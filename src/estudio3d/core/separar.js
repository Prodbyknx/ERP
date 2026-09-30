// PartSeparator — transforma uma região selecionada em peça independente,
// fechando as DUAS peças (a que fica e a que sai). Dois métodos:
//
//  PLANO (padrão): acha o plano da borda da seleção, e com o Manifold faz
//    detalhe = peça ∩ prisma(pegada da seleção) e resto = peça − prisma.
//    As duas faces do corte são planas e idênticas (encaixe perfeito, boa
//    pra colar e pra imprimir deitada). Com 'profundidade' o plano desce pra
//    dentro da peça: o detalhe ganha espessura e o resto ganha um bolso
//    (é assim que um olho pintado vira peça imprimível). 'folga' alarga o bolso.
//    Depois confere pelo rastreio de triângulos que o prisma NÃO pegou nada
//    fora da seleção (+ uma faixa perto da borda). Se pegou, não aceita.
//
//  SUPERFÍCIE: segue a borda exata da seleção e tampa os buracos com a mesma
//    tampa nas duas peças (lisa quando a borda não é plana). Usado quando o
//    plano não serve (seleção curva demais ou o prisma pegaria outra parte).
//
//  CAMADA: com 'profundidade' numa região curva (o plano não serve), o
//    detalhe vira uma camada que acompanha a superfície e o resto ganha o
//    bolso do mesmo formato (ex.: olho pintado numa cabeça redonda).
import { comContexto, manifold } from './solidos.js';
import { prepararAdjacencia, limpar, regioes, expandir } from './selecao.js';
import { criar, subMalha, areaFace, compactar, volume } from './malha.js';
import { triangularLaco, refinarEAlisar, reparar } from './reparo.js';
import { gerarConectores, dimensionarConector } from './conectores.js';
import { componentes } from './topologia.js';
import { autoInterseccoes } from './validador.js';
import { separarNoPlano } from './corteLocal.js';
import * as M4 from './mat4.js';
import { progresso } from './progresso.js';

/* ---------------------------------------------------------- utilidades */

// autovetores de matriz simétrica 3x3 (Jacobi). Devolve {val:[3], vec:[[3]x3]} crescente
export function autovetores3(A) {
  const a = [[A[0], A[1], A[2]], [A[1], A[3], A[4]], [A[2], A[4], A[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1, mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { mx = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > mx) { mx = Math.abs(a[1][2]); p = 1; q = 2; }
    if (mx < 1e-15) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
    }
  }
  const ord = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { val: ord.map(i => a[i][i]), vec: ord.map(i => [v[0][i], v[1][i], v[2][i]]) };
}

function cascoConvexo(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  hi.pop(); lo.pop();
  return lo.concat(hi);
}

// Arestas da borda da seleção e laços orientados como nas faces selecionadas
function bordaDaSelecao(m, adj, R) {
  const nt = R.length, idx = m.idx;
  const saida = new Map();         // vértice -> [meia-arestas de borda saindo dele]
  const verts = new Set();
  let nArestas = 0;
  for (let f = 0; f < nt; f++) {
    if (!R[f]) continue;
    for (let k = 0; k < 3; k++) {
      const o = adj.viz[f * 3 + k];
      if (o >= 0 && R[o]) continue;
      const a = idx[f * 3 + k], b = idx[f * 3 + (k + 1) % 3];
      const l = saida.get(a); if (l) l.push(b); else saida.set(a, [b]);
      verts.add(a); verts.add(b); nArestas++;
    }
  }
  const usadas = new Set();
  const lacos = [];
  for (const [a0, lista] of saida) {
    for (const b0 of lista) {
      const k0 = a0 + '_' + b0;
      if (usadas.has(k0)) continue;
      const laco = [a0];
      let a = a0, b = b0, ok = true, n = 0;
      usadas.add(k0);
      while (b !== a0) {
        laco.push(b);
        const cand = saida.get(b) || [];
        let prox = -1;
        for (const c of cand) if (!usadas.has(b + '_' + c)) { prox = c; break; }
        if (prox < 0 || ++n > 2e6) { ok = false; break; }
        usadas.add(b + '_' + prox);
        a = b; b = prox;
      }
      if (ok && laco.length >= 3) lacos.push(laco);
    }
  }
  return { verts: [...verts], lacos, nArestas };
}

function planoDaBorda(m, verts, R) {
  const p = m.pos;
  let cx = 0, cy = 0, cz = 0;
  for (const v of verts) { cx += p[v * 3]; cy += p[v * 3 + 1]; cz += p[v * 3 + 2]; }
  cx /= verts.length; cy /= verts.length; cz /= verts.length;
  const C = [0, 0, 0, 0, 0, 0];
  for (const v of verts) {
    const x = p[v * 3] - cx, y = p[v * 3 + 1] - cy, z = p[v * 3 + 2] - cz;
    C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z;
  }
  const e = autovetores3(C);
  let n = e.vec[0];
  // normal aponta pro lado da seleção
  let s = 0;
  for (let f = 0; f < R.length; f++) {
    if (!R[f]) continue;
    const a = m.idx[f * 3] * 3, b = m.idx[f * 3 + 1] * 3, c = m.idx[f * 3 + 2] * 3;
    const w = areaFace(m, f);
    s += w * (((p[a] + p[b] + p[c]) / 3 - cx) * n[0] + ((p[a + 1] + p[b + 1] + p[c + 1]) / 3 - cy) * n[1] + ((p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz) * n[2]);
  }
  if (s < 0) n = [-n[0], -n[1], -n[2]];
  let desvio = 0, raio = 0;
  for (const v of verts) {
    const x = p[v * 3] - cx, y = p[v * 3 + 1] - cy, z = p[v * 3 + 2] - cz;
    desvio = Math.max(desvio, Math.abs(x * n[0] + y * n[1] + z * n[2]));
    raio = Math.max(raio, Math.hypot(x, y, z));
  }
  return { centro: [cx, cy, cz], n, desvio, raio, linear: e.val[1] < 1e-9 * (e.val[2] || 1) };
}

/* ---------------------------------------------------------- método plano */

function extrairPorPlano(ctx, atual, R, adj, opc, avisos) {
  const { Manifold, CrossSection } = manifold();
  const m = atual.malha;
  const b = bordaDaSelecao(m, adj, R);
  const pl = planoDaBorda(m, b.verts, R);
  if (pl.linear) return { falhou: 'A borda da seleção é uma linha; não dá pra achar um plano.' };
  const n = opc.normal ? normalizar(opc.normal) : pl.n;
  const prof = Math.max(0, opc.profundidade || 0);
  const desloc = opc.deslocamento || 0;
  const origem = [pl.centro[0] + n[0] * (desloc - prof), pl.centro[1] + n[1] * (desloc - prof), pl.centro[2] + n[2] * (desloc - prof)];
  const F = M4.doPlano(origem, n);
  const Fi = M4.inverter(F);
  // pegada e altura da seleção no referencial do plano
  const pts = [];
  let H = 0, areaAbaixo = 0, areaTot = 0;
  const tolZ = Math.max(0.05, pl.raio * 0.02);
  const vistos = new Uint8Array(m.pos.length / 3);
  for (let f = 0; f < R.length; f++) {
    if (!R[f]) continue;
    let zc = 0;
    for (let k = 0; k < 3; k++) {
      const v = m.idx[f * 3 + k];
      const q = M4.aplicarPonto(Fi, m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
      zc += q[2] / 3;
      if (!vistos[v]) { vistos[v] = 1; pts.push([q[0], q[1]]); if (q[2] > H) H = q[2]; }
    }
    const a = areaFace(m, f);
    areaTot += a;
    if (zc < prof - tolZ) areaAbaixo += a;
  }
  if (areaAbaixo / areaTot > 0.15 && !opc.forcarPlano) {
    return { falhou: 'A seleção dobra pra baixo do plano da borda (' + Math.round(100 * areaAbaixo / areaTot) + '% dela).' };
  }
  const casco = cascoConvexo(pts);
  if (casco.length < 3) return { falhou: 'Seleção sem área no plano.' };
  const margem = opc.margem != null ? opc.margem : Math.max(0.4, pl.raio * 0.04);
  const csBase = ctx.guardar(CrossSection.ofPolygons([casco], 'EvenOdd'));
  const Q = ctx.guardar(csBase.offset(margem, 'Round', 2, 48));
  const alto = H + margem + 1;
  const Kd = ctx.guardar(ctx.guardar(Manifold.extrude(Q, alto)).transform(Array.from(F)));
  const folga = Math.max(0, opc.folga || 0);
  let Kp = Kd;
  if (folga > 0) {
    const Qf = ctx.guardar(Q.offset(folga, 'Round', 2, 48));
    Kp = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.extrude(Qf, alto + folga)).translate([0, 0, -folga])).transform(Array.from(F)));
  }
  const M = atual.man;
  let det = ctx.guardar(M.intersect(Kd));
  let resto = ctx.guardar(M.subtract(Kp));
  if (det.isEmpty()) return { falhou: 'O corte plano não pegou nada.' };
  if (resto.isEmpty()) return { falhou: 'O corte plano levaria a peça inteira.' };

  // conferência: o prisma só pode ter pegado a seleção (e perto da borda dela)
  const detParte = ctx.parte(det, 'detalhe', atual.corDetalhe, true);
  // faixa aceita perto da borda: o plano se afasta da borda até 'desvio' e o
  // prisma passa dela até 'margem'
  let somaA = 0, nA = 0;
  for (const laco of b.lacos) for (let i = 0; i < laco.length; i++) {
    const u = laco[i] * 3, w = laco[(i + 1) % laco.length] * 3;
    somaA += Math.hypot(m.pos[u] - m.pos[w], m.pos[u + 1] - m.pos[w + 1], m.pos[u + 2] - m.pos[w + 2]); nA++;
  }
  const arestaMedia = nA ? somaA / nA : 1;
  const aneis = opc.faixa != null ? opc.faixa : Math.min(60, Math.ceil((pl.desvio + margem + prof) / Math.max(1e-6, arestaMedia)) + 2);
  const faixa = expandir(R, adj, aneis);
  const permitido = new Set();
  for (let f = 0; f < faixa.length; f++) if (faixa[f] && atual.origem[f] >= 0) permitido.add(atual.origem[f]);
  let capturada = 0, daSelecao = 0;
  const dm = detParte.malha;
  // opc.faixaMm: faixa aceita medida em mm (distância até a borda), não em
  // anéis de triângulo — malha com triângulo miúdo na borda (borda de cor
  // alisada) deixaria a faixa estreita demais
  let perto = null;
  if (opc.faixaMm != null) {
    const bv = []; for (const laco of b.lacos) for (const v of laco) bv.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
    const r2 = opc.faixaMm * opc.faixaMm, rootSel = new Set();
    for (let f = 0; f < R.length; f++) if (R[f] && atual.origem[f] >= 0) rootSel.add(atual.origem[f]);
    // face capturada conta como "perto" se algum vértice dela está na faixa
    // (malha de triângulo grande: o vizinho da borda tem o centro longe, mas
    // encosta nela; o vão entre as pontas de uma estrela continua contando)
    perto = (o, t) => {
      if (rootSel.has(o)) return true;
      for (let k = 0; k < 3; k++) {
        const q = dm.idx[t * 3 + k] * 3, cx = dm.pos[q], cy = dm.pos[q + 1], cz = dm.pos[q + 2];
        for (let j = 0; j < bv.length; j += 3) { const dx = bv[j] - cx, dy = bv[j + 1] - cy, dz = bv[j + 2] - cz; if (dx * dx + dy * dy + dz * dz <= r2) return true; }
      }
      return false;
    };
  }
  for (let t = 0; t < dm.idx.length / 3; t++) {
    const o = detParte.origem[t];
    if (o < 0) continue;
    const a = areaFace(dm, t);
    if (perto ? perto(o, t) : permitido.has(o)) daSelecao += a; else capturada += a;
  }
  if (capturada > Math.max(0.02 * daSelecao, 0.5) && !opc.forcarPlano) {
    return { falhou: 'O corte plano pegaria outra parte do modelo junto (' + capturada.toFixed(1) + ' mm² fora da seleção).' };
  }
  // cada pedaço do detalhe precisa conter parte da seleção. Lasca de volume
  // ~0 (corte coplanar com uma face existente) é descartada dos dois lados.
  const volMin = Math.max(1e-3, 1e-7 * Math.abs(M.volume()));
  const rootR = new Set();
  for (let f = 0; f < R.length; f++) if (R[f] && atual.origem[f] >= 0) rootR.add(atual.origem[f]);
  const comps = det.decompose().map(c => ctx.guardar(c));
  if (comps.length > 1) {
    const bons = [];
    let lixo = 0;
    for (const c of comps) {
      const cp = ctx.parte(c, 'x', null, true);
      if (cp.origem.some(o => rootR.has(o))) bons.push(c);
      else if (Math.abs(c.volume()) > volMin) lixo++;
    }
    if (lixo && !opc.forcarPlano) return { falhou: 'O corte plano soltaria ' + lixo + ' pedaço(s) que não fazem parte da seleção.' };
    if (!bons.length) return { falhou: 'O corte plano não pegou a seleção.' };
    det = bons.length === 1 ? bons[0] : ctx.guardar(Manifold.compose(bons));
  }
  const compsR = resto.decompose().map(c => ctx.guardar(c));
  if (compsR.length > 1) {
    const bons = compsR.filter(c => Math.abs(c.volume()) > volMin);
    if (bons.length && bons.length < compsR.length) resto = bons.length === 1 ? bons[0] : ctx.guardar(Manifold.compose(bons));
  }

  let relatorio = [], soltos = [];
  if (opc.conector && opc.conector.tipo && opc.conector.tipo !== 'nenhum') {
    const loc = ctx.guardar(det.transform(Array.from(Fi)));
    const sec = ctx.guardar(loc.slice(1e-3));
    const secao = sec.toPolygons();
    if (secao.length) {
      const g = gerarConectores(ctx, { solidoA: det, solidoB: resto, frame: F, secao, cfg: dimensionarConector(secao, opc.conector, avisos) });
      avisos.push(...g.avisos);
      relatorio = g.relatorio;
      if (g.positivos.length) det = ctx.guardar(det.add(g.positivos.length === 1 ? g.positivos[0] : ctx.guardar(Manifold.union(g.positivos))));
      if (g.negativosB.length) resto = ctx.guardar(resto.subtract(g.negativosB.length === 1 ? g.negativosB[0] : ctx.guardar(Manifold.union(g.negativosB))));
      // pino solto / de filamento: furo também no detalhe
      if (g.negativosA.length) det = ctx.guardar(det.subtract(g.negativosA.length === 1 ? g.negativosA[0] : ctx.guardar(Manifold.union(g.negativosA))));
      soltos = g.soltos;
    } else avisos.push('Não achei a face do corte pra pôr o conector.');
  }
  return {
    det, resto, metodo: 'plano', relatorio, soltos,
    plano: { n, d: n[0] * origem[0] + n[1] * origem[1] + n[2] * origem[2], centro: origem, desvioBorda: pl.desvio }
  };
}

function normalizar(v) { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; }

/* ---------------------------------------------------------- método camada */

// Região pintada numa superfície CURVA com espessura: o plano não serve (a
// região dobra), então o detalhe vira uma camada de espessura t que acompanha
// a curvatura e a peça principal ganha o bolso do mesmo formato. As duas peças
// são montadas direto da malha (sem booleana): o topo do detalhe são as faces
// originais da região (cor e forma exatas), o fundo é a região empurrada pra
// dentro pelas normais dos vértices e as paredes descem ao longo da borda.
// Depois confere se nada se cruza (curva mais fechada que a espessura, ou
// parede mais fina que ela); se cruzar, suaviza as normais e tenta de novo.
function extrairPorCamada(ctx, atual, R, adj, opc) {
  const m = atual.malha, p = m.pos, I = m.idx, nt = R.length, nv0 = p.length / 3;
  const t = Math.max(0.2, opc.profundidade || 0), folga = Math.max(0, opc.folga || 0);
  const mapa = new Int32Array(nv0).fill(-1), verts = [];
  for (let f = 0; f < nt; f++) if (R[f]) for (let k = 0; k < 3; k++) { const v = I[f * 3 + k]; if (mapa[v] < 0) { mapa[v] = verts.length; verts.push(v); } }
  const nv = verts.length, N0 = new Float64Array(nv * 3), viz = verts.map(() => new Set());
  // normal do vértice com TODAS as faces em volta (inclusive fora da região):
  // na borda serrilhada de uma região de cor ela varia suave
  for (let f = 0; f < nt; f++) {
    const a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2];
    if (mapa[a] < 0 && mapa[b] < 0 && mapa[c] < 0) continue;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];   // |n| = 2·área: média ponderada
    for (const v of [a, b, c]) { const j = mapa[v]; if (j >= 0) { N0[j * 3] += n[0]; N0[j * 3 + 1] += n[1]; N0[j * 3 + 2] += n[2]; } }
    if (R[f]) { viz[mapa[a]].add(mapa[b]).add(mapa[c]); viz[mapa[b]].add(mapa[a]).add(mapa[c]); viz[mapa[c]].add(mapa[a]).add(mapa[b]); }
  }
  const unit = A => { for (let j = 0; j < A.length; j += 3) { const L = Math.hypot(A[j], A[j + 1], A[j + 2]) || 1; A[j] /= L; A[j + 1] /= L; A[j + 2] /= L; } return A; };
  unit(N0);
  // meias-arestas da borda (u -> v como na face da região)
  const bordas = [];
  for (let f = 0; f < nt; f++) if (R[f]) for (let k = 0; k < 3; k++) {
    const o = adj.viz[f * 3 + k];
    if (o < 0 || !R[o]) bordas.push(I[f * 3 + k], I[f * 3 + (k + 1) % 3]);
  }
  if (!bordas.length) return { falhou: 'Não achei a borda da região.' };
  // FOLGA LATERAL: a borda do inserto recua 'fl' mm pra dentro da região (no
  // plano da superfície) e o bolso fica no contorno original — sem isso as
  // duas paredes coincidem e o encaixe não entra na peça impressa
  const fl = opc.folgaLateral != null ? Math.max(0, opc.folgaLateral) : folga;
  const D = new Float64Array(nv * 3);
  if (fl > 0) {
    for (let i = 0; i < bordas.length; i += 2) {
      const u = bordas[i], v = bordas[i + 1];
      const ex = p[v * 3] - p[u * 3], ey = p[v * 3 + 1] - p[u * 3 + 1], ez = p[v * 3 + 2] - p[u * 3 + 2];
      for (const j of [mapa[u], mapa[v]]) {
        const nx = N0[j * 3], ny = N0[j * 3 + 1], nz = N0[j * 3 + 2];
        // normal × aresta = lado de dentro (a face da região fica à esquerda)
        const ix = ny * ez - nz * ey, iy = nz * ex - nx * ez, iz = nx * ey - ny * ex, L = Math.hypot(ix, iy, iz) || 1;
        D[j * 3] += ix / L; D[j * 3 + 1] += iy / L; D[j * 3 + 2] += iz / L;
      }
    }
    // direção alisada ao longo da borda (dobra curta na borda não entorta o recuo)
    const vizB = new Map(); const liga = (a, b) => { if (!vizB.has(a)) vizB.set(a, []); vizB.get(a).push(b); };
    for (let i = 0; i < bordas.length; i += 2) { const a = mapa[bordas[i]], b = mapa[bordas[i + 1]]; liga(a, b); liga(b, a); }
    for (let it = 0; it < 3; it++) {
      const S = Float64Array.from(D);
      for (const [j, lista] of vizB) for (const q of lista) { S[j * 3] += 0.5 * D[q * 3]; S[j * 3 + 1] += 0.5 * D[q * 3 + 1]; S[j * 3 + 2] += 0.5 * D[q * 3 + 2]; }
      D.set(S);
    }
    for (let j = 0; j < nv; j++) {
      const nx = N0[j * 3], ny = N0[j * 3 + 1], nz = N0[j * 3 + 2], dn = D[j * 3] * nx + D[j * 3 + 1] * ny + D[j * 3 + 2] * nz;
      D[j * 3] -= dn * nx; D[j * 3 + 1] -= dn * ny; D[j * 3 + 2] -= dn * nz;
      const L = Math.hypot(D[j * 3], D[j * 3 + 1], D[j * 3 + 2]);
      if (L > 1e-9) { D[j * 3] *= fl / L; D[j * 3 + 1] *= fl / L; D[j * 3 + 2] *= fl / L; }
    }
  }
  const naBorda = new Uint8Array(nv); for (let i = 0; i < bordas.length; i++) naBorda[mapa[bordas[i]]] = 1;
  // o miolo perto da borda recua junto, cada vez menos até 3·fl pra dentro:
  // vértice a menos de fl da borda (triângulo miúdo) não fica pra trás dela
  const Dm = new Float64Array(nv * 3);
  if (fl > 0) {
    const Rm = 3 * fl, dist = new Float64Array(nv).fill(Infinity), fonte = new Int32Array(nv).fill(-1), fila = [];
    for (let j = 0; j < nv; j++) if (naBorda[j]) { dist[j] = 0; fonte[j] = j; fila.push(j); }
    while (fila.length) {
      let mi = 0; for (let i = 1; i < fila.length; i++) if (dist[fila[i]] < dist[fila[mi]]) mi = i;
      const j = fila[mi]; fila[mi] = fila[fila.length - 1]; fila.pop();
      const vj = verts[j] * 3;
      for (const q of viz[j]) {
        if (naBorda[q]) continue;
        const vq = verts[q] * 3, nd = dist[j] + Math.hypot(p[vj] - p[vq], p[vj + 1] - p[vq + 1], p[vj + 2] - p[vq + 2]);
        if (nd < Rm && nd < dist[q]) { if (dist[q] === Infinity) fila.push(q); dist[q] = nd; fonte[q] = fonte[j]; }
      }
    }
    for (let j = 0; j < nv; j++) if (!naBorda[j] && fonte[j] >= 0) { const w = 1 - dist[j] / Rm; for (let e = 0; e < 3; e++) Dm[j * 3 + e] = D[fonte[j] * 3 + e] * w; }
  }
  const temCor = !!m.cor;
  const kDet = atual.corDetalheIdx != null ? atual.corDetalheIdx : 0, kRes = atual.corRestoIdx != null ? atual.corRestoIdx : 0;
  // caixa da região + espessura: só ali pode aparecer cruzamento novo
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let e = 0; e < 3; e++) { mn[e] = Math.min(mn[e], p[v * 3 + e]); mx[e] = Math.max(mx[e], p[v * 3 + e]); }
  const pad = t + folga + 0.01;
  const perto = (P, mm, f) => { for (let k = 0; k < 3; k++) { const v = mm.idx[f * 3 + k] * 3; if (P[v] > mn[0] - pad && P[v] < mx[0] + pad && P[v + 1] > mn[1] - pad && P[v + 1] < mx[1] + pad && P[v + 2] > mn[2] - pad && P[v + 2] < mx[2] + pad) return true; } return false; };
  const cruza = mm => { const loc = subMalha(mm, Uint8Array.from({ length: mm.idx.length / 3 }, (_, f) => perto(mm.pos, mm, f) ? 1 : 0)).malha; return autoInterseccoes(loc, { max: 1 }).pares > 0; };

  // suavização proporcional a quantas arestas cabem na espessura (malha fina
  // de IA tem triângulo bem menor que a espessura: normal crua dobraria)
  let somaA = 0;
  for (let i = 0; i < bordas.length; i += 2) { const a = bordas[i] * 3, b = bordas[i + 1] * 3; somaA += Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]); }
  const aneis = (t + folga) / Math.max(1e-6, somaA / (bordas.length / 2));
  const tentativas = [...new Set([0, 1, 4, 12, 40].map(k => Math.min(400, Math.ceil(k * aneis * aneis))))];
  for (const passos of tentativas) {
    let N = N0;
    for (let it = 0; it < passos; it++) {
      const S = Float64Array.from(N);
      for (let j = 0; j < nv; j++) for (const q of viz[j]) { S[j * 3] += N[q * 3]; S[j * 3 + 1] += N[q * 3 + 1]; S[j * 3 + 2] += N[q * 3 + 2]; }
      N = unit(S);
    }
    const baseT = nv0, baseF = folga > 0 ? nv0 + nv : nv0, baseS = nv0 + nv * (folga > 0 ? 2 : 1);
    const P = new Float64Array((baseS + (fl > 0 ? nv : 0)) * 3);
    P.set(p);
    for (let j = 0; j < nv; j++) for (let e = 0; e < 3; e++) {
      const v = verts[j] * 3 + e;
      P[(baseT + j) * 3 + e] = p[v] - N[j * 3 + e] * t + D[j * 3 + e] + Dm[j * 3 + e];
      if (Dm[j * 3 + e]) P[v] = p[v] + Dm[j * 3 + e];       // miolo: só o detalhe usa
      if (folga > 0) P[(baseF + j) * 3 + e] = p[v] - N[j * 3 + e] * (t + folga);
      if (fl > 0) P[(baseS + j) * 3 + e] = p[v] + D[j * 3 + e];
    }
    // vértice do topo do inserto: o recuado (borda) ou o original (miolo)
    const topo = x => fl > 0 && naBorda[mapa[x]] ? baseS + mapa[x] : x;
    const iD = [], iR = [], cD = [], cR = [], oD = [], oR = [];
    const novaD = (a, b, c) => { iD.push(a, b, c); cD.push(kDet); oD.push(-1); };
    const novaR = (a, b, c) => { iR.push(a, b, c); cR.push(kRes); oR.push(-1); };
    for (let f = 0; f < nt; f++) {
      const a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2];
      if (R[f]) {
        iD.push(topo(a), topo(b), topo(c)); cD.push(temCor ? m.cor[f] : kDet); oD.push(atual.origem[f]);
        novaD(baseT + mapa[a], baseT + mapa[c], baseT + mapa[b]);   // fundo do detalhe
        novaR(baseF + mapa[a], baseF + mapa[b], baseF + mapa[c]);   // fundo do bolso
      } else { iR.push(a, b, c); cR.push(temCor ? m.cor[f] : kRes); oR.push(atual.origem[f]); }
    }
    for (let i = 0; i < bordas.length; i += 2) {
      const u = bordas[i], v = bordas[i + 1];
      novaD(topo(v), topo(u), baseT + mapa[u]); novaD(topo(v), baseT + mapa[u], baseT + mapa[v]);
      novaR(v, baseF + mapa[u], u); novaR(v, baseF + mapa[v], baseF + mapa[u]);
    }
    const d = compactarComOrigem(criar(P, Uint32Array.from(iD), temCor ? Uint16Array.from(cD) : null), oD);
    const r = compactarComOrigem(criar(P, Uint32Array.from(iR), temCor ? Uint16Array.from(cR) : null), oR);
    if (cruza(d.malha) || cruza(r.malha)) continue;
    return { detMalha: d.malha, detOrigem: d.origem, restoMalha: r.malha, restoOrigem: r.origem, metodo: 'camada' };
  }
  // borda serrilhada (degraus) pode fazer o recuo lateral se cruzar nos
  // cantos: sem folga lateral ainda dá peça (encaixe mais justo), com aviso
  if (fl > 0) { const r2 = extrairPorCamada(ctx, atual, R, adj, { ...opc, folgaLateral: 0 }); if (!r2.falhou) { r2.semFolgaLateral = true; return r2; } }
  return { falhou: 'A camada de ' + t.toFixed(1) + ' mm se cruzaria (curva mais fechada ou parede mais fina que a espessura). Use uma espessura menor.' };
}

/* ---------------------------------------------------------- método plano local */

// Plano da borda da seleção, mas só o pedaço ligado à seleção sai (mão perto
// da coxa: o prisma do plano comum pegaria a coxa). Faces planas -> aceita encaixe.
function extrairPorPlanoLocal(ctx, atual, R, adj, opc, avisos) {
  const m = atual.malha, p = m.pos, I = m.idx;
  const b = bordaDaSelecao(m, adj, R);
  // plano pelo laço principal da borda (onde a parte encosta no corpo)
  let lacoP = b.lacos[0] || [];
  for (const l of b.lacos) if (l.length > lacoP.length) lacoP = l;
  const pl = planoDaBorda(m, lacoP.length >= 3 ? lacoP : b.verts, R);
  if (pl.linear) return { falhou: 'A borda da seleção é uma linha.' };
  const n = pl.n, d0 = n[0] * pl.centro[0] + n[1] * pl.centro[1] + n[2] * pl.centro[2];
  // ponto da seleção mais longe do plano (a "ponta" da parte) e o mais baixo
  let ponto = null, dm = -Infinity, dMin = Infinity, aSel = 0;
  for (let f = 0; f < R.length; f++) {
    if (!R[f]) continue;
    aSel += areaFace(m, f);
    const c = [0, 1, 2].map(e => (p[I[f * 3] * 3 + e] + p[I[f * 3 + 1] * 3 + e] + p[I[f * 3 + 2] * 3 + e]) / 3);
    const s = c[0] * n[0] + c[1] * n[1] + c[2] * n[2] - d0;
    if (s > dm) { dm = s; ponto = c; }
    for (let k = 0; k < 3; k++) { const v = I[f * 3 + k] * 3; dMin = Math.min(dMin, p[v] * n[0] + p[v + 1] * n[1] + p[v + 2] * n[2] - d0); }
  }
  if (!(dm > 0)) return { falhou: 'A seleção não sai do plano da borda.' };
  let somaA = 0, nA = 0;
  for (const laco of b.lacos) for (let i = 0; i < laco.length; i++) {
    const u = laco[i] * 3, w = laco[(i + 1) % laco.length] * 3;
    somaA += Math.hypot(p[u] - p[w], p[u + 1] - p[w + 1], p[u + 2] - p[w + 2]); nA++;
  }
  const aneis = Math.min(60, Math.ceil((pl.desvio + 0.5) / Math.max(1e-6, nA ? somaA / nA : 1)) + 2);
  const faixa = expandir(R, adj, aneis), permitido = new Set(), daSel = new Set();
  for (let f = 0; f < faixa.length; f++) if (atual.origem[f] >= 0) { if (faixa[f]) permitido.add(atual.origem[f]); if (R[f]) daSel.add(atual.origem[f]); }
  const tentar = (d, folgaFora) => {
    const av = [];
    let r;
    try { r = separarNoPlano(ctx, atual.man, { n, d }, ponto, { conector: opc.conector }, av); }
    catch (e) { return { falhou: e.message }; }
    // conferência: o pedaço cobre a seleção e não leva outra parte junto
    const dp = ctx.parte(r.det, 'detalhe', atual.corDetalhe, true);
    let cobre = 0, fora = 0;
    for (let t = 0; t < dp.malha.idx.length / 3; t++) {
      const o = dp.origem[t];
      if (o < 0) continue;
      const a = areaFace(dp.malha, t);
      if (daSel.has(o)) cobre += a; else if (!permitido.has(o)) fora += a;
    }
    if (cobre < 0.8 * aSel) return { falhou: 'O plano da borda deixaria ' + Math.round(100 - 100 * cobre / aSel) + '% da seleção pra trás.' };
    if (fora > folgaFora * aSel + 1) return { falhou: 'O corte pegaria outra parte do modelo junto (' + fora.toFixed(1) + ' mm²).' };
    return { r, av, fora };
  };
  let t = tentar(d0, 0.05);
  // borda torta (não plana): desce o plano até a seleção inteira ficar do lado
  // de fora; aceita levar um pouco além da seleção (até 30% da área dela)
  if (t.falhou && dMin < -0.05) {
    const t2 = tentar(d0 + dMin - 0.05, 0.3);
    if (!t2.falhou) { t = t2; if (t.fora > 0.5) t.av.push('Pra o corte ficar plano ele pegou ' + t.fora.toFixed(0) + ' mm² além da seleção.'); }
  }
  if (t.falhou) return t;
  avisos.push(...t.av);
  return { det: t.r.det, resto: t.r.resto, metodo: 'plano-local', relatorio: t.r.relatorio, soltos: t.r.soltos, plano: { n, d: d0, centro: pl.centro, desvioBorda: pl.desvio } };
}

// cruzamentos novos perto da tampa (o fechamento pela superfície pode furar
// a própria peça quando a seleção encosta em outra parte)
function cruzamentosPerto(malhaNova, origem, malhaAntes) {
  const nt = malhaNova.idx.length / 3, P = malhaNova.pos;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < nt; t++) if (origem[t] < 0) for (let k = 0; k < 3; k++) { const v = malhaNova.idx[t * 3 + k] * 3; for (let e = 0; e < 3; e++) { mn[e] = Math.min(mn[e], P[v + e]); mx[e] = Math.max(mx[e], P[v + e]); } }
  if (!isFinite(mn[0])) return 0;
  const conta = mm => {
    const Q = mm.pos, J = mm.idx, sel = new Uint8Array(J.length / 3);
    for (let t = 0; t < sel.length; t++) for (let k = 0; k < 3 && !sel[t]; k++) { const v = J[t * 3 + k] * 3; if ([0, 1, 2].every(e => Q[v + e] >= mn[e] - 0.5 && Q[v + e] <= mx[e] + 0.5)) sel[t] = 1; }
    return autoInterseccoes(subMalha(mm, sel).malha, { max: 200 }).pares;
  };
  return conta(malhaNova) - conta(malhaAntes);
}

/* ---------------------------------------------------------- método superfície */

function extrairPelaSuperficie(atual, R, adj, opc) {
  const m = atual.malha;
  const b = bordaDaSelecao(m, adj, R);
  if (!b.lacos.length) return { falhou: 'Não achei a borda da seleção.' };
  const pos = Array.from(m.pos);
  const tampas = [];
  for (const laco of b.lacos) {
    const r = triangularLaco(pos, laco);
    let tris = r.tris;
    if (!r.plano && opc.alisar !== false && laco.length > 6) {
      let per = 0;
      for (let i = 0; i < laco.length; i++) {
        const a = laco[i] * 3, c = laco[(i + 1) % laco.length] * 3;
        per += Math.hypot(pos[a] - pos[c], pos[a + 1] - pos[c + 1], pos[a + 2] - pos[c + 2]);
      }
      tris = refinarEAlisar(pos, tris, laco, per / laco.length, 20);
    }
    tampas.push(...tris);
  }
  const nt = R.length;
  const idxD = [], idxR = [], corD = [], corR = [], orD = [], orR = [];
  const temCor = !!m.cor;
  for (let f = 0; f < nt; f++) {
    const alvo = R[f] ? idxD : idxR;
    alvo.push(m.idx[f * 3], m.idx[f * 3 + 1], m.idx[f * 3 + 2]);
    if (temCor) (R[f] ? corD : corR).push(m.cor[f]);
    (R[f] ? orD : orR).push(atual.origem[f]);
  }
  const kDet = atual.corDetalheIdx != null ? atual.corDetalheIdx : 0;
  const kRes = atual.corRestoIdx != null ? atual.corRestoIdx : 0;
  for (let i = 0; i < tampas.length; i += 3) {
    idxD.push(tampas[i], tampas[i + 1], tampas[i + 2]);
    idxR.push(tampas[i], tampas[i + 2], tampas[i + 1]);
    if (temCor) { corD.push(kDet); corR.push(kRes); }
    orD.push(-1); orR.push(-1);
  }
  const P = Float64Array.from(pos);
  const det = compactarComOrigem(criar(P, Uint32Array.from(idxD), temCor ? Uint16Array.from(corD) : null), orD);
  const resto = compactarComOrigem(criar(P, Uint32Array.from(idxR), temCor ? Uint16Array.from(corR) : null), orR);
  return { detMalha: det.malha, detOrigem: det.origem, restoMalha: resto.malha, restoOrigem: resto.origem, metodo: 'superficie', lacos: b.lacos.length };
}

// faces novas (tampa, parede, fundo) precisam das duas cores na paleta
function paletaDasTampas(atual, corDetalhe) {
  if (!atual.paleta) return;
  atual.paleta = atual.paleta.slice();
  if (atual.paleta.indexOf(corDetalhe) < 0) atual.paleta.push(corDetalhe);
  if (atual.paleta.indexOf(atual.cor) < 0) atual.paleta.push(atual.cor);
  atual.corDetalheIdx = atual.paleta.indexOf(corDetalhe);
  atual.corRestoIdx = atual.paleta.indexOf(atual.cor);
}

function compactarComOrigem(m, origem) {
  const nt = m.idx.length / 3;
  const todas = new Uint32Array(nt); for (let t = 0; t < nt; t++) todas[t] = t;
  return { malha: subMalha(m, todas).malha, origem: Int32Array.from(origem) };
}

// Conserta a malha (solda, orientação, buracos) e leva a seleção pelas faces
// iguais (mesmo centro); tampa nova herda a seleção das vizinhas.
function consertarComMascara(parte, mascara) {
  const adj0 = prepararAdjacencia(parte.malha);
  let aberta = false;
  for (let h = 0; h < adj0.viz.length && !aberta; h++) if (adj0.viz[h] < 0) aberta = true;
  if (!aberta) return null;
  const r = reparar(parte.malha, {});
  const m = r.malha, nt = m.idx.length / 3;
  const chave = (x, y, z) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
  const C0 = centroidesDe(parte.malha), mapa = new Map();
  for (let f = 0; f < mascara.length; f++) mapa.set(chave(C0[f * 3], C0[f * 3 + 1], C0[f * 3 + 2]), mascara[f]);
  const C = centroidesDe(m), out = new Uint8Array(nt), novo = new Uint8Array(nt);
  for (let f = 0; f < nt; f++) { const v = mapa.get(chave(C[f * 3], C[f * 3 + 1], C[f * 3 + 2])); if (v === undefined) novo[f] = 1; else out[f] = v; }
  const adj = prepararAdjacencia(m);
  for (let volta = 0; volta < 8; volta++) {
    let mudou = false;
    for (let f = 0; f < nt; f++) {
      if (!novo[f]) continue;
      let sim = 0, nao = 0;
      for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o < 0 || novo[o] === 1) continue; if (out[o]) sim++; else nao++; }
      if (sim + nao) { out[f] = sim > nao ? 1 : 0; novo[f] = 2; mudou = true; }
    }
    if (!mudou) break;
  }
  return { parte: { ...parte, malha: m }, mascara: out, aviso: 'Consertei a malha antes de separar' + (r.passos.length ? ': ' + r.passos.join(', ') : '') + '.' };
}
function centroidesDe(m) {
  const nt = m.idx.length / 3, c = new Float64Array(nt * 3), p = m.pos, I = m.idx;
  for (let f = 0; f < nt; f++) for (let e = 0; e < 3; e++) c[f * 3 + e] = (p[I[f * 3] * 3 + e] + p[I[f * 3 + 1] * 3 + e] + p[I[f * 3 + 2] * 3 + e]) / 3;
  return c;
}

function unirCascasComMascara(parte, mascara) {
  const adj = prepararAdjacencia(parte.malha);
  for (let h = 0; h < adj.viz.length; h++) if (adj.viz[h] < 0) return null;   // aberta: o erro claro vem depois
  return comContexto(ctx => {
    const { Manifold } = manifold();
    let man;
    try { man = ctx.solido(parte, parte.nome); } catch (e) { return null; }
    const comps = man.decompose();
    if (comps.length < 2) { for (const c of comps) c.delete(); return null; }
    let soma = 0; for (const c of comps) soma += c.volume();
    const u = ctx.guardar(Manifold.union(comps));
    for (const c of comps) c.delete();
    if (soma - u.volume() <= 1e-6 * Math.max(1, soma)) return null;
    const pu = ctx.parte(u, parte.nome, parte.cor, true);
    const m2 = new Uint8Array(pu.malha.idx.length / 3);
    for (let f = 0; f < m2.length; f++) { const o = pu.origem[f]; if (o >= 0 && mascara[o]) m2[f] = 1; }
    return { parte: { nome: parte.nome, malha: pu.malha, cor: pu.cor, paleta: pu.paleta }, mascara: m2, aviso: 'Juntei ' + comps.length + ' cascas que se atravessavam num sólido só.' };
  });
}

function preencherBuracos(sel, adj, malha) {
  const fora = Uint8Array.from(sel, x => x ? 0 : 1);
  const r = regioes(fora, adj);
  if (r.n < 2) return sel;
  // por casca: dentro de cada casca que tem seleção, o maior pedaço NÃO
  // selecionado é o "resto"; os outros menores são buracos esquecidos
  const cas = componentes(malha), maiorDaCasca = new Map(), temSel = new Set();
  for (let f = 0; f < sel.length; f++) {
    const c = cas.rotulo[f];
    if (sel[f]) { temSel.add(c); continue; }
    const k = r.rotulo[f], m = maiorDaCasca.get(c);
    if (m === undefined || r.tamanhos[k] > r.tamanhos[m]) maiorDaCasca.set(c, k);
  }
  const out = Uint8Array.from(sel);
  for (let f = 0; f < out.length; f++) {
    if (!fora[f] || !temSel.has(cas.rotulo[f])) continue;
    const k = r.rotulo[f], m = maiorDaCasca.get(cas.rotulo[f]);
    if (k !== m && r.tamanhos[k] < 0.5 * r.tamanhos[m]) out[f] = 1;
  }
  return out;
}

/* ---------------------------------------------------------- API */

// parte: {nome, malha, cor, paleta}; mascara: Uint8Array(nT) da seleção
// opc: { modo:'auto'|'plano'|'superficie', profundidade, folga, deslocamento, margem, conector, nomeDetalhe }
export function separarDetalhe(parte, mascara, opc = {}) {
  const avisos = [];
  if (mascara.length !== parte.malha.idx.length / 3) throw new Error('Seleção não corresponde à peça.');
  // malha aberta (STL cru com buraco): conserta aqui mesmo e leva a seleção junto
  // opc.solida: quem chama garante casca única fechada (separar por cor já
  // consertou e separou as cascas) — pula as duas conferências, que
  // convertem a peça inteira
  const rep = opc.solida ? null : consertarComMascara(parte, mascara);
  if (rep) { parte = rep.parte; mascara = rep.mascara; avisos.push(rep.aviso); }
  // cascas que se atravessam (braço solto sobre o corpo) viram UM sólido antes
  // de tudo; a seleção vai junto pelas faces de origem
  const un = opc.solida ? null : unirCascasComMascara(parte, mascara);
  if (un) { parte = un.parte; mascara = un.mascara; avisos.push(un.aviso); }
  const nt0 = parte.malha.idx.length / 3;
  if (mascara.length !== nt0) throw new Error('Seleção não corresponde à peça.');
  const adj0 = prepararAdjacencia(parte.malha);
  for (let h = 0; h < adj0.viz.length; h++) if (adj0.viz[h] < 0) throw new Error('A peça precisa estar fechada (sem buraco nem aresta non-manifold) pra separar. Rode "Analisar e reparar" antes.');
  // limpeza tira ilhas de 1-3 faces (ruído de pincel); se a seleção INTEIRA
  // for pequena (ex.: etiqueta plana de 2 triângulos), ela é o que o usuário quer
  let sel = opc.limparSelecao === false ? mascara : limpar(mascara, adj0, 4);
  if (!regioes(sel, adj0).n) sel = mascara;
  const reg = regioes(sel, adj0);
  if (!reg.n) throw new Error('Nada selecionado.');
  // cor do detalhe = cor mais presente na seleção
  let corDetalhe = parte.cor;
  if (parte.malha.cor && parte.paleta) {
    const cont = new Map();
    for (let f = 0; f < nt0; f++) if (sel[f]) { const k = parte.malha.cor[f]; cont.set(k, (cont.get(k) || 0) + areaFace(parte.malha, f)); }
    let mx = -1; cont.forEach((a, k) => { if (a > mx) { mx = a; corDetalhe = parte.paleta[k]; } });
  }
  const raizOrigem = new Int32Array(nt0); for (let t = 0; t < nt0; t++) raizOrigem[t] = t;

  return comContexto(ctx => {
    const { Manifold } = manifold();
    // estado atual da peça principal
    let atual = { malha: parte.malha, cor: parte.cor, paleta: parte.paleta, origem: raizOrigem };
    const detalhes = [];
    const metodos = [];
    const relatorio = [], pinos = [];
    let plano = null;
    // regiões em ordem de tamanho (maior primeiro)
    const ordem = [...Array(reg.n).keys()].sort((a, b) => reg.tamanhos[b] - reg.tamanhos[a]);
    const pg = opc.progresso ? progresso : () => {};
    let iReg = 0;
    for (const r of ordem) {
      pg(0.1 + 0.75 * (iReg++) / ordem.length, ordem.length > 1 ? 'Separando a região ' + iReg + ' de ' + ordem.length : 'Separando');
      // sólido da peça atual só quando precisa (depois da última região não precisa)
      if (!atual.man) atual.man = ctx.solido(atual, parte.nome);
      // região r em termos das faces originais
      const raiz = new Uint8Array(nt0);
      for (let f = 0; f < nt0; f++) if (reg.rotulo[f] === r) raiz[f] = 1;
      const adj = prepararAdjacencia(atual.malha);
      const R = new Uint8Array(atual.malha.idx.length / 3);
      let nR = 0;
      for (let f = 0; f < R.length; f++) { const o = atual.origem[f]; if (o >= 0 && raiz[o]) { R[f] = 1; nR++; } }
      if (!nR) { avisos.push('Uma parte da seleção já tinha saído junto com outro detalhe.'); continue; }
      // buraquinhos esquecidos no meio da seleção (ponta do polegar fora do
      // pincel) viram seleção: só o "resto do modelo" fica de fora
      if (opc.limparSelecao !== false) R.set(preencherBuracos(R, adj, atual.malha));
      // região = casca inteira? então só separa, sem cortar nada
      let borda = 0;
      for (let f = 0; f < R.length && !borda; f++) if (R[f]) for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0 && !R[o]) { borda++; break; } }
      atual.corDetalhe = corDetalhe;
      let res = null;
      if (!borda) {
        const sd = subMalha(atual.malha, R), sr = subMalha(atual.malha, Uint8Array.from(R, x => x ? 0 : 1));
        res = { detMalha: sd.malha, detOrigem: Int32Array.from(sd.faces, f => atual.origem[f]), restoMalha: sr.malha, restoOrigem: Int32Array.from(sr.faces, f => atual.origem[f]), metodo: 'casca' };
        if (!sr.malha.idx.length) throw new Error('A seleção é a peça inteira.');
      } else {
        const modo = opc.modo || 'auto';
        if (modo !== 'superficie') {
          res = extrairPorPlano(ctx, atual, R, adj, opc, avisos);
          if (res.falhou) {
            if (modo === 'plano') throw new Error(res.falhou);
            if (opc.profundidade > 0) {
              // com espessura: camada que acompanha a curvatura
              paletaDasTampas(atual, corDetalhe);
              const c = extrairPorCamada(ctx, atual, R, adj, opc);
              if (c.falhou) throw new Error(res.falhou + ' ' + c.falhou);
              avisos.push('A região é curva: o detalhe virou uma camada de ' + (+opc.profundidade).toFixed(1) + ' mm que acompanha a superfície.');
              if (c.semFolgaLateral) avisos.push('A borda da região é serrilhada: a camada saiu sem folga dos lados (encaixe justo — lixe de leve se não entrar).');
              res = c;
            } else {
              // antes do fechamento curvo: plano da borda soltando só a parte
              const loc = extrairPorPlanoLocal(ctx, atual, R, adj, opc, avisos);
              if (!loc.falhou) res = loc;
              else { avisos.push(res.falhou + ' ' + loc.falhou + ' Usei o fechamento que segue a superfície.'); res = null; }
            }
          }
        } else if (opc.profundidade > 0) {
          paletaDasTampas(atual, corDetalhe);
          res = extrairPorCamada(ctx, atual, R, adj, opc);
          if (res.falhou) throw new Error(res.falhou);
          if (res.semFolgaLateral) avisos.push('A borda da região é serrilhada: a camada saiu sem folga dos lados (encaixe justo — lixe de leve se não entrar).');
        }
        if (!res) {
          paletaDasTampas(atual, corDetalhe);
          res = extrairPelaSuperficie(atual, R, adj, opc);
          if (res.falhou) throw new Error(res.falhou);
          if (cruzamentosPerto(res.restoMalha, res.restoOrigem, atual.malha) > 0 || cruzamentosPerto(res.detMalha, res.detOrigem, atual.malha) > 0) {
            throw new Error('Essa seleção não dá pra fechar sem a tampa atravessar a peça (ela encosta em outra parte). Use Cortar → "Só uma parte" e clique nela, ou ajuste a seleção.');
          }
        }
      }
      metodos.push(res.metodo);
      if (res.relatorio) relatorio.push(...res.relatorio);
      for (const sp of res.soltos || []) pinos.push(ctx.parte(sp.man, 'Pino solto ' + (pinos.length + 1), parte.cor));
      if (res.plano && !plano) plano = res.plano;
      let det, resto;
      if (res.det) {
        const limpo = x => res.relatorio && res.relatorio.length ? ctx.guardar(x.simplify(2e-3)) : x;
        det = ctx.parte(limpo(res.det), opc.nomeDetalhe || 'Detalhe', corDetalhe, true);
        resto = ctx.parte(limpo(res.resto), parte.nome, parte.cor, true);
      } else {
        // malhas vindas do método superfície/casca: valida no Manifold (e limpa)
        const md = ctx.solido({ malha: res.detMalha, cor: corDetalhe, paleta: atual.paleta, origem: res.detOrigem }, 'O detalhe separado');
        const mr = ctx.solido({ malha: res.restoMalha, cor: parte.cor, paleta: atual.paleta, origem: res.restoOrigem }, 'A peça principal');
        det = ctx.parte(md, opc.nomeDetalhe || 'Detalhe', corDetalhe, true);
        resto = ctx.parte(mr, parte.nome, parte.cor, true);
      }
      // região que não virou volume (só a pele de cima foi marcada): não vira peça vazia
      if (!det.malha.idx.length || volume(det.malha) < 1e-3) {
        avisos.push('Uma das regiões marcadas era só superfície e não virou peça.');
        continue;
      }
      detalhes.push(det);
      atual = { malha: resto.malha, cor: resto.cor, paleta: resto.paleta, origem: resto.origem };
    }
    if (!detalhes.length) throw new Error('A seleção marcou só a superfície do detalhe (ex.: só a face de cima). Clique no detalhe com "Detalhe inteiro" ligado, ou use Expandir, e tente de novo.');
    // o que o corte plano levou de fora da seleção (faixa perto da borda)
    // assume a cor do detalhe: a peça separada é impressa num filamento só
    const raizSel = new Set();
    for (let f = 0; f < nt0; f++) if (sel[f]) raizSel.add(f);
    for (const dt of detalhes) {
      if (!dt.paleta || !dt.malha.cor || !dt.origem) continue;
      const k = dt.paleta.indexOf(corDetalhe);
      if (k < 0) continue;
      const cor = Uint16Array.from(dt.malha.cor);
      for (let t = 0; t < cor.length; t++) { const o = dt.origem[t]; if (o >= 0 && !raizSel.has(o)) cor[t] = k; }
      let uma = true; for (let t = 1; t < cor.length && uma; t++) if (cor[t] !== cor[0]) uma = false;
      if (uma) { dt.malha = { pos: dt.malha.pos, idx: dt.malha.idx }; dt.cor = dt.paleta[cor[0]]; dt.paleta = null; }
      else dt.malha = { pos: dt.malha.pos, idx: dt.malha.idx, cor };
    }
    // várias regiões viram UM detalhe (ex.: os dois olhos juntos)
    let detalhe = detalhes[0];
    if (detalhes.length > 1) {
      const u = ctx.guardar(Manifold.union(detalhes.map(d => ctx.solido(d, 'detalhe'))));
      detalhe = ctx.parte(u, opc.nomeDetalhe || 'Detalhe', corDetalhe);
    }
    // origem < 0 = face nova (corte, tampa, encaixe) -> a prévia pinta de azul
    const principal = { nome: parte.nome, malha: atual.malha, cor: atual.cor, paleta: atual.paleta, origem: atual.origem };
    return {
      principal, detalhe: { nome: opc.nomeDetalhe || 'Detalhe', malha: detalhe.malha, cor: detalhe.cor, paleta: detalhe.paleta, origem: detalhe.origem || null },
      metodos, plano, relatorio, avisos,
      pinos: pinos.map(p => ({ nome: p.nome, malha: { pos: p.malha.pos, idx: p.malha.idx }, cor: p.cor })),
      volumes: { principal: volume(principal.malha), detalhe: volume(detalhe.malha) },
      regioes: reg.n
    };
  });
}

// SEPARAR POR COR: ver separarCor.js (peças de fabricação, com folga).

// Cada casca solta vira uma peça
export function separarCascas(parte) {
  const comp = componentes(parte.malha);
  if (comp.n < 2) return [parte];
  const out = [];
  for (let c = 0; c < comp.n; c++) {
    const mask = new Uint8Array(comp.rotulo.length);
    for (let t = 0; t < mask.length; t++) if (comp.rotulo[t] === c) mask[t] = 1;
    const s = subMalha(parte.malha, mask).malha;
    out.push({ nome: parte.nome + ' ' + (c + 1), malha: s, cor: parte.cor, paleta: s.cor ? parte.paleta : null });
  }
  out.sort((a, b) => Math.abs(volume(b.malha)) - Math.abs(volume(a.malha)));
  return out;
}

void compactar;

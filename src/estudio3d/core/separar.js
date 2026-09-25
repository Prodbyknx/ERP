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
import { comContexto, manifold } from './solidos.js';
import { prepararAdjacencia, limpar, regioes, expandir } from './selecao.js';
import { criar, subMalha, areaFace, compactar, volume } from './malha.js';
import { triangularLaco, refinarEAlisar } from './reparo.js';
import { gerarConectores } from './conectores.js';
import { componentes } from './topologia.js';
import * as M4 from './mat4.js';

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
  for (let t = 0; t < dm.idx.length / 3; t++) {
    const o = detParte.origem[t];
    if (o < 0) continue;
    const a = areaFace(dm, t);
    if (permitido.has(o)) daSelecao += a; else capturada += a;
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

  let relatorio = [];
  if (opc.conector && opc.conector.tipo && opc.conector.tipo !== 'nenhum') {
    const loc = ctx.guardar(det.transform(Array.from(Fi)));
    const sec = ctx.guardar(loc.slice(1e-3));
    const secao = sec.toPolygons();
    if (secao.length) {
      const g = gerarConectores(ctx, { solidoA: det, solidoB: resto, frame: F, secao, cfg: opc.conector });
      avisos.push(...g.avisos);
      relatorio = g.relatorio;
      if (g.positivos.length) det = ctx.guardar(det.add(g.positivos.length === 1 ? g.positivos[0] : ctx.guardar(Manifold.union(g.positivos))));
      if (g.negativosB.length) resto = ctx.guardar(resto.subtract(g.negativosB.length === 1 ? g.negativosB[0] : ctx.guardar(Manifold.union(g.negativosB))));
    } else avisos.push('Não achei a face do corte pra pôr o conector.');
  }
  return {
    det, resto, metodo: 'plano', relatorio,
    plano: { n, d: n[0] * origem[0] + n[1] * origem[1] + n[2] * origem[2], centro: origem, desvioBorda: pl.desvio }
  };
}

function normalizar(v) { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; }

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

function compactarComOrigem(m, origem) {
  const nt = m.idx.length / 3;
  const todas = new Uint32Array(nt); for (let t = 0; t < nt; t++) todas[t] = t;
  return { malha: subMalha(m, todas).malha, origem: Int32Array.from(origem) };
}

/* ---------------------------------------------------------- API */

// parte: {nome, malha, cor, paleta}; mascara: Uint8Array(nT) da seleção
// opc: { modo:'auto'|'plano'|'superficie', profundidade, folga, deslocamento, margem, conector, nomeDetalhe }
export function separarDetalhe(parte, mascara, opc = {}) {
  const avisos = [];
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
    atual.man = ctx.solido(atual, parte.nome);
    const detalhes = [];
    const metodos = [];
    const relatorio = [];
    let plano = null;
    // regiões em ordem de tamanho (maior primeiro)
    const ordem = [...Array(reg.n).keys()].sort((a, b) => reg.tamanhos[b] - reg.tamanhos[a]);
    for (const r of ordem) {
      // região r em termos das faces originais
      const raiz = new Uint8Array(nt0);
      for (let f = 0; f < nt0; f++) if (reg.rotulo[f] === r) raiz[f] = 1;
      const adj = prepararAdjacencia(atual.malha);
      const R = new Uint8Array(atual.malha.idx.length / 3);
      let nR = 0;
      for (let f = 0; f < R.length; f++) { const o = atual.origem[f]; if (o >= 0 && raiz[o]) { R[f] = 1; nR++; } }
      if (!nR) { avisos.push('Uma parte da seleção já tinha saído junto com outro detalhe.'); continue; }
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
            if (modo === 'plano' || (opc.profundidade > 0)) throw new Error(res.falhou + (opc.profundidade > 0 ? ' Com espessura o corte precisa ser plano: selecione uma região mais plana ou só a parte de cima do detalhe.' : ''));
            avisos.push(res.falhou + ' Usei o fechamento que segue a superfície.');
            res = null;
          }
        }
        if (!res) {
          if (atual.paleta) {
            atual.paleta = atual.paleta.slice();
            if (atual.paleta.indexOf(corDetalhe) < 0) atual.paleta.push(corDetalhe);
            if (atual.paleta.indexOf(atual.cor) < 0) atual.paleta.push(atual.cor);
            atual.corDetalheIdx = atual.paleta.indexOf(corDetalhe);
            atual.corRestoIdx = atual.paleta.indexOf(atual.cor);
          }
          res = extrairPelaSuperficie(atual, R, adj, opc);
          if (res.falhou) throw new Error(res.falhou);
        }
      }
      metodos.push(res.metodo);
      if (res.relatorio) relatorio.push(...res.relatorio);
      if (res.plano && !plano) plano = res.plano;
      let det, resto;
      if (res.det) {
        det = ctx.parte(res.det, opc.nomeDetalhe || 'Detalhe', corDetalhe, true);
        resto = ctx.parte(res.resto, parte.nome, parte.cor, true);
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
      atual.man = ctx.solido(atual, parte.nome);
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
      volumes: { principal: volume(principal.malha), detalhe: volume(detalhe.malha) },
      regioes: reg.n
    };
  });
}

// Separa cada cor em peça própria. Cor base = a de maior área (ou opc.corBase).
// Região pintada na superfície precisa de espessura (opc.espessura, padrão 1 mm).
export function separarPorCor(parte, opc = {}) {
  const m = parte.malha;
  if (!m.cor || !parte.paleta || parte.paleta.length < 2) throw new Error('Essa peça tem uma cor só.');
  const nt = m.idx.length / 3;
  const area = new Float64Array(parte.paleta.length);
  for (let f = 0; f < nt; f++) area[m.cor[f]] += areaFace(m, f);
  let base = opc.corBase != null ? parte.paleta.indexOf(opc.corBase) : -1;
  if (base < 0) { base = 0; for (let k = 1; k < area.length; k++) if (area[k] > area[base]) base = k; }
  const ordem = [...area.keys()].filter(k => k !== base && area[k] > 0).sort((a, b) => area[a] - area[b]);
  let atual = { nome: parte.nome, malha: m, cor: parte.paleta[base], paleta: parte.paleta };
  const pecas = [];
  const avisos = [];
  const esp = opc.espessura != null ? opc.espessura : 1.0;
  for (const k of ordem) {
    const hex = parte.paleta[k];
    const ma = atual.malha;
    const mask = new Uint8Array(ma.idx.length / 3);
    let n = 0;
    for (let f = 0; f < mask.length; f++) if (ma.cor && atual.paleta[ma.cor[f]] === hex) { mask[f] = 1; n++; }
    if (!n) continue;
    // região que é uma casca inteira sai sem espessura extra
    const r = separarDetalhe(atual, mask, { modo: 'auto', profundidade: esp, folga: opc.folga || 0, nomeDetalhe: opc.nomes && opc.nomes[hex] || hex, limparSelecao: false });
    avisos.push(...r.avisos.map(a => hex + ': ' + a));
    // peça de cor = um filamento só
    pecas.push({ nome: r.detalhe.nome, malha: { pos: r.detalhe.malha.pos, idx: r.detalhe.malha.idx }, cor: hex, paleta: null });
    atual = r.principal;
  }
  pecas.unshift(Object.assign(atual, { cor: parte.paleta[base] }));
  return { pecas, avisos, corBase: parte.paleta[base] };
}

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

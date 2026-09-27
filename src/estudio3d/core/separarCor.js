// SEPARAR POR COR pra FABRICAÇÃO: cada cor vira peça física que imprime e
// encaixa, não grupo de triângulos. Por região de cor:
//  - COMPONENTE REAL (casca inteira de uma cor, ex.: olho que é uma bola):
//    sai inteiro; o que ele atravessa ganha o encaixe dele (com folga).
//  - FRONTEIRA PLANA (caneca de duas cores): corte no plano, duas peças
//    sólidas.
//  - SÓ PINTURA (logo, olho pintado): vira INSERTO de espessura e (ex.: 0,8
//    mm) que acompanha a superfície; o corpo ganha o bolso com folga dos
//    lados e no fundo. Tudo por booleana (Manifold): peça sempre fechada, e
//    as peças montadas não se sobrepõem.
//  - PAREDE FINA embaixo da pintura: o inserto atravessa a peça (senão o
//    fundo do bolso ficaria mais fino que a impressora faz).
//  - RESPINGO (ilha de cor minúscula, comum em modelo de IA): volta pra cor
//    em volta, com aviso — não vira lasca.
// Cada região é isolada: se uma falhar, ela fica na cor do corpo (com aviso)
// e o resto sai normal. Nada de travar o motor com centenas de regiões.
import { comContexto, manifold, ehErroWasm } from './solidos.js';
import { separarDetalhe } from './separar.js';
import { criar, areaFace, volume, subMalha, soldar, compactar } from './malha.js';
import { componentes } from './topologia.js';
import { prepararAdjacencia, regioes } from './selecao.js';
import { construirBVH, lancarRaio } from './bvh.js';
import { autoInterseccoes, facesDegeneradas } from './validador.js';
import { reparar, removerDegeneradasPorIndice, removerDuplicadas } from './reparo.js';
import { progresso } from './progresso.js';

const PAREDE_MIN = 0.8;          // o mínimo que a impressora faz bem (2 linhas de 0,4)

// ------------------------------------------------ respingos de cor
// ilhas de cor com área < aMin voltam pra cor com quem mais fazem fronteira
function limparRespingos(m, adj, aMin) {
  const nt = m.idx.length / 3, cor = Uint16Array.from(m.cor), A = new Float64Array(nt);
  for (let t = 0; t < nt; t++) A[t] = areaFace(m, t);
  let trocadas = 0, ilhas = 0;
  for (let volta = 0; volta < 6; volta++) {
    // regiões por cor (vizinhas pela aresta, mesma cor)
    const rot = new Int32Array(nt).fill(-1), fila = new Int32Array(nt), lista = [];
    for (let s = 0; s < nt; s++) {
      if (rot[s] >= 0) continue;
      const id = lista.length; let ini = 0, fim = 0, area = 0;
      fila[fim++] = s; rot[s] = id;
      const faces = [];
      while (ini < fim) { const f = fila[ini++]; faces.push(f); area += A[f]; for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0 && rot[o] < 0 && cor[o] === cor[s]) { rot[o] = id; fila[fim++] = o; } } }
      lista.push({ faces, area, cor: cor[s] });
    }
    let mudou = false;
    for (const r of lista) {
      if (r.area >= aMin) continue;
      // cor vizinha com mais fronteira
      const conta = new Map();
      for (const f of r.faces) for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0 && cor[o] !== r.cor) conta.set(cor[o], (conta.get(cor[o]) || 0) + 1); }
      if (!conta.size) continue;                   // casca inteira pequena: é peça de verdade
      let melhor = -1, mx = -1; conta.forEach((n, c) => { if (n > mx) { mx = n; melhor = c; } });
      for (const f of r.faces) cor[f] = melhor;
      trocadas += r.faces.length; ilhas++; mudou = true;
    }
    if (!mudou) break;
  }
  return { cor, trocadas, ilhas };
}

// ------------------------------------------------ fronteira serrilhada
// Pintura por face em malha que não segue o desenho deixa a borda em zigue-
// zague (triângulo sim, triângulo não; ou leque em volta de um vértice): o
// inserto sairia com dentes de 0,3 mm que a impressora não faz. Aqui a
// borda passa a seguir a LINHA MÉDIA da pintura: campo "quanto desta cor"
// por vértice (área das faces em volta), alisado 2x, e a malha é cortada
// onde ele vale 1/2 (o triângulo vira 2 ou 3, com vértice novo SOBRE a
// aresta: a superfície não muda nada). Cor por cor, da menor área pra maior
// (a de maior área é o fundo). Corte a menos de 15% de um vértice passa
// pelo vértice (não nasce triângulo-agulha).
function alisarFronteiras(m, cor0) {
  let pos = Array.from(m.pos), idx = Array.from(m.idx), cor = Array.from(cor0);
  let nCores = 0; for (const c of cor) if (c >= nCores) nCores = c + 1;
  const areaCor = new Float64Array(nCores);
  for (let f = 0; f < idx.length / 3; f++) areaCor[cor[f]] += areaTri(pos, idx, f);
  const ordem = [...areaCor.keys()].filter(k => areaCor[k] > 0).sort((a, b) => areaCor[a] - areaCor[b]);
  ordem.pop();                                     // a de maior área é o fundo
  let cortes = 0; const protegidas = [];
  for (const k of ordem) {
    const nv = pos.length / 3, nt = idx.length / 3;
    // campo por vértice: fração (em área) das faces em volta que são da cor k
    const w = new Float64Array(nv), tot = new Float64Array(nv);
    const outro = new Int32Array(nv).fill(-1), outroA = new Float64Array(nv);
    let temBorda = false;
    for (let f = 0; f < nt; f++) {
      const A = areaTri(pos, idx, f) + 1e-12, eh = cor[f] === k;
      for (let j = 0; j < 3; j++) {
        const v = idx[f * 3 + j]; tot[v] += A; if (eh) w[v] += A;
        else if (A > outroA[v]) { outroA[v] = A; outro[v] = cor[f]; }
      }
    }
    const misto = [];
    for (let v = 0; v < nv; v++) { if (tot[v]) w[v] /= tot[v]; if (w[v] > 0 && w[v] < 1) { temBorda = true; misto.push(v); } }
    if (!temBorda) continue;
    // perto da borda, o campo é a fração pintada num DISCO de raio ρ (1,5x a
    // aresta) em volta do vértice, peso linear — média espacial, não pela
    // vizinhança da malha: em malha irregular a média por vizinho não
    // preserva a reta e a borda sai ondulada; o disco não liga pra
    // triangulação. Só faces do mesmo lado (parede fina: o verso não conta).
    const vf = facesDosVertices(idx, nv), NF = new Float64Array(nt * 3), CF = new Float64Array(nt * 3), AF = new Float64Array(nt);
    for (let f = 0; f < nt; f++) {
      const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1e-30;
      NF[f * 3] = nx / L; NF[f * 3 + 1] = ny / L; NF[f * 3 + 2] = nz / L; AF[f] = L / 2;
      for (let e = 0; e < 3; e++) CF[f * 3 + e] = (pos[a + e] + pos[b + e] + pos[c + e]) / 3;
    }
    // faixa: vértices mistos + 1 anel (onde o campo é medido) e + 2 anéis
    // (faces que entram no disco)
    const anel = (vs, marca) => { const out = []; for (const v of vs) for (let i = vf.ini[v]; i < vf.ini[v + 1]; i++) { const f = vf.lista[i]; for (let j = 0; j < 3; j++) { const q = idx[f * 3 + j]; if (!marca[q]) { marca[q] = 1; out.push(q); } } } return out; };
    const marca = new Uint8Array(nv); for (const v of misto) marca[v] = 1;
    const anel1 = anel(misto, marca), mede = misto.concat(anel1), anel2 = anel(anel1, marca), anel3 = anel(anel2, marca);
    let somaL = 0, nL = 0;
    for (const v of misto) for (let i = vf.ini[v]; i < vf.ini[v + 1]; i++) { const f = vf.lista[i]; for (let j = 0; j < 3; j++) { const a = idx[f * 3 + j] * 3, b = idx[f * 3 + (j + 1) % 3] * 3; somaL += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]); nL++; } }
    const rho = 1.5 * somaL / Math.max(1, nL);
    const grade = new Map(), cel = rho, ch3 = (x, y, z) => Math.floor(x / cel) + ',' + Math.floor(y / cel) + ',' + Math.floor(z / cel);
    const naGrade = new Uint8Array(nt);
    for (const v of mede.concat(anel2, anel3)) for (let i = vf.ini[v]; i < vf.ini[v + 1]; i++) {
      const f = vf.lista[i]; if (naGrade[f]) continue; naGrade[f] = 1;
      const key = ch3(CF[f * 3], CF[f * 3 + 1], CF[f * 3 + 2]); let l = grade.get(key); if (!l) grade.set(key, l = []); l.push(f);
    }
    for (const v of mede) {
      let nx = 0, ny = 0, nz = 0; for (let i = vf.ini[v]; i < vf.ini[v + 1]; i++) { const f = vf.lista[i]; nx += NF[f * 3] * AF[f]; ny += NF[f * 3 + 1] * AF[f]; nz += NF[f * 3 + 2] * AF[f]; }
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], gx = Math.floor(x / cel), gy = Math.floor(y / cel), gz = Math.floor(z / cel);
      let sk = 0, st = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = grade.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz)); if (!l) continue;
        for (const f of l) {
          const d = Math.hypot(CF[f * 3] - x, CF[f * 3 + 1] - y, CF[f * 3 + 2] - z); if (d >= rho) continue;
          if (NF[f * 3] * nx + NF[f * 3 + 1] * ny + NF[f * 3 + 2] * nz <= 0) continue;
          const pw = AF[f] * (1 - d / rho); st += pw; if (cor[f] === k) sk += pw;
        }
      }
      if (st > 0) w[v] = sk / st;
    }
    const nPos = pos.length;
    const cortar = fixa => {
      pos.length = nPos;                           // 2ª passada: desfaz os vértices novos
      const phi = new Float64Array(nv); for (let v = 0; v < nv; v++) phi[v] = w[v] - 0.5;
      // região protegida: as faces dela e do anel em volta não são cortadas
      // (vértices todos do lado de fora: sem halo e sem vértice no meio de aresta)
      if (fixa) for (let f = 0; f < nt; f++) if (fixa[f]) for (let j = 0; j < 3; j++) { const v = idx[f * 3 + j]; phi[v] = -Math.max(Math.abs(phi[v]), 0.25); }
      // corte perto demais de um vértice: passa pelo vértice
      for (let h = 0; h < nt * 3; h++) {
        const a = idx[h], b = idx[h - (h % 3) + (h % 3 + 1) % 3];
        if (!(phi[a] > 0 && phi[b] < 0) && !(phi[a] < 0 && phi[b] > 0)) continue;
        const t = phi[a] / (phi[a] - phi[b]);
        if (t < 0.15) phi[a] = 0; else if (t > 0.85) phi[b] = 0;
      }
      const novoV = new Map(), P2 = pos, I2 = [], C2 = [], mae = [];
      const cruza = (a, b) => {
        const lo = Math.min(a, b), hi = Math.max(a, b), ch = lo * 4294967296 + hi;
        let v = novoV.get(ch);
        if (v == null) {
          const t = phi[lo] / (phi[lo] - phi[hi]);
          v = P2.length / 3;
          for (let e = 0; e < 3; e++) P2.push(P2[lo * 3 + e] + t * (P2[hi * 3 + e] - P2[lo * 3 + e]));
          novoV.set(ch, v);
        }
        return v;
      };
      let n = 0;
      for (let f = 0; f < nt; f++) {
        const v = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]], s = v.map(q => phi[q]);
        if (fixa && fixa[f]) { I2.push(...v); C2.push(cor[f]); mae.push(f); continue; }
        const pos_ = s.some(x => x > 0), neg = s.some(x => x < 0);
        const corNeg = () => { if (cor[f] !== k) return cor[f]; let q = v[0]; for (const x of v) if (phi[x] < phi[q]) q = x; return outro[q] >= 0 ? outro[q] : cor[f]; };
        if (!pos_ && !neg) { I2.push(...v); C2.push(cor[f]); mae.push(f); continue; }
        if (!neg) { I2.push(...v); C2.push(k); mae.push(f); continue; }
        if (!pos_) { I2.push(...v); C2.push(corNeg()); mae.push(f); continue; }
        // recorta o triângulo em φ ≥ 0 e φ ≤ 0 (polígonos convexos, leque)
        for (const lado of [1, -1]) {
          const pol = [];
          for (let j = 0; j < 3; j++) {
            const a = v[j], b = v[(j + 1) % 3], sa = s[j] * lado, sb = s[(j + 1) % 3] * lado;
            if (sa >= 0) pol.push(a);
            if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) pol.push(cruza(a, b));
          }
          const c = lado > 0 ? k : corNeg();
          for (let j = 1; j + 1 < pol.length; j++) { I2.push(pol[0], pol[j], pol[j + 1]); C2.push(c); mae.push(f); }
        }
        n++;
      }
      return { P2, I2, C2, mae, n };
    };
    let c = cortar(null);
    // região que o alisamento comeu (mais de 25% da área: botão em malha de
    // triângulo grande, pupila dentro do olho) e que tem largura de peça:
    // refaz protegendo ela — fica exatamente como foi pintada
    const fixa = regioesComidas(pos, idx, cor, k, AF, c);
    if (fixa) { c = cortar(fixa); protegidas.push(k); }
    cortes += c.n;
    const { P2, I2, C2 } = c;
    pos = P2; idx = I2; cor = C2;
  }
  return { malha: criar(Float64Array.from(pos), Uint32Array.from(idx), Uint16Array.from(cor)), cortes, protegidas };
}
// microtriângulo (arestas de µm) que a booleana deixa onde duas faces de
// origens diferentes se encostam — o simplify do Manifold não mexe ali.
// Solda vértices a menos de 1 µm e tira o que ficou sem área; só aceita se
// continuar fechada e com o mesmo volume
function semMicroTriangulos(m) {
  let curta = false; const P = m.pos, I = m.idx;
  for (let h = 0; h < I.length && !curta; h++) { const a = I[h] * 3, b = I[h - (h % 3) + (h % 3 + 1) % 3] * 3; if (Math.abs(P[a] - P[b]) < 1e-3 && Math.abs(P[a + 1] - P[b + 1]) < 1e-3 && Math.abs(P[a + 2] - P[b + 2]) < 1e-3) curta = true; }
  if (!curta && !facesDegeneradas(m).length) return m;
  let r = removerDegeneradasPorIndice(soldar(m, 1e-3).malha).malha;
  r = removerDuplicadas(r).malha;
  r = compactar(r);
  const adj = prepararAdjacencia(r);
  for (let h = 0; h < adj.viz.length; h++) if (adj.viz[h] < 0) return m;
  if (facesDegeneradas(r).length || Math.abs(volume(r) / volume(m) - 1) > 1e-5) return m;
  return r;
}
// faces "fixas" pra cor k: regiões (da cor k, e do resto menos o fundo) que
// o corte 'c' comeu em mais de 25% da área, com largura de peça (2·área/
// perímetro >= 0,55 — na borda serrilhada isso dá ~0,9 mm reais; mais fino
// não imprime: some, com aviso), ou regiões da cor k que o corte juntou numa
// só; mais o anel de faces que encosta nelas. null = nenhuma
function regioesComidas(pos, idx, cor, k, AF, c) {
  const nt = idx.length / 3, m = criar(Float64Array.from(pos.slice(0, pos.length)), Uint32Array.from(idx)), adj = prepararAdjacencia(m);
  // área que ficou com a cor certa, por face-mãe
  const P = c.P2, fica = new Float64Array(nt);
  for (let t = 0; t < c.C2.length; t++) {
    const f = c.mae[t], dono = cor[f] === k;
    if ((c.C2[t] === k) !== dono) continue;
    const a = c.I2[t * 3] * 3, b = c.I2[t * 3 + 1] * 3, d = c.I2[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[d] - P[a], wy = P[d + 1] - P[a + 1], wz = P[d + 2] - P[a + 2];
    fica[f] += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  const eh = Uint8Array.from(cor, x => x === k ? 1 : 0), nao = Uint8Array.from(eh, x => 1 - x);
  const prot = new Uint8Array(nt); let alguma = false;
  for (const mask of [eh, nao]) {
    const r = regioes(mask, adj), A = new Float64Array(r.n), F = new Float64Array(r.n), Pm = new Float64Array(r.n);
    for (let f = 0; f < nt; f++) {
      const g = r.rotulo[f]; if (g < 0 || !mask[f]) continue;
      A[g] += AF[f]; F[g] += fica[f];
      for (let j = 0; j < 3; j++) { const o = adj.viz[f * 3 + j]; if (o >= 0 && mask[o]) continue; const a = idx[f * 3 + j] * 3, b = idx[f * 3 + (j + 1) % 3] * 3; Pm[g] += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]); }
    }
    // do resto, a maior região é o fundo (não conta)
    let maior = -1; if (mask === nao) for (let g = 0; g < r.n; g++) if (maior < 0 || A[g] > A[maior]) maior = g;
    const comida = new Uint8Array(r.n);
    for (let g = 0; g < r.n; g++) { const larg = Pm[g] > 0 ? 2 * A[g] / Pm[g] : 0; if (g !== maior && F[g] < 0.75 * A[g] && larg >= 0.55) { comida[g] = 1; alguma = true; } }
    // duas regiões da cor k viraram uma (olhos pertinho: o disco faz ponte
    // entre eles e ilha o que ficava no meio) — protege as duas
    if (mask === eh && r.n > 1) {
      const m2 = criar(Float64Array.from(c.P2), Uint32Array.from(c.I2)), adj2 = prepararAdjacencia(m2);
      const r2 = regioes(Uint8Array.from(c.C2, x => x === k ? 1 : 0), adj2), dona = new Int32Array(r2.n).fill(-1);
      for (let t = 0; t < c.C2.length; t++) {
        const g2 = r2.rotulo[t]; if (g2 < 0 || c.C2[t] !== k) continue;
        const g = r.rotulo[c.mae[t]]; if (g < 0 || !eh[c.mae[t]]) continue;
        if (dona[g2] < 0) dona[g2] = g; else if (dona[g2] !== g) { comida[g] = comida[dona[g2]] = 1; alguma = true; }
      }
    }
    for (let f = 0; f < nt; f++) { const g = r.rotulo[f]; if (g >= 0 && mask[f] && comida[g]) prot[f] = 1; }
  }
  if (!alguma) return null;
  const vp = new Uint8Array(pos.length / 3); for (let f = 0; f < nt; f++) if (prot[f]) for (let j = 0; j < 3; j++) vp[idx[f * 3 + j]] = 1;
  const fixa = new Uint8Array(nt); for (let f = 0; f < nt; f++) for (let j = 0; j < 3; j++) if (vp[idx[f * 3 + j]]) { fixa[f] = 1; break; }
  return fixa;
}
function facesDosVertices(idx, nv) {
  const ini = new Int32Array(nv + 1); for (let i = 0; i < idx.length; i++) ini[idx[i] + 1]++;
  for (let v = 0; v < nv; v++) ini[v + 1] += ini[v];
  const lista = new Int32Array(idx.length), cur = ini.slice(0, nv);
  for (let i = 0; i < idx.length; i++) lista[cur[idx[i]]++] = (i / 3) | 0;
  return { ini, lista };
}
function areaTri(P, I, f) {
  const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

// ------------------------------------------------ cortador de uma região
// Sólido que é a região "engrossada": de 'acima' mm pra fora até 'abaixo' mm
// pra dentro, ao longo das normais suavizadas; 'dilatar' empurra a borda pra
// fora (folga lateral do bolso). Malha fechada montada à mão.
function normaisDaRegiao(m, R, adj, t) {
  const P = m.pos, I = m.idx, nt = R.length, nv = P.length / 3;
  const mapa = new Int32Array(nv).fill(-1), verts = [];
  for (let f = 0; f < nt; f++) if (R[f]) for (let k = 0; k < 3; k++) { const v = I[f * 3 + k]; if (mapa[v] < 0) { mapa[v] = verts.length; verts.push(v); } }
  const n = verts.length, N0 = new Float64Array(n * 3), viz = verts.map(() => new Set());
  for (let f = 0; f < nt; f++) {
    const a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2];
    if (mapa[a] < 0 && mapa[b] < 0 && mapa[c] < 0) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    const nn = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    for (const v of [a, b, c]) { const j = mapa[v]; if (j >= 0) { N0[j * 3] += nn[0]; N0[j * 3 + 1] += nn[1]; N0[j * 3 + 2] += nn[2]; } }
    if (R[f]) { viz[mapa[a]].add(mapa[b]).add(mapa[c]); viz[mapa[b]].add(mapa[a]).add(mapa[c]); viz[mapa[c]].add(mapa[a]).add(mapa[b]); }
  }
  const unit = X => { for (let j = 0; j < X.length; j += 3) { const L = Math.hypot(X[j], X[j + 1], X[j + 2]) || 1; X[j] /= L; X[j + 1] /= L; X[j + 2] /= L; } return X; };
  unit(N0);
  const bordas = [];
  for (let f = 0; f < nt; f++) if (R[f]) for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o < 0 || !R[o]) bordas.push(I[f * 3 + k], I[f * 3 + (k + 1) % 3]); }
  let somaA = 0; for (let i = 0; i < bordas.length; i += 2) { const a = bordas[i] * 3, b = bordas[i + 1] * 3; somaA += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
  const h = bordas.length ? somaA / (bordas.length / 2) : 1;
  const suavizar = passos => { let N = Float64Array.from(N0); for (let it = 0; it < passos; it++) { const S = Float64Array.from(N); for (let j = 0; j < n; j++) for (const q of viz[j]) { S[j * 3] += N[q * 3]; S[j * 3 + 1] += N[q * 3 + 1]; S[j * 3 + 2] += N[q * 3 + 2]; } N = unit(S); } return N; };
  const aneis = t / Math.max(1e-6, h);
  return { verts, mapa, bordas, h, suavizar, passos: [...new Set([0, 1, 4, 12, 40].map(k => Math.min(300, Math.ceil(k * aneis * aneis))))] };
}
function montarCortador(m, R, reg, N, { acima, abaixo, dilatar }) {
  const P = m.pos, I = m.idx, nt = R.length, { verts, mapa, bordas } = reg, n = verts.length;
  // direção pra fora da região (no plano da superfície) nos vértices da borda
  const B = new Float64Array(n * 3);
  if (dilatar > 0) {
    for (let i = 0; i < bordas.length; i += 2) {
      const u = bordas[i], v = bordas[i + 1], ju = mapa[u], jv = mapa[v];
      const ex = P[v * 3] - P[u * 3], ey = P[v * 3 + 1] - P[u * 3 + 1], ez = P[v * 3 + 2] - P[u * 3 + 2];
      for (const j of [ju, jv]) {
        const nx = N[j * 3], ny = N[j * 3 + 1], nz = N[j * 3 + 2];
        // aresta × normal = lado de fora (a face da região fica à esquerda)
        let ox = ey * nz - ez * ny, oy = ez * nx - ex * nz, oz = ex * ny - ey * nx; const L = Math.hypot(ox, oy, oz) || 1;
        B[j * 3] += ox / L; B[j * 3 + 1] += oy / L; B[j * 3 + 2] += oz / L;
      }
    }
    for (let j = 0; j < n; j++) { const L = Math.hypot(B[j * 3], B[j * 3 + 1], B[j * 3 + 2]); if (L > 1e-9) { B[j * 3] /= L; B[j * 3 + 1] /= L; B[j * 3 + 2] /= L; } }
  }
  const pos = new Float64Array(n * 2 * 3);
  for (let j = 0; j < n; j++) {
    const v = verts[j];
    for (let e = 0; e < 3; e++) {
      const d = B[j * 3 + e] * dilatar;
      pos[j * 3 + e] = P[v * 3 + e] + N[j * 3 + e] * acima + d;
      pos[(n + j) * 3 + e] = P[v * 3 + e] - N[j * 3 + e] * abaixo + d;
    }
  }
  const idx = [];
  for (let f = 0; f < nt; f++) if (R[f]) {
    const a = mapa[I[f * 3]], b = mapa[I[f * 3 + 1]], c = mapa[I[f * 3 + 2]];
    idx.push(a, b, c, n + a, n + c, n + b);
  }
  for (let i = 0; i < bordas.length; i += 2) {
    const u = mapa[bordas[i]], v = mapa[bordas[i + 1]];
    idx.push(u, n + u, n + v, u, n + v, v);
  }
  return criar(pos, Uint32Array.from(idx));
}
// cortador válido (sólido fechado, sem dobrar): tenta normais mais suaves
function cortador(ctx, m, R, reg, opc) {
  const { Manifold, Mesh } = manifold();
  for (const passos of reg.passos) {
    const N = reg.suavizar(passos);
    const c = montarCortador(m, R, reg, N, opc);
    if (autoInterseccoes(c, { max: 1, tempoMs: 2000 }).pares) continue;      // dobrou (quina/curva fechada)
    const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(c.pos), triVerts: Uint32Array.from(c.idx) });
    mesh.merge();
    let man;
    try { man = new Manifold(mesh); } catch (e) { continue; }
    if (man.status() !== 'NoError' || man.isEmpty()) { man.delete(); continue; }
    const esperado = areaRegiao(m, R) * (opc.acima + opc.abaixo);
    if (man.volume() < 0.6 * esperado) { man.delete(); continue; }
    return ctx.guardar(man);
  }
  return null;
}
function areaRegiao(m, R) { let a = 0; for (let f = 0; f < R.length; f++) if (R[f]) a += areaFace(m, f); return a; }
function areaTotal(m) { let a = 0; for (let f = 0; f < m.idx.length / 3; f++) a += areaFace(m, f); return a; }
// Manifold -> parte com a cor por face preservada (paleta própria)
function paraParte(ctx, man, atual) { const p = ctx.parte(man, atual.nome, atual.cor); return { nome: atual.nome, malha: p.malha.cor ? p.malha : criar(p.malha.pos, p.malha.idx, new Uint16Array(p.malha.idx.length / 3)), cor: p.cor, paleta: p.paleta || [p.cor] }; }

// espessura da peça embaixo da região (raio pra dentro a partir de cada face)
// BVH só das faces perto das faces 'sel' (caixa delas + margem): o raio de
// espessura não passa de 'margem'; a BVH da peça inteira (1 milhão de
// triângulos) custava ~1 s por região. local[f] = índice da face na BVH
function bvhLocal(m, sel, margem) {
  const P = m.pos, I = m.idx, nt = I.length / 3, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let f = 0; f < nt; f++) if (sel[f]) for (let k = 0; k < 3; k++) { const v = I[f * 3 + k] * 3; for (let e = 0; e < 3; e++) { if (P[v + e] < mn[e]) mn[e] = P[v + e]; if (P[v + e] > mx[e]) mx[e] = P[v + e]; } }
  const perto = new Uint8Array(nt);
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) { const v = I[f * 3 + k] * 3; if (P[v] >= mn[0] - margem && P[v] <= mx[0] + margem && P[v + 1] >= mn[1] - margem && P[v + 1] <= mx[1] + margem && P[v + 2] >= mn[2] - margem && P[v + 2] <= mx[2] + margem) { perto[f] = 1; break; } }
  const sub = subMalha(m, perto), local = new Int32Array(nt).fill(-1);
  sub.faces.forEach((f, i) => { local[f] = i; });
  return { bvh: construirBVH(sub.malha), local };
}
function espessuraEmbaixo(m, R) {
  const P = m.pos, I = m.idx; let mn = Infinity, mx = 0, n = 0;
  const { bvh, local } = bvhLocal(m, R, 15);
  for (let f = 0; f < R.length; f++) {
    if (!R[f] || (f % 3 && n > 400)) continue;
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz); if (!(L > 0)) continue; nx /= L; ny /= L; nz /= L;
    const h = lancarRaio(bvh, (P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3, -nx, -ny, -nz, Infinity, local[f], 1e-6);
    if (!h) continue;
    n++; if (h.t < mn) mn = h.t; if (h.t > mx) mx = h.t;
  }
  return { min: n ? mn : Infinity, max: mx };
}

// região inteira num plano (normais iguais, sem altura)? = pintura em face plana
function regiaoPlana(m, R) {
  const P = m.pos, I = m.idx; let nx = 0, ny = 0, nz = 0, a0 = -1;
  const nf = f => { const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
  for (let f = 0; f < R.length; f++) if (R[f]) { const n = nf(f); nx += n[0]; ny += n[1]; nz += n[2]; if (a0 < 0) a0 = I[f * 3]; }
  const L = Math.hypot(nx, ny, nz); if (!(L > 0)) return false; nx /= L; ny /= L; nz /= L;
  const d0 = nx * P[a0 * 3] + ny * P[a0 * 3 + 1] + nz * P[a0 * 3 + 2];
  for (let f = 0; f < R.length; f++) if (R[f]) {
    const n = nf(f), l = Math.hypot(n[0], n[1], n[2]); if (l > 0 && (n[0] * nx + n[1] * ny + n[2] * nz) / l < 0.9995) return false;
    for (let k = 0; k < 3; k++) { const v = I[f * 3 + k] * 3; if (Math.abs(nx * P[v] + ny * P[v + 1] + nz * P[v + 2] - d0) > 0.02) return false; }
  }
  return true;
}

// fração (da área) do fundo do bolso com parede < 'min': faces novas
// (origem < 0) viradas pro lado do detalhe (normal ~ n do plano), raio pra
// dentro do corpo. Por área: lasca coplanar de 0,0004 mm² na quina não conta
function fundoFino(m, origem, n, min) {
  if (!origem) return 1;
  const novas = Uint8Array.from(origem, o => o < 0 ? 1 : 0), { bvh, local } = bvhLocal(m, novas, 15), P = m.pos, I = m.idx; let fina = 0, tot = 0;
  for (let f = 0; f < I.length / 3; f++) {
    if (origem[f] >= 0) continue;
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz); if (!(L > 1e-12)) continue; nx /= L; ny /= L; nz /= L;
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0.9) continue;
    const h = lancarRaio(bvh, (P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3, -nx, -ny, -nz, Infinity, local[f], 1e-6);
    tot += L; if (!h || h.t < min) fina += L;
  }
  return tot ? fina / tot : 1;
}

// fronteira da região num plano? (caneca de duas cores): plano e se ele
// separa a peça certinho (região de um lado, resto do outro)
function planoDaFronteira(m, R, reg) {
  const P = m.pos, vs = new Set(); for (let i = 0; i < reg.bordas.length; i++) vs.add(reg.bordas[i]);
  if (vs.size < 3) return null;
  const pts = [...vs]; let cx = 0, cy = 0, cz = 0; for (const v of pts) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; } cx /= pts.length; cy /= pts.length; cz /= pts.length;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const v of pts) { const d = [P[v * 3] - cx, P[v * 3 + 1] - cy, P[v * 3 + 2] - cz]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j]; }
  // menor autovetor por iteração inversa simples (matriz 3x3)
  let nrm = [0, 0, 1], best = Infinity;
  for (const cand of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { let x = cand; for (let it = 0; it < 30; it++) { const y = solve3(C, x); if (!y) break; const L = Math.hypot(...y); x = y.map(q => q / L); } const r = quad(C, x); if (r < best) { best = r; nrm = x; } }
  const d0 = nrm[0] * cx + nrm[1] * cy + nrm[2] * cz;
  let res = 0; for (const v of pts) res = Math.max(res, Math.abs(nrm[0] * P[v * 3] + nrm[1] * P[v * 3 + 1] + nrm[2] * P[v * 3 + 2] - d0));
  // tamanho dos triângulos da borda (maior aresta de cada um: o corte da
  // borda alisada deixa pedaços curtos, que não contam)
  const I0 = m.idx; let hb = 0, nb = 0;
  for (let f = 0; f < R.length; f++) {
    if (!R[f]) continue;
    let toca = false; for (let k = 0; k < 3; k++) if (vs.has(I0[f * 3 + k])) toca = true;
    if (!toca) continue;
    let mx = 0; for (let k = 0; k < 3; k++) { const a = I0[f * 3 + k] * 3, b = I0[f * 3 + (k + 1) % 3] * 3; mx = Math.max(mx, Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); }
    hb += mx; nb++;
  }
  hb /= Math.max(1, nb);
  // fronteira de cor serrilhada (segue os triângulos): tolera ~1 triângulo
  const tol = Math.max(0.25, 0.75 * hb);
  if (res > tol) return null;
  // região inteira de um lado, resto do outro (tolerância pequena)
  const I = m.idx; let lado = 0;
  for (let f = 0; f < R.length; f++) {
    let s = 0; for (let k = 0; k < 3; k++) { const v = I[f * 3 + k]; s += nrm[0] * P[v * 3] + nrm[1] * P[v * 3 + 1] + nrm[2] * P[v * 3 + 2] - d0; }
    s /= 3; if (Math.abs(s) < Math.max(0.3, tol)) continue;
    const sg = Math.sign(s) * (R[f] ? 1 : -1);
    if (!lado) lado = sg; else if (sg !== lado) return null;
  }
  if (!lado) return null;
  return { n: nrm.map(q => q * lado), d: d0 * lado };      // lado positivo = região
}
function solve3(A, b) {
  const [a, bb, c, d, e, f, g, h, i] = A, det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [((e * i - f * h) * b[0] - (bb * i - c * h) * b[1] + (bb * f - c * e) * b[2]) / det, (-(d * i - f * g) * b[0] + (a * i - c * g) * b[1] - (a * f - c * d) * b[2]) / det, ((d * h - e * g) * b[0] - (a * h - bb * g) * b[1] + (a * e - bb * d) * b[2]) / det];
}
const quad = (C, x) => x[0] * (C[0] * x[0] + C[1] * x[1] + C[2] * x[2]) + x[1] * (C[3] * x[0] + C[4] * x[1] + C[5] * x[2]) + x[2] * (C[6] * x[0] + C[7] * x[1] + C[8] * x[2]);

// ---------------------------------------------------------------- principal
// opc: { espessura (0,8), folga (0,1), corBase (hex, opcional) }
export function separarPorCorFabricacao(parte, opc = {}) {
  let m = parte.malha;
  if (!m.cor || !parte.paleta || parte.paleta.length < 2) throw new Error('Essa peça tem uma cor só.');
  const paleta = parte.paleta, esp = Math.max(0.4, opc.espessura != null ? +opc.espessura : 0.8), folga = Math.max(0, opc.folga != null ? +opc.folga : 0.1);
  const avisos = [];
  // malha aberta: conserta e leva a cor pela posição da face
  let adj = prepararAdjacencia(m);
  let aberta = false; for (let h = 0; h < adj.viz.length && !aberta; h++) if (adj.viz[h] < 0) aberta = true;
  if (aberta) {
    const r = reparar(m, {}), m2 = r.malha, C0 = centroides(m), mapa = new Map(), ch = (x, y, z) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
    for (let f = 0; f < m.idx.length / 3; f++) mapa.set(ch(C0[f * 3], C0[f * 3 + 1], C0[f * 3 + 2]), m.cor[f]);
    const C = centroides(m2), cor = new Uint16Array(m2.idx.length / 3);
    for (let f = 0; f < cor.length; f++) { const v = mapa.get(ch(C[f * 3], C[f * 3 + 1], C[f * 3 + 2])); cor[f] = v != null ? v : m.cor[0]; }
    m = criar(m2.pos, m2.idx, cor); adj = prepararAdjacencia(m);
    avisos.push('Consertei a malha antes (estava aberta).');
  }
  // 1) respingos
  const aMin = Math.max(1, 4 * esp * esp);
  const lr = limparRespingos(m, adj, aMin);
  if (lr.ilhas) avisos.push(lr.ilhas + ' respingo(s) de cor (menores que ' + aMin.toFixed(1).replace('.', ',') + ' mm²) voltaram pra cor em volta — não dá pra imprimir peça desse tamanho.');
  // 2) borda serrilhada da pintura (linha mais fina que ~1,5 triângulo some
  // no alisamento: avisa, não some calado)
  const mAntes = criar(m.pos, m.idx, lr.cor);
  const al = alisarFronteiras(m, lr.cor);
  m = al.malha;
  for (const k of al.protegidas) avisos.push(paleta[k] + ': região pequena ou estreita demais pra alisar a borda (sumiria) — sai do jeito que foi pintada, com a borda seguindo os triângulos.');
  {
    const adj2 = prepararAdjacencia(m), cont = (mm, aa) => { const n = new Map(); for (let k = 0; k < paleta.length; k++) { const mask = Uint8Array.from(mm.cor, c => c === k ? 1 : 0); n.set(k, regioes(mask, aa).n); } return n; };
    const r0 = cont(mAntes, adj), r1 = cont(m, adj2);
    for (const [k, n0] of r0) { const perdeu = n0 - (r1.get(k) || 0); if (perdeu > 0) avisos.push(paleta[k] + ': ' + perdeu + ' região(ões) (traço) mais fina(s) que o triângulo da malha sumiu(ram) ao alisar a borda — fina demais pra virar peça. Engrosse a pintura ou use "Mais detalhe na malha" (Esculpir) antes de pintar.'); }
  }
  const nt = m.idx.length / 3;
  // cor de maior área = corpo
  const areaCor = new Float64Array(paleta.length);
  for (let f = 0; f < nt; f++) areaCor[m.cor[f]] += areaFace(m, f);
  let base = opc.corBase != null ? paleta.indexOf(opc.corBase) : -1;
  if (base < 0) { base = 0; for (let k = 1; k < areaCor.length; k++) if (areaCor[k] > areaCor[base]) base = k; }

  return comContexto(ctx => {
    const { Manifold } = manifold();
    const porCor = new Map();                         // k -> [Manifold]
    const junta = (k, man) => { if (!man || man.isEmpty()) return; if (!porCor.has(k)) porCor.set(k, []); porCor.get(k).push(man); };
    const comp = componentes(m);
    const inteiras = [];                              // cascas de uma cor só (componente real)
    let feitas = 0;
    const regiaoCount = { inserto: 0, plano: 0, atravessa: 0, falhou: 0, casca: 0 };
    for (let c = 0; c < comp.n; c++) {
      const faces = new Uint8Array(nt); let cores = new Set();
      for (let f = 0; f < nt; f++) if (comp.rotulo[f] === c) { faces[f] = 1; cores.add(m.cor[f]); }
      const sub = subMalha(m, faces), sm = sub.malha;
      // casca de uma cor só: sólido já (peça inteira). Casca com várias cores
      // é validada quando vira sólido lá embaixo (converter aqui também
      // custava ~0,7 s em 250 mil triângulos, à toa)
      if (cores.size === 1) {
        let solido;
        try { solido = ctx.solido({ malha: { pos: sm.pos, idx: sm.idx }, cor: paleta[base] }, 'A peça'); } catch (e) { avisos.push('Uma casca da peça não é sólida e ficou de fora.'); continue; }
        const k = [...cores][0]; inteiras.push({ k, man: solido }); regiaoCount.casca++; continue;
      }
      // cor principal desta casca
      const ac = new Map(); for (let f = 0; f < sm.idx.length / 3; f++) ac.set(sm.cor[f], (ac.get(sm.cor[f]) || 0) + areaFace(sm, f));
      let kb = base; if (!ac.has(kb)) { let mx = -1; ac.forEach((a, k) => { if (a > mx) { mx = a; kb = k; } }); }
      // 'atual' = o corpo (malha com cor por face, paleta própria), que vai
      // perdendo cada região; região que falha volta pra cor do corpo
      let atual = { nome: parte.nome || 'Peça', malha: sm, cor: paleta[kb], paleta: paleta.slice() };
      const outrasCores = [...ac.keys()].filter(k => k !== kb).sort((a, b) => ac.get(a) - ac.get(b));
      for (const k of outrasCores) {
        const hex = paleta[k];
        for (let volta = 0; volta < 200; volta++) {
          const am = atual.malha, na = am.idx.length / 3, mask = new Uint8Array(na);
          let tem = false; for (let f = 0; f < na; f++) if (atual.paleta[am.cor ? am.cor[f] : 0] === hex) { mask[f] = 1; tem = true; }
          if (!tem) break;
          const adjA = prepararAdjacencia(am), reg0 = regioes(mask, adjA);
          // a maior região que sobrou desta cor
          let ri = 0; for (let i = 1; i < reg0.n; i++) if (reg0.tamanhos[i] > reg0.tamanhos[ri]) ri = i;
          const R = new Uint8Array(na); for (let f = 0; f < na; f++) if (reg0.rotulo[f] === ri) R[f] = 1;
          progresso(Math.min(0.95, (feitas++) / Math.max(1, feitas + 4)), 'Separando ' + hex);
          try {
            const reg = normaisDaRegiao(am, R, adjA, esp + folga);
            const aBase = areaTotal(am) - areaRegiao(am, R);
            const pl = areaRegiao(am, R) > 0.1 * aBase ? planoDaFronteira(am, R, reg) : null;
            const e = espessuraEmbaixo(am, R);
            let feitoPlano = false;
            if (pl) {
              // FRONTEIRA PLANA (caneca de duas cores): duas peças sólidas — se
              // o pedaço da cor tiver espessura (senão é só uma lente: camada)
              const man = ctx.solido(atual, atual.nome);
              const [a, b] = man.splitByPlane(pl.n, pl.d); ctx.guardar(a); ctx.guardar(b);
              if (!a.isEmpty() && !b.isEmpty() && a.volume() / Math.max(1e-9, areaRegiao(am, R)) >= esp) {
                junta(k, a); atual = paraParte(ctx, b, atual); regiaoCount.plano++; feitoPlano = true;
                // dentes da fronteira serrilhada que ficaram do outro lado do plano: cor do corpo
                const am2 = atual.malha, na2 = am2.idx.length / 3, tolP = 1.5 * reg.h;
                let kbA = atual.paleta.indexOf(paleta[kb]); const pal = atual.paleta.slice(); if (kbA < 0) { kbA = pal.length; pal.push(paleta[kb]); }
                const cor = Uint16Array.from(am2.cor); let mud = 0;
                for (let f2 = 0; f2 < na2; f2++) {
                  if (atual.paleta[cor[f2]] !== hex) continue;
                  let sd = 0; for (let q = 0; q < 3; q++) { const v = am2.idx[f2 * 3 + q] * 3; sd += Math.abs(pl.n[0] * am2.pos[v] + pl.n[1] * am2.pos[v + 1] + pl.n[2] * am2.pos[v + 2] - pl.d); }
                  if (sd / 3 < tolP) { cor[f2] = kbA; mud++; }
                }
                if (mud) atual = { ...atual, malha: criar(am2.pos, am2.idx, cor), paleta: pal };
              }
            }
            // RELEVO fino (botão de 1,6 mm saindo da barriga): o corte plano na
            // base tira o botão inteiro e o bolso fica na barriga, grossa. Vale
            // se o fundo do bolso tiver a parede mínima; senão, atravessa.
            // pintura em face plana: camada que segue o desenho exato (o
            // corte plano usa o casco + margem: a peça sairia maior que a pintura)
            const plana = regiaoPlana(am, R);
            if (!feitoPlano && !plana && e.min < esp + folga + PAREDE_MIN) {
              let r = null; try { r = separarDetalhe(atual, R, { modo: 'plano', profundidade: esp, folga, limparSelecao: false, solida: true, nomeDetalhe: hex, faixaMm: 0.4 + esp + folga + 0.5 }); } catch (err) { r = null; }
              if (r && r.plano && fundoFino(r.principal.malha, r.principal.origem, r.plano.n, PAREDE_MIN * 0.95) < 0.03) {
                junta(k, ctx.solido({ malha: { pos: r.detalhe.malha.pos, idx: r.detalhe.malha.idx }, cor: hex }, 'O detalhe'));
                atual = { nome: atual.nome, malha: r.principal.malha, cor: r.principal.cor, paleta: r.principal.paleta || [r.principal.cor] };
                regiaoCount.inserto++; feitoPlano = true;
              }
            }
            if (feitoPlano) { /* pronto */ } else if (e.min < esp + folga + PAREDE_MIN) {
              // PAREDE FINA: o inserto atravessa (booleana)
              const man = ctx.solido(atual, atual.nome), fundo = e.max + 0.5;
              const cIns = cortador(ctx, am, R, reg, { acima: 0.5, abaixo: fundo, dilatar: -0.02 });
              const cBol = cortador(ctx, am, R, reg, { acima: 0.5, abaixo: fundo, dilatar: folga });
              if (!cIns || !cBol) throw new Error('curva fechada demais');
              const ins = ctx.guardar(man.intersect(cIns));
              if (ins.isEmpty() || ins.volume() < 0.05) throw new Error('inserto vazio');
              junta(k, ins); atual = paraParte(ctx, ctx.guardar(man.subtract(cBol)), atual); regiaoCount.atravessa++;
            } else {
              // SÓ PINTURA: camada de 'esp' que acompanha a superfície, com folga
              // dos lados e no fundo (montada direto da malha, sem booleana).
              // Primeiro a CAMADA (segue o desenho exato: logo em estrela na
              // esfera continua estrela); se ela não fecha (relevo de curva
              // forte: olho, botão), o corte plano na base — que só vale se
              // não pegar superfície além da folga do prisma
              const base = { profundidade: esp, folga, limparSelecao: false, solida: true, nomeDetalhe: hex, faixaMm: 0.4 + esp + folga + 0.5 };
              let r;
              try { r = separarDetalhe(atual, R, { ...base, modo: 'superficie' }); }
              catch (e1) { if (plana || ehErroWasm(e1)) throw e1; r = separarDetalhe(atual, R, { ...base, modo: 'auto' }); }
              for (const a of r.avisos) if (/serrilhada/.test(a)) avisos.push(hex + ': ' + a);
              junta(k, ctx.solido({ malha: { pos: r.detalhe.malha.pos, idx: r.detalhe.malha.idx }, cor: hex }, 'O detalhe'));
              atual = { nome: atual.nome, malha: r.principal.malha, cor: r.principal.cor, paleta: r.principal.paleta || [r.principal.cor] };
              regiaoCount.inserto++;
            }
          } catch (err) {
            if (ehErroWasm(err)) throw err;           // motor corrompido: não segue
            regiaoCount.falhou++;
            avisos.push('Uma região ' + hex + ' não virou peça (' + String(err.message || err).slice(0, 120) + ') e ficou na cor do corpo.');
            // pinta ela com a cor do corpo pra não tentar de novo
            let kbA = atual.paleta.indexOf(paleta[kb]); const pal = atual.paleta.slice(); if (kbA < 0) { kbA = pal.length; pal.push(paleta[kb]); }
            const cor = Uint16Array.from(atual.malha.cor); for (let f = 0; f < na; f++) if (R[f]) cor[f] = kbA;
            atual = { ...atual, malha: criar(atual.malha.pos, atual.malha.idx, cor), paleta: pal };
          }
        }
      }
      let corpo;
      try { corpo = ctx.solido(atual, atual.nome); } catch (e) { if (ehErroWasm(e)) throw e; avisos.push('Uma casca da peça não é sólida e ficou de fora.'); continue; }
      junta(kb, corpo);
    }
    // componente real atravessando outra casca: fica inteiro, a outra ganha
    // o encaixe dele (com folga: bola escalada pelo centro)
    for (const it of inteiras) {
      let tocou = false;
      for (const [k, lista] of porCor) {
        if (k === it.k) continue;
        for (let i = 0; i < lista.length; i++) {
          const inter = lista[i].intersect(it.man), vi = inter.volume(); inter.delete();
          if (vi < 1e-3) continue;
          const b = it.man.boundingBox(), cx = [0, 1, 2].map(e => (b.min[e] + b.max[e]) / 2), menor = Math.min(...[0, 1, 2].map(e => b.max[e] - b.min[e]));
          const s = 1 + 2 * folga / Math.max(menor, 1e-6);
          const molde = ctx.guardar(it.man.translate(cx.map(v => -v)).scale([s, s, s]).translate(cx));
          lista[i] = ctx.guardar(lista[i].subtract(molde)); tocou = true;
        }
      }
      junta(it.k, it.man);
      if (tocou) avisos.push(paleta[it.k] + ': peça de verdade (casca própria) — sai inteira e o corpo ganha o encaixe dela.');
    }
    // uma peça por cor; lasca (pedaço minúsculo) sai com aviso
    const pecas = [];
    for (const [k, lista] of porCor) {
      const u = lista.length === 1 ? lista[0] : ctx.guardar(Manifold.union(lista));
      const partes = u.decompose(), bons = [];
      let lascas = 0;
      for (const p of partes) { if (p.volume() < Math.max(0.2, esp * esp * esp * 0.5)) { lascas++; p.delete(); } else bons.push(ctx.guardar(p)); }
      if (lascas) avisos.push(paleta[k] + ': ' + lascas + ' lasca(s) minúscula(s) descartada(s).');
      if (!bons.length) continue;
      const peca = bons.length === 1 ? bons[0] : ctx.guardar(Manifold.union(bons));
      const pp = ctx.parte(ctx.guardar(peca.simplify(2e-3)), paleta[k], paleta[k]);
      const mf = semMicroTriangulos({ pos: pp.malha.pos, idx: pp.malha.idx });
      pecas.push({ nome: paleta[k], malha: { pos: mf.pos, idx: mf.idx }, cor: paleta[k], paleta: null, k });
    }
    pecas.sort((a, b) => (a.k === base ? -1 : b.k === base ? 1 : 0));
    if (regiaoCount.atravessa) avisos.push(regiaoCount.atravessa + ' região(ões) em parede fina: a peça colorida atravessa (o fundo do bolso ficaria mais fino que ' + String(PAREDE_MIN).replace('.', ',') + ' mm).');
    progresso(1, 'Pronto');
    return { pecas: pecas.map(({ k, ...p }) => p), avisos, corBase: paleta[base], regioes: regiaoCount };
  });
}
function centroides(m) { const nt = m.idx.length / 3, c = new Float64Array(nt * 3), p = m.pos, I = m.idx; for (let f = 0; f < nt; f++) for (let e = 0; e < 3; e++) c[f * 3 + e] = (p[I[f * 3] * 3 + e] + p[I[f * 3 + 1] * 3 + e] + p[I[f * 3 + 2] * 3 + e]) / 3; return c; }

export { separarPorCorFabricacao as separarPorCor };

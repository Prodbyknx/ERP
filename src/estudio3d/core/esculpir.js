// ESCULPIR (deformação com pincel): puxar, empurrar, inflar, achatar,
// suavizar — com raio, força, queda suave e simetria ao vivo. Só mexe nos
// vértices (a malha continua fechada); ao soltar, confere se a peça não se
// cruzou e, se cruzou, desfaz o traço. Roda na tela (é interativo) e só
// recalcula o que está debaixo do pincel.
import { facesDoVertice, vizinhosDoVertice } from './topologia.js';
import { criar, caixa } from './malha.js';
import { autoInterseccoes } from './validador.js';
import { subMalha } from './malha.js';

export const PINCEIS = ['puxar', 'empurrar', 'inflar', 'achatar', 'suavizar'];

// grade de vértices pra achar quem está no raio
function grade(pos, cel) {
  const m = new Map(), n = pos.length / 3;
  for (let v = 0; v < n; v++) {
    const k = Math.floor(pos[v * 3] / cel) + ',' + Math.floor(pos[v * 3 + 1] / cel) + ',' + Math.floor(pos[v * 3 + 2] / cel);
    const l = m.get(k); if (l) l.push(v); else m.set(k, [v]);
  }
  return m;
}

export function criarSessao(malha, opc = {}) {
  const pos = Float64Array.from(malha.pos);
  const cx = caixa(malha);
  const s = {
    malha, pos, idx: malha.idx, fv: facesDoVertice(malha), viz: vizinhosDoVertice(malha),
    centro: cx.min.map((v, i) => (v + cx.max[i]) / 2), cel: Math.max(0.5, opc.raio || 5), mexidos: new Set()
  };
  s.grade = grade(pos, s.cel);
  return s;
}

function noRaio(s, c, R) {
  const out = [], cel = s.cel, r = Math.ceil(R / cel);
  const i0 = Math.floor(c[0] / cel), j0 = Math.floor(c[1] / cel), k0 = Math.floor(c[2] / cel), R2 = R * R, P = s.pos;
  for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) for (let k = k0 - r; k <= k0 + r; k++) {
    const l = s.grade.get(i + ',' + j + ',' + k);
    if (!l) continue;
    for (const v of l) { const dx = P[v * 3] - c[0], dy = P[v * 3 + 1] - c[1], dz = P[v * 3 + 2] - c[2]; const d2 = dx * dx + dy * dy + dz * dz; if (d2 <= R2) out.push([v, Math.sqrt(d2)]); }
  }
  return out;
}

function normalVertice(s, v) {
  const P = s.pos, I = s.idx, n = [0, 0, 0];
  for (let i = s.fv.inicio[v]; i < s.fv.inicio[v + 1]; i++) {
    const f = s.fv.lista[i], a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    n[0] += uy * wz - uz * wy; n[1] += uz * wx - ux * wz; n[2] += ux * wy - uy * wx;
  }
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}

// um toque do pincel em c (referencial da peça). opc: { tipo, raio, forca (0..1), simetria: 'x'|'y'|null }
// devolve os vértices mexidos
export function tocar(s, c, opc) {
  const pontos = [c];
  if (opc.simetria === 'x') pontos.push([2 * s.centro[0] - c[0], c[1], c[2]]);
  if (opc.simetria === 'y') pontos.push([c[0], 2 * s.centro[1] - c[1], c[2]]);
  const mex = new Set();
  for (const q of pontos) for (const v of aplicar(s, q, opc)) mex.add(v);
  return mex;
}

function aplicar(s, c, opc) {
  const R = opc.raio, f = Math.max(0, Math.min(1, opc.forca == null ? 0.5 : opc.forca)), P = s.pos;
  const viz = noRaio(s, c, R);
  if (!viz.length) return [];
  // peso: queda suave (1 − (d/R)²)²
  const w = viz.map(([, d]) => { const x = 1 - (d / R) * (d / R); return x * x; });
  // normal média da região (pra puxar/empurrar/achatar numa direção só)
  let nm = [0, 0, 0];
  viz.forEach(([v], i) => { const n = normalVertice(s, v); nm = nm.map((x, k) => x + n[k] * w[i]); });
  const Ln = Math.hypot(...nm) || 1; nm = nm.map(x => x / Ln);
  const passo = R * 0.08 * f;          // deslocamento máximo por toque
  const tipo = opc.tipo;
  if (tipo === 'suavizar') {
    const novo = viz.map(([v]) => {
      const a = [0, 0, 0]; let n = 0;
      for (let j = s.viz.inicio[v]; j < s.viz.inicio[v + 1]; j++) { const u = s.viz.lista[j]; a[0] += P[u * 3]; a[1] += P[u * 3 + 1]; a[2] += P[u * 3 + 2]; n++; }
      return n ? a.map(x => x / n) : [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    });
    viz.forEach(([v], i) => { const k = w[i] * Math.min(1, f * 1.5); for (let e = 0; e < 3; e++) P[v * 3 + e] += (novo[i][e] - P[v * 3 + e]) * k; });
  } else if (tipo === 'achatar') {
    // plano: pelo centro dos vértices da região, normal média
    let o = [0, 0, 0], W = 0;
    viz.forEach(([v], i) => { for (let e = 0; e < 3; e++) o[e] += P[v * 3 + e] * w[i]; W += w[i]; });
    o = o.map(x => x / W);
    viz.forEach(([v], i) => { const d = (P[v * 3] - o[0]) * nm[0] + (P[v * 3 + 1] - o[1]) * nm[1] + (P[v * 3 + 2] - o[2]) * nm[2]; const k = w[i] * Math.min(1, f); for (let e = 0; e < 3; e++) P[v * 3 + e] -= nm[e] * d * k; });
  } else {
    const sinal = tipo === 'empurrar' ? -1 : 1;
    viz.forEach(([v], i) => {
      const n = tipo === 'inflar' ? normalVertice(s, v) : nm;
      for (let e = 0; e < 3; e++) P[v * 3 + e] += n[e] * passo * w[i] * sinal;
    });
  }
  const out = viz.map(([v]) => v);
  for (const v of out) s.mexidos.add(v);
  return out;
}

// fim do traço: malha nova, ou erro se a peça passou a se cruzar ali
export function concluir(s) {
  const m = criar(s.pos, s.idx, s.malha.cor ? s.malha.cor : null);
  if (!s.mexidos.size) return { malha: s.malha, mudou: false };
  // confere só a região mexida (+ vizinhança): cruzou -> não aceita
  const faces = new Uint8Array(s.idx.length / 3);
  for (const v of s.mexidos) for (let i = s.fv.inicio[v]; i < s.fv.inicio[v + 1]; i++) faces[s.fv.lista[i]] = 1;
  const antes = autoInterseccoes(subMalha(s.malha, faces).malha, { max: 50 }).pares;
  const depois = autoInterseccoes(subMalha(m, faces).malha, { max: 50 }).pares;
  if (depois > antes) return { malha: s.malha, mudou: false, erro: 'Esse traço fez a peça atravessar ela mesma (' + depois + ' cruzamento(s)). Desfiz o traço: use menos força ou um pincel maior.' };
  return { malha: m, mudou: true };
}

// tamanho médio de aresta (pra saber se precisa refinar antes de esculpir)
export function arestaMedia(m) {
  const P = m.pos, I = m.idx, n = Math.min(I.length / 3, 20000);
  let s = 0;
  for (let t = 0; t < n; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3; s += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
  return s / Math.max(1, n);
}

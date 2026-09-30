// ESCULPIR (deformação com pincel): puxar, empurrar, inflar, achatar,
// suavizar — com raio, força, queda suave, simetria ao vivo e DETALHE
// AUTOMÁTICO (divide as arestas longas debaixo do pincel durante o traço,
// sem precisar refinar a peça inteira antes). A malha continua fechada; ao
// soltar, confere se a peça não se cruzou e, se cruzou, desfaz o traço.
// Roda na tela (é interativo) e só recalcula o que está debaixo do pincel.
import { criar, caixa, subMalha } from './malha.js';
import { autoInterseccoes } from './validador.js';

export const PINCEIS = ['puxar', 'empurrar', 'inflar', 'achatar', 'suavizar', 'vincar'];

const chave = (x, y, z, cel) => Math.floor(x / cel) + ',' + Math.floor(y / cel) + ',' + Math.floor(z / cel);

export function criarSessao(malha, opc = {}) {
  const nv = malha.pos.length / 3, nt = malha.idx.length / 3;
  const pos = new Float64Array(Math.ceil(nv * 1.25) * 3 + 300); pos.set(malha.pos);
  const idx = new Uint32Array(Math.ceil(nt * 1.25) * 3 + 300); idx.set(malha.idx);
  let cor = null;
  if (malha.cor) { cor = new Uint16Array(Math.ceil(nt * 1.25) + 100); cor.set(malha.cor); }
  const vf = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vf[malha.idx[t * 3 + k]].push(t);
  const cx = caixa(malha);
  const s = {
    malha, pos, idx, cor, nv, nt, nt0: nt, vf, pai: [],
    centro: cx.min.map((v, i) => (v + cx.max[i]) / 2), cel: Math.max(0.5, opc.raio || 5), mexidos: new Set(), grade: new Map()
  };
  for (let v = 0; v < nv; v++) gradeAdd(s, v);
  return s;
}

function gradeAdd(s, v) {
  const k = chave(s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2], s.cel), l = s.grade.get(k);
  if (l) l.push(v); else s.grade.set(k, [v]);
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
  for (const f of s.vf[v]) {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    n[0] += uy * wz - uz * wy; n[1] += uz * wx - ux * wz; n[2] += ux * wy - uy * wx;
  }
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}

function vizinhos(s, v) {
  const out = new Set(), I = s.idx;
  for (const f of s.vf[v]) for (let k = 0; k < 3; k++) { const u = I[f * 3 + k]; if (u !== v) out.add(u); }
  return out;
}

// ---------------------------------------------------------------- detalhe
function crescer(s, nvNovo, ntNovo) {
  if (nvNovo * 3 > s.pos.length) { const p = new Float64Array(Math.ceil(nvNovo * 1.5) * 3); p.set(s.pos); s.pos = p; }
  if (ntNovo * 3 > s.idx.length) {
    const i = new Uint32Array(Math.ceil(ntNovo * 1.5) * 3); i.set(s.idx); s.idx = i;
    if (s.cor) { const c = new Uint16Array(Math.ceil(ntNovo * 1.5)); c.set(s.cor); s.cor = c; }
  }
}
const comp2 = (s, a, b) => { const P = s.pos; const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; };

// divide a aresta a-b no meio (as 2 faces que a usam viram 4)
function dividirAresta(s, a, b, novosV) {
  const faces = s.vf[a].filter(f => s.vf[b].includes(f));
  crescer(s, s.nv + 1, s.nt + faces.length);
  const m = s.nv++, P = s.pos;
  for (let e = 0; e < 3; e++) P[m * 3 + e] = (P[a * 3 + e] + P[b * 3 + e]) / 2;
  s.vf[m] = [];
  gradeAdd(s, m);
  novosV.push(m);
  const I = s.idx;
  for (const h of faces) {
    // acha x->y (a aresta, na ordem da face) e z (o outro vértice)
    let x, y, z;
    for (let k = 0; k < 3; k++) {
      const p = I[h * 3 + k], q = I[h * 3 + (k + 1) % 3];
      if ((p === a && q === b) || (p === b && q === a)) { x = p; y = q; z = I[h * 3 + (k + 2) % 3]; }
    }
    const hn = s.nt++;
    I[h * 3] = x; I[h * 3 + 1] = m; I[h * 3 + 2] = z;
    I[hn * 3] = m; I[hn * 3 + 1] = y; I[hn * 3 + 2] = z;
    if (s.cor) s.cor[hn] = s.cor[h];
    s.pai[hn - s.nt0] = h;
    const ly = s.vf[y]; ly[ly.indexOf(h)] = hn;
    s.vf[z].push(hn);
    s.vf[m].push(h, hn);
  }
}

// distância do ponto c ao triângulo f
function distTri(s, f, c) {
  const P = s.pos, I = s.idx, A = I[f * 3] * 3, B = I[f * 3 + 1] * 3, C = I[f * 3 + 2] * 3;
  const a = [P[A], P[A + 1], P[A + 2]], ab = [P[B] - a[0], P[B + 1] - a[1], P[B + 2] - a[2]], ac = [P[C] - a[0], P[C + 1] - a[1], P[C + 2] - a[2]], ap = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const dt = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dt(ab, ap), d2 = dt(ac, ap), bp = [ap[0] - ab[0], ap[1] - ab[1], ap[2] - ab[2]], d3 = dt(ab, bp), d4 = dt(ac, bp);
  const cp = [ap[0] - ac[0], ap[1] - ac[1], ap[2] - ac[2]], d5 = dt(ab, cp), d6 = dt(ac, cp);
  let q;
  if (d1 <= 0 && d2 <= 0) q = [0, 0];
  else if (d3 >= 0 && d4 <= d3) q = [1, 0];
  else if (d6 >= 0 && d5 <= d6) q = [0, 1];
  else {
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) q = [d1 / (d1 - d3), 0];
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = [0, d2 / (d2 - d6)];
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = [1 - w, w]; }
    else { const den = 1 / (va + vb + vc); q = [vb * den, vc * den]; }
  }
  const x = a[0] + ab[0] * q[0] + ac[0] * q[1] - c[0], y = a[1] + ab[1] * q[0] + ac[1] * q[1] - c[1], z = a[2] + ab[2] * q[0] + ac[2] * q[1] - c[2];
  return Math.hypot(x, y, z);
}

// deixa as arestas debaixo do pincel com no máximo L (limite de divisões por toque)
function detalhar(s, c, R, L, novosV, limite = 4000) {
  const L2 = L * L, I = s.idx;
  const fila = new Set();
  for (const [v] of noRaio(s, c, R * 1.15)) for (const f of s.vf[v]) fila.add(f);
  // triângulo grande (caixa, peça simples): os vértices ficam longe do
  // pincel. Procura pelas faces que o pincel encosta.
  if (fila.size < 8 && s.nt < 300000) for (let f = 0; f < s.nt; f++) if (distTri(s, f, c) <= R * 1.15) fila.add(f);
  let feitas = 0;
  const maior = f => {
    const a = s.idx[f * 3], b = s.idx[f * 3 + 1], cc = s.idx[f * 3 + 2];
    const ab = comp2(s, a, b), bc = comp2(s, b, cc), ca = comp2(s, cc, a);
    return ab >= bc && ab >= ca ? [a, b, ab] : bc >= ca ? [b, cc, bc] : [cc, a, ca];
  };
  void I;
  while (fila.size && feitas < limite) {
    const f = fila.values().next().value; fila.delete(f);
    const [a, b, d2] = maior(f);
    if (d2 <= L2) continue;
    const antes = s.nt;
    const faces = s.vf[a].filter(x => s.vf[b].includes(x));
    dividirAresta(s, a, b, novosV);
    feitas++;
    // só continua dividindo o que o pincel encosta (vizinhas longe ficam)
    for (const h of faces) if (distTri(s, h, c) <= R * 1.15) fila.add(h);
    for (let h = antes; h < s.nt; h++) if (distTri(s, h, c) <= R * 1.15) fila.add(h);
  }
  return feitas;
}

// Depois de dividir: VIRA arestas (critério de Delaunay) na região do pincel.
// Dividir pela aresta mais longa numa triangulação ruim (tampa de cilindro
// em leque, CAD) deixa triângulos finíssimos e vértices quase coincidentes;
// puxando, a pele dobra e cruza. Virando a diagonal onde os dois ângulos
// opostos somam mais de 180°, os triângulos ficam bem formados. Só vira em
// superfície quase plana ali (não muda a forma) e sem misturar cores.
function virarArestas(s, c, R, passadas = 4) {
  const I = s.idx, P = s.pos;
  const faces = new Set();
  for (const [v] of noRaio(s, c, R * 1.25)) for (const f of s.vf[v]) faces.add(f);
  const nor = (a, b, cc) => { const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], wx = P[cc * 3] - P[a * 3], wy = P[cc * 3 + 1] - P[a * 3 + 1], wz = P[cc * 3 + 2] - P[a * 3 + 2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
  const ang = (o, a, b) => { const ux = P[a * 3] - P[o * 3], uy = P[a * 3 + 1] - P[o * 3 + 1], uz = P[a * 3 + 2] - P[o * 3 + 2], wx = P[b * 3] - P[o * 3], wy = P[b * 3 + 1] - P[o * 3 + 1], wz = P[b * 3 + 2] - P[o * 3 + 2]; const d = ux * wx + uy * wy + uz * wz, L = Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz); return L > 0 ? Math.acos(Math.max(-1, Math.min(1, d / L))) : 0; };
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const tira = (l, f) => { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  let total = 0;
  for (let it = 0; it < passadas; it++) {
    let viradas = 0;
    for (const f1 of faces) {
      for (let e = 0; e < 3; e++) {
        const a = I[f1 * 3 + e], b = I[f1 * 3 + (e + 1) % 3], c1 = I[f1 * 3 + (e + 2) % 3];
        let f2 = -1, d = -1;
        for (const g of s.vf[a]) {
          if (g === f1) continue;
          for (let k = 0; k < 3; k++) if (I[g * 3 + k] === b && I[g * 3 + (k + 1) % 3] === a) { f2 = g; d = I[g * 3 + (k + 2) % 3]; }
          if (f2 >= 0) break;
        }
        if (f2 < 0 || d === c1) continue;
        if (s.cor && s.cor[f1] !== s.cor[f2]) continue;
        if (ang(c1, a, b) + ang(d, b, a) <= Math.PI + 1e-3) continue;
        const n1 = nor(a, b, c1), n2 = nor(b, a, d), L1 = Math.hypot(...n1), L2 = Math.hypot(...n2);
        if (!(L1 > 0 && L2 > 0) || dot(n1, n2) / (L1 * L2) < 0.985) continue;
        if (s.vf[c1].some(g => s.vf[d].includes(g))) continue;          // já existe a aresta c1-d
        const m = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]], q1 = nor(a, d, c1), q2 = nor(d, b, c1);
        if (dot(q1, m) <= 1e-12 || dot(q2, m) <= 1e-12) continue;        // não pode inverter
        I[f1 * 3] = a; I[f1 * 3 + 1] = d; I[f1 * 3 + 2] = c1;
        I[f2 * 3] = d; I[f2 * 3 + 1] = b; I[f2 * 3 + 2] = c1;
        tira(s.vf[a], f2); tira(s.vf[b], f1); s.vf[c1].push(f2); s.vf[d].push(f1);
        viradas++;
        break;
      }
    }
    total += viradas;
    if (!viradas) break;
  }
  return total;
}

// um toque do pincel em c (referencial da peça).
// opc: { tipo, raio, forca (0..1), simetria: 'x'|'y'|'z'|0|1|2|null,
//        detalhe: aresta máxima em mm debaixo do pincel (0/nada = não divide) }
// devolve os vértices mexidos (inclusive os novos)
export function tocar(s, c, opc) {
  const pontos = [c];
  // simetria pelo meio da peça
  const ax = typeof opc.simetria === 'number' ? opc.simetria : { x: 0, y: 1, z: 2 }[opc.simetria];
  if (ax != null) { const q = c.slice(); q[ax] = 2 * s.centro[ax] - c[ax]; pontos.push(q); }
  const mex = new Set();
  if (opc.detalhe > 0) {
    const novos = [];
    let divididas = 0;
    for (const q of pontos) divididas += detalhar(s, q, opc.raio, opc.detalhe, novos);
    if (divididas) for (const q of pontos) virarArestas(s, q, opc.raio);
    for (const v of novos) { mex.add(v); s.mexidos.add(v); }
  }
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
      for (const u of vizinhos(s, v)) { a[0] += P[u * 3]; a[1] += P[u * 3 + 1]; a[2] += P[u * 3 + 2]; n++; }
      return n ? a.map(x => x / n) : [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    });
    viz.forEach(([v], i) => { const k = w[i] * Math.min(1, f * 1.5); for (let e = 0; e < 3; e++) P[v * 3 + e] += (novo[i][e] - P[v * 3 + e]) * k; });
  } else if (tipo === 'vincar') {
    // VINCO: puxa a pele pro centro do pincel (no plano da superfície) e
    // afunda o meio com queda bem mais fina — ao arrastar, vira um sulco
    // estreito e fundo (dobra de roupa, ruga, costura, divisão de dedos)
    viz.forEach(([v, d], i) => {
      const x = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      let ac = [c[0] - x[0], c[1] - x[1], c[2] - x[2]];
      const dn = ac[0] * nm[0] + ac[1] * nm[1] + ac[2] * nm[2];
      ac = [ac[0] - nm[0] * dn, ac[1] - nm[1] * dn, ac[2] - nm[2] * dn];
      const q = 1 - d / R, fino = q * q * q * q;       // queda estreita pro fundo
      const belisca = w[i] * f * 0.04;
      for (let e = 0; e < 3; e++) P[v * 3 + e] += ac[e] * belisca - nm[e] * passo * 0.6 * fino;
    });
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

// malha atual da sessão (arrays do tamanho certo)
export function malhaDaSessao(s) {
  return criar(s.pos.slice(0, s.nv * 3), s.idx.slice(0, s.nt * 3), s.cor ? s.cor.slice(0, s.nt) : null);
}

// face original (antes do traço) de onde veio a face f
const origem = (s, f) => { while (f >= s.nt0) f = s.pai[f - s.nt0]; return f; };

// fim do traço: malha nova, ou erro se a peça passou a se cruzar ali
export function concluir(s) {
  if (!s.mexidos.size) return { malha: s.malha, mudou: false };
  const m = malhaDaSessao(s);
  // confere só a região mexida (+ vizinhança): cruzou -> não aceita
  const facesNovas = new Uint8Array(s.nt), facesAntes = new Uint8Array(s.nt0);
  for (const v of s.mexidos) for (const f of s.vf[v]) { facesNovas[f] = 1; facesAntes[origem(s, f)] = 1; }
  const antes = autoInterseccoes(subMalha(s.malha, facesAntes).malha, { max: 50 }).pares;
  const depois = autoInterseccoes(subMalha(m, facesNovas).malha, { max: 50 }).pares;
  if (depois > antes) return { malha: s.malha, mudou: false, erro: 'Esse traço fez a peça atravessar ela mesma (' + depois + ' cruzamento(s)). Desfiz o traço: use menos força ou um pincel maior.' };
  return { malha: m, mudou: true, novosTriangulos: s.nt - s.nt0 };
}

// tamanho médio de aresta (pra saber se precisa refinar antes de esculpir)
export function arestaMedia(m) {
  const P = m.pos, I = m.idx, n = Math.min(I.length / 3, 20000);
  let s = 0;
  for (let t = 0; t < n; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3; s += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
  return s / Math.max(1, n);
}

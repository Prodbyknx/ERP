// Limpeza final de triângulos degenerados (área ~0) sem abrir a malha.
// Aparecem na saída de booleana quando vértices ficam colineares depois do
// arredondamento pra float32. O fatiador "conserta" isso e acusa erro; aqui
// eles somem antes de exportar:
//   - "tampa" (um vértice em cima da aresta maior): troca a aresta maior com o
//     triângulo vizinho (edge flip) -> dois triângulos bons, mesma superfície;
//   - "agulha" (dois vértices no mesmo lugar): funde os dois vértices, se isso
//     não criar aresta non-manifold.
// Cor e origem de cada face vão junto.
import { criar, subMalha } from './malha.js';

// arestas abertas / non-manifold / com orientação repetida que tocam os
// vértices S (a fusão só muda a topologia em volta deles)
function contarRuins(idx, S) {
  const mapa = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    if (!S.has(idx[t * 3]) && !S.has(idx[t * 3 + 1]) && !S.has(idx[t * 3 + 2])) continue;
    for (let k = 0; k < 3; k++) {
      const u = idx[t * 3 + k], w = idx[t * 3 + (k + 1) % 3];
      if (u === w || (!S.has(u) && !S.has(w))) continue;
      const ch = Math.min(u, w) * 4294967296 + Math.max(u, w);
      const e = mapa.get(ch);
      if (!e) mapa.set(ch, { n: 1, s: u, mesmo: false });
      else { if (e.n === 1 && e.s === u) e.mesmo = true; e.n++; }
    }
  }
  let n = 0; for (const e of mapa.values()) if (e.n !== 2 || e.mesmo) n++;
  return n;
}

function area2(p, a, b, c) {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}
function normal(p, a, b, c) {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

// fração altura/comprimento abaixo da qual o triângulo é "degenerado"
const LIMITE = 1e-6;

function ehDegenerada(p, idx, t) {
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  if (a === b || b === c || a === c) return true;
  const L = Math.max(
    Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]),
    Math.hypot(p[b] - p[c], p[b + 1] - p[c + 1], p[b + 2] - p[c + 2]),
    Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]));
  if (L === 0) return true;
  return area2(p, a, b, c) / (L * L) < LIMITE;
}

// extras: { cor?: Uint16Array, origem?: Int32Array } (por face). Devolve { malha, origem, trocas, fusoes, restantes }
export function corrigirDegeneradas(m, extras = {}) {
  const p = m.pos;
  let idx = Uint32Array.from(m.idx);
  let cor = m.cor ? Uint16Array.from(m.cor) : null;
  let origem = extras.origem ? Int32Array.from(extras.origem) : null;
  let trocas = 0, fusoes = 0;
  for (let passo = 0; passo < 12; passo++) {
    const nt = idx.length / 3;
    const deg = [];
    for (let t = 0; t < nt; t++) if (ehDegenerada(p, idx, t)) deg.push(t);
    if (!deg.length) break;
    // vizinhança SÓ em volta dos degenerados (são dezenas numa malha de 1
    // milhão): montar a topologia inteira a cada passada custava segundos.
    // Consultas pelo retrato do começo da passada (como era com a topologia)
    const idx0 = Uint32Array.from(idx), nv = p.length / 3;
    const m1 = new Uint8Array(nv); for (const f of deg) for (let k = 0; k < 3; k++) m1[idx0[f * 3 + k]] = 1;
    const m2 = Uint8Array.from(m1);
    for (let t = 0; t < nt; t++) { const a = idx0[t * 3], b = idx0[t * 3 + 1], c = idx0[t * 3 + 2]; if (m1[a] || m1[b] || m1[c]) m2[a] = m2[b] = m2[c] = 1; }
    const vf = new Map();
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = idx0[t * 3 + k]; if (!m2[v]) continue; let l = vf.get(v); if (!l) vf.set(v, l = []); if (l[l.length - 1] !== t) l.push(t); }
    const tem = (t, v) => idx0[t * 3] === v || idx0[t * 3 + 1] === v || idx0[t * 3 + 2] === v;
    // face do outro lado da aresta a-b (só se for exatamente uma: aresta manifold)
    const gemea = (f, a, b) => { let o = -1, n = 0; for (const t of vf.get(a) || []) if (t !== f && tem(t, b)) { o = t; n++; } return n === 1 ? o : -1; };
    // arestas criadas nesta passada (pra não criar aresta repetida no flip)
    const novas = new Set();
    const existe = { has: ch => { if (novas.has(ch)) return true; const c = Math.floor(ch / 4294967296), d = ch % 4294967296; for (const t of vf.get(c) || []) if (tem(t, d)) return true; return false; }, add: ch => novas.add(ch) };
    const tocada = new Uint8Array(nt);
    let mexeu = 0;
    const remover = new Uint8Array(nt);
    const fundir = new Map();     // vértice -> vértice
    for (const f of deg) {
      if (tocada[f]) continue;
      const v = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
      const P = k => [p[v[k] * 3], p[v[k] * 3 + 1], p[v[k] * 3 + 2]];
      const len = k => { const a = P(k), b = P((k + 1) % 3); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
      const L = [len(0), len(1), len(2)];
      const maior = L[0] >= L[1] && L[0] >= L[2] ? 0 : (L[1] >= L[2] ? 1 : 2);
      const menor = L[0] <= L[1] && L[0] <= L[2] ? 0 : (L[1] <= L[2] ? 1 : 2);
      if (L[menor] < L[maior] * 1e-5) {
        // agulha: funde as pontas da aresta curtíssima
        const a = v[menor], b = v[(menor + 1) % 3];
        if (fundir.has(a) || fundir.has(b)) continue;
        fundir.set(b, a);
        tocada[f] = 1;
        continue;
      }
      // tampa: vértice oposto à maior aresta está em cima dela -> flip
      const a = v[maior], b = v[(maior + 1) % 3], c = v[(maior + 2) % 3];
      const o = gemea(f, a, b);
      if (o < 0) continue;
      if (tocada[o]) continue;
      let d = -1;
      for (let k = 0; k < 3; k++) { const x = idx[o * 3 + k]; if (x !== a && x !== b) d = x; }
      if (d < 0 || d === c) continue;
      const ch = c < d ? c * 4294967296 + d : d * 4294967296 + c;
      if (existe.has(ch)) continue;
      // os dois novos têm que ter área e apontar pro mesmo lado do vizinho
      const no = normal(p, idx[o * 3] * 3, idx[o * 3 + 1] * 3, idx[o * 3 + 2] * 3);
      const n1 = normal(p, a * 3, d * 3, c * 3), n2 = normal(p, d * 3, b * 3, c * 3);
      const dot1 = n1[0] * no[0] + n1[1] * no[1] + n1[2] * no[2], dot2 = n2[0] * no[0] + n2[1] * no[1] + n2[2] * no[2];
      if (!(dot1 > 0 && dot2 > 0)) continue;
      idx[f * 3] = a; idx[f * 3 + 1] = d; idx[f * 3 + 2] = c;
      idx[o * 3] = d; idx[o * 3 + 1] = b; idx[o * 3 + 2] = c;
      // a área toda era do vizinho: os dois novos herdam dele
      if (cor) cor[f] = cor[o];
      if (origem) origem[f] = origem[o];
      existe.add(ch);
      tocada[f] = tocada[o] = 1;
      trocas++; mexeu++;
    }
    if (fundir.size) {
      // fusão segura: se piorar a topologia (aresta aberta/non-manifold), desfaz
      const antes = { idx: Uint32Array.from(idx), cor: cor && Uint16Array.from(cor), origem: origem && Int32Array.from(origem) };
      const S = new Set(); for (const [x, y] of fundir) { S.add(x); S.add(y); }
      const ruimAntes = contarRuins(idx, S);
      for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const x = fundir.get(idx[t * 3 + k]); if (x !== undefined) idx[t * 3 + k] = x; }
      for (let t = 0; t < nt; t++) {
        const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
        if (a === b || b === c || a === c) remover[t] = 1;
      }
      fusoes += fundir.size; mexeu++;
      let n = 0; for (let t = 0; t < nt; t++) if (!remover[t]) n++;
      const idx2 = new Uint32Array(n * 3);
      const cor2 = cor ? new Uint16Array(n) : null, or2 = origem ? new Int32Array(n) : null;
      n = 0;
      for (let t = 0; t < nt; t++) {
        if (remover[t]) continue;
        idx2[n * 3] = idx[t * 3]; idx2[n * 3 + 1] = idx[t * 3 + 1]; idx2[n * 3 + 2] = idx[t * 3 + 2];
        if (cor2) cor2[n] = cor[t]; if (or2) or2[n] = origem[t];
        n++;
      }
      idx = idx2; cor = cor2; origem = or2;
      if (contarRuins(idx, S) > ruimAntes) { idx = antes.idx; cor = antes.cor; origem = antes.origem; fusoes -= fundir.size; if (!trocas) break; }
    }
    if (!mexeu) break;
  }
  let restantes = 0;
  for (let t = 0; t < idx.length / 3; t++) if (ehDegenerada(p, idx, t)) restantes++;
  let malha = criar(p, idx, cor);
  if (fusoes) malha = subMalha(malha, new Uint8Array(idx.length / 3).fill(1)).malha;   // tira vértice que sobrou
  return { malha, origem, trocas, fusoes, restantes };
}

// Limpeza final de triângulos degenerados (área ~0) sem abrir a malha.
// Aparecem na saída de booleana quando vértices ficam colineares depois do
// arredondamento pra float32. O fatiador "conserta" isso e acusa erro; aqui
// eles somem antes de exportar:
//   - "tampa" (um vértice em cima da aresta maior): troca a aresta maior com o
//     triângulo vizinho (edge flip) -> dois triângulos bons, mesma superfície;
//   - "agulha" (dois vértices no mesmo lugar): funde os dois vértices, se isso
//     não criar aresta non-manifold.
// Cor e origem de cada face vão junto.
import { arestas, gemeas } from './topologia.js';
import { criar, subMalha } from './malha.js';

function contarRuins(m) {
  const top = arestas(m);
  let n = 0;
  for (let e = 0; e < top.nE; e++) {
    const k = top.inicio[e + 1] - top.inicio[e];
    if (k !== 2) n++;
    else if (m.idx[top.ordem[top.inicio[e]]] === m.idx[top.ordem[top.inicio[e] + 1]]) n++;
  }
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
    const mm = criar(p, idx);
    const top = arestas(mm);
    const gem = gemeas(mm, top);
    // arestas existentes (pra não criar aresta repetida no flip)
    const existe = new Set();
    for (let e = 0; e < top.nE; e++) existe.add(top.v0[e] + '_' + top.v1[e]);
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
      const h = f * 3 + maior;
      const g = gem[h];
      if (g < 0) continue;
      const o = (g / 3) | 0;
      if (tocada[o]) continue;
      const a = v[maior], b = v[(maior + 1) % 3], c = v[(maior + 2) % 3];
      let d = -1;
      for (let k = 0; k < 3; k++) { const x = idx[o * 3 + k]; if (x !== a && x !== b) d = x; }
      if (d < 0 || d === c) continue;
      const ch = c < d ? c + '_' + d : d + '_' + c;
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
      const ruimAntes = contarRuins(criar(p, idx));
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
      if (contarRuins(criar(p, idx)) > ruimAntes) { idx = antes.idx; cor = antes.cor; origem = antes.origem; fusoes -= fundir.size; if (!trocas) break; }
    }
    if (!mexeu) break;
  }
  let restantes = 0;
  for (let t = 0; t < idx.length / 3; t++) if (ehDegenerada(p, idx, t)) restantes++;
  let malha = criar(p, idx, cor);
  if (fusoes) malha = subMalha(malha, new Uint8Array(idx.length / 3).fill(1)).malha;   // tira vértice que sobrou
  return { malha, origem, trocas, fusoes, restantes };
}

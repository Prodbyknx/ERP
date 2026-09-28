// Máscaras binárias (Uint8Array w*h, 1 = dentro): distância exata, engordar,
// afinar, rotular pedaços, tapar furos, esqueleto. Tudo por distância
// euclidiana exata (Felzenszwalb), então engordar 10 px é um disco de verdade.

const INF = 1e12;   // "longe": maior que qualquer distância² real, sem estourar a conta

// distância² de cada pixel até o pixel mais perto com m == alvo
export function distancia2(m, w, h, alvo = 1) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = m[i] === alvo ? 0 : INF;
  const linha = (len) => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        const r = v[k];
        s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
        if (s <= z[k]) k--; else break;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    linha(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    linha(w);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  return g;
}

export function dilatar(m, w, h, r) {
  if (r <= 0) return Uint8Array.from(m);
  const d = distancia2(m, w, h, 1), r2 = r * r, o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = d[i] <= r2 ? 1 : 0;
  return o;
}
export function erodir(m, w, h, r) {
  if (r <= 0) return Uint8Array.from(m);
  const d = distancia2(m, w, h, 0), r2 = r * r, o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = m[i] && d[i] > r2 ? 1 : 0;
  return o;
}
export const abrir = (m, w, h, r) => dilatar(erodir(m, w, h, r), w, h, r);
export const fechar = (m, w, h, r) => erodir(dilatar(m, w, h, r), w, h, r);

export const conta = m => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i] ? 1 : 0; return n; };
export function uniao(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] || b[i] ? 1 : 0; return o; }
export function menos(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && !b[i] ? 1 : 0; return o; }
export function e(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && b[i] ? 1 : 0; return o; }

// pedaços ligados (8 vizinhos pra dentro, que é como o olho vê um traço
// diagonal). Devolve o rótulo de cada pixel (0 = fora) e a área/caixa de cada.
export function rotular(m, w, h, oito = true) {
  const v = new Int16Array(m.length);
  for (let i = 0; i < m.length; i++) v[i] = m[i] ? 1 : -1;
  return rotularValores(v, w, h, oito);
}

// pedaços de pixels vizinhos com o MESMO valor (>= 0), numa passada só
export function rotularValores(val, w, h, oito = true) {
  const n = w * h, rot = new Int32Array(n), pilha = new Int32Array(n);
  const pedacos = [];
  for (let s = 0; s < n; s++) {
    const alvo = val[s];
    if (alvo < 0 || rot[s]) continue;
    const id = pedacos.length + 1;
    let topo = 0, area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    pilha[topo++] = s; rot[s] = id;
    while (topo) {
      const i = pilha[--topo], y = (i / w) | 0, x = i - y * w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const l = x > 0, r = x < w - 1, u = y > 0, d = y < h - 1;
      let j;
      if (l && val[j = i - 1] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
      if (r && val[j = i + 1] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
      if (u && val[j = i - w] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
      if (d && val[j = i + w] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
      if (oito) {
        if (l && u && val[j = i - w - 1] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
        if (r && u && val[j = i - w + 1] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
        if (l && d && val[j = i + w - 1] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
        if (r && d && val[j = i + w + 1] === alvo && !rot[j]) { rot[j] = id; pilha[topo++] = j; }
      }
    }
    pedacos.push({ id, valor: alvo, area, x0, y0, x1, y1 });
  }
  return { rot, pedacos };
}

// tapa furo (fundo que não encosta na borda da imagem). areaMax: só os menores
export function taparFuros(m, w, h, areaMax = Infinity) {
  const fora = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) fora[i] = m[i] ? 0 : 1;
  const { rot, pedacos } = rotular(fora, w, h, false);
  const tapar = new Uint8Array(pedacos.length + 1);
  for (const p of pedacos) {
    const naBorda = p.x0 === 0 || p.y0 === 0 || p.x1 === w - 1 || p.y1 === h - 1;
    if (!naBorda && p.area <= areaMax) tapar[p.id] = 1;
  }
  const o = Uint8Array.from(m);
  for (let i = 0; i < w * h; i++) if (rot[i] && tapar[rot[i]]) o[i] = 1;
  return o;
}

// Esqueleto (Zhang-Suen), no máximo `passadas` rodadas: o que tiver meia
// largura <= passadas vira linha de 1 px; o resto só afina.
export function afinar(m, w, h, passadas = 1e9) {
  const a = Uint8Array.from(m), apagar = [];
  const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : a[y * w + x];
  for (let it = 0; it < passadas; it++) {
    let mudou = false;
    for (let sub = 0; sub < 2; sub++) {
      apagar.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!a[y * w + x]) continue;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1);
        const p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (sub === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        apagar.push(y * w + x);
      }
      for (const i of apagar) a[i] = 0;
      if (apagar.length) mudou = true;
    }
    if (!mudou) break;
  }
  return a;
}

// caixa dos pixels ligados
export function caixa(m, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

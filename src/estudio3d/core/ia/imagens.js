// Pré-processamento das fotos (AIImageProcessor / SegmentationEngine):
// tirar fundo liso, achar o objeto, medir e alinhar a escala entre vistas.
// Fundo complexo (foto com cenário) precisa de um segmentador de IA — ver
// docs/IA-3D.md; aqui o fundo é liso ou transparente (o guia de foto pede isso).

// rgba: Uint8Array/Uint8ClampedArray (w*h*4) -> { w, h, d: Uint8Array (1 = objeto) }
export function mascaraDaImagem(rgba, w, h, opc = {}) {
  const n = w * h, d = new Uint8Array(n);
  // PNG com transparência: o alfa já é a máscara
  let temAlfa = false;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 250) { temAlfa = true; break; }
  if (temAlfa) {
    for (let i = 0; i < n; i++) d[i] = rgba[i * 4 + 3] >= (opc.alfaMin || 128) ? 1 : 0;
  } else {
    // cor do fundo = mediana da borda; tira o que é parecido e está LIGADO à borda
    const borda = [];
    for (let x = 0; x < w; x++) { borda.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { borda.push(y * w, y * w + w - 1); }
    const med = k => { const v = borda.map(i => rgba[i * 4 + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const fr = med(0), fg = med(1), fb = med(2);
    const tol = opc.tolerancia != null ? opc.tolerancia : 40;
    const parecido = i => Math.abs(rgba[i * 4] - fr) + Math.abs(rgba[i * 4 + 1] - fg) + Math.abs(rgba[i * 4 + 2] - fb) <= tol;
    d.fill(1);
    const fila = new Int32Array(n); let a = 0, b = 0;
    for (const i of borda) if (d[i] && parecido(i)) { d[i] = 0; fila[b++] = i; }
    while (a < b) {
      const i = fila[a++], x = i % w, y = (i / w) | 0;
      const viz = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of viz) if (j >= 0 && d[j] && parecido(j)) { d[j] = 0; fila[b++] = j; }
    }
  }
  return manterMaior({ w, h, d });
}

// tira sujeira: fica todo pedaço com pelo menos 2% do maior (um acessório
// solto ao lado continua; pontinho de poeira sai)
function manterMaior(m, fracao = 0.02) {
  const { w, h, d } = m, n = w * h, rot = new Int32Array(n).fill(-1);
  let melhorN = 0, k = 0;
  const tam = [];
  const fila = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!d[s] || rot[s] >= 0) continue;
    let a = 0, b = 0; fila[b++] = s; rot[s] = k; let cont = 0;
    while (a < b) {
      const i = fila[a++]; cont++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && d[i - 1] && rot[i - 1] < 0) { rot[i - 1] = k; fila[b++] = i - 1; }
      if (x < w - 1 && d[i + 1] && rot[i + 1] < 0) { rot[i + 1] = k; fila[b++] = i + 1; }
      if (y > 0 && d[i - w] && rot[i - w] < 0) { rot[i - w] = k; fila[b++] = i - w; }
      if (y < h - 1 && d[i + w] && rot[i + w] < 0) { rot[i + w] = k; fila[b++] = i + w; }
    }
    tam.push(cont);
    if (cont > melhorN) melhorN = cont;
    k++;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rot[i] >= 0 && tam[rot[i]] >= melhorN * fracao ? 1 : 0;
  return { w, h, d: out };
}

export function caixaDaMascara(m) {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// distância euclidiana ao quadrado 1D (Felzenszwalb & Huttenlocher)
function edt1d(f, n, out, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(alvo, w, h) {
  // distância (em pixels) de cada pixel até o pixel mais perto com alvo=1
  const INF = 1e20, g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = alvo[i] ? 0 : INF;
  const N = Math.max(w, h), f = new Float64Array(N), o = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, o, v, z); for (let y = 0; y < h; y++) g[y * w + x] = o[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, o, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(o[x]); }
  return g;
}
// distância com sinal (pixels): + dentro do objeto, − fora
export function distanciaComSinal(m) {
  const n = m.w * m.h, fora = new Uint8Array(n);
  for (let i = 0; i < n; i++) fora[i] = m.d[i] ? 0 : 1;
  const dFora = edt(fora, m.w, m.h), dDentro = edt(m.d, m.w, m.h);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = m.d[i] ? dFora[i] - 0.5 : -(dDentro[i] - 0.5);
  return s;
}

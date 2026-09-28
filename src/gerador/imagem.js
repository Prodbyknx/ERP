// Imagem (RGBA) -> dados que o gerador usa: cor perceptual (Lab), redimensionar
// sem halo escuro na borda (alfa pré-multiplicado) e diferença de cor (ΔE).
// Puro: roda no worker, no Node (testes/MCP) e na tela.

const _lin = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; _lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const _f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;

// sRGB 0..255 -> CIE Lab (D65)
export function lab(r, g, b) {
  const R = _lin[r | 0], G = _lin[g | 0], B = _lin[b | 0];
  const x = _f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = _f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = _f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// ΔE76: distância no Lab (1 ≈ o mínimo que o olho percebe)
export const dE = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); };

// imagem inteira -> L, a, b em 3 vetores (com cache por cor: logo tem poucas)
export function labDaImagem(px, n) {
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const k = (px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2];
    let v = cache.get(k);
    if (!v) { v = lab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); if (cache.size < 200000) cache.set(k, v); }
    L[i] = v[0]; A[i] = v[1]; B[i] = v[2];
  }
  return { L, A, B };
}

export const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export function rgbDeHex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Redimensiona (bilinear pra aumentar, média de área pra diminuir), com alfa
// pré-multiplicado: sem isso a borda de um PNG transparente puxa preto.
export function redimensionar(px, w, h, W, H) {
  if (W === w && H === h) return new Uint8ClampedArray(px);
  const pm = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    pm[i * 4] = px[i * 4] * a; pm[i * 4 + 1] = px[i * 4 + 1] * a; pm[i * 4 + 2] = px[i * 4 + 2] * a; pm[i * 4 + 3] = px[i * 4 + 3];
  }
  const out = new Uint8ClampedArray(W * H * 4);
  const sx = w / W, sy = h / H;
  const acc = new Float32Array(4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      acc.fill(0);
      if (sx > 1 || sy > 1) {
        // área: soma os pixels de origem que caem neste pixel
        const x0 = x * sx, x1 = x0 + sx, y0 = y * sy, y1 = y0 + sy;
        let peso = 0;
        for (let yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx++) {
            const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), p = wx * wy, o = (yy * w + xx) * 4;
            acc[0] += pm[o] * p; acc[1] += pm[o + 1] * p; acc[2] += pm[o + 2] * p; acc[3] += pm[o + 3] * p; peso += p;
          }
        }
        for (let c = 0; c < 4; c++) acc[c] /= peso || 1;
      } else {
        const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5)), fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 4; c++) {
          const a = pm[(y0 * w + x0) * 4 + c], b = pm[(y0 * w + x1) * 4 + c], d = pm[(y1 * w + x0) * 4 + c], e = pm[(y1 * w + x1) * 4 + c];
          acc[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
        }
      }
      const o = (y * W + x) * 4, a = acc[3];
      out[o + 3] = a;
      if (a > 0) { const k = 255 / a; out[o] = acc[0] * k; out[o + 1] = acc[1] * k; out[o + 2] = acc[2] * k; }
    }
  }
  return out;
}

// Nome da cor pra tela ("Verde", "Branco"...), pelo Lab/matiz
export function nomeDaCor(rgb) {
  const [L, a, b] = lab(rgb[0], rgb[1], rgb[2]);
  const C = Math.hypot(a, b);
  if (C < 10 || (L < 25 && C < 20)) return L > 88 ? 'Branco' : L < 25 ? 'Preto' : L > 62 ? 'Cinza claro' : 'Cinza';
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;   // matiz do Lab (vermelho ~40°, azul ~290°)
  if (h < 20 || h >= 345) return L > 70 ? 'Rosa' : 'Vermelho';
  if (h < 45) return L > 75 ? 'Rosa' : (L < 45 && C < 45) ? 'Marrom' : 'Vermelho';
  if (h < 75) return L < 50 ? 'Marrom' : 'Laranja';
  if (h < 110) return L < 55 ? 'Verde-oliva' : 'Amarelo';
  if (h < 175) return 'Verde';
  if (h < 240) return L > 75 ? 'Azul claro' : 'Verde-água';
  if (h < 315) return L > 70 ? 'Azul claro' : 'Azul';
  return L > 65 ? 'Rosa' : L < 40 ? 'Roxo' : 'Magenta';
}

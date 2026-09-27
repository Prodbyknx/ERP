// Prévia de peças (malhas) em PNG: vista de 3/4, sombreado por face, com
// z-buffer. É o que o Claude "vê" depois de consertar, suavizar ou cortar.
import { escreverPNG } from './imagem.mjs';

const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const v = m ? parseInt(m[1], 16) : 0xB4BAC4; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

// itens: [{ malha, cor, dx }] (dx: deslocamento em mm pra pôr lado a lado)
export function previaMalhas(itens, { W = 720, H = 540, dir = [-0.55, -0.62, -0.56] } = {}) {
  const L = Math.hypot(...dir), d = dir.map(x => x / L), cima = [0, 0, 1];
  const k = cima[0] * d[0] + cima[1] * d[1] + cima[2] * d[2];
  let up = cima.map((x, i) => x - k * d[i]); const Lu = Math.hypot(...up); up = up.map(x => x / Lu);
  const u = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
  // enquadra todas as peças juntas
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const it of itens) {
    const P = it.malha.pos, dx = it.dx || 0;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] + dx, sx = x * u[0] + P[i + 1] * u[1] + P[i + 2] * u[2], sy = x * up[0] + P[i + 1] * up[1] + P[i + 2] * up[2];
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
  }
  const esc = Math.min(W * 0.9 / Math.max(1e-6, x1 - x0), H * 0.9 / Math.max(1e-6, y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const img = new Uint8ClampedArray(W * H * 4), zb = new Float64Array(W * H).fill(Infinity);
  for (let i = 0; i < img.length; i += 4) { img[i] = 247; img[i + 1] = 245; img[i + 2] = 242; img[i + 3] = 255; }
  const luz = (() => { const l = [d[0] - 0.5 * up[0] + 0.4 * u[0], d[1] - 0.5 * up[1] + 0.4 * u[1], d[2] - 0.5 * up[2] + 0.4 * u[2]], n = Math.hypot(...l); return l.map(x => x / n); })();
  for (const it of itens) {
    const P = it.malha.pos, I = it.malha.idx, dx = it.dx || 0, c = hex(it.cor);
    const proj = v => { const x = P[v * 3] + dx, y = P[v * 3 + 1], z = P[v * 3 + 2]; return [W / 2 + (x * u[0] + y * u[1] + z * u[2] - cx) * esc, H / 2 - (x * up[0] + y * up[1] + z * up[2] - cy) * esc, x * d[0] + y * d[1] + z * d[2]]; };
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, e = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[e] - P[a], wy = P[e + 1] - P[a + 1], wz = P[e + 2] - P[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (nx * d[0] + ny * d[1] + nz * d[2] > 0) continue;
      const s = Math.pow(Math.max(0, -(nx * luz[0] + ny * luz[1] + nz * luz[2])), 1.1) * 0.78 + 0.26;
      const A = proj(I[t]), B = proj(I[t + 1]), C = proj(I[t + 2]);
      const bx0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), bx1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const by0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), by1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (Math.abs(den) < 1e-12) continue;
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den, l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const z = l1 * A[2] + l2 * B[2] + l3 * C[2];
        if (z >= zb[y * W + x]) continue; zb[y * W + x] = z;
        const o = (y * W + x) * 4; img[o] = Math.min(255, c[0] * s + 18); img[o + 1] = Math.min(255, c[1] * s + 18); img[o + 2] = Math.min(255, c[2] * s + 18);
      }
    }
  }
  return escreverPNG(img, W, H);
}

// FORMAS pra foto (pôster e litofania): retângulo de canto arredondado,
// redondo e coração, sempre centralizados e do maior tamanho que cabe na
// imagem. Contorno em pontos (pro Manifold) e máscara em pixels (pra análise).

// contorno (sentido anti-horário, y pra baixo como na imagem) numa caixa w x h
export function contornoForma(forma, w, h, passo = 0) {
  const lado = Math.min(w, h), cx = w / 2, cy = h / 2;
  const pts = [];
  if (forma === 'redondo') {
    const r = lado / 2, n = Math.max(48, Math.min(360, Math.ceil(2 * Math.PI * r / (passo || lado / 120))));
    for (let i = 0; i < n; i++) { const a = -2 * Math.PI * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }
  if (forma === 'coracao') {
    // coração clássico (x = 16 sen³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t), encaixado no quadrado
    const n = 240, raw = [];
    for (let i = 0; i < n; i++) { const t = -2 * Math.PI * i / n; raw.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of raw) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = lado / Math.max(x1 - x0, y1 - y0), ox = cx - (x0 + x1) / 2 * k, oy = cy - (y0 + y1) / 2 * k;
    for (const [x, y] of raw) pts.push([ox + x * k, oy + y * k]);
    return pts;
  }
  // retângulo com canto arredondado (8% do menor lado)
  const r = lado * 0.08, q = 10;
  const canto = (ccx, ccy, a0) => { for (let i = 0; i <= q; i++) { const a = a0 - Math.PI / 2 * i / q; pts.push([ccx + r * Math.cos(a), ccy + r * Math.sin(a)]); } };
  canto(w - r, h - r, Math.PI / 2); canto(w - r, r, 0); canto(r, r, -Math.PI / 2); canto(r, h - r, -Math.PI);
  return pts;
}

// máscara (1 = dentro) de um polígono em W x H px (centro do pixel)
export function mascaraPoligono(pts, W, H) {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xa, ya] = pts[j], [xb, yb] = pts[i];
      if ((ya <= yc) !== (yb <= yc)) xs.push(xa + (yc - ya) / (yb - ya) * (xb - xa));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) m[y * W + x] = 1;
    }
  }
  return m;
}

export const mascaraForma = (forma, W, H) => mascaraPoligono(contornoForma(forma, W, H), W, H);

// vários anéis (furos pela regra par/ímpar)
export function mascaraPoligonos(aneis, W, H) {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5, xs = [];
    for (const pts of aneis) for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xa, ya] = pts[j], [xb, yb] = pts[i];
      if ((ya <= yc) !== (yb <= yc)) xs.push(xa + (yc - ya) / (yb - ya) * (xb - xa));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) m[y * W + x] = 1;
    }
  }
  return m;
}

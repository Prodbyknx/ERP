// Utilidades 2D sobre polígonos [[x,y],...] (anéis; regra par-ímpar)

export function dentro(aneis, x, y) {
  let d = false;
  for (const a of aneis) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const xi = a[i][0], yi = a[i][1], xj = a[j][0], yj = a[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d;
    }
  }
  return d;
}

export function distanciaBorda(aneis, x, y) {
  let m = Infinity;
  for (const a of aneis) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const ax = a[j][0], ay = a[j][1], bx = a[i][0], by = a[i][1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (d < m) m = d;
    }
  }
  return m;
}

export function caixa2D(aneis) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of aneis) for (const p of a) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

export function areaAnel(a) {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] + a[i][0]) * (a[j][1] - a[i][1]);
  return -s / 2;
}

// eixo principal (PCA) dos pontos dos anéis
export function eixoPrincipal(aneis) {
  let n = 0, mx = 0, my = 0;
  for (const a of aneis) for (const p of a) { mx += p[0]; my += p[1]; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const a of aneis) for (const p of a) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx: mx, cy: my, ang, ux: Math.cos(ang), uy: Math.sin(ang) };
}

// Candidatos numa grade dentro da região permitida; escolhe N pontos
// espalhados (o 1º é o mais "fundo", os outros maximizam a distância mínima).
export function espalharPontos(permitida, n, passo) {
  const b = caixa2D(permitida);
  if (!isFinite(b.x0)) return [];
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  passo = passo || Math.max(w, h) / 80 || 0.1;
  const cand = [];
  for (let y = b.y0 + passo / 2; y <= b.y1; y += passo) {
    for (let x = b.x0 + passo / 2; x <= b.x1; x += passo) {
      if (dentro(permitida, x, y)) cand.push([x, y, distanciaBorda(permitida, x, y)]);
    }
  }
  if (!cand.length) {
    // região estreita demais pra grade: usa os próprios vértices
    for (const a of permitida) for (const p of a) cand.push([p[0], p[1], 0]);
  }
  if (!cand.length) return [];
  const escolhidos = [];
  let melhor = cand[0];
  for (const c of cand) if (c[2] > melhor[2]) melhor = c;
  if (n === 1) return [[melhor[0], melhor[1]]];
  // com N > 1 o primeiro é um extremo do eixo principal, pra espalhar de ponta a ponta
  const eixo = eixoPrincipal(permitida);
  let ext = cand[0], vmin = Infinity;
  for (const c of cand) { const v = (c[0] - eixo.cx) * eixo.ux + (c[1] - eixo.cy) * eixo.uy - c[2] * 0.5; if (v < vmin) { vmin = v; ext = c; } }
  escolhidos.push(ext);
  while (escolhidos.length < n) {
    let alvo = null, dMax = -1;
    for (const c of cand) {
      let d = Infinity;
      for (const e of escolhidos) d = Math.min(d, Math.hypot(c[0] - e[0], c[1] - e[1]));
      const s = d + c[2] * 0.25;
      if (s > dMax) { dMax = s; alvo = c; }
    }
    if (!alvo) break;
    escolhidos.push(alvo);
  }
  return escolhidos.map(c => [c[0], c[1]]);
}

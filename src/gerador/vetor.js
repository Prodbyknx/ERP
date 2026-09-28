// Máscara -> contornos lisos em mm. Campo de distância com sinal (a borda do
// pixel vira rampa), um borrão leve tira o degrau, marching squares acha o
// ponto exato onde o campo cruza zero (subpixel) e Douglas-Peucker tira ponto
// sobrando com erro máximo em MILÍMETRO. Sai pronto pro CrossSection do Manifold.
import { distancia2, caixa } from './mascara.js';

function borrar(c, w, h, raio, passadas) {
  const t = new Float32Array(c.length), jan = 2 * raio + 1;
  for (let p = 0; p < passadas; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let x = -raio; x <= raio; x++) s += c[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        t[o + x] = s / jan;
        s += c[o + Math.min(w - 1, x + raio + 1)] - c[o + Math.max(0, x - raio)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -raio; y <= raio; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        c[y * w + x] = s / jan;
        s += t[Math.min(h - 1, y + raio + 1) * w + x] - t[Math.max(0, y - raio) * w + x];
      }
    }
  }
}

// contornos (laços fechados, em px da máscara) de m; suave = raio do borrão
export function lacos(m, W, H, { suave = 1, passadas = 2 } = {}) {
  const cx = caixa(m, W, H);
  if (!cx) return [];
  const mg = 3 + suave * passadas;
  const x0 = cx.x0 - mg, y0 = cx.y0 - mg, w = cx.w + 2 * mg, h = cx.h + 2 * mg;
  const sub = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y + y0; if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < w; x++) { const sx = x + x0; if (sx >= 0 && sx < W) sub[y * w + x] = m[sy * W + sx]; }
  }
  // distância com sinal: + dentro, - fora (0,5 px de cada lado da borda do pixel)
  const dF = distancia2(sub, w, h, 1), dD = distancia2(sub, w, h, 0);
  const c = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) c[i] = sub[i] ? Math.sqrt(dD[i]) - 0.5 : 0.5 - Math.sqrt(dF[i]);
  if (suave > 0) borrar(c, w, h, suave, passadas);

  // marching squares com índice inteiro de aresta: H(x,y) = 2*(y*w+x), V = +1
  const prox = new Int32Array(2 * w * h).fill(-1);
  const px = new Float32Array(2 * w * h), py = new Float32Array(2 * w * h);
  const ponto = (e) => {
    const k = e >> 1, y = (k / w) | 0, x = k - y * w;
    if (e & 1) { const a = c[k], b = c[k + w], t = a === b ? 0.5 : a / (a - b); px[e] = x; py[e] = y + Math.max(0, Math.min(1, t)); }
    else { const a = c[k], b = c[k + 1], t = a === b ? 0.5 : a / (a - b); px[e] = x + Math.max(0, Math.min(1, t)); py[e] = y; }
    return e;
  };
  const T = (x, y) => 2 * (y * w + x), B = (x, y) => 2 * ((y + 1) * w + x), L = (x, y) => 2 * (y * w + x) + 1, R = (x, y) => 2 * (y * w + x + 1) + 1;
  const liga = (a, b) => { ponto(a); ponto(b); prox[a] = b; };
  const inicios = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x;
    const tl = c[i] > 0, tr = c[i + 1] > 0, br = c[i + w + 1] > 0, bl = c[i + w] > 0;
    const k = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (k === 0 || k === 15) continue;
    // dentro fica à esquerda de quem anda (sentido anti-horário na tela com y pra baixo = horário no mm)
    switch (k) {
      case 1: liga(B(x, y), L(x, y)); break;
      case 2: liga(R(x, y), B(x, y)); break;
      case 3: liga(R(x, y), L(x, y)); break;
      case 4: liga(T(x, y), R(x, y)); break;
      case 5: {
        const centro = (c[i] + c[i + 1] + c[i + w] + c[i + w + 1]) > 0;
        if (centro) { liga(T(x, y), L(x, y)); liga(B(x, y), R(x, y)); } else { liga(T(x, y), R(x, y)); liga(B(x, y), L(x, y)); }
        break;
      }
      case 6: liga(T(x, y), B(x, y)); break;
      case 7: liga(T(x, y), L(x, y)); break;
      case 8: liga(L(x, y), T(x, y)); break;
      case 9: liga(B(x, y), T(x, y)); break;
      case 10: {
        const centro = (c[i] + c[i + 1] + c[i + w] + c[i + w + 1]) > 0;
        if (centro) { liga(R(x, y), T(x, y)); liga(L(x, y), B(x, y)); } else { liga(L(x, y), T(x, y)); liga(R(x, y), B(x, y)); }
        break;
      }
      case 11: liga(R(x, y), T(x, y)); break;
      case 12: liga(L(x, y), R(x, y)); break;
      case 13: liga(B(x, y), R(x, y)); break;
      case 14: liga(L(x, y), B(x, y)); break;
    }
    inicios.push(i);
  }
  const saida = [], visto = new Uint8Array(2 * w * h);
  for (let e = 0; e < prox.length; e++) {
    if (prox[e] < 0 || visto[e]) continue;
    const pts = [];
    let a = e, guarda = 0;
    while (a >= 0 && !visto[a] && guarda++ < 4e6) { visto[a] = 1; pts.push([px[a] + x0, py[a] + y0]); a = prox[a]; }
    if (pts.length >= 3) saida.push(pts);
  }
  return saida;
}

export function area2(p) { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return s; }

// Douglas-Peucker num laço fechado (parte no ponto mais longe do primeiro)
export function simplificar(p, tol) {
  const n = p.length;
  if (n < 5 || tol <= 0) return p;
  let far = 0, dm = -1;
  for (let i = 1; i < n; i++) { const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2; if (d > dm) { dm = d; far = i; } }
  const marca = new Uint8Array(n); marca[0] = 1; marca[far] = 1;
  const pilha = [[0, far], [far, n]];
  const t2 = tol * tol;
  while (pilha.length) {
    const [a, b] = pilha.pop();
    const A = p[a], Bp = p[b % n], dx = Bp[0] - A[0], dy = Bp[1] - A[1], L2 = dx * dx + dy * dy;
    let im = -1, dmax = t2;
    for (let i = a + 1; i < b; i++) {
      const P = p[i];
      let d;
      if (!L2) d = (P[0] - A[0]) ** 2 + (P[1] - A[1]) ** 2;
      else { const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)); d = (P[0] - A[0] - t * dx) ** 2 + (P[1] - A[1] - t * dy) ** 2; }
      if (d > dmax) { dmax = d; im = i; }
    }
    if (im > 0) { marca[im] = 1; pilha.push([a, im], [im, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (marca[i]) out.push(p[i]);
  return out.length >= 3 ? out : p;
}

// máscara -> polígonos em mm (x pra direita, y pra CIMA), prontos pro CrossSection
export function poligonosMM(m, W, H, esc, { tolMM = 0.02, areaMinMM2 = 0.004, suave = 1 } = {}) {
  const tol = tolMM / esc, aMin = areaMinMM2 / (esc * esc);
  const out = [];
  for (const l of lacos(m, W, H, { suave })) {
    if (Math.abs(area2(l)) / 2 < aMin) continue;
    const s = simplificar(l, tol);
    out.push(s.map(([x, y]) => [x * esc, -y * esc]));
  }
  return out;
}

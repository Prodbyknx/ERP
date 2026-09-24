// Triangulação de polígonos (planos ou quase planos) em 3D:
// projeta no plano de melhor ajuste e usa earcut (robusto com côncavo e furo).
import earcut from 'earcut';

// Plano de melhor ajuste pelo método de Newell (estável pra polígono côncavo)
export function normalNewell(pts) {
  let nx = 0, ny = 0, nz = 0;
  const n = pts.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 3], ay = pts[i * 3 + 1], az = pts[i * 3 + 2];
    const bx = pts[j * 3], by = pts[j * 3 + 1], bz = pts[j * 3 + 2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const L = Math.hypot(nx, ny, nz);
  return L > 0 ? [nx / L, ny / L, nz / L] : [0, 0, 1];
}

export function baseDoPlano(n) {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
  const L = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / L, u[1] / L, u[2] / L];
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}

// pts: Float64Array/array 3*n (anel externo), furos: [array 3*k] opcionais.
// Devolve índices locais (0..n+soma furos-1) no mesmo sentido do anel externo.
export function triangularPoligono3D(pts, furos, normal) {
  const n = normal || normalNewell(pts);
  const { u, v } = baseDoPlano(n);
  const todos = [pts].concat(furos || []);
  const plano = [];
  const inicioFuros = [];
  let cont = 0;
  todos.forEach((anel, k) => {
    if (k > 0) inicioFuros.push(cont);
    for (let i = 0; i < anel.length; i += 3) {
      plano.push(anel[i] * u[0] + anel[i + 1] * u[1] + anel[i + 2] * u[2],
                 anel[i] * v[0] + anel[i + 1] * v[1] + anel[i + 2] * v[2]);
      cont++;
    }
  });
  const tri = earcut(plano, inicioFuros.length ? inicioFuros : null, 2);
  // earcut devolve sentido horário ou anti conforme a entrada; alinha com a normal
  const out = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i + 1], c = tri[i + 2];
    const ax = plano[a * 2], ay = plano[a * 2 + 1];
    const cr = (plano[b * 2] - ax) * (plano[c * 2 + 1] - ay) - (plano[b * 2 + 1] - ay) * (plano[c * 2] - ax);
    if (cr >= 0) out.push(a, b, c); else out.push(a, c, b);
  }
  return out;
}

// Área com sinal no plano (u,v) de um laço 2D [x0,y0,x1,y1,...]
export function area2D(xy) {
  let s = 0;
  const n = xy.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) s += (xy[j * 2] - xy[i * 2]) * (xy[j * 2 + 1] + xy[i * 2 + 1]);
  return s / 2;
}

// Laço 2D se cruza? (O(n^2), só pra laços de tamanho moderado)
export function lacoSeCruza(xy) {
  const n = xy.length / 2;
  const cruza = (a, b, c, d) => {
    const o = (p, q, r) => (xy[q * 2] - xy[p * 2]) * (xy[r * 2 + 1] - xy[p * 2 + 1]) - (xy[q * 2 + 1] - xy[p * 2 + 1]) * (xy[r * 2] - xy[p * 2]);
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  if (n > 4000) return false;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      const c = j, d = (j + 1) % n;
      if (d === a) continue;
      if (cruza(a, b, c, d)) return true;
    }
  }
  return false;
}

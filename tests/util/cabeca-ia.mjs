// Cabeça de modelo de IA com CAROÇO em grade (comprimento de onda 4,5 mm,
// 0,4 mm de altura) e duas orelhas encostadas — o caso real que o
// Suavizar antigo não resolvia. carocoCabeca: desvio médio da esfera da
// cabeça (calota longe das orelhas), em mm.
import { comContexto, manifold } from '../../src/estudio3d/core/solidos.js';
import { criar } from '../../src/estudio3d/core/malha.js';

export function cabecaIA() {
  return comContexto(ctx => {
    const M = manifold().Manifold;
    const u = ctx.guardar(M.union([ctx.guardar(M.sphere(25, 200)), ctx.guardar(M.sphere(8, 96).translate([17, 0, 22])), ctx.guardar(M.sphere(8, 96).translate([-17, 0, 22]))]));
    const m = ctx.parte(ctx.guardar(u.refineToLength(0.35)), 'c', '#999').malha;
    const P = Float64Array.from(m.pos), lam = 4.5, A = 0.4;
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2], L = Math.hypot(x, y, z) || 1;
      const d = A * Math.sin(2 * Math.PI * x / lam) * Math.sin(2 * Math.PI * y / lam) * Math.sin(2 * Math.PI * z / lam + 1);
      P[v] += d * x / L; P[v + 1] += d * y / L; P[v + 2] += d * z / L;
    }
    return criar(P, m.idx);
  });
}
// c = centro da cabeça (a peça aberta na tela pode ter sido movida)
export function carocoCabeca(m, c = [0, 0, 0]) {
  const P = m.pos; let s = 0, n = 0;
  for (let v = 0; v < P.length; v += 3) { if (P[v + 2] - c[2] > 5) continue; s += Math.abs(Math.hypot(P[v] - c[0], P[v + 1] - c[1], P[v + 2] - c[2]) - 25); n++; }
  return s / n;
}

// Cabeça com ruga, DECIMADA (simplify): ~14% de triângulo fino (agulha),
// como sai de modelo de IA / scan reduzido
export function cabecaDecimada() {
  return comContexto(ctx => {
    const W = manifold(), M = W.Manifold;
    const base = ctx.guardar(ctx.guardar(M.union([ctx.guardar(M.sphere(25, 200)), ctx.guardar(M.sphere(8, 96).translate([17, 0, 22]))])).refineToLength(0.3));
    const m = ctx.parte(base, 'c', '#999').malha, P = Float64Array.from(m.pos);
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2], L = Math.hypot(x, y, z) || 1;
      const d = 0.3 * Math.sin(x * 1.4) * Math.sin(y * 1.1 + 0.5) * Math.sin(z * 1.2 + 1);
      P[v] += d * x / L; P[v + 1] += d * y / L; P[v + 2] += d * z / L;
    }
    const mf = ctx.guardar(new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(P), triVerts: Uint32Array.from(m.idx) })));
    return ctx.parte(ctx.guardar(mf.simplify(0.06)), 's', '#999').malha;
  });
}

// ângulo (graus) entre as faces de cada aresta interna, na ordem da malha
export function diedros(m) {
  const P = m.pos, I = m.idx, nt = I.length / 3, N = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1;
    N[t * 3] = nx / L; N[t * 3 + 1] = ny / L; N[t * 3 + 2] = nz / L;
  }
  const outra = new Map(), ang = [];
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3], ch = a < b ? a * 4294967296 + b : b * 4294967296 + a, o = outra.get(ch);
    if (o === undefined) { outra.set(ch, t); continue; }
    ang.push(Math.acos(Math.max(-1, Math.min(1, N[t * 3] * N[o * 3] + N[t * 3 + 1] * N[o * 3 + 1] + N[t * 3 + 2] * N[o * 3 + 2]))) * 180 / Math.PI);
  }
  return ang;
}

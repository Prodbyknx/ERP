// DESENHAR E CRIAR: um contorno 2D desenhado na mesa (pontos em mm) vira
//   'extrudar'     — peça com espessura (placa, base, logo, suporte)
//   'revolucionar' — perfil girado em volta do eixo (vaso, puxador, botão):
//                    a linha mais à esquerda do desenho é o eixo
//   'tubo'         — caminho vira tubo de diâmetro d (aberto ou em anel)
// Linha reta ou CURVA SUAVE passando pelos pontos (pontos de canto ficam
// pontudos). Sempre sólido fechado, medidas em mm, apoiado em z = 0.
import { comContexto, manifold, segmentos } from './solidos.js';
import { validar } from './validador.js';
import { criar, volume, inverterFaces } from './malha.js';

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// CURVA SUAVE pelos pontos: spline cúbica C2 (a "curva por pontos" de CAD),
// parâmetro pelo comprimento da corda (não faz laçada com ponto irregular).
// 'cantos': índices que ficam pontudos (a curva é quebrada ali).
// passo: tamanho máximo de cada pedacinho (mm).
export function curvaSuave(pts, { fechado = false, cantos = [], passo = 0.5 } = {}) {
  const n = pts.length;
  if (n < 3) return pts.map(p => p.slice());
  const cs = [...new Set(cantos.filter(i => i >= 0 && i < n))].sort((a, b) => a - b);
  const out = [];
  const trecho = (Q, cicl) => {            // devolve pontos da curva por Q (sem o último se cicl)
    const m = Q.length, ns = cicl ? m : m - 1, h = [];
    for (let i = 0; i < ns; i++) h.push(Math.max(1e-9, d2(Q[i], Q[(i + 1) % m])));
    const D = [0, 1].map(k => resolverSpline(Q.map(p => p[k]), h, cicl));
    const r = [];
    for (let i = 0; i < ns; i++) {
      const a = Q[i], b = Q[(i + 1) % m], j = (i + 1) % m, hi = h[i];
      const c1 = [a[0] + D[0][i] * hi / 3, a[1] + D[1][i] * hi / 3], c2 = [b[0] - D[0][j] * hi / 3, b[1] - D[1][j] * hi / 3];
      const k = Math.max(2, Math.ceil((d2(a, c1) + d2(c1, c2) + d2(c2, b)) / passo));
      for (let s = 0; s < k; s++) {
        const t = s / k, u = 1 - t;
        r.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
      }
    }
    if (!cicl) r.push(Q[m - 1].slice());
    return r;
  };
  if (fechado && !cs.length) return trecho(pts, true);
  // quebra nos cantos (e nas pontas do caminho aberto)
  let idx = pts.map((_, i) => i);
  if (fechado) { idx = [...idx.slice(cs[0]), ...idx.slice(0, cs[0]), cs[0]]; }
  const quebra = new Set(cs);
  let run = [idx[0]];
  for (let k = 1; k < idx.length; k++) {
    run.push(idx[k]);
    if (quebra.has(idx[k]) || k === idx.length - 1) {
      const Q = run.map(i => pts[i]);
      const r = Q.length >= 3 ? trecho(Q, false) : Q.map(p => p.slice());
      if (out.length) r.shift();
      out.push(...r);
      run = [idx[k]];
    }
  }
  if (fechado) out.pop();                   // último = primeiro
  return out;
}

// derivadas D da spline cúbica C2 com intervalos h (natural nas pontas, ou
// cíclica). Sistema pequeno (pontos clicados): resolve direto.
function resolverSpline(y, h, cicl) {
  const m = y.length, A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
  const H = i => h[(i + h.length) % h.length], Y = i => y[(i + m) % m];
  for (let i = 0; i < m; i++) {
    if (!cicl && i === 0) { A[0][0] = 2; A[0][1] = 1; b[0] = 3 * (y[1] - y[0]) / h[0]; continue; }
    if (!cicl && i === m - 1) { A[i][i - 1] = 1; A[i][i] = 2; b[i] = 3 * (y[i] - y[i - 1]) / h[i - 1]; continue; }
    const h0 = H(i - 1), h1 = H(i);
    A[i][(i - 1 + m) % m] += h1; A[i][i] += 2 * (h0 + h1); A[i][(i + 1) % m] += h0;
    b[i] = 3 * (h1 * (Y(i) - Y(i - 1)) / h0 + h0 * (Y(i + 1) - Y(i)) / h1);
  }
  // Gauss com pivô parcial
  for (let c = 0; c < m; c++) {
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < m; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < m; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < m; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

// tubo por VARREDURA (curva suave): anéis ao longo do caminho + meia esfera
// nas pontas. Rápido e liso; se a curva for fechada demais pro diâmetro
// (a parede de dentro se dobraria), devolve null e usa o outro jeito.
function tuboVarrido(ctx, pts, r, anel) {
  const S = Math.ceil(segmentos(r, 16) / 4) * 4, P = [], I = [];
  const n = pts.length - (anel ? 1 : 0);
  if (n < 2) return null;
  const tang = i => {
    const a = pts[anel ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[anel ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const L = d2(a, b) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  };
  const anelEm = (c, t, rr, off) => { for (let j = 0; j < S; j++) { const th = 2 * Math.PI * j / S, nx = -t[1], ny = t[0]; P.push(c[0] + t[0] * off + nx * rr * Math.cos(th), c[1] + t[1] * off + ny * rr * Math.cos(th), r + rr * Math.sin(th)); } };
  const liga = (a, b) => { for (let j = 0; j < S; j++) { const j1 = (j + 1) % S; I.push(a + j, b + j, b + j1, a + j, b + j1, a + j1); } };
  const K = Math.max(3, Math.ceil(S / 4));
  let ult = -1;
  if (!anel) {                                  // meia esfera no começo
    const t = tang(0);
    P.push(pts[0][0] - t[0] * r, pts[0][1] - t[1] * r, r);
    const polo = 0;
    for (let k = 1; k < K; k++) { const ph = Math.PI / 2 * (1 - k / K); anelEm(pts[0], t, r * Math.cos(ph), -r * Math.sin(ph)); const b = P.length / 3 - S; if (k === 1) for (let j = 0; j < S; j++) I.push(polo, b + j, b + (j + 1) % S); else liga(b - S, b); ult = b; }
  }
  const primeiro = P.length / 3;
  for (let i = 0; i < n; i++) { anelEm(pts[i], tang(i), r, 0); const b = P.length / 3 - S; if (ult >= 0) liga(ult, b); ult = b; }
  if (anel) liga(ult, primeiro);
  else {                                        // meia esfera no fim
    const t = tang(n - 1), c = pts[n - 1];
    for (let k = K - 1; k >= 1; k--) { const ph = Math.PI / 2 * (1 - k / K); anelEm(c, t, r * Math.cos(ph), r * Math.sin(ph)); const b = P.length / 3 - S; liga(ult, b); ult = b; }
    P.push(c[0] + t[0] * r, c[1] + t[1] * r, r);
    const polo = P.length / 3 - 1;
    for (let j = 0; j < S; j++) I.push(ult + j, polo, ult + (j + 1) % S);
  }
  let m = criar(P, I);
  if (volume(m) < 0) m = inverterFaces(m);
  const v = validar(m, { completo: true });
  if (!v.fechada || v.autoInterseccoes || v.facesDegeneradas) return null;
  return ctx.solido({ malha: m }, 'tubo');
}

// tubo: cilindro por trecho + esfera em cada junta, unidos. Se o resultado
// não sair limpo (caminho que se cruza em ângulo ruim), refaz pelo campo de
// distância (sempre fecha, sem cruzamento).
function tubo(ctx, pts, r) {
  const { Manifold } = manifold();
  const seg = Math.ceil(segmentos(r, 16) / 4) * 4;
  const ped = [];
  for (const p of pts) ped.push(ctx.guardar(ctx.guardar(Manifold.sphere(r * 1.0005, seg)).translate([p[0], p[1], r])));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = d2(a, b);
    if (L < 1e-6) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    ped.push(ctx.guardar(ctx.guardar(ctx.guardar(ctx.guardar(Manifold.cylinder(L, r, r, seg)).rotate([0, 90, 0])).rotate([0, 0, ang])).translate([a[0], a[1], r])));
  }
  let M = ctx.guardar(Manifold.union(ped));
  const v = validar(ctx.parte(M, 't', '#999999').malha, { completo: true });
  if (v.fechada && !v.autoInterseccoes && v.componentes === 1) return M;
  // plano B: campo de distância até o caminho (resolução ~ r/5)
  const h = Math.max(0.08, r / 5);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  const sdf = q => {
    let best = Infinity;
    const z = q[2] - r;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], LL = dx * dx + dy * dy;
      let t = LL > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / LL : 0; t = Math.max(0, Math.min(1, t));
      const ex = q[0] - a[0] - t * dx, ey = q[1] - a[1] - t * dy, dd = ex * ex + ey * ey + z * z;
      if (dd < best) best = dd;
    }
    return r - Math.sqrt(best);
  };
  M = ctx.guardar(ctx.guardar(Manifold.levelSet(sdf, { min: [x0 - r - h, y0 - r - h, -h], max: [x1 + r + h, y1 + r + h, 2 * r + h] }, h, 0)).simplify(h * 0.02));
  return M;
}

// opc: { espessura, cantos (raio dos cantos, mm), graus, diametro, cor,
//        suave (curva), pontosDeCanto: [índices], fechado (tubo em anel) }
export function criarDoDesenho(pts0, tipo, opc = {}) {
  if (!pts0 || pts0.length < 2) throw new Error('Desenhe pelo menos 2 pontos.');
  const fechado = tipo !== 'tubo' || !!opc.fechado;
  let pts = opc.suave ? curvaSuave(pts0, { fechado, cantos: opc.pontosDeCanto || [], passo: 0.4 }) : pts0.map(p => p.slice());
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    let M;
    if (tipo === 'tubo') {
      const r = Math.max(0.2, (+opc.diametro || 4) / 2);
      if (fechado && d2(pts[0], pts[pts.length - 1]) > 1e-6) pts = [...pts, pts[0].slice()];
      // pedacinhos menores que ~r/2 não mudam a forma, só pesam
      const enx = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) if (d2(pts[i], enx[enx.length - 1]) >= Math.min(r / 2, 1)) enx.push(pts[i]);
      enx.push(pts[pts.length - 1]);
      M = (opc.suave && tuboVarrido(ctx, enx, r, fechado)) || tubo(ctx, enx, r);
    } else {
      if (pts.length < 3) throw new Error('Feche um contorno com pelo menos 3 pontos.');
      // NonZero: contorno que se cruza (oito, estrela) vira peça inteira
      let cs = ctx.guardar(CrossSection.ofPolygons([pts], 'NonZero'));
      if (cs.isEmpty() || cs.area() < 1e-6) throw new Error('O desenho não tem área (pontos em linha).');
      const rc = +opc.cantos || 0;
      // cantos arredondados (fora e dentro), sem mudar o tamanho geral
      if (rc > 0) cs = ctx.guardar(ctx.guardar(ctx.guardar(cs.offset(-rc, 'Round', 2, 32)).offset(2 * rc, 'Round', 2, 32)).offset(-rc, 'Round', 2, 32));
      if (cs.isEmpty()) throw new Error('O contorno sumiu com esse arredondamento.');
      if (tipo === 'revolucionar') {
        const b = cs.bounds();
        const perfil = ctx.guardar(cs.translate([-b.min[0], -b.min[1]]));
        const graus = Math.max(1, Math.min(360, +opc.graus || 360));
        M = ctx.guardar(Manifold.revolve(perfil, segmentos(b.max[0] - b.min[0], 48), graus));
        // centro do giro onde estava o eixo (esquerda do desenho), de pé na mesa
        M = ctx.guardar(M.translate([b.min[0], (b.min[1] + b.max[1]) / 2, 0]));
      } else {
        const e = +opc.espessura;
        if (!(e > 0)) throw new Error('Informe a espessura (mm).');
        M = ctx.guardar(Manifold.extrude(cs, e));
      }
    }
    if (M.isEmpty()) throw new Error('Não saiu peça desse desenho.');
    const bb = M.boundingBox();
    M = ctx.guardar(M.translate([0, 0, -bb.min[2]]));
    return { malha: ctx.parte(M, 'Desenho', opc.cor || '#999999').malha, volume: M.volume() };
  });
}

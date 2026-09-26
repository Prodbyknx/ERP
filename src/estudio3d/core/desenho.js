// DESENHAR E CRIAR: pontos em mm viram
//   'extrudar'     — peça com espessura (placa, base, logo, suporte)
//   'revolucionar' — perfil girado em volta do eixo (vaso, puxador, botão):
//                    a linha mais à esquerda do desenho é o eixo
//   'tubo'         — caminho vira tubo de diâmetro d (aberto ou em anel)
// Na MESA (x,y), num PLANO em pé (parede) ou no ESPAÇO: ponto com altura,
// tubo que sobe e desce, tubo que corre SOBRE a superfície de uma peça.
// Linha reta ou CURVA SUAVE passando pelos pontos (pontos de canto ficam
// pontudos). Sempre sólido fechado, medidas em mm.
import { comContexto, manifold, segmentos } from './solidos.js';
import { validar } from './validador.js';
import { criar, volume, inverterFaces } from './malha.js';
import { construirBVH, pontoMaisPerto } from './bvh.js';
import { prepararSuperficie, normalEm } from './envolver.js';

// distância entre pontos de 2 ou 3 coordenadas
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0));
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

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
    const dim = Q[0].length, K = [...Array(dim).keys()];
    const D = K.map(k => resolverSpline(Q.map(p => p[k]), h, cicl));
    const r = [];
    for (let i = 0; i < ns; i++) {
      const a = Q[i], b = Q[(i + 1) % m], j = (i + 1) % m, hi = h[i];
      const c1 = K.map(k => a[k] + D[k][i] * hi / 3), c2 = K.map(k => b[k] - D[k][j] * hi / 3);
      const n = Math.max(2, Math.ceil((d2(a, c1) + d2(c1, c2) + d2(c2, b)) / passo));
      for (let s = 0; s < n; s++) {
        const t = s / n, u = 1 - t;
        r.push(K.map(k => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k]));
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

// tubo por VARREDURA (curva suave): anéis ao longo da linha de centro (3D)
// + meia esfera nas pontas. Os anéis seguem a curva sem torcer (o "de lado"
// de cada anel é o do anterior, girado o mínimo). Rápido e liso; se a curva
// for fechada demais pro diâmetro (a parede de dentro se dobraria), devolve
// null e usa o outro jeito.
function tuboVarrido(ctx, pts, r, anel) {
  const S = Math.ceil(segmentos(r, 16) / 4) * 4, P = [], I = [];
  const n = pts.length - (anel ? 1 : 0);
  if (n < 2) return null;
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = pts[anel ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[anel ? (i + 1) % n : Math.min(n - 1, i + 1)];
    T.push(norm3(sub3(b, a)));
  }
  // referencial que não torce (transporte paralelo)
  const Z = [0, 0, 1];
  const N = [norm3(cruz3(T[0], Math.abs(T[0][2]) < 0.9 ? Z : [1, 0, 0]))];
  const girar = (v, eixo, ang) => { const c = Math.cos(ang), s = Math.sin(ang), k = eixo, kv = cruz3(k, v), d = dot3(k, v); return [0, 1, 2].map(e => v[e] * c + kv[e] * s + k[e] * d * (1 - c)); };
  const levar = (Nv, t0, t1) => { const ax = cruz3(t0, t1), L = Math.hypot(...ax); let v = L > 1e-12 ? girar(Nv, [ax[0] / L, ax[1] / L, ax[2] / L], Math.atan2(L, dot3(t0, t1))) : Nv; return norm3(sub3(v, T1(v, t1))); };
  const T1 = (v, t) => { const d = dot3(v, t); return [t[0] * d, t[1] * d, t[2] * d]; };
  for (let i = 1; i < n; i++) N.push(levar(N[i - 1], T[i - 1], T[i]));
  if (anel) {
    // o anel tem que fechar sem degrau: distribui a torção que sobrou
    const Nf = levar(N[n - 1], T[n - 1], T[0]), B0 = cruz3(T[0], N[0]);
    const fi = Math.atan2(dot3(Nf, B0), dot3(Nf, N[0]));
    for (let i = 1; i < n; i++) N[i] = girar(N[i], T[i], -fi * i / n);
  }
  const anelEm = (i, c, rr, off) => {
    const t = T[i], nn = N[i], b = cruz3(t, nn);
    for (let j = 0; j < S; j++) { const th = 2 * Math.PI * j / S, co = Math.cos(th) * rr, si = Math.sin(th) * rr; P.push(c[0] + t[0] * off + nn[0] * co + b[0] * si, c[1] + t[1] * off + nn[1] * co + b[1] * si, c[2] + t[2] * off + nn[2] * co + b[2] * si); }
  };
  const liga = (a, b) => { for (let j = 0; j < S; j++) { const j1 = (j + 1) % S; I.push(a + j, b + j, b + j1, a + j, b + j1, a + j1); } };
  const K = Math.max(3, Math.ceil(S / 4));
  let ult = -1;
  if (!anel) {                                  // meia esfera no começo
    const t = T[0], c = pts[0];
    P.push(c[0] - t[0] * r, c[1] - t[1] * r, c[2] - t[2] * r);
    for (let k = 1; k < K; k++) { const ph = Math.PI / 2 * (1 - k / K); anelEm(0, c, r * Math.cos(ph), -r * Math.sin(ph)); const b = P.length / 3 - S; if (k === 1) for (let j = 0; j < S; j++) I.push(0, b + j, b + (j + 1) % S); else liga(b - S, b); ult = b; }
  }
  const primeiro = P.length / 3;
  for (let i = 0; i < n; i++) { anelEm(i, pts[i], r, 0); const b = P.length / 3 - S; if (ult >= 0) liga(ult, b); ult = b; }
  if (anel) liga(ult, primeiro);
  else {                                        // meia esfera no fim
    const t = T[n - 1], c = pts[n - 1];
    for (let k = K - 1; k >= 1; k--) { const ph = Math.PI / 2 * (1 - k / K); anelEm(n - 1, c, r * Math.cos(ph), r * Math.sin(ph)); const b = P.length / 3 - S; liga(ult, b); ult = b; }
    P.push(c[0] + t[0] * r, c[1] + t[1] * r, c[2] + t[2] * r);
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
  for (const p of pts) ped.push(ctx.guardar(ctx.guardar(Manifold.sphere(r * 1.0005, seg)).translate(p)));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = d2(a, b);
    if (L < 1e-6) continue;
    const d = sub3(b, a);
    const pitch = Math.acos(Math.max(-1, Math.min(1, d[2] / L))) * 180 / Math.PI, yaw = Math.atan2(d[1], d[0]) * 180 / Math.PI;
    ped.push(ctx.guardar(ctx.guardar(ctx.guardar(ctx.guardar(Manifold.cylinder(L, r, r, seg)).rotate([0, pitch, 0])).rotate([0, 0, yaw])).translate(a)));
  }
  // (a união deixa triângulos de área zero nas juntas: limpa sem mudar a forma)
  let M = ctx.guardar(ctx.guardar(Manifold.union(ped)).simplify(1e-6));
  const v = validar(ctx.parte(M, 't', '#999999').malha, { completo: true });
  if (v.fechada && !v.autoInterseccoes && v.componentes === 1) return M;
  // plano B: campo de distância até o caminho (resolução ~ r/5)
  const h = Math.max(0.08, r / 5);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let e = 0; e < 3; e++) { lo[e] = Math.min(lo[e], p[e]); hi[e] = Math.max(hi[e], p[e]); }
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], sub3(pts[i], pts[i - 1])]);
  const sdf = q => {
    let best = Infinity;
    for (const [a, d] of segs) {
      const LL = dot3(d, d), w = sub3(q, a);
      let t = LL > 0 ? dot3(w, d) / LL : 0; t = Math.max(0, Math.min(1, t));
      const ex = w[0] - t * d[0], ey = w[1] - t * d[1], ez = w[2] - t * d[2], dd = ex * ex + ey * ey + ez * ez;
      if (dd < best) best = dd;
    }
    return r - Math.sqrt(best);
  };
  M = ctx.guardar(ctx.guardar(Manifold.levelSet(sdf, { min: lo.map(x => x - r - h), max: hi.map(x => x + r + h) }, h, 0)).simplify(h * 0.02));
  return M;
}

// leva cada ponto da linha pra cima da superfície (ponto mais perto + normal
// suave), a 'alt' mm dela: o tubo corre por cima da peça
function sobreASuperficie(pts, malha, alt) {
  const bvh = construirBVH(malha), S = prepararSuperficie(malha);
  return pts.map(p => {
    const q = pontoMaisPerto(bvh, p[0], p[1], p[2]);
    if (!q) return p;
    const n = normalEm(S, q.face, q.ponto);
    return [q.ponto[0] + n[0] * alt, q.ponto[1] + n[1] * alt, q.ponto[2] + n[2] * alt];
  });
}

// pts: [[x,y]] na mesa ou [[x,y,z]] no espaço.
// opc: { espessura, cantos (raio dos cantos, mm), graus, diametro, cor,
//        suave (curva), pontosDeCanto: [índices], fechado (tubo em anel),
//        plano: {o,u,v} (contorno desenhado num plano em pé: pts 3D nele),
//        sobre: malha (tubo que corre por cima dessa superfície, no mundo),
//        manterPosicao (não encosta na mesa: fica onde foi desenhado) }
export function criarDoDesenho(pts0, tipo, opc = {}) {
  if (!pts0 || pts0.length < 2) throw new Error('Desenhe pelo menos 2 pontos.');
  const fechado = tipo !== 'tubo' || !!opc.fechado;
  const tres = pts0[0].length >= 3;
  let pts = opc.suave ? curvaSuave(pts0, { fechado, cantos: opc.pontosDeCanto || [], passo: 0.4 }) : pts0.map(p => p.slice());
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    let M;
    if (tipo === 'tubo') {
      const r = Math.max(0.2, (+opc.diametro || 4) / 2);
      // na mesa: linha de centro a r do chão (o tubo deita na mesa)
      pts = tres ? pts.map(p => p.slice(0, 3)) : pts.map(p => [p[0], p[1], r]);
      if (opc.sobre) pts = sobreASuperficie(pts, opc.sobre, r * 0.85);
      if (fechado && d2(pts[0], pts[pts.length - 1]) > 1e-6) pts = [...pts, pts[0].slice()];
      // pedacinhos menores que ~r/2 não mudam a forma, só pesam
      const enx = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) if (d2(pts[i], enx[enx.length - 1]) >= Math.min(r / 2, 1)) enx.push(pts[i]);
      enx.push(pts[pts.length - 1]);
      // curva suave: a varredura usa TODOS os pontos da curva (a cada 0,4 mm,
      // passando exatamente pelos clicados: altura e largura exatas); o
      // caminho enxuto é só pro jeito de reserva (cilindros unidos)
      // curva mais fechada que o raio num ponto: tenta com o caminho enxuto
      // (corta a curvinha) e, por fim, cilindros unidos
      M = ((opc.suave || tres) && ((opc.suave && tuboVarrido(ctx, pts, r, fechado)) || tuboVarrido(ctx, enx, r, fechado))) || tubo(ctx, enx, r);
    } else {
      if (pts.length < 3) throw new Error('Feche um contorno com pelo menos 3 pontos.');
      // contorno num plano em pé: passa pras coordenadas do plano (u, v)
      const pl = opc.plano;
      let u, v, nn;
      if (pl) { u = norm3(pl.u); v = norm3(pl.v); nn = cruz3(u, v); pts = pts.map(p => { const w = sub3(p, pl.o); return [dot3(w, u), dot3(w, v)]; }); }
      else pts = pts.map(p => [p[0], p[1]]);
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
        if (pl) {
          // perfil desenhado em pé: o eixo é a linha da esquerda, onde foi desenhada
          const eixo = [pl.o[0] + u[0] * b.min[0] + v[0] * b.min[1], pl.o[1] + u[1] * b.min[0] + v[1] * b.min[1], pl.o[2] + u[2] * b.min[0] + v[2] * b.min[1]];
          // o "pra cima" do perfil (v) vira o Z do sólido; gira pra alinhar com v
          const R = baseDe([u[0], u[1], u[2]], v);
          M = ctx.guardar(ctx.guardar(M.transform(R)).translate(eixo));
        } else {
          // centro do giro onde estava o eixo (esquerda do desenho), de pé na mesa
          M = ctx.guardar(M.translate([b.min[0], (b.min[1] + b.max[1]) / 2, 0]));
        }
      } else {
        const e = +opc.espessura;
        if (!(e > 0)) throw new Error('Informe a espessura (mm).');
        M = ctx.guardar(Manifold.extrude(cs, e));
        if (pl) M = ctx.guardar(M.transform([u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, nn[0], nn[1], nn[2], 0, pl.o[0], pl.o[1], pl.o[2], 1]));
      }
    }
    if (M.isEmpty()) throw new Error('Não saiu peça desse desenho.');
    if (!opc.manterPosicao) { const bb = M.boundingBox(); M = ctx.guardar(M.translate([0, 0, -bb.min[2]])); }
    return { malha: ctx.parte(M, 'Desenho', opc.cor || '#999999').malha, volume: M.volume() };
  });
}

// matriz 4x4 (coluna) que leva o Z do sólido girado pra v e o X pra u
function baseDe(u, v) {
  const z = norm3(v), x = norm3(sub3(u, [z[0] * dot3(u, z), z[1] * dot3(u, z), z[2] * dot3(u, z)])), y = cruz3(z, x);
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1];
}

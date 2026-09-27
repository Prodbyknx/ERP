// Deformações da peça inteira (orgânico): TORCER, AFUNILAR, DOBRAR e INFLAR
// (o SUAVIZAR fica em suavizar.js). Antes refina a malha pra curva sair
// lisa; depois confere que continua um sólido fechado sem se cruzar.
import { comContexto, manifold } from './solidos.js';
import { caixa, criar } from './malha.js';
import { autoInterseccoes } from './validador.js';

const fmt = v => (Math.round(v * 100) / 100).toString().replace('.', ',');

// opc: { tipo: 'torcer'|'afunilar'|'dobrar'|'inflar', valor, eixo: 0|1|2, sentido: 1|-1 }
export function deformar(parte, opc) {
  const { tipo } = opc, valor = +opc.valor, eixo = opc.eixo == null ? 2 : +opc.eixo;
  if (!isFinite(valor) || valor === 0) throw new Error('Informe o valor.');
  const cx = caixa(parte.malha), c = cx.min.map((v, i) => (v + cx.max[i]) / 2);
  const a0 = cx.min[eixo], L = cx.tam[eixo] || 1;
  const [u, w] = [0, 1, 2].filter(i => i !== eixo);
  return comContexto(ctx => {
    const M0 = ctx.solido(parte, parte.nome);
    // malha fina o bastante pra curva não sair em degraus
    const alvo = Math.max(Math.max(...cx.tam) / 80, 0.3);
    let M = M0.numTri() < 200000 ? ctx.guardar(M0.refineToLength(alvo)) : M0;
    const f = v => {
      // 0 embaixo, 1 em cima (sentido -1: a peça está de cabeça pra baixo no mundo)
      const t = opc.sentido === -1 ? (a0 + L - v[eixo]) / L : (v[eixo] - a0) / L;
      if (tipo === 'torcer') {
        const ang = valor * Math.PI / 180 * t, co = Math.cos(ang), si = Math.sin(ang);
        const x = v[u] - c[u], y = v[w] - c[w];
        v[u] = c[u] + x * co - y * si; v[w] = c[w] + x * si + y * co;
      } else if (tipo === 'afunilar') {
        // valor = escala no topo (1 = igual, 0,5 = metade)
        const k = 1 + (valor - 1) * t;
        v[u] = c[u] + (v[u] - c[u]) * k; v[w] = c[w] + (v[w] - c[w]) * k;
      } else if (tipo === 'dobrar') {
        // dobra em volta do eixo w; valor = ângulo total (graus)
        const ang = valor * Math.PI / 180;
        const Rb = L / ang;                             // raio da dobra
        const th = t * ang, x = v[u] - c[u];
        const r = Rb - x;
        v[u] = c[u] + Rb - r * Math.cos(th);
        v[eixo] = opc.sentido === -1 ? a0 + L - r * Math.sin(th) : a0 + r * Math.sin(th);
      }
    };
    if (tipo === 'inflar') {
      // pela normal de cada vértice, valor em mm
      const m = ctx.parte(M, 'x', parte.cor).malha;
      const P = Float64Array.from(m.pos), N = normaisVertice(m);
      for (let i = 0; i < P.length; i++) P[i] += N[i] * valor;
      M = ctx.solido({ malha: criar(P, m.idx) }, parte.nome);
    } else M = ctx.guardar(M.warp(f));
    if (M.status() !== 'NoError' || M.isEmpty()) throw new Error('A deformação quebrou a peça. Use um valor menor.');
    const p = ctx.parte(M, parte.nome, parte.cor, false);
    if (autoInterseccoes(p.malha, { max: 5 }).pares > 0) throw new Error('Com ' + fmt(valor) + ' a peça passa a atravessar ela mesma. Use um valor menor.');
    return { parte: { nome: parte.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }, volume: M.volume() };
  });
}

function normaisVertice(m) {
  const P = m.pos, I = m.idx, N = new Float64Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    for (const v of [a, b, c]) for (let e = 0; e < 3; e++) N[v + e] += n[e];
  }
  for (let i = 0; i < N.length; i += 3) { const L = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= L; N[i + 1] /= L; N[i + 2] /= L; }
  return N;
}

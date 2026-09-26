// ENVOLVER A SUPERFÍCIE: leva um desenho plano (texto, logo) pra cima de uma
// superfície curva SEM achatar as letras — a medida ao longo da superfície é
// a medida do desenho (como um adesivo colado numa caneca) — e com altura ou
// profundidade constante acompanhando a curva.
// Como: a partir do ponto central anda sobre a superfície na direção X do
// desenho (em passos pequenos, raio pra achar a superfície a cada passo);
// de cada ponto dessa linha anda na direção Y. Isso dá uma grade (x,y) ->
// ponto e normal da superfície. Funciona em cilindro (caneca, caneta), cone,
// esfera, ovo e formas orgânicas suaves; numa quina, dobra junto.
import { construirBVH, lancarRaio } from './bvh.js';
import * as M4 from './mat4.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
const semComp = (a, b) => soma(a, b, -dot(a, b));      // tira de a a componente em b (b unitário)

function normaisVertice(m) {
  const P = m.pos, I = m.idx, N = new Float64Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c]) { N[v] += n[0]; N[v + 1] += n[1]; N[v + 2] += n[2]; }
  }
  return N;
}

// malha: peça alvo; F: referencial do desenho (origem ~ na superfície, Z pra fora);
// cobre: { x0, x1, y0, y1 } a área do desenho (mm, no referencial)
export function mapaDaSuperficie(malha, F, cobre, opc = {}) {
  const bvh = construirBVH(malha), VN = normaisVertice(malha), P = malha.pos, I = malha.idx;
  const O = M4.aplicarPonto(F, 0, 0, 0), X = norm(M4.aplicarDirecao(F, 1, 0, 0)), Y = norm(M4.aplicarDirecao(F, 0, 1, 0)), Z = norm(M4.aplicarDirecao(F, 0, 0, 1));
  const larg = Math.max(cobre.x1 - cobre.x0, 1e-3), alt = Math.max(cobre.y1 - cobre.y0, 1e-3);
  const ds = opc.passo || Math.max(0.15, Math.min(0.6, Math.min(larg, alt) / 40));
  let raios = 0;
  // ponto e normal (suavizada) da superfície no raio p -> -n
  const achar = (p, n, alcance) => {
    raios++;
    const o = soma(p, n, alcance), h = lancarRaio(bvh, o[0], o[1], o[2], -n[0], -n[1], -n[2], alcance * 2.5);
    if (!h) return null;
    const q = soma(o, n, -h.t), f = h.face;
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    // baricêntricas pra misturar as normais dos 3 vértices
    const v0 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v1 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], v2 = [q[0] - P[a], q[1] - P[a + 1], q[2] - P[a + 2]];
    const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01 || 1;
    const wb = (d11 * d20 - d01 * d21) / den, wc = (d00 * d21 - d01 * d20) / den, wa = 1 - wb - wc;
    let nn = [0, 1, 2].map(k => VN[a + k] * wa + VN[b + k] * wb + VN[c + k] * wc);
    if (dot(nn, n) < 0.2) nn = n;            // normal esquisita (quina): segue a de antes
    return { p: q, n: norm(nn) };
  };
  // anda sobre a superfície a partir de (p,n) na direção d, sem sair do plano
  // que tem 'lado' como normal, até cobrir 'ate' mm. Devolve [{s,p,n,t}]
  const andar = (p0, n0, d, lado, ate) => {
    const out = [];
    let p = p0, n = norm(semComp(n0, lado)), t = norm(semComp(semComp(d, lado), n)), s = 0;
    while (s < ate) {
      // deu a volta inteira (cilindro, esfera): o desenho não cabe na volta
      if (s > 4 * ds && Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]) < 1.5 * ds) { out.volta = s + Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]); break; }
      const g = soma(p, t, ds);
      const q = achar(g, n, ds * 3);
      if (!q) break;
      const passo = sub(q.p, p), L = Math.hypot(passo[0], passo[1], passo[2]);
      if (L < ds * 0.2 || L > ds * 3) break;   // caiu da peça ou voltou
      const nn = norm(semComp(q.n, lado));
      s += L; p = q.p; n = nn;
      t = norm(semComp(semComp(passo, lado), n));
      out.push({ s, p, n, t });
      if (out.length > 20000) break;
    }
    return out;
  };
  // ponto de partida na superfície
  const ini = achar(O, Z, opc.alcance || 1e4);
  if (!ini) return null;
  // linha X (ao longo do desenho), pros dois lados
  const mx = ds * 2;
  let volta = 0;
  const perfil = (p, n, dir, lado, a0, a1) => {
    const n0 = andar(p, n, soma([0, 0, 0], dir, -1), lado, -a0 + mx), pos = andar(p, n, dir, lado, a1 + mx);
    // os dois lados se encontram do outro lado da volta
    const vt = n0.volta || pos.volta || 0;
    if (vt) volta = volta ? Math.min(volta, vt) : vt;
    else if (n0.length && pos.length) {
      // um lado alcança o outro (passou da volta): acha o primeiro encontro
      let achou = 0;
      for (let i = 0; i < pos.length && !achou; i += 2) for (let j = 0; j < n0.length; j += 2) {
        const a = pos[i].p, b = n0[j].p;
        if (pos[i].s + n0[j].s > 4 * ds && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < ds * 2) { achou = pos[i].s + n0[j].s; break; }
      }
      if (achou) volta = volta ? Math.min(volta, achou) : achou;
    }
    const neg = n0.map(e => ({ s: -e.s, p: e.p, n: e.n, t: soma([0, 0, 0], e.t, -1) }));
    const t0 = norm(semComp(semComp(dir, lado), n));
    return [...neg.reverse(), { s: 0, p, n: norm(semComp(n, lado)), t: t0 }, ...pos];
  };
  const linhaX = perfil(ini.p, ini.n, X, Y, cobre.x0, cobre.x1);
  if (volta && larg > volta - 2 * ds) return { falta: 'volta', volta, raios };
  if (linhaX[0].s > cobre.x0 || linhaX[linhaX.length - 1].s < cobre.x1) return { falta: 'x', raios };
  // uma coluna Y por amostra da linha X (dentro da área do desenho)
  const colunas = [];
  for (const e of linhaX) {
    if (e.s < cobre.x0 - mx || e.s > cobre.x1 + mx) continue;
    const lado = norm(e.t);
    const c = perfil(e.p, e.n, norm(semComp(semComp(Y, lado), e.n)), lado, cobre.y0, cobre.y1);
    if (volta && alt > volta - 2 * ds) return { falta: 'volta', volta, raios };
    if (c[0].s > cobre.y0 || c[c.length - 1].s < cobre.y1) return { falta: 'y', raios };
    colunas.push({ s: e.s, c });
  }
  const busca = (arr, s) => { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m].s <= s) lo = m; else hi = m; } return lo; };
  const naColuna = (col, y) => {
    const c = col.c, i = Math.max(0, Math.min(c.length - 2, busca(c, y))), a = c[i], b = c[i + 1];
    const k = Math.max(0, Math.min(1, (y - a.s) / ((b.s - a.s) || 1)));
    return { p: soma(a.p, sub(b.p, a.p), k), n: soma(a.n, sub(b.n, a.n), k) };
  };
  // (x,y) do desenho -> ponto e normal da superfície
  const f = (x, y) => {
    const i = Math.max(0, Math.min(colunas.length - 2, busca(colunas, x))), A = colunas[i], B = colunas[i + 1];
    const k = Math.max(0, Math.min(1, (x - A.s) / ((B.s - A.s) || 1)));
    const a = naColuna(A, y), b = naColuna(B, y);
    return { p: soma(a.p, sub(b.p, a.p), k), n: norm(soma(a.n, sub(b.n, a.n), k)) };
  };
  return { f, raios, passo: ds, colunas: colunas.length };
}

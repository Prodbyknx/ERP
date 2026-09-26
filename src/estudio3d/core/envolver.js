// ENVOLVER A SUPERFÍCIE: leva um desenho plano (texto, logo) pra cima de uma
// superfície SEM achatar as letras — a medida ao longo da superfície é a
// medida do desenho (como um adesivo colado) — e com altura ou profundidade
// constante acompanhando a superfície.
// Como: a partir do ponto central ANDA SOBRE A MALHA em linha reta
// (geodésica): de triângulo em triângulo, desdobrando um sobre o outro. Assim
// vira qualquer curva E qualquer quina viva (convexa ou côncava). Da linha X
// saem colunas Y. Isso dá uma grade (x,y) -> ponto, normal e "face lisa"
// (grupo de triângulos sem quina viva entre eles).
// Se o desenho passa por mais de uma face lisa (atravessa uma quina), cada
// pedaço é levantado pela sua face e os pedaços se encontram na bissetriz da
// quina — a dobra fica em meia-esquadria, como um adesivo grosso dobrado.
import { construirBVH, lancarRaio } from './bvh.js';
import * as M4 from './mat4.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
const semComp = (a, b) => soma(a, b, -dot(a, b));      // tira de a a componente em b (b unitário)
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const ANGULO_QUINA = 35;                        // graus: acima disso é quina viva

// ------------------------------------------------ preparo (fica guardado por malha)
const cache = new WeakMap();
export function prepararSuperficie(m) {
  let S = cache.get(m);
  if (S) return S;
  const P = m.pos, I = m.idx, nt = I.length / 3, nv = P.length / 3;
  const fn = new Float64Array(nt * 3), area = new Float64Array(nt);
  for (let f = 0; f < nt; f++) {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const n = cruz([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    const L = Math.hypot(n[0], n[1], n[2]); area[f] = L / 2;
    if (L > 0) { fn[f * 3] = n[0] / L; fn[f * 3 + 1] = n[1] / L; fn[f * 3 + 2] = n[2] / L; }
  }
  // vizinha do outro lado de cada aresta (f, k): aresta I[f*3+k] -> I[f*3+(k+1)%3]
  const viz = new Int32Array(nt * 3).fill(-1), arestas = new Map();
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) {
    const a = I[f * 3 + k], b = I[f * 3 + (k + 1) % 3], ch = a < b ? a * nv + b : b * nv + a;
    const o = arestas.get(ch);
    if (o === undefined) arestas.set(ch, f * 3 + k);
    else if (o >= 0) { viz[f * 3 + k] = Math.floor(o / 3); viz[o] = f; arestas.set(ch, -1); }
    else { viz[f * 3 + k] = -1; }                       // aresta com 3+ faces: não atravessa
  }
  const cq = Math.cos(ANGULO_QUINA * Math.PI / 180);
  const lisa = (f, g) => fn[f * 3] * fn[g * 3] + fn[f * 3 + 1] * fn[g * 3 + 1] + fn[f * 3 + 2] * fn[g * 3 + 2] > cq;
  // grupos lisos (sem quina viva entre as faces)
  const pai = new Int32Array(nt); for (let f = 0; f < nt; f++) pai[f] = f;
  const raiz = x => { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) { const g = viz[f * 3 + k]; if (g > f && lisa(f, g)) { const a = raiz(f), b = raiz(g); if (a !== b) pai[a] = b; } }
  const grupo = new Int32Array(nt); for (let f = 0; f < nt; f++) grupo[f] = raiz(f);
  // normal por canto: média das faces em volta do vértice que são "lisas" com esta
  const ini = new Int32Array(nv + 1);
  for (let t = 0; t < I.length; t++) ini[I[t] + 1]++;
  for (let v = 0; v < nv; v++) ini[v + 1] += ini[v];
  const lista = new Int32Array(I.length), pos = ini.slice(0, nv);
  for (let t = 0; t < I.length; t++) lista[pos[I[t]]++] = Math.floor(t / 3);
  const cn = new Float64Array(nt * 9);
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) {
    const v = I[f * 3 + k]; let x = 0, y = 0, z = 0;
    for (let i = ini[v]; i < ini[v + 1]; i++) { const g = lista[i]; if (g === f || lisa(f, g)) { x += fn[g * 3] * area[g]; y += fn[g * 3 + 1] * area[g]; z += fn[g * 3 + 2] * area[g]; } }
    const L = Math.hypot(x, y, z) || 1;
    cn[f * 9 + k * 3] = x / L; cn[f * 9 + k * 3 + 1] = y / L; cn[f * 9 + k * 3 + 2] = z / L;
  }
  S = { m, fn, viz, grupo, cn, bvh: null };
  cache.set(m, S);
  return S;
}

const V = (S, f, k) => { const i = S.m.idx[f * 3 + k] * 3, P = S.m.pos; return [P[i], P[i + 1], P[i + 2]]; };
const FN = (S, f) => [S.fn[f * 3], S.fn[f * 3 + 1], S.fn[f * 3 + 2]];

// normal suave no ponto p da face f (quina viva respeitada)
export function normalEm(S, f, p) {
  const A = V(S, f, 0), B = V(S, f, 1), C = V(S, f, 2);
  const v0 = sub(B, A), v1 = sub(C, A), v2 = sub(p, A);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01 || 1;
  const wb = Math.max(0, (d11 * d20 - d01 * d21) / den), wc = Math.max(0, (d00 * d21 - d01 * d20) / den), wa = Math.max(0, 1 - wb - wc);
  const c = S.cn, o = f * 9;
  return norm([c[o] * wa + c[o + 3] * wb + c[o + 6] * wc, c[o + 1] * wa + c[o + 4] * wb + c[o + 7] * wc, c[o + 2] * wa + c[o + 5] * wb + c[o + 8] * wc]);
}

// ANDA 'ate' mm em linha reta sobre a malha a partir de p (na face f), na
// direção d (no plano da face). A cada 'ds' mm chama amostra(s, p, f, t).
// Na aresta, passa pra face vizinha girando a direção em volta da aresta
// (desdobra). Para na borda aberta. Devolve a distância andada.
export function andarNaMalha(S, f, p, d, ate, ds, amostra) {
  let s = 0, prox = ds, veio = -1, voltas = 0;
  d = norm(semComp(d, FN(S, f)));
  while (s < ate && voltas++ < 200000) {
    // saída do triângulo: menor u > 0 em que p + u·d cruza uma aresta
    const n = FN(S, f);
    let uSai = Infinity, kSai = -1;
    for (let k = 0; k < 3; k++) {
      if (k === veio) continue;
      const a = V(S, f, k), b = V(S, f, (k + 1) % 3), e = sub(b, a);
      // plano da aresta (perpendicular à face): normal m = n × e (aponta pra dentro)
      const mm = cruz(n, e), den = dot(d, mm);
      if (den >= -1e-15) continue;                     // não está saindo por essa aresta
      const u = dot(sub(a, p), mm) / den;
      if (u < uSai) { uSai = u; kSai = k; }
    }
    if (kSai < 0 || !isFinite(uSai)) return s;          // degenerado
    uSai = Math.max(0, uSai);
    // amostras dentro deste triângulo
    while (prox <= s + uSai && prox <= ate + 1e-9) { const q = soma(p, d, prox - s); amostra(prox, q, f, d); prox += ds; }
    if (s + uSai >= ate) return ate;
    p = soma(p, d, uSai); s += uSai;
    const g = S.viz[f * 3 + kSai];
    if (g < 0) return s;                                 // borda aberta
    // desdobra: gira d em volta da aresta, da face f pra face g
    const a = V(S, f, kSai), b = V(S, f, (kSai + 1) % 3), e = norm(sub(b, a));
    const pf = norm(cruz(e, n));                          // perpendicular à aresta no plano de f
    const w = dot(d, pf), al = dot(d, e);
    const ng = FN(S, g);
    let pg = norm(cruz(e, ng));
    // pg tem que apontar pra dentro de g (pro vértice de g fora da aresta)
    const I = S.m.idx, ia = I[f * 3 + kSai], ib = I[f * 3 + (kSai + 1) % 3];
    let kg = -1, oposto;
    for (let k = 0; k < 3; k++) { const vk = I[g * 3 + k]; if (vk !== ia && vk !== ib) oposto = V(S, g, k); const vn = I[g * 3 + (k + 1) % 3]; if ((vk === ia && vn === ib) || (vk === ib && vn === ia)) kg = k; }
    if (dot(sub(oposto, a), pg) < 0) pg = [-pg[0], -pg[1], -pg[2]];
    d = norm(soma(soma([0, 0, 0], e, al), pg, Math.abs(w)));
    f = g; veio = kg;
    p = soma(p, d, 1e-9);                                 // desencosta da aresta
  }
  return s;
}

// malha: peça alvo; F: referencial do desenho (origem ~ na superfície, Z pra fora);
// cobre: { x0, x1, y0, y1 } a área do desenho (mm, no referencial)
export function mapaDaSuperficie(malha, F, cobre, opc = {}) {
  const S = prepararSuperficie(malha);
  if (!S.bvh) S.bvh = construirBVH(malha);
  const O = M4.aplicarPonto(F, 0, 0, 0), X = norm(M4.aplicarDirecao(F, 1, 0, 0)), Y = norm(M4.aplicarDirecao(F, 0, 1, 0)), Z = norm(M4.aplicarDirecao(F, 0, 0, 1));
  const larg = Math.max(cobre.x1 - cobre.x0, 1e-3), alt = Math.max(cobre.y1 - cobre.y0, 1e-3);
  const ds = opc.passo || Math.max(0.15, Math.min(0.6, Math.min(larg, alt) / 40));
  // ponto de partida: raio de fora pra dentro pela normal do referencial
  const al = opc.alcance || 1e4;
  const o = soma(O, Z, al), h = lancarRaio(S.bvh, o[0], o[1], o[2], -Z[0], -Z[1], -Z[2], al * 2.5);
  if (!h) return null;
  const p0 = soma(o, Z, -h.t), f0 = h.face;
  const mx = ds * 2;
  // linha: amostras [{s,p,f,t}] pros dois lados a partir de (p,f) na direção dir
  const linha = (p, f, dir, a0, a1) => {
    const pos = [], neg = [];
    andarNaMalha(S, f, p, dir, a1 + mx, ds, (s, q, g, t) => pos.push({ s, p: q, f: g, t }));
    andarNaMalha(S, f, p, soma([0, 0, 0], dir, -1), -a0 + mx, ds, (s, q, g, t) => neg.push({ s: -s, p: q, f: g, t: soma([0, 0, 0], t, -1) }));
    return [...neg.reverse(), { s: 0, p, f, t: norm(semComp(dir, FN(S, f))) }, ...pos];
  };
  // deu a volta na peça? (um lado encontra o outro)
  const volta = L => {
    const neg = L.filter(e => e.s < 0), pos = L.filter(e => e.s > 0);
    for (let i = 0; i < pos.length; i += 2) for (let j = 0; j < neg.length; j += 2) {
      if (pos[i].s - neg[j].s > 4 * ds && dist(pos[i].p, neg[j].p) < ds * 2) return pos[i].s - neg[j].s;
    }
    return 0;
  };
  const linhaX = linha(p0, f0, X, cobre.x0, cobre.x1);
  const vx = volta(linhaX);
  if (vx && larg > vx - 2 * ds) return { falta: 'volta', volta: vx };
  if (linhaX[0].s > cobre.x0 || linhaX[linhaX.length - 1].s < cobre.x1) return { falta: 'x' };
  const colunas = [];
  for (const e of linhaX) {
    if (e.s < cobre.x0 - mx || e.s > cobre.x1 + mx) continue;
    // Y da coluna: perpendicular à linha, na face, do lado do Y do desenho
    const n = FN(S, e.f);
    let yd = norm(cruz(n, e.t));
    if (dot(yd, colunas.length ? colunas[colunas.length - 1].yd : Y) < 0) yd = [-yd[0], -yd[1], -yd[2]];
    const c = linha(e.p, e.f, yd, cobre.y0, cobre.y1);
    const vy = volta(c);
    if (vy && alt > vy - 2 * ds) return { falta: 'volta', volta: vy };
    if (c[0].s > cobre.y0 || c[c.length - 1].s < cobre.y1) return { falta: 'y' };
    colunas.push({ s: e.s, yd, xt: norm(semComp(e.t, FN(S, e.f))), c: c.map(q => ({ s: q.s, p: q.p, n: normalEm(S, q.f, q.p), f: q.f, t: q.t, g: S.grupo[q.f] })) });
  }
  // faces lisas que o desenho toca (sem contar a margem)
  const grupos = new Map();
  for (const col of colunas) if (col.s >= cobre.x0 && col.s <= cobre.x1) for (const q of col.c) if (q.s >= cobre.y0 && q.s <= cobre.y1) grupos.set(q.g, (grupos.get(q.g) || 0) + 1);
  const busca = (arr, s) => { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m].s <= s) lo = m; else hi = m; } return lo; };
  const fazerF = cols => (x, y) => {
    const i = Math.max(0, Math.min(cols.length - 2, busca(cols, x))), A = cols[i], B = cols[i + 1];
    const k = Math.max(0, Math.min(1, (x - A.s) / ((B.s - A.s) || 1)));
    const em = (col) => { const c = col.c, j = Math.max(0, Math.min(c.length - 2, busca(c, y))), a = c[j], b = c[j + 1]; const t = Math.max(0, Math.min(1, (y - a.s) / ((b.s - a.s) || 1))); return { p: soma(a.p, sub(b.p, a.p), t), n: soma(a.n, sub(b.n, a.n), t) }; };
    const a = em(A), b = em(B);
    return { p: soma(a.p, sub(b.p, a.p), k), n: norm(soma(a.n, sub(b.n, a.n), k)) };
  };
  const res = { f: fazerF(colunas), passo: ds, colunas: colunas.length, grupos: [...grupos.keys()] };
  if (grupos.size <= 1) return res;
  // ---- atravessa quina: um mapa por face lisa (o resto continua reto no
  // plano dela, como se a face seguisse) + os planos das quinas (bissetriz)
  res.porGrupo = [];
  const cortes = new Map();                                // "k|j" -> {c, dir}
  const anotarCorte = (a, b, ta) => {
    // a (grupo k) e b (grupo j) vizinhos na grade; ta = direção do caminho na
    // face de a (de a pra b). A quina é onde essa reta cruza o plano de b.
    const ch = a.g + '|' + b.g;
    if (cortes.has(ch)) return;
    const na = FN(S, a.f), nb = FN(S, b.f);
    ta = norm(semComp(ta, na));
    const den = dot(ta, nb);
    const s = Math.abs(den) > 1e-6 ? dot(sub(b.p, a.p), nb) / den : dist(a.p, b.p) / 2;
    const c = soma(a.p, ta, Math.max(0, Math.min(dist(a.p, b.p), s)));
    let dir = norm(sub(na, nb));
    // lado de k: um ponto 1 mm pra trás no caminho (dentro da face de a)
    if (dot(sub(soma(c, ta, -1), c), dir) < 0) dir = [-dir[0], -dir[1], -dir[2]];
    cortes.set(ch, { k: a.g, j: b.g, c, dir });
  };
  for (let i = 0; i < colunas.length; i++) {
    const c = colunas[i].c;
    for (let j = 1; j < c.length; j++) if (c[j].g !== c[j - 1].g) { anotarCorte(c[j - 1], c[j], c[j - 1].t); anotarCorte(c[j], c[j - 1], soma([0, 0, 0], c[j].t, -1)); }
    if (i > 0) { const a = colunas[i - 1].c[busca(colunas[i - 1].c, 0)], b = c[busca(c, 0)]; if (a.g !== b.g) { anotarCorte(a, b, colunas[i - 1].xt); anotarCorte(b, a, soma([0, 0, 0], colunas[i].xt, -1)); } }
  }
  for (const k of grupos.keys()) {
    // grade do grupo k: onde é k, a de verdade; fora, segue reto no plano de
    // k a partir da última amostra de k (a face "continua", desdobrada)
    const temK = colunas.map(col => col.c.some(q => q.g === k));
    const idxK = temK.map((b, i) => b ? i : -1).filter(i => i >= 0);
    if (!idxK.length) continue;
    const cols = colunas.map((col, i) => {
      let c = col.c;
      if (!temK[i]) {
        // coluna que não toca k: a coluna de k mais perto, deslocada reto na linha X
        let r = idxK[0]; for (const j of idxK) if (Math.abs(j - i) < Math.abs(r - i)) r = j;
        const cr = colunas[r].c, desl = soma([0, 0, 0], colunas[r].xt, col.s - colunas[r].s);
        c = cr.map(q => ({ ...q, p: soma(q.p, desl) }));
      }
      // antes do primeiro e depois do último ponto de k: segue reto pela coluna
      const out = c.map(q => ({ ...q }));
      let jA = out.findIndex(q => q.g === k), jB = -1;
      for (let j = out.length - 1; j >= 0; j--) if (out[j].g === k) { jB = j; break; }
      for (let j = jB + 1; j < out.length; j++) {
        const a = out[j - 1], t = j - 2 >= 0 ? norm(sub(a.p, out[j - 2].p)) : norm(a.t);
        out[j] = { ...out[j], p: soma(a.p, t, out[j].s - a.s), n: a.n, g: k };
      }
      for (let j = jA - 1; j >= 0; j--) {
        const a = out[j + 1], t = j + 2 < out.length ? norm(sub(a.p, out[j + 2].p)) : soma([0, 0, 0], norm(a.t), -1);
        out[j] = { ...out[j], p: soma(a.p, t, a.s - out[j].s), n: a.n, g: k };
      }
      return { s: col.s, c: out };
    });
    const planos = [...cortes.values()].filter(x => x.k === k);
    res.porGrupo.push({ grupo: k, f: fazerF(cols), planos });
  }
  return res;
}

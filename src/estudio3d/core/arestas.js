// Bordas de verdade da peça (não aresta de triângulo): onde duas superfícies
// se encontram com dobra. Cada borda vira uma cadeia classificada:
//   'reta'   — segmento entre duas faces planas (caixa, suporte, placa)
//   'circulo'— aro entre uma face plana e uma parede cilíndrica (borda de
//              cilindro, boca de furo, base de pino)
//   'curva'  — o resto (dá pra selecionar e medir; arredondar ainda não)
// Com: pontos, comprimento, normais dos dois lados, se é quina pra fora
// (convexa) ou canto pra dentro (côncava) e as direções das faces (u1, u2).
import { gemeas } from './topologia.js';
import { normaisFace, caixa } from './malha.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

export function detectarArestas(m, opc = {}) {
  const ang = opc.angulo != null ? opc.angulo : 25;
  const cosLim = Math.cos(ang * Math.PI / 180);
  const P = m.pos, I = m.idx, nt = I.length / 3;
  const N = normaisFace(m);
  const gem = gemeas(m);
  const cx = caixa(m), diag = Math.hypot(cx.tam[0], cx.tam[1], cx.tam[2]);
  const vert = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const nf = f => [N[f * 3], N[f * 3 + 1], N[f * 3 + 2]];
  // meias-arestas de dobra: (f, k) com f < gêmea (cada aresta uma vez)
  const dobras = [];
  for (let h = 0; h < nt * 3; h++) {
    const g = gem[h];
    if (g < 0) continue;
    const f = (h / 3) | 0, o = (g / 3) | 0;
    if (f > o) continue;
    if (dot(nf(f), nf(o)) < cosLim) dobras.push(h);
  }
  // cadeias: liga arestas de dobra pelos vértices de grau 2
  const porVert = new Map();
  const ends = h => { const f = (h / 3) | 0, k = h % 3; return [I[f * 3 + k], I[f * 3 + (k + 1) % 3]]; };
  for (let i = 0; i < dobras.length; i++) for (const v of ends(dobras[i])) (porVert.get(v) || porVert.set(v, []).get(v)).push(i);
  const usada = new Uint8Array(dobras.length), cadeias = [];
  const dirDe = i => { const [a, b] = ends(dobras[i]); return unit(sub(vert(b), vert(a))); };
  for (let s = 0; s < dobras.length; s++) {
    if (usada[s]) continue;
    usada[s] = 1;
    const lista = [s];
    const [a0, b0] = ends(dobras[s]);
    const seguir = (v, ultimo, frente) => {
      for (;;) {
        const viz = (porVert.get(v) || []).filter(i => !usada[i]);
        if (viz.length !== 1 || (porVert.get(v) || []).length !== 2) return;   // quina (3+ bordas) ou fim
        const i = viz[0];
        // para em mudança brusca de direção (quina da caixa)
        const d1 = dirDe(ultimo), d2 = dirDe(i);
        if (Math.abs(dot(d1, d2)) < Math.cos(35 * Math.PI / 180)) return;
        usada[i] = 1;
        if (frente) lista.push(i); else lista.unshift(i);
        const [x, y] = ends(dobras[i]);
        v = x === v ? y : x; ultimo = i;
      }
    };
    seguir(b0, s, true);
    seguir(a0, s, false);
    cadeias.push(lista);
  }
  const out = [];
  for (const lista of cadeias) {
    // vértices em ordem
    const vs = [];
    {
      let [a, b] = ends(dobras[lista[0]]);
      if (lista.length > 1) { const [c, d] = ends(dobras[lista[1]]); if (a === c || a === d) [a, b] = [b, a]; }
      vs.push(a, b);
      for (let i = 1; i < lista.length; i++) { const [c, d] = ends(dobras[lista[i]]); vs.push(c === vs[vs.length - 1] ? d : c); }
    }
    const fechada = vs.length > 3 && vs[0] === vs[vs.length - 1];
    const pts = vs.map(vert);
    let comp = 0;
    for (let i = 1; i < pts.length; i++) comp += Math.hypot(...sub(pts[i], pts[i - 1]));
    if (comp < 1e-6) continue;
    // lados: face 1 = a do lado esquerdo da 1ª meia-aresta, face 2 = a gêmea
    const h0 = dobras[lista[0]];
    const f1 = (h0 / 3) | 0, f2 = (gem[h0] / 3) | 0;
    const n1r = nf(f1), n2r = nf(f2);
    // lado de cada face pela continuidade: a face do lado 1 de uma aresta é a
    // que compartilha o lado com a da aresta anterior (normal mais parecida)
    let s1 = [0, 0, 0], s2 = [0, 0, 0], ref1 = n1r, ref2 = n2r;
    const lado1 = [], lado2 = [];
    for (const i of lista) {
      const h = dobras[i], a = (h / 3) | 0, b = (gem[h] / 3) | 0;
      const [x, y] = dot(nf(a), ref1) + dot(nf(b), ref2) >= dot(nf(b), ref1) + dot(nf(a), ref2) ? [a, b] : [b, a];
      s1 = s1.map((v, k) => v + N[x * 3 + k]); s2 = s2.map((v, k) => v + N[y * 3 + k]);
      lado1.push(x); lado2.push(y); ref1 = nf(x); ref2 = nf(y);
    }
    // lado plano = normais iguais (a soma tem o tamanho da contagem)
    const plano1 = Math.hypot(...s1) > 0.995 * lista.length, plano2 = Math.hypot(...s2) > 0.995 * lista.length;
    const n1 = plano1 || !plano2 ? unit(s1) : nf(lado1[0]), n2 = plano2 || !plano1 ? unit(s2) : nf(lado2[0]);
    const ar = { id: out.length, pts, fechada, comprimento: comp, n1, n2, plano1, plano2, faces: [f1, f2], lado1, lado2, meias: lista.map(i => dobras[i]) };
    classificar(ar, m, diag, f1, f2, n1r, n2r);
    out.push(ar);
  }
  return out;
}

// centróide de uma face
function centro(m, f) {
  const P = m.pos, I = m.idx;
  return [0, 1, 2].map(e => (P[I[f * 3] * 3 + e] + P[I[f * 3 + 1] * 3 + e] + P[I[f * 3 + 2] * 3 + e]) / 3);
}

function classificar(ar, m, diag, f1, f2, n1f, n2f) {
  const p = ar.pts, tol = Math.max(1e-4, diag * 2e-4);
  const a = p[0], b = p[p.length - 1];
  // reta: todos os pontos na linha a-b
  const d = sub(b, a), L = Math.hypot(...d);
  if (!ar.fechada && L > 1e-6) {
    const t = d.map(v => v / L);
    let desvio = 0;
    for (const q of p) { const w = sub(q, a), s = dot(w, t); desvio = Math.max(desvio, Math.hypot(w[0] - s * t[0], w[1] - s * t[1], w[2] - s * t[2])); }
    if (desvio < tol && Math.abs(dot(ar.n1, t)) < 0.02 && Math.abs(dot(ar.n2, t)) < 0.02) {
      ar.tipo = 'reta'; ar.a = a; ar.b = b; ar.t = t; ar.comprimento = L;
      // u: direção dentro de cada face, perpendicular à borda, pra longe dela
      let u1 = unit(cruz(t, ar.n1)); if (dot(u1, sub(centro(m, ar.lado1[0]), a)) < 0) u1 = u1.map(v => -v);
      let u2 = unit(cruz(t, ar.n2)); if (dot(u2, sub(centro(m, ar.lado2[0]), a)) < 0) u2 = u2.map(v => -v);
      ar.u1 = u1; ar.u2 = u2;
      ar.convexa = dot(ar.n1, u2) < 0;
      ar.angulo = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))) * 180 / Math.PI;   // ângulo entre as faces
      return;
    }
  }
  // círculo: um lado plano (normal constante) e pontos num círculo desse plano
  if (ar.fechada && p.length >= 8) {
    for (const [np, nw, lp] of [[ar.n1, ar.n2, 1], [ar.n2, ar.n1, 2]]) {
      // o lado plano tem a normal paralela ao eixo; o lado parede tem normal ⟂ eixo
      if (!(lp === 1 ? ar.plano1 : ar.plano2)) continue;
      const eixo = np;
      if (Math.abs(dot(nw, eixo)) > 0.2) continue;
      const c = p.slice(0, -1).reduce((s, q) => s.map((v, k) => v + q[k] / (p.length - 1)), [0, 0, 0]);
      let rm = 0, rM = Infinity, rX = 0, fora = 0;
      for (const q of p) { const w = sub(q, c); const h = dot(w, eixo); fora = Math.max(fora, Math.abs(h)); const r = Math.hypot(w[0] - h * eixo[0], w[1] - h * eixo[1], w[2] - h * eixo[2]); rm += r / p.length; rM = Math.min(rM, r); rX = Math.max(rX, r); }
      if (fora > tol * 5 || rX - rM > Math.max(tol * 5, rm * 0.02)) continue;
      ar.tipo = 'circulo'; ar.centro = c; ar.eixo = eixo; ar.raio = rm; ar.comprimento = 2 * Math.PI * rm;
      ar.ladoPlano = lp;
      // no perfil (ρ radial, z no eixo): a face plana vai pra dentro (topo de pino)
      // ou pra fora (boca de furo); a parede vai pra cima ou pra baixo
      const fP = ar.ladoPlano === 1 ? ar.lado1[0] : ar.lado2[0], fW = ar.ladoPlano === 1 ? ar.lado2[0] : ar.lado1[0];
      const cp = sub(centro(m, fP), c), cw = sub(centro(m, fW), c);
      const rho = q => { const h = dot(q, eixo); return Math.hypot(q[0] - h * eixo[0], q[1] - h * eixo[1], q[2] - h * eixo[2]); };
      ar.planoParaFora = rho(cp) > rm;                 // true: boca de furo / base de pino
      ar.paredeSobe = dot(cw, eixo) > 0;               // parede vai pro lado +eixo
      // normal da parede: pra fora do eixo (pino) ou pra dentro (furo)
      const pw = sub(p[0], c); const hw = dot(pw, eixo); const rad = unit([pw[0] - hw * eixo[0], pw[1] - hw * eixo[1], pw[2] - hw * eixo[2]]);
      ar.paredeOlhaFora = dot(nw, rad) > 0;
      // u no perfil 2D (ρ, z): plano: ±ρ; parede: ±z
      ar.u1p = [ar.planoParaFora ? 1 : -1, 0];
      ar.u2p = [0, ar.paredeSobe ? 1 : -1];
      // quina pra fora? normal do plano aponta pro lado oposto de onde a parede vai
      ar.convexa = (dot(eixo, np) > 0) !== ar.paredeSobe ? true : false;
      ar.angulo = 90;
      return;
    }
  }
  ar.tipo = 'curva';
  ar.convexa = null;
}

// borda mais perto de um ponto (clique): distância ponto-polilinha
export function arestaPerto(arestas, q, maxDist = Infinity) {
  let melhor = null, dm = maxDist;
  for (const ar of arestas) {
    const p = ar.pts;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], d = sub(p[i], a), L2 = dot(d, d);
      let s = L2 > 0 ? dot(sub(q, a), d) / L2 : 0; s = Math.max(0, Math.min(1, s));
      const e = Math.hypot(q[0] - a[0] - s * d[0], q[1] - a[1] - s * d[1], q[2] - a[2] - s * d[2]);
      if (e < dm) { dm = e; melhor = ar; }
    }
  }
  return melhor ? { aresta: melhor, distancia: dm } : null;
}

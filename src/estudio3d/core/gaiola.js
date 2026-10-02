// MALHA EDITÁVEL ("gaiola"), como o modo de edição do Blender: pontos, bordas
// e faces que a gente cria clicando em cima da foto. A peça de verdade é
// GERADA da gaiola: espelho (o outro lado acompanha), suavização
// (Catmull-Clark) e espessura (placa de N mm quando a malha é aberta).
//
//   g = {
//     v: [[x,y,z], ...]          pontos (no espaço do objeto, mm)
//     f: [[i,j,k,...], ...]      faces (polígonos de 3+ pontos)
//     a: [[i,j], ...]            bordas soltas (ainda sem face: a linha que está sendo desenhada)
//     espelho: null | { eixo: 0|1|2, c }   plano do espelho: coordenada 'eixo' = c
//     espessura: mm (vale quando a malha é aberta), suave: 0|1|2,
//     frente: [x,y,z]            de que lado se olha (as faces abertas apontam pra lá)
//   }
// Tudo aqui é imutável: cada operação devolve uma gaiola NOVA (o Desfazer da
// cena guarda a anterior).
import { criar } from './malha.js';
import { triangularPoligono3D } from './triangular.js';

export const TOL_ESPELHO = 1e-6;

const chave = (a, b) => a < b ? a + ',' + b : b + ',' + a;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mult = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norma = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const L = norma(a); return L > 1e-12 ? mult(a, 1 / L) : [0, 0, 0]; };

export function novaGaiola(opc = {}) {
  return { v: [], f: [], a: [], espelho: opc.espelho || null, espessura: opc.espessura != null ? opc.espessura : 3, suave: opc.suave || 0, frente: opc.frente || [0, -1, 0] };
}
const copia = (g, mud) => ({ ...g, ...mud });

/* ---------------- espelho */
export function noEspelho(g, p) { return !!g.espelho && Math.abs(p[g.espelho.eixo] - g.espelho.c) <= TOL_ESPELHO; }
export function refletir(g, p) { if (!g.espelho) return p.slice(); const q = p.slice(); q[g.espelho.eixo] = 2 * g.espelho.c - q[g.espelho.eixo]; return q; }
// lado "de verdade" da gaiola: o lado do 1º ponto fora do espelho (0 = ainda nenhum)
export function ladoDaGaiola(g) {
  if (!g.espelho) return 0;
  const { eixo, c } = g.espelho;
  for (const p of g.v) { const d = p[eixo] - c; if (Math.abs(d) > TOL_ESPELHO) return Math.sign(d); }
  return 0;
}
// ponto clicado do outro lado do espelho -> vira o ponto correspondente do lado de verdade;
// perto da linha do meio (tol, mm) gruda nela
export function paraOLado(g, p, tol = 0, lado = ladoDaGaiola(g)) {
  if (!g.espelho) return p.slice();
  const { eixo, c } = g.espelho;
  const q = p.slice();
  if (Math.abs(q[eixo] - c) <= tol) { q[eixo] = c; return q; }
  if (lado && Math.sign(q[eixo] - c) !== lado) q[eixo] = 2 * c - q[eixo];
  return q;
}

/* ---------------- consultas */
export function bordas(g) {
  const m = new Map();
  for (const f of g.f) for (let i = 0; i < f.length; i++) { const k = chave(f[i], f[(i + 1) % f.length]); m.set(k, (m.get(k) || 0) + 1); }
  for (const [a, b] of g.a) { const k = chave(a, b); if (!m.has(k)) m.set(k, 0); }
  return m;               // "i,j" -> nº de faces que usam a borda (0 = solta)
}
export function listaBordas(g) { return [...bordas(g).keys()].map(k => k.split(',').map(Number)); }
const facesNaBorda = (g, a, b) => bordas(g).get(chave(a, b)) || 0;

/* ---------------- edição (cada uma devolve { g, ... }) */
export function addPonto(g, p, ligarA = -1) {
  const v = g.v.concat([p.slice()]);
  const i = v.length - 1;
  let r = copia(g, { v });
  if (ligarA >= 0) r = ligar(r, ligarA, i).g;
  return { g: r, i };
}

// liga dois pontos; se a borda nova fecha um contorno só de bordas soltas, vira FACE
export function ligar(g, a, b) {
  if (a === b || a < 0 || b < 0) return { g, face: -1 };
  const bs = bordas(g);
  if (bs.has(chave(a, b))) return { g, face: -1 };
  // caminho de a até b só por bordas soltas (BFS) -> fecha um contorno
  const soltas = new Map();
  for (const [x, y] of g.a) { (soltas.get(x) || soltas.set(x, []).get(x)).push(y); (soltas.get(y) || soltas.set(y, []).get(y)).push(x); }
  const ant = new Map([[b, -1]]), fila = [b];
  while (fila.length && !ant.has(a)) { const x = fila.shift(); for (const y of soltas.get(x) || []) if (!ant.has(y)) { ant.set(y, x); fila.push(y); } }
  if (ant.has(a)) {
    const ciclo = []; for (let x = a; x !== -1; x = ant.get(x)) ciclo.push(x);
    if (ciclo.length >= 3) {
      const usadas = new Set(); for (let i = 0; i < ciclo.length; i++) usadas.add(chave(ciclo[i], ciclo[(i + 1) % ciclo.length]));
      const a2 = g.a.filter(([x, y]) => !usadas.has(chave(x, y)));
      return { g: copia(g, { a: a2, f: g.f.concat([ciclo]) }), face: g.f.length };
    }
  }
  return { g: copia(g, { a: g.a.concat([[a, b]]) }), face: -1 };
}

// borda (a,b) "puxada" até o ponto p: nasce uma face de 4 pontos (o jeito de
// modelar face por face em cima da foto). Ponta da borda no espelho fica nele.
export function extrudarBorda(g, a, b, p) {
  if (facesNaBorda(g, a, b) >= 2) return { g, erro: 'Essa borda já tem face dos dois lados. Puxe uma borda da beirada.' };
  const meio = mult(soma(g.v[a], g.v[b]), 0.5), d = sub(p, meio);
  const na = soma(g.v[a], d), nb = soma(g.v[b], d);
  if (g.espelho) { const { eixo, c } = g.espelho; if (noEspelho(g, g.v[a])) na[eixo] = c; if (noEspelho(g, g.v[b])) nb[eixo] = c; }
  const v = g.v.concat([na, nb]);
  const ia = v.length - 2, ib = v.length - 1;
  // sentido: o mesmo da face vizinha (se houver) pra não virar
  let face = [a, b, ib, ia];
  for (const f of g.f) for (let i = 0; i < f.length; i++) if (f[i] === a && f[(i + 1) % f.length] === b) face = [b, a, ia, ib];
  const a2 = g.a.filter(([x, y]) => chave(x, y) !== chave(a, b));
  return { g: copia(g, { v, f: g.f.concat([face]), a: a2 }), borda: [ia, ib] };
}

// face com os pontos escolhidos (na ordem do contorno quando dá, senão em volta do centro)
export function fazerFace(g, pts) {
  const ids = [...new Set(pts)];
  if (ids.length < 3) return { g, erro: 'Escolha pelo menos 3 pontos (ou 2 bordas) pra fazer uma face.' };
  const ordem = ordenarContorno(g, ids);
  for (let i = 0; i < ordem.length; i++) if (facesNaBorda(g, ordem[i], ordem[(i + 1) % ordem.length]) >= 2) return { g, erro: 'Uma das bordas já tem face dos dois lados.' };
  const k = new Set(ordem.map((x, i) => chave(x, ordem[(i + 1) % ordem.length])));
  if (g.f.some(f => f.length === ordem.length && f.every(x => ids.includes(x)))) return { g, erro: 'Essa face já existe.' };
  return { g: copia(g, { f: g.f.concat([ordem]), a: g.a.filter(([x, y]) => !k.has(chave(x, y))) }), face: g.f.length };
}
function ordenarContorno(g, ids) {
  // ciclo pelas bordas que já existem entre os escolhidos
  const s = new Set(ids), viz = new Map(ids.map(i => [i, []]));
  for (const [a, b] of listaBordas(g)) if (s.has(a) && s.has(b)) { viz.get(a).push(b); viz.get(b).push(a); }
  if (ids.every(i => viz.get(i).length === 2)) {
    const c = [ids[0]]; let ant = -1, x = ids[0];
    for (;;) { const y = viz.get(x).find(z => z !== ant); if (y === undefined || y === ids[0]) break; c.push(y); ant = x; x = y; if (c.length > ids.length) break; }
    if (c.length === ids.length) return c;
  }
  // em volta do centro, no plano de melhor ajuste
  const P = ids.map(i => g.v[i]), cen = mult(P.reduce(soma, [0, 0, 0]), 1 / P.length);
  let n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) n = soma(n, cruz(sub(P[i], cen), sub(P[(i + 1) % P.length], cen)));
  if (norma(n) < 1e-12) n = g.frente ? mult(g.frente, -1) : [0, 0, 1];
  n = unit(n);
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = unit(cruz(n, ref)), w = cruz(n, u);
  return ids.map(i => { const d = sub(g.v[i], cen); return { i, ang: Math.atan2(dot(d, w), dot(d, u)) }; }).sort((x, y) => x.ang - y.ang).map(x => x.i);
}

// move pontos; com espelho, quem está no meio fica no meio e ninguém atravessa (como o "Clipping" do Blender)
export function moverPontos(g, ids, d) {
  const s = new Set(ids);
  const v = g.v.map((p, i) => {
    if (!s.has(i)) return p;
    const q = soma(p, d);
    if (g.espelho) {
      const { eixo, c } = g.espelho;
      if (noEspelho(g, p)) q[eixo] = c;
      else if (Math.sign(q[eixo] - c) !== Math.sign(p[eixo] - c)) q[eixo] = c;
    }
    return q;
  });
  return { g: copia(g, { v }) };
}
export function definirPonto(g, i, p) { return moverPontos(g, [i], sub(p, g.v[i])); }

// tira pontos (e as faces/bordas que usam eles)
export function apagarPontos(g, ids) {
  const s = new Set(ids), mapa = new Int32Array(g.v.length).fill(-1);
  const v = [];
  g.v.forEach((p, i) => { if (!s.has(i)) { mapa[i] = v.length; v.push(p); } });
  const f = g.f.filter(ff => ff.every(i => !s.has(i))).map(ff => ff.map(i => mapa[i]));
  const a = g.a.filter(([x, y]) => !s.has(x) && !s.has(y)).map(([x, y]) => [mapa[x], mapa[y]]);
  return { g: copia(g, { v, f, a }) };
}
// tira faces (os pontos ficam; as bordas que sobram viram soltas)
export function apagarFaces(g, faces) {
  const s = new Set(faces);
  const resto = g.f.filter((_, i) => !s.has(i));
  const usadas = new Set(); for (const f of resto) for (let i = 0; i < f.length; i++) usadas.add(chave(f[i], f[(i + 1) % f.length]));
  const a = g.a.slice(), ja = new Set(a.map(([x, y]) => chave(x, y)));
  for (const i of s) { const f = g.f[i]; for (let k = 0; k < f.length; k++) { const c = chave(f[k], f[(k + 1) % f.length]); if (!usadas.has(c) && !ja.has(c)) { a.push([f[k], f[(k + 1) % f.length]]); ja.add(c); } } }
  return { g: copia(g, { f: resto, a }) };
}

// junta os pontos escolhidos num só (no meio deles; no espelho se algum estiver nele)
export function juntarPontos(g, ids) {
  const lista = [...new Set(ids)];
  if (lista.length < 2) return { g, erro: 'Escolha 2 ou mais pontos pra juntar.' };
  const P = lista.map(i => g.v[i]);
  const m = mult(P.reduce(soma, [0, 0, 0]), 1 / P.length);
  if (g.espelho && P.some(p => noEspelho(g, p))) m[g.espelho.eixo] = g.espelho.c;
  const alvo = lista[0], s = new Set(lista.slice(1));
  const troca = i => s.has(i) ? alvo : i;
  let f = g.f.map(ff => { const r = []; for (const i of ff.map(troca)) if (r[r.length - 1] !== i) r.push(i); if (r.length > 1 && r[0] === r[r.length - 1]) r.pop(); return r; }).filter(ff => ff.length >= 3);
  const vistas = new Set(); f = f.filter(ff => { const k = ff.slice().sort((x, y) => x - y).join(','); if (vistas.has(k)) return false; vistas.add(k); return true; });
  const a = g.a.map(([x, y]) => [troca(x), troca(y)]).filter(([x, y]) => x !== y);
  const v = g.v.slice(); v[alvo] = m;
  return apagarPontos(copia(g, { v, f, a }), [...s]);
}

// ponto novo no meio de uma borda (entra nas faces vizinhas)
export function dividirBorda(g, a, b) {
  const p = mult(soma(g.v[a], g.v[b]), 0.5);
  const v = g.v.concat([p]), n = v.length - 1;
  const f = g.f.map(ff => {
    for (let i = 0; i < ff.length; i++) {
      const x = ff[i], y = ff[(i + 1) % ff.length];
      if ((x === a && y === b) || (x === b && y === a)) return ff.slice(0, i + 1).concat([n], ff.slice(i + 1));
    }
    return ff;
  });
  const aa = [];
  for (const [x, y] of g.a) { if (chave(x, y) === chave(a, b)) aa.push([x, n], [n, y]); else aa.push([x, y]); }
  return { g: copia(g, { v, f, a: aa }), i: n };
}

// face puxada pra fora (dá volume): a face vai junto, as laterais nascem.
// Se a face está na BEIRADA da malha (uma placa), a base fica no lugar e sai
// um bloco FECHADO (o que quem nunca modelou espera; o Blender deixaria o fundo
// aberto). opc.para: pra que lado puxar (ex.: de frente pra quem olha).
export function extrudarFaces(g, faces, dist, opc = {}) {
  const lista = [...new Set(faces)].filter(i => g.f[i]);
  if (!lista.length) return { g, erro: 'Escolha uma face.' };
  let n = [0, 0, 0];
  for (const i of lista) n = soma(n, normalFace(g.v, g.f[i]));
  n = unit(n);
  if (norma(n) < 1e-9) return { g, erro: 'Não sei pra que lado puxar essa face.' };
  if (opc.para && dot(n, opc.para) < 0) n = mult(n, -1);
  const d = mult(n, dist);
  const pts = new Set(lista.flatMap(i => g.f[i]));
  const v = g.v.slice(), novo = new Map();
  for (const i of pts) { const q = soma(g.v[i], d); if (g.espelho && noEspelho(g, g.v[i])) q[g.espelho.eixo] = g.espelho.c; novo.set(i, v.length); v.push(q); }
  const cont = new Map();
  for (const i of lista) { const f = g.f[i]; for (let k = 0; k < f.length; k++) { const c = chave(f[k], f[(k + 1) % f.length]); cont.set(c, (cont.get(c) || 0) + 1); } }
  const usoTotal = bordas(g);
  const noMeio = (a, b) => g.espelho && noEspelho(g, g.v[a]) && noEspelho(g, g.v[b]);
  // a região está solta na beirada? (toda borda de fora dela é beirada da malha ou o meio do espelho)
  let solta = true;
  for (const i of lista) { const ff = g.f[i]; for (let k = 0; k < ff.length; k++) { const a = ff[k], b = ff[(k + 1) % ff.length]; if (cont.get(chave(a, b)) === 1 && !noMeio(a, b) && usoTotal.get(chave(a, b)) !== 1) solta = false; } }
  const sel = new Set(lista), f = [];
  g.f.forEach((ff, i) => { if (!sel.has(i)) f.push(ff); else { if (solta) f.push(ff.slice().reverse()); f.push(ff.map(x => novo.get(x))); } });
  for (const i of lista) {
    const ff = g.f[i];
    for (let k = 0; k < ff.length; k++) {
      const a = ff[k], b = ff[(k + 1) % ff.length];
      if (cont.get(chave(a, b)) !== 1) continue;
      if (noMeio(a, b)) continue;            // lateral em cima do espelho é interna (o outro lado cobre)
      f.push([a, b, novo.get(b), novo.get(a)]);
    }
  }
  // as faces puxadas (pra continuar escolhidas): índices novos
  const novas = [];
  let k = 0;
  g.f.forEach((ff, i) => { if (!sel.has(i)) k++; else { if (solta) k++; novas.push(k); k++; } });
  return { g: copia(g, { v, f }), faces: novas, fechou: solta };
}

export function normalFace(V, f) {
  let n = [0, 0, 0];
  for (let i = 0; i < f.length; i++) { const p = V[f[i]], q = V[f[(i + 1) % f.length]]; n = [n[0] + (p[1] - q[1]) * (p[2] + q[2]), n[1] + (p[2] - q[2]) * (p[0] + q[0]), n[2] + (p[0] - q[0]) * (p[1] + q[1])]; }
  return unit(n);
}

/* ---------------- começos prontos (com espelho, só a metade de verdade) */
// u, v = eixos do plano da foto (ex.: frente: X e Z); n = eixo da profundidade
export function comecoQuadrado(g, centro, tam, u, v) {
  const h = tam / 2;
  const P = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => soma(centro, soma(mult(u, a), mult(v, b))));
  return comecoDePontos(g, P, [[0, 1, 2, 3]]);
}
export function comecoCubo(g, centro, tam, u, v) {
  const h = tam / 2, w = cruz(u, v);
  const P = [];
  for (const c of [-h, h]) for (const [a, b] of [[-h, -h], [h, -h], [h, h], [-h, h]]) P.push(soma(centro, soma(soma(mult(u, a), mult(v, b)), mult(w, c))));
  const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return comecoDePontos(g, P, F);
}
// com espelho: corta no meio, fica o lado direito (o esquerdo é o espelho)
function comecoDePontos(g, P, F) {
  const base = g.v.length;
  if (!g.espelho) return { g: copia(g, { v: g.v.concat(P), f: g.f.concat(F.map(f => f.map(i => i + base))) }) };
  const { eixo, c } = g.espelho;
  const lado = ladoDaGaiola(g) || 1;
  // pontos do lado de lá vão pra linha do meio; faces que ficarem achatadas no meio saem
  const Q = P.map(p => { const q = p.slice(); if (Math.sign(q[eixo] - c) !== lado) q[eixo] = c; return q; });
  // pontos repetidos (dois que caíram no mesmo lugar do meio) viram um só
  const mapa = [], v = g.v.slice();
  Q.forEach((q, i) => { const j = Q.findIndex((r, k) => k < i && norma(sub(r, q)) < 1e-9); mapa[i] = j >= 0 ? mapa[j] : (v.push(q), v.length - 1); });
  const f = g.f.slice();
  for (const ff of F) {
    const r = []; for (const i of ff.map(x => mapa[x])) if (r[r.length - 1] !== i) r.push(i);
    if (r.length > 1 && r[0] === r[r.length - 1]) r.pop();
    if (r.length < 3) continue;
    if (r.every(i => Math.abs(v[i][eixo] - c) <= TOL_ESPELHO)) continue;
    f.push(r);
  }
  return { g: copia(g, { v, f }) };
}

/* ---------------- a peça gerada */
// polígonos com o espelho aplicado
function comEspelho(g) {
  const V = g.v.map(p => p.slice());
  let F = g.f.filter(f => new Set(f).size >= 3).map(f => f.slice());
  if (!g.espelho) return { V, F };
  const { eixo, c } = g.espelho, n0 = V.length, mapa = new Int32Array(n0);
  const no = i => Math.abs(V[i][eixo] - c) <= TOL_ESPELHO;
  for (let i = 0; i < n0; i++) {
    if (no(i)) { V[i][eixo] = c; mapa[i] = i; }
    else { const q = V[i].slice(); q[eixo] = 2 * c - q[eixo]; mapa[i] = V.length; V.push(q); }
  }
  F = F.filter(f => !f.every(no));               // face deitada no espelho seria parede interna
  const M = F.map(f => f.map(i => mapa[i]).reverse());
  return { V, F: F.concat(M) };
}

// mesmo sentido em todas as faces que se tocam; fechada -> normais pra fora;
// aberta -> virada pra quem olha (g.frente)
function orientar(V, F, frente) {
  const dono = new Map();
  F.forEach((f, fi) => { for (let i = 0; i < f.length; i++) { const k = chave(f[i], f[(i + 1) % f.length]); (dono.get(k) || dono.set(k, []).get(k)).push(fi); } });
  const mesmoSentido = (f, g2, a, b) => {
    for (let i = 0; i < f.length; i++) if (f[i] === a && f[(i + 1) % f.length] === b) {
      for (let j = 0; j < g2.length; j++) if (g2[j] === a && g2[(j + 1) % g2.length] === b) return true;
    }
    return false;
  };
  const feito = new Int8Array(F.length), comp = new Int32Array(F.length).fill(-1);
  let nc = 0;
  for (let s = 0; s < F.length; s++) {
    if (feito[s]) continue;
    feito[s] = 1; comp[s] = nc;
    const fila = [s];
    while (fila.length) {
      const fi = fila.pop(), f = F[fi];
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length], viz = dono.get(chave(a, b));
        if (viz.length !== 2) continue;
        const gj = viz[0] === fi ? viz[1] : viz[0];
        if (feito[gj]) continue;
        if (mesmoSentido(f, F[gj], a, b)) F[gj] = F[gj].slice().reverse();
        feito[gj] = 1; comp[gj] = nc; fila.push(gj);
      }
    }
    nc++;
  }
  // por componente: fechada -> volume positivo; aberta -> pra frente
  for (let c = 0; c < nc; c++) {
    const faces = [];
    for (let i = 0; i < F.length; i++) if (comp[i] === c) faces.push(i);
    let aberta = false;
    for (const fi of faces) { const f = F[fi]; for (let i = 0; i < f.length; i++) if (dono.get(chave(f[i], f[(i + 1) % f.length])).length === 1) aberta = true; }
    let virar;
    if (!aberta) {
      let vol = 0;
      for (const fi of faces) { const f = F[fi]; for (let i = 1; i + 1 < f.length; i++) vol += dot(V[f[0]], cruz(V[f[i]], V[f[i + 1]])); }
      virar = vol < 0;
    } else {
      let n = [0, 0, 0];
      for (const fi of faces) { const f = F[fi]; for (let i = 0; i < f.length; i++) { const p = V[f[i]], q = V[f[(i + 1) % f.length]]; n = [n[0] + (p[1] - q[1]) * (p[2] + q[2]), n[1] + (p[2] - q[2]) * (p[0] + q[0]), n[2] + (p[0] - q[0]) * (p[1] + q[1])]; } }
      virar = dot(n, frente || [0, 0, 1]) < 0;
    }
    if (virar) for (const fi of faces) F[fi] = F[fi].slice().reverse();
  }
  return F;
}

// Catmull-Clark (aceita n-ágonos e borda aberta): cada face vira quadriláteros
export function catmullClark(V, F) {
  const nv = V.length;
  const fp = F.map(f => mult(f.reduce((s, i) => soma(s, V[i]), [0, 0, 0]), 1 / f.length));
  const ar = new Map();           // borda -> { a, b, faces: [] , id }
  F.forEach((f, fi) => { for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length], k = chave(a, b); let e = ar.get(k); if (!e) { e = { a, b, faces: [] }; ar.set(k, e); } e.faces.push(fi); } });
  const NV = V.map(p => p.slice());
  let id = nv;
  const ep = new Map();
  for (const [k, e] of ar) {
    const m = mult(soma(V[e.a], V[e.b]), 0.5);
    const p = e.faces.length === 2 ? mult(soma(soma(V[e.a], V[e.b]), soma(fp[e.faces[0]], fp[e.faces[1]])), 0.25) : m;
    e.mid = m; e.id = id++; NV.push(p); ep.set(k, e.id);
  }
  // pontos originais
  const facesDe = Array.from({ length: nv }, () => []), bordasDe = Array.from({ length: nv }, () => []);
  F.forEach((f, fi) => f.forEach(i => facesDe[i].push(fi)));
  for (const e of ar.values()) { bordasDe[e.a].push(e); bordasDe[e.b].push(e); }
  for (let i = 0; i < nv; i++) {
    const es = bordasDe[i]; if (!es.length || !facesDe[i].length) continue;
    const abertas = es.filter(e => e.faces.length === 1);
    if (abertas.length === 2) {
      const o1 = abertas[0].a === i ? abertas[0].b : abertas[0].a, o2 = abertas[1].a === i ? abertas[1].b : abertas[1].a;
      NV[i] = mult(soma(soma(V[o1], V[o2]), mult(V[i], 6)), 1 / 8);
    } else if (abertas.length === 0 && es.every(e => e.faces.length === 2)) {
      const n = facesDe[i].length;
      const Fm = mult(facesDe[i].reduce((s, fi) => soma(s, fp[fi]), [0, 0, 0]), 1 / n);
      const R = mult(es.reduce((s, e) => soma(s, e.mid), [0, 0, 0]), 1 / es.length);
      NV[i] = mult(soma(soma(Fm, mult(R, 2)), mult(V[i], n - 3)), 1 / n);
    }
    // canto ou não-manifold: fica onde está
  }
  const fid = F.map(() => id++);
  F.forEach((f, fi) => NV.push(fp[fi]));
  const NF = [];
  F.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], prev = f[(i - 1 + f.length) % f.length], next = f[(i + 1) % f.length];
      NF.push([a, ep.get(chave(a, next)), fid[fi], ep.get(chave(prev, a))]);
    }
  });
  return { V: NV, F: NF };
}

function triangular(V, F) {
  const T = [];
  for (const f of F) {
    if (f.length === 3) { T.push(f[0], f[1], f[2]); continue; }
    if (f.length === 4) {
      // diagonal mais curta (quadrilátero torto dobra menos)
      const d02 = norma(sub(V[f[0]], V[f[2]])), d13 = norma(sub(V[f[1]], V[f[3]]));
      if (d02 <= d13) T.push(f[0], f[1], f[2], f[0], f[2], f[3]); else T.push(f[1], f[2], f[3], f[1], f[3], f[0]);
      continue;
    }
    const pts = f.flatMap(i => V[i]);
    const loc = triangularPoligono3D(pts);
    for (const k of loc) T.push(f[k]);
  }
  return T;
}

// placa: a superfície aberta ganha espessura (metade pra cada lado) e a beirada é fechada
function solidificar(V, T, esp) {
  const nv = V.length, N = V.map(() => [0, 0, 0]);
  for (let t = 0; t < T.length; t += 3) {
    const a = V[T[t]], b = V[T[t + 1]], c = V[T[t + 2]];
    const n = cruz(sub(b, a), sub(c, a));        // área já pesa
    for (let k = 0; k < 3; k++) N[T[t + k]] = soma(N[T[t + k]], n);
  }
  const h = esp / 2;
  const P = [];
  for (let i = 0; i < nv; i++) P.push(soma(V[i], mult(unit(N[i]), h)));
  for (let i = 0; i < nv; i++) P.push(soma(V[i], mult(unit(N[i]), -h)));
  const idx = [];
  for (let t = 0; t < T.length; t += 3) { idx.push(T[t], T[t + 1], T[t + 2]); idx.push(T[t] + nv, T[t + 2] + nv, T[t + 1] + nv); }
  const uso = new Map();
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k], b = T[t + (k + 1) % 3], kk = chave(a, b); const e = uso.get(kk); if (e) e.n++; else uso.set(kk, { a, b, n: 1 }); }
  for (const e of uso.values()) if (e.n === 1) { const { a, b } = e; idx.push(a, a + nv, b + nv, a, b + nv, b); }
  return { P, idx };
}

// a peça: { malha, info: { pontos, faces, aberta, bordasAbertas, naoManifold } } (malha null sem face)
export function gerarMalha(g) {
  let { V, F } = comEspelho(g);
  // pontos que nenhuma face usa não entram
  const usa = new Int32Array(V.length).fill(-1), V2 = [];
  for (const f of F) for (const i of f) if (usa[i] < 0) { usa[i] = V2.length; V2.push(V[i]); }
  V = V2; F = F.map(f => f.map(i => usa[i]));
  if (!F.length) return { malha: null, info: { pontos: g.v.length, faces: 0, aberta: true, bordasAbertas: 0, naoManifold: 0 } };
  F = orientar(V, F, g.frente);
  for (let k = 0; k < (g.suave | 0); k++) ({ V, F } = catmullClark(V, F));
  const uso = new Map();
  for (const f of F) for (let i = 0; i < f.length; i++) { const k = chave(f[i], f[(i + 1) % f.length]); uso.set(k, (uso.get(k) || 0) + 1); }
  let abertas = 0, naoMan = 0;
  for (const n of uso.values()) { if (n === 1) abertas++; else if (n > 2) naoMan++; }
  const T = triangular(V, F);
  let pos, idx;
  if (abertas && g.espessura > 0) { const s = solidificar(V, T, g.espessura); pos = s.P.flat(); idx = s.idx; }
  else { pos = V.flat(); idx = T; }
  return { malha: criar(pos, idx), info: { pontos: g.v.length, faces: g.f.length, aberta: abertas > 0 && !(g.espessura > 0), bordasAbertas: abertas, naoManifold: naoMan } };
}

// o espelho vira pontos de verdade: os dois lados ficam editáveis cada um por si
export function aplicarEspelho(g) {
  if (!g.espelho) return { g };
  const { eixo, c } = g.espelho, n0 = g.v.length;
  const v = g.v.map(p => p.slice()), mapa = new Int32Array(n0);
  for (let i = 0; i < n0; i++) {
    if (Math.abs(v[i][eixo] - c) <= TOL_ESPELHO) { v[i][eixo] = c; mapa[i] = i; }
    else { const q = v[i].slice(); q[eixo] = 2 * c - q[eixo]; mapa[i] = v.length; v.push(q); }
  }
  const no = i => Math.abs(v[i][eixo] - c) <= TOL_ESPELHO;
  const fs = g.f.filter(f => !f.every(no));
  const f = fs.concat(fs.map(ff => ff.map(i => mapa[i]).reverse()));
  const a = g.a.concat(g.a.filter(([x, y]) => !(no(x) && no(y))).map(([x, y]) => [mapa[x], mapa[y]]));
  return { g: { ...g, v, f, a, espelho: null } };
}

// a peça foi esticada/encolhida (a escala vai pra malha): a gaiola acompanha.
// M: matriz 4×4 (coluna-maior) sem translação. Escala que não é no eixo do
// espelho entorta o plano: aí o espelho vira pontos de verdade antes.
export function transformarGaiola(g, M) {
  let h = g;
  if (h.espelho) {
    const k = h.espelho.eixo;
    const fora = [0, 1, 2].some(j => j !== k && (Math.abs(M[k * 4 + j]) > 1e-9 || Math.abs(M[j * 4 + k]) > 1e-9));
    if (fora) h = aplicarEspelho(h).g;
  }
  const t = p => [0, 1, 2].map(i => M[i] * p[0] + M[4 + i] * p[1] + M[8 + i] * p[2] + M[12 + i]);
  const v = h.v.map(t);
  let espelho = h.espelho;
  if (espelho) { const q = [0, 0, 0]; q[espelho.eixo] = espelho.c; espelho = { eixo: espelho.eixo, c: t(q)[espelho.eixo] }; }
  // espelhar (escala negativa) troca o sentido das faces: a geração reorienta sozinha
  return { ...h, v, espelho };
}

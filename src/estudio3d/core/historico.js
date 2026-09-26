// Operações de modelagem guardadas pra refazer: "Caixa -> Arredondar 3 mm ->
// Casca 2 mm -> Furo". Bordas e faces são guardadas pela POSIÇÃO RELATIVA na
// caixa da peça (0..1 em cada eixo) e direção: quando a medida da caixa muda,
// a mesma borda é achada de novo e a operação é refeita.
// Peça aberta de arquivo usa o mesmo caminho (só não tem a forma-base).
import { detectarArestas } from './arestas.js';
import { arredondar } from './arredondar.js';
import { puxarFace, casca, espelhar, facePlana } from './modificar.js';
import { caixa, centroidesFace, normaisFace } from './malha.js';

const rel = (cx, p) => [0, 1, 2].map(i => cx.tam[i] > 1e-9 ? (p[i] - cx.min[i]) / cx.tam[i] : 0.5);
const abs = (cx, r) => [0, 1, 2].map(i => cx.min[i] + r[i] * cx.tam[i]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function descritorAresta(m, ar) {
  const cx = caixa(m);
  if (ar.tipo === 'reta') return { tipo: 'reta', m: rel(cx, ar.a.map((v, i) => (v + ar.b[i]) / 2)), t: ar.t };
  if (ar.tipo === 'circulo') return { tipo: 'circulo', c: rel(cx, ar.centro), eixo: ar.eixo, r: ar.raio / Math.max(...cx.tam) };
  return { tipo: 'curva', m: rel(cx, ar.pts[0]) };
}

export function acharAresta(m, arestas, d) {
  const cx = caixa(m);
  let melhor = null, dm = Infinity;
  for (const ar of arestas) {
    if (ar.tipo !== d.tipo) continue;
    let e;
    if (d.tipo === 'reta') {
      if (Math.abs(ar.t[0] * d.t[0] + ar.t[1] * d.t[1] + ar.t[2] * d.t[2]) < 0.99) continue;
      e = dist(abs(cx, d.m), ar.a.map((v, i) => (v + ar.b[i]) / 2));
    } else if (d.tipo === 'circulo') {
      if (Math.abs(ar.eixo[0] * d.eixo[0] + ar.eixo[1] * d.eixo[1] + ar.eixo[2] * d.eixo[2]) < 0.99) continue;
      e = dist(abs(cx, d.c), ar.centro) + Math.abs(ar.raio - d.r * Math.max(...cx.tam));
    } else continue;
    if (e < dm) { dm = e; melhor = ar; }
  }
  return melhor;
}

export function descritorFace(m, f) {
  const g = facePlana(m, f), C = centroidesFace(m);
  let c = [0, 0, 0];
  for (const x of g.faces) c = c.map((v, i) => v + C[x * 3 + i] / g.faces.length);
  return { n: g.n, c: rel(caixa(m), c) };
}

export function acharFace(m, d) {
  const cx = caixa(m), N = normaisFace(m), C = centroidesFace(m), alvo = abs(cx, d.c);
  let melhor = -1, dm = Infinity;
  for (let f = 0; f < N.length / 3; f++) {
    if (N[f * 3] * d.n[0] + N[f * 3 + 1] * d.n[1] + N[f * 3 + 2] * d.n[2] < 0.999) continue;
    const e = dist(alvo, [C[f * 3], C[f * 3 + 1], C[f * 3 + 2]]);
    if (e < dm) { dm = e; melhor = f; }
  }
  return melhor;
}

// op: { tipo: 'arredondar'|'chanfrar'|'puxar'|'casca'|'espelhar', valor, bordas:[desc], face:desc, abrir:[desc], eixo, pos:'min'|'centro'|'max'|número, unir }
export function aplicarOperacao(parte, op) {
  const m = parte.malha;
  if (op.tipo === 'arredondar' || op.tipo === 'chanfrar') {
    const arestas = detectarArestas(m);
    const ids = [];
    for (const d of op.bordas || []) { const a = acharAresta(m, arestas, d); if (!a) throw new Error('Não achei mais uma das bordas escolhidas.'); if (!ids.includes(a.id)) ids.push(a.id); }
    return arredondar(parte, ids, { tipo: op.tipo === 'chanfrar' ? 'chanfro' : 'raio', valor: op.valor, arestas }).parte;
  }
  if (op.tipo === 'puxar') {
    const f = acharFace(m, op.face);
    if (f < 0) throw new Error('Não achei mais a face escolhida.');
    return puxarFace(parte, f, op.valor).parte;
  }
  if (op.tipo === 'casca') {
    const abrir = (op.abrir || []).map(d => acharFace(m, d)).filter(f => f >= 0);
    return casca(parte, op.valor, { abrir }).parte;
  }
  if (op.tipo === 'espelhar') {
    const cx = caixa(m);
    const pos = op.pos === 'min' ? cx.min[op.eixo] : op.pos === 'max' ? cx.max[op.eixo] : op.pos === 'centro' ? (cx.min[op.eixo] + cx.max[op.eixo]) / 2 : +op.pos;
    return espelhar(parte, op.eixo, pos, { unir: !!op.unir }).parte;
  }
  throw new Error('Operação desconhecida: ' + op.tipo);
}

// refaz a pilha inteira a partir da forma-base; a primeira que falhar para
// (as seguintes dependem dela) e diz qual foi
export function reaplicar(base, operacoes) {
  let parte = base;
  const status = [];
  for (let i = 0; i < operacoes.length; i++) {
    try { parte = { ...aplicarOperacao(parte, operacoes[i]), nome: base.nome }; status.push({ ok: true }); }
    catch (e) { status.push({ ok: false, erro: e.message }); for (let j = i + 1; j < operacoes.length; j++) status.push({ ok: false, erro: 'depende da operação ' + (i + 1) }); break; }
  }
  return { parte, status };
}

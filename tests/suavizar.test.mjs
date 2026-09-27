// SUAVIZAR com qualidade medida contra a VERDADE (forma conhecida + ruído
// conhecido): tira o ruído sem encolher, quina fica viva, caroço some na
// escala em mm (não depende da densidade da malha), seleção mexe só nela
// com transição suave, facetas viram superfície lisa, parede fina não se
// cruza, cor por triângulo e 3MF sobrevivem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { suavizarMalha, analisarSuavizar } from '../src/estudio3d/core/suavizar.js';
import { definirProgresso } from '../src/estudio3d/core/progresso.js';
import { validar, autoInterseccoes } from '../src/estudio3d/core/validador.js';
import { caixa, criar, volume } from '../src/estudio3d/core/malha.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { gerarBoneco } from './util/boneco.mjs';
import { construirBVH, pontoMaisPerto } from '../src/estudio3d/core/bvh.js';

await carregarManifold();
const mk = f => comContexto(ctx => ctx.parte(ctx.guardar(f(manifold().Manifold)), 'x', '#999999').malha);

// ruído determinístico pela normal (sigma em mm) e caroços (raio R, altura a)
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function normaisV(m) {
  const P = m.pos, I = m.idx, N = new Float64Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c]) for (let e = 0; e < 3; e++) N[v + e] += n[e];
  }
  for (let i = 0; i < N.length; i += 3) { const L = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= L; N[i + 1] /= L; N[i + 2] /= L; }
  return N;
}
function sujar(m, { fino = 0, R = 0, a = 0, seed = 5 }) {
  const r = rng(seed), P = Float64Array.from(m.pos), N = normaisV(m), nv = P.length / 3, d = new Float64Array(nv);
  const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
  if (fino) for (let v = 0; v < nv; v++) d[v] = g() * fino;
  if (R) {
    const cx = caixa(m), area = 4 * Math.PI * (Math.max(...cx.tam) / 2) ** 2, nb = Math.ceil(area / (Math.PI * R * R) * 1.5);
    for (let b = 0; b < nb; b++) {
      const c = Math.floor(r() * nv), s = (r() * 2 - 1) * a;
      for (let v = 0; v < nv; v++) { const dd = (P[v * 3] - P[c * 3]) ** 2 + (P[v * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[v * 3 + 2] - P[c * 3 + 2]) ** 2; if (dd < 9 * R * R && N[v * 3] * N[c * 3] + N[v * 3 + 1] * N[c * 3 + 1] + N[v * 3 + 2] * N[c * 3 + 2] > 0.3) d[v] += s * Math.exp(-dd / (2 * R * R)); }
    }
  }
  for (let v = 0; v < nv; v++) for (let e = 0; e < 3; e++) P[v * 3 + e] += N[v * 3 + e] * d[v];
  return criar(P, m.idx, m.cor || null);
}
// distância média dos vértices até a superfície de verdade
function erro(m, verdade) {
  const bvh = construirBVH(verdade), P = m.pos; let s = 0;
  for (let v = 0; v < P.length / 3; v++) s += pontoMaisPerto(bvh, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).d;
  return s / (P.length / 3);
}
const esferaErroFaces = (m, R) => { const P = m.pos, I = m.idx; let s = 0; for (let t = 0; t < I.length; t += 3) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { x += P[I[t + k] * 3]; y += P[I[t + k] * 3 + 1]; z += P[I[t + k] * 3 + 2]; } s += Math.abs(Math.hypot(x / 3, y / 3, z / 3) - R); } return s / (I.length / 3); };
const esferaErro = (m, R) => { const P = m.pos; let s = 0; for (let v = 0; v < P.length / 3; v++) s += Math.abs(Math.hypot(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) - R); return s / (P.length / 3); };
function fechadaSemCruzar(m, rot) {
  const v = validar(m, { completo: true });
  assert.ok(v.fechada && !v.autoInterseccoes && v.componentesInvertidos === 0 && v.volume > 0, rot + ' ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, inv: v.componentesInvertidos }));
  return v;
}

test('SUAVIZAR: esfera com ruído fino -> volta pra perto da esfera, sem encolher, malha válida e mesma topologia', () => {
  const R = 25, verdade = mk(M => M.sphere(R, 128)), suja = sujar(verdade, { fino: 0.12 });
  const e0 = esferaErro(suja, R);
  const r = suavizarMalha(suja, { intensidade: 0.55 });
  const e1 = esferaErro(r.malha, R);
  assert.ok(e1 < e0 * 0.35, 'erro caiu de ' + e0.toFixed(3) + ' pra ' + e1.toFixed(3));
  assert.ok(Math.abs(volume(r.malha) / volume(verdade) - 1) < 0.004, 'volume ' + r.info.volume);
  assert.equal(r.malha.idx.length, suja.idx.length);
  fechadaSemCruzar(r.malha, 'esfera');
});

test('SUAVIZAR: cubo com ruído -> quina continua viva (preservar), volume e medida mantidos; sem preservar arredonda', () => {
  const verdade = mk(M => M.cube([30, 30, 30], true).refineToLength(0.4)), suja = sujar(verdade, { fino: 0.06 });
  const e0 = erro(suja, verdade);
  const r = suavizarMalha(suja, { intensidade: 0.55 });
  const e1 = erro(r.malha, verdade);
  assert.ok(e1 < e0 * 0.4, 'erro ' + e0.toFixed(3) + ' -> ' + e1.toFixed(3));
  caixa(r.malha).tam.forEach(t => assert.ok(Math.abs(t - 30) < 0.25, 'medida ' + t));
  assert.ok(Math.abs(r.info.volume) < 0.5, 'volume ' + r.info.volume);
  // canto do cubo: ainda tem vértice perto do canto de verdade
  const P = r.malha.pos; let canto = Infinity;
  for (let v = 0; v < P.length / 3; v++) canto = Math.min(canto, Math.hypot(P[v * 3] - 15, P[v * 3 + 1] - 15, P[v * 3 + 2] - 15));
  assert.ok(canto < 0.5, 'canto vivo a ' + canto.toFixed(2) + ' mm');
  fechadaSemCruzar(r.malha, 'cubo');
  // sem preservar e forte: o canto arredonda
  const s = suavizarMalha(verdade, { intensidade: 1, preservar: false });
  let canto2 = Infinity; const Q = s.malha.pos;
  for (let v = 0; v < Q.length / 3; v++) canto2 = Math.min(canto2, Math.hypot(Q[v * 3] - 15, Q[v * 3 + 1] - 15, Q[v * 3 + 2] - 15));
  assert.ok(canto2 > 0.25 && canto2 > canto * 3, 'sem preservar arredonda o canto (' + canto2.toFixed(2) + ' mm, com preservar ' + canto.toFixed(2) + ')');
});

test('SUAVIZAR: ondulação de IA ("casca de laranja", onda de 6 mm) some no Forte, não no Leve; a escala é em mm (igual em malha 1,5x mais densa)', () => {
  const R = 30, k = 2 * Math.PI / 6, a = 0.25;
  for (const seg of [256, 384]) {
    const verdade = mk(M => M.sphere(R, seg)), N = normaisV(verdade), P = Float64Array.from(verdade.pos);
    for (let v = 0; v < P.length / 3; v++) { const d = a * Math.sin(k * P[v * 3]) * Math.sin(k * P[v * 3 + 1]) * Math.sin(k * P[v * 3 + 2]); for (let e = 0; e < 3; e++) P[v * 3 + e] += N[v * 3 + e] * d; }
    const suja = criar(P, verdade.idx);
    const e0 = esferaErro(suja, R);
    const leve = esferaErro(suavizarMalha(suja, { intensidade: 0.2 }).malha, R);
    const forte = suavizarMalha(suja, { intensidade: 0.85 });
    const e2 = esferaErro(forte.malha, R);
    assert.ok(leve > e0 * 0.7, seg + ': leve não apaga a ondulação (' + leve.toFixed(3) + ' de ' + e0.toFixed(3) + ')');
    assert.ok(e2 < e0 * 0.5, seg + ': forte tira a ondulação (' + e0.toFixed(3) + ' -> ' + e2.toFixed(3) + ')');
    assert.ok(Math.abs(forte.info.volume) < 0.5, 'volume ' + forte.info.volume);
  }
});

test('SUAVIZAR SÓ A SELEÇÃO: fora da seleção (e da transição) nada se mexe; dentro alisa; sem degrau na borda', () => {
  const R = 25, verdade = mk(M => M.sphere(R, 128)), suja = sujar(verdade, { fino: 0.12 });
  const I = suja.idx, P = suja.pos, nt = I.length / 3, mask = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) if (P[I[t * 3] * 3 + 2] > 15) mask[t] = 1;          // calota de cima
  const r = suavizarMalha(suja, { intensidade: 0.55, mascara: mask });
  assert.ok(r.info.local && r.info.regiao < nt, 'só a região entra na conta');
  const Q = r.malha.pos; let foraMexeu = 0, dentro = 0, dentroN = 0;
  for (let v = 0; v < P.length / 3; v++) {
    const z = P[v * 3 + 2], d = Math.hypot(Q[v * 3] - P[v * 3], Q[v * 3 + 1] - P[v * 3 + 1], Q[v * 3 + 2] - P[v * 3 + 2]);
    if (z < 8) foraMexeu = Math.max(foraMexeu, d);
    if (z > 18) { dentro += Math.abs(Math.hypot(Q[v * 3], Q[v * 3 + 1], Q[v * 3 + 2]) - R); dentroN++; }
  }
  assert.equal(foraMexeu, 0, 'longe da seleção não mexe');
  assert.ok(dentro / dentroN < 0.05, 'dentro ficou liso: ' + (dentro / dentroN).toFixed(3));
  fechadaSemCruzar(r.malha, 'local');
});

test('SUAVIZAR facetada: ícone de poucos triângulos vira superfície lisa (divide), quina de 90° fica viva, cor por triângulo sobrevive', () => {
  const baixa = mk(M => M.sphere(20, 12));
  assert.ok(analisarSuavizar(baixa).facetada, 'detecta facetada');
  const r = executar('suavizar', { parte: { nome: 's', malha: baixa, cor: '#888888' }, opc: { intensidade: 0.3, facetas: true } });
  assert.ok(r.info.facetas.depois > 20 * r.info.facetas.antes, 'dividiu ' + JSON.stringify(r.info.facetas));
  const e0 = esferaErroFaces(baixa, 20), e1 = esferaErroFaces(r.parte.malha, 20);
  assert.ok(e1 < e0 * 0.2, 'faceta sumiu (distância dos centros das faces à esfera): ' + e0.toFixed(3) + ' -> ' + e1.toFixed(3));
  fechadaSemCruzar(r.parte.malha, 'facetas');
  // caixa pintada (topo vermelho): quina viva e pintura continuam
  const cx = mk(M => M.cube([20, 20, 20], true)); const cor = new Uint16Array(cx.idx.length / 3);
  for (let t = 0; t < cor.length; t++) { let z = 0; for (let k = 0; k < 3; k++) z += cx.pos[cx.idx[t * 3 + k] * 3 + 2]; if (z > 29) cor[t] = 1; }
  const pint = { nome: 'c', malha: criar(cx.pos, cx.idx, cor), cor: '#888888', paleta: ['#888888', '#D1242F'] };
  const r2 = executar('suavizar', { parte: pint, opc: { intensidade: 0.3, facetas: true } });
  caixa(r2.parte.malha).tam.forEach(t => assert.ok(Math.abs(t - 20) < 0.05, 'cubo continua cubo ' + t));
  assert.ok(r2.parte.paleta && r2.parte.paleta.includes('#D1242F') && r2.parte.malha.cor, 'pintura sobreviveu');
});

test('SUAVIZAR parede fina (0,6 mm) com ruído no Forte: não cria cruzamento (onde cruzaria, fica como estava)', () => {
  const verdade = mk(M => M.cube([30, 30, 0.6], true).refineToLength(0.5)), suja = sujar(verdade, { fino: 0.08, R: 1.5, a: 0.3 });
  const a0 = autoInterseccoes(suja, { max: 5000 }).pares;
  const r = suavizarMalha(suja, { intensidade: 0.9 });
  const a1 = autoInterseccoes(r.malha, { max: 5000 }).pares;
  assert.ok(a1 <= a0, 'cruzamentos ' + a0 + ' -> ' + a1);
});

test('SUAVIZAR: avisa o progresso (etapa e %), até 100%', () => {
  const lista = [];
  definirProgresso((f, etapa) => lista.push([f, etapa]));
  try { suavizarMalha(sujar(mk(M => M.sphere(20, 96)), { fino: 0.1, R: 2, a: 0.3 }), { intensidade: 0.85 }); } finally { definirProgresso(null); }
  assert.ok(lista.length >= 2, 'avisou ' + lista.length);
  assert.equal(lista[lista.length - 1][0], 1);
  assert.ok(lista.some(x => /grão/.test(x[1])), 'etapa grão');
});

test('SUAVIZAR boneco de IA (pele ondulada, 120 mil triângulos): ondas somem (mais perto do limpo), volume igual, nenhum cruzamento novo, 3MF ida e volta igual', () => {
  const limpo = gerarBoneco('limpo').malha, ia = gerarBoneco('ia').malha;
  const e0 = erro(ia, limpo);
  const r = suavizarMalha(ia, { intensidade: 0.55 });
  const e1 = erro(r.malha, limpo);
  assert.ok(e1 < e0 * 0.85, 'erro ' + e0.toFixed(4) + ' -> ' + e1.toFixed(4));
  assert.ok(Math.abs(r.info.volume) < 0.2, 'volume ' + r.info.volume);
  const v = validar(r.malha, { completo: true });
  assert.ok(v.fechada && v.componentesInvertidos === 0, 'fechada');
  assert.ok(autoInterseccoes(r.malha, { max: 5000 }).pares <= autoInterseccoes(ia, { max: 5000 }).pares, 'não cria cruzamento');
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'b', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: [{ nome: 'b', malha: r.malha, cor: '#999999' }] }] }, opc: {} });
  const m2 = executar('importar', { nome: 'b.3mf', bytes: x.bytes, extras: {} }).objetos[0].partes[0].malha;
  assert.ok(Math.abs(volume(m2) - volume(r.malha)) < 1e-3 * volume(r.malha), '3MF manteve');
});

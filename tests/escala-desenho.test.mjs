// AUDITORIA v7: medida em mm de verdade depois de Escalar (a escala vai pra
// malha, a matriz fica só com girar/espelhar/mover), desenho que se cruza,
// tubo que se cruza, CURVA SUAVE, e deformar numa peça girada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import * as M4 from '../src/estudio3d/core/mat4.js';
import { Cena, novoObjeto } from '../src/estudio3d/ui/cena.js';
import { caixa } from '../src/estudio3d/core/malha.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { criarDoDesenho, curvaSuave } from '../src/estudio3d/core/desenho.js';
import { deformar } from '../src/estudio3d/core/deformar.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { reaplicar } from '../src/estudio3d/core/historico.js';

await carregarManifold();
const mk = f => comContexto(ctx => ctx.parte(ctx.guardar(f(manifold().Manifold)), 'x', '#999999').malha);
const limpo = (m, rot) => { const v = validar(m, { completo: true }); assert.ok(v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.componentesInvertidos === 0, rot + ' ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas, inv: v.componentesInvertidos })); return v; };
const caixaMundo = (m, T) => { const p = []; for (let i = 0; i < m.pos.length; i += 3) p.push(...M4.aplicarPonto(T, m.pos[i], m.pos[i + 1], m.pos[i + 2])); return caixa({ pos: Float64Array.from(p), idx: m.idx }); };

test('ESCALA: separarEsticar reconstrói a matriz (girada, escalada, espelhada, cisalhada pela escala no mundo)', () => {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 200; k++) {
    let T = M4.compor([rnd() * 100, rnd() * 100, rnd() * 10], [rnd() * 360, rnd() * 360, rnd() * 360], [0.2 + rnd() * 3, 0.2 + rnd() * 3, 0.2 + rnd() * 3]);
    if (k % 3 === 0) T = M4.multiplicar(M4.escala(0.5 + rnd(), 1, 2 * rnd() + 0.3), T);   // escala no eixo do mundo depois de girar
    if (k % 5 === 0) T = M4.multiplicar(M4.escala(-1, 1, 1), T);
    const r = M4.separarEsticar(T);
    const P = M4.multiplicar(r.rigida, r.esticar);
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(P[i] - T[i]) < 1e-9 * (1 + Math.abs(T[i])), 'reconstrução ' + k);
    assert.equal(M4.separarEsticar(r.rigida), null, 'parte rígida é rígida');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(r.esticar[j * 4 + i] - r.esticar[i * 4 + j]) < 1e-9, 'esticar simétrica');
    assert.ok(M4.determinante(r.esticar) > 0);
  }
  assert.equal(M4.separarEsticar(M4.compor([5, 6, 7], [10, 20, 30], [1, 1, 1])), null);
  assert.equal(M4.separarEsticar(M4.escala(-1, 1, 1)), null, 'espelho continua na matriz');
});

test('ESCALA: Escalar 50% leva a escala pra malha — peça no mundo igual, medida em mm vale (pino Ø5 sai Ø5); desfazer volta', () => {
  const c = new Cena();
  const m = mk(M => M.cube([40, 20, 60]));
  c.aplicar('add', () => { c.objetos.push(novoObjeto({ nome: 'b', partes: [{ nome: 'b', malha: m, cor: '#999999' }], transform: M4.compor([10, 0, 0], [0, 0, 30], [1, 1, 1]) })); });
  const o = c.objetos[0], antes = caixaMundo(o.partes[0].malha, o.transform);
  c.aplicar('Tamanho', () => { o.transform = M4.multiplicar(o.transform, M4.escala(0.5, 0.5, 0.5)); });
  assert.equal(M4.separarEsticar(o.transform), null, 'matriz ficou rígida');
  const cl = caixa(o.partes[0].malha);
  assert.ok(Math.abs(cl.tam[0] - 20) < 1e-9 && Math.abs(cl.tam[2] - 30) < 1e-9, 'malha na medida: ' + cl.tam);
  const depois = caixaMundo(o.partes[0].malha, o.transform);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(depois.tam[i] - antes.tam[i] / 2) < 1e-9, 'mundo = metade');
  assert.ok(o.esticado && Math.abs(o.esticado[0] - 0.5) < 1e-12, 'painel sabe que é 50%');
  // corte com pino na peça escalada: o furo tem Ø5 + 2×folga NO MUNDO
  const r = executar('cortar', { partes: o.partes.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor })), plano: { n: [0, 0, 1], d: 15 }, opc: { conector: { tipo: 'cilindrico', diametro: 5, folga: 0.25, profundidade: 6, quantidade: 1 } } });
  const aFuro = 20 * 10 - comContexto(ctx => ctx.guardar(ctx.guardar(ctx.solido({ malha: r.B[0].malha, cor: '#000' })).slice(12)).area());
  const dFuro = Math.sqrt(4 * aFuro / Math.PI);
  assert.ok(Math.abs(dFuro - 5.5) < 0.05, 'furo Ø' + dFuro.toFixed(3) + ' (esperado 5,50)');
  c.desfazer();
  assert.ok(Math.abs(caixa(c.objetos[0].partes[0].malha).tam[0] - 40) < 1e-9, 'desfazer volta a malha');
});

test('ESCALA: forma paramétrica escalada guarda "Tamanho" na lista e refaz igual; escala e volta some da lista', () => {
  const c = new Cena();
  const m = mk(M => M.cube([30, 20, 10]));
  c.aplicar('add', () => { c.objetos.push(novoObjeto({ nome: 'c', forma: { id: 'caixa', params: {} }, partes: [{ nome: 'c', malha: m, cor: '#999999' }] })); });
  const o = c.objetos[0];
  c.aplicar('Tamanho', () => { o.transform = M4.multiplicar(o.transform, M4.escala(2, 1, 1)); });
  assert.equal(o.operacoes.length, 1); assert.equal(o.operacoes[0].tipo, 'esticar');
  const refeita = reaplicar({ nome: 'c', malha: m, cor: '#999999' }, o.operacoes);
  assert.ok(Math.abs(caixa(refeita.parte.malha).tam[0] - 60) < 1e-9, 'refeita com a escala');
  c.aplicar('Tamanho', () => { o.transform = M4.multiplicar(o.transform, M4.escala(0.5, 1, 1)); });
  assert.equal(o.operacoes, undefined, 'voltou ao tamanho: sem operação');
  assert.equal(o.esticado, undefined);
});

test('DESENHO: oito e estrela que se cruzam viram peça; tubo que se cruza sai inteiro e limpo; anel', () => {
  const oito = criarDoDesenho([[0, 0], [20, 20], [20, 0], [0, 20]], 'extrudar', { espessura: 2 });
  assert.ok(Math.abs(oito.volume - 400) < 1e-6);
  const est = []; for (let i = 0; i < 5; i++) est.push([20 * Math.cos(i * 4 * Math.PI / 5), 20 * Math.sin(i * 4 * Math.PI / 5)]);
  const estrela = criarDoDesenho(est, 'extrudar', { espessura: 2 });
  // estrela cheia (com o miolo): 10 triângulos centro–ponta–dentro
  const rIn = 20 * Math.cos(2 * Math.PI / 5) / Math.cos(Math.PI / 5);
  limpo(estrela.malha, 'estrela'); assert.ok(Math.abs(estrela.volume / 2 - 10 * 0.5 * 20 * rIn * Math.sin(Math.PI / 5)) < 0.5, 'estrela cheia: ' + estrela.volume);
  const t = criarDoDesenho([[0, 0], [20, 20], [20, 0], [0, 20]], 'tubo', { diametro: 3 });
  assert.equal(limpo(t.malha, 'tubo cruzado').componentes, 1);
  const anel = criarDoDesenho([[0, 0], [20, 0], [20, 20], [0, 20]], 'tubo', { diametro: 2, fechado: true });
  assert.equal(limpo(anel.malha, 'anel').componentes, 1);
  assert.equal(validar(anel.malha, {}).genus ?? 1, 1);
});

test('CURVA SUAVE: passa pelos pontos, círculo de 8 pontos ~ círculo, canto fica pontudo, tubo curvo e vaso limpos', () => {
  const circ = [...Array(8)].map((_, i) => [10 * Math.cos(i * Math.PI / 4), 10 * Math.sin(i * Math.PI / 4)]);
  const c = curvaSuave(circ, { fechado: true, passo: 0.3 });
  for (const p of circ) assert.ok(c.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9), 'passa pelo ponto');
  for (const q of c) assert.ok(Math.abs(Math.hypot(q[0], q[1]) - 10) < 0.05, 'fica no círculo: ' + Math.hypot(q[0], q[1]));
  const disco = criarDoDesenho(circ, 'extrudar', { espessura: 1, suave: true });
  assert.ok(Math.abs(disco.volume - Math.PI * 100) < 0.01 * Math.PI * 100, 'área do círculo ' + disco.volume);
  const gota = curvaSuave([[0, 0], [10, 10], [0, 25], [-10, 10]], { fechado: true, cantos: [0] });
  // no canto as duas tangentes são diferentes (ponta)
  const i0 = gota.findIndex(q => Math.hypot(q[0], q[1]) < 1e-9), a = gota[(i0 + 1) % gota.length], b = gota[(i0 - 1 + gota.length) % gota.length];
  const ang = Math.acos((a[0] * b[0] + a[1] * b[1]) / Math.hypot(...a) / Math.hypot(...b)) * 180 / Math.PI;
  assert.ok(ang < 170, 'ponta no canto: ' + ang.toFixed(1) + '°');
  const t0 = Date.now();
  const onda = criarDoDesenho([[0, 0], [20, 15], [40, -15], [60, 15], [80, 0]], 'tubo', { diametro: 4, suave: true });
  assert.equal(limpo(onda.malha, 'onda').componentes, 1);
  assert.ok(Date.now() - t0 < 3000, 'tubo curvo rápido');
  const laco = criarDoDesenho([[0, 0], [20, 0], [20, 10], [5, -5], [0, 10]], 'tubo', { diametro: 4, suave: true });
  assert.equal(limpo(laco.malha, 'laço que se cruza').componentes, 1);
  const vaso = criarDoDesenho([[0, 0], [15, 0], [12, 10], [18, 25], [10, 40], [0, 40]], 'revolucionar', { suave: true, pontosDeCanto: [0, 1, 4, 5] });
  limpo(vaso.malha, 'vaso');
  assert.ok(Math.abs(caixa(vaso.malha).tam[2] - 40) < 1e-6);
});

test('DEFORMAR em peça de cabeça pra baixo (sentido -1): afunilar afina o TOPO do mundo', () => {
  const m = mk(M => M.cube([20, 20, 40]));
  const r = deformar({ nome: 'p', malha: m, cor: '#999999' }, { tipo: 'afunilar', valor: 0.5, eixo: 2, sentido: -1 });
  limpo(r.parte.malha, 'afunilada');
  const P = r.parte.malha.pos; let wBaixo = 0, wCima = 0;
  for (let i = 0; i < P.length; i += 3) { if (P[i + 2] < 1e-6) wBaixo = Math.max(wBaixo, Math.abs(P[i] - 10)); if (P[i + 2] > 40 - 1e-6) wCima = Math.max(wCima, Math.abs(P[i] - 10)); }
  assert.ok(Math.abs(wBaixo - 5) < 1e-6 && Math.abs(wCima - 10) < 1e-6, 'z=0 (topo no mundo) afinou: ' + wBaixo + ' / ' + wCima);
  const d = deformar({ nome: 'p', malha: m, cor: '#999999' }, { tipo: 'dobrar', valor: 60, eixo: 2, sentido: -1 });
  limpo(d.parte.malha, 'dobrada de cabeça pra baixo');
});

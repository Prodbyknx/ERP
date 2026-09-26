// MODELAGEM ORGÂNICA: esculpir com pincel (e simetria ao vivo), torcer,
// afunilar, dobrar, inflar, suavizar de verdade, desenhar -> peça (espessura,
// giro, tubo) e o fluxo completo de uma MÁSCARA: forma base, simetria,
// deformar, olhos e boca, casca, borda lisa, corte, 3MF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { criarSessao, tocar, concluir } from '../src/estudio3d/core/esculpir.js';
import { deformar, suavizar } from '../src/estudio3d/core/deformar.js';
import { criarDoDesenho } from '../src/estudio3d/core/desenho.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa } from '../src/estudio3d/core/malha.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';

await carregarManifold();
const mk = f => comContexto(ctx => ctx.parte(ctx.guardar(f(manifold().Manifold)), 'x', '#999999').malha);
function ok(m, rot) {
  const v = validar(m, { completo: true });
  assert.ok(v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.componentesInvertidos === 0 && v.volume > 0, rot + ' ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas, inv: v.componentesInvertidos }));
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'p', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: [{ nome: 'p', malha: m, cor: '#999999' }] }] }, opc: {} });
  const m2 = executar('importar', { nome: 'p.3mf', bytes: x.bytes, extras: {} }).objetos[0].partes[0].malha;
  assert.ok(Math.abs(validar(m2, {}).volume - v.volume) < 1e-3 * v.volume, rot + ': 3MF mudou');
  return v;
}

test('ESCULPIR: puxar sobe a região e a simetria X faz o mesmo do outro lado; traço exagerado que cruza a peça é desfeito', () => {
  const m = mk(M => M.sphere(20, 96));
  const s = criarSessao(m, { raio: 6 });
  for (let i = 0; i < 12; i++) tocar(s, [12, 0, 16], { tipo: 'puxar', raio: 6, forca: 0.8, simetria: 'x' });
  const r = concluir(s);
  assert.ok(r.mudou, r.erro);
  const v = ok(r.malha, 'esculpido');
  assert.ok(v.volume > validar(m, {}).volume, 'puxar aumenta volume');
  const c = caixa(r.malha);
  assert.ok(Math.abs(c.max[0] + c.min[0]) < 0.05, 'simétrico em X: ' + c.min[0].toFixed(3) + ' / ' + c.max[0].toFixed(3));
  for (const tipo of ['empurrar', 'inflar', 'achatar', 'suavizar']) {
    const s2 = criarSessao(m, { raio: 8 });
    for (let i = 0; i < 6; i++) tocar(s2, [0, -20, 0], { tipo, raio: 8, forca: 0.6 });
    const r2 = concluir(s2);
    assert.ok(r2.mudou || tipo === 'suavizar', tipo + ': ' + r2.erro);
    ok(r2.malha, tipo);
  }
  // placa fina: empurrar demais atravessa -> desfaz
  const p = mk(M => M.cube([40, 40, 1.2]).refineToLength(1));
  const s3 = criarSessao(p, { raio: 6 });
  for (let i = 0; i < 80; i++) tocar(s3, [20, 20, 1.2], { tipo: 'empurrar', raio: 6, forca: 1 });
  const r3 = concluir(s3);
  assert.equal(r3.mudou, false); assert.match(r3.erro, /Desfiz o traço/);
});

test('DEFORMAR: torcer 90°, afunilar 0,5, dobrar 60° e inflar 1 mm saem sólidos válidos; torção absurda recusada', () => {
  const barra = { nome: 'b', malha: mk(M => M.cube([10, 10, 60], true).translate([0, 0, 30])) };
  const t = deformar(barra, { tipo: 'torcer', valor: 90, eixo: 2 });
  ok(t.parte.malha, 'torcer'); assert.ok(Math.abs(t.volume - 6000) < 60, 'torcer mantém volume ' + t.volume);
  const a = deformar(barra, { tipo: 'afunilar', valor: 0.5, eixo: 2 });
  ok(a.parte.malha, 'afunilar'); assert.ok(Math.abs(caixa(a.parte.malha).tam[2] - 60) < 1e-6);
  const d = deformar(barra, { tipo: 'dobrar', valor: 60, eixo: 2 });
  ok(d.parte.malha, 'dobrar');
  const i = deformar({ nome: 'e', malha: mk(M => M.sphere(10, 64)) }, { tipo: 'inflar', valor: 1 });
  ok(i.parte.malha, 'inflar'); assert.ok(Math.abs(caixa(i.parte.malha).tam[0] - 22) < 0.1);
  assert.throws(() => deformar({ nome: 'p', malha: mk(M => M.cube([40, 2, 20]).translate([-20, -1, 0])) }, { tipo: 'torcer', valor: 7200, eixo: 1 }), /menor/);
});

test('SUAVIZAR de verdade: cubo refinado vira forma arredondada, medida mantida, malha válida', () => {
  const c = { nome: 'c', malha: mk(M => M.cube([20, 20, 20]).refineToLength(1.5)) };
  const r = suavizar(c, { passos: 20 });
  const v = ok(r.parte.malha, 'suave');
  caixa(r.parte.malha).tam.forEach(t => assert.ok(Math.abs(t - 20) < 1e-6));
  assert.ok(v.volume < 8000 * 0.99, 'cantos ficaram arredondados');
});

test('DESENHAR: contorno com espessura (cantos arredondados), perfil girado (vaso) e tubo por caminho', () => {
  const r = criarDoDesenho([[0, 0], [40, 0], [40, 20], [0, 20]], 'extrudar', { espessura: 3, cantos: 4 });
  const v = ok(r.malha, 'placa');
  caixa(r.malha).tam.forEach((t, i) => assert.ok(Math.abs(t - [40, 20, 3][i]) < 1e-6, 'medida placa'));
  assert.ok(Math.abs(v.volume - (800 - (4 - Math.PI) * 16) * 3) < 4, 'volume cantos r4 ' + v.volume);
  const vaso = criarDoDesenho([[0, 0], [15, 0], [15, 2], [8, 10], [12, 30], [10, 30], [6, 10], [0, 2]], 'revolucionar', { graus: 360 });
  ok(vaso.malha, 'vaso'); assert.ok(Math.abs(caixa(vaso.malha).tam[2] - 30) < 1e-6 && Math.abs(caixa(vaso.malha).tam[0] - 30) < 0.1);
  const tubo = criarDoDesenho([[0, 0], [20, 0], [20, 20], [40, 30]], 'tubo', { diametro: 4 });
  ok(tubo.malha, 'tubo'); assert.ok(Math.abs(caixa(tubo.malha).tam[2] - 4) < 0.05);
  assert.throws(() => criarDoDesenho([[0, 0], [10, 0], [20, 0]], 'extrudar', { espessura: 2 }), /área/);
});

test('MÁSCARA do zero: forma base -> simetria -> deformar -> olhos e boca -> oca 2 mm aberta atrás -> borda lisa -> corte com encaixe -> 3MF', async () => {
  const { puxarFace, casca } = await import('../src/estudio3d/core/modificar.js');
  const { cortarPorPlano } = await import('../src/estudio3d/core/corte.js');
  const { combinar } = await import('../src/estudio3d/core/modelagem.js');
  // 1) forma base: elipsoide achatado (rosto) 140 × 90 × 70, frente pra −Y
  let rosto = { nome: 'Máscara', malha: mk(M => M.sphere(1, 96).scale([70, 35, 90]).translate([0, 0, 90])), cor: '#999999' };
  // 2) esculpe com simetria X: maçãs do rosto pra fora, testa achatada
  let s = criarSessao(rosto.malha, { raio: 18 });
  for (let i = 0; i < 10; i++) tocar(s, [28, -30, 80], { tipo: 'puxar', raio: 18, forca: 0.7, simetria: 'x' });
  for (let i = 0; i < 8; i++) tocar(s, [0, -25, 150], { tipo: 'achatar', raio: 25, forca: 0.6 });
  let r = concluir(s); assert.ok(r.mudou, r.erro);
  rosto = { ...rosto, malha: r.malha };
  // 3) afunila pro queixo
  rosto = deformar(rosto, { tipo: 'afunilar', valor: 1.25, eixo: 2 }).parte;
  // 4) só a metade da frente (máscara) — corta no meio da profundidade
  const c = cortarPorPlano([rosto], { n: [0, 1, 0], d: 0 }, {});
  let frente = c.B[0];
  // 5) oca com parede 2 mm, aberta na face de trás (a do corte)
  const { centroidesFace } = await import('../src/estudio3d/core/malha.js');
  const C = centroidesFace(frente.malha); let fTras = -1;
  for (let t = 0; t < C.length / 3; t++) if (C[t * 3 + 1] > -0.001) { fTras = t; break; }
  frente = { ...frente, ...casca(frente, 2, { abrir: [fTras] }).parte };
  ok(frente.malha, 'casca da máscara');
  // 6) olhos e boca: furos elípticos (simétricos) que atravessam
  const furos = ['olhoE', 'olhoD', 'boca'].map((n, i) => ({ nome: n, papel: 'furo', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    partes: [{ nome: n, malha: mk(M => i < 2 ? M.cylinder(80, 1, 1, 64).scale([13, 7, 1]).rotate([90, 0, 0]).translate([(i ? 1 : -1) * 27, 10, 110]) : M.cylinder(80, 1, 1, 64).scale([22, 6, 1]).rotate([90, 0, 0]).translate([0, 10, 55])), cor: '#ff0000' }] }));
  const res = combinar([{ nome: 'Máscara', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: [frente] }, ...furos], 'subtrair', { base: 0 });
  let mascara = { nome: 'Máscara', malha: res.partes[0].malha, cor: '#999999' };
  const vm = ok(mascara.malha, 'olhos e boca');
  assert.equal(vm.componentes, 1);
  // 7) corte em 2 com pino (impressora pequena): cima e baixo
  const cc = cortarPorPlano([mascara], { n: [0, 0, 1], d: 90 }, { conector: { tipo: 'cilindrico', auto: true, folga: 0.2, quantidade: 2 } });
  for (const p of [...cc.A, ...cc.B]) ok(p.malha, 'metade');
  // parede de 2 mm não comporta pino: sai sem encaixe e diz por quê
  assert.equal(cc.relatorio.length, 0);
  assert.ok(cc.avisos.some(a => /não cabe pino.*cole/.test(a)), cc.avisos.join(' | '));
  void puxarFace;
});

test('ESCULPIR com DETALHE AUTOMÁTICO: caixa de 12 triângulos ganha detalhe só debaixo do pincel; cor herdada; simetria', () => {
  const m = mk(M => M.cube([30, 30, 30], true));
  const cor = new Uint16Array(m.idx.length / 3).fill(1);
  const s = criarSessao({ ...m, cor }, { raio: 6 });
  for (let i = 0; i < 15; i++) tocar(s, [3 + i * 0.3, 0, 15], { tipo: 'puxar', raio: 6, forca: 0.7, detalhe: 1, simetria: 'x' });
  const r = concluir(s);
  assert.ok(r.mudou, r.erro);
  const v = ok(r.malha, 'caixa esculpida');
  assert.ok(r.novosTriangulos > 500 && r.malha.idx.length / 3 < 8000, 'detalhe local: ' + r.malha.idx.length / 3 + ' triângulos');
  const c = caixa(r.malha);
  assert.ok(c.max[2] > 17, 'puxou: ' + c.max[2]);
  assert.ok(Math.abs(c.max[0] - 15) < 1e-9 && Math.abs(c.min[2] + 15) < 1e-9, 'resto da caixa igual');
  assert.ok(v.volume > 27000);
  assert.ok(r.malha.cor && r.malha.cor.length === r.malha.idx.length / 3 && r.malha.cor.every(x => x === 1), 'cor herdada nas faces novas');
  // simetria X: os dois lados sobem igual (a triangulação pode ser diferente)
  const P = r.malha.pos; let e = 0, d = 0;
  for (let i = 0; i < P.length; i += 3) { if (P[i] > 1) d = Math.max(d, P[i + 2]); else if (P[i] < -1) e = Math.max(e, P[i + 2]); }
  assert.ok(e > 16.5 && Math.abs(d - e) < 0.35, 'altura dos lados ' + e.toFixed(2) + ' / ' + d.toFixed(2));
});

test('VINCAR: arrastar o pincel faz um sulco estreito (fundo no meio, raso a meio raio), malha fechada e sem se cruzar', () => {
  const m = mk(M => M.sphere(20, 128));
  const s = criarSessao(m, { raio: 5 });
  // traço na frente da esfera, na horizontal (x de -8 a 8, em y = -20)
  for (let k = 0; k < 3; k++) for (let x = -8; x <= 8; x += 0.5) {
    const c = [x, -Math.sqrt(400 - x * x), 0];
    tocar(s, c, { tipo: 'vincar', raio: 5, forca: 0.7, detalhe: 0.4 });
  }
  const r = concluir(s);
  assert.ok(r.mudou, r.erro);
  ok(r.malha, 'vincada');
  // profundidade (quanto entrou em relação à esfera) no meio do traço x ~ 0
  const P = r.malha.pos; let meio = 0, lado = 0;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (Math.abs(x) > 2 || y > -10) continue;
    const prof = 20 - Math.hypot(x, y, z);
    if (Math.abs(z) < 0.4) meio = Math.max(meio, prof);
    if (Math.abs(Math.abs(z) - 2.5) < 0.4) lado = Math.max(lado, prof);
  }
  assert.ok(meio > 0.8, 'sulco fundo: ' + meio.toFixed(2));
  assert.ok(lado < meio * 0.45, 'sulco estreito: meio ' + meio.toFixed(2) + ' / meio raio ' + lado.toFixed(2));
});

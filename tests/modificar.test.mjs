// MODELAGEM ESSENCIAL com geometria real: arredondar, chanfrar, puxar/empurrar
// face, casca (fechada e aberta), espelhar + unir. Cada ferramenta: medida
// exata, malha válida (fechada, sem cruzamento, sem face degenerada), limite
// impossível recusado com o máximo, e o 3MF volta igual.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { detectarArestas } from '../src/estudio3d/core/arestas.js';
import { arredondar } from '../src/estudio3d/core/arredondar.js';
import { puxarFace, casca, espelhar } from '../src/estudio3d/core/modificar.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, centroidesFace } from '../src/estudio3d/core/malha.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';

await carregarManifold();
const mk = f => comContexto(ctx => ctx.parte(ctx.guardar(f(manifold().Manifold)), 'x', '#999999').malha);
const face = (m, f) => { const C = centroidesFace(m); for (let t = 0; t < C.length / 3; t++) if (f([C[t * 3], C[t * 3 + 1], C[t * 3 + 2]])) return t; return -1; };
function ok(m, rot) {
  const v = validar(m, { completo: true });
  assert.ok(v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.componentesInvertidos === 0 && v.volume > 0, rot + ' ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas }));
  // exporta e reimporta: mesma medida e volume
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'p', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: [{ nome: 'p', malha: m, cor: '#999999' }] }] }, opc: {} });
  const m2 = executar('importar', { nome: 'p.3mf', bytes: x.bytes, extras: {} }).objetos[0].partes[0].malha;
  assert.ok(Math.abs(validar(m2, {}).volume - v.volume) < 1e-3 * v.volume, rot + ': 3MF mudou o volume');
  caixa(m2).tam.forEach((t, i) => assert.ok(Math.abs(t - caixa(m).tam[i]) < 1e-3, rot + ': 3MF mudou a medida'));
  return v;
}
const quase = (a, b, tol, rot) => assert.ok(Math.abs(a - b) <= tol, rot + ': ' + a + ' ≠ ' + b);

test('ARREDONDAR bordas retas: caixa 30×20×10, raio 3 nas 4 verticais = volume da fórmula, medidas mantidas', () => {
  const m = mk(M => M.cube([30, 20, 10]));
  const a = detectarArestas(m);
  assert.equal(a.filter(x => x.tipo === 'reta' && x.convexa).length, 12);
  const r = arredondar({ nome: 'c', malha: m }, a.filter(x => Math.abs(x.t[2]) > 0.9).map(x => x.id), { valor: 3, arestas: a });
  const v = ok(r.parte.malha, 'fillet');
  quase(6000 - v.volume, 4 * 10 * 9 * (1 - Math.PI / 4), 0.6, 'volume tirado');
  caixa(r.parte.malha).tam.forEach((t, i) => quase(t, [30, 20, 10][i], 1e-6, 'medida'));
});

test('ARREDONDAR todas as 12 bordas (cantos se cruzam) e placa 100×50×3: limite certo e raio impossível recusado', () => {
  const m = mk(M => M.cube([30, 20, 10]));
  const r = arredondar({ nome: 'c', malha: m }, detectarArestas(m).map(x => x.id), { valor: 3 });
  ok(r.parte.malha, '12 bordas');
  const p = mk(M => M.cube([100, 50, 3]));
  const ap = detectarArestas(p), longas = ap.filter(x => Math.abs(x.t[2]) < 0.1).map(x => x.id);
  assert.throws(() => arredondar({ nome: 'p', malha: p }, longas, { valor: 1.6, arestas: ap }), e => /máximo aqui é 1,49 mm/.test(e.message) && Math.abs(e.limite - 1.4925) < 0.01);
  const r2 = arredondar({ nome: 'p', malha: p }, longas, { valor: 1.4, arestas: ap });
  ok(r2.parte.malha, 'placa');
  caixa(r2.parte.malha).tam.forEach((t, i) => quase(t, [100, 50, 3][i], 1e-6, 'placa medida'));
});

test('CHANFRO 1,5 mm no topo da caixa e na boca do furo (escareado) = volume da fórmula', () => {
  const m = mk(M => M.cube([30, 20, 10]));
  const a = detectarArestas(m);
  const r = arredondar({ nome: 'c', malha: m }, a.filter(x => Math.min(x.a[2], x.b[2]) > 9.9).map(x => x.id), { tipo: 'chanfro', valor: 1.5, arestas: a });
  const v = ok(r.parte.malha, 'chanfro');
  // 4 prismas triangulares menos os 4 cantos em pirâmide (sobreposição)
  quase(6000 - v.volume, 1.125 * 100 - 4 * 1.5 ** 3 / 3, 0.05, 'volume chanfro');
  const pf = mk(M => M.cube([40, 30, 4]).subtract(M.cylinder(10, 3, 3, 64).translate([20, 15, -2])));
  const af = detectarArestas(pf), boca = af.filter(x => x.tipo === 'circulo' && x.centro[2] > 3.9);
  assert.equal(boca.length, 1);
  const r2 = arredondar({ nome: 'p', malha: pf }, boca.map(x => x.id), { tipo: 'chanfro', valor: 1, arestas: af });
  const v2 = ok(r2.parte.malha, 'escareado');
  quase(validar(pf, {}).volume - v2.volume, 0.5 * 2 * Math.PI * (3 + 1 / 3), 0.15, 'escareado volume');
});

test('ARREDONDAR aro de cilindro, canto de dentro do L (côncavo: põe material) e base de pino', () => {
  const c = mk(M => M.cylinder(10, 6, 6, 96));
  const ac = detectarArestas(c);
  assert.equal(ac.filter(x => x.tipo === 'circulo').length, 2);
  const rc = arredondar({ nome: 'c', malha: c }, ac.filter(x => x.centro[2] > 5).map(x => x.id), { valor: 2, arestas: ac });
  ok(rc.parte.malha, 'cilindro');
  quase(caixa(rc.parte.malha).tam[2], 10, 1e-6, 'altura');
  // raio maior que o do cilindro não cabe
  assert.throws(() => arredondar({ nome: 'c', malha: c }, ac.map(x => x.id), { valor: 5.5, arestas: ac }), /máximo/);
  const L = mk(M => M.union([M.cube([40, 20, 4]), M.cube([4, 20, 30])]));
  const aL = detectarArestas(L), dentro = aL.filter(x => x.convexa === false);
  assert.equal(dentro.length, 1);
  const rL = arredondar({ nome: 'L', malha: L }, dentro.map(x => x.id), { valor: 3, arestas: aL });
  const vL = ok(rL.parte.malha, 'L');
  quase(vL.volume - validar(L, {}).volume, 20 * 9 * (1 - Math.PI / 4), 0.4, 'material posto no canto');
  const pn = mk(M => M.union([M.cube([40, 30, 4]), M.cylinder(10, 4, 4, 64).translate([20, 15, 4])]));
  const ap = detectarArestas(pn), base = ap.filter(x => x.tipo === 'circulo' && x.convexa === false);
  assert.equal(base.length, 1);
  ok(arredondar({ nome: 'p', malha: pn }, base.map(x => x.id), { valor: 1.5, arestas: ap }).parte.malha, 'base do pino');
});

test('PUXAR +5 e EMPURRAR −4 a face de cima: volume e altura exatos; atravessar é recusado', () => {
  const m = mk(M => M.cube([30, 20, 10]));
  const f = face(m, c => c[2] > 9.99);
  const a = puxarFace({ nome: 'c', malha: m }, f, 5), b = puxarFace({ nome: 'c', malha: m }, f, -4);
  quase(ok(a.parte.malha, 'puxar').volume, 9000, 1e-6, 'puxar'); quase(caixa(a.parte.malha).tam[2], 15, 1e-9, 'altura');
  quase(ok(b.parte.malha, 'empurrar').volume, 3600, 1e-6, 'empurrar'); quase(caixa(b.parte.malha).tam[2], 6, 1e-9, 'altura');
  assert.throws(() => puxarFace({ nome: 'c', malha: m }, f, -12), /apagaria|atravessa/);
  // face com furo: o furo continua
  const pf = mk(M => M.cube([40, 30, 4]).subtract(M.cylinder(10, 3, 3, 64).translate([20, 15, -2])));
  const r = puxarFace({ nome: 'p', malha: pf }, face(pf, c => c[2] > 3.99), 3);
  quase(ok(r.parte.malha, 'puxar com furo').volume, validar(pf, {}).volume * 7 / 4, 0.01, 'furo continua');
});

test('CASCA: caixa com parede 2 mm (fechada e aberta em cima), esfera oca 2 mm, parede grossa demais recusada', () => {
  const m = mk(M => M.cube([30, 20, 10]));
  quase(ok(casca({ nome: 'c', malha: m }, 2).parte.malha, 'casca').volume, 6000 - 26 * 16 * 6, 1e-6, 'fechada');
  const pote = casca({ nome: 'c', malha: m }, 2, { abrir: [face(m, c => c[2] > 9.99)] }).parte.malha;
  const vp = ok(pote, 'pote');
  quase(vp.volume, 6000 - 26 * 16 * 8, 1e-6, 'pote volume');
  assert.equal(vp.componentes, 1);
  const e = mk(M => M.sphere(20, 96));
  const ve = ok(casca({ nome: 'e', malha: e }, 2).parte.malha, 'esfera');
  quase(ve.volume, 4 / 3 * Math.PI * (8000 - 5832), 0.01 * ve.volume, 'esfera oca');
  assert.throws(() => casca({ nome: 'c', malha: m }, 6), /máximo 4,5 mm/);
});

test('ESPELHAR + UNIR: costura central exata (meia esfera, peça passando do plano, L vira T)', () => {
  for (const [rot, f, vol] of [['meia', M => M.sphere(10, 64).trimByPlane([1, 0, 0], 0), null], ['passa', M => M.sphere(10, 64).trimByPlane([1, 0, 0], -1.5), null], ['L', M => M.union([M.cube([40, 20, 4]), M.cube([4, 20, 30])]), 10560]]) {
    const m = mk(f);
    const r = espelhar({ nome: rot, malha: m }, 0, 0, { unir: true });
    const v = ok(r.parte.malha, rot);
    assert.equal(v.componentes, 1, rot + ': uma peça só');
    quase(v.volume, vol || 2 * r.volumeMetade, 1e-3 * v.volume, rot + ' volume = 2× metade');
  }
});

test('HISTÓRICO: Caixa -> Arredondar 3 -> Casca 2 (aberta em cima); mudar a caixa pra 50×30×20 refaz tudo', async () => {
  const { descritorAresta, descritorFace, aplicarOperacao, reaplicar } = await import('../src/estudio3d/core/historico.js');
  const { gerarForma } = await import('../src/estudio3d/core/formas.js');
  const base = p => ({ nome: 'Caixa', malha: gerarForma('caixa', { largura: p.x, profundidade: p.y, altura: p.z, canto: 0 }).malha, cor: '#999999' });
  const b0 = base({ x: 30, y: 20, z: 10 });
  const ar = detectarArestas(b0.malha).filter(x => x.tipo === 'reta' && Math.abs(x.t[2]) > 0.9);
  const ops = [
    { tipo: 'arredondar', valor: 3, bordas: ar.map(x => descritorAresta(b0.malha, x)) }
  ];
  const p1 = aplicarOperacao(b0, ops[0]);
  const topo = caixa(p1.malha).max[2];
  ops.push({ tipo: 'casca', valor: 2, abrir: [descritorFace(p1.malha, face(p1.malha, c => c[2] > topo - 0.01))] });
  const r0 = reaplicar(b0, ops);
  assert.ok(r0.status.every(s => s.ok), JSON.stringify(r0.status));
  ok(r0.parte.malha, 'pilha');
  // muda a medida da caixa e refaz: mesmas bordas, mesma face aberta
  const r1 = reaplicar(base({ x: 50, y: 30, z: 20 }), ops);
  assert.ok(r1.status.every(s => s.ok), JSON.stringify(r1.status));
  const v1 = ok(r1.parte.malha, 'refeita');
  caixa(r1.parte.malha).tam.forEach((t, i) => quase(t, [50, 30, 20][i], 1e-6, 'nova medida'));
  // volume: caixa arredondada menos o miolo aberto (parede 2 também arredondada por dentro)
  const cheia = 50 * 30 * 20 - 4 * 20 * 9 * (1 - Math.PI / 4);
  assert.ok(v1.volume < cheia * 0.5 && v1.volume > 0, 'ficou oca ' + v1.volume);
  // mudar o raio pra 4 também refaz
  const r2 = reaplicar(base({ x: 50, y: 30, z: 20 }), [{ ...ops[0], valor: 4 }, ops[1]]);
  assert.ok(r2.status.every(s => s.ok));
  ok(r2.parte.malha, 'raio 4');
});

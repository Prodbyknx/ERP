// Os critérios de aceitação pedidos, um por um, com os números da especificação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha, esfera } from './util/malhas.mjs';
import { escrever3MF, ler3MF } from '../src/estudio3d/core/formatos/tmf.js';
import { lerSTL, escreverSTL } from '../src/estudio3d/core/formatos/stl.js';
import { cortarPorPlano } from '../src/estudio3d/core/corte.js';
import { separarDetalhe } from '../src/estudio3d/core/separar.js';
import { separarPorCor } from '../src/estudio3d/core/separarCor.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, volume, centroidesFace, transformar } from '../src/estudio3d/core/malha.js';
import * as M4 from '../src/estudio3d/core/mat4.js';

await carregarManifold();

// "imprimível" no sentido da especificação: fechado, manifold, sem buraco,
// sem face degenerada/duplicada/invertida e sem auto-interseção
function imprimivel(m, rotulo) {
  const v = validar(m, { completo: true });
  const msg = rotulo + ': ' + JSON.stringify({ abertas: v.arestasAbertas, nm: v.arestasNaoManifold, nmv: v.verticesNaoManifold, inv: v.orientacaoTrocada + v.componentesInvertidos, deg: v.facesDegeneradas, dup: v.facesDuplicadas, ai: v.autoInterseccoes });
  assert.equal(v.arestasAbertas, 0, msg);
  assert.equal(v.arestasNaoManifold, 0, msg);
  assert.equal(v.verticesNaoManifold, 0, msg);
  assert.equal(v.orientacaoTrocada + v.componentesInvertidos, 0, msg);
  assert.equal(v.facesDegeneradas, 0, msg);
  assert.equal(v.facesDuplicadas, 0, msg);
  assert.equal(v.autoInterseccoes, 0, msg);
  assert.ok(v.volume > 0, msg);
  return v;
}
const unir = ms => comContexto(ctx => { const { Manifold } = manifold(); const u = ctx.guardar(Manifold.union(ms.map(m => ctx.solido({ malha: m, cor: '#000000' })))); return ctx.parte(u, 'm', '#000000').malha; });
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);

test('DIMENSÃO: 60 × 40 × 4 mm continua 60 × 40 × 4 mm no 3MF e no STL', () => {
  const m = caixaMalha(60, 40, 4);
  const r = ler3MF(escrever3MF({ objetos: [{ nome: 'P', transform: M4.translacao(10, 20, 0), partes: [{ nome: 'P', malha: m, cor: '#E54C00' }] }] }).bytes);
  const o = r.objetos[0];
  const mundo = transformar(o.partes[0].malha, o.transform);
  assert.deepEqual(caixa(mundo).tam.map(v => +v.toFixed(6)), [60, 40, 4]);
  assert.deepEqual(caixa(mundo).min.map(v => +v.toFixed(6)), [10, 20, 0]);
  assert.equal(r.unidade, 'millimeter');
  assert.deepEqual(caixa(lerSTL(escreverSTL(m)).malha).tam, [60, 40, 4]);
});

test('COR: #E54C00 sai e volta #E54C00 (sem aproximação)', () => {
  for (const hex of ['#E54C00', '#010203', '#FFFFFF', '#000000', '#7F7F80']) {
    const r = ler3MF(escrever3MF({ objetos: [{ nome: 'P', transform: M4.identidade(), partes: [{ nome: 'P', malha: caixaMalha(1, 1, 1), cor: hex }] }] }).bytes);
    assert.equal(r.objetos[0].partes[0].cor, hex);
  }
});

test('CORTE: objeto fechado vira Parte A e Parte B manifold', () => {
  const corpo = unir([esfera(15, 4, 0, 0, 15), caixaMalha(20, 20, 6, -10, -10, 0)]);
  imprimivel(corpo, 'antes');
  const r = cortarPorPlano([{ nome: 'C', malha: corpo, cor: '#1F6FEB' }], { n: [0, 0, 1], d: 12 });
  imprimivel(r.A[0].malha, 'Parte A');
  imprimivel(r.B[0].malha, 'Parte B');
  perto(volume(r.A[0].malha) + volume(r.B[0].malha), volume(corpo), 0.01, 'volume');
});

test('CONECTOR: pino 5,00 mm e folga 0,25 -> furo 5,50 mm; peças imprimíveis', () => {
  const r = cortarPorPlano([{ nome: 'B', malha: caixaMalha(40, 40, 20), cor: '#1F6FEB' }], { n: [0, 0, 1], d: 10 }, { conector: { tipo: 'cilindrico', diametro: 5, folga: 0.25, profundidade: 6, quantidade: 1 } });
  assert.equal(r.relatorio[0].pino, 'Ø 5,00 mm');
  assert.equal(r.relatorio[0].furo, 'Ø 5,50 mm');
  imprimivel(r.A[0].malha, 'A com pino');
  imprimivel(r.B[0].malha, 'B com furo');
  // nunca positivo dos dois lados: B não sobe acima do corte, A desce (pino)
  assert.ok(caixa(r.B[0].malha).max[2] <= 10 + 1e-6);
  assert.ok(caixa(r.A[0].malha).min[2] < 10 - 5);
});

test('SEPARAÇÃO DE DETALHE: 1 objeto manifold -> 2 peças manifold, escala e posição preservadas', () => {
  const modelo = unir([esfera(20, 4), esfera(6, 3, 0, 0, 22)]);
  imprimivel(modelo, 'modelo');
  const C = centroidesFace(modelo);
  const sel = new Uint8Array(modelo.idx.length / 3);
  for (let t = 0; t < sel.length; t++) if (C[t * 3 + 2] > 20.5) sel[t] = 1;
  const r = separarDetalhe({ nome: 'Personagem', malha: modelo, cor: '#1B1B1B' }, sel, { nomeDetalhe: 'Orelha' });
  const vp = imprimivel(r.principal.malha, 'peça principal');
  const vd = imprimivel(r.detalhe.malha, 'detalhe');
  assert.equal(vp.componentes + vd.componentes, 2, 'número de peças = 2');
  // escala: o corpo continua com 40 mm de diâmetro; o detalhe continua no alto
  perto(caixa(r.principal.malha).tam[0], 40, 0.2, 'escala corpo');
  const cd = caixa(r.detalhe.malha);
  perto(cd.max[2], 28, 0.1, 'posição relativa do detalhe');
  perto((cd.min[0] + cd.max[0]) / 2, 0, 0.2);
  perto(volume(r.principal.malha) + volume(r.detalhe.malha), volume(modelo), volume(modelo) * 0.005, 'volume conservado');
});

test('SEPARAÇÃO POR COR: preto + branco + vermelho -> 3 grupos imprimíveis, cor e posição certas', () => {
  const modelo = unir([esfera(20, 5), esfera(4, 3, -7, -18, 6), esfera(4, 3, 7, -18, 6), esfera(3, 3, 0, 0, 20)]);
  const C = centroidesFace(modelo);
  const nt = modelo.idx.length / 3;
  const cor = new Uint16Array(nt);
  for (let t = 0; t < nt; t++) {
    const x = C[t * 3], y = C[t * 3 + 1], z = C[t * 3 + 2];
    if (y < -19 && Math.hypot(Math.abs(x) - 7, z - 6) < 3.2) cor[t] = 1;        // olhos brancos
    else if (z > 21.2 && Math.hypot(x, y) < 2.5) cor[t] = 2;                   // detalhe vermelho no topo
  }
  modelo.cor = cor;
  const parte = { nome: 'Boneco', malha: modelo, cor: '#1B1B1B', paleta: ['#1B1B1B', '#FFFFFF', '#D1242F'] };
  const v0 = volume(modelo);
  const r = separarPorCor(parte, { espessura: 1 });
  assert.equal(r.pecas.length, 3, '3 grupos');
  assert.deepEqual(r.pecas.map(p => p.cor).sort(), ['#1B1B1B', '#D1242F', '#FFFFFF']);
  for (const p of r.pecas) { imprimivel(p.malha, p.cor); assert.equal(p.paleta, null, p.cor + ' uma cor só'); }
  perto(r.pecas.reduce((s, p) => s + volume(p.malha), 0), v0, v0 * 0.005, 'volume');
  const branco = r.pecas.find(p => p.cor === '#FFFFFF');
  const cb = caixa(branco.malha);
  assert.ok(cb.min[1] < -18.5 && cb.max[1] < -15, 'olhos na frente do rosto');
  const verm = r.pecas.find(p => p.cor === '#D1242F');
  assert.ok(caixa(verm.malha).min[2] > 19, 'detalhe vermelho no topo');
  assert.equal(validar(branco.malha, { completo: false }).componentes, 2, 'os dois olhos');
});

test('ROUND-TRIP: exportar -> reimportar -> exportar dá o mesmo (objetos, posição, cores, estrutura)', () => {
  const c1 = { objetos: [
    { nome: 'Chaveiro', transform: M4.compor([100, 80, 0], [0, 0, 30], [1, 1, 1]), partes: [{ nome: 'Base', malha: caixaMalha(60, 30, 3), cor: '#E54C00' }, { nome: 'Texto', malha: caixaMalha(20, 8, 1, 5, 5, 3), cor: '#FFFFFF' }] },
    { nome: 'Pino', transform: M4.translacao(20, 20, 0), partes: [{ nome: 'Pino', malha: caixaMalha(5, 5, 12), cor: '#1B1B1B' }] }] };
  const r1 = ler3MF(escrever3MF(c1).bytes);
  const r2 = ler3MF(escrever3MF(r1).bytes);
  for (const r of [r1, r2]) {
    assert.deepEqual(r.objetos.map(o => o.nome), ['Chaveiro', 'Pino']);
    assert.deepEqual(r.objetos.map(o => o.partes.map(p => p.nome + ' ' + p.cor)), [['Base #E54C00', 'Texto #FFFFFF'], ['Pino #1B1B1B']]);
    r.objetos.forEach((o, i) => { for (let k = 0; k < 16; k++) perto(o.transform[k], c1.objetos[i].transform[k], 1e-5, 'transform'); });
    r.objetos.forEach((o, i) => o.partes.forEach((p, j) => assert.deepEqual(caixa(p.malha).tam.map(v => +v.toFixed(5)), caixa(c1.objetos[i].partes[j].malha).tam)));
  }
});

test('RELEVO e ENCAIXES: toda peça gerada passa na checagem rígida', async () => {
  const { aplicarRelevo } = await import('../src/estudio3d/core/relevo.js');
  const placa = [{ nome: 'Chaveiro', malha: caixaMalha(60, 30, 3), cor: '#E54C00' }];
  const anel = { aneis: [[[-10, -5], [10, -5], [10, 5], [-10, 5]], [[-5, -2], [5, -2], [5, 2], [-5, 2]]] };
  for (const modo of ['alto', 'alto-cor', 'baixo', 'embutido', 'recorte']) {
    for (const lado of ['frente', 'verso']) {
      const r = aplicarRelevo(placa, 0, anel, { modo, lado, altura: 1, profundidade: 0.6, folga: modo === 'embutido' ? 0.15 : 0, cor: '#FFFFFF' });
      r.partes.forEach((p, i) => imprimivel(p.malha, modo + '/' + lado + '/' + i));
    }
  }
  for (const tipo of ['quadrado', 'retangular', 'hexagonal', 'lingueta', 'andorinha', 'solto']) {
    const r = cortarPorPlano([{ nome: 'B', malha: caixaMalha(60, 40, 20), cor: '#1F6FEB' }], { n: [0, 0, 1], d: 10 }, { conector: { tipo, diametro: 5, lado: 5, largura: 5, comprimento: 9, folga: 0.2, profundidade: 5, quantidade: 2 } });
    assert.ok(r.relatorio.length > 0, tipo + ' ' + r.avisos.join(';'));
    for (const p of [...r.A, ...r.B, ...r.extras]) imprimivel(p.malha, tipo);
  }
});

// Dados de exibição preparados no worker, seção do corte e caixas com memória.
import test from 'node:test';
import assert from 'node:assert/strict';
import { caixaMalha, esfera } from './util/malhas.mjs';
import { prepararRender, segmentosDaSecao, malhasDe } from '../src/estudio3d/core/render.js';
import { Cena, novoObjeto } from '../src/estudio3d/ui/cena.js';
import { transformar, caixa } from '../src/estudio3d/core/malha.js';
import * as M4 from '../src/estudio3d/core/mat4.js';

test('preparo da exibição: triângulo t ocupa os vértices 3t..3t+2 e normal aponta pra fora', () => {
  const m = caixaMalha(10, 20, 30);
  const r = prepararRender(m);
  const nt = m.idx.length / 3;
  assert.equal(r.pos.length, nt * 9);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const v = m.idx[t * 3 + k];
    for (let c = 0; c < 3; c++) assert.equal(r.pos[t * 9 + k * 3 + c], Math.fround(m.pos[v * 3 + c]));
  }
  // caixa: faces planas -> normal do canto = normal da face (dobra de 90° fica marcada)
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const o = t * 9 + k * 3;
    assert.ok(Math.abs(r.nor[o] - r.fn[t * 3]) < 1e-6 && Math.abs(r.nor[o + 1] - r.fn[t * 3 + 1]) < 1e-6 && Math.abs(r.nor[o + 2] - r.fn[t * 3 + 2]) < 1e-6);
  }
  // esfera: normal suave aponta pra fora
  const e = esfera(10, 3);
  const re = prepararRender(e);
  for (let i = 0; i < re.pos.length; i += 3) assert.ok(re.pos[i] * re.nor[i] + re.pos[i + 1] * re.nor[i + 1] + re.pos[i + 2] * re.nor[i + 2] > 0);
});

test('malhasDe acha as malhas de um resultado sem entrar em campos da tela', () => {
  const a = caixaMalha(1, 1, 1), b = caixaMalha(2, 2, 2);
  const r = { A: [{ malha: a }], B: [{ malha: b }], _r: { malha: caixaMalha(3, 3, 3) }, relatorio: [] };
  assert.deepEqual(malhasDe(r), [a, b]);
});

test('seção do corte: caixa 40×20×10 cortada em z=5 dá contorno 40×20', () => {
  const m = caixaMalha(40, 20, 10);
  const { n, saida } = segmentosDaSecao(m, { n: [0, 0, 1], d: 5 });
  assert.ok(n > 0 && n % 6 === 0);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += 3) {
    assert.ok(Math.abs(saida[i + 2] - 5) < 1e-5);
    x0 = Math.min(x0, saida[i]); x1 = Math.max(x1, saida[i]); y0 = Math.min(y0, saida[i + 1]); y1 = Math.max(y1, saida[i + 1]);
  }
  assert.ok(Math.abs(x1 - x0 - 40) < 1e-4 && Math.abs(y1 - y0 - 20) < 1e-4);
  assert.equal(segmentosDaSecao(m, { n: [0, 0, 1], d: 50 }).n, 0);
});

test('caixa exata com memória: igual à conta direta, e muda quando a posição muda', () => {
  const cena = new Cena();
  const m = esfera(12, 3, 1, 2, 3);
  const o = novoObjeto({ nome: 'e', transform: M4.compor([10, 20, 5], [0, 30, 45], [1, 1, 1]), partes: [{ malha: m, cor: '#ff0000' }] });
  const direta = caixa(transformar(m, o.transform));
  for (let rep = 0; rep < 2; rep++) {
    const c = cena.caixaExata(o);
    for (let i = 0; i < 3; i++) { assert.ok(Math.abs(c.min[i] - direta.min[i]) < 1e-9); assert.ok(Math.abs(c.max[i] - direta.max[i]) < 1e-9); }
  }
  o.transform = M4.multiplicar(M4.translacao(7, 0, 0), o.transform);
  const c2 = cena.caixaExata(o);
  assert.ok(Math.abs(c2.min[0] - (direta.min[0] + 7)) < 1e-9);
});

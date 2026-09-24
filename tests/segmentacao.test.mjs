import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { esfera, caixaMalha } from './util/malhas.mjs';
import { segmentar } from '../src/estudio3d/core/segmentacao.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { centroidesFace, juntar } from '../src/estudio3d/core/malha.js';

await carregarManifold();
function unir(malhas) {
  return comContexto(ctx => { const { Manifold } = manifold(); const u = ctx.guardar(Manifold.union(malhas.map(m => ctx.solido({ malha: m, cor: '#000000' })))); return ctx.parte(u, 'm', '#000000').malha; });
}

test('cabeça com duas orelhas grudadas: orelhas viram partes próprias', () => {
  const m = unir([esfera(20, 4), esfera(7, 3, -12, 0, 19), esfera(7, 3, 12, 0, 19)]);
  const t0 = Date.now();
  const r = segmentar(m);
  const C = centroidesFace(m);
  // cada orelha: as faces bem no alto de cada lado caem numa parte que não é a da cabeça
  const cabeca = r.rotulo[C.findIndex((v, i) => i % 3 === 2 && v < -19) / 3 | 0];
  const topoE = []; const topoD = [];
  for (let f = 0; f < C.length / 3; f++) {
    if (C[f * 3 + 2] > 24) (C[f * 3] < 0 ? topoE : topoD).push(r.rotulo[f]);
  }
  const moda = l => { const c = {}; l.forEach(x => c[x] = (c[x] || 0) + 1); return +Object.keys(c).sort((a, b) => c[b] - c[a])[0]; };
  const e = moda(topoE), d = moda(topoD);
  assert.notEqual(e, cabeca); assert.notEqual(d, cabeca); assert.notEqual(e, d);
  assert.ok(r.partes.length >= 3 && r.partes.length <= 12, 'partes: ' + r.partes.length);
  assert.equal(r.partes[0].nome, 'Parte 01');
  console.log('   segmentação:', r.partes.length, 'partes em', Date.now() - t0, 'ms');
});

test('cascas soltas: cada uma é uma parte', () => {
  const m = juntar([caixaMalha(10, 10, 10), caixaMalha(5, 5, 5, 20, 0, 0)]);
  const r = segmentar(m);
  assert.equal(r.cascas, 2);
  assert.ok(r.partes.length >= 2);
});

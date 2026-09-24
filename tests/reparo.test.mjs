import test from 'node:test';
import assert from 'node:assert/strict';
import { criar, volume, juntar, caixa } from '../src/estudio3d/core/malha.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { reparar } from '../src/estudio3d/core/reparo.js';
import { caixaMalha, esfera, tirarFaces } from './util/malhas.mjs';

const ok = r => r.arestasAbertas === 0 && r.arestasNaoManifold === 0 && r.orientacaoTrocada === 0 && r.verticesNaoManifold === 0 && r.componentesInvertidos === 0 && r.facesDegeneradas === 0 && r.facesDuplicadas === 0;

test('validador: caixa perfeita', () => {
  const r = validar(caixaMalha(60, 40, 4));
  assert.ok(r.fechada && r.imprimivel);
  assert.equal(r.autoInterseccoes, 0);
  assert.ok(Math.abs(r.espessuraMinima - 4) < 1e-9);
  assert.deepEqual(r.caixa.tam, [60, 40, 4]);
});

test('reparo: buraco plano (face faltando) fecha e volume volta', () => {
  const m = tirarFaces(caixaMalha(20, 20, 20), [2, 3]);
  const v0 = validar(m);
  assert.equal(v0.arestasAbertas, 4);
  const r = reparar(m);
  const v = validar(r.malha);
  assert.ok(ok(v), JSON.stringify(v));
  assert.ok(Math.abs(volume(r.malha) - 8000) < 1e-6);
});

test('reparo: buraco curvo em esfera fecha com tampa suave', () => {
  const s = esfera(10, 3);
  const nt = s.idx.length / 3;
  // tira uma calota: faces com centro z > 7
  const lista = [];
  for (let t = 0; t < nt; t++) { let z = 0; for (let k = 0; k < 3; k++) z += s.pos[s.idx[t*3+k]*3+2]; if (z / 3 > 7) lista.push(t); }
  const m = tirarFaces(s, lista);
  const r = reparar(m);
  const v = validar(r.malha);
  assert.ok(ok(v), JSON.stringify({ ...v, espessuraPorFace: undefined, infoComponentes: undefined }));
  assert.equal(v.autoInterseccoes, 0);
  assert.ok(volume(r.malha) > 0.9 * 4 / 3 * Math.PI * 1000);
});

test('reparo: faces invertidas e peça do avesso', () => {
  const m = caixaMalha(10, 10, 10);
  const idx = Uint32Array.from(m.idx);
  for (const t of [0, 5, 7]) { const x = idx[t*3+1]; idx[t*3+1] = idx[t*3+2]; idx[t*3+2] = x; }
  assert.ok(validar(criar(m.pos, idx)).orientacaoTrocada > 0);
  const r = reparar(criar(m.pos, idx));
  const v = validar(r.malha);
  assert.ok(ok(v)); assert.ok(Math.abs(volume(r.malha) - 1000) < 1e-9);
  // toda do avesso
  const inv = Uint32Array.from(m.idx); for (let t = 0; t < 12; t++) { const x = inv[t*3+1]; inv[t*3+1] = inv[t*3+2]; inv[t*3+2] = x; }
  const r2 = reparar(criar(m.pos, inv));
  assert.ok(volume(r2.malha) > 0);
});

test('reparo: duas caixas encostadas por uma aresta (non-manifold)', () => {
  const a = caixaMalha(10, 10, 10), b = caixaMalha(10, 10, 10, 10, 10, 0);
  const j = juntar([a, b]);
  // solda os vértices comuns pra criar a aresta non-manifold
  const r0 = reparar(j, { taparBuracos: false });
  const v0 = validar(r0.malha);
  assert.equal(v0.arestasNaoManifold, 0);
  assert.equal(v0.verticesNaoManifold, 0);
  assert.ok(ok(v0));
  assert.ok(Math.abs(volume(r0.malha) - 2000) < 1e-9);
});

test('reparo: faces duplicadas e aleta solta', () => {
  const m = caixaMalha(10, 10, 10);
  const pos = Array.from(m.pos), idx = Array.from(m.idx);
  idx.push(idx[0], idx[1], idx[2]);                 // duplicada
  pos.push(5, 5, 20); idx.push(4, 5, 8);            // aleta presa na aresta 4-5
  const r = reparar(criar(pos, idx));
  const v = validar(r.malha);
  assert.ok(ok(v), JSON.stringify({ ...v, espessuraPorFace: undefined, infoComponentes: undefined }));
  assert.ok(Math.abs(volume(r.malha) - 1000) < 1e-9);
  assert.equal(v.componentes, 1);
});

test('validador: auto-interseção entre duas caixas sobrepostas', () => {
  const j = juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 5, 5, 5)]);
  const v = validar(j);
  assert.ok(v.autoInterseccoes > 0);
  assert.ok(!v.imprimivel);
});

test('validador: componente interno detectado', () => {
  const j = juntar([caixaMalha(20, 20, 20), caixaMalha(2, 2, 2, 9, 9, 9)]);
  const v = validar(j);
  assert.equal(v.componentesInternos, 1);
});

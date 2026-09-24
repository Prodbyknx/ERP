import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha } from './util/malhas.mjs';
import { aplicarRelevo } from '../src/estudio3d/core/relevo.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, volume, centroidesFace } from '../src/estudio3d/core/malha.js';

await carregarManifold();
const solida = m => { const v = validar(m, { completo: false }); return v.fechada && v.volume > 0 && v.componentesInvertidos === 0; };
const placa = () => [{ nome: 'Chaveiro', malha: caixaMalha(60, 30, 3), cor: '#E54C00' }];
// anel retangular 20x10 com furo 10x4 (área 160) — centrado
const anel = { aneis: [[[-10, -5], [10, -5], [10, 5], [-10, 5]], [[-5, -2], [5, -2], [5, 2], [-5, 2]]] };
// letra "L" (assimétrica) pra conferir a leitura do verso
const L = { aneis: [[[-6, -8], [6, -8], [6, -4], [-2, -4], [-2, 8], [-6, 8]]] };
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ~ ' + b);

test('alto-relevo na frente soma área x altura', () => {
  const r = aplicarRelevo(placa(), 0, anel, { modo: 'alto', lado: 'frente', altura: 1 });
  assert.equal(r.partes.length, 1);
  assert.ok(solida(r.partes[0].malha));
  perto(volume(r.partes[0].malha), 5400 + 160, 0.05);
  perto(caixa(r.partes[0].malha).max[2], 4, 1e-4);
});

test('alto-relevo colorido vira peça separada com a cor escolhida', () => {
  const r = aplicarRelevo(placa(), 0, anel, { modo: 'alto-cor', altura: 1.2, cor: '#FFFFFF', nome: 'Texto' });
  assert.equal(r.partes.length, 2);
  assert.equal(r.partes[1].cor, '#FFFFFF'); assert.equal(r.partes[1].nome, 'Texto');
  assert.ok(solida(r.partes[1].malha));
  perto(volume(r.partes[1].malha), 160 * 1.2, 0.05);
  perto(volume(r.partes[0].malha), 5400, 0.01);
  perto(caixa(r.partes[1].malha).min[2], 3, 1e-4, 'relevo encosta na superfície');
});

test('baixo-relevo, recorte e embutido', () => {
  const b = aplicarRelevo(placa(), 0, anel, { modo: 'baixo', profundidade: 0.6 });
  perto(volume(b.partes[0].malha), 5400 - 96, 0.05);
  const c = aplicarRelevo(placa(), 0, anel, { modo: 'recorte' });
  perto(volume(c.partes[0].malha), 5400 - 480, 0.05);
  assert.ok(solida(c.partes[0].malha));
  const e = aplicarRelevo(placa(), 0, anel, { modo: 'embutido', profundidade: 0.6, cor: '#1B1B1B' });
  assert.equal(e.partes.length, 2);
  perto(volume(e.partes[0].malha), 5400 - 96, 0.05);
  perto(volume(e.partes[1].malha), 96, 0.05);
  perto(caixa(e.partes[1].malha).max[2], 3, 1e-4, 'embutido rente');
  // com folga o bolso é maior que a peça
  const ef = aplicarRelevo(placa(), 0, anel, { modo: 'embutido', profundidade: 0.6, folga: 0.15, cor: '#1B1B1B' });
  assert.ok(volume(ef.partes[0].malha) < 5400 - 96 - 5);
  perto(volume(ef.partes[1].malha), 96, 0.05);
});

test('verso: grava embaixo e lê certo quando a peça é virada', () => {
  const f = aplicarRelevo(placa(), 0, L, { modo: 'embutido', lado: 'frente', profundidade: 0.6, cor: '#FFFFFF' });
  const v = aplicarRelevo(placa(), 0, L, { modo: 'embutido', lado: 'verso', profundidade: 0.6, cor: '#FFFFFF' });
  const cf = caixa(f.partes[1].malha), cv = caixa(v.partes[1].malha);
  perto(cf.max[2], 3, 1e-4); perto(cv.min[2], 0, 1e-4, 'verso no fundo');
  // a perna vertical do L fica à ESQUERDA na frente e à DIREITA (em X do mundo) no verso
  const massaX = m => { const C = centroidesFace(m); let s = 0, n = 0; for (let i = 0; i < C.length; i += 3) { s += C[i]; n++; } return s / n; };
  assert.ok(massaX(f.partes[1].malha) < 30, 'frente: perna à esquerda');
  assert.ok(massaX(v.partes[1].malha) > 30, 'verso: espelhado em X');
});

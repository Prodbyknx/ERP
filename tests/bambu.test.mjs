// Compatibilidade com o Bambu Studio: roda o simulador do importador dele
// (tests/bambu/simular_importador.py, lógica tirada do código-fonte) em cima
// do 3MF novo e do 3MF antigo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { escrever3MF } from '../src/estudio3d/core/formatos/tmf.js';
import { escreverZip } from '../src/estudio3d/core/formatos/zip.js';
import * as M4 from '../src/estudio3d/core/mat4.js';
import { caixaMalha } from './util/malhas.mjs';

const aqui = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bambu-'));
const simular = arq => JSON.parse(execFileSync('python3', [path.join(aqui, 'bambu/simular_importador.py'), arq]).toString());
const lib3mf = arq => JSON.parse(execFileSync('python3', [path.join(aqui, 'lib3mf/validar.py'), arq]).toString());

const cena = () => ({ objetos: [
  { nome: 'Chaveiro', transform: M4.translacao(128, 128, 0), partes: [
    { nome: 'Base', malha: caixaMalha(60, 30, 3), cor: '#E54C00' },
    { nome: 'Texto', malha: caixaMalha(40, 10, 1, 10, 10, 3), cor: '#FFFFFF' }] },
  { nome: 'Olho', transform: M4.translacao(40, 40, 0), partes: [{ nome: 'Olho', malha: caixaMalha(5, 5, 2), cor: '#1B1B1B' }] }
] });

test('3MF novo: Bambu atribui a cada peça EXATAMENTE a cor definida no sistema', () => {
  const arq = path.join(tmp, 'novo.3mf');
  fs.writeFileSync(arq, escrever3MF(cena()).bytes);
  const s = simular(arq);
  assert.equal(s.eh_projeto_bambu, false);
  assert.deepEqual(s.filamentos, ['#E54C00FF', '#FFFFFFFF', '#1B1B1BFF']);
  const vols = s.objetos.flatMap(o => o.volumes);
  assert.deepEqual(vols.map(v => [v.nome, v.cor_volume, v.filamento, v.pintado]), [
    ['Base', '#E54C00FF', 1, false], ['Texto', '#FFFFFFFF', 2, false], ['Olho', '#1B1B1BFF', 3, false]]);
  // estrutura: 2 objetos, o chaveiro com 2 volumes
  assert.deepEqual(s.objetos.map(o => [o.nome, o.volumes.length]), [['Chaveiro', 2], ['Olho', 1]]);
  // e passa na lib3mf (norma 3MF) em modo estrito
  const l = lib3mf(arq);
  assert.deepEqual(l.avisos, []);
  assert.ok(l.objetos.every(o => o.manifold_orientado));
});

test('3MF ANTIGO (o que causava o problema): Bambu não recebe nenhuma cor', () => {
  const require = createRequire(import.meta.url);
  const antigo = require('./fixtures/treimf-antigo.cjs');
  const pecas = cena().objetos[0].partes.map(p => ({ nome: p.nome, cor: [229, 76, 0], malha: p.malha }));
  const arquivos = antigo.exportar(pecas, { nome: 'x' });
  const arq = path.join(tmp, 'antigo.3mf');
  fs.writeFileSync(arq, escreverZip(arquivos.map(a => ({ nome: a.nome, dados: a.dados }))));
  const s = simular(arq);
  assert.equal(s.eh_projeto_bambu, false);             // "144 Laboratorio 3D" != "BambuStudio-"
  assert.equal(s.project_settings_usado, false);        // as cores estavam só lá -> ignoradas
  assert.deepEqual(s.filamentos, []);                   // basematerials não é lido
  assert.ok(s.objetos[0].volumes.every(v => v.cor_volume === null));
});

test('peça com pintura por triângulo sai como pintura (cor por triângulo)', () => {
  const m = caixaMalha(10, 10, 10); m.cor = new Uint16Array(12); m.cor[0] = 1; m.cor[1] = 1;
  const arq = path.join(tmp, 'pintado.3mf');
  fs.writeFileSync(arq, escrever3MF({ objetos: [{ nome: 'P', transform: M4.identidade(), partes: [{ nome: 'p', malha: m, cor: '#000000', paleta: ['#000000', '#D1242F'] }] }] }).bytes);
  const v = simular(arq).objetos[0].volumes[0];
  assert.equal(v.pintado, true);
  assert.deepEqual(v.cores_triangulos, ['#000000FF', '#D1242FFF']);
});

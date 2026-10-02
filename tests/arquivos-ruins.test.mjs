// Arquivos ruins (auditoria M4, B2, B9) e mensagens que dão pra agir (B1):
//  - STL binário CORTADO (download incompleto) abre o que veio, com aviso
//    (antes: "O STL não tem nenhum triângulo");
//  - bytes que não são STL são recusados (não abre lixo);
//  - OBJ com índice que não existe: a face inteira sai e o aviso conta;
//  - 3MF fatiado com G-code enorme: só o modelo é descompactado;
//  - peça aberta no motor de sólidos: mensagem em português com o que fazer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha, esfera } from './util/malhas.mjs';
import { escreverSTL } from '../src/estudio3d/core/formatos/stl.js';
import { escrever3MF } from '../src/estudio3d/core/formatos/tmf.js';
import { lerZip } from '../src/estudio3d/core/formatos/zip.js';
import { importarArquivo } from '../src/estudio3d/core/importar.js';
import { comContexto } from '../src/estudio3d/core/solidos.js';
import { criar } from '../src/estudio3d/core/malha.js';
import { zipSync } from 'fflate';
import * as M4 from '../src/estudio3d/core/mat4.js';

await carregarManifold();

test('STL binário cortado no meio abre o que veio e avisa', () => {
  const inteiro = escreverSTL(esfera(20, 4), 'bola');
  const n = new DataView(inteiro.buffer, inteiro.byteOffset).getUint32(80, true);
  const cortado = inteiro.slice(0, 84 + Math.floor(n / 2) * 50 + 17);
  const r = importarArquivo('bola.stl', cortado);
  assert.equal(r.triangulos, Math.floor(n / 2));
  assert.ok(r.avisos.some(a => /incompleto/.test(a) && a.includes((n / 2).toLocaleString('pt-BR'))), r.avisos.join(' | '));
});

test('bytes que não são STL são recusados com mensagem clara', () => {
  const lixo = new Uint8Array(5000);
  for (let i = 0; i < lixo.length; i++) lixo[i] = (i * 7919 + 13) % 256;
  assert.throws(() => importarArquivo('lixo.stl', lixo), /não parece um modelo 3D/);
});

test('OBJ: face com índice inexistente sai inteira (não vira outro triângulo) e avisa', () => {
  const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nf 1 2 3\nf 1 2 99 4\n';
  const r = importarArquivo('x.obj', new TextEncoder().encode(obj));
  assert.equal(r.triangulos, 1);
  assert.ok(r.avisos.some(a => /1 face\(s\) apontam pra vértice que não existe/.test(a)), r.avisos.join(' | '));
});

test('3MF fatiado com G-code enorme: lê o modelo sem descompactar o G-code', () => {
  const base = lerZip(escrever3MF({ objetos: [{ nome: 'c', transform: M4.identidade(), partes: [{ nome: 'c', malha: caixaMalha(10, 10, 10), cor: '#888888' }] }] }).bytes);
  const arqs = {};
  for (const k in base) arqs[k] = base[k];
  arqs['Metadata/plate_1.gcode'] = [new Uint8Array(200 * 1024 * 1024), { level: 9 }];
  const zip = zipSync(arqs);
  const t0 = Date.now();
  const r = importarArquivo('fatiado.gcode.3mf', zip);
  assert.equal(r.triangulos, 12);
  assert.ok(Date.now() - t0 < 300, (Date.now() - t0) + ' ms (descompactou o G-code?)');
  // o filtro não esconde o que a leitura usa (cor dos filamentos, config)
  const so = lerZip(zip, n => /\.(model|rels|config|xml)$/i.test(n));
  assert.ok(Object.keys(so).some(k => /3dmodel\.model$/.test(k)));
  assert.ok(!Object.keys(so).some(k => /\.gcode$/.test(k)));
});

test('peça aberta no motor de sólidos: mensagem em português, com o botão que existe', () => {
  const aberta = criar([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10], [0, 1, 2, 0, 2, 3]);
  assert.throws(() => comContexto(ctx => ctx.solido({ malha: aberta, cor: '#888888' }, 'Tampa')),
    e => /Tampa não é um sólido fechado/.test(e.message) && /Consertar automaticamente/.test(e.message) && !/Not manifold|Analisar e reparar/.test(e.message));
});

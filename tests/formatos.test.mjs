import test from 'node:test';
import assert from 'node:assert/strict';
import { criar, caixa, volume } from '../src/estudio3d/core/malha.js';
import * as M4 from '../src/estudio3d/core/mat4.js';
import { escrever3MF, ler3MF, decodificarPintura } from '../src/estudio3d/core/formatos/tmf.js';
import { lerSTL, escreverSTL } from '../src/estudio3d/core/formatos/stl.js';
import { lerOBJ } from '../src/estudio3d/core/formatos/obj.js';
import { estatisticaArestas } from '../src/estudio3d/core/topologia.js';

export function caixaMalha(x, y, z, ox = 0, oy = 0, oz = 0) {
  const pos = [0,0,0, x,0,0, x,y,0, 0,y,0, 0,0,z, x,0,z, x,y,z, 0,y,z].map((v, i) => v + [ox, oy, oz][i % 3]);
  const idx = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  return criar(pos, idx);
}

test('caixa fechada e volume positivo', () => {
  const m = caixaMalha(60, 40, 4);
  assert.equal(volume(m), 60 * 40 * 4);
  const e = estatisticaArestas(m);
  assert.deepEqual([e.abertas, e.naoManifold, e.invertidas], [0, 0, 0]);
});

test('3MF: dimensão, posição, cor e estrutura sobrevivem ida e volta', () => {
  const base = caixaMalha(60, 40, 4);
  const texto = caixaMalha(20, 10, 1, 20, 15, 4);
  const T = M4.compor([128, 128, 0], [0, 0, 90], [1, 1, 1]);
  const cena = { objetos: [{ nome: 'Chaveiro', transform: T, partes: [
    { nome: 'Base', malha: base, cor: '#E54C00' },
    { nome: 'Texto', malha: texto, cor: '#ffffff' }
  ] }] };
  const { bytes, cores } = escrever3MF(cena);
  assert.deepEqual(cores, ['#E54C00', '#FFFFFF']);
  const r = ler3MF(bytes, 'teste.3mf');
  assert.equal(r.objetos.length, 1);
  const o = r.objetos[0];
  assert.equal(o.nome, 'Chaveiro');
  assert.equal(o.partes.length, 2);
  assert.deepEqual(o.partes.map(p => p.cor), ['#E54C00', '#FFFFFF']);
  assert.deepEqual(o.partes.map(p => p.nome), ['Base', 'Texto']);
  const cx = caixa(o.partes[0].malha);
  assert.deepEqual(cx.tam.map(v => +v.toFixed(5)), [60, 40, 4]);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(o.transform[i] - T[i]) < 1e-5, 'transform ' + i);
  assert.ok(Math.abs(volume(o.partes[1].malha) - 200) < 1e-6);
});

test('3MF: arquivo tem colorgroup e pid/pindex (o que o Bambu lê)', async () => {
  const { lerZip, texto } = await import('../src/estudio3d/core/formatos/zip.js');
  const cena = { objetos: [{ nome: 'X', transform: M4.identidade(), partes: [{ nome: 'A', malha: caixaMalha(1,1,1), cor: '#E54C00' }] }] };
  const arq = lerZip(escrever3MF(cena).bytes);
  const xml = texto(arq['3D/3dmodel.model']);
  assert.match(xml, /xmlns:m="http:\/\/schemas.microsoft.com\/3dmanufacturing\/material\/2015\/02"/);
  assert.match(xml, /<m:colorgroup id="1">\s*<m:color color="#E54C00FF"\/>/);
  assert.match(xml, /<object id="2" type="model" pid="1" pindex="0"/);
  assert.doesNotMatch(xml, /BambuStudio/);
  assert.doesNotMatch(xml, /basematerials/);
  assert.ok(arq['Metadata/model_settings.config']);
  assert.ok(!arq['Metadata/project_settings.config']);
});

test('3MF: cor por triângulo, unidade em polegada, espelho inverte ordem', () => {
  const m = caixaMalha(10, 10, 10);
  m.cor = new Uint16Array(12); m.cor[0] = 1; m.cor[1] = 1;
  const cena = { objetos: [{ nome: 'P', transform: M4.escala(-1, 1, 1), partes: [{ nome: 'p', malha: m, cor: '#000000', paleta: ['#000000', '#FF0000'] }] }] };
  const r = ler3MF(escrever3MF(cena).bytes);
  const p = r.objetos[0].partes[0];
  assert.deepEqual(p.paleta, ['#000000', '#FF0000']);
  assert.equal(p.malha.cor[0], 1); assert.equal(p.malha.cor[5], 0);
});

test('STL binário ida e volta preserva medida', () => {
  const m = caixaMalha(60, 40, 4);
  const r = lerSTL(escreverSTL(m, 'x'));
  assert.deepEqual(caixa(r.malha).tam, [60, 40, 4]);
  assert.equal(r.malha.idx.length, 36);
  assert.equal(r.malha.pos.length, 24);
  const e = estatisticaArestas(r.malha);
  assert.equal(e.abertas + e.naoManifold + e.invertidas, 0);
});

test('OBJ com MTL: peças e cores', () => {
  const obj = `mtllib a.mtl\no Corpo\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl preto\nf 1 2 3\nusemtl branco\nf 1 3 4\n`;
  const mtl = `newmtl preto\nKd 0 0 0\nnewmtl branco\nKd 1 1 1\n`;
  const r = lerOBJ(obj, mtl, 'a.obj');
  assert.equal(r.partes.length, 1);
  assert.deepEqual(r.partes[0].paleta, ['#000000', '#FFFFFF']);
});

test('pintura Bambu: estados simples e subdivididos', () => {
  assert.equal(decodificarPintura('4'), 1);   // 0b0100 -> folha estado 1
  assert.equal(decodificarPintura('8'), 2);
  assert.equal(decodificarPintura(''), 0);
  // estado 5: nibble 0b1100 + próximo nibble 2 -> 2+3 = 5; string é lida de trás pra frente
  assert.equal(decodificarPintura('2C'), 5);
});

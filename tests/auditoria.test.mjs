// Auditoria com MEDIÇÃO na geometria: folga dos encaixes, transformações até
// o arquivo exportado, estrutura do STL, desfazer/refazer, 3MF de cena
// complexa no validador oficial (lib3mf) e no simulador do Bambu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha, esfera } from './util/malhas.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { volume, caixa, transformar } from '../src/estudio3d/core/malha.js';
import { lerSTL } from '../src/estudio3d/core/formatos/stl.js';
import { Cena, novoObjeto } from '../src/estudio3d/ui/cena.js';
import * as M4 from '../src/estudio3d/core/mat4.js';

await carregarManifold();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// área da seção de um sólido num plano z (via Manifold.slice)
const areaEm = (m, z) => comContexto(ctx => { const s = ctx.guardar(ctx.guardar(ctx.solido({ malha: m, cor: '#000' })).slice(z)); return s.area(); });

test('ENCAIXE medido na geometria: pino Ø5,00 e furo Ø5,50 (folga 0,25), profundidades certas', () => {
  const L = 40, H = 20, zc = 10;
  const r = executar('cortar', { partes: [{ nome: 'b', malha: caixaMalha(L, L, H), cor: '#1F6FEB' }], plano: { n: [0, 0, 1], d: zc }, opc: { conector: { tipo: 'cilindrico', diametro: 5, folga: 0.25, profundidade: 6, quantidade: 1 } } });
  const A = r.A[0].malha, B = r.B[0].malha;
  // pino: seção de A 3 mm abaixo do corte = círculo do pino
  const aPino = areaEm(A, zc - 3);
  const dPino = Math.sqrt(4 * aPino / Math.PI);
  assert.ok(Math.abs(dPino - 5) < 0.03, 'Ø pino medido ' + dPino.toFixed(3));
  // furo: em B, seção 3 mm abaixo = quadrado menos o furo
  const aFuro = L * L - areaEm(B, zc - 3);
  const dFuro = Math.sqrt(4 * aFuro / Math.PI);
  assert.ok(Math.abs(dFuro - 5.5) < 0.03, 'Ø furo medido ' + dFuro.toFixed(3));
  // o pino tem 6 mm; o furo é mais fundo que o pino (não bate no fundo)
  const cA = caixa(A);
  assert.ok(Math.abs((zc - cA.min[2]) - 6) < 0.02, 'comprimento do pino ' + (zc - cA.min[2]).toFixed(3));
  assert.ok(L * L - areaEm(B, zc - 6.1) > 1, 'furo acaba antes da ponta do pino');
  assert.ok(Math.abs(L * L - areaEm(B, zc - 7)) < 1e-6, 'furo fundo demais');
  // B nunca sobe acima do corte, A nunca tem furo
  assert.ok(caixa(B).max[2] <= zc + 1e-6);
  assert.ok(Math.abs(areaEm(A, zc + 3) - L * L) < 1e-6, 'A tem furo onde não devia');
});

test('ENCAIXE quadrado medido: lado 5,00 → furo 5,40 com folga 0,2', () => {
  const r = executar('cortar', { partes: [{ nome: 'b', malha: caixaMalha(40, 40, 20), cor: '#1F6FEB' }], plano: { n: [0, 0, 1], d: 10 }, opc: { conector: { tipo: 'quadrado', lado: 5, folga: 0.2, profundidade: 6, quantidade: 1 } } });
  const aPino = areaEm(r.A[0].malha, 7), aFuro = 1600 - areaEm(r.B[0].malha, 7);
  assert.ok(Math.abs(Math.sqrt(aPino) - 5) < 0.02, 'lado do pino ' + Math.sqrt(aPino).toFixed(3));
  assert.ok(Math.abs(Math.sqrt(aFuro) - 5.4) < 0.02, 'lado do furo ' + Math.sqrt(aFuro).toFixed(3));
});

test('TRANSFORMAÇÕES até o arquivo: mover + girar + escalar + ESPELHAR saem certos no 3MF e no STL', () => {
  const m = caixaMalha(30, 20, 10);
  const T = M4.multiplicar(M4.compor([90, 70, 5], [20, 35, 50], [1.5, 0.8, 2]), M4.escala(-1, 1, 1));   // com espelho
  assert.ok(M4.determinante(T) < 0);
  const esperado = caixa(transformar(m, T));
  const cena = { objetos: [{ nome: 'P', transform: T, partes: [{ nome: 'P', malha: m, cor: '#E54C00' }] }] };
  const x = executar('exportar3MF', { cena, opc: {} });
  const r = executar('importar', { nome: 'x.3mf', bytes: x.bytes, extras: {} });
  const o = r.objetos[0];
  const mundo = transformar(o.partes[0].malha, o.transform);
  const c = caixa(mundo);
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(c.min[i] - esperado.min[i]) < 1e-3 && Math.abs(c.max[i] - esperado.max[i]) < 1e-3, '3MF eixo ' + i); }
  assert.ok(volume(mundo) > 0, '3MF espelhado ficou do avesso');
  const f = path.join(tmp, 'espelho.3mf'); fs.writeFileSync(f, x.bytes);
  const lib = JSON.parse(execFileSync('python3', [path.join(raiz, 'tests/lib3mf/validar.py'), f]).toString());
  assert.ok(lib.objetos.length === 1, 'lib3mf leu ' + JSON.stringify(lib).slice(0, 200));
  const s = executar('exportarSTL', { cena, opc: {} });
  const st = lerSTL(s.bytes).malha;
  const cs = caixa(st);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(cs.min[i] - esperado.min[i]) < 1e-3 && Math.abs(cs.max[i] - esperado.max[i]) < 1e-3, 'STL eixo ' + i);
  assert.ok(volume(st) > 0, 'STL espelhado ficou do avesso');
  assert.ok(Math.abs(volume(st) - volume(m) * 1.5 * 0.8 * 2) < 0.5, 'volume STL ' + volume(st));
});

test('STL binário: cabeçalho 80 bytes, contagem certa, 50 bytes por triângulo, normais apontando pra fora', () => {
  const m = esfera(10, 3);
  const s = executar('exportarSTL', { cena: { objetos: [{ nome: 'E', transform: M4.identidade(), partes: [{ nome: 'E', malha: m, cor: '#000000' }] }] }, opc: {} });
  const b = s.bytes, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(80, true);
  assert.equal(n, m.idx.length / 3);
  assert.equal(b.byteLength, 84 + 50 * n);
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t;
    const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
    const cx = (dv.getFloat32(o + 12, true) + dv.getFloat32(o + 24, true) + dv.getFloat32(o + 36, true)) / 3;
    const cy = (dv.getFloat32(o + 16, true) + dv.getFloat32(o + 28, true) + dv.getFloat32(o + 40, true)) / 3;
    const cz = (dv.getFloat32(o + 20, true) + dv.getFloat32(o + 32, true) + dv.getFloat32(o + 44, true)) / 3;
    assert.ok(nx * cx + ny * cy + nz * cz > 0, 'normal pra dentro no triângulo ' + t);
  }
});

test('DESFAZER/REFAZER: 6 ações, desfaz tudo volta ao começo, refaz tudo volta ao fim', () => {
  const cena = new Cena();
  const retrato = () => JSON.stringify(cena.objetos.map(o => [o.nome, Array.from(o.transform).map(v => +v.toFixed(9)), o.visivel, o.partes.map(p => [p.nome, p.cor, p.malha.idx.length])]));
  const inicio = retrato();
  const a = novoObjeto({ nome: 'A', partes: [{ malha: caixaMalha(10, 10, 10), cor: '#FF0000' }] });
  cena.aplicar('Adicionar', () => { cena.objetos.push(a); });
  cena.aplicar('Mover', () => { a.transform = M4.multiplicar(M4.translacao(5, 6, 0), a.transform); });
  cena.aplicar('Trocar malha', () => { a.partes[0] = { ...a.partes[0], malha: esfera(5, 2) }; });
  cena.aplicar('Renomear', () => { a.nome = 'B'; });
  cena.aplicar('Cor', () => { a.partes[0] = { ...a.partes[0], cor: '#00FF00' }; });
  cena.aplicar('Esconder', () => { a.visivel = false; });
  const fim = retrato();
  let n = 0; while (cena.desfazer()) n++;
  assert.equal(n, 6);
  assert.equal(retrato(), inicio);
  n = 0; while (cena.refazer()) n++;
  assert.equal(n, 6);
  assert.equal(retrato(), fim);
  cena.desfazer(); cena.desfazer();
  cena.aplicar('Nova ação', () => { cena.objetos[0].nome = 'C'; });
  assert.equal(cena.podeRefazer(), false, 'refazer tem que sumir depois de ação nova');
});

test('3MF de cena complexa (5 objetos, multipeça, pintura, espelho, escala): lib3mf estrito + Bambu com a cor exata de cada peça', () => {
  const pint = esfera(8, 3);
  const cor = new Uint16Array(pint.idx.length / 3); for (let t = 0; t < cor.length; t += 3) cor[t] = 1;
  const cena = { objetos: [
    { nome: 'Caixa', transform: M4.translacao(20, 20, 0), partes: [{ nome: 'Caixa', malha: caixaMalha(20, 20, 10), cor: '#E54C00' }] },
    { nome: 'Chaveiro', transform: M4.compor([80, 30, 0], [0, 0, 30], [1, 1, 1]), partes: [{ nome: 'Base', malha: caixaMalha(50, 25, 3), cor: '#1B1B1B' }, { nome: 'Texto', malha: caixaMalha(30, 8, 1, 10, 8, 3), cor: '#FFFFFF' }] },
    { nome: 'Pintado', transform: M4.translacao(150, 40, 8), partes: [{ nome: 'Pintado', malha: { ...pint, cor }, cor: '#0E9F2E', paleta: ['#0E9F2E', '#D1242F'] }] },
    { nome: 'Espelhado', transform: M4.multiplicar(M4.translacao(60, 120, 0), M4.escala(-1, 1, 1)), partes: [{ nome: 'E', malha: caixaMalha(15, 10, 5), cor: '#7F7F80' }] },
    { nome: 'Escalado', transform: M4.compor([150, 150, 0], [0, 0, 0], [2, 2, 0.5]), partes: [{ nome: 'S', malha: esfera(6, 3, 0, 0, 6), cor: '#010203' }] }] };
  const x = executar('exportar3MF', { cena, opc: {} });
  const f = path.join(tmp, 'complexa.3mf'); fs.writeFileSync(f, x.bytes);
  const lib = JSON.parse(execFileSync('python3', [path.join(raiz, 'tests/lib3mf/validar.py'), f]).toString());
  assert.ok(lib.unidade === 1 || lib.unidade === 'millimeter', 'unidade ' + lib.unidade);   // lib3mf: 1 = milímetro
  const bambu = JSON.parse(execFileSync('python3', [path.join(raiz, 'tests/bambu/simular_importador.py'), f]).toString());
  assert.equal(bambu.objetos.length, 5);
  const esperado = { Caixa: ['#E54C00'], Chaveiro: ['#1B1B1B', '#FFFFFF'], Espelhado: ['#7F7F80'], Escalado: ['#010203'] };
  for (const o of bambu.objetos) {
    if (esperado[o.nome]) assert.deepEqual(o.volumes.map(v => (v.cor_volume || '').slice(0, 7).toUpperCase()), esperado[o.nome], o.nome);
    else assert.deepEqual(o.volumes[0].cores_triangulos.map(c => c.slice(0, 7).toUpperCase()).sort(), ['#0E9F2E', '#D1242F'], 'pintura');
  }
  const r = executar('importar', { nome: 'c.3mf', bytes: x.bytes, extras: {} });
  assert.deepEqual(r.objetos.map(o => o.nome), ['Caixa', 'Chaveiro', 'Pintado', 'Espelhado', 'Escalado']);
  for (const o of r.objetos) for (const p of o.partes) {
    const w = transformar(p.malha, o.transform);
    assert.ok(volume(w) > 0, o.nome + ' do avesso');
    const v = validar(p.malha, { completo: false });
    assert.equal(v.arestasAbertas + v.arestasNaoManifold, 0, o.nome);
  }
  const esc = r.objetos.find(o => o.nome === 'Escalado');
  const ce = caixa(transformar(esc.partes[0].malha, esc.transform));
  assert.ok(Math.abs(ce.tam[0] - 24) < 0.05 && Math.abs(ce.tam[2] - 6) < 0.05, 'escala ' + ce.tam.join(','));
});

test('IMPORTAR: STL ASCII com CRLF, OBJ com quads e índice negativo, 3MF em centímetros', () => {
  const ascii = 'solid x\r\n' + [[0, 0, 0, 10, 0, 0, 0, 10, 0], [0, 0, 0, 0, 10, 0, 0, 0, 10], [0, 0, 0, 0, 0, 10, 10, 0, 0], [10, 0, 0, 0, 0, 10, 0, 10, 0]].map(t => ' facet normal 0 0 0\r\n  outer loop\r\n' + [0, 1, 2].map(k => '   vertex ' + t[k * 3] + ' ' + t[k * 3 + 1] + ' ' + t[k * 3 + 2] + '\r\n').join('') + '  endloop\r\n endfacet\r\n').join('') + 'endsolid x\r\n';
  const r1 = executar('importar', { nome: 't.stl', bytes: new TextEncoder().encode(ascii), extras: {} });
  const m1 = r1.objetos[0].partes[0].malha;
  assert.equal(m1.idx.length / 3, 4);
  assert.deepEqual(caixa(m1).tam, [10, 10, 10]);
  const obj = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nv 0 0 5\nv 10 0 5\nv 10 10 5\nv 0 10 5\nf -8 -5 -6 -7\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n';
  const r2 = executar('importar', { nome: 'q.obj', bytes: new TextEncoder().encode(obj), extras: {} });
  const m2 = r2.objetos[0].partes[0].malha;
  assert.equal(m2.idx.length / 3, 12);
  assert.ok(Math.abs(Math.abs(volume(m2)) - 500) < 1e-6);
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'C', transform: M4.identidade(), partes: [{ nome: 'C', malha: caixaMalha(2, 3, 4), cor: '#000000' }] }] }, opc: {} });
  const { lerZip, escreverZip, texto } = awaitZip();
  const arqs = lerZip(x.bytes);
  const modelo = texto(arqs['3D/3dmodel.model']).replace(/unit="millimeter"/, 'unit="centimeter"');
  const novo = escreverZip(Object.keys(arqs).map(k => ({ nome: k, dados: k === '3D/3dmodel.model' ? modelo : arqs[k] })));
  const r3 = executar('importar', { nome: 'cm.3mf', bytes: novo, extras: {} });
  const o3 = r3.objetos[0];
  assert.deepEqual(caixa(transformar(o3.partes[0].malha, o3.transform)).tam.map(v => +v.toFixed(6)), [20, 30, 40]);
});

import * as ZIP from '../src/estudio3d/core/formatos/zip.js';
function awaitZip() { return ZIP; }

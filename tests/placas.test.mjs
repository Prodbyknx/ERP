// PLACAS: mesma grade do Bambu Studio (colunas = ⌈√n⌉, passo 1,2 × a mesa,
// linhas descendo em −Y — conferido em PartPlate.cpp/.hpp); ORGANIZAR
// distribui e cria placa sozinho; a peça anda junto com a placa quando a
// grade muda; tirar placa só vazia; exportar uma placa sai na posição da
// placa 1 (abre no Bambu direto na mesa); desfazer volta as placas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import * as M4 from '../src/estudio3d/core/mat4.js';
import { Cena, novoObjeto } from '../src/estudio3d/ui/cena.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { caixa } from '../src/estudio3d/core/malha.js';

await carregarManifold();
const cubo = (x, y, z) => comContexto(ctx => ctx.parte(ctx.guardar(manifold().Manifold.cube([x, y, z])), 'c', '#999999').malha);
const add = (c, m, pos, nome = 'c') => { const o = novoObjeto({ nome, transform: M4.translacao(pos[0], pos[1], 0), partes: [{ nome, malha: m, cor: '#999999' }] }); c.objetos.push(o); return o; };
const dentroDaSuaPlaca = (c, o) => { const b = c.caixaExata(o), k = c.placaDe(o), p = c.origemPlaca(k); return k >= 0 && b.min[0] >= p[0] - 1e-6 && b.min[1] >= p[1] - 1e-6 && b.max[0] <= p[0] + 256 + 1e-6 && b.max[1] <= p[1] + 256 + 1e-6; };

test('PLACAS: grade igual à do Bambu (colunas e posição de cada placa)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 16, 17].map(Cena.colunas), [1, 2, 2, 2, 3, 3, 4, 4, 5]);
  const c = new Cena();
  assert.deepEqual(c.origemPlaca(1, 2).map(v => +v.toFixed(6)), [307.2, 0]);
  assert.deepEqual(c.origemPlaca(2, 3).map(v => +v.toFixed(6)), [0, -307.2]);
  assert.deepEqual(c.origemPlaca(4, 5).map(v => +v.toFixed(6)), [307.2, -307.2]);
  assert.equal(c.placaDoPonto(400, 100, 2), 1);
  assert.equal(c.placaDoPonto(280, 100, 2), -1, 'no vão entre placas: fora');
});

test('ORGANIZAR: 11 caixas de 100×100 não cabem numa placa -> cria as placas sozinho, cada uma dentro da sua, sem sobrepor; desfazer volta', () => {
  const c = new Cena(), m = cubo(100, 100, 20);
  c.aplicar('add', () => { for (let i = 0; i < 11; i++) add(c, m, [i * 5, 0], 'c' + i); });
  let r;
  c.aplicar('Organizar', () => { r = c.organizarMesa(); });
  assert.equal(r.placas, 3, 'placas ' + r.placas); assert.equal(r.novas, 2); assert.ok(r.coube);
  assert.equal(c.placas, 3);
  for (const o of c.objetos) assert.ok(dentroDaSuaPlaca(c, o), o.nome + ' fora da placa');
  assert.deepEqual([0, 1, 2].map(k => c.objetosDaPlaca(k).length), [4, 4, 3]);
  const cx = c.objetos.map(o => c.caixaExata(o));
  for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) {
    const a = cx[i], b = cx[j];
    assert.ok(a.max[0] <= b.min[0] + 1e-6 || b.max[0] <= a.min[0] + 1e-6 || a.max[1] <= b.min[1] + 1e-6 || b.max[1] <= a.min[1] + 1e-6, 'sobrepõe ' + i + ' ' + j);
  }
  c.desfazer();
  assert.equal(c.placas, 1, 'desfazer volta as placas');
  assert.ok(Math.abs(c.caixaExata(c.objetos[10]).min[0] - 50) < 1e-9);
});

test('PLACAS: quando a grade muda de colunas (4 -> 5 placas), cada peça vai junto com a sua placa; tirar placa só vazia', () => {
  const c = new Cena(), m = cubo(20, 20, 10);
  c.definirPlacas(4);
  const p2 = c.origemPlaca(2);                            // linha 1, coluna 0 com 4 placas
  const o = add(c, m, [p2[0] + 50, p2[1] + 60]);
  assert.equal(c.placaDe(o), 2);
  c.definirPlacas(5);                                    // agora 3 colunas: a placa 2 mudou de lugar
  assert.equal(c.placaDe(o), 2, 'continua na placa 3');
  const q = c.origemPlaca(2), b = c.caixaExata(o);
  assert.ok(Math.abs(b.min[0] - q[0] - 50) < 1e-9 && Math.abs(b.min[1] - q[1] - 60) < 1e-9, 'mesmo lugar dentro da placa');
  assert.equal(c.removerPlaca(2), false, 'placa com peça não sai');
  assert.equal(c.removerPlaca(0), true);
  assert.equal(c.placas, 4); assert.equal(c.placaDe(o), 1, 'a placa 3 virou a 2');
  const r = c.origemPlaca(1), b2 = c.caixaExata(o);
  assert.ok(Math.abs(b2.min[0] - r[0] - 50) < 1e-9 && Math.abs(b2.min[1] - r[1] - 60) < 1e-9);
  c.moverParaPlaca(o, 3);
  assert.equal(c.placaDe(o), 3);
});

test('EXPORTAR POR PLACA: peça da placa 2 sai na posição da placa 1 no 3MF (abre no Bambu direto na mesa)', () => {
  const c = new Cena(), m = cubo(30, 20, 10);
  c.definirPlacas(2);
  const p = c.origemPlaca(1), o = add(c, m, [p[0] + 40, p[1] + 50]);
  const T = M4.multiplicar(M4.translacao(-p[0], -p[1], 0), o.transform);
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'c', transform: T, partes: [{ nome: 'c', malha: m, cor: '#999999' }] }] }, opc: {} });
  const back = executar('importar', { nome: 'p.3mf', bytes: x.bytes, extras: {} }).objetos[0];
  const pos = back.partes[0].malha.pos, t = back.transform || M4.identidade();
  const pts = []; for (let i = 0; i < pos.length; i += 3) pts.push(...M4.aplicarPonto(t, pos[i], pos[i + 1], pos[i + 2]));
  const b = caixa({ pos: Float64Array.from(pts), idx: back.partes[0].malha.idx });
  assert.ok(Math.abs(b.min[0] - 40) < 1e-4 && Math.abs(b.min[1] - 50) < 1e-4, 'posição na placa 1: ' + b.min);
});

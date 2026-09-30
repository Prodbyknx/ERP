import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha } from './util/malhas.mjs';
import { cortarPorPlano, planoParaLocal } from '../src/estudio3d/core/corte.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, volume } from '../src/estudio3d/core/malha.js';
import * as M4 from '../src/estudio3d/core/mat4.js';

const W = await carregarManifold();

// diâmetro equivalente de um furo/pino pela área da seção num Z
function diametroNaAltura(malha, z, dentro) {
  const { Manifold, Mesh } = W;
  const m = new Manifold(new Mesh({ numProp: 3, vertProperties: Float32Array.from(malha.pos), triVerts: Uint32Array.from(malha.idx) }));
  const cs = m.slice(z);
  const pol = cs.toPolygons();
  m.delete(); cs.delete();
  return pol;
}
function areaAnel(a) { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] + a[i][0]) * (a[j][1] - a[i][1]); return Math.abs(s / 2); }

const solida = m => { const v = validar(m, { completo: false }); return v.fechada && v.volume > 0 && v.componentesInvertidos === 0; };

test('corte em Z: as duas metades fechadas, volume conservado', () => {
  const p = { nome: 'Bloco', malha: caixaMalha(60, 40, 20), cor: '#E54C00' };
  const r = cortarPorPlano([p], { n: [0, 0, 1], d: 10 });
  assert.equal(r.A.length, 1); assert.equal(r.B.length, 1);
  assert.ok(solida(r.A[0].malha)); assert.ok(solida(r.B[0].malha));
  assert.ok(Math.abs(volume(r.A[0].malha) - 24000) < 0.5);
  assert.ok(Math.abs(volume(r.B[0].malha) - 24000) < 0.5);
  assert.equal(r.A[0].cor, '#E54C00'); assert.equal(r.B[0].cor, '#E54C00');
  assert.deepEqual(caixa(r.A[0].malha).min.map(v => +v.toFixed(4)), [0, 0, 10]);
  assert.ok(Math.abs(r.areaSecao - 2400) < 1e-3);
});

test('conector cilíndrico Ø5 com folga 0,25: pino 5,00 em A, furo 5,50 em B', () => {
  const p = { nome: 'Bloco', malha: caixaMalha(60, 40, 20), cor: '#1F6FEB' };
  const r = cortarPorPlano([p], { n: [0, 0, 1], d: 10 }, { conector: { tipo: 'cilindrico', diametro: 5, folga: 0.25, profundidade: 6, quantidade: 1, chanfro: 0.4 } });
  assert.equal(r.relatorio.length, 1, JSON.stringify(r.avisos));
  const A = r.A[0].malha, B = r.B[0].malha;
  assert.ok(solida(A)); assert.ok(solida(B));
  // pino desce de z=10 até z=4 (6 mm) — seção a 7 mm (fora do chanfro)
  const pinos = diametroNaAltura(A, 7);
  assert.equal(pinos.length, 1);
  const dPino = Math.sqrt(4 * areaAnel(pinos[0]) / Math.PI);
  assert.ok(Math.abs(dPino - 5) < 0.02, 'pino ' + dPino);
  // furo em B: anel externo 60x40 + furo interno
  const furos = diametroNaAltura(B, 7);
  const internos = furos.filter(a => areaAnel(a) < 100);
  assert.equal(internos.length, 1);
  const dFuro = Math.sqrt(4 * areaAnel(internos[0]) / Math.PI);
  assert.ok(Math.abs(dFuro - 5.5) < 0.02, 'furo ' + dFuro);
  // fundo do furo 0,3 mm abaixo da ponta do pino
  assert.ok(Math.abs(r.relatorio[0].fundoFuro - 6.3) < 1e-9);
  assert.equal(r.relatorio[0].pino, 'Ø 5,00 mm');
  assert.equal(r.relatorio[0].furo, 'Ø 5,50 mm');
  // volume: A ganhou o pino, B perdeu o furo
  assert.ok(volume(A) > 24000 + 100); assert.ok(volume(B) < 24000 - 130);
});

test('vários pinos, hexagonal e pino solto', () => {
  const p = { nome: 'Bloco', malha: caixaMalha(80, 30, 20), cor: '#2DA44E' };
  const r = cortarPorPlano([p], { n: [0, 0, 1], d: 10 }, { conector: { tipo: 'hexagonal', diametro: 6, folga: 0.2, profundidade: 5, quantidade: 3 } });
  assert.equal(r.relatorio.length, 3, JSON.stringify(r.avisos));
  assert.ok(solida(r.A[0].malha) && solida(r.B[0].malha));
  const s = cortarPorPlano([p], { n: [0, 0, 1], d: 10 }, { conector: { tipo: 'solto', diametro: 5, folga: 0.2, profundidade: 5, quantidade: 2 } });
  assert.equal(s.extras.length, 2);
  assert.ok(solida(s.extras[0].malha));
  assert.ok(volume(s.A[0].malha) < 24000 && volume(s.B[0].malha) < 24000);
});

test('lingueta e rabo de andorinha geram sólidos válidos', () => {
  const p = { nome: 'Bloco', malha: caixaMalha(60, 40, 20), cor: '#8250DF' };
  for (const tipo of ['lingueta', 'andorinha']) {
    const r = cortarPorPlano([p], { n: [0, 0, 1], d: 10 }, { conector: { tipo, largura: 6, folga: 0.2, profundidade: 4 } });
    assert.equal(r.relatorio.length, 1, tipo + ' ' + JSON.stringify(r.avisos));
    assert.ok(solida(r.A[0].malha), tipo + ' A'); assert.ok(solida(r.B[0].malha), tipo + ' B');
    assert.ok(volume(r.A[0].malha) > 24000, tipo); assert.ok(volume(r.B[0].malha) < 24000, tipo);
  }
});

test('plano do mundo vira plano local respeitando a transformação do objeto', () => {
  const T = M4.compor([100, 50, 0], [0, 0, 90], [2, 2, 2]);
  const pl = planoParaLocal({ n: [0, 0, 1], d: 10 }, T);
  assert.ok(Math.abs(pl.n[2] - 1) < 1e-12);
  assert.ok(Math.abs(pl.d - 5) < 1e-12);
  const pl2 = planoParaLocal({ n: [1, 0, 0], d: 110 }, T);   // x=110 no mundo -> y local = -5
  assert.ok(Math.abs(pl2.n[1] + 1) < 1e-9); assert.ok(Math.abs(pl2.d - 5) < 1e-9);
});

// ---------- pediu conector: NUNCA some calado. Peça fina ganha pino solto;
// seção fina (orelha, dedo) ganha furo pra pino de FILAMENTO; o que não dá
// mesmo explica com o motivo certo (espessura × largura)
const cilindroMalha = (h, r) => { const m = W.Manifold.cylinder(h, r, r, 48, true), g = m.getMesh(); const pos = new Float32Array(g.vertProperties.length / g.numProp * 3); for (let v = 0; v < pos.length / 3; v++) for (let k = 0; k < 3; k++) pos[v * 3 + k] = g.vertProperties[v * g.numProp + k]; return { pos, idx: Uint32Array.from(g.triVerts) }; };
const con = t => ({ tipo: t, auto: true, diametro: 5, lado: 5, largura: 4, comprimento: 8, profundidade: 6, folga: 0.2, quantidade: 2, ladoPino: 'A', folgaFundo: 0.3, chanfro: 0.4, parede: 1.2 });
test('conector em placa de 6 mm cortada na espessura: pino SOLTO (antes saía sem nada)', () => {
  const r = cortarPorPlano([{ nome: 'Placa', malha: caixaMalha(60, 40, 6), cor: '#fff' }], { n: [0, 0, 1], d: 3 }, { conector: con('cilindrico') });
  assert.ok(r.relatorio.length >= 1, r.avisos.join(' | '));
  assert.ok(r.extras.length >= 1 && /Pino solto/.test(r.extras[0].nome));
  assert.ok(r.avisos.some(a => /PINO SOLTO/.test(a)));
  for (const p of [...r.A, ...r.B, ...r.extras]) assert.ok(solida(p.malha), p.nome);
});
test('conector em pescoço de Ø3,2 mm: furo pros dois lados pra pino de filamento 1,75', () => {
  for (const t of ['cilindrico', 'quadrado', 'lingueta', 'andorinha']) {
    const r = cortarPorPlano([{ nome: 'Pescoço', malha: cilindroMalha(30, 1.6), cor: '#fff' }], { n: [0, 0, 1], d: 0 }, { conector: con(t) });
    assert.equal(r.relatorio.length, 1, t + ': ' + r.avisos.join(' | '));
    assert.equal(r.relatorio[0].tipo, 'filamento', t);
    assert.ok(r.relatorio[0].comprimentoPino >= 2.6, t);
    const vA = r.A.reduce((s, p) => s + volume(p.malha), 0), vB = r.B.reduce((s, p) => s + volume(p.malha), 0), meio = Math.PI * 1.6 ** 2 * 15;
    assert.ok(vA < meio - 5 && vB < meio - 5, t + ' furo dos dois lados ' + vA.toFixed(1) + ' ' + vB.toFixed(1));
    for (const p of [...r.A, ...r.B]) assert.ok(solida(p.malha), t + ' ' + p.nome);
  }
});
test('conector que não cabe mesmo (placa de 4 mm): sai sem, e diz que é ESPESSURA, não largura', () => {
  const r = cortarPorPlano([{ nome: 'Placa', malha: caixaMalha(60, 40, 4), cor: '#fff' }], { n: [0, 0, 1], d: 2 }, { conector: con('cilindrico') });
  assert.equal(r.relatorio.length, 0);
  assert.ok(r.avisos.some(a => /espessura de cada lado/.test(a)), r.avisos.join(' | '));
  assert.ok(!r.avisos.some(a => /de largura: não cabe/.test(a)));
});

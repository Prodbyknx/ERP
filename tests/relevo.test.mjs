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

// ---------------------------------------------------------------- ENVOLVER
{
  const { comContexto: cc, manifold: mf } = await import('../src/estudio3d/core/solidos.js');
  const { executar: ex } = await import('../src/estudio3d/motor/operacoes.js');
  const { validar: val } = await import('../src/estudio3d/core/validador.js');
  const mk = f => cc(ctx => ctx.parte(ctx.guardar(f(mf().Manifold)), 'x', '#999999').malha);
  const barra = (w, h) => [[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]];
  const limpo = (m, rot) => { const v = val(m, { completo: true }); assert.ok(v.fechada && !v.autoInterseccoes && !v.facesDegeneradas, rot + ' ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes })); return v; };
  const cil = mk(M => M.cylinder(80, 20, 20, 128));
  const lado = { lado: 'ponto', ponto: [0, -20, 40], normal: [0, -1, 0], dicaX: [1, 0, 0] };

  test('ENVOLVER: nome de 60 mm na caneca Ø40 dá a volta certa (60/20 rad) com 1 mm constante, sem aviso falso', () => {
    const r = ex('relevo', { partes: [{ nome: 'C', malha: cil, cor: '#333333' }], alvo: 0, forma: { aneis: barra(60, 6) }, opc: { modo: 'alto-cor', ...lado, altura: 1, cor: '#FFFFFF' } });
    assert.equal(r.envolveu, true);
    assert.deepEqual(r.avisos, []);
    const p = r.partes[1].malha, v = limpo(p, 'peça');
    let a0 = Infinity, a1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (let i = 0; i < p.pos.length; i += 3) { const a = Math.atan2(p.pos[i + 1], p.pos[i]), rr = Math.hypot(p.pos[i], p.pos[i + 1]); a0 = Math.min(a0, a); a1 = Math.max(a1, a); r0 = Math.min(r0, rr); r1 = Math.max(r1, rr); }
    assert.ok(Math.abs((a1 - a0) - 3) < 0.01, 'ângulo ' + (a1 - a0));
    assert.ok(r0 > 19.98 && Math.abs(r1 - 21) < 1e-3, 'altura constante: ' + r0 + '..' + r1);
    assert.ok(Math.abs(v.volume - 6 * 1.5 * (21 * 21 - 400)) < 3, 'volume ' + v.volume);
    limpo(r.partes[0].malha, 'caneca');
  });

  test('ENVOLVER: gravar 0,6 mm na caneca tira o volume da casca certa; esfera alto e embutido seguem a curva', () => {
    const r = ex('relevo', { partes: [{ nome: 'C', malha: cil, cor: '#333333' }], alvo: 0, forma: { aneis: barra(60, 6) }, opc: { modo: 'baixo', ...lado, profundidade: 0.6 } });
    const tirado = val(cil, {}).volume - limpo(r.partes[0].malha, 'gravada').volume;
    assert.ok(Math.abs(tirado - 6 * 1.5 * (400 - 19.4 * 19.4)) < 2, 'tirado ' + tirado);
    const esf = mk(M => M.sphere(20, 128));
    const a = ex('relevo', { partes: [{ nome: 'E', malha: esf, cor: '#333333' }], alvo: 0, forma: { aneis: barra(20, 4) }, opc: { modo: 'alto-cor', lado: 'frente', altura: 1, cor: '#FFFFFF' } });
    const P = a.partes[1].malha.pos; let mx = 0;
    for (let i = 0; i < P.length; i += 3) mx = Math.max(mx, Math.hypot(P[i], P[i + 1], P[i + 2]));
    assert.ok(Math.abs(mx - 21) < 1e-3, 'topo a 1 mm da esfera: ' + mx);
    const e = ex('relevo', { partes: [{ nome: 'E', malha: esf, cor: '#333333' }], alvo: 0, forma: { aneis: barra(20, 4) }, opc: { modo: 'embutido', lado: 'frente', profundidade: 1, folga: 0.15, cor: '#FFFFFF' } });
    limpo(e.partes[0].malha, 'esfera com bolso'); limpo(e.partes[1].malha, 'embutido');
  });

  test('ENVOLVER: desenho maior que a volta da peça é recusado dizendo as medidas; superfície plana continua igual', () => {
    assert.throws(() => ex('relevo', { partes: [{ nome: 'C', malha: cil, cor: '#333333' }], alvo: 0, forma: { aneis: barra(150, 6) }, opc: { modo: 'alto', ...lado, altura: 1 } }), /maior que a volta da peça.*125/);
    const cubo = mk(M => M.cube([40, 40, 10]));
    const r = ex('relevo', { partes: [{ nome: 'P', malha: cubo, cor: '#333333' }], alvo: 0, forma: { aneis: barra(20, 6) }, opc: { modo: 'alto', lado: 'frente', altura: 1 } });
    assert.equal(r.envolveu, false);
    assert.ok(Math.abs(val(r.partes[0].malha, {}).volume - (16000 + 120)) < 1e-6);
  });
}

// ---------------------------------------------------------------- QUINA VIVA
{
  const { comContexto: cc, manifold: mf } = await import('../src/estudio3d/core/solidos.js');
  const { executar: ex } = await import('../src/estudio3d/motor/operacoes.js');
  const { validar: val } = await import('../src/estudio3d/core/validador.js');
  const mk = f => cc(ctx => ctx.parte(ctx.guardar(f(mf().Manifold)), 'x', '#999999').malha);
  const barra = (w, h) => [[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]];
  const limpo = (m, rot) => { const v = val(m, { completo: true }); assert.ok(v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.componentes === 1, rot + ' ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, c: v.componentes })); return v; };

  test('QUINA CONVEXA: texto que passa da frente pro topo da caixa dobra junto (meia-esquadria), 1 mm nas duas faces, nada cortado', () => {
    const cx = mk(M => M.cube([40, 40, 20], true).translate([0, 0, 10]));      // 12 triângulos
    const r = ex('relevo', { partes: [{ nome: 'C', malha: cx, cor: '#333333' }], alvo: 0, forma: { aneis: barra(6, 16) }, opc: { modo: 'alto-cor', lado: 'ponto', ponto: [0, -20, 16], normal: [0, -1, 0], dicaX: [1, 0, 0], altura: 1, cor: '#FFFFFF' } });
    assert.equal(r.envolveu, true); assert.deepEqual(r.avisos, []);
    const p = r.partes[1].malha, v = limpo(p, 'letra dobrada');
    // 12 mm na frente + 4 mm no topo + o canto da dobra (6×1×1)
    assert.ok(Math.abs(v.volume - (6 * 12 + 6 * 4 + 6)) < 0.3, 'volume ' + v.volume);
    let yMin = Infinity, zMax = -Infinity, yMaxTopo = -Infinity;
    for (let i = 0; i < p.pos.length; i += 3) { yMin = Math.min(yMin, p.pos[i + 1]); zMax = Math.max(zMax, p.pos[i + 2]); if (p.pos[i + 2] > 20.5) yMaxTopo = Math.max(yMaxTopo, p.pos[i + 1]); }
    // (os pedaços se sobrepõem 2 µm no corte: a ponta da dobra fica até 5 µm maior)
    assert.ok(Math.abs(yMin + 21) < 0.005 && Math.abs(zMax - 21) < 0.005, 'altura 1 mm nas duas faces: ' + yMin + ' / ' + zMax);
    assert.ok(Math.abs(yMaxTopo - (-16)) < 0.05, 'no topo vai 4 mm além da quina: ' + yMaxTopo);
  });

  test('QUINA CÔNCAVA: texto descendo da parede pro piso do degrau não se cruza; gravar na quina também', () => {
    const L = mk(M => M.union([M.cube([40, 40, 10]), M.cube([40, 20, 30]).translate([0, 20, 0])]));
    const r = ex('relevo', { partes: [{ nome: 'L', malha: L, cor: '#333333' }], alvo: 0, forma: { aneis: barra(6, 16) }, opc: { modo: 'alto-cor', lado: 'ponto', ponto: [20, 20, 13], normal: [0, -1, 0], dicaX: [1, 0, 0], altura: 1, cor: '#FFFFFF' } });
    assert.equal(r.envolveu, true);
    const v = limpo(r.partes[1].malha, 'letra no degrau');
    assert.ok(Math.abs(v.volume - (6 * 16 - 6)) < 0.3, 'volume ' + v.volume);
    const g = ex('relevo', { partes: [{ nome: 'L', malha: L, cor: '#333333' }], alvo: 0, forma: { aneis: barra(6, 16) }, opc: { modo: 'baixo', lado: 'ponto', ponto: [20, 20, 13], normal: [0, -1, 0], dicaX: [1, 0, 0], profundidade: 0.6 } });
    limpo(g.partes[0].malha, 'degrau gravado');
    const tirado = val(L, {}).volume - val(g.partes[0].malha, {}).volume;
    assert.ok(Math.abs(tirado - (6 * 16 * 0.6 + 6 * 0.36)) < 0.3, 'gravado ' + tirado);
  });
}

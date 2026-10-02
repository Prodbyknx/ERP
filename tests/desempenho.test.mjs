// As funções que ficaram mais rápidas continuam dando o MESMO resultado da
// conta direta (força bruta) — velocidade não pode trocar precisão.
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanciaBorda } from '../src/estudio3d/core/geo2d.js';
import { verticesCoincidentes, validar } from '../src/estudio3d/core/validador.js';
import { soldar, criar, volume } from '../src/estudio3d/core/malha.js';
import { corrigirDegeneradas } from '../src/estudio3d/core/limpeza.js';

// gerador pseudoaleatório fixo (teste repetível)
let semente = 12345;
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };

test('distância até a borda (planejador de pino): grade de segmentos = força bruta, dentro e fora do polígono', () => {
  const bruta = (aneis, x, y) => { let m = Infinity; for (const a of aneis) for (let i = 0, j = a.length - 1; i < a.length; j = i++) { const ax = a[j][0], ay = a[j][1], dx = a[i][0] - ax, dy = a[i][1] - ay, L2 = dx * dx + dy * dy; let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return m; };
  for (let caso = 0; caso < 6; caso++) {
    const aneis = [];
    for (let r = 0; r < 1 + caso % 3; r++) { const N = 300 + caso * 400, a = []; for (let i = 0; i < N; i++) { const t = i / N * 2 * Math.PI, rr = (10 + r * 3) * (1 + 0.3 * Math.sin(7 * t + caso)); a.push([r * 30 + rr * Math.cos(t), rr * Math.sin(t)]); } aneis.push(a); }
    for (let q = 0; q < 500; q++) {
      const x = -30 + rnd() * 120, y = -30 + rnd() * 60;
      assert.ok(Math.abs(distanciaBorda(aneis, x, y) - bruta(aneis, x, y)) < 1e-12, 'ponto ' + x + ',' + y);
    }
  }
});

test('vértices repetidos e solda: mesma contagem da busca completa; duplicado exato vira um só', () => {
  const nv = 3000, tol = 1e-3, pos = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    if (i > 0 && rnd() < 0.3) { const j = Math.floor(rnd() * i); for (let e = 0; e < 3; e++) pos[i * 3 + e] = pos[j * 3 + e] + (rnd() < 0.5 ? 0 : (rnd() - 0.5) * tol); }
    else for (let e = 0; e < 3; e++) pos[i * 3 + e] = rnd() * 20;
  }
  // referência: comparação de todos contra os "representantes" já vistos
  let esperado = 0; const reps = [];
  for (let v = 0; v < nv; v++) {
    let achou = false;
    for (const u of reps) if (Math.abs(pos[u * 3] - pos[v * 3]) <= tol && Math.abs(pos[u * 3 + 1] - pos[v * 3 + 1]) <= tol && Math.abs(pos[u * 3 + 2] - pos[v * 3 + 2]) <= tol) { achou = true; break; }
    if (achou) esperado++; else reps.push(v);
  }
  assert.ok(esperado > 500, 'o teste precisa ter repetidos');
  assert.equal(verticesCoincidentes({ pos }, tol), esperado);
  // duplicado exato (STL em sopa): a solda junta todos
  const cubo = new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
  const s = soldar({ pos: cubo, idx: new Uint32Array([0, 1, 2, 3, 4, 5]) }, 1e-6);
  assert.equal(s.fundidos, 2);
  assert.equal(s.malha.pos.length / 3, 4);
});

test('triângulo degenerado ("tampa": vértice em cima da aresta) some sem abrir a malha, mesmo volume', () => {
  // octaedro; do lado da face (3,0,4) a aresta 0-4 ganha o ponto médio 6, e a
  // junção fecha com a tampa (0,4,6), de área zero — como sai de booleana
  const P = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.5, 0, 0.5]];
  const F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5], [3, 0, 6], [3, 6, 4], [0, 4, 6]];
  const m = criar(Float64Array.from(P.flat()), Uint32Array.from(F.flat()));
  const antes = validar(m, { completo: false });
  assert.equal(antes.facesDegeneradas, 1);
  assert.ok(antes.fechada, 'a malha de teste tem que ser fechada');
  const r = corrigirDegeneradas(m);
  const v = validar(r.malha, { completo: false });
  assert.equal(v.facesDegeneradas, 0);
  assert.ok(v.fechada && !v.arestasNaoManifold, 'abriu a malha');
  assert.ok(Math.abs(volume(r.malha) - 4 / 3) < 1e-9, 'volume ' + volume(r.malha));
  assert.equal(r.trocas, 1);
});

// subMalha não pode custar o tamanho da malha inteira a cada casca (auditoria M6:
// 60 s parado em "Conferindo a malha 2%" no boneco com milhares de cascas)
test('subMalha: mil cascas de 1 triângulo numa malha de 2 milhões de vértices em menos de 1 s, e certa', async () => {
  const { subMalha, criar } = await import('../src/estudio3d/core/malha.js');
  const nv = 2000000, pos = new Float64Array(nv * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = i * 0.001;
  const idx = new Uint32Array(3000);
  for (let t = 0; t < 1000; t++) { idx[t * 3] = t * 1999; idx[t * 3 + 1] = t * 1999 + 1; idx[t * 3 + 2] = t * 1999 + 2; }
  const m = criar(pos, idx);
  const t0 = Date.now();
  for (let t = 0; t < 1000; t++) {
    const s = subMalha(m, Uint32Array.of(t)).malha;
    assert.equal(s.pos.length, 9);
    assert.equal(s.pos[0], pos[t * 1999 * 3]);
    assert.deepEqual(Array.from(s.idx), [0, 1, 2]);
  }
  assert.ok(Date.now() - t0 < 1000, (Date.now() - t0) + ' ms');
  // vértice repetido entre chamadas não vaza (mapa volta limpo)
  const a = subMalha(m, Uint32Array.of(0, 1)).malha, b = subMalha(m, Uint32Array.of(1, 0)).malha;
  assert.equal(a.pos.length, 18); assert.equal(b.pos.length, 18);
});

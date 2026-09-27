// SEPARAR POR COR pra fabricação: cada cenário que já quebrou (ou que
// entregava "grupo de triângulos" em vez de peça) com a medida que prova
// que agora sai peça imprimível que monta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { separarPorCor } from '../src/estudio3d/core/separarCor.js';
import { comContexto, manifold, ehErroWasm } from '../src/estudio3d/core/solidos.js';
import { validar, espessuras, facesDegeneradas } from '../src/estudio3d/core/validador.js';
import { criar, centroidesFace, areaFace, volume } from '../src/estudio3d/core/malha.js';
import { componentes } from '../src/estudio3d/core/topologia.js';

const W = await carregarManifold();
const mk = f => comContexto(ctx => ctx.parte(ctx.guardar(f(manifold().Manifold)), 'x', '#1B1B1B').malha);
const pintar = (m, fn) => { const C = centroidesFace(m), nt = m.idx.length / 3, cor = new Uint16Array(nt); for (let t = 0; t < nt; t++) cor[t] = fn(C[t * 3], C[t * 3 + 1], C[t * 3 + 2]) || 0; return criar(m.pos, m.idx, cor); };
const man = m => new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.pos), triVerts: Uint32Array.from(m.idx) }));
const separar = (m, paleta, opc = {}) => separarPorCor({ nome: 'p', malha: m, cor: paleta[0], paleta }, { espessura: 0.8, folga: 0.1, ...opc });

// peças fechadas, sem cruzamento nem triângulo degenerado, que montadas não
// se sobrepõem e somam o volume do original; parede fina (< 0,4 mm) em no
// máximo 3% da área de cada peça
function imprimiveis(r, m0, { fina = 0.03 } = {}) {
  const v0 = volume(m0);
  let vt = 0;
  for (const p of r.pecas) {
    const v = validar(p.malha, { completo: true });
    assert.ok(v.fechada && !v.componentesInvertidos, p.cor + ' fechada');
    assert.equal(v.autoInterseccoes, 0, p.cor + ' cruzamentos');
    assert.equal(facesDegeneradas(p.malha).length, 0, p.cor + ' degenerados');
    const e = espessuras(p.malha, { amostras: 1e9 });
    let af = 0, at = 0; for (let t = 0; t < e.porFace.length; t++) { const a = areaFace(p.malha, t); at += a; if (e.porFace[t] < 0.4) af += a; }
    assert.ok(af / at <= fina, p.cor + ': ' + (100 * af / at).toFixed(1) + '% da área com parede < 0,4 mm');
    vt += v.volume;
  }
  for (let i = 0; i < r.pecas.length; i++) for (let j = i + 1; j < r.pecas.length; j++) {
    const vi = man(r.pecas[i].malha).intersect(man(r.pecas[j].malha)).volume();
    assert.ok(vi < 0.05, 'peças ' + r.pecas[i].cor + ' e ' + r.pecas[j].cor + ' se sobrepõem ' + vi.toFixed(3));
  }
  assert.ok(Math.abs(vt / v0 - 1) < 0.03, 'volume total ' + vt + ' x ' + v0);
  assert.equal(r.regioes.falhou, 0, 'região que não virou peça');
}

test('FAIXA pintada em volta do cilindro (borda em zigue-zague): inserto sem dentes, com folga dos lados, sem aviso', () => {
  const m = pintar(mk(M => M.cylinder(40, 15, 15, 128).refineToLength(1)), (x, y, z) => z > 18 && z < 24 && Math.hypot(x, y) > 14.9 ? 1 : 0);
  const r = separar(m, ['#1B1B1B', '#FFFFFF']);
  assert.equal(r.pecas.length, 2);
  imprimiveis(r, m);
  assert.ok(!r.avisos.some(a => /serrilhada/.test(a)), 'saiu sem folga lateral: ' + r.avisos.join(' ; '));
  assert.equal(r.regioes.inserto, 1);
  // 2 paredes laterais de 0,1 somam volume: o vão é maior que só o do fundo
  const ins = r.pecas.find(p => p.cor === '#FFFFFF'), corpo = r.pecas.find(p => p.cor === '#1B1B1B');
  const vao = volume(m) - volume(ins.malha) - volume(corpo.malha), fundo = 0.1 * 2 * Math.PI * 14.2 * 6;
  assert.ok(vao > fundo + 5, 'vão ' + vao.toFixed(1) + ' mm³ (só o fundo daria ' + fundo.toFixed(1) + ')');
});

test('LOGO em estrela pintado na esfera: continua estrela (não vira pentágono pelo casco convexo) e sai como camada', () => {
  const est = (x, z) => { const a = Math.atan2(z, x), rr = Math.hypot(x, z), k = 0.5 + 0.5 * Math.cos(5 * a); return rr < 4 + 5 * k; };
  const m = pintar(mk(M => M.sphere(20, 160)), (x, y, z) => y < -14 && est(x, z) ? 1 : 0);
  let area = 0; for (let t = 0; t < m.idx.length / 3; t++) if (m.cor[t]) area += areaFace(m, t);
  const r = separar(m, ['#1B1B1B', '#D1242F']);
  imprimiveis(r, m);
  const ins = r.pecas.find(p => p.cor === '#D1242F');
  // camada de 0,8 que segue a superfície: volume ~ área × 0,8 (pentágono daria o dobro)
  const v = volume(ins.malha);
  assert.ok(v > 0.8 * area * 0.8 && v < 0.8 * area * 1.2, 'volume ' + v.toFixed(1) + ' x área ' + area.toFixed(1));
});

test('METADE de cima de outra cor (caneca bicolor): corte no plano da divisa, duas peças sólidas iguais', () => {
  const m = pintar(mk(M => M.cylinder(40, 20, 20, 128).refineToLength(1.5)), (x, y, z) => z > 20 ? 1 : 0);
  const r = separar(m, ['#1B1B1B', '#D1242F']);
  imprimiveis(r, m);
  assert.equal(r.regioes.plano, 1);
  const [a, b] = r.pecas.map(p => volume(p.malha));
  assert.ok(Math.abs(a / b - 1) < 0.01, a + ' x ' + b);
});

test('PINTURA em placa de 1,2 mm: o inserto atravessa (fundo do bolso ficaria < 0,8 mm) e avisa', () => {
  const m = pintar(mk(M => M.cube([40, 40, 1.2], true).refineToLength(0.8)), (x, y, z) => z > 0.5 && Math.hypot(x, y) < 8 ? 1 : 0);
  const r = separar(m, ['#1B1B1B', '#FFFFFF']);
  imprimiveis(r, m);
  assert.equal(r.regioes.atravessa, 1);
  assert.ok(r.avisos.some(a => /parede fina/.test(a)));
});

test('BOTÃO em relevo de 1,6 mm (só a face da frente pintada): sai o botão inteiro pelo plano da base, não "atravessa"', () => {
  const m0 = comContexto(ctx => {
    const M = manifold().Manifold;
    const u = ctx.guardar(M.union([ctx.guardar(M.sphere(20, 128)), ctx.guardar(ctx.guardar(ctx.guardar(M.cylinder(1.6 + 0.4, 3, 3, 64)).rotate([90, 0, 0])).translate([0, -19.6, 0]))]));
    return ctx.parte(u, 'b', '#1B1B1B').malha;
  });
  // frente do botão (y < -21) + metade da lateral, como no pincel
  const m = pintar(m0, (x, y, z) => y < -20.8 && Math.hypot(x, z) < 3.05 ? 1 : 0);
  const r = separar(m, ['#1B1B1B', '#D1242F']);
  imprimiveis(r, m);
  assert.equal(r.regioes.atravessa, 0, 'relevo tratado como parede fina');
  const bt = r.pecas.find(p => p.cor === '#D1242F');
  assert.ok(volume(bt.malha) > Math.PI * 9 * 0.8, 'botão ' + volume(bt.malha).toFixed(1) + ' mm³');
});

test('RESPINGOS de cor (IA): ilhas minúsculas voltam pra cor em volta com aviso; o resto sai normal', () => {
  const m = pintar(mk(M => M.sphere(20, 128)), (x, y, z) => {
    if (z > 5) return 1;
    // pontinhos soltos de ~1 triângulo
    return (Math.abs(Math.sin(x * 7.3) * Math.cos(y * 5.1)) > 0.995 && z < 0) ? 1 : 0;
  });
  const r = separar(m, ['#1B1B1B', '#FFFFFF']);
  imprimiveis(r, m);
  assert.ok(r.avisos.some(a => /respingo/.test(a)), r.avisos.join(' ; '));
  for (const p of r.pecas) assert.equal(componentes(p.malha).n, 1, p.cor + ' em pedaços');
});

test('COMPONENTE REAL (olho é uma bola própria encostada): sai inteiro e o corpo ganha o encaixe com folga', () => {
  const m = comContexto(ctx => {
    const M = manifold().Manifold;
    const cab = ctx.parte(ctx.guardar(M.sphere(15, 96)), 'c', '#1B1B1B').malha, olho = ctx.parte(ctx.guardar(M.sphere(3, 48).translate([0, -13.5, 3])), 'o', '#FFFFFF').malha;
    const nC = cab.idx.length / 3, pos = new Float64Array([...cab.pos, ...olho.pos]), idx = new Uint32Array([...cab.idx, ...Array.from(olho.idx, v => v + cab.pos.length / 3)]);
    const cor = new Uint16Array(idx.length / 3); for (let t = nC; t < cor.length; t++) cor[t] = 1;
    return criar(pos, idx, cor);
  });
  const r = separar(m, ['#1B1B1B', '#FFFFFF']);
  assert.equal(r.regioes.casca, 2);
  const olho = r.pecas.find(p => p.cor === '#FFFFFF'), corpo = r.pecas.find(p => p.cor === '#1B1B1B');
  assert.ok(Math.abs(volume(olho.malha) / (4 / 3 * Math.PI * 27) - 1) < 0.02, 'olho inteiro');
  assert.ok(man(corpo.malha).intersect(man(olho.malha)).volume() < 0.05, 'olho entra no corpo');
});

test('TRAÇO pintado em face plana: 2,5 mm vira inserto do tamanho da pintura (não do casco + margem); 0,6 mm nunca some calado', () => {
  const caixa = mk(M => M.cube([40, 40, 10], true).refineToLength(1));
  const traco = larg => pintar(caixa, (x, y, z) => z > 4.9 && Math.abs(x) < larg / 2 && Math.abs(y) < 15 ? 1 : 0);
  const m = traco(2.5), r = separar(m, ['#1B1B1B', '#FFFFFF']);
  imprimiveis(r, m);
  const v = volume(r.pecas.find(p => p.cor === '#FFFFFF').malha);
  // 2,5 × 30 × 0,8 = 60 menos a folga dos lados; casco + margem daria > 90
  assert.ok(v > 45 && v < 64, 'inserto ' + v.toFixed(1) + ' mm³');
  // traço da largura de 1 triângulo: some ou sai como pintado — nunca calado
  const fino = separar(traco(0.6), ['#1B1B1B', '#FFFFFF']);
  assert.ok(fino.avisos.some(a => /sumiu|sumiria|respingo/.test(a)), 'calado: ' + fino.avisos.join(' ; '));
});

test('pane do WASM é reconhecida (o worker é trocado) e erro comum não', () => {
  assert.ok(ehErroWasm(new WebAssembly.RuntimeError('memory access out of bounds')));
  assert.ok(ehErroWasm(new Error('RuntimeError: unreachable')));
  assert.ok(!ehErroWasm(new Error('O plano não atravessa a peça.')));
});

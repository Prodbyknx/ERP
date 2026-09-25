// Modelagem simples: cada forma sai fechada e com a medida/volume da conta;
// unir/tirar/parte comum e furos com volume exato; exportação aplica os furos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { FORMAS, normalizarParams, paramsPadrao } from '../src/estudio3d/core/formas.js';
import { alinhar, duplicarEmSerie } from '../src/estudio3d/core/modelagem.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { volume, caixa, transformar } from '../src/estudio3d/core/malha.js';
import * as M4 from '../src/estudio3d/core/mat4.js';

await carregarManifold();
const PI = Math.PI;
function imprimivel(m, rot) {
  const v = validar(m, { completo: true });
  const r = { abertas: v.arestasAbertas, nm: v.arestasNaoManifold, nmv: v.verticesNaoManifold, inv: v.orientacaoTrocada + v.componentesInvertidos, deg: v.facesDegeneradas, dup: v.facesDuplicadas, ai: v.autoInterseccoes };
  assert.ok(!r.abertas && !r.nm && !r.nmv && !r.inv && !r.deg && !r.dup && !r.ai && v.volume > 0, rot + ': ' + JSON.stringify(r));
}
const forma = (id, params = {}, extras = {}) => executar('forma', { id, params: { ...paramsPadrao(id), ...params }, opc: extras });
const perto = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, msg + ': ' + a.toFixed(4) + ' vs ' + b.toFixed(4));

// volume esperado (conta) e caixa esperada de cada forma com os valores padrão
const ESPERADO = {
  cubo: q => [q.lado ** 3, [q.lado, q.lado, q.lado]],
  caixa: q => [q.largura * q.profundidade * q.altura, [q.largura, q.profundidade, q.altura]],
  esfera: q => [4 / 3 * PI * (q.diametro / 2) ** 3, [q.diametro, q.diametro, q.diametro]],
  cilindro: q => [PI * (q.diametro / 2) ** 2 * q.altura, [q.diametro, q.diametro, q.altura]],
  cone: q => [PI * (q.diametro / 2) ** 2 * q.altura / 3, [q.diametro, q.diametro, q.altura]],
  piramide: q => [q.lado ** 2 * q.altura / 3, [q.lado, q.lado, q.altura]],
  prisma: q => [q.lados / 2 * (q.diametro / 2) ** 2 * Math.sin(2 * PI / q.lados) * q.altura, null],
  tubo: q => [PI * ((q.diametro / 2) ** 2 - (q.diametroInterno / 2) ** 2) * q.altura, [q.diametro, q.diametro, q.altura]],
  anel: q => { const r = q.grossura / 2, R = q.diametro / 2 - r; return [2 * PI * PI * R * r * r, [q.diametro, q.diametro, q.grossura]]; },
  capsula: q => { const r = q.diametro / 2; return [PI * r * r * (q.comprimento - 2 * r) + 4 / 3 * PI * r ** 3, [q.diametro, q.diametro, q.comprimento]]; },
  hemisferio: q => [2 / 3 * PI * (q.diametro / 2) ** 3, [q.diametro, q.diametro, q.diametro / 2]],
  placa: q => [q.largura * q.profundidade * q.espessura, [q.largura, q.profundidade, q.espessura]],
  circulo: q => [PI * (q.diametro / 2) ** 2 * q.espessura, [q.diametro, q.diametro, q.espessura]],
  quadrado: q => [q.lado ** 2 * q.espessura, [q.lado, q.lado, q.espessura]],
  retangulo: q => [q.largura * q.comprimento * q.espessura, [q.largura, q.comprimento, q.espessura]],
  triangulo: q => [Math.sqrt(3) / 4 * q.lado ** 2 * q.espessura, null],
  estrela: q => [null, null],
  hexagono: q => [3 * Math.sqrt(3) / 2 * (q.diametro / 2) ** 2 * q.espessura, [q.diametro, null, q.espessura]],
  poligono: q => [q.lados / 2 * (q.diametro / 2) ** 2 * Math.sin(2 * PI / q.lados) * q.espessura, null],
  coracao: q => [null, [q.largura, null, q.espessura]],
  texto: q => [null, [q.altura, null, q.espessura]],
  furoParafuso: q => [null, [q.bitola * 2 + 0.6, q.bitola * 2 + 0.6, q.comprimento]],
  argola: q => [PI * ((q.diametro / 2) ** 2 - (q.furo / 2) ** 2) * q.espessura, [q.diametro, q.diametro, q.espessura]],
  pino: q => [null, [q.diametro, q.diametro, q.comprimento]],
  espacador: q => [PI * ((q.diametro / 2) ** 2 - (q.furo / 2) ** 2) * q.altura, [q.diametro, q.diametro, q.altura]],
  imaFuro: q => [PI * (q.diametro / 2 + q.folga) ** 2 * (q.altura + q.folga), [q.diametro + 2 * q.folga, null, q.altura + q.folga]],
  base: q => [(q.largura * q.profundidade - (4 - PI) * q.canto ** 2) * q.altura, [q.largura, q.profundidade, q.altura]]
};
const ANEIS_TEXTO = [[[0, 0], [30, 0], [30, 10], [0, 10]], [[5, 3], [25, 3], [25, 7], [5, 7]]];

for (const f of FORMAS) {
  test('FORMA ' + f.nome + ': fechada, apoiada na mesa, centrada, medida e volume da conta', () => {
    const q = normalizarParams(f.id, paramsPadrao(f.id));
    const r = forma(f.id, {}, f.id === 'texto' ? { aneis: ANEIS_TEXTO } : {});
    imprimivel(r.malha, f.nome);
    const c = caixa(r.malha);
    assert.ok(Math.abs(c.min[2]) < 1e-6, f.nome + ' não está na mesa: ' + c.min[2]);
    assert.ok(Math.abs(c.min[0] + c.max[0]) < 1e-6 && Math.abs(c.min[1] + c.max[1]) < 1e-6, f.nome + ' fora do centro');
    const [vol, tam] = ESPERADO[f.id](q);
    if (vol != null) perto(volume(r.malha), vol, 0.012, f.nome + ' volume');
    if (tam) tam.forEach((t, i) => { if (t != null) assert.ok(Math.abs(c.tam[i] - t) < Math.max(0.02, t * 0.004), f.nome + ' eixo ' + i + ': ' + c.tam[i] + ' vs ' + t); });
  });
}

test('FORMA: medidas absurdas são limitadas e erro claro quando não dá (furo maior que o tubo)', () => {
  const q = normalizarParams('cilindro', { diametro: -5, altura: 99999 });
  assert.equal(q.diametro, 0.1); assert.equal(q.altura, 500);
  assert.throws(() => forma('tubo', { diametro: 10, diametroInterno: 12 }), /furo do tubo/);
});

const obj = (nome, malha, T, papel) => ({ nome, transform: T || M4.identidade(), papel: papel || 'solido', partes: [{ nome, malha, cor: '#E54C00' }] });

test('COMBINAR cubo 20 + cilindro Ø10×30 atravessando: unir, tirar e parte comum com volume exato', () => {
  const cubo = forma('cubo', { lado: 20 }).malha, cil = forma('cilindro', { diametro: 10, altura: 30 }).malha;
  const A = obj('Cubo', cubo, M4.translacao(50, 50, 0)), B = obj('Cilindro', cil, M4.translacao(50, 50, -5));
  const vc = volume(cil) / 30;   // área da seção do cilindro (poligonal, exata)
  const u = executar('combinar', { objetos: [A, B], modo: 'unir' });
  imprimivel(u.partes[0].malha, 'unir'); perto(volume(u.partes[0].malha), 8000 + vc * 10, 1e-6, 'unir');
  const s = executar('combinar', { objetos: [A, B], modo: 'subtrair' });
  imprimivel(s.partes[0].malha, 'tirar'); perto(volume(s.partes[0].malha), 8000 - vc * 20, 1e-6, 'tirar');
  const i = executar('combinar', { objetos: [A, B], modo: 'intersectar' });
  imprimivel(i.partes[0].malha, 'comum'); perto(volume(i.partes[0].malha), vc * 20, 1e-6, 'comum');
  // resultado fica no lugar do cubo (mesma matriz) e na mesma posição do mundo
  const w = caixa(transformar(s.partes[0].malha, s.transform));
  assert.deepEqual(w.min.map(v => +v.toFixed(6)), [40, 40, 0]);
  assert.deepEqual(w.max.map(v => +v.toFixed(6)), [60, 60, 20]);
});

test('COMBINAR com peça girada e espelhada: resultado fechado e no lugar certo', () => {
  const cubo = forma('caixa', { largura: 40, profundidade: 20, altura: 10 }).malha, cil = forma('cilindro', { diametro: 6, altura: 20 }).malha;
  const A = obj('Caixa', cubo, M4.multiplicar(M4.compor([30, 30, 0], [0, 0, 30], [1, 1, 1]), M4.escala(-1, 1, 1)));
  const B = obj('Furo', cil, M4.translacao(30, 30, -5), 'furo');
  const u = executar('combinar', { objetos: [A, B], modo: 'unir' });
  imprimivel(u.partes[0].malha, 'girado');
  const w = transformar(u.partes[0].malha, u.transform);
  assert.ok(volume(w) > 0);
  perto(volume(w), 8000 - volume(cil) / 20 * 10, 1e-6, 'volume com furo');
});

test('FURO ao vivo e na EXPORTAÇÃO: o 3MF sai com o furo de verdade e sem o objeto-furo', () => {
  const placa = forma('retangulo', { largura: 60, comprimento: 30, espessura: 3 }).malha;
  const furo = forma('cilindro', { diametro: 5, altura: 10 }).malha;
  const cena = { objetos: [obj('Placa', placa, M4.translacao(100, 100, 0)), obj('Furo', furo, M4.translacao(120, 100, -2), 'furo'), obj('Longe', forma('cubo', { lado: 5 }).malha, M4.translacao(10, 10, 0))] };
  const ao = executar('furar', { alvo: cena.objetos[0], furos: [cena.objetos[1]] });
  assert.deepEqual(ao.furosUsados, [0]);
  assert.equal(executar('furar', { alvo: cena.objetos[2], furos: [cena.objetos[1]] }), null, 'furo longe não mexe');
  const x = executar('exportar3MF', { cena, opc: {} });
  const r = executar('importar', { nome: 'f.3mf', bytes: x.bytes, extras: {} });
  assert.deepEqual(r.objetos.map(o => o.nome), ['Placa', 'Longe'], 'objeto-furo não pode ir pro arquivo');
  const p = r.objetos[0].partes[0].malha;
  imprimivel(p, 'placa furada');
  perto(volume(p), 60 * 30 * 3 - volume(furo) / 10 * 3, 1e-6, 'volume da placa furada');
  const st = executar('exportarSTL', { cena, opc: {} });
  assert.ok(st.zip && st.arquivos.length === 2, 'STL: só as 2 peças sólidas');
});

test('ALINHAR, DISTRIBUIR, EMPILHAR e DUPLICAR EM SÉRIE: contas certas', () => {
  const cx = [{ min: [0, 0, 0], max: [10, 10, 10] }, { min: [30, 5, 2], max: [40, 25, 6] }, { min: [100, -5, 0], max: [120, 5, 20] }];
  const ap = (d, k) => ({ min: cx[k].min.map((v, i) => v + d[k][i]), max: cx[k].max.map((v, i) => v + d[k][i]) });
  let d = alinhar(cx, 'esq'); for (let k = 0; k < 3; k++) assert.equal(ap(d, k).min[0], 0);
  d = alinhar(cx, 'dir'); for (let k = 0; k < 3; k++) assert.equal(ap(d, k).max[0], 120);
  d = alinhar(cx, 'centroY'); for (let k = 0; k < 3; k++) { const c = ap(d, k); assert.equal((c.min[1] + c.max[1]) / 2, 10); }
  d = alinhar(cx, 'base'); for (let k = 0; k < 3; k++) assert.equal(ap(d, k).min[2], 0);
  d = alinhar(cx, 'distribuirX');
  const cs = [0, 1, 2].map(k => ap(d, k)).sort((a, b) => a.min[0] - b.min[0]);
  assert.ok(Math.abs((cs[1].min[0] - cs[0].max[0]) - (cs[2].min[0] - cs[1].max[0])) < 1e-9, 'vãos iguais');
  d = alinhar(cx.slice(0, 2), 'emCima');
  assert.equal(ap(d, 1).min[2], 10);
  const ts = duplicarEmSerie(M4.translacao(1, 2, 3), 5, [10, 0, 0]);
  assert.equal(ts.length, 5);
  ts.forEach((t, k) => assert.deepEqual([t[12], t[13], t[14]], [1 + 10 * (k + 1), 2, 3]));
});

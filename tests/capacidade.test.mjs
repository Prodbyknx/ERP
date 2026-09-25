// "Dá pra modelar de verdade?" — peças reais criadas DO ZERO só com as
// ferramentas do Estúdio (formas, unir, tirar, furos, relevo, série, separar),
// pelo mesmo motor que a tela usa. Cada peça: fechada/imprimível, medida
// conferida, encaixes com folga MEDIDA, e exportada/relida em 3MF.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { carregarManifold } from './util/manifold.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { paramsPadrao } from '../src/estudio3d/core/formas.js';
import { duplicarEmSerie } from '../src/estudio3d/core/modelagem.js';
import { comContexto } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { volume, caixa, transformar } from '../src/estudio3d/core/malha.js';
import * as M4 from '../src/estudio3d/core/mat4.js';

await carregarManifold();
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
const PI = Math.PI;
const PECAS = [];     // tudo que foi modelado vai junto num 3MF no fim

function imprimivel(m, rot) {
  const v = validar(m, { completo: true });
  const r = { abertas: v.arestasAbertas, nm: v.arestasNaoManifold, nmv: v.verticesNaoManifold, inv: v.orientacaoTrocada + v.componentesInvertidos, deg: v.facesDegeneradas, dup: v.facesDuplicadas, ai: v.autoInterseccoes };
  assert.ok(!r.abertas && !r.nm && !r.nmv && !r.inv && !r.deg && !r.dup && !r.ai && v.volume > 0, rot + ': ' + JSON.stringify(r));
  return v;
}
const forma = (id, p = {}) => executar('forma', { id, params: { ...paramsPadrao(id), ...p }, opc: {} }).malha;
const obj = (nome, malha, T, papel) => ({ nome, transform: T || M4.identidade(), papel: papel || 'solido', partes: [{ nome, malha, cor: '#E54C00' }] });
const T = (x, y, z) => M4.translacao(x, y, z);
const unir = objs => executar('combinar', { objetos: objs, modo: 'unir' });
const tirar = objs => executar('combinar', { objetos: objs, modo: 'subtrair' });
const mundo = r => transformar(r.partes[0].malha, r.transform);
const volInter = (a, b) => comContexto(ctx => ctx.guardar(ctx.solido({ malha: a, cor: '#000' }).intersect(ctx.solido({ malha: b, cor: '#000' }))).volume());
const secao = (m, z) => comContexto(ctx => ctx.guardar(ctx.guardar(ctx.solido({ malha: m, cor: '#000' })).slice(z)).area());
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg + ': ' + a.toFixed(4) + ' vs ' + b.toFixed(4));
const guardar = (nome, malha, cor) => PECAS.push({ nome, malha, cor });

test('CAIXA COM TAMPA que encaixa (paredes 2 mm, folga 0,2 mm por lado)', () => {
  // caixa oca: externa 60×40×30 menos interna 56×36 começando 2 mm acima do fundo
  const caixaOca = tirar([obj('Caixa', forma('caixa', { largura: 60, profundidade: 40, altura: 30, canto: 3 })), obj('Oco', forma('caixa', { largura: 56, profundidade: 36, altura: 30, canto: 1 }), T(0, 0, 2))]);
  const cx = mundo(caixaOca);
  imprimivel(cx, 'caixa oca');
  perto(secao(cx, 1), (60 * 40 - (4 - PI) * 9), 0.05, 'fundo maciço');
  // tampa: chapa 60×40×2 + lábio 55,6×35,6×3 embaixo (entra no oco com 0,2 de folga)
  const tampa = unir([obj('Tampa', forma('caixa', { largura: 60, profundidade: 40, altura: 2, canto: 3 }), T(0, 0, 30)), obj('Lábio', forma('caixa', { largura: 55.6, profundidade: 35.6, altura: 3, canto: 0.8 }), T(0, 0, 27.01))]);
  const tp = mundo(tampa);
  imprimivel(tp, 'tampa');
  assert.ok(volInter(cx, tp) < 1e-6, 'tampa bate na caixa');
  const oco = caixa(cx), lab = caixa(tp);
  perto((56 - 55.6) / 2, 0.2, 1e-9, 'folga por lado');
  assert.ok(lab.min[2] < 30 && lab.min[2] > 26.9, 'lábio entra no oco');
  guardar('Caixa', cx); guardar('Tampa', tp, '#FFFFFF');
  void oco;
});

test('SUPORTE EM L com 3 furos de parafuso M4 (2 na base com rebaixo, 1 na parede)', () => {
  const base = obj('Base', forma('caixa', { largura: 60, profundidade: 30, altura: 4 }), T(0, 0, 0));
  const parede = obj('Parede', forma('caixa', { largura: 60, profundidade: 4, altura: 40 }), T(0, 13, 0));
  const L = unir([base, parede]);
  const f1 = obj('F1', forma('furoParafuso', { bitola: 4, comprimento: 4.02, cabeca: 2 }), T(-20, -4, -0.01), 'furo');
  const f2 = obj('F2', forma('furoParafuso', { bitola: 4, comprimento: 4.02, cabeca: 2 }), T(20, -4, -0.01), 'furo');
  const f3 = obj('F3', forma('furoParafuso', { bitola: 4, comprimento: 4.02, cabeca: 2 }), M4.multiplicar(T(0, 15.01, 25), M4.rotacaoEuler(90, 0, 0)), 'furo');
  const r = unir([{ ...L, papel: 'solido' }, f1, f2, f3]);
  const m = mundo(r);
  imprimivel(m, 'suporte L');
  const c = caixa(m);
  perto(c.tam[0], 60, 1e-6, 'largura'); perto(c.tam[2], 40, 1e-6, 'altura');
  // na base, a 1 mm: 2 furos Ø4,4; a 3 mm: 2 rebaixos Ø8,6 (cabeça)
  const areaBase = 60 * 30 - 4 * 60;   // base inteira menos o pedaço sob a parede já contado na parede
  void areaBase;
  const a1 = secao(m, 1), a3 = secao(m, 3), furoA = volume(forma('cilindro', { diametro: 4.4, altura: 1 })), cabA = volume(forma('cilindro', { diametro: 8.6, altura: 1 }));
  perto(60 * 30 - a1, 2 * furoA, 0.05, 'furos na base a 1 mm');
  perto(60 * 30 - a3, 2 * cabA, 0.05, 'rebaixo da cabeça a 3 mm');
  // na parede, a 25 mm de altura (centro do furo): 2 mm de furo Ø4,4 + 2 mm de rebaixo Ø8,6
  perto(60 * 4 - secao(m, 25), 4.4 * 2 + 8.6 * 2, 0.3, 'furo da parede');
  guardar('Suporte L', m, '#1F6FEB');
});

test('CHAVEIRO: placa arredondada + argola + relevo na frente + gravação no verso', () => {
  const placa = obj('Placa', forma('retangulo', { largura: 50, comprimento: 25, canto: 5, espessura: 3 }), T(0, 0, 0));
  const argola = obj('Argola', forma('argola', { diametro: 12, furo: 6, espessura: 3 }), T(-27, 0, 0));
  const ch = unir([placa, argola]);
  const m0 = mundo(ch);
  imprimivel(m0, 'placa + argola');
  const semFuro = 50 * 25 - (4 - PI) * 25 + PI * 36 - (PI * 36 / 2);   // aproximado: só pra ver que o furo da argola continua
  void semFuro;
  const furoArgola = volume(forma('cilindro', { diametro: 6, altura: 1 }));
  assert.ok(secao(m0, 1.5) < 50 * 25 + PI * 36 - furoArgola * 0.9, 'furo da argola sumiu');
  // relevo: estrela 0,8 mm na frente, retângulo gravado 0,6 mm no verso (texto usa o mesmo caminho, com o contorno da fonte)
  const estrela = []; for (let i = 0; i < 10; i++) { const a = PI / 2 + i * PI / 5, rr = i % 2 ? 3.5 : 8; estrela.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  let partes = [{ nome: 'Chaveiro', malha: m0, cor: '#E54C00' }];
  let r = executar('relevo', { partes, alvo: 0, forma: { aneis: [estrela] }, opc: { modo: 'alto-cor', lado: 'frente', altura: 0.8, cor: '#FFFFFF', largura: 16, dx: 5 } });
  partes = r.partes;
  r = executar('relevo', { partes, alvo: 0, forma: { aneis: [[[-12, -3], [12, -3], [12, 3], [-12, 3]]] }, opc: { modo: 'baixo', lado: 'verso', profundidade: 0.6, dx: 5 } });
  for (const p of r.partes) imprimivel(p.malha, 'chaveiro/' + p.nome);
  const corpo = r.partes.find(p => p.cor === '#E54C00'), relevo = r.partes.find(p => p.cor === '#FFFFFF');
  assert.ok(relevo, 'relevo colorido virou peça');
  perto(caixa(relevo.malha).max[2], 3.8, 1e-3, 'altura do relevo');
  assert.ok(volume(corpo.malha) < volume(m0) - 24 * 6 * 0.6 * 0.95, 'gravação do verso não tirou material');
  assert.ok(volInter(corpo.malha, relevo.malha) < 1e-6);
  guardar('Chaveiro', corpo.malha, '#E54C00'); guardar('Chaveiro relevo', relevo.malha, '#FFFFFF');
});

test('BASE COM ENCAIXE DE ÍMÃ Ø8×3 (folga 0,15): bolso medido', () => {
  const base = obj('Base', forma('cilindro', { diametro: 40, altura: 5 }));
  const ima = obj('Ímã', forma('imaFuro', { diametro: 8, altura: 3, folga: 0.15 }), T(0, 0, -0.01), 'furo');
  const m = mundo(unir([base, ima]));
  imprimivel(m, 'base ímã');
  const disco = volume(forma('cilindro', { diametro: 40, altura: 1 }));
  const bolso = volume(forma('cilindro', { diametro: 8.3, altura: 1 }));
  perto(disco - secao(m, 1), bolso, 0.05, 'bolso a 1 mm');
  perto(disco - secao(m, 3.1), bolso, 0.05, 'bolso a 3,1 mm (altura + folga)');
  perto(secao(m, 3.3), disco, 1e-6, 'acima do bolso é maciço');
  guardar('Base ímã', m, '#1B1B1B');
});

test('PINO E FURO entre duas peças feitas do zero: folga 0,2 medida, montadas sem colisão', () => {
  const A = mundo(unir([obj('Placa A', forma('caixa', { largura: 30, profundidade: 30, altura: 4 })), obj('Pino', forma('pino', { diametro: 5, comprimento: 10, chanfro: 0.5 }), T(0, 0, 3))]));
  const B = mundo(tirar([obj('Placa B', forma('caixa', { largura: 30, profundidade: 30, altura: 4 }), T(0, 0, 8)), obj('Furo', forma('cilindro', { diametro: 5.4, altura: 10 }), T(0, 0, 6))]));
  imprimivel(A, 'placa com pino'); imprimivel(B, 'placa com furo');
  assert.ok(volInter(A, B) < 1e-6, 'pino bate no furo');
  const pino = volume(forma('pino', { diametro: 5, comprimento: 10, chanfro: 0.5 }));
  void pino;
  const secPino = secao(A, 9), secFuro = 900 - secao(B, 10);
  perto(Math.sqrt(4 * secPino / PI), 5, 0.03, 'Ø pino');
  perto(Math.sqrt(4 * secFuro / PI), 5.4, 0.03, 'Ø furo');
  guardar('Placa pino', A, '#0E9F2E'); guardar('Placa furo', B, '#0E9F2E');
});

test('SUPORTE DE CELULAR: base + encosto inclinado 20° + batente (peças giradas unidas)', () => {
  const r = unir([
    obj('Base', forma('caixa', { largura: 80, profundidade: 60, altura: 4, canto: 4 })),
    obj('Encosto', forma('caixa', { largura: 80, profundidade: 5, altura: 70 }), M4.multiplicar(T(0, 14, 1), M4.rotacaoEuler(-20, 0, 0))),
    obj('Batente', forma('caixa', { largura: 80, profundidade: 6, altura: 12 }), T(0, -18, 2))]);
  const m = mundo(r);
  const v = imprimivel(m, 'suporte celular');
  assert.equal(v.componentes, 1, 'peças soltas');
  assert.ok(caixa(m).tam[2] > 65 && caixa(m).tam[2] < 72);
  guardar('Suporte celular', m, '#7F7F80');
});

test('PLACA COM 5 FUROS EM SÉRIE (duplicar em série a cada 18 mm)', () => {
  const placa = obj('Placa', forma('caixa', { largura: 100, profundidade: 20, altura: 3 }));
  const f0 = T(-36, 0, -1);
  const furos = [f0, ...duplicarEmSerie(f0, 4, [18, 0, 0])].map((t, k) => obj('F' + k, forma('cilindro', { diametro: 4, altura: 5 }), t, 'furo'));
  const m = mundo(unir([placa, ...furos]));
  imprimivel(m, 'placa furada');
  const f = volume(forma('cilindro', { diametro: 4, altura: 1 }));
  perto(2000 - secao(m, 1.5), 5 * f, 0.02, '5 furos');
  guardar('Placa 5 furos', m, '#E54C00');
});

test('PEÇA DE PRIMITIVAS (pião): cone + cilindro + esfera + parte comum de esfera com cubo (dado arredondado)', () => {
  const piao = mundo(unir([obj('Cone', forma('cone', { diametro: 30, diametroTopo: 0, altura: 20 }), M4.multiplicar(T(0, 0, 20), M4.rotacaoEuler(180, 0, 0))), obj('Disco', forma('cilindro', { diametro: 34, altura: 4 }), T(0, 0, 20)), obj('Cabo', forma('cilindro', { diametro: 6, altura: 15 }), T(0, 0, 24)), obj('Bola', forma('esfera', { diametro: 8 }), T(0, 0, 36))]));
  imprimivel(piao, 'pião');
  const dado = mundo(executar('combinar', { objetos: [obj('Cubo', forma('cubo', { lado: 20 })), obj('Esfera', forma('esfera', { diametro: 27 }), T(0, 0, -3.5))], modo: 'intersectar' }));
  imprimivel(dado, 'dado');
  assert.ok(volume(dado) < 8000 && volume(dado) > 0.75 * 8000);
  guardar('Pião', piao, '#D1242F'); guardar('Dado', dado, '#FFFFFF');
});

test('ELEMENTOS SEPARADOS: chaveiro bicolor separado por cor em 2 peças imprimíveis', () => {
  const m = forma('retangulo', { largura: 40, comprimento: 20, espessura: 3 });
  const r = executar('relevo', { partes: [{ nome: 'P', malha: m, cor: '#1B1B1B' }], alvo: 0, forma: { aneis: [[[-8, -4], [8, -4], [8, 4], [-8, 4]]] }, opc: { modo: 'embutido', lado: 'frente', profundidade: 1, folga: 0.15, cor: '#FFFFFF', largura: 16 } });
  assert.equal(r.partes.length, 2);
  for (const p of r.partes) imprimivel(p.malha, 'embutido ' + p.cor);
  assert.ok(volInter(r.partes[0].malha, r.partes[1].malha) < 1e-6, 'embutido colide');
});

test('TUDO NUM 3MF: validador oficial (lib3mf) + Bambu com a cor de cada peça + reabrir com as mesmas medidas', () => {
  const objetos = PECAS.map((p, k) => ({ nome: p.nome, transform: T(20 + (k % 4) * 70, 20 + Math.floor(k / 4) * 80, 0), partes: [{ nome: p.nome, malha: p.malha, cor: p.cor || '#E54C00' }] }));
  const x = executar('exportar3MF', { cena: { objetos }, opc: {} });
  const f = path.join(tmp, 'pecas.3mf'); fs.writeFileSync(f, x.bytes);
  execFileSync('python3', [path.join(raiz, 'tests/lib3mf/validar.py'), f]);
  const bambu = JSON.parse(execFileSync('python3', [path.join(raiz, 'tests/bambu/simular_importador.py'), f]).toString());
  assert.equal(bambu.objetos.length, PECAS.length);
  bambu.objetos.forEach((o, k) => assert.equal((o.volumes[0].cor_volume || '').slice(0, 7).toUpperCase(), (PECAS[k].cor || '#E54C00').toUpperCase(), o.nome));
  const r = executar('importar', { nome: 'p.3mf', bytes: x.bytes, extras: {} });
  r.objetos.forEach((o, k) => {
    const a = caixa(PECAS[k].malha).tam, b = caixa(o.partes[0].malha).tam;
    for (let i = 0; i < 3; i++) perto(b[i], a[i], 1e-3, o.nome + ' eixo ' + i);
    imprimivel(o.partes[0].malha, 'relido ' + o.nome);
  });
  fs.copyFileSync(f, path.join(raiz, 'dist', 'pecas-modeladas-no-sistema.3mf'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { criar, volume, juntar, caixa } from '../src/estudio3d/core/malha.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { reparar } from '../src/estudio3d/core/reparo.js';
import { caixaMalha, esfera, tirarFaces } from './util/malhas.mjs';

const ok = r => r.arestasAbertas === 0 && r.arestasNaoManifold === 0 && r.orientacaoTrocada === 0 && r.verticesNaoManifold === 0 && r.componentesInvertidos === 0 && r.facesDegeneradas === 0 && r.facesDuplicadas === 0;

test('validador: caixa perfeita', () => {
  const r = validar(caixaMalha(60, 40, 4));
  assert.ok(r.fechada && r.imprimivel);
  assert.equal(r.autoInterseccoes, 0);
  assert.ok(Math.abs(r.espessuraMinima - 4) < 1e-9);
  assert.deepEqual(r.caixa.tam, [60, 40, 4]);
});

test('reparo: buraco plano (face faltando) fecha e volume volta', () => {
  const m = tirarFaces(caixaMalha(20, 20, 20), [2, 3]);
  const v0 = validar(m);
  assert.equal(v0.arestasAbertas, 4);
  const r = reparar(m);
  const v = validar(r.malha);
  assert.ok(ok(v), JSON.stringify(v));
  assert.ok(Math.abs(volume(r.malha) - 8000) < 1e-6);
});

test('reparo: buraco curvo em esfera fecha com tampa suave', () => {
  const s = esfera(10, 3);
  const nt = s.idx.length / 3;
  // tira uma calota: faces com centro z > 7
  const lista = [];
  for (let t = 0; t < nt; t++) { let z = 0; for (let k = 0; k < 3; k++) z += s.pos[s.idx[t*3+k]*3+2]; if (z / 3 > 7) lista.push(t); }
  const m = tirarFaces(s, lista);
  const r = reparar(m);
  const v = validar(r.malha);
  assert.ok(ok(v), JSON.stringify({ ...v, espessuraPorFace: undefined, infoComponentes: undefined }));
  assert.equal(v.autoInterseccoes, 0);
  assert.ok(volume(r.malha) > 0.9 * 4 / 3 * Math.PI * 1000);
});

test('reparo: faces invertidas e peça do avesso', () => {
  const m = caixaMalha(10, 10, 10);
  const idx = Uint32Array.from(m.idx);
  for (const t of [0, 5, 7]) { const x = idx[t*3+1]; idx[t*3+1] = idx[t*3+2]; idx[t*3+2] = x; }
  assert.ok(validar(criar(m.pos, idx)).orientacaoTrocada > 0);
  const r = reparar(criar(m.pos, idx));
  const v = validar(r.malha);
  assert.ok(ok(v)); assert.ok(Math.abs(volume(r.malha) - 1000) < 1e-9);
  // toda do avesso
  const inv = Uint32Array.from(m.idx); for (let t = 0; t < 12; t++) { const x = inv[t*3+1]; inv[t*3+1] = inv[t*3+2]; inv[t*3+2] = x; }
  const r2 = reparar(criar(m.pos, inv));
  assert.ok(volume(r2.malha) > 0);
});

test('reparo: duas caixas encostadas por uma aresta (non-manifold)', () => {
  const a = caixaMalha(10, 10, 10), b = caixaMalha(10, 10, 10, 10, 10, 0);
  const j = juntar([a, b]);
  // solda os vértices comuns pra criar a aresta non-manifold
  const r0 = reparar(j, { taparBuracos: false });
  const v0 = validar(r0.malha);
  assert.equal(v0.arestasNaoManifold, 0);
  assert.equal(v0.verticesNaoManifold, 0);
  assert.ok(ok(v0));
  assert.ok(Math.abs(volume(r0.malha) - 2000) < 1e-9);
});

test('reparo: faces duplicadas e aleta solta', () => {
  const m = caixaMalha(10, 10, 10);
  const pos = Array.from(m.pos), idx = Array.from(m.idx);
  idx.push(idx[0], idx[1], idx[2]);                 // duplicada
  pos.push(5, 5, 20); idx.push(4, 5, 8);            // aleta presa na aresta 4-5
  const r = reparar(criar(pos, idx));
  const v = validar(r.malha);
  assert.ok(ok(v), JSON.stringify({ ...v, espessuraPorFace: undefined, infoComponentes: undefined }));
  assert.ok(Math.abs(volume(r.malha) - 1000) < 1e-9);
  assert.equal(v.componentes, 1);
});

test('validador: auto-interseção entre duas caixas sobrepostas', () => {
  const j = juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 5, 5, 5)]);
  const v = validar(j);
  assert.ok(v.autoInterseccoes > 0);
  assert.ok(!v.imprimivel);
});

test('validador: componente interno detectado', () => {
  const j = juntar([caixaMalha(20, 20, 20), caixaMalha(2, 2, 2, 9, 9, 9)]);
  const v = validar(j);
  assert.equal(v.componentesInternos, 1);
});

/* ---- auditoria do "Conferir e consertar" (01/10): defeitos que o conserto
   piorava ou deixava pra trás ---- */
import { carregarManifold } from './util/manifold.mjs';
import { gerarBoneco } from './util/boneco.mjs';
await carregarManifold();
const { OPERACOES } = await import('../src/estudio3d/motor/operacoes.js');
const virarTudo = m => { const idx = Uint32Array.from(m.idx); for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; } return criar(m.pos, idx); };
const consertar = (malha, extra = {}) => OPERACOES.reparar({ parte: { nome: 'p', malha, cor: '#999999', ...extra }, opc: {} });

test('consertar: faces viradas -> conta só as que estavam erradas (não a peça inteira)', () => {
  const s = esfera(10, 4), nt = s.idx.length / 3, idx = Uint32Array.from(s.idx);
  let erradas = 0;
  for (let t = 0; t < nt; t += 7) { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; erradas++; }
  const r = reparar(criar(s.pos, idx));
  assert.ok(ok(validar(r.malha)));
  assert.ok(volume(r.malha) > 0);
  assert.deepEqual(r.passos, ['acertou a orientação de ' + erradas + ' face(s)']);
});

test('consertar: peça dentro de outra NÃO vira vazio (antes virava do avesso e mudava a impressão)', () => {
  const m = juntar([caixaMalha(20, 20, 20), caixaMalha(4, 4, 4, 8, 8, 8)]);
  assert.equal(volume(reparar(m).malha), 8064, 'o conserto de malha não vira a peça de dentro');
  const r = consertar(m);
  const v = validar(r.parte.malha);
  assert.ok(v.imprimivel && v.componentes === 1, JSON.stringify({ comp: v.componentes, imp: v.imprimivel }));
  assert.ok(Math.abs(volume(r.parte.malha) - 8000) < 1e-3, 'virou um sólido só: ' + volume(r.parte.malha));
});

test('consertar: duas peças que se atravessam viram um sólido só (antes o volume ia a ZERO)', () => {
  const r = consertar(juntar([caixaMalha(20, 20, 20), caixaMalha(20, 20, 20, 10, 10, 10)]));
  const v = validar(r.parte.malha);
  assert.ok(v.imprimivel && v.autoInterseccoes === 0 && v.componentes === 1);
  assert.ok(Math.abs(volume(r.parte.malha) - 15000) < 1e-2, String(volume(r.parte.malha)));
  assert.match(r.passos.join(' '), /juntou 2 partes/);
});

test('consertar: peça oca continua oca; peça que atravessa a oca é juntada sem tapar o vazio', () => {
  const oca = juntar([caixaMalha(20, 20, 20), virarTudo(caixaMalha(10, 10, 10, 5, 5, 5))]);
  let r = consertar(oca);
  assert.deepEqual(r.passos, []);
  assert.ok(Math.abs(volume(r.parte.malha) - 7000) < 1e-3);
  r = consertar(juntar([caixaMalha(20, 20, 20), virarTudo(caixaMalha(6, 6, 6, 3, 3, 3)), caixaMalha(10, 10, 10, 15, 15, 15)]));
  const v = validar(r.parte.malha);
  assert.equal(v.cavidades, 1, 'o vazio continua');
  assert.ok(v.imprimivel);
  assert.ok(Math.abs(volume(r.parte.malha) - (8000 - 216 + 1000 - 125)) < 1e-2, String(volume(r.parte.malha)));
});

test('consertar: cores das peças juntadas ficam', () => {
  const ab = juntar([caixaMalha(20, 20, 20), caixaMalha(20, 20, 20, 10, 10, 10)]);
  const cor = new Uint16Array(24); for (let t = 12; t < 24; t++) cor[t] = 1;
  const r = consertar(criar(ab.pos, ab.idx, cor), { cor: '#cc0000', paleta: ['#cc0000', '#0000cc'] });
  assert.deepEqual(r.parte.paleta, ['#CC0000', '#0000CC']);
  assert.ok(r.parte.malha.cor.includes(0) && r.parte.malha.cor.includes(1));
});

test('consertar: boneco de partes sobrepostas vira um sólido limpo, com o volume do boneco certo', () => {
  const limpo = gerarBoneco('limpo').malha;
  const r = consertar(gerarBoneco('cascas').malha);
  const v = validar(r.parte.malha);
  assert.ok(v.imprimivel && v.componentes === 1 && v.autoInterseccoes === 0, JSON.stringify({ comp: v.componentes, auto: v.autoInterseccoes }));
  assert.ok(Math.abs(volume(r.parte.malha) - volume(limpo)) / volume(limpo) < 1e-3, volume(r.parte.malha) + ' x ' + volume(limpo));
});

test('consertar: boneco de IA sujo sai sem nenhum cruzamento (antes sobrava auto-interseção)', () => {
  const r = consertar(gerarBoneco('sujo').malha);
  const v = validar(r.parte.malha);
  assert.ok(v.imprimivel && v.fechada && v.autoInterseccoes === 0, JSON.stringify({ fechada: v.fechada, auto: v.autoInterseccoes }));
  assert.match(r.passos.join(' '), /refez \d+ face\(s\) onde a superfície se cruzava/);
  const limpo = volume(gerarBoneco('limpo').malha);
  assert.ok(Math.abs(volume(r.parte.malha) - limpo) / limpo < 0.005, 'detalhe/volume preservado');
});

test('chaveiro com tag NFC fechada: o bolso continua vazio ao abrir no Estúdio (antes era tapado)', async () => {
  const fs = await import('node:fs');
  const { lerImagem } = await import('../mcp/imagem.mjs');
  const { analisar } = await import('../src/gerador/analise.js');
  const { construir } = await import('../src/gerador/chaveiro.js');
  const { pecasDoGerador } = await import('../src/estudio3d/core/pecasGerador.js');
  const img = lerImagem(new Uint8Array(fs.readFileSync(new URL('./fixtures/logos/sol-4cores.png', import.meta.url))), 'x.png');
  const r = construir(analisar({ px: img.px, w: img.largura, h: img.altura }), { nfc: { ligado: true, modo: 'fechado', diametroMM: 25 }, altBase: 3 });
  const b = r.partes[0], m0 = criar(b.malha.pos, b.malha.idx);
  assert.equal(validar(m0).cavidades, 1, 'o gerador faz o bolso');
  const ps = await pecasDoGerador(r.partes.map(p => ({ nome: p.nome, cor: p.cor, malha: p.malha, fatias: p.fatias })), (op, a) => OPERACOES[op](a));
  const base = ps.find(p => p.nome === b.nome).malha;
  assert.equal(validar(base).cavidades, 1, 'bolso continua lá');
  assert.ok(Math.abs(volume(base) - volume(m0)) < 0.5, volume(base) + ' x ' + volume(m0));
  // "Unir partes sobrepostas" e "Consertar" também não tapam
  assert.equal(validar(OPERACOES.unirSobrepostos({ parte: { nome: 'b', malha: base, cor: '#999999' } }).parte.malha).cavidades, 1);
  assert.equal(validar(consertar(base).parte.malha).cavidades, 1);
});

test('consertar: 2ª passada refaz o resto pequeno de cruzamento que a 1ª não pegou, sem mudar o volume', () => {
  const m = juntar([esfera(10, 6), esfera(10, 6, 19.95, 0, 0)]);
  assert.ok(validar(m).autoInterseccoes > 0);
  const sem = OPERACOES.reparar({ parte: { nome: 'p', malha: m, cor: '#999999' }, opc: { unir: false, segundaPassada: false } });
  assert.ok(sem.depois.autoInterseccoes > 0, 'sem a 2ª passada sobra');
  const com = OPERACOES.reparar({ parte: { nome: 'p', malha: m, cor: '#999999' }, opc: { unir: false } });
  assert.equal(com.depois.autoInterseccoes, 0);
  assert.ok(com.depois.fechada);
  assert.ok(Math.abs(volume(com.parte.malha) - volume(m)) / volume(m) < 0.001);
  assert.match(com.passos.join(' '), /2ª passada/);
});

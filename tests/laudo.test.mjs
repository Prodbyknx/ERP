// Laudo × conserto falando a mesma língua (auditoria A5, A6, M3):
//  - o Consertar só diz que consertou o que o laudo apontou, e a 2ª vez não
//    tem mais nada (antes: peças encostadas por aresta davam "soldou/separou"
//    a cada clique; a base do chaveiro do gerador "tinha" defeito só pro conserto);
//  - espessura não dá alarme falso (casca sobreposta, dobra de 1 face) e
//    continua achando parede fina de verdade (chapa, peça oca);
//  - "pronto pra imprimir" é uma regra só.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha } from './util/malhas.mjs';
import { cabecaIA } from './util/cabeca-ia.mjs';
import { juntar, criar, inverterOrdem } from '../src/estudio3d/core/malha.js';
import { validar, defeitosGraves } from '../src/estudio3d/core/validador.js';
import { OPERACOES } from '../src/estudio3d/motor/operacoes.js';
import { lerImagem } from '../mcp/imagem.mjs';
import { analisar } from '../src/gerador/analise.js';
import { construir } from '../src/gerador/chaveiro.js';

await carregarManifold();
const consertar = (malha, nome = 'p') => OPERACOES.reparar({ parte: { nome, malha, cor: '#888888' }, opc: {} });

test('conserto estável: peças encostadas por aresta / por canto não "consertam" nada (nem na 1ª vez)', () => {
  for (const m of [juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 10, 10, 0)]), juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 10, 10, 10)])]) {
    const v = validar(m);
    assert.equal(v.verticesDuplicados, 0, 'encostado não é costura aberta');
    assert.ok(v.verticesSobrepostos > 0, 'mas o laudo informa os pontos encostados');
    assert.ok(v.imprimivel);
    const r1 = consertar(m);
    assert.deepEqual(r1.passos, []);
    assert.deepEqual(consertar(r1.parte.malha).passos, []);
  }
});

test('costura aberta de verdade (STL sem solda) continua sendo soldada e o laudo aponta antes', () => {
  // cubo com as faces de cima soltas (vértices repetidos com folga minúscula)
  const c = caixaMalha(10, 10, 10);
  const pos = Array.from(c.pos), idx = Array.from(c.idx);
  const nv = pos.length / 3;
  for (let t = 0; t < idx.length; t += 3) {
    if ([idx[t], idx[t + 1], idx[t + 2]].every(v => pos[v * 3 + 2] > 9)) {
      for (let k = 0; k < 3; k++) { const v = idx[t + k]; pos.push(pos[v * 3] + 1e-7, pos[v * 3 + 1], pos[v * 3 + 2]); idx[t + k] = pos.length / 3 - 1; }
    }
  }
  const m = criar(pos, idx);
  assert.ok(pos.length / 3 > nv);
  const v = validar(m);
  assert.ok(v.verticesDuplicados > 0 && v.arestasAbertas > 0, 'laudo mostra a costura');
  const r = consertar(m);
  assert.ok(r.passos.some(p => /soldou/.test(p)));
  assert.ok(r.depois.imprimivel);
  assert.deepEqual(consertar(r.parte.malha).passos, []);
});

test('chaveiro do gerador: o laudo e o Consertar concordam (nada pra consertar)', () => {
  const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'logos');
  const logos = JSON.parse(fs.readFileSync(path.join(pasta, 'logos.json'), 'utf8')).filter(l => /texto-fino|escudo-3cores-jpg|texto-branco-fundo-preto/.test(l.nome));
  assert.ok(logos.length >= 3);
  for (const l of logos) {
    const img = lerImagem(new Uint8Array(fs.readFileSync(path.join(pasta, l.arquivo))), l.arquivo);
    const r = construir(analisar({ px: img.px, w: img.largura, h: img.altura }), {});
    for (const p of r.partes) {
      const m = criar(Float64Array.from(p.malha.pos), p.malha.idx);
      const v = validar(m);
      assert.ok(v.imprimivel, l.nome + '/' + p.nome + ' imprimível no laudo');
      assert.deepEqual(consertar(m, p.nome).passos, [], l.nome + '/' + p.nome + ': conserto achou o que o laudo não achou');
    }
  }
});

test('espessura: casca sobreposta não vira parede de 0,00 mm', () => {
  const v = validar(juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 9.999, 0, 0)]));
  assert.ok(v.espessuraMinima > 9.9, 'mínima ' + v.espessuraMinima);
  assert.equal(v.regioesCriticas, 0);
});

test('espessura: parede de peça oca (vazio por dentro) é medida', () => {
  const fora = caixaMalha(20, 20, 20), vazio = caixaMalha(16, 16, 16, 2, 2, 2);
  const m = juntar([fora, criar(vazio.pos, inverterOrdem(vazio.idx))]);
  const v = validar(m);
  assert.ok(Math.abs(v.espessuraMinima - 2) < 1e-6, 'mínima ' + v.espessuraMinima);
});

test('espessura: chapa fina de verdade (0,5 mm) continua apontada', () => {
  const v = validar(caixaMalha(20, 20, 0.5));
  assert.ok(Math.abs(v.espessuraMinima - 0.5) < 1e-6);
  assert.ok(v.regioesCriticas >= 1);
});

test('espessura: cabeça de IA consertada não dá 0,0002 mm por causa de 1 face dobrada', () => {
  const m = cabecaIA();
  const r = consertar(m.malha || m);
  assert.ok(r.depois.espessuraMinima > 0.5, 'mínima ' + r.depois.espessuraMinima);
});

test('regra única: face degenerada impede "pronto pra imprimir" no laudo e conta como defeito', () => {
  const c = caixaMalha(10, 10, 10);
  const m = criar(c.pos, [...c.idx, 0, 1, 1]);
  const v = validar(m);
  const g = defeitosGraves(v);
  assert.ok(!v.imprimivel);
  assert.ok(g.total > 0 && g.tipos.includes('faces degeneradas'));
  assert.equal(defeitosGraves(validar(c)).total, 0);
});

// Histórico da cena (Cena.aplicar): operação que dá erro no meio não pode
// deixar a cena pela metade (auditoria, erros silenciosos item 10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Cena, novoObjeto } from '../src/estudio3d/ui/cena.js';
import { caixaMalha } from './util/malhas.mjs';

test('Cena.aplicar: erro no meio volta tudo (objetos, seleção, placas), sem entrada de desfazer', () => {
  const c = new Cena();
  const a = novoObjeto({ nome: 'A', partes: [{ nome: 'A', malha: caixaMalha(10, 10, 10) }] });
  const b = novoObjeto({ nome: 'B', partes: [{ nome: 'B', malha: caixaMalha(5, 5, 5) }] });
  c.aplicar('abrir', () => { c.objetos.push(a, b); c.sel = { objeto: a.id, parte: null }; });
  const pilha = c.pilhaDesfazer.length;
  let mudou = null;
  c.on('mudou', d => { mudou = d; });
  assert.throws(() => c.aplicar('quebra', () => {
    a.partes[0].malha = caixaMalha(1, 1, 1);         // mexeu numa peça...
    c.objetos = c.objetos.filter(o => o !== b);      // ...tirou outra...
    c.adicionarPlaca();
    throw new Error('falhou no meio');                // ...e deu erro
  }), /falhou no meio/);
  assert.equal(c.objetos.length, 2, 'B voltou');
  assert.equal(c.objetos[0].partes[0].malha.pos.length, caixaMalha(10, 10, 10).pos.length, 'malha de A voltou');
  assert.equal(c.placas, 1);
  assert.equal(c.sel.objeto, a.id);
  assert.equal(c.pilhaDesfazer.length, pilha, 'erro não vira entrada de desfazer');
  assert.ok(mudou && mudou.falhou, 'a tela é avisada pra redesenhar');
});

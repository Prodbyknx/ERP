// Função erp-users (seguranca/supabase/functions/erp-users): só ADMIN conferido
// no servidor, validação de tudo e o último ADMIN nunca sai. Banco de mentira
// em memória com o mesmo contrato do index.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tratar, cabecalhosCors, Recusa } from '../seguranca/supabase/functions/erp-users/logica.js';

const A = '00000000-0000-4000-8000-00000000000a', V = '00000000-0000-4000-8000-00000000000b';
function banco() {
  const contas = new Map([[A, { email: 'dono@x.com', senha: 'senha-dono' }], [V, { email: 'ana@x.com', senha: 'senha-ana1' }]]);
  const perfis = new Map([[A, { id: A, nome: 'Dono', login: 'dono@x.com', perfil: 'ADMIN' }], [V, { id: V, nome: 'Ana', login: 'ana@x.com', perfil: 'VENDEDOR' }]]);
  let n = 0;
  return {
    contas, perfis, falharPerfil: false,
    async usuarioDoToken(t) { return { 'tok-dono': { id: A }, 'tok-ana': { id: V } }[t] || null; },
    async perfil(id) { return perfis.get(id) || null; },
    async contarAdmins() { return [...perfis.values()].filter(p => p.perfil === 'ADMIN').length; },
    async criarConta(email, senha) { if ([...contas.values()].some(c => c.email === email)) throw new Recusa(400, 'Já existe uma conta com este e-mail'); const id = '00000000-0000-4000-8000-0000000001' + String(++n).padStart(2, '0'); contas.set(id, { email, senha }); return id; },
    async apagarConta(id) { contas.delete(id); },
    async trocarSenha(id, senha) { contas.get(id).senha = senha; },
    async gravarPerfil(p) { if (this.falharPerfil) throw new Error('banco fora'); perfis.set(p.id, { ...p }); },
    async mudarPerfil(id, m) { Object.assign(perfis.get(id), m); },
    async apagarPerfil(id) { perfis.delete(id); }
  };
}
const recusa = async (p, status, re) => { await assert.rejects(p, e => e instanceof Recusa && e.status === status && re.test(e.message)); };

test('erp-users: sem login, token inválido ou vendedor -> recusado (401/403), nada muda', async () => {
  const db = banco();
  await recusa(tratar('', { action: 'delete', id: V }, db), 401, /Entre/);
  await recusa(tratar('tok-falso', { action: 'delete', id: V }, db), 401, /Sessão/);
  for (const c of [{ action: 'create', nome: 'X', login: 'x@x.com', senha: '12345678', perfil: 'ADMIN' }, { action: 'update', id: V, nome: 'Ana', perfil: 'ADMIN' }, { action: 'password', id: A, senha: 'nova-senha' }, { action: 'delete', id: A }])
    await recusa(tratar('tok-ana', c, db), 403, /Requer ADMIN/);
  assert.equal(db.perfis.get(V).perfil, 'VENDEDOR'); assert.equal(db.contas.get(A).senha, 'senha-dono'); assert.equal(db.perfis.size, 2);
});

test('erp-users: ADMIN cria, edita, troca senha e apaga — com validação', async () => {
  const db = banco();
  const { id } = await tratar('tok-dono', { action: 'create', id: '', nome: ' Caio ', login: 'Caio@X.com', senha: 'senha-boa', perfil: 'VENDEDOR' }, db);
  assert.deepEqual(db.perfis.get(id), { id, nome: 'Caio', login: 'caio@x.com', perfil: 'VENDEDOR' });
  await recusa(tratar('tok-dono', { action: 'create', nome: 'C2', login: 'caio@x.com', senha: 'senha-boa', perfil: 'VENDEDOR' }, db), 400, /Já existe/);
  await recusa(tratar('tok-dono', { action: 'create', nome: 'C3', login: 'sem-arroba', senha: 'senha-boa', perfil: 'VENDEDOR' }, db), 400, /e-mail/);
  await recusa(tratar('tok-dono', { action: 'create', nome: 'C3', login: 'c3@x.com', senha: '123', perfil: 'VENDEDOR' }, db), 400, /senha/);
  await recusa(tratar('tok-dono', { action: 'create', nome: 'C3', login: 'c3@x.com', senha: 'senha-boa', perfil: 'DONO' }, db), 400, /Perfil/);
  await recusa(tratar('tok-dono', { action: 'update', id: "x' or 1=1", nome: 'a', perfil: 'ADMIN' }, db), 400, /inválido/);
  await recusa(tratar('tok-dono', { action: 'hackear' }, db), 400, /desconhecida/);
  await tratar('tok-dono', { action: 'update', id, nome: 'Caio Silva', perfil: 'ADMIN', senha: '' }, db);
  assert.equal(db.perfis.get(id).perfil, 'ADMIN'); assert.equal(db.perfis.get(id).nome, 'Caio Silva');
  await tratar('tok-dono', { action: 'password', id: V, senha: 'nova-senha-ana' }, db);
  assert.equal(db.contas.get(V).senha, 'nova-senha-ana');
  await tratar('tok-dono', { action: 'delete', id: V }, db);
  assert.ok(!db.perfis.has(V) && !db.contas.has(V));
  await recusa(tratar('tok-dono', { action: 'delete', id: V }, db), 404, /não encontrado/);
});

test('erp-users: ninguém se apaga/rebaixa, o último ADMIN não sai e conta sem perfil é desfeita', async () => {
  const db = banco();
  await recusa(tratar('tok-dono', { action: 'delete', id: A }, db), 400, /própria conta/);
  await recusa(tratar('tok-dono', { action: 'update', id: A, nome: 'Dono', perfil: 'VENDEDOR' }, db), 400, /próprio acesso/);
  // dois ADMIN: rebaixar o outro pode; o último não
  await tratar('tok-dono', { action: 'update', id: V, nome: 'Ana', perfil: 'ADMIN' }, db);
  await tratar('tok-dono', { action: 'update', id: V, nome: 'Ana', perfil: 'VENDEDOR' }, db);
  assert.equal(await db.contarAdmins(), 1);
  // falha ao gravar o perfil: a conta criada é apagada (não sobra login sem perfil)
  db.falharPerfil = true;
  await assert.rejects(tratar('tok-dono', { action: 'create', nome: 'X', login: 'x@x.com', senha: 'senha-boa', perfil: 'VENDEDOR' }, db), /banco fora/);
  assert.equal(db.contas.size, 2);
});

test('erp-users: CORS só libera o endereço do ERP', () => {
  const ok = ['https://erp.144labstore.com.br'];
  assert.equal(cabecalhosCors('https://erp.144labstore.com.br', ok)['Access-Control-Allow-Origin'], 'https://erp.144labstore.com.br');
  assert.equal(cabecalhosCors('https://site-do-golpe.com', ok)['Access-Control-Allow-Origin'], 'https://erp.144labstore.com.br');
});

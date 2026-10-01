// PROTEÇÃO NO SERVIDOR (seguranca/protecao-servidor.sql) num PostgreSQL de
// verdade que imita o Supabase e o banco do ERP como está hoje
// (fixtures/supabase/erp-original.sql). Primeiro prova as brechas do jeito
// atual; depois aplica a proteção e confere, como ADMIN, como vendedor e como
// visitante, que cada regra vale NO BANCO (não na tela) e que o uso normal
// (vender, baixar estoque, cadastrar) continua funcionando. Por fim, desfaz e
// confere que voltou a ser como era.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { pular, subirPostgres } from './util/postgres.mjs';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fix = n => path.join(raiz, 'tests', 'fixtures', 'supabase', n);
const SEG = n => path.join(raiz, 'seguranca', n);
const A = '00000000-0000-4000-8000-00000000000a';   // ADMIN
const B = '00000000-0000-4000-8000-00000000000b';   // vendedor, permissões padrão (tem Painel)
const C = '00000000-0000-4000-8000-00000000000c';   // vendedor só com Vendas, Orçamentos e Clientes
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const J = o => q(JSON.stringify(o)) + '::jsonb';

test('SUPABASE proteção no servidor: regras por perfil valem no banco, uso normal continua, e desfaz', { skip: pular, timeout: 180000 }, async () => {
  const pg = await subirPostgres();
  const DB = 'erp';
  try {
    assert.equal(pg.criar(DB).status, 0);
    for (const f of ['base.sql', 'erp-original.sql']) { const x = pg.arquivo(DB, fix(f)); assert.equal(x.status, 0, f + ': ' + x.stderr); }
    const semLogin = sql => pg.como(DB, null, sql);
    let x = semLogin(`
      insert into auth.users(id, email, email_confirmed_at) values (${q(A)}, 'dono@x.com', now()), (${q(B)}, 'ana@x.com', now()), (${q(C)}, 'caio@x.com', now());
      insert into public.profiles(id, nome, login, perfil) values (${q(A)}, 'Dono', 'dono@x.com', 'ADMIN'), (${q(B)}, 'Ana', 'ana@x.com', 'VENDEDOR'), (${q(C)}, 'Caio', 'caio@x.com', 'VENDEDOR');`);
    assert.ok(x.ok, x.stderr);

    const json = r => { assert.ok(r.ok, r.erro || r.stderr); return JSON.parse(r.linhas[r.linhas.length - 1]); };
    const commit = (quem, changes, restore = false, op = crypto.randomUUID()) =>
      pg.como(DB, quem, `select public.erp_commit_sync(${q(op)}, ${J(changes)}, ${restore});`);
    const ler = (quem, desde = '0') => json(pg.como(DB, quem, `select public.erp_changes(${q(desde)});`));

    // dados de um dia normal, gravados pelo ADMIN pela função original
    const cfg = { taxaML: 12, negocio: '144', permissoes: { [C]: ['sales', 'quote', 'clients'], 'outro-id': ['fin'] } };
    const prod = { id: 'p1', nome: 'Vaso', custo: '10,50', preco: 25, gramas: 80, estoque: 5, locais: { oficina: 5, ml: 0, shopee: 0 }, foto: '', categoria: 'Casa', printerId: 0, filamentId: 'f1' };
    const gasto = { id: 'e1', data: '2026-09-01', categoria: 'Filamento', valor: 120, descricao: 'PLA preto' };
    x = pg.como(DB, A, `select public.erp_commit_sync(${q(crypto.randomUUID())}::uuid, ${J([
      { collection: 'config', id: '_', before: null, after: cfg },
      { collection: 'products', id: 'p1', before: null, after: prod },
      { collection: 'expenses', id: 'e1', before: null, after: gasto },
      { collection: 'clients', id: 'c1', before: null, after: { id: 'c1', nome: 'Maria', whatsapp: '21999' } }])}, false);`);
    assert.ok(x.ok, x.stderr);

    // ---------------------------------------------------- ANTES: as brechas existem
    let r = pg.como(DB, C, `select count(*) from public.erp_records where collection = 'expenses';`);
    assert.equal(r.linhas.at(-1), '1', 'antes: vendedor lê os gastos direto na tabela');
    r = json(pg.como(DB, C, `select public.erp_changes(0);`));
    assert.ok(r.rows.some(l => l.collection === 'expenses'), 'antes: a função entrega os gastos a qualquer um');
    r = pg.como(DB, C, `update public.profiles set perfil = 'ADMIN' where id = ${q(C)} returning perfil;`);
    assert.equal(r.linhas.at(-1), 'ADMIN', 'antes: vendedor se promove a ADMIN');
    assert.ok(semLogin(`update public.profiles set perfil = 'VENDEDOR' where id = ${q(C)};`).ok);

    // ---------------------------------------------------- APLICA (duas vezes: tem que poder rodar de novo)
    for (let i = 0; i < 2; i++) {
      x = pg.arquivo(DB, SEG('protecao-servidor.sql'));
      assert.equal(x.status, 0, 'aplicar #' + (i + 1) + ': ' + x.stderr);
      assert.match(x.stdout, /PRONTO/);
    }

    // ---------------------------------------------------- VENDEDOR sem Painel/Financeiro/Relatórios
    r = ler(C);
    const cols = new Set(r.rows.map(l => l.collection));
    assert.ok(!cols.has('expenses'), 'vendedor sem Financeiro não recebe gastos');
    assert.ok(cols.has('products') && cols.has('clients') && cols.has('config'), 'recebe o resto');
    const cfgC = r.rows.find(l => l.collection === 'config').data;
    assert.deepEqual(Object.keys(cfgC.permissoes), [C], 'só as próprias permissões');
    assert.equal(cfgC.taxaML, 12);
    assert.match(r.cursor, /^\d+~p1$/, 'cursor marca as regras: ' + r.cursor);
    assert.equal(r.protegido, 1, 'o site reconhece a proteção pela resposta');
    const cursorC = r.cursor;
    // nada direto nas tabelas
    for (const t of ['erp_records', 'erp_deleted']) {
      r = pg.como(DB, C, `select count(*) from public.${t};`);
      assert.equal(r.linhas.at(-1), '0', t + ' direto: nada');
    }
    r = pg.como(DB, C, `select count(*), string_agg(login, ',') from public.profiles;`);
    assert.equal(r.linhas.at(-1), '1\tcaio@x.com', 'vê só o próprio perfil (sem e-mail dos outros)');
    r = pg.como(DB, C, `select erp_interno.chamar_changes('0');`);
    assert.match(r.erro || '', /permission denied for schema erp_interno/, 'funções originais fora do alcance');
    r = pg.como(DB, C, `update public.profiles set perfil = 'ADMIN' where id = ${q(C)};`);
    assert.equal(json(pg.como(DB, C, 'select public.erp_usuarios();')).eu.perfil, 'VENDEDOR', 'não se promove');
    r = json(pg.como(DB, C, 'select public.erp_usuarios();'));
    assert.equal(r.usuarios.length, 1);
    assert.equal(r.protegido, 1);
    assert.match(pg.como(DB, C, 'select public.erp_historico();').erro || '', /Requer ADMIN/);

    // uso normal do vendedor: vender e baixar o estoque (custo "10,50" volta normalizado 10.5: não é mudança)
    const venda = { id: 's1', data: '2026-09-30', produtoId: 'p1', qtd: 1, precoUnit: 25, custoUnit: 10.5, usuarioId: C, usuarioNome: 'Caio' };
    const prod2 = { ...prod, custo: 10.5, estoque: 4, locais: { oficina: 4, ml: 0, shopee: 0 } };
    x = commit(C, [{ collection: 'sales', id: 's1', before: null, after: venda }, { collection: 'products', id: 'p1', before: prod, after: prod2 }]);
    assert.ok(x.ok, 'venda do vendedor: ' + x.stderr);
    const recibo = JSON.parse(x.linhas.at(-1));
    assert.deepEqual(recibo.rows.map(l => l.collection), ['sales', 'products']);
    x = commit(C, [{ collection: 'clients', id: 'c2', before: null, after: { id: 'c2', nome: 'João' } }]);
    assert.ok(x.ok, 'cadastrar cliente: ' + x.stderr);

    // o que o vendedor NÃO faz (cada uma recusada pelo banco, com o motivo)
    const recusa = (changes, re, restore = false) => {
      const y = commit(C, changes, restore);
      assert.ok(!y.ok, 'devia recusar: ' + JSON.stringify(changes).slice(0, 120));
      assert.match(y.erro, re);
    };
    recusa([{ collection: 'products', id: 'p1', before: prod2, after: { ...prod2, preco: 30 } }], /preço, custo e ficha do produto \(campo preco\)/);
    recusa([{ collection: 'products', id: 'p1', before: prod2, after: { ...prod2, custo: 2 } }], /campo custo/);
    recusa([{ collection: 'products', id: 'p1', before: prod2, after: { ...prod2, nome: 'Vaso barato' } }], /campo nome/);
    recusa([{ collection: 'products', id: 'p9', before: null, after: { id: 'p9', nome: 'Novo', preco: 1 } }], /Cadastrar produto requer ADMIN/);
    recusa([{ collection: 'sales', id: 's1', before: venda, after: null }], /Exclusão requer ADMIN/);
    recusa([{ collection: 'config', id: '_', before: cfgC, after: { ...cfgC, permissoes: { [C]: ['fin', 'cfg'] } } }], /Configurações requer ADMIN/);
    recusa([{ collection: 'expenses', id: 'e2', before: null, after: { id: 'e2', valor: 1 } }], /gastos requer ADMIN/);
    recusa([{ collection: 'sales', id: 's1', before: venda, after: venda }], /Importar backup requer ADMIN/, true);
    recusa([{ collection: 'usuarios_hack', id: 'x', before: null, after: {} }], /Coleção desconhecida/);
    // o conflito da função original continua chegando igual
    recusa([{ collection: 'sales', id: 's1', before: { ...venda, qtd: 9 }, after: { ...venda, qtd: 2 } }], /Conflito em sales\/s1/);
    assert.equal(json(pg.como(DB, C, 'select public.erp_usuarios();')).eu.perfil, 'VENDEDOR');

    // ---------------------------------------------------- VENDEDOR com Painel (padrão): vê os gastos
    r = ler(B);
    assert.ok(r.rows.some(l => l.collection === 'expenses'), 'com Painel recebe os gastos (o Painel mostra Despesas)');
    assert.match(r.cursor, /~p1g$/);
    assert.deepEqual(Object.keys(r.rows.find(l => l.collection === 'config').data.permissoes), [], 'B não tem entrada: não vê a dos outros');

    // ---------------------------------------------------- ADMIN: tudo, igual antes
    r = ler(A);
    assert.ok(r.rows.some(l => l.collection === 'expenses'));
    assert.match(r.cursor, /^\d+$/, 'cursor do ADMIN é o de sempre');
    assert.equal(r.protegido, 1);
    assert.equal(Object.keys(r.rows.find(l => l.collection === 'config').data.permissoes).length, 2);
    const cfgA = r.rows.find(l => l.collection === 'config').data;
    // ADMIN dá Financeiro ao Caio: na próxima leitura (com o cursor velho) chegam os gastos ANTIGOS
    x = commit(A, [{ collection: 'config', id: '_', before: cfgA, after: { ...cfgA, permissoes: { ...cfgA.permissoes, [C]: ['sales', 'quote', 'clients', 'fin'] } } }]);
    assert.ok(x.ok, x.stderr);
    r = ler(C, cursorC);
    assert.ok(r.rows.some(l => l.collection === 'expenses' && l.id === 'e1'), 'ganhou Financeiro: recebe o gasto antigo');
    assert.match(r.cursor, /~p1g$/);
    const r2 = ler(C, r.cursor);
    assert.equal(r2.rows.length, 0, 'depois, só o que mudar');
    x = commit(A, [{ collection: 'products', id: 'p1', before: prod2, after: { ...prod2, preco: 29 } }]);
    assert.ok(x.ok, 'ADMIN muda preço: ' + x.stderr);
    x = commit(A, [{ collection: 'expenses', id: 'e1', before: gasto, after: null }]);
    assert.ok(x.ok, 'ADMIN exclui: ' + x.stderr);
    const u = json(pg.como(DB, A, 'select public.erp_usuarios();'));
    assert.deepEqual(u.usuarios.map(v => v.login).sort(), ['ana@x.com', 'caio@x.com', 'dono@x.com']);
    // perfis: ADMIN promove/rebaixa; o último ADMIN não sai
    assert.ok(pg.como(DB, A, `update public.profiles set perfil = 'ADMIN' where id = ${q(B)};`).ok);
    assert.ok(pg.como(DB, A, `update public.profiles set perfil = 'VENDEDOR' where id = ${q(B)};`).ok);
    assert.match(pg.como(DB, A, `update public.profiles set perfil = 'VENDEDOR' where id = ${q(A)};`).erro || '', /último ADMIN/);
    // a função de usuários (chave de serviço, sem usuário na requisição) continua podendo
    assert.ok(semLogin(`update public.profiles set nome = 'Ana Paula' where id = ${q(B)};`).ok);

    // histórico do servidor: quem fez o quê
    const h = json(pg.como(DB, A, 'select public.erp_historico();'));
    const vendaH = h.find(l => l.colecao === 'sales' && l.registro === 's1');
    assert.equal(vendaH.acao, 'criou'); assert.equal(vendaH.nome, 'Caio');
    const estoqueH = h.find(l => l.colecao === 'products' && l.nome === 'Caio');
    assert.deepEqual(estoqueH.campos, ['custo', 'estoque', 'locais'], 'campos que mudaram na baixa: ' + JSON.stringify(estoqueH.campos));
    assert.ok(h.some(l => l.colecao === 'expenses' && l.acao === 'apagou' && l.nome === 'Dono'));
    // mesma operação repetida (rede caiu e o site tentou de novo): mesmo recibo, sem duplicar histórico
    const op = crypto.randomUUID();
    const c3 = [{ collection: 'clients', id: 'c3', before: null, after: { id: 'c3', nome: 'Rita' } }];
    const a1 = commit(C, c3, false, op), a2 = commit(C, c3, false, op);
    assert.ok(a1.ok && a2.ok, a1.stderr + a2.stderr);
    assert.equal(a1.linhas.at(-1), a2.linhas.at(-1));
    assert.equal(json(pg.como(DB, A, 'select public.erp_historico();')).filter(l => l.registro === 'c3').length, 1);

    // tempo real: só um aviso sem dados, e o vendedor consegue ler o aviso
    r = pg.como(DB, C, 'select versao > 0, (select count(*) from jsonb_object_keys(to_jsonb(s))) from public.erp_sinal s;');
    assert.equal(r.linhas.at(-1), 't\t3');
    r = pg.como(DB, null, `select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'erp_sinal';`);
    assert.equal(r.linhas.at(-1), '1');

    // visitante: nada
    for (const f of [`public.erp_changes('0')`, 'public.erp_usuarios()', `public.erp_commit_sync('x', '[]', false)`]) {
      assert.match(pg.como(DB, 'anon', 'select ' + f + ';').erro || '', /permission denied/, f);
    }
    r = pg.como(DB, 'anon', 'select count(*) from public.erp_sinal;');
    assert.match(r.erro || '', /permission denied/);

    // a auditoria (auditoria-supabase.sql) não aponta FALHA no banco protegido
    x = pg.psql(DB, ['-At', '-F', '\t', '-f', SEG('auditoria-supabase.sql')], { env: { PGOPTIONS: '-c default_transaction_read_only=on' } });
    assert.equal(x.status, 0, x.stderr);
    const falhas = x.stdout.trim().split('\n').filter(l => l.startsWith('FALHA'));
    assert.deepEqual(falhas, [], 'auditoria: ' + falhas.join(' | '));

    // ---------------------------------------------------- DESFAZER: volta a como era (e dá pra aplicar de novo)
    x = pg.arquivo(DB, SEG('desfazer-protecao.sql'));
    assert.equal(x.status, 0, 'desfazer: ' + x.stderr);
    assert.match(x.stdout, /DESFEITO/);
    r = pg.como(DB, C, `select count(*) from public.erp_records where collection = 'products';`);
    assert.equal(r.linhas.at(-1), '1', 'política antiga de volta');
    r = json(pg.como(DB, C, 'select public.erp_changes(0);'));
    assert.ok(r.rows.length > 0 && /^\d+$/.test(r.cursor) && !r.protegido, 'função original de volta no lugar');
    r = pg.como(DB, null, `select count(*) from pg_namespace where nspname = 'erp_interno';`);
    assert.equal(r.linhas.at(-1), '0');
    r = pg.como(DB, 'anon', `select public.erp_changes(0);`);
    assert.match(r.erro || '', /permission denied/, 'visitante continua sem acesso depois de desfazer');
    x = pg.arquivo(DB, SEG('protecao-servidor.sql'));
    assert.equal(x.status, 0, 'aplicar de novo depois de desfazer: ' + x.stderr);
    assert.ok(!ler(C).rows.some(l => l.collection === 'expenses' && l.id === 'e1'));
  } finally {
    pg.parar();
  }
});

test('SUPABASE proteção: não aplica pela metade em banco diferente do esperado', { skip: pular, timeout: 120000 }, async () => {
  const pg = await subirPostgres();
  try {
    assert.equal(pg.criar('outro').status, 0);
    assert.equal(pg.arquivo('outro', fix('base.sql')).status, 0);
    // banco sem as tabelas do ERP: recusa com mensagem clara e não deixa nada criado
    let x = pg.arquivo('outro', SEG('protecao-servidor.sql'));
    assert.notEqual(x.status, 0);
    assert.match(x.stderr, /Não achei a tabela public\.erp_records/);
    let r = pg.como('outro', null, `select count(*) from pg_namespace where nspname = 'erp_interno';`);
    assert.equal(r.linhas.at(-1), '0', 'transação desfeita: nada ficou');
    // ERP com a função de leitura devolvendo outra coisa: também recusa
    assert.equal(pg.arquivo('outro', fix('erp-original.sql')).status, 0);
    assert.ok(pg.como('outro', null, `drop function public.erp_changes(bigint); create function public.erp_changes(since_revision bigint) returns setof int language sql as 'select 1';`).ok);
    x = pg.arquivo('outro', SEG('protecao-servidor.sql'));
    assert.notEqual(x.status, 0);
    assert.match(x.stderr, /erp_changes devolve integer/);
    r = pg.como('outro', null, `select count(*) from pg_proc where proname = 'erp_commit_sync' and pronamespace = 'public'::regnamespace;`);
    assert.equal(r.linhas.at(-1), '1', 'a original continua no lugar');
  } finally {
    pg.parar();
  }
});

// A auditoria do Supabase (seguranca/auditoria-supabase.sql) roda num
// PostgreSQL local que imita o Supabase: tem que achar cada erro do projeto
// INSEGURO, não apontar nada no SEGURO e rodar em transação só de leitura.
// Sem PostgreSQL instalado, o teste é pulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fix = n => path.join(raiz, 'tests', 'fixtures', 'supabase', n);
const AUDITORIA = path.join(raiz, 'seguranca', 'auditoria-supabase.sql');

function acharBin() {
  const dirs = fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse().map(v => '/usr/lib/postgresql/' + v + '/bin') : [];
  for (const d of [...dirs, ...(process.env.PATH || '').split(':')]) if (fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'pg_ctl'))) return d;
  return null;
}
const BIN = acharBin();
const root = process.getuid && process.getuid() === 0;
const temPostgresUser = root && spawnSync('id', ['postgres']).status === 0;
const pular = !BIN || !spawnSync('psql', ['--version']).stdout?.length ? 'sem PostgreSQL instalado' : (root && !temPostgresUser ? 'rodando como root sem o usuário postgres' : false);

test('SUPABASE auditoria: acha os erros do projeto inseguro, nada no seguro, e só lê', { skip: pular, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg144-'));
  const comoPg = cmd => root ? spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', cmd], { encoding: 'utf8' }) : spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
  if (root) spawnSync('chown', ['postgres', dir]);
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const psql = (db, args, env = {}) => spawnSync('psql', ['-h', dir, '-p', String(porta), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  try {
    let r = comoPg(`${BIN}/initdb -D ${dir}/data -A trust -U postgres >/dev/null && ${BIN}/pg_ctl -D ${dir}/data -w -o "-p ${porta} -k ${dir} -c listen_addresses=" -l ${dir}/log start >/dev/null`);
    assert.equal(r.status, 0, 'postgres não subiu: ' + r.stderr);
    const auditar = db => {
      for (const f of ['base.sql', db + '.sql']) {
        const x = psql(db, ['-f', fix(f)]);
        assert.equal(x.status, 0, f + ': ' + x.stderr);
      }
      // em transação SÓ DE LEITURA: se a auditoria tentasse gravar algo, dava erro
      const a = psql(db, ['-At', '-F', '\t', '-f', AUDITORIA], { PGOPTIONS: '-c default_transaction_read_only=on' });
      assert.equal(a.status, 0, 'auditoria falhou em ' + db + ': ' + a.stderr);
      return a.stdout.trim().split('\n').map(l => { const [status, item, objeto, detalhe] = l.split('\t'); return { status, item, objeto, detalhe }; });
    };
    for (const db of ['inseguro', 'seguro']) assert.equal(psql('postgres', ['-c', 'create database ' + db]).status, 0);

    const ins = auditar('inseguro');
    const tem = (st, item, obj) => ins.some(l => l.status === st && l.item.startsWith(item) && l.objeto.startsWith(obj));
    assert.ok(tem('FALHA', 'RLS', 'erp_records'), 'tabela sem RLS');
    assert.ok(tem('FALHA', 'Política', 'erp_deleted / tudo'), 'política aberta pra qualquer um');
    assert.ok(tem('FALHA', 'Função', 'erp_commit_sync'), 'função security definer sem login e restore sem ADMIN');
    assert.ok(ins.find(l => l.objeto.startsWith('erp_commit_sync')).detalhe.includes('restore'), 'aponta o restore sem ADMIN');
    assert.ok(ins.find(l => l.objeto.startsWith('erp_commit_sync')).detalhe.includes('EXECUTE'), 'aponta o SQL montado com texto');
    assert.ok(tem('FALHA', 'Mass assignment', 'profiles.perfil'), 'vendedor pode virar ADMIN');
    assert.ok(tem('FALHA', 'Tempo real', 'erp_records'), 'tempo real sem RLS');
    assert.ok(tem('ATENÇÃO', 'Função', 'erp_changes'), 'security definer sem search_path');
    assert.ok(tem('ATENÇÃO', 'View', 'resumo'), 'view que ignora RLS');
    assert.ok(tem('ATENÇÃO', 'Storage', 'fotos'), 'bucket público');
    assert.ok(tem('ATENÇÃO', 'Contas', 'auth.users'), 'conta sem perfil');
    assert.ok(!ins.some(l => /pgcrypto|gen_random|digest/.test(l.objeto)), 'funções de extensão ficam de fora');

    const seg = auditar('seguro');
    const ruins = seg.filter(l => l.status === 'FALHA' || l.status === 'ATENÇÃO');
    assert.deepEqual(ruins, [], 'projeto seguro não pode ter falha: ' + JSON.stringify(ruins));
    assert.ok(seg.filter(l => l.status === 'OK').length >= 10);
  } finally {
    comoPg(`${BIN}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null 2>&1`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

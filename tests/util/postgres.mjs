// PostgreSQL local de verdade para os testes de SQL (imita o Supabase com
// tests/fixtures/supabase/base.sql). Sem PostgreSQL instalado, `pular` diz o
// motivo e o teste é pulado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function acharBin() {
  const dirs = fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse().map(v => '/usr/lib/postgresql/' + v + '/bin') : [];
  for (const d of [...dirs, ...(process.env.PATH || '').split(':')]) if (fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'pg_ctl'))) return d;
  return null;
}
const BIN = acharBin();
const root = process.getuid && process.getuid() === 0;
const temPostgresUser = root && spawnSync('id', ['postgres']).status === 0;
export const pular = !BIN || !spawnSync('psql', ['--version']).stdout?.length ? 'sem PostgreSQL instalado' : (root && !temPostgresUser ? 'rodando como root sem o usuário postgres' : false);

export async function subirPostgres() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg144-'));
  const comoPg = cmd => root ? spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', cmd], { encoding: 'utf8' }) : spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
  if (root) spawnSync('chown', ['postgres', dir]);
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const r = comoPg(`${BIN}/initdb -D ${dir}/data -A trust -U postgres >/dev/null && ${BIN}/pg_ctl -D ${dir}/data -w -o "-p ${porta} -k ${dir} -c listen_addresses=" -l ${dir}/log start >/dev/null`);
  if (r.status !== 0) throw new Error('postgres não subiu: ' + r.stderr);
  const psql = (db, args, opc = {}) => spawnSync('psql', ['-h', dir, '-p', String(porta), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', ...args],
    { encoding: 'utf8', input: opc.input, env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning', ...(opc.env || {}) } });
  return {
    psql,
    arquivo: (db, f, env) => psql(db, ['-f', f], { env }),
    criar: db => psql('postgres', ['-c', 'create database ' + db]),
    // roda SQL como um usuário logado (papel authenticated + o "sub" do token),
    // como o PostgREST faz; `quem` = 'anon' roda como visitante.
    // Devolve { ok, linhas (saída), erro (mensagem do ERROR) }
    como(db, quem, sql) {
      const pre = quem === 'anon' ? "set local role anon;\n"
        : quem ? `set local role authenticated;\nselect set_config('request.jwt.claim.sub', '${quem}', true) \\g /dev/null\n` : '';
      const x = psql(db, ['-At', '-F', '\t'], { input: 'begin;\n' + pre + sql + '\ncommit;\n' });
      const erro = (/ERROR:\s+([^\n]*)/.exec(x.stderr) || [])[1] || null;
      return { ok: x.status === 0 && !erro, linhas: x.stdout.split('\n').filter(Boolean), erro, stderr: x.stderr };
    },
    // o que o PostgREST faria: chama a função com os argumentos por nome, como
    // o usuário do token, e devolve { status, body } no formato de erro dele
    // avisos (WARNING) que o banco deu nas chamadas pelo postgrest()
    avisos: [],
    postgrest(db) {
      const avisos = this.avisos;
      const lit = v => v === null || v === undefined ? 'null' : "'" + (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/'/g, "''") + "'";
      const rodar = (uid, sql) => {
        const pre = uid ? `set local role authenticated;\nselect set_config('request.jwt.claim.sub', '${uid}', true) \\g /dev/null\n` : 'set local role anon;\n';
        const x = psql(db, ['-At', '-v', 'VERBOSITY=verbose'], { input: 'begin;\n' + pre + sql + '\ncommit;\n' });
        const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(x.stderr);
        for (const w of x.stderr.matchAll(/WARNING:\s+(?:[0-9A-Z]{5}:\s+)?([^\n]*)/g)) avisos.push(w[1]);
        if (m) {
          const code = m[1];
          if (code === '42883') return { status: 404, body: { code: 'PGRST202', details: null, hint: null, message: 'Could not find the function' } };
          return { status: code === '42501' ? (uid ? 403 : 401) : 400, body: { code, details: null, hint: null, message: m[2] } };
        }
        if (x.status !== 0) return { status: 500, body: { code: 'XX000', message: x.stderr.slice(0, 300) } };
        const out = x.stdout.split('\n').filter(Boolean).at(-1);
        return { status: 200, body: out ? JSON.parse(out) : null };
      };
      return {
        rpc: (nome, args, uid) => {
          if (!/^[a-z_][a-z0-9_]*$/.test(nome)) return { status: 404, body: { code: 'PGRST202' } };
          const a = Object.entries(args || {}).map(([k, v]) => k.replace(/[^a-z_]/g, '') + ' => ' + lit(v)).join(', ');
          return rodar(uid, `select to_json(public.${nome}(${a}));`);
        },
        perfis: (id, uid) => rodar(uid, `select coalesce(json_agg(t order by t.nome), '[]') from (select id, nome, login, perfil from public.profiles${id ? ' where id = ' + lit(id) : ''}) t;`),
        versaoSinal: () => {
          const x = psql(db, ['-At', '-c', "select coalesce((select versao from public.erp_sinal), 0)"]);
          return x.status === 0 ? Number(x.stdout.trim() || 0) : 0;
        }
      };
    },
    parar() {
      comoPg(`${BIN}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null 2>&1`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

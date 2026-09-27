// E2E do KIT DE VERIFICAÇÃO DO SUPABASE (seguranca/verificar-supabase.html):
// um Supabase de mentira, local, responde como um projeto INSEGURO e como um
// SEGURO. A página tem que apontar as falhas no primeiro e nenhuma no segundo
// — e nunca mandar pedido que muda dados (só GET, login e gravação do mesmo
// valor, que o servidor falso registra).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UID = '11111111-1111-1111-1111-111111111111';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = b64({ alg: 'none' }) + '.' + b64({ sub: UID, role: 'authenticated' }) + '.x';

export function supabaseFalso(modo) {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', d => { corpo += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), logado = req.headers.authorization === 'Bearer ' + TOKEN;
      pedidos.push({ metodo: req.method, caminho: u.pathname, corpo });
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' };
      const r = (st, j) => { res.writeHead(st, { ...cors, 'Content-Type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
      if (req.method === 'OPTIONS') return r(204);
      const ins = modo === 'inseguro', p = u.pathname;
      if (p === '/auth/v1/settings') return r(200, { disable_signup: !ins, mailer_autoconfirm: ins });
      if (p === '/auth/v1/token') { const c = JSON.parse(corpo || '{}'); return c.email === 'vend@x.com' && c.password === 'certa' ? r(200, { access_token: TOKEN }) : r(400, { error_description: 'Invalid login credentials' }); }
      if (p === '/auth/v1/logout') return r(204);
      if (p === '/rest/v1/rpc/erp_changes') return ins ? r(200, { revision: 7, records: [{ id: 'x' }] }) : r(401, { message: 'Entre com sua conta' });
      if (p === '/storage/v1/bucket') return r(200, ins ? [{ id: 'fotos', public: true }] : []);
      if (p === '/functions/v1/erp-users') return !logado ? (ins ? r(400, { error: 'Usuário não encontrado' }) : r(401, { msg: 'Invalid JWT' })) : (ins ? r(200, { ok: true }) : r(403, { error: 'Requer ADMIN' }));
      if (p === '/rest/v1/profiles' && req.method === 'PATCH') return r(200, ins ? [{ id: UID, perfil: 'VENDEDOR' }] : []);
      if (p === '/rest/v1/profiles' && logado) return r(200, [{ id: UID, perfil: 'VENDEDOR' }]);
      if (p.startsWith('/rest/v1/')) return r(200, ins || logado ? [{ id: 'linha-1' }] : []);
      r(404, { message: 'não existe' });
    });
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, url: 'http://127.0.0.1:' + srv.address().port, pedidos })));
}

async function resultado(pg, botao) {
  await pg.click(botao);
  await pg.waitForFunction(() => { const t = document.getElementById('resumo').textContent; return t && t !== 'Verificando…'; }, null, { timeout: 20000 });
  return pg.evaluate(() => [...document.querySelectorAll('#res tr')].map(tr => [tr.cells[0].textContent, tr.cells[1].querySelector('b')?.textContent || '']));
}
const com = (linhas, st, re) => linhas.some(([s, i]) => s === st && re.test(i));

export async function secaoSupabaseKit({ b, novaPagina, passo, pagina = path.join(raiz, 'seguranca', 'verificar-supabase.html'), empacotada = false }) {
  console.log('SEG) kit de verificação do Supabase aponta as falhas certas');
  const ins = await supabaseFalso('inseguro'), seg = await supabaseFalso('seguro');
  const pg = await novaPagina(b);
  pg.on('dialog', d => d.dismiss().catch(() => {}));
  const abrir = async (url, chave = 'sb_publishable_teste') => { await pg.goto('file://' + pagina); await pg.fill('#url', url); await pg.fill('#chave', chave); };
  try {
    if (empacotada) await passo(pg, 'SEG: no pacote de teste a página já vem com o endereço e a chave PÚBLICA do config.js', async () => {
      await pg.goto('file://' + pagina);
      const v = await pg.evaluate(() => [document.getElementById('url').value, document.getElementById('chave').value]);
      if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v[0]) || !/^sb_publishable_/.test(v[1])) throw new Error(JSON.stringify(v));
    });
    await passo(pg, 'SEG: projeto INSEGURO — cadastro aberto, tabela sem RLS, função sem login e storage público são apontados', async () => {
      await abrir(ins.url);
      const l = await resultado(pg, '#testar');
      const falta = [[/Cadastro/], [/erp_records/], [/profiles/], [/erp_changes/], [/erp-users/]].filter(([re]) => !com(l, 'FALHA', re));
      if (falta.length || !com(l, 'ATENÇÃO', /Storage/)) throw new Error('não apontou: ' + falta.map(x => x[0]).join(', ') + ' | ' + JSON.stringify(l));
    });
    await passo(pg, 'SEG: projeto INSEGURO com vendedor — "virar ADMIN sozinho" e função de usuários sem checar ADMIN são FALHA', async () => {
      await abrir(ins.url); await pg.fill('#email', 'vend@x.com'); await pg.fill('#senha', 'certa');
      const l = await resultado(pg, '#testar_login');
      if (!com(l, 'FALHA', /ADMIN sozinho/) || !com(l, 'FALHA', /erp-users com vendedor/)) throw new Error(JSON.stringify(l));
      if (await pg.inputValue('#senha')) throw new Error('a senha ficou no campo');
    });
    await passo(pg, 'SEG: projeto SEGURO — nenhuma falha nem atenção, sem e com vendedor', async () => {
      await abrir(seg.url);
      const a = await resultado(pg, '#testar');
      await pg.fill('#email', 'vend@x.com'); await pg.fill('#senha', 'certa');
      const c = await resultado(pg, '#testar_login');
      const ruins = [...a, ...c].filter(([s]) => s === 'FALHA' || s === 'ATENÇÃO');
      if (ruins.length || a.length < 7 || c.length < 4) throw new Error(JSON.stringify({ ruins, a, c }));
    });
    await passo(pg, 'SEG: chave SECRETA no site é FALHA; a página nunca manda pedido que apaga ou muda dado', async () => {
      await abrir(seg.url, 'sb_secret_abc123');
      const l = await resultado(pg, '#testar');
      if (!com(l, 'FALHA', /Chave do site/)) throw new Error(JSON.stringify(l));
      const todos = [...ins.pedidos, ...seg.pedidos].filter(p => p.metodo !== 'OPTIONS');
      const perigosos = todos.filter(p => p.metodo === 'DELETE' || p.metodo === 'PUT' || /erp_commit_sync|signup|\/admin/.test(p.caminho) ||
        (p.metodo === 'PATCH' && (p.caminho !== '/rest/v1/profiles' || JSON.stringify(JSON.parse(p.corpo)) !== '{"perfil":"VENDEDOR"}')) ||
        (p.caminho === '/functions/v1/erp-users' && JSON.parse(p.corpo).id !== '00000000-0000-0000-0000-000000000000'));
      if (perigosos.length) throw new Error('pedido que muda dado: ' + JSON.stringify(perigosos));
    });
  } finally {
    ins.srv.close(); seg.srv.close();
    await pg.context().close();
  }
}

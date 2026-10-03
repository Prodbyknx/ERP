// E2E da NUVEM PROTEGIDA: o site de produção (cloud.js + app.js) no Chromium,
// falando com um Supabase falso cujo "PostgREST" roda as funções de VERDADE
// num PostgreSQL local com seguranca/protecao-servidor.sql aplicado.
//  - vendedor entra: perfil pela função, tempo real só com o aviso (sem dados),
//    sem gastos e sem as permissões dos outros, console limpo
//  - mudança do ADMIN chega ao vivo pelo aviso
//  - vendedor muda preço pelo console: o BANCO recusa, e dá pra descartar
//  - uso normal do vendedor grava; o ADMIN vê no "Registro do servidor"
//  - backup protegido por senha: arquivo cifrado (sem texto legível), senha
//    errada recusada, senha certa importa
//  - CAPTCHA (Turnstile) ligado no config.js: login só com o token, que vai
//    para o Supabase; desligado, nem carrega o script
//  - CAPTCHA com erro: mostra o código, o motivo e o que fazer; não tranca o
//    Entrar (o Supabase decide); erro passageiro passa sozinho; com a sessão
//    aberta o script nem carrega
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { supabaseFalso, CHAVE_PUBLICA } from '../util/supabase-falso.mjs';
import { pular, subirPostgres } from '../util/postgres.mjs';
import { servir, lerHeaders } from './csp.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = '00000000-0000-4000-8000-00000000000a', C = '00000000-0000-4000-8000-00000000000c';
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

// o Turnstile de mentira (o de verdade vem de challenges.cloudflare.com)
const TURNSTILE_FALSO = `window.turnstile={render(el,o){const b=document.createElement('button');b.type='button';b.id='captcha-falso';b.textContent='Sou humano';
  b.onclick=()=>o.callback('tok-humano-'+(++window.__captchas));el.appendChild(b);window.__opcCaptcha=o;return 'w1';},reset(){window.__resets=(window.__resets||0)+1;}};
  window.__captchas=0;setTimeout(()=>window.aoCarregarTurnstile&&window.aoCarregarTurnstile(),0);`;
// Turnstile que dá erro (código da Cloudflare); "depois": passa sozinho na nova tentativa
const turnstileComErro = (codigo, depois) => `window.turnstile={render(el,o){window.__opcCaptcha=o;setTimeout(()=>{window.__retornoErro=o['error-callback'](${codigo});
  ${depois ? `setTimeout(()=>o.callback('${depois}'),400);` : ''}},50);return 'w1';},reset(){window.__resets=(window.__resets||0)+1;}};
  setTimeout(()=>window.aoCarregarTurnstile&&window.aoCarregarTurnstile(),0);`;

export async function secaoNuvemProtegida({ chromium, passo, pastaSite = path.join(raiz, 'site') }) {
  console.log('NUVEM PROTEGIDA) site de produção x funções de verdade do servidor (PostgreSQL local)');
  if (pular) { console.log('  pulado: ' + pular); return; }
  const pg = await subirPostgres(), DB = 'erp';
  pg.criar(DB);
  for (const f of ['base.sql', 'erp-original.sql']) {
    const x = pg.arquivo(DB, path.join(raiz, 'tests', 'fixtures', 'supabase', f));
    if (x.status !== 0) throw new Error(f + ': ' + x.stderr);
  }
  const sql = (quem, t) => { const r = pg.como(DB, quem, t); if (!r.ok) throw new Error(r.erro || r.stderr); return r.linhas; };
  sql(null, `insert into auth.users(id, email, email_confirmed_at) values (${q(A)}, 'dono@teste.com', now()), (${q(C)}, 'caio@teste.com', now());
    insert into public.profiles(id, nome, login, perfil) values (${q(A)}, 'Dono', 'dono@teste.com', 'ADMIN'), (${q(C)}, 'Caio', 'caio@teste.com', 'VENDEDOR');`);
  const commit = (quem, changes) => sql(quem, `select public.erp_commit_sync(${q(crypto.randomUUID())}, ${q(JSON.stringify(changes))}::jsonb, false);`);
  const cfg = { negocio: '144 Laboratório 3D', kwh: 1.07, hora: 18, falha: 8, margem: 60, plat: 0, taxaML: 12, taxaShopee: 14, taxaCartao: 4,
    permissoes: { [C]: ['sales', 'quote', 'clients'], 'id-de-outro': ['fin', 'cfg'] } };
  const prod = { id: 'p1', nome: 'Vaso Geométrico', categoria: 'Decoração', gramas: 120, horas: 6, min: 0, custo: 24.9, preco: 89.9, margem: 60, plataforma: 0,
    estoque: 2, locais: { oficina: 2, ml: 0, shopee: 0 }, filamentId: 'f1', printerId: 1, ativo: true, foto: '' };
  commit(A, [
    { collection: 'config', id: '_', before: null, after: cfg },
    { collection: 'printers', id: '1', before: null, after: { id: 1, nome: 'Bambu Lab A1', qtd: 1, pot: 0.1, maq: 0.7 } },
    { collection: 'filaments', id: 'f1', before: null, after: { id: 'f1', marca: 'F3D', material: 'PLA', cor: '#9aa3b2', corNome: 'CINZA', prkg: 112, estoque: 2400 } },
    { collection: 'products', id: 'p1', before: null, after: prod },
    { collection: 'expenses', id: 'e1', before: null, after: { id: 'e1', data: '2026-09-01', categoria: 'Aluguel', valor: 1500, descricao: 'Aluguel da oficina' } },
    { collection: 'clients', id: 'c1', before: null, after: { id: 'c1', nome: 'Maria Confidencial', whatsapp: '(21) 99999-0000' } }]);
  const semAplicar = pg.arquivo(DB, path.join(raiz, 'seguranca', 'protecao-servidor.sql'));
  if (semAplicar.status !== 0) throw new Error('proteção: ' + semAplicar.stderr);

  const sb = await supabaseFalso({ banco: pg.postgrest(DB), usuarios: [
    { id: A, email: 'dono@teste.com', senha: 'senha-do-dono', nome: 'Dono', login: 'dono@teste.com', perfil: 'ADMIN' },
    { id: C, email: 'caio@teste.com', senha: 'senha-do-caio', nome: 'Caio', login: 'caio@teste.com', perfil: 'VENDEDOR' }] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvemp-'));
  for (const f of fs.readdirSync(pastaSite)) fs.copyFileSync(path.join(pastaSite, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'config.js'), `window.ERP_CONFIG={url:'${sb.url}',publicKey:'${CHAVE_PUBLICA}'};`);
  const dirCap = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvemc-'));
  for (const f of fs.readdirSync(pastaSite)) fs.copyFileSync(path.join(pastaSite, f), path.join(dirCap, f));
  fs.writeFileSync(path.join(dirCap, 'config.js'), `window.ERP_CONFIG={url:'${sb.url}',publicKey:'${CHAVE_PUBLICA}',turnstile:'0x4AAAAAAAteste144'};`);
  const cab = lerHeaders(); cab['Content-Security-Policy'] = cab['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  const s1 = await servir(dir, cab), s2 = await servir(dirCap, cab);
  const b = await chromium.launch({ channel: 'chromium', args: sb.argsChromium() });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.erros = []; p.on('pageerror', e => p.erros.push('PAGEERR ' + e.message));
  const consoleMsgs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.text().slice(0, 200)); });
  const pedidosCaptcha = []; p.on('request', r => { if (/challenges\.cloudflare\.com/.test(r.url())) pedidosCaptcha.push(r.url()); });
  const sincronizado = () => p.waitForFunction(() => /Nuvem (sincronizada|conectada)|Salvo na nuvem/.test(document.getElementById('cloud-status').textContent), null, { timeout: 20000 });
  const entrar = async (url, email, senha) => {
    await p.goto(url + '/index.html');
    await p.fill('#login_user', email); await p.fill('#login_pass', senha); await p.click('#btn_login');
    await p.waitForFunction(() => document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 });
    await sincronizado();
  };
  const esperar = async (cond, ms = 15000) => { const fim = Date.now() + ms; while (!(await cond())) { if (Date.now() > fim) throw new Error('tempo esgotado'); await p.waitForTimeout(100); } };
  try {
    await passo(p, 'NUVEM PROTEGIDA: vendedor entra — perfil pela função, tempo real só com o aviso, sem gastos nem permissões dos outros', async () => {
      const t0 = Date.now();
      await entrar(s1.url, 'caio@teste.com', 'senha-do-caio');
      await esperar(() => sb.topicosAbertos() === 1);
      await p.waitForTimeout(600);
      if (sb.pedidosDe(x => x.caminho === '/rest/v1/profiles', t0).length) throw new Error('leu a tabela profiles direto');
      if (!sb.pedidosDe(x => x.caminho === '/rest/v1/rpc/erp_usuarios' && x.status === 200, t0).length) throw new Error('não usou erp_usuarios');
      const tabs = sb.tabelasInscritas();
      if (JSON.stringify(tabs) !== '["erp_sinal"]') throw new Error('tempo real inscrito em: ' + tabs);
      const v = await p.evaluate(() => ({ gastos: window.Cloud.load('knx3d_expenses', []), perms: Object.keys(window.Cloud.load('knx3d_config', {}).permissoes || {}),
        prot: window.Cloud._test.protegido(), cursor: window.Cloud._test.state().cursor, users: window.Cloud.users.map(u => u.login) }));
      if (v.gastos.length) throw new Error('recebeu gastos: ' + JSON.stringify(v.gastos));
      if (JSON.stringify(v.perms) !== JSON.stringify([C])) throw new Error('permissões recebidas: ' + v.perms);
      if (!v.prot || !/~p1$/.test(v.cursor)) throw new Error(JSON.stringify(v));
      if (JSON.stringify(v.users) !== '["caio@teste.com"]') throw new Error('usuários: ' + v.users);
      if (consoleMsgs.length) throw new Error('console: ' + consoleMsgs.join(' | '));
    });
    await passo(p, 'NUVEM PROTEGIDA: mudança do ADMIN chega ao vivo pelo aviso (sem recarregar)', async () => {
      commit(A, [{ collection: 'clients', id: 'c-dono', before: null, after: { id: 'c-dono', nome: 'Cliente cadastrado pelo dono' } }]);
      sb.avisarBanco();
      await p.waitForFunction(() => (window.Cloud.load('knx3d_clients', []) || []).some(c => c.nome === 'Cliente cadastrado pelo dono'), null, { timeout: 10000 });
    });
    await passo(p, 'NUVEM PROTEGIDA: vendedor muda preço pelo console — o BANCO recusa e dá pra descartar', async () => {
      await p.evaluate(() => { const l = window.Cloud.load('knx3d_products', []); l.find(x => x.id === 'p1').preco = 1; window.Cloud.save('knx3d_products', l); });
      await p.waitForFunction(() => /não foi confirmada/.test(document.querySelector('#cloud-barrier p')?.textContent || ''), null, { timeout: 15000 });
      const msg = await p.textContent('#cloud-barrier p');
      if (!/Só o ADMIN muda preço, custo e ficha do produto/.test(msg)) throw new Error(msg);
      await p.click('#cloud-barrier button:has-text("Descartar e atualizar")');
      await p.waitForFunction(() => document.getElementById('cloud-barrier').style.display === 'none', null, { timeout: 15000 });
      const preco = await p.evaluate(() => window.Cloud.load('knx3d_products', []).find(x => x.id === 'p1').preco);
      if (preco !== 89.9) throw new Error('preço depois de descartar: ' + preco);
      if (sql(null, `select data->>'preco' from public.erp_records where id = 'p1';`).at(-1) !== '89.9') throw new Error('o banco mudou!');
      consoleMsgs.length = 0;   // o 403 da recusa aparece no console do navegador: é o esperado
    });
    await passo(p, 'NUVEM PROTEGIDA: uso normal do vendedor grava (cliente novo)', async () => {
      await p.evaluate(() => window.Cloud.save('knx3d_clients', [...window.Cloud.load('knx3d_clients', []), { id: 'c-caio', nome: 'Cliente do Caio' }]));
      await esperar(() => sql(null, `select count(*) from public.erp_records where id = 'c-caio';`).at(-1) === '1');
      await sincronizado();
    });
    await passo(p, 'NUVEM PROTEGIDA: ADMIN vê tudo e o "Registro do servidor" mostra quem fez o quê', async () => {
      await Promise.all([p.waitForEvent('load'), p.evaluate(() => window.Cloud.logout())]);
      await entrar(s1.url, 'dono@teste.com', 'senha-do-dono');
      const v = await p.evaluate(() => ({ gastos: window.Cloud.load('knx3d_expenses', []).length, users: window.Cloud.users.length }));
      if (v.gastos !== 1 || v.users !== 2) throw new Error(JSON.stringify(v));
      await p.evaluate(() => showTab('audit'));
      await p.waitForFunction(() => document.querySelectorAll('#audit-srv-list tbody tr').length > 0, null, { timeout: 10000 });
      const linhas = await p.$$eval('#audit-srv-list tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ')));
      if (!linhas.some(l => /Caio/.test(l) && /criou Cliente/.test(l) && /Cliente do Caio/.test(l))) throw new Error('histórico: ' + linhas.slice(0, 4).join(' || '));
      if (!(await p.isVisible('#audit-servidor'))) throw new Error('card do servidor escondido');
    });
    let arquivo = null;
    await passo(p, 'NUVEM PROTEGIDA: backup com senha sai cifrado (nada legível) e abre só com a senha', async () => {
      await p.evaluate(() => document.getElementById('btn_export').click());
      await p.fill('#bk_senha', 'minha senha forte'); await p.fill('#bk_senha2', 'minha senha forte');
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#bk_baixar')]);
      arquivo = path.join(dir, 'backup.json'); await dl.saveAs(arquivo);
      const txt = fs.readFileSync(arquivo, 'utf8'), j = JSON.parse(txt);
      if (j.formato !== '144lab-cifrado-v1' || j.cifra !== 'AES-256-GCM' || j.iteracoes < 600000) throw new Error(txt.slice(0, 200));
      for (const segredo of ['Maria', 'Confidencial', 'Aluguel', '99999', 'Vaso']) if (txt.includes(segredo)) throw new Error('texto legível no arquivo: ' + segredo);
      // decifra aqui fora (Node) com a senha: é o backup completo de verdade
      const w = crypto.webcrypto.subtle, de = t => Buffer.from(t, 'base64');
      const base = await w.importKey('raw', Buffer.from('minha senha forte'), 'PBKDF2', false, ['deriveKey']);
      const k = await w.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: de(j.sal), iterations: j.iteracoes }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const dados = JSON.parse(Buffer.from(await w.decrypt({ name: 'AES-GCM', iv: de(j.iv) }, k, de(j.dados))).toString());
      if (!dados.clients.some(c => c.nome === 'Maria Confidencial') || dados.expenses.length !== 1 || dados.formato !== '144lab-completo-v1') throw new Error('conteúdo decifrado errado');
    });
    await passo(p, 'NUVEM PROTEGIDA: importar backup protegido — senha errada recusa, senha certa importa', async () => {
      await p.evaluate(() => showTab('cfg'));
      const importar = async senha => {
        await p.setInputFiles('#file_import', arquivo);
        await p.waitForSelector('#custom-prompt.active'); await p.click('#prompt-ok');
        // o modal fechado só fica transparente: espera o NOVO (aberto) antes de digitar
        await p.waitForSelector('#modal-form.active #bk_abrir'); await p.fill('#modal-form.active #bk_abrir', senha); await p.keyboard.press('Enter');
        await p.waitForFunction(() => !document.getElementById('modal-form').classList.contains('active'));
      };
      await importar('senha errada');
      await p.waitForFunction(() => /Senha errada/.test(document.body.innerText), null, { timeout: 15000 });
      const importacoes = () => sql(null, `select count(*) from erp_interno.historico where acao = 'importou backup' and nome = 'Dono';`).at(-1);
      if (importacoes() !== '0') throw new Error('senha errada importou');
      await importar('minha senha forte');
      await esperar(() => importacoes() === '1', 30000);
      if (await p.evaluate(() => document.getElementById('cloud-barrier').style.display === 'flex')) throw new Error('ficou bloqueado: ' + await p.textContent('#cloud-barrier p'));
    });
    await passo(p, 'NUVEM PROTEGIDA: sem CAPTCHA configurado o script nem carrega; com ele, login só com o token, que vai para o Supabase', async () => {
      if (pedidosCaptcha.length) throw new Error('carregou o Turnstile sem estar configurado');
      await Promise.all([p.waitForEvent('load'), p.evaluate(() => window.Cloud.logout())]);
      await p.route('https://challenges.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: TURNSTILE_FALSO }));
      await p.goto(s2.url + '/index.html');
      await p.waitForSelector('#captcha-falso');
      if (!(await p.isDisabled('#btn_login'))) throw new Error('login liberado sem o CAPTCHA');
      const opc = await p.evaluate(() => ({ k: window.__opcCaptcha.sitekey, a: window.__opcCaptcha.action }));
      if (opc.k !== '0x4AAAAAAAteste144' || opc.a !== 'login') throw new Error(JSON.stringify(opc));
      // senha errada: o token vale uma vez; o widget é reiniciado e o botão volta a travar
      await p.click('#captcha-falso'); await p.fill('#login_user', 'dono@teste.com'); await p.fill('#login_pass', 'errada'); await p.click('#btn_login');
      await p.waitForFunction(() => window.__resets === 1, null, { timeout: 10000 });
      if (sb.estado.ultimoLogin?.gotrue_meta_security?.captcha_token !== 'tok-humano-1') throw new Error('token não foi: ' + JSON.stringify(sb.estado.ultimoLogin));
      if (!(await p.isDisabled('#btn_login'))) throw new Error('botão liberado com token já usado');
      await p.click('#captcha-falso'); await p.fill('#login_pass', 'senha-do-dono'); await p.click('#btn_login');
      await p.waitForFunction(() => document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 });
      if (sb.estado.ultimoLogin.gotrue_meta_security.captcha_token !== 'tok-humano-2') throw new Error('2º token: ' + JSON.stringify(sb.estado.ultimoLogin));
      await sincronizado();
      const bloqueados = consoleMsgs.filter(m => /Content Security Policy|Refused/.test(m));
      if (bloqueados.length) throw new Error('CSP bloqueou: ' + bloqueados.join(' | '));
    });
    await passo(p, 'NUVEM PROTEGIDA: anti-robô com ERRO mostra código, motivo e o que fazer; não tranca o Entrar (o Supabase decide); erro passageiro passa sozinho; sessão aberta nem carrega o script', async () => {
      // sessão aberta: recarregar não carrega o Turnstile (nem avisa erro dele por cima do ERP)
      const antes = pedidosCaptcha.length;
      await p.reload(); await p.waitForFunction(() => document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 }); await sincronizado();
      if (pedidosCaptcha.length !== antes) throw new Error('carregou o Turnstile com a sessão aberta');
      // 110200: este endereço não está liberado no widget (o caso do "falhou, recarregue")
      await Promise.all([p.waitForEvent('load'), p.evaluate(() => window.Cloud.logout())]);
      await p.unroute('https://challenges.cloudflare.com/**');
      await p.route('https://challenges.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: turnstileComErro(110200) }));
      await p.goto(s2.url + '/index.html');
      await p.waitForSelector('#login_captcha_msg', { state: 'visible', timeout: 10000 });
      const msg = await p.textContent('#login_captcha_msg');
      if (!/127\.0\.0\.1/.test(msg) || !/Hostname/.test(msg) || !/110200/.test(msg) || /tentando de novo/.test(msg)) throw new Error('mensagem: ' + msg);
      if (!/código 110200/.test(await p.textContent('#cloud-status'))) throw new Error('status: ' + await p.textContent('#cloud-status'));
      if (await p.evaluate(() => window.__retornoErro) !== true) throw new Error('error-callback não tratou o erro');
      if (await p.isDisabled('#btn_login')) throw new Error('Entrar trancado sem saída');
      // CAPTCHA ligado no Supabase: ele recusa e a tela diz onde mexer
      sb.estado.exigirCaptcha = true;
      await p.fill('#login_user', 'dono@teste.com'); await p.fill('#login_pass', 'senha-do-dono'); await p.click('#btn_login');
      await p.waitForFunction(() => /exige o anti-robô/.test(document.getElementById('cloud-status').textContent), null, { timeout: 15000 });
      if (sb.estado.ultimoLogin.gotrue_meta_security && sb.estado.ultimoLogin.gotrue_meta_security.captcha_token) throw new Error('mandou token que não existe');
      if (await p.evaluate(() => document.getElementById('app-wrapper').style.display === 'block')) throw new Error('entrou sem o CAPTCHA que o servidor exige');
      // desligado no Supabase (a saída de emergência): entra
      sb.estado.exigirCaptcha = false;
      await p.fill('#login_pass', 'senha-do-dono'); await p.click('#btn_login');
      await p.waitForFunction(() => document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 }); await sincronizado();
      // 600010 (passageiro): avisa que está tentando de novo e, quando passa, some o aviso e o token vai
      await Promise.all([p.waitForEvent('load'), p.evaluate(() => window.Cloud.logout())]);
      await p.unroute('https://challenges.cloudflare.com/**');
      await p.route('https://challenges.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: turnstileComErro(600010, 'tok-depois') }));
      await p.goto(s2.url + '/index.html');
      await p.waitForFunction(() => /600010/.test(document.getElementById('login_captcha_msg')?.textContent || '') && /tentando de novo/.test(document.getElementById('login_captcha_msg').textContent), null, { timeout: 10000 });
      await p.waitForSelector('#login_captcha_msg', { state: 'hidden', timeout: 10000 });
      sb.estado.exigirCaptcha = true;
      await p.fill('#login_user', 'dono@teste.com'); await p.fill('#login_pass', 'senha-do-dono'); await p.click('#btn_login');
      await p.waitForFunction(() => document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 });
      sb.estado.exigirCaptcha = false;
      if (sb.estado.ultimoLogin.gotrue_meta_security.captcha_token !== 'tok-depois') throw new Error('token: ' + JSON.stringify(sb.estado.ultimoLogin));
      await sincronizado();
    });
  } finally {
    await b.close(); s1.srv.close(); s2.srv.close(); await sb.fechar(); pg.parar();
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dirCap, { recursive: true, force: true });
  }
}

// E2E da NUVEM (cloud.js de produção) contra o Supabase falso (tests/util/supabase-falso.mjs),
// no Chromium completo com o BFCache LIGADO (o Playwright desliga por padrão):
//  - login e tempo real ao vivo: 1 socket, 1 canal, console limpo
//  - sair da página e voltar 5×: volta do BFCache (sem recarregar), sem erro de WebSocket,
//    sem canal duplicado, e o que mudou enquanto estava fora aparece
//  - login fora do ar ao acordar o PC: nenhuma chamada anônima (401)
//  - sessão derrubada no servidor: nada mais é chamado, socket fechado, e uma gravação
//    pendente NÃO oferece "Descartar" (fica guardada para depois de entrar de novo)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseFalso, CHAVE_PUBLICA } from '../util/supabase-falso.mjs';
import { servir, lerHeaders } from './csp.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function secaoNuvem({ chromium, passo, pastaSite = path.join(raiz, 'site') }) {
  console.log('NUVEM) cloud.js de produção: sessão, 401, tempo real e BFCache (Supabase falso)');
  const sb = await supabaseFalso();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvem-'));
  for (const f of fs.readdirSync(pastaSite)) fs.copyFileSync(path.join(pastaSite, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'config.js'), `window.ERP_CONFIG={url:'${sb.url}',publicKey:'${CHAVE_PUBLICA}'};`);
  fs.writeFileSync(path.join(dir, 'outra.html'), '<!doctype html><meta charset="utf-8"><title>outra</title><link rel="icon" href="data:,"><p>outra página</p>');
  const cab = lerHeaders(); cab['Content-Security-Policy'] = cab['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  const { srv, url } = await servir(dir, cab);
  const b = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'], args: sb.argsChromium() });
  const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  // erros da própria página (exceção, promessa sem tratamento) param o passo; o console é conferido em cada passo
  pg.erros = []; pg.on('pageerror', e => pg.erros.push('PAGEERR ' + e.message));
  const consoleMsgs = []; pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.text().slice(0, 200)); });
  await pg.addInitScript(() => { addEventListener('pageshow', e => { (window.__voltas = window.__voltas || []).push(e.persisted); }); });
  await pg.clock.install();
  const rpc = (t0, nome = 'erp_changes') => sb.pedidosDe(x => x.caminho.endsWith(nome), t0);
  const anonimas = t0 => sb.pedidosDe(x => x.caminho.startsWith('/rest/') && x.status === 401, t0);
  const sincronizado = () => pg.waitForFunction(() => /Nuvem (sincronizada|conectada)|Salvo na nuvem/.test(document.getElementById('cloud-status').textContent), null, { timeout: 20000 });
  const esperarServidor = async (cond, ms = 15000) => { const fim = Date.now() + ms; while (!cond()) { if (Date.now() > fim) throw new Error('tempo esgotado esperando o servidor'); await pg.waitForTimeout(100); } };
  const clientes = () => pg.evaluate(() => (window.Cloud.load('knx3d_clients', []) || []).map(c => c.nome));
  try {
    await passo(pg, 'NUVEM: login — 1 socket, 1 canal, todas as chamadas com o usuário, console limpo', async () => {
      const t0 = Date.now();
      await pg.goto(url + '/index.html');
      await pg.fill('#login_user', 'dono@teste.com'); await pg.fill('#login_pass', 'senha-certa'); await pg.click('#btn_login');
      await pg.waitForFunction(() => document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 });
      await esperarServidor(() => sb.topicosAbertos() === 1); await sincronizado(); await pg.waitForTimeout(800);
      const r = rpc(t0);
      if (!r.length || r.some(x => x.status !== 200 || x.quem !== 'usuario')) throw new Error('erp_changes: ' + JSON.stringify(r));
      if (sb.socketsAbertos() !== 1 || sb.topicosAbertos() !== 1) throw new Error('sockets ' + sb.socketsAbertos() + ' canais ' + sb.topicosAbertos());
      if (consoleMsgs.length) throw new Error('console: ' + consoleMsgs.join(' | '));
    });
    await passo(pg, 'NUVEM: tempo real ao vivo — mudança de outro usuário chega sem recarregar', async () => {
      const t0 = Date.now();
      sb.aplicar([{ collection: 'clients', id: 'c-vivo', after: { id: 'c-vivo', nome: 'Cliente ao vivo' } }]);
      await pg.waitForFunction(() => (window.Cloud.load('knx3d_clients', []) || []).some(c => c.nome === 'Cliente ao vivo'), null, { timeout: 10000 });
      if (consoleMsgs.length) throw new Error('console: ' + consoleMsgs.join(' | '));
      if (anonimas(t0).length) throw new Error('chamada anônima');
    });
    await passo(pg, 'NUVEM: gravar — a alteração chega ao banco com o usuário', async () => {
      const t0 = Date.now();
      await pg.evaluate(() => window.Cloud.save('knx3d_clients', [...window.Cloud.load('knx3d_clients', []), { id: 'c-meu', nome: 'Cliente gravado aqui' }]));
      await esperarServidor(() => sb.estado.registros.has('clients|c-meu'));
      const c = rpc(t0, 'erp_commit_sync');
      if (c.length !== 1 || c[0].status !== 200 || c[0].quem !== 'usuario') throw new Error(JSON.stringify(c));
      await sincronizado();
    });
    await passo(pg, 'NUVEM: sair da página e voltar 5× — volta do BFCache, sem erro de WebSocket, sem canal duplicado, e o que mudou fora aparece', async () => {
      const t0 = Date.now(), joins0 = sb.estado.joins;
      consoleMsgs.length = 0;
      for (let i = 0; i < 5; i++) {
        await pg.evaluate(() => { location.href = '/outra.html'; }); await pg.waitForURL(/outra/);
        await pg.waitForTimeout(300);
        if (i === 2) sb.aplicar([{ collection: 'clients', id: 'c-fora', after: { id: 'c-fora', nome: 'Cliente criado com a página fora' } }]);
        await pg.goBack({ waitUntil: 'commit' });
        await esperarServidor(() => sb.topicosAbertos() === 1);
        await sincronizado();
      }
      await pg.waitForTimeout(800);
      const voltas = await pg.evaluate(() => window.__voltas);
      if (voltas.filter(Boolean).length !== 5) throw new Error('não voltou do BFCache (recarregou a página): pageshow.persisted = ' + JSON.stringify(voltas));
      if (sb.socketsAbertos() !== 1 || sb.topicosAbertos() !== 1) throw new Error('sockets ' + sb.socketsAbertos() + ' canais ' + sb.topicosAbertos());
      if (sb.estado.joins - joins0 !== 5) throw new Error('inscrições no canal: ' + (sb.estado.joins - joins0) + ' (esperado 5, uma por volta)');
      if (!(await clientes()).includes('Cliente criado com a página fora')) throw new Error('a mudança feita fora não apareceu');
      if (anonimas(t0).length) throw new Error('chamada anônima: ' + JSON.stringify(anonimas(t0)));
      if (consoleMsgs.length) throw new Error('console: ' + [...new Set(consoleMsgs)].join(' | '));
    });
    await passo(pg, 'NUVEM: voltar/avançar 10× sem esperar — no fim 1 socket, 1 canal, sem ouvinte acumulado', async () => {
      // conta só os ouvintes criados pelos arquivos do sistema (o Playwright injeta os dele)
      const ouvintes = async () => {
        const cdp = await pg.context().newCDPSession(pg), urls = new Map();
        cdp.on('Debugger.scriptParsed', e => urls.set(e.scriptId, e.url));
        await cdp.send('Debugger.enable');
        const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
        const l = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners;
        await cdp.detach();
        return l.filter(x => (urls.get(x.scriptId) || '').startsWith(url)).map(x => x.type).sort().join(',');
      };
      const antes = await ouvintes();
      consoleMsgs.length = 0;
      for (let i = 0; i < 10; i++) { await pg.goForward({ waitUntil: 'commit' }); await pg.waitForTimeout(100); await pg.goBack({ waitUntil: 'commit' }); await pg.waitForTimeout(100); }
      // navegar no meio do carregamento faz o Chrome descartar a página do cache e recarregar
      // (é dele); o que importa é o estado final: app pronto, 1 socket, 1 canal, nada acumulado
      await pg.waitForFunction(() => window.ERP_APP && document.getElementById('app-wrapper').style.display === 'block', null, { timeout: 30000 });
      await esperarServidor(() => sb.topicosAbertos() === 1 && sb.socketsAbertos() === 1); await sincronizado(); await pg.waitForTimeout(1500);
      if (sb.socketsAbertos() !== 1 || sb.topicosAbertos() !== 1) throw new Error('sockets ' + sb.socketsAbertos() + ' canais ' + sb.topicosAbertos());
      const depois = await ouvintes();
      if (!antes || depois !== antes) throw new Error('ouvintes do sistema em window: ' + antes + ' -> ' + depois);
      if (consoleMsgs.length) throw new Error('console: ' + [...new Set(consoleMsgs)].join(' | '));
    });
    await passo(pg, 'NUVEM: tempo real fora do ar — reconecta esperando cada vez mais (sem loop), depois volta com 1 canal e recebe ao vivo', async () => {
      sb.estado.recusarWS = true; sb.estado.tentativasWS.length = 0;
      sb.derrubarWS();
      await pg.waitForTimeout(16000);
      const n = sb.estado.tentativasWS.length;
      // a biblioteca espera 1 s, 2 s, 5 s e depois 10 s entre tentativas: em 16 s são no máximo ~5
      if (n < 2 || n > 6) throw new Error('tentativas de reconexão em 16 s: ' + n);
      sb.estado.recusarWS = false;
      await esperarServidor(() => sb.topicosAbertos() === 1, 20000);
      if (sb.socketsAbertos() !== 1) throw new Error('sockets ' + sb.socketsAbertos());
      sb.aplicar([{ collection: 'clients', id: 'c-religou', after: { id: 'c-religou', nome: 'Cliente depois da queda' } }]);
      await pg.waitForFunction(() => (window.Cloud.load('knx3d_clients', []) || []).some(c => c.nome === 'Cliente depois da queda'), null, { timeout: 10000 });
      // durante a queda o navegador avisa que a conexão falhou (servidor fora): é o esperado
      consoleMsgs.length = 0;
    });
    await passo(pg, 'NUVEM: PC dorme 2 h e o login demora a responder ao acordar — nenhuma chamada anônima, sincroniza quando volta', async () => {
      const t0 = Date.now();
      sb.estado.foraDoAr = true; sb.estado.desvio += 2 * 3600e3;
      await pg.clock.fastForward('02:00:00');
      await pg.evaluate(() => { dispatchEvent(new Event('focus')); dispatchEvent(new Event('online')); });
      await pg.waitForTimeout(2500);
      sb.estado.foraDoAr = false;
      sb.aplicar([{ collection: 'clients', id: 'c-acordou', after: { id: 'c-acordou', nome: 'Cliente depois de acordar' } }]);
      await pg.evaluate(() => dispatchEvent(new Event('online')));
      await pg.waitForFunction(() => (window.Cloud.load('knx3d_clients', []) || []).some(c => c.nome === 'Cliente depois de acordar'), null, { timeout: 15000 });
      if (anonimas(t0).length) throw new Error('chamada anônima (401): ' + JSON.stringify(anonimas(t0)));
    });
    await passo(pg, 'NUVEM: sessão derrubada no servidor com gravação pendente — nada sai anônimo, sem "Descartar", dá pra entrar de novo', async () => {
      const t0 = Date.now();
      sb.revogarTudo(); sb.estado.desvio += 2 * 3600e3;
      await pg.clock.fastForward('02:00:00');
      await pg.evaluate(() => window.Cloud.save('knx3d_clients', [...window.Cloud.load('knx3d_clients', []), { id: 'c-pendente', nome: 'Gravado sem sessão' }]));
      await pg.waitForFunction(() => /não foi confirmada/.test(document.querySelector('#cloud-barrier p')?.textContent || ''), null, { timeout: 15000 });
      const botoes = await pg.evaluate(() => [...document.querySelectorAll('#cloud-barrier button')].map(b => b.textContent));
      if (!botoes.includes('Entrar novamente') || !botoes.includes('Baixar alteração pendente') || botoes.some(t => /Descartar/.test(t))) throw new Error('botões: ' + JSON.stringify(botoes));
      if (!(await pg.evaluate(() => window.Cloud._test.state().pending))) throw new Error('a alteração pendente se perdeu');
      // a aba continua aberta: foco, online e o timer de 5 min não podem gerar chamadas
      for (let i = 0; i < 4; i++) { await pg.evaluate(() => { dispatchEvent(new Event('focus')); dispatchEvent(new Event('online')); }); await pg.waitForTimeout(300); }
      await pg.clock.fastForward('00:06:00'); await pg.waitForTimeout(1000);
      const chamadas = sb.pedidosDe(x => x.caminho.startsWith('/rest/'), t0);
      if (chamadas.length) throw new Error('chamadas depois da sessão encerrada: ' + JSON.stringify(chamadas.map(x => x.caminho + ' ' + x.status)));
      if (sb.socketsAbertos() !== 0 || sb.topicosAbertos() !== 0) throw new Error('sockets ' + sb.socketsAbertos() + ' canais ' + sb.topicosAbertos());
    });
  } finally {
    await b.close(); srv.close(); await sb.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

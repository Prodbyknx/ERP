// Testes de ponta a ponta no Chromium (Playwright), no pacote de TESTE:
//   node tests/e2e/run.mjs
// 1) regressão: todas as abas do ERP abrem sem erro de JavaScript + PDF
// 2) Estúdio 3D aberto por file:// (dois cliques) e por http://
// 3) fluxo completo: abrir, analisar, selecionar com clique, separar com
//    encaixe, desfazer/refazer, cortar com pinos, texto frente/verso,
//    separar por cor, exportar 3MF/STL, reabrir o 3MF exportado
// 4) gerador de chaveiro: 3MF novo (cor que o Bambu lê) e "Abrir no Estúdio"
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { gerarPacotes } from '../../tools/pacotes.mjs';
import { construir } from '../../tools/build.mjs';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
let falhas = 0;

async function gerarModelos(dir) {
  const { carregarManifold } = await import('../util/manifold.mjs');
  const { esfera, caixaMalha } = await import('../util/malhas.mjs');
  const { comContexto, manifold } = await import('../../src/estudio3d/core/solidos.js');
  const { escreverSTL } = await import('../../src/estudio3d/core/formatos/stl.js');
  const { escrever3MF } = await import('../../src/estudio3d/core/formatos/tmf.js');
  const { centroidesFace } = await import('../../src/estudio3d/core/malha.js');
  const M4 = await import('../../src/estudio3d/core/mat4.js');
  await carregarManifold();
  const unir = ms => comContexto(ctx => { const { Manifold } = manifold(); const u = ctx.guardar(Manifold.union(ms.map(m => ctx.solido({ malha: m, cor: '#000000' })))); return ctx.parte(u, 'm', '#000000').malha; });
  const cab = unir([esfera(20, 5, 0, 0, 20), esfera(7, 4, -12, 0, 39), esfera(7, 4, 12, 0, 39), esfera(4, 4, -7, -17, 24), esfera(4, 4, 7, -17, 24)]);
  fs.writeFileSync(dir + '/personagem.stl', escreverSTL(cab, 'personagem'));
  const C = centroidesFace(cab), cor = new Uint16Array(cab.idx.length / 3);
  for (let t = 0; t < cor.length; t++) if (C[t * 3 + 1] < -17.5 && Math.hypot(Math.abs(C[t * 3]) - 7, C[t * 3 + 2] - 24) < 3.4) cor[t] = 1;
  fs.writeFileSync(dir + '/personagem-cor.3mf', escrever3MF({ objetos: [{ nome: 'Personagem', transform: M4.translacao(128, 128, 0), partes: [{ nome: 'Corpo', malha: { ...cab, cor }, cor: '#1B1B1B', paleta: ['#1B1B1B', '#FFFFFF'] }] }] }).bytes);
  fs.writeFileSync(dir + '/chaveiro.stl', escreverSTL(caixaMalha(60, 30, 3), 'chaveiro'));
  fs.writeFileSync(dir + '/estrela.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#222" d="M50 5 L61 38 L96 38 L68 59 L79 93 L50 72 L21 93 L32 59 L4 38 L39 38 Z"/></svg>');
}

function servir(dir, porta) {
  const tipos = { '.js': 'application/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
  return http.createServer((q, r) => {
    let p = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': tipos[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
  }).listen(porta);
}

async function novaPagina(b) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  pg.erros = [];
  pg.on('pageerror', e => pg.erros.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(m.text())) pg.erros.push('console ' + m.text().slice(0, 200)); });
  return pg;
}

async function passo(pg, nome, fn) {
  const t0 = Date.now();
  try {
    await fn();
    if (pg.erros.length) throw new Error('erro de página: ' + pg.erros.join(' | '));
    console.log('  ok    ' + nome + ' (' + (Date.now() - t0) + ' ms)');
  } catch (e) {
    falhas++;
    console.log('  FALHA ' + nome + ': ' + String(e.message).split('\n')[0]);
    pg.erros.length = 0;
    try { await pg.screenshot({ path: path.join(tmp, 'falha-' + nome.replace(/\W+/g, '_') + '.png') }); } catch (x) { /* ok */ }
  }
}

const abrirSecao = (pg, s) => pg.evaluate(sec => { const d = document.querySelector('[data-sec=' + sec + ']'); if (!d.open) { d.open = true; d.dispatchEvent(new Event('toggle')); } }, s);
const nObjetos = pg => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
const confirmarPrevia = async pg => { await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 }); await pg.click('.e3d-previa button.primary'); };
const simular = arq => JSON.parse(execFileSync('python3', [path.join(raiz, 'tests/bambu/simular_importador.py'), arq]).toString());

async function abrirEstudio(pg, url) {
  await pg.goto(url);
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => showTab('ferr'));
  await pg.click('#ferr_modo_seg button[data-v=estudio]');
  await pg.waitForFunction(() => document.querySelector('.e3d-motor span')?.textContent.includes('pronto'), null, { timeout: 60000 });
}

async function main() {
  console.log('build + pacotes…');
  await construir();
  const { teste } = gerarPacotes();
  const modelos = path.join(tmp, 'modelos'); fs.mkdirSync(modelos);
  await gerarModelos(modelos);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

  console.log('1) regressão das abas (file://)');
  let pg = await novaPagina(b);
  await pg.goto('file://' + teste + '/index.html');
  await pg.waitForTimeout(1500);
  const abas = await pg.evaluate(() => NAV.flatMap(g => g[2].map(t => t[0])));
  for (const t of abas) await passo(pg, 'aba ' + t, async () => { await pg.evaluate(id => showTab(id), t); await pg.waitForTimeout(200); const a = await pg.evaluate(() => document.querySelector('.view.active')?.id); if (a !== 'view-' + t) throw new Error('aba não abriu: ' + a); });
  await passo(pg, 'PDF (html2pdf)', async () => {
    const src = await pg.evaluate(async () => { window.pdfViewer('<div style="padding:30px">Teste</div>', 't.pdf', 'Teste', ''); await new Promise(r => setTimeout(r, 4000)); return document.getElementById('pv_frame').src; });
    if (!src.startsWith('blob:')) throw new Error('PDF não gerou');
    await pg.evaluate(() => document.getElementById('modal-pdf-view').classList.remove('active'));
  });
  await pg.context().close();

  console.log('2) Estúdio por http:// (Web Worker)');
  const srv = servir(teste, 8791);
  pg = await novaPagina(b);
  await passo(pg, 'motor em worker via http', async () => {
    await abrirEstudio(pg, 'http://localhost:8791/index.html');
    const modo = await pg.evaluate(() => window.Estudio3D.estudio.modoMotor);
    if (modo !== 'worker') throw new Error('motor em modo ' + modo);
  });
  await pg.context().close(); srv.close();

  console.log('3) fluxo completo do Estúdio (file://)');
  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await passo(pg, 'abrir STL e analisar', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', modelos + '/personagem.stl');
    await pg.waitForFunction(() => /Malha fechada\s*OK/.test(document.querySelector('[data-sec=diag] .e3d-diag')?.textContent || ''), null, { timeout: 60000 });
  });
  await passo(pg, 'clique inteligente seleciona a orelha', async () => {
    await abrirSecao(pg, 'sel');
    await pg.click('[data-sec=sel] [data-a="modos"] button[data-v=regiao]');
    const w = await pg.evaluate(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetos[0]; const p = o.partes[0]; let best = null; for (let v = 0; v < p.malha.pos.length / 3; v++) { const x = p.malha.pos[v * 3], y = p.malha.pos[v * 3 + 1], z = p.malha.pos[v * 3 + 2]; if (x < -8 && (!best || z > best[2])) best = [x, y, z]; } const t = o.transform; e.visor.vista('frente'); e.enquadrar(); return [t[0] * best[0] + t[4] * best[1] + t[8] * best[2] + t[12], t[1] * best[0] + t[5] * best[1] + t[9] * best[2] + t[13], t[2] * best[0] + t[6] * best[1] + t[10] * best[2] + t[14] - 0.5]; });
    await pg.waitForTimeout(300);
    const s = await pg.evaluate(w => window.Estudio3D.estudio.visor.telaDe(w[0], w[1], w[2]), w);
    await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => /faces selecionadas/.test(document.querySelector('[data-sec=sel] [data-a="info"]').textContent));
  });
  await passo(pg, 'separar com pino (prévia + confirmar)', async () => {
    await abrirSecao(pg, 'sep');
    await pg.fill('[data-sec=sep] [data-a="nome"]', 'Orelha');
    await pg.selectOption('[data-sec=sep] [data-a="con"]', 'cilindrico');
    await pg.click('[data-sec=sep] [data-a="ir"]');
    await confirmarPrevia(pg);
    if (await nObjetos(pg) !== 2) throw new Error('esperava 2 objetos');
  });
  await passo(pg, 'desfazer / refazer', async () => {
    await pg.click('[data-b=desfazer]'); if (await nObjetos(pg) !== 1) throw new Error('desfazer');
    await pg.click('[data-b=refazer]'); if (await nObjetos(pg) !== 2) throw new Error('refazer');
  });
  await passo(pg, 'cortar com 2 pinos', async () => {
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.selecionar(e.cena.objetos[0].id, e.cena.objetos[0].partes[0].id); });
    await abrirSecao(pg, 'corte');
    await pg.selectOption('[data-sec=corte] [data-a="tipo"]', 'cilindrico');
    await pg.fill('[data-sec=corte] [data-a="quantidade"]', '2');
    await pg.fill('[data-sec=corte] [data-a="posmm"]', '20'); await pg.press('[data-sec=corte] [data-a="posmm"]', 'Enter');
    await pg.click('[data-sec=corte] [data-a="ir"]');
    await confirmarPrevia(pg);
    if (await nObjetos(pg) !== 3) throw new Error('esperava 3 objetos');
  });
  await passo(pg, 'chaveiro: texto na frente e telefone no verso', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', modelos + '/chaveiro.stl');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 4, null, { timeout: 30000 });
    await abrirSecao(pg, 'relevo');
    await pg.fill('[data-sec=relevo] [data-a="texto"]', '144 LAB');
    await pg.selectOption('[data-sec=relevo] [data-a="modo"]', 'alto-cor');
    await pg.click('[data-sec=relevo] [data-a="ir"]'); await confirmarPrevia(pg);
    await pg.click('[data-sec=relevo] [data-a="lado"] button[data-v=verso]');
    await pg.fill('[data-sec=relevo] [data-a="texto"]', '(21) 99999-9999');
    await pg.selectOption('[data-sec=relevo] [data-a="modo"]', 'embutido');
    await pg.fill('[data-sec=relevo] [data-a="largura"]', '50');
    await pg.click('[data-sec=relevo] [data-a="ir"]'); await confirmarPrevia(pg);
    const n = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos[3].partes.length);
    if (n !== 3) throw new Error('chaveiro com ' + n + ' peças');
  });
  await passo(pg, 'separar por cor (3MF pintado)', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', modelos + '/personagem-cor.3mf');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 5, null, { timeout: 30000 });
    await abrirSecao(pg, 'sep');
    await pg.click('[data-sec=sep] [data-a="porCor"]'); await confirmarPrevia(pg);
    const cores = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.slice(4).map(o => o.partes.map(p => p.cor + (p.paleta ? '*' : '')).join()));
    if (JSON.stringify(cores) !== JSON.stringify(['#1B1B1B', '#FFFFFF'])) throw new Error('cores: ' + cores);
  });
  await passo(pg, 'deitar na maior face plana', async () => {
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.selecionar(e.cena.objetos[2].id, e.cena.objetos[2].partes[0].id); });
    await abrirSecao(pg, 'transf');
    await pg.click('[data-sec=transf] [data-a="deitar"]');
    const z = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[2]).min[2]; });
    if (Math.abs(z) > 1e-6) throw new Error('não encostou na mesa: ' + z);
  });
  const arq3mf = path.join(tmp, 'estudio.3mf');
  await passo(pg, 'organizar e exportar 3MF + STL', async () => {
    await pg.click('[data-b=organizar]');
    await abrirSecao(pg, 'exp');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
    await dl.saveAs(arq3mf);
    const [dl2] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="stl"]')]);
    await dl2.saveAs(path.join(tmp, 'estudio-stl.zip'));
  });
  await passo(pg, '3MF exportado: Bambu (simulado) recebe a cor certa em cada peça', async () => {
    const s = simular(arq3mf);
    const vols = s.objetos.flatMap(o => o.volumes);
    const semCor = vols.filter(v => !v.cor_volume && !v.pintado);
    if (semCor.length) throw new Error('peças sem cor: ' + semCor.map(v => v.nome));
    const esperado = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.flatMap(o => o.partes.map(p => p.cor + 'FF')));
    const obtido = vols.map(v => v.cor_volume);
    if (JSON.stringify(esperado) !== JSON.stringify(obtido)) throw new Error('cores diferentes: ' + obtido + ' x ' + esperado);
  });
  await passo(pg, 'reabrir o 3MF exportado: mesmas peças, medidas e cores', async () => {
    const antes = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.objetos.map(o => ({ n: o.partes.length, c: o.partes.map(p => p.cor), cx: e.cena.caixaExata(o) })); });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos = []; }); });
    await pg.setInputFiles('.e3d input[type=file][multiple]', arq3mf);
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos.length === n, antes.length, { timeout: 60000 });
    const depois = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.objetos.map(o => ({ n: o.partes.length, c: o.partes.map(p => p.cor), cx: e.cena.caixaExata(o) })); });
    antes.forEach((a, i) => {
      const d = depois[i];
      if (a.n !== d.n || JSON.stringify(a.c) !== JSON.stringify(d.c)) throw new Error('objeto ' + i + ' mudou');
      for (let k = 0; k < 3; k++) if (Math.abs(a.cx.min[k] - d.cx.min[k]) > 1e-3 || Math.abs(a.cx.tam[k] - d.cx.tam[k]) > 1e-3) throw new Error('medida/posição do objeto ' + i);
    });
  });
  await pg.context().close();

  console.log('4) gerador de chaveiro');
  pg = await novaPagina(b);
  await pg.goto('file://' + teste + '/index.html');
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => showTab('ferr'));
  await passo(pg, 'gerador: 3MF com cor que o Bambu lê', async () => {
    await pg.click('#fer_entrada_seg button[data-v=texto]');
    await pg.fill('#fer_texto', 'MARIA');
    await pg.waitForFunction(() => document.getElementById('fer_acoes').style.display !== 'none', null, { timeout: 20000 });
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('#fer_3mf')]);
    const arq = path.join(tmp, 'gerador.3mf');
    await dl.saveAs(arq);
    const s = simular(arq);
    const vols = s.objetos.flatMap(o => o.volumes);
    if (vols.length !== 2 || vols.some(v => !v.cor_volume)) throw new Error(JSON.stringify(vols));
  });
  await passo(pg, 'gerador: Abrir no Estúdio 3D', async () => {
    await pg.click('#fer_estudio');
    await pg.waitForFunction(() => window.Estudio3D && window.Estudio3D.estudio && window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
  });
  await pg.context().close();
  await b.close();
  console.log(falhas ? '\n' + falhas + ' FALHA(S) — capturas em ' + tmp : '\nE2E: tudo certo');
  process.exit(falhas ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

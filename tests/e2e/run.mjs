// Testes de ponta a ponta no Chromium (Playwright), no pacote de TESTE:
//   node tests/e2e/run.mjs
// 0) equivalência com o sistema original: mesmas contas, abas e dados (tests/e2e/equivalencia.mjs)
// 1) regressão: todas as abas do ERP abrem sem erro de JavaScript + PDF
// 2) Estúdio 3D aberto por file:// (dois cliques) e por http://
// 3) fluxo completo: abrir, analisar, selecionar com clique, separar com
//    encaixe, desfazer/refazer, cortar com pinos, texto frente/verso,
//    separar por cor, exportar 3MF/STL, reabrir o 3MF exportado
// 10) orgânico: esculpir, torcer, desenhar (tests/e2e/organico.mjs)
// 11) v7: escala em mm, detalhe no pincel, curva, texto envolvendo, preparar (tests/e2e/v7.mjs)
// 12) v8: curva 3D, editar desenho, em pé, sobre a peça, texto na quina, vincar (tests/e2e/v8.mjs)
// 13) placas: várias placas na grade do Bambu, organizar, 3MF por placa (tests/e2e/placas.mjs)
// 16) separar por cor pra fabricação (tests/e2e/cores.mjs)
// 4) gerador de chaveiro: 3MF novo (cor que o Bambu lê), "Abrir no Estúdio", argola (centralizar, arrastar) e bolso da tag NFC no arquivo
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
  fs.writeFileSync(dir + '/grande.stl', escreverSTL(esfera(40, 7, 0, 0, 40), 'grande'));
  const { gerarBoneco } = await import('../util/boneco.mjs');
  fs.writeFileSync(dir + '/boneco.stl', escreverSTL(gerarBoneco('sujo').malha, 'boneco'));
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
    console.log('  FALHA ' + nome + ': ' + String(e.message).split('\n')[0] + (pg.erros.length ? ' | erros da página: ' + pg.erros.join(' | ').slice(0, 400) : ''));
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
  await pg.waitForFunction(() => document.querySelector('#ferr_estudio .e3d-motor span')?.textContent.includes('pronto'), null, { timeout: 60000 });
}

async function main() {
  console.log('build + pacotes…');
  await construir();
  await construir({ entrada: 'src/estudio3d/lab/fotos3d.js', saida: 'teste/laboratorio-fotos-3d.js' });
  const { teste } = gerarPacotes();
  const modelos = path.join(tmp, 'modelos'); fs.mkdirSync(modelos);
  await gerarModelos(modelos);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

  console.log('0) equivalência com o sistema original (calculadora, orçamento, relatórios, todas as abas, dados) — antes e depois de usar o Estúdio');
  {
    const { equivalencia } = await import('./equivalencia.mjs');
    const pg0 = await novaPagina(b);
    await passo(pg0, 'original × atual: 88 contas da calculadora, orçamento, DRE/ABC/canais/clientes, 15 abas e dados idênticos (e continuam idênticos depois de usar o Estúdio 3D)', async () => {
      const r = await equivalencia({ b, tmp, teste, log: null });
      const d = [...r.difAtual, ...r.difDepoisEstudio];
      if (r.naoDeterminismo.length) throw new Error('comparação não determinística: ' + r.naoDeterminismo[0]);
      if (d.length || r.erros.length) throw new Error(d.length + ' diferença(s): ' + d.slice(0, 3).join(' | ') + (r.erros.length ? ' | erro: ' + r.erros[0] : ''));
    });
    await pg0.context().close();
  }

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
  await passo(pg, 'modo escuro: liga, lembra ao recarregar e o PDF continua branco', async () => {
    await pg.evaluate(() => window.alternarTema());
    await pg.reload(); await pg.waitForTimeout(1200);
    if (await pg.evaluate(() => document.documentElement.dataset.tema) !== 'escuro') throw new Error('tema não foi lembrado');
    const fundo = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (fundo !== 'rgb(14, 16, 19)') throw new Error('fundo não escureceu: ' + fundo);
    const lum = await pg.evaluate(async () => {
      await new Promise((ok, falha) => carregarPDF(ok, falha));
      const el = document.createElement('div');
      el.innerHTML = '<div style="padding:30px;width:600px;font-size:22px"><b>Orçamento</b><p>texto sem cor definida</p><table><tr><th>Peça</th><td>R$ 10,00</td></tr></table></div>';
      const cv = await html2pdf().set({ html2canvas: { scale: 1 } }).from(el).toCanvas().get('canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let soma = 0, min = 255;
      for (let i = 0; i < d.length; i += 4) { const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; soma += l; if (l < min) min = l; }
      return { media: soma / (d.length / 4), min };
    });
    if (lum.media < 235 || lum.min > 90) throw new Error('PDF no modo escuro não está branco com texto escuro: ' + JSON.stringify(lum));
  });
  await passo(pg, 'modo escuro: nenhum texto ilegível nas ' + abas.length + ' telas', async () => {
    const ruins = [];
    for (const t of abas) {
      await pg.evaluate(id => showTab(id), t); await pg.waitForTimeout(150);
      const r = await pg.evaluate(() => {
        const rgb = c => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
        const L = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const fundoDe = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0.5) return c; } return [14, 16, 19]; };
        const out = [];
        for (const el of document.querySelectorAll('.view.active *')) {
          if (!el.offsetParent || !el.childNodes.length) continue;
          const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
          if (!txt) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || +cs.opacity < 0.5) continue;
          const a = L(rgb(cs.color)), b = L(fundoDe(el));
          const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (razao < 2.2) out.push(txt.slice(0, 30) + ' (' + razao.toFixed(1) + ')');
        }
        return out;
      });
      if (r.length) ruins.push(t + ': ' + r.slice(0, 4).join(' | '));
    }
    await pg.evaluate(() => window.alternarTema());
    if (ruins.length) throw new Error(ruins.join(' ;; '));
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
  await passo(pg, 'Início: sugestões e tarefa "Cortar" + corte pelo teclado', async () => {
    await pg.click('.e3d-rail [data-ferr=inicio]');
    await pg.waitForSelector('.e3d-sug', { timeout: 20000 });
    await pg.click('.e3d-tarefa[data-tarefa=corte]');
    if (!(await pg.evaluate(() => document.querySelector('[data-sec=corte]').open))) throw new Error('tarefa não abriu o corte');
    const antes = await pg.evaluate(() => document.querySelector('[data-sec=corte] [data-a="posmm"]').value);
    await pg.evaluate(() => document.activeElement && document.activeElement.blur());
    await pg.keyboard.press('ArrowUp');
    const depois = await pg.evaluate(() => document.querySelector('[data-sec=corte] [data-a="posmm"]').value);
    const n = v => parseFloat(v.replace(/\./g, '').replace(',', '.'));
    if (Math.abs(n(depois) - n(antes) - 1) > 0.01) throw new Error('seta ↑ não subiu 1 mm: ' + antes + ' -> ' + depois);
    await pg.waitForFunction(() => /Seção do corte/.test(document.querySelector('[data-sec=corte] [data-a="secao"]').textContent), null, { timeout: 5000 });
    await pg.click('.e3d-rail [data-ferr=inicio]');
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

  console.log('4) auditoria da interface (mouse e teclado de verdade)');
  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await pg.setInputFiles('.e3d input[type=file][multiple]', modelos + '/personagem.stl');
  await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1);
  await pg.waitForTimeout(600);
  const cam = () => pg.evaluate(() => { const v = window.Estudio3D.estudio.visor; const c = v.camera.position, t = v.controles.target; return { c: [c.x, c.y, c.z], t: [t.x, t.y, t.z] }; });
  const caixaCanvas = () => pg.evaluate(() => { const r = window.Estudio3D.estudio.visor.renderer.domElement.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const telaObjeto = () => pg.evaluate(() => { const e = window.Estudio3D.estudio; const c = e.cena.caixaExata(e.cena.objetos[0]); return e.visor.telaDe((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2); });
  await passo(pg, 'visor: girar (arrastar), mover a vista (botão direito) e zoom (rodinha)', async () => {
    const r = await caixaCanvas();
    const x0 = r.x + r.w * 0.85, y0 = r.y + r.h * 0.5;
    let a = await cam();
    await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move(x0 - 120, y0 + 40, { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(400);
    let d = await cam();
    const ang = (u, v) => { const p = [u.c[0] - u.t[0], u.c[1] - u.t[1], u.c[2] - u.t[2]], q = [v.c[0] - v.t[0], v.c[1] - v.t[1], v.c[2] - v.t[2]]; return Math.acos(Math.min(1, (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / Math.hypot(...p) / Math.hypot(...q))) * 180 / Math.PI; };
    if (ang(a, d) < 10) throw new Error('girar não girou: ' + ang(a, d).toFixed(1) + '°');
    a = d;
    await pg.mouse.move(x0, y0); await pg.mouse.down({ button: 'right' }); await pg.mouse.move(x0 - 100, y0 - 60, { steps: 8 }); await pg.mouse.up({ button: 'right' }); await pg.waitForTimeout(400);
    d = await cam();
    if (Math.hypot(d.t[0] - a.t[0], d.t[1] - a.t[1], d.t[2] - a.t[2]) < 1) throw new Error('mover a vista não moveu o alvo');
    a = d;
    await pg.mouse.move(x0, y0); await pg.mouse.wheel(0, -600); await pg.waitForTimeout(500);
    d = await cam();
    const dist = u => Math.hypot(u.c[0] - u.t[0], u.c[1] - u.t[1], u.c[2] - u.t[2]);
    if (!(dist(d) < dist(a) * 0.95)) throw new Error('zoom não aproximou: ' + dist(a).toFixed(1) + ' -> ' + dist(d).toFixed(1));
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('iso'); e.enquadrar(); });
  });
  await passo(pg, 'clicar escolhe a peça, clicar no vazio solta', async () => {
    await pg.evaluate(() => window.Estudio3D.estudio.cena.selecionar(null, null));
    const s = await telaObjeto();
    await pg.mouse.click(s.x, s.y); await pg.waitForTimeout(200);
    if (!(await pg.evaluate(() => !!window.Estudio3D.estudio.cena.sel.objeto))) throw new Error('clique não escolheu');
    const r = await caixaCanvas();
    await pg.mouse.click(r.x + 20, r.y + r.h - 90); await pg.waitForTimeout(200);
    if (await pg.evaluate(() => !!window.Estudio3D.estudio.cena.sel.objeto)) throw new Error('clique no vazio não soltou');
  });
  await passo(pg, 'seta de mover (G): arrastar move a peça; Ctrl+Z desfaz, Ctrl+Y refaz', async () => {
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    await pg.keyboard.press('g'); await pg.waitForTimeout(300);
    const antes = await pg.evaluate(() => Array.from(window.Estudio3D.estudio.cena.objetos[0].transform.slice(12, 15)));
    // a seta de mover fica na origem do objeto: arrasta pela ponta vermelha (eixo X)
    const s = await pg.evaluate(() => { const v = window.Estudio3D.estudio.visor; const g = v.gizmo.object; const p = g.getWorldPosition(g.position.clone()); const a = v.telaDe(p.x, p.y, p.z); const dist = v.camera.position.distanceTo(p); const k = dist * Math.min(1.9 * Math.tan(Math.PI * v.camera.fov / 360) / v.camera.zoom, 7) / 4 * 0.9; const b = v.telaDe(p.x + k * 0.6, p.y, p.z); return { a, b }; });
    await pg.mouse.move(s.b.x, s.b.y); await pg.waitForTimeout(100); await pg.mouse.down(); await pg.mouse.move(s.b.x + (s.b.x - s.a.x) * 1.5, s.b.y + (s.b.y - s.a.y) * 1.5, { steps: 10 }); await pg.mouse.up(); await pg.waitForTimeout(300);
    const depois = await pg.evaluate(() => Array.from(window.Estudio3D.estudio.cena.objetos[0].transform.slice(12, 15)));
    if (Math.hypot(depois[0] - antes[0], depois[1] - antes[1], depois[2] - antes[2]) < 1) throw new Error('gizmo não moveu: ' + antes + ' -> ' + depois);
    await pg.keyboard.press('Control+z'); await pg.waitForTimeout(200);
    const desf = await pg.evaluate(() => Array.from(window.Estudio3D.estudio.cena.objetos[0].transform.slice(12, 15)));
    if (Math.hypot(desf[0] - antes[0], desf[1] - antes[1], desf[2] - antes[2]) > 1e-6) throw new Error('Ctrl+Z não voltou');
    await pg.keyboard.press('Control+y'); await pg.waitForTimeout(200);
    const ref = await pg.evaluate(() => Array.from(window.Estudio3D.estudio.cena.objetos[0].transform.slice(12, 15)));
    if (Math.hypot(ref[0] - depois[0], ref[1] - depois[1], ref[2] - depois[2]) > 1e-6) throw new Error('Ctrl+Y não refez');
    await pg.keyboard.press('Escape');
  });
  await passo(pg, 'medidas em mm: posição X e altura digitadas viram a medida real', async () => {
    await abrirSecao(pg, 'transf');
    await pg.fill('[data-sec=transf] [data-t="px"]', '100'); await pg.press('[data-sec=transf] [data-t="px"]', 'Enter'); await pg.waitForTimeout(200);
    await pg.fill('[data-sec=transf] [data-t="tz"]', '30'); await pg.press('[data-sec=transf] [data-t="tz"]', 'Enter'); await pg.waitForTimeout(300);
    const c = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[0]); });
    if (Math.abs(c.tam[2] - 30) > 0.01) throw new Error('altura ' + c.tam[2]);
    if (Math.abs((c.min[0] + c.max[0]) / 2 - 100) > 0.6 && Math.abs(c.min[0] - 100) > 0.6) throw new Error('posição X ' + c.min[0] + '..' + c.max[0]);
  });
  await passo(pg, 'pincel: pinta arrastando, "Apagar" tira, Expandir/Reduzir mudam a seleção', async () => {
    await abrirSecao(pg, 'sel');
    await pg.click('[data-sec=sel] [data-a="modos"] button[data-v=pincel]');
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('frente'); e.enquadrar(); });
    await pg.waitForTimeout(300);
    const n = () => pg.evaluate(() => { const e = window.Estudio3D.estudio; const p = e.cena.objetos[0].partes[0]; const m = e.visor.selecao(p.id); let k = 0; if (m) for (let i = 0; i < m.length; i++) k += m[i]; return k; });
    const s = await telaObjeto();
    await pg.mouse.move(s.x - 30, s.y); await pg.mouse.down(); await pg.mouse.move(s.x + 30, s.y, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(300);
    const pintado = await n();
    if (pintado < 20) throw new Error('pincel pintou ' + pintado);
    await pg.click('[data-sec=sel] [data-a="exp"]'); const exp = await n();
    await pg.click('[data-sec=sel] [data-a="red"]'); const red = await n();
    if (!(exp > pintado && red < exp)) throw new Error('expandir/reduzir: ' + pintado + ' -> ' + exp + ' -> ' + red);
    await pg.click('[data-sec=sel] [data-a="pincelModo"] button[data-v=tirar]');
    await pg.mouse.move(s.x - 30, s.y); await pg.mouse.down(); await pg.mouse.move(s.x + 30, s.y, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(300);
    const apagado = await n();
    if (!(apagado < red)) throw new Error('apagar não tirou: ' + red + ' -> ' + apagado);
    await pg.click('[data-sec=sel] [data-a="pincelModo"] button[data-v=add]');
    await pg.click('[data-sec=sel] [data-a="limpar"]');
    await pg.keyboard.press('Escape');
  });
  await passo(pg, 'Cancelar: consertar um modelo de 330 mil triângulos, cancelar no meio, motor volta a funcionar', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', modelos + '/grande.stl');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 60000 });
    await pg.waitForFunction(() => !/confer|calcul/.test(document.querySelector('.e3d-motor').textContent), null, { timeout: 60000 });
    await abrirSecao(pg, 'diag');
    await pg.click('[data-sec=diag] [data-a="reparar"]');
    await pg.waitForSelector('.e3d-ocupado [data-o=cancelar]', { state: 'visible', timeout: 20000 });
    const antes = await nObjetos(pg);
    await pg.click('.e3d-ocupado [data-o=cancelar]');
    await pg.waitForFunction(() => !document.querySelector('.e3d-ocupado').classList.contains('on'), null, { timeout: 20000 });
    if (await nObjetos(pg) !== antes) throw new Error('cancelar mudou a cena');
    const r = await pg.evaluate(async () => { const e = window.Estudio3D.estudio; const p = e.cena.objetos[0].partes[0]; const v = await e.motor.rodar('analisar', { parte: e.parteParaMotor(p), opc: {} }, { canal: 'principal' }); return v.fechada; });
    if (r !== true) throw new Error('motor não voltou');
    pg.erros = pg.erros.filter(x => !/Cancelado/.test(x));
  });
  await pg.context().close();

  console.log('5) modelagem simples: o fluxo do funcionário');
  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const doEst = (f, a) => pg.evaluate(f, a);
  const campoForma = async (k, v) => { await pg.fill('[data-sec=formas] [data-p="' + k + '"]', String(v)); await pg.press('[data-sec=formas] [data-p="' + k + '"]', 'Enter'); await pg.waitForTimeout(400); };
  const esperarMotor = () => pg.waitForFunction(() => !/calcul/.test(document.querySelector('.e3d-motor').textContent) && !document.querySelector('.e3d-ocupado').classList.contains('on'), null, { timeout: 60000 });
  const posX = async (x, y) => { await abrirSecao(pg, 'transf'); await pg.fill('[data-sec=transf] [data-t="px"]', String(x)); await pg.press('[data-sec=transf] [data-t="px"]', 'Enter'); if (y != null) { await pg.fill('[data-sec=transf] [data-t="py"]', String(y)); await pg.press('[data-sec=transf] [data-t="py"]', 'Enter'); } await pg.waitForTimeout(200); };
  let arqModelagem = null;
  await passo(pg, 'retângulo 60×30×3 + círculo Ø30 na ponta, selecionar os dois e UNIR', async () => {
    await pg.click('.e3d-rail [data-ferr=formas]');
    await pg.click('[data-sec=formas] [data-forma=retangulo]'); await esperarMotor(); await pg.waitForTimeout(300);
    await campoForma('largura', 60); await campoForma('comprimento', 30); await campoForma('espessura', 3); await esperarMotor();
    const ret = await doEst(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetoSel(); return { id: o.id, c: e.cena.caixaExata(o) }; });
    if (Math.abs(ret.c.tam[0] - 60) > 1e-6 || Math.abs(ret.c.tam[1] - 30) > 1e-6 || Math.abs(ret.c.tam[2] - 3) > 1e-6) throw new Error('retângulo ' + ret.c.tam);
    await pg.click('.e3d-rail [data-ferr=formas]');
    await pg.click('[data-sec=formas] [data-forma=circulo]'); await esperarMotor(); await pg.waitForTimeout(300);
    await campoForma('diametro', 30); await campoForma('espessura', 3); await esperarMotor();
    const cx = (ret.c.min[0] + ret.c.max[0]) / 2, cy = (ret.c.min[1] + ret.c.max[1]) / 2;
    await posX(ret.c.max[0], cy);                                    // centro do círculo na ponta direita
    await doEst(id => { const e = window.Estudio3D.estudio; const c = e.cena.objetoSel(); e.cena.selecionar(id, null); e.cena.selecionar(c.id, null, true); }, ret.id);
    await pg.waitForSelector('.e3d-multi', { state: 'visible' });
    await pg.click('.e3d-multi .btn.primary'); await esperarMotor(); await pg.waitForTimeout(300);
    const r = await doEst(() => { const e = window.Estudio3D.estudio; return { n: e.cena.objetos.length, c: e.cena.caixaExata(e.cena.objetos[0]) }; });
    if (r.n !== 1) throw new Error('unir deixou ' + r.n + ' objetos');
    if (Math.abs(r.c.tam[0] - 75) > 0.01) throw new Error('largura unida ' + r.c.tam[0]);
  });
  await passo(pg, 'círculo Ø5 marcado como FURO na ponta: aparece furado ao vivo', async () => {
    const u = await doEst(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[0]); });
    await pg.click('.e3d-rail [data-ferr=formas]');
    await pg.click('[data-sec=formas] [data-forma=circulo]'); await esperarMotor(); await pg.waitForTimeout(300);
    await campoForma('diametro', 5); await campoForma('espessura', 3); await esperarMotor();
    await pg.click('[data-sec=formas] .e3d-props [data-v=furo]'); await pg.waitForTimeout(200);
    await posX(u.max[0] - 8, (u.min[1] + u.max[1]) / 2);
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetos[0]; const f = e.furados.get(o.id); return f && f.malhas.size > 0; }, null, { timeout: 30000 });
    const vis = await doEst(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetos[0]; const it = e.visor.itens.get(o.partes[0].id); return it.malha !== o.partes[0].malha; });
    if (!vis) throw new Error('a tela não mostra a peça furada');
  });
  await passo(pg, 'texto "144" em relevo de 0,8 mm em cima', async () => {
    await doEst(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetos.find(x => x.papel !== 'furo'); e.cena.selecionar(o.id, o.partes[0].id); });
    await abrirSecao(pg, 'relevo'); await pg.waitForTimeout(300);
    await pg.fill('[data-sec=relevo] [data-a="texto"]', '144');
    await pg.selectOption('[data-sec=relevo] [data-a="modo"]', 'alto');
    await pg.fill('[data-sec=relevo] [data-a="altura"]', '0,8');
    await pg.fill('[data-sec=relevo] [data-a="largura"]', '30');
    await pg.click('[data-sec=relevo] [data-a="ir"]'); await confirmarPrevia(pg); await esperarMotor();
  });
  await passo(pg, 'EXPORTAR: o 3MF tem o furo de verdade, o texto, e nenhum objeto-furo', async () => {
    await abrirSecao(pg, 'exp');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
    arqModelagem = path.join(tmp, 'modelagem.3mf'); await dl.saveAs(arqModelagem);
    const { executar } = await import('../../src/estudio3d/motor/operacoes.js');
    const { volume, transformar } = await import('../../src/estudio3d/core/malha.js');
    const { validar } = await import('../../src/estudio3d/core/validador.js');
    const { comContexto } = await import('../../src/estudio3d/core/solidos.js');
    const r = executar('importar', { nome: 'm.3mf', bytes: new Uint8Array(fs.readFileSync(arqModelagem)), extras: {} });
    if (r.objetos.length !== 1) throw new Error('objetos no arquivo: ' + r.objetos.map(o => o.nome).join(', '));
    const o = r.objetos[0];
    for (const p of o.partes) { const v = validar(p.malha, { completo: true }); if (v.arestasAbertas || v.arestasNaoManifold || v.autoInterseccoes || v.facesDegeneradas) throw new Error('peça exportada com defeito: ' + JSON.stringify({ a: v.arestasAbertas, nm: v.arestasNaoManifold, ai: v.autoInterseccoes, d: v.facesDegeneradas })); }
    const mundo = o.partes.map(p => transformar(p.malha, o.transform));
    const vol = mundo.reduce((s, m) => s + volume(m), 0);
    const base = 60 * 30 * 3 + Math.PI * 15 * 15 * 3 / 2, furo = Math.PI * 2.5 * 2.5 * 3;
    if (!(vol > base - furo - 2 && vol < base - furo + 60 * 30 * 0.8)) throw new Error('volume ' + vol.toFixed(1) + ' (base ' + base.toFixed(1) + ', furo ' + furo.toFixed(1) + ')');
    // a 1,5 mm de altura a seção tem o furo (área = base - furo)
    const area = comContexto(ctx => mundo.reduce((s, m) => s + ctx.guardar(ctx.guardar(ctx.solido({ malha: m, cor: '#000' })).slice(1.5)).area(), 0));
    const esperado = 60 * 30 + Math.PI * 15 * 15 / 2 - Math.PI * 2.5 * 2.5;
    if (Math.abs(area - esperado) > 0.6) throw new Error('seção a 1,5 mm: ' + area.toFixed(2) + ' (esperado ' + esperado.toFixed(2) + ' — sem furo seria ' + (esperado + Math.PI * 6.25).toFixed(2) + ')');
  });
  await passo(pg, 'duplicar em série (4 cópias a cada 10 mm) e alinhar', async () => {
    await pg.click('.e3d-rail [data-ferr=formas]');
    await pg.click('[data-sec=formas] [data-forma=cilindro]'); await esperarMotor(); await pg.waitForTimeout(300);
    await abrirSecao(pg, 'transf');
    await pg.fill('[data-sec=transf] [data-a="serieN"]', '4'); await pg.fill('[data-sec=transf] [data-a="serieD"]', '25');
    await pg.click('[data-sec=transf] [data-a="serie"]'); await pg.waitForTimeout(300);
    const xs = await doEst(() => { const e = window.Estudio3D.estudio; return e.cena.objetosSel().map(o => o.transform[12]); });
    if (xs.length !== 5) throw new Error('cópias: ' + xs.length);
    for (let k = 1; k < 5; k++) if (Math.abs(xs[k] - xs[0] - 25 * k) > 1e-6) throw new Error('distância errada: ' + xs);
    await pg.click('.e3d-multi .e3d-alinhar > .btn'); await pg.click('.e3d-multi [data-alinhar=base]');
    await pg.click('.e3d-multi .e3d-alinhar > .btn'); await pg.click('.e3d-multi [data-alinhar=centroY]');
    const ys = await doEst(() => { const e = window.Estudio3D.estudio; return e.cena.objetosSel().map(o => { const c = e.cena.caixaExata(o); return [(c.min[1] + c.max[1]) / 2, c.min[2]]; }); });
    for (const [y, z] of ys) if (Math.abs(y - ys[0][0]) > 1e-6 || Math.abs(z) > 1e-6) throw new Error('alinhar: ' + JSON.stringify(ys));
  });
  await pg.screenshot({ path: path.join(tmp, 'modelagem.png') });
  await pg.context().close();

  console.log('6) gerador de chaveiro');
  const { secaoGerador } = await import('./gerador.mjs');
  await secaoGerador({ b, teste, tmp, raiz, novaPagina, passo, simular });
  const { secaoCSP } = await import('./csp.mjs');
  await secaoCSP({ b, teste, novaPagina, passo });
  const { secaoXSS } = await import('./xss.mjs');
  await secaoXSS({ b, teste, novaPagina, passo });
  const { secaoXSS3D } = await import('./xss3d.mjs');
  await secaoXSS3D({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoCorrida } = await import('./corrida.mjs');
  await secaoCorrida({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoLaudo } = await import('./laudo.mjs');
  await secaoLaudo({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoTrabalho } = await import('./trabalho.mjs');
  await secaoTrabalho({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoDiagnostico } = await import('./diagnostico.mjs');
  await secaoDiagnostico({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoDesenhar } = await import('./desenhar.mjs');
  await secaoDesenhar({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoSupabaseKit } = await import('./supabase-kit.mjs');
  await secaoSupabaseKit({ b, novaPagina, passo, pagina: path.join(teste, 'seguranca', 'verificar-supabase.html'), empacotada: true });
  const { secaoNuvem } = await import('./nuvem.mjs');
  await secaoNuvem({ chromium, passo });
  const { secaoNuvemProtegida } = await import('./nuvem-protegida.mjs');
  await secaoNuvemProtegida({ chromium, passo });
  const { secaoMenu } = await import('./menu.mjs');
  await secaoMenu({ b, teste, novaPagina, passo, abrirEstudio, abrirSecao });

  console.log('7b) pegar olho/orelha num clique (passar o mouse acende) e separar pela barra');
  const { secaoParte } = await import('./parte.mjs');
  await secaoParte({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });
  const { secaoUso } = await import('./uso.mjs');
  await secaoUso({ b, teste, tmp, novaPagina, passo, abrirEstudio });

  console.log('8) separar a mão do boneco (STL cru, com furos) pelo corte de uma parte');
  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const { validar } = await import('../../src/estudio3d/core/validador.js');
  const valida = async idx => {
    const m = await pg.evaluate(i => { const o = window.Estudio3D.estudio.cena.objetos[i]; const p = o.partes[0].malha; return { pos: Array.from(p.pos), idx: Array.from(p.idx), nome: o.nome }; }, idx);
    const v = validar({ pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) }, { completo: true });
    if (!v.fechada || v.autoInterseccoes > 2 || !(v.volume > 0)) throw new Error(m.nome + ': ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, vol: v.volume }));
    return v.volume;
  };
  await passo(pg, 'clicar na mão -> corte vai pro pulso -> encaixe -> 2 sólidos válidos', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', modelos + '/boneco.stl');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await abrirSecao(pg, 'corte');
    await pg.click('[data-sec=corte] [data-a=modo] button[data-v=parte]');
    await pg.selectOption('[data-sec=corte] [data-a=tipo]', 'cilindrico');
    // palma da mão direita (costas da mão, acima do polegar), no referencial da caixa do boneco
    const s = await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return e.visor.telaDe(c.min[0] + 49.9, c.min[1] + 7.7, c.min[2] + 34); });
    await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => /Achei o ponto mais fino|erro/.test(document.querySelector('[data-sec=corte] [data-a=res]').textContent), null, { timeout: 60000 });
    const txt = await pg.textContent('[data-sec=corte] [data-a=res]');
    if (!/Achei/.test(txt)) throw new Error(txt);
    await pg.click('[data-sec=corte] [data-a=ir]'); await confirmarPrevia(pg);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length >= 2, null, { timeout: 60000 });
    const res = await pg.textContent('[data-sec=corte] [data-a=res]');
    if (!/com encaixe/.test(res)) throw new Error('sem encaixe: ' + res);
    const vResto = await valida(0), vMao = await valida(1);
    if (!(vMao > 150 && vMao < 800)) throw new Error('a parte não é a mão: ' + vMao.toFixed(0) + ' mm³');
    if (!(vResto > 38000)) throw new Error('resto ' + vResto);
  });
  await passo(pg, 'desfazer volta o boneco inteiro', async () => {
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 20000 });
  });
  await passo(pg, 'selecionar a cabeça num clique (até o pescoço) e Separar: 2 sólidos válidos', async () => {
    await abrirSecao(pg, 'sel');
    await pg.click('[data-sec=sel] [data-a=modos] button[data-v=membro]');
    const s = await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return e.visor.telaDe(c.min[0] + 26.4, c.min[1] + 1.5, c.min[2] + 99); });
    await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => /faces|mm²/.test(document.querySelector('[data-sec=sel] [data-a=info]').textContent), null, { timeout: 60000 });
    await abrirSecao(pg, 'sep');
    await pg.click('[data-sec=sep] [data-a="ir"]');
    await pg.waitForFunction(() => document.querySelector('.e3d-previa')?.offsetParent || document.querySelector('[data-sec=sep] .erro'), null, { timeout: 120000 });
    const erro = await pg.evaluate(() => document.querySelector('[data-sec=sep] .erro')?.textContent);
    if (erro) throw new Error(erro);
    await confirmarPrevia(pg);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 60000 });
    const v0 = await valida(0), v1 = await valida(1);
    const cab = Math.min(v0, v1);
    if (!(cab > 5000 && cab < 9000)) throw new Error('a parte não é a cabeça: ' + cab.toFixed(0));
  });
  await pg.context().close();

  console.log('9) modelar: caixa -> arredondar todas as bordas -> deixar oca aberta em cima -> mudar a medida refaz tudo');
  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const malhaDe = i => pg.evaluate(k => { const o = window.Estudio3D.estudio.cena.objetos[k]; const p = o.partes[0].malha; return { pos: Array.from(p.pos), idx: Array.from(p.idx), ops: (o.operacoes || []).length }; }, i);
  const conferir = async (rot, tam) => {
    const m = await malhaDe(0), M = { pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) };
    const v = validar(M, { completo: true });
    if (!v.fechada || v.autoInterseccoes || v.facesDegeneradas || !(v.volume > 0)) throw new Error(rot + ': ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas }));
    const { caixa: cx } = await import('../../src/estudio3d/core/malha.js');
    const t = cx(M).tam;
    if (tam && t.some((x, i) => Math.abs(x - tam[i]) > 1e-3)) throw new Error(rot + ': medida ' + t.map(x => x.toFixed(3)).join('x'));
    return { v, ops: m.ops };
  };
  await passo(pg, 'caixa 30×20×10 + arredondar todas as bordas 2 mm (prévia, aplicar): medidas mantidas, malha válida', async () => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    for (const [k, v] of [['largura', '30'], ['profundidade', '20'], ['altura', '10']]) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', v); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(400); }
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[0] - c.min[0] - 30) < 1e-6 && Math.abs(c.max[2] - c.min[2] - 10) < 1e-6; }, null, { timeout: 30000 });
    await abrirSecao(pg, 'mod');
    await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=arredondar]');
    await pg.click('[data-sec=mod] [data-a=todas]');
    await pg.fill('[data-sec=mod] [data-a=valor]', '2');
    await pg.click('[data-sec=mod] [data-a=ir]'); await confirmarPrevia(pg);
    await pg.waitForFunction(() => (window.Estudio3D.estudio.cena.objetos[0].operacoes || []).length === 1, null, { timeout: 60000 });
    await conferir('arredondar', [30, 20, 10]);
  });
  await passo(pg, 'deixar oca (parede 2 mm) aberta na face de cima', async () => {
    await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=casca]');
    const s = await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return e.visor.telaDe((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, c.max[2]); });
    await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => /1<\/b> face/.test(document.querySelector('[data-sec=mod] [data-a=info]').innerHTML), null, { timeout: 20000 });
    await pg.fill('[data-sec=mod] [data-a=parede]', '2');
    await pg.click('[data-sec=mod] [data-a=ir]'); await confirmarPrevia(pg);
    await pg.waitForFunction(() => (window.Estudio3D.estudio.cena.objetos[0].operacoes || []).length === 2, null, { timeout: 90000 });
    const r = await conferir('oca', [30, 20, 10]);
    if (!(r.v.volume < 3000 && r.v.componentes === 1)) throw new Error('não ficou pote: ' + r.v.volume + ' / ' + r.v.componentes);
  });
  await passo(pg, 'mudar a largura pra 50 refaz o arredondado e a casca; desfazer volta', async () => {
    await abrirSecao(pg, 'formas');
    await pg.fill('[data-sec=formas] [data-p=largura]', '50'); await pg.press('[data-sec=formas] [data-p=largura]', 'Enter');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[0] - c.min[0] - 50) < 1e-6; }, null, { timeout: 90000 });
    const r = await conferir('refeita', [50, 20, 10]);
    if (r.ops !== 2 || !(r.v.volume < 5000)) throw new Error('operações não refeitas: ' + r.ops + ' vol ' + r.v.volume);
    if (await pg.locator('[data-sec=formas] .e3d-op').count() !== 2) throw new Error('lista de operações');
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[0] - c.min[0] - 30) < 1e-6; }, null, { timeout: 20000 });
  });
  await passo(pg, 'medida digitada não some se o painel se redesenhar no meio (ex.: uma operação terminando)', async () => {
    await abrirSecao(pg, 'formas'); await pg.waitForTimeout(200);
    await pg.fill('[data-sec=formas] [data-p=altura]', '12');
    // redesenha o painel com o campo ainda em edição
    await pg.evaluate(() => document.querySelector('[data-sec=formas]').dispatchEvent(new Event('toggle')));
    const v = await pg.evaluate(() => [document.activeElement.dataset.p, document.querySelector('[data-sec=formas] [data-p=altura]').value]);
    if (v[0] !== 'altura' || v[1] !== '12') throw new Error('o valor digitado sumiu no redesenho: ' + JSON.stringify(v));
    await pg.press('[data-sec=formas] [data-p=altura]', 'Enter');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[2] - c.min[2] - 12) < 1e-6; }, null, { timeout: 90000 });
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[2] - c.min[2] - 10) < 1e-6; }, null, { timeout: 20000 });
  });
  await passo(pg, 'caixa nova: medir borda (40 mm), simetria X pega as 2 verticais, puxar a face de cima +5', async () => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 30000 });
    const tela = (fx, fy, fz) => pg.evaluate(([a, b, c]) => { const e = window.Estudio3D.estudio, o = e.cena.objetos[1], x = e.cena.caixaExata(o); return e.visor.telaDe(x.min[0] + a * (x.max[0] - x.min[0]), x.min[1] + b * (x.max[1] - x.min[1]), x.min[2] + c * (x.max[2] - x.min[2])); }, [fx, fy, fz]);
    await abrirSecao(pg, 'mod');
    await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=medir]');
    let s = await tela(0.5, 0, 1); await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => /40,00 mm/.test(document.querySelector('[data-sec=mod] [data-a=info]').textContent), null, { timeout: 10000 });
    await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=arredondar]');
    await pg.check('[data-sec=mod] [data-a=simX]');
    s = await tela(0, 0, 0.5); await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => /<b>2<\/b> borda/.test(document.querySelector('[data-sec=mod] [data-a=info]').innerHTML), null, { timeout: 10000 });
    await pg.uncheck('[data-sec=mod] [data-a=simX]');
    await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=puxar]');
    s = await tela(0.5, 0.5, 1); await pg.mouse.click(s.x, s.y);
    await pg.fill('[data-sec=mod] [data-a=dist]', '5');
    await pg.click('[data-sec=mod] [data-a=ir]'); await confirmarPrevia(pg);
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[1]); return Math.abs(c.max[2] - c.min[2] - 25) < 1e-6; }, null, { timeout: 30000 });
  });
  await pg.context().close();

  console.log('10) orgânico: esculpir com simetria, torcer com prévia, desenhar e criar peça');
  const { secaoOrganico } = await import('./organico.mjs');
  await secaoOrganico({ b, teste, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia });

  console.log('11) v7: escala em mm, pincel com detalhe, curva suave, texto envolvendo, preparar pra imprimir');
  const { secaoV7 } = await import('./v7.mjs');
  await secaoV7({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia });

  console.log('12) v8: tubo que sobe, editar desenho depois, desenho em pé, tubo sobre a peça, texto na quina, vincar');
  const { secaoV8 } = await import('./v8.mjs');
  await secaoV8({ b, teste, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia });

  console.log('13) placas: organizar cria placas, +, placa ativa, levar pra outra placa, 3MF por placa, abrir de novo, preparar');
  const { secaoPlacas } = await import('./placas.mjs');
  await secaoPlacas({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao });

  console.log('14) suavizar: boneco de IA, Forte com prévia, desfazer, 3MF, só a seleção, progresso e cancelar, facetada');
  const { secaoSuavizar } = await import('./suavizar.mjs');
  await secaoSuavizar({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia });

  console.log('15) corte com pinos no boneco de IA: cada pedaço com encaixe, pino não bate no furo, 3MF, parede fina explica');
  const { secaoPinos } = await import('./pinos.mjs');
  await secaoPinos({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia });

  console.log('16) separar por cor pra fabricação: personagem 3 cores, prévia diz como saiu, peças montam sem sobrepor, 3MF, faixa com folga, pane do motor');
  const { secaoCores } = await import('./cores.mjs');
  await secaoCores({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia });

  console.log('7) laboratório fotos -> 3D (pacote de teste, file://)');
  const { cenaDeFotos } = await import('../util/fotos.mjs');
  const { escreverPNG } = await import('../util/png.mjs');
  const cena = cenaDeFotos(), dirFotos = path.join(tmp, 'fotos'); fs.mkdirSync(dirFotos);
  for (const v of ['frente', 'costas', 'esquerda', 'direita', 'frenteEsquerda', 'frenteDireita']) fs.writeFileSync(path.join(dirFotos, v + '.png'), escreverPNG(cena.FOTOS[v].rgba, cena.FOTOS[v].w, cena.FOTOS[v].h));
  pg = await novaPagina(b);
  const errosLab = []; pg.on('pageerror', e => errosLab.push(e.message));
  await pg.goto('file://' + teste + '/laboratorio-fotos-3d.html');
  let arqLab = null;
  await passo(pg, 'lab: 6 fotos -> sólido imprimível, fiel às fotos, com comparação por vista', async () => {
    for (const v of ['frente', 'costas', 'esquerda', 'direita', 'frenteEsquerda', 'frenteDireita']) await pg.setInputFiles('.vista[data-v=' + v + '] input', path.join(dirFotos, v + '.png'));
    await pg.fill('#altura', String(cena.H));
    await pg.click('#gerar');
    await pg.waitForSelector('#saida:not([hidden])', { timeout: 120000 });
    const t = await pg.textContent('#numeros');
    if (!/Imprimível[^]*sim/.test(t)) throw new Error('não imprimível: ' + t);
    const fid = +(t.match(/pior vista[\d.]+% \/ ([\d.]+)%/) || [])[1];
    if (!(fid > 95)) throw new Error('fidelidade ' + fid + ': ' + t);
    if (await pg.locator('#comparar canvas').count() !== 6) throw new Error('comparação por vista');
    if (errosLab.length) throw new Error(errosLab.join(' | '));
  });
  await passo(pg, 'lab: 3MF inteiro e 3MF separado por cor que o Bambu lê', async () => {
    const [d1] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('#b3mf')]);
    arqLab = path.join(tmp, 'lab.3mf'); await d1.saveAs(arqLab);
    const [d2] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('#bcor')]);
    const arqCor = path.join(tmp, 'lab-cor.3mf'); await d2.saveAs(arqCor);
    const vols = simular(arqCor).objetos.flatMap(o => o.volumes);
    if (vols.length < 3 || vols.some(v => !v.cor_volume)) throw new Error(JSON.stringify(vols));
  });
  await pg.context().close();
  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await passo(pg, 'lab: o 3MF das fotos entra no Estúdio pelo Abrir (mesmo caminho de modelo importado)', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', arqLab);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
  });
  await pg.context().close();
  await b.close();
  console.log(falhas ? '\n' + falhas + ' FALHA(S) — capturas em ' + tmp : '\nE2E: tudo certo');
  process.exit(falhas ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

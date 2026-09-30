// EQUIVALÊNCIA COM O SISTEMA ORIGINAL: roda o pacote de teste da versão
// recebida (commit base) e o atual no mesmo navegador, com as MESMAS ações,
// e compara número por número: calculadora (80 combinações), orçamento com
// desconto, relatórios (DRE, curva ABC, canais, clientes), o texto de TODAS
// as abas e os dados gravados. Depois repete no atual DEPOIS de usar o
// Estúdio 3D — o Estúdio não pode mudar nada nas outras abas.
//   node tests/e2e/equivalencia.mjs            (sozinho)
//   ou pela seção 0 do tests/e2e/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const COMMIT_BASE = 'e7544b9';
const TAGS_NUVEM = ['<script src="config.js"></script>', '<script src="supabase.min.js"></script>', '<script src="cloud.js"></script>'];

// pacote de teste do sistema como foi recebido (mesma montagem do tools/pacotes.mjs)
export function pacoteOriginal(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', raiz, 'archive', '-o', path.join(dir, 'base.tar'), COMMIT_BASE, 'site', 'teste/teste.js']);
  execFileSync('tar', ['-xf', path.join(dir, 'base.tar'), '-C', dir]);
  const site = path.join(dir, 'site');
  let html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  for (const t of TAGS_NUVEM) if (!html.includes(t)) throw new Error('index.html original sem ' + t);
  html = html.replace(TAGS_NUVEM[0], '').replace(TAGS_NUVEM[1], '').replace(TAGS_NUVEM[2], '<script src="teste.js"></script>');
  fs.writeFileSync(path.join(site, 'index.html'), html);
  fs.copyFileSync(path.join(dir, 'teste', 'teste.js'), path.join(site, 'teste.js'));
  return site;
}

// tudo o que é calculado, com entradas fixas
async function coletar(pg) {
  return pg.evaluate(async () => {
    const out = {};
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const txt = el => (el ? el.innerText : '').replace(/\s+/g, ' ').trim();
    // calculadora: 80 combinações determinísticas
    showTab('calc'); await espera(50);
    const selP = $('c_printer'), selF = $('c_filament');
    const nP = selP.options.length, nF = selF.options.length;
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    out.calc = [];
    for (let k = 0; k < 80; k++) {
      selP.selectedIndex = k % Math.max(1, nP); selF.selectedIndex = (k * 3) % Math.max(1, nF);
      const v = { c_qtd: String(1 + (k % 5)), c_gramas: (rnd() * 400).toFixed(1).replace('.', ','), c_horas: String(Math.floor(rnd() * 20)), c_min: String(Math.floor(rnd() * 59)),
        c_extras: (rnd() * 30).toFixed(2).replace('.', ','), c_margem: String(Math.floor(rnd() * 150)), c_plataforma: (rnd() * 25).toFixed(1).replace('.', ',') };
      for (const [id, x] of Object.entries(v)) $(id).value = x;
      const loc = $('c_local'); if (loc && loc.options.length) loc.selectedIndex = k % loc.options.length;
      out.calc.push(JSON.stringify(calcular(readCalc())));
      if (k % 10 === 0) { renderCalc(); out.calc.push(txt($('r_break')) + '|' + txt($('r_preco')) + '|' + txt($('r_lucro')) + '|' + txt($('r_margpct'))); }
    }
    // orçamento: itens e descontos
    out.quote = [];
    for (const [tipo, val] of [['pct', '10'], ['pct', '150'], ['valor', '35,5'], ['valor', '99999']]) {
      quoteItems = [{ qtd: 3, preco: 49.9, nome: 'a' }, { qtd: 1, preco: 120, nome: 'b' }, { qtd: 7, preco: 12.35, nome: 'c' }];
      $('q_desc_tipo').value = tipo; $('q_desc_val').value = val;
      out.quote.push(JSON.stringify(quoteTotals()));
    }
    quoteItems = [];
    // relatórios
    out.rep = {};
    for (const f of ['calcDRE', 'calcABC', 'calcCanais', 'calcClientes']) {
      try { out.rep[f] = JSON.stringify(window[f] ? window[f]() : eval(f + '()')); } catch (e) { out.rep[f] = 'ERRO ' + e.message; }
    }
    // texto de todas as abas
    out.abas = {};
    for (const t of ['dash', 'calc', 'prod', 'sales', 'fil', 'serv', 'clients', 'consig', 'quote', 'rep', 'fin', 'ecom', 'audit', 'users', 'cfg']) {
      try { showTab(t); await espera(120); out.abas[t] = txt(document.getElementById('view-' + t)); } catch (e) { out.abas[t] = 'ERRO ' + e.message; }
    }
    // dados gravados (sem a preferência de tema, que é só visual)
    out.dados = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== '144lab_tema') out.dados[k] = localStorage.getItem(k); }
    return out;
  });
}

async function abrir(b, url) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });
  const pg = await ctx.newPage();
  pg.erros = [];
  pg.on('pageerror', e => pg.erros.push(e.message));
  // relógio fixo: datas e "hoje" iguais nas duas versões
  await pg.addInitScript(() => { const T = new Date('2026-09-20T12:00:00-03:00').getTime(); const D = Date; class F extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } } window.Date = F; Math.random = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); });
  await pg.goto(url);
  await pg.waitForTimeout(1500);
  return pg;
}

// diferenças entre dois resultados (lista legível)
export function comparar(a, b, rot) {
  const dif = [];
  const vis = (x, y, p) => {
    if (typeof x !== typeof y) { dif.push(p + ': tipo ' + typeof x + ' x ' + typeof y); return; }
    if (x && typeof x === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) vis(x[k], y[k], p + '.' + k); return; }
    if (x !== y) dif.push(p + ': ' + String(x).slice(0, 160) + '  ≠  ' + String(y).slice(0, 160));
  };
  vis(a, b, rot);
  return dif;
}

// ações do Estúdio 3D no pacote atual (abre, cria peça, corta, exporta)
async function usarEstudio(pg) {
  await pg.evaluate(() => showTab('ferr'));
  await pg.click('#ferr_modo_seg button[data-v=estudio]');
  await pg.waitForFunction(() => document.querySelector('#ferr_estudio .e3d-motor span')?.textContent.includes('pronto'), null, { timeout: 60000 });
  await pg.evaluate(async () => {
    const e = window.Estudio3D.estudio;
    const d = document.querySelector('[data-sec=formas]'); d.open = true; d.dispatchEvent(new Event('toggle'));
    document.querySelector('[data-forma=esfera]').click();
    await new Promise(r => setTimeout(r, 1500));
    document.querySelector('.e3d-top [data-b=preparar]').click();
    await new Promise(r => setTimeout(r, 2500));
    e.cena.aplicar('teste', () => { e.cena.objetos[0].transform[0] = 1.5; });
    document.documentElement.setAttribute('data-tema', 'escuro');
    await new Promise(r => setTimeout(r, 300));
    document.documentElement.removeAttribute('data-tema');
  });
}

export async function equivalencia({ b, tmp, teste, log = console.log }) {
  const orig = pacoteOriginal(path.join(tmp, 'original'));
  const pgA = await abrir(b, 'file://' + orig + '/index.html');
  const A = await coletar(pgA);
  const A2 = await coletar(pgA);        // determinismo: a mesma versão duas vezes
  await pgA.context().close();
  const pgB = await abrir(b, 'file://' + teste + '/index.html');
  const B = await coletar(pgB);
  await usarEstudio(pgB);
  const C = await coletar(pgB);        // depois de usar o Estúdio
  const erros = pgB.erros.slice();
  await pgB.context().close();
  const det = comparar(A, A2, 'original×original');
  const d1 = comparar(A, B, 'original×atual');
  const d2 = comparar(A, C, 'original×atual-depois-do-estudio');
  const resumo = {
    calculadora: A.calc.length, orcamento: A.quote.length, relatorios: Object.keys(A.rep).length, abas: Object.keys(A.abas).length,
    chavesDados: Object.keys(A.dados).length, naoDeterminismo: det, difAtual: d1, difDepoisEstudio: d2, erros
  };
  if (log) log(JSON.stringify({ ...resumo, naoDeterminismo: det.length, difAtual: d1.length, difDepoisEstudio: d2.length }));
  return resumo;
}

// sozinho: node tests/e2e/equivalencia.mjs [pasta-do-pacote-de-teste]
if (process.argv[1] && process.argv[1].endsWith('equivalencia.mjs')) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'equiv-'));
  const teste = process.argv[2] || path.join(raiz, 'dist', '144lab-teste');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const r = await equivalencia({ b, tmp, teste });
  await b.close();
  for (const d of [...r.naoDeterminismo, ...r.difAtual, ...r.difDepoisEstudio].slice(0, 40)) console.log('  ' + d);
  if (r.erros.length) console.log('erros de página:', r.erros);
  process.exit(r.difAtual.length || r.difDepoisEstudio.length || r.erros.length ? 1 : 0);
}

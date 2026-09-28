// BENCHMARK DE FIDELIDADE do gerador de chaveiros: roda o gerador do site (o
// mesmo código do app.js, pelo carregador do MCP) em cada logo de teste
// (tests/fixtures/logos) e compara com o gabarito:
//   silhueta e cada cor (IoU), erro médio de borda em mm, cores achadas × reais,
//   quanto a argola come da arte, traços finos preservados, malha (fechada, sem
//   cruzar, sem pedaço solto) e tempos de cada etapa.
//   node tools/bench-chaveiro.mjs [--fluxo padrao|cor] [--json saida.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from '../mcp/canvas.mjs';
import { codigoDoGerador, FUNCOES } from '../mcp/fonte-site.mjs';
import { lerImagem } from '../mcp/imagem.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { pecasDoGerador } from '../src/estudio3d/core/pecasGerador.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { carregarManifold } from '../tests/util/manifold.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pastaLogos = path.join(raiz, 'tests', 'fixtures', 'logos');

// ---------- o gerador do site, sem tela
let A = null, FER = null, el = {};
function gerador() {
  if (A) return A;
  const stubs = 'function ferMarcarSeg(){} function ferRecalcular(){} function ferTrocarModo(){} function ferAviso(){} function ferPintarTudo(){} function ferAvisoLeve(t){ FER.avisoLeve = t; }';
  const document = { createElement: () => new Canvas(), getElementById: id => el[id] || null };
  FER = { modo: 'imagem', fontes: {}, cores: {}, origem: null, marca: 0, vista: { rx: 0.95, rz: -0.42, zoom: 1 } };
  const corpo = 'var self = {}, module = undefined, exports = undefined, require = undefined;\n' + stubs + '\n' + codigoDoGerador() +
    '\nreturn { GEO: GEO, MODELOS: MODELOS, ' + FUNCOES.map(f => f + ': ' + f).join(', ') + ' };';
  A = new Function('document', 'FER', 'window', 'toast', corpo)(document, FER, {}, () => {});
  return A;
}

// ---------- gabarito
function pngMascara(arq) {
  const img = lerImagem(new Uint8Array(fs.readFileSync(arq)), arq);
  const d = new Uint8Array(img.largura * img.altura);
  for (let i = 0; i < d.length; i++) d[i] = img.px[i * 4 + 3] >= 128 ? 1 : 0;
  return { w: img.largura, h: img.altura, d };
}
function hexRGB(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function lab([r, g, b]) {
  const f = c => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  X = t(X); Y = t(Y); Z = t(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// ---------- polígonos da peça -> máscara no grid do gabarito (preenchimento par-ímpar)
function rasterizarGrupos(grupos, w, h, mapa) {
  const m = new Uint8Array(w * h);
  const aneis = [];
  for (const g of grupos) { aneis.push(g.externo); for (const f of g.furos || []) aneis.push(f); }
  const arestas = [];
  for (const a of aneis) for (let i = 0; i < a.length; i++) {
    const p = mapa(a[i]), q = mapa(a[(i + 1) % a.length]);
    if (p[1] !== q[1]) arestas.push(p[1] < q[1] ? [p, q] : [q, p]);
  }
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs = [];
    for (const [p, q] of arestas) if (yc >= p[1] && yc < q[1]) xs.push(p[0] + (yc - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) m[y * w + x] ^= 1;
    }
  }
  return m;
}
const conta = m => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };
function iou(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k] & b[k]; u += a[k] | b[k]; } return u ? i / u : 1; }
function perimetro(m, w, h) { let n = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = m[y * w + x]; if (x + 1 < w && v !== m[y * w + x + 1]) n++; if (y + 1 < h && v !== m[(y + 1) * w + x]) n++; } return n; }
// espessura: distância até o fora (chessboard, 2 passadas) — raio inscrito aproximado em px
function raioInscrito(m, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? 1e9 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], (x ? d[i - 1] : 0) + 1, (y ? d[i - w] : 0) + 1, (x && y ? d[i - w - 1] : 0) + 1.414, (y && x + 1 < w ? d[i - w + 1] : 0) + 1.414); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], (x + 1 < w ? d[i + 1] : 0) + 1, (y + 1 < h ? d[i + w] : 0) + 1, (x + 1 < w && y + 1 < h ? d[i + w + 1] : 0) + 1.414, (y + 1 < h && x ? d[i + w - 1] : 0) + 1.414); }
  return d;
}

// ---------- o que o usuário recebe: fluxo 'padrao' (tela sem mexer) ou 'cor' (Cores com o número certo)
export async function rodarGeradorAtual(logo, fluxo = 'padrao', { tamanhoMM = 50, bico = 0.4 } = {}) {
  const G = gerador().GEO, tempos = {};
  const arq = path.join(pastaLogos, logo.arquivo);
  if (/\.svg$/.test(arq)) return { pulado: 'SVG: o site rasteriza no tamanho declarado (sem vetor); no Node não há decodificador de SVG' };
  const img = lerImagem(new Uint8Array(fs.readFileSync(arq)), arq);
  Object.assign(FER, { fontes: {}, cores: {}, origem: null, analise: null, recorteAuto: null, limiarAuto: null, avisoLeve: '', modo: 'imagem', memoImagem: null });
  el = { fer_inverter: { checked: false }, fer_limiar: { value: 60 }, fer_dropinfo: {} };
  let t = performance.now();
  A.ferUsarImagem({ naturalWidth: img.largura, naturalHeight: img.altura, width: img.largura, height: img.altura, _px: img.px });
  tempos.analise = performance.now() - t;
  const o = FER.origem, modoRec = FER.recorteAuto || 'tom', lim = FER.limiarAuto, inverter = !!el.fer_inverter.checked;
  t = performance.now();
  let m = modoRec === 'fundo' && FER.analise.corFundo ? G.mascaraPorFundo(o.px, o.w, o.h, FER.analise.corFundo, lim, true)
    : G.mascaraDePixels(o.px, o.w, o.h, { usarAlfa: modoRec === 'alfa', limiar: lim, inverter });
  m = G.suavizar(m, 1); m = G.limparSujeira(m, 0.01);
  const detalhe = fluxo === 'cor' ? 'cor' : 'chapado';
  const coresArte = detalhe === 'cor' ? A.ferQuantizar(o.px, o.w, o.h, m, Math.min(4, Math.max(2, logo.cores)), A.ferMinPx(m, tamanhoMM, bico)) : null;
  tempos.imagem = performance.now() - t;
  t = performance.now();
  const peca = gerador().MODELOS.construir(m, { modelo: 'chaveiro', larguraMM: tamanhoMM, altBase: 2.4, altArte: 1.2, bordaMM: 2.5, argolaLigada: true, argolaFuroMM: 4,
    argolaPosicao: 'topo', argolaCentro: true, argolaParedeMM: 2.2, cantoMM: 3, bicoMM: bico, coresArte, corArte: [17, 24, 39] });
  tempos.construir = performance.now() - t;
  if (peca.erro) return { erro: peca.erro, tempos };
  // caixa da máscara: leva as coordenadas da peça de volta pra imagem
  let bx0 = o.w, by0 = o.h;
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) if (m.d[y * o.w + x]) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; }
  FER.peca = peca; FER.malhas = gerador().MODELOS.malhas(peca); FER.marca++;
  t = performance.now();
  const pecas = A.ferPecasParaEstudio();
  const partes = await pecasDoGerador(pecas, async (op, a) => executar(op, a), () => {});
  tempos.solidos = performance.now() - t;
  return { peca, partes, tempos, modoRec, fatorImg: o.w / img.largura,
    paraImagem: ([x, y]) => [x - peca.arteCaixa.x0 + bx0, y - peca.arteCaixa.y0 + by0],
    camadas: peca.camadas.map(c => ({ cor: c.cor, grupos: c.grupos })), furo: peca.furo, escala: peca.escala };
}

// ---------- medidas contra o gabarito (serve pra qualquer gerador que devolva camadas em px da imagem)
export function medir(logo, r, { bico = 0.4 } = {}) {
  const verd = logo.verdade.map(v => ({ cor: hexRGB(v.cor), m: pngMascara(path.join(pastaLogos, v.arquivo)) }));
  const W = verd[0].m.w, H = verd[0].m.h;
  // cor visível de cada pixel (a de cima tapa a de baixo)
  const visivel = verd.map(() => new Uint8Array(W * H)), sil = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) for (let k = verd.length - 1; k >= 0; k--) if (verd[k].m.d[i]) { visivel[k][i] = 1; sil[i] = 1; break; }
  // cores iguais (o branco do selo e o do escudo) contam como uma só
  const truthCores = [];
  verd.forEach((v, k) => { const j = truthCores.findIndex(c => deltaE(c.cor, v.cor) < 3); if (j >= 0) { const a = truthCores[j].m; for (let i = 0; i < a.length; i++) a[i] |= visivel[k][i]; } else truthCores.push({ cor: v.cor, m: new Uint8Array(visivel[k]) }); });
  // de px da imagem usada pro grid do gabarito
  const k = (logo.escalaVerdade || 1) * r.fatorImg, s = 2 / k;
  const mapa = p => { const q = r.paraImagem(p); return [q[0] * s, q[1] * s]; };
  const saida = r.camadas.map(c => ({ cor: c.cor, m: rasterizarGrupos(c.grupos, W, H, mapa) }));
  const silSaida = new Uint8Array(W * H);
  saida.forEach(c => { for (let i = 0; i < W * H; i++) silSaida[i] |= c.m[i]; });
  const mmPorPx = r.escala / s;
  const xor = conta(silSaida.map((v, i) => v ^ sil[i]));
  const res = {
    silhuetaIoU: iou(sil, silSaida),
    erroBordaMM: xor / Math.max(1, perimetro(sil, W, H)) * mmPorPx,
    coresReais: truthCores.length,
    coresAchadas: saida.length
  };
  // cada cor real: a camada de saída de cor mais parecida
  res.porCor = truthCores.map(t => {
    let melhor = null;
    for (const c of saida) { const d = deltaE(t.cor, c.cor); if (!melhor || d < melhor.d) melhor = { d, c }; }
    return { cor: t.cor, deltaE: melhor ? melhor.d : null, iou: melhor ? iou(t.m, melhor.c.m) : 0 };
  });
  // argola: quanto da arte ficou dentro da alça
  if (r.furo) {
    const [fx, fy] = mapa([r.furo.x, r.furo.y]), rr = r.furo.rAlca * s;
    let dentro = 0;
    for (let y = Math.max(0, Math.floor(fy - rr)); y < Math.min(H, Math.ceil(fy + rr)); y++) for (let x = Math.max(0, Math.floor(fx - rr)); x < Math.min(W, Math.ceil(fx + rr)); x++) if (sil[y * W + x] && (x - fx) ** 2 + (y - fy) ** 2 <= rr * rr) dentro++;
    res.argolaComeArtePct = 100 * dentro / Math.max(1, conta(sil));
  }
  // traços finos (mais finos que o bico): quanto sobrou deles na saída
  const rin = raioInscrito(sil, W, H), limite = (bico / 2) / mmPorPx;
  let finos = 0, finosOk = 0;
  for (let i = 0; i < W * H; i++) if (sil[i] && rin[i] <= limite) { finos++; if (silSaida[i]) finosOk++; }
  res.fracaoFinaPct = 100 * finos / Math.max(1, conta(sil));
  res.finosPreservadosPct = finos ? 100 * finosOk / finos : 100;
  // malha
  if (r.partes) {
    res.malha = r.partes.map(p => { const v = validar(p.malha, { completo: true }); return { nome: p.nome, tris: p.malha.idx.length / 3, fechada: v.fechada, cruzamentos: v.autoInterseccoes, degeneradas: v.facesDegeneradas, componentes: v.componentes }; });
  }
  res.tempos = r.tempos;
  return res;
}

async function principal() {
  const args = process.argv.slice(2), fluxo = args.includes('--fluxo') ? args[args.indexOf('--fluxo') + 1] : 'padrao';
  const saidaJson = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  await carregarManifold(); gerador();
  const logos = JSON.parse(fs.readFileSync(path.join(pastaLogos, 'logos.json'), 'utf8'));
  const tabela = [];
  for (const l of logos) {
    const r = await rodarGeradorAtual(l, fluxo);
    if (r.pulado || r.erro) { tabela.push({ logo: l.nome, obs: r.pulado || r.erro }); continue; }
    tabela.push({ logo: l.nome, recorte: r.modoRec, ...medir(l, r) });
  }
  const f = (v, c = 2) => v == null ? '—' : typeof v === 'number' ? v.toFixed(c) : v;
  console.log('fluxo:', fluxo);
  console.log('logo'.padEnd(26), 'recorte', 'silh.IoU', 'borda mm', 'cores(real/achou)', 'pior cor IoU', 'ΔE máx', 'argola come %', 'finos ok %', 'malha', 'tempo ms (análise+img+construir+sólidos)');
  for (const t of tabela) {
    if (t.obs) { console.log(t.logo.padEnd(26), '—', t.obs); continue; }
    const pior = Math.min(...t.porCor.map(c => c.iou)), dE = Math.max(...t.porCor.map(c => c.deltaE ?? 999));
    const malhaOk = t.malha.every(m => m.fechada && !m.cruzamentos && !m.degeneradas);
    const tp = t.tempos;
    console.log(t.logo.padEnd(26), (t.recorte || '').padEnd(7), f(t.silhuetaIoU, 3).padStart(8), f(t.erroBordaMM, 3).padStart(8), (t.coresReais + '/' + t.coresAchadas).padStart(17), f(pior, 3).padStart(12), f(dE, 1).padStart(6), f(t.argolaComeArtePct, 1).padStart(13), f(t.finosPreservadosPct, 0).padStart(10) + ` (${f(t.fracaoFinaPct, 1)}% fino)`, (malhaOk ? 'ok' : 'FALHA').padStart(5), [tp.analise, tp.imagem, tp.construir, tp.solidos].map(x => x.toFixed(0)).join('+'), '| tris', t.malha.reduce((a, m) => a + m.tris, 0));
  }
  if (saidaJson) fs.writeFileSync(saidaJson, JSON.stringify(tabela, null, 1));
  return tabela;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await principal();

// Folha visual: original | resultado (vista de cima, cores da peça, base em cinza)
export async function folha(logos, fluxo, arqSaida) {
  const { escreverPNG } = await import('../mcp/imagem.mjs');
  const paineis = [];
  for (const l of logos) {
    const r = await rodarGeradorAtual(l, fluxo);
    if (r.pulado || r.erro) continue;
    const img = lerImagem(new Uint8Array(fs.readFileSync(path.join(pastaLogos, l.arquivo))), l.arquivo);
    const k = (l.escalaVerdade || 1) * r.fatorImg, W = l.w, H = l.h, s = 1 / k * (W / (img.largura / (l.escalaVerdade || 1)) || 1);
    const mapa = p => { const q = r.paraImagem(p); return [q[0] / r.fatorImg * (W / img.largura), q[1] / r.fatorImg * (H / img.altura)]; };
    const mBase = rasterizarGrupos(r.peca.base, W, H, mapa);
    const px = new Uint8Array(W * 2 * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * 2 * W + x) * 4, sx = Math.min(img.largura - 1, Math.floor(x * img.largura / W)), sy = Math.min(img.altura - 1, Math.floor(y * img.altura / H)), j = (sy * img.largura + sx) * 4, a = img.px[j + 3] / 255;
      for (let c = 0; c < 3; c++) px[i + c] = img.px[j + c] * a + 255 * (1 - a);
      px[i + 3] = 255;
      const o = (y * 2 * W + W + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = mBase[y * W + x] ? 170 : 255; px[o + 3] = 255;
    }
    for (const c of r.camadas) {
      const m = rasterizarGrupos(c.grupos, W, H, mapa);
      for (let i = 0; i < W * H; i++) if (m[i]) { const o = ((Math.floor(i / W)) * 2 * W + W + (i % W)) * 4; px[o] = c.cor[0]; px[o + 1] = c.cor[1]; px[o + 2] = c.cor[2]; }
    }
    paineis.push({ nome: l.nome, w: 2 * W, h: H, px });
  }
  // empilha
  const LW = Math.max(...paineis.map(p => p.w)), LH = paineis.reduce((a, p) => a + p.h + 8, 0);
  const out = new Uint8Array(LW * LH * 4).fill(235);
  let y0 = 0;
  for (const p of paineis) { for (let y = 0; y < p.h; y++) out.set(p.px.subarray(y * p.w * 4, (y + 1) * p.w * 4), ((y0 + y) * LW) * 4); y0 += p.h + 8; }
  fs.writeFileSync(arqSaida, escreverPNG(out, LW, LH));
}

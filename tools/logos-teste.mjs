// Gera o CONJUNTO DE LOGOS DE TESTE do gerador de chaveiros (tests/fixtures/logos),
// com gabarito: cada logo é um SVG só de caminhos (texto convertido em curva, pra
// não depender das fontes da máquina), rasterizado pelo Chromium como uma logo de
// verdade (PNG com antisserrilhado, JPG com artefato, fundo branco/preto), e a
// MÁSCARA VERDADEIRA de cada cor (2× a resolução) pra medir fidelidade.
//   node tools/logos-teste.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destino = path.join(raiz, 'tests', 'fixtures', 'logos');
const fonte = arq => opentype.parse(fs.readFileSync(arq).buffer.slice(0));
const F = {
  negrito: fonte('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
  serifItalico: fonte('/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf'),
  sans: fonte('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
};
// texto -> caminho SVG centralizado em (cx, base). Letra por letra: o motor de
// substituições do opentype.js quebra em algumas fontes (DejaVu).
function texto(f, s, tam, cx, base) {
  const k = tam / f.unitsPerEm, gl = [...s].map(ch => f.charToGlyph(ch));
  const larg = gl.reduce((a, g) => a + g.advanceWidth * k, 0);
  let x = cx - larg / 2, d = '';
  for (const g of gl) { d += g.getPath(x, base, tam).toPathData(2); x += g.advanceWidth * k; }
  return d;
}
const circulo = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const ret = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
function raios(cx, cy, r0, r1, n) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i / n * 2 * Math.PI, b = a + Math.PI / n * 0.55, c = a - Math.PI / n * 0.55;
    d += `M${(cx + r0 * Math.cos(c)).toFixed(1)} ${(cy + r0 * Math.sin(c)).toFixed(1)}L${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)}L${(cx + r0 * Math.cos(b)).toFixed(1)} ${(cy + r0 * Math.sin(b)).toFixed(1)}Z`;
  }
  return d;
}
const coracao = (cx, cy, s) => `M${cx} ${cy + 0.9 * s}C${cx - 1.4 * s} ${cy},${cx - 0.9 * s} ${cy - 0.9 * s},${cx} ${cy - 0.35 * s}C${cx + 0.9 * s} ${cy - 0.9 * s},${cx + 1.4 * s} ${cy},${cx} ${cy + 0.9 * s}Z`;

// cada logo: caixa, fundo (null = transparente), camadas [{cor, d}] de baixo pra cima
// e o que o chaveiro deveria ter (cores de verdade)
export function logos() {
  const L = [];
  L.push({ nome: 'texto-1cor', w: 520, h: 180, fundo: null, camadas: [{ cor: '#111111', d: texto(F.negrito, 'LUNA', 150, 260, 145) }], cores: 1 });
  L.push({ nome: 'texto-fino', w: 560, h: 220, fundo: null, camadas: [{ cor: '#1f2937', d: texto(F.serifItalico, 'Maria Clara', 100, 280, 110) + texto(F.sans, 'ATELIÊ DE DOCES', 26, 280, 170) }], cores: 1 });
  L.push({ nome: 'selo-2cores', w: 460, h: 300, fundo: null, camadas: [
    { cor: '#e8590c', d: ret(10, 10, 440, 280, 60) },
    { cor: '#ffffff', d: texto(F.negrito, '144', 170, 230, 212) }], cores: 2 });
  const escudo = 'M200 12L380 60V170C380 270 300 340 200 388C100 340 20 270 20 170V60Z';
  L.push({ nome: 'escudo-3cores', w: 400, h: 400, fundo: null, camadas: [
    { cor: '#15803d', d: escudo },
    { cor: '#ffffff', d: 'M20 150H380V230H20Z' },
    { cor: '#111111', d: texto(F.negrito, 'FC', 72, 200, 216) }], cores: 3, recorteNaSilhueta: escudo });
  L.push({ nome: 'sol-4cores', w: 420, h: 420, fundo: null, camadas: [
    { cor: '#1d4ed8', d: circulo(210, 210, 200) },
    { cor: '#facc15', d: circulo(210, 170, 70) + raios(210, 170, 78, 118, 12) },
    { cor: '#dc2626', d: coracao(210, 312, 46) },
    { cor: '#111111', d: texto(F.negrito, 'SOL', 44, 210, 250) }], cores: 4 });
  L.push({ nome: 'ilhas', w: 520, h: 220, fundo: null, camadas: [{ cor: '#111111', d:
    texto(F.negrito, 'i j ! :', 120, 200, 130) + [6, 4.5, 3, 2, 1.4, 1].map((r, k) => circulo(400 + k * 20, 60, r)).join('') +
    [0, 1, 2, 3, 4].map(k => circulo(400 + k * 24, 150, 9)).join('') }], cores: 1 });
  return L;
}
// variações de arquivo (mesma arte): JPG com fundo branco, fundo preto, SVG, imagem pequena
export const variacoes = [
  { de: 'escudo-3cores', nome: 'escudo-3cores-jpg', formato: 'jpg', fundo: '#ffffff', qualidade: 0.7 },
  { de: 'texto-1cor', nome: 'texto-branco-fundo-preto', formato: 'png', fundo: '#000000', trocarCor: '#ffffff' },
  { de: 'sol-4cores', nome: 'sol-4cores-svg', formato: 'svg' },
  { de: 'texto-1cor', nome: 'texto-1cor-pequena', formato: 'png', escala: 0.32 }
];
export function svgDe(l, { fundo = l.fundo, trocarCor = null, so = null } = {}) {
  const corpo = l.camadas.map((c, i) => (so == null || so === i) ? `<path fill="${trocarCor || c.cor}" fill-rule="nonzero" d="${c.d}"/>` : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.w}" height="${l.h}" viewBox="0 0 ${l.w} ${l.h}">${fundo ? `<rect width="100%" height="100%" fill="${fundo}"/>` : ''}${corpo}</svg>`;
}

async function gerar() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs');
  fs.mkdirSync(destino, { recursive: true });
  const b = await chromium.launch();
  const pg = await b.newPage();
  // rasteriza um SVG no tamanho pedido (px) e devolve PNG ou JPG em bytes
  const rasterizar = (svg, w, h, formato = 'png', qualidade = 0.9, fundo = null) => pg.evaluate(async ([svg, w, h, formato, qualidade, fundo]) => {
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (fundo) { g.fillStyle = fundo; g.fillRect(0, 0, w, h); }
    g.drawImage(img, 0, 0, w, h);
    return cv.toDataURL(formato === 'jpg' ? 'image/jpeg' : 'image/png', qualidade).split(',')[1];
  }, [svg, w, h, formato, qualidade, fundo]).then(b64 => Buffer.from(b64, 'base64'));
  const manifesto = [];
  const base = Object.fromEntries(logos().map(l => [l.nome, l]));
  const ESC = 800 / 520;   // todas as logos saem com ~800 px na maior medida
  for (const l of logos()) {
    const w = Math.round(l.w * ESC), h = Math.round(l.h * ESC);
    fs.writeFileSync(path.join(destino, l.nome + '.png'), await rasterizar(svgDe(l), w, h));
    // gabarito: cada cor sozinha, 2× a resolução (a de cima tapa a de baixo, como na arte)
    const verdade = [];
    for (let i = 0; i < l.camadas.length; i++) {
      const arq = l.nome + '.verdade.' + i + '.png';
      fs.writeFileSync(path.join(destino, arq), await rasterizar(svgDe(l, { so: i, trocarCor: '#000000' }), 2 * w, 2 * h));
      verdade.push({ cor: l.camadas[i].cor, arquivo: arq });
    }
    manifesto.push({ nome: l.nome, arquivo: l.nome + '.png', w, h, cores: l.cores, verdade });
  }
  for (const v of variacoes) {
    const l = base[v.de], k = v.escala || 1, w = Math.round(l.w * ESC * k), h = Math.round(l.h * ESC * k);
    let arq, dados;
    if (v.formato === 'svg') { arq = v.nome + '.svg'; dados = svgDe(l); }
    else { arq = v.nome + '.' + v.formato; dados = await rasterizar(svgDe(l, { trocarCor: v.trocarCor || null }), w, h, v.formato, v.qualidade || 0.9, v.fundo || null); }
    fs.writeFileSync(path.join(destino, arq), dados);
    const m = manifesto.find(x => x.nome === v.de);
    manifesto.push({ nome: v.nome, arquivo: arq, w, h, cores: l.cores, verdade: m.verdade, escalaVerdade: k, fundo: v.fundo || null });
  }
  fs.writeFileSync(path.join(destino, 'logos.json'), JSON.stringify(manifesto, null, 1));
  await b.close();
  return manifesto;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const m = await gerar();
  console.log(m.length + ' logos em ' + path.relative(raiz, destino) + ':', m.map(x => x.arquivo).join(', '));
}

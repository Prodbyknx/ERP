// Gera site/html2pdf.bundle.min.js (a biblioteca que monta os PDFs: orçamento,
// venda, termo, relatórios) a partir das versões do package.json, sem as
// falhas conhecidas das versões antigas embutidas (html2pdf 0.10.1 levava
// jsPDF 2.3.1 e DOMPurify 2.3.0). Expõe window.html2pdf como antes.
//   node tools/pdf.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = p => path.join(raiz, p);
const versao = n => JSON.parse(fs.readFileSync(r('node_modules/' + n + '/package.json'), 'utf8')).version;

export async function construirPDF(saida = r('site/html2pdf.bundle.min.js')) {
  const libs = ['html2pdf.js', 'jspdf', 'html2canvas', 'dompurify'].map(n => n + ' ' + versao(n));
  const res = await esbuild.build({
    stdin: { contents: "import h from 'html2pdf.js/src/index.js'; self.html2pdf = h;", resolveDir: raiz, loader: 'js' },
    bundle: true, format: 'iife', platform: 'browser', target: ['es2019'], minify: true, write: false,
    // o jsPDF só carrega estes sob demanda em funções que o sistema não usa (SVG e canvas)
    external: ['canvg', 'core-js'],
    legalComments: 'eof', logLevel: 'warning',
    banner: { js: '/* 144 Laboratorio 3D - biblioteca de PDF. Gerado por tools/pdf.mjs (nao editar aqui).\n   Inclui ' + libs.join(', ') + ' (licencas no fim do arquivo). */' }
  });
  fs.writeFileSync(saida, res.outputFiles[0].text);
  return { saida, bytes: fs.statSync(saida).size, libs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const x = await construirPDF();
  console.log('gerado', path.relative(raiz, x.saida), (x.bytes / 1024).toFixed(0) + ' KB', '(' + x.libs.join(', ') + ')');
}

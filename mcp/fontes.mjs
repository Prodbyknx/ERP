// Fonte do sistema pelo nome da família (Windows, macOS, Linux), igual ao
// que o navegador usaria na tela do gerador. Se não achar, usa uma fonte
// negrito comum e AVISA (o MCP devolve qual arquivo foi usado).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import opentype from 'opentype.js';

const parse = opentype.parse || (opentype.default && opentype.default.parse);

// família -> arquivos (negrito primeiro: o gerador pede peso 700)
const ARQUIVOS = {
  'impact': ['impact.ttf', 'Impact.ttf'],
  'arial black': ['ariblk.ttf', 'Arial Black.ttf'],
  'arial': ['arialbd.ttf', 'Arial Bold.ttf', 'arial.ttf', 'Arial.ttf', 'LiberationSans-Bold.ttf'],
  'georgia': ['georgiab.ttf', 'Georgia Bold.ttf', 'georgia.ttf', 'Georgia.ttf'],
  'times new roman': ['timesbd.ttf', 'Times New Roman Bold.ttf', 'times.ttf', 'LiberationSerif-Bold.ttf'],
  'verdana': ['verdanab.ttf', 'Verdana Bold.ttf', 'verdana.ttf', 'DejaVuSans-Bold.ttf'],
  'trebuchet ms': ['trebucbd.ttf', 'Trebuchet MS Bold.ttf', 'trebuc.ttf'],
  'comic sans ms': ['comicbd.ttf', 'Comic Sans MS Bold.ttf', 'comic.ttf'],
  'courier new': ['courbd.ttf', 'Courier New Bold.ttf', 'cour.ttf', 'LiberationMono-Bold.ttf']
};
const RESERVA = ['arialbd.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'FreeSansBold.ttf', 'Roboto-Bold.ttf', 'NotoSans-Bold.ttf'];

function pastas() {
  const h = os.homedir(), l = [];
  if (process.env.WINDIR) l.push(path.join(process.env.WINDIR, 'Fonts'));
  if (process.env.LOCALAPPDATA) l.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  l.push('C:\\Windows\\Fonts', '/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(h, 'Library', 'Fonts'),
    '/usr/share/fonts', '/usr/local/share/fonts', path.join(h, '.fonts'), path.join(h, '.local', 'share', 'fonts'));
  return [...new Set(l)].filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

// índice nome-do-arquivo (minúsculo) -> caminho, com subpastas (Linux)
let indice = null;
function indexar() {
  if (indice) return indice;
  indice = new Map();
  const visitar = (p, prof) => {
    let itens; try { itens = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const q = path.join(p, it.name);
      if (it.isDirectory() && prof < 4) visitar(q, prof + 1);
      else if (/\.(ttf|otf)$/i.test(it.name) && !indice.has(it.name.toLowerCase())) indice.set(it.name.toLowerCase(), q);
    }
  };
  for (const p of pastas()) visitar(p, 0);
  return indice;
}

const cache = new Map();
function abrir(arq) {
  if (!cache.has(arq)) {
    const b = fs.readFileSync(arq);
    const f = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    f._arquivo = arq;
    cache.set(arq, f);
  }
  return cache.get(arq);
}

let arquivoForcado = null;
// arquivo .ttf/.otf escolhido pela pessoa (vale pra próxima chamada)
export function usarArquivoDeFonte(arq) { arquivoForcado = arq || null; }

export function fonteDaFamilia(familia) {
  if (arquivoForcado) return abrir(arquivoForcado);
  const idx = indexar(), fam = String(familia || '').toLowerCase().replace(/["']/g, '').trim();
  for (const n of [...(ARQUIVOS[fam] || []), fam + '.ttf', fam + ' bold.ttf', ...RESERVA]) {
    const q = idx.get(n.toLowerCase());
    if (q) { const f = abrir(q); f._pedida = familia; f._achou = (ARQUIVOS[fam] || []).map(x => x.toLowerCase()).includes(n.toLowerCase()) || n === fam + '.ttf' || n === fam + ' bold.ttf'; return f; }
  }
  // qualquer uma que exista
  const q = idx.values().next().value;
  if (q) { const f = abrir(q); f._pedida = familia; f._achou = false; return f; }
  throw new Error('Não achei nenhuma fonte instalada neste computador. Passe "arquivo_fonte" com o caminho de um .ttf.');
}

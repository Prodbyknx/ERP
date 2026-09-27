// Recorta do site/app.js o código do GERADOR (os mesmos módulos e funções
// que a tela usa) — o MCP não tem cópia própria da lógica do chaveiro.
// No pacote final (tools/mcp.mjs) este texto já vem embutido.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// módulos UMD do app.js, na ordem (o de baixo usa o de cima)
const MODULOS = ['EARCUT', 'MALHA', 'GEO', 'MODELOS'];
// funções de topo do gerador (sem mexer na tela: a tela vira stub)
export const FUNCOES = ['ferMinPx', 'ferQuantizar', 'ferCorCSS', 'ferMascaraPlana', 'ferMediana', 'ferBorrarTom', 'ferNiveisDeTom',
  'ferHexParaRGB', 'ferRGBParaHex', 'ferCorDe', 'ferClonar', 'ferMalhasIndexadas', 'ferRotuloPeca', 'ferPecasParaEstudio',
  'ferDesenharTexto', 'ferDesenharForma', 'ferUsarImagem', 'ferPintar3D'];

export function extrairDoSite(app) {
  const linhas = app.split('\n'), partes = [];
  // blocos "(function (raiz) { ... })(typeof self ...)" que terminam em raiz.NOME = ...
  let ini = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].startsWith('(function (raiz) {')) ini = i;
    else if (ini >= 0 && linhas[i].startsWith('})(typeof self')) {
      const bloco = linhas.slice(ini, i + 1).join('\n');
      const nome = (/raiz\.(\w+)\s*=\s*\w+;?\s*$/m.exec(bloco) || [])[1];
      if (nome && MODULOS.includes(nome)) partes.push({ nome, bloco });
      ini = -1;
    }
  }
  const ordem = MODULOS.map(n => { const p = partes.find(x => x.nome === n); if (!p) throw new Error('módulo ' + n + ' não achado no app.js'); return p.bloco; });
  const funcoes = FUNCOES.map(n => {
    const i = linhas.findIndex(l => l.startsWith('function ' + n + '('));
    if (i < 0) throw new Error('função ' + n + ' não achada no app.js');
    let j = i + 1; while (j < linhas.length && linhas[j] !== '}') j++;
    return linhas.slice(i, j + 1).join('\n');
  });
  const lista = nome => {
    const i = linhas.findIndex(l => l.startsWith('var ' + nome + ' = ['));
    if (i < 0) throw new Error(nome + ' não achado no app.js');
    let j = i; while (!linhas[j].startsWith('];')) j++;
    return linhas.slice(i, j + 1).join('\n');
  };
  return [...ordem, 'var EARCUT = self.EARCUT, MALHA = self.MALHA, GEO = self.GEO, MODELOS = self.MODELOS;', lista('FER_FORMAS'), lista('FER_FONTES'), ...funcoes].join('\n\n');
}

// no repositório: lê o app.js ao lado (o pacote troca este módulo pelo texto pronto)
/* global __CODIGO_GERADOR__ */
export function codigoDoGerador() {
  if (typeof __CODIGO_GERADOR__ !== 'undefined') return __CODIGO_GERADOR__;
  const app = fs.readFileSync(fileURLToPath(new URL('../site/app.js', import.meta.url)), 'utf8');
  return extrairDoSite(app);
}

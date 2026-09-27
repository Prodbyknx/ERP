// GERADOR de chaveiro / medalha / placa / contorno no MCP: roda o código do
// site (recortado do app.js por fonte-site.mjs) com a tela trocada por
// stubs e o "canvas" do canvas.mjs. Mesmos padrões da tela do gerador.
import { Canvas } from './canvas.mjs';
import { codigoDoGerador, FUNCOES } from './fonte-site.mjs';
import { usarArquivoDeFonte } from './fontes.mjs';
import { lerImagem, escreverPNG } from './imagem.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { pecasDoGerador } from '../src/estudio3d/core/pecasGerador.js';
import { identidade } from '../src/estudio3d/core/mat4.js';

let api = null, FER = null, elementos = {};
function carregar() {
  if (api) return api;
  const stubs = 'function ferMarcarSeg(){} function ferRecalcular(){} function ferTrocarModo(){} function ferAviso(){} function ferPintarTudo(){} function ferAvisoLeve(t){ FER.avisoLeve = t; }';
  const document = {
    createElement: t => { if (t !== 'canvas') throw new Error('elemento ' + t + ' não existe no MCP'); return new Canvas(); },
    getElementById: id => elementos[id] || null
  };
  FER = { modo: 'imagem', fontes: {}, cores: {}, origem: null, marca: 0, vista: { rx: 0.95, rz: -0.42, zoom: 1 } };
  const corpo = 'var self = {}, module = undefined, exports = undefined, require = undefined;\n' + stubs + '\n' + codigoDoGerador() +
    '\nreturn { GEO: GEO, MODELOS: MODELOS, MALHA: MALHA, FER_FORMAS: FER_FORMAS, FER_FONTES: FER_FONTES, ' + FUNCOES.map(f => f + ': ' + f).join(', ') + ' };';
  // eslint-disable-next-line no-new-func
  api = new Function('document', 'FER', 'window', 'toast', corpo)(document, FER, {}, () => {});
  return api;
}

export function formasDisponiveis() { return carregar().FER_FORMAS.map(f => f[0]); }
export function fontesDaTela() { return carregar().FER_FONTES.map(f => f[1]); }

const hexParaRGB = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

// o: parâmetros já validados pelo servidor. Devolve as partes (sólidos
// prontos), a peça (medidas, avisos, nfc) e a prévia 3D (PNG) da tela.
export async function gerarPeca(o) {
  const A = carregar();
  Object.assign(FER, { fontes: {}, cores: {}, origem: null, analise: null, recorteAuto: null, limiarAuto: null, avisoLeve: '', mioloTirado: 0, reparadas: null, indexCache: null });
  elementos = { fer_texto: { value: o.texto || '' }, fer_fonte: { value: o.fonte || 'Impact' }, fer_inverter: { checked: false }, fer_limiar: { value: 60 }, fer_dropinfo: {} };
  usarArquivoDeFonte(o.arquivoFonte || null);
  let fonteUsada = null;
  // 1) o desenho (as mesmas funções da tela)
  if (o.texto) {
    FER.modo = 'texto';
    const { fonteDaFamilia } = await import('./fontes.mjs');
    const f = fonteDaFamilia(o.fonte || 'Impact');
    fonteUsada = { arquivo: f._arquivo, pedida: o.fonte || 'Impact', achou: !!f._achou || !!o.arquivoFonte };
    A.ferDesenharTexto();
  } else if (o.forma) {
    FER.modo = 'forma';
    A.ferDesenharForma(o.forma);
  } else {
    FER.modo = 'imagem';
    const img = lerImagem(o.imagemBytes, o.imagemNome);
    FER.nomeArquivo = o.imagemNome || 'imagem';
    A.ferUsarImagem({ naturalWidth: img.largura, naturalHeight: img.altura, width: img.largura, height: img.altura, _px: img.px });
  }
  if (!FER.origem) throw new Error('Não consegui montar o desenho.');
  // 2) recorte e cores (igual ferProcessar)
  const G = A.GEO, org = FER.origem;
  const modoRec = o.recorte && o.recorte !== 'auto' ? o.recorte : (FER.recorteAuto || 'tom');
  const lim = o.limiar != null ? o.limiar : (FER.limiarAuto != null ? FER.limiarAuto : 128);
  const inverter = o.inverter != null ? o.inverter : !!elementos.fer_inverter.checked;
  const detalhe = FER.modo === 'imagem' ? (o.detalhe || 'chapado') : 'chapado';
  const nNiveis = o.cores || 3, bico = 0.4;
  let m;
  if (modoRec === 'fundo' && FER.analise && FER.analise.corFundo) {
    m = G.mascaraPorFundo(org.px, org.w, org.h, FER.analise.corFundo, lim, true);
    if (inverter) for (let i = 0; i < m.d.length; i++) m.d[i] = m.d[i] ? 0 : 1;
  } else m = G.mascaraDePixels(org.px, org.w, org.h, { usarAlfa: modoRec === 'alfa', limiar: lim, inverter });
  m = G.suavizar(m, 1);
  m = G.limparSujeira(m, 0.01);
  const avisos = [];
  let coresArte = null;
  if (detalhe === 'cor') {
    coresArte = A.ferQuantizar(org.px, org.w, org.h, m, Math.min(4, nNiveis), A.ferMinPx(m, o.tamanhoMM, bico));
    if (!coresArte) avisos.push('A imagem tem uma cor só — não deu pra separar.');
  } else if (detalhe === 'relevo') {
    coresArte = A.ferNiveisDeTom(org.px, org.w, org.h, m, nNiveis, !!o.inverterRelevo, A.ferMinPx(m, o.tamanhoMM, bico));
    if (!coresArte) avisos.push('A imagem tem uma cor só — não tem tom pra virar relevo.');
  }
  FER.detalhe = detalhe;
  if (o.corBase) FER.cores.base = hexParaRGB(o.corBase);
  if (o.corDesenho) FER.cores.desenho = hexParaRGB(o.corDesenho);
  // 3) a peça (MODELOS.construir do site)
  const cfg = {
    modelo: o.modelo, larguraMM: o.tamanhoMM, altBase: o.alturaBaseMM, altArte: o.alturaRelevoMM, bordaMM: o.bordaMM,
    arteVazada: !!o.vazado, argolaLigada: o.argola, argolaFuroMM: o.furoArgolaMM, argolaPosicao: o.posicaoArgola,
    argolaCentro: o.centralizarArgola, argolaPonto: o.pontoArgola || null, argolaParedeMM: o.paredeArgolaMM, cantoMM: o.cantoMM,
    bicoMM: bico, coresArte, corBase: A.ferCorDe('base', null), corArte: A.ferCorDe('desenho', [17, 24, 39]),
    nfcLigado: o.nfc, nfcDiametroMM: o.nfcDiametroMM, nfcProfundidadeMM: 0.9, nfcModo: o.nfcModo
  };
  const peca = A.MODELOS.construir(m, cfg);
  if (peca.erro) throw new Error(peca.erro);
  FER.peca = peca; FER.malhas = A.MODELOS.malhas(peca); FER.marca++;
  // 4) sólidos prontos (mesmo caminho do "Baixar 3MF" da tela)
  const pecas = A.ferPecasParaEstudio();
  const partes = await pecasDoGerador(pecas, async (op, a) => executar(op, a), msg => avisos.push(msg));
  // 5) prévia: a mesma "Como vai ficar" da tela
  const cv = new Canvas(900, 660);
  elementos.fer_cv3d = cv;
  FER.vista = { rx: 0.95, rz: -0.42, zoom: 1 };
  A.ferPintar3D();
  const px = cv.getContext('2d').px;
  // fundo claro (o canvas é transparente fora da mesa)
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] < 255) { const a = px[i + 3] / 255; px[i] = px[i] * a + 247 * (1 - a); px[i + 1] = px[i + 1] * a + 245 * (1 - a); px[i + 2] = px[i + 2] * a + 242 * (1 - a); px[i + 3] = 255; }
  const previa = escreverPNG(px, cv.width, cv.height);
  return {
    partes, previa, fonteUsada,
    avisos: [...(peca.avisos || []), ...avisos, ...(FER.avisoLeve ? [FER.avisoLeve] : [])],
    medidas: { largura: peca.larguraMM, altura: peca.alturaMM, alturaTotal: peca.altBase + (peca.altArteReal || 0) },
    nfc: peca.nfc ? { modo: peca.nfc.modo, diametro: peca.nfc.diametroMM, profundidade: peca.nfc.prof, zPausa: peca.nfc.zPausa } : null,
    nome: o.texto ? String(o.texto).replace(/[^\wÀ-ÿ -]/g, '').trim().slice(0, 24) : (o.forma || (o.imagemNome || 'imagem').replace(/\.[^.]+$/, ''))
  };
}

// cena de um objeto com as partes (pra exportar 3MF/STL)
export const cenaDe = (nome, partes) => ({ objetos: [{ nome, transform: identidade(), partes }] });

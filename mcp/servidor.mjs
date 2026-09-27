#!/usr/bin/env node
// MCP do 144 Laboratório 3D — ferramentas de peças 3D pro Claude, rodando
// no computador da pessoa (stdio). Usa o MESMO motor do site: gerador de
// chaveiro, conserto, suavizar, corte com pinos, separar por cor, 3MF com cor.
// Não acessa internet nem dados do negócio.
import './silencio.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Module from 'manifold-3d';
import { definirManifold } from '../src/estudio3d/core/solidos.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { transformar, volume, caixa } from '../src/estudio3d/core/malha.js';
import { identidade } from '../src/estudio3d/core/mat4.js';
import { analisarSuavizar } from '../src/estudio3d/core/suavizar.js';
import { gerarPeca, cenaDe } from './gerador.mjs';
import { previaMalhas } from './previa.mjs';
import { arquivoDeEntrada, arquivoDeSaida, gravar, pastaSaida, pastasLiberadas } from './arquivos.mjs';

/* global __WASM_B64__, __VERSAO_MCP__ */
export const VERSAO = typeof __VERSAO_MCP__ !== 'undefined' ? __VERSAO_MCP__ : 'dev';
const PLA = 1.24;                                       // g/cm³

// ------------------------------------------------------------ motor 3D
let pronto = null;
export function prepararMotor() {
  if (!pronto) {
    const wasmBinary = typeof __WASM_B64__ !== 'undefined'
      ? Buffer.from(__WASM_B64__, 'base64')
      : fs.readFileSync(createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm'));
    pronto = Module({ wasmBinary, print: () => {}, printErr: () => {} }).then(w => { w.setup(); definirManifold(w); return w; });
  }
  return pronto;
}

// ------------------------------------------------------------ utilidades
const n = (x, d = 1) => Number(x).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const texto = t => ({ type: 'text', text: t });
const imagem = png => ({ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' });
const partesDe = objetos => objetos.flatMap(o => o.partes.map(p => ({ ...p, malha: transformar(p.malha, o.transform) })));
const medida = ms => { const c = ms.reduce((a, m) => { const b = caixa(m); if (!a) return b; return { min: a.min.map((v, i) => Math.min(v, b.min[i])), max: a.max.map((v, i) => Math.max(v, b.max[i])) }; }, null); return c ? c.max.map((v, i) => v - c.min[i]) : [0, 0, 0]; };
const pesoG = ms => ms.reduce((a, m) => a + Math.abs(volume(m)), 0) / 1000 * PLA;

function abrirModelo(arquivo) {
  const e = arquivoDeEntrada(arquivo, 'modelo');
  const r = executar('importar', { nome: e.nome, bytes: e.bytes, extras: {} });
  if (!r.objetos || !r.objetos.length) throw new Error('O arquivo não tem nenhuma peça.');
  return { ...e, objetos: r.objetos, avisos: r.avisos || [] };
}

// salva as partes: 3MF (cores e peças juntas) ou STL (uma peça = um .stl;
// várias = zip, ou tudo num .stl só com juntar_stl)
function salvar(objetos, nome, formato, sobrescrever, juntarSTL = false) {
  const base = String(nome || 'peca').replace(/\.(stl|3mf|zip|obj)$/i, '');
  if (formato === 'stl') {
    const r = executar('exportarSTL', { cena: { objetos }, opc: { porPeca: !juntarSTL } }), ext = r.zip ? '.zip' : '.stl';
    return gravar(arquivoDeSaida(base + ext, ext, sobrescrever), r.bytes);
  }
  const r = executar('exportar3MF', { cena: { objetos }, opc: { titulo: base } });
  return gravar(arquivoDeSaida(base + '.3mf', '.3mf', sobrescrever), r.bytes);
}
const nomeSem = f => path.basename(f).replace(/\.[^.]+$/, '');

// toda ferramenta: erro vira mensagem clara (isError), nunca derruba o servidor
const seguro = fn => async args => {
  try { await prepararMotor(); return await fn(args); } catch (e) {
    console.error('[144lab-mcp]', e && e.stack || e);
    return { content: [texto('Não deu certo: ' + (e && e.message || String(e)))], isError: true };
  }
};

// ------------------------------------------------------------ servidor
export function criarServidor() {
  const servidor = new McpServer({ name: '144lab-3d', version: VERSAO }, {
    instructions: 'Ferramentas de peças 3D do 144 Laboratório 3D (impressão 3D). Medidas sempre em mm. ' +
      'Os arquivos gerados vão pra pasta ' + pastaSaida() + '; pra usar um arquivo de entrada, passe o caminho completo (ou só o nome, se estiver nessa pasta). ' +
      'Depois de gerar ou alterar uma peça, mostre a prévia e diga onde o arquivo foi salvo. Prefira 3MF (cores e peças prontas pro Bambu Studio).'
  });
  const ANOT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const saidaArgs = {
    nome_arquivo: z.string().max(80).optional().describe('Nome do arquivo de saída (sem pasta). Padrão: nome da peça.'),
    formato: z.enum(['3mf', 'stl']).default('3mf').describe('3mf (padrão: cores e peças juntas, abre no Bambu Studio) ou stl'),
    sobrescrever: z.boolean().default(false).describe('Se já existir um arquivo com esse nome: false = cria "nome (2)"; true = substitui')
  };

  // ----------------------------------------------------- gerar chaveiro
  servidor.registerTool('gerar_chaveiro', {
    title: 'Gerar chaveiro / medalha / placa',
    description: 'Cria uma peça pronta pra imprimir a partir de um TEXTO, uma IMAGEM (PNG/JPG) ou uma FORMA pronta — o mesmo gerador do site. ' +
      'Modelos: chaveiro (segue o contorno do desenho), medalha (disco), placa (retângulo de canto arredondado), contorno (só o desenho). ' +
      'Tem argola (furo pra chaveiro: em cima/esquerda/direita/canto, centralizada ou num ponto livre), bolso pra tag NFC e desenho em várias cores. ' +
      'Salva 3MF com as cores (ou STL) e devolve a prévia 3D. Informe exatamente UM entre texto, imagem e forma.',
    inputSchema: {
      texto: z.string().min(1).max(40).optional().describe('Texto do chaveiro (até 40 letras)'),
      imagem: z.string().optional().describe('Caminho de uma imagem PNG ou JPG (fundo transparente ou liso funciona melhor)'),
      forma: z.enum(['circulo', 'quadrado', 'coracao', 'estrela', 'escudo', 'hexagono', 'flor', 'gota']).optional().describe('Forma pronta'),
      fonte: z.string().max(60).default('Impact').describe('Fonte do texto (instalada no computador): Impact, Arial Black, Arial, Georgia, Times New Roman, Verdana, Trebuchet MS, Comic Sans MS, Courier New…'),
      arquivo_fonte: z.string().optional().describe('Caminho de um .ttf/.otf, se quiser uma fonte específica'),
      modelo: z.enum(['chaveiro', 'medalha', 'placa', 'contorno']).default('chaveiro'),
      tamanho_mm: z.number().min(5).max(300).default(50).describe('Maior lado do desenho, em mm'),
      altura_base_mm: z.number().min(0.2).max(20).default(2.4),
      altura_relevo_mm: z.number().min(0).max(20).default(1.2).describe('Quanto o desenho sobe acima da base'),
      borda_mm: z.number().min(0).max(30).default(2.5).describe('Moldura em volta do desenho'),
      canto_mm: z.number().min(0).max(20).default(3).describe('Arredondamento do canto (modelo placa)'),
      detalhe: z.enum(['chapado', 'cor', 'relevo']).default('chapado').describe('Só pra imagem: chapado (uma cor), cor (separa nas cores da imagem), relevo (tons viram alturas)'),
      cores: z.number().int().min(2).max(6).default(3).describe('Quantas cores (detalhe=cor, até 4) ou níveis (detalhe=relevo)'),
      recorte: z.enum(['auto', 'alfa', 'fundo', 'tom']).default('auto').describe('Como separar o desenho do fundo da imagem (auto decide sozinho)'),
      limiar: z.number().min(5).max(245).optional().describe('Sensibilidade do recorte (avançado)'),
      inverter: z.boolean().optional().describe('Troca desenho e fundo (avançado)'),
      desenho_vazado: z.boolean().default(false).describe('O desenho vira furo passante (estêncil)'),
      argola: z.boolean().default(true).describe('Furo pra argola do chaveiro'),
      argola_posicao: z.enum(['topo', 'esquerda', 'direita', 'canto', 'livre']).default('topo'),
      argola_centralizar: z.boolean().default(true).describe('Em cima/esquerda/direita: no meio da peça (false = ponto mais pra fora)'),
      argola_ponto: z.object({ u: z.number().min(-1).max(2), v: z.number().min(-1).max(2) }).optional().describe('Posição livre: u,v na caixa do desenho (0,0 = canto de cima à esquerda; 1,1 = de baixo à direita). Use com argola_posicao=livre'),
      furo_argola_mm: z.number().min(1).max(15).default(4),
      parede_argola_mm: z.number().min(0.4).max(10).default(2.2),
      nfc: z.boolean().default(false).describe('Bolso pra tag NFC'),
      nfc_modo: z.enum(['baixo', 'fechado']).default('baixo').describe('baixo = aberto por baixo (cola depois); fechado = lacrado por dentro (pausar a impressão)'),
      nfc_diametro_mm: z.number().min(8).max(60).default(25),
      cor_base: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('Cor da base no 3MF (#RRGGBB)'),
      cor_desenho: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('Cor do desenho no 3MF (#RRGGBB)'),
      ...saidaArgs
    },
    annotations: { ...ANOT, title: 'Gerar chaveiro / medalha / placa' }
  }, seguro(async a => {
    const fontes = [a.texto, a.imagem, a.forma].filter(x => x != null && x !== '');
    if (fontes.length !== 1) throw new Error('Informe exatamente um entre texto, imagem e forma.');
    let imagemBytes = null, imagemNome = null, arquivoFonte = null;
    if (a.imagem) { const e = arquivoDeEntrada(a.imagem, 'imagem'); imagemBytes = e.bytes; imagemNome = e.nome; }
    if (a.arquivo_fonte) {
      // fonte é só lida (nunca executada): vale de qualquer pasta, mas só .ttf/.otf de até 50 MB
      const p = path.resolve(a.arquivo_fonte);
      if (!/\.(ttf|otf)$/i.test(p) || !fs.existsSync(p) || !fs.statSync(p).isFile() || fs.statSync(p).size > 50 * 1048576) throw new Error('arquivo_fonte precisa ser um arquivo .ttf ou .otf (até 50 MB).');
      arquivoFonte = p;
    }
    if (a.argola_posicao === 'livre' && !a.argola_ponto) throw new Error('Com argola_posicao=livre, informe argola_ponto {u, v}.');
    const r = await gerarPeca({
      texto: a.texto, forma: a.forma, imagemBytes, imagemNome, fonte: a.fonte, arquivoFonte,
      modelo: a.modelo, tamanhoMM: a.tamanho_mm, alturaBaseMM: a.altura_base_mm, alturaRelevoMM: a.altura_relevo_mm, bordaMM: a.borda_mm, cantoMM: a.canto_mm,
      detalhe: a.detalhe, cores: a.cores, recorte: a.recorte, limiar: a.limiar, inverter: a.inverter, vazado: a.desenho_vazado,
      argola: a.argola, posicaoArgola: a.argola_posicao, centralizarArgola: a.argola_centralizar, pontoArgola: a.argola_ponto,
      furoArgolaMM: a.furo_argola_mm, paredeArgolaMM: a.parede_argola_mm,
      nfc: a.nfc, nfcModo: a.nfc_modo, nfcDiametroMM: a.nfc_diametro_mm,
      corBase: a.cor_base && '#' + a.cor_base.replace('#', ''), corDesenho: a.cor_desenho && '#' + a.cor_desenho.replace('#', '')
    });
    const nome = a.nome_arquivo || r.nome || 'chaveiro';
    const s = salvar(cenaDe(nome, r.partes).objetos, nome, a.formato, a.sobrescrever);
    const ms = r.partes.map(p => p.malha);
    const linhas = [
      'Salvo em: ' + s.caminho + ' (' + s.kb + ' KB)',
      'Tamanho: ' + n(r.medidas.largura) + ' × ' + n(r.medidas.altura) + ' mm · altura ' + n(r.medidas.alturaTotal) + ' mm · ≈ ' + n(pesoG(ms)) + ' g de PLA',
      'Peças (cores): ' + r.partes.map(p => p.nome + ' ' + p.cor).join(', ')
    ];
    if (r.nfc) linhas.push('Tag NFC de ' + r.nfc.diametro + ' mm: bolso de ' + n(r.nfc.profundidade) + ' mm ' + (r.nfc.modo === 'fechado' ? 'lacrado por dentro — PAUSE a impressão em Z = ' + n(r.nfc.zPausa) + ' mm, coloque a tag e continue.' : 'aberto por baixo (virado pra mesa) — imprima normal e cole a tag no final.'));
    if (r.fonteUsada && !r.fonteUsada.achou) linhas.push('Atenção: a fonte "' + r.fonteUsada.pedida + '" não está instalada; usei ' + path.basename(r.fonteUsada.arquivo) + '.');
    if (r.avisos.length) linhas.push('Avisos: ' + r.avisos.join(' | '));
    return { content: [texto(linhas.join('\n')), imagem(r.previa)] };
  }));

  // ----------------------------------------------------- analisar
  servidor.registerTool('analisar_peca', {
    title: 'Analisar peça',
    description: 'Abre um STL, 3MF ou OBJ e diz se está pronto pra imprimir: medidas (mm), peso estimado em PLA, triângulos, se é fechado (sem buracos), faces invertidas, peças que se atravessam, parede fina (< 0,8 mm). Devolve uma prévia. Não altera nada.',
    inputSchema: { arquivo: z.string().describe('Caminho do STL/3MF/OBJ') },
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Analisar peça' }
  }, seguro(async ({ arquivo }) => {
    const m = abrirModelo(arquivo), partes = partesDe(m.objetos);
    const linhas = ['Arquivo: ' + m.caminho];
    const tam = medida(partes.map(p => p.malha));
    linhas.push('Tamanho total: ' + tam.map(v => n(v)).join(' × ') + ' mm · ≈ ' + n(pesoG(partes.map(p => p.malha))) + ' g de PLA (100% cheio)');
    for (const p of partes) {
      const v = executar('analisar', { parte: p, opc: { completo: true } });
      const prob = [];
      if (!v.fechada) prob.push(v.arestasAbertas + ' arestas abertas (buraco)');
      if (v.arestasNaoManifold) prob.push(v.arestasNaoManifold + ' arestas quebradas');
      if (v.componentesInvertidos || v.orientacaoTrocada) prob.push('faces viradas do avesso');
      if (v.autoInterseccoes) prob.push(v.autoInterseccoes + ' auto-interseções');
      if (v.facesFinas) prob.push('parede fina (mín. ' + n(v.espessuraMinima, 2) + ' mm)');
      if (v.facesDegeneradas) prob.push(v.facesDegeneradas + ' triângulos degenerados');
      linhas.push('• ' + (p.nome || 'peça') + ': ' + v.triangulos.toLocaleString('pt-BR') + ' triângulos, ' + v.componentes + ' pedaço(s), volume ' + n(Math.abs(v.volume) / 1000, 2) + ' cm³ → ' +
        (prob.length ? 'PROBLEMAS: ' + prob.join('; ') + '. Use consertar_peca.' : 'pronta pra imprimir (fechada, sem interseções' + (v.espessuraMinima != null ? ', parede mín. ' + n(v.espessuraMinima, 2) + ' mm' : '') + ').'));
    }
    if (m.avisos.length) linhas.push('Avisos da leitura: ' + m.avisos.join(' | '));
    return { content: [texto(linhas.join('\n')), imagem(previaMalhas(partes.map(p => ({ malha: p.malha, cor: p.cor }))))] };
  }));

  // ----------------------------------------------------- consertar
  servidor.registerTool('consertar_peca', {
    title: 'Consertar peça',
    description: 'Conserta a malha pra imprimir: fecha buracos, desvira faces, solda vértices soltos, tira triângulos duplicados/degenerados e vira sólido fechado. Salva uma cópia (não mexe no original) e diz o que foi feito.',
    inputSchema: { arquivo: z.string().describe('Caminho do STL/3MF/OBJ'), ...saidaArgs },
    annotations: { ...ANOT, idempotentHint: true, title: 'Consertar peça' }
  }, seguro(async a => {
    const m = abrirModelo(a.arquivo), relat = [];
    const objetos = m.objetos.map(o => ({ ...o, partes: o.partes.map(p => { const r = executar('reparar', { parte: p, opc: { completo: true, taparBuracos: true } }); relat.push({ nome: p.nome, r }); return { ...p, ...r.parte }; }) }));
    const s = salvar(objetos, a.nome_arquivo || nomeSem(m.nome) + ' consertado', a.formato, a.sobrescrever);
    const linhas = ['Salvo em: ' + s.caminho + ' (' + s.kb + ' KB)'];
    for (const { nome, r } of relat) linhas.push('• ' + (nome || 'peça') + ': ' + (r.passos.length ? r.passos.join('; ') : 'já estava boa') + ' → ' + (r.depois.fechada ? 'fechada' : 'AINDA ABERTA') + ', ' + (r.depois.autoInterseccoes || 0) + ' auto-interseções' + (r.solido ? ', sólido OK' : ''));
    return { content: [texto(linhas.join('\n')), imagem(previaMalhas(partesDe(objetos).map(p => ({ malha: p.malha, cor: p.cor }))))] };
  }));

  // ----------------------------------------------------- suavizar
  servidor.registerTool('suavizar_peca', {
    title: 'Suavizar peça',
    description: 'Alisa a superfície sem encolher (tira grão e "caroço" de modelo feito por IA ou scan). Leve ≈ 1% da peça (só o grão), média ≈ 5% (padrão, caroço de IA), forte ≈ 10% (bem liso; arredonda detalhe menor que isso). Quinas vivas ficam. Salva uma cópia.',
    inputSchema: {
      arquivo: z.string(),
      nivel: z.enum(['leve', 'media', 'forte']).default('media'),
      intensidade: z.number().min(1).max(100).optional().describe('Em vez do nível: 1 a 100 (25 = leve, 60 = média, 90 = forte)'),
      preservar_quinas: z.boolean().default(true),
      arredondar_facetas: z.boolean().optional().describe('Peça de poucos triângulos (facetada): divide e arredonda. Padrão: automático'),
      ...saidaArgs
    },
    annotations: { ...ANOT, title: 'Suavizar peça' }
  }, seguro(async a => {
    const m = abrirModelo(a.arquivo), inten = (a.intensidade != null ? a.intensidade : { leve: 25, media: 60, forte: 90 }[a.nivel]) / 100, relat = [];
    const objetos = m.objetos.map(o => ({ ...o, partes: o.partes.map(p => {
      const facetas = a.arredondar_facetas != null ? a.arredondar_facetas : analisarSuavizar(p.malha).facetada;
      const r = executar('suavizar', { parte: p, opc: { intensidade: inten, preservar: a.preservar_quinas, facetas } });
      relat.push({ nome: p.nome, i: r.info }); return { ...p, ...r.parte };
    }) }));
    const s = salvar(objetos, a.nome_arquivo || nomeSem(m.nome) + ' suavizado', a.formato, a.sobrescrever);
    const linhas = ['Salvo em: ' + s.caminho + ' (' + s.kb + ' KB) — intensidade ' + Math.round(inten * 100) + '%'];
    for (const { nome, i } of relat) linhas.push('• ' + (nome || 'peça') + ': mexeu até ' + n(i.deslocamentoMax || 0, 2) + ' mm (média ' + n(i.deslocamentoMedio || 0, 2) + ')' +
      (i.volume != null ? ', volume ' + (i.volume > 0 ? '+' : '') + n(i.volume, 2) + '%' : '') + (i.facetas ? ', facetas arredondadas (' + i.facetas.antes + ' → ' + i.facetas.depois + ' triângulos)' : '') +
      (i.cruzamentos && i.cruzamentos.revertidos ? ', ' + i.cruzamentos.revertidos + ' ponto(s) em parte fina ficaram como estavam' : '') +
      (i.cruzamentos && i.cruzamentos.completo === false ? ' (conferência de cruzamento incompleta: rode analisar_peca)' : ''));
    return { content: [texto(linhas.join('\n')), imagem(previaMalhas(partesDe(objetos).map(p => ({ malha: p.malha, cor: p.cor }))))] };
  }));

  // ----------------------------------------------------- cortar
  servidor.registerTool('cortar_peca', {
    title: 'Cortar peça (com pinos de encaixe)',
    description: 'Corta a peça num plano (pra caber na mesa ou imprimir sem suporte) e, se pedir, cria pinos de encaixe com folga: pino numa metade e furo na outra. Salva as duas metades.',
    inputSchema: {
      arquivo: z.string(),
      eixo: z.enum(['x', 'y', 'z']).default('z').describe('z = corte horizontal (altura)'),
      altura_mm: z.number().optional().describe('Onde cortar, em mm a partir do começo da peça nesse eixo'),
      percentual: z.number().min(1).max(99).default(50).describe('Onde cortar em % do tamanho (se não passar altura_mm)'),
      pinos: z.enum(['nenhum', 'cilindrico', 'quadrado', 'hexagonal', 'solto']).default('cilindrico').describe('solto = pino separado, furos dos dois lados'),
      quantidade_pinos: z.number().int().min(1).max(8).optional().describe('Padrão: automático pelo tamanho do corte'),
      folga_mm: z.number().min(0).max(1).default(0.2),
      ...saidaArgs
    },
    annotations: { ...ANOT, title: 'Cortar peça' }
  }, seguro(async a => {
    const m = abrirModelo(a.arquivo), partes = partesDe(m.objetos), e = { x: 0, y: 1, z: 2 }[a.eixo];
    const c0 = partes.reduce((acc, p) => { const b = caixa(p.malha); return acc ? { min: acc.min.map((v, i) => Math.min(v, b.min[i])), max: acc.max.map((v, i) => Math.max(v, b.max[i])) } : b; }, null);
    const d = c0.min[e] + (a.altura_mm != null ? a.altura_mm : (c0.max[e] - c0.min[e]) * a.percentual / 100);
    if (!(d > c0.min[e] && d < c0.max[e])) throw new Error('O corte tem que ficar dentro da peça: entre 0 e ' + n(c0.max[e] - c0.min[e]) + ' mm nesse eixo.');
    const nrm = [0, 0, 0]; nrm[e] = 1;
    const conector = a.pinos === 'nenhum' ? null : { tipo: a.pinos, auto: a.quantidade_pinos == null, quantidade: a.quantidade_pinos || 2, folga: a.folga_mm };
    const r = executar('cortar', { partes, plano: { n: nrm, d }, opc: conector ? { conector } : {} });
    const objetos = [{ nome: 'parte A', transform: identidade(), partes: r.A }, { nome: 'parte B', transform: identidade(), partes: r.B }];
    if (r.extras && r.extras.length) objetos.push({ nome: 'pinos', transform: identidade(), partes: r.extras });
    // no 3MF as metades saem lado a lado e apoiadas na mesa
    const larg = c0.max[0] - c0.min[0] + 10;
    objetos.forEach((o, i) => { const zmin = Math.min(...o.partes.map(p => caixa(p.malha).min[2])); o.transform = identidade(); o.transform[12] = i * larg; o.transform[14] = -zmin; });
    const s = salvar(objetos, a.nome_arquivo || nomeSem(m.nome) + ' cortado', a.formato, a.sobrescrever);
    const linhas = ['Salvo em: ' + s.caminho + ' (' + s.kb + ' KB)', 'Corte em ' + a.eixo.toUpperCase() + ' = ' + n(d - c0.min[e]) + ' mm · área do corte ' + n(r.areaSecao || 0) + ' mm² · volumes ' + (r.volumes || []).map(v => n(v / 1000, 2) + ' cm³').join(' e ')];
    for (const p of (r.relatorio || [])) linhas.push('• pino ' + p.pino + ' / furo ' + p.furo + ', profundidade ' + n(p.profundidade) + ' mm');
    if (r.avisos && r.avisos.length) linhas.push('Avisos: ' + r.avisos.join(' | '));
    const prev = partesDe(objetos).map(p => ({ malha: p.malha, cor: p.cor }));
    return { content: [texto(linhas.join('\n')), imagem(previaMalhas(prev))] };
  }));

  // ----------------------------------------------------- separar por cor
  servidor.registerTool('separar_por_cor', {
    title: 'Separar por cor (peças que encaixam)',
    description: 'Pega um 3MF pintado (várias cores na mesma malha) e transforma cada cor numa PEÇA física que imprime e encaixa: inserto com folga, corte no plano da divisa, relevo que sai pela base, etc. Salva um 3MF com as peças.',
    inputSchema: {
      arquivo: z.string().describe('3MF com cores pintadas'),
      espessura_mm: z.number().min(0.4).max(5).default(0.8).describe('Espessura do inserto de cor'),
      folga_mm: z.number().min(0).max(0.6).default(0.1),
      ...saidaArgs
    },
    annotations: { ...ANOT, title: 'Separar por cor' }
  }, seguro(async a => {
    const m = abrirModelo(a.arquivo), partes = partesDe(m.objetos);
    const pintada = partes.find(p => p.malha.cor && p.paleta && p.paleta.length > 1);
    if (!pintada) throw new Error('Esse arquivo não tem uma peça pintada com mais de uma cor.');
    const r = executar('separarPorCor', { parte: pintada, opc: { espessura: a.espessura_mm, folga: a.folga_mm } });
    const objetos = [{ nome: nomeSem(m.nome), transform: identidade(), partes: r.pecas.map(p => ({ nome: p.cor, cor: p.cor, malha: p.malha })) }];
    const s = salvar(objetos, a.nome_arquivo || nomeSem(m.nome) + ' por cor', a.formato, a.sobrescrever);
    const linhas = ['Salvo em: ' + s.caminho + ' (' + s.kb + ' KB)', 'Peças: ' + r.pecas.map(p => p.cor + ' (' + n(volume(p.malha) / 1000, 2) + ' cm³)').join(', ')];
    if (r.avisos && r.avisos.length) linhas.push('Avisos: ' + r.avisos.join(' | '));
    return { content: [texto(linhas.join('\n')), imagem(previaMalhas(r.pecas.map(p => ({ malha: p.malha, cor: p.cor }))))] };
  }));

  // ----------------------------------------------------- converter
  servidor.registerTool('converter_peca', {
    title: 'Converter peça (STL ↔ 3MF)',
    description: 'Converte STL/OBJ/3MF em 3MF (com cor, abre direto no Bambu Studio) ou STL. Pode trocar a cor e a unidade (arquivo em polegadas/cm → mm).',
    inputSchema: {
      arquivo: z.string(),
      cor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('Cor da peça no 3MF (#RRGGBB)'),
      escala: z.number().min(0.001).max(1000).default(1).describe('Multiplica o tamanho (25.4 = polegada→mm, 10 = cm→mm)'),
      juntar_stl: z.boolean().default(false).describe('STL: tudo num arquivo só (em vez de um por peça)'),
      ...saidaArgs
    },
    annotations: { ...ANOT, idempotentHint: true, title: 'Converter peça' }
  }, seguro(async a => {
    const m = abrirModelo(a.arquivo), cor = a.cor && '#' + a.cor.replace('#', '').toUpperCase();
    const objetos = m.objetos.map(o => ({ ...o, partes: o.partes.map(p => {
      let q = { ...p, cor: cor || p.cor || '#B4BAC4' };
      if (a.escala !== 1) q = { ...q, ...executar('escalarGeometria', { parte: q, fator: a.escala }).parte };
      return q;
    }) }));
    const s = salvar(objetos, a.nome_arquivo || nomeSem(m.nome), a.formato, a.sobrescrever, a.juntar_stl);
    const ms = partesDe(objetos).map(p => p.malha), tam = medida(ms);
    return { content: [texto('Salvo em: ' + s.caminho + ' (' + s.kb + ' KB)\nTamanho: ' + tam.map(v => n(v)).join(' × ') + ' mm · ≈ ' + n(pesoG(ms)) + ' g de PLA')] };
  }));

  // ----------------------------------------------------- pastas
  servidor.registerTool('pastas_do_mcp', {
    title: 'Onde ficam os arquivos',
    description: 'Mostra a pasta onde o MCP salva os arquivos e as pastas de onde ele pode ler, com os arquivos 3D e imagens mais recentes da pasta de saída.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Onde ficam os arquivos' }
  }, seguro(async () => {
    const saida = pastaSaida();
    const recentes = fs.readdirSync(saida).filter(f => /\.(stl|3mf|obj|zip|png|jpe?g)$/i.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(saida, f)).mtimeMs })).sort((x, y) => y.t - x.t).slice(0, 15).map(x => x.f);
    return { content: [texto('Salva em: ' + saida + '\nPode ler de: ' + pastasLiberadas().join(', ') + '\nMais recentes: ' + (recentes.length ? recentes.join(', ') : '(nenhum ainda)'))] };
  }));

  return servidor;
}

// rodando direto (node servidor.mjs ou o pacote): conecta no stdio
const direto = (() => { try { return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (direto || typeof __VERSAO_MCP__ !== 'undefined') {
  prepararMotor().catch(e => console.error('[144lab-mcp] motor 3D:', e));
  await criarServidor().connect(new StdioServerTransport());
  console.error('[144lab-mcp] pronto (' + VERSAO + '), salvando em ' + pastaSaida());
}

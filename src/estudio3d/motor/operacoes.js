// API única do motor. Tudo aqui recebe e devolve dados simples (arrays
// tipados), pra rodar igual no Web Worker, na thread principal e no Node.
import { importarArquivo } from '../core/importar.js';
import { validar, espessuras, facesInternas } from '../core/validador.js';
import { reparar as repararMalha } from '../core/reparo.js';
import { comContexto, manifold, temManifold } from '../core/solidos.js';
import { cortarPorPlano } from '../core/corte.js';
import { cortarLocal, sugerirSeparacao } from '../core/corteLocal.js';
import { aplicarOperacao, reaplicar } from '../core/historico.js';
import { deformar } from '../core/deformar.js';
import { suavizarMalha, analisarSuavizar } from '../core/suavizar.js';
import { criarDoDesenho } from '../core/desenho.js';
import { separarDetalhe, separarCascas } from '../core/separar.js';
import { separarPorCor } from '../core/separarCor.js';
import { prepararAdjacencia } from '../core/selecao.js';
import { aplicarRelevo } from '../core/relevo.js';
import { segmentar } from '../core/segmentacao.js';
import { escrever3MF } from '../core/formatos/tmf.js';
import { escreverSTL } from '../core/formatos/stl.js';
import { escreverZip } from '../core/formatos/zip.js';
import { transformar, juntar, volume, caixa, semFaces, compactar } from '../core/malha.js';
import { gerarForma } from '../core/formas.js';
import { combinar, aplicarFuros, aplicarFurosNaCena } from '../core/modelagem.js';
import { fotosPara3D, prepararVistas } from '../core/ia/reconstrucao.js';
import { melhorGiro, normalizar, avaliar } from '../core/ia/avaliacao.js';
import { BufferGeometry, BufferAttribute } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { progresso } from '../core/progresso.js';
import { analisar as analisarLogo } from '../../gerador/analise.js';
import { construir as construirChaveiro } from '../../gerador/chaveiro.js';
import { criar } from '../core/malha.js';

// GERADOR DE CHAVEIRO: a análise (máscaras grandes) fica aqui no worker; a
// tela só recebe o resumo e manda construir de novo a cada ajuste
const analises = new Map();
function resumoAnalise(id, an) {
  const { W, H, fatorImg, modo, fundo, cores, coresBrutas, caixa, ruido, sugestao, ms } = an;
  return { id, W, H, fatorImg, modo, fundo, coresBrutas, caixa, ruido, sugestao, ms,
    cores: cores.map(c => ({ id: c.id, hex: c.hex, nome: c.nome, fracao: c.fracao, pai: c.pai, nivel: c.nivel })) };
}

// operações cujo resultado não vai pra tela como peça
export const SEM_RENDER = new Set(['analisar', 'bvh', 'exportar3MF', 'exportarSTL', 'medidas', 'sugerirSeparacao', 'adjacencia']);

function resumoValidacao(v) {
  const r = Object.assign({}, v);
  delete r.infoComponentes;
  return r;
}

export const OPERACOES = {
  geradorAnalisar({ id, px, w, h }) {
    progresso(0.1, 'Analisando a logo');
    const an = analisarLogo({ px, w, h });
    if (an.erro) return { erro: an.erro };
    analises.set(id, an);
    while (analises.size > 3) analises.delete(analises.keys().next().value);
    return resumoAnalise(id, an);
  },
  geradorConstruir({ id, cfg }) {
    const an = analises.get(id);
    if (!an) { const e = new Error('A análise da logo não está mais no motor.'); e.codigo = 'sem-analise'; throw e; }
    const r = construirChaveiro(an, cfg);
    if (r.erro) return { erro: r.erro };
    r.partes = r.partes.map(p => ({ ...p, malha: criar(p.malha.pos, p.malha.idx) }));
    return r;
  },

  importar({ nome, bytes, extras }) { return importarArquivo(nome, bytes, extras || {}); },

  analisar({ parte, opc }) {
    const v = validar(parte.malha, { ...(opc || {}), progresso: true });
    return resumoValidacao(v);
  },

  reparar({ parte, opc }) {
    opc = opc || {};
    progresso(0.02, 'Conferindo a malha');
    const antes = resumoValidacao(validar(parte.malha, { completo: false }));
    const r = repararMalha(parte.malha, { ...opc, progresso: true });
    let malha = r.malha, cor = parte.cor, paleta = parte.paleta;
    const passos = r.passos.slice();
    let solido = false;
    if (temManifold()) {
      progresso(0.6, 'Virando sólido');
      try {
        comContexto(ctx => {
          const man = ctx.solido({ malha, cor, paleta: malha.cor ? paleta : null }, parte.nome);
          const p = ctx.parte(man, parte.nome, cor);
          malha = p.malha; cor = p.cor; paleta = p.paleta;
        });
        solido = true;
      } catch (e) { passos.push('ainda não é um sólido fechado: ' + e.message); }
    }
    progresso(0.75, 'Conferindo o resultado');
    const depois = resumoValidacao(validar(malha, { completo: opc.completo !== false }));
    return { parte: { nome: parte.nome, malha, cor, paleta }, passos, antes, depois, solido };
  },

  // cascas que se atravessam viram um sólido só (o que o fatiador faria)
  unirSobrepostos({ parte }) {
    return comContexto(ctx => {
      const { Manifold } = manifold();
      const s = ctx.solido(parte, parte.nome);
      const comps = s.decompose().map(c => ctx.guardar(c));
      const u = comps.length > 1 ? ctx.guardar(Manifold.union(comps)) : s;
      return { parte: ctx.parte(u, parte.nome, parte.cor), antes: comps.length, depois: u.decompose().map(c => { c.delete(); return 1; }).length };
    });
  },

  removerInternos({ parte }) {
    const r = facesInternas(parte.malha);
    if (!r.removidos) return { parte, removidos: 0 };
    return { parte: { ...parte, malha: compactar(semFaces(parte.malha, r.mask)) }, removidos: r.removidos };
  },

  // converte unidade (assado na geometria: o arquivo passa a estar em mm de verdade)
  escalarGeometria({ parte, fator }) {
    const m = transformar(parte.malha, [fator, 0, 0, 0, 0, fator, 0, 0, 0, 0, fator, 0, 0, 0, 0, 1]);
    return { parte: { ...parte, malha: m } };
  },

  cortar({ partes, plano, opc }) { return cortarPorPlano(partes, plano, { ...(opc || {}), progresso: true }); },
  // só a parte clicada (mão, cabeça…): sugestão do lugar e o corte em si
  sugerirSeparacao({ partes, ponto, opc }) { return sugerirSeparacao(partes, ponto, opc || {}); },
  cortarLocal({ partes, plano, ponto, opc }) { return cortarLocal(partes, plano, ponto, opc || {}); },
  separarDetalhe({ parte, mascara, opc }) { return separarDetalhe(parte, mascara, { ...(opc || {}), progresso: true }); },
  separarPorCor({ parte, opc }) { return separarPorCor(parte, opc || {}); },
  separarCascas({ parte }) { return { partes: separarCascas(parte) }; },
  relevo({ partes, alvo, forma, opc }) { return aplicarRelevo(partes, alvo, forma, opc || {}); },
  segmentar({ parte, opc }) { const r = segmentar(parte.malha, opc || {}); return r; },
  espessura({ parte, opc }) { return espessuras(parte.malha, opc || {}); },

  // booleana entre objetos: tipo 'unir' | 'subtrair' | 'intersectar'
  booleana({ tipo, a, b }) {
    return comContexto(ctx => {
      const { Manifold } = manifold();
      const sa = ctx.guardar(Manifold.union(a.map(p => ctx.solido(p, p.nome))));
      const sb = ctx.guardar(Manifold.union(b.map(p => ctx.solido(p, p.nome))));
      const r = ctx.guardar(tipo === 'subtrair' ? sa.subtract(sb) : tipo === 'intersectar' ? sa.intersect(sb) : sa.add(sb));
      if (r.isEmpty()) throw new Error('O resultado ficou vazio.');
      return { parte: ctx.parte(r, a[0].nome, a[0].cor) };
    });
  },

  // biblioteca de formas (sempre sólido fechado, em mm)
  forma({ id, params, opc }) { return gerarForma(id, params || {}, opc || {}); },
  // unir / tirar uma da outra / parte comum
  combinar({ objetos, modo, opc }) { progresso(0.1, 'Calculando a combinação'); return combinar(objetos, modo, opc || {}); },
  // fotos de várias vistas -> sólido fechado (silhuetas, sem IA, roda na CPU)
  // (etapa final do pipeline: o mesmo Consertar do editor)
  fotosPara3D({ entradas, opc }) {
    const r = fotosPara3D(entradas, opc || {});
    const rep = OPERACOES.reparar({ parte: { nome: r.nome, malha: r.malha, cor: r.cor, paleta: r.paleta }, opc: {} });
    return { ...r, malha: rep.parte.malha, cor: rep.parte.cor, paleta: rep.parte.paleta, relatorio: { ...r.relatorio, reparo: rep.passos, triangulos: rep.parte.malha.idx.length / 3 } };
  },
  // Resultado de QUALQUER gerador (arquivo do servidor de IA já importado, ou
  // o local) -> peça do editor: consertar, pôr no referencial das fotos (Z pra
  // cima, giro que bate com as fotos, altura em mm, na mesa) e medir (benchmark).
  posProcessarIA({ partes, entradas, opc }) {
    opc = opc || {};
    const t0 = Date.now();
    const paleta = [];
    const idxCor = h => { let k = paleta.indexOf(h); if (k < 0) { k = paleta.length; paleta.push(h); } return k; };
    const malhas = partes.map(p => {
      if (!p.malha.cor || !p.paleta) return { ...p.malha, cor: null, _k: idxCor(p.cor || '#B4BAC4') };
      const mapa = p.paleta.map(idxCor);
      return { ...p.malha, cor: Uint16Array.from(p.malha.cor, k => mapa[k]) };
    });
    const junta = malhas.length === 1 && !malhas[0].cor ? malhas[0] : juntar(malhas, malhas.map(m => m._k || 0));
    const malha0 = paleta.length > 1 ? junta : { pos: junta.pos, idx: junta.idx };
    const rep = OPERACOES.reparar({ parte: { nome: opc.nome || 'Modelo das fotos', malha: malha0, cor: paleta[0], paleta: paleta.length > 1 ? paleta : null }, opc: {} });
    const prep = prepararVistas(entradas, opc.alturaMM || 60, opc);
    const g = opc.girar === false
      ? { giro: 0, malha: normalizar(rep.parte.malha, { eixoCima: opc.eixoCima, alturaMM: prep.alturaMM }) }
      : melhorGiro(rep.parte.malha, prep, { eixoCima: opc.eixoCima, alturaMM: prep.alturaMM });
    const avaliacao = avaliar(g.malha, prep, { fidelidade: g.fidelidade, reparo: rep.passos });
    return {
      parte: { ...rep.parte, malha: g.malha },
      relatorio: { giro: g.giro, reparo: rep.passos, avaliacao, avisos: prep.avisos, ms: Date.now() - t0 }
    };
  },
  transformarParte({ parte, transform }) { return { parte: { ...parte, malha: transformar(parte.malha, transform) } }; },
  // modelagem: arredondar, chanfrar, puxar/empurrar face, casca, espelhar
  // (op com bordas/faces por posição relativa: dá pra refazer depois)
  modificar({ parte, op }) { const p = aplicarOperacao(parte, op); return { parte: { ...p, nome: parte.nome } }; },
  reaplicar({ parte, operacoes }) { return reaplicar(parte, operacoes); },
  // orgânico: torcer/afunilar/dobrar/inflar a peça inteira e suavizar de verdade
  deformar({ parte, opc }) { return deformar(parte, opc || {}); },
  // suavizar: tira grão e caroço sem encolher, quina/detalhe ficam; com
  // seleção, só ela (transição suave). 'facetas': malha de poucos triângulos
  // vira superfície lisa de verdade (divide; quina > 60° fica viva)
  suavizar({ parte, opc }) {
    const o = opc || {};
    let p = parte, facetas = null;
    if (o.facetas && !o.mascara) {
      p = comContexto(ctx => {
        const M = ctx.solido(parte, parte.nome), d = analisarSuavizar(parte.malha);
        const L = Math.max(d.tamanho / 400, Math.sqrt(M.surfaceArea() / (150000 * 0.433)));
        // simplify: o refine deixa triângulo degenerado em face plana — sai
        const R = ctx.guardar(ctx.guardar(ctx.guardar(M.smoothOut(60, 0)).refineToLength(L)).simplify(1e-5));
        facetas = { antes: M.numTri(), depois: R.numTri() };
        return { ...parte, ...ctx.parte(R, parte.nome, parte.cor, false) };
      });
    }
    const r = suavizarMalha(p.malha, o);
    return { parte: { ...p, nome: parte.nome, malha: r.malha }, info: { ...r.info, facetas } };
  },
  // desenho 2D -> peça (espessura, giro ou tubo)
  desenho({ pts, tipo, opc }) { return criarDoDesenho(pts, tipo, opc || {}); },
  // divide os triângulos (pro pincel de esculpir ter onde mexer)
  refinar({ parte, aresta }) {
    return comContexto(ctx => {
      const M = ctx.solido(parte, parte.nome);
      if (M.numTri() > 600000) throw new Error('A malha já tem muito detalhe (' + M.numTri() + ' triângulos).');
      const r = ctx.guardar(M.refineToLength(Math.max(0.1, +aresta || 1)));
      if (r.numTri() > 1500000) throw new Error('Ficaria com ' + r.numTri() + ' triângulos — use um pincel maior.');
      return { parte: ctx.parte(r, parte.nome, parte.cor, false) };
    });
  },
  // prévia ao vivo dos furos num objeto
  furar({ alvo, furos }) { return aplicarFuros(alvo, furos); },

  exportar3MF({ cena, opc }) {
    // furos entram na geometria de verdade; objeto-furo não vai pro arquivo
    cena = aplicarFurosNaCena(cena);
    const r = escrever3MF(cena, { ...(opc || {}), progresso: true });
    return { bytes: r.bytes, cores: r.cores, avisos: r.avisos };
  },

  // STL: um arquivo por objeto (peças juntas) ou por peça; vários -> zip
  exportarSTL({ cena, opc }) {
    opc = opc || {};
    cena = aplicarFurosNaCena(cena);
    const arquivos = [];
    const usados = new Set();
    const nomeUnico = n => { let s = n.replace(/[^\w\u00C0-\u00FF .-]/g, '').trim().replace(/\s+/g, '_') || 'peca'; let k = s, i = 2; while (usados.has(k)) k = s + '_' + i++; usados.add(k); return k; };
    for (const o of cena.objetos) {
      const mundo = o.partes.map(p => transformar(p.malha, o.transform));
      if (opc.porPeca && mundo.length > 1) {
        mundo.forEach((m, i) => arquivos.push({ nome: nomeUnico(o.nome + '-' + o.partes[i].nome) + '.stl', dados: escreverSTL(m, o.partes[i].nome) }));
      } else {
        arquivos.push({ nome: nomeUnico(o.nome) + '.stl', dados: escreverSTL(mundo.length === 1 ? mundo[0] : juntar(mundo), o.nome) });
      }
    }
    if (arquivos.length === 1) return { bytes: arquivos[0].dados, nome: arquivos[0].nome, zip: false };
    return { bytes: escreverZip(arquivos.map(a => ({ nome: a.nome, dados: a.dados, nivel: 6 }))), zip: true, arquivos: arquivos.map(a => a.nome) };
  },

  // estrutura de pontaria (clique/pincel) no mesmo formato da tela: triângulo
  // t = vértices 3t..3t+2. Volta serializada; a tela só encaixa.
  bvh({ malha }) {
    const p = malha.pos, idx = malha.idx, nt = idx.length / 3;
    const pos = new Float32Array(nt * 9);
    for (let i = 0; i < nt * 3; i++) { const v = idx[i] * 3; pos[i * 3] = p[v]; pos[i * 3 + 1] = p[v + 1]; pos[i * 3 + 2] = p[v + 2]; }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const ind = nt * 3 > 65535 ? new Uint32Array(nt * 3) : new Uint16Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) ind[i] = i;
    g.setIndex(new BufferAttribute(ind, 1));
    const s = MeshBVH.serialize(new MeshBVH(g), { cloneBuffers: false });
    return { version: s.version, roots: s.roots, index: s.index };
  },

  medidas({ parte }) { return { volume: volume(parte.malha), caixa: caixa(parte.malha) }; },

  // vizinhança das faces (seleção/pincel) calculada fora da tela: peça de 1
  // milhão de triângulos não trava o primeiro clique
  adjacencia({ malha }) { return prepararAdjacencia(malha); },

  // teste de recuperação: simula a pane do WASM (o worker tem que subir de novo)
  _simularPane() { throw new WebAssembly.RuntimeError('memory access out of bounds'); }
};

export function executar(op, args) {
  const f = OPERACOES[op];
  if (!f) throw new Error('Operação desconhecida: ' + op);
  return f(args || {});
}

// arrays tipados do resultado (pra transferir sem copiar)
export function transferiveis(obj, lista = [], vistos = new Set()) {
  if (!obj || typeof obj !== 'object' || vistos.has(obj)) return lista;
  vistos.add(obj);
  if (ArrayBuffer.isView(obj)) { if (!vistos.has(obj.buffer) && obj.buffer.byteLength) { vistos.add(obj.buffer); lista.push(obj.buffer); } return lista; }
  if (obj instanceof ArrayBuffer) { lista.push(obj); return lista; }
  for (const k in obj) transferiveis(obj[k], lista, vistos);
  return lista;
}

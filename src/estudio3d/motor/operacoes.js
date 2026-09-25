// API única do motor. Tudo aqui recebe e devolve dados simples (arrays
// tipados), pra rodar igual no Web Worker, na thread principal e no Node.
import { importarArquivo } from '../core/importar.js';
import { validar, espessuras, facesInternas } from '../core/validador.js';
import { reparar as repararMalha } from '../core/reparo.js';
import { comContexto, manifold, temManifold } from '../core/solidos.js';
import { cortarPorPlano } from '../core/corte.js';
import { separarDetalhe, separarPorCor, separarCascas } from '../core/separar.js';
import { aplicarRelevo } from '../core/relevo.js';
import { segmentar } from '../core/segmentacao.js';
import { escrever3MF } from '../core/formatos/tmf.js';
import { escreverSTL } from '../core/formatos/stl.js';
import { escreverZip } from '../core/formatos/zip.js';
import { transformar, juntar, volume, caixa, semFaces, compactar } from '../core/malha.js';
import { gerarForma } from '../core/formas.js';
import { combinar, aplicarFuros, aplicarFurosNaCena } from '../core/modelagem.js';
import { fotosPara3D } from '../core/ia/reconstrucao.js';
import { BufferGeometry, BufferAttribute } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// operações cujo resultado não vai pra tela como peça
export const SEM_RENDER = new Set(['analisar', 'bvh', 'exportar3MF', 'exportarSTL', 'medidas']);

function resumoValidacao(v) {
  const r = Object.assign({}, v);
  delete r.infoComponentes;
  return r;
}

export const OPERACOES = {
  importar({ nome, bytes, extras }) { return importarArquivo(nome, bytes, extras || {}); },

  analisar({ parte, opc }) {
    const v = validar(parte.malha, opc || {});
    return resumoValidacao(v);
  },

  reparar({ parte, opc }) {
    opc = opc || {};
    const antes = resumoValidacao(validar(parte.malha, { completo: false }));
    const r = repararMalha(parte.malha, opc);
    let malha = r.malha, cor = parte.cor, paleta = parte.paleta;
    const passos = r.passos.slice();
    let solido = false;
    if (temManifold()) {
      try {
        comContexto(ctx => {
          const man = ctx.solido({ malha, cor, paleta: malha.cor ? paleta : null }, parte.nome);
          const p = ctx.parte(man, parte.nome, cor);
          malha = p.malha; cor = p.cor; paleta = p.paleta;
        });
        solido = true;
      } catch (e) { passos.push('ainda não é um sólido fechado: ' + e.message); }
    }
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

  cortar({ partes, plano, opc }) { return cortarPorPlano(partes, plano, opc || {}); },
  separarDetalhe({ parte, mascara, opc }) { return separarDetalhe(parte, mascara, opc || {}); },
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
  combinar({ objetos, modo, opc }) { return combinar(objetos, modo, opc || {}); },
  // fotos de várias vistas -> sólido fechado (silhuetas, sem IA, roda na CPU)
  // (etapa final do pipeline: o mesmo Consertar do editor)
  fotosPara3D({ entradas, opc }) {
    const r = fotosPara3D(entradas, opc || {});
    const rep = OPERACOES.reparar({ parte: { nome: r.nome, malha: r.malha, cor: r.cor, paleta: r.paleta }, opc: {} });
    return { ...r, malha: rep.parte.malha, cor: rep.parte.cor, paleta: rep.parte.paleta, relatorio: { ...r.relatorio, reparo: rep.passos, triangulos: rep.parte.malha.idx.length / 3 } };
  },
  // prévia ao vivo dos furos num objeto
  furar({ alvo, furos }) { return aplicarFuros(alvo, furos); },

  exportar3MF({ cena, opc }) {
    // furos entram na geometria de verdade; objeto-furo não vai pro arquivo
    cena = aplicarFurosNaCena(cena);
    const r = escrever3MF(cena, opc || {});
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

  medidas({ parte }) { return { volume: volume(parte.malha), caixa: caixa(parte.malha) }; }
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

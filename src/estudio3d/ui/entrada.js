// Entrada do bundle site/estudio3d.js. Expõe window.Estudio3D pro app.js.
import { Estudio } from './estudio.js';
import { Motor } from '../motor/cliente.js';
import { criar } from '../core/malha.js';
import * as M4 from '../core/mat4.js';
import { baixar, nomeArquivo } from './util.js';

/* global __VERSAO_ESTUDIO__ */
let estudio = null;
let motorAvulso = null;

function motor() {
  if (estudio) return estudio.motor;
  if (!motorAvulso) motorAvulso = new Motor();
  return motorAvulso;
}

window.Estudio3D = {
  versao: typeof __VERSAO_ESTUDIO__ !== 'undefined' ? __VERSAO_ESTUDIO__ : 'dev',
  montar(elemento) {
    if (estudio) {
      if (estudio.raiz !== elemento) { elemento.appendChild(estudio.raiz); }
      estudio.visor.redimensionar();
      return estudio;
    }
    const raiz = document.createElement('div');
    elemento.appendChild(raiz);
    estudio = new Estudio(raiz);
    return estudio;
  },
  get estudio() { return estudio; },

  // peças do gerador (triângulos soltos por peça) -> sólidos unidos no motor
  async pecasDoGerador(pecas) {
    const m = motor();
    const saida = [];
    for (const p of pecas) {
      const malha = criar(p.malha.pos, p.malha.idx);
      let parte = { nome: p.nome, malha, cor: p.cor };
      try {
        const r = await m.rodar('reparar', { parte, opc: { completo: false, taparBuracos: true } });
        parte = { nome: p.nome, malha: r.parte.malha, cor: p.cor };
        // fatias empilhadas (bolso da tag) viram um sólido só
        const u = await m.rodar('unirSobrepostos', { parte });
        parte = { nome: p.nome, malha: u.parte.malha, cor: p.cor };
      } catch (e) { console.warn('peça do gerador sem união:', e); }
      saida.push(parte);
    }
    return saida;
  },

  async abrirDoGerador(pecas, nome) {
    const partes = await this.pecasDoGerador(pecas);
    const e = estudio;
    if (!e) throw new Error('Estúdio não montado.');
    e.adicionarObjetos([{ nome: nome || 'Chaveiro', transform: M4.identidade(), partes }], { rotulo: 'Abrir do gerador', centralizar: true });
    return e;
  },

  // 3MF do gerador com a cor certa pro Bambu (colorgroup + sólidos unidos)
  async exportar3MFGerador(pecas, nome) {
    const partes = await this.pecasDoGerador(pecas);
    const r = await motor().rodar('exportar3MF', { cena: { objetos: [{ nome: nome || 'peca', transform: M4.translacao(0, 0, 0), partes }] }, opc: { titulo: nome } });
    baixar(r.bytes, nomeArquivo(nome, 'peca') + '.3mf', 'model/3mf');
    return r;
  },
  async exportarSTLGerador(pecas, nome, separado) {
    const partes = await this.pecasDoGerador(pecas);
    const objetos = separado ? partes.map(p => ({ nome: (nome || 'peca') + '-' + p.nome, transform: M4.identidade(), partes: [p] })) : [{ nome: nome || 'peca', transform: M4.identidade(), partes }];
    const r = await motor().rodar('exportarSTL', { cena: { objetos }, opc: {} });
    if (r.zip) baixar(r.bytes, nomeArquivo(nome, 'peca') + '-stl.zip', 'application/zip');
    else baixar(r.bytes, nomeArquivo(nome, 'peca') + '.stl', 'model/stl');
    return r;
  }
};

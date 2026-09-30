// Entrada do bundle site/estudio3d.js. Expõe window.Estudio3D pro app.js.
import { Estudio } from './estudio.js';
import { Gerador } from './gerador.js';
import { Motor } from '../motor/cliente.js';
import { pecasDoGerador } from '../core/pecasGerador.js';
import * as M4 from '../core/mat4.js';
import { baixar, nomeArquivo } from './util.js';

/* global __VERSAO_ESTUDIO__ */
let estudio = null;
let gerador = null;
let motorComum = null;

// um motor só (dois workers) pro Estúdio, pro gerador e pras exportações
function motor() {
  if (!motorComum) motorComum = new Motor();
  return motorComum;
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
    estudio = new Estudio(raiz, { motor: motor() });
    return estudio;
  },
  get estudio() { return estudio; },

  // gerador de chaveiro (mesma casca/visor do Estúdio)
  montarGerador(elemento) {
    if (gerador) {
      if (gerador.raiz.parentNode !== elemento) elemento.appendChild(gerador.raiz);
      gerador.redimensionar();
      return gerador;
    }
    const raiz = document.createElement('div');
    elemento.appendChild(raiz);
    gerador = new Gerador(raiz, motor());
    return gerador;
  },
  get gerador() { return gerador; },

  // peças do gerador (triângulos soltos por peça) -> sólidos unidos no motor
  async pecasDoGerador(pecas) {
    const m = motor();
    return pecasDoGerador(pecas, (op, a) => m.rodar(op, a), msg => console.warn(msg));
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

// Web Worker do motor geométrico. Criado a partir de Blob (funciona até
// abrindo o index.html com dois cliques). O WASM do Manifold chega pela 1ª
// mensagem, já em bytes — nada é baixado aqui dentro.
import Module from 'manifold-3d';
import { definirManifold } from '../core/solidos.js';
import { executar, transferiveis } from './operacoes.js';

let pronto = null;

self.onmessage = async ev => {
  const msg = ev.data || {};
  if (msg.tipo === 'iniciar') {
    try {
      pronto = Module({ wasmBinary: msg.wasm, locateFile: () => 'manifold.wasm', print: () => {}, printErr: () => {} })
        .then(w => { w.setup(); definirManifold(w); });
      await pronto;
      self.postMessage({ tipo: 'pronto' });
    } catch (e) {
      self.postMessage({ tipo: 'falhou', erro: String(e && e.message || e) });
    }
    return;
  }
  const { id, op, args } = msg;
  try {
    if (pronto) await pronto;
    const t0 = Date.now();
    const resultado = executar(op, args);
    self.postMessage({ id, ok: true, resultado, ms: Date.now() - t0 }, transferiveis(resultado));
  } catch (e) {
    self.postMessage({ id, ok: false, erro: String(e && e.message || e), codigo: e && e.codigo });
  }
};

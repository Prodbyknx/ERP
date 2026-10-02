// Web Worker do motor geométrico. Criado a partir de Blob (funciona até
// abrindo o index.html com dois cliques). O WASM do Manifold chega pela 1ª
// mensagem, já em bytes — nada é baixado aqui dentro.
import Module from 'manifold-3d';
import { definirManifold, ehErroWasm } from '../core/solidos.js';
import { executar, transferiveis, SEM_RENDER } from './operacoes.js';
import { prepararRender, malhasDe } from '../core/render.js';
import { definirProgresso } from '../core/progresso.js';

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
    // operação longa avisa quanto falta (a tela mostra %)
    definirProgresso((f, etapa) => self.postMessage({ id, tipo: 'progresso', f, etapa }));
    let resultado;
    try { resultado = executar(op, args); } finally { definirProgresso(null); }
    // malhas novas já voltam prontas pra exibir: a tela só entrega pra placa de vídeo
    if (!SEM_RENDER.has(op)) for (const m of malhasDe(resultado)) m._r = prepararRender(m);
    self.postMessage({ id, ok: true, resultado, ms: Date.now() - t0 }, transferiveis(resultado));
  } catch (e) {
    // pane no WASM: a tela reinicia este worker (o módulo pode ter ficado
    // corrompido); a peça não mudou — a operação só aplica quando dá certo
    if (ehErroWasm(e)) { self.postMessage({ id, ok: false, codigo: 'wasm', reiniciar: true, erro: 'O motor 3D teve uma pane interna nessa operação e foi reiniciado. Nada mudou na peça — tente de novo com outro ajuste (ex.: espessura, posição) ou use "Consertar automaticamente" (painel Consertar) antes.' }); return; }
    self.postMessage({ id, ok: false, erro: String(e && e.message || e), codigo: e && e.codigo, pilha: e && e.stack ? String(e.stack).slice(0, 2000) : null });
  }
};

// Cliente do motor na thread principal. Tenta o Web Worker (interface não
// trava); se o navegador não deixar, roda aqui mesmo com o mesmo código.
import Module from 'manifold-3d';
import { definirManifold } from '../core/solidos.js';
import { executar } from './operacoes.js';

/* global __WORKER_CODIGO__, __MANIFOLD_WASM__ */

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

let wasmBytes = null;
const bytesWasm = () => wasmBytes || (wasmBytes = base64ParaBytes(__MANIFOLD_WASM__));

// cópia dos arrays que vão pro worker (a cena na tela continua com os originais)
function copiarArrays(obj, lista) {
  if (!obj || typeof obj !== 'object') return obj;
  if (ArrayBuffer.isView(obj)) { const c = obj.slice(); lista.push(c.buffer); return c; }
  if (obj instanceof ArrayBuffer) { const c = obj.slice(0); lista.push(c); return c; }
  if (Array.isArray(obj)) return obj.map(x => copiarArrays(x, lista));
  const o = {};
  for (const k in obj) o[k] = copiarArrays(obj[k], lista);
  return o;
}

export class Motor {
  constructor() {
    this.worker = null;
    this.local = false;
    this.fila = new Map();
    this.seq = 0;
    this.pronto = null;
    this.ocupado = 0;
    this.aoMudar = null;
  }

  iniciar() {
    if (this.pronto) return this.pronto;
    this.pronto = new Promise(resolve => {
      let terminou = false;
      const usarLocal = motivo => {
        if (terminou) return;
        terminou = true;
        this.local = true;
        this.motivoLocal = motivo;
        if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ok */ } this.worker = null; }
        Module({ wasmBinary: bytesWasm(), locateFile: () => 'manifold.wasm' }).then(w => { w.setup(); definirManifold(w); resolve('local'); });
      };
      try {
        const url = URL.createObjectURL(new Blob([__WORKER_CODIGO__], { type: 'text/javascript' }));
        const w = new Worker(url);
        this.worker = w;
        const limite = setTimeout(() => usarLocal('o worker não respondeu'), 20000);
        w.onmessage = ev => {
          const m = ev.data;
          if (m.tipo === 'pronto') { clearTimeout(limite); terminou = true; resolve('worker'); return; }
          if (m.tipo === 'falhou') { clearTimeout(limite); usarLocal(m.erro); return; }
          const p = this.fila.get(m.id);
          if (!p) return;
          this.fila.delete(m.id);
          this._fim();
          if (m.ok) p.resolve(m.resultado); else { const e = new Error(m.erro); e.codigo = m.codigo; p.reject(e); }
        };
        w.onerror = ev => { clearTimeout(limite); ev.preventDefault && ev.preventDefault(); usarLocal('erro no worker: ' + (ev.message || '')); };
        const wasm = bytesWasm().slice();
        w.postMessage({ tipo: 'iniciar', wasm: wasm.buffer }, [wasm.buffer]);
      } catch (e) {
        usarLocal(String(e && e.message || e));
      }
    });
    return this.pronto;
  }

  _inicio() { this.ocupado++; if (this.aoMudar) this.aoMudar(this.ocupado); }
  _fim() { this.ocupado = Math.max(0, this.ocupado - 1); if (this.aoMudar) this.aoMudar(this.ocupado); }

  async rodar(op, args) {
    await this.iniciar();
    this._inicio();
    if (this.local) {
      // deixa a tela pintar o "calculando..." antes de travar
      await new Promise(r => setTimeout(r, 30));
      try { return executar(op, copiarArrays(args, [])); }
      finally { this._fim(); }
    }
    const id = ++this.seq;
    const lista = [];
    const copia = copiarArrays(args, lista);
    return new Promise((resolve, reject) => {
      this.fila.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, args: copia }, lista);
    });
  }
}

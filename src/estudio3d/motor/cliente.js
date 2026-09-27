// Cliente do motor na thread principal. Dois Web Workers:
//   principal  as operações que você pede (cortar, separar, reparar, exportar…)
//   aux        o que roda por trás sem te fazer esperar (análise automática,
//              estrutura de pontaria/BVH). Assim um corte nunca fica na fila
//              atrás da análise do arquivo que acabou de abrir.
// Se o navegador não deixar criar worker, roda tudo aqui mesmo (mais lento,
// com a tela parando durante o cálculo).
import Module from 'manifold-3d';
import { definirManifold } from '../core/solidos.js';
import { executar } from './operacoes.js';
import { malhasDe } from '../core/render.js';
import { cacheRender } from '../ui/cacheRender.js';

/* global __WORKER_CODIGO__, __MANIFOLD_WASM__ */

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

let wasmBytes = null;
const bytesWasm = () => wasmBytes || (wasmBytes = base64ParaBytes(__MANIFOLD_WASM__));

// operações que vão pro worker auxiliar
const OPS_AUX = new Set(['analisar', 'bvh']);

// cópia dos arrays que vão pro worker (a cena na tela continua com os
// originais). Campos que começam com "_" são da tela e não viajam.
function copiarArrays(obj, lista) {
  if (!obj || typeof obj !== 'object') return obj;
  if (ArrayBuffer.isView(obj)) { const c = obj.slice(); lista.push(c.buffer); return c; }
  if (obj instanceof ArrayBuffer) { const c = obj.slice(0); lista.push(c); return c; }
  if (Array.isArray(obj)) return obj.map(x => copiarArrays(x, lista));
  const o = {};
  for (const k in obj) if (k[0] !== '_') o[k] = copiarArrays(obj[k], lista);
  return o;
}

// dados de exibição que o worker já calculou vão pro cache da tela
function recolherRender(resultado) {
  for (const m of malhasDe(resultado)) {
    if (m._r) { cacheRender.guardar(m, m._r); delete m._r; }
  }
  return resultado;
}

class Canal {
  constructor(nome, motor) { this.nome = nome; this.motor = motor; this.worker = null; this.fila = new Map(); }
  get ocupado() { return this.fila.size; }
  // o worker faz uma coisa por vez, na ordem: a primeira da fila é a que está rodando
  get atual() { const p = this.fila.values().next().value; return p ? { op: p.op, desde: p.desde } : null; }
  iniciar(url) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(url); } catch (e) { reject(e); return; }
      this.worker = w;
      let ok = false;
      const limite = setTimeout(() => { if (!ok) reject(new Error('o worker não respondeu')); }, 20000);
      w.onmessage = ev => {
        const m = ev.data;
        if (m.tipo === 'pronto') { ok = true; clearTimeout(limite); resolve(); return; }
        if (m.tipo === 'falhou') { clearTimeout(limite); reject(new Error(m.erro)); return; }
        if (m.tipo === 'progresso') { if (this.fila.has(m.id) && this.motor.aoProgresso) this.motor.aoProgresso(m.f, m.etapa, this); return; }
        const p = this.fila.get(m.id);
        if (!p) return;
        this.fila.delete(m.id);
        const prox = this.fila.values().next().value;
        if (prox) prox.desde = performance.now();
        this.motor.avisar(this);
        if (m.ok) p.resolve(recolherRender(m.resultado)); else { const e = new Error(m.erro); e.codigo = m.codigo; p.reject(e); }
      };
      w.onerror = ev => { clearTimeout(limite); ev.preventDefault && ev.preventDefault(); if (!ok) reject(new Error('erro no worker: ' + (ev.message || ''))); };
      const wasm = bytesWasm().slice();
      w.postMessage({ tipo: 'iniciar', wasm: wasm.buffer }, [wasm.buffer]);
    });
  }
  enviar(op, args) {
    const id = ++this.motor.seq;
    const lista = [];
    const copia = copiarArrays(args, lista);
    return new Promise((resolve, reject) => {
      this.fila.set(id, { resolve, reject, op, desde: performance.now() });
      this.motor.avisar(this);
      this.worker.postMessage({ id, op, args: copia }, lista);
    });
  }
  derrubar(motivo) {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ok */ } }
    this.worker = null;
    for (const [, p] of this.fila) { const e = new Error(motivo || 'Cancelado.'); e.codigo = 'cancelado'; p.reject(e); }
    this.fila.clear();
    this.motor.avisar(this);
  }
}

export class Motor {
  constructor() {
    this.local = false;
    this.seq = 0;
    this.pronto = null;
    this.aoMudar = null;        // (ocupadoPrincipal, info) -> tela
    this.aoMudarAux = null;     // (ocupadoAux) -> tela
    this.aoProgresso = null;    // (fração, etapa, canal) -> tela
    this.principal = new Canal('principal', this);
    this.aux = new Canal('aux', this);
    this.url = null;
  }

  get ocupado() { return this.local ? (this._ocupadoLocal || 0) : this.principal.ocupado; }

  avisar(canal) {
    if (canal === this.aux) { if (this.aoMudarAux) this.aoMudarAux(this.aux.ocupado); return; }
    if (this.aoMudar) this.aoMudar(this.ocupado, canal.atual);
  }

  iniciar() {
    if (this.pronto) return this.pronto;
    this.pronto = (async () => {
      try {
        this.url = URL.createObjectURL(new Blob([__WORKER_CODIGO__], { type: 'text/javascript' }));
        await this.principal.iniciar(this.url);
      } catch (e) {
        return this.usarLocal(String(e && e.message || e));
      }
      // o auxiliar é bônus: se não subir, tudo vai pro principal
      this.auxPronto = this.aux.iniciar(this.url).then(() => true, () => { this.aux.derrubar(); return false; });
      return 'worker';
    })();
    return this.pronto;
  }

  async usarLocal(motivo) {
    this.local = true;
    this.motivoLocal = motivo;
    this.principal.derrubar(motivo);
    const w = await Module({ wasmBinary: bytesWasm(), locateFile: () => 'manifold.wasm' });
    w.setup(); definirManifold(w);
    return 'local';
  }

  async rodar(op, args, opc = {}) {
    await this.iniciar();
    if (this.local) {
      this._ocupadoLocal = (this._ocupadoLocal || 0) + 1;
      if (this.aoMudar) this.aoMudar(this._ocupadoLocal, { op, desde: performance.now() });
      // deixa a tela pintar o "calculando..." antes de travar
      await new Promise(r => setTimeout(r, 30));
      try { return executar(op, copiarArrays(args, [])); }
      finally { this._ocupadoLocal--; if (this.aoMudar) this.aoMudar(this._ocupadoLocal, null); }
    }
    let canal = this.principal;
    if ((opc.canal === 'aux' || (opc.canal == null && OPS_AUX.has(op))) && this.auxPronto && await this.auxPronto) canal = this.aux;
    if (!canal.worker) await this.reiniciarPrincipal();
    return canal.enviar(op, args);
  }

  // Botão "Cancelar": derruba o cálculo em andamento e sobe o motor de novo
  async cancelar() {
    if (this.local || !this.principal.ocupado) return false;
    this.principal.derrubar('Cancelado.');
    await this.reiniciarPrincipal();
    return true;
  }
  async reiniciarPrincipal() {
    if (this._reiniciando) return this._reiniciando;
    this._reiniciando = this.principal.iniciar(this.url).finally(() => { this._reiniciando = null; });
    return this._reiniciando;
  }
}

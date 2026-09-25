// SceneManager + TransformManager + histórico (desfazer/refazer).
// A geometria é imutável: toda operação cria malha nova, então o histórico
// guarda só referências (barato) e desfazer é trocar o estado inteiro.
import * as M4 from '../core/mat4.js';
import { caixa, juntarCaixas } from '../core/malha.js';
import { normalizarHex, COR_PADRAO, PALETA_PECAS } from '../core/cores.js';

let seq = 1;

// A malha é imutável: o que se calcula dela uma vez vale pra sempre.
const cacheUsados = new WeakMap();     // malha -> Float64Array só com os vértices usados
const cacheCaixa = new WeakMap();      // malha -> caixa local
const cacheExata = new WeakMap();      // malha -> Map(transform -> caixa no mundo)
function verticesUsados(m) {
  let u = cacheUsados.get(m);
  if (u) return u;
  const pos = m.pos, idx = m.idx, nv = pos.length / 3;
  const marca = new Uint8Array(nv);
  let n = 0;
  for (let i = 0; i < idx.length; i++) if (!marca[idx[i]]) { marca[idx[i]] = 1; n++; }
  u = new Float64Array(n * 3);
  for (let v = 0, k = 0; v < nv; v++) if (marca[v]) { u[k++] = pos[v * 3]; u[k++] = pos[v * 3 + 1]; u[k++] = pos[v * 3 + 2]; }
  cacheUsados.set(m, u);
  return u;
}
function caixaLocal(m) { let c = cacheCaixa.get(m); if (!c) { c = caixa(m); cacheCaixa.set(m, c); } return c; }
function caixaExataParte(m, t) {
  let mapa = cacheExata.get(m);
  if (!mapa) { mapa = new Map(); cacheExata.set(m, mapa); }
  const chave = Array.prototype.join.call(t, ',');
  let c = mapa.get(chave);
  if (c !== undefined) return c;
  const u = verticesUsados(m);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < u.length; i += 3) {
    const x = u[i], y = u[i + 1], z = u[i + 2];
    const X = t[0] * x + t[4] * y + t[8] * z + t[12], Y = t[1] * x + t[5] * y + t[9] * z + t[13], Z = t[2] * x + t[6] * y + t[10] * z + t[14];
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
  }
  c = isFinite(x0) ? [x0, y0, z0, x1, y1, z1] : null;
  if (mapa.size > 6) mapa.delete(mapa.keys().next().value);
  mapa.set(chave, c);
  return c;
}
export const novoId = p => (p || 'x') + (seq++) + '_' + Math.random().toString(36).slice(2, 6);

export function novaParte(p) {
  return {
    id: p.id || novoId('p'), nome: p.nome || 'Peça',
    malha: p.malha, cor: normalizarHex(p.cor) || COR_PADRAO, paleta: p.paleta || null,
    visivel: p.visivel !== false
  };
}

export function novoObjeto(o) {
  return {
    id: o.id || novoId('o'), nome: o.nome || 'Objeto',
    transform: o.transform ? Float64Array.from(o.transform) : M4.identidade(),
    partes: (o.partes || []).map(novaParte),
    visivel: o.visivel !== false
  };
}

export class Cena {
  constructor() {
    this.objetos = [];
    this.pilhaDesfazer = [];
    this.pilhaRefazer = [];
    this.ouvintes = new Map();
    this.sel = { objeto: null, parte: null };
    this.mesa = { x: 256, y: 256 };            // Bambu A1 / P1 / X1
    this.limite = 40;
  }
  on(ev, fn) { if (!this.ouvintes.has(ev)) this.ouvintes.set(ev, new Set()); this.ouvintes.get(ev).add(fn); }
  emitir(ev, dado) { (this.ouvintes.get(ev) || []).forEach(fn => { try { fn(dado); } catch (e) { console.error(e); } }); }

  instantaneo() {
    return this.objetos.map(o => ({ ...o, transform: Float64Array.from(o.transform), partes: o.partes.map(p => ({ ...p })) }));
  }
  // toda mudança passa por aqui: guarda o antes e avisa a tela
  aplicar(rotulo, fn) {
    const antes = this.instantaneo();
    const selAntes = { ...this.sel };
    const r = fn();
    this.pilhaDesfazer.push({ rotulo, estado: antes, sel: selAntes });
    if (this.pilhaDesfazer.length > this.limite) this.pilhaDesfazer.shift();
    this.pilhaRefazer = [];
    this.conferirSelecao();
    this.emitir('mudou', { rotulo });
    return r;
  }
  podeDesfazer() { return this.pilhaDesfazer.length > 0; }
  podeRefazer() { return this.pilhaRefazer.length > 0; }
  desfazer() {
    const u = this.pilhaDesfazer.pop();
    if (!u) return null;
    this.pilhaRefazer.push({ rotulo: u.rotulo, estado: this.instantaneo(), sel: { ...this.sel } });
    this.objetos = u.estado; this.sel = u.sel;
    this.conferirSelecao();
    this.emitir('mudou', { rotulo: u.rotulo, desfeito: true });
    return u.rotulo;
  }
  refazer() {
    const r = this.pilhaRefazer.pop();
    if (!r) return null;
    this.pilhaDesfazer.push({ rotulo: r.rotulo, estado: this.instantaneo(), sel: { ...this.sel } });
    this.objetos = r.estado; this.sel = r.sel;
    this.conferirSelecao();
    this.emitir('mudou', { rotulo: r.rotulo, refeito: true });
    return r.rotulo;
  }
  proximoDesfazer() { const u = this.pilhaDesfazer[this.pilhaDesfazer.length - 1]; return u ? u.rotulo : null; }
  proximoRefazer() { const u = this.pilhaRefazer[this.pilhaRefazer.length - 1]; return u ? u.rotulo : null; }

  conferirSelecao() {
    const o = this.objeto(this.sel.objeto);
    if (!o) { this.sel = { objeto: this.objetos.length ? null : null, parte: null }; return; }
    if (!o.partes.some(p => p.id === this.sel.parte)) this.sel.parte = o.partes.length === 1 ? o.partes[0].id : null;
  }
  selecionar(objId, parteId) {
    this.sel = { objeto: objId || null, parte: parteId || null };
    this.conferirSelecao();
    this.emitir('selecao', this.sel);
  }
  objeto(id) { return this.objetos.find(o => o.id === id) || null; }
  parte(objId, parteId) { const o = this.objeto(objId); return o ? o.partes.find(p => p.id === parteId) || null : null; }
  objetoSel() { return this.objeto(this.sel.objeto); }
  parteSel() {
    const o = this.objetoSel();
    if (!o) return null;
    return o.partes.find(p => p.id === this.sel.parte) || (o.partes.length === 1 ? o.partes[0] : null);
  }

  // caixa de um objeto no MUNDO (com a transformação)
  caixaObjeto(o) {
    let cx = null;
    for (const p of o.partes) {
      if (!p.malha || !p.malha.idx.length) continue;
      const c = caixaLocal(p.malha);
      for (let i = 0; i < 8; i++) {
        const q = M4.aplicarPonto(o.transform, i & 1 ? c.max[0] : c.min[0], i & 2 ? c.max[1] : c.min[1], i & 4 ? c.max[2] : c.min[2]);
        cx = juntarCaixas(cx, { min: q, max: q, tam: [0, 0, 0] });
      }
    }
    return cx;
  }
  // caixa exata (vértices transformados) — pra "colocar na mesa" sem erro de
  // rotação. Guardada por malha + posição: clicar/selecionar não recalcula.
  caixaExata(o) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const p of o.partes) {
      if (!p.malha || !p.malha.idx.length) continue;
      const c = caixaExataParte(p.malha, o.transform);
      if (!c) continue;
      if (c[0] < x0) x0 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[2] < z0) z0 = c[2];
      if (c[3] > x1) x1 = c[3]; if (c[4] > y1) y1 = c[4]; if (c[5] > z1) z1 = c[5];
    }
    if (!isFinite(x0)) return null;
    return { min: [x0, y0, z0], max: [x1, y1, z1], tam: [x1 - x0, y1 - y0, z1 - z0] };
  }
  caixaCena() {
    let cx = null;
    for (const o of this.objetos) if (o.visivel) cx = juntarCaixas(cx, this.caixaObjeto(o));
    return cx;
  }

  // --- TransformManager: tudo não destrutivo (mexe só na matriz) ---
  colocarNaMesa(o) {
    const c = this.caixaExata(o);
    if (!c) return;
    o.transform = M4.multiplicar(M4.translacao(0, 0, -c.min[2]), o.transform);
  }
  centralizar(o) {
    const c = this.caixaExata(o);
    if (!c) return;
    const dx = this.mesa.x / 2 - (c.min[0] + c.max[0]) / 2, dy = this.mesa.y / 2 - (c.min[1] + c.max[1]) / 2;
    o.transform = M4.multiplicar(M4.translacao(dx, dy, -c.min[2]), o.transform);
  }
  // Organiza os objetos lado a lado na mesa (prateleiras), sem sobrepor.
  organizarMesa(espaco = 6) {
    const itens = this.objetos.filter(o => o.visivel).map(o => {
      this.colocarNaMesa(o);
      const c = this.caixaExata(o);
      return { o, c, w: c.tam[0], h: c.tam[1] };
    }).sort((a, b) => b.h - a.h);
    let x = espaco, y = espaco, alturaLinha = 0;
    for (const it of itens) {
      if (x + it.w > this.mesa.x - espaco && x > espaco) { x = espaco; y += alturaLinha + espaco; alturaLinha = 0; }
      const dx = x - it.c.min[0], dy = y - it.c.min[1];
      it.o.transform = M4.multiplicar(M4.translacao(dx, dy, 0), it.o.transform);
      x += it.w + espaco;
      alturaLinha = Math.max(alturaLinha, it.h);
    }
    return y + alturaLinha <= this.mesa.y;
  }

  proximaCor() {
    const usadas = new Set();
    for (const o of this.objetos) for (const p of o.partes) usadas.add(p.cor);
    return PALETA_PECAS.find(c => !usadas.has(c)) || PALETA_PECAS[this.objetos.length % PALETA_PECAS.length];
  }
}

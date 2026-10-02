// SceneManager + TransformManager + histórico (desfazer/refazer).
// A geometria é imutável: toda operação cria malha nova, então o histórico
// guarda só referências (barato) e desfazer é trocar o estado inteiro.
import * as M4 from '../core/mat4.js';
import { caixa, juntarCaixas, transformar } from '../core/malha.js';
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
    visivel: o.visivel !== false,
    papel: o.papel === 'furo' ? 'furo' : 'solido',     // furo tira material de quem ele atravessa
    forma: o.forma || null,                             // { id, params, texto? } quando veio da biblioteca
    esticado: o.esticado ? Float64Array.from(o.esticado) : undefined,   // escala que já foi pra malha (só pra mostrar %)
    desenho: o.desenho || undefined,                    // peça feita no Desenhar: pontos pra editar depois
    operacoes: o.forma && o.operacoes ? o.operacoes : undefined   // Modificar feitos na forma (refeitos ao mudar medida)
  };
}

export class Cena {
  constructor() {
    this.objetos = [];
    this.pilhaDesfazer = [];
    this.pilhaRefazer = [];
    this.ouvintes = new Map();
    this.sel = { objeto: null, parte: null };
    this.multi = [];                           // seleção múltipla (Shift+clique); a principal é sel.objeto
    this.mesa = { x: 256, y: 256 };            // Bambu A1 / P1 / X1
    this.limite = 40;
    // além dos 40 passos, um teto de MEMÓRIA: cada passo guarda a malha inteira
    // de antes (≈90 MB por conserto num modelo de 3,7 M triângulos). Passou do
    // teto, os passos mais antigos saem (auditoria A4: a aba caía)
    this.limiteBytes = 400 * 1024 * 1024;
    // PLACAS: mesma grade do Bambu Studio (colunas = ⌈√n⌉, passo = 1,2 × a
    // mesa, linhas descendo em −Y). A peça é da placa onde está o centro dela.
    this.placas = 1;
    this.placaAtiva = 0;
  }

  /* ------------------------------------------------------------ placas */
  static colunas(n) { const v = Math.sqrt(n), r = Math.round(v); return v > r ? r + 1 : r; }
  origemPlaca(k, n = this.placas) {
    const c = Cena.colunas(n), lin = Math.floor(k / c), col = k % c;
    return [col * this.mesa.x * 1.2, -lin * this.mesa.y * 1.2];
  }
  centroPlaca(k = this.placaAtiva) { const o = this.origemPlaca(k); return [o[0] + this.mesa.x / 2, o[1] + this.mesa.y / 2]; }
  placaDoPonto(x, y, n = this.placas) {
    for (let k = 0; k < n; k++) {
      const o = this.origemPlaca(k, n);
      if (x >= o[0] - 1e-6 && x <= o[0] + this.mesa.x + 1e-6 && y >= o[1] - 1e-6 && y <= o[1] + this.mesa.y + 1e-6) return k;
    }
    return -1;
  }
  placaDe(o, n = this.placas) {
    const c = this.caixaExata(o);
    return c ? this.placaDoPonto((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, n) : -1;
  }
  objetosDaPlaca(k) { return this.objetos.filter(o => this.placaDe(o) === k); }
  // muda o número de placas; a grade pode mudar de colunas: cada peça vai
  // junto com a sua placa (mesmo lugar dentro dela)
  definirPlacas(n) {
    n = Math.max(1, Math.round(n));
    const antes = this.placas;
    if (n === antes) return;
    const onde = this.objetos.map(o => this.placaDe(o, antes));
    this.objetos.forEach((o, i) => {
      const k = onde[i];
      if (k < 0 || k >= n) return;
      const a = this.origemPlaca(k, antes), b = this.origemPlaca(k, n);
      if (a[0] !== b[0] || a[1] !== b[1]) o.transform = M4.multiplicar(M4.translacao(b[0] - a[0], b[1] - a[1], 0), o.transform);
    });
    this.placas = n;
    this.placaAtiva = Math.min(this.placaAtiva, n - 1);
  }
  adicionarPlaca() { this.definirPlacas(this.placas + 1); this.placaAtiva = this.placas - 1; }
  // tira a placa k (só vazia); as de depois andam uma casa
  removerPlaca(k) {
    if (this.placas <= 1 || this.objetosDaPlaca(k).length) return false;
    const n = this.placas, onde = this.objetos.map(o => this.placaDe(o, n));
    this.objetos.forEach((o, i) => {
      const j = onde[i];
      if (j < 0) return;
      const nj = j > k ? j - 1 : j, a = this.origemPlaca(j, n), b = this.origemPlaca(nj, n - 1);
      if (a[0] !== b[0] || a[1] !== b[1]) o.transform = M4.multiplicar(M4.translacao(b[0] - a[0], b[1] - a[1], 0), o.transform);
    });
    this.placas = n - 1;
    this.placaAtiva = Math.min(this.placaAtiva > k ? this.placaAtiva - 1 : this.placaAtiva, this.placas - 1);
    return true;
  }
  // leva a peça pra placa k, no mesmo lugar dentro dela
  moverParaPlaca(o, k) {
    const j = this.placaDe(o);
    if (k >= this.placas) this.definirPlacas(k + 1);
    const c = this.caixaExata(o);
    if (!c) return;
    const b = this.origemPlaca(k);
    if (j < 0) { const cc = this.centroPlaca(k); o.transform = M4.multiplicar(M4.translacao(cc[0] - (c.min[0] + c.max[0]) / 2, cc[1] - (c.min[1] + c.max[1]) / 2, 0), o.transform); return; }
    const a = this.origemPlaca(j);
    o.transform = M4.multiplicar(M4.translacao(b[0] - a[0], b[1] - a[1], 0), o.transform);
  }
  on(ev, fn) { if (!this.ouvintes.has(ev)) this.ouvintes.set(ev, new Set()); this.ouvintes.get(ev).add(fn); }
  emitir(ev, dado) { (this.ouvintes.get(ev) || []).forEach(fn => { try { fn(dado); } catch (e) { console.error(e); } }); }

  instantaneo() {
    return this.objetos.map(o => ({ ...o, transform: Float64Array.from(o.transform), partes: o.partes.map(p => ({ ...p })) }));
  }
  // toda mudança passa por aqui: guarda o antes e avisa a tela
  aplicar(rotulo, fn) {
    const antes = this.instantaneo();
    const selAntes = { ...this.sel, multi: this.multi.slice() };
    const placasAntes = { n: this.placas, ativa: this.placaAtiva };
    let r;
    try { r = fn(); this.fixarEsticar(); }
    catch (e) {
      // deu erro no meio: volta a cena inteira pro estado de antes (nada pela metade)
      this.objetos = antes; this.restaurarSel(selAntes);
      this.placas = placasAntes.n; this.placaAtiva = placasAntes.ativa;
      this.conferirSelecao();
      this.emitir('mudou', { rotulo, falhou: true });
      throw e;
    }
    this.pilhaDesfazer.push({ rotulo, estado: antes, sel: selAntes, placas: placasAntes });
    if (this.pilhaDesfazer.length > this.limite) this.pilhaDesfazer.shift();
    this.pilhaRefazer = [];
    this.podarHistorico();
    this.conferirSelecao();
    this.emitir('mudou', { rotulo });
    return r;
  }
  // A escala não fica na matriz: vai pra malha (a peça no mundo não muda).
  // Assim toda medida em mm das ferramentas vale na peça de verdade — pino
  // Ø5 numa peça escalada a 50% continua Ø5. Girar/espelhar/mover ficam na
  // matriz. 'esticado' guarda o total, pro painel mostrar a escala em %.
  fixarEsticar() {
    for (const o of this.objetos) {
      const sep = M4.separarEsticar(o.transform);
      if (!sep) continue;
      const S = sep.esticar;
      for (const p of o.partes) p.malha = transformar(p.malha, S);
      o.transform = sep.rigida;
      o.esticado = M4.multiplicar(S, o.esticado || M4.identidade());
      if (M4.ehIdentidade(o.esticado, 1e-9)) o.esticado = undefined;
      if (o.forma) {
        // escalas seguidas viram uma só; se voltou ao tamanho original, some
        const ops = (o.operacoes || []).slice(), ult = ops[ops.length - 1];
        const m = ult && ult.tipo === 'esticar' ? M4.multiplicar(S, Float64Array.from(ult.m)) : S;
        if (ult && ult.tipo === 'esticar') ops.pop();
        if (!M4.ehIdentidade(m, 1e-9)) ops.push({ tipo: 'esticar', m: Array.from(m) });
        o.operacoes = ops.length ? ops : undefined;
      }
    }
  }
  // bytes das malhas que SÓ o histórico segura (as da cena atual não contam)
  bytesHistorico() {
    const atuais = new Set();
    for (const o of this.objetos) for (const p of o.partes) atuais.add(p.malha);
    const vistas = new Set();
    let total = 0;
    const contar = estado => {
      for (const o of estado) for (const p of o.partes) {
        const m = p.malha;
        if (!m || atuais.has(m) || vistas.has(m)) continue;
        vistas.add(m);
        total += m.pos.byteLength + m.idx.byteLength + (m.cor ? m.cor.byteLength : 0);
      }
    };
    for (const u of this.pilhaDesfazer) contar(u.estado);
    for (const u of this.pilhaRefazer) contar(u.estado);
    return total;
  }
  // passou do teto: tira os passos mais antigos (sempre fica pelo menos 1)
  podarHistorico() {
    let tirou = 0;
    while (this.pilhaDesfazer.length > 1 && this.bytesHistorico() > this.limiteBytes) { this.pilhaDesfazer.shift(); tirou++; }
    if (tirou) this.emitir('historico-podado', { tirou, resta: this.pilhaDesfazer.length });
    return tirou;
  }
  podeDesfazer() { return this.pilhaDesfazer.length > 0; }
  podeRefazer() { return this.pilhaRefazer.length > 0; }
  desfazer() {
    const u = this.pilhaDesfazer.pop();
    if (!u) return null;
    this.pilhaRefazer.push({ rotulo: u.rotulo, estado: this.instantaneo(), sel: { ...this.sel, multi: this.multi.slice() }, placas: { n: this.placas, ativa: this.placaAtiva } });
    this.objetos = u.estado; this.restaurarSel(u.sel);
    if (u.placas) { this.placas = u.placas.n; this.placaAtiva = u.placas.ativa; }
    this.conferirSelecao();
    this.emitir('mudou', { rotulo: u.rotulo, desfeito: true });
    return u.rotulo;
  }
  refazer() {
    const r = this.pilhaRefazer.pop();
    if (!r) return null;
    this.pilhaDesfazer.push({ rotulo: r.rotulo, estado: this.instantaneo(), sel: { ...this.sel, multi: this.multi.slice() }, placas: { n: this.placas, ativa: this.placaAtiva } });
    this.objetos = r.estado; this.restaurarSel(r.sel);
    if (r.placas) { this.placas = r.placas.n; this.placaAtiva = r.placas.ativa; }
    this.conferirSelecao();
    this.emitir('mudou', { rotulo: r.rotulo, refeito: true });
    return r.rotulo;
  }
  proximoDesfazer() { const u = this.pilhaDesfazer[this.pilhaDesfazer.length - 1]; return u ? u.rotulo : null; }
  proximoRefazer() { const u = this.pilhaRefazer[this.pilhaRefazer.length - 1]; return u ? u.rotulo : null; }

  restaurarSel(s) { this.sel = { objeto: s.objeto, parte: s.parte }; this.multi = (s.multi || []).slice(); }
  conferirSelecao() {
    this.multi = this.multi.filter(id => this.objeto(id));
    if (this.sel.objeto && !this.multi.includes(this.sel.objeto)) this.multi = this.multi.length ? [...this.multi, this.sel.objeto] : [this.sel.objeto];
    if (!this.sel.objeto) this.multi = [];
    const o = this.objeto(this.sel.objeto);
    if (!o) { this.sel = { objeto: this.objetos.length ? null : null, parte: null }; return; }
    if (!o.partes.some(p => p.id === this.sel.parte)) this.sel.parte = o.partes.length === 1 ? o.partes[0].id : null;
  }
  // somar: Shift+clique -> entra/sai da seleção múltipla
  selecionar(objId, parteId, somar) {
    if (somar && objId) {
      if (this.multi.includes(objId) && this.multi.length > 1) {
        this.multi = this.multi.filter(x => x !== objId);
        if (this.sel.objeto === objId) { const u = this.objeto(this.multi[this.multi.length - 1]); this.sel = { objeto: u.id, parte: u.partes.length === 1 ? u.partes[0].id : null }; }
      } else {
        if (!this.multi.includes(objId)) this.multi.push(objId);
        this.sel = { objeto: objId, parte: parteId || null };
      }
    } else {
      this.sel = { objeto: objId || null, parte: parteId || null };
      this.multi = objId ? [objId] : [];
    }
    this.conferirSelecao();
    this.emitir('selecao', this.sel);
  }
  selecionarTodos() {
    if (!this.objetos.length) return;
    this.multi = this.objetos.map(o => o.id);
    const u = this.objetos[this.objetos.length - 1];
    this.sel = { objeto: u.id, parte: u.partes.length === 1 ? u.partes[0].id : null };
    this.emitir('selecao', this.sel);
  }
  objetosSel() { return this.multi.map(id => this.objeto(id)).filter(Boolean); }
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
    const cp = this.centroPlaca();
    const dx = cp[0] - (c.min[0] + c.max[0]) / 2, dy = cp[1] - (c.min[1] + c.max[1]) / 2;
    o.transform = M4.multiplicar(M4.translacao(dx, dy, -c.min[2]), o.transform);
  }
  // ORGANIZAR: peças lado a lado (prateleiras), sem sobrepor. Não coube na
  // placa? Vai pra próxima — e cria placa nova sozinho. soPlaca: só as peças
  // daquela placa (as que não couberem vão pra placas novas no fim).
  // Devolve { coube (toda peça cabe numa placa), placas, grandes: [nomes] }
  organizarMesa(espaco = 6, soPlaca = null) {
    const W = this.mesa.x, D = this.mesa.y;
    const alvo = this.objetos.filter(o => o.visivel && (soPlaca == null || this.placaDe(o) === soPlaca));
    const itens = alvo.map(o => { this.colocarNaMesa(o); const c = this.caixaExata(o); return { o, c, w: c.tam[0], h: c.tam[1] }; }).sort((a, b) => b.h - a.h);
    // placas disponíveis, na ordem: a escolhida (ou todas do começo), depois novas
    const n0 = this.placas;
    const fila = soPlaca == null ? [...Array(n0).keys()] : [soPlaca];
    let pi = 0, x = espaco, y = espaco, alturaLinha = 0, novas = 0;
    const lugar = [], grandes = [];
    const placaAtual = () => pi < fila.length ? fila[pi] : n0 + (pi - fila.length);
    for (const it of itens) {
      if (it.w > W - 2 * espaco || it.h > D - 2 * espaco) {
        // maior que a mesa: vai sozinha numa placa (e o aviso diz)
        grandes.push(it.o.nome);
        if (x > espaco || y > espaco) { pi++; x = espaco; y = espaco; alturaLinha = 0; }
        lugar.push({ it, p: placaAtual(), x: (W - it.w) / 2, y: (D - it.h) / 2 });
        pi++; x = espaco; y = espaco; alturaLinha = 0;
        continue;
      }
      if (x + it.w > W - espaco && x > espaco) { x = espaco; y += alturaLinha + espaco; alturaLinha = 0; }
      if (y + it.h > D - espaco && (x > espaco || y > espaco)) { pi++; x = espaco; y = espaco; alturaLinha = 0; }
      lugar.push({ it, p: placaAtual(), x, y });
      x += it.w + espaco;
      alturaLinha = Math.max(alturaLinha, it.h);
    }
    const maior = lugar.reduce((m, l) => Math.max(m, l.p), -1);
    if (maior >= n0) { novas = maior + 1 - n0; this.definirPlacas(maior + 1); }
    for (const l of lugar) {
      const o = this.origemPlaca(l.p), c = this.caixaExata(l.it.o);
      l.it.o.transform = M4.multiplicar(M4.translacao(o[0] + l.x - c.min[0], o[1] + l.y - c.min[1], 0), l.it.o.transform);
    }
    return { coube: !grandes.length, placas: this.placas, novas, grandes };
  }

  proximaCor() {
    const usadas = new Set();
    for (const o of this.objetos) for (const p of o.partes) usadas.add(p.cor);
    return PALETA_PECAS.find(c => !usadas.has(c)) || PALETA_PECAS[this.objetos.length % PALETA_PECAS.length];
  }
}

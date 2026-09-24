// Controlador do Estúdio 3D: junta cena, visor, motor e painéis.
import { Cena, novoObjeto, novaParte } from './cena.js';
import { Visor } from './visor.js';
import { Motor } from '../motor/cliente.js';
import { el, esc, fmt, fmtInt, avisar, lerArquivo } from './util.js';
import * as M4 from '../core/mat4.js';
import { prepararAdjacencia } from '../core/selecao.js';
import { transformar } from '../core/malha.js';
import { PALETA_PECAS } from '../core/cores.js';
import { injetarCSS } from './estilo.js';
import { montarDiagnostico } from './secoes/diagnostico.js';
import { montarTransformar } from './secoes/transformar.js';
import { montarSelecionar } from './secoes/selecionar.js';
import { montarSeparar } from './secoes/separar.js';
import { montarCortar } from './secoes/cortar.js';
import { montarRelevo } from './secoes/relevo.js';
import { montarExportar } from './secoes/exportar.js';

const ICONES = {
  olho: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  olhoFechado: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 3.9M6.1 6.1C3.3 8 1 12 1 12s4 7 11 7c1.8 0 3.4-.5 4.8-1.2"/></svg>'
};

export class Estudio {
  constructor(raiz, opcoes = {}) {
    injetarCSS();
    this.raiz = raiz;
    this.opcoes = opcoes;
    this.cena = new Cena();
    this.motor = new Motor();
    this.ferramenta = 'navegar';
    this.adjCache = new WeakMap();
    this.diag = new Map();          // parte.id -> { rel, malha }
    this.segm = new Map();          // parte.id -> { rotulo, partes, malha }
    this.previaAtiva = null;
    this.ouvintes = new Map();
    this.secoes = {};
    this.montar();
    this.motor.aoMudar = n => this.atualizarMotor(n);
    this.motor.iniciar().then(modo => { this.modoMotor = modo; this.atualizarMotor(0); });
  }

  on(ev, fn) { if (!this.ouvintes.has(ev)) this.ouvintes.set(ev, []); this.ouvintes.get(ev).push(fn); }
  emitir(ev, d) { (this.ouvintes.get(ev) || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } }); }

  /* ------------------------------------------------------------ DOM */
  montar() {
    const r = this.raiz;
    r.innerHTML = '';
    r.classList.add('e3d');
    this.barra = el('div', { class: 'e3d-barra' });
    this.barra.innerHTML = `
      <button class="btn primary" data-b="abrir" title="Abrir STL, OBJ ou 3MF">Abrir modelo</button>
      <button class="btn" data-b="desfazer" title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
      <button class="btn" data-b="refazer" title="Refazer (Ctrl+Y)">↷ Refazer</button>
      <span class="sep"></span>
      <button class="btn ativo" data-g="nenhum" title="Clique pra escolher peça">Escolher</button>
      <button class="btn" data-g="mover" title="Mover (G)">Mover</button>
      <button class="btn" data-g="girar" title="Girar (R)">Girar</button>
      <button class="btn" data-g="escalar" title="Escalar (S)">Escalar</button>
      <span class="sep"></span>
      <button class="btn" data-b="enquadrar" title="Enquadrar (F)">Enquadrar</button>
      <button class="btn" data-v="iso">3D</button>
      <button class="btn" data-v="frente">Frente</button>
      <button class="btn" data-v="topo">Topo</button>
      <button class="btn" data-v="direita">Lado</button>
      <span class="sep"></span>
      <select data-b="modo" title="Modo de visualização">
        <option value="cores">Ver: cores/materiais</option>
        <option value="normais">Ver: normais (avesso em vermelho)</option>
        <option value="cascas">Ver: cascas soltas</option>
        <option value="problemas">Ver: problemas da malha</option>
        <option value="espessura">Ver: espessura</option>
        <option value="partes">Ver: partes detectadas</option>
      </select>
      <label class="fer-check" style="margin:0"><input type="checkbox" data-b="arame"> Arame</label>
      <label class="fer-check" style="margin:0" title="Sombreado suave ou facetado"><input type="checkbox" data-b="facetado"> Facetado</label>
      <span class="grow"></span>
      <button class="btn" data-b="organizar" title="Põe todos os objetos lado a lado na mesa">Organizar mesa</button>
      <span class="e3d-motor" data-b="motor"><i></i><span>carregando motor…</span></span>`;
    this.corpo = el('div', { class: 'e3d-corpo' });
    this.painelCena = el('aside', { class: 'e3d-cena' });
    this.palco = el('div', { class: 'e3d-palco' });
    this.painel = el('aside', { class: 'e3d-painel' });
    this.corpo.append(this.painelCena, this.palco, this.painel);
    r.append(this.barra, this.corpo);
    this.inputArquivo = el('input', { type: 'file', multiple: true, accept: '.stl,.obj,.mtl,.3mf', style: 'display:none' });
    r.appendChild(this.inputArquivo);

    this.visor = new Visor(this.palco, this.cena);
    this.vazio = el('div', { class: 'e3d-vazio', html: '<b>Arraste um modelo aqui</b><span>STL, OBJ (+MTL) ou 3MF — ou use "Abrir modelo".<br>Do gerador de chaveiros, use "Abrir no Estúdio 3D".</span>' });
    this.hud = el('div', { class: 'e3d-hud' });
    this.dica = el('div', { class: 'e3d-dica', html: 'arrastar: girar · botão direito: mover a vista · rodinha: zoom' });
    this.ocupadoEl = el('div', { class: 'e3d-ocupado', html: 'calculando…' });
    this.previaEl = el('div', { class: 'e3d-previa', style: 'display:none' });
    this.palco.append(this.vazio, this.hud, this.dica, this.ocupadoEl, this.previaEl);

    this.secoes.diagnostico = montarDiagnostico(this);
    this.secoes.transformar = montarTransformar(this);
    this.secoes.selecionar = montarSelecionar(this);
    this.secoes.separar = montarSeparar(this);
    this.secoes.cortar = montarCortar(this);
    this.secoes.relevo = montarRelevo(this);
    this.secoes.exportar = montarExportar(this);
    for (const k in this.secoes) this.painel.appendChild(this.secoes[k].el);
    // um quadro aberto por vez (menos rolagem)
    this.painel.addEventListener('toggle', ev => {
      const d = ev.target;
      if (d.tagName === 'DETAILS' && d.open) {
        this.painel.querySelectorAll('details[open]').forEach(x => { if (x !== d) x.open = false; });
        this.emitir('secao', d.dataset.sec);
      } else if (d.tagName === 'DETAILS' && !d.open) this.emitir('secao-fechou', d.dataset.sec);
    }, true);

    this.ligarBarra();
    this.ligarPalco();
    this.ligarAtalhos();
    this.cena.on('mudou', () => this.aoMudar());
    this.cena.on('selecao', () => this.aoSelecionar());
    this.visor.on('gizmo-fim', g => this.fimGizmo(g));
    this.visor.on('gizmo-mudou', () => this.atualizarHud());
    this.aoMudar();
  }

  ligarBarra() {
    const b = this.barra;
    b.addEventListener('click', ev => {
      const t = ev.target.closest('button');
      if (!t) return;
      if (t.dataset.g) this.definirGizmo(t.dataset.g);
      else if (t.dataset.v) this.visor.vista(t.dataset.v);
      else if (t.dataset.b === 'abrir') this.inputArquivo.click();
      else if (t.dataset.b === 'desfazer') this.desfazer();
      else if (t.dataset.b === 'refazer') this.refazer();
      else if (t.dataset.b === 'enquadrar') this.enquadrar();
      else if (t.dataset.b === 'organizar') this.organizarMesa();
    });
    b.querySelector('[data-b=modo]').addEventListener('change', ev => this.definirModoVisual(ev.target.value));
    b.querySelector('[data-b=arame]').addEventListener('change', ev => this.visor.definirArame(ev.target.checked));
    b.querySelector('[data-b=facetado]').addEventListener('change', ev => this.visor.definirSombreado(ev.target.checked ? 'facetado' : 'suave'));
    this.inputArquivo.addEventListener('change', () => { const f = [...this.inputArquivo.files]; this.inputArquivo.value = ''; if (f.length) this.importarArquivos(f); });
  }

  definirGizmo(m) {
    this.barra.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('ativo', x.dataset.g === m));
    this.visor.definirGizmo(m);
    if (m !== 'nenhum' && this.ferramenta !== 'navegar') this.definirFerramenta('navegar');
  }

  ligarPalco() {
    const cv = this.visor.renderer.domElement;
    let ini = null;
    cv.addEventListener('pointerdown', ev => {
      ini = { x: ev.clientX, y: ev.clientY, b: ev.button };
      if (ev.button === 0 && this.ferramenta === 'pincel' && !this.previaAtiva) {
        const hit = this.visor.intersectar(ev);
        if (hit) {
          this.pintando = true;
          this.visor.controles.enabled = false;
          cv.setPointerCapture(ev.pointerId);
          this.secoes.selecionar.pincel(hit, ev, true);
        }
      }
    });
    cv.addEventListener('pointermove', ev => {
      if (this.ferramenta === 'pincel') {
        const hit = this.visor.intersectar(ev);
        this.secoes.selecionar.cursorPincel(hit);
        if (this.pintando && hit) this.secoes.selecionar.pincel(hit, ev, false);
      }
    });
    const fim = ev => {
      if (this.pintando) {
        this.pintando = false;
        this.visor.controles.enabled = true;
        try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
        this.secoes.selecionar.fimPincel();
        ini = null;
        return;
      }
      if (!ini) return;
      const moveu = Math.hypot(ev.clientX - ini.x, ev.clientY - ini.y);
      if (moveu < 5 && ini.b === 0 && !this.visor.gizmo.dragging) this.clique(ev);
      ini = null;
    };
    cv.addEventListener('pointerup', fim);
    cv.addEventListener('pointerleave', () => { if (this.ferramenta === 'pincel') this.secoes.selecionar.cursorPincel(null); });
    cv.addEventListener('contextmenu', ev => ev.preventDefault());
    // arrastar arquivo
    const p = this.palco;
    ['dragenter', 'dragover'].forEach(e => p.addEventListener(e, ev => { ev.preventDefault(); p.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(e => p.addEventListener(e, ev => { ev.preventDefault(); p.classList.remove('sobre'); }));
    p.addEventListener('drop', ev => { const f = [...(ev.dataTransfer && ev.dataTransfer.files || [])]; if (f.length) this.importarArquivos(f); });
  }

  ligarAtalhos() {
    document.addEventListener('keydown', ev => {
      if (!this.visivel()) return;
      const alvo = ev.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable)) return;
      const k = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && k === 'z' && !ev.shiftKey) { ev.preventDefault(); this.desfazer(); }
      else if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); this.refazer(); }
      else if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      else if (k === 'escape') { if (this.previaAtiva) this.cancelarPrevia(); else if (this.ferramenta !== 'navegar') this.definirFerramenta('navegar'); else this.definirGizmo('nenhum'); }
      else if (k === 'delete') { const o = this.cena.objetoSel(); if (o) this.removerObjeto(o.id); }
      else if (k === 'f') this.enquadrar();
      else if (k === 'g') this.definirGizmo('mover');
      else if (k === 'r') this.definirGizmo('girar');
      else if (k === 's') this.definirGizmo('escalar');
      else if (k === 'b') this.definirFerramenta('pincel');
      else if (k === 'w') { const c = this.barra.querySelector('[data-b=arame]'); c.checked = !c.checked; this.visor.definirArame(c.checked); }
    });
  }

  visivel() { return !!this.raiz.offsetParent; }

  /* ------------------------------------------------------------ clique no 3D */
  clique(ev) {
    if (this.previaAtiva) return;
    const hit = this.visor.intersectar(ev);
    if (this.ferramenta === 'navegar' || !hit) {
      if (hit) this.cena.selecionar(hit.objeto, hit.parte);
      else if (this.ferramenta === 'navegar') this.cena.selecionar(null, null);
      return;
    }
    if (hit.objeto !== this.cena.sel.objeto || hit.parte !== this.cena.sel.parte) this.cena.selecionar(hit.objeto, hit.parte);
    this.emitir('clique', { hit, ev });
  }

  definirFerramenta(f) {
    this.ferramenta = f;
    if (f !== 'navegar') this.definirGizmoSilencioso('nenhum');
    if (f !== 'pincel') this.visor.mostrarPincel(null);
    this.visor.renderer.domElement.style.cursor = f === 'navegar' ? '' : 'crosshair';
    this.dica.innerHTML = f === 'pincel' ? 'arraste sobre a peça pra pintar · começando fora da peça, gira a vista'
      : f === 'navegar' ? 'arrastar: girar · botão direito: mover a vista · rodinha: zoom'
      : 'clique na peça · Shift soma · Alt tira · Esc volta';
    this.emitir('ferramenta', f);
  }
  definirGizmoSilencioso(m) {
    this.barra.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('ativo', x.dataset.g === m));
    this.visor.definirGizmo(m);
  }

  /* ------------------------------------------------------------ estado */
  aoMudar() {
    this.visor.sincronizar();
    this.renderCena();
    this.atualizarHud();
    this.vazio.style.display = this.cena.objetos.length ? 'none' : '';
    const bd = this.barra.querySelector('[data-b=desfazer]'), br = this.barra.querySelector('[data-b=refazer]');
    bd.disabled = !this.cena.podeDesfazer(); br.disabled = !this.cena.podeRefazer();
    bd.title = this.cena.proximoDesfazer() ? 'Desfazer: ' + this.cena.proximoDesfazer() + ' (Ctrl+Z)' : 'Nada pra desfazer';
    br.title = this.cena.proximoRefazer() ? 'Refazer: ' + this.cena.proximoRefazer() + ' (Ctrl+Y)' : 'Nada pra refazer';
    if (this.visor.modo !== 'cores' && this.visor.modo !== 'normais') this.recalcularMapas();
    this.emitir('mudou');
  }
  aoSelecionar() {
    this.visor.atualizarGizmo();
    this.visor.atualizarCaixaSel();
    this.renderCena();
    this.atualizarHud();
    this.emitir('selecao');
  }

  objetoAtual() { return this.cena.objetoSel(); }
  parteAtual() { return this.cena.parteSel(); }
  adj(malha) {
    let a = this.adjCache.get(malha);
    if (!a) { a = prepararAdjacencia(malha); this.adjCache.set(malha, a); }
    return a;
  }

  atualizarHud() {
    const o = this.cena.objetoSel();
    if (!o) {
      const n = this.cena.objetos.length;
      this.hud.textContent = n ? n + ' objeto(s) · clique numa peça' : 'mesa ' + this.cena.mesa.x + ' × ' + this.cena.mesa.y + ' mm';
      return;
    }
    const c = this.visor.gizmo.dragging ? this.caixaAoVivo(o) : this.cena.caixaExata(o);
    let tri = 0; o.partes.forEach(p => { tri += p.malha.idx.length / 3; });
    this.hud.textContent = o.nome + ' · ' + (c ? fmt(c.tam[0]) + ' × ' + fmt(c.tam[1]) + ' × ' + fmt(c.tam[2]) + ' mm' : '') + ' · ' + fmtInt(tri) + ' triângulos';
  }
  caixaAoVivo(o) {
    const g = this.visor.grupos.get(o.id);
    if (!g) return null;
    const t = this.visor.matrizDoGrupo(g);
    return this.cena.caixaExata({ ...o, transform: t });
  }

  atualizarMotor(n) {
    const m = this.barra.querySelector('[data-b=motor]');
    const pronto = !!this.modoMotor;
    m.className = 'e3d-motor ' + (n > 0 ? 'ocupado' : pronto ? 'ok' : '');
    m.querySelector('span').textContent = !pronto ? 'carregando motor…' : n > 0 ? 'calculando…' : (this.modoMotor === 'worker' ? 'motor pronto' : 'motor pronto (modo simples)');
    m.title = this.modoMotor === 'local' ? 'Rodando sem Web Worker: ' + (this.motor.motivoLocal || '') : 'Geometria calculada em segundo plano (Web Worker)';
    this.ocupadoEl.classList.toggle('on', n > 0);
  }

  // roda uma operação do motor mostrando "calculando" e tratando erro
  async rodar(op, args, rotulo) {
    try {
      return await this.motor.rodar(op, args);
    } catch (e) {
      console.error(e);
      avisar((rotulo ? rotulo + ': ' : '') + (e.message || e), 'warn');
      throw e;
    }
  }

  /* ------------------------------------------------------------ lista da cena */
  renderCena() {
    const p = this.painelCena;
    const sel = this.cena.sel;
    p.innerHTML = '';
    p.appendChild(el('div', { class: 'e3d-titulo' }, 'Objetos na mesa'));
    if (!this.cena.objetos.length) { p.appendChild(el('p', { class: 'u', style: 'font-size:12px;color:var(--ink-dim)' }, 'Nenhum modelo aberto.')); return; }
    for (const o of this.cena.objetos) {
      const box = el('div', { class: 'e3d-obj' + (o.id === sel.objeto ? ' sel' : '') });
      const c = this.cena.caixaExata(o);
      const cab = el('div', { class: 'e3d-obj-cab', title: 'Clique pra escolher · duplo clique renomeia' },
        el('span', { class: 'nome' }, o.nome),
        el('span', { class: 'med' }, c ? fmt(c.tam[0], 0) + '×' + fmt(c.tam[1], 0) + '×' + fmt(c.tam[2], 0) : ''),
        el('button', { class: 'e3d-ico', title: o.visivel ? 'Esconder' : 'Mostrar', html: o.visivel ? ICONES.olho : ICONES.olhoFechado, onclick: ev => { ev.stopPropagation(); this.cena.aplicar(o.visivel ? 'Esconder objeto' : 'Mostrar objeto', () => { o.visivel = !o.visivel; }); } }),
        el('button', { class: 'e3d-ico', title: 'Duplicar', onclick: ev => { ev.stopPropagation(); this.duplicarObjeto(o.id); } }, '⧉'),
        el('button', { class: 'e3d-ico', title: 'Excluir (Delete)', onclick: ev => { ev.stopPropagation(); this.removerObjeto(o.id); } }, '✕'));
      cab.addEventListener('click', () => this.cena.selecionar(o.id, o.partes.length === 1 ? o.partes[0].id : null));
      cab.addEventListener('dblclick', () => this.renomear(o));
      box.appendChild(cab);
      if (o.partes.length > 1 || o.id === sel.objeto) {
        for (const pt of o.partes) {
          const linha = el('div', { class: 'e3d-parte' + (o.id === sel.objeto && pt.id === sel.parte ? ' sel' : ''), title: pt.cor + (pt.paleta ? ' + ' + (pt.paleta.length - 1) + ' cor(es) pintada(s)' : '') },
            el('span', { class: 'e3d-bola', style: 'background:' + pt.cor + (pt.paleta ? ';background:conic-gradient(' + pt.paleta.slice(0, 6).map((h, i, a) => h + ' ' + Math.round(i * 100 / a.length) + '% ' + Math.round((i + 1) * 100 / a.length) + '%').join(',') + ')' : '') }),
            el('span', { class: 'nome' }, pt.nome),
            el('button', { class: 'e3d-ico', title: pt.visivel !== false ? 'Esconder peça' : 'Mostrar peça', html: pt.visivel !== false ? ICONES.olho : ICONES.olhoFechado, onclick: ev => { ev.stopPropagation(); this.cena.aplicar('Visibilidade da peça', () => { pt.visivel = pt.visivel === false; }); } }));
          linha.addEventListener('click', () => this.cena.selecionar(o.id, pt.id));
          linha.addEventListener('dblclick', () => this.renomear(pt));
          box.appendChild(linha);
        }
      }
      p.appendChild(box);
    }
    const acoes = el('div', { class: 'e3d-botoes' },
      el('button', { class: 'btn', title: 'Todos os objetos viram peças de um objeto só (montagem multicor)', onclick: () => this.juntarObjetos() }, 'Juntar num objeto'),
      el('button', { class: 'btn', title: 'Cada peça do objeto escolhido vira um objeto (imprimir separado)', onclick: () => this.separarPecasEmObjetos() }, 'Peças → objetos'),
      el('button', { class: 'btn danger', onclick: () => this.limparCena() }, 'Limpar mesa'));
    p.appendChild(acoes);
  }

  renomear(alvo) {
    const n = window.prompt('Novo nome:', alvo.nome);
    if (n == null || !n.trim()) return;
    this.cena.aplicar('Renomear', () => { alvo.nome = n.trim().slice(0, 60); });
  }

  /* ------------------------------------------------------------ ações de cena */
  adicionarObjetos(objs, opc = {}) {
    const novos = objs.map(o => novoObjeto(o));
    this.cena.aplicar(opc.rotulo || 'Adicionar', () => {
      for (const o of novos) {
        const c = this.cena.caixaExata(o);
        const fora = !c || c.min[0] < -1 || c.min[1] < -1 || c.max[0] > this.cena.mesa.x + 1 || c.max[1] > this.cena.mesa.y + 1;
        if (opc.centralizar || (fora && opc.centralizar !== false)) this.cena.centralizar(o);
        else if (opc.naMesa !== false) this.cena.colocarNaMesa(o);
        this.cena.objetos.push(o);
      }
      const ult = novos[novos.length - 1];
      if (ult) this.cena.sel = { objeto: ult.id, parte: ult.partes.length === 1 ? ult.partes[0].id : null };
    });
    if (opc.enquadrar !== false) this.enquadrar();
    return novos;
  }

  removerObjeto(id) {
    const o = this.cena.objeto(id);
    if (!o) return;
    this.cena.aplicar('Excluir ' + o.nome, () => {
      this.cena.objetos = this.cena.objetos.filter(x => x.id !== id);
      if (this.cena.sel.objeto === id) this.cena.sel = { objeto: null, parte: null };
    });
  }
  duplicarObjeto(id) {
    const o = this.cena.objeto(id);
    if (!o) return;
    const c = this.cena.caixaExata(o);
    const d = novoObjeto({ nome: o.nome + ' (cópia)', transform: M4.multiplicar(M4.translacao(c ? c.tam[0] + 6 : 10, 0, 0), o.transform), partes: o.partes.map(p => ({ ...p, id: undefined })) });
    this.cena.aplicar('Duplicar', () => { this.cena.objetos.push(d); this.cena.sel = { objeto: d.id, parte: d.partes.length === 1 ? d.partes[0].id : null }; });
  }
  juntarObjetos() {
    const vis = this.cena.objetos.filter(o => o.visivel);
    if (vis.length < 2) { avisar('Precisa de pelo menos dois objetos.', 'warn'); return; }
    // peças levam a transformação do objeto pra dentro da geometria? não: usa o 1º como referência
    const ref = vis[0];
    const inv = M4.inverter(ref.transform);
    {
      const partes = [];
      for (const o of vis) {
        const rel = M4.multiplicar(inv, o.transform);
        for (const p of o.partes) partes.push({ ...p, id: undefined, nome: vis.length > 1 && o.partes.length === 1 ? o.nome : p.nome, malha: M4.ehIdentidade(rel) ? p.malha : transformar(p.malha, rel) });
      }
      const novo = novoObjeto({ nome: ref.nome + ' (montagem)', transform: ref.transform, partes });
      this.cena.aplicar('Juntar objetos', () => {
        this.cena.objetos = this.cena.objetos.filter(o => !vis.includes(o));
        this.cena.objetos.push(novo);
        this.cena.sel = { objeto: novo.id, parte: null };
      });
    }
  }
  separarPecasEmObjetos() {
    const o = this.cena.objetoSel();
    if (!o || o.partes.length < 2) { avisar('Escolha um objeto com mais de uma peça.', 'warn'); return; }
    const novos = o.partes.map(p => novoObjeto({ nome: p.nome, transform: o.transform, partes: [{ ...p, id: undefined }] }));
    this.cena.aplicar('Peças viram objetos', () => {
      const i = this.cena.objetos.indexOf(o);
      this.cena.objetos.splice(i, 1, ...novos);
      this.cena.sel = { objeto: novos[0].id, parte: novos[0].partes[0].id };
    });
  }
  limparCena() {
    if (!this.cena.objetos.length) return;
    if (!window.confirm('Tirar todos os objetos da mesa? (dá pra desfazer)')) return;
    this.cena.aplicar('Limpar mesa', () => { this.cena.objetos = []; this.cena.sel = { objeto: null, parte: null }; });
  }
  organizarMesa() {
    if (!this.cena.objetos.length) return;
    let coube = true;
    this.cena.aplicar('Organizar mesa', () => { coube = this.cena.organizarMesa(); });
    if (!coube) avisar('Nem tudo coube numa mesa de ' + this.cena.mesa.x + ' mm. O Bambu Studio pode distribuir em mais placas.', 'warn');
    this.enquadrar();
  }
  // troca uma peça por outra malha (mesmo id: a seleção de faces é limpa)
  trocarParte(objId, parteId, nova, rotulo) {
    this.cena.aplicar(rotulo, () => {
      const o = this.cena.objeto(objId);
      const i = o.partes.findIndex(p => p.id === parteId);
      o.partes[i] = novaParte({ ...o.partes[i], ...nova, id: parteId });
    });
  }

  fimGizmo(g) {
    if (!g) return;
    const id = g.userData.objeto;
    const o = this.cena.objeto(id);
    if (!o) return;
    const t = this.visor.matrizDoGrupo(g);
    let mudou = false;
    for (let i = 0; i < 16; i++) if (Math.abs(t[i] - o.transform[i]) > 1e-9) mudou = true;
    if (!mudou) return;
    const modo = this.visor.modoGizmo;
    this.cena.aplicar(modo === 'girar' ? 'Girar' : modo === 'escalar' ? 'Escalar' : 'Mover', () => { o.transform = t; });
  }

  desfazer() { if (this.previaAtiva) this.cancelarPrevia(); const r = this.cena.desfazer(); if (r) avisar('Desfeito: ' + r); }
  refazer() { if (this.previaAtiva) this.cancelarPrevia(); const r = this.cena.refazer(); if (r) avisar('Refeito: ' + r); }
  enquadrar() {
    const o = this.cena.objetoSel();
    this.visor.enquadrar(o ? this.cena.caixaObjeto(o) : null);
  }

  /* ------------------------------------------------------------ importação */
  async importarArquivos(files) {
    const modelos = files.filter(f => /\.(stl|obj|3mf)$/i.test(f.name));
    const mtls = files.filter(f => /\.mtl$/i.test(f.name));
    if (!modelos.length) { avisar('Escolha um arquivo STL, OBJ ou 3MF.', 'warn'); return; }
    for (const f of modelos) {
      if (f.size > 400 * 1024 * 1024) { avisar(f.name + ': arquivo grande demais (máx. 400 MB).', 'warn'); continue; }
      try {
        const bytes = await lerArquivo(f);
        const extras = {};
        if (/\.obj$/i.test(f.name) && mtls.length) extras.mtl = new TextDecoder().decode(await lerArquivo(mtls[0]));
        const r = await this.rodar('importar', { nome: f.name, bytes, extras }, 'Abrir ' + f.name);
        // peça sem cor declarada no arquivo (STL, OBJ sem MTL) ganha cor própria
        const usadas = new Set();
        this.cena.objetos.forEach(o => o.partes.forEach(p => usadas.add(p.cor)));
        for (const o of r.objetos) for (const p of o.partes) {
          if (!p.cor) { p.cor = PALETA_PECAS.find(c => !usadas.has(c)) || '#B4BAC4'; }
          usadas.add(p.cor);
        }
        const novos = this.adicionarObjetos(r.objetos, { rotulo: 'Abrir ' + f.name });
        this.emitir('importou', { resultado: r, objetos: novos, arquivo: f.name });
        avisar(f.name + ': ' + fmtInt(r.triangulos) + ' triângulos, ' + r.objetos.length + ' objeto(s)');
      } catch (e) { /* já avisado */ }
    }
  }

  /* ------------------------------------------------------------ visualização */
  definirModoVisual(m) {
    this.barra.querySelector('[data-b=modo]').value = m;
    this.visor.definirModo(m);
    this.recalcularMapas();
  }
  recalcularMapas() {
    const m = this.visor.modo;
    for (const o of this.cena.objetos) for (const p of o.partes) {
      const mapa = this.emitirMapa(m, p);
      if (mapa) this.visor.mapas.set(p.id, mapa); else this.visor.mapas.delete(p.id);
    }
    this.visor.pintarTudo();
  }
  emitirMapa(modo, parte) {
    const f = this.mapeadores && this.mapeadores[modo];
    return f ? f(parte) : null;
  }
  registrarMapa(modo, fn) { (this.mapeadores || (this.mapeadores = {}))[modo] = fn; }

  /* ------------------------------------------------------------ prévia */
  // cfg: { titulo, legenda:[[cor,texto]], objetos (pro visor), explodir, confirmar() }
  mostrarPrevia(cfg) {
    this.cancelarPrevia(true);
    this.previaAtiva = cfg;
    this.visor.limparAjudas();
    this.visor.mostrarPrevia(cfg.objetos, cfg.explodir || 0);
    this.previaEl.innerHTML = '';
    this.previaEl.append(
      el('b', null, cfg.titulo || 'Prévia'),
      el('div', { class: 'leg' }, (cfg.legenda || []).map(([c, t]) => el('span', { style: '--c:' + c }, t))),
      el('button', { class: 'btn primary', onclick: () => this.confirmarPrevia() }, cfg.textoConfirmar || 'Confirmar'),
      el('button', { class: 'btn', onclick: () => this.cancelarPrevia() }, 'Cancelar'));
    if (cfg.notas && cfg.notas.length) this.previaEl.appendChild(el('div', { style: 'flex-basis:100%;font-size:11.5px;color:var(--warn)' }, cfg.notas.join(' · ')));
    this.previaEl.style.display = 'flex';
  }
  confirmarPrevia() {
    const cfg = this.previaAtiva;
    if (!cfg) return;
    this.previaAtiva = null;
    this.previaEl.style.display = 'none';
    this.visor.limparPrevia();
    cfg.confirmar();
    this.emitir('previa-fim', true);
  }
  cancelarPrevia(silencioso) {
    if (!this.previaAtiva) return;
    const cfg = this.previaAtiva;
    this.previaAtiva = null;
    this.previaEl.style.display = 'none';
    this.visor.limparPrevia();
    if (cfg.cancelar) cfg.cancelar();
    if (!silencioso) this.emitir('previa-fim', false);
  }

  // objetos de/para o formato do motor
  paraMotor(o) { return { nome: o.nome, transform: o.transform, partes: o.partes.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta })) }; }
  parteParaMotor(p) { return { nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }; }
}

export { esc };

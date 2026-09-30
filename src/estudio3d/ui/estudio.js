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
import { montarFormas } from './secoes/formas.js';
import { montarModificar } from './secoes/modificar.js';
import { montarEsculpir } from './secoes/esculpir.js';
import { montarDesenhar } from './secoes/desenhar.js';
import { prepararParaImpressao } from './preparar.js';
import { alinhar, duplicarEmSerie } from '../core/modelagem.js';
import { icone } from './icones.js';
import { calcularSugestoes } from './sugestoes.js';

const ICONES = { olho: icone('olho', 15), olhoFechado: icone('olhoFechado', 15) };

// As ferramentas, na ordem em que a gente costuma usar. O nome é o que você
// quer FAZER, não o nome técnico.
const FERRAMENTAS = [
  { sec: 'inicio', ico: 'casa', rot: 'Início', titulo: 'O que você quer fazer?', desc: 'Escolha uma tarefa — o Estúdio guia o resto. As sugestões abaixo são do modelo aberto.' },
  { sec: 'formas', ico: 'formas', rot: 'Formas', titulo: 'Adicionar formas', desc: 'Caixa, cilindro, círculo, estrela, texto, furo de parafuso… Clique e a forma aparece na mesa. Medidas em mm, e dá pra juntar ou furar uma peça com a outra.' },
  { sec: 'mod', ico: 'modificar', rot: 'Modificar', titulo: 'Modificar a peça', desc: 'Arredondar e chanfrar bordas, puxar ou empurrar uma face, deixar oca com parede em mm e espelhar. Geometria de verdade, com prévia.' },
  { sec: 'esc', ico: 'esculpir', rot: 'Esculpir', titulo: 'Esculpir e deformar', desc: 'Pincel pra puxar, empurrar, inflar, achatar e suavizar — com simetria ao vivo. Torcer, afunilar e dobrar a peça inteira.' },
  { sec: 'des', ico: 'desenhar', rot: 'Desenhar', titulo: 'Desenhar e criar', desc: 'Desenhe um contorno na mesa e ele vira peça: com espessura, girado (vaso, puxador) ou tubo.' },
  { sec: 'diag', ico: 'escudo', rot: 'Consertar', titulo: 'Conferir e consertar', desc: 'Vê se o arquivo imprime e conserta buracos, faces viradas e sobras, sem perder detalhe.' },
  { sec: 'transf', ico: 'ajustar', rot: 'Ajustar', titulo: 'Posição, tamanho e cor', desc: 'Medidas em mm, girar, deitar pra imprimir sem suporte e a cor de cada peça.' },
  { sec: 'sel', ico: 'selecionar', rot: 'Selecionar', titulo: 'Selecionar uma parte', desc: 'Clique numa orelha, olho ou detalhe: a seleção para sozinha na dobra.' },
  { sec: 'sep', ico: 'separar', rot: 'Separar', titulo: 'Separar para imprimir', desc: 'O detalhe selecionado vira peça própria, com encaixe. Ou separe por cor, pra imprimir sem AMS.' },
  { sec: 'corte', ico: 'tesoura', rot: 'Cortar', titulo: 'Cortar em partes', desc: 'Corte num plano: as duas partes saem fechadas e com pino de encaixe.' },
  { sec: 'relevo', ico: 'texto', rot: 'Texto', titulo: 'Texto, logo e relevo', desc: 'Nome, telefone ou logo em relevo, gravado ou vazado — na frente e no verso.' },
  { sec: 'exp', ico: 'baixar', rot: 'Exportar', titulo: 'Mandar pro fatiador', desc: '3MF com as cores certas pro Bambu Studio / Orca, ou STL.' }
];

// Atalhos da tela Início: tarefas do dia a dia de quem imprime
const TAREFAS = [
  { ico: 'check', t: 'Preparar pra imprimir', d: 'Conserta, põe na mesa e confere tudo', acao: 'preparar' },
  { ico: 'formas', t: 'Criar peça com formas', d: 'Caixa, círculo, texto, furo…', acao: 'formas' },
  { ico: 'escudo', t: 'Consertar o arquivo', d: 'Buracos, faces viradas e sobras', acao: 'consertar' },
  { ico: 'tesoura', t: 'Cortar em duas partes', d: 'Com pino de encaixe', acao: 'corte' },
  { ico: 'separar', t: 'Separar um detalhe', d: 'Orelha, olho, acessório', acao: 'sep' },
  { ico: 'paleta', t: 'Separar por cor', d: 'Colorido sem AMS', acao: 'porCor' },
  { ico: 'texto', t: 'Nome ou logo', d: 'Frente e verso do chaveiro', acao: 'relevo' },
  { ico: 'deitar', t: 'Deitar pra imprimir', d: 'Maior face plana na mesa', acao: 'deitar' },
  { ico: 'regua', t: 'Mudar o tamanho', d: 'Em mm ou em %', acao: 'transf' },
  { ico: 'baixar', t: 'Mandar pro Bambu', d: '3MF com as cores certas', acao: 'exp' }
];

// nome amigável de cada cálculo (aparece no "calculando")
const NOMES_OP = {
  importar: 'Abrindo o arquivo', cortar: 'Cortando', separarDetalhe: 'Separando o detalhe', separarPorCor: 'Separando por cor',
  separarCascas: 'Separando as cascas', reparar: 'Consertando a malha', relevo: 'Aplicando o relevo', exportar3MF: 'Gerando o 3MF',
  exportarSTL: 'Gerando o STL', segmentar: 'Procurando as partes', unirSobrepostos: 'Unindo partes', removerInternos: 'Limpando sobras',
  escalarGeometria: 'Convertendo a medida', analisar: 'Analisando', suavizar: 'Suavizando'
};

export class Estudio {
  constructor(raiz, opcoes = {}) {
    injetarCSS();
    this.raiz = raiz;
    this.opcoes = opcoes;
    this.cena = new Cena();
    this.motor = opcoes.motor || new Motor();   // o gerador de chaveiro usa o mesmo motor (mesmos workers)
    this.ferramenta = 'navegar';
    this.adjCache = new WeakMap();
    this.diag = new Map();          // parte.id -> { rel, malha }
    this.segm = new Map();          // parte.id -> { rotulo, partes, malha }
    this.previaAtiva = null;
    this.ouvintes = new Map();
    this.secoes = {};
    this.montar();
    this.motor.aoMudar = (n, info) => this.atualizarMotor(n, info);
    this.motor.aoMudarAux = () => this.atualizarMotor(this.motor.ocupado, this.motor.principal.atual);
    // operação longa: etapa e % (a barra aparece só quando o motor informa)
    this.motor.aoProgresso = (f, etapa, canal) => { if (canal === this.motor.principal) { this._prog = { f, etapa }; if (this._tick) this._tick(); } };
    this.motor.iniciar().then(modo => { this.modoMotor = modo; this.atualizarMotor(0); });
  }

  on(ev, fn) { if (!this.ouvintes.has(ev)) this.ouvintes.set(ev, []); this.ouvintes.get(ev).push(fn); }
  emitir(ev, d) { (this.ouvintes.get(ev) || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } }); }

  /* ------------------------------------------------------------ DOM */
  montar() {
    const r = this.raiz;
    r.innerHTML = '';
    r.classList.add('e3d');
    const bt = (attrs, ico, rot, cls) => '<button type="button" class="e3d-bt ' + (cls || '') + '" ' + attrs + '>' + icone(ico, 17) + (rot ? '<span class="rot">' + rot + '</span>' : '') + '</button>';
    this.topo = el('div', { class: 'e3d-top', role: 'toolbar' });
    this.topo.innerHTML =
      '<div class="e3d-marca"><i>' + icone('cubo', 17) + '</i><span>Estúdio 3D</span></div>' +
      bt('data-b="abrir" title="Abrir STL, OBJ ou 3MF (ou arraste o arquivo pra tela)"', 'abrir', 'Abrir', 'primario') +
      bt('data-b="desfazer" title="Desfazer (Ctrl+Z)"', 'desfazer', '', 'so-ico') +
      bt('data-b="refazer" title="Refazer (Ctrl+Y)"', 'refazer', '', 'so-ico') +
      '<span class="grow"></span>' +
      '<div class="e3d-grupo" data-b="gizmos">' +
        bt('data-g="nenhum" title="Escolher peça (Esc)"', 'cursor', '<span class="rot-lg">Escolher</span>', 'ativo') +
        bt('data-g="mover" title="Mover (G)"', 'mover', '<span class="rot-lg">Mover</span>') +
        bt('data-g="girar" title="Girar (R)"', 'girar', '<span class="rot-lg">Girar</span>') +
        bt('data-g="escalar" title="Escalar (S)"', 'escalar', '<span class="rot-lg">Escalar</span>') +
      '</div>' +
      '<span class="grow"></span>' +
      bt('data-b="preparar" title="Confere e arruma tudo pra imprimir: conserta a malha, põe na mesa, confere tamanho, paredes finas e posição"', 'check', '<span class="rot-lg">Preparar pra imprimir</span>', 'destaque') +
      bt('data-b="organizar" title="Põe todos os objetos lado a lado na mesa"', 'organizar', '<span class="rot-lg">Organizar mesa</span>') +
      bt('data-b="tela" title="Tela cheia (mais espaço pro 3D)"', 'telaCheia', '', 'so-ico') +
      '<span class="e3d-motor" data-b="motor"><i></i><span>carregando motor…</span></span>';
    this.btDesfazer = this.topo.querySelector('[data-b=desfazer]');
    this.btRefazer = this.topo.querySelector('[data-b=refazer]');

    this.principalEl = el('div', { class: 'e3d-main' });
    this.trilho = el('div', { class: 'e3d-rail', role: 'navigation', 'aria-label': 'Ferramentas' });
    FERRAMENTAS.forEach((f, i) => {
      if (i === 1) this.trilho.appendChild(el('hr'));
      this.trilho.appendChild(el('button', { type: 'button', 'data-ferr': f.sec, title: f.titulo, html: icone(f.ico, 22) + '<span>' + f.rot + '</span>', onclick: () => this.abrirFerramenta(f.sec) }));
    });
    this.palco = el('div', { class: 'e3d-palco' });
    this.painel = el('div', { class: 'e3d-painel' });
    this.painelCab = el('div', { class: 'e3d-painel-cab' });
    this.painelCorpo = el('div', { class: 'e3d-painel-corpo' });
    this.painel.append(this.painelCab, this.painelCorpo);
    this.principalEl.append(this.trilho, this.palco, this.painel);
    r.append(this.topo, this.principalEl);
    this.inputArquivo = el('input', { type: 'file', multiple: true, accept: '.stl,.obj,.mtl,.3mf', style: 'display:none' });
    r.appendChild(this.inputArquivo);

    this.visor = new Visor(this.palco, this.cena);
    this.vazio = el('div', { class: 'e3d-vazio' });
    this.vazio.innerHTML = '<div class="caixa"><div class="ico">' + icone('abrir', 28) + '</div><h3>Arraste seu modelo aqui</h3>' +
      '<p>Abra um arquivo e escolha o que quer fazer: consertar, cortar, separar, pôr texto e mandar pro Bambu com as cores certas.</p>' +
      '<button type="button" class="btn primary" data-b="abrir2">Escolher arquivo</button>' +
      '<div class="formatos"><span>STL</span><span>OBJ + MTL</span><span>3MF</span><span>modelos de IA</span></div></div>';
    this.vazio.querySelector('[data-b=abrir2]').onclick = () => this.inputArquivo.click();
    this.objetosEl = el('div', { class: 'e3d-objetos e3d-vidro', style: 'display:none' });
    this.saudeEl = el('div', { class: 'e3d-saude e3d-vidro', title: 'Ver sugestões pra este modelo', onclick: () => this.abrirFerramenta('inicio') });
    this.vistasEl = el('div', { class: 'e3d-vistas e3d-vidro' });
    this.vistasEl.innerHTML =
      bt('data-b="enquadrar" title="Enquadrar a peça (F)"', 'enquadrar', '', 'so-ico') +
      '<span class="sep"></span>' +
      bt('data-v="iso" title="Vista 3D"', 'cubo', '3D') +
      '<button type="button" class="e3d-bt" data-v="frente" title="Vista de frente">Frente</button>' +
      '<button type="button" class="e3d-bt" data-v="topo" title="Vista de cima">Topo</button>' +
      '<button type="button" class="e3d-bt" data-v="direita" title="Vista de lado">Lado</button>' +
      '<span class="sep"></span>' +
      '<select data-b="modo" title="O que mostrar na peça">' +
        '<option value="cores">Cores</option><option value="normais">Avesso (vermelho)</option><option value="cascas">Cascas soltas</option>' +
        '<option value="problemas">Defeitos da malha</option><option value="espessura">Espessura</option><option value="partes">Partes detectadas</option></select>' +
      '<label class="chip" title="Mostrar os triângulos (W)"><input type="checkbox" data-b="arame">Arame</label>' +
      '<label class="chip" title="Sombreado facetado"><input type="checkbox" data-b="facetado">Facetado</label>' +
      '<label class="chip" title="Ímã: mover de 1 em 1 mm, girar de 15 em 15°"><input type="checkbox" data-b="ima">Ímã</label>';
    this.chkArame = this.vistasEl.querySelector('[data-b=arame]');
    this.hud = el('div', { class: 'e3d-hud e3d-vidro' });
    this.dica = el('div', { class: 'e3d-dica e3d-vidro', html: 'arrastar: girar · botão direito: mover · rodinha: zoom' });
    this.ocupadoEl = el('div', { class: 'e3d-ocupado e3d-vidro' });
    this.ocupadoEl.innerHTML = '<span class="roda"></span><div><span data-o="rot">Calculando…</span><small data-o="tempo">0,0 s</small><i class="barra" data-o="barra" style="display:none"><b></b></i></div><button type="button" class="btn" data-o="cancelar" style="display:none">Cancelar</button>';
    this.ocupadoEl.querySelector('[data-o=cancelar]').onclick = () => this.cancelarCalculo();
    this.previaEl = el('div', { class: 'e3d-previa e3d-vidro', style: 'display:none' });
    this.multiEl = el('div', { class: 'e3d-multi e3d-vidro', style: 'display:none' });
    this.palco.append(this.multiEl);
    // parte selecionada (olho, orelha…): as ações ficam logo ali, em cima do 3D
    this.acaoSelEl = el('div', { class: 'e3d-acaosel e3d-vidro', style: 'display:none', role: 'toolbar', 'aria-label': 'Parte selecionada' });
    this.palco.append(this.acaoSelEl);
    this.placasEl = el('div', { class: 'e3d-placas e3d-vidro' });
    this.palco.append(this.vazio, this.objetosEl, this.saudeEl, this.vistasEl, this.hud, this.dica, this.ocupadoEl, this.previaEl, this.placasEl);

    // início (tarefas + sugestões) e os quadros das ferramentas
    this.inicioEl = el('div', { class: 'e3d-inicio' });
    this.painelCorpo.appendChild(this.inicioEl);
    this.secoes.formas = montarFormas(this);
    this.secoes.modificar = montarModificar(this);
    this.secoes.esculpir = montarEsculpir(this);
    this.secoes.desenhar = montarDesenhar(this);
    this.secoes.diagnostico = montarDiagnostico(this);
    this.secoes.transformar = montarTransformar(this);
    this.secoes.selecionar = montarSelecionar(this);
    this.secoes.separar = montarSeparar(this);
    this.secoes.cortar = montarCortar(this);
    this.secoes.relevo = montarRelevo(this);
    this.secoes.exportar = montarExportar(this);
    for (const k in this.secoes) this.painelCorpo.appendChild(this.secoes[k].el);
    // um quadro aberto por vez; o trilho acompanha
    this.painel.addEventListener('toggle', ev => {
      const d = ev.target;
      if (d.tagName !== 'DETAILS') return;
      if (d.open) {
        this.painel.querySelectorAll('details[open]').forEach(x => { if (x !== d) x.open = false; });
        this.mostrarCabecalho(d.dataset.sec);
        this.garantirFurosSeFerramenta();
        this.emitir('secao', d.dataset.sec);
      } else {
        this.emitir('secao-fechou', d.dataset.sec);
        if (!this.painel.querySelector('details[open]')) this.mostrarCabecalho('inicio');
      }
    }, true);

    this.furados = new Map();
    this.visor.exibir = (o, p) => {
      if (o.papel === 'furo') return p.malha;
      const f = this.furados.get(o.id);
      if (!f || f.chave !== this.chaveFuros(o)) return p.malha;
      return f.malhas.get(p.id) || p.malha;
    };
    this.visor.pedirBVH = malha => this.motor.local ? Promise.resolve(null)
      : this.motor.rodar('bvh', { malha: { pos: malha.pos, idx: malha.idx } }, { canal: 'aux' }).catch(() => null);
    this.visor.on('secao', () => {});
    this.ligarBarra();
    this.ligarPalco();
    this.ligarAtalhos();
    this.cena.on('mudou', () => this.aoMudar());
    this.cena.on('selecao', () => this.aoSelecionar());
    this.visor.on('gizmo-fim', g => this.fimGizmo(g));
    this.visor.on('gizmo-mudou', () => this.atualizarHud());
    this.on('faces', ({ parte, n }) => this.renderAcaoSel(parte, n));
    this.on('previa-fim', () => { const p = this.parteAtual(); const m = p && this.visor.selecao(p.id); this.renderAcaoSel(p, m && m.length === p.malha.idx.length / 3 ? m.reduce((a, v) => a + v, 0) : 0); });
    this.cena.on('mudou', () => { const p = this.parteAtual(); const m = p && this.visor.selecao(p.id); if (!m || m.length !== p.malha.idx.length / 3) { this.acaoSelEl.style.display = 'none'; this.dica.style.visibility = ''; } });
    this.on('analisou', () => { this.renderSaude(); if (this.painel.classList.contains('inicio')) this.renderInicio(); });
    // tema claro/escuro do sistema
    new MutationObserver(() => this.visor.definirTema(document.documentElement.dataset.tema === 'escuro'))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    document.addEventListener('fullscreenchange', () => {
      const b = this.topo.querySelector('[data-b=tela]');
      const cheia = document.fullscreenElement === this.raiz;
      b.innerHTML = icone(cheia ? 'sairTela' : 'telaCheia', 17);
      b.title = cheia ? 'Sair da tela cheia (Esc)' : 'Tela cheia (mais espaço pro 3D)';
      this.visor.redimensionar();
    });
    this.aoMudar();
    // abre no quadro 1 (conferir) — o mesmo de antes; sem modelo, mostra o Início
    const d1 = this.secoes.diagnostico.el;
    if (d1.open) this.mostrarCabecalho('diag');
    this.abrirFerramenta(this.cena.objetos.length ? 'diag' : 'inicio');
    // botão direito no Estúdio: menu do sistema (quando o ERP oferece; o laboratório não tem)
    if (window.MenuContexto) window.MenuContexto.registrar(this.raiz, ev => this.menuDaArea(ev));
  }

  /* ------------------------------------------------------------ trilho / painel */
  abrirFerramenta(sec) {
    if (sec === 'inicio') {
      this.painel.querySelectorAll('details[open]').forEach(x => { x.open = false; });
      this.mostrarCabecalho('inicio');
      return;
    }
    const d = this.painel.querySelector('details[data-sec="' + sec + '"]');
    if (!d) return;
    if (!d.open) { d.open = true; d.dispatchEvent(new Event('toggle')); }
    this.mostrarCabecalho(sec);
  }
  mostrarCabecalho(sec) {
    const f = FERRAMENTAS.find(x => x.sec === sec) || FERRAMENTAS[0];
    this.trilho.querySelectorAll('button[data-ferr]').forEach(b => b.classList.toggle('ativo', b.dataset.ferr === f.sec));
    this.painelCab.innerHTML = '<div class="rot"><i>' + icone(f.ico, 19) + '</i><h3>' + f.titulo + '</h3></div><p>' + f.desc + '</p>';
    this.painel.classList.toggle('inicio', f.sec === 'inicio');
    if (f.sec === 'inicio') this.renderInicio();
    this.painelCorpo.scrollTop = 0;
  }

  renderInicio() {
    const h = this.inicioEl;
    h.innerHTML = '';
    const o = this.cena.objetoSel() || this.cena.objetos[0] || null;
    if (!o) {
      h.appendChild(el('div', { class: 'e3d-sugestoes' }, el('div', { class: 'e3d-sug dica' },
        el('i', { html: icone('abrir', 16) }),
        el('div', { class: 'txt' }, el('b', null, 'Comece abrindo um modelo'), 'Arraste o STL, OBJ ou 3MF pra área 3D.'),
        el('button', { class: 'btn primary', onclick: () => this.inputArquivo.click() }, 'Abrir'))));
    } else {
      const sug = calcularSugestoes(this, o);
      h.appendChild(el('div', { class: 'e3d-bloco-tit' }, 'Sugestões pra ' + o.nome));
      const lista = el('div', { class: 'e3d-sugestoes' });
      for (const s of sug) {
        lista.appendChild(el('div', { class: 'e3d-sug ' + s.tipo },
          el('i', { html: icone(s.ico, 16) }),
          el('div', { class: 'txt' }, el('b', null, s.titulo), s.texto || ''),
          s.botao ? el('button', { class: 'btn' + (s.tipo === 'ruim' || s.tipo === 'atencao' ? ' primary' : ''), onclick: () => this.executarTarefa(s.acao) }, s.botao) : null));
      }
      h.appendChild(lista);
    }
    h.appendChild(el('div', { class: 'e3d-bloco-tit' }, 'Tarefas'));
    const g = el('div', { class: 'e3d-tarefas' });
    for (const t of TAREFAS) {
      g.appendChild(el('button', { type: 'button', class: 'e3d-tarefa', 'data-tarefa': t.acao, disabled: !o && t.acao !== 'formas' ? true : null, onclick: () => this.executarTarefa(t.acao), html: '<i>' + icone(t.ico, 18) + '</i><b>' + t.t + '</b><span>' + t.d + '</span>' }));
    }
    h.appendChild(g);
  }

  // o que cada atalho/sugestão faz
  executarTarefa(acao) {
    const o = this.cena.objetoSel() || this.cena.objetos[0];
    if (o && !this.cena.objetoSel()) this.cena.selecionar(o.id, o.partes.length === 1 ? o.partes[0].id : null);
    switch (acao) {
      case 'consertar': this.abrirFerramenta('diag'); this.secoes.diagnostico.el.querySelector('[data-a=reparar]').click(); break;
      case 'analisar': this.abrirFerramenta('diag'); this.secoes.diagnostico.el.querySelector('[data-a=analisar]').click(); break;
      case 'deitar': this.abrirFerramenta('transf'); this.secoes.transformar.el.querySelector('[data-a=deitar]').click(); break;
      case 'naMesa': if (o) { this.cena.aplicar('Colocar na mesa', () => this.cena.colocarNaMesa(o)); } break;
      case 'porCor': {
        this.abrirFerramenta('sep');
        const b = this.secoes.separar.el.querySelector('[data-a="porCor"]');
        if (b) setTimeout(() => b.scrollIntoView({ block: 'center' }), 60);
        break;
      }
      case 'cascas': {
        this.abrirFerramenta('sep');
        const b = this.secoes.separar.el.querySelector('[data-a="cascas"]');
        if (b) setTimeout(() => b.scrollIntoView({ block: 'center' }), 60);
        break;
      }
      case 'espessura': this.definirModoVisual('espessura'); this.abrirFerramenta('diag'); break;
      case 'preparar': prepararParaImpressao(this); break;
      case 'unidade': this.abrirFerramenta('diag'); break;
      default: this.abrirFerramenta(acao);
    }
  }

  // bolinha de saúde no canto do 3D
  renderSaude() {
    const o = this.cena.objetoSel() || this.cena.objetos[0];
    const s = this.saudeEl;
    if (!o) { s.className = 'e3d-saude e3d-vidro'; return; }
    const sug = calcularSugestoes(this, o);
    const ruins = sug.filter(x => x.tipo === 'ruim').length, atencao = sug.filter(x => x.tipo === 'atencao').length;
    const medindo = sug.some(x => x.medindo);
    const tipo = medindo ? 'medindo' : ruins ? 'ruim' : atencao ? 'atencao' : 'bom';
    s.className = 'e3d-saude e3d-vidro on ' + tipo;
    s.innerHTML = '<i>' + (tipo === 'bom' ? icone('check', 13) : tipo === 'medindo' ? '…' : '!') + '</i><span>' +
      (medindo ? 'Conferindo a malha…' : ruins ? ruins + ' problema' + (ruins > 1 ? 's' : '') + ' pra resolver' : atencao ? atencao + ' sugest' + (atencao > 1 ? 'ões' : 'ão') : 'Pronto pra imprimir') + '</span>';
  }

  ligarBarra() {
    const clique = ev => {
      const t = ev.target.closest('button');
      if (!t) return;
      if (t.dataset.g) this.definirGizmo(t.dataset.g);
      else if (t.dataset.v) this.visor.vista(t.dataset.v);
      else if (t.dataset.b === 'abrir') this.inputArquivo.click();
      else if (t.dataset.b === 'desfazer') this.desfazer();
      else if (t.dataset.b === 'refazer') this.refazer();
      else if (t.dataset.b === 'enquadrar') this.enquadrar();
      else if (t.dataset.b === 'organizar') this.organizarMesa();
      else if (t.dataset.b === 'preparar') prepararParaImpressao(this);
      else if (t.dataset.b === 'tela') this.alternarTelaCheia();
    };
    this.topo.addEventListener('click', clique);
    this.vistasEl.addEventListener('click', clique);
    this.vistasEl.querySelector('[data-b=modo]').addEventListener('change', ev => this.definirModoVisual(ev.target.value));
    this.chkArame.addEventListener('change', ev => this.visor.definirArame(ev.target.checked));
    this.vistasEl.querySelector('[data-b=facetado]').addEventListener('change', ev => this.visor.definirSombreado(ev.target.checked ? 'facetado' : 'suave'));
    this.vistasEl.querySelector('[data-b=ima]').addEventListener('change', ev => this.visor.definirIma(ev.target.checked));
    this.inputArquivo.addEventListener('change', () => { const f = [...this.inputArquivo.files]; this.inputArquivo.value = ''; if (f.length) this.importarArquivos(f); });
  }

  alternarTelaCheia() {
    try {
      if (document.fullscreenElement === this.raiz) document.exitFullscreen();
      else if (this.raiz.requestFullscreen) this.raiz.requestFullscreen();
    } catch (e) { /* navegador sem tela cheia */ }
  }

  definirGizmo(m) {
    this.topo.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('ativo', x.dataset.g === m));
    this.visor.definirGizmo(m);
    if (m !== 'nenhum' && this.ferramenta !== 'navegar') this.definirFerramenta('navegar');
  }

  ligarPalco() {
    const cv = this.visor.renderer.domElement;
    let ini = null;
    // seta azul do corte: pega antes da câmera (fase de captura)
    let arrastandoCorte = null;
    this.palco.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || this.ferramenta !== 'corte' || this.previaAtiva || ev.target !== cv) return;
      if (!this.visor.acertouAlcaCorte(ev)) return;
      ev.stopPropagation(); ev.preventDefault();
      arrastandoCorte = ev.pointerId;
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
      this.visor.realcarAlcaCorte(true);
    }, true);
    cv.addEventListener('pointermove', ev => {
      if (arrastandoCorte != null) { this.emitir('corte-arrasto', this.visor.dDoArrasto(ev)); return; }
      if (this.ferramenta === 'corte' && !ev.buttons) {
        const em = this.visor.acertouAlcaCorte(ev);
        cv.style.cursor = em ? 'grab' : 'crosshair';
        this.visor.realcarAlcaCorte(em);
      }
    });
    const soltarCorte = ev => {
      if (arrastandoCorte == null) return false;
      arrastandoCorte = null;
      try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
      this.visor.realcarAlcaCorte(false);
      ini = null;
      return true;
    };
    cv.addEventListener('pointerup', ev => { if (soltarCorte(ev)) ev.stopImmediatePropagation(); }, true);
    cv.addEventListener('pointerdown', ev => {
      ini = { x: ev.clientX, y: ev.clientY, b: ev.button };
      if (ev.button === 2) this._direitoEm = performance.now();
      // Desenhar: pegar um ponto já marcado pra arrastar
      if (ev.button === 0 && this.ferramenta === 'desenhar' && !this.previaAtiva && this.secoes.desenhar.segurar(ev)) {
        this.arrastandoPonto = true;
        this.visor.controles.enabled = false;
        cv.setPointerCapture(ev.pointerId);
        return;
      }
      const pin = this.alvoPincel();
      if (ev.button === 0 && pin && !this.previaAtiva) {
        const hit = this.visor.intersectar(ev);
        if (hit) {
          this.pintando = true;
          this.visor.controles.enabled = false;
          cv.setPointerCapture(ev.pointerId);
          pin.pincel(hit, ev, true);
        }
        return;
      }
      // ARRASTAR A PEÇA na mesa (modo Escolher, como no Bambu Studio): segurou
      // em cima de uma peça e arrastou -> ela anda no plano da mesa (a altura
      // não muda). Arrastar no vazio continua girando a câmera.
      // (com a alça Mover ligada também: a seta move num eixo, o corpo na mesa)
      const gz = this.visor.gizmo;
      if (ev.button === 0 && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !this.previaAtiva && this.ferramenta === 'navegar' && (this.visor.modoGizmo === 'nenhum' || this.visor.modoGizmo === 'mover') && !(gz && (gz.axis || gz.dragging))) {
        const hit = this.visor.intersectar(ev);
        if (hit && this.cena.objeto(hit.objeto)) {
          const z = hit.ponto.z, p0 = this.visor.pontoNoPlano(ev, [0, 0, 1], z);
          if (p0) {
            this.arrasteObj = { id: hit.objeto, parte: hit.parte, z, p0: [p0.x, p0.y], x: ev.clientX, y: ev.clientY, ativo: false, pid: ev.pointerId };
            this.visor.controles.enabled = false;
          }
        }
      }
    });
    cv.addEventListener('pointermove', ev => {
      if (this.arrastandoPonto) { this.secoes.desenhar.mover(ev); return; }
      const a = this.arrasteObj;
      if (a) {
        if (!a.ativo) {
          if (Math.hypot(ev.clientX - a.x, ev.clientY - a.y) < 5) return;
          a.ativo = true;
          try { cv.setPointerCapture(a.pid); } catch (e) { /* ok */ }
          // arrastou uma peça fora da seleção: ela passa a ser a seleção
          if (!this.cena.objetosSel().some(o => o.id === a.id)) { const o = this.cena.objeto(a.id); this.cena.selecionar(a.id, o.partes.length === 1 ? o.partes[0].id : a.parte); }
          a.objs = this.cena.objetosSel().map(o => ({ o, t0: o.transform }));
          cv.style.cursor = 'grabbing';
        }
        const p = this.visor.pontoNoPlano(ev, [0, 0, 1], a.z);
        if (!p) return;
        a.d = [p.x - a.p0[0], p.y - a.p0[1]];
        const T = M4.translacao(a.d[0], a.d[1], 0);
        for (const { o, t0 } of a.objs) { const g = this.visor.grupos.get(o.id); if (g) this.visor.aplicarMatriz(g, M4.multiplicar(T, t0)); }
        this.visor.pedirRender();
        return;
      }
      const pin = this.alvoPincel();
      if (pin) {
        const hit = this.visor.intersectar(ev);
        pin.cursorPincel(hit);
        if (this.pintando && hit) pin.pincel(hit, ev, false);
      }
    });
    const fim = ev => {
      const a = this.arrasteObj;
      if (a) {
        this.arrasteObj = null;
        this.visor.controles.enabled = true;
        cv.style.cursor = '';
        try { cv.releasePointerCapture(a.pid); } catch (e) { /* ok */ }
        if (a.ativo) {
          ini = null;
          if (a.d && Math.hypot(a.d[0], a.d[1]) > 1e-6) {
            const T = M4.translacao(a.d[0], a.d[1], 0);
            this.cena.aplicar(a.objs.length > 1 ? 'Mover ' + a.objs.length + ' peças' : 'Mover', () => { for (const { o, t0 } of a.objs) o.transform = M4.multiplicar(T, t0); });
          } else this.visor.sincronizar();
          return;
        }
      }
      if (this.arrastandoPonto) {
        this.arrastandoPonto = false;
        this.visor.controles.enabled = true;
        try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
        if (this.secoes.desenhar.soltar()) { ini = null; return; }   // arrastou: não é clique
      }
      if (this.pintando) {
        this.pintando = false;
        this.visor.controles.enabled = true;
        try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
        const pin = this.alvoPincel(); if (pin) pin.fimPincel();
        ini = null;
        return;
      }
      if (!ini) return;
      const moveu = Math.hypot(ev.clientX - ini.x, ev.clientY - ini.y);
      if (moveu < 5 && ini.b === 0 && !this.visor.gizmo.dragging) this.clique(ev);
      // botão direito sem arrastar (arrastar com ele move a câmera): menu do Estúdio
      else if (moveu < 5 && ini.b === 2) this.abrirMenuContexto(ev);
      ini = null;
    };
    cv.addEventListener('pointerup', fim);
    cv.addEventListener('pointercancel', fim);
    cv.addEventListener('pointerleave', () => { const pin = this.alvoPincel(); if (pin) pin.cursorPincel(null); });
    cv.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      // clique direito do mouse: o menu abre ao SOLTAR (acima), igual em Windows, Mac e Linux
      if (this._direitoEm && performance.now() - this._direitoEm < 5000) { this._direitoEm = 0; return; }
      this.abrirMenuContexto(ev);   // tecla Menu / Shift+F10, ou Ctrl+clique no Mac
    });
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
      else if ((ev.ctrlKey || ev.metaKey) && k === 'a') { ev.preventDefault(); this.cena.selecionarTodos(); }
      else if ((ev.ctrlKey || ev.metaKey) && k === 'd') { ev.preventDefault(); this.duplicarSelecao(); }
      else if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      else if (k === 'escape') { if (this.previaAtiva) this.cancelarPrevia(); else if (this.ferramenta !== 'navegar') this.definirFerramenta('navegar'); else this.definirGizmo('nenhum'); }
      else if (k === 'delete') this.removerSelecao();
      else if (k === 'f') this.enquadrar();
      else if (k === 'g') this.definirGizmo('mover');
      else if (k === 'r') this.definirGizmo('girar');
      else if (k === 's') this.definirGizmo('escalar');
      else if (k === 'b') this.definirFerramenta('pincel');
      else if (k === 'w') { const c = this.chkArame; c.checked = !c.checked; this.visor.definirArame(c.checked); }
    });
  }

  visivel() { return !!this.raiz.offsetParent; }

  /* ------------------------------------------------------------ clique no 3D */
  // quem recebe o arraste de pincel: seleção (pintar) ou esculpir
  alvoPincel() { return this.ferramenta === 'pincel' ? this.secoes.selecionar : this.ferramenta === 'esculpir' ? this.secoes.esculpir : null; }

  clique(ev) {
    if (this.previaAtiva) return;
    if (this.ferramenta === 'desenhar') { this.emitir('clique-mesa', { ponto: this.visor.pontoNaMesa(ev), ev }); return; }
    const hit = this.visor.intersectar(ev);
    if (this.ferramenta === 'navegar' || !hit) {
      if (hit) this.cena.selecionar(hit.objeto, hit.parte, ev.shiftKey);
      else if (this.ferramenta === 'navegar' && !ev.shiftKey) {
        this.cena.selecionar(null, null);
        // clique numa placa: ela vira a ativa (peça nova entra nela)
        const k = this.visor.placaNoPonto(ev);
        if (k >= 0 && k !== this.cena.placaAtiva) this.ativarPlaca(k, false);
      }
      return;
    }
    if (hit.objeto !== this.cena.sel.objeto || hit.parte !== this.cena.sel.parte) this.cena.selecionar(hit.objeto, hit.parte);
    this.emitir('clique', { hit, ev });
  }

  definirFerramenta(f) {
    this.ferramenta = f;
    if (f !== 'navegar') this.definirGizmoSilencioso('nenhum');
    if (f !== 'pincel' && f !== 'esculpir') this.visor.mostrarPincel(null);
    this.visor.renderer.domElement.style.cursor = f === 'navegar' ? '' : 'crosshair';
    this.dica.innerHTML = f === 'pincel' ? 'arraste sobre a peça pra pintar · começando fora da peça, gira a vista'
      : f === 'navegar' ? 'arrastar: girar · botão direito: mover · rodinha: zoom'
      : f === 'corte' ? 'clique na peça: o corte vai até ali · arraste a seta azul · ↑ ↓ ajustam'
      : f === 'deitar' ? 'clique na face que deve ficar na mesa · Esc volta'
      : f === 'modificar' ? 'clique na borda ou na face da peça · Esc volta'
      : f === 'esculpir' ? 'arraste sobre a peça pra esculpir · começando fora dela, gira a vista'
      : f === 'desenhar' ? 'clique na mesa pra marcar pontos · clique no 1º pra fechar · arraste um ponto pra mudar'
      : 'clique na peça · Shift soma · Alt tira · Esc volta';
    this.vazio.style.display = this.cena.objetos.length || f === 'desenhar' ? 'none' : '';
    this.emitir('ferramenta', f);
  }
  definirGizmoSilencioso(m) {
    this.topo.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('ativo', x.dataset.g === m));
    this.visor.definirGizmo(m);
  }

  /* ------------------------------------------------------------ estado */
  aoMudar() {
    this.visor.atualizarMesa();
    this.renderPlacas();
    this.visor.sincronizar();
    this.renderCena();
    this.atualizarHud();
    // desenhando na mesa vazia: o cartão "Arraste seu modelo" sai da frente
    this.vazio.style.display = this.cena.objetos.length || this.ferramenta === 'desenhar' ? 'none' : '';
    this.objetosEl.style.display = this.cena.objetos.length ? '' : 'none';
    this.renderSaude();
    if (this.painel.classList.contains('inicio')) this.renderInicio();
    const bd = this.btDesfazer, br = this.btRefazer;
    bd.disabled = !this.cena.podeDesfazer(); br.disabled = !this.cena.podeRefazer();
    bd.title = this.cena.proximoDesfazer() ? 'Desfazer: ' + this.cena.proximoDesfazer() + ' (Ctrl+Z)' : 'Nada pra desfazer';
    br.title = this.cena.proximoRefazer() ? 'Refazer: ' + this.cena.proximoRefazer() + ' (Ctrl+Y)' : 'Nada pra refazer';
    if (this.visor.modo !== 'cores' && this.visor.modo !== 'normais') this.recalcularMapas();
    this.renderMulti();
    this.agendarFuros();
    this.emitir('mudou');
  }
  aoSelecionar() {
    this.visor.atualizarGizmo();
    this.visor.atualizarCaixaSel();
    this.renderCena();
    this.atualizarHud();
    this.renderSaude();
    if (this.painel.classList.contains('inicio')) this.renderInicio();
    this.renderMulti();
    this.garantirFurosSeFerramenta();
    this.encomendarAdj(this.parteAtual());
    this.emitir('selecao');
  }

  objetoAtual() { return this.cena.objetoSel(); }
  parteAtual() { return this.cena.parteSel(); }
  adj(malha) {
    let a = this.adjCache.get(malha);
    if (!a) { a = prepararAdjacencia(malha); this.adjCache.set(malha, a); }
    return a;
  }
  // peça grande selecionada: a vizinhança já vai sendo calculada no motor
  // auxiliar (o primeiro clique da seleção não trava a tela)
  encomendarAdj(p) {
    const m = p && p.malha;
    if (!m || this.motor.local || this.adjCache.has(m) || m.idx.length < 300000 || this._adjPedida === m) return;
    this._adjPedida = m;
    this.motor.rodar('adjacencia', { malha: { pos: m.pos, idx: m.idx } }, { canal: 'aux' })
      .then(a => { if (a && !this.adjCache.has(m)) this.adjCache.set(m, a); }, () => {})
      .finally(() => { if (this._adjPedida === m) this._adjPedida = null; });
  }

  atualizarHud() {
    const o = this.cena.objetoSel();
    if (!o) {
      const n = this.cena.objetos.length;
      const pl = this.cena.placas > 1 ? 'placa ' + (this.cena.placaAtiva + 1) + ' de ' + this.cena.placas + ' · ' : '';
      this.hud.textContent = pl + (n ? n + ' objeto(s) · clique numa peça' : 'mesa ' + this.cena.mesa.x + ' × ' + this.cena.mesa.y + ' mm');
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

  atualizarMotor(n, info) {
    const m = this.topo.querySelector('[data-b=motor]');
    const pronto = !!this.modoMotor;
    const aux = this.motor.aux ? this.motor.aux.ocupado : 0;
    m.className = 'e3d-motor ' + (n > 0 || aux > 0 ? 'ocupado' : pronto ? 'ok' : '');
    m.querySelector('span').textContent = !pronto ? 'carregando motor…' : n > 0 ? 'calculando…' : aux > 0 ? 'conferindo…' : (this.modoMotor === 'worker' ? 'motor pronto' : 'motor pronto (modo simples)');
    m.title = this.modoMotor === 'local' ? 'Rodando sem Web Worker: ' + (this.motor.motivoLocal || '') : 'Geometria calculada em segundo plano, sem travar a tela';
    const on = n > 0;
    this.ocupadoEl.classList.toggle('on', on);
    clearInterval(this._relogio);
    if (!info || !this._progDe || this._progDe !== info.desde) this._prog = null;
    this._progDe = info && info.desde;
    this._tick = null;
    if (on) {
      const ini = info && info.desde || performance.now();
      this.ocupadoEl.querySelector('[data-o=rot]').textContent = (info && NOMES_OP[info.op] || 'Calculando') + '…';
      const barra = this.ocupadoEl.querySelector('[data-o=barra]');
      const tick = () => {
        const s = (performance.now() - ini) / 1000, p = this._prog;
        this.ocupadoEl.querySelector('[data-o=tempo]').textContent = (p ? (p.etapa ? p.etapa + ' · ' : '') + Math.round(p.f * 100) + '% · ' : '') + fmt(s, 1) + ' s' + (n > 1 ? ' · ' + (n - 1) + ' na fila' : '');
        barra.style.display = p ? '' : 'none';
        if (p) barra.firstChild.style.width = Math.round(p.f * 100) + '%';
        this.ocupadoEl.querySelector('[data-o=cancelar]').style.display = s > 1.2 && !this.motor.local ? '' : 'none';
      };
      this._tick = tick;
      tick();
      this._relogio = setInterval(tick, 100);
    }
  }
  async cancelarCalculo() {
    if (await this.motor.cancelar()) avisar('Cálculo cancelado.', 'warn');
  }

  // roda uma operação do motor mostrando "calculando" e tratando erro
  async rodar(op, args, rotulo) {
    try {
      return await this.motor.rodar(op, args);
    } catch (e) {
      if (e && e.codigo === 'cancelado') throw e;
      console.error(e);
      avisar((rotulo ? rotulo + ': ' : '') + (e.message || e), 'warn');
      throw e;
    }
  }

  /* ------------------------------------------------------------ lista da cena */
  renderCena() {
    const p = this.objetosEl;
    const sel = this.cena.sel;
    p.innerHTML = '';
    const cab = el('div', { class: 'e3d-objetos-cab', title: 'Mostrar/esconder a lista' },
      el('span', { html: icone('camadas', 15) }), 'Objetos', el('span', { class: 'qtd' }, String(this.cena.objetos.length)), el('span', { class: 'seta', html: icone('seta', 15) }));
    // com um objeto só a lista fica recolhida (não cobre a peça); o clique do usuário manda
    const recolhida = () => this.listaRecolhida != null ? this.listaRecolhida : this.cena.objetos.length <= 1;
    cab.onclick = () => { this.listaRecolhida = !recolhida(); p.classList.toggle('recolhido', this.listaRecolhida); };
    p.classList.toggle('recolhido', recolhida());
    p.appendChild(cab);
    const lista = el('div', { class: 'e3d-objetos-lista' });
    p.appendChild(lista);
    if (!this.cena.objetos.length) return;
    for (const o of this.cena.objetos) {
      const box = el('div', { class: 'e3d-obj' + (o.id === sel.objeto ? ' sel' : this.cena.multi.includes(o.id) ? ' multi' : '') + (o.papel === 'furo' ? ' furo' : ''), 'data-obj': o.id });
      const c = this.cena.caixaExata(o);
      const cabO = el('div', { class: 'e3d-obj-cab', title: 'Clique pra escolher · duplo clique renomeia' },
        o.papel === 'furo' ? el('span', { class: 'e3d-tag-furo', title: 'Furo: tira material de quem atravessa' }, 'furo') : el('span', { class: 'e3d-bola', style: 'background:' + (o.partes[0] ? o.partes[0].cor : '#999') }),
        el('span', { class: 'nome' }, o.nome),
        el('span', { class: 'med' }, c ? fmt(c.tam[0], 0) + '×' + fmt(c.tam[1], 0) + '×' + fmt(c.tam[2], 0) : ''),
        el('button', { class: 'e3d-ico', title: o.visivel ? 'Esconder' : 'Mostrar', html: o.visivel ? ICONES.olho : ICONES.olhoFechado, onclick: ev => { ev.stopPropagation(); this.cena.aplicar(o.visivel ? 'Esconder objeto' : 'Mostrar objeto', () => { o.visivel = !o.visivel; }); } }),
        el('button', { class: 'e3d-ico', title: 'Duplicar', html: icone('duplicar', 14), onclick: ev => { ev.stopPropagation(); this.duplicarObjeto(o.id); } }),
        el('button', { class: 'e3d-ico', title: 'Excluir (Delete)', html: icone('lixo', 14), onclick: ev => { ev.stopPropagation(); this.removerObjeto(o.id); } }));
      cabO.addEventListener('click', ev => this.cena.selecionar(o.id, o.partes.length === 1 ? o.partes[0].id : null, ev.shiftKey));
      cabO.addEventListener('dblclick', () => this.renomear(o));
      box.appendChild(cabO);
      if (o.partes.length > 1) {
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
      lista.appendChild(box);
    }
    const acoes = el('div', { class: 'e3d-botoes' },
      el('button', { class: 'btn', title: 'Todos os objetos viram peças de um objeto só (montagem multicor)', onclick: () => this.juntarObjetos() }, 'Juntar'),
      el('button', { class: 'btn', title: 'Cada peça do objeto escolhido vira um objeto (imprimir separado)', onclick: () => this.separarPecasEmObjetos() }, 'Peças → objetos'),
      el('button', { class: 'btn danger', onclick: () => this.limparCena() }, 'Limpar'));
    lista.appendChild(acoes);
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
      // arquivo com várias placas (projeto do Bambu, ou nosso "tudo num
      // arquivo"): cada peça continua na sua placa, com as placas criadas
      let nArq = 0;
      if (novos.length > 1 && opc.centralizar === undefined) {
        for (let n = 2; n <= 36; n++) { const ks = novos.map(o => this.cena.placaDe(o, n)); if (ks.every(k => k >= 0)) { if (ks.some(k => k > 0)) nArq = n; break; } }
      }
      if (nArq) {
        const nFinal = Math.max(this.cena.placas, nArq);
        for (const o of novos) {
          const k = this.cena.placaDe(o, nArq), a = this.cena.origemPlaca(k, nArq), b = this.cena.origemPlaca(k, nFinal);
          if (a[0] !== b[0] || a[1] !== b[1]) o.transform = M4.multiplicar(M4.translacao(b[0] - a[0], b[1] - a[1], 0), o.transform);
        }
        this.cena.definirPlacas(nFinal);
      }
      for (const o of novos) {
        const c = this.cena.caixaExata(o);
        // fora de todas as placas: vai pro meio da placa ativa
        const k = c ? this.cena.placaDoPonto((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2) : -1;
        const po = k >= 0 ? this.cena.origemPlaca(k) : null;
        const fora = !c || k < 0 || c.min[0] < po[0] - 1 || c.min[1] < po[1] - 1 || c.max[0] > po[0] + this.cena.mesa.x + 1 || c.max[1] > po[1] + this.cena.mesa.y + 1;
        if (nArq) { if (opc.naMesa !== false) this.cena.colocarNaMesa(o); }
        else if (opc.centralizar || (fora && opc.centralizar !== false)) this.cena.centralizar(o);
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
    const d = novoObjeto({ nome: o.nome + ' (cópia)', transform: M4.multiplicar(M4.translacao(c ? c.tam[0] + 6 : 10, 0, 0), o.transform), papel: o.papel, forma: o.forma, partes: o.partes.map(p => ({ ...p, id: undefined })) });
    // a seleção passa pra CÓPIA (só ela): senão Excluir logo depois apagava as duas
    this.cena.aplicar('Duplicar', () => { this.cena.objetos.push(d); this.cena.sel = { objeto: d.id, parte: d.partes.length === 1 ? d.partes[0].id : null }; this.cena.multi = [d.id]; });
    return d;
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
  // ORGANIZAR: tudo lado a lado; não coube, vai pra próxima placa (cria
  // placa nova sozinho). soPlaca: só as peças daquela placa.
  organizarMesa(soPlaca = null) {
    if (!this.cena.objetos.length) return;
    let r;
    this.cena.aplicar(soPlaca == null ? 'Organizar mesa' : 'Organizar placa ' + (soPlaca + 1), () => { r = this.cena.organizarMesa(6, soPlaca); });
    if (r.novas) avisar('Não coube tudo numa placa: ' + (r.novas === 1 ? 'criei a placa ' + r.placas : 'criei ' + r.novas + ' placas novas (agora são ' + r.placas + ')') + '. Ctrl+Z desfaz.');
    if (r.grandes.length) avisar(r.grandes.join(', ') + (r.grandes.length > 1 ? ' são maiores' : ' é maior') + ' que a mesa: corte em partes (Cortar) ou reduza.', 'warn');
    this.enquadrar();
  }

  /* ------------------------------------------------------------ placas */
  renderPlacas() {
    const n = this.cena.placas, a = this.cena.placaAtiva, b = this.placasEl;
    b.innerHTML = '';
    b.append(el('span', { class: 'rot' }, 'Placa'));
    for (let k = 0; k < n; k++) {
      const cnt = this.cena.objetosDaPlaca(k).length;
      b.append(el('button', { type: 'button', class: 'btn mini' + (k === a ? ' ativa' : ''), 'data-placa': String(k), title: 'Placa ' + (k + 1) + ' — ' + cnt + ' peça(s)' + (k === a ? ' (peça nova entra aqui)' : ''), onclick: () => this.ativarPlaca(k, true) }, String(k + 1)));
    }
    b.append(el('button', { type: 'button', class: 'btn mini', 'data-b': 'maisPlaca', title: 'Adicionar placa', onclick: () => this.novaPlaca() }, '+'));
    if (n > 1 && !this.cena.objetosDaPlaca(a).length) b.append(el('button', { type: 'button', class: 'btn mini', 'data-b': 'tirarPlaca', title: 'Tirar a placa ' + (a + 1) + ' (está vazia)', onclick: () => this.tirarPlaca(a) }, '✕'));
  }
  ativarPlaca(k, enquadrar) {
    if (k < 0 || k >= this.cena.placas) return;
    this.cena.placaAtiva = k;
    this.visor.atualizarMesa();
    this.renderPlacas(); this.atualizarHud();
    if (enquadrar) this.visor.enquadrarPlaca(k);
  }
  novaPlaca() {
    this.cena.aplicar('Nova placa', () => this.cena.adicionarPlaca());
    this.visor.enquadrarPlaca(this.cena.placaAtiva);
    avisar('Placa ' + this.cena.placas + ' criada — peça nova entra nela. Pra levar uma peça: Ajustar → Placa.');
  }
  tirarPlaca(k) {
    if (this.cena.objetosDaPlaca(k).length) { avisar('Tire as peças da placa ' + (k + 1) + ' antes.', 'warn'); return; }
    this.cena.aplicar('Tirar placa ' + (k + 1), () => this.cena.removerPlaca(k));
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
    const outros = modo === 'mover' ? this.cena.objetosSel().filter(x => x !== o) : [];
    const delta = M4.multiplicar(t, M4.inverter(o.transform));
    this.cena.aplicar(modo === 'girar' ? 'Girar' : modo === 'escalar' ? 'Escalar' : outros.length ? 'Mover ' + (outros.length + 1) + ' peças' : 'Mover', () => {
      o.transform = t;
      for (const x of outros) x.transform = M4.multiplicar(delta, x.transform);
    });
  }

  /* ------------------------------------------------------------ modelagem simples */
  definirPapel(o, papel) {
    if (!o || o.papel === papel) return;
    this.cena.aplicar(papel === 'furo' ? 'Usar ' + o.nome + ' como furo' : 'Usar ' + o.nome + ' como sólido', () => { o.papel = papel; });
    if (papel === 'furo') avisar('Agora ' + o.nome + ' é um furo: onde ele atravessar outra peça, sai material.');
  }
  duplicarSelecao() {
    const copias = this.cena.objetosSel().map(o => this.duplicarObjeto(o.id)).filter(Boolean);
    if (copias.length > 1) { this.cena.multi = copias.map(c => c.id); this.cena.emitir('selecao', this.cena.sel); }
  }
  removerSelecao() {
    const objs = this.cena.objetosSel();
    if (!objs.length) return;
    if (objs.length === 1) { this.removerObjeto(objs[0].id); return; }
    const ids = new Set(objs.map(o => o.id));
    this.cena.aplicar('Excluir ' + objs.length + ' peças', () => { this.cena.objetos = this.cena.objetos.filter(o => !ids.has(o.id)); this.cena.sel = { objeto: null, parte: null }; this.cena.multi = []; });
  }
  duplicarEmSerie(o, n, passo) {
    if (!o || n < 1) return;
    const ts = duplicarEmSerie(o.transform, Math.min(100, Math.round(n)), passo);
    const copias = ts.map((t, k) => novoObjeto({ nome: o.nome + ' ' + (k + 2), transform: t, papel: o.papel, forma: o.forma, partes: o.partes.map(p => ({ ...p, id: undefined })) }));
    this.cena.aplicar('Duplicar em série (' + copias.length + ')', () => {
      this.cena.objetos.push(...copias);
      this.cena.multi = [o.id, ...copias.map(c => c.id)];
    });
  }
  alinharSelecao(modo) {
    const objs = this.cena.objetosSel();
    if (objs.length < 2) { avisar('Escolha pelo menos duas peças (Shift + clique).', 'warn'); return; }
    const caixas = objs.map(o => this.cena.caixaExata(o));
    const d = alinhar(caixas, modo);
    this.cena.aplicar('Alinhar', () => { objs.forEach((o, k) => { const [x, y, z] = d[k]; if (x || y || z) o.transform = M4.multiplicar(M4.translacao(x, y, z), o.transform); }); });
  }
  // unir / tirar uma da outra / parte comum (geometria de verdade, no motor)
  async combinarSelecao(modo) {
    const objs = this.cena.objetosSel();
    if (objs.length < 2) { avisar('Escolha pelo menos duas peças (Shift + clique).', 'warn'); return; }
    const base = objs[0];
    const rotulo = modo === 'unir' ? 'Unir' : modo === 'subtrair' ? 'Tirar ' + objs.slice(1).map(o => o.nome).join(', ') + ' de ' + base.nome : 'Parte comum';
    let r;
    try { r = await this.rodar('combinar', { objetos: objs.map(o => this.paraMotor(o)), modo, opc: { base: 0 } }, rotulo); } catch (e) { return; }
    const novo = novoObjeto({ nome: r.nome, transform: r.transform, partes: r.partes });
    const ids = new Set(objs.map(o => o.id));
    this.cena.aplicar(rotulo, () => {
      const i = this.cena.objetos.findIndex(o => ids.has(o.id));
      this.cena.objetos = this.cena.objetos.filter(o => !ids.has(o.id));
      this.cena.objetos.splice(Math.max(0, i), 0, novo);
      this.cena.sel = { objeto: novo.id, parte: novo.partes.length === 1 ? novo.partes[0].id : null };
      this.cena.multi = [novo.id];
    });
    avisar(rotulo + ' — feito (dá pra desfazer).');
  }
  agruparSelecao() {
    const objs = this.cena.objetosSel();
    if (objs.length < 2) return;
    const ref = objs[0], inv = M4.inverter(ref.transform);
    const partes = [];
    for (const o of objs) {
      const rel = M4.multiplicar(inv, o.transform);
      for (const p of o.partes) partes.push({ ...p, id: undefined, nome: o.partes.length === 1 ? o.nome : p.nome, malha: M4.ehIdentidade(rel) ? p.malha : transformar(p.malha, rel) });
    }
    const novo = novoObjeto({ nome: ref.nome + ' (grupo)', transform: ref.transform, partes });
    const ids = new Set(objs.map(o => o.id));
    this.cena.aplicar('Agrupar', () => {
      this.cena.objetos = this.cena.objetos.filter(o => !ids.has(o.id));
      this.cena.objetos.push(novo);
      this.cena.sel = { objeto: novo.id, parte: null }; this.cena.multi = [novo.id];
    });
  }

  // barra que aparece com 2+ peças escolhidas
  renderMulti() {
    const objs = this.cena.objetosSel();
    const b = this.multiEl;
    const on = objs.length >= 2 && !this.previaAtiva;
    this.raiz.classList.toggle('com-multi', on);
    if (!on) { b.style.display = 'none'; return; }
    b.style.display = 'flex';
    b.innerHTML = '';
    const temFuro = this.cena.objetos.some(o => o.papel === 'furo');
    const base = objs[0], resto = objs.slice(1);
    b.append(
      el('b', null, objs.length + ' peças'),
      el('button', { class: 'btn primary', title: 'Vira uma peça só (furos tiram material)', onclick: () => this.combinarSelecao('unir') }, 'Unir'),
      el('button', { class: 'btn', title: 'Tira ' + resto.map(o => o.nome).join(', ') + ' de ' + base.nome, onclick: () => this.combinarSelecao('subtrair') }, 'Tirar ', el('span', { class: 'u' }, resto.length === 1 ? resto[0].nome : resto.length + ' peças'), ' de ', el('span', { class: 'u' }, base.nome)),
      el('button', { class: 'btn so-ico', title: 'Trocar quem fica e quem sai', html: '⇄', onclick: () => { this.cena.multi = [...this.cena.multi.slice(1), this.cena.multi[0]]; this.renderMulti(); } }),
      el('button', { class: 'btn', title: 'Fica só onde as peças se encostam', onclick: () => this.combinarSelecao('intersectar') }, 'Parte comum'),
      el('button', { class: 'btn', title: 'Várias peças num objeto só, cada uma com sua cor', onclick: () => this.agruparSelecao() }, 'Agrupar'),
      this.botaoAlinhar(),
      ...(temFuro ? [el('button', { class: 'btn', title: 'Os furos passam a fazer parte da geometria', onclick: () => this.aplicarFurosAgora() }, 'Aplicar furos')] : []));
  }
  botaoAlinhar() {
    const w = el('div', { class: 'e3d-alinhar' });
    const pop = el('div', { class: 'e3d-alinhar-pop e3d-vidro' });
    const op = [['esq', 'Esquerda'], ['centroX', 'Centro (X)'], ['dir', 'Direita'], ['frente', 'Frente'], ['centroY', 'Centro (Y)'], ['tras', 'Trás'], ['base', 'Embaixo'], ['centroZ', 'Meio (Z)'], ['topo', 'Em cima'], ['distribuirX', 'Espalhar igual (X)'], ['distribuirY', 'Espalhar igual (Y)'], ['emCima', 'Empilhar uma na outra']];
    for (const [m, t] of op) pop.appendChild(el('button', { class: 'btn', 'data-alinhar': m, onclick: () => { pop.classList.remove('on'); this.alinharSelecao(m); } }, t));
    w.append(el('button', { class: 'btn', onclick: ev => { ev.stopPropagation(); pop.classList.toggle('on'); } }, 'Alinhar ▾'), pop);
    return w;
  }

  /* ------------------------------------------------------------ furos ao vivo */
  idMalha(m) { if (!this._idsM) { this._idsM = new WeakMap(); this._seqM = 0; } let i = this._idsM.get(m); if (!i) { i = ++this._seqM; this._idsM.set(m, i); } return i; }
  chaveFuros(o) {
    const furos = this.cena.objetos.filter(f => f.papel === 'furo' && f.visivel);
    return Array.from(o.transform).join(',') + '|' + o.partes.map(p => this.idMalha(p.malha)).join(',') + '|' +
      furos.map(f => f.id + ':' + Array.from(f.transform).join(',') + ':' + f.partes.map(p => this.idMalha(p.malha)).join(',')).join(';');
  }
  agendarFuros() { clearTimeout(this._tFuros); this._tFuros = setTimeout(() => this.atualizarFuros(), 120); }
  async atualizarFuros() {
    const furos = this.cena.objetos.filter(o => o.papel === 'furo' && o.visivel);
    const toca = (a, b) => a && b && a.min.every((v, i) => v <= b.max[i] + 0.01) && b.min.every((v, i) => v <= a.max[i] + 0.01);
    let mudou = false;
    for (const o of this.cena.objetos) {
      if (o.papel === 'furo') continue;
      const chave = this.chaveFuros(o);
      const f = this.furados.get(o.id);
      if (f && f.chave === chave) continue;
      const co = this.cena.caixaExata(o);
      const usados = furos.filter(x => toca(co, this.cena.caixaExata(x)));
      if (!usados.length) { if (f) { this.furados.delete(o.id); mudou = true; } continue; }
      let r = null;
      try { r = await this.motor.rodar('furar', { alvo: this.paraMotor(o), furos: usados.map(x => this.paraMotor(x)) }, { canal: 'aux' }); } catch (e) { r = null; }
      if (this.chaveFuros(o) !== chave || !this.cena.objeto(o.id)) continue;   // mudou enquanto calculava
      const malhas = new Map();
      if (r) o.partes.forEach((p, i) => { if (r.partes[i] && r.partes[i].malha !== undefined) malhas.set(p.id, r.partes[i].malha); });
      this.furados.set(o.id, { chave, malhas, furos: usados.map(x => x.id) });
      mudou = true;
    }
    for (const id of [...this.furados.keys()]) if (!this.cena.objeto(id)) this.furados.delete(id);
    if (mudou) this.visor.sincronizar();
  }
  // os furos passam a ser geometria (e os objetos-furo usados saem da mesa)
  async aplicarFurosAgora(soDe) {
    const furos = this.cena.objetos.filter(o => o.papel === 'furo' && o.visivel);
    if (!furos.length) return false;
    const alvos = this.cena.objetos.filter(o => o.papel !== 'furo' && (!soDe || soDe.includes(o.id)));
    const res = [];
    for (const o of alvos) {
      let r;
      try { r = await this.rodar('furar', { alvo: this.paraMotor(o), furos: furos.map(x => this.paraMotor(x)) }, 'Aplicar furos'); } catch (e) { return false; }
      if (r) res.push({ o, r });
    }
    if (!res.length) { avisar('Nenhum furo encosta nas peças.', 'warn'); return false; }
    const usados = new Set(); res.forEach(({ r }) => r.furosUsados.forEach(i => usados.add(furos[i].id)));
    this.cena.aplicar('Aplicar furos', () => {
      for (const { o, r } of res) o.partes = o.partes.map((p, i) => r.partes[i] === null ? null : { ...p, malha: r.partes[i].malha }).filter(Boolean);
      // o furo só sai da mesa se não fura mais nenhuma outra peça
      const outrosAlvos = this.cena.objetos.filter(o => o.papel !== 'furo' && !res.some(x => x.o === o));
      this.cena.objetos = this.cena.objetos.filter(o => !(usados.has(o.id) && !outrosAlvos.some(a => this.furados.get(a.id) && (this.furados.get(a.id).furos || []).includes(o.id))));
    });
    this.furados.clear();
    avisar('Furos aplicados na peça (dá pra desfazer).');
    return true;
  }
  // ferramentas que usam as faces da peça trabalham na peça já furada
  garantirFurosSeFerramenta() {
    const d = this.painel.querySelector('details[open]');
    if (!d || !['sel', 'sep', 'corte', 'relevo', 'diag'].includes(d.dataset.sec)) return;
    const o = this.cena.objetoSel();
    if (!o || o.papel === 'furo') return;
    const f = this.furados.get(o.id);
    if (f && f.chave === this.chaveFuros(o) && f.malhas.size) this.aplicarFurosAgora([o.id]);
  }

  /* ------------------------------------------------------------ menu do botão direito */
  // No 3D: em cima de uma peça, ela é escolhida e o menu mostra o que fazer com ela;
  // no vazio, as ações da cena. As ações são as mesmas dos botões e atalhos.
  abrirMenuContexto(ev) {
    const M = window.MenuContexto;
    if (!M || this.previaAtiva) return;
    const teclado = M.porTeclado ? M.porTeclado() : !ev.clientX && !ev.clientY;
    const hit = teclado ? null : this.visor.intersectar(ev);
    if (hit && !this.cena.objetosSel().some(o => o.id === hit.objeto)) this.cena.selecionar(hit.objeto, hit.parte);
    const r = this.visor.renderer.domElement.getBoundingClientRect();
    const deObjeto = hit || (teclado && this.cena.objetoSel());
    M.abrir(deObjeto ? this.itensObjeto() : this.itensCena(), teclado ? r.left + r.width / 2 : ev.clientX, teclado ? r.top + r.height / 2 : ev.clientY, { teclado });
  }
  // fora do 3D (lista de objetos, painel): a lista mostra o menu da peça; o resto, o da cena
  menuDaArea(ev) {
    if (ev.target === this.visor.renderer.domElement) return 'proprio';
    if (this.previaAtiva) return [];
    const linha = ev.target.closest && ev.target.closest('.e3d-obj[data-obj]');
    if (linha) {
      const o = this.cena.objetos.find(x => String(x.id) === linha.dataset.obj);
      if (o && !this.cena.objetosSel().includes(o)) this.cena.selecionar(o.id, o.partes.length === 1 ? o.partes[0].id : null);
      return this.itensObjeto();
    }
    return this.itensCena();
  }
  itensObjeto() {
    const sel = this.cena.objetosSel(), o = this.cena.objetoSel(), varios = sel.length > 1;
    if (!sel.length) return this.itensCena();
    return [
      { rot: 'Duplicar', atalho: 'Ctrl+D', fn: () => this.duplicarSelecao() },
      { rot: 'Renomear…', desativado: varios || !o, fn: () => this.renomear(o) },
      { rot: 'Esconder', fn: () => this.cena.aplicar(varios ? 'Esconder ' + sel.length + ' peças' : 'Esconder objeto', () => { sel.forEach(x => { x.visivel = false; }); }) },
      { rot: 'Enquadrar', atalho: 'F', fn: () => this.enquadrar() },
      '-',
      ...(varios ? [{ rot: 'Unir em uma peça', fn: () => this.combinarSelecao('unir') }] : []),
      { rot: 'Cortar com encaixe…', desativado: varios, fn: () => this.abrirFerramenta('corte') },
      { rot: 'Separar um detalhe…', desativado: varios, fn: () => this.abrirFerramenta('sep') },
      { rot: 'Separar por cor…', desativado: varios, fn: () => this.executarTarefa('porCor') },
      { rot: 'Cor e medidas…', desativado: varios, fn: () => this.abrirFerramenta('transf') },
      { rot: 'Preparar pra imprimir', fn: () => prepararParaImpressao(this) },
      '-',
      { rot: varios ? 'Excluir ' + sel.length + ' peças' : 'Excluir', atalho: 'Delete', perigo: true, fn: () => this.removerSelecao() }
    ];
  }
  itensCena() {
    const tem = this.cena.objetos.length > 0, escondidos = this.cena.objetos.filter(o => !o.visivel);
    return [
      { rot: 'Desfazer', atalho: 'Ctrl+Z', desativado: !this.cena.podeDesfazer(), fn: () => this.desfazer() },
      { rot: 'Refazer', atalho: 'Ctrl+Y', desativado: !this.cena.podeRefazer(), fn: () => this.refazer() },
      '-',
      { rot: 'Selecionar tudo', atalho: 'Ctrl+A', desativado: !tem, fn: () => this.cena.selecionarTodos() },
      { rot: 'Enquadrar tudo', atalho: 'F', desativado: !tem, fn: () => { this.cena.selecionar(null, null); this.enquadrar(); } },
      ...(escondidos.length ? [{ rot: 'Mostrar ' + (escondidos.length > 1 ? 'as ' + escondidos.length + ' escondidas' : 'a peça escondida'), fn: () => this.cena.aplicar('Mostrar peças', () => { escondidos.forEach(x => { x.visivel = true; }); }) }] : []),
      { rot: 'Organizar mesa', desativado: !tem, fn: () => this.organizarMesa() },
      '-',
      { rot: 'Adicionar forma…', fn: () => this.abrirFerramenta('formas') },
      { rot: 'Abrir arquivo…', fn: () => this.inputArquivo.click() }
    ];
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
        this.abrirFerramenta('inicio');
        avisar(f.name + ': ' + fmtInt(r.triangulos) + ' triângulos, ' + r.objetos.length + ' objeto(s)');
      } catch (e) { /* já avisado */ }
    }
  }

  /* ------------------------------------------------------------ visualização */
  definirModoVisual(m) {
    this.vistasEl.querySelector('[data-b=modo]').value = m;
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
    // alerta: o que a pessoa pediu e NÃO saiu (ex.: conector que não coube) — em destaque
    if (cfg.alerta) this.previaEl.appendChild(el('div', { class: 'e3d-nota aviso', 'data-a': 'alerta', style: 'flex-basis:100%;margin:4px 0 0;font-weight:600' }, cfg.alerta));
    if (cfg.notas && cfg.notas.length) this.previaEl.appendChild(el('div', { style: 'flex-basis:100%;font-size:11.5px;color:var(--warn)' }, cfg.notas.join(' · ')));
    this.previaEl.style.display = 'flex';
    this.multiEl.style.display = 'none';
    this.acaoSelEl.style.display = 'none';
    this.dica.style.visibility = '';
  }

  // barra da parte selecionada: tamanho + Separar / com pino / limpar
  renderAcaoSel(parte, n) {
    const b = this.acaoSelEl;
    const mask = parte && this.visor.selecao(parte.id);
    if (!n || !mask || this.previaAtiva || mask.length !== parte.malha.idx.length / 3) { b.style.display = 'none'; this.dica.style.visibility = ''; return; }
    this.dica.style.visibility = 'hidden';     // a barra fica no lugar da dica
    const pos = parte.malha.pos, idx = parte.malha.idx;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let t = 0; t < mask.length; t++) {
      if (!mask[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k] * 3;
        if (pos[v] < x0) x0 = pos[v]; if (pos[v] > x1) x1 = pos[v];
        if (pos[v + 1] < y0) y0 = pos[v + 1]; if (pos[v + 1] > y1) y1 = pos[v + 1];
        if (pos[v + 2] < z0) z0 = pos[v + 2]; if (pos[v + 2] > z1) z1 = pos[v + 2];
      }
    }
    const tam = Math.max(x1 - x0, y1 - y0, z1 - z0);
    b.innerHTML = '';
    b.append(
      el('span', { class: 'tit', html: icone('check', 15) + ' <b>Parte selecionada</b> <span class="u">~' + fmt(tam, 1) + ' mm · ' + fmtInt(n) + ' faces</span>' }),
      el('button', { type: 'button', class: 'btn primary', 'data-a': 'separar', onclick: () => { this.abrirFerramenta('sep'); this.secoes.separar.separar({}); } }, 'Separar'),
      el('button', { type: 'button', class: 'btn', 'data-a': 'pino', title: 'Separa com pino e furo pra encaixar de volta', onclick: () => { this.abrirFerramenta('sep'); this.secoes.separar.separar({ conector: 'cilindrico' }); } }, 'Separar com pino'),
      el('button', { type: 'button', class: 'btn so-ico', 'aria-label': 'Limpar seleção', title: 'Limpar seleção (Esc)', html: icone('x', 14), onclick: () => { this.visor.definirSelecao(parte.id, null); this.emitir('faces', { parte, n: 0 }); } }));
    b.style.display = 'flex';
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
  paraMotor(o) { return { nome: o.nome, transform: o.transform, papel: o.papel || 'solido', partes: o.partes.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta })) }; }
  parteParaMotor(p) { return { nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }; }
}

export { esc };

// GERADOR DE CHAVEIRO — mesma casca, visor 3D e componentes do Estúdio.
// Fluxo: logo -> análise automática (no worker) -> chaveiro pronto na hora ->
// personalizar (opcional) -> baixar 3MF pro Bambu / abrir no Estúdio.
// A prévia é a própria peça que vai pro arquivo (mesma malha, mesmas cores).
import * as THREE from 'three';
import { Visor } from './visor.js';
import { Cena, novoObjeto } from './cena.js';
import { injetarCSS } from './estilo.js';
import { icone } from './icones.js';
import { el, esc, fmt, baixar, nomeArquivo, avisar, lerNumero } from './util.js';
import * as M4 from '../core/mat4.js';
import { IMPRESSORAS } from '../../gerador/perfis.js';

// PLA Basic da Bambu (nome e cor do carretel)
const FILAMENTOS = [
  ['Branco', '#FFFFFF'], ['Preto', '#000000'], ['Cinza', '#8E9089'], ['Prata', '#A6A9AA'], ['Bege', '#F7E6DE'],
  ['Vermelho', '#C12E1F'], ['Laranja', '#FF6A13'], ['Amarelo', '#F4EE2A'], ['Dourado', '#E4BD68'], ['Verde', '#00AE42'],
  ['Verde-escuro', '#164B35'], ['Ciano', '#0086D6'], ['Azul', '#0A2989'], ['Roxo', '#5E43B7'], ['Rosa', '#F55A74'],
  ['Magenta', '#EC008C'], ['Marrom', '#9D432C']
];
const FONTES = ['Arial Black', 'Impact', 'Arial', 'Georgia', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Courier New', 'Times New Roman'];
const FORMAS = [
  ['circulo', 'Círculo', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
  ['coracao', 'Coração', 'M12 21s-8-4.9-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 3.5C20 16.1 12 21 12 21z'],
  ['estrela', 'Estrela', 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z'],
  ['escudo', 'Escudo', 'M12 2l8 3v6.5c0 5-3.4 9.3-8 10.5-4.6-1.2-8-5.5-8-10.5V5z'],
  ['hexagono', 'Hexágono', 'M12 2l8.7 5v10L12 22l-8.7-5V7z'],
  ['quadrado', 'Quadrado', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'],
  ['flor', 'Flor', 'M12 2c1.7 0 3 1.3 3 3 1.4-.8 3.2-.4 4 1s.4 3.2-1 4c1.4.8 1.8 2.6 1 4s-2.6 1.8-4 1c0 1.7-1.3 3-3 3s-3-1.3-3-3c-1.4.8-3.2.4-4-1s-.4-3.2 1-4c-1.4-.8-1.8-2.6-1-4s2.6-1.8 4-1c0-1.7 1.3-3 3-3z'],
  ['gota', 'Gota', 'M12 2c4 5 7 8.2 7 11.5A7 7 0 1 1 5 13.5C5 10.2 8 7 12 2z']
];
const PADRAO = {
  modelo: 'chaveiro', tamanhoMM: 50, altBase: 2.4, altArte: 1.2, degrauMM: 0.6, bordaMM: 2.5, cantoMM: 3,
  corBase: 'auto', cores: {}, estrategia: 'ams', alturas: 'degraus', engrossar: true, impressora: 'A1', bicoMM: 0.4,
  argola: { ligada: true, posicao: 'topo', centro: true, ponto: null, furoMM: 4, paredeMM: 2.2 },
  nfc: { ligado: false, diametroMM: 25, profundidadeMM: 0.9, modo: 'baixo' },
  verso: { texto: '', modo: 'cor', cor: '#FFFFFF' },
  litofania: { forma: 'retangulo', espMin: 0.8, espMax: 3.0, moldura: 2.5, contraste: 1, inverter: false }
};
const MOTIVO_BASE = { fundo: 'a cor do fundo da sua imagem', cracha: 'a cor de fora da logo', contraste: 'contrasta com a logo' };
const MODO_RECORTE = { alfa: 'Fundo transparente', fundo: 'Fundo liso removido', tom: 'Recorte por claro/escuro', poster: 'Foto em pôster' };
const FORMAS_FOTO = [['retangulo', 'Retângulo'], ['redondo', 'Redondo'], ['coracao', 'Coração']];
const LADO_MAX = 1600;   // imagem que vai pro motor (o motor trabalha em 1000 px)

export const CSS_GERADOR = `
.e3g .e3d-main{ grid-template-columns:minmax(0,1fr) 380px }
.e3g-passos{ display:flex; align-items:center; gap:4px; font:600 12px var(--sans); color:var(--ink-dim) }
.e3g-passos span{ display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px 0 6px; border-radius:99px; background:var(--bg-2); white-space:nowrap }
.e3g-passos span i{ width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font:700 10.5px var(--sans); font-style:normal; background:var(--line); color:var(--ink-soft) }
.e3g-passos span.feito{ color:var(--ink) } .e3g-passos span.feito i{ background:var(--green); color:#fff }
.e3g-passos span.atual{ color:var(--brand); background:var(--brand-soft) } .e3g-passos span.atual i{ background:var(--brand); color:#fff }
.e3g-passos b{ width:8px; height:1px; background:var(--line) }
.e3g-qual{ position:absolute; right:12px; top:12px; z-index:3; display:none; align-items:center; gap:9px; padding:8px 12px 8px 9px; cursor:pointer; color:var(--ink); font:600 12.5px var(--sans); border:0 }
.e3g-qual.on{ display:flex }
.e3g-qual i{ width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-style:normal }
.e3g-qual.excelente i, .e3g-qual.boa i{ background:#16a34a } .e3g-qual.regular i{ background:#f59e0b } .e3g-qual.baixa i{ background:#dc2626 }
.e3g-qual small{ display:block; font:500 11px var(--sans); color:var(--ink-dim); margin-top:1px }
.e3g-qual:hover{ transform:translateY(-1px) }
.e3g-pop{ position:absolute; right:12px; top:66px; z-index:6; width:min(360px, calc(100% - 24px)); max-height:calc(100% - 90px); overflow:auto; padding:12px 14px; display:none; flex-direction:column; gap:6px }
.e3g-pop.on{ display:flex; animation:e3dsurge .18s var(--ease) }
.e3g-item{ display:flex; gap:10px; align-items:flex-start; padding:8px; border-radius:10px; background:var(--panel-2); font-size:12.5px; color:var(--ink-soft); line-height:1.4 }
.e3g-item i{ flex:none; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-style:normal; font-size:11px; font-weight:700; background:#16a34a }
.e3g-item.dica i{ background:#1f6feb } .e3g-item.alerta i{ background:#d97706 }
.e3g-item b{ display:block; color:var(--ink); font-size:12.5px }
.e3g-antes{ position:absolute; left:12px; top:12px; z-index:3; display:none; align-items:center; gap:4px; padding:4px }
.e3g-antes.on{ display:flex }
.e3g-antes img{ width:40px; height:40px; object-fit:contain; border-radius:8px; background:repeating-conic-gradient(var(--bg-2) 0% 25%, var(--panel) 0% 50%) 50%/10px 10px; margin-right:4px }
.e3g-comparar{ position:absolute; inset:0; z-index:2; display:none; cursor:ew-resize; touch-action:none }
.e3g-comparar.on{ display:block }
.e3g-comparar img{ position:absolute; pointer-events:none; image-rendering:auto }
.e3g-comparar .corte{ position:absolute; top:0; bottom:0; width:2px; background:var(--brand); box-shadow:0 0 0 1px rgba(255,255,255,.6) }
.e3g-comparar .corte::after{ content:'Original  |  Chaveiro'; position:absolute; top:12px; left:50%; transform:translateX(-50%); white-space:pre; padding:4px 10px; border-radius:99px; background:var(--brand); color:#fff; font:700 11px var(--sans) }
.e3g-vazio .caixa{ max-width:520px }
.e3g-vazio .ou{ display:flex; align-items:center; gap:10px; margin:16px 0 10px; font:600 11px var(--sans); color:var(--ink-dim); text-transform:uppercase; letter-spacing:.07em }
.e3g-vazio .ou::before, .e3g-vazio .ou::after{ content:''; flex:1; height:1px; background:var(--line) }
.e3g-vazio .linha{ display:flex; gap:8px }
.e3g-vazio .linha input{ flex:1; height:40px; border-radius:10px; border:1px solid var(--line); padding:0 12px; font:600 14px var(--sans); background:var(--panel); color:var(--ink) }
.e3g-vazio .formas{ display:flex; gap:6px; justify-content:center; flex-wrap:wrap }
.e3g-vazio .formas button{ width:40px; height:40px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--ink-soft); cursor:pointer; display:inline-flex; align-items:center; justify-content:center }
.e3g-vazio .formas button:hover{ color:var(--brand); border-color:var(--brand) }
.e3g-logo{ display:flex; align-items:center; gap:12px; padding:10px; border-radius:14px; border:1px solid var(--line); background:var(--panel-2); margin-bottom:16px }
.e3g-logo img{ width:52px; height:52px; object-fit:contain; border-radius:10px; flex:none; background:repeating-conic-gradient(var(--bg-2) 0% 25%, var(--panel) 0% 50%) 50%/10px 10px }
.e3g-logo .txt{ flex:1; min-width:0; font-size:12px; color:var(--ink-soft); line-height:1.4 }
.e3g-logo .txt b{ display:block; color:var(--ink); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.e3g-cores{ display:flex; flex-direction:column; gap:6px; margin-bottom:16px }
.e3g-cor{ display:flex; align-items:center; gap:10px; padding:7px 8px 7px 7px; border-radius:12px; border:1px solid var(--line); background:var(--panel); position:relative }
.e3g-cor.base{ background:var(--panel-2) }
.e3g-cor.desligada{ opacity:.55 }
.e3g-cor .bola{ width:30px; height:30px; border-radius:9px; border:1px solid rgba(0,0,0,.15); cursor:pointer; flex:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,.3); padding:0 }
.e3g-cor .bola:hover{ transform:scale(1.06) }
.e3g-cor .txt{ flex:1; min-width:0; font-size:12.5px; line-height:1.3 }
.e3g-cor .txt b{ display:block; color:var(--ink); font-size:13px }
.e3g-cor .txt span{ color:var(--ink-dim); font-size:11.5px }
.e3g-cor .hex{ font:500 10.5px var(--mono); color:var(--ink-dim) }
.e3g-cor .mais{ border:0; background:none; width:28px; height:28px; border-radius:8px; cursor:pointer; color:var(--ink-dim); font:700 16px var(--sans) }
.e3g-cor .mais:hover{ background:var(--line-soft); color:var(--ink) }
.e3g-paleta{ position:absolute; z-index:20; padding:10px; width:236px; display:flex; flex-direction:column; gap:8px }
.e3g-paleta .grade{ display:grid; grid-template-columns:repeat(6, 1fr); gap:6px }
.e3g-paleta .grade button{ width:30px; height:30px; border-radius:8px; border:1px solid rgba(0,0,0,.15); cursor:pointer; padding:0 }
.e3g-paleta .grade button:hover{ transform:scale(1.1) }
.e3g-paleta label{ display:flex; align-items:center; gap:8px; font:600 12px var(--sans); color:var(--ink-soft) }
.e3g-paleta input[type=color]{ width:36px; height:28px; border:0; background:none; padding:0; cursor:pointer }
.e3g-paleta .acoes{ display:flex; flex-direction:column; gap:2px; border-top:1px solid var(--line); padding-top:6px }
.e3g-paleta .acoes button{ text-align:left; border:0; background:none; padding:6px 8px; border-radius:8px; font:600 12px var(--sans); color:var(--ink-soft); cursor:pointer }
.e3g-paleta .acoes button:hover{ background:var(--line-soft); color:var(--ink) }
.e3g-bloco{ margin-bottom:16px }
.e3g-bloco .e3d-slider input[type=text]{ width:74px }
.e3g-resumo{ display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin:4px 0 14px }
.e3g-resumo div{ padding:9px 10px; border-radius:12px; background:var(--panel-2); border:1px solid var(--line-soft) }
.e3g-resumo span{ display:block; font:600 10.5px var(--sans); color:var(--ink-dim); text-transform:uppercase; letter-spacing:.05em }
.e3g-resumo b{ font:700 14px var(--mono); color:var(--ink) }
.e3g-check{ display:flex; align-items:center; gap:8px; font:500 12.5px var(--sans); color:var(--ink-soft); cursor:pointer; margin:6px 0 }
.e3g-check input{ accent-color:var(--brand); width:16px; height:16px }
.e3g-trocas{ margin-top:8px; font-size:12px; color:var(--ink-soft); line-height:1.5 }
.e3g-trocas b{ color:var(--ink) }
.e3g-pausas{ margin-top:12px; padding:12px; border-radius:12px; border:1px solid var(--line); background:var(--panel-2); font-size:12px; color:var(--ink-soft); line-height:1.5 }
.e3g-pausas p{ margin:0 0 8px }
.e3g-pausas b{ color:var(--ink) }
.e3g-pausas ol{ margin:0 0 10px; padding-left:18px }
.e3g-pausas li span{ color:var(--ink-soft) }
.e3g-pausas .bolinha{ display:inline-block; width:10px; height:10px; border-radius:50%; margin:0 4px -1px 2px; box-shadow:0 0 0 1px rgba(0,0,0,.2) }
.e3g-pausas .jeito{ margin:8px 0 }
.e3g-pausas .e3g-soltar{ border-style:dashed }
.e3g-pausas .e3g-soltar.sobre{ border-color:var(--brand); color:var(--brand) }
.e3g-argola-fantasma{ pointer-events:none }
.e3g-verso textarea{ width:100%; min-height:62px; resize:vertical; font:600 14px var(--sans) }
.e3g-verso .rapidos{ display:flex; gap:6px; margin:6px 0 10px }
.e3g-verso .rapidos button{ height:28px; padding:0 10px; border-radius:99px; border:1px solid var(--line); background:var(--panel); font:600 11.5px var(--sans); color:var(--ink-soft); cursor:pointer }
.e3g-verso .rapidos button:hover{ color:var(--brand); border-color:var(--brand) }
@media (max-width:1500px){ .e3g .e3d-motor{ display:none } }
@media (max-width:1180px){ .e3g .e3d-main{ grid-template-columns:minmax(0,1fr) 330px } .e3g-passos{ display:none } }
@media (max-width:900px){ .e3g .e3d-main{ grid-template-columns:1fr; grid-template-rows:60vh auto } }
`;

function injetarCSSGerador() {
  if (document.getElementById('e3g-css')) return;
  const s = document.createElement('style'); s.id = 'e3g-css'; s.textContent = CSS_GERADOR;
  document.head.appendChild(s);
}
const bt = (attrs, ico, rot, cls = '') => '<button type="button" class="e3d-bt ' + cls + '" ' + attrs + '>' + (ico ? icone(ico, 17) : '') + (rot || '') + '</button>';
const clone = o => JSON.parse(JSON.stringify(o));

export class Gerador {
  constructor(raiz, motor) {
    injetarCSS(); injetarCSSGerador();
    this.raiz = raiz; this.motor = motor;
    this.cfg = clone(PADRAO);
    this.aba = 'padrao';
    this.seq = 0;
    // foto: pôster (análise nova) ou litofania (modelo); anBase = a análise "logo" da mesma imagem
    this.opcAnalise = { poster: null };
    this.anBase = null;
    this.montar();
  }

  /* ------------------------------------------------------------ casca */
  montar() {
    const r = this.raiz;
    r.className = 'e3d e3g';
    this.topo = el('div', { class: 'e3d-top' });
    this.topo.innerHTML =
      '<div class="e3d-marca"><i>' + icone('faisca', 17) + '</i><span>Gerador de chaveiro</span></div>' +
      bt('data-b="logo" title="Escolher outra imagem (ou arraste na tela, ou cole com Ctrl+V)"', 'abrir', '<span class="rot-lg">Trocar logo</span>') +
      '<span class="grow"></span>' +
      '<div class="e3g-passos" data-b="passos"></div>' +
      '<span class="grow"></span>' +
      bt('data-b="estudio" title="Continuar editando no Estúdio 3D (cortar, texto no verso, juntar peças…)" disabled', 'cubo', '<span class="rot-lg">Abrir no Estúdio</span>') +
      bt('data-b="baixar3mf" title="Arquivo do Bambu Studio com as cores certas" disabled', 'baixar', 'Baixar 3MF', 'primario') +
      bt('data-b="tela" title="Tela cheia"', 'telaCheia', '', 'so-ico') +
      '<span class="e3d-motor" data-b="motor"><i></i><span>pronto</span></span>';
    this.principalEl = el('div', { class: 'e3d-main' });
    this.palco = el('div', { class: 'e3d-palco' });
    this.painel = el('div', { class: 'e3d-painel' });
    this.painelCab = el('div', { class: 'e3d-painel-cab' });
    this.painelCorpo = el('div', { class: 'e3d-painel-corpo' });
    this.painel.append(this.painelCab, this.painelCorpo);
    this.principalEl.append(this.palco, this.painel);
    this.input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/bmp', style: 'display:none' });
    r.append(this.topo, this.principalEl, this.input);

    this.cena = new Cena();
    this.visor = new Visor(this.palco, this.cena);
    this.visor.definirTema(document.documentElement.dataset.tema === 'escuro');
    new MutationObserver(() => this.visor.definirTema(document.documentElement.dataset.tema === 'escuro'))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

    // sobreposições do palco (mesmos componentes do Estúdio)
    this.vazio = el('div', { class: 'e3d-vazio e3g-vazio' });
    this.vazio.innerHTML = '<div class="caixa"><div class="ico">' + icone('faisca', 28) + '</div>' +
      '<h3>Solte sua logo aqui</h3><p>O gerador descobre sozinho o fundo, as cores e onde vai a argola. Em segundos você tem o chaveiro pronto pro Bambu.</p>' +
      '<button type="button" class="btn primary" data-b="escolher">Escolher imagem</button>' +
      '<div class="formatos"><span>PNG</span><span>JPG</span><span>SVG</span><span>WEBP</span><span>Ctrl+V cola</span></div>' +
      '<div class="ou">ou escreva um nome</div>' +
      '<div class="linha"><input type="text" data-b="nome" maxlength="30" placeholder="Ex.: Maria" autocomplete="off"><button type="button" class="btn" data-b="usarNome">Gerar</button></div>' +
      '<div class="ou">ou comece de uma forma</div><div class="formas" data-b="formas"></div></div>';
    const formasEl = this.vazio.querySelector('[data-b=formas]');
    for (const [id, nome, d] of FORMAS) formasEl.appendChild(el('button', { type: 'button', title: nome, 'aria-label': nome, html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="' + d + '"/></svg>', onclick: () => this.usarForma(id) }));
    this.antesEl = el('div', { class: 'e3g-antes e3d-vidro' });
    this.qualEl = el('button', { type: 'button', class: 'e3g-qual e3d-vidro', title: 'Ver o que o gerador conferiu', onclick: () => this.popEl.classList.toggle('on') });
    this.popEl = el('div', { class: 'e3g-pop e3d-vidro' });
    this.vistasEl = el('div', { class: 'e3d-vistas e3d-vidro' });
    this.vistasEl.innerHTML = bt('data-b="enquadrar" title="Enquadrar (F)"', 'enquadrar', '', 'so-ico') + '<span class="sep"></span>' +
      bt('data-v="iso" title="Vista 3D"', 'cubo', '3D') +
      '<button type="button" class="e3d-bt" data-v="topo" title="Vista de cima">De cima</button>' +
      '<button type="button" class="e3d-bt" data-v="frente" title="Vista de lado (mostra as alturas)">De lado</button>' +
      '<button type="button" class="e3d-bt" data-v="baixo" title="Vista de baixo (verso)">Verso</button>' +
      '<span class="sep"></span>' +
      '<button type="button" class="e3d-bt" data-b="comparar" title="Compara com a imagem original (arraste a linha)">Comparar</button>';
    this.hud = el('div', { class: 'e3d-hud e3d-vidro', style: 'display:none' });
    this.dica = el('div', { class: 'e3d-dica e3d-vidro', style: 'display:none', html: 'arraste pra girar · arraste a argola pra mudar de lugar · rodinha: zoom' });
    this.ocupadoEl = el('div', { class: 'e3d-ocupado e3d-vidro' });
    this.ocupadoEl.innerHTML = '<span class="roda"></span><div><span data-o="rot">Analisando…</span><small data-o="sub"></small></div>';
    this.compararEl = el('div', { class: 'e3g-comparar' });
    this.compararEl.innerHTML = '<img alt="Imagem original"><div class="corte"></div>';
    this.palco.append(this.vazio, this.antesEl, this.qualEl, this.popEl, this.vistasEl, this.hud, this.dica, this.ocupadoEl, this.compararEl);
    this.vistasEl.style.display = 'none';

    this.ligar();
    this.renderPassos();
    this.renderPainel();
  }

  ligar() {
    const t = this.topo;
    t.querySelector('[data-b=logo]').onclick = () => this.input.click();
    t.querySelector('[data-b=baixar3mf]').onclick = () => this.baixar3MF();
    t.querySelector('[data-b=estudio]').onclick = () => this.abrirNoEstudio();
    t.querySelector('[data-b=tela]').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (this.raiz.requestFullscreen) this.raiz.requestFullscreen().catch(() => {}); };
    document.addEventListener('fullscreenchange', () => {
      const cheia = document.fullscreenElement === this.raiz;
      t.querySelector('[data-b=tela]').innerHTML = icone(cheia ? 'sairTela' : 'telaCheia', 17);
      this.visor.redimensionar();
    });
    this.input.onchange = () => { const f = this.input.files && this.input.files[0]; this.input.value = ''; if (f) this.abrirArquivo(f); };
    const v = this.vazio;
    v.querySelector('[data-b=escolher]').onclick = () => this.input.click();
    const nome = v.querySelector('[data-b=nome]');
    const usarNome = () => { const s = nome.value.trim(); if (s) this.usarTexto(s, FONTES[0]); else nome.focus(); };
    v.querySelector('[data-b=usarNome]').onclick = usarNome;
    nome.onkeydown = ev => { if (ev.key === 'Enter') usarNome(); };
    // arrastar arquivo / colar
    this.palco.addEventListener('dragover', ev => { if ([...(ev.dataTransfer.items || [])].some(i => i.kind === 'file')) { ev.preventDefault(); this.palco.classList.add('sobre'); } });
    this.palco.addEventListener('dragleave', ev => { if (!this.palco.contains(ev.relatedTarget)) this.palco.classList.remove('sobre'); });
    this.palco.addEventListener('drop', ev => { ev.preventDefault(); this.palco.classList.remove('sobre'); const f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) this.abrirArquivo(f); });
    document.addEventListener('paste', ev => {
      if (!this.raiz.isConnected || this.raiz.offsetParent === null) return;
      if (/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) return;
      const it = [...((ev.clipboardData && ev.clipboardData.items) || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
      if (it) { ev.preventDefault(); this.abrirArquivo(it.getAsFile()); }
    });
    this.vistasEl.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.v) { this.fecharComparar(); this.vista(b.dataset.v); }
      else if (b.dataset.b === 'enquadrar') this.enquadrar();
      else if (b.dataset.b === 'comparar') this.alternarComparar();
    });
    this.palco.addEventListener('keydown', ev => { if (ev.key === 'f' || ev.key === 'F') this.enquadrar(); });
    this.ligarArgola();
    this.ligarComparar();
    this.painelCorpo.addEventListener('pointerdown', ev => { if (ev.target.matches && ev.target.matches('input[type=range]')) this.arrastandoPainel = true; });
    document.addEventListener('pointerup', () => {
      if (!this.arrastandoPainel) return;
      this.arrastandoPainel = false;
      if (this.renderDepois) { this.renderDepois = false; this.renderPainel(); }
    });
  }

  /* ------------------------------------------------------------ entrada */
  async abrirArquivo(f) {
    if (!/^image\//.test(f.type) && !/\.(svg|png|jpe?g|webp)$/i.test(f.name || '')) { avisar('Isso não é uma imagem (use PNG, JPG, SVG ou WEBP).', 'warn'); return; }
    if (f.size > 25 * 1024 * 1024) { avisar('Imagem muito grande (máximo 25 MB).', 'warn'); return; }
    const nome = (f.name || 'logo').replace(/\.[^.]+$/, '').slice(0, 40) || 'logo';
    const url = URL.createObjectURL(f);
    try {
      const img = await carregarImagem(url);
      const svg = /svg/.test(f.type) || /\.svg$/i.test(f.name || '');
      // SVG é vetor: desenha grande (1600 px) antes de analisar
      let w = img.naturalWidth || img.width || (svg ? LADO_MAX : 0), h = img.naturalHeight || img.height || (svg ? LADO_MAX : 0);
      if (!w || !h) throw new Error('imagem vazia');
      const k = svg ? LADO_MAX / Math.max(w, h) : Math.min(1, LADO_MAX / Math.max(w, h));
      w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      // SVG: o motor lê os caminhos do arquivo (contorno exato); os pixels ficam pra tela e de reserva
      const texto = svg ? await f.text().catch(() => null) : null;
      await this.usarPixels(g.getImageData(0, 0, w, h), { tipo: svg ? 'svg' : 'imagem', nome, url: cv.toDataURL('image/png'), svg: texto });
    } catch (e) {
      avisar('Não consegui abrir essa imagem.', 'warn');
    } finally { URL.revokeObjectURL(url); }
  }

  usarTexto(s, fonte) {
    const tam = 300, cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    const f = '900 ' + tam + 'px "' + fonte + '", "Arial Black", Arial, sans-serif';
    g.font = f;
    const w = Math.min(LADO_MAX * 2, Math.ceil(g.measureText(s).width) + 60), h = Math.round(tam * 1.35);
    cv.width = w; cv.height = h;
    g.font = f; g.textBaseline = 'middle'; g.fillStyle = '#111111';
    g.fillText(s, 30, h / 2);
    this.usarPixels(g.getImageData(0, 0, w, h), { tipo: 'texto', nome: s, url: cv.toDataURL('image/png'), texto: s, fonte });
  }

  usarForma(id) {
    const f = FORMAS.find(x => x[0] === id); if (!f) return;
    const L = 1000, cv = document.createElement('canvas'); cv.width = cv.height = L;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.setTransform(L / 24, 0, 0, L / 24, 0, 0); g.fillStyle = '#111111'; g.fill(new Path2D(f[2]));
    this.usarPixels(g.getImageData(0, 0, L, L), { tipo: 'forma', nome: f[1], url: cv.toDataURL('image/png') });
  }

  async usarPixels(img, origem) {
    this.origem = origem;
    this.pixels = img;
    this.fecharComparar();
    this.cfg.cores = {}; this.cfg.corBase = 'auto';
    if (this.cfg.argola.posicao === 'livre') this.cfg.argola = { ...this.cfg.argola, posicao: 'topo', ponto: null };
    if (this.cfg.modelo === 'litofania') this.cfg.modelo = this.modeloAntes || 'chaveiro';
    this.opcAnalise = { poster: null }; this.anBase = null; this.fotoDecidida = false; this.simURL = null;
    this.res = null; this.an = null; this.primeiraVez = true;
    this.vazio.style.display = 'none';
    this.estado('analisando');
    this.renderPassos();
    await this.analisar();
  }

  async analisar() {
    const id = 'logo' + (++this.seq);
    const img = this.pixels;
    try {
      const poster = this.opcAnalise.poster;
      const an = await this.motor.rodar('geradorAnalisar', { id, px: img.data, w: img.width, h: img.height, svg: (this.origem && this.origem.svg) || null, poster, base: this.anBase ? this.anBase.id : null });
      if (this.pixels !== img) return;                 // já trocaram de logo
      if (an.erro) { this.estado('erro', an.erro); return; }
      if (!an.poster) this.anBase = an;
      // FOTO como logo vira mancha: na primeira vez já sai em pôster (dá pra trocar)
      if (!an.poster && an.foto && an.foto.provavel && !this.fotoDecidida && this.cfg.modelo !== 'litofania') {
        this.fotoDecidida = true;
        this.opcAnalise = { poster: { cores: 4, forma: 'retangulo' } };
        this.cfg.alturas = 'iguais';
        avisar('É uma FOTO: fiz um pôster de 4 cores. Quer litofania (a foto aparece contra a luz)? Escolha em "Usar como".', 'ok');
        return this.analisar();
      }
      this.an = an;
      this.renderPainel();
      await this.construir();
    } catch (e) {
      this.estado('erro', 'Não consegui analisar a imagem: ' + (e.message || e));
    }
  }

  /* ------------------------------------------------------------ foto: logo | pôster | litofania */
  tipoAtual() { return this.cfg.modelo === 'litofania' ? 'litofania' : this.an && this.an.poster ? 'poster' : 'logo'; }
  async usarTipo(t) {
    if (!this.an || t === this.tipoAtual()) return;
    this.fecharComparar();
    if (this.cfg.modelo === 'litofania' && t !== 'litofania') this.cfg.modelo = this.modeloAntes || 'chaveiro';
    if (t === 'litofania') {
      if (this.cfg.modelo !== 'litofania') this.modeloAntes = this.cfg.modelo;
      this.cfg.modelo = 'litofania';
      this.opcAnalise = { poster: null };
      if (this.an.poster && this.anBase) this.an = this.anBase;     // litofania usa a foto inteira
      this.res = null; this.estado('gerando'); this.renderPainel();
      return this.construir();
    }
    this.cfg.cores = {}; this.cfg.corBase = 'auto';
    if (t === 'poster') {
      this.opcAnalise = { poster: { cores: 4, forma: 'retangulo', ...(this.ultimoPoster || {}) } };
      this.cfg.alturas = 'iguais';
    } else {
      this.opcAnalise = { poster: null };
      if (this.an.poster && this.anBase) { this.an = this.anBase; this.res = null; this.estado('gerando'); this.renderPainel(); return this.construir(); }
    }
    this.res = null; this.estado('analisando');
    return this.analisar();
  }
  mudarPoster(o) {
    this.ultimoPoster = { ...(this.opcAnalise.poster || {}), ...o };
    this.opcAnalise = { poster: this.ultimoPoster };
    this.cfg.cores = {}; this.cfg.corBase = 'auto';
    this.estado('analisando');
    this.analisar();
  }
  // "Usar como": aparece sozinho quando a imagem é foto (ou já está em pôster/litofania)
  blocoTipo(c, sempre) {
    const t = this.tipoAtual(), foto = this.an.foto && this.an.foto.provavel;
    if (!sempre && !foto && t === 'logo') return;
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Usar como'));
    const s = el('div', { class: 'seg', 'data-b': 'tipo' });
    for (const [v, txt] of [['logo', 'Logo'], ['poster', 'Pôster'], ['litofania', 'Litofania']]) s.appendChild(el('button', { type: 'button', 'data-v': v, class: v === t ? 'active' : '' }, txt));
    s.onclick = ev => { const b = ev.target.closest('button'); if (b) this.usarTipo(b.dataset.v); };
    c.appendChild(s);
    const txt = t === 'litofania' ? 'Placa branca de espessura variável: contra a luz (janela, lanterna), a foto aparece com todos os tons.'
      : t === 'poster' ? 'A foto em ' + (this.an.poster ? this.an.poster.cores : 4) + ' cores chapadas, sem mancha pequena demais pra imprimir.'
        : foto ? 'Isso é uma FOTO: como logo ela vira manchas. Pôster ou Litofania ficam muito melhores.' : 'Pôster: a imagem em poucas cores chapadas. Litofania: aparece contra a luz.';
    c.appendChild(el('p', { class: 'u', style: 'margin:0 0 10px' }, txt));
    if (t === 'poster') {
      const p = this.an.poster;
      c.appendChild(el('div', { class: 'e3d-l2' },
        el('div', {}, el('label', {}, 'Cores'), this.segSimples([['2', '2'], ['3', '3'], ['4', '4']], String(p.cores), v => this.mudarPoster({ cores: +v }))),
        el('div', {}, el('label', {}, 'Forma'), this.segSimples([...FORMAS_FOTO, ...(this.an.alfa || (this.anBase && this.anBase.alfa) ? [['contorno', 'Recorte']] : [])], p.forma, v => this.mudarPoster({ forma: v })))));
    }
  }
  // seg que não reconstrói sozinho (quem chama decide)
  segSimples(ops, atual, aoMudar) {
    const s = el('div', { class: 'seg' });
    for (const [v, t] of ops) s.appendChild(el('button', { type: 'button', 'data-v': v, class: v === atual ? 'active' : '' }, t));
    s.onclick = ev => { const b = ev.target.closest('button'); if (b && b.dataset.v !== atual) aoMudar(b.dataset.v); };
    return s;
  }
  // controles da litofania (no lugar das cores)
  blocoLitofania(c) {
    const L = this.cfg.litofania, r = this.res;
    const set = o => { this.cfg.litofania = { ...this.cfg.litofania, ...o }; };
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Forma'));
    c.appendChild(this.seg([...FORMAS_FOTO, ...(this.an.alfa ? [['contorno', 'Recorte']] : [])], L.forma, v => set({ forma: v })));
    c.appendChild(this.campoSlider('Tamanho', 'maior lado, em mm', this.cfg.tamanhoMM, 25, 150, 1, v => { this.cfg.tamanhoMM = v; }));
    c.appendChild(this.campoSlider('Mais fino', 'onde é claro, mm', L.espMin, 0.6, 2, 0.1, v => set({ espMin: v })));
    c.appendChild(this.campoSlider('Mais grosso', 'onde é escuro, mm', L.espMax, 2, 6, 0.1, v => set({ espMax: v })));
    c.appendChild(this.campoSlider('Contraste', '1 = como a foto', L.contraste, 0.5, 2, 0.05, v => set({ contraste: v })));
    c.appendChild(this.campoSlider('Moldura', 'em volta, mm (0 = sem)', L.moldura, 0, 6, 0.5, v => set({ moldura: v })));
    c.appendChild(this.check('Negativo (inverter claro e escuro)', !!L.inverter, v => set({ inverter: v })));
    if (r && r.litofania) c.appendChild(el('div', { class: 'e3d-nota' }, 'Filamento BRANCO, camada de ' + fmt(r.litofania.camadaSugerida, 2) + ' mm e preenchimento 100%. Veja a prévia "contra a luz" no canto de cima.'));
  }

  /* ------------------------------------------------------------ construir */
  agendar(ms = 110) { clearTimeout(this._t); this._t = setTimeout(() => this.construir(), ms); }

  async construir() {
    if (!this.an) return;
    if (this.construindo) { this.pendente = true; return; }
    this.construindo = true;
    const idAnalise = this.an.id;
    if (!this.res) this.estado('gerando'); else this.motorEstado('ocupado', 'atualizando…');
    try {
      let r;
      try { r = await this.motor.rodar('geradorConstruir', { id: this.an.id, cfg: this.cfg }); }
      catch (e) {
        if (e.codigo !== 'sem-analise' && e.codigo !== 'cancelado') throw e;
        // motor reiniciou: analisa de novo (mesma imagem) e segue
        const an = await this.motor.rodar('geradorAnalisar', { id: this.an.id, px: this.pixels.data, w: this.pixels.width, h: this.pixels.height, svg: (this.origem && this.origem.svg) || null, poster: this.an.poster || null });
        if (an.erro) throw new Error(an.erro);
        r = await this.motor.rodar('geradorConstruir', { id: this.an.id, cfg: this.cfg });
      }
      // trocou de logo enquanto calculava: esse resultado é da logo antiga
      if (!this.an || this.an.id !== idAnalise) { /* descarta */ }
      else if (r.erro) this.estado('erro', r.erro);
      else this.aplicar(r);
    } catch (e) {
      this.estado('erro', 'Não consegui montar o chaveiro: ' + (e.message || e));
    } finally {
      this.construindo = false;
      if (this.pendente) { this.pendente = false; this.construir(); }
    }
  }

  aplicar(r) {
    this.res = r;
    const mesa = IMPRESSORAS[this.cfg.impressora] ? IMPRESSORAS[this.cfg.impressora].mesa : [256, 256];
    if (this.cena.mesa.x !== mesa[0]) { this.cena.mesa = { x: mesa[0], y: mesa[1] }; this.visor.montarMesa(); }
    this.pos = [this.cena.mesa.x / 2 - r.medidas.largura / 2, this.cena.mesa.y / 2 - r.medidas.altura / 2];
    const obj = novoObjeto({ id: 'chaveiro', nome: this.nomePeca(), transform: M4.translacao(this.pos[0], this.pos[1], 0),
      partes: r.partes.map((p, i) => ({ id: 'g' + i + '_' + p.nome, nome: p.nome, cor: p.cor, malha: p.malha })) });
    this.cena.objetos = [obj];
    this.visor.sincronizar();
    if (this.primeiraVez) { this.primeiraVez = false; this.vista('iso'); }
    this.estado('pronto');
    this.renderPassos();
    this.renderQualidade();
    this.renderHud();
    // arrastando um controle do painel: refaz o painel só quando soltar (senão
    // o controle é trocado no meio do gesto e o arraste para)
    if (this.arrastandoPainel) this.renderDepois = true; else this.renderPainel();
    if (this.compararEl.classList.contains('on')) this.posicionarComparar();
  }

  nomePeca() { return (this.origem && this.origem.nome) || 'Chaveiro'; }

  enquadrar() {
    const c = this.cena.caixaCena();
    if (c) this.visor.enquadrar(c);
  }
  // vistas do gerador: 3D de frente e de cima (o texto da logo fica reto na
  // tela, igual à imagem); de lado mostra as alturas; verso por baixo
  vista(tipo) {
    const dirs = { iso: [0, -0.62, 0.78], topo: [0, -0.0008, 1], frente: [0, -1, 0.12], baixo: [0, 0.0008, -1] };   // verso: como virar a peça de lado (o texto lê reto)
    const v = this.visor, t = v.controles.target, d = v.camera.position.distanceTo(t) || 300;
    const dir = new THREE.Vector3(...(dirs[tipo] || dirs.iso)).normalize();
    v.camera.position.copy(t).add(dir.multiplyScalar(d));
    v.controles.update();
    this.enquadrar();
  }

  /* ------------------------------------------------------------ estados */
  estado(qual, msg) {
    this.estadoAtual = qual;
    const o = this.ocupadoEl;
    const rot = o.querySelector('[data-o=rot]'), sub = o.querySelector('[data-o=sub]');
    const tem = !!this.res;
    this.vistasEl.style.display = tem ? '' : 'none';
    this.hud.style.display = tem ? '' : 'none';
    this.dica.style.display = tem ? '' : 'none';
    this.topo.querySelector('[data-b=baixar3mf]').disabled = !tem;
    this.topo.querySelector('[data-b=estudio]').disabled = !tem;
    if (qual === 'analisando' || qual === 'gerando') {
      o.classList.add('on');
      rot.textContent = qual === 'analisando' ? 'Analisando a logo…' : 'Gerando o chaveiro…';
      sub.textContent = qual === 'analisando' ? 'fundo, cores e detalhes' : 'base, argola e cores';
      this.motorEstado('ocupado', qual === 'analisando' ? 'analisando…' : 'gerando…');
    } else {
      o.classList.remove('on');
      this.motorEstado(qual === 'erro' ? 'erro' : 'ok', qual === 'erro' ? 'erro' : 'pronto');
    }
    if (qual === 'erro') {
      avisar(msg, 'warn');
      if (!tem) { this.vazio.style.display = ''; }
    }
    this.renderAntes();
  }
  motorEstado(cls, txt) {
    const m = this.topo.querySelector('[data-b=motor]');
    m.className = 'e3d-motor ' + (cls === 'erro' ? '' : cls);
    m.querySelector('span').textContent = txt;
  }

  renderPassos() {
    const p = this.topo.querySelector('[data-b=passos]');
    const temLogo = !!this.origem, tem = !!this.res;
    const bom = tem && (this.res.qualidade.nivel === 'excelente' || this.res.qualidade.nivel === 'boa');
    const passo = (n, t, feito, atual) => '<span class="' + (feito ? 'feito' : atual ? 'atual' : '') + '"><i>' + (feito ? '✓' : n) + '</i>' + t + '</span>';
    p.innerHTML = passo(1, 'Logo', temLogo && !!this.an, !temLogo) + '<b></b>' + passo(2, 'Chaveiro', tem, temLogo && !tem) + '<b></b>' + passo(3, 'Imprimir', bom, tem && !bom);
  }

  // litofania: a foto como vai aparecer contra a luz (PNG da simulação)
  urlSimulacao() {
    const L = this.res && this.res.litofania;
    if (!L) return null;
    if (this.simURL && this.simDe === this.res) return this.simURL;
    const s = L.simulacao, cv = document.createElement('canvas'); cv.width = s.w; cv.height = s.h;
    const g = cv.getContext('2d'), im = g.createImageData(s.w, s.h);
    for (let i = 0; i < s.w * s.h; i++) { const v = s.px[i]; im.data[i * 4] = Math.min(255, v * 1.02 + 6); im.data[i * 4 + 1] = Math.min(255, v * 0.98 + 4); im.data[i * 4 + 2] = v * 0.9; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    this.simURL = cv.toDataURL('image/png'); this.simDe = this.res;
    return this.simURL;
  }

  renderAntes() {
    if (!this.origem) { this.antesEl.classList.remove('on'); return; }
    this.antesEl.classList.add('on');
    const sim = this.cfg.modelo === 'litofania' ? this.urlSimulacao() : null;
    this.antesEl.innerHTML = '<img alt="" src="' + esc(sim || this.origem.url) + '">' + bt('data-b="comparar2" title="' + (sim ? 'Como fica contra a luz' : 'Comparar com a original') + '"', null, sim ? 'Contra a luz × peça' : 'Original × chaveiro');
    this.antesEl.querySelector('[data-b=comparar2]').onclick = () => this.alternarComparar();
  }

  renderQualidade() {
    const r = this.res, q = r.qualidade;
    const n = this.an.cores.length;
    this.qualEl.className = 'e3g-qual e3d-vidro on ' + q.nivel;
    this.qualEl.innerHTML = '<i>' + (q.nivel === 'excelente' || q.nivel === 'boa' ? icone('check', 14) : '!') + '</i><div>' + esc(q.titulo) +
      '<small>' + (this.cfg.modelo === 'litofania' ? 'litofania · filamento branco' : n + (n === 1 ? ' cor' : ' cores') + ' · ' + esc(MODO_RECORTE[this.an.modo] || '').toLowerCase()) + '</small></div>';
    const item = (cls, t, s) => '<div class="e3g-item ' + cls + '"><i>' + (cls === 'dica' ? 'i' : cls === 'alerta' ? '!' : '✓') + '</i><div><b>' + esc(t) + '</b>' + esc(s || '') + '</div></div>';
    let h = '<div class="tp" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><b style="font-size:14px">O que o gerador conferiu</b><button type="button" class="e3d-ico" data-b="fechar" aria-label="Fechar">' + icone('x', 14) + '</button></div>';
    for (const i of q.itens) h += item(i.nivel === 'ok' ? 'ok' : i.nivel === 'dica' ? 'dica' : 'alerta', i.titulo, i.texto);
    for (const a of r.avisos) h += item(a.tipo === 'alerta' ? 'alerta' : 'dica', a.tipo === 'alerta' ? 'Atenção' : 'Dica', a.texto);
    for (const d of r.dicas) h += item('dica', 'Dica', d.texto);
    this.popEl.innerHTML = h;
    this.popEl.querySelector('[data-b=fechar]').onclick = () => this.popEl.classList.remove('on');
  }

  renderHud() {
    const r = this.res, m = r.medidas, e = r.estimativa;
    this.hud.textContent = fmt(m.largura, 1) + ' × ' + fmt(m.altura, 1) + ' × ' + fmt(m.espessura, 1) + ' mm  ·  ' + fmt(e.gramas, 1) + ' g  ·  ~' + e.minutos + ' min' +
      (this.cfg.estrategia === 'troca' ? '  ·  ' + (r.trocas || []).length + ' troca(s) na mão' : e.trocas ? '  ·  ' + e.trocas + (e.trocas === 1 ? ' troca de cor' : ' trocas de cor') : '');
  }

  /* ------------------------------------------------------------ painel */
  renderPainel() {
    const cab = this.painelCab;
    if (!this.an) {
      cab.innerHTML = '<div class="rot"><i>' + icone('faisca', 18) + '</i><h3>Seu chaveiro</h3></div><p>Escolha uma logo, escreva um nome ou comece de uma forma. O resto é automático.</p>';
      this.painelCorpo.innerHTML = '<div class="e3d-sec"><div class="e3d-titulo">Como funciona</div>' +
        '<div class="e3g-item"><i>1</i><div><b>Logo</b>PNG com fundo transparente é o ideal; JPG com fundo liso também serve.</div></div>' +
        '<div class="e3g-item" style="margin-top:6px"><i>2</i><div><b>Análise</b>Descobre o fundo, as cores (até 4) e os detalhes finos.</div></div>' +
        '<div class="e3g-item" style="margin-top:6px"><i>3</i><div><b>Chaveiro</b>Base, argola e cores prontas. Mude só o que quiser.</div></div>' +
        '<div class="e3g-item" style="margin-top:6px"><i>4</i><div><b>Imprimir</b>Baixe o 3MF: o Bambu Studio abre com as cores certas.</div></div></div>';
      return;
    }
    cab.innerHTML = '<div class="rot"><i>' + icone('faisca', 18) + '</i><h3>Seu chaveiro</h3></div>' +
      '<p>Cores, base e argola já estão decididas. Mude só o que quiser — a prévia acompanha.</p>' +
      '<div class="e3d-sec" style="margin-top:12px"><div class="seg" data-b="abas" style="margin:0">' +
      ['padrao:Padrão', 'personalizar:Personalizar', 'avancado:Avançado'].map(x => { const [v, t] = x.split(':'); return '<button type="button" data-v="' + v + '" class="' + (this.aba === v ? 'active' : '') + '">' + t + '</button>'; }).join('') + '</div></div>';
    cab.querySelector('[data-b=abas]').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; this.aba = b.dataset.v; this.renderPainel(); };
    const corpo = el('div', { class: 'e3d-sec' });
    if (this.aba === 'padrao') this.painelPadrao(corpo);
    else if (this.aba === 'personalizar') this.painelPersonalizar(corpo);
    else this.painelAvancado(corpo);
    // quem está sendo digitado não perde o foco nem o texto quando a prévia
    // atualiza e o painel é refeito
    const ativo = document.activeElement, rolagem = this.painelCorpo.scrollTop;
    let foco = null;
    if (ativo && this.painelCorpo.contains(ativo) && ativo.getAttribute('aria-label') && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) {
      foco = { rot: ativo.getAttribute('aria-label'), valor: ativo.value, ini: ativo.selectionStart, fim: ativo.selectionEnd };
    }
    this.painelCorpo.replaceChildren(corpo);
    this.painelCorpo.scrollTop = rolagem;
    if (foco) {
      const x = [...corpo.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === foco.rot);
      if (x) { if (x.type !== 'range' && x.tagName !== 'SELECT') x.value = foco.valor; x.focus(); try { if (foco.ini != null) x.setSelectionRange(foco.ini, foco.fim); } catch (e) { /* ok */ } }
    }
  }

  painelPadrao(c) {
    const an = this.an, r = this.res;
    // logo
    const logo = el('div', { class: 'e3g-logo' });
    logo.innerHTML = '<img alt="" src="' + esc(this.origem.url) + '"><div class="txt"><b>' + esc(this.origem.nome) + '</b>' +
      (this.cfg.modelo === 'litofania' ? 'Litofania · a foto em tons, contra a luz' : esc(MODO_RECORTE[an.modo]) + ' · ' + an.cores.length + (an.cores.length === 1 ? ' cor' : ' cores') + (an.coresBrutas > 4 && !an.poster ? ' (de ' + an.coresBrutas + ' tons)' : '')) + '</div>';
    logo.appendChild(el('button', { type: 'button', class: 'btn mini', onclick: () => this.input.click() }, 'Trocar'));
    c.appendChild(logo);
    if (r) {
      const m = r.medidas;
      c.appendChild(el('div', { class: 'e3g-resumo', html: '<div><span>Tamanho</span><b>' + fmt(m.largura, 0) + '×' + fmt(m.altura, 0) + '</b></div><div><span>Peso</span><b>' + fmt(r.estimativa.gramas, 1) + ' g</b></div><div><span>Tempo</span><b>~' + r.estimativa.minutos + ' min</b></div>' }));
    }
    this.blocoTipo(c);
    const lito = this.cfg.modelo === 'litofania';
    if (lito) this.blocoLitofania(c);
    else this.painelCoresFormato(c);
    // impressora
    this.blocoImpressora(c, lito);
    // ações
    const acoes = el('div', { class: 'e3d-botoes' });
    acoes.append(
      el('button', { type: 'button', class: 'btn primary largo', disabled: !r, onclick: () => this.baixar3MF() }, 'Baixar 3MF pro Bambu Studio'),
      el('button', { type: 'button', class: 'btn', disabled: !r, onclick: () => this.abrirNoEstudio() }, 'Abrir no Estúdio 3D'),
      el('button', { type: 'button', class: 'btn', disabled: !r, onclick: () => this.baixarSTL() }, 'STL'),
      el('button', { type: 'button', class: 'btn', disabled: !r, onclick: () => this.baixarSVG() }, 'SVG'));
    c.appendChild(acoes);
    if (r) {
      const notas = [...r.avisos.filter(a => a.tipo === 'alerta')];
      for (const a of notas) c.appendChild(el('div', { class: 'e3d-nota aviso' }, a.texto));
    }
  }

  painelCoresFormato(c) {
    // cores = filamentos
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Cores (filamentos)'));
    const lista = el('div', { class: 'e3g-cores' });
    c.appendChild(lista);
    this.renderCores(lista);
    // tamanho
    c.appendChild(this.campoSlider('Tamanho', 'maior lado, em mm', this.cfg.tamanhoMM, 15, 150, 1, v => { this.cfg.tamanhoMM = v; }));
    // formato
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Formato'));
    c.appendChild(this.seg([['chaveiro', 'Chaveiro'], ['medalha', 'Medalha'], ['placa', 'Placa'], ['contorno', 'Só contorno']], this.cfg.modelo, v => { this.cfg.modelo = v; }));
  }

  blocoImpressora(c, lito) {
    const r = this.res;
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Impressora'));
    const imp = el('div', { class: 'e3d-l2' });
    const sel = el('select', { 'aria-label': 'Impressora' });
    for (const [k, p] of Object.entries(IMPRESSORAS)) sel.appendChild(el('option', { value: k, selected: k === this.cfg.impressora }, p.nome));
    sel.onchange = () => { this.cfg.impressora = sel.value; this.agendar(0); };
    const bico = el('select', { 'aria-label': 'Bico' });
    for (const b of [0.2, 0.4, 0.6]) bico.appendChild(el('option', { value: b, selected: b === this.cfg.bicoMM }, 'Bico ' + String(b).replace('.', ',') + ' mm'));
    bico.onchange = () => { this.cfg.bicoMM = +bico.value; this.agendar(0); };
    imp.append(el('div', {}, el('label', {}, 'Modelo'), sel), el('div', {}, el('label', {}, 'Bico'), bico));
    c.appendChild(imp);
    if (lito) return;
    c.appendChild(this.check('Tenho AMS (troca de cor automática)', this.cfg.estrategia !== 'troca', v => { this.cfg.estrategia = v ? 'ams' : 'troca'; }));
    if (r && r.pausas && r.pausas.length) c.appendChild(this.blocoPausas(r));
  }

  // PAUSAS (sem AMS e/ou tag NFC): onde parar e os dois jeitos de pôr no arquivo
  blocoPausas(r) {
    const d = el('div', { class: 'e3g-pausas' });
    const semAms = this.cfg.estrategia === 'troca';
    const fz = z => fmt(z, 2);
    d.innerHTML = '<div class="e3d-titulo" style="margin-top:0">Pausas na impressão</div>' +
      (semAms ? '<p>Sem AMS a peça vai com <b>um filamento só</b> (comece com a cor da base: <span class="hex">' + esc(r.corBase) + '</span>). A impressora para em cada troca, você troca o filamento e continua.</p>' : '') +
      '<ol>' + r.pausas.map(p => '<li><b>Camada ' + p.camada + '</b> <span>(' + fz(p.zBarra != null ? p.zBarra : p.z) + ' mm)</span> — ' + (p.tipo === 'nfc' ? 'coloque a tag NFC' : 'troque pra <i class="bolinha" style="background:' + esc(p.hex) + '"></i>' + esc(p.nome.toLowerCase())) + '</li>').join('') + '</ol>' +
      '<div class="jeito"><b>Automático:</b> no Bambu Studio, fatie e use <i>Arquivo → Exportar → Exportar arquivo fatiado da placa</i> (.gcode.3mf). Solte esse arquivo aqui: ele volta com as pausas no lugar certo, pronto pra imprimir (cartão microSD ou abrindo no Bambu Studio e imprimindo).</div>';
    const inp = el('input', { type: 'file', accept: '.3mf,.gcode', style: 'display:none', 'aria-label': 'Arquivo fatiado do Bambu' });
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) this.pausarFatiado(f); };
    const zona = el('button', { type: 'button', class: 'btn largo e3g-soltar', 'data-b': 'pausas' }, 'Colocar as pausas no arquivo fatiado…');
    zona.onclick = () => inp.click();
    zona.addEventListener('dragover', ev => { ev.preventDefault(); zona.classList.add('sobre'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
    zona.addEventListener('drop', ev => { ev.preventDefault(); zona.classList.remove('sobre'); const f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) this.pausarFatiado(f); });
    d.append(zona, inp);
    d.appendChild(el('div', { class: 'jeito', html: '<b>Na mão:</b> no Bambu Studio, depois de fatiar, clique com o botão direito no <b>+</b> da barra de camadas (à direita) na camada indicada → <i>Adicionar pausa</i>.' }));
    if (this.ultimasPausas && this.ultimasPausas.length) d.appendChild(el('div', { class: 'e3d-nota' }, 'Último arquivo: ' + this.ultimasPausas.map(p => 'camada ' + p.camada + (p.jaTinha ? ' (já tinha)' : '')).join(', ') + '.'));
    return d;
  }

  renderCores(lista) {
    const an = this.an, r = this.res;
    const baseHex = r ? r.corBase : (this.cfg.corBase !== 'auto' ? this.cfg.corBase : an.sugestao.corBase);
    const motivo = this.cfg.corBase === 'auto' ? MOTIVO_BASE[an.sugestao.motivo] || '' : 'escolhida por você';
    const linha = (cls, hex, nome, sub, aoCor, menu) => {
      const d = el('div', { class: 'e3g-cor ' + cls });
      const b = el('button', { type: 'button', class: 'bola', style: 'background:' + hex, title: 'Trocar a cor', 'aria-label': 'Trocar a cor de ' + nome });
      b.onclick = () => this.abrirPaleta(b, hex, aoCor, menu);
      d.append(b, el('div', { class: 'txt', html: '<b>' + esc(nome) + ' <span class="hex">' + esc(hex) + '</span></b><span>' + esc(sub) + '</span>' }));
      if (menu && menu.length) d.appendChild(el('button', { type: 'button', class: 'mais', title: 'Mais', 'aria-label': 'Mais opções de ' + nome, onclick: ev => this.abrirPaleta(ev.currentTarget, hex, aoCor, menu, true) }, '⋯'));
      lista.appendChild(d);
    };
    linha('base', baseHex, 'Base', 'embaixo de tudo — ' + motivo, hex => { this.cfg.corBase = hex; }, this.cfg.corBase !== 'auto' ? [['Voltar pra cor automática', () => { this.cfg.corBase = 'auto'; }]] : []);
    const v = this.cfg.verso;
    if (((v.tipo !== 'qr' && v.texto) || (v.tipo === 'qr' && v.qr)) && v.modo === 'cor' && this.cfg.estrategia !== 'troca') linha('', v.cor, 'Verso', v.tipo === 'qr' ? 'QR atrás, rente' : 'texto atrás, rente — "' + v.texto.split('\n')[0].slice(0, 18) + '"', h => { this.cfg.verso = { ...this.cfg.verso, cor: h }; if (v.tipo !== 'qr') this.rasterVerso(); }, []);
    const cracha = r ? r.cracha : null;
    for (const c of an.cores) {
      const u = this.cfg.cores[c.id] || {};
      if (u.juntarCom != null) continue;
      if (c.id === cracha) continue;          // virou a base
      const hex = (u.hex || c.hex).toUpperCase();
      const juntos = an.cores.filter(o => (this.cfg.cores[o.id] || {}).juntarCom === c.id).map(o => o.nome.toLowerCase());
      const sub = u.desligada ? 'fica na base (não sobe)' : Math.round(c.fracao * 100) + '% da logo' + (juntos.length ? ' + ' + juntos.join(', ') : '');
      const menu = [];
      if (u.desligada) menu.push(['Erguer de novo', () => { delete this.cfg.cores[c.id].desligada; }]);
      else menu.push(['Deixar na base (não sobe)', () => { this.cfg.cores[c.id] = { ...u, desligada: true }; }]);
      for (const o of an.cores) if (o.id !== c.id && (this.cfg.cores[o.id] || {}).juntarCom == null && o.id !== cracha) menu.push(['Juntar com ' + o.nome.toLowerCase(), () => { this.cfg.cores[c.id] = { ...u, juntarCom: o.id }; }]);
      if (juntos.length) menu.push(['Separar as cores juntadas', () => { for (const o of an.cores) if ((this.cfg.cores[o.id] || {}).juntarCom === c.id) delete this.cfg.cores[o.id].juntarCom; }]);
      if (u.hex) menu.push(['Voltar pra cor da logo', () => { delete this.cfg.cores[c.id].hex; }]);
      linha(u.desligada ? 'desligada' : '', hex, c.nome, sub, h => { this.cfg.cores[c.id] = { ...u, hex: h }; }, menu);
    }
  }

  abrirPaleta(ancora, hex, aoCor, menu, soMenu) {
    this.fecharPaleta();
    const p = el('div', { class: 'e3g-paleta e3d-vidro', role: 'dialog', 'aria-label': 'Escolher cor' });
    if (!soMenu) {
      const grade = el('div', { class: 'grade' });
      for (const [n, h] of FILAMENTOS) grade.appendChild(el('button', { type: 'button', title: n + ' (PLA Basic)', 'aria-label': n, style: 'background:' + h, onclick: () => { aoCor(h); this.fecharPaleta(); this.renderPainel(); this.agendar(0); } }));
      const livre = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff' });
      livre.onchange = () => { aoCor(livre.value.toUpperCase()); this.fecharPaleta(); this.renderPainel(); this.agendar(0); };
      p.append(grade, el('label', {}, livre, 'Outra cor'));
    }
    if (menu && menu.length) {
      const a = el('div', { class: 'acoes' });
      for (const [t, fn] of menu) a.appendChild(el('button', { type: 'button', onclick: () => { fn(); this.fecharPaleta(); this.renderPainel(); this.agendar(0); } }, t));
      p.appendChild(a);
    }
    const pr = this.painel.getBoundingClientRect(), ar = ancora.getBoundingClientRect();
    this.painel.style.position = 'relative';
    p.style.left = Math.max(8, Math.min(pr.width - 244, ar.left - pr.left)) + 'px';
    p.style.top = (ar.bottom - pr.top + 6) + 'px';
    this.painel.appendChild(p);
    this.paletaEl = p;
    const fora = ev => { if (!p.contains(ev.target) && ev.target !== ancora) this.fecharPaleta(); };
    const tecla = ev => { if (ev.key === 'Escape') this.fecharPaleta(); };
    setTimeout(() => { document.addEventListener('pointerdown', fora, true); document.addEventListener('keydown', tecla); }, 0);
    this._fecharPaleta = () => { document.removeEventListener('pointerdown', fora, true); document.removeEventListener('keydown', tecla); };
    const primeiro = p.querySelector('button'); if (primeiro) primeiro.focus();
  }
  fecharPaleta() { if (this.paletaEl) { this.paletaEl.remove(); this.paletaEl = null; } if (this._fecharPaleta) { this._fecharPaleta(); this._fecharPaleta = null; } }

  painelPersonalizar(c) {
    const a = this.cfg.argola;
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Argola'));
    c.appendChild(this.seg([['topo', 'Topo'], ['esquerda', 'Esquerda'], ['direita', 'Direita'], ['canto', 'Canto'], ['sem', 'Sem']], a.ligada ? (a.posicao === 'livre' ? null : a.posicao) : 'sem', v => {
      if (v === 'sem') this.cfg.argola = { ...a, ligada: false }; else this.cfg.argola = { ...a, ligada: true, posicao: v, ponto: null };
    }));
    if (a.ligada) {
      if (a.posicao !== 'canto') c.appendChild(this.check('No meio da peça', a.centro !== false, v => { this.cfg.argola = { ...this.cfg.argola, centro: v }; }));
      c.appendChild(el('p', { class: 'u', style: 'margin:4px 0 10px' }, a.posicao === 'livre' ? 'Argola no lugar onde você soltou. Escolha Topo/Esquerda/Direita pra voltar ao automático.' : 'Dica: arraste a argola na prévia pra pôr onde quiser — ela nunca fica em cima do desenho.'));
      c.appendChild(this.campoSlider('Furo', 'diâmetro, mm (argola comum: 4 a 5)', a.furoMM, 2, 10, 0.5, v => { this.cfg.argola = { ...this.cfg.argola, furoMM: v }; }));
    }
    if (this.cfg.modelo === 'litofania') { c.appendChild(el('p', { class: 'u', style: 'margin:10px 0' }, 'Litofania é uma peça só, branca: verso, alturas e cores não se aplicam. Forma, espessura, contraste e moldura ficam em Padrão.')); return; }
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Verso (atrás)'));
    const v = this.cfg.verso, qr = v.tipo === 'qr', box = el('div', { class: 'e3g-verso' });
    box.appendChild(this.seg([['texto', 'Texto'], ['qr', 'QR code']], qr ? 'qr' : 'texto', t => {
      // troca o tipo: o QR vai direto pro motor; o texto vira máscara aqui
      const at = this.cfg.verso;
      this.cfg.verso = t === 'qr' ? { tipo: 'qr', texto: '', qrTexto: at.qrTexto || '', qr: at.qrTexto || '', modo: 'cor', cor: at.cor && at.cor !== '#FFFFFF' ? at.cor : '#000000' }
        : { tipo: 'texto', texto: at.textoSalvo || '', modo: at.modo, cor: at.cor === '#000000' ? '#FFFFFF' : at.cor, qrTexto: at.qrTexto };
      if (t !== 'qr') this.rasterVerso();
    }));
    let tv = null;
    if (qr) {
      const inp = el('input', { type: 'text', maxlength: 200, placeholder: 'Link ou texto: instagram.com/seuperfil, wa.me/55219…', 'aria-label': 'QR do verso', autocomplete: 'off' });
      inp.value = v.qrTexto || '';
      inp.oninput = () => { clearTimeout(tv); tv = setTimeout(() => { const q = inp.value.trim(); this.cfg.verso = { ...this.cfg.verso, qrTexto: q, qr: q }; this.agendar(0); }, 400); };
      const rap = el('div', { class: 'rapidos' });
      const modelo = t => () => { if (!inp.value.trim()) { inp.value = t; inp.dispatchEvent(new Event('input')); } inp.focus(); };
      rap.append(el('button', { type: 'button', onclick: modelo('https://instagram.com/') }, 'Instagram'), el('button', { type: 'button', onclick: modelo('https://wa.me/55') }, 'WhatsApp'), el('button', { type: 'button', onclick: modelo('https://') }, 'Site'));
      box.append(inp, rap);
    } else {
      const ta = el('textarea', { rows: 2, maxlength: 60, placeholder: 'Ex.: @seuinstagram ou (21) 99999-9999 — até 2 linhas', 'aria-label': 'Texto no verso' });
      ta.value = v.texto || '';
      ta.oninput = () => { clearTimeout(tv); tv = setTimeout(() => { const t = ta.value.split('\n').slice(0, 2).join('\n').trim(); this.cfg.verso = { ...this.cfg.verso, texto: t, textoSalvo: t }; this.rasterVerso(); this.agendar(0); }, 350); };
      const rap = el('div', { class: 'rapidos' });
      const modelo = t => () => { if (!ta.value.trim()) { ta.value = t; ta.dispatchEvent(new Event('input')); } ta.focus(); };
      rap.append(el('button', { type: 'button', onclick: modelo('@') }, '@ Instagram'), el('button', { type: 'button', onclick: modelo('(21) 9') }, 'Telefone'), el('button', { type: 'button', onclick: modelo('Nome\n(21) 9') }, 'Nome + telefone'));
      box.append(ta, rap);
    }
    c.appendChild(box);
    const info = this.res && this.res.verso;
    if (qr && v.qr) {
      c.appendChild(el('p', { class: 'u', style: 'margin:0 0 10px' }, 'O QR sai colorido e rente nas primeiras camadas (use uma cor escura numa base clara).' + (info && info.qr ? ' Tamanho ' + fmt(info.qr.ladoMM, 0) + ' mm, quadradinhos de ' + fmt(info.qr.moduloMM, 2) + ' mm.' : '') + ' Teste com a câmera do celular olhando a prévia em "Verso".'));
    } else if (!qr && v.texto) {
      c.appendChild(this.seg([['cor', 'Colorido, rente (AMS)'], ['gravado', 'Gravado']], v.modo, m => { this.cfg.verso = { ...this.cfg.verso, modo: m }; this.rasterVerso(); }));
      c.appendChild(el('p', { class: 'u', style: 'margin:0 0 10px' }, (v.modo === 'cor' ? 'Sai nas primeiras camadas, colado na mesa: liso e com a cor que você escolher em Cores.' : 'Gravado no fundo, sem trocar filamento.') + (info && info.alturaLetraMM ? ' Letras com ' + fmt(info.alturaLetraMM, 1) + ' mm.' : '') + ' Veja em "Verso", embaixo da prévia.'));
    }
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Alturas'));
    c.appendChild(this.seg([['degraus', 'Em degraus'], ['iguais', 'Tudo na mesma altura']], this.cfg.alturas, v => { this.cfg.alturas = v; }));
    c.appendChild(el('p', { class: 'u', style: 'margin:0 0 10px' }, this.cfg.alturas === 'degraus' ? 'O que está dentro de outra cor fica um degrau mais alto (profundidade, como na logo).' : 'Todas as cores na mesma altura: menos trocas de filamento.'));
    const res = this.res;
    const alt = res ? res.alturas : null;
    c.appendChild(this.campoSlider('Base', 'espessura, mm' + (alt ? ' (vai ' + fmt(alt.base, 1) + ')' : ''), this.cfg.altBase, 1, 6, 0.2, v => { this.cfg.altBase = v; }));
    c.appendChild(this.campoSlider('Relevo', 'altura do desenho, mm', this.cfg.altArte, 0.4, 4, 0.2, v => { this.cfg.altArte = v; }));
    if (this.cfg.modelo !== 'contorno') c.appendChild(this.campoSlider('Borda', 'em volta da logo, mm', this.cfg.bordaMM, 0.5, 8, 0.5, v => { this.cfg.bordaMM = v; }));
    if (this.cfg.modelo === 'placa') c.appendChild(this.campoSlider('Canto da placa', 'raio, mm', this.cfg.cantoMM, 0, 15, 0.5, v => { this.cfg.cantoMM = v; }));
  }

  painelAvancado(c) {
    const an = this.an;
    this.blocoTipo(c, true);
    if (this.cfg.modelo === 'litofania') {
      if (this.cfg.argola.ligada) c.appendChild(this.campoSlider('Parede da argola', 'mm', this.cfg.argola.paredeMM, 1.2, 5, 0.1, v => { this.cfg.argola = { ...this.cfg.argola, paredeMM: v }; }));
      return this.diagnostico(c);
    }
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Detalhes'));
    c.appendChild(this.check('Engrossar traço mais fino que o bico', this.cfg.engrossar, v => { this.cfg.engrossar = v; }));
    c.appendChild(el('p', { class: 'u', style: 'margin:0 0 10px' }, 'Traço mais fino que o bico some no fatiador. Ligado, ele engrossa só o necessário, no mesmo lugar.'));
    c.appendChild(this.campoSlider('Degrau entre cores', 'mm (em degraus)', this.cfg.degrauMM, 0.2, 2, 0.2, v => { this.cfg.degrauMM = v; }));
    if (this.cfg.argola.ligada) c.appendChild(this.campoSlider('Parede da argola', 'mm', this.cfg.argola.paredeMM, 1.2, 5, 0.1, v => { this.cfg.argola = { ...this.cfg.argola, paredeMM: v }; }));
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Tag NFC'));
    const n = this.cfg.nfc;
    c.appendChild(this.check('Bolso pra tag NFC', n.ligado, v => { this.cfg.nfc = { ...this.cfg.nfc, ligado: v }; }));
    if (n.ligado) {
      c.appendChild(this.seg([['baixo', 'Por baixo (cola depois)'], ['fechado', 'Fechada dentro (pausa)']], n.modo, v => { this.cfg.nfc = { ...this.cfg.nfc, modo: v }; }));
      c.appendChild(this.campoSlider('Diâmetro da tag', 'mm', n.diametroMM, 10, 40, 1, v => { this.cfg.nfc = { ...this.cfg.nfc, diametroMM: v }; }));
      c.appendChild(this.campoSlider('Profundidade', 'mm', n.profundidadeMM, 0.4, 3, 0.1, v => { this.cfg.nfc = { ...this.cfg.nfc, profundidadeMM: v }; }));
      if (this.res && this.res.nfc && this.res.nfc.modo === 'fechado') c.appendChild(this.blocoPausas(this.res));
    }
    this.diagnostico(c);
  }

  diagnostico(c) {
    const an = this.an;
    c.appendChild(el('div', { class: 'e3d-titulo' }, 'Análise da imagem'));
    const d = el('div', { class: 'e3d-diag' });
    const lin = (a, b) => d.append(el('span', {}, a), el('b', {}, b));
    lin('Recorte', MODO_RECORTE[an.modo]);
    if (an.foto) lin('Foto?', an.foto.provavel ? 'sim (' + an.foto.tons + ' tons)' : 'não (' + an.foto.tons + ' tons)');
    if (an.fundo) lin('Cor do fundo', an.fundo.nome + ' ' + an.fundo.hex);
    lin('Cores achadas', String(an.cores.length) + (an.coresBrutas > an.cores.length ? ' (de ' + an.coresBrutas + ')' : ''));
    lin('Resolução', an.W + '×' + an.H + ' px');
    lin('Tempo', fmt(an.ms / 1000, 2) + ' s + ' + (this.res ? fmt(this.res.ms / 1000, 2) + ' s' : '—'));
    c.appendChild(d);
    c.appendChild(el('button', { type: 'button', class: 'btn', style: 'margin-top:10px', onclick: () => { const lito = this.cfg.modelo === 'litofania'; this.cfg = clone(PADRAO); if (lito) this.cfg.modelo = 'litofania'; this.renderPainel(); this.agendar(0); } }, 'Voltar tudo ao automático'));
  }

  // componentes do painel
  seg(ops, atual, aoMudar) {
    const s = el('div', { class: 'seg' });
    for (const [v, t] of ops) s.appendChild(el('button', { type: 'button', 'data-v': v, class: v === atual ? 'active' : '' }, t));
    s.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; aoMudar(b.dataset.v); this.renderPainel(); this.agendar(0); };
    return s;
  }
  check(rot, valor, aoMudar) {
    const i = el('input', { type: 'checkbox' }); i.checked = !!valor;
    i.onchange = () => { aoMudar(i.checked); this.renderPainel(); this.agendar(0); };
    return el('label', { class: 'e3g-check' }, i, rot);
  }
  campoSlider(rot, sub, valor, min, max, passo, aoMudar) {
    const b = el('div', { class: 'e3g-bloco field' });
    b.appendChild(el('label', { html: esc(rot) + ' <span class="u">' + esc(sub) + '</span>' }));
    const r = el('input', { type: 'range', min, max, step: passo, value: valor, 'aria-label': rot });
    const t = el('input', { type: 'text', inputmode: 'decimal', value: fmt(valor, passo < 1 ? 1 : 0), 'aria-label': rot + ' (número)' });
    r.oninput = () => { t.value = fmt(+r.value, passo < 1 ? 1 : 0); aoMudar(+r.value); this.agendar(); };
    const confirmar = () => { const v = Math.max(min, Math.min(max * 2, lerNumero(t.value, valor))); r.value = v; aoMudar(v); this.agendar(0); };
    t.onchange = confirmar;
    t.onkeydown = ev => { if (ev.key === 'Enter') confirmar(); };
    b.appendChild(el('div', { class: 'e3d-slider' }, r, t));
    return b;
  }

  // texto do verso -> máscara (alfa) que vai pro motor junto com a config
  rasterVerso() {
    const v = this.cfg.verso, linhas = (v.texto || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 2);
    if (v.tipo === 'qr') return;
    if (!linhas.length) { this.cfg.verso = { tipo: 'texto', texto: '', modo: v.modo, cor: v.cor, qrTexto: v.qrTexto }; return; }
    const tam = 160, f = '800 ' + tam + 'px "Arial Black", Arial, sans-serif';
    const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    g.font = f;
    const w = Math.min(3000, Math.ceil(Math.max(...linhas.map(l => g.measureText(l).width))) + 40), h = Math.round(linhas.length * tam * 1.18) + 30;
    cv.width = w; cv.height = h;
    g.font = f; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
    linhas.forEach((l, i) => g.fillText(l, w / 2, 15 + tam * 1.18 * (i + 0.5)));
    const d = g.getImageData(0, 0, w, h).data, alfa = new Uint8Array(w * h);
    for (let i = 0; i < alfa.length; i++) alfa[i] = d[i * 4 + 3];
    this.cfg.verso = { ...v, alfa, w, h, linhas: linhas.length, nome: 'Verso' };
  }

  /* ------------------------------------------------------------ argola (arrastar) */
  localDe(ev) {
    const z = this.res ? this.res.alturas.base : 2.4;
    const p = this.visor.pontoNoPlano(ev, [0, 0, 1], z);
    return p ? [p.x - this.pos[0], p.y - this.pos[1]] : null;
  }
  naArgola(ev) {
    const a = this.res && this.res.argola; if (!a) return false;
    const q = this.localDe(ev); if (!q) return false;
    return Math.hypot(q[0] - a.xMM, q[1] - a.yMM) <= a.alcaMM * 1.15;
  }
  ligarArgola() {
    const cv = this.visor.renderer.domElement;
    cv.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || !this.naArgola(ev)) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      this.visor.controles.enabled = false;
      cv.setPointerCapture(ev.pointerId);
      const a = this.res.argola;
      const g = new THREE.RingGeometry(a.furoMM / 2, a.alcaMM, 48);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe54c00, transparent: true, opacity: 0.55, depthTest: false }));
      m.renderOrder = 20; m.position.set(this.pos[0] + a.xMM, this.pos[1] + a.yMM, this.res.medidas.espessura + 0.2);
      this.visor.raizAjuda.add(m);
      this.arrasto = { m, id: ev.pointerId };
      this.visor.pedirRender();
    }, true);
    cv.addEventListener('pointermove', ev => {
      if (this.arrasto) {
        const q = this.localDe(ev); if (!q) return;
        this.arrasto.m.position.set(this.pos[0] + q[0], this.pos[1] + q[1], this.arrasto.m.position.z);
        this.arrasto.q = q;
        this.visor.pedirRender();
        return;
      }
      if (ev.buttons === 0) cv.style.cursor = this.naArgola(ev) ? 'grab' : '';
    });
    const soltar = ev => {
      if (!this.arrasto) return;
      const { m, q } = this.arrasto;
      this.arrasto = null;
      this.visor.controles.enabled = true;
      this.visor.raizAjuda.remove(m); m.geometry.dispose(); m.material.dispose();
      this.visor.pedirRender();
      try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
      if (!q) return;
      // mm -> px da análise -> posição relativa na caixa da logo (sobrevive a trocar o tamanho)
      const { esc: k, tx, ty } = this.res.transformada, cx = this.an.caixa;
      const xp = (q[0] - tx) / k, yp = -(q[1] - ty) / k;
      this.cfg.argola = { ...this.cfg.argola, ligada: true, posicao: 'livre', ponto: { u: (xp - cx.x0) / cx.w, v: (yp - cx.y0) / cx.h } };
      if (this.aba === 'personalizar') this.renderPainel();
      this.agendar(0);
    };
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', soltar);
  }

  /* ------------------------------------------------------------ comparar (original × chaveiro) */
  ligarComparar() {
    const c = this.compararEl;
    let arrastando = false;
    const mover = ev => { const r = c.getBoundingClientRect(); this.corteX = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); this.aplicarCorte(); };
    c.addEventListener('pointerdown', ev => { arrastando = true; c.setPointerCapture(ev.pointerId); mover(ev); });
    c.addEventListener('pointermove', ev => { if (arrastando) mover(ev); });
    c.addEventListener('pointerup', () => { arrastando = false; });
    c.addEventListener('dblclick', () => this.fecharComparar());
  }
  alternarComparar() { if (this.compararEl.classList.contains('on')) this.fecharComparar(); else this.abrirComparar(); }
  abrirComparar() {
    if (!this.res || !this.origem) return;
    this.vista('topo');
    this.visor.controles.enabled = false;
    this.corteX = this.corteX == null ? 0.5 : this.corteX;
    this.compararEl.querySelector('img').src = (this.cfg.modelo === 'litofania' && this.urlSimulacao()) || this.origem.url;
    this.compararEl.classList.add('on');
    this.vistasEl.querySelector('[data-b=comparar]').classList.add('ativo');
    requestAnimationFrame(() => this.posicionarComparar());
  }
  fecharComparar() {
    if (!this.compararEl.classList.contains('on')) return;
    this.compararEl.classList.remove('on');
    this.visor.controles.enabled = true;
    this.vistasEl.querySelector('[data-b=comparar]').classList.remove('ativo');
  }
  posicionarComparar() {
    const r = this.res, an = this.an, { esc: k, tx, ty } = r.transformada;
    const z = r.medidas.espessura;
    // canto da imagem (px da análise) -> mm na mesa -> tela; litofania: a caixa da simulação (mm)
    const w = (x, y) => this.visor.telaDe(this.pos[0] + x * k + tx, this.pos[1] - y * k + ty, z);
    const cm = r.litofania && this.cfg.modelo === 'litofania' ? r.litofania.caixaMM : null;
    const wm = (X, Y) => this.visor.telaDe(this.pos[0] + X, this.pos[1] + Y, z);
    const a = cm ? wm(cm[0], cm[3]) : w(0, 0), b = cm ? wm(cm[2], cm[1]) : w(an.W, an.H), box = this.compararEl.getBoundingClientRect();
    const img = this.compararEl.querySelector('img');
    Object.assign(img.style, { left: (Math.min(a.x, b.x) - box.left) + 'px', top: (Math.min(a.y, b.y) - box.top) + 'px', width: Math.abs(b.x - a.x) + 'px', height: Math.abs(b.y - a.y) + 'px' });
    this.aplicarCorte();
  }
  aplicarCorte() {
    const c = this.compararEl, img = c.querySelector('img'), box = c.getBoundingClientRect();
    const x = this.corteX * box.width;
    c.querySelector('.corte').style.left = (x - 1) + 'px';
    const il = parseFloat(img.style.left) || 0, iw = parseFloat(img.style.width) || 1;
    const direita = Math.max(0, Math.min(iw, il + iw - x));
    img.style.clipPath = 'inset(0 ' + direita + 'px 0 0)';
  }

  /* ------------------------------------------------------------ saídas */
  // sem AMS: pro Bambu vai UM sólido de um filamento (a cor muda na pausa);
  // o Estúdio recebe as faixas coloridas (pra ver/editar)
  partesExport(paraImprimir = true) {
    const r = this.res;
    const ps = paraImprimir && this.cfg.estrategia === 'troca' && r.pecaUnica ? [r.pecaUnica] : r.partes;
    return ps.map(p => ({ nome: p.nome, cor: p.cor, malha: { pos: p.malha.pos, idx: p.malha.idx } }));
  }

  // arquivo fatiado do Bambu (.gcode.3mf ou .gcode) -> o mesmo arquivo com as pausas
  async pausarFatiado(f) {
    const r = this.res;
    if (!r || !r.pausas || !r.pausas.length || !f) return;
    if (f.size > 300 * 1024 * 1024) { avisar('Arquivo grande demais (máximo 300 MB).', 'warn'); return; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const x = await this.motor.rodar('geradorPausas', { bytes, pausas: r.pausas.map(p => ({ z: p.z, texto: p.texto })) });
      if (x.erro) { avisar(x.erro, 'warn'); return; }
      const nomeBase = (f.name || 'chaveiro').replace(/\.gcode\.3mf$|\.3mf$|\.gcode$/i, '');
      baixar(x.bytes, nomeBase + '-com-pausas' + (x.formato === '3mf' ? '.gcode.3mf' : '.gcode'), x.formato === '3mf' ? 'model/3mf' : 'text/x-gcode');
      this.ultimasPausas = x.feitas;
      const lista = x.feitas.map(p => 'camada ' + p.camada).join(', ');
      avisar((x.feitas.length === 1 ? 'Pausa colocada: ' : x.feitas.length + ' pausas colocadas: ') + lista + '. Imprima esse arquivo.' + (x.avisos.length ? ' ' + x.avisos.join(' ') : ''), x.avisos.length ? 'warn' : 'ok');
      if (this.aba === 'personalizar') this.renderPainel();
    } catch (e) { avisar('Não consegui colocar as pausas: ' + (e.message || e), 'warn'); }
  }

  async baixar3MF() {
    if (!this.res) return;
    const nome = this.nomePeca();
    const b = this.topo.querySelector('[data-b=baixar3mf]'); b.disabled = true;
    try {
      const r = await this.motor.rodar('exportar3MF', { cena: { objetos: [{ nome, transform: M4.identidade(), partes: this.partesExport() }] }, opc: { titulo: nome } });
      baixar(r.bytes, nomeArquivo(nome, 'chaveiro') + '.3mf', 'model/3mf');
      if (this.res.litofania) avisar('3MF da litofania pronto: filamento BRANCO, camada ' + fmt(this.res.litofania.camadaSugerida, 2) + ' mm, preenchimento 100%.', 'ok');
      else if (this.cfg.estrategia === 'troca' && this.res.pecaUnica) avisar('3MF de um filamento só pronto. Fatie no Bambu e coloque as pausas (camadas ' + (this.res.pausas || []).map(p => p.camada).join(', ') + ') — veja "Pausas" no painel.', 'ok');
      else avisar('3MF pronto — abra no Bambu Studio (ele já vem com as cores).', 'ok');
    } catch (e) { avisar('Não consegui gerar o 3MF: ' + (e.message || e), 'warn'); }
    finally { b.disabled = false; }
  }
  async baixarSTL() {
    if (!this.res) return;
    const nome = this.nomePeca();
    const objetos = this.partesExport().map(p => ({ nome: nome + '-' + p.nome, transform: M4.identidade(), partes: [p] }));
    try {
      const r = await this.motor.rodar('exportarSTL', { cena: { objetos }, opc: {} });
      baixar(r.bytes, nomeArquivo(nome, 'chaveiro') + (r.zip ? '-stl.zip' : '.stl'), r.zip ? 'application/zip' : 'model/stl');
    } catch (e) { avisar('Não consegui gerar o STL: ' + (e.message || e), 'warn'); }
  }
  baixarSVG() {
    if (!this.res) return;
    const r = this.res, W = r.medidas.largura, H = r.medidas.altura;
    const caminho = pols => pols.map(p => 'M' + p.map(v => v[0].toFixed(3) + ' ' + (H - v[1]).toFixed(3)).join('L') + 'Z').join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W.toFixed(2) + 'mm" height="' + H.toFixed(2) + 'mm" viewBox="0 0 ' + W.toFixed(3) + ' ' + H.toFixed(3) + '">' +
      r.vista.map(v => '<path fill="' + v.cor + '" fill-rule="nonzero" d="' + caminho(v.poligonos) + '"/>').join('') + '</svg>';
    baixar(new TextEncoder().encode(svg), nomeArquivo(this.nomePeca(), 'chaveiro') + '.svg', 'image/svg+xml');
  }
  async abrirNoEstudio() {
    if (!this.res) return;
    const partes = this.partesExport(false), nome = this.nomePeca();
    try {
      if (typeof window.ferModoFerramentas !== 'function') throw new Error('Estúdio indisponível');
      const E = await window.ferModoFerramentas('estudio');
      E.estudio.adicionarObjetos([{ nome, transform: M4.identidade(), partes }], { rotulo: 'Abrir do gerador', centralizar: true });
      avisar('Chaveiro aberto no Estúdio 3D.', 'ok');
    } catch (e) { avisar('Não consegui abrir no Estúdio: ' + (e.message || e), 'warn'); }
  }

  redimensionar() { this.visor.redimensionar(); }
}

function carregarImagem(url) {
  return new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('imagem')); i.src = url; });
}

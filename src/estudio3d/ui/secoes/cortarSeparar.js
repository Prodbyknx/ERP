// Painel "Cortar e separar": as tarefas de dividir a peça num lugar só, em
// abas. Cada aba é o painel de sempre (Cortar, Selecionar + Separar, Por cor),
// aberto/fechado aqui: cada um liga e desliga a própria ferramenta do 3D.
import { el } from '../util.js';
import { montarCortar } from './cortar.js';
import { montarSelecionar } from './selecionar.js';
import { montarSeparar } from './separar.js';

export const ABAS_CS = [
  ['corte', 'Cortar', 'Corte reto: a peça inteira em duas, ou só uma parte (mão, cabeça, orelha). As partes saem fechadas, com pino de encaixe se quiser.'],
  ['sep', 'Soltar um detalhe', 'Clique no detalhe no 3D (olho, botão, orelha, logo): a seleção para sozinha na dobra. Depois veja a prévia e separe.'],
  ['cor', 'Por cor', 'Cada cor vira uma peça física, pra imprimir sem AMS e montar depois.']
];
// seção antiga -> aba (atalhos, menu e sugestões ainda chamam pelo nome antigo)
export const ABA_DA_SECAO = { corte: 'corte', sel: 'sep', sep: 'sep', cor: 'cor' };

export function montarCortarSeparar(est) {
  const d = el('details', { 'data-sec': 'cs' });
  d.innerHTML = `<summary>Cortar e separar</summary><div class="e3d-sec">
    <div class="seg" data-a="aba">${ABAS_CS.map(a => '<button type="button" data-v="' + a[0] + '">' + a[1] + '</button>').join('')}</div>
    <p class="u" data-a="dicaAba" style="margin-top:-2px"></p>
    <div data-a="corpo"></div></div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  const cortar = montarCortar(est), selecionar = montarSelecionar(est), separar = montarSeparar(est);
  const subs = [cortar.el, selecionar.el, separar.el];
  for (const x of subs) x.classList.add('e3d-sub');
  // "Soltar um detalhe": passo 1 (escolher) e passo 2 (separar), um embaixo do outro
  separar.el.querySelector('.e3d-sec').prepend(el('div', { class: 'e3d-titulo e3d-passo' }, '2. Separar'));
  selecionar.el.querySelector('.e3d-sec').prepend(el('div', { class: 'e3d-titulo e3d-passo' }, '1. Escolher o detalhe'));
  q('corpo').append(cortar.el, selecionar.el, separar.el, separar.elCor);
  let aba = 'corte';

  function sub(x, abrir) {
    if (x.open === abrir) return;
    x.open = abrir;
    x.dispatchEvent(new Event('toggle'));
  }
  function mostrar() {
    const quer = new Set(d.open ? (aba === 'corte' ? [cortar.el] : aba === 'sep' ? [selecionar.el, separar.el] : []) : []);
    // fecha antes de abrir (cada um desliga a própria ferramenta); o Separar
    // fecha antes do Selecionar, senão a seleção automática fica ligada
    for (const x of [cortar.el, separar.el, selecionar.el]) if (!quer.has(x)) sub(x, false);
    for (const x of subs) if (quer.has(x)) sub(x, true);
    separar.elCor.style.display = aba === 'cor' ? '' : 'none';
    q('aba').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === aba));
    q('dicaAba').textContent = ABAS_CS.find(a => a[0] === aba)[2];
  }
  q('aba').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b && b.dataset.v !== aba) { aba = b.dataset.v; mostrar(); } });
  d.addEventListener('toggle', mostrar);
  mostrar();
  return { el: d, cortar, selecionar, separar, aba: () => aba, irPara: a => { aba = ABA_DA_SECAO[a] || a; mostrar(); } };
}

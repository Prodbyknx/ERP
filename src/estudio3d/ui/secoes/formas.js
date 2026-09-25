// Painel "Formas": biblioteca (3D, 2D com espessura, peças prontas pra
// impressão). Clique -> a forma aparece na mesa. Medidas em mm editáveis
// (a geometria é refeita no motor, sempre sólida). Sólido ou Furo.
import { el, fmt, lerNumero, avisar } from '../util.js';
import { FORMAS, formaPorId, paramsPadrao } from '../../core/formas.js';
import { formaDeTexto, FONTES } from '../formas2d.js';
import * as M4 from '../../core/mat4.js';

const GRUPOS = [['3d', 'Formas 3D'], ['2d', 'Formas planas (com espessura)'], ['pronta', 'Peças prontas pra impressão']];

// desenho pequeno de cada forma (cartão)
const DESENHO = {
  cubo: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 21v-9M20 7.5 12 12 4 7.5"/>',
  caixa: '<path d="M3 9.5 8 6h13l-5 3.5z"/><path d="M3 9.5h13v9H3z"/><path d="M16 9.5 21 6v9l-5 3.5"/>',
  esfera: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3"/>',
  cilindro: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>',
  cone: '<path d="M12 3 4.5 18.5M12 3l7.5 15.5"/><ellipse cx="12" cy="18.5" rx="7.5" ry="2.5"/>',
  piramide: '<path d="M12 3 3 17l9 4 9-4z"/><path d="M12 3v18"/>',
  prisma: '<path d="M7 4h10l4 5-4 5H7L3 9z"/><path d="M3 9v7l4 5h10l4-5V9"/>',
  tubo: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><ellipse cx="12" cy="5.5" rx="3" ry="1"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>',
  anel: '<ellipse cx="12" cy="12" rx="9" ry="5"/><ellipse cx="12" cy="11.5" rx="4" ry="1.8"/>',
  capsula: '<rect x="7" y="2.5" width="10" height="19" rx="5"/>',
  hemisferio: '<path d="M3.5 16a8.5 8.5 0 0 1 17 0z"/>',
  placa: '<path d="M2.5 12 9 8h12.5L15 12z"/><path d="M2.5 12v3h12.5l6.5-4V8M15 12v3"/>',
  circulo: '<circle cx="12" cy="12" r="8.5"/>',
  quadrado: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  retangulo: '<rect x="2.5" y="7" width="19" height="10" rx="1"/>',
  triangulo: '<path d="M12 4 21 19.5H3z"/>',
  estrela: '<path d="m12 2.8 2.7 5.8 6.3.8-4.6 4.3 1.2 6.3L12 17l-5.6 3.2 1.2-6.3L3 9.4l6.3-.8z"/>',
  hexagono: '<path d="M7.5 4h9l4.5 8-4.5 8h-9L3 12z"/>',
  poligono: '<path d="M9 3h6l5 5v8l-5 5H9l-5-5V8z"/>',
  coracao: '<path d="M12 20.5S3.5 15 3.5 9A4.5 4.5 0 0 1 12 6.8 4.5 4.5 0 0 1 20.5 9c0 6-8.5 11.5-8.5 11.5z"/>',
  texto: '<path d="M4 7V4.5h16V7M9 20h6M12 4.5V20"/>',
  furoParafuso: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  argola: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
  pino: '<rect x="8.5" y="2.5" width="7" height="19" rx="2"/><path d="M8.5 6h7M8.5 18h7"/>',
  espacador: '<ellipse cx="12" cy="8" rx="8" ry="3"/><ellipse cx="12" cy="8" rx="3" ry="1.1"/><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8"/>',
  imaFuro: '<path d="M6 3.5v8a6 6 0 0 0 12 0v-8"/><path d="M6 7.5h4M14 7.5h4"/>',
  base: '<path d="M2.5 13 8 9h13.5L16 13z"/><path d="M2.5 13v3.5H16l5.5-4V9M16 13v3.5"/>'
};
const svg = (id, t = 26) => '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (DESENHO[id] || '') + '</svg>';

export function montarFormas(est) {
  const d = el('details', { 'data-sec': 'formas' });
  d.innerHTML = `<summary>Formas</summary><div class="e3d-sec">
    <div data-a="props"></div>
    ${GRUPOS.map(([g, t]) => '<div class="e3d-titulo" style="margin-top:14px">' + t + '</div><div class="e3d-formas">' +
      FORMAS.filter(f => f.grupo === g).map(f => '<button type="button" class="e3d-forma" data-forma="' + f.id + '" title="Adicionar ' + f.nome + '">' + svg(f.id) + '<span>' + f.nome + '</span></button>').join('') + '</div>').join('')}
    <p class="u" style="margin-top:12px">Dica: <b>Shift + clique</b> escolhe várias peças. Aí aparecem, em cima do 3D, <b>Unir</b>, <b>Tirar uma da outra</b>, <b>Parte comum</b> e <b>Alinhar</b>. Uma peça marcada como <b>Furo</b> tira material de quem ela atravessa.</p>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');

  // texto 3D: contorno feito aqui (fonte do navegador), extrudado no motor
  const extrasDe = (id, forma) => {
    if (id !== 'texto') return {};
    const t = (forma && forma.texto) || '144 LAB';
    const f = formaDeTexto(t, { fonte: (forma && forma.fonte) || 'Arial Black', negrito: true, largura: 100 });
    return { aneis: f.aneis };
  };

  async function adicionar(id) {
    const def = formaPorId(id);
    const params = paramsPadrao(id);
    const forma = { id, params, texto: id === 'texto' ? '144 LAB' : undefined, fonte: id === 'texto' ? 'Arial Black' : undefined };
    let r;
    try { r = await est.rodar('forma', { id, params, opc: { ...extrasDe(id, forma), cor: def.papel === 'furo' ? '#e5484d' : est.cena.proximaCor() } }, def.nome); } catch (e) { return; }
    // na mesa: ao lado da peça escolhida, ou no centro
    const sel = est.cena.objetoSel();
    let T = M4.translacao(est.cena.mesa.x / 2, est.cena.mesa.y / 2, 0);
    if (sel) { const c = est.cena.caixaExata(sel); if (c) T = M4.translacao(c.max[0] + 5 + (r.malha ? 0 : 0), (c.min[1] + c.max[1]) / 2, 0); }
    const [novo] = est.adicionarObjetos([{ nome: def.nome, transform: T, papel: def.papel || 'solido', forma, partes: [{ nome: def.nome, malha: r.malha, cor: def.papel === 'furo' ? '#e5484d' : r.cor }] }], { rotulo: 'Adicionar ' + def.nome, centralizar: false, naMesa: true, enquadrar: false });
    if (sel) {
      // se passou da mesa, volta pro centro
      const c = est.cena.caixaExata(novo);
      if (c && c.max[0] > est.cena.mesa.x) est.cena.aplicar('Ajustar posição', () => est.cena.centralizar(novo));
    }
    est.definirGizmo('mover');
    avisar(def.nome + ' adicionado — ajuste as medidas aqui, arraste as setas ou digite a posição em Ajustar.');
  }
  d.querySelectorAll('[data-forma]').forEach(b => b.addEventListener('click', () => adicionar(b.dataset.forma)));

  // medidas da forma escolhida (refaz a geometria, mantém lugar e giro)
  let refazendo = 0;
  async function refazer(o, forma) {
    const def = formaPorId(forma.id);
    const eu = ++refazendo;
    let r;
    try { r = await est.rodar('forma', { id: forma.id, params: forma.params, opc: { ...extrasDe(forma.id, forma), cor: o.partes[0].cor } }, def.nome); } catch (e) { render(); return; }
    if (eu !== refazendo || !est.cena.objeto(o.id)) return;
    // mantém a base no mesmo lugar: a forma nova nasce apoiada em z=0 local
    est.cena.aplicar('Mudar medidas de ' + o.nome, () => {
      o.forma = { ...forma, params: r.params };
      o.partes = [{ ...o.partes[0], malha: r.malha }];
    });
  }
  function render() {
    const o = est.objetoAtual();
    const box = q('props');
    box.innerHTML = '';
    if (!o) return;
    const cab = el('div', { class: 'e3d-props' });
    const f = o.forma && formaPorId(o.forma.id);
    cab.appendChild(el('div', { class: 'e3d-props-tit' }, el('span', { html: f ? svg(f.id, 20) : '' }), el('b', null, o.nome)));
    // Sólido / Furo (vale pra qualquer peça)
    const seg = el('div', { class: 'seg', 'data-a': 'papel' },
      el('button', { type: 'button', class: o.papel !== 'furo' ? 'active' : '', 'data-v': 'solido' }, 'Sólido'),
      el('button', { type: 'button', class: o.papel === 'furo' ? 'active' : '', 'data-v': 'furo' }, 'Furo'));
    seg.addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) est.definirPapel(o, b.dataset.v); });
    cab.appendChild(el('div', { class: 'field' }, el('label', null, 'Tipo ', el('span', { class: 'u' }, 'Furo tira material de quem ele atravessa')), seg));
    if (f) {
      const grade = el('div', { class: 'e3d-l2' });
      for (const p of f.params) {
        const inp = el('input', { type: 'text', value: fmt(o.forma.params[p.k], p.inteiro ? 0 : 2).replace(/\./g, ''), 'data-p': p.k });
        inp.addEventListener('change', () => {
          const v = lerNumero(inp.value, o.forma.params[p.k]);
          refazer(o, { ...o.forma, params: { ...o.forma.params, [p.k]: v } });
        });
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
        grade.appendChild(el('div', null, el('label', null, p.rot + (p.unid ? ' (' + p.unid + ')' : '')), inp));
      }
      cab.appendChild(grade);
      if (f.texto) {
        const t = el('input', { type: 'text', value: o.forma.texto || '', 'data-p': 'texto', placeholder: 'Texto' });
        t.addEventListener('change', () => refazer(o, { ...o.forma, texto: t.value || ' ' }));
        const fs = el('select', { 'data-p': 'fonte' }, FONTES.map(n => el('option', { value: n, selected: n === (o.forma.fonte || 'Arial Black') ? true : null }, n)));
        fs.addEventListener('change', () => refazer(o, { ...o.forma, fonte: fs.value }));
        cab.appendChild(el('div', { class: 'e3d-l2', style: 'margin-top:8px' }, el('div', null, el('label', null, 'Texto'), t), el('div', null, el('label', null, 'Fonte'), fs)));
      }
    } else cab.appendChild(el('p', { class: 'u', style: 'margin:4px 0 0' }, 'Peça aberta de arquivo: medidas e giro ficam em Ajustar.'));
    box.appendChild(cab);
  }
  est.on('selecao', () => { if (d.open) render(); });
  est.on('mudou', () => { if (d.open) render(); });
  d.addEventListener('toggle', () => { if (d.open) render(); });
  return { el: d, adicionar, render };
}

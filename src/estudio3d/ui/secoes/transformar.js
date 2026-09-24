// Painel 2 — posição, rotação, tamanho (valores numéricos) e cor.
// Mover/girar/escalar só mexe na matriz do objeto: a malha não é tocada.
import { el, fmt, lerNumero, avisar } from '../util.js';
import * as M4 from '../../core/mat4.js';
import { normalizarHex, nomeDaCor, PALETA_PECAS } from '../../core/cores.js';

export function montarTransformar(est) {
  const d = el('details', { 'data-sec': 'transf' });
  d.innerHTML = `<summary><span class="n">2</span>Posição, tamanho e cor</summary><div class="e3d-sec">
    <p class="u" data-a="alvo">Escolha um objeto.</p>
    <div class="e3d-l3"><div><label>Posição X</label><input type="text" data-t="px"></div><div><label>Y</label><input type="text" data-t="py"></div><div><label>Z (mm)</label><input type="text" data-t="pz"></div></div>
    <div class="e3d-l3" style="margin-top:6px"><div><label>Rotação X</label><input type="text" data-t="rx"></div><div><label>Y</label><input type="text" data-t="ry"></div><div><label>Z (graus)</label><input type="text" data-t="rz"></div></div>
    <div class="e3d-l3" style="margin-top:6px"><div><label>Largura X</label><input type="text" data-t="tx"></div><div><label>Profund. Y</label><input type="text" data-t="ty"></div><div><label>Altura Z (mm)</label><input type="text" data-t="tz"></div></div>
    <div class="e3d-l3" style="margin-top:6px"><div><label>Escala %</label><input type="text" data-t="esc"></div>
      <div style="grid-column:span 2;display:flex;align-items:end"><label class="fer-check" style="margin:0 0 8px"><input type="checkbox" data-t="prop" checked> Manter proporção</label></div></div>
    <div class="e3d-botoes">
      <button class="btn" data-a="mesa" title="Encosta a parte de baixo na mesa (Z=0)">Colocar na mesa</button>
      <button class="btn" data-a="centro">Centralizar</button>
      <button class="btn" data-a="gx">Girar 90° X</button>
      <button class="btn" data-a="gy">90° Y</button>
      <button class="btn" data-a="gz">90° Z</button>
      <button class="btn" data-a="esp">Espelhar</button>
      <button class="btn" data-a="zerar" title="Volta rotação e escala pro original">Redefinir</button>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">
      <div class="e3d-titulo">Cor da peça</div>
      <p class="u" data-a="corAlvo">Escolha uma peça (clique nela).</p>
      <div style="display:flex;gap:8px;align-items:center"><input type="color" data-a="cor"><input type="text" data-a="hex" style="width:110px" maxlength="7" placeholder="#RRGGBB"><span class="e3d-cores-hex" data-a="nomeCor"></span></div>
      <div data-a="paleta"></div>
      <div class="e3d-titulo" style="margin-top:10px">Filamentos do estoque</div>
      <div class="e3d-swatches" data-a="fil"></div>
      <div class="e3d-titulo" style="margin-top:8px">Cores rápidas</div>
      <div class="e3d-swatches" data-a="rapidas"></div>
    </div>
  </div>`;
  const q = s => d.querySelector(s);
  const campo = k => q('[data-t=' + k + ']');

  function estado(o) {
    const dc = M4.decompor(o.transform);
    return dc;
  }
  function render() {
    const o = est.objetoAtual();
    const inputs = d.querySelectorAll('input[data-t]');
    inputs.forEach(i => { i.disabled = !o; });
    q('[data-a=alvo]').textContent = o ? 'Objeto: ' + o.nome : 'Escolha um objeto.';
    if (o) {
      const dc = estado(o);
      const c = est.cena.caixaExata(o);
      const set = (k, v, casas = 2) => { const i = campo(k); if (document.activeElement !== i) i.value = fmt(v, casas).replace(/\./g, ''); };
      set('px', dc.pos[0]); set('py', dc.pos[1]); set('pz', dc.pos[2]);
      set('rx', dc.rot[0], 1); set('ry', dc.rot[1], 1); set('rz', dc.rot[2], 1);
      if (c) { set('tx', c.tam[0]); set('ty', c.tam[1]); set('tz', c.tam[2]); }
      const uni = Math.abs(dc.esc[0] - dc.esc[1]) < 1e-9 && Math.abs(dc.esc[1] - dc.esc[2]) < 1e-9;
      if (document.activeElement !== campo('esc')) campo('esc').value = uni ? fmt(Math.abs(dc.esc[0]) * 100, 1).replace(/\./g, '') : '—';
    }
    renderCor();
  }

  function aplicarNumeros(k) {
    const o = est.objetoAtual();
    if (!o) return;
    const dc = estado(o);
    const pos = [lerNumero(campo('px').value, dc.pos[0]), lerNumero(campo('py').value, dc.pos[1]), lerNumero(campo('pz').value, dc.pos[2])];
    const rot = [lerNumero(campo('rx').value, dc.rot[0]), lerNumero(campo('ry').value, dc.rot[1]), lerNumero(campo('rz').value, dc.rot[2])];
    let esc = dc.esc.slice();
    if (k === 'esc') {
      const e = lerNumero(campo('esc').value, NaN) / 100;
      if (!(e > 0)) { render(); return; }
      esc = esc.map(v => Math.sign(v || 1) * e);
    } else if (k === 'tx' || k === 'ty' || k === 'tz') {
      const c = est.cena.caixaExata(o);
      const eixo = { tx: 0, ty: 1, tz: 2 }[k];
      const novo = lerNumero(campo(k).value, NaN);
      if (!(novo > 0) || !c || !(c.tam[eixo] > 0)) { render(); return; }
      const f = novo / c.tam[eixo];
      if (campo('prop').checked) esc = esc.map(v => v * f);
      else {
        // sem proporção: escala só no eixo do mundo pedido (vale com rotação múltipla de 90°)
        const T = M4.multiplicar(M4.escala(eixo === 0 ? f : 1, eixo === 1 ? f : 1, eixo === 2 ? f : 1), o.transform);
        const cz = est.cena.caixaExata({ ...o, transform: T });
        const ajuste = M4.translacao(0, 0, c.min[2] - cz.min[2]);
        est.cena.aplicar('Tamanho', () => { o.transform = M4.multiplicar(ajuste, T); });
        return;
      }
    }
    const T = M4.compor(pos, rot, esc);
    est.cena.aplicar(k[0] === 'p' ? 'Posição' : k[0] === 'r' ? 'Rotação' : 'Tamanho', () => {
      o.transform = T;
      if (k[0] !== 'p' && dc.pos[2] >= -1e-6) est.cena.colocarNaMesa(o);
    });
  }
  d.querySelectorAll('input[data-t]').forEach(i => {
    if (i.type === 'checkbox') return;
    i.addEventListener('change', () => aplicarNumeros(i.dataset.t));
    i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); } });
  });

  function girar(ax, ay, az) {
    const o = est.objetoAtual(); if (!o) return;
    const c = est.cena.caixaExata(o);
    const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2;
    const R = M4.multiplicar(M4.translacao(cx, cy, cz), M4.multiplicar(M4.rotacaoEuler(ax, ay, az), M4.translacao(-cx, -cy, -cz)));
    est.cena.aplicar('Girar 90°', () => { o.transform = M4.multiplicar(R, o.transform); est.cena.colocarNaMesa(o); });
  }
  q('[data-a=mesa]').onclick = () => { const o = est.objetoAtual(); if (o) est.cena.aplicar('Colocar na mesa', () => est.cena.colocarNaMesa(o)); };
  q('[data-a=centro]').onclick = () => { const o = est.objetoAtual(); if (o) { est.cena.aplicar('Centralizar', () => est.cena.centralizar(o)); est.enquadrar(); } };
  q('[data-a=gx]').onclick = () => girar(90, 0, 0);
  q('[data-a=gy]').onclick = () => girar(0, 90, 0);
  q('[data-a=gz]').onclick = () => girar(0, 0, 90);
  q('[data-a=esp]').onclick = () => {
    const o = est.objetoAtual(); if (!o) return;
    const c = est.cena.caixaExata(o), cx = (c.min[0] + c.max[0]) / 2;
    est.cena.aplicar('Espelhar', () => { o.transform = M4.multiplicar(M4.multiplicar(M4.translacao(cx, 0, 0), M4.multiplicar(M4.escala(-1, 1, 1), M4.translacao(-cx, 0, 0))), o.transform); });
  };
  q('[data-a=zerar]').onclick = () => {
    const o = est.objetoAtual(); if (!o) return;
    const dc = estado(o);
    est.cena.aplicar('Redefinir rotação e escala', () => { o.transform = M4.translacao(dc.pos[0], dc.pos[1], dc.pos[2]); est.cena.colocarNaMesa(o); });
  };

  /* ---------------- cor ---------------- */
  function renderCor() {
    const p = est.parteAtual();
    const o = est.objetoAtual();
    q('[data-a=cor]').disabled = !p; q('[data-a=hex]').disabled = !p;
    q('[data-a=corAlvo]').textContent = p ? 'Peça: ' + p.nome + (o && o.partes.length > 1 ? ' (de ' + o.nome + ')' : '') : (o && o.partes.length > 1 ? 'Esse objeto tem ' + o.partes.length + ' peças: clique na peça ou escolha na lista.' : 'Escolha uma peça.');
    const pal = q('[data-a=paleta]');
    pal.innerHTML = '';
    if (!p) { q('[data-a=nomeCor]').textContent = ''; return; }
    q('[data-a=cor]').value = p.cor.toLowerCase();
    if (document.activeElement !== q('[data-a=hex]')) q('[data-a=hex]').value = p.cor;
    q('[data-a=nomeCor]').textContent = nomeDaCor(p.cor);
    if (p.paleta && p.paleta.length > 1) {
      pal.appendChild(el('p', { class: 'u', style: 'margin:8px 0 4px' }, 'Cores pintadas nesta peça (clique pra trocar):'));
      const box = el('div', { class: 'e3d-swatches' });
      p.paleta.forEach((h, i) => {
        const inp = el('input', { type: 'color', value: h.toLowerCase(), title: h + ' — ' + nomeDaCor(h), style: 'width:30px;height:26px;padding:0' });
        inp.addEventListener('change', () => trocarCorPaleta(i, inp.value));
        box.appendChild(inp);
      });
      pal.appendChild(box);
    }
  }
  function definirCor(hex) {
    const p = est.parteAtual();
    const n = normalizarHex(hex);
    if (!p || !n) { if (!p) avisar('Escolha uma peça primeiro.', 'warn'); return; }
    if (p.cor === n) return;
    est.cena.aplicar('Cor ' + n, () => {
      // cor principal também troca na paleta (posição 0 = cor da peça)
      if (p.paleta) { const i = p.paleta.indexOf(p.cor); if (i >= 0) { p.paleta = p.paleta.slice(); p.paleta[i] = n; } }
      p.cor = n;
    });
  }
  function trocarCorPaleta(i, hex) {
    const p = est.parteAtual(); const n = normalizarHex(hex);
    if (!p || !n) return;
    est.cena.aplicar('Trocar cor pintada', () => {
      const velho = p.paleta[i];
      p.paleta = p.paleta.slice(); p.paleta[i] = n;
      if (p.cor === velho) p.cor = n;
    });
  }
  q('[data-a=cor]').addEventListener('change', ev => definirCor(ev.target.value));
  q('[data-a=hex]').addEventListener('change', ev => { const n = normalizarHex(ev.target.value); if (n) definirCor(n); else { avisar('Cor inválida. Use #RRGGBB.', 'warn'); renderCor(); } });

  function renderFilamentos() {
    const box = q('[data-a=fil]');
    box.innerHTML = '';
    let lista = [];
    try { lista = (window.ERP_APP && window.ERP_APP.values().filaments) || []; } catch (e) { lista = []; }
    const vistos = new Set();
    for (const f of lista) {
      const h = normalizarHex(f.cor);
      if (!h || vistos.has(h)) continue;
      vistos.add(h);
      box.appendChild(el('button', { style: 'background:' + h, title: [f.marca, f.material, f.corNome].filter(Boolean).join(' ') + ' — ' + h, onclick: () => definirCor(h) }));
    }
    if (!vistos.size) box.appendChild(el('span', { class: 'u' }, 'Nenhum filamento cadastrado com cor.'));
    const r = q('[data-a=rapidas]');
    r.innerHTML = '';
    for (const h of PALETA_PECAS) r.appendChild(el('button', { style: 'background:' + h, title: nomeDaCor(h) + ' — ' + h, onclick: () => definirCor(h) }));
  }
  d.addEventListener('toggle', () => { if (d.open) { renderFilamentos(); render(); } });
  est.on('selecao', render);
  est.on('mudou', render);
  est.visor.on('gizmo-mudou', () => { if (d.open) render(); });
  renderFilamentos();
  return { el: d, render };
}

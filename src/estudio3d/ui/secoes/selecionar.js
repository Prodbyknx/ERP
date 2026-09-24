// Painel 3 — selecionar região (sem editar triângulo por triângulo) e
// detectar partes. Tudo roda na thread principal: é rápido (BFS em arrays).
import { el, fmt, fmtInt, avisar } from '../util.js';
import { crescerRegiao, componenteConectado, expandir, reduzir, inverter, similar, suavizarBorda, limpar, contar, areaSelecionada, uniao, subtrair } from '../../core/selecao.js';
import { corDeRotulo } from './diagnostico.js';

const MODOS = [
  ['regiao', 'Região inteligente', 'Clique numa parte: a seleção cresce até encontrar uma dobra (onde uma peça encontra a outra).'],
  ['pincel', 'Pincel', 'Pinte arrastando sobre a peça. Começando fora da peça, arrastar gira a vista.'],
  ['casca', 'Casca inteira', 'Clique: pega tudo que está ligado (uma "ilha" da malha).'],
  ['cor', 'Mesma cor', 'Clique: pega a região da mesma cor/material.'],
  ['parte', 'Parte detectada', 'Clique: pega a parte sugerida pela detecção automática.']
];

export function montarSelecionar(est) {
  const d = el('details', { 'data-sec': 'sel' });
  d.innerHTML = `<summary><span class="n">3</span>Selecionar região</summary><div class="e3d-sec">
    <div class="seg" data-a="modos">${MODOS.map(m => '<button type="button" data-v="' + m[0] + '">' + m[1] + '</button>').join('')}</div>
    <p class="u" data-a="dica"></p>
    <div data-a="optRegiao"><div class="field"><label>Sensibilidade à dobra <span class="u">menor = para em dobra mais suave</span></label>
      <div class="e3d-slider"><input type="range" min="5" max="75" value="30" data-a="ang"><b data-a="angv">30°</b></div></div></div>
    <div data-a="optPincel" style="display:none">
      <div class="field"><label>Tamanho do pincel <span class="u">raio em mm</span></label>
        <div class="e3d-slider"><input type="range" min="0.3" max="30" step="0.1" value="3" data-a="raio"><b data-a="raiov">3,0</b></div></div>
      <div class="seg" data-a="pincelModo"><button type="button" data-v="add" class="active">Adicionar</button><button type="button" data-v="tirar">Apagar</button></div>
      <label class="fer-check"><input type="checkbox" data-a="frente" checked> Só faces viradas pra mim <span class="u">não pinta o outro lado da peça</span></label>
    </div>
    <div class="e3d-nota" data-a="info">Nada selecionado.</div>
    <div class="e3d-botoes">
      <button class="btn" data-a="exp" title="Cresce 1 anel de faces">Expandir</button>
      <button class="btn" data-a="red">Reduzir</button>
      <button class="btn" data-a="suave" title="Limpa o contorno serrilhado">Suavizar borda</button>
      <button class="btn" data-a="sim" title="Faces com a mesma direção/cor">Similar</button>
      <button class="btn" data-a="conect" title="Tudo ligado à seleção">Conectado</button>
      <button class="btn" data-a="inv">Inverter</button>
      <button class="btn danger" data-a="limpar">Limpar</button>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">
      <div class="e3d-titulo">Detectar partes</div>
      <p class="u">Procura regiões que parecem peças diferentes (orelha, olho, acessório…). Os nomes são sugestão: renomeie à vontade.</p>
      <div class="field"><label>Quantas partes <span class="u">poucas ↔ muitas</span></label>
        <div class="e3d-slider"><input type="range" min="0" max="100" value="50" data-a="sensSeg"></div></div>
      <div class="e3d-botoes"><button class="btn primary" data-a="detectar">Detectar partes</button></div>
      <div class="e3d-partes-lista" data-a="lista"></div>
    </div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let modo = 'regiao';
  let pincelTirar = false;
  let tracoAntes = null;

  function ativarModo(m) {
    modo = m;
    q('modos').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === m));
    q('dica').textContent = (MODOS.find(x => x[0] === m) || [])[2] || '';
    q('optRegiao').style.display = m === 'regiao' ? '' : 'none';
    q('optPincel').style.display = m === 'pincel' ? '' : 'none';
    if (d.open) est.definirFerramenta(m);
  }
  q('modos').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) ativarModo(b.dataset.v); });
  q('pincelModo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    pincelTirar = b.dataset.v === 'tirar';
    q('pincelModo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  });
  q('ang').addEventListener('input', () => { q('angv').textContent = q('ang').value + '°'; });
  q('raio').addEventListener('input', () => { q('raiov').textContent = fmt(+q('raio').value, 1); });
  d.addEventListener('toggle', () => { if (d.open) est.definirFerramenta(modo); else if (est.ferramenta !== 'navegar' && MODOS.some(m => m[0] === est.ferramenta)) est.definirFerramenta('navegar'); });

  const parte = () => est.parteAtual();
  const mascaraAtual = p => est.visor.selecao(p.id) || new Uint8Array(p.malha.idx.length / 3);
  function definir(p, mask, rotulo) {
    est.visor.definirSelecao(p.id, contar(mask) ? mask : null);
    info();
    est.emitir('selecao-faces', { parte: p, rotulo });
  }
  function combinar(p, nova, ev) {
    const atual = est.visor.selecao(p.id);
    if (ev && ev.shiftKey && atual) return uniao(atual, nova);
    if (ev && (ev.altKey || ev.ctrlKey || ev.metaKey) && atual) return subtrair(atual, nova);
    return nova;
  }

  est.on('clique', ({ hit, ev }) => {
    if (!d.open && !['regiao', 'casca', 'cor', 'parte'].includes(est.ferramenta)) return;
    if (!['regiao', 'casca', 'cor', 'parte'].includes(est.ferramenta)) return;
    const o = est.cena.objeto(hit.objeto); if (!o) return;
    const p = o.partes.find(x => x.id === hit.parte); if (!p) return;
    const adj = est.adj(p.malha);
    let nova;
    if (est.ferramenta === 'regiao') nova = crescerRegiao(p.malha, adj, hit.face, { anguloVizinho: +q('ang').value });
    else if (est.ferramenta === 'casca') nova = componenteConectado(p.malha, adj, hit.face);
    else if (est.ferramenta === 'cor') {
      if (!p.malha.cor) { avisar('Essa peça tem uma cor só — use "Casca inteira" ou a região inteligente.', 'warn'); nova = componenteConectado(p.malha, adj, hit.face); }
      else nova = crescerRegiao(p.malha, adj, hit.face, { anguloVizinho: 180, mesmaCor: true });
    } else {
      const s = est.segm.get(p.id);
      if (!s || s.malha !== p.malha) { avisar('Rode "Detectar partes" primeiro.', 'warn'); return; }
      const l = s.rotulo[hit.face];
      nova = new Uint8Array(s.rotulo.length);
      for (let t = 0; t < nova.length; t++) if (s.rotulo[t] === l) nova[t] = 1;
    }
    definir(p, combinar(p, nova, ev), 'clique');
  });

  function pincel(hit, ev, inicio) {
    const o = est.cena.objeto(hit.objeto);
    const p = o && o.partes.find(x => x.id === hit.parte);
    if (!p) return;
    if (inicio) tracoAntes = mascaraAtual(p).slice();
    const tirar = pincelTirar || ev.altKey;
    const faces = est.visor.facesNaEsfera(p.id, hit.ponto, +q('raio').value, q('frente').checked);
    const m = mascaraAtual(p).slice();
    for (const f of faces) m[f] = tirar ? 0 : 1;
    est.visor.definirSelecao(p.id, m);
    cursorPincel(hit);
  }
  function cursorPincel(hit) {
    if (!hit) { est.visor.mostrarPincel(null); return; }
    est.visor.mostrarPincel(hit.ponto, hit.normal, +q('raio').value);
  }
  function fimPincel() { tracoAntes = null; info(); }

  function acao(fn, rotulo) {
    const p = parte();
    if (!p) { avisar('Escolha uma peça.', 'warn'); return; }
    const adj = est.adj(p.malha);
    const m = fn(mascaraAtual(p), adj, p);
    definir(p, m, rotulo);
  }
  q('exp').onclick = () => acao((m, a) => expandir(m, a, 1), 'expandir');
  q('red').onclick = () => acao((m, a) => reduzir(m, a, 1), 'reduzir');
  q('suave').onclick = () => acao((m, a) => limpar(suavizarBorda(m, a, 2), a, 6), 'suavizar');
  q('sim').onclick = () => acao((m, a, p) => similar(p.malha, a, m, { angulo: 12 }), 'similar');
  q('conect').onclick = () => acao((m, a, p) => { let r = new Uint8Array(m.length); for (let t = 0; t < m.length; t++) if (m[t] && !r[t]) r = uniao(r, componenteConectado(p.malha, a, t)); return r; }, 'conectado');
  q('inv').onclick = () => acao(m => inverter(m), 'inverter');
  q('limpar').onclick = () => { const p = parte(); if (p) definir(p, new Uint8Array(p.malha.idx.length / 3), 'limpar'); };

  function info() {
    const p = parte();
    const box = q('info');
    if (!p) { box.textContent = 'Escolha uma peça.'; return; }
    const m = est.visor.selecao(p.id);
    const n = m ? contar(m) : 0;
    const total = p.malha.idx.length / 3;
    box.innerHTML = n ? '<b>' + fmtInt(n) + '</b> de ' + fmtInt(total) + ' faces selecionadas · ' + fmt(areaSelecionada(p.malha, m), 1) + ' mm² — agora use <b>Separar para impressão</b> (quadro 4).' : 'Nada selecionado em <b>' + p.nome + '</b>.';
  }

  /* -------- detectar partes -------- */
  async function detectar() {
    const p = parte();
    if (!p) { avisar('Escolha uma peça.', 'warn'); return; }
    q('detectar').disabled = true;
    try {
      const r = await est.rodar('segmentar', { parte: est.parteParaMotor(p), opc: { sensibilidade: +q('sensSeg').value / 100 } }, 'Detectar partes');
      est.segm.set(p.id, { rotulo: r.rotulo, partes: r.partes, malha: p.malha, nomes: r.partes.map(x => x.nome) });
      renderLista();
      est.definirModoVisual('partes');
      ativarModo('parte');
      avisar(r.partes.length + ' parte(s) sugerida(s)');
    } finally { q('detectar').disabled = false; }
  }
  function renderLista() {
    const p = parte();
    const box = q('lista');
    box.innerHTML = '';
    const s = p && est.segm.get(p.id);
    if (!s || s.malha !== p.malha) return;
    s.partes.forEach((pt, i) => {
      const c = corDeRotulo(i).map(v => Math.round(Math.pow(v, 1 / 2.2) * 255));
      const nome = el('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.nomes[i]);
      const ren = el('button', { class: 'e3d-ico', title: 'Renomear', onclick: ev => {
        ev.stopPropagation();
        const n = window.prompt('Nome da parte:', s.nomes[i]);
        if (n && n.trim()) { s.nomes[i] = n.trim(); nome.textContent = s.nomes[i]; }
      } }, '✎');
      const linha = el('div', { title: 'Clique pra selecionar · Shift soma' },
        el('span', { class: 'e3d-bola', style: 'background:rgb(' + c.join(',') + ')' }), nome,
        el('span', { class: 'u', style: 'font-size:11px' }, fmt(pt.area, 0) + ' mm²'), ren);
      linha.addEventListener('click', ev => {
        const m = new Uint8Array(s.rotulo.length);
        for (let t = 0; t < m.length; t++) if (s.rotulo[t] === i) m[t] = 1;
        definir(p, combinar(p, m, ev), 'parte');
        est.emitir('nome-sugerido', s.nomes[i]);
      });
      box.appendChild(linha);
    });
  }
  q('detectar').onclick = detectar;
  est.registrarMapa('partes', p => {
    const s = est.segm.get(p.id);
    const nt = p.malha.idx.length / 3;
    const out = new Float32Array(nt * 3);
    if (!s || s.malha !== p.malha) { for (let t = 0; t < nt; t++) out.set([0.6, 0.62, 0.65], t * 3); return out; }
    for (let t = 0; t < nt; t++) out.set(corDeRotulo(s.rotulo[t]), t * 3);
    return out;
  });

  est.on('selecao', () => { info(); renderLista(); });
  est.on('mudou', () => { info(); renderLista(); });
  ativarModo('regiao');
  void tracoAntes;
  return { el: d, pincel, cursorPincel, fimPincel, info };
}

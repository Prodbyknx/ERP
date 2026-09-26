// Painel "Modificar": arredondar / chanfrar bordas, puxar / empurrar face,
// deixar oca (casca) e espelhar. Geometria real no motor, sempre com prévia
// antes de aplicar e Desfazer. Em peça criada no Estúdio a operação entra na
// lista de operações da forma (dá pra mudar o valor depois).
import { el, fmt, lerNumero, avisar } from '../util.js';
import { detectarArestas, arestaPerto } from '../../core/arestas.js';
import { limites } from '../../core/arredondar.js';
import { facePlana } from '../../core/modificar.js';
import { descritorAresta, descritorFace } from '../../core/historico.js';
import { caixa } from '../../core/malha.js';
import * as M4 from '../../core/mat4.js';

export const FERR_MOD = [
  ['arredondar', 'Arredondar', 'Clique nas bordas que quer arredondar (cada clique soma ou tira uma).'],
  ['chanfrar', 'Chanfrar', 'Clique nas bordas. O tamanho é medido em cada face (chanfro a 45° em quina reta).'],
  ['puxar', 'Puxar / empurrar', 'Clique numa face plana. Valor + puxa pra fora; − empurra (rebaixo).'],
  ['casca', 'Deixar oca', 'Parede em mm. Clique nas faces que devem ficar abertas (pote, caixa, capacete) — ou nenhuma, pra fechada.'],
  ['espelhar', 'Espelhar', 'Espelha a peça. Com "unir": modele metade e ganhe a peça inteira, costura exata no meio.'],
  ['medir', 'Medir', 'Clique em dois pontos pra ver a distância; clique numa borda pra ver o comprimento ou o diâmetro.']
];
export const NOME_OP = { arredondar: 'Arredondar', chanfrar: 'Chanfrar', puxar: 'Puxar/empurrar', casca: 'Oca', espelhar: 'Espelhar' };

function faceMaisPerto(m, q) {
  const P = m.pos, I = m.idx;
  let melhor = -1, dm = Infinity;
  for (let f = 0; f < I.length / 3; f++) {
    const c = [0, 1, 2].map(e => (P[I[f * 3] * 3 + e] + P[I[f * 3 + 1] * 3 + e] + P[I[f * 3 + 2] * 3 + e]) / 3);
    const d = Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]);
    if (d < dm) { dm = d; melhor = f; }
  }
  return melhor;
}

export function montarModificar(est) {
  const d = el('details', { 'data-sec': 'mod' });
  d.innerHTML = `<summary>Modificar</summary><div class="e3d-sec">
    <div class="seg e3d-seg-quebra" data-a="ferr">${FERR_MOD.map(f => '<button type="button" data-v="' + f[0] + '">' + f[1] + '</button>').join('')}</div>
    <p class="u" data-a="dica"></p>
    <div data-a="optBorda">
      <div class="field"><label><span data-a="rotValor">Raio</span> <span class="u">mm</span> <span class="u" data-a="max"></span></label><input type="text" data-a="valor" value="2"></div>
      <div class="e3d-botoes"><button type="button" class="btn" data-a="todas">Todas as bordas</button><button type="button" class="btn" data-a="limparB">Limpar</button></div>
    </div>
    <div data-a="optPuxar" style="display:none">
      <div class="field"><label>Distância <span class="u">mm · + puxa, − empurra</span></label><input type="text" data-a="dist" value="5"></div>
    </div>
    <div data-a="optCasca" style="display:none">
      <div class="field"><label>Parede <span class="u">mm</span></label><input type="text" data-a="parede" value="2"></div>
      <div class="e3d-botoes"><button type="button" class="btn" data-a="limparA">Fechar todas</button></div>
    </div>
    <div data-a="optEsp" style="display:none">
      <div class="field"><label>Eixo</label><div class="seg" data-a="eixo"><button type="button" data-v="0" class="active">X</button><button type="button" data-v="1">Y</button><button type="button" data-v="2">Z</button></div></div>
      <div class="field"><label>Onde fica o espelho</label><div class="seg" data-a="pos"><button type="button" data-v="min">Lado −</button><button type="button" data-v="centro">Centro</button><button type="button" data-v="max" class="active">Lado +</button></div></div>
      <label class="fer-check"><input type="checkbox" data-a="unir" checked> Unir com a original <span class="u">uma peça só</span></label>
    </div>
    <div data-a="optSim"><label class="fer-check" title="Escolheu uma borda ou face de um lado? A do outro lado (espelhada no meio da peça) vem junto"><input type="checkbox" data-a="simX"> Simetria X</label> <label class="fer-check"><input type="checkbox" data-a="simY"> Simetria Y</label></div>
    <div class="e3d-nota" data-a="info">Escolha uma peça.</div>
    <div class="e3d-botoes" data-a="botoes"><button class="btn primary largo" data-a="ir">Aplicar (com prévia)</button></div>
    <div data-a="res"></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let ferr = 'arredondar';
  let alvo = null;            // { objId, parteId }
  let bordas = new Set(), face = -1, abrir = new Set();
  let eixo = 0, pos = 'max';
  let medida = [];            // pontos clicados (mundo) no Medir
  const cacheAr = new WeakMap();
  const arestasDe = m => { let a = cacheAr.get(m); if (!a) { a = detectarArestas(m); cacheAr.set(m, a); } return a; };

  function atual() {
    if (!alvo) return null;
    const o = est.cena.objeto(alvo.objId);
    const p = o && o.partes.find(x => x.id === alvo.parteId);
    return p ? { o, p } : null;
  }
  function limparSel() {
    bordas = new Set(); face = -1; abrir = new Set();
    est.visor.limparAjudas('bordas');
    const a = atual(); if (a) est.visor.definirSelecao(a.p.id, null);
    atualizar();
  }
  function ativar(f) {
    ferr = f;
    q('ferr').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === f));
    q('dica').textContent = FERR_MOD.find(x => x[0] === f)[2];
    q('optBorda').style.display = f === 'arredondar' || f === 'chanfrar' ? '' : 'none';
    q('optPuxar').style.display = f === 'puxar' ? '' : 'none';
    q('optCasca').style.display = f === 'casca' ? '' : 'none';
    q('optEsp').style.display = f === 'espelhar' ? '' : 'none';
    q('optSim').style.display = ['arredondar', 'chanfrar', 'puxar', 'casca'].includes(f) ? '' : 'none';
    q('botoes').style.display = f === 'medir' ? 'none' : '';
    medida = [];
    q('rotValor').textContent = f === 'chanfrar' ? 'Chanfro' : 'Raio';
    q('res').innerHTML = '';
    limparSel();
  }
  q('ferr').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) ativar(b.dataset.v); });
  q('eixo').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; eixo = +b.dataset.v; q('eixo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); });
  q('pos').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; pos = b.dataset.v; q('pos').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); });
  q('limparB').onclick = limparSel;
  q('limparA').onclick = limparSel;
  q('valor').addEventListener('input', atualizar);
  q('todas').onclick = () => {
    const a = atual() || escolherAtual();
    if (!a) return;
    for (const ar of arestasDe(a.p.malha)) if (ar.tipo !== 'curva') bordas.add(ar.id);
    atualizar();
  };
  function escolherAtual() {
    const o = est.objetoAtual(), p = est.parteAtual() || (o && o.partes[0]);
    if (!o || !p) return null;
    alvo = { objId: o.id, parteId: p.id };
    return { o, p };
  }

  // desenha as bordas escolhidas e diz o limite
  function atualizar() {
    const a = atual();
    const box = q('info');
    if (!a) { box.textContent = 'Clique na peça que quer modificar.'; est.visor.limparAjudas('bordas'); return; }
    if (ferr === 'arredondar' || ferr === 'chanfrar') {
      const ars = arestasDe(a.p.malha), sel = [...bordas].map(i => ars[i]).filter(Boolean);
      const T = a.o.transform;
      est.visor.mostrarContornos(sel.map(ar => {
        const pts = ar.tipo === 'reta' ? [ar.a, ar.b] : ar.pts;
        const out = [];
        for (const p of pts) out.push(...M4.aplicarPonto(T, p[0], p[1], p[2]));
        return out;
      }), '#1f6feb', 'bordas');
      if (!sel.length) { box.innerHTML = 'Nenhuma borda escolhida. <b>Clique perto de uma borda</b> da peça (' + ars.filter(x => x.tipo !== 'curva').length + ' encontradas).'; q('max').textContent = ''; return; }
      const lim = limites(a.p.malha, sel, ferr === 'chanfrar' ? 'chanfro' : 'raio');
      const mx = Math.min(...lim.map(x => x.max));
      const v = lerNumero(q('valor').value, 0);
      q('max').textContent = isFinite(mx) ? '· máx. ' + fmt(mx, 2) : '';
      box.innerHTML = '<b>' + sel.length + '</b> borda(s): ' + resumo(sel) + (v > mx ? '<br><span class="aviso">' + fmt(v, 2) + ' mm não cabe: ' + lim.find(x => x.max === mx).motivo + '.</span>' : '');
    } else if (ferr === 'puxar') {
      box.innerHTML = face < 0 ? 'Clique numa <b>face plana</b> da peça.' : 'Face escolhida: <b>' + fmt(facePlana(a.p.malha, face).area, 1) + ' mm²</b>.';
    } else if (ferr === 'casca') {
      box.innerHTML = abrir.size ? '<b>' + abrir.size + '</b> face(s) vão ficar abertas.' : 'Peça fechada por fora (oca por dentro). Clique numa face pra deixá-la aberta.';
    } else if (ferr === 'espelhar') {
      const c = caixa(a.p.malha);
      box.innerHTML = 'Peça: ' + c.tam.map(x => fmt(x, 1)).join(' × ') + ' mm.';
    } else if (!medida.length) box.innerHTML = 'Clique numa borda ou em dois pontos da peça.';
  }
  function resumo(sel) {
    const n = t => sel.filter(x => x.tipo === t).length;
    const partes = [];
    if (n('reta')) partes.push(n('reta') + ' reta(s)');
    if (n('circulo')) partes.push(n('circulo') + ' circular(es)');
    const conc = sel.filter(x => x.convexa === false).length;
    if (conc) partes.push(conc + ' de canto pra dentro (põe material)');
    return partes.join(', ');
  }

  est.on('clique', ({ hit, ev }) => {
    if (!d.open || est.ferramenta !== 'modificar' || !hit) return;
    const o = est.cena.objeto(hit.objeto); if (!o) return;
    const p = o.partes.find(x => x.id === hit.parte); if (!p) return;
    if (!alvo || alvo.objId !== o.id || alvo.parteId !== p.id) { limparSel(); alvo = { objId: o.id, parteId: p.id }; }
    const G = M4.inverter(o.transform);
    const pl = M4.aplicarPonto(G, hit.ponto.x, hit.ponto.y, hit.ponto.z);
    const c = caixa(p.malha), tol = Math.max(0.8, 0.03 * Math.hypot(...c.tam));
    // simetria: o mesmo ponto espelhado no meio da peça (X e/ou Y)
    const espelhos = [pl];
    if (q('simX').checked) espelhos.push([c.min[0] + c.max[0] - pl[0], pl[1], pl[2]]);
    if (q('simY').checked) for (const e of espelhos.slice()) espelhos.push([e[0], c.min[1] + c.max[1] - e[1], e[2]]);
    if (ferr === 'medir') { medir(o, p, pl, hit, tol); return; }
    if (ferr === 'arredondar' || ferr === 'chanfrar') {
      const r = arestaPerto(arestasDe(p.malha), pl, tol);
      if (!r) { q('info').innerHTML = 'Nenhuma borda perto do clique — clique <b>em cima da quina</b>.'; return; }
      const tirar = bordas.has(r.aresta.id);
      for (const e of espelhos) {
        const x = arestaPerto(arestasDe(p.malha), e, tol);
        if (x) { if (tirar) bordas.delete(x.aresta.id); else bordas.add(x.aresta.id); }
      }
    } else if (ferr === 'puxar') {
      face = hit.face;
      if (espelhos.length > 1) avisar('Simetria vale pra bordas e faces abertas; puxar é uma face por vez.', 'info');
      const g = facePlana(p.malha, face);
      const m = new Uint8Array(p.malha.idx.length / 3); for (const f of g.faces) m[f] = 1;
      est.visor.definirSelecao(p.id, m);
    } else if (ferr === 'casca') {
      const g = facePlana(p.malha, hit.face);
      const chave = Math.min(...g.faces);
      if ([...abrir].some(f => Math.min(...facePlana(p.malha, f).faces) === chave)) abrir = new Set([...abrir].filter(f => Math.min(...facePlana(p.malha, f).faces) !== chave));
      else {
        abrir.add(hit.face);
        // lado espelhado: a face mais perto do ponto espelhado com a normal espelhada
        for (const e of espelhos.slice(1)) {
          const f2 = faceMaisPerto(p.malha, e);
          if (f2 >= 0) abrir.add(f2);
        }
      }
      const m = new Uint8Array(p.malha.idx.length / 3);
      for (const f of abrir) for (const x of facePlana(p.malha, f).faces) m[x] = 1;
      est.visor.definirSelecao(p.id, abrir.size ? m : null);
    }
    atualizar();
  });

  // MEDIR: borda clicada = comprimento/diâmetro; dois pontos = distância
  function medir(o, p, pl, hit, tol) {
    const r = arestaPerto(arestasDe(p.malha), pl, tol * 0.5);
    const T = o.transform;
    if (r && medida.length === 0) {
      const a = r.aresta;
      const txt = a.tipo === 'circulo' ? 'Borda circular: <b>Ø ' + fmt(2 * a.raio, 2) + ' mm</b> (raio ' + fmt(a.raio, 2) + ')' : a.tipo === 'reta' ? 'Borda reta: <b>' + fmt(a.comprimento, 2) + ' mm</b>' : 'Borda curva: ' + fmt(a.comprimento, 2) + ' mm de comprimento';
      q('info').innerHTML = txt + '<br><span class="u">Clique em dois pontos da peça pra medir a distância.</span>';
      const pts = a.tipo === 'reta' ? [a.a, a.b] : a.pts;
      const out = []; for (const x of pts) out.push(...M4.aplicarPonto(T, x[0], x[1], x[2]));
      est.visor.mostrarContornos([out], '#1f6feb', 'bordas');
      return;
    }
    medida.push([hit.ponto.x, hit.ponto.y, hit.ponto.z]);
    if (medida.length === 1) { q('info').innerHTML = 'Ponto 1 marcado. Clique no ponto 2.'; est.visor.mostrarContornos([[...medida[0], ...medida[0]]], '#1f6feb', 'bordas'); return; }
    const [a, b] = medida.slice(-2); medida = [];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    est.visor.mostrarContornos([[...a, ...b]], '#1f6feb', 'bordas');
    q('info').innerHTML = 'Distância: <b>' + fmt(Math.hypot(...d), 2) + ' mm</b><br>X ' + fmt(Math.abs(d[0]), 2) + ' · Y ' + fmt(Math.abs(d[1]), 2) + ' · Z ' + fmt(Math.abs(d[2]), 2) + ' mm';
  }

  async function aplicar() {
    const a = atual() || escolherAtual();
    if (!a) { avisar('Escolha a peça.', 'warn'); return; }
    const { o, p } = a;
    let op;
    if (ferr === 'arredondar' || ferr === 'chanfrar') {
      if (!bordas.size) { avisar('Clique nas bordas primeiro.', 'warn'); return; }
      const ars = arestasDe(p.malha);
      op = { tipo: ferr, valor: lerNumero(q('valor').value, 0), bordas: [...bordas].map(i => descritorAresta(p.malha, ars[i])) };
    } else if (ferr === 'puxar') {
      if (face < 0) { avisar('Clique numa face plana primeiro.', 'warn'); return; }
      op = { tipo: 'puxar', valor: lerNumero(q('dist').value, 0), face: descritorFace(p.malha, face) };
    } else if (ferr === 'casca') {
      op = { tipo: 'casca', valor: lerNumero(q('parede').value, 0), abrir: [...abrir].map(f => descritorFace(p.malha, f)) };
    } else op = { tipo: 'espelhar', eixo, pos, unir: q('unir').checked };
    q('ir').disabled = true;
    q('res').innerHTML = '<div class="e3d-nota">Calculando…</div>';
    let r;
    try { r = await est.rodar('modificar', { parte: est.parteParaMotor(p), op }, NOME_OP[ferr]); }
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + (e.message || e) + '</div>'; return; }
    finally { q('ir').disabled = false; }
    q('res').innerHTML = '';
    est.visor.limparAjudas('bordas');
    est.mostrarPrevia({
      titulo: NOME_OP[ferr], legenda: [], explodir: 0, textoConfirmar: 'Aplicar',
      objetos: [{ transform: o.transform, partes: o.partes.map(x => x.id === p.id ? { malha: r.parte.malha, cor: r.parte.cor || p.cor, paleta: r.parte.paleta, papel: 'normal' } : { malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal' }) }],
      confirmar: () => {
        est.cena.aplicar(NOME_OP[ferr] + ' ' + o.nome, () => {
          p.malha = r.parte.malha;
          if (r.parte.paleta !== undefined) p.paleta = r.parte.paleta;
          // peça do Estúdio: guarda a operação pra poder mudar depois
          if (o.forma && o.partes.length === 1) o.operacoes = [...(o.operacoes || []), op];
        });
        limparSel();
        q('res').innerHTML = '<div class="e3d-nota ok">' + NOME_OP[ferr] + ' aplicado.' + (o.forma ? ' Dá pra mudar o valor depois em <b>Formas</b> → Operações.' : '') + '</div>';
      },
      cancelar: () => { atualizar(); }
    });
  }
  q('ir').onclick = aplicar;

  d.addEventListener('toggle', () => {
    if (d.open) { est.definirFerramenta('modificar'); escolherAtual(); ativar(ferr); }
    else { est.visor.limparAjudas('bordas'); if (est.ferramenta === 'modificar') est.definirFerramenta('navegar'); }
  });
  est.on('selecao', () => { if (d.open && !est.previaAtiva) { const o = est.objetoAtual(); if (o && (!alvo || alvo.objId !== o.id)) { limparSel(); escolherAtual(); atualizar(); } } });
  est.on('mudou', () => { if (d.open) atualizar(); });
  ativar('arredondar');
  return { el: d };
}

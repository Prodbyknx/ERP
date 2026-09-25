// Painel 5 — cortar por plano (X/Y/Z ou inclinado) com conectores.
import { el, fmt, lerNumero, avisar } from '../util.js';
import { novaParte, novoObjeto } from '../cena.js';
import { TIPOS_CONECTOR, medidaTexto } from '../../core/conectores.js';
import { planoParaLocal } from '../../core/corte.js';

export function montarCortar(est) {
  const d = el('details', { 'data-sec': 'corte' });
  d.innerHTML = `<summary><span class="n">5</span>Cortar a peça</summary><div class="e3d-sec">
    <div class="field"><label>Direção do corte</label>
      <div class="seg" data-a="eixo"><button type="button" data-v="z" class="active">Horizontal (Z)</button><button type="button" data-v="x">Vertical X</button><button type="button" data-v="y">Vertical Y</button><button type="button" data-v="livre">Inclinado</button></div></div>
    <div data-a="livre" style="display:none" class="e3d-l2">
      <div class="field"><label>Inclinação A (graus)</label><input type="text" data-a="ia" value="0"></div>
      <div class="field"><label>Inclinação B (graus)</label><input type="text" data-a="ib" value="0"></div>
    </div>
    <div class="field"><label>Posição do corte <span class="u" data-a="faixa"></span></label>
      <div class="e3d-slider"><input type="range" min="0" max="100" step="0.1" value="50" data-a="pos"><input type="text" data-a="posmm"></div>
      <div class="e3d-posbotoes">
        <button type="button" class="btn mini" data-a="menos" title="Desce 1 mm (Shift: 0,1 mm) — seta ↓ do teclado">−1</button>
        <button type="button" class="btn mini" data-a="meio" title="Corte bem no meio da peça">No meio</button>
        <button type="button" class="btn mini" data-a="mais" title="Sobe 1 mm (Shift: 0,1 mm) — seta ↑ do teclado">+1</button>
      </div>
      <div class="e3d-dicacorte">
        <span><b>Clique na peça</b> pra levar o corte até o ponto</span>
        <span><b>Arraste a seta azul</b> no 3D</span>
        <span><b>↑ ↓</b> no teclado: 1 mm (com Shift: 0,1 mm)</span>
      </div>
      <div class="e3d-secao" data-a="secao"></div></div>
    <div class="field"><label>Conector</label><select data-a="tipo"><option value="nenhum">Sem conector</option>${TIPOS_CONECTOR.map(t => '<option value="' + t.id + '">' + t.nome + '</option>').join('')}</select></div>
    <div data-a="conOpc" style="display:none">
      <div class="e3d-l3">
        <div data-c="diametro"><label>Diâmetro</label><input type="text" data-a="diametro" value="5"></div>
        <div data-c="lado"><label>Lado</label><input type="text" data-a="lado" value="5"></div>
        <div data-c="largura"><label>Largura</label><input type="text" data-a="largura" value="4"></div>
        <div data-c="comprimento"><label>Comprimento</label><input type="text" data-a="comprimento" value="8"></div>
        <div><label>Profundidade</label><input type="text" data-a="profundidade" value="6"></div>
        <div><label>Folga/lado</label><input type="text" data-a="folga" value="0,2"></div>
        <div data-c="quantidade"><label>Quantidade</label><input type="text" data-a="quantidade" value="2"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>O pino fica na</label>
        <div class="seg" data-a="lado2"><button type="button" data-v="A" class="active">Parte de cima / frente</button><button type="button" data-v="B">Parte de baixo / trás</button></div></div>
      <p class="u" data-a="conInfo"></p>
    </div>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="ir">Cortar (com prévia)</button></div>
    <div data-a="res"></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let eixo = 'z', ladoPino = 'A';
  let faixa = null;       // {min, max} da projeção do objeto na normal

  function normal() {
    if (eixo === 'x') return [1, 0, 0];
    if (eixo === 'y') return [0, 1, 0];
    if (eixo === 'z') return [0, 0, 1];
    const a = lerNumero(q('ia').value, 0) * Math.PI / 180, b = lerNumero(q('ib').value, 0) * Math.PI / 180;
    // parte do vertical e inclina em X (A) e Y (B)
    return [Math.sin(b) * Math.cos(a), -Math.sin(a), Math.cos(a) * Math.cos(b)];
  }
  function calcularFaixa() {
    const o = est.objetoAtual();
    faixa = null;
    if (!o) { q('faixa').textContent = 'escolha um objeto'; return; }
    const n = normal();
    let mn = Infinity, mx = -Infinity;
    const t = o.transform;
    for (const p of o.partes) {
      const pos = p.malha.pos;
      const passo = Math.max(1, Math.floor(pos.length / 3 / 50000));
      for (let v = 0; v < pos.length / 3; v += passo) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        const X = t[0] * x + t[4] * y + t[8] * z + t[12], Y = t[1] * x + t[5] * y + t[9] * z + t[13], Z = t[2] * x + t[6] * y + t[10] * z + t[14];
        const s = X * n[0] + Y * n[1] + Z * n[2];
        if (s < mn) mn = s; if (s > mx) mx = s;
      }
    }
    faixa = { min: mn, max: mx };
    q('faixa').textContent = fmt(mn) + ' a ' + fmt(mx) + ' mm';
  }
  function posicaoMM() { return faixa ? faixa.min + (faixa.max - faixa.min) * (+q('pos').value / 100) : 0; }
  function mostrarPlano() {
    const o = est.objetoAtual();
    if (!o || !faixa || !d.open || est.previaAtiva) { est.visor.limparAjudas('corte'); return; }
    const c = est.cena.caixaObjeto(o);
    const tam = c ? Math.hypot(c.tam[0], c.tam[1], c.tam[2]) * 1.15 : 100;
    est.visor.mostrarPlanoCorte(o.id, { n: normal(), d: posicaoMM() }, tam);
    if (document.activeElement !== q('posmm')) q('posmm').value = fmt(posicaoMM(), 2).replace(/\./g, '');
  }
  function refazerTudo() { calcularFaixa(); mostrarPlano(); }
  // leva o corte pra uma posição em mm (limita à peça)
  function irPara(mm) {
    if (!faixa) calcularFaixa();
    if (!faixa) return;
    const v = Math.max(faixa.min, Math.min(faixa.max, mm));
    q('pos').value = 100 * (v - faixa.min) / Math.max(1e-9, faixa.max - faixa.min);
    mostrarPlano();
    if (document.activeElement !== q('posmm')) q('posmm').value = fmt(v, 2).replace(/\./g, '');
  }
  q('menos').onclick = ev => irPara(posicaoMM() - (ev.shiftKey ? 0.1 : 1));
  q('mais').onclick = ev => irPara(posicaoMM() + (ev.shiftKey ? 0.1 : 1));
  q('meio').onclick = () => { if (!faixa) calcularFaixa(); if (faixa) irPara((faixa.min + faixa.max) / 2); };
  est.visor.on('secao', m => {
    q('secao').innerHTML = m ? 'Seção do corte: <b>' + fmt(m.largura, 1) + ' × ' + fmt(m.altura, 1) + ' mm</b>' : (d.open && faixa ? '<span class="aviso">O plano não passa pela peça.</span>' : '');
  });
  // clique na peça: o corte vai até o ponto clicado
  est.on('clique', ({ hit }) => {
    if (!d.open || est.ferramenta !== 'corte' || !hit) return;
    const n = normal();
    irPara(hit.ponto.x * n[0] + hit.ponto.y * n[1] + hit.ponto.z * n[2]);
  });
  // seta do 3D arrastada
  est.on('corte-arrasto', mm => { if (d.open && mm != null && isFinite(mm)) irPara(mm); });
  // teclado
  document.addEventListener('keydown', ev => {
    if (!d.open || est.ferramenta !== 'corte' || !est.visivel() || est.previaAtiva) return;
    const alvo = ev.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT')) return;
    const passo = ev.shiftKey ? 0.1 : 1;
    if (ev.key === 'ArrowUp' || ev.key === 'PageUp') { ev.preventDefault(); irPara(posicaoMM() + passo); }
    else if (ev.key === 'ArrowDown' || ev.key === 'PageDown') { ev.preventDefault(); irPara(posicaoMM() - passo); }
  });

  q('eixo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    eixo = b.dataset.v;
    q('eixo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    q('livre').style.display = eixo === 'livre' ? '' : 'none';
    refazerTudo();
  });
  ['ia', 'ib'].forEach(k => q(k).addEventListener('input', refazerTudo));
  q('pos').addEventListener('input', mostrarPlano);
  q('posmm').addEventListener('change', () => {
    if (!faixa) return;
    const v = lerNumero(q('posmm').value, posicaoMM());
    q('pos').value = Math.max(0, Math.min(100, 100 * (v - faixa.min) / Math.max(1e-9, faixa.max - faixa.min)));
    mostrarPlano();
  });
  q('lado2').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; ladoPino = b.dataset.v; q('lado2').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); });

  function cfgConector() {
    const t = q('tipo').value;
    if (t === 'nenhum') return null;
    const n = k => lerNumero(q(k).value, 0);
    return { tipo: t, diametro: n('diametro'), lado: n('lado'), largura: n('largura'), comprimento: n('comprimento'), profundidade: n('profundidade'), folga: n('folga'), quantidade: Math.max(1, Math.round(n('quantidade'))), ladoPino, folgaFundo: 0.3, chanfro: 0.4, parede: 1.2 };
  }
  function atualizarCon() {
    const t = q('tipo').value;
    q('conOpc').style.display = t === 'nenhum' ? 'none' : '';
    const mostra = { diametro: ['cilindrico', 'hexagonal', 'solto'], lado: ['quadrado'], largura: ['retangular', 'lingueta', 'andorinha'], comprimento: ['retangular'], quantidade: ['cilindrico', 'quadrado', 'retangular', 'hexagonal', 'solto'] };
    d.querySelectorAll('[data-c]').forEach(x => { x.style.display = (mostra[x.dataset.c] || []).includes(t) ? '' : 'none'; });
    const c = cfgConector();
    q('conInfo').textContent = !c ? '' : ['lingueta', 'andorinha'].includes(t)
      ? 'Ranhura com ' + fmt(c.folga, 2) + ' mm de folga por lado. ' + (t === 'andorinha' ? 'Encaixa deslizando de lado.' : '')
      : 'Positivo: ' + medidaTexto(c) + ' → negativo: ' + medidaTexto(c, c.folga) + (t === 'solto' ? ' (furos dos dois lados + pino separado)' : '') + '. Fundo do furo ' + fmt(c.folgaFundo, 1) + ' mm além da ponta.';
  }
  ['tipo', 'diametro', 'lado', 'largura', 'comprimento', 'folga'].forEach(k => q(k).addEventListener('input', atualizarCon));
  atualizarCon();

  async function cortar() {
    const o = est.objetoAtual();
    if (!o) { avisar('Escolha o objeto a cortar.', 'warn'); return; }
    if (!faixa) calcularFaixa();
    const planoMundo = { n: normal(), d: posicaoMM() };
    const plano = planoParaLocal(planoMundo, o.transform);
    const opc = { conector: cfgConector() };
    q('ir').disabled = true;
    q('res').innerHTML = '<div class="e3d-nota">Cortando…</div>';
    let r;
    try { r = await est.rodar('cortar', { partes: o.partes.map(p => est.parteParaMotor(p)), plano, opc }, 'Cortar'); }
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + (e.message || e) + '</div>'; return; }
    finally { q('ir').disabled = false; }
    est.visor.limparAjudas('corte');
    const c = est.cena.caixaObjeto(o);
    const afasta = c ? Math.max(6, Math.hypot(c.tam[0], c.tam[1], c.tam[2]) * 0.12) : 10;
    const n = planoMundo.n;
    const objetos = [
      { transform: o.transform, deslocar: n.map(v => v * afasta), partes: r.A.map(p => ({ malha: p.malha, cor: p.cor, paleta: p.paleta, papel: 'normal', origem: p.origem })) },
      { transform: o.transform, deslocar: n.map(v => -v * afasta), partes: r.B.map(p => ({ malha: p.malha, cor: p.cor, paleta: p.paleta, papel: 'normal', origem: p.origem })) }
    ];
    const notas = r.avisos.slice();
    if (r.relatorio.length) notas.push(r.relatorio.length + ' conector(es): ' + (r.relatorio[0].pino ? 'pino ' + r.relatorio[0].pino + ' / furo ' + r.relatorio[0].furo : r.relatorio[0].tipo));
    q('res').innerHTML = '<div class="e3d-nota ok">Prévia: confirme em cima do 3D. Área do corte: ' + fmt(r.areaSecao, 1) + ' mm².</div>';
    est.mostrarPrevia({
      titulo: 'Corte em 2 partes', legenda: [['#0659f2', 'face do corte / conector']], objetos, explodir: 1, notas, textoConfirmar: 'Confirmar corte',
      confirmar: () => {
        est.cena.aplicar('Cortar ' + o.nome, () => {
          const idx = est.cena.objetos.indexOf(o);
          const nomeA = o.nome + ' A', nomeB = o.nome + ' B';
          const A = novoObjeto({ nome: nomeA, transform: o.transform, partes: r.A.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta })) });
          const B = novoObjeto({ nome: nomeB, transform: o.transform, partes: r.B.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta })) });
          const extras = r.extras.map((x, k) => novoObjeto({ nome: x.nome, transform: o.transform, partes: [{ nome: x.nome, malha: x.malha, cor: x.cor }] }));
          est.cena.objetos.splice(idx, 1, A, B, ...extras);
          for (const x of extras) { est.cena.centralizar(x); }
          est.cena.sel = { objeto: A.id, parte: A.partes.length === 1 ? A.partes[0].id : null };
        });
        q('res').innerHTML = '<div class="e3d-nota ok">Cortado. As partes ficaram no lugar; use <b>Organizar mesa</b> pra imprimir.' + (r.relatorio.length ? ' Conectores: ' + r.relatorio.map(x => x.pino ? x.pino + '/' + x.furo : x.tipo).join(', ') + '.' : '') + '</div>';
        refazerTudo();
      },
      cancelar: () => { q('res').innerHTML = ''; mostrarPlano(); }
    });
    void novaParte;
  }
  q('ir').onclick = cortar;
  d.addEventListener('toggle', () => {
    if (d.open) { est.definirFerramenta('corte'); refazerTudo(); }
    else { est.visor.limparAjudas('corte'); if (est.ferramenta === 'corte') est.definirFerramenta('navegar'); }
  });
  est.on('selecao', () => { if (d.open) refazerTudo(); });
  est.on('mudou', () => { if (d.open) refazerTudo(); });
  est.on('previa-fim', () => { if (d.open) refazerTudo(); });
  return { el: d };
}

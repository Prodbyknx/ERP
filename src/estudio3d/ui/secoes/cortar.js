// Painel 5 — cortar por plano (X/Y/Z ou inclinado) com conectores.
import { el, esc, fmt, lerNumero, avisar } from '../util.js';
import { novaParte, novoObjeto } from '../cena.js';
import { TIPOS_CONECTOR, medidaTexto } from '../../core/conectores.js';
import { planoParaLocal } from '../../core/corte.js';
import * as M4 from '../../core/mat4.js';

export function montarCortar(est) {
  const d = el('details', { 'data-sec': 'corte' });
  d.innerHTML = `<summary><span class="n">5</span>Cortar a peça</summary><div class="e3d-sec">
    <div class="field"><label>O que cortar</label>
      <div class="seg" data-a="modo"><button type="button" data-v="plano" class="active">A peça inteira</button><button type="button" data-v="parte">Só uma parte</button></div>
      <p class="u" data-a="modoDica" style="display:none;margin:6px 0 0">Clique na parte que quer soltar (mão, cabeça, orelha, chifre…). O corte vai sozinho pro ponto mais fino e só ela sai.</p></div>
    <div data-a="soPlano">
    <div class="field"><label>Direção do corte</label>
      <div class="seg" data-a="eixo"><button type="button" data-v="z" class="active">Horizontal (Z)</button><button type="button" data-v="x">Vertical X</button><button type="button" data-v="y">Vertical Y</button><button type="button" data-v="livre">Inclinado</button></div></div>
    <div data-a="livre" style="display:none" class="e3d-l2">
      <div class="field"><label>Inclinação A (graus)</label><input type="text" data-a="ia" value="0"></div>
      <div class="field"><label>Inclinação B (graus)</label><input type="text" data-a="ib" value="0"></div>
    </div>
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
      <label class="fer-check" style="margin-bottom:6px" title="O maior conector que cabe na seção deixando parede, e a profundidade que a peça aguenta"><input type="checkbox" data-a="auto" checked> Tamanho automático <span class="u">o maior que cabe</span></label>
      <div class="e3d-l3">
        <div data-c="diametro"><label>Diâmetro</label><input type="text" data-a="diametro" value="5"></div>
        <div data-c="lado"><label>Lado</label><input type="text" data-a="lado" value="5"></div>
        <div data-c="largura"><label>Largura</label><input type="text" data-a="largura" value="4"></div>
        <div data-c="comprimento"><label>Comprimento</label><input type="text" data-a="comprimento" value="8"></div>
        <div data-c="profundidade"><label>Profundidade</label><input type="text" data-a="profundidade" value="6"></div>
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
  let eixo = 'z', ladoPino = 'A', modo = 'plano';
  let sug = null;         // corte de uma parte: { objId, plano, centro, raio, ponto } no referencial da peça
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
  // corte de uma parte: plano da sugestão (+ ajuste do slider), levado pro mundo
  function planoDaParte(o) {
    const off = (+q('pos').value - 50) / 50 * alcanceParte();
    const n = sug.plano.n, c = sug.centro.map((v, i) => v + n[i] * off);
    const T = o.transform, G = M4.inverter(T);
    const cw = M4.aplicarPonto(T, c[0], c[1], c[2]);
    let nw = [0, 1, 2].map(i => G[i * 4] * n[0] + G[i * 4 + 1] * n[1] + G[i * 4 + 2] * n[2]);
    const L = Math.hypot(nw[0], nw[1], nw[2]) || 1; nw = nw.map(v => v / L);
    return { local: { n, d: n[0] * c[0] + n[1] * c[1] + n[2] * c[2] }, mundo: { n: nw, d: nw[0] * cw[0] + nw[1] * cw[1] + nw[2] * cw[2] }, cw, off };
  }
  const alcanceParte = () => sug ? Math.max(4, 3 * sug.raio) : 5;
  function mostrarPlano() {
    const o = est.objetoAtual();
    if (modo === 'parte') {
      if (!o || !sug || sug.objId !== o.id || !d.open || est.previaAtiva) { est.visor.limparAjudas('corte'); return; }
      const p = planoDaParte(o);
      est.visor.mostrarPlanoCorte(o.id, p.mundo, Math.max(8, sug.raio * 5), { centro: p.cw, local: true });
      q('faixa').textContent = '± ' + fmt(alcanceParte(), 1) + ' mm do ponto sugerido';
      if (document.activeElement !== q('posmm')) q('posmm').value = fmt(p.off, 2).replace(/\./g, '');
      return;
    }
    if (!o || !faixa || !d.open || est.previaAtiva) { est.visor.limparAjudas('corte'); return; }
    const c = est.cena.caixaObjeto(o);
    const tam = c ? Math.hypot(c.tam[0], c.tam[1], c.tam[2]) * 1.15 : 100;
    est.visor.mostrarPlanoCorte(o.id, { n: normal(), d: posicaoMM() }, tam);
    if (document.activeElement !== q('posmm')) q('posmm').value = fmt(posicaoMM(), 2).replace(/\./g, '');
  }
  function refazerTudo() { calcularFaixa(); mostrarPlano(); }
  // leva o corte pra uma posição em mm (limita à peça)
  function irPara(mm) {
    if (modo === 'parte') {
      if (!sug) return;
      const R = alcanceParte(), v = Math.max(-R, Math.min(R, mm));
      q('pos').value = 50 + 50 * v / R;
      mostrarPlano();
      return;
    }
    if (!faixa) calcularFaixa();
    if (!faixa) return;
    const v = Math.max(faixa.min, Math.min(faixa.max, mm));
    q('pos').value = 100 * (v - faixa.min) / Math.max(1e-9, faixa.max - faixa.min);
    mostrarPlano();
    if (document.activeElement !== q('posmm')) q('posmm').value = fmt(v, 2).replace(/\./g, '');
  }
  const posAtual = () => modo === 'parte' ? (+q('pos').value - 50) / 50 * alcanceParte() : posicaoMM();
  q('menos').onclick = ev => irPara(posAtual() - (ev.shiftKey ? 0.1 : 1));
  q('mais').onclick = ev => irPara(posAtual() + (ev.shiftKey ? 0.1 : 1));
  q('meio').onclick = () => { if (modo === 'parte') { irPara(0); return; } if (!faixa) calcularFaixa(); if (faixa) irPara((faixa.min + faixa.max) / 2); };
  est.visor.on('secao', m => {
    if (modo === 'parte') { q('secao').innerHTML = sug ? 'Seção ≈ <b>Ø ' + fmt(2 * sug.raio, 1) + ' mm</b>' + (m ? ' (' + fmt(m.largura, 1) + ' × ' + fmt(m.altura, 1) + ')' : '') : ''; return; }
    q('secao').innerHTML = m ? 'Seção do corte: <b>' + fmt(m.largura, 1) + ' × ' + fmt(m.altura, 1) + ' mm</b>' : (d.open && faixa ? '<span class="aviso">O plano não passa pela peça.</span>' : '');
  });
  // clique na peça: o corte vai até o ponto clicado
  est.on('clique', ({ hit }) => {
    if (!d.open || est.ferramenta !== 'corte' || !hit) return;
    if (modo === 'parte') { sugerir(hit); return; }
    const n = normal();
    irPara(hit.ponto.x * n[0] + hit.ponto.y * n[1] + hit.ponto.z * n[2]);
  });
  // seta do 3D arrastada
  est.on('corte-arrasto', mm => {
    if (!d.open || mm == null || !isFinite(mm)) return;
    if (modo === 'parte') { const o = est.objetoAtual(); if (o && sug) { const p = planoDaParte(o); irPara(p.off + (mm - p.mundo.d)); } return; }
    irPara(mm);
  });
  // teclado
  document.addEventListener('keydown', ev => {
    if (!d.open || est.ferramenta !== 'corte' || !est.visivel() || est.previaAtiva) return;
    const alvo = ev.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT')) return;
    const passo = ev.shiftKey ? 0.1 : 1;
    if (ev.key === 'ArrowUp' || ev.key === 'PageUp') { ev.preventDefault(); irPara(posAtual() + passo); }
    else if (ev.key === 'ArrowDown' || ev.key === 'PageDown') { ev.preventDefault(); irPara(posAtual() - passo); }
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
    if (modo === 'parte') { irPara(lerNumero(q('posmm').value, 0)); return; }
    if (!faixa) return;
    const v = lerNumero(q('posmm').value, posicaoMM());
    q('pos').value = Math.max(0, Math.min(100, 100 * (v - faixa.min) / Math.max(1e-9, faixa.max - faixa.min)));
    mostrarPlano();
  });
  q('modo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    modo = b.dataset.v;
    q('modo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    q('soPlano').style.display = modo === 'parte' ? 'none' : '';
    q('modoDica').style.display = modo === 'parte' ? '' : 'none';
    d.querySelector('.e3d-dicacorte').style.display = modo === 'parte' ? 'none' : '';
    const [bA, bB] = q('lado2').querySelectorAll('button');
    bA.textContent = modo === 'parte' ? 'Na parte que sai' : 'Parte de cima / frente';
    bB.textContent = modo === 'parte' ? 'No resto da peça' : 'Parte de baixo / trás';
    q('pos').value = 50; sug = null; q('res').innerHTML = '';
    if (modo === 'parte' && q('quantidade')) q('quantidade').value = '1';
    refazerTudo();
  });
  q('auto').addEventListener('change', atualizarCon);
  // pede ao motor o lugar do corte da parte clicada
  async function sugerir(hit) {
    const o = est.objetoAtual();
    if (!o) return;
    const G = M4.inverter(o.transform);
    const ponto = M4.aplicarPonto(G, hit.ponto.x, hit.ponto.y, hit.ponto.z);
    q('res').innerHTML = '<div class="e3d-nota">Procurando o ponto mais fino…</div>';
    try {
      const r = await est.rodar('sugerirSeparacao', { partes: o.partes.map(p => est.parteParaMotor(p)), ponto, opc: { encaixe: q('tipo').value !== 'nenhum' } }, 'Achar onde separar');
      sug = { objId: o.id, plano: r.plano, centro: r.centro, raio: r.raio, ponto };
      q('pos').value = 50;
      q('res').innerHTML = '<div class="e3d-nota ok">Achei o ponto mais fino (≈ Ø ' + fmt(2 * r.raio, 1) + ' mm). Ajuste com a seta ou ↑ ↓ e clique em Cortar.' + (r.avisos.length ? '<br>' + r.avisos.map(esc).join('<br>') : '') + '</div>';
      mostrarPlano();
    } catch (e) { sug = null; q('res').innerHTML = '<div class="e3d-nota erro">' + esc(e.message || e) + '</div>'; est.visor.limparAjudas('corte'); }
  }
  q('lado2').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; ladoPino = b.dataset.v; q('lado2').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); });

  function cfgConector() {
    const t = q('tipo').value;
    if (t === 'nenhum') return null;
    const n = k => lerNumero(q(k).value, 0);
    const auto = q('auto').checked && ['cilindrico', 'quadrado', 'hexagonal', 'solto'].includes(t);
    return { tipo: t, auto, diametro: n('diametro'), lado: n('lado'), largura: n('largura'), comprimento: n('comprimento'), profundidade: n('profundidade'), folga: n('folga'), quantidade: Math.max(1, Math.round(n('quantidade'))), ladoPino, folgaFundo: 0.3, chanfro: 0.4, parede: 1.2 };
  }
  function atualizarCon() {
    const t = q('tipo').value;
    q('conOpc').style.display = t === 'nenhum' ? 'none' : '';
    const mostra = { diametro: ['cilindrico', 'hexagonal', 'solto'], lado: ['quadrado'], largura: ['retangular', 'lingueta', 'andorinha'], comprimento: ['retangular'], quantidade: ['cilindrico', 'quadrado', 'retangular', 'hexagonal', 'solto'] };
    const autoOk = ['cilindrico', 'quadrado', 'hexagonal', 'solto'].includes(t);
    q('auto').closest('label').style.display = autoOk ? '' : 'none';
    const auto = autoOk && q('auto').checked;
    mostra.profundidade = ['cilindrico', 'quadrado', 'retangular', 'hexagonal', 'solto', 'lingueta', 'andorinha'];
    d.querySelectorAll('[data-c]').forEach(x => { x.style.display = (mostra[x.dataset.c] || []).includes(t) && !(auto && x.dataset.c !== 'quantidade') ? '' : 'none'; });
    const c = cfgConector();
    if (auto) { q('conInfo').textContent = 'O tamanho sai da seção do corte (o maior que cabe deixando parede). Folga ' + fmt(c.folga, 2) + ' mm por lado.'; return; }
    q('conInfo').textContent = !c ? '' : ['lingueta', 'andorinha'].includes(t)
      ? 'Ranhura com ' + fmt(c.folga, 2) + ' mm de folga por lado. ' + (t === 'andorinha' ? 'Encaixa deslizando de lado.' : '')
      : 'Positivo: ' + medidaTexto(c) + ' → negativo: ' + medidaTexto(c, c.folga) + (t === 'solto' ? ' (furos dos dois lados + pino separado)' : '') + '. Fundo do furo ' + fmt(c.folgaFundo, 1) + ' mm além da ponta.';
  }
  ['tipo', 'diametro', 'lado', 'largura', 'comprimento', 'folga'].forEach(k => q(k).addEventListener('input', atualizarCon));
  atualizarCon();

  async function cortarParte() {
    const o = est.objetoAtual();
    if (!o || !sug || sug.objId !== o.id) { avisar('Clique na parte que quer separar.', 'warn'); return; }
    const p = planoDaParte(o);
    q('ir').disabled = true;
    q('res').innerHTML = '<div class="e3d-nota">Separando…</div>';
    let r;
    try { r = await est.rodar('cortarLocal', { partes: o.partes.map(x => est.parteParaMotor(x)), plano: p.local, ponto: sug.ponto, opc: { conector: cfgConector(), nomeParte: o.nome + ' – parte' } }, 'Separar parte'); }
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + esc(e.message || e) + '</div>'; return; }
    finally { q('ir').disabled = false; }
    est.visor.limparAjudas('corte');
    const afasta = Math.max(6, sug.raio * 3), n = p.mundo.n;
    const notas = r.avisos.slice();
    if (r.relatorio.length) notas.push('Encaixe: pino ' + r.relatorio[0].pino + ' / furo ' + r.relatorio[0].furo + ', ' + fmt(r.relatorio[0].profundidade, 1) + ' mm');
    const semConector = !!cfgConector() && !r.relatorio.length;
    const alerta = semConector ? 'Saiu SEM encaixe: ' + (r.avisos.find(a => /encaixe|conector|pino|espessura|largura/i.test(a)) || 'não coube pino nessa parte.') : null;
    est.mostrarPrevia({
      titulo: 'Separar parte', legenda: [['#0659f2', 'face do corte / encaixe']], explodir: 1, notas, alerta, textoConfirmar: semConector ? 'Separar sem encaixe' : 'Confirmar',
      objetos: [
        { transform: o.transform, deslocar: n.map(v => v * afasta), partes: r.A.map(x => ({ malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal', origem: x.origem })) },
        { transform: o.transform, deslocar: [0, 0, 0], partes: r.B.map(x => ({ malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal', origem: x.origem })) }
      ],
      confirmar: () => {
        est.cena.aplicar('Separar parte de ' + o.nome, () => {
          const idx = est.cena.objetos.indexOf(o);
          const B = novoObjeto({ nome: o.nome, transform: o.transform, partes: r.B.map(x => ({ nome: x.nome, malha: x.malha, cor: x.cor, paleta: x.paleta })) });
          const A = novoObjeto({ nome: o.nome + ' – parte', transform: o.transform, partes: r.A.map(x => ({ nome: x.nome, malha: x.malha, cor: x.cor, paleta: x.paleta })) });
          const extras = r.extras.map(x => novoObjeto({ nome: x.nome, transform: o.transform, partes: [{ nome: x.nome, malha: x.malha, cor: x.cor }] }));
          est.cena.objetos.splice(idx, 1, B, A, ...extras);
          for (const x of extras) est.cena.colocarNaMesa(x);
          est.cena.sel = { objeto: A.id, parte: A.partes.length === 1 ? A.partes[0].id : null };
        });
        sug = null;
        q('res').innerHTML = '<div class="e3d-nota ok">Parte separada' + (r.relatorio.length ? ' com encaixe (' + esc(r.relatorio.map(x => x.pino + '/' + x.furo).join(', ')) + ')' : '') + '. Clique em outra parte pra continuar.</div>';
        refazerTudo();
      },
      cancelar: () => { q('res').innerHTML = ''; mostrarPlano(); }
    });
  }

  async function cortar() {
    if (modo === 'parte') return cortarParte();
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
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + esc(e.message || e) + '</div>'; return; }
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
    // pediu conector e não saiu nenhum: diz em destaque e por quê (antes só cortava calado)
    const semConector = opc.conector && !r.relatorio.length;
    const alerta = semConector ? 'Saiu SEM conector: ' + (r.avisos.find(a => /encaixe|conector|pino|espessura|largura/i.test(a)) || 'não coube encaixe nesse corte.') : null;
    q('res').innerHTML = semConector ? '<div class="e3d-nota aviso">' + esc(alerta) + '</div>' : '<div class="e3d-nota ok">Prévia: confirme em cima do 3D. Área do corte: ' + fmt(r.areaSecao, 1) + ' mm².</div>';
    est.mostrarPrevia({
      titulo: 'Corte em 2 partes', legenda: [['#0659f2', 'face do corte / conector']], objetos, explodir: 1, notas: semConector ? notas.filter(a => a !== alerta.replace('Saiu SEM conector: ', '')) : notas, alerta, textoConfirmar: semConector ? 'Cortar sem conector' : 'Confirmar corte',
      confirmar: () => {
        est.cena.aplicar('Cortar ' + o.nome, () => {
          const idx = est.cena.objetos.indexOf(o);
          const nomeA = o.nome + ' A', nomeB = o.nome + ' B';
          const A = novoObjeto({ nome: nomeA, transform: o.transform, partes: r.A.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta })) });
          const B = novoObjeto({ nome: nomeB, transform: o.transform, partes: r.B.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor, paleta: p.paleta })) });
          const extras = r.extras.map((x, k) => novoObjeto({ nome: x.nome, transform: o.transform, partes: [{ nome: x.nome, malha: x.malha, cor: x.cor }] }));
          est.cena.objetos.splice(idx, 1, A, B, ...extras);
          for (const x of extras) { est.cena.colocarNaMesa(x); }
          est.cena.sel = { objeto: A.id, parte: A.partes.length === 1 ? A.partes[0].id : null };
        });
        q('res').innerHTML = '<div class="e3d-nota ' + (semConector ? 'aviso' : 'ok') + '">Cortado' + (semConector ? ' SEM conector' : '') + '. As partes ficaram no lugar; use <b>Organizar mesa</b> pra imprimir.' + (r.relatorio.length ? ' Conectores: ' + esc(r.relatorio.map(x => x.pino ? x.pino + '/' + x.furo : x.tipo).join(', ')) + (r.extras.length ? ' + ' + r.extras.length + ' pino(s) solto(s) pra imprimir' : '') + '.' : '') + '</div>';
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

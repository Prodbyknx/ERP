// Painel 2 — posição, rotação, tamanho (valores numéricos) e cor.
// Mover/girar/escalar só mexe na matriz do objeto: a malha não é tocada.
// Espelhar: só virar (matriz) ou juntar com a original (geometria no motor,
// com prévia: modele metade e ganhe a peça inteira).
import { el, esc, fmt, lerNumero, avisar } from '../util.js';
import * as M4 from '../../core/mat4.js';
import { normalizarHex, nomeDaCor, PALETA_PECAS } from '../../core/cores.js';

export function montarTransformar(est) {
  const d = el('details', { 'data-sec': 'transf' });
  d.innerHTML = `<summary><span class="n">2</span>Posição, tamanho e cor</summary><div class="e3d-sec">
    <p class="u" data-a="alvo">Escolha um objeto.</p>
    <div class="e3d-l3" title="Centro da peça na mesa (X, Y) e altura da parte de baixo (Z)"><div><label>Centro X</label><input type="text" data-t="px"></div><div><label>Centro Y</label><input type="text" data-t="py"></div><div><label>Base Z (mm)</label><input type="text" data-t="pz"></div></div>
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
      <button class="btn" data-a="zerar" title="Volta rotação e escala pro original">Redefinir</button>
    </div>
    <div class="e3d-botoes">
      <button class="btn" data-a="deitar" title="Gira a peça pra maior face plana ficar na mesa (ex.: a face do corte)">Deitar na maior face plana</button>
      <button class="btn" data-a="deitarClique" title="Clique numa face da peça: ela vai pra mesa">Deitar na face que eu clicar</button>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">
      <div class="e3d-titulo">Espelhar</div>
      <div class="seg" data-a="espEixo"><button type="button" data-v="0" class="active" title="Esquerda ↔ direita">X</button><button type="button" data-v="1" title="Frente ↔ trás">Y</button><button type="button" data-v="2" title="Cima ↔ baixo">Z</button></div>
      <label class="fer-check" title="Corta a peça no espelho, vira a metade e solda na costura: uma peça só, fechada"><input type="checkbox" data-a="espUnir"> Juntar com a original <span class="u">modele metade, ganhe a peça inteira</span></label>
      <div class="field" data-a="espPosBloco" style="display:none"><label>Onde fica o espelho</label><div class="seg" data-a="espPos"><button type="button" data-v="min">Lado −</button><button type="button" data-v="centro">No meio</button><button type="button" data-v="max" class="active">Lado +</button></div></div>
      <div class="e3d-botoes"><button class="btn" data-a="esp">Espelhar</button></div>
      <div data-a="espRes"></div>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">
      <div data-a="blocoPlaca" style="display:none;margin-bottom:10px"><div class="e3d-titulo">Placa</div>
        <div class="seg" data-a="placa"></div></div>
      <div class="e3d-titulo">Duplicar em série</div>
      <div class="e3d-l3"><div><label>Cópias</label><input type="text" data-a="serieN" value="4"></div><div><label>Distância (mm)</label><input type="text" data-a="serieD" value="10"></div>
        <div><label>Direção</label><select data-a="serieE"><option value="0">X (lado)</option><option value="1">Y (fundo)</option><option value="2">Z (pra cima)</option></select></div></div>
      <div class="e3d-botoes"><button class="btn" data-a="serie">Criar cópias</button></div>
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

  // a escala já foi pra malha (cena.fixarEsticar): o painel mostra a matriz
  // "de antes" (rígida · esticado) e, ao aplicar, desconta o esticado
  const vista = o => o.esticado ? M4.multiplicar(o.transform, o.esticado) : o.transform;
  const real = (o, T) => o.esticado ? M4.multiplicar(T, M4.inverter(o.esticado)) : T;
  function estado(o) {
    const dc = M4.decompor(vista(o));
    return dc;
  }
  function render() {
    const o = est.objetoAtual();
    const inputs = d.querySelectorAll('input[data-t]');
    inputs.forEach(i => { i.disabled = !o; });
    q('[data-a=alvo]').textContent = o ? 'Objeto: ' + o.nome : 'Escolha um objeto.';
    // placa da peça (levar pra outra placa, ou pra uma nova)
    const bp = q('[data-a=blocoPlaca]');
    bp.style.display = o && est.cena.placas > 1 ? '' : 'none';
    if (o && est.cena.placas > 1) {
      const atual = est.cena.placaDe(o), sp = q('[data-a=placa]');
      sp.innerHTML = '';
      for (let k = 0; k < est.cena.placas; k++) sp.appendChild(el('button', { type: 'button', 'data-v': String(k), class: k === atual ? 'active' : null }, String(k + 1)));
      sp.appendChild(el('button', { type: 'button', 'data-v': 'nova', title: 'Levar pra uma placa nova' }, '+ nova'));
    }
    if (o) {
      const dc = estado(o);
      const c = est.cena.caixaExata(o);
      const set = (k, v, casas = 2) => { const i = campo(k); if (document.activeElement !== i) i.value = fmt(v, casas).replace(/\./g, ''); };
      // posição = o que se vê: centro da peça na mesa e altura da base (girada
      // ou não). A origem interna do arquivo não diz nada pra quem usa.
      if (c) { set('px', (c.min[0] + c.max[0]) / 2); set('py', (c.min[1] + c.max[1]) / 2); set('pz', c.min[2]); }
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
    if (k === 'px' || k === 'py' || k === 'pz') {
      const c = est.cena.caixaExata(o), eixo = { px: 0, py: 1, pz: 2 }[k];
      const v = lerNumero(campo(k).value, NaN);
      if (!c || !isFinite(v)) { render(); return; }
      const atual = [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, c.min[2]], d = [0, 0, 0];
      d[eixo] = v - atual[eixo];
      if (Math.abs(d[eixo]) < 1e-9) return;
      est.cena.aplicar('Posição', () => { o.transform = M4.multiplicar(M4.translacao(d[0], d[1], d[2]), o.transform); });
      return;
    }
    const pos = dc.pos;
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
      o.transform = real(o, T);
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
  /* ---------------- espelhar ---------------- */
  const segEsp = k => q('[data-a=' + k + '] button.active').dataset.v;
  ['espEixo', 'espPos'].forEach(k => q('[data-a=' + k + ']').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) q('[data-a=' + k + ']').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }));
  q('[data-a=espUnir]').addEventListener('change', () => { q('[data-a=espPosBloco]').style.display = q('[data-a=espUnir]').checked ? '' : 'none'; q('[data-a=espRes]').innerHTML = ''; });
  q('[data-a=esp]').onclick = async () => {
    const o = est.objetoAtual(); if (!o) { avisar('Escolha a peça.', 'warn'); return; }
    const k = +segEsp('espEixo'), res = q('[data-a=espRes]');
    if (!q('[data-a=espUnir]').checked) {
      // só virar: no lugar, em volta do centro da peça
      const c = est.cena.caixaExata(o), m = (c.min[k] + c.max[k]) / 2, t = [0, 0, 0], u = [0, 0, 0], e = [1, 1, 1];
      t[k] = m; u[k] = -m; e[k] = -1;
      est.cena.aplicar('Espelhar', () => { o.transform = M4.multiplicar(M4.multiplicar(M4.translacao(...t), M4.multiplicar(M4.escala(...e), M4.translacao(...u))), o.transform); });
      res.innerHTML = '';
      return;
    }
    // juntar: o espelho é no referencial da peça (vale mesmo girada)
    const p = est.parteAtual() || o.partes[0];
    const v = M4.aplicarDirecao(M4.inverter(o.transform), k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0), a = v.map(Math.abs), i = a.indexOf(Math.max(...a));
    const lado = segEsp('espPos'), pos = lado === 'centro' ? 'centro' : (lado === 'max') === (v[i] > 0) ? 'max' : 'min';
    const op = { tipo: 'espelhar', eixo: i, pos, unir: true }, btn = q('[data-a=esp]');
    if (btn.disabled) return;              // já está calculando (duplo clique)
    btn.disabled = true;
    res.innerHTML = '<div class="e3d-nota">Calculando…</div>';
    const ficha = est.ficha(o);
    let r;
    try { r = await est.rodar('modificar', { parte: est.parteParaMotor(p), op }, 'Espelhar'); }
    catch (e) { res.innerHTML = e && e.codigo === 'cancelado' ? '' : '<div class="e3d-nota erro">' + esc(e.message || e) + '</div>'; return; }
    finally { btn.disabled = false; }
    if (!est.resolver(ficha)) { res.innerHTML = ''; est.avisarMudou('Espelhar'); return; }
    res.innerHTML = '';
    est.mostrarPrevia({
      titulo: 'Espelhar e juntar', legenda: [], explodir: 0, textoConfirmar: 'Aplicar', ficha,
      objetos: [{ transform: o.transform, partes: o.partes.map(x => x.id === p.id ? { malha: r.parte.malha, cor: r.parte.cor || p.cor, paleta: r.parte.paleta, papel: 'normal' } : { malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal' }) }],
      confirmar: oa => {
        const forma = !!oa.forma;
        est.cena.aplicar('Espelhar ' + oa.nome, () => {
          const pa = oa.partes.find(x => x.id === p.id);
          pa.malha = r.parte.malha;
          if (r.parte.paleta !== undefined) pa.paleta = r.parte.paleta;
          // peça do Estúdio: guarda a operação pra refazer ao mudar a medida
          if (oa.forma && oa.partes.length === 1) oa.operacoes = [...(oa.operacoes || []), op];
        });
        res.innerHTML = '<div class="e3d-nota ok">Espelhado e junto: uma peça só.' + (forma ? ' Dá pra tirar depois em <b>Formas</b> → Operações.' : '') + '</div>';
      }
    });
  };
  q('[data-a=placa]').addEventListener('click', ev => {
    const b = ev.target.closest('button'), o = est.objetoAtual();
    if (!b || !o) return;
    const k = b.dataset.v === 'nova' ? est.cena.placas : +b.dataset.v;
    if (k === est.cena.placaDe(o)) return;
    est.cena.aplicar('Levar pra placa ' + (k + 1), () => { est.cena.moverParaPlaca(o, k); est.cena.placaAtiva = k; });
    est.visor.enquadrarPlaca(k);
  });
  q('[data-a=serie]').onclick = () => {
    const o = est.objetoAtual(); if (!o) { avisar('Escolha a peça.', 'warn'); return; }
    const n = Math.round(lerNumero(q('[data-a=serieN]').value, 4)), dist = lerNumero(q('[data-a=serieD]').value, 10), e = +q('[data-a=serieE]').value;
    const passo = [0, 0, 0]; passo[e] = dist;
    est.duplicarEmSerie(o, n, passo);
  };
  q('[data-a=zerar]').onclick = () => {
    const o = est.objetoAtual(); if (!o) return;
    const dc = estado(o);
    est.cena.aplicar('Redefinir rotação e escala', () => { o.transform = real(o, M4.translacao(dc.pos[0], dc.pos[1], dc.pos[2])); est.cena.colocarNaMesa(o); });
  };

  /* ---------------- deitar na face (melhor orientação pra imprimir) ---------------- */
  // gira em volta do centro pra normal 'nMundo' apontar pra baixo (-Z) e encosta na mesa
  function deitar(o, nMundo) {
    const L = Math.hypot(nMundo[0], nMundo[1], nMundo[2]) || 1;
    const n = [nMundo[0] / L, nMundo[1] / L, nMundo[2] / L];
    const alvo = [0, 0, -1];
    let eixo = [n[1] * alvo[2] - n[2] * alvo[1], n[2] * alvo[0] - n[0] * alvo[2], n[0] * alvo[1] - n[1] * alvo[0]];
    const s = Math.hypot(eixo[0], eixo[1], eixo[2]), c = n[0] * alvo[0] + n[1] * alvo[1] + n[2] * alvo[2];
    let R;
    if (s < 1e-9) R = c > 0 ? M4.identidade() : M4.rotacaoEuler(180, 0, 0);
    else {
      eixo = eixo.map(v => v / s);
      const [x, y, z] = eixo, t = 1 - c;
      R = M4.identidade();
      R[0] = t * x * x + c; R[4] = t * x * y - s * z; R[8] = t * x * z + s * y;
      R[1] = t * x * y + s * z; R[5] = t * y * y + c; R[9] = t * y * z - s * x;
      R[2] = t * x * z - s * y; R[6] = t * y * z + s * x; R[10] = t * z * z + c;
    }
    const cx = est.cena.caixaExata(o);
    const ce = [(cx.min[0] + cx.max[0]) / 2, (cx.min[1] + cx.max[1]) / 2, (cx.min[2] + cx.max[2]) / 2];
    const G = M4.multiplicar(M4.translacao(ce[0], ce[1], ce[2]), M4.multiplicar(R, M4.translacao(-ce[0], -ce[1], -ce[2])));
    est.cena.aplicar('Deitar na face', () => { o.transform = M4.multiplicar(G, o.transform); est.cena.colocarNaMesa(o); });
  }
  // normal (no mundo) da maior região plana do objeto
  function maiorFacePlana(o) {
    const grupos = new Map();
    const inv = M4.inverter(o.transform);
    for (const p of o.partes) {
      const m = p.malha, pos = m.pos, idx = m.idx;
      for (let t = 0; t < idx.length / 3; t++) {
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const L = Math.hypot(nx, ny, nz);
        if (!L) continue;
        nx /= L; ny /= L; nz /= L;
        const d = nx * pos[a] + ny * pos[a + 1] + nz * pos[a + 2];
        const ch = Math.round(nx * 200) + ',' + Math.round(ny * 200) + ',' + Math.round(nz * 200) + ',' + Math.round(d * 20);
        const g = grupos.get(ch);
        if (g) { g.area += L / 2; } else grupos.set(ch, { area: L / 2, n: [nx, ny, nz] });
      }
    }
    let melhor = null;
    for (const g of grupos.values()) if (!melhor || g.area > melhor.area) melhor = g;
    if (!melhor) return null;
    // normal do referencial da peça pro mundo: inversa transposta
    const n = melhor.n;
    return { n: [inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2], inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2], inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2]], area: melhor.area };
  }
  q('[data-a=deitar]').onclick = () => {
    const o = est.objetoAtual(); if (!o) { avisar('Escolha um objeto.', 'warn'); return; }
    const f = maiorFacePlana(o);
    if (!f || f.area < 1) { avisar('Não achei face plana nessa peça.', 'warn'); return; }
    deitar(o, f.n);
    avisar('Deitado na face plana de ' + fmt(f.area, 0) + ' mm²');
  };
  q('[data-a=deitarClique]').onclick = () => { est.definirFerramenta('deitar'); avisar('Clique na face que deve ficar na mesa.'); };
  est.on('clique', ({ hit }) => {
    if (est.ferramenta !== 'deitar') return;
    const o = est.cena.objeto(hit.objeto); if (!o) return;
    deitar(o, [hit.normal.x, hit.normal.y, hit.normal.z]);
    est.definirFerramenta('navegar');
  });

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

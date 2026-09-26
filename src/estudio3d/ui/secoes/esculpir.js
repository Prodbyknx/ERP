// Painel "Esculpir": pincel de deformação (puxar, empurrar, inflar, achatar,
// suavizar) com raio, força e SIMETRIA ao vivo; deformar a peça inteira
// (torcer, afunilar, dobrar, inflar) e suavizar de verdade. O pincel roda
// aqui na tela e só mexe no que está debaixo dele; ao soltar, o traço vira
// uma etapa do Desfazer (e é desfeito sozinho se a peça se cruzar).
import { el, fmt, lerNumero, avisar } from '../util.js';
import { criarSessao, tocar, concluir, arestaMedia } from '../../core/esculpir.js';
import * as M4 from '../../core/mat4.js';

const PINCEL = [['puxar', 'Puxar'], ['empurrar', 'Empurrar'], ['inflar', 'Inflar'], ['achatar', 'Achatar'], ['suavizar', 'Suavizar']];
const DEF = [['torcer', 'Torcer', 'graus', 45], ['afunilar', 'Afunilar', 'escala no topo (1 = igual)', 0.6], ['dobrar', 'Dobrar', 'graus', 45], ['inflar', 'Inflar', 'mm', 1]];

export function montarEsculpir(est) {
  const d = el('details', { 'data-sec': 'esc' });
  d.innerHTML = `<summary>Esculpir</summary><div class="e3d-sec">
    <div class="e3d-titulo">Pincel</div>
    <div class="seg" data-a="tipo">${PINCEL.map((p, i) => '<button type="button" data-v="' + p[0] + '"' + (i ? '' : ' class="active"') + '>' + p[1] + '</button>').join('')}</div>
    <div class="field"><label>Tamanho <span class="u">raio em mm</span></label><div class="e3d-slider"><input type="range" min="1" max="60" step="0.5" value="8" data-a="raio"><b data-a="raiov">8,0</b></div></div>
    <div class="field"><label>Força</label><div class="e3d-slider"><input type="range" min="0.05" max="1" step="0.05" value="0.4" data-a="forca"><b data-a="forcav">0,40</b></div></div>
    <div class="field"><label>Simetria <span class="u">mexe de um lado, o outro acompanha</span></label><div class="seg" data-a="sim"><button type="button" data-v="" class="active">Nenhuma</button><button type="button" data-v="x">X</button><button type="button" data-v="y">Y</button></div></div>
    <div class="e3d-nota" data-a="info">Arraste sobre a peça pra esculpir. Começando fora dela, arrastar gira a vista.</div>
    <div class="e3d-botoes"><button type="button" class="btn" data-a="refinar" title="Divide os triângulos pra o pincel ter onde mexer">Mais detalhe na malha</button></div>
    <div class="e3d-titulo" style="margin-top:16px">Deformar a peça inteira</div>
    <div class="seg" data-a="def">${DEF.map((x, i) => '<button type="button" data-v="' + x[0] + '"' + (i ? '' : ' class="active"') + '>' + x[1] + '</button>').join('')}</div>
    <div class="e3d-l2"><div><label data-a="rotDef">Valor (graus)</label><input type="text" data-a="valDef" value="45"></div>
      <div><label>Ao longo de</label><div class="seg" data-a="eixo"><button type="button" data-v="0">X</button><button type="button" data-v="1">Y</button><button type="button" data-v="2" class="active">Z</button></div></div></div>
    <div class="e3d-botoes"><button class="btn primary" data-a="aplDef">Deformar (com prévia)</button></div>
    <div class="e3d-titulo" style="margin-top:16px">Suavizar de verdade</div>
    <p class="u" style="margin:0 0 6px">Muda a malha exportada. (O botão <b>Facetado</b> lá embaixo muda só o sombreado da tela.)</p>
    <div class="field"><label>Intensidade</label><div class="e3d-slider"><input type="range" min="1" max="40" step="1" value="8" data-a="passos"><b data-a="passosv">8</b></div></div>
    <label class="fer-check"><input type="checkbox" data-a="manter" checked> Manter as medidas da peça</label>
    <div class="e3d-botoes"><button class="btn primary" data-a="aplSuave">Suavizar (com prévia)</button></div>
    <div data-a="res"></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  const segVal = (k, v) => { if (v !== undefined) q(k).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === v)); return q(k).querySelector('button.active').dataset.v; };
  ['tipo', 'sim', 'def', 'eixo'].forEach(k => q(k).addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) segVal(k, b.dataset.v); if (k === 'def' && b) { const x = DEF.find(y => y[0] === b.dataset.v); q('rotDef').textContent = 'Valor (' + x[2] + ')'; q('valDef').value = String(x[3]).replace('.', ','); } }));
  q('raio').addEventListener('input', () => { q('raiov').textContent = fmt(+q('raio').value, 1); });
  q('forca').addEventListener('input', () => { q('forcav').textContent = fmt(+q('forca').value, 2); });
  q('passos').addEventListener('input', () => { q('passosv').textContent = q('passos').value; });

  let sessao = null;   // { s, o, p, it, antes }
  // esculpida, a forma deixa de ser paramétrica (mudar a medida apagaria o traço)
  const trocar = (o, p, malha) => { p.malha = malha; if (o.forma) { o.forma = undefined; o.operacoes = undefined; } };
  const alvo = hit => { const o = est.cena.objeto(hit.objeto); const p = o && o.partes.find(x => x.id === hit.parte); return p ? { o, p } : null; };

  // atualiza na tela só os triângulos dos vértices mexidos
  function atualizarTela(ses, mexidos) {
    const g = ses.it.geom, pos = g.attributes.position.array, nor = g.attributes.normal.array, I = ses.s.idx, P = ses.s.pos, fv = ses.s.fv;
    const faces = new Set();
    for (const v of mexidos) for (let i = fv.inicio[v]; i < fv.inicio[v + 1]; i++) faces.add(fv.lista[i]);
    for (const f of faces) {
      const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      [a, b, c].forEach((v, k) => { const o = f * 9 + k * 3; pos[o] = P[v]; pos[o + 1] = P[v + 1]; pos[o + 2] = P[v + 2]; nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; });
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    est.visor.pedirRender();
  }
  function opcoes() { return { tipo: segVal('tipo'), raio: +q('raio').value, forca: +q('forca').value, simetria: segVal('sim') || null }; }

  // chamado pelo Estúdio (pointerdown/move/up com a ferramenta 'esculpir')
  function pincel(hit, ev, inicio) {
    if (inicio) {
      const a = alvo(hit);
      if (!a) return;
      const it = est.visor.itens.get(a.p.id);
      if (!it) return;
      if (arestaMedia(a.p.malha) > +q('raio').value / 2) q('info').innerHTML = '<span class="aviso">Malha grossa pra esse pincel: clique em <b>Mais detalhe na malha</b> pra o resultado sair liso.</span>';
      sessao = { s: criarSessao(a.p.malha, { raio: +q('raio').value }), o: a.o, p: a.p, it };
    }
    if (!sessao || hit.parte !== sessao.p.id) return;
    const G = M4.inverter(sessao.o.transform);
    const c = M4.aplicarPonto(G, hit.ponto.x, hit.ponto.y, hit.ponto.z);
    atualizarTela(sessao, tocar(sessao.s, c, opcoes()));
    cursorPincel(hit);
  }
  function cursorPincel(hit) {
    if (!hit) { est.visor.mostrarPincel(null); return; }
    est.visor.mostrarPincel(hit.ponto, hit.normal, +q('raio').value);
  }
  function fimPincel() {
    if (!sessao) return;
    const { s, o, p } = sessao;
    sessao = null;
    const r = concluir(s);
    if (!r.mudou) {
      est.visor.descartarItem(p.id); est.visor.sincronizar();     // volta a malha de antes na tela
      if (r.erro) q('info').innerHTML = '<span class="aviso">' + r.erro + '</span>';
      return;
    }
    est.cena.aplicar('Esculpir ' + o.nome, () => trocar(o, p, r.malha));
    q('info').textContent = 'Traço aplicado (Ctrl+Z desfaz). ' + fmt(r.malha.idx.length / 3, 0) + ' triângulos.';
  }

  async function refinar() {
    const p = est.parteAtual() || (est.objetoAtual() && est.objetoAtual().partes[0]), o = est.objetoAtual();
    if (!p) { avisar('Escolha a peça.', 'warn'); return; }
    const alvoA = Math.max(0.2, +q('raio').value / 5);
    try {
      const r = await est.rodar('refinar', { parte: est.parteParaMotor(p), aresta: alvoA }, 'Mais detalhe');
      const n = r.parte.malha.idx.length / 3;
      if (n <= p.malha.idx.length / 3) { q('info').textContent = 'A malha já tem detalhe pra esse pincel (' + fmt(n, 0) + ' triângulos).'; return; }
      est.cena.aplicar('Mais detalhe em ' + o.nome, () => trocar(o, p, r.parte.malha));
      q('info').textContent = 'Malha com ' + fmt(n, 0) + ' triângulos (aresta ~' + fmt(alvoA, 2) + ' mm).';
    } catch (e) { q('info').textContent = e.message || String(e); }
  }
  q('refinar').onclick = refinar;

  async function comPrevia(op, args, titulo) {
    const o = est.objetoAtual(), p = est.parteAtual() || (o && o.partes[0]);
    if (!p) { avisar('Escolha a peça.', 'warn'); return; }
    q('res').innerHTML = '<div class="e3d-nota">Calculando…</div>';
    let r;
    try { r = await est.rodar(op, { parte: est.parteParaMotor(p), ...args }, titulo); }
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + (e.message || e) + '</div>'; return; }
    q('res').innerHTML = '';
    est.mostrarPrevia({
      titulo, legenda: [], explodir: 0, textoConfirmar: 'Aplicar',
      objetos: [{ transform: o.transform, partes: o.partes.map(x => x.id === p.id ? { malha: r.parte.malha, cor: p.cor, paleta: p.paleta, papel: 'normal' } : { malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal' }) }],
      confirmar: () => est.cena.aplicar(titulo + ' ' + o.nome, () => trocar(o, p, r.parte.malha))
    });
  }
  q('aplDef').onclick = () => comPrevia('deformar', { opc: { tipo: segVal('def'), valor: lerNumero(q('valDef').value, 0), eixo: +segVal('eixo') } }, DEF.find(x => x[0] === segVal('def'))[1]);
  q('aplSuave').onclick = () => {
    const p = est.parteAtual(), mask = p && est.visor.selecao(p.id);
    comPrevia('suavizar', { opc: { passos: +q('passos').value, manterMedidas: q('manter').checked, mascara: mask || null } }, mask ? 'Suavizar seleção' : 'Suavizar');
  };

  d.addEventListener('toggle', () => {
    if (d.open) est.definirFerramenta('esculpir');
    else if (est.ferramenta === 'esculpir') est.definirFerramenta('navegar');
  });
  return { el: d, pincel, cursorPincel, fimPincel };
}

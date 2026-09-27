// Painel "Esculpir": pincel de deformação (puxar, empurrar, inflar, achatar,
// suavizar) com raio, força e SIMETRIA ao vivo; deformar a peça inteira
// (torcer, afunilar, dobrar, inflar) e suavizar de verdade. O pincel roda
// aqui na tela e só mexe no que está debaixo dele; ao soltar, o traço vira
// uma etapa do Desfazer (e é desfeito sozinho se a peça se cruzar).
import { el, fmt, lerNumero, avisar } from '../util.js';
import { criarSessao, tocar, concluir, arestaMedia } from '../../core/esculpir.js';
import { analisarSuavizar, raioDaIntensidade } from '../../core/suavizar.js';
import * as M4 from '../../core/mat4.js';

const PINCEL = [['puxar', 'Puxar'], ['empurrar', 'Empurrar'], ['inflar', 'Inflar'], ['achatar', 'Achatar'], ['suavizar', 'Suavizar'], ['vincar', 'Vincar']];
const DEF = [['torcer', 'Torcer', 'graus', 45], ['afunilar', 'Afunilar', 'escala no topo (1 = igual)', 0.6], ['dobrar', 'Dobrar', 'graus', 45], ['inflar', 'Inflar', 'mm', 1]];

export function montarEsculpir(est) {
  const d = el('details', { 'data-sec': 'esc' });
  d.innerHTML = `<summary>Esculpir</summary><div class="e3d-sec">
    <div class="e3d-titulo">Pincel</div>
    <div class="seg" data-a="tipo">${PINCEL.map((p, i) => '<button type="button" data-v="' + p[0] + '"' + (i ? '' : ' class="active"') + '>' + p[1] + '</button>').join('')}</div>
    <div class="field"><label>Tamanho <span class="u">raio em mm</span></label><div class="e3d-slider"><input type="range" min="1" max="60" step="0.5" value="8" data-a="raio"><b data-a="raiov">8,0</b></div></div>
    <div class="field"><label>Força</label><div class="e3d-slider"><input type="range" min="0.05" max="1" step="0.05" value="0.4" data-a="forca"><b data-a="forcav">0,40</b></div></div>
    <div class="field"><label>Simetria <span class="u">mexe de um lado, o outro acompanha</span></label><div class="seg" data-a="sim"><button type="button" data-v="" class="active">Nenhuma</button><button type="button" data-v="x">X</button><button type="button" data-v="y">Y</button></div></div>
    <label class="fer-check" title="Divide os triângulos debaixo do pincel durante o traço: dá pra esculpir detalhe até numa caixa simples"><input type="checkbox" data-a="detalhe" checked> Detalhe automático debaixo do pincel</label>
    <div class="e3d-nota" data-a="info">Arraste sobre a peça pra esculpir. Começando fora dela, arrastar gira a vista.</div>
    <div class="e3d-botoes"><button type="button" class="btn" data-a="refinar" title="Divide os triângulos pra o pincel ter onde mexer">Mais detalhe na malha</button></div>
    <div class="e3d-titulo" style="margin-top:16px">Deformar a peça inteira</div>
    <div class="seg" data-a="def">${DEF.map((x, i) => '<button type="button" data-v="' + x[0] + '"' + (i ? '' : ' class="active"') + '>' + x[1] + '</button>').join('')}</div>
    <div class="e3d-l2"><div><label data-a="rotDef">Valor (graus)</label><input type="text" data-a="valDef" value="45"></div>
      <div><label>Ao longo de</label><div class="seg" data-a="eixo"><button type="button" data-v="0">X</button><button type="button" data-v="1">Y</button><button type="button" data-v="2" class="active">Z</button></div></div></div>
    <div class="e3d-botoes"><button class="btn primary" data-a="aplDef">Deformar (com prévia)</button></div>
    <div class="e3d-titulo" style="margin-top:16px">Suavizar</div>
    <p class="u" style="margin:0 0 6px">Tira grão e caroço da superfície de verdade (vai pro arquivo) sem encolher a peça. Com faces selecionadas, só a seleção, com transição suave. (O <b>Facetado</b> lá embaixo muda só o sombreado da tela.)</p>
    <div class="seg" data-a="nivel"><button type="button" data-v="30">Leve</button><button type="button" data-v="55" class="active">Média</button><button type="button" data-v="85">Forte</button></div>
    <div class="field"><label>Intensidade <span class="u" data-a="alcance"></span></label><div class="e3d-slider"><input type="range" min="5" max="100" step="5" value="55" data-a="inten"><b data-a="intenv">55%</b></div></div>
    <label class="fer-check" title="Quina viva, olho, vinco e encaixe ficam como estão"><input type="checkbox" data-a="preservar" checked> Preservar quinas e detalhes</label>
    <label class="fer-check" data-a="blocoFacetas" style="display:none" title="Malha com poucos triângulos: mexer nos pontos não tira a faceta. Divide os triângulos numa superfície lisa (quina acima de 60° fica viva)."><input type="checkbox" data-a="facetas"> Arredondar as facetas <span class="u" data-a="facetasInfo"></span></label>
    <div class="e3d-botoes"><button class="btn primary" data-a="aplSuave">Suavizar (com prévia)</button></div>
    <div data-a="res"></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  const segVal = (k, v) => { if (v !== undefined) q(k).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === v)); return q(k).querySelector('button.active').dataset.v; };
  ['tipo', 'sim', 'def', 'eixo'].forEach(k => q(k).addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) segVal(k, b.dataset.v); if (k === 'def' && b) { const x = DEF.find(y => y[0] === b.dataset.v); q('rotDef').textContent = 'Valor (' + x[2] + ')'; q('valDef').value = String(x[3]).replace('.', ','); } }));
  q('raio').addEventListener('input', () => { q('raiov').textContent = fmt(+q('raio').value, 1); });
  q('forca').addEventListener('input', () => { q('forcav').textContent = fmt(+q('forca').value, 2); });
  // SUAVIZAR: nível -> intensidade; mostra até quantos mm o caroço some
  const cacheDiag = new WeakMap();
  const diagDe = p => { let d = cacheDiag.get(p.malha); if (!d) { d = analisarSuavizar(p.malha); cacheDiag.set(p.malha, d); } return d; };
  function renderSuave() {
    const I = +q('inten').value / 100;
    q('intenv').textContent = q('inten').value + '%';
    q('nivel').querySelectorAll('button').forEach(b => b.classList.toggle('active', +b.dataset.v === +q('inten').value));
    const p = est.parteAtual() || (est.objetoAtual() && est.objetoAtual().partes[0]);
    if (!p) { q('alcance').textContent = ''; q('blocoFacetas').style.display = 'none'; return; }
    const d = diagDe(p), r = raioDaIntensidade(I, d.tamanho);
    q('alcance').textContent = r >= d.aresta ? 'caroço de até ~' + fmt(r, r < 1 ? 2 : 1) + ' mm' : 'só o grão fino';
    q('blocoFacetas').style.display = d.facetada ? '' : 'none';
    if (d.facetada && q('blocoFacetas').dataset.p !== String(p.id)) { q('blocoFacetas').dataset.p = String(p.id); q('facetas').checked = true; }
    q('facetasInfo').textContent = d.facetada ? '(' + fmt(d.triangulos, 0) + ' triângulos: poucos pra ficar liso)' : '';
  }
  q('inten').addEventListener('input', renderSuave);
  q('nivel').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { q('inten').value = b.dataset.v; renderSuave(); } });
  est.on('selecao', () => { if (d.open) renderSuave(); });
  est.on('mudou', () => { if (d.open) renderSuave(); });

  let sessao = null;   // { s, o, p, it, antes }
  // esculpida, a forma deixa de ser paramétrica (mudar a medida apagaria o traço)
  const trocar = (o, p, malha) => { p.malha = malha; if (o.forma) { o.forma = undefined; o.operacoes = undefined; } };
  const alvo = hit => { const o = est.cena.objeto(hit.objeto); const p = o && o.partes.find(x => x.id === hit.parte); return p ? { o, p } : null; };

  // o detalhe automático criou triângulos: cresce os buffers da tela (a
  // pontaria/BVH continua valendo pros antigos e é refeita de vez em quando)
  function crescerTela(ses) {
    const g = ses.it.geom, s = ses.s, nt = s.nt;
    for (const k of ['position', 'normal', 'color']) {
      const at = g.attributes[k];
      if (at && nt * 9 > at.array.length) {
        const na = new Float32Array(Math.ceil(nt * 1.5) * 9); na.set(at.array);
        g.setAttribute(k, new at.constructor(na, 3));
      }
    }
    const col = g.attributes.color && g.attributes.color.array;
    const origem = f => { while (f >= s.nt0) f = s.pai[f - s.nt0]; return f; };
    if (col) for (let f = ses.ntTela; f < nt; f++) { const p = origem(f); for (let k = 0; k < 9; k++) col[f * 9 + k] = col[p * 9 + k]; }
    if (col) g.attributes.color.needsUpdate = true;
    const velho = g.index.array, ni = new Uint32Array(nt * 3);
    ni.set(velho.subarray(0, Math.min(velho.length, ses.ntTela * 3)));
    for (let i = ses.ntTela * 3; i < nt * 3; i++) ni[i] = i;
    g.setIndex(new g.index.constructor(ni, 1));
    ses.ntTela = nt; ses.bvhVelha = true;
  }
  // atualiza na tela só os triângulos dos vértices mexidos
  function atualizarTela(ses, mexidos) {
    if (ses.s.nt > ses.ntTela) crescerTela(ses);
    const g = ses.it.geom, pos = g.attributes.position.array, nor = g.attributes.normal.array, I = ses.s.idx, P = ses.s.pos, vf = ses.s.vf;
    const faces = new Set();
    for (const v of mexidos) for (const f of vf[v]) faces.add(f);
    for (const f of faces) {
      const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      [a, b, c].forEach((v, k) => { const o = f * 9 + k * 3; pos[o] = P[v]; pos[o + 1] = P[v + 1]; pos[o + 2] = P[v + 2]; nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; });
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    const agora = performance.now();
    if (ses.bvhVelha && !(ses.rebuild > agora - 300)) { ses.rebuild = ses.refit = agora; ses.bvhVelha = false; if (g.disposeBoundsTree) g.disposeBoundsTree(); g.computeBoundsTree(); g.computeBoundingSphere(); g.computeBoundingBox(); }
    else if (!(ses.refit > agora - 80)) { ses.refit = agora; if (g.boundsTree) g.boundsTree.refit(); g.computeBoundingSphere(); g.computeBoundingBox(); }
    est.visor.pedirRender();
  }
  // eixo do MUNDO (o que o usuário vê) -> eixo da peça, mesmo se ela foi girada
  const dirLocal = (o, k) => { const d = M4.aplicarDirecao(M4.inverter(o.transform), k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0); const a = d.map(Math.abs), i = a.indexOf(Math.max(...a)); return { i, sentido: Math.sign(d[i]) || 1 }; };
  const eixoLocal = (o, k) => dirLocal(o, k).i;
  function opcoes(o) { const sv = segVal('sim'), R = +q('raio').value; return { tipo: segVal('tipo'), raio: R, forca: +q('forca').value, simetria: sv ? eixoLocal(o, sv === 'x' ? 0 : 1) : null, detalhe: q('detalhe').checked ? Math.max(0.15, Math.min(4, R / (segVal('tipo') === 'vincar' ? 12 : 7))) : 0 }; }

  // chamado pelo Estúdio (pointerdown/move/up com a ferramenta 'esculpir')
  function pincel(hit, ev, inicio) {
    if (inicio) {
      const a = alvo(hit);
      if (!a) return;
      const it = est.visor.itens.get(a.p.id);
      if (!it) return;
      if (!q('detalhe').checked && arestaMedia(a.p.malha) > +q('raio').value / 2) q('info').innerHTML = '<span class="aviso">Malha grossa pra esse pincel: clique em <b>Mais detalhe na malha</b> pra o resultado sair liso.</span>';
      const s0 = criarSessao(a.p.malha, { raio: +q('raio').value });
      sessao = { s: s0, o: a.o, p: a.p, it, ntTela: s0.nt };
    }
    if (!sessao || hit.parte !== sessao.p.id) return;
    const G = M4.inverter(sessao.o.transform);
    const c = M4.aplicarPonto(G, hit.ponto.x, hit.ponto.y, hit.ponto.z);
    atualizarTela(sessao, tocar(sessao.s, c, opcoes(sessao.o)));
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
    q('info').textContent = 'Traço aplicado (Ctrl+Z desfaz). ' + fmt(r.malha.idx.length / 3, 0) + ' triângulos' + (r.novosTriangulos ? ' (+' + fmt(r.novosTriangulos, 0) + ' de detalhe)' : '') + '.';
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

  async function comPrevia(op, args, titulo, relatorio) {
    const o = est.objetoAtual(), p = est.parteAtual() || (o && o.partes[0]);
    if (!p) { avisar('Escolha a peça.', 'warn'); return; }
    q('res').innerHTML = '<div class="e3d-nota">Calculando…</div>';
    let r;
    try { r = await est.rodar(op, { parte: est.parteParaMotor(p), ...args }, titulo); }
    catch (e) { q('res').innerHTML = e && e.codigo === 'cancelado' ? '' : '<div class="e3d-nota erro">' + (e.message || e) + '</div>'; return; }
    q('res').innerHTML = relatorio ? '<div class="e3d-nota ok">' + relatorio(r) + '</div>' : '';
    est.mostrarPrevia({
      titulo, legenda: [], explodir: 0, textoConfirmar: 'Aplicar',
      objetos: [{ transform: o.transform, partes: o.partes.map(x => x.id === p.id ? { malha: r.parte.malha, cor: p.cor, paleta: p.paleta, papel: 'normal' } : { malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal' }) }],
      confirmar: () => est.cena.aplicar(titulo + ' ' + o.nome, () => trocar(o, p, r.parte.malha))
    });
  }
  q('aplDef').onclick = () => { const o = est.objetoAtual(); comPrevia('deformar', { opc: { tipo: segVal('def'), valor: lerNumero(q('valDef').value, 0), ...(o ? (x => ({ eixo: x.i, sentido: x.sentido }))(dirLocal(o, +segVal('eixo'))) : { eixo: +segVal('eixo') }) } }, DEF.find(x => x[0] === segVal('def'))[1]); };
  q('aplSuave').onclick = () => {
    const p = est.parteAtual(), mask = p && est.visor.selecao(p.id);
    const facetas = !mask && q('blocoFacetas').style.display !== 'none' && q('facetas').checked;
    comPrevia('suavizar', { opc: { intensidade: +q('inten').value / 100, preservar: q('preservar').checked, facetas, mascara: mask || null } }, mask ? 'Suavizar seleção' : 'Suavizar', relSuave);
  };
  const relSuave = r => {
    const i = r.info || {}, sinal = x => (x > 0 ? '+' : '') + fmt(x, 2);
    return (i.facetas ? 'Facetas arredondadas: ' + fmt(i.facetas.antes, 0) + ' → ' + fmt(i.facetas.depois, 0) + ' triângulos. ' : '') +
      'Volume ' + sinal(i.volume || 0) + '% · mexeu até ' + fmt(i.deslocamentoMax || 0, 2) + ' mm (média ' + fmt(i.deslocamentoMedio || 0, 2) + ') · ' + fmt((i.ms || 0) / 1000, 1) + ' s' +
      (i.cruzamentos && i.cruzamentos.revertidos ? '<br>' + fmt(i.cruzamentos.revertidos, 0) + ' ponto(s) em parte fina ficaram como estavam (senão a peça se cruzaria ali).' : '') +
      '<br>Confira na prévia e clique em Aplicar (Ctrl+Z desfaz).';
  };

  d.addEventListener('toggle', () => {
    if (d.open) renderSuave();
    if (d.open) est.definirFerramenta('esculpir');
    else if (est.ferramenta === 'esculpir') est.definirFerramenta('navegar');
  });
  return { el: d, pincel, cursorPincel, fimPincel };
}

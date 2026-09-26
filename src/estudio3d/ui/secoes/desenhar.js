// Painel "Desenhar": clique na mesa pra marcar os pontos (ímã de 0,5 mm),
// feche no primeiro ponto e escolha: ESPESSURA (placa, base, logo), GIRAR
// (vaso, puxador — a linha da esquerda é o eixo) ou TUBO (caminho aberto).
import { el, fmt, lerNumero, avisar } from '../util.js';
import * as M4 from '../../core/mat4.js';

const MODOS = [['extrudar', 'Espessura'], ['revolucionar', 'Girar (perfil)'], ['tubo', 'Tubo (caminho)']];

export function montarDesenhar(est) {
  const d = el('details', { 'data-sec': 'des' });
  d.innerHTML = `<summary>Desenhar</summary><div class="e3d-sec">
    <p class="u" style="margin-top:0">Clique na mesa pra marcar os pontos. Clique no primeiro ponto pra fechar. Medidas em mm (ímã de 0,5 mm).</p>
    <div class="seg" data-a="modo">${MODOS.map((m, i) => '<button type="button" data-v="' + m[0] + '"' + (i ? '' : ' class="active"') + '>' + m[1] + '</button>').join('')}</div>
    <div data-a="optE" class="e3d-l2"><div><label>Espessura (mm)</label><input type="text" data-a="esp" value="3"></div><div><label>Cantos arredondados (mm)</label><input type="text" data-a="cantos" value="0"></div></div>
    <div data-a="optR" style="display:none" class="field"><label>Ângulo do giro (graus)</label><input type="text" data-a="graus" value="360"></div>
    <div data-a="optT" style="display:none" class="field"><label>Diâmetro do tubo (mm)</label><input type="text" data-a="diam" value="4"></div>
    <div class="e3d-nota" data-a="info">Nenhum ponto ainda.</div>
    <div class="e3d-botoes"><button type="button" class="btn" data-a="desfazer">Tirar último ponto</button><button type="button" class="btn" data-a="limpar">Recomeçar</button></div>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="criar">Criar peça</button></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let modo = 'extrudar', pts = [], fechado = false;
  q('modo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    modo = b.dataset.v;
    q('modo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    q('optE').style.display = modo === 'extrudar' ? '' : 'none';
    q('optR').style.display = modo === 'revolucionar' ? '' : 'none';
    q('optT').style.display = modo === 'tubo' ? '' : 'none';
    mostrar();
  });
  const ima = v => Math.round(v * 2) / 2;
  function mostrar() {
    const l = pts.flatMap(p => [p[0], p[1], 0.05]);
    if (pts.length) est.visor.mostrarContornos(fechado || pts.length < 2 ? [l] : [[...l, ...l.slice().reverse()]], '#1f6feb', 'desenho');
    else est.visor.limparAjudas('desenho');
    let per = 0; for (let i = 1; i < pts.length; i++) per += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    q('info').innerHTML = !pts.length ? 'Nenhum ponto ainda.' : '<b>' + pts.length + '</b> ponto(s)' + (fechado ? ', contorno <b>fechado</b>' : '') + ' · ' + fmt(per, 1) + ' mm de linha' + (modo !== 'tubo' && !fechado && pts.length > 2 ? ' — clique no 1º ponto pra fechar' : '');
  }
  est.on('clique-mesa', ({ ponto }) => {
    if (!d.open || est.ferramenta !== 'desenhar' || !ponto) return;
    const p = [ima(ponto.x), ima(ponto.y)];
    if (pts.length > 2 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 1.5) { fechado = true; mostrar(); return; }
    if (fechado) { pts = []; fechado = false; }
    if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.25) pts.push(p);
    mostrar();
  });
  q('desfazer').onclick = () => { if (fechado) fechado = false; else pts.pop(); mostrar(); };
  q('limpar').onclick = () => { pts = []; fechado = false; mostrar(); };
  q('criar').onclick = async () => {
    if (modo !== 'tubo' && !fechado) { avisar('Feche o contorno (clique no primeiro ponto).', 'warn'); return; }
    const opc = { espessura: lerNumero(q('esp').value, 0), cantos: lerNumero(q('cantos').value, 0), graus: lerNumero(q('graus').value, 360), diametro: lerNumero(q('diam').value, 4), cor: est.cena.proximaCor() };
    let r;
    try { r = await est.rodar('desenho', { pts, tipo: modo, opc }, 'Criar do desenho'); }
    catch (e) { avisar(e.message || String(e), 'warn'); return; }
    const nome = modo === 'tubo' ? 'Tubo' : modo === 'revolucionar' ? 'Peça girada' : 'Peça desenhada';
    est.adicionarObjetos([{ nome, transform: M4.identidade(), partes: [{ nome, malha: r.malha, cor: opc.cor }] }], { rotulo: 'Criar ' + nome, centralizar: false, naMesa: true, enquadrar: false });
    pts = []; fechado = false; mostrar();
    avisar(nome + ' criada — ' + fmt(r.volume / 1000, 2) + ' cm³.');
  };
  d.addEventListener('toggle', () => {
    if (d.open) { est.definirFerramenta('desenhar'); mostrar(); }
    else { est.visor.limparAjudas('desenho'); if (est.ferramenta === 'desenhar') est.definirFerramenta('navegar'); }
  });
  return { el: d };
}

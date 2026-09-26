// Painel "Desenhar": clique na mesa pra marcar os pontos (ímã de 0,5 mm),
// feche no primeiro ponto e escolha: ESPESSURA (placa, base, logo), GIRAR
// (vaso, puxador — a linha da esquerda é o eixo) ou TUBO (caminho aberto ou
// em anel). Linha RETA ou CURVA SUAVE; Shift+clique = ponto de canto; dá pra
// arrastar qualquer ponto depois de marcado.
import { el, fmt, lerNumero, avisar } from '../util.js';
import * as M4 from '../../core/mat4.js';
import { curvaSuave } from '../../core/desenho.js';

const MODOS = [['extrudar', 'Espessura'], ['revolucionar', 'Girar (perfil)'], ['tubo', 'Tubo (caminho)']];

export function montarDesenhar(est) {
  const d = el('details', { 'data-sec': 'des' });
  d.innerHTML = `<summary>Desenhar</summary><div class="e3d-sec">
    <p class="u" style="margin-top:0">Clique na mesa pra marcar os pontos. Clique no primeiro ponto pra fechar. Arraste um ponto pra mudar. Medidas em mm (ímã de 0,5 mm).</p>
    <div class="seg" data-a="modo">${MODOS.map((m, i) => '<button type="button" data-v="' + m[0] + '"' + (i ? '' : ' class="active"') + '>' + m[1] + '</button>').join('')}</div>
    <div class="field" style="margin-top:8px"><label>Linha <span class="u">na curva, Shift+clique marca ponto de canto</span></label><div class="seg" data-a="linha"><button type="button" data-v="reta" class="active">Reta</button><button type="button" data-v="suave">Curva suave</button></div></div>
    <div data-a="optE" class="e3d-l2"><div><label>Espessura (mm)</label><input type="text" data-a="esp" value="3"></div><div><label>Cantos arredondados (mm)</label><input type="text" data-a="cantos" value="0"></div></div>
    <div data-a="optR" style="display:none" class="field"><label>Ângulo do giro (graus)</label><input type="text" data-a="graus" value="360"></div>
    <div data-a="optT" style="display:none" class="field"><label>Diâmetro do tubo (mm)</label><input type="text" data-a="diam" value="4"></div>
    <div class="e3d-nota" data-a="info">Nenhum ponto ainda.</div>
    <div class="e3d-botoes"><button type="button" class="btn" data-a="desfazer">Tirar último ponto</button><button type="button" class="btn" data-a="limpar">Recomeçar</button></div>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="criar">Criar peça</button></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let modo = 'extrudar', linha = 'reta', pts = [], fechado = false, segura = null;
  const seg = (k, fn) => q(k).addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    q(k).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    fn(b.dataset.v); mostrar();
  });
  seg('modo', v => {
    modo = v;
    q('optE').style.display = modo === 'extrudar' ? '' : 'none';
    q('optR').style.display = modo === 'revolucionar' ? '' : 'none';
    q('optT').style.display = modo === 'tubo' ? '' : 'none';
  });
  seg('linha', v => { linha = v; });
  const ima = v => Math.round(v * 2) / 2;
  const xy = () => pts.map(p => [p.x, p.y]);
  const cantosIdx = () => pts.map((p, i) => p.canto ? i : -1).filter(i => i >= 0);
  const suave = () => linha === 'suave' && pts.length >= 3;
  function mostrar() {
    if (!pts.length) { est.visor.limparAjudas('desenho'); q('info').innerHTML = 'Nenhum ponto ainda.'; return; }
    const cur = suave() ? curvaSuave(xy(), { fechado, cantos: cantosIdx(), passo: 0.4 }) : xy();
    const l = cur.flatMap(p => [p[0], p[1], 0.05]);
    const lacos = [fechado || cur.length < 2 ? l : [...l, ...l.slice().reverse()]];
    // marcas dos pontos: quadrado = canto, losango = suave; o 1º um pouco maior
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const s = Math.max(0.6, Math.max(x1 - x0, y1 - y0) / 70);
    pts.forEach((p, i) => {
      const k = s * (i === 0 && !fechado ? 1.6 : 1);
      lacos.push(p.canto || linha === 'reta'
        ? [p.x - k, p.y - k, 0.05, p.x + k, p.y - k, 0.05, p.x + k, p.y + k, 0.05, p.x - k, p.y + k, 0.05]
        : [p.x - k, p.y, 0.05, p.x, p.y - k, 0.05, p.x + k, p.y, 0.05, p.x, p.y + k, 0.05]);
    });
    est.visor.mostrarContornos(lacos, '#1f6feb', 'desenho');
    let per = 0; for (let i = 1; i < cur.length; i++) per += Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1]);
    q('info').innerHTML = '<b>' + pts.length + '</b> ponto(s)' + (fechado ? ', contorno <b>fechado</b>' : '') + ' · ' + fmt(per, 1) + ' mm de linha' +
      (!fechado && pts.length > 2 ? (modo === 'tubo' ? ' — clique no 1º ponto pra fazer anel' : ' — clique no 1º ponto pra fechar') : '');
  }
  const perto = (p, x, y, tol) => Math.hypot(p.x - x, p.y - y) < tol;
  est.on('clique-mesa', ({ ponto, ev }) => {
    if (!d.open || est.ferramenta !== 'desenhar' || !ponto) return;
    const x = ima(ponto.x), y = ima(ponto.y), shift = ev && ev.shiftKey;
    if (!fechado && pts.length > 2 && perto(pts[0], x, y, 1.5) && !shift) { fechado = true; mostrar(); return; }
    // Shift+clique num ponto que já existe: alterna canto/suave
    const j = pts.findIndex(p => perto(p, x, y, 1));
    if (shift && j >= 0) { pts[j].canto = !pts[j].canto; mostrar(); return; }
    if (fechado) { pts = []; fechado = false; }
    if (!pts.length || !perto(pts[pts.length - 1], x, y, 0.25)) pts.push({ x, y, canto: !!shift });
    mostrar();
  });
  // arrastar ponto (o Estúdio chama com a ferramenta 'desenhar')
  function segurar(ev) {
    if (!d.open || !pts.length) return false;
    let melhor = -1, dm = 10;
    pts.forEach((p, i) => { const s = est.visor.telaDe(p.x, p.y, 0), dd = Math.hypot(s.x - ev.clientX, s.y - ev.clientY); if (dd < dm) { dm = dd; melhor = i; } });
    if (melhor < 0) return false;
    segura = { i: melhor, x0: ev.clientX, y0: ev.clientY, moveu: false };
    return true;
  }
  function mover(ev) {
    if (!segura) return;
    if (!segura.moveu && Math.hypot(ev.clientX - segura.x0, ev.clientY - segura.y0) < 4) return;
    const p = est.visor.pontoNaMesa(ev); if (!p) return;
    segura.moveu = true;
    pts[segura.i].x = ima(p.x); pts[segura.i].y = ima(p.y);
    mostrar();
  }
  function soltar() { const m = !!(segura && segura.moveu); segura = null; return m; }

  q('desfazer').onclick = () => { if (fechado) fechado = false; else pts.pop(); mostrar(); };
  q('limpar').onclick = () => { pts = []; fechado = false; mostrar(); };
  q('criar').onclick = async () => {
    if (modo !== 'tubo' && !fechado) { avisar('Feche o contorno (clique no primeiro ponto).', 'warn'); return; }
    const opc = {
      espessura: lerNumero(q('esp').value, 0), cantos: lerNumero(q('cantos').value, 0), graus: lerNumero(q('graus').value, 360), diametro: lerNumero(q('diam').value, 4),
      cor: est.cena.proximaCor(), suave: linha === 'suave', pontosDeCanto: cantosIdx(), fechado
    };
    let r;
    try { r = await est.rodar('desenho', { pts: xy(), tipo: modo, opc }, 'Criar do desenho'); }
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
  return { el: d, segurar, mover, soltar };
}

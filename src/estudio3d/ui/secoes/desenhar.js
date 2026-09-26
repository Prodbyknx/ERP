// Painel "Desenhar": clique pra marcar os pontos (ímã de 0,5 mm), feche no
// primeiro ponto e escolha: ESPESSURA (placa, base, logo), GIRAR (vaso,
// puxador — a linha da esquerda é o eixo) ou TUBO (caminho aberto ou anel).
// ONDE: na mesa (com ALTURA por ponto: o tubo sobe e desce), em pé (frente
// ou lado, passando pelo meio da peça escolhida) ou SOBRE A PEÇA (o tubo
// corre por cima da superfície). Linha reta ou CURVA SUAVE; Shift+clique =
// ponto de canto; arraste qualquer ponto. A peça guarda o desenho: dá pra
// EDITAR os pontos depois de criada.
import { el, fmt, lerNumero, avisar } from '../util.js';
import * as M4 from '../../core/mat4.js';
import { curvaSuave } from '../../core/desenho.js';
import { transformar, juntar } from '../../core/malha.js';

const MODOS = [['extrudar', 'Espessura'], ['revolucionar', 'Girar (perfil)'], ['tubo', 'Tubo (caminho)']];
const ONDE = [['mesa', 'Na mesa'], ['frente', 'Em pé (frente)'], ['lado', 'Em pé (lado)'], ['sobre', 'Sobre a peça']];

export function montarDesenhar(est) {
  const d = el('details', { 'data-sec': 'des' });
  d.innerHTML = `<summary>Desenhar</summary><div class="e3d-sec">
    <div data-a="editarBarra" style="display:none" class="e3d-nota"><b>Esta peça foi desenhada aqui.</b> <button type="button" class="btn mini" data-a="editar">Editar o desenho</button></div>
    <p class="u" style="margin-top:0" data-a="dica">Clique pra marcar os pontos. Clique no primeiro pra fechar. Clique num ponto pra escolher; arraste pra mover. Medidas em mm (ímã de 0,5 mm).</p>
    <div class="field"><label>Onde</label><div class="seg" data-a="onde">${ONDE.map((m, i) => '<button type="button" data-v="' + m[0] + '"' + (i ? '' : ' class="active"') + '>' + m[1] + '</button>').join('')}</div></div>
    <div class="seg" data-a="modo">${MODOS.map((m, i) => '<button type="button" data-v="' + m[0] + '"' + (i ? '' : ' class="active"') + '>' + m[1] + '</button>').join('')}</div>
    <div class="field" style="margin-top:8px"><label>Linha <span class="u">na curva, Shift+clique marca ponto de canto</span></label><div class="seg" data-a="linha"><button type="button" data-v="reta" class="active">Reta</button><button type="button" data-v="suave">Curva suave</button></div></div>
    <div data-a="optAltura" class="field" style="display:none"><label>Altura do ponto escolhido (mm) <span class="u">o tubo sobe até ela</span></label>
      <div style="display:flex;gap:6px"><input type="text" data-a="altura" value="0" style="flex:1"><button type="button" class="btn mini" data-a="subir" title="+1 mm">▲</button><button type="button" class="btn mini" data-a="descer" title="−1 mm">▼</button></div></div>
    <div data-a="optE" class="e3d-l2"><div><label>Espessura (mm)</label><input type="text" data-a="esp" value="3"></div><div><label>Cantos arredondados (mm)</label><input type="text" data-a="cantos" value="0"></div></div>
    <div data-a="optR" style="display:none" class="field"><label>Ângulo do giro (graus)</label><input type="text" data-a="graus" value="360"></div>
    <div data-a="optT" style="display:none" class="field"><label>Diâmetro do tubo (mm)</label><input type="text" data-a="diam" value="4"></div>
    <div class="e3d-nota" data-a="info">Nenhum ponto ainda.</div>
    <div class="e3d-botoes"><button type="button" class="btn" data-a="desfazer">Tirar último ponto</button><button type="button" class="btn" data-a="limpar">Recomeçar</button></div>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="criar">Criar peça</button></div>
    <div class="e3d-botoes" data-a="barraEd" style="display:none"><button type="button" class="btn" data-a="cancelarEd">Cancelar edição</button></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  // pontos: { p:[x,y,z] no mundo, canto }; na mesa z = altura do ponto
  let modo = 'extrudar', linha = 'reta', onde = 'mesa', pts = [], fechado = false, segura = null, sel = -1;
  let plano = null, alvo = null, editando = null;
  const segAtivo = (k, v) => q(k).querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.v === v));
  const seg = (k, fn) => q(k).addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    segAtivo(k, b.dataset.v); fn(b.dataset.v); campos(); mostrar();
  });
  function campos() {
    if (onde === 'sobre' && modo !== 'tubo') { modo = 'tubo'; segAtivo('modo', 'tubo'); }
    q('modo').querySelectorAll('button').forEach(b => { b.disabled = onde === 'sobre' && b.dataset.v !== 'tubo'; });
    q('optE').style.display = modo === 'extrudar' ? '' : 'none';
    q('optR').style.display = modo === 'revolucionar' ? '' : 'none';
    q('optT').style.display = modo === 'tubo' ? '' : 'none';
    q('optAltura').style.display = onde === 'mesa' && modo === 'tubo' && sel >= 0 ? '' : 'none';
    if (sel >= 0 && pts[sel]) q('altura').value = fmt(pts[sel].p[2], 1);
    q('criar').textContent = editando ? 'Atualizar peça' : 'Criar peça';
    q('barraEd').style.display = editando ? '' : 'none';
    const o = est.objetoAtual();
    q('editarBarra').style.display = !editando && o && o.desenho ? '' : 'none';
  }
  seg('modo', v => { modo = v; });
  seg('linha', v => { linha = v; });
  seg('onde', v => { if (v !== onde && pts.length) { pts = []; fechado = false; sel = -1; } onde = v; plano = null; alvo = null; });

  // plano em pé: passa pelo meio da peça escolhida (ou pela origem)
  function planoAtual() {
    if (plano) return plano;
    const o = est.objetoAtual(), c = o && est.cena.caixaExata(o);
    const m = c ? [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, 0] : [0, 0, 0];
    plano = onde === 'frente' ? { o: [0, m[1], 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], d: m[1] }
      : { o: [m[0], 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], d: m[0] };
    return plano;
  }
  const ima = v => Math.round(v * 2) / 2;
  const suave = () => linha === 'suave' && pts.length >= 3;
  const cantosIdx = () => pts.map((p, i) => p.canto ? i : -1).filter(i => i >= 0);

  function mostrar() {
    if (!pts.length) { est.visor.limparAjudas('desenho'); est.visor.limparAjudas('desenho-sel'); q('info').innerHTML = 'Nenhum ponto ainda.'; return; }
    const P = pts.map(x => x.p);
    const cur = suave() ? curvaSuave(P, { fechado: fechado, cantos: cantosIdx(), passo: 0.4 }) : P;
    const l = cur.flatMap(p => [p[0], p[1], p[2] + 0.05]);
    const lacos = [fechado || cur.length < 2 ? l : [...l, ...l.slice().reverse()]];
    // marcas: quadrado = canto, losango = suave; 1º maior; na mesa, fio até a altura
    let ext = 0;
    for (const a of P) for (const b of P) ext = Math.max(ext, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const s = Math.max(0.6, ext / 70);
    const marca = (p, k, quad) => {
      const pl = onde === 'frente' || onde === 'lado' ? planoAtual() : null;
      const [ex, ey] = pl ? [pl.u, pl.v] : [[1, 0, 0], [0, 1, 0]];
      const pt = (a, b) => [p[0] + ex[0] * a + ey[0] * b, p[1] + ex[1] * a + ey[1] * b, p[2] + ex[2] * a + ey[2] * b + 0.05];
      return (quad ? [pt(-k, -k), pt(k, -k), pt(k, k), pt(-k, k)] : [pt(-k, 0), pt(0, -k), pt(k, 0), pt(0, k)]).flat();
    };
    pts.forEach((x, i) => {
      if (i === sel) return;
      lacos.push(marca(x.p, s * (i === 0 && !fechado ? 1.6 : 1), x.canto || linha === 'reta'));
      if (onde === 'mesa' && x.p[2] > 0.01) lacos.push([x.p[0], x.p[1], 0.05, x.p[0], x.p[1], x.p[2]]);
    });
    est.visor.mostrarContornos(lacos, '#1f6feb', 'desenho');
    if (sel >= 0 && pts[sel]) {
      const x = pts[sel];
      est.visor.mostrarContornos([marca(x.p, s * 1.8, true), ...(onde === 'mesa' && x.p[2] > 0.01 ? [[x.p[0], x.p[1], 0.05, x.p[0], x.p[1], x.p[2]]] : [])], '#e54c00', 'desenho-sel');
    } else est.visor.limparAjudas('desenho-sel');
    let per = 0; for (let i = 1; i < cur.length; i++) per += Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1], cur[i][2] - cur[i - 1][2]);
    q('info').innerHTML = '<b>' + pts.length + '</b> ponto(s)' + (fechado ? ', contorno <b>fechado</b>' : '') + ' · ' + fmt(per, 1) + ' mm de linha' +
      (sel >= 0 ? ' · ponto ' + (sel + 1) + ' escolhido' : '') +
      (!fechado && pts.length > 2 ? (modo === 'tubo' ? ' — clique no 1º ponto pra fazer anel' : ' — clique no 1º ponto pra fechar') : '');
  }

  // clique -> ponto no lugar certo (mesa / plano em pé / superfície da peça)
  function pontoDoClique(ev) {
    if (onde === 'sobre') {
      const hit = est.visor.intersectar(ev);
      if (!hit) return null;
      if (alvo && hit.objeto !== alvo) return null;              // fica na mesma peça
      alvo = hit.objeto;
      return [hit.ponto.x, hit.ponto.y, hit.ponto.z];
    }
    if (onde === 'frente' || onde === 'lado') {
      const pl = planoAtual(), p = est.visor.pontoNoPlano(ev, pl.n, pl.d);
      if (!p) return null;
      const w = [p.x, p.y, p.z], a = ima(w[0] * pl.u[0] + w[1] * pl.u[1] + w[2] * pl.u[2]), b = Math.max(0, ima(w[2]));
      return [pl.o[0] + pl.u[0] * a, pl.o[1] + pl.u[1] * a, b];
    }
    const p = est.visor.pontoNaMesa(ev);
    return p ? [ima(p.x), ima(p.y), sel >= 0 && pts[sel] ? pts[sel].p[2] : 0] : null;
  }
  const pertoTela = (ev, tol = 10) => {
    let melhor = -1, dm = tol;
    pts.forEach((x, i) => { const s = est.visor.telaDe(x.p[0], x.p[1], x.p[2]), dd = Math.hypot(s.x - ev.clientX, s.y - ev.clientY); if (dd < dm) { dm = dd; melhor = i; } });
    return melhor;
  };
  est.on('clique-mesa', ({ ev }) => {
    if (!d.open || est.ferramenta !== 'desenhar' || !ev) return;
    const shift = ev.shiftKey;
    const j = pertoTela(ev);
    // clique no 1º ponto fecha; em outro ponto, escolhe (Shift: alterna canto)
    if (j === 0 && !fechado && pts.length > 2 && !shift) { fechado = true; sel = -1; campos(); mostrar(); return; }
    if (j >= 0) { if (shift) pts[j].canto = !pts[j].canto; else sel = sel === j ? -1 : j; campos(); mostrar(); return; }
    const p = pontoDoClique(ev);
    if (!p) { if (onde === 'sobre') avisar(alvo ? 'Clique na mesma peça.' : 'Clique em cima de uma peça.', 'warn'); return; }
    if (fechado) { pts = []; fechado = false; }
    const ult = pts[pts.length - 1];
    if (!ult || Math.hypot(p[0] - ult.p[0], p[1] - ult.p[1], p[2] - ult.p[2]) > 0.25) { pts.push({ p, canto: !!shift }); sel = onde === 'mesa' && modo === 'tubo' ? pts.length - 1 : -1; }
    campos(); mostrar();
  });
  // arrastar ponto (o Estúdio chama com a ferramenta 'desenhar')
  function segurar(ev) {
    if (!d.open || !pts.length) return false;
    const i = pertoTela(ev);
    if (i < 0) return false;
    segura = { i, x0: ev.clientX, y0: ev.clientY, moveu: false };
    return true;
  }
  function mover(ev) {
    if (!segura) return;
    if (!segura.moveu && Math.hypot(ev.clientX - segura.x0, ev.clientY - segura.y0) < 4) return;
    const x = pts[segura.i];
    let p = null;
    if (onde === 'mesa') { const r = est.visor.pontoNoPlano(ev, [0, 0, 1], x.p[2]); if (r) p = [ima(r.x), ima(r.y), x.p[2]]; }
    else if (onde === 'sobre') { const hit = est.visor.intersectar(ev); if (hit && hit.objeto === alvo) p = [hit.ponto.x, hit.ponto.y, hit.ponto.z]; }
    else p = pontoDoClique(ev);
    if (!p) return;
    segura.moveu = true; x.p = p; sel = segura.i;
    campos(); mostrar();
  }
  function soltar() { const m = !!(segura && segura.moveu); segura = null; return m; }

  const mudarAltura = h => { if (sel < 0 || !pts[sel]) return; pts[sel].p[2] = Math.max(0, h); campos(); mostrar(); };
  q('altura').addEventListener('change', () => mudarAltura(lerNumero(q('altura').value, 0)));
  q('altura').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); mudarAltura(lerNumero(q('altura').value, 0)); } });
  q('subir').onclick = () => mudarAltura((pts[sel] ? pts[sel].p[2] : 0) + 1);
  q('descer').onclick = () => mudarAltura((pts[sel] ? pts[sel].p[2] : 0) - 1);
  q('desfazer').onclick = () => { if (fechado) fechado = false; else pts.pop(); sel = -1; campos(); mostrar(); };
  q('limpar').onclick = () => { pts = []; fechado = false; sel = -1; alvo = null; campos(); mostrar(); };

  // plano levado por uma matriz (peça <-> mundo)
  function planoEm(M, pl) {
    if (!M) return { ...pl };
    const o = M4.aplicarPonto(M, pl.o[0], pl.o[1], pl.o[2]), u = M4.aplicarDirecao(M, pl.u[0], pl.u[1], pl.u[2]), v = M4.aplicarDirecao(M, pl.v[0], pl.v[1], pl.v[2]), n = M4.aplicarDirecao(M, pl.n[0], pl.n[1], pl.n[2]);
    return { o, u, v, n, d: n[0] * o[0] + n[1] * o[1] + n[2] * o[2] };
  }
  // malha (no mundo) da peça onde o tubo corre por cima
  function malhaDoAlvo(G) {
    const o = est.cena.objeto(alvo);
    if (!o) return null;
    const T = G ? M4.multiplicar(G, o.transform) : o.transform;
    const ms = o.partes.map(p => transformar(p.malha, T));
    return ms.length === 1 ? ms[0] : juntar(ms);
  }
  // pedido pro motor, com os pontos no referencial dado (G = mundo -> peça)
  function pedido(G) {
    const L = v => G ? M4.aplicarPonto(G, v[0], v[1], v[2]) : v.slice();
    const Ld = v => G ? M4.aplicarDirecao(G, v[0], v[1], v[2]) : v.slice();
    const opc = {
      espessura: lerNumero(q('esp').value, 0), cantos: lerNumero(q('cantos').value, 0), graus: lerNumero(q('graus').value, 360), diametro: lerNumero(q('diam').value, 4),
      suave: linha === 'suave', pontosDeCanto: cantosIdx(), fechado, manterPosicao: onde !== 'mesa' || !!G
    };
    let P;
    if (onde === 'mesa') {
      // na mesa: x,y (no referencial da peça, se editando); tubo com ponto no alto vira 3D
      const alto = modo === 'tubo' && pts.some(x => x.p[2] > 0.01), r = Math.max(0.2, opc.diametro / 2);
      P = pts.map(x => { const l = L(x.p); return alto ? [l[0], l[1], l[2] + r] : [l[0], l[1]]; });
    } else {
      P = pts.map(x => L(x.p));
      if (onde !== 'sobre') { const pl = planoAtual(); opc.plano = { o: L(pl.o), u: Ld(pl.u), v: Ld(pl.v) }; }
      else { opc.sobre = malhaDoAlvo(G); if (!opc.sobre) throw new Error('A peça onde o tubo corre não está mais na cena.'); }
    }
    return { pts: P, tipo: modo, opc };
  }
  // o que fica guardado na peça pra editar depois (referencial da peça)
  const guardar = (G, malha) => ({
    onde, tipo: modo, linha, fechado, alvo, cantos: cantosIdx(),
    pts: pts.map(x => { const p = G ? M4.aplicarPonto(G, x.p[0], x.p[1], x.p[2]) : x.p.slice(); return p; }),
    plano: plano ? planoEm(G, plano) : null,
    campos: { esp: q('esp').value, cantos: q('cantos').value, graus: q('graus').value, diam: q('diam').value },
    malha
  });

  q('criar').onclick = async () => {
    if (modo !== 'tubo' && !fechado) { avisar('Feche o contorno (clique no primeiro ponto).', 'warn'); return; }
    if (pts.length < 2) { avisar('Marque pelo menos 2 pontos.', 'warn'); return; }
    const cor = editando ? null : est.cena.proximaCor();
    let r, ped;
    try {
      if (editando) {
        const o = est.cena.objeto(editando);
        if (!o) { sairEdicao(); return; }
        const G = M4.inverter(o.transform);
        ped = pedido(G);
        r = await est.rodar('desenho', ped, 'Atualizar desenho');
        est.cena.aplicar('Editar desenho de ' + o.nome, () => { o.partes[0].malha = r.malha; o.desenho = guardar(G, r.malha); });
        avisar(o.nome + ' atualizada — ' + fmt(r.volume / 1000, 2) + ' cm³ (Ctrl+Z volta).');
        sairEdicao();
        return;
      }
      ped = pedido(null);
      ped.opc.cor = cor;
      r = await est.rodar('desenho', ped, 'Criar do desenho');
    } catch (e) { avisar(e.message || String(e), 'warn'); return; }
    const nome = modo === 'tubo' ? 'Tubo' : modo === 'revolucionar' ? 'Peça girada' : 'Peça desenhada';
    const desenho = guardar(null, r.malha);
    est.adicionarObjetos([{ nome, transform: M4.identidade(), partes: [{ nome, malha: r.malha, cor }], desenho }], { rotulo: 'Criar ' + nome, centralizar: false, naMesa: onde === 'mesa', enquadrar: false });
    // a peça nova guarda o desenho (pra editar depois)
    const o = est.cena.objetos[est.cena.objetos.length - 1];
    if (o && !o.desenho) { o.desenho = desenho; o.desenho.malha = o.partes[0].malha; }
    pts = []; fechado = false; sel = -1; alvo = null; campos(); mostrar();
    avisar(nome + ' criada — ' + fmt(r.volume / 1000, 2) + ' cm³. Pra mudar depois: escolha a peça e "Editar o desenho".');
  };

  // EDITAR: carrega os pontos da peça (no mundo) e troca "Criar" por "Atualizar"
  q('editar').onclick = () => {
    const o = est.objetoAtual();
    if (!o || !o.desenho) return;
    const D = o.desenho;
    if (D.malha && o.partes[0].malha !== D.malha && !window.confirm('Esta peça foi mudada depois de desenhada (' + o.nome + '). Atualizar o desenho refaz a peça sem essas mudanças. Continuar?')) return;
    editando = o.id; onde = D.onde; modo = D.tipo; linha = D.linha; fechado = D.fechado; alvo = D.alvo; sel = -1;
    const T = o.transform;
    pts = D.pts.map((p, i) => ({ p: M4.aplicarPonto(T, p[0], p[1], p[2]), canto: D.cantos.includes(i) }));
    plano = D.plano ? planoEm(T, D.plano) : null;
    for (const [k, v] of Object.entries(D.campos || {})) if (q(k)) q(k).value = v;
    segAtivo('onde', onde); segAtivo('modo', modo); segAtivo('linha', linha);
    campos(); mostrar();
  };
  function sairEdicao() { editando = null; pts = []; fechado = false; sel = -1; alvo = null; plano = null; campos(); mostrar(); }
  q('cancelarEd').onclick = sairEdicao;
  est.cena.on('selecao', () => { if (d.open) campos(); });
  est.cena.on('mudou', () => { if (d.open && !editando) campos(); });

  d.addEventListener('toggle', () => {
    if (d.open) { est.definirFerramenta('desenhar'); campos(); mostrar(); }
    else { est.visor.limparAjudas('desenho'); est.visor.limparAjudas('desenho-sel'); if (est.ferramenta === 'desenhar') est.definirFerramenta('navegar'); }
  });
  return { el: d, segurar, mover, soltar };
}

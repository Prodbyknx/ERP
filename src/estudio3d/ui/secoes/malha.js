// Painel "Modelar ponto a ponto" (o modo de edição do Blender, feito pra quem
// nunca usou): a foto de referência fica atrás e a gente cria a peça clicando.
//   CRIAR PONTOS   clique = ponto novo, já ligado ao anterior; clicar no 1º
//                  ponto fecha o contorno e vira FACE; clicar numa BORDA e depois
//                  na foto puxa uma face nova até ali (face por face);
//                  arrastar um ponto move ele.
//   ESCOLHER       clique escolhe ponto/borda/face (Shift: vários); arrastar
//                  move; botões: fazer face, juntar, dividir, puxar face, apagar.
//   ESPELHO        faz um lado, o outro acompanha. Clicar do lado espelhado
//                  mexe no lado de verdade ("e vice-versa"); o que encosta na
//                  linha do meio gruda nela.
// A peça é gerada da malha (core/gaiola.js): espelho, suavizar e espessura.
// Antes da 1ª face é um RASCUNHO no painel (Ctrl+Z tira o último ponto); com a
// 1ª face a peça entra na cena e tudo passa pelo Desfazer normal.
import { el, esc, fmt, lerNumero, avisar } from '../util.js';
import * as G from '../../core/gaiola.js';
import * as M4 from '../../core/mat4.js';
import { novoObjeto } from '../cena.js';
import { autoInterseccoes } from '../../core/validador.js';

const COR = { inicio: [0.13, 0.62, 0.27], ponto: [0.12, 0.43, 0.92], fantasma: [0.55, 0.69, 0.93], sel: [0.9, 0.3, 0], borda: [0.12, 0.43, 0.92], bordaF: [0.6, 0.72, 0.93], bordaSel: [0.9, 0.3, 0] };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const chave = (a, b) => a < b ? a + ',' + b : b + ',' + a;
// contorno que cruza a própria linha (o "8" sem querer): a peça sai cruzada e não imprime
const cruzamentos = new WeakMap();
function cruza(g) {
  let n = cruzamentos.get(g);
  if (n === undefined) { const { malha } = G.gerarMalha(g); n = malha && malha.idx.length < 120000 ? autoInterseccoes(malha, { max: 1 }).pares : 0; cruzamentos.set(g, n); }
  return n;
}

export function montarMalha(est) {
  const d = el('details', { 'data-sec': 'malha' });
  d.innerHTML = `<summary>Modelar ponto a ponto</summary><div class="e3d-sec">
    <div data-a="inicio">
      <p class="u" style="margin-top:0">Ponha uma foto em <b>Foto</b> e crie a peça clicando por cima: cada clique é um ponto e os pontos viram faces.</p>
      <div class="field"><label>Espelho <span class="u">faça um lado, o outro aparece sozinho</span></label><div class="seg" data-a="espelho0"><button type="button" data-v="0" class="active">Esquerda ↔ Direita</button><button type="button" data-v="1">Frente ↔ Trás</button><button type="button" data-v="">Sem espelho</button></div></div>
      <div class="e3d-titulo" style="margin-top:12px">Começar com</div>
      <div class="e3d-botoes" style="margin-top:0">
        <button type="button" class="btn primary" data-a="novoPontos" title="Clique por cima da foto ligando os pontos">Pontos</button>
        <button type="button" class="btn" data-a="novoQuadrado" title="Um quadrado pronto, pra puxar as bordas">Um quadrado</button>
        <button type="button" class="btn" data-a="novoCubo" title="Um cubo pronto, pra mover os pontos e puxar as faces">Um cubo</button>
      </div>
      <div data-a="rascunhoBloco" class="e3d-nota" style="display:none;margin-top:10px">Tem um rascunho com <b data-a="rascunhoN"></b> ponto(s). <button type="button" class="btn mini" data-a="continuar">Continuar</button> <button type="button" class="btn mini" data-a="descartar">Descartar</button></div>
      <div data-a="editarBloco" class="e3d-nota" style="display:none;margin-top:10px"><b data-a="editarNome"></b> foi modelada aqui. <button type="button" class="btn mini" data-a="editar">Editar a malha</button></div>
    </div>
    <div data-a="ed" style="display:none">
      <div class="e3d-nota" data-a="passo"></div>
      <div class="seg" data-a="modo" style="margin-top:8px"><button type="button" data-v="criar" class="active">Criar pontos</button><button type="button" data-v="mexer">Escolher e mover</button></div>
      <div data-a="selBloco" style="display:none;margin-top:10px">
        <div class="u" data-a="selInfo"></div>
        <div class="e3d-botoes">
          <button type="button" class="btn" data-a="face" title="Uma face com os pontos escolhidos (tecla F)">Fazer face</button>
          <button type="button" class="btn" data-a="juntar" title="Os pontos escolhidos viram um só (tecla M)">Juntar pontos</button>
          <button type="button" class="btn" data-a="dividir" title="Ponto novo no meio da borda escolhida">Dividir borda</button>
          <button type="button" class="btn" data-a="apagar" title="Apaga o que está escolhido (Delete)">Apagar</button>
        </div>
        <div data-a="puxarBloco" class="e3d-l2" style="margin-top:6px"><div><label>Puxar a face (mm)</label><input type="text" data-a="puxarMm" value="5"></div><div style="display:flex;align-items:end"><button type="button" class="btn" data-a="puxar" title="A face escolhida sai pra fora e nascem as laterais (dá volume)">Puxar face</button></div></div>
        <div data-a="xyzBloco" style="margin-top:6px"><div class="e3d-l3"><div><label>X</label><input type="text" data-a="px"></div><div><label>Y</label><input type="text" data-a="py"></div><div><label>Z (mm)</label><input type="text" data-a="pz"></div></div></div>
      </div>
      <div class="e3d-titulo" style="margin-top:14px">A peça</div>
      <div class="e3d-l2"><div><label>Espessura (mm)</label><input type="text" data-a="esp"></div><div><label>Suavizar</label><select data-a="suave"><option value="0">Não</option><option value="1">Um pouco</option><option value="2">Bem liso</option></select></div></div>
      <p class="u" style="margin:4px 0 0">A espessura vale enquanto a malha é aberta (uma placa). Peça fechada já é sólida.</p>
      <div data-a="espelhoBloco" style="margin-top:8px;display:flex;gap:8px;align-items:center"><span class="u" data-a="espelhoInfo" style="flex:1"></span><button type="button" class="btn mini" data-a="aplicarEspelho" title="Os dois lados viram pontos de verdade (cada lado edita sozinho)">Aplicar o espelho</button></div>
      <label class="fer-check" style="margin-top:8px"><input type="checkbox" data-a="raiox" checked> Ver através da peça (raio-X)</label>
      <div class="e3d-nota" data-a="status" style="margin-top:10px"></div>
      <div class="e3d-botoes"><button type="button" class="btn primary largo" data-a="pronto">Pronto</button></div>
    </div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');

  let editId = null;          // peça em edição (null = rascunho)
  let rascunho = null, pilhaRascunho = [], rascunhoAntes = null;
  let ativo = false, modo = 'criar';
  let ponta = null, borda = null;          // { i, f } / { a, b, f }  (f = clicado do lado espelhado)
  let sel = new Set(), facesSel = new Set();
  let segura = null, espelho0 = '0', nomeSeq = 0, idCriado = null;

  const obj = () => editId ? est.cena.objeto(editId) : null;
  const gaiola = () => { const o = obj(); return o ? o.gaiola : rascunho; };
  const matriz = () => { const o = obj(); return o ? o.transform : M4.identidade(); };
  const mundo = p => M4.aplicarPonto(matriz(), p[0], p[1], p[2]);
  const local = p => M4.aplicarPonto(M4.inverter(matriz()), p[0], p[1], p[2]);

  /* ---------------- onde os pontos nascem */
  function vista() {
    const cam = est.visor.camera.position, t = est.visor.controles.target;
    const dir = [cam.x - t.x, cam.y - t.y, cam.z - t.z];
    let k = 0; for (let i = 1; i < 3; i++) if (Math.abs(dir[i]) > Math.abs(dir[k])) k = i;
    return { k, frente: [0, 1, 2].map(i => i === k ? Math.sign(dir[k]) || 1 : 0) };
  }
  // foto que está de frente pra vista (ou a escolhida), e o centro de trabalho
  function fotoDaVista(k) {
    const R = est.secoes.referencia;
    if (!R) return null;
    const tipo = k === 1 ? 'frente' : k === 0 ? 'lado' : 'mesa';
    const a = R.atual();
    return a && a.visivel && a.plano === tipo ? a : R.lista().find(r => r.visivel && r.plano === tipo) || null;
  }
  function centroTrabalho() {
    const R = est.secoes.referencia, k = vista().k;
    const r = fotoDaVista(k) || (R && (R.atual() || R.lista().find(x => x.visivel)));
    if (r) return r.plano === 'frente' ? [r.cx, r.prof, r.cy] : r.plano === 'lado' ? [r.prof, r.cx, r.cy] : [r.cx, r.cy, 0];
    const cp = est.cena.centroPlaca ? est.cena.centroPlaca() : [est.cena.mesa.x / 2, est.cena.mesa.y / 2];
    return [cp[0], cp[1], 0];
  }
  // plano de trabalho (mundo): de frente pra vista, passando pela ponta/borda, pela foto ou pelo centro
  function planoTrabalho(passaPorMundo) {
    const { k } = vista(), n = [0, 0, 0]; n[k] = 1;
    let dd;
    if (passaPorMundo) dd = passaPorMundo[k];
    else { const r = fotoDaVista(k); dd = r ? (r.plano === 'mesa' ? 0 : r.prof) : centroTrabalho()[k]; }
    return { n, d: dd, k };
  }
  function pontoDoClique(ev, passaPorMundo) {
    const pl = planoTrabalho(passaPorMundo);
    const w = est.visor.pontoNoPlano(ev, pl.n, pl.d);
    return w ? local([w.x, w.y, w.z]) : null;
  }
  // 10 px na tela em mm (pra grudar na linha do meio)
  function tolMm(pLocal) {
    const w = mundo(pLocal), { k } = vista(), e = k === 0 ? [0, 1, 0] : [1, 0, 0];
    const a = est.visor.telaDe(w[0], w[1], w[2]), b = est.visor.telaDe(w[0] + e[0], w[1] + e[1], w[2] + e[2]);
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    return px > 1e-6 ? 10 / px : 0.5;
  }

  /* ---------------- o que aparece na tela (pontos, bordas, espelho) */
  function instancias(g) {
    const out = [];
    g.v.forEach((p, i) => { out.push({ i, f: false, p }); if (g.espelho && !G.noEspelho(g, p)) out.push({ i, f: true, p: G.refletir(g, p) }); });
    return out;
  }
  function bordasInst(g) {
    const out = [];
    for (const [a, b] of G.listaBordas(g)) {
      out.push({ a, b, f: false, pa: g.v[a], pb: g.v[b] });
      if (g.espelho && !(G.noEspelho(g, g.v[a]) && G.noEspelho(g, g.v[b]))) out.push({ a, b, f: true, pa: G.refletir(g, g.v[a]), pb: G.refletir(g, g.v[b]) });
    }
    return out;
  }
  function facesInst(g) {
    const out = [];
    g.f.forEach((f, fi) => {
      out.push({ fi, f: false, pts: f.map(i => g.v[i]) });
      if (g.espelho && !f.every(i => G.noEspelho(g, g.v[i]))) out.push({ fi, f: true, pts: f.map(i => G.refletir(g, g.v[i])) });
    });
    return out;
  }
  function desenhar(gTela) {
    const g = gTela || gaiola();
    if (!ativo || !g) { est.visor.mostrarGaiola(null); return; }
    // 1º ponto da linha que está sendo desenhada (clicar nele fecha a face): verde
    let inicio = -1;
    if (ponta && modo === 'criar') {
      const viz = new Map();
      for (const [x, y] of g.a) { (viz.get(x) || viz.set(x, []).get(x)).push(y); (viz.get(y) || viz.set(y, []).get(y)).push(x); }
      let ant = -1, x = ponta.i;
      for (let k = 0; k <= g.v.length; k++) { const nb = (viz.get(x) || []).filter(y => y !== ant); if (!nb.length) break; ant = x; x = nb[0]; if (x === ponta.i) break; }
      if (x !== ponta.i && g.a.length >= 2) inicio = x;
    }
    const inst = instancias(g), pos = [], cor = [], ondeInst = new Map();
    for (const x of inst) {
      ondeInst.set(x.i + (x.f ? 'f' : ''), pos.length / 3);
      pos.push(x.p[0], x.p[1], x.p[2]);
      const s = sel.has(x.i) || (ponta && ponta.i === x.i);
      cor.push(...(s ? COR.sel : x.i === inicio ? COR.inicio : x.f ? COR.fantasma : COR.ponto));
    }
    const seg = [], corSeg = [];
    const ativa = borda ? chave(borda.a, borda.b) : null;
    for (const e of bordasInst(g)) {
      const ia = ondeInst.get(e.a + (e.f && !G.noEspelho(g, g.v[e.a]) ? 'f' : '')), ib = ondeInst.get(e.b + (e.f && !G.noEspelho(g, g.v[e.b]) ? 'f' : ''));
      if (ia === undefined || ib === undefined) continue;
      seg.push(ia, ib);
      const c = chave(e.a, e.b) === ativa || (sel.has(e.a) && sel.has(e.b)) ? COR.bordaSel : e.f ? COR.bordaF : COR.borda;
      corSeg.push(...c, ...c);
    }
    const faces = [];
    for (const fx of facesInst(g)) if (facesSel.has(fx.fi)) for (let i = 1; i + 1 < fx.pts.length; i++) faces.push(...fx.pts[0], ...fx.pts[i], ...fx.pts[i + 1]);
    let espelho = null;
    if (g.espelho) {
      // linha verde do meio: no plano do espelho, de pé na vista atual
      const { k } = vista(), e = g.espelho.eixo;
      if (k !== e) {
        const dir = [0, 0, 0]; dir[3 - k - e] = 1;
        const c = local(centroTrabalho()); c[e] = g.espelho.c;
        let L = 60; for (const p of g.v) L = Math.max(L, Math.abs(p[3 - k - e] - c[3 - k - e]) * 1.3 + 10);
        const r = est.secoes.referencia && est.secoes.referencia.atual();
        if (r) L = Math.max(L, r.largura * Math.max(1, r.aspecto) * 0.6);
        espelho = [c[0] - dir[0] * L, c[1] - dir[1] * L, c[2] - dir[2] * L, c[0] + dir[0] * L, c[1] + dir[1] * L, c[2] + dir[2] * L];
      }
    }
    est.visor.mostrarGaiola({ matriz: Array.from(matriz()), pos, corPonto: cor, seg, corSeg, faces, espelho });
  }

  /* ---------------- achar o que está debaixo do mouse */
  const tela = p => { const w = mundo(p); return est.visor.telaDe(w[0], w[1], w[2]); };
  function acharPonto(ev, g = gaiola(), tol = 12) {
    let melhor = null, dm = tol;
    for (const x of instancias(g)) { const s = tela(x.p), dd = Math.hypot(s.x - ev.clientX, s.y - ev.clientY); if (dd < dm) { dm = dd; melhor = x; } }
    return melhor;
  }
  function acharBorda(ev, g = gaiola(), tol = 7) {
    let melhor = null, dm = tol;
    for (const e of bordasInst(g)) {
      const A = tela(e.pa), B = tela(e.pb), vx = B.x - A.x, vy = B.y - A.y, L2 = vx * vx + vy * vy;
      if (L2 < 1) continue;
      const t = ((ev.clientX - A.x) * vx + (ev.clientY - A.y) * vy) / L2;
      if (t < 0.12 || t > 0.88) continue;
      const dd = Math.hypot(A.x + vx * t - ev.clientX, A.y + vy * t - ev.clientY);
      if (dd < dm) { dm = dd; melhor = e; }
    }
    return melhor;
  }
  function acharFace(ev, g = gaiola()) {
    let melhor = null, dm = Infinity;
    const cam = est.visor.camera.position;
    for (const fx of facesInst(g)) {
      const P = fx.pts.map(tela);
      let dentro = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (((P[i].y > ev.clientY) !== (P[j].y > ev.clientY)) && ev.clientX < (P[j].x - P[i].x) * (ev.clientY - P[i].y) / (P[j].y - P[i].y) + P[i].x) dentro = !dentro;
      if (!dentro) continue;
      const c = mundo(fx.pts.reduce((s, p) => [s[0] + p[0] / fx.pts.length, s[1] + p[1] / fx.pts.length, s[2] + p[2] / fx.pts.length], [0, 0, 0]));
      const dd = Math.hypot(c[0] - cam.x, c[1] - cam.y, c[2] - cam.z);
      if (dd < dm) { dm = dd; melhor = fx; }
    }
    return melhor;
  }

  /* ---------------- gravar uma mudança */
  function gravar(g2, rotulo) {
    const { malha } = G.gerarMalha(g2);
    if (editId) {
      const o = obj();
      if (!o) { parar(); return false; }
      if (!malha) { avisar('A peça precisa de pelo menos uma face. Pra começar de novo, exclua a peça.', 'warn'); return false; }
      est.cena.aplicar('Modelar: ' + rotulo, () => {
        const oa = est.cena.objeto(editId);
        oa.gaiola = { ...g2, gerada: malha };
        oa.partes = [{ ...oa.partes[0], malha }];
      });
      return true;
    }
    // rascunho: vira peça quando nasce a 1ª face
    if (!malha) { pilhaRascunho.push(rascunho); rascunho = g2; atualizar(); return true; }
    const n = ++nomeSeq + est.cena.objetos.filter(o => o.gaiola).length;
    const o = novoObjeto({ nome: 'Modelada ' + n, partes: [{ nome: 'Modelada ' + n, malha }], gaiola: { ...g2, gerada: malha } });
    rascunhoAntes = { g: rascunho, pilha: pilhaRascunho.slice() }; idCriado = o.id;
    editId = o.id; rascunho = null; pilhaRascunho = [];
    if (q('raiox').checked) est.visor.raioX = o.id;
    est.cena.aplicar('Modelar: nova peça', () => { est.cena.objetos.push(o); est.cena.sel = { objeto: o.id, parte: o.partes[0].id }; est.cena.multi = [o.id]; });
    return true;
  }
  // Ctrl+Z no rascunho tira o último ponto (antes da peça existir)
  function desfazerRascunho() {
    if (!ativo || editId || !pilhaRascunho.length) return false;
    rascunho = pilhaRascunho.pop();
    ponta = rascunho.v.length ? { i: rascunho.v.length - 1, f: ponta ? ponta.f : false } : null;
    borda = null; sel.clear(); facesSel.clear();
    atualizar();
    return true;
  }

  /* ---------------- clique */
  function clique(ev) {
    if (!ativo) return;
    const g = gaiola();
    if (!g) return;
    const shift = ev.shiftKey;
    if (modo === 'criar') {
      const hp = acharPonto(ev);
      if (hp) {
        if (ponta && ponta.i !== hp.i) {
          const r = G.ligar(g, ponta.i, hp.i);
          if (r.g !== g) gravar(r.g, r.face >= 0 ? 'fechar face' : 'ligar pontos');
          ponta = r.face >= 0 ? null : { i: hp.i, f: hp.f };
        } else ponta = ponta && ponta.i === hp.i ? null : { i: hp.i, f: hp.f };
        borda = null; atualizar(); return;
      }
      const hb = acharBorda(ev);
      if (hb) { borda = borda && chave(borda.a, borda.b) === chave(hb.a, hb.b) ? null : { a: hb.a, b: hb.b, f: hb.f }; ponta = null; atualizar(); return; }
      const base = ponta ? g.v[ponta.i] : borda ? g.v[borda.a].map((x, k) => (x + g.v[borda.b][k]) / 2) : null;
      const baseMundo = base ? mundo(ponta && ponta.f || borda && borda.f ? G.refletir(g, base) : base) : null;
      let p = pontoDoClique(ev, baseMundo);
      if (!p) return;
      const tol = tolMm(p);
      // trabalhando do lado espelhado: o ponto vai pro lado de verdade
      if ((ponta && ponta.f) || (borda && borda.f)) p = G.refletir(g, p);
      p = G.paraOLado(g, p, tol);
      if (borda) {
        const r = G.extrudarBorda(g, borda.a, borda.b, p);
        if (r.erro) { avisar(r.erro, 'warn'); return; }
        const f = borda.f;
        if (gravar(r.g, 'face nova')) borda = { a: r.borda[0], b: r.borda[1], f };
      } else {
        const r = G.addPonto(g, p, ponta ? ponta.i : -1);
        const f = ponta ? ponta.f : false;
        if (gravar(r.g, 'ponto')) ponta = { i: r.i, f };
      }
      atualizar();
      return;
    }
    // ESCOLHER
    const hp = acharPonto(ev);
    if (hp) {
      if (shift) { if (sel.has(hp.i)) sel.delete(hp.i); else sel.add(hp.i); } else { sel = new Set([hp.i]); }
      facesSel.clear(); atualizar(); return;
    }
    const hb = acharBorda(ev);
    if (hb) { if (!shift) sel.clear(); sel.add(hb.a); sel.add(hb.b); facesSel.clear(); atualizar(); return; }
    const hf = acharFace(ev);
    if (hf) {
      if (!shift) { sel.clear(); facesSel.clear(); }
      facesSel.add(hf.fi); for (const i of g.f[hf.fi]) sel.add(i);
      atualizar(); return;
    }
    if (!shift) { sel.clear(); facesSel.clear(); atualizar(); }
  }

  /* ---------------- arrastar ponto(s) */
  function segurar(ev) {
    if (!ativo) return false;
    const g = gaiola();
    if (!g) return false;
    const hp = acharPonto(ev);
    let ids = null, f = false, ref = null;
    if (hp) { ids = modo === 'mexer' && sel.has(hp.i) && sel.size > 1 ? [...sel] : [hp.i]; f = hp.f; ref = hp.p; }
    else if (modo === 'mexer' && sel.size) {
      const hf = acharFace(ev), hb = acharBorda(ev);
      if ((hf && facesSel.has(hf.fi)) || (hb && sel.has(hb.a) && sel.has(hb.b))) { ids = [...sel]; f = (hf || hb).f; ref = hf ? hf.pts[0] : hb.pa; }
    }
    if (!ids) return false;
    const refMundo = mundo(ref);
    segura = { ids, f, g0: g, refMundo, plano: planoTrabalho(refMundo), x0: ev.clientX, y0: ev.clientY, moveu: false, g: g };
    return true;
  }
  function mover(ev) {
    if (!segura) return;
    if (!segura.moveu && Math.hypot(ev.clientX - segura.x0, ev.clientY - segura.y0) < 4) return;
    const w = est.visor.pontoNoPlano(ev, segura.plano.n, segura.plano.d);
    if (!w) return;
    const g0 = segura.g0;
    const dl = sub(local([w.x, w.y, w.z]), local(segura.refMundo));
    if (segura.f && g0.espelho) dl[g0.espelho.eixo] = -dl[g0.espelho.eixo];
    let g2 = G.moverPontos(g0, segura.ids, dl).g;
    // um ponto só chegando perto da linha do meio: gruda nela
    if (g2.espelho && segura.ids.length === 1) {
      const i = segura.ids[0], p = g2.v[i], { eixo, c } = g2.espelho;
      if (!G.noEspelho(g0, g0.v[i]) && Math.abs(p[eixo] - c) < tolMm(p)) { const p2 = p.slice(); p2[eixo] = c; g2 = G.definirPonto(g2, i, p2).g; }
    }
    segura.g = g2; segura.moveu = true;
    previa(g2);
  }
  function soltar() {
    const s = segura; segura = null;
    if (!s || !s.moveu) return false;
    previa(null);
    gravar(s.g, s.ids.length > 1 ? 'mover ' + s.ids.length + ' pontos' : 'mover ponto');
    atualizar();
    return true;
  }
  // enquanto arrasta: a peça e os pontos acompanham sem entrar no Desfazer
  let rafPrevia = 0;
  function previa(g2) {
    if (!g2) { est.previaMalha = null; est.visor.sincronizar(); return; }
    desenhar(g2);
    if (!editId) return;
    cancelAnimationFrame(rafPrevia);
    rafPrevia = requestAnimationFrame(() => {
      if (!segura) return;
      const { malha } = G.gerarMalha(g2);
      if (malha) { est.previaMalha = { id: editId, malha }; est.visor.sincronizar(); }
    });
  }

  /* ---------------- botões da seleção */
  const g2Ou = (r, rotulo) => { if (r.erro) { avisar(r.erro, 'warn'); return false; } return gravar(r.g, rotulo); };
  function fazerFace() {
    const g = gaiola(); if (!g) return;
    if (g2Ou(G.fazerFace(g, [...sel]), 'fazer face')) { sel.clear(); facesSel.clear(); atualizar(); }
  }
  function juntar() {
    const g = gaiola(); if (!g) return;
    if (g2Ou(G.juntarPontos(g, [...sel]), 'juntar pontos')) { sel.clear(); facesSel.clear(); ponta = null; borda = null; atualizar(); }
  }
  function apagar() {
    const g = gaiola(); if (!g) return;
    if (facesSel.size && modo === 'mexer') { if (g2Ou(G.apagarFaces(g, [...facesSel]), 'apagar face')) { sel.clear(); facesSel.clear(); atualizar(); } return; }
    const ids = sel.size ? [...sel] : ponta ? [ponta.i] : [];
    if (!ids.length) { avisar('Escolha o que apagar (modo "Escolher e mover").', 'warn'); return; }
    if (g2Ou(G.apagarPontos(g, ids), 'apagar ponto')) { sel.clear(); facesSel.clear(); ponta = null; borda = null; atualizar(); }
  }
  function dividir() {
    const g = gaiola(); if (!g) return;
    const ids = [...sel];
    if (ids.length !== 2 || !G.listaBordas(g).some(([a, b]) => chave(a, b) === chave(ids[0], ids[1]))) { avisar('Escolha uma borda (clique nela no modo "Escolher e mover").', 'warn'); return; }
    const r = G.dividirBorda(g, ids[0], ids[1]);
    if (gravar(r.g, 'dividir borda')) { sel = new Set([r.i]); atualizar(); }
  }
  function puxar() {
    const g = gaiola(); if (!g) return;
    if (!facesSel.size) { avisar('Escolha uma face (clique dentro dela no modo "Escolher e mover").', 'warn'); return; }
    const mm = lerNumero(q('puxarMm').value, NaN);
    if (!isFinite(mm) || !mm) { avisar('Digite quantos mm puxar (negativo empurra pra dentro).', 'warn'); return; }
    // sentido: peça fechada -> pra fora; placa -> pra quem está olhando
    const fechada = !G.gerarMalha({ ...g, espessura: 0 }).info.bordasAbertas;
    let para;
    if (fechada) {
      const media = pts => pts.reduce((s2, p) => [s2[0] + p[0] / pts.length, s2[1] + p[1] / pts.length, s2[2] + p[2] / pts.length], [0, 0, 0]);
      const c = media(g.v); if (g.espelho) c[g.espelho.eixo] = g.espelho.c;
      para = sub(media([...facesSel].flatMap(fi => g.f[fi]).map(i => g.v[i])), c);
    } else { const fr = vista().frente; para = M4.aplicarDirecao(M4.inverter(matriz()), fr[0], fr[1], fr[2]); }
    const r = G.extrudarFaces(g, [...facesSel], mm, { para });
    if (r.erro) { avisar(r.erro, 'warn'); return; }
    if (gravar(r.g, 'puxar face')) {
      // continua escolhida a face puxada (dá pra puxar de novo)
      sel = new Set(r.faces.flatMap(fi => gaiola().f[fi])); facesSel = new Set(r.faces); atualizar();
    }
  }
  q('face').onclick = fazerFace; q('juntar').onclick = juntar; q('apagar').onclick = apagar; q('dividir').onclick = dividir; q('puxar').onclick = puxar;
  const campoXYZ = (k, eixo) => {
    const ap = () => {
      const g = gaiola(); if (!g || sel.size !== 1) return;
      const i = [...sel][0], v = lerNumero(q(k).value, NaN);
      if (!isFinite(v)) { atualizar(); return; }
      const w = mundo(g.v[i]); w[eixo] = v;
      if (gravar(G.definirPonto(g, i, local(w)).g, 'posição do ponto')) atualizar();
    };
    q(k).addEventListener('change', ap);
    q(k).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ap(); } });
  };
  campoXYZ('px', 0); campoXYZ('py', 1); campoXYZ('pz', 2);

  /* ---------------- a peça: espessura, suavizar, espelho */
  const ajustar = (fn, rotulo) => { const g = gaiola(); if (!g) return; const g2 = fn(g); if (editId) gravar(g2, rotulo); else { rascunho = g2; } atualizar(); };
  const lerEsp = () => { const v = lerNumero(q('esp').value, NaN); if (!isFinite(v) || v < 0 || v > 200) { atualizar(); return; } ajustar(g => ({ ...g, espessura: v }), 'espessura ' + fmt(v, 1) + ' mm'); };
  q('esp').addEventListener('change', lerEsp);
  q('esp').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); lerEsp(); } });
  q('suave').onchange = () => ajustar(g => ({ ...g, suave: Number(q('suave').value) | 0 }), 'suavizar');
  q('aplicarEspelho').onclick = () => {
    const g = gaiola(); if (!g || !g.espelho) return;
    ajustar(gg => G.aplicarEspelho(gg).g, 'aplicar espelho');
    avisar('Espelho aplicado: agora os dois lados são pontos de verdade (cada lado edita sozinho).');
  };
  q('raiox').onchange = () => { est.visor.raioX = ativo && q('raiox').checked ? editId : null; est.visor.sincronizar(); };
  q('modo').addEventListener('click', ev => { const b = ev.target.closest('button[data-v]'); if (!b) return; modo = b.dataset.v; ponta = null; borda = null; if (modo === 'criar') { sel.clear(); facesSel.clear(); } atualizar(); });
  q('espelho0').addEventListener('click', ev => { const b = ev.target.closest('button[data-v]'); if (!b) return; espelho0 = b.dataset.v; q('espelho0').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); });

  /* ---------------- começar / editar / parar */
  function novaGaiola() {
    const v = vista(), c = centroTrabalho();
    const eixo = espelho0 === '' ? null : Number(espelho0);
    return G.novaGaiola({ espessura: 3, frente: v.frente, espelho: eixo == null ? null : { eixo, c: c[eixo] } });
  }
  function olharPraFoto() {
    const R = est.secoes.referencia, r = R && (R.atual() || R.lista().find(x => x.visivel));
    if (r) { R.enquadrar(r); return; }
    est.visor.vista('frente');
    const c = centroTrabalho();
    est.visor.enquadrar({ min: [c[0] - 50, c[1] - 50, 0], max: [c[0] + 50, c[1] + 50, 100], tam: [100, 100, 100] });
  }
  function comecar(tipo) {
    if (!est.secoes.referencia || !est.secoes.referencia.lista().length) avisar('Dica: ponha uma foto em "Foto" pra modelar por cima dela.');
    olharPraFoto();
    editId = null; pilhaRascunho = []; ponta = null; borda = null; sel.clear(); facesSel.clear();
    rascunho = novaGaiola();
    ativar();
    if (tipo === 'pontos') { modo = 'criar'; atualizar(); return; }
    const { k } = vista(), c = local(centroTrabalho());
    if (rascunho.espelho) c[rascunho.espelho.eixo] = rascunho.espelho.c;
    const r = est.secoes.referencia && est.secoes.referencia.atual();
    const tam = r ? Math.max(10, Math.round(r.largura / 4)) : 20;
    const eixosTela = [0, 1, 2].filter(i => i !== k), u = [0, 0, 0], vv = [0, 0, 0];
    u[eixosTela[0]] = 1; vv[eixosTela[1]] = 1;
    if (tipo === 'quadrado' && r && r.plano !== 'mesa') c[2] = Math.max(c[2], tam / 2);
    if (tipo === 'cubo') c[2] = Math.max(c[2], tam / 2);
    const g2 = tipo === 'cubo' ? G.comecoCubo(rascunho, c, tam, u, vv).g : G.comecoQuadrado(rascunho, c, tam, u, vv).g;
    gravar(g2, tipo === 'cubo' ? 'cubo' : 'quadrado');
    modo = tipo === 'cubo' ? 'mexer' : 'criar';
    atualizar();
  }
  q('novoPontos').onclick = () => comecar('pontos');
  q('novoQuadrado').onclick = () => comecar('quadrado');
  q('novoCubo').onclick = () => comecar('cubo');
  q('continuar').onclick = () => { if (!rascunho) return; editId = null; olharPraFoto(); ativar(); };
  q('descartar').onclick = () => { rascunho = null; pilhaRascunho = []; atualizar(); };
  q('editar').onclick = () => editar(est.objetoAtual());
  q('pronto').onclick = () => { parar(); est.definirFerramenta('navegar'); };

  function editar(o) {
    if (!o || !o.gaiola) return;
    if (o.partes.length !== 1 || o.gaiola.gerada !== o.partes[0].malha) {
      if (!window.confirm('Esta peça foi mudada por outra ferramenta depois de modelada (Consertar, Esculpir, Cortar…). Editar a malha volta pro que foi modelado e essas mudanças se perdem. Continuar?')) return;
    }
    editId = o.id; rascunho = null; pilhaRascunho = [];
    ponta = null; borda = null; sel.clear(); facesSel.clear(); modo = 'mexer';
    ativar();
  }
  function ativar() {
    ativo = true;
    if (!d.open) est.abrirFerramenta('malha');
    est.definirFerramenta('malha');
    est.visor.raioX = editId && q('raiox').checked ? editId : null;
    est.visor.sincronizar();
    atualizar();
  }
  function parar() {
    if (!ativo) return;
    ativo = false; segura = null; ponta = null; borda = null; sel.clear(); facesSel.clear();
    est.previaMalha = null;
    est.visor.raioX = null;
    est.visor.mostrarGaiola(null);
    est.visor.sincronizar();
    if (editId && !obj()) editId = null;
    atualizar();
  }

  /* ---------------- painel */
  function atualizar() {
    const g = gaiola();
    q('inicio').style.display = ativo ? 'none' : '';
    q('ed').style.display = ativo ? '' : 'none';
    if (!ativo) {
      q('rascunhoBloco').style.display = rascunho && rascunho.v.length ? '' : 'none';
      if (rascunho) q('rascunhoN').textContent = String(rascunho.v.length);
      const o = est.objetoAtual();
      q('editarBloco').style.display = o && o.gaiola ? '' : 'none';
      if (o && o.gaiola) q('editarNome').textContent = o.nome;
      desenhar();
      return;
    }
    if (!g) { parar(); return; }
    // índices que não existem mais (Desfazer/Refazer)
    sel = new Set([...sel].filter(i => i < g.v.length)); facesSel = new Set([...facesSel].filter(i => i < g.f.length));
    if (ponta && ponta.i >= g.v.length) ponta = null;
    if (borda && (borda.a >= g.v.length || borda.b >= g.v.length || !G.listaBordas(g).some(([a, b]) => chave(a, b) === chave(borda.a, borda.b)))) borda = null;
    q('modo').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === modo));
    const esp = !!g.espelho;
    let passo;
    if (modo === 'criar') {
      if (!g.v.length) passo = 'Clique em cima da foto pra pôr o 1º ponto.' + (esp ? ' <b>Com o espelho:</b> comece na linha verde do meio, contorne só um lado e termine na linha verde.' : '');
      else if (ponta) passo = 'Clique pra pôr o próximo ponto (já sai ligado ao laranja). <b>Clique no 1º ponto pra fechar</b>: vira face. Esc solta a linha.';
      else if (borda) passo = '<b>Clique na foto</b>: a borda laranja vira uma face até ali. Continue clicando pra seguir a faixa. Esc solta.';
      else passo = 'Clique numa <b>borda azul</b> e depois na foto: nasce uma face até ali. Ou clique num <b>ponto</b> pra continuar a linha dele. Arraste um ponto pra mover.';
    } else passo = 'Clique num ponto, numa borda ou dentro de uma face pra escolher (Shift: vários). <b>Arraste pra mover.</b> Os botões abaixo agem no que está escolhido.';
    if (esp) passo += ' <span class="u">Do lado espelhado (azul claro) também dá: mexe nos dois.</span>';
    q('passo').innerHTML = passo;
    const nSel = sel.size;
    q('selBloco').style.display = modo === 'mexer' ? '' : 'none';
    q('selInfo').textContent = nSel ? nSel + ' ponto(s) escolhido(s)' + (facesSel.size ? ' · ' + facesSel.size + ' face(s)' : '') : 'Nada escolhido ainda.';
    q('puxarBloco').style.display = facesSel.size ? '' : 'none';
    q('xyzBloco').style.display = nSel === 1 ? '' : 'none';
    if (nSel === 1) { const w = mundo(g.v[[...sel][0]]); q('px').value = fmt(w[0], 2); q('py').value = fmt(w[1], 2); q('pz').value = fmt(w[2], 2); }
    if (document.activeElement !== q('esp')) q('esp').value = fmt(g.espessura, 1);
    q('suave').value = String(g.suave | 0);
    q('espelhoBloco').style.display = esp ? 'flex' : 'none';
    if (esp) q('espelhoInfo').textContent = 'Espelho ligado: ' + (g.espelho.eixo === 0 ? 'esquerda ↔ direita' : g.espelho.eixo === 1 ? 'frente ↔ trás' : 'cima ↔ baixo') + ' (linha verde).';
    const { info } = G.gerarMalha(g);
    let st;
    if (!info.faces) st = g.v.length ? g.v.length + ' ponto(s), nenhuma face ainda: feche um contorno (clique no 1º ponto) ou use "Fazer face".' : 'Nenhum ponto ainda.';
    else {
      st = '<b>' + g.v.length + '</b> ponto(s) · <b>' + g.f.length + '</b> face(s)' + (esp ? ' (o espelho dobra)' : '') + ' · ';
      st += info.naoManifold ? '<span style="color:var(--warn,#b45309)">uma borda tem 3 faces ou mais: apague a face sobrando</span>'
        : cruza(g) ? '<span style="color:var(--warn,#b45309)"><b>a peça se cruza</b> (linha passando por cima de outra, ou face dobrada): arraste os pontos pra desfazer o cruzamento</span>'
        : info.aberta ? 'malha aberta — dê espessura pra imprimir'
        : info.bordasAbertas ? 'placa de ' + esc(fmt(g.espessura, 1)) + ' mm, fechada: pronta pra imprimir'
        : 'sólido fechado: pronto pra imprimir';
    }
    q('status').innerHTML = st;
    desenhar();
  }

  /* ---------------- teclas (só com a ferramenta ligada) */
  function tecla(ev) {
    if (!ativo) return false;
    const k = ev.key.toLowerCase();
    if (k === 'escape') {
      if (segura) return true;
      if (ponta || borda) { ponta = null; borda = null; atualizar(); return true; }
      if (sel.size || facesSel.size) { sel.clear(); facesSel.clear(); atualizar(); return true; }
      return false;
    }
    if (k === 'delete' || k === 'backspace') { apagar(); return true; }
    if (k === 'f') { if (modo === 'mexer') fazerFace(); return true; }
    if (k === 'm') { if (modo === 'mexer') juntar(); return true; }
    if (k === 'tab') { modo = modo === 'criar' ? 'mexer' : 'criar'; ponta = null; borda = null; atualizar(); return true; }
    if (k === 'g' || k === 'r' || k === 's' || k === 'b') return true;     // não troca de ferramenta no meio da modelagem
    return false;
  }

  est.cena.on('mudou', () => {
    if (editId && !obj()) {
      // Desfazer tirou a peça (a 1ª face): volta pro rascunho de antes
      editId = null;
      if (ativo && rascunhoAntes) { rascunho = rascunhoAntes.g; pilhaRascunho = rascunhoAntes.pilha.slice(); ponta = rascunho.v.length ? { i: rascunho.v.length - 1, f: false } : null; est.visor.raioX = null; }
      else if (ativo) { parar(); return; }
    }
    // Refazer trouxe de volta a peça que nasceu do rascunho: continua editando ela
    if (!editId && ativo && idCriado && est.cena.objeto(idCriado)) {
      editId = idCriado; rascunho = null; pilhaRascunho = []; ponta = null; borda = null;
      if (q('raiox').checked) { est.visor.raioX = editId; est.visor.sincronizar(); }
    }
    if (d.open) atualizar();
  });
  est.cena.on('selecao', () => { if (d.open && !ativo) atualizar(); });
  est.on('ferramenta', f => { if (f !== 'malha' && ativo) parar(); });
  // a vista mudou (Frente/Lado/Topo): a linha do meio acompanha
  est.visor.controles.addEventListener('end', () => { if (ativo) desenhar(); });
  d.addEventListener('toggle', () => { if (d.open) atualizar(); else parar(); });

  return { el: d, clique, segurar, mover, soltar, tecla, desfazerRascunho, editar, comecar, estado: () => ({ ativo, editId, modo, ponta, borda, sel: [...sel], facesSel: [...facesSel], gaiola: gaiola() }) };
}

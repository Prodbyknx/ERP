// Painel "Desenhar" — UM lugar só pra criar peça clicando (juntou o antigo
// Desenhar, o Modelar e a Foto). Feito pra quem nunca modelou:
//   ABRIU E CLICOU, APARECE PONTO. Não tem botão de começar. O ponto cai onde
//   você está olhando: em cima da foto de referência; na mesa (olhando de
//   cima ou do 3D); ou num plano em pé de frente pra você (vista Frente/Lado).
//   Clicar no 1º ponto (verde) fecha: vira PEÇA (placa de 3 mm, pra frente).
//   Daí escolhe: Placa · Vaso (gira em volta do eixo) · Tubo (em anel).
//   Linha aberta: "Virar tubo". Clicar numa borda e depois no 3D: face nova
//   até ali (modelar face por face). Arrastar um ponto move ele (na vista de
//   lado dá fundura). "Escolher": fazer face, juntar, dividir, puxar (bloco),
//   apagar, X/Y/Z. Espelho: faz um lado, o outro aparece; mexer do lado
//   espelhado mexe nos dois; o que encosta na linha verde gruda nela.
// Contorno simples sai pelo motor de sólidos (core/desenho.js: contorno que se
// cruza vira peça inteira, cantos arredondados, curva suave, vaso, tubo);
// malha de várias faces sai daqui mesmo (core/gaiola.js). Antes de virar
// peça é um rascunho no painel (Ctrl+Z tira o último ponto).
import { el, esc, fmt, lerNumero, avisar } from '../util.js';
import * as G from '../../core/gaiola.js';
import * as M4 from '../../core/mat4.js';
import { novoObjeto } from '../cena.js';
import { autoInterseccoes, validar } from '../../core/validador.js';
import { transformar, juntar } from '../../core/malha.js';
import { montarReferencia } from './referencia.js';

const COR = { inicio: [0.13, 0.62, 0.27], ponto: [0.12, 0.43, 0.92], fantasma: [0.55, 0.69, 0.93], sel: [0.9, 0.3, 0], borda: [0.12, 0.43, 0.92], bordaF: [0.6, 0.72, 0.93], bordaSel: [0.9, 0.3, 0] };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const chave = (a, b) => a < b ? a + ',' + b : b + ',' + a;
// malha de várias faces que cruza a própria linha: avisa (o contorno simples o motor resolve sozinho)
const cruzamentos = new WeakMap();
function cruza(g) {
  let n = cruzamentos.get(g);
  if (n === undefined) { const { malha } = G.gerarMalha(g); n = malha && malha.idx.length < 120000 ? autoInterseccoes(malha, { max: 1 }).pares : 0; cruzamentos.set(g, n); }
  return n;
}
// a peça saiu boa? (contorno que cruza a própria linha vira 2 pedaços presos por um ponto)
const qualidade = new WeakMap();
function conferir(malha) {
  let q = qualidade.get(malha);
  if (!q) { const r = malha.idx.length < 300000 ? validar(malha) : null; q = { presoNumPonto: !!(r && (r.arestasNaoManifold || r.verticesNaoManifold)), pedacos: r ? r.componentes : 1, aberta: !!(r && r.arestasAbertas) }; qualidade.set(malha, q); }
  return q;
}
const PADRAO = { tipo: 'placa', espessura: 3, cantos: 0, curva: false, graus: 360, diam: 4, suave: 0 };
// o desenho já vira peça? (antes disso é rascunho no painel)
// tubo desenhado rente à mesa (mais baixo que o próprio raio): fica apoiado em cima dela
const rente = (pts, diam) => Math.min(...pts.map(p => p[2])) < (diam || 4) / 2 + 0.01;
const viraPeca = g => { const f = G.forma(g); return f === 'contorno' || f === 'malha' || (f === 'linha' && g.tipo === 'tubo'); };

export function montarDesenhar(est) {
  const d = el('details', { 'data-sec': 'des' });
  d.innerHTML = `<summary>Desenhar</summary><div class="e3d-sec">
    <div data-a="foto"></div>
    <div class="e3d-nota" data-a="passo" style="margin-top:12px"></div>
    <div class="e3d-l2" style="margin-top:8px">
      <div><label>O clique no 3D</label><div class="seg" data-a="modo"><button type="button" data-v="criar" class="active">Põe ponto</button><button type="button" data-v="mexer">Escolhe</button></div></div>
      <div><label>Espelho</label><select data-a="espelho"><option value="">Sem espelho</option><option value="sim">Esquerda ↔ direita</option></select></div>
    </div>
    <div data-a="selBloco" style="display:none;margin-top:10px">
      <div class="u" data-a="selInfo"></div>
      <div class="e3d-botoes">
        <button type="button" class="btn" data-a="face" title="Uma face com os pontos escolhidos (tecla F)">Fazer face</button>
        <button type="button" class="btn" data-a="juntar" title="Os pontos escolhidos viram um só (tecla M)">Juntar pontos</button>
        <button type="button" class="btn" data-a="dividir" title="Ponto novo no meio da borda escolhida">Dividir borda</button>
        <button type="button" class="btn" data-a="apagar" title="Apaga o que está escolhido (Delete)">Apagar</button>
      </div>
      <div data-a="puxarBloco" class="e3d-l2" style="margin-top:6px"><div><label>Puxar a face (mm)</label><input type="text" data-a="puxarMm" value="5"></div><div style="display:flex;align-items:end"><button type="button" class="btn" data-a="puxar" title="A face escolhida sai pra fora e vira bloco (dá volume)">Puxar face</button></div></div>
      <div data-a="xyzBloco" style="margin-top:6px"><div class="e3d-l3"><div><label>X</label><input type="text" data-a="px"></div><div><label>Y</label><input type="text" data-a="py"></div><div><label>Z (altura, mm)</label><input type="text" data-a="pz"></div></div></div>
    </div>
    <div data-a="linhaBloco" style="display:none;margin-top:10px">
      <div class="e3d-botoes" style="margin-top:0"><button type="button" class="btn primary" data-a="virarTubo">Virar tubo</button></div>
    </div>
    <div data-a="pecaBloco" style="display:none">
      <div class="e3d-titulo" style="margin-top:14px">A peça vira</div>
      <div class="seg" data-a="tipo"><button type="button" data-v="placa">Placa</button><button type="button" data-v="vaso">Vaso (girar)</button><button type="button" data-v="tubo">Tubo</button></div>
      <div data-a="optPlaca" class="e3d-l2" style="margin-top:8px"><div><label>Espessura (mm)</label><input type="text" data-a="esp"></div><div data-a="blocoCantos"><label>Cantos arredondados (mm)</label><input type="text" data-a="cantos"></div></div>
      <div data-a="optVaso" class="field" style="margin-top:8px"><label>Ângulo do giro (graus) <span class="u" data-a="eixoInfo"></span></label><input type="text" data-a="graus"></div>
      <div data-a="optTubo" class="field" style="margin-top:8px"><label>Diâmetro do tubo (mm)</label><input type="text" data-a="diam"></div>
      <label class="fer-check" data-a="optCurva" style="margin-top:6px"><input type="checkbox" data-a="curva"> Linha em curva suave (passa pelos pontos)</label>
      <div data-a="optArred" class="field" style="margin-top:6px"><label>Arredondar a malha</label><select data-a="arred"><option value="0">Não</option><option value="1">Um pouco</option><option value="2">Bem redondo</option></select></div>
    </div>
    <div class="e3d-nota" data-a="status" style="display:none;margin-top:10px"></div>
    <div class="e3d-botoes" style="margin-top:12px">
      <button type="button" class="btn" data-a="tirar" title="Ctrl+Z">Desfazer o último</button>
      <button type="button" class="btn" data-a="nova" title="Termina esta peça: o próximo clique começa outra">Peça nova</button>
    </div>
    <div data-a="editarBloco" class="e3d-nota" style="display:none;margin-top:10px"><b data-a="editarNome"></b> foi desenhada aqui. <button type="button" class="btn mini" data-a="editar">Editar o desenho</button></div>
    <div class="e3d-titulo" style="margin-top:14px">Mais</div>
    <label class="fer-check"><input type="checkbox" data-a="raiox" checked> Ver através da peça enquanto desenha</label>
    <label class="fer-check"><input type="checkbox" data-a="grudar"> Pontos grudam na superfície das peças (tubo por cima de uma peça)</label>
    <div class="e3d-botoes">
      <button type="button" class="btn mini" data-a="quadrado" title="Um quadrado pronto, pra puxar as bordas">Começar com um quadrado</button>
      <button type="button" class="btn mini" data-a="cubo" title="Um cubo pronto, pra mover os pontos e puxar as faces">Começar com um cubo</button>
      <button type="button" class="btn mini" data-a="aplicarEspelho" title="Os dois lados viram pontos de verdade (cada lado edita sozinho)">Aplicar o espelho</button>
    </div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  // a foto de referência mora aqui dentro (é pra desenhar por cima dela)
  const foto = montarReferencia(est);
  q('foto').appendChild(foto.el);
  est.secoes.referencia = foto;

  let alvo = null;                 // peça em edição (null: desenho novo, ainda rascunho)
  let rascunho = null, pilhaRascunho = [], rascunhoAntes = null, idCriado = null;
  let gTela = null;                // a gaiola mais nova (o que está na tela)
  let modo = 'criar', ponta = null, borda = null;           // { i, f } / { a, b, f } (f = do lado espelhado)
  let sel = new Set(), facesSel = new Set(), segura = null;
  let erroPeca = null, gravando = false, nomeSeq = 0;
  let trabalho = Promise.resolve(), pendente = null;

  const obj = () => alvo ? est.cena.objeto(alvo) : null;
  const gaiola = () => gTela;
  const matriz = () => { const o = obj(); return o ? o.transform : M4.identidade(); };
  const mundo = p => M4.aplicarPonto(matriz(), p[0], p[1], p[2]);
  const local = p => M4.aplicarPonto(M4.inverter(matriz()), p[0], p[1], p[2]);
  const ativo = () => d.open && est.ferramenta === 'desenhar';

  /* ---------------- onde o ponto cai */
  function orientacao() {
    const cam = est.visor.camera.position, t = est.visor.controles.target;
    let dir = [cam.x - t.x, cam.y - t.y, cam.z - t.z];
    const L = Math.hypot(dir[0], dir[1], dir[2]) || 1; dir = dir.map(x => x / L);
    const a = foto.atual(), fotos = [a, ...foto.lista()].filter((r, i, arr) => r && r.visivel && arr.indexOf(r) === i);
    for (const r of fotos) { const k = r.plano === 'frente' ? 1 : r.plano === 'lado' ? 0 : 2; if (Math.abs(dir[k]) > 0.64) return { k, sinal: Math.sign(dir[k]) || 1, foto: r }; }
    // câmera acima da mesa (mais de ~15°): o ponto cai na mesa; Frente/Lado (de nível): em pé
    if (dir[2] > 0.26) return { k: 2, sinal: 1, foto: null };
    const k = Math.abs(dir[0]) > Math.abs(dir[1]) ? 0 : 1;
    return { k, sinal: Math.sign(dir[k]) || 1, foto: null };
  }
  function centroTrabalho(o = orientacao()) {
    const r = o.foto;
    if (r) return r.plano === 'frente' ? [r.cx, r.prof, r.cy] : r.plano === 'lado' ? [r.prof, r.cx, r.cy] : [r.cx, r.cy, 0];
    // sem foto: o ponto pra onde a câmera está olhando (o centro da vista)
    const t = est.visor.controles.target;
    return [t.x, t.y, Math.max(0, t.z)];
  }
  function planoTrabalho(passaPorMundo) {
    const o = orientacao(), n = [0, 0, 0]; n[o.k] = 1;
    let dd;
    if (passaPorMundo) dd = passaPorMundo[o.k];
    else if (o.foto) dd = o.foto.plano === 'mesa' ? 0 : o.foto.prof;
    else if (o.k === 2) dd = 0;
    else dd = centroTrabalho(o)[o.k];
    return { n, d: dd, k: o.k };
  }
  // ponto do clique (local da peça). Com "grudar", em cima da peça que estiver ali
  function pontoDoClique(ev, passaPorMundo) {
    if (q('grudar').checked) {
      const hit = est.visor.intersectar(ev, it => it.mesh.userData.objeto !== alvo);
      if (hit) return { p: local([hit.ponto.x, hit.ponto.y, hit.ponto.z]), sobre: hit.objeto };
    }
    const pl = planoTrabalho(passaPorMundo);
    const w = est.visor.pontoNoPlano(ev, pl.n, pl.d);
    if (!w) return null;
    // de 0,1 em 0,1 mm no plano (medida limpa; e o eixo do vaso fica reto de verdade)
    const m = [w.x, w.y, w.z].map((v, i) => i === pl.k ? pl.d : Math.round(v * 10) / 10);
    return { p: local(m) };
  }
  // 10 px da tela em mm (pra grudar na linha do meio)
  function tolMm(pLocal) {
    const w = mundo(pLocal), { k } = orientacao(), e = k === 0 ? [0, 1, 0] : [1, 0, 0];
    const a = est.visor.telaDe(w[0], w[1], w[2]), b = est.visor.telaDe(w[0] + e[0], w[1] + e[1], w[2] + e[2]);
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    return px > 1e-6 ? 10 / px : 0.5;
  }
  // desenho novo: de frente pra vista; espelho no eixo "esquerda-direita" da vista, no meio da foto/placa
  function novoDesenho() {
    const o = orientacao(), c = centroTrabalho(o), frente = [0, 0, 0]; frente[o.k] = o.sinal;
    const eixo = o.k === 0 ? 1 : 0;
    return { ...G.novaGaiola({ frente, espelho: q('espelho').value ? { eixo, c: c[eixo] } : null }), ...PADRAO };
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
  function desenhar(gT) {
    const g = gT || gaiola();
    if (!ativo()) { est.visor.mostrarGaiola(null); return; }
    // antes do 1º ponto: com espelho ligado, a linha verde já aparece (é ali que começa)
    if (!g || !g.v.length) { if (q('espelho').value) desenharEspelho(g && g.espelho ? g : novoDesenho()); else est.visor.mostrarGaiola(null); return; }
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
    est.visor.mostrarGaiola({ matriz: Array.from(matriz()), pos, corPonto: cor, seg, corSeg, faces, espelho: linhaDoEspelho(g) });
  }
  // linha verde do meio: no plano do espelho, de pé na vista atual
  function linhaDoEspelho(g) {
    if (!g.espelho) return null;
    const { k } = orientacao(), e = g.espelho.eixo;
    if (k === e) return null;
    const dir = [0, 0, 0]; dir[3 - k - e] = 1;
    const c = local(centroTrabalho()); c[e] = g.espelho.c;
    let L = 60; for (const p of g.v) L = Math.max(L, Math.abs(p[3 - k - e] - c[3 - k - e]) * 1.3 + 10);
    const r = foto.atual();
    if (r) L = Math.max(L, r.largura * Math.max(1, r.aspecto) * 0.6);
    return [c[0] - dir[0] * L, c[1] - dir[1] * L, c[2] - dir[2] * L, c[0] + dir[0] * L, c[1] + dir[1] * L, c[2] + dir[2] * L];
  }
  function desenharEspelho(g) { est.visor.mostrarGaiola({ matriz: Array.from(matriz()), pos: [], corPonto: [], seg: [], corSeg: [], faces: [], espelho: linhaDoEspelho(g) }); }

  /* ---------------- achar o que está debaixo do mouse */
  const tela = p => { const w = mundo(p); return est.visor.telaDe(w[0], w[1], w[2]); };
  function acharPonto(ev, g = gaiola(), tol = 12) {
    if (!g) return null;
    let melhor = null, dm = tol;
    for (const x of instancias(g)) { const s = tela(x.p), dd = Math.hypot(s.x - ev.clientX, s.y - ev.clientY); if (dd < dm) { dm = dd; melhor = x; } }
    return melhor;
  }
  function acharBorda(ev, g = gaiola(), tol = 7) {
    if (!g) return null;
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
    if (!g) return null;
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

  /* ---------------- a peça a partir do desenho */
  async function gerarPeca(g) {
    const fm = G.forma(g);
    if (fm === 'malha') return G.gerarMalha(g).malha;
    const rodar = args => est.motor.rodar('desenho', args).then(r => r.malha);
    if (fm === 'contorno') {
      const pts = G.contornoCompleto(g);
      if (g.tipo === 'tubo') return rodar({ pts, tipo: 'tubo', opc: { fechado: true, diametro: g.diam, suave: g.curva, manterPosicao: !rente(pts, g.diam) } });
      if (g.tipo === 'vaso') {
        // eixo: a linha verde do meio (com espelho) ou a linha mais à esquerda do desenho
        let perfil = G.perfilDoVaso(g) || pts;
        if (g.espelho && perfil.some(p => p[g.espelho.eixo] < g.espelho.c - 1e-6)) perfil = perfil.map(p => G.refletir(g, p));
        const pl = G.planoDoContorno(g, perfil);
        // ponto quase no eixo (a menos de 0,05 mm): vai pro eixo exato (senão o giro faz uma lasca)
        const uDe = p => p[0] * pl.u[0] + p[1] * pl.u[1] + p[2] * pl.u[2], u0 = Math.min(...perfil.map(uDe));
        perfil = perfil.map(p => { const du = uDe(p) - u0; return du > 0 && du < 0.05 ? p.map((x, k) => x - pl.u[k] * du) : p; });
        return rodar({ pts: perfil, tipo: 'revolucionar', opc: { graus: g.graus, plano: pl, suave: g.curva, manterPosicao: true } });
      }
      return rodar({ pts, tipo: 'extrudar', opc: { espessura: g.espessura, cantos: g.cantos, suave: g.curva, plano: G.planoDoContorno(g, pts), manterPosicao: true } });
    }
    if (fm === 'linha' && g.tipo === 'tubo') {
      const L = G.linhaCompleta(g);
      let sobre = null;
      if (g.sobre) { const so = est.cena.objeto(g.sobre); if (so) sobre = transformar(so.partes[0].malha, so.transform); }
      const malhas = [];
      for (const c of L.caminhos) malhas.push(await rodar({ pts: c, tipo: 'tubo', opc: { fechado: L.fechado, diametro: g.diam, suave: g.curva, manterPosicao: !!sobre || !rente(c, g.diam), sobre } }));
      return malhas.length === 1 ? malhas[0] : juntar(malhas);
    }
    return null;
  }

  /* ---------------- gravar uma mudança (a peça é refeita; cada mudança entra no Desfazer) */
  function gravar(g2, rotulo) {
    gTela = g2;
    if (!alvo && !viraPeca(g2)) {
      // rascunho (ainda não é peça): Ctrl+Z tira o último ponto
      pilhaRascunho.push(rascunho); rascunho = g2; erroPeca = null;
      atualizar();
      return true;
    }
    pendente = { g: g2, rotulo, alvo, rascunhoAntes: alvo ? null : { g: rascunho, pilha: pilhaRascunho.slice() } };
    if (!alvo) rascunho = g2;
    trabalho = trabalho.then(processar, processar);
    atualizar();
    return true;
  }
  async function processar() {
    const p = pendente;
    if (!p) return;
    pendente = null;
    let malha;
    try { malha = await gerarPeca(p.g); }
    catch (e) {
      erroPeca = (e && e.message) || String(e);
      if (pendente === null) atualizar();
      return;
    }
    erroPeca = null;
    if (!malha) { atualizar(); return; }
    gravando = true;
    try {
      if (p.alvo) {
        if (!est.cena.objeto(p.alvo)) return;
        est.cena.aplicar('Desenhar: ' + p.rotulo, () => {
          const oa = est.cena.objeto(p.alvo);
          oa.gaiola = { ...p.g, gerada: malha };
          oa.partes = [{ ...oa.partes[0], malha }];
        });
      } else {
        const n = ++nomeSeq;
        const o = novoObjeto({ nome: 'Desenho ' + n, partes: [{ nome: 'Desenho ' + n, malha }], gaiola: { ...p.g, gerada: malha } });
        // ainda é o desenho que está na tela? então ele passa a ser esta peça
        const mesmo = !alvo && rascunho === p.g;
        if (mesmo) { alvo = o.id; idCriado = o.id; rascunhoAntes = p.rascunhoAntes; rascunho = null; pilhaRascunho = []; if (q('raiox').checked) est.visor.raioX = o.id; }
        est.cena.aplicar('Desenhar: nova peça', () => { est.cena.objetos.push(o); est.cena.sel = { objeto: o.id, parte: o.partes[0].id }; est.cena.multi = [o.id]; });
      }
    } finally { gravando = false; }
    // o que está na tela é a gaiola mais nova (pode ter mudança na fila)
    if (!pendente && alvo) { const o = obj(); if (o) gTela = o.gaiola; }
    atualizar();
  }
  // Ctrl+Z no rascunho tira o último ponto (antes de virar peça)
  function desfazerRascunho() {
    if (!ativo() || alvo || !pilhaRascunho.length) return false;
    rascunho = pilhaRascunho.pop(); gTela = rascunho;
    ponta = rascunho && rascunho.v.length ? { i: rascunho.v.length - 1, f: ponta ? ponta.f : false } : null;
    borda = null; sel.clear(); facesSel.clear();
    atualizar();
    return true;
  }
  function pecaNova() {
    alvo = null; rascunho = null; pilhaRascunho = []; gTela = null;
    ponta = null; borda = null; sel.clear(); facesSel.clear(); erroPeca = null;
    est.visor.raioX = null; est.visor.sincronizar();
    atualizar();
  }

  /* ---------------- clique */
  function clique(ev) {
    if (!ativo()) return;
    const g = gaiola(), shift = ev.shiftKey;
    if (modo === 'mexer') { escolher(ev, shift); return; }
    const hp = g && acharPonto(ev);
    if (hp) {
      if (ponta && ponta.i !== hp.i) {
        const r = G.ligar(g, ponta.i, hp.i);
        if (r.g !== g) gravar(r.g, r.face >= 0 ? 'fechar o contorno' : 'ligar pontos');
        ponta = r.face >= 0 ? null : { i: hp.i, f: hp.f };
      } else ponta = ponta && ponta.i === hp.i ? null : { i: hp.i, f: hp.f };
      borda = null; atualizar(); return;
    }
    const hb = g && acharBorda(ev);
    if (hb) { borda = borda && chave(borda.a, borda.b) === chave(hb.a, hb.b) ? null : { a: hb.a, b: hb.b, f: hb.f }; ponta = null; atualizar(); return; }
    // no vazio sem linha nem borda ativa: começa um desenho novo (a peça anterior fica pronta)
    let gg = g;
    if (!ponta && !borda && (alvo || !gg || !gg.v.length)) { if (alvo) pecaNova(); rascunho = novoDesenho(); gTela = rascunho; gg = rascunho; }
    const base = ponta ? gg.v[ponta.i] : borda ? gg.v[borda.a].map((x, k) => (x + gg.v[borda.b][k]) / 2) : null;
    const baseMundo = base ? mundo(ponta && ponta.f || borda && borda.f ? G.refletir(gg, base) : base) : null;
    const pc = pontoDoClique(ev, baseMundo);
    if (!pc) { avisar('Esse clique não caiu em lugar nenhum: gire a vista ou use Frente / Topo.', 'warn'); return; }
    let p = pc.p;
    const tol = tolMm(p);
    // trabalhando do lado espelhado: o ponto vai pro lado de verdade
    if ((ponta && ponta.f) || (borda && borda.f)) p = G.refletir(gg, p);
    p = G.paraOLado(gg, p, tol);
    if (pc.sobre && gg.sobre !== pc.sobre) gg = { ...gg, sobre: pc.sobre };
    if (borda) {
      const r = G.extrudarBorda(gg, borda.a, borda.b, p);
      if (r.erro) { avisar(r.erro, 'warn'); return; }
      const f = borda.f;
      gravar(r.g, 'face nova');
      borda = { a: r.borda[0], b: r.borda[1], f };
    } else {
      const r = G.addPonto(gg, p, ponta ? ponta.i : -1);
      const f = ponta ? ponta.f : false;
      gravar(r.g, 'ponto');
      ponta = { i: r.i, f };
    }
    atualizar();
  }
  function escolher(ev, shift) {
    const g = gaiola();
    if (!g) return;
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
    if (!ativo()) return false;
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
    segura = { ids, f, g0: g, refMundo, plano: planoTrabalho(refMundo), x0: ev.clientX, y0: ev.clientY, moveu: false, g };
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
    if (segura.ids.length === 1) {
      const i = segura.ids[0], k = segura.plano.k, p = g2.v[i];
      const q2 = p.map((x, j) => j === k || (g2.espelho && j === g2.espelho.eixo && G.noEspelho(g2, p)) ? x : Math.round(x * 10) / 10);
      if (q2.some((x, j) => x !== p[j])) g2 = G.definirPonto(g2, i, q2).g;
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
  // enquanto arrasta: os pontos acompanham; malha de várias faces acompanha também
  let rafPrevia = 0;
  function previa(g2) {
    if (!g2) { est.previaMalha = null; est.visor.sincronizar(); return; }
    desenhar(g2);
    if (!alvo || G.forma(g2) !== 'malha') return;
    cancelAnimationFrame(rafPrevia);
    rafPrevia = requestAnimationFrame(() => {
      if (!segura) return;
      const { malha } = G.gerarMalha(g2);
      if (malha) { est.previaMalha = { id: alvo, malha }; est.visor.sincronizar(); }
    });
  }

  /* ---------------- botões do "Escolhe" */
  const feito = (r, rotulo) => { if (r.erro) { avisar(r.erro, 'warn'); return false; } return gravar(r.g, rotulo); };
  function fazerFace() { const g = gaiola(); if (!g) return; if (feito(G.fazerFace(g, [...sel]), 'fazer face')) { sel.clear(); facesSel.clear(); atualizar(); } }
  function juntarPts() { const g = gaiola(); if (!g) return; if (feito(G.juntarPontos(g, [...sel]), 'juntar pontos')) { sel.clear(); facesSel.clear(); ponta = null; borda = null; atualizar(); } }
  function apagar() {
    const g = gaiola(); if (!g) return;
    if (facesSel.size && modo === 'mexer') { if (feito(G.apagarFaces(g, [...facesSel]), 'apagar face')) { sel.clear(); facesSel.clear(); atualizar(); } return; }
    const ids = sel.size ? [...sel] : ponta ? [ponta.i] : [];
    if (!ids.length) { avisar('Escolha o que apagar (modo "Escolhe").', 'warn'); return; }
    const r = G.apagarPontos(g, ids);
    if (alvo && !viraPeca(r.g)) { avisar('A peça ficaria sem forma. Pra tirar a peça toda, exclua ela na lista de Objetos.', 'warn'); return; }
    if (feito(r, 'apagar ponto')) { sel.clear(); facesSel.clear(); ponta = null; borda = null; atualizar(); }
  }
  function dividir() {
    const g = gaiola(); if (!g) return;
    const ids = [...sel];
    if (ids.length !== 2 || !G.listaBordas(g).some(([a, b]) => chave(a, b) === chave(ids[0], ids[1]))) { avisar('Escolha uma borda (clique nela no modo "Escolhe").', 'warn'); return; }
    const r = G.dividirBorda(g, ids[0], ids[1]);
    if (gravar(r.g, 'dividir borda')) { sel = new Set([r.i]); atualizar(); }
  }
  function puxar() {
    const g = gaiola(); if (!g) return;
    if (!facesSel.size) { avisar('Escolha uma face (clique dentro dela no modo "Escolhe").', 'warn'); return; }
    const mm = lerNumero(q('puxarMm').value, NaN);
    if (!isFinite(mm) || !mm) { avisar('Digite quantos mm puxar (negativo empurra pra dentro).', 'warn'); return; }
    // sentido: peça fechada -> pra fora; placa -> pra quem está olhando
    const fechada = !G.gerarMalha({ ...g, espessura: 0 }).info.bordasAbertas;
    let para;
    if (fechada) {
      const media = pts => pts.reduce((s2, p) => [s2[0] + p[0] / pts.length, s2[1] + p[1] / pts.length, s2[2] + p[2] / pts.length], [0, 0, 0]);
      const c = media(g.v); if (g.espelho) c[g.espelho.eixo] = g.espelho.c;
      para = sub(media([...facesSel].flatMap(fi => g.f[fi]).map(i => g.v[i])), c);
    } else { const o = orientacao(), fr = [0, 0, 0]; fr[o.k] = o.sinal; para = M4.aplicarDirecao(M4.inverter(matriz()), fr[0], fr[1], fr[2]); }
    const r = G.extrudarFaces(g, [...facesSel], mm, { para });
    if (r.erro) { avisar(r.erro, 'warn'); return; }
    if (gravar(r.g, 'puxar face')) { sel = new Set(r.faces.flatMap(fi => gaiola().f[fi])); facesSel = new Set(r.faces); atualizar(); }
  }
  q('face').onclick = fazerFace; q('juntar').onclick = juntarPts; q('apagar').onclick = apagar; q('dividir').onclick = dividir; q('puxar').onclick = puxar;
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

  /* ---------------- o que a peça vira */
  const ajustar = (mud, rotulo) => { const g = gaiola(); if (!g) return; gravar({ ...g, ...mud }, rotulo); };
  q('tipo').addEventListener('click', ev => { const b = ev.target.closest('button[data-v]'); if (!b) return; ajustar({ tipo: b.dataset.v }, b.textContent.toLowerCase()); });
  q('virarTubo').onclick = () => ajustar({ tipo: 'tubo' }, 'tubo');
  const campoPeca = (k, campo, min, max, rotulo) => {
    const ap = () => { const v = lerNumero(q(k).value, NaN); if (!isFinite(v) || v < min || v > max) { atualizar(); return; } const g = gaiola(); if (g && g[campo] !== v) ajustar({ [campo]: v }, rotulo + ' ' + fmt(v, 1)); };
    q(k).addEventListener('change', ap);
    q(k).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ap(); } });
  };
  campoPeca('esp', 'espessura', 0.2, 200, 'espessura');
  campoPeca('cantos', 'cantos', 0, 100, 'cantos');
  campoPeca('graus', 'graus', 1, 360, 'giro');
  campoPeca('diam', 'diam', 0.4, 100, 'diâmetro');
  q('curva').onchange = () => ajustar({ curva: q('curva').checked }, 'curva suave');
  q('arred').onchange = () => ajustar({ suave: Number(q('arred').value) | 0 }, 'arredondar');
  q('aplicarEspelho').onclick = () => {
    const g = gaiola();
    if (!g || !g.espelho) { avisar('Esta peça não tem espelho.', 'warn'); return; }
    gravar(G.aplicarEspelho(g).g, 'aplicar espelho');
    avisar('Espelho aplicado: agora os dois lados são pontos de verdade (cada lado edita sozinho).');
  };
  q('espelho').onchange = () => {
    // vale pro desenho que ainda não começou; peça com pontos fica como está
    const g = gaiola();
    if (!alvo && (!g || !g.v.length)) { rascunho = novoDesenho(); gTela = rascunho; }
    else if (g && g.v.length) avisar(q('espelho').value ? 'O espelho vale pra próxima peça (clique em "Peça nova").' : 'Pra tirar o espelho desta peça, use "Aplicar o espelho".');
    atualizar();
  };
  q('raiox').onchange = () => { est.visor.raioX = ativo() && q('raiox').checked ? alvo : null; est.visor.sincronizar(); };
  q('modo').addEventListener('click', ev => { const b = ev.target.closest('button[data-v]'); if (!b) return; modo = b.dataset.v; ponta = null; borda = null; if (modo === 'criar') { sel.clear(); facesSel.clear(); } atualizar(); });
  q('tirar').onclick = () => est.desfazer();
  q('nova').onclick = () => { pecaNova(); avisar('Pronto: o próximo clique começa outra peça.'); };
  q('editar').onclick = () => editar(est.objetoAtual());

  /* ---------------- começar com um quadrado / cubo */
  function comecarCom(tipo) {
    pecaNova();
    rascunho = novoDesenho(); gTela = rascunho;
    const o = orientacao(), c = local(centroTrabalho(o));
    if (rascunho.espelho) c[rascunho.espelho.eixo] = rascunho.espelho.c;
    const r = foto.atual();
    const tam = r ? Math.max(10, Math.round(r.largura / 4)) : 20;
    const eixosTela = [0, 1, 2].filter(i => i !== o.k), u = [0, 0, 0], v = [0, 0, 0];
    u[eixosTela[0]] = 1; v[eixosTela[1]] = 1;
    if (o.k !== 2) c[2] = Math.max(c[2], tam / 2);
    if (tipo === 'cubo') c[2] = Math.max(c[2], tam / 2);
    const g2 = tipo === 'cubo' ? G.comecoCubo(rascunho, c, tam, u, v).g : G.comecoQuadrado(rascunho, c, tam, u, v).g;
    gravar(g2, tipo === 'cubo' ? 'cubo' : 'quadrado');
    modo = tipo === 'cubo' ? 'mexer' : 'criar';
    atualizar();
  }
  q('quadrado').onclick = () => comecarCom('quadrado');
  q('cubo').onclick = () => comecarCom('cubo');

  function editar(o) {
    if (!o || !o.gaiola) return;
    if (o.partes.length !== 1 || o.gaiola.gerada !== o.partes[0].malha) {
      if (!window.confirm('Esta peça foi mudada por outra ferramenta depois de desenhada (Consertar, Esculpir, Cortar…). Editar o desenho volta pro que foi desenhado e essas mudanças se perdem. Continuar?')) return;
    }
    alvo = o.id; rascunho = null; pilhaRascunho = []; gTela = { ...PADRAO, ...o.gaiola };
    ponta = null; borda = null; sel.clear(); facesSel.clear(); modo = 'mexer'; erroPeca = null;
    if (q('raiox').checked) { est.visor.raioX = o.id; est.visor.sincronizar(); }
    atualizar();
  }

  /* ---------------- painel */
  function atualizar() {
    const g = gaiola(), fm = g ? G.forma(g) : 'vazio';
    if (g) { sel = new Set([...sel].filter(i => i < g.v.length)); facesSel = new Set([...facesSel].filter(i => i < g.f.length)); }
    if (ponta && (!g || ponta.i >= g.v.length)) ponta = null;
    if (borda && (!g || borda.a >= g.v.length || borda.b >= g.v.length || !G.listaBordas(g).some(([a, b]) => chave(a, b) === chave(borda.a, borda.b)))) borda = null;
    q('modo').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === modo));
    const esp = !!(g && g.espelho), temFoto = foto.lista().some(r => r.visivel);
    let passo;
    if (modo === 'mexer') passo = 'Clique num ponto, numa borda ou dentro de uma face pra escolher (Shift: vários). <b>Arraste pra mover.</b> Os botões abaixo agem no que está escolhido.';
    else if (!g || !g.v.length) passo = '<b>Clique no 3D pra pôr o 1º ponto.</b> ' + (temFoto ? 'O ponto cai em cima da foto.' : 'No 3D e de cima o ponto cai na mesa; na vista Frente ou Lado ele fica em pé.') + (esp ? ' <b>Com o espelho:</b> comece na linha verde do meio, desenhe só um lado e termine na linha verde.' : '');
    else if (ponta) passo = 'Clique pra pôr o próximo ponto (sai ligado ao laranja). <b>Clique no 1º ponto (verde) pra fechar</b>: vira peça. Esc solta a linha.';
    else if (borda) passo = '<b>Clique no 3D</b>: a borda laranja vira uma face até ali. Continue clicando pra seguir. Esc solta.';
    else if (alvo) passo = '<b>Pronto, virou peça.</b> Escolha abaixo o que ela vira. Arraste um ponto pra ajustar; clique numa borda azul e depois no 3D pra aumentar com uma face nova. <b>Clique no vazio pra começar outra peça.</b>';
    else passo = 'Clique num ponto pra continuar a linha dele, ou no vazio pra começar outra.';
    if (esp && (g.v.length || alvo)) passo += ' <span class="u">Do lado espelhado (azul claro) também dá: mexe nos dois.</span>';
    q('passo').innerHTML = passo;
    // escolher
    const nSel = sel.size;
    q('selBloco').style.display = modo === 'mexer' ? '' : 'none';
    q('selInfo').textContent = nSel ? nSel + ' ponto(s) escolhido(s)' + (facesSel.size ? ' · ' + facesSel.size + ' face(s)' : '') : 'Nada escolhido ainda.';
    q('puxarBloco').style.display = facesSel.size ? '' : 'none';
    q('xyzBloco').style.display = nSel === 1 && g ? '' : 'none';
    if (nSel === 1 && g) { const w = mundo(g.v[[...sel][0]]); q('px').value = fmt(w[0], 2); q('py').value = fmt(w[1], 2); q('pz').value = fmt(w[2], 2); }
    // a peça
    q('linhaBloco').style.display = !alvo && fm === 'linha' && g.tipo !== 'tubo' ? '' : 'none';
    const mostraPeca = g && (fm === 'contorno' || fm === 'malha' || (fm === 'linha' && g.tipo === 'tubo'));
    q('pecaBloco').style.display = mostraPeca ? '' : 'none';
    if (mostraPeca) {
      const tipo = fm === 'malha' ? 'placa' : fm === 'linha' ? 'tubo' : g.tipo;
      q('tipo').style.display = fm === 'contorno' ? '' : 'none';
      q('tipo').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === tipo));
      q('optPlaca').style.display = tipo === 'placa' ? '' : 'none';
      q('blocoCantos').style.display = fm === 'contorno' ? '' : 'none';
      q('optVaso').style.display = tipo === 'vaso' ? '' : 'none';
      q('eixoInfo').textContent = esp ? '(gira em volta da linha verde)' : '(gira em volta da linha mais à esquerda)';
      q('optTubo').style.display = tipo === 'tubo' ? '' : 'none';
      q('optCurva').style.display = fm === 'malha' ? 'none' : '';
      q('optArred').style.display = fm === 'malha' ? '' : 'none';
      const ativoEl = document.activeElement;
      if (ativoEl !== q('esp')) q('esp').value = fmt(g.espessura, 1);
      if (ativoEl !== q('cantos')) q('cantos').value = fmt(g.cantos || 0, 1);
      if (ativoEl !== q('graus')) q('graus').value = fmt(g.graus || 360, 0);
      if (ativoEl !== q('diam')) q('diam').value = fmt(g.diam || 4, 1);
      q('curva').checked = !!g.curva;
      q('arred').value = String(g.suave | 0);
    }
    // situação
    let st = '';
    if (erroPeca) st = '<span style="color:var(--warn,#b45309)">Não consegui fazer a peça: ' + esc(erroPeca) + '</span>';
    else if (fm === 'malha') {
      const { info } = G.gerarMalha(g);
      st = '<b>' + g.v.length + '</b> ponto(s) · <b>' + g.f.length + '</b> face(s)' + (esp ? ' (o espelho dobra)' : '') + ' · ';
      st += info.naoManifold ? '<span style="color:var(--warn,#b45309)">uma borda tem 3 faces ou mais: apague a face sobrando</span>'
        : cruza(g) ? '<span style="color:var(--warn,#b45309)"><b>a peça se cruza</b> (linha passando por cima de outra, ou face dobrada): arraste os pontos pra desfazer o cruzamento</span>'
        : info.aberta ? 'malha aberta — dê espessura pra imprimir'
        : info.bordasAbertas ? 'placa de ' + esc(fmt(g.espessura, 1)) + ' mm, fechada: pronta pra imprimir'
        : 'sólido fechado: pronto pra imprimir';
    } else if (alvo && (fm === 'contorno' || fm === 'linha')) {
      const o = obj(), q = o && o.partes[0] && conferir(o.partes[0].malha);
      // um contorno só tem que dar UM pedaço; mais que isso é a linha cruzando ela mesma
      st = q && (q.presoNumPonto || (fm === 'contorno' && q.pedacos > 1)) ? '<span style="color:var(--warn,#b45309)"><b>O contorno cruza a própria linha</b>: a peça fica presa só por um ponto e quebra fácil. Arraste os pontos (no "Escolhe") pra desfazer o cruzamento.</span>'
        : q && q.aberta ? '<span style="color:var(--warn,#b45309)">A peça saiu aberta: abra o Consertar.</span>' : 'Sólido fechado: pronto pra imprimir.';
    }
    q('status').innerHTML = st;
    q('status').style.display = st ? '' : 'none';
    const o = est.objetoAtual();
    q('editarBloco').style.display = o && o.gaiola && o.id !== alvo ? '' : 'none';
    if (o && o.gaiola) q('editarNome').textContent = o.nome;
    if (!(g && g.v.length) && !alvo) q('espelho').disabled = false;
    desenhar();
  }

  /* ---------------- teclas (com o Desenhar aberto) */
  function tecla(ev) {
    if (!ativo()) return false;
    const k = ev.key.toLowerCase();
    if (k === 'escape') {
      if (segura) return true;
      if (ponta || borda) { ponta = null; borda = null; atualizar(); return true; }
      if (sel.size || facesSel.size) { sel.clear(); facesSel.clear(); atualizar(); return true; }
      return false;
    }
    if (k === 'delete' || k === 'backspace') { apagar(); return true; }
    if (k === 'f') { if (modo === 'mexer') fazerFace(); return true; }
    if (k === 'm') { if (modo === 'mexer') juntarPts(); return true; }
    if (k === 'tab') { modo = modo === 'criar' ? 'mexer' : 'criar'; ponta = null; borda = null; atualizar(); return true; }
    if (k === 'g' || k === 'r' || k === 's' || k === 'b') return true;     // não troca de ferramenta no meio do desenho
    return false;
  }

  est.cena.on('mudou', () => {
    if (gravando) return;
    // Desfazer/Refazer (ou outra ferramenta): a tela volta pro que está na cena
    if (alvo && !obj()) {
      alvo = null;
      if (rascunhoAntes) { rascunho = rascunhoAntes.g; pilhaRascunho = rascunhoAntes.pilha.slice(); gTela = rascunho; ponta = rascunho && rascunho.v.length ? { i: rascunho.v.length - 1, f: false } : null; }
      else { rascunho = null; gTela = null; }
      est.visor.raioX = null;
    } else if (!alvo && idCriado && est.cena.objeto(idCriado) && rascunho === (rascunhoAntes && rascunhoAntes.g)) {
      // Refazer trouxe de volta a peça que nasceu deste desenho
      alvo = idCriado; rascunho = null; pilhaRascunho = []; ponta = null; borda = null;
      if (q('raiox').checked && ativo()) { est.visor.raioX = alvo; est.visor.sincronizar(); }
    }
    if (alvo) { const o = obj(); if (o && o.gaiola) gTela = { ...PADRAO, ...o.gaiola }; }
    if (d.open) atualizar();
  });
  est.cena.on('selecao', () => { if (d.open) atualizar(); });
  // a vista mudou (Frente/Lado/Topo): a linha do meio acompanha
  est.visor.controles.addEventListener('end', () => { if (ativo()) desenhar(); });
  d.addEventListener('toggle', () => {
    if (d.open) {
      est.definirFerramenta('desenhar');
      if (alvo && !obj()) alvo = null;
      if (!gTela) { gTela = rascunho; }
      if (alvo && q('raiox').checked) { est.visor.raioX = alvo; est.visor.sincronizar(); }
      foto.render();
      atualizar();
    } else {
      segura = null; ponta = null; borda = null; sel.clear(); facesSel.clear();
      est.previaMalha = null; est.visor.raioX = null;
      est.visor.mostrarGaiola(null); est.visor.sincronizar();
      foto.parar();
      if (est.ferramenta === 'desenhar') est.definirFerramenta('navegar');
    }
  });

  return {
    el: d, clique, segurar, mover, soltar, tecla, desfazerRascunho, editar, pecaNova,
    estado: () => ({ ativo: ativo(), alvo, modo, ponta, borda, sel: [...sel], facesSel: [...facesSel], gaiola: gaiola(), forma: gaiola() ? G.forma(gaiola()) : 'vazio', erro: erroPeca }),
    ocioso: () => trabalho.then(() => trabalho)
  };
}

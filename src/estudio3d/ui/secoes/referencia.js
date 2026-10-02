// Painel "Foto de referência" (como a imagem de referência do Blender): a foto
// fica num plano da cena — em pé de frente, em pé de lado ou deitada na mesa —
// com opacidade, tamanho em mm (medindo na própria foto) e posição. A gente
// modela por cima dela. A foto NÃO entra no 3MF/STL, na miniatura nem no
// Desfazer: é só guia.
import { el, esc, fmt, lerNumero, avisar } from '../util.js';
import { icone } from '../icones.js';

// eixos de cada plano: u = direita na foto, v = pra cima na foto, n = de onde se olha
//   frente: vista de frente (câmera em −Y) · lado: vista de lado (câmera em +X)
export const PLANOS_REF = {
  frente: { nome: 'De frente', u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  lado: { nome: 'De lado', u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  mesa: { nome: 'Deitada na mesa', u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }
};
export const Z_MESA_REF = 0.03;          // um fio acima da grade da mesa
const MAX_FOTOS = 6, MAX_LADO = 2048;
const EXT_IMG = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const ehImagem = f => !!f && ((f.type && /^image\//.test(f.type) && !/svg/.test(f.type)) || EXT_IMG.test(f.name || ''));

// centro da foto no mundo (cx, cy = coordenadas NO plano; prof = onde o plano está)
export function centroRef(r) {
  return r.plano === 'mesa' ? [r.cx, r.cy, Z_MESA_REF] : r.plano === 'frente' ? [r.cx, r.prof, r.cy] : [r.prof, r.cx, r.cy];
}
// plano n·p = d onde a foto está
export function planoRef(r) {
  const P = PLANOS_REF[r.plano];
  return { n: P.n, d: r.plano === 'mesa' ? Z_MESA_REF : r.prof, u: P.u, v: P.v };
}
// ponto do mundo -> coordenadas no plano (a, b) e posição relativa na foto (-0,5..0,5)
export function noPlanoRef(r, p) {
  const P = PLANOS_REF[r.plano];
  const a = p[0] * P.u[0] + p[1] * P.u[1] + p[2] * P.u[2], b = p[0] * P.v[0] + p[1] * P.v[1] + p[2] * P.v[2];
  const g = -r.giro * Math.PI / 180, dx = a - r.cx, dy = b - r.cy;
  const lx = (dx * Math.cos(g) - dy * Math.sin(g)) / r.largura, ly = (dx * Math.sin(g) + dy * Math.cos(g)) / (r.largura * r.aspecto);
  return { a, b, lx: r.espelhar ? -lx : lx, ly, dentro: Math.abs(lx) <= 0.5 && Math.abs(ly) <= 0.5 };
}
// os 4 cantos no mundo (pra enquadrar)
export function cantosRef(r) {
  const P = PLANOS_REF[r.plano], c = centroRef(r), g = r.giro * Math.PI / 180, w = r.largura / 2, h = r.largura * r.aspecto / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => {
    const a = x * Math.cos(g) - y * Math.sin(g), b = x * Math.sin(g) + y * Math.cos(g);
    return [0, 1, 2].map(k => c[k] + P.u[k] * a + P.v[k] * b);
  });
}

// arquivo -> canvas (no máximo 2048 px no lado maior; a orientação da câmera do celular vale)
async function carregarImagem(arq) {
  let fonte = null, w = 0, h = 0;
  try {
    if (typeof createImageBitmap === 'function') { fonte = await createImageBitmap(arq); w = fonte.width; h = fonte.height; }
  } catch (e) { fonte = null; }
  if (!fonte) {
    const url = URL.createObjectURL(arq);
    try {
      const img = new Image();
      await new Promise((ok, falha) => { img.onload = ok; img.onerror = () => falha(new Error('imagem')); img.src = url; });
      fonte = img; w = img.naturalWidth; h = img.naturalHeight;
    } catch (e) {
      throw new Error('Não consegui abrir essa imagem' + (/\.hei[cf]$/i.test(arq.name || '') ? ' (foto HEIC do iPhone: mande como JPG)' : '') + '. Use PNG, JPG ou WebP.');
    } finally { URL.revokeObjectURL(url); }
  }
  if (!w || !h) throw new Error('A imagem está vazia.');
  const k = Math.min(1, MAX_LADO / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  cv.getContext('2d').drawImage(fonte, 0, 0, cv.width, cv.height);
  if (fonte.close) fonte.close();
  return cv;
}

export function montarReferencia(est) {
  const d = el('details', { 'data-sec': 'ref' });
  d.innerHTML = `<summary>Foto de referência</summary><div class="e3d-sec">
    <div class="e3d-botoes" style="margin-top:0"><button type="button" class="btn primary largo" data-a="add">Adicionar foto</button></div>
    <p class="u" style="margin:6px 0 0">Ou arraste a imagem pro 3D, ou cole com Ctrl+V. A foto é só guia: não vai pro arquivo exportado.</p>
    <div data-a="lista" style="margin-top:10px"></div>
    <div data-a="ed" style="display:none">
      <div class="field"><label>Onde a foto fica</label><div class="seg" data-a="plano">${Object.entries(PLANOS_REF).map(([k, P]) => '<button type="button" data-v="' + k + '">' + esc(P.nome) + '</button>').join('')}</div></div>
      <div class="field"><label>Opacidade <span class="u">mais clara = dá pra ver a peça por cima</span></label><div class="e3d-slider"><input type="range" min="5" max="100" step="1" value="50" data-a="opac"><b data-a="opacv">50%</b></div></div>
      <div class="e3d-titulo">Tamanho</div>
      <div class="e3d-l2"><div><label>Largura (mm)</label><input type="text" data-a="larg"></div><div><label>Altura (mm)</label><input type="text" data-a="alt"></div></div>
      <div class="e3d-botoes"><button type="button" class="btn" data-a="medir" title="Clique em 2 pontos da foto e diga quanto mede de verdade">Medir na foto</button></div>
      <div data-a="medPainel" class="e3d-nota" style="display:none">
        <div data-a="medDica">Clique no 1º ponto de uma medida que você conhece (ex.: a largura da peça).</div>
        <div data-a="medCampos" style="display:none;margin-top:8px">
          <div class="e3d-l2"><div><label>Na foto agora (mm)</label><input type="text" data-a="medHoje" disabled></div><div><label>Medida real (mm)</label><input type="text" data-a="medReal"></div></div>
        </div>
        <div class="e3d-botoes"><button type="button" class="btn primary" data-a="medAplicar" style="display:none">Aplicar a medida</button><button type="button" class="btn" data-a="medCancelar">Cancelar</button></div>
      </div>
      <div class="e3d-titulo" style="margin-top:12px">Posição <span class="u" style="font-weight:400">— ou arraste a foto no 3D</span></div>
      <div class="e3d-l3"><div><label data-a="lh">Centro X</label><input type="text" data-a="ph"></div><div><label data-a="lv">Centro Z</label><input type="text" data-a="pv"></div><div data-a="bp"><label data-a="lp">Plano Y</label><input type="text" data-a="pp"></div></div>
      <div class="e3d-botoes">
        <button type="button" class="btn" data-a="base" title="A parte de baixo da foto encosta na mesa">Encostar na mesa</button>
        <button type="button" class="btn" data-a="napeca" title="Centraliza a foto na peça escolhida">No meio da peça</button>
      </div>
      <div class="e3d-l2" style="margin-top:6px"><div><label>Girar (graus)</label><input type="text" data-a="giro"></div><div style="display:flex;align-items:end;gap:6px"><button type="button" class="btn" data-a="g90" title="Girar 90°">↻ 90°</button><button type="button" class="btn" data-a="esp" title="Espelhar a foto">Espelhar</button></div></div>
      <label class="fer-check" style="margin-top:10px"><input type="checkbox" data-a="porCima"> Mostrar a foto por cima das peças</label>
    </div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp', multiple: true, style: 'display:none' });
  d.appendChild(input);

  const refs = [];
  let selId = null, seq = 0, medindo = null, segura = null;
  const atual = () => refs.find(r => r.id === selId) || null;

  function sincronizar() {
    est.visor.definirReferencias(refs);
    est.atualizarVazio();
  }

  // plano da foto pra outras ferramentas (Desenhar em pé desenha em cima dela)
  function planoPara(tipo) {
    const r0 = atual();
    const r = r0 && r0.visivel && r0.plano === tipo ? r0 : refs.find(x => x.visivel && x.plano === tipo);
    if (!r || tipo === 'mesa') return null;
    const P = PLANOS_REF[tipo];
    return tipo === 'frente' ? { o: [0, r.prof, 0], u: P.u, v: P.v, n: P.n, d: r.prof } : { o: [r.prof, 0, 0], u: P.u, v: P.v, n: P.n, d: r.prof };
  }

  // onde a foto nasce: no meio da peça escolhida (ou da placa), em pé na mesa
  function posicaoInicial(r) {
    const o = est.objetoAtual(), c = o && est.cena.caixaExata(o);
    const cp = est.cena.centroPlaca ? est.cena.centroPlaca() : [est.cena.mesa.x / 2, est.cena.mesa.y / 2];
    const m = c ? [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2] : [cp[0], cp[1], 0];
    const h = r.largura * r.aspecto;
    if (r.plano === 'mesa') { r.cx = m[0]; r.cy = m[1]; r.prof = 0; }
    else if (r.plano === 'frente') { r.cx = m[0]; r.cy = c ? m[2] : h / 2; r.prof = m[1]; }
    else { r.cx = m[1]; r.cy = c ? m[2] : h / 2; r.prof = m[0]; }
  }
  // de que lado a câmera está olhando -> plano mais útil pra foto nova
  function planoDaVista() {
    const cam = est.visor.camera.position, t = est.visor.controles.target;
    const dx = cam.x - t.x, dy = cam.y - t.y, dz = cam.z - t.z, n = Math.hypot(dx, dy, dz) || 1;
    if (Math.abs(dz) / n > 0.8) return 'mesa';
    return Math.abs(dx) > Math.abs(dy) ? 'lado' : 'frente';
  }

  async function adicionar(arquivos) {
    const imgs = [...arquivos].filter(ehImagem);
    if (!imgs.length) { avisar('Isso não é uma imagem. Use PNG, JPG ou WebP.', 'warn'); return 0; }
    let n = 0;
    for (const arq of imgs) {
      if (refs.length >= MAX_FOTOS) { avisar('No máximo ' + MAX_FOTOS + ' fotos de referência. Tire uma pra pôr outra.', 'warn'); break; }
      let cv;
      try { cv = await carregarImagem(arq); } catch (e) { avisar(e.message, 'erro'); continue; }
      const aspecto = cv.height / cv.width;
      const r = { id: 'ref' + (++seq), nome: String(arq.name || 'Foto colada').slice(0, 80), imagem: cv, aspecto, plano: refs.length ? planoDaVista() : (planoDaVista() === 'mesa' ? 'mesa' : 'frente'),
        largura: aspecto > 1 ? 100 / aspecto : 100, giro: 0, espelhar: false, opacidade: 0.5, porCima: false, visivel: true, cx: 0, cy: 0, prof: 0 };
      posicaoInicial(r);
      refs.push(r); selId = r.id; n++;
    }
    if (!n) return 0;
    sincronizar();
    if (!d.open) est.abrirFerramenta('ref');
    render();
    enquadrar(atual());
    avisar(n === 1 ? 'Foto de referência adicionada: ajuste a opacidade e o tamanho, e modele por cima.' : n + ' fotos de referência adicionadas.');
    return n;
  }
  // olha de frente pra foto e enquadra
  function enquadrar(r) {
    if (!r) return;
    const k = cantosRef(r), mn = [0, 1, 2].map(i => Math.min(...k.map(p => p[i]))), mx = [0, 1, 2].map(i => Math.max(...k.map(p => p[i])));
    est.visor.vista(r.plano === 'mesa' ? 'topo' : r.plano === 'frente' ? 'frente' : 'direita');
    est.visor.enquadrar({ min: mn, max: mx, tam: mx.map((v, i) => v - mn[i]) });
  }

  function remover(id) {
    const i = refs.findIndex(r => r.id === id);
    if (i < 0) return;
    refs.splice(i, 1);
    if (selId === id) selId = refs.length ? refs[refs.length - 1].id : null;
    pararMedida();
    sincronizar(); render();
  }

  /* ---------------- painel */
  function render() {
    const lista = q('lista');
    lista.innerHTML = '';
    refs.forEach(r => {
      const box = el('div', { class: 'e3d-obj' + (r.id === selId ? ' sel' : ''), 'data-ref': r.id });
      const cab = el('div', { class: 'e3d-obj-cab', title: 'Clique pra escolher' },
        el('span', { html: icone('imagem', 15), style: 'display:inline-flex;color:var(--ink-dim)' }),
        el('span', { class: 'nome' }, r.nome),
        el('span', { class: 'med' }, PLANOS_REF[r.plano].nome),
        el('button', { type: 'button', class: 'e3d-ico', 'data-b': 'ver', title: r.visivel ? 'Esconder' : 'Mostrar', html: icone(r.visivel ? 'olho' : 'olhoFechado', 15), onclick: ev => { ev.stopPropagation(); r.visivel = !r.visivel; sincronizar(); render(); } }),
        el('button', { type: 'button', class: 'e3d-ico', 'data-b': 'tirar', title: 'Tirar a foto', html: icone('lixo', 14), onclick: ev => { ev.stopPropagation(); remover(r.id); } }));
      cab.addEventListener('click', () => { selId = r.id; pararMedida(); render(); });
      box.appendChild(cab);
      lista.appendChild(box);
    });
    const r = atual();
    q('ed').style.display = r ? '' : 'none';
    if (!r) return;
    q('plano').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === r.plano));
    q('opac').value = Math.round(r.opacidade * 100); q('opacv').textContent = Math.round(r.opacidade * 100) + '%';
    q('larg').value = fmt(r.largura, 1); q('alt').value = fmt(r.largura * r.aspecto, 1);
    const [lh, lv, lp] = r.plano === 'mesa' ? ['Centro X', 'Centro Y', ''] : r.plano === 'frente' ? ['Centro X', 'Centro Z', 'Plano Y'] : ['Centro Y', 'Centro Z', 'Plano X'];
    q('lh').textContent = lh; q('lv').textContent = lv; q('lp').textContent = lp;
    q('bp').style.visibility = r.plano === 'mesa' ? 'hidden' : '';
    q('base').style.display = r.plano === 'mesa' ? 'none' : '';
    q('ph').value = fmt(r.cx, 1); q('pv').value = fmt(r.cy, 1); q('pp').value = fmt(r.prof, 1);
    q('giro').value = fmt(r.giro, 0);
    q('porCima').checked = !!r.porCima;
  }
  const mudar = fn => { const r = atual(); if (!r) return; fn(r); sincronizar(); render(); };
  q('add').onclick = () => input.click();
  input.onchange = () => { const f = [...input.files]; input.value = ''; if (f.length) adicionar(f); };
  q('plano').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-v]'); if (!b) return;
    mudar(r => { if (r.plano !== b.dataset.v) { r.plano = b.dataset.v; posicaoInicial(r); } });
    enquadrar(atual());
  });
  q('opac').addEventListener('input', () => { const r = atual(); if (!r) return; r.opacidade = Math.max(0.05, Math.min(1, Number(q('opac').value) / 100)); q('opacv').textContent = Math.round(r.opacidade * 100) + '%'; est.visor.definirReferencias(refs); });
  const campoNum = (k, fn) => {
    const ap = () => { const r = atual(); if (!r) return; const v = lerNumero(q(k).value, NaN); if (!isFinite(v)) { render(); return; } mudar(rr => fn(rr, v)); };
    q(k).addEventListener('change', ap);
    q(k).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ap(); } });
  };
  // mudar o tamanho mantém o meio no lugar (em pé: a base continua na mesma altura)
  const tamanho = (r, L) => {
    L = Math.max(1, Math.min(5000, L));
    if (r.plano !== 'mesa') { const base = r.cy - r.largura * r.aspecto / 2; r.largura = L; r.cy = base + L * r.aspecto / 2; } else r.largura = L;
  };
  campoNum('larg', (r, v) => tamanho(r, v));
  campoNum('alt', (r, v) => tamanho(r, v / r.aspecto));
  campoNum('ph', (r, v) => { r.cx = v; });
  campoNum('pv', (r, v) => { r.cy = v; });
  campoNum('pp', (r, v) => { r.prof = v; });
  campoNum('giro', (r, v) => { r.giro = ((v % 360) + 360) % 360; });
  q('g90').onclick = () => mudar(r => { r.giro = (r.giro + 270) % 360; });
  q('esp').onclick = () => mudar(r => { r.espelhar = !r.espelhar; });
  q('porCima').onchange = () => mudar(r => { r.porCima = q('porCima').checked; });
  q('base').onclick = () => mudar(r => { const k = cantosRef(r); r.cy -= Math.min(...k.map(p => p[2])); });
  q('napeca').onclick = () => {
    const o = est.objetoAtual();
    if (!o) { avisar('Escolha uma peça primeiro (clique nela).', 'warn'); return; }
    mudar(r => { const z = r.cy; posicaoInicial(r); if (r.plano !== 'mesa') r.cy = z; });
  };

  /* ---------------- medir na foto: 2 cliques + a medida real */
  function pararMedida() {
    medindo = null;
    q('medPainel').style.display = 'none';
    est.visor.limparAjudas('ref-medida');
  }
  function mostrarMedida() {
    const r = atual(); if (!r || !medindo) return;
    const P = PLANOS_REF[r.plano], pl = planoRef(r);
    const w = ([a, b]) => [0, 1, 2].map(k => P.u[k] * a + P.v[k] * b + pl.n[k] * pl.d);
    const s = Math.max(0.8, r.largura / 80), laco = [];
    for (const p of medindo.pts) { const c = w(p); laco.push([c[0] - P.u[0] * s, c[1] - P.u[1] * s, c[2] - P.u[2] * s, c[0] + P.u[0] * s, c[1] + P.u[1] * s, c[2] + P.u[2] * s], [c[0] - P.v[0] * s, c[1] - P.v[1] * s, c[2] - P.v[2] * s, c[0] + P.v[0] * s, c[1] + P.v[1] * s, c[2] + P.v[2] * s]); }
    if (medindo.pts.length === 2) laco.push([...w(medindo.pts[0]), ...w(medindo.pts[1])]);
    est.visor.mostrarContornos(laco, '#e54c00', 'ref-medida');
  }
  q('medir').onclick = () => {
    const r = atual(); if (!r) return;
    if (!r.visivel) { r.visivel = true; sincronizar(); render(); }
    medindo = { pts: [] };
    q('medPainel').style.display = ''; q('medCampos').style.display = 'none'; q('medAplicar').style.display = 'none';
    q('medDica').textContent = 'Clique no 1º ponto de uma medida que você conhece (ex.: a largura da peça).';
    est.visor.limparAjudas('ref-medida');
  };
  q('medCancelar').onclick = pararMedida;
  const aplicarMedida = () => {
    const r = atual(); if (!r || !medindo || medindo.pts.length < 2) return;
    const [a, b] = medindo.pts, hoje = Math.hypot(b[0] - a[0], b[1] - a[1]), real = lerNumero(q('medReal').value, NaN);
    if (!(real > 0) || !(hoje > 1e-6)) { avisar('Digite a medida real em mm (maior que zero).', 'warn'); return; }
    const k = real / hoje;
    // o 1º ponto fica parado; o resto da foto cresce/encolhe em volta dele
    r.largura *= k; r.cx = a[0] + (r.cx - a[0]) * k; r.cy = a[1] + (r.cy - a[1]) * k;
    pararMedida(); sincronizar(); render();
    avisar('Pronto: a foto está em escala real (' + fmt(real, 1) + ' mm entre os pontos).');
  };
  q('medAplicar').onclick = aplicarMedida;
  q('medReal').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); aplicarMedida(); } });
  est.on('clique-ref', ({ ev }) => {
    const r = atual();
    if (!r || !medindo) return;
    const pl = planoRef(r), p = est.visor.pontoNoPlano(ev, pl.n, pl.d);
    if (!p) return;
    const x = noPlanoRef(r, [p.x, p.y, p.z]);
    if (medindo.pts.length >= 2) medindo.pts = [];
    medindo.pts.push([x.a, x.b]);
    mostrarMedida();
    if (medindo.pts.length === 1) { q('medDica').textContent = 'Agora clique no 2º ponto.'; return; }
    const hoje = Math.hypot(medindo.pts[1][0] - medindo.pts[0][0], medindo.pts[1][1] - medindo.pts[0][1]);
    q('medDica').textContent = 'Quanto essa distância mede de verdade?';
    q('medCampos').style.display = ''; q('medAplicar').style.display = '';
    q('medHoje').value = fmt(hoje, 1); q('medReal').value = '';
    q('medReal').focus();
  });

  /* ---------------- arrastar a foto no 3D (com o painel aberto) */
  function acharNoPonto(ev) {
    const ordem = [atual(), ...refs.filter(r => r.id !== selId)].filter(r => r && r.visivel);
    for (const r of ordem) {
      const pl = planoRef(r), p = est.visor.pontoNoPlano(ev, pl.n, pl.d);
      if (!p) continue;
      const x = noPlanoRef(r, [p.x, p.y, p.z]);
      if (x.dentro) return { r, x };
    }
    return null;
  }
  function segurar(ev) {
    if (!d.open || medindo) return false;
    const h = acharNoPonto(ev);
    if (!h) return false;
    if (h.r.id !== selId) { selId = h.r.id; render(); }
    segura = { r: h.r, a0: h.x.a, b0: h.x.b, cx0: h.r.cx, cy0: h.r.cy, x0: ev.clientX, y0: ev.clientY, moveu: false };
    return true;
  }
  function mover(ev) {
    if (!segura) return;
    if (!segura.moveu && Math.hypot(ev.clientX - segura.x0, ev.clientY - segura.y0) < 4) return;
    const r = segura.r, pl = planoRef(r), p = est.visor.pontoNoPlano(ev, pl.n, pl.d);
    if (!p) return;
    const x = noPlanoRef(r, [p.x, p.y, p.z]);
    segura.moveu = true;
    r.cx = segura.cx0 + (x.a - segura.a0); r.cy = segura.cy0 + (x.b - segura.b0);
    est.visor.definirReferencias(refs);
  }
  function soltar() { const m = !!(segura && segura.moveu); segura = null; if (m) render(); return m; }

  d.addEventListener('toggle', () => {
    if (d.open) { est.definirFerramenta('referencia'); render(); }
    else { pararMedida(); if (est.ferramenta === 'referencia') est.definirFerramenta('navegar'); }
  });
  return { el: d, adicionar, lista: () => refs, atual, planoPara, segurar, mover, soltar, remover, enquadrar, estaMedindo: () => !!medindo };
}

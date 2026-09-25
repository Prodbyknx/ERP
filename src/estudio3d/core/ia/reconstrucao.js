// Reconstrução por silhuetas de várias vistas (ReconstructionEngine clássico,
// sem IA): cada foto diz "o objeto está DENTRO desta silhueta"; o sólido é o
// cruzamento de todas (casca visual). Sai fechado (manifold) por construção,
// com a altura em mm pedida e cores amostradas das fotos onde cada face aparece.
// Serve de: (1) geração local sem GPU, grosseira mas imprimível; (2) métrica
// de fidelidade por vista pra comparar modelos de IA; (3) base de pós-processo.
import { comContexto, manifold } from '../solidos.js';
import { caixa, normaisFace, centroidesFace, criar, areaFace } from '../malha.js';
import { prepararAdjacencia } from '../selecao.js';
import { mascaraDaImagem, caixaDaMascara, distanciaComSinal } from './imagens.js';

const R2 = Math.SQRT1_2;
// câmera olhando pro objeto; o objeto está de frente pra câmera "frente" (−Y)
export const VISTAS = {
  frente: { f: [0, 1, 0], nome: 'Frente' },
  costas: { f: [0, -1, 0], nome: 'Costas' },
  esquerda: { f: [-1, 0, 0], nome: 'Lado esquerdo' },      // câmera do lado esquerdo do personagem (+X)
  direita: { f: [1, 0, 0], nome: 'Lado direito' },
  frenteEsquerda: { f: [-R2, R2, 0], nome: '3/4 frente-esquerda' },
  frenteDireita: { f: [R2, R2, 0], nome: '3/4 frente-direita' },
  costasEsquerda: { f: [-R2, -R2, 0], nome: '3/4 costas-esquerda' },
  costasDireita: { f: [R2, -R2, 0], nome: '3/4 costas-direita' },
  cima: { f: [0, 0, -1], nome: 'De cima', topo: true }
};
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function eixosDaVista(nome) {
  const v = VISTAS[nome];
  if (!v) throw new Error('Vista desconhecida: ' + nome);
  if (v.topo) return { f: v.f, r: [1, 0, 0], u: [0, 1, 0] };
  return { f: v.f, r: cruz(v.f, [0, 0, 1]), u: [0, 0, 1] };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// fotos -> vistas calibradas (escala mm/pixel e origem na imagem)
// entrada: [{ vista: 'frente', rgba, w, h } | { vista, mascara:{w,h,d} }], alturaMM
export function prepararVistas(entradas, alturaMM, opc = {}) {
  const avisos = [];
  const vs = entradas.map(e => {
    const m = e.mascara || mascaraDaImagem(e.rgba, e.w, e.h, opc);
    const bb = caixaDaMascara(m);
    if (!bb) throw new Error('Não achei o objeto na foto "' + (VISTAS[e.vista] ? VISTAS[e.vista].nome : e.vista) + '". Use fundo liso ou PNG sem fundo.');
    return { ...e, mascara: m, bb, eixos: eixosDaVista(e.vista) };
  });
  if (!vs.some(v => !VISTAS[v.vista].topo)) throw new Error('Precisa de pelo menos uma foto de frente/lado (a de cima sozinha não dá a altura).');
  // escala: todas as vistas laterais têm a mesma altura do objeto
  for (const v of vs) if (!VISTAS[v.vista].topo) { v.s = alturaMM / v.bb.h; v.cx = (v.bb.x0 + v.bb.x1 + 1) / 2; v.cy = v.bb.y1 + 1; }
  const largura = n => { const v = vs.find(x => x.vista === n); return v ? v.bb.w * v.s : null; };
  const X = largura('frente') || largura('costas'), Y = largura('esquerda') || largura('direita');
  const par = (a, b, rot) => { const la = largura(a), lb = largura(b); if (la && lb && Math.abs(la - lb) > 0.06 * Math.max(la, lb)) avisos.push('As fotos de ' + rot + ' têm larguras diferentes (' + la.toFixed(1) + ' × ' + lb.toFixed(1) + ' mm): confira o enquadramento e a distância da câmera.'); };
  par('frente', 'costas', 'frente e costas'); par('esquerda', 'direita', 'lado esquerdo e direito');
  // vista de cima: escala pela largura da frente (ou do lado)
  for (const v of vs) if (VISTAS[v.vista].topo) {
    if (X) v.s = X / v.bb.w; else if (Y) v.s = Y / v.bb.h; else throw new Error('A foto de cima precisa de uma foto de frente ou de lado junto.');
    v.cx = (v.bb.x0 + v.bb.x1 + 1) / 2; v.cy = (v.bb.y0 + v.bb.y1 + 1) / 2;
  }
  for (const v of vs) v.sdf = distanciaComSinal(v.mascara);
  return { vistas: vs, avisos, larguraX: X, profundidadeY: Y, alturaMM };
}

// ponto do mundo -> pixel da vista
function pixel(v, p) {
  const a = dot(p, v.eixos.r), b = dot(p, v.eixos.u);
  if (VISTAS[v.vista].topo) return [v.cx + a / v.s - 0.5, v.cy - b / v.s - 0.5];
  return [v.cx + a / v.s - 0.5, v.cy - b / v.s - 0.5];
}
function amostrar(v, x, y) {
  const { w, h } = v.mascara;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return -1e3;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const s = v.sdf;
  return (s[y0 * w + x0] * (1 - fx) + s[y0 * w + x1] * fx) * (1 - fy) + (s[y1 * w + x0] * (1 - fx) + s[y1 * w + x1] * fx) * fy;
}

// casca visual -> malha fechada. opc: { resolucao (mm), suavizar (mm) }
export function reconstruirPorSilhuetas(prep, opc = {}) {
  const { vistas, alturaMM } = prep;
  const X = prep.larguraX || prep.profundidadeY || alturaMM, Y = prep.profundidadeY || prep.larguraX || alturaMM;
  const res = opc.resolucao || Math.max(0.35, Math.max(X, Y, alturaMM) / 90);
  const k = opc.suavizar != null ? opc.suavizar : res * 1.5;
  const margem = res * 3;
  // mínimo suave entre as vistas (arredonda as quinas onde duas silhuetas se cruzam)
  // (só entre as DUAS silhuetas mais apertadas: não acumula erosão com muitas vistas)
  const sdf = p => {
    let d1 = Infinity, d2 = Infinity;
    for (const v of vistas) {
      const [x, y] = pixel(v, p);
      const s = amostrar(v, x, y) * v.s;
      if (s < d1) { d2 = d1; d1 = s; } else if (s < d2) d2 = s;
    }
    let d = d1;
    if (k > 0 && d2 < Infinity) { const h = Math.max(k - (d2 - d1), 0) / k; d = d1 - h * h * k * 0.25; }
    return Math.min(d, p[2] + res, alturaMM + res - p[2]);      // fecha em cima e embaixo
  };
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const bounds = { min: [-X / 2 - margem, -Y / 2 - margem, -margem], max: [X / 2 + margem, Y / 2 + margem, alturaMM + margem] };
    // superfície fechada; simplify colapsa as lascas que a grade deixa (sem abrir a malha)
    const m = ctx.guardar(ctx.guardar(Manifold.levelSet(sdf, bounds, res, 0)).simplify(res * 0.05));
    if (m.isEmpty()) throw new Error('As silhuetas não se cruzam: confira se as fotos são do mesmo objeto e estão na orientação certa.');
    const b = m.boundingBox(), hz = b.max[2] - b.min[2];
    const f = hz > 0 ? alturaMM / hz : 1;
    const ms = ctx.guardar(ctx.guardar(m.translate([0, 0, -b.min[2]])).scale([f, f, f]));
    const o = ctx.primitiva(ms, '#B4BAC4');
    return { ...ctx.parte(o, 'Modelo das fotos', '#B4BAC4'), resolucao: res, escalaFinal: f };
  });
}

/* ---------------------------------------------------------- rasterização */

// desenha a malha vista pela câmera (ortográfica) numa grade de pixels:
// profundidade, triângulo visível e silhueta. cfg: { w, h, s, cx, cy } da vista
export function rasterizar(malha, eixos, cfg) {
  const { w, h, s, cx, cy } = cfg, n = w * h;
  const prof = new Float32Array(n).fill(Infinity), tri = new Int32Array(n).fill(-1);
  const p = malha.pos, I = malha.idx;
  const px = new Float64Array(p.length / 3), py = new Float64Array(p.length / 3), pz = new Float64Array(p.length / 3);
  for (let i = 0; i < px.length; i++) {
    const q = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
    px[i] = cx + dot(q, eixos.r) / s - 0.5; py[i] = cy - dot(q, eixos.u) / s - 0.5; pz[i] = dot(q, eixos.f);
  }
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const x0 = Math.max(0, Math.floor(Math.min(px[a], px[b], px[c]))), x1 = Math.min(w - 1, Math.ceil(Math.max(px[a], px[b], px[c])));
    const y0 = Math.max(0, Math.floor(Math.min(py[a], py[b], py[c]))), y1 = Math.min(h - 1, Math.ceil(Math.max(py[a], py[b], py[c])));
    if (x0 > x1 || y0 > y1) continue;
    const den = (py[b] - py[c]) * (px[a] - px[c]) + (px[c] - px[b]) * (py[a] - py[c]);
    if (Math.abs(den) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l1 = ((py[b] - py[c]) * (x - px[c]) + (px[c] - px[b]) * (y - py[c])) / den;
      const l2 = ((py[c] - py[a]) * (x - px[c]) + (px[a] - px[c]) * (y - py[c])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const z = l1 * pz[a] + l2 * pz[b] + l3 * pz[c], i = y * w + x;
      if (z < prof[i]) { prof[i] = z; tri[i] = t; }
    }
  }
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = tri[i] >= 0 ? 1 : 0;
  return { w, h, d, prof, tri };
}

// Fidelidade: silhueta do modelo × silhueta da foto, por vista (IoU 0..1)
export function fidelidadePorVista(malha, prep) {
  const out = {};
  for (const v of prep.vistas) {
    const r = rasterizar(malha, v.eixos, { w: v.mascara.w, h: v.mascara.h, s: v.s, cx: v.cx, cy: v.cy });
    let inter = 0, uni = 0;
    for (let i = 0; i < r.d.length; i++) { const a = r.d[i], b = v.mascara.d[i]; if (a && b) inter++; if (a || b) uni++; }
    out[v.vista] = uni ? inter / uni : 0;
  }
  return out;
}

/* ---------------------------------------------------------- cores */

// cor de cada face tirada da foto onde ela aparece de frente (sem estar
// escondida atrás de outra parte), depois agrupada em até N cores
export function coresDasFotos(malha, prep, opc = {}) {
  const nt = malha.idx.length / 3, N = normaisFace(malha), C = centroidesFace(malha);
  const vis = prep.vistas.filter(v => v.rgba).map(v => ({ v, r: rasterizar(malha, v.eixos, { w: v.mascara.w, h: v.mascara.h, s: v.s, cx: v.cx, cy: v.cy }) }));
  if (!vis.length) return null;
  const rgb = new Float32Array(nt * 3), tem = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    let melhor = null, mv = 0.15;
    const n = [N[t * 3], N[t * 3 + 1], N[t * 3 + 2]], c = [C[t * 3], C[t * 3 + 1], C[t * 3 + 2]];
    for (const x of vis) {
      const fac = -dot(n, x.v.eixos.f);
      if (fac <= mv) continue;
      const [px, py] = pixel(x.v, c);
      const i = Math.round(py) * x.v.mascara.w + Math.round(px);
      if (i < 0 || i >= x.r.tri.length || !x.v.mascara.d[i]) continue;
      const z = dot(c, x.v.eixos.f);
      if (Math.abs(x.r.prof[i] - z) > (opc.folgaProf || 1.2)) continue;    // escondida por outra parte
      melhor = { x, i }; mv = fac;
    }
    if (!melhor) continue;
    const q = melhor.x.v.rgba, i = melhor.i * 4;
    rgb[t * 3] = q[i]; rgb[t * 3 + 1] = q[i + 1]; rgb[t * 3 + 2] = q[i + 2]; tem[t] = 1;
  }
  // agrupamento (k-médias simples, junta cores parecidas)
  const maxK = opc.maxCores || 6;
  let centros = [];
  for (let t = 0; t < nt && centros.length < maxK; t++) if (tem[t]) {
    const c = [rgb[t * 3], rgb[t * 3 + 1], rgb[t * 3 + 2]];
    if (centros.every(x => Math.hypot(x[0] - c[0], x[1] - c[1], x[2] - c[2]) > 60)) centros.push(c);
  }
  if (!centros.length) return null;
  const rot = new Int32Array(nt);
  for (let it = 0; it < 8; it++) {
    const soma = centros.map(() => [0, 0, 0, 0]);
    for (let t = 0; t < nt; t++) {
      if (!tem[t]) continue;
      let b = 0, bd = Infinity;
      centros.forEach((x, k) => { const d = (x[0] - rgb[t * 3]) ** 2 + (x[1] - rgb[t * 3 + 1]) ** 2 + (x[2] - rgb[t * 3 + 2]) ** 2; if (d < bd) { bd = d; b = k; } });
      rot[t] = b; const s = soma[b]; s[0] += rgb[t * 3]; s[1] += rgb[t * 3 + 1]; s[2] += rgb[t * 3 + 2]; s[3]++;
    }
    centros = centros.map((x, k) => soma[k][3] ? [soma[k][0] / soma[k][3], soma[k][1] / soma[k][3], soma[k][2] / soma[k][3]] : x);
  }
  // mesmo material com luz diferente (branco no sol e na sombra) vira UMA cor:
  // junta grupos de mesmo tom (cromaticidade) com brilho até 2,2× diferente
  const brilho = c => (c[0] + c[1] + c[2]) / 3 + 1;
  const tom = c => { const b = c[0] + c[1] + c[2] + 1; return [c[0] / b, c[1] / b, c[2] / b]; };
  const alvo = centros.map((_, k) => k);
  const raizDe = k => { while (alvo[k] !== k) k = alvo[k]; return k; };
  for (let a = 0; a < centros.length; a++) for (let b = a + 1; b < centros.length; b++) {
    const ta = tom(centros[a]), tb = tom(centros[b]);
    const dTom = Math.hypot(ta[0] - tb[0], ta[1] - tb[1], ta[2] - tb[2]);
    const razao = Math.max(brilho(centros[a]), brilho(centros[b])) / Math.min(brilho(centros[a]), brilho(centros[b]));
    if (dTom < 0.04 && razao < 2.2) alvo[raizDe(b)] = raizDe(a);
  }
  for (let t = 0; t < nt; t++) if (tem[t]) rot[t] = raizDe(rot[t]);
  // a cor que representa o grupo é a mais clara (a parte iluminada é a cor de verdade)
  const repres = centros.map(c => c.slice());
  centros.forEach((c, k) => { const r = raizDe(k); if (brilho(c) > brilho(repres[r])) repres[r] = c.slice(); });
  centros = repres;
  // ilhas de cor pequenas demais pra imprimir (ruído de foto) e faces sem
  // foto (escondidas em todas) ficam com a cor vizinha dominante
  for (let t = 0; t < nt; t++) if (!tem[t]) rot[t] = -1;
  limparIlhas(malha, rot, opc.ilhaMinMM2 != null ? opc.ilhaMinMM2 : 2);
  const conta = centros.map(() => 0);
  for (let t = 0; t < nt; t++) if (rot[t] >= 0) conta[rot[t]]++;
  const ordem = centros.map((_, k) => k).sort((a, b) => conta[b] - conta[a]).filter(k => conta[k] > 0);
  const nova = new Map(ordem.map((k, i) => [k, i]));
  const cor = new Uint16Array(nt);
  for (let t = 0; t < nt; t++) cor[t] = rot[t] >= 0 ? nova.get(rot[t]) : 0;
  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { malha: criar(malha.pos, malha.idx, ordem.length > 1 ? cor : null), paleta: ordem.map(k => hex(centros[k])), coberturas: ordem.map(k => conta[k] / nt) };
}

// rot: rótulo por face (-1 = sem cor). Região conexa de área < minArea (ou
// sem cor) passa pro rótulo vizinho com mais borda em comum.
export function limparIlhas(malha, rot, minArea) {
  const nt = rot.length, adj = prepararAdjacencia(malha), p = malha.pos, I = malha.idx;
  const area = new Float64Array(nt);
  for (let t = 0; t < nt; t++) area[t] = areaFace(malha, t);
  const compr = (t, k) => { const a = I[t * 3 + k] * 3, b = I[t * 3 + (k + 1) % 3] * 3; return Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]); };
  const reg = new Int32Array(nt), fila = new Int32Array(nt);
  for (let volta = 0; volta < 6; volta++) {
    reg.fill(-1);
    let mudou = false;
    for (let s0 = 0; s0 < nt; s0++) {
      if (reg[s0] >= 0) continue;
      let a = 0, b = 0, soma = 0; fila[b++] = s0; reg[s0] = s0;
      const borda = new Map();
      while (a < b) {
        const t = fila[a++]; soma += area[t];
        for (let k = 0; k < 3; k++) {
          const o = adj.viz[t * 3 + k]; if (o < 0) continue;
          if (rot[o] === rot[s0]) { if (reg[o] < 0) { reg[o] = s0; fila[b++] = o; } }
          else if (rot[o] >= 0) borda.set(rot[o], (borda.get(rot[o]) || 0) + compr(t, k));
        }
      }
      if ((rot[s0] < 0 || soma < minArea) && borda.size) {
        let melhor = -1, mx = -1; borda.forEach((L, r) => { if (L > mx) { mx = L; melhor = r; } });
        for (let i = 0; i < b; i++) rot[fila[i]] = melhor;
        mudou = true;
      }
    }
    if (!mudou) break;
  }
  return rot;
}

// Pipeline completo: fotos -> sólido fechado com cores, medida e relatório
export function fotosPara3D(entradas, opc = {}) {
  const t0 = Date.now();
  const prep = prepararVistas(entradas, opc.alturaMM || 60, opc);
  const r = reconstruirPorSilhuetas(prep, opc);
  let malha = r.malha, paleta = null;
  if (opc.cores !== false) { const c = coresDasFotos(malha, prep, opc); if (c) { malha = c.malha; paleta = c.malha.cor ? c.paleta : null; r.cor = c.paleta[0]; } }
  const fid = fidelidadePorVista(malha, prep);
  return {
    nome: 'Modelo das fotos', malha, cor: r.cor || '#B4BAC4', paleta,
    relatorio: { metodo: 'silhuetas (casca visual)', vistas: prep.vistas.map(v => v.vista), fidelidade: fid, resolucaoMM: r.resolucao, avisos: prep.avisos, triangulos: malha.idx.length / 3, medidas: caixa(malha).tam, ms: Date.now() - t0 }
  };
}

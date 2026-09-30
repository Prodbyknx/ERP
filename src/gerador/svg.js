// LEITOR DE SVG (vetor de verdade): lê os caminhos do arquivo e devolve as
// formas pintadas, na ordem do desenho, com a cor, a regra de preenchimento
// e o contorno já em pontos (curvas e arcos achatados com erro mínimo).
// Entende: path, rect (cantos), circle, ellipse, line, polyline, polygon, use,
// g, svg aninhado, symbol/defs, transform, viewBox, style="" e <style> com
// classes/ids/elementos, fill/stroke/opacity/fill-rule/display/visibility,
// cores (#rgb, #rrggbb, rgb(), nomes, currentColor) e degradê (cor média).
// Puro JS: roda no worker, na tela e nos testes.

const NOMES = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080', teal: '#008080', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff', brown: '#a52a2a', gold: '#ffd700',
  darkgreen: '#006400', darkblue: '#00008b', darkred: '#8b0000', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  beige: '#f5f5dc', crimson: '#dc143c', coral: '#ff7f50', salmon: '#fa8072', tomato: '#ff6347', indigo: '#4b0082', violet: '#ee82ee', khaki: '#f0e68c',
  turquoise: '#40e0d0', skyblue: '#87ceeb', royalblue: '#4169e1', steelblue: '#4682b4', forestgreen: '#228b22', seagreen: '#2e8b57', chocolate: '#d2691e',
  tan: '#d2b48c', ivory: '#fffff0', lavender: '#e6e6fa', whitesmoke: '#f5f5f5', dimgray: '#696969', dimgrey: '#696969', hotpink: '#ff69b4', deeppink: '#ff1493' };

/* ------------------------------------------------------------ XML mínimo */
function lerXML(t) {
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/i, '');
  const raiz = { nome: '#doc', attrs: {}, filhos: [], texto: '' };
  const pilha = [raiz];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/\s*([\w:.-]+)\s*>|<\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(t))) {
    const topo = pilha[pilha.length - 1];
    if (m[1] != null) topo.texto += m[1];
    else if (m[2]) { if (pilha.length > 1) pilha.pop(); }
    else if (m[3]) {
      const attrs = {};
      const ra = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
      while ((a = ra.exec(m[4] || ''))) attrs[a[1]] = decodificar(a[3] != null ? a[3] : a[4]);
      const el = { nome: m[3].replace(/^.*:/, ''), attrs, filhos: [], texto: '', pai: topo };
      topo.filhos.push(el);
      if (!m[5]) pilha.push(el);
    } else if (m[6]) topo.texto += m[6];
  }
  return raiz;
}
const decodificar = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');

/* ------------------------------------------------------------ CSS simples */
function lerCSS(texto) {
  const regras = [];
  texto = texto.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g; let m, ordem = 0;
  while ((m = re.exec(texto))) {
    const decl = lerEstilo(m[2]);
    for (const sel of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
      if (sel.startsWith('@')) continue;
      regras.push({ sel, decl, peso: (sel.match(/#/g) || []).length * 100 + (sel.match(/\./g) || []).length * 10 + (/^[a-z]/i.test(sel) ? 1 : 0), ordem: ordem++ });
    }
  }
  return regras;
}
function lerEstilo(s) {
  const o = {};
  for (const par of String(s || '').split(';')) { const i = par.indexOf(':'); if (i > 0) o[par.slice(0, i).trim().toLowerCase()] = par.slice(i + 1).trim().replace(/\s*!important$/, ''); }
  return o;
}
// seletor simples: "tag", ".a", "#b", "tag.a", ".a.b", e descendente "g .a" (só o último)
function casa(el, sel) {
  const ultimo = sel.split(/\s+|>/).filter(Boolean).pop();
  const m = /^([\w-]*)((?:[.#][\w-]+)*)$/.exec(ultimo);
  if (!m) return false;
  if (m[1] && m[1] !== '*' && m[1] !== el.nome) return false;
  const classes = String(el.attrs.class || '').split(/\s+/);
  for (const p of (m[2].match(/[.#][\w-]+/g) || [])) {
    if (p[0] === '.' && !classes.includes(p.slice(1))) return false;
    if (p[0] === '#' && el.attrs.id !== p.slice(1)) return false;
  }
  return true;
}

/* ------------------------------------------------------------ cores */
function lerCor(v, cor, defs) {
  if (v == null) return undefined;
  v = String(v).trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  if (v === 'currentcolor') return cor ? lerCor(cor, null, defs) : [0, 0, 0];
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(v);
  if (url) {
    const g = defs.get(url[1]);
    if (g) return corMediaDegrade(g, defs);
    const resto = v.slice(url[0].length).trim();
    return resto ? lerCor(resto, cor, defs) : [0, 0, 0];
  }
  if (NOMES[v]) v = NOMES[v];
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(([^)]+)\)/.exec(v);
  if (m) return m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(x => x.endsWith('%') ? parseFloat(x) * 2.55 : +x).map(x => Math.max(0, Math.min(255, Math.round(x))));
  return undefined;
}
function corMediaDegrade(g, defs, profundidade = 0) {
  let paradas = g.filhos.filter(f => f.nome === 'stop');
  const ref = (g.attrs['xlink:href'] || g.attrs.href || '').replace('#', '');
  if (!paradas.length && ref && defs.get(ref) && profundidade < 5) return corMediaDegrade(defs.get(ref), defs, profundidade + 1);
  if (!paradas.length) return [128, 128, 128];
  const cs = paradas.map(p => { const st = lerEstilo(p.attrs.style); return lerCor(st['stop-color'] || p.attrs['stop-color'] || '#000', null, defs) || [0, 0, 0]; });
  return [0, 1, 2].map(k => Math.round(cs.reduce((a, c) => a + c[k], 0) / cs.length));
}

/* ------------------------------------------------------------ matrizes 2D [a b c d e f] */
const I = [1, 0, 0, 1, 0, 0];
const mult = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const aplicar = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function lerTransform(t) {
  let m = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let x;
  while ((x = re.exec(t || ''))) {
    const a = numeros(x[2]);
    let n;
    switch (x[1]) {
      case 'matrix': n = a.length === 6 ? a : I; break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
      case 'rotate': {
        const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        n = [c, s, -s, c, 0, 0];
        if (a.length === 3) n = mult(mult([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      default: n = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    }
    m = mult(m, n);
  }
  return m;
}
function numeros(s) {
  const out = []; const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi; let m;
  while ((m = re.exec(s || ''))) out.push(parseFloat(m[0]));
  return out;
}
const comprimento = (v, ref = 0) => { if (v == null || v === '') return null; const s = String(v).trim(); const n = parseFloat(s); if (!isFinite(n)) return null; return s.endsWith('%') ? n / 100 * ref : n; };

/* ------------------------------------------------------------ path d -> subcaminhos */
// achata a curva em pontos: tol = erro máximo (unidades do desenho)
export function caminhoParaPontos(d, tol) {
  const txt = String(d || ''), subs = [];
  let pos = 0, cmd = null, prevCmd = '', x = 0, y = 0, sx = 0, sy = 0, cx2 = null, cy2 = null, qx = null, qy = null, atual = null;
  const reNum = /[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/y, reFlag = /[\s,]*([01])/y, reCmd = /[\s,]*([MmLlHhVvCcSsQqTtAaZz])/y;
  const ler = re => { re.lastIndex = pos; const m = re.exec(txt); if (!m) return null; pos = re.lastIndex; return m[1]; };
  const nextNum = () => { const v = ler(reNum); if (v == null) throw new Error('path'); return parseFloat(v); };
  // flag do arco é um dígito só e pode vir grudada ("a10 10 0 01 5 5")
  const nextFlag = () => { const v = ler(reFlag); if (v == null) throw new Error('path'); return +v; };
  const temNum = () => { reNum.lastIndex = pos; return reNum.test(txt); };
  const novo = () => { atual = [[x, y]]; subs.push({ pts: atual, fechado: false }); };
  const linha = (nx, ny) => { if (!atual) novo(); atual.push([nx, ny]); x = nx; y = ny; };
  const cubica = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x, y0 = y;
    const pl = (ax, ay, bx, by, cx_, cy_, dx, dy, nivel) => {
      // planura: distância dos controles até a corda
      const ux = 3 * bx - 2 * ax - dx, uy = 3 * by - 2 * ay - dy, vx = 3 * cx_ - ax - 2 * dx, vy = 3 * cy_ - ay - 2 * dy;
      if (nivel > 16 || Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <= 16 * tol * tol) { linha(dx, dy); return; }
      const abx = (ax + bx) / 2, aby = (ay + by) / 2, bcx = (bx + cx_) / 2, bcy = (by + cy_) / 2, cdx = (cx_ + dx) / 2, cdy = (cy_ + dy) / 2;
      const abcx = (abx + bcx) / 2, abcy = (aby + bcy) / 2, bcdx = (bcx + cdx) / 2, bcdy = (bcy + cdy) / 2, mx = (abcx + bcdx) / 2, my = (abcy + bcdy) / 2;
      pl(ax, ay, abx, aby, abcx, abcy, mx, my, nivel + 1); pl(mx, my, bcdx, bcdy, cdx, cdy, dx, dy, nivel + 1);
    };
    pl(x0, y0, x1, y1, x2, y2, x3, y3, 0);
  };
  const arco = (rx, ry, rot, grande, varre, x2, y2) => {
    const x1 = x, y1 = y;
    if (!rx || !ry) { linha(x2, y2); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const f = rot * Math.PI / 180, cf = Math.cos(f), sf = Math.sin(f);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cf * dx + sf * dy, y1p = -sf * dx + cf * dy;
    const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num / den)); if (grande === varre) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const ccx = cf * cxp - sf * cyp + (x1 + x2) / 2, ccy = sf * cxp + cf * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!varre && dt > 0) dt -= 2 * Math.PI; else if (varre && dt < 0) dt += 2 * Math.PI;
    const r = Math.max(rx, ry), passos = Math.max(2, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(-1, 1 - tol / r)))));
    for (let k = 1; k <= passos; k++) {
      const t = t1 + dt * k / passos, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      linha(k === passos ? x2 : cf * ex - sf * ey + ccx, k === passos ? y2 : sf * ex + cf * ey + ccy);
    }
  };
  for (;;) {
    const c = ler(reCmd);
    if (c) cmd = c;
    else if (cmd == null || !temNum()) break;       // fim (ou lixo no fim)
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const bx = rel ? x : 0, by = rel ? y : 0;
    try {
      switch (C) {
        case 'M': x = bx + nextNum(); y = by + nextNum(); sx = x; sy = y; novo(); cmd = rel ? 'l' : 'L'; break;
        case 'L': linha(bx + nextNum(), by + nextNum()); break;
        case 'H': linha(bx + nextNum(), y); break;
        case 'V': linha(x, by + nextNum()); break;
        case 'C': { const a = [bx + nextNum(), by + nextNum(), bx + nextNum(), by + nextNum(), bx + nextNum(), by + nextNum()]; if (!atual) novo(); cubica(...a); cx2 = a[2]; cy2 = a[3]; break; }
        case 'S': { const r1x = cx2 != null && /[CS]/i.test(prevCmd) ? 2 * x - cx2 : x, r1y = cx2 != null && /[CS]/i.test(prevCmd) ? 2 * y - cy2 : y; const a = [bx + nextNum(), by + nextNum(), bx + nextNum(), by + nextNum()]; if (!atual) novo(); cubica(r1x, r1y, a[0], a[1], a[2], a[3]); cx2 = a[0]; cy2 = a[1]; break; }
        case 'Q': { const a = [bx + nextNum(), by + nextNum(), bx + nextNum(), by + nextNum()]; if (!atual) novo(); const x0 = x, y0 = y; cubica(x0 + 2 / 3 * (a[0] - x0), y0 + 2 / 3 * (a[1] - y0), a[2] + 2 / 3 * (a[0] - a[2]), a[3] + 2 / 3 * (a[1] - a[3]), a[2], a[3]); qx = a[0]; qy = a[1]; break; }
        case 'T': { const px_ = qx != null && /[QT]/i.test(prevCmd) ? 2 * x - qx : x, py_ = qx != null && /[QT]/i.test(prevCmd) ? 2 * y - qy : y; const ex = bx + nextNum(), ey = by + nextNum(); if (!atual) novo(); const x0 = x, y0 = y; cubica(x0 + 2 / 3 * (px_ - x0), y0 + 2 / 3 * (py_ - y0), ex + 2 / 3 * (px_ - ex), ey + 2 / 3 * (py_ - ey), ex, ey); qx = px_; qy = py_; break; }
        case 'A': { const rx = nextNum(), ry = nextNum(), rot = nextNum(), g = nextFlag(), v = nextFlag(); const ex = bx + nextNum(), ey = by + nextNum(); if (!atual) novo(); arco(rx, ry, rot, g, v, ex, ey); break; }
        case 'Z': if (atual) { subs[subs.length - 1].fechado = true; } x = sx; y = sy; atual = null; cmd = null; break;
      }
    } catch (e) { break; }        // path truncado: usa o que leu
    prevCmd = C;
    if (!/[CS]/.test(C)) cx2 = null;
    if (!/[QT]/.test(C)) qx = null;
  }
  return subs.filter(s => s.pts.length >= 1);
}

/* ------------------------------------------------------------ formas básicas */
function elipse(cx, cy, rx, ry, tol) {
  const r = Math.max(rx, ry), n = Math.max(12, Math.min(720, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / Math.max(r, 1e-9))))));
  const p = []; for (let k = 0; k < n; k++) { const t = 2 * Math.PI * k / n; p.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return p;
}
function retangulo(x, y, w, h, rx, ry, tol) {
  if (!(w > 0 && h > 0)) return null;
  if (rx == null && ry == null) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  rx = Math.min(rx == null ? ry : rx, w / 2); ry = Math.min(ry == null ? rx : ry, h / 2);
  if (!(rx > 0 && ry > 0)) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const q = (cx, cy, a0) => { const n = Math.max(3, Math.ceil(Math.PI / 2 / Math.acos(Math.max(-1, 1 - tol / Math.max(rx, ry))))); const o = []; for (let k = 0; k <= n; k++) { const t = a0 + Math.PI / 2 * k / n; o.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return o; };
  return [...q(x + w - rx, y + ry, -Math.PI / 2), ...q(x + w - rx, y + h - ry, 0), ...q(x + rx, y + h - ry, Math.PI / 2), ...q(x + rx, y + ry, Math.PI)];
}

/* ------------------------------------------------------------ leitura */
const HERDA = ['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'stroke-miterlimit', 'stroke-dasharray', 'color', 'visibility', 'clip-rule'];
const PROPRIAS = [...HERDA, 'opacity', 'display', 'clip-path', 'mask'];
const NAO_DESENHA = ['defs', 'symbol', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'style', 'title', 'desc', 'metadata', 'marker', 'filter', 'script', 'foreignObject'];

/**
 * lerSVG(texto) -> {
 *   quadro:{x0,y0,x1,y1}  área que o navegador mostra (viewBox; sem viewBox, width/height; sem nada, a caixa do desenho)
 *   caixa:{x0,y0,x1,y1}   caixa do que está desenhado
 *   formas:[{tipo:'fill', cor, regra, aneis, opacidade, clip} | {tipo:'stroke', cor, largura, linhas, ponta, junta, limite, opacidade, clip}]
 *   avisos:[texto], textoOuImagem: bool  (tem texto em fonte/foto: o vetor sozinho não mostra tudo)
 * } — coordenadas do desenho (y pra baixo, como na tela), na ordem em que são pintadas.
 * clip: lista de recortes (a forma só vale dentro de TODOS); cada recorte = {partes:[{aneis, regra}]} (união).
 */
export function lerSVG(texto, opc = {}) {
  const doc = lerXML(String(texto));
  const svg = achar(doc, e => e.nome === 'svg');
  if (!svg) throw new Error('Não é um arquivo SVG.');
  const avisos = new Set();
  let textoOuImagem = false;
  const defs = new Map();
  const regras = [];
  (function coletar(e) {
    if (e.attrs && e.attrs.id) defs.set(e.attrs.id, e);
    if (e.nome === 'style') regras.push(...lerCSS(e.texto));
    for (const f of e.filhos) coletar(f);
  })(doc);
  regras.sort((a, b) => a.peso - b.peso || a.ordem - b.ordem);

  const vb = numeros(svg.attrs.viewBox || '');
  const W = comprimento(svg.attrs.width), H = comprimento(svg.attrs.height);
  const temQuadro = (vb.length === 4 && vb[2] > 0 && vb[3] > 0) || (W > 0 && H > 0);
  const caixaVB = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, W || 100, H || 100];
  const tamanho = Math.max(caixaVB[2], caixaVB[3]) || 100;
  const tol = opc.tol || tamanho / 10000;
  const formas = [];

  // estilo final de um elemento (herança + atributo + CSS + style="")
  const estilo = (el, herdado) => {
    const s = {};
    for (const k of HERDA) if (herdado[k] != null) s[k] = herdado[k];
    for (const k of PROPRIAS) if (el.attrs[k] != null) s[k] = el.attrs[k];
    for (const r of regras) if (casa(el, r.sel)) Object.assign(s, r.decl);
    Object.assign(s, lerEstilo(el.attrs.style));
    return s;
  };

  // geometria de um elemento de forma, já na matriz mm (null se não for forma)
  const geometria = (el, mm) => {
    const t = tol / escalaDe(mm);
    const n = a => +(el.attrs[a] || 0);
    let subs = null;
    switch (el.nome) {
      case 'path': subs = caminhoParaPontos(el.attrs.d, t); break;
      case 'rect': { const r = retangulo(n('x'), n('y'), comprimento(el.attrs.width, caixaVB[2]), comprimento(el.attrs.height, caixaVB[3]), comprimento(el.attrs.rx), comprimento(el.attrs.ry), t); if (r) subs = [{ pts: r, fechado: true }]; break; }
      case 'circle': { const r = comprimento(el.attrs.r); if (r > 0) subs = [{ pts: elipse(n('cx'), n('cy'), r, r, t), fechado: true }]; break; }
      case 'ellipse': { const rx = comprimento(el.attrs.rx), ry = comprimento(el.attrs.ry); if (rx > 0 && ry > 0) subs = [{ pts: elipse(n('cx'), n('cy'), rx, ry, t), fechado: true }]; break; }
      case 'line': subs = [{ pts: [[n('x1'), n('y1')], [n('x2'), n('y2')]], fechado: false }]; break;
      case 'polyline': case 'polygon': { const v = numeros(el.attrs.points); const p = []; for (let k = 0; k + 1 < v.length; k += 2) p.push([v[k], v[k + 1]]); if (p.length >= 2) subs = [{ pts: p, fechado: el.nome === 'polygon' }]; break; }
      default: return null;
    }
    return (subs || []).map(sb => ({ pts: sb.pts.map(p => aplicar(mm, p[0], p[1])), fechado: sb.fechado }));
  };

  // recorte (clip-path): as formas de dentro do <clipPath>, unidas
  const recortes = new Map();
  const recorte = (ref, m) => {
    const id = /url\(\s*['"]?#([^'")]+)/.exec(ref || '');
    const cp = id && defs.get(id[1]);
    if (!cp || cp.nome !== 'clipPath') return null;
    if (cp.attrs.clipPathUnits === 'objectBoundingBox') { avisos.add('Um recorte (clip-path) do SVG usa unidades da caixa do objeto: ficou sem recorte.'); return null; }
    const chave = id[1] + '|' + m.join(',');
    if (recortes.has(chave)) return recortes.get(chave);
    const partes = [];
    const mc = cp.attrs.transform ? mult(m, lerTransform(cp.attrs.transform)) : m;
    (function juntar(el, mm, herd) {
      const s = estilo(el, herd);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      const m2 = el.attrs.transform ? mult(mm, lerTransform(el.attrs.transform)) : mm;
      if (el.nome === 'use') { const r = defs.get((el.attrs.href || el.attrs['xlink:href'] || '').replace('#', '')); if (r) juntar(r, mult(m2, [1, 0, 0, 1, +el.attrs.x || 0, +el.attrs.y || 0]), s); return; }
      const g = geometria(el, m2);
      if (g) {
        const aneis = g.map(x => x.pts).filter(p => p.length >= 3);
        if (aneis.length) partes.push({ aneis, regra: String(s['clip-rule'] || 'nonzero').trim() === 'evenodd' ? 'evenodd' : 'nonzero' });
        return;
      }
      for (const f of el.filhos) juntar(f, m2, s);
    })({ ...cp, nome: 'g', attrs: { ...cp.attrs, transform: null } }, mc, {});
    const r = { partes };
    recortes.set(chave, r);
    return r;
  };

  function visitar(el, m, herdado, opacidade, emUso, clips) {
    if (NAO_DESENHA.includes(el.nome) && !(emUso && el.nome === 'symbol')) return;
    const s = estilo(el, herdado);
    if (s.display === 'none') return;
    const op = opacidade * (s.opacity != null ? +s.opacity : 1);
    if (op <= 0.02) return;
    let mm = el.attrs.transform ? mult(m, lerTransform(el.attrs.transform)) : m;
    if (el.nome === 'svg' && el !== svg) {
      const x = +el.attrs.x || 0, y = +el.attrs.y || 0, v = numeros(el.attrs.viewBox || '');
      mm = mult(mm, [1, 0, 0, 1, x, y]);
      const w = comprimento(el.attrs.width), h = comprimento(el.attrs.height);
      if (v.length === 4 && w && h) mm = mult(mm, [w / v[2], 0, 0, h / v[3], -v[0] * w / v[2], -v[1] * h / v[3]]);
    }
    // clip-path vale pro elemento e tudo dentro dele (no espaço dele)
    let cl = clips;
    if (s['clip-path'] && s['clip-path'] !== 'none') { const r = recorte(s['clip-path'], mm); if (r) cl = [...clips, r]; }
    if (s.mask && s.mask !== 'none') avisos.add('O SVG usa máscara (mask): a máscara foi ignorada — confira o resultado.');
    if (el.nome === 'use') {
      const ref = defs.get((el.attrs.href || el.attrs['xlink:href'] || '').replace('#', ''));
      if (ref) visitar(ref, mult(mm, [1, 0, 0, 1, +el.attrs.x || 0, +el.attrs.y || 0]), s, op, true, cl);
      return;
    }
    if (el.nome === 'text' || el.nome === 'tspan' || el.nome === 'textPath') {
      if ((el.texto || '').trim() || el.filhos.length) { textoOuImagem = true; avisos.add('O SVG tem TEXTO em fonte: converta o texto em curvas no seu programa (Inkscape: Caminho → Objeto em caminho; Illustrator: Criar contornos) pra ter o contorno exato.'); }
      return;
    }
    if (el.nome === 'image') { textoOuImagem = true; avisos.add('O SVG tem uma IMAGEM (foto/bitmap) dentro.'); return; }
    const g = geometria(el, mm);
    if (!g) { for (const f of el.filhos) visitar(f, mm, s, op, emUso, cl); return; }
    if (!g.length || s.visibility === 'hidden' || s.visibility === 'collapse') return;
    // preenchimento (padrão: preto; <line> não tem área)
    const fill = s.fill === undefined ? (el.nome === 'line' ? null : [0, 0, 0]) : lerCor(s.fill, s.color, defs);
    const fillOp = op * (s['fill-opacity'] != null ? +s['fill-opacity'] : 1);
    if (fill && fillOp > 0.15 && el.nome !== 'line') {
      const aneis = g.map(p => p.pts).filter(p => p.length >= 3);
      if (aneis.length) formas.push({ tipo: 'fill', cor: fill, regra: String(s['fill-rule'] || 'nonzero').trim() === 'evenodd' ? 'evenodd' : 'nonzero', aneis, opacidade: fillOp, clip: cl });
    }
    const stroke = s.stroke == null ? null : lerCor(s.stroke, s.color, defs);
    const strokeOp = op * (s['stroke-opacity'] != null ? +s['stroke-opacity'] : 1);
    const larg = (comprimento(s['stroke-width'], tamanho) ?? 1) * escalaDe(mm);
    if (stroke && strokeOp > 0.15 && larg > 0) {
      if (s['stroke-dasharray'] && s['stroke-dasharray'] !== 'none') avisos.add('Linha tracejada do SVG virou linha contínua.');
      formas.push({ tipo: 'stroke', cor: stroke, largura: larg, linhas: g, ponta: String(s['stroke-linecap'] || 'butt').trim(), junta: String(s['stroke-linejoin'] || 'miter').trim(), limite: +s['stroke-miterlimit'] || 4, opacidade: strokeOp, clip: cl });
    }
  }
  for (const f of svg.filhos) visitar(f, I, estilo(svg, {}), 1, false, []);
  if (!formas.length) throw new Error('Não achei formas desenhadas no SVG' + (avisos.size ? ': ' + [...avisos][0] : '.'));
  // caixa de tudo
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of formas) {
    const g = f.tipo === 'stroke' ? f.largura / 2 : 0;
    for (const a of (f.aneis || f.linhas.map(l => l.pts))) for (const [x, y] of a) { x0 = Math.min(x0, x - g); y0 = Math.min(y0, y - g); x1 = Math.max(x1, x + g); y1 = Math.max(y1, y + g); }
  }
  const caixa = { x0, y0, x1, y1 };
  const quadro = temQuadro ? { x0: caixaVB[0], y0: caixaVB[1], x1: caixaVB[0] + caixaVB[2], y1: caixaVB[1] + caixaVB[3] } : caixa;
  return { quadro, caixa, formas, avisos: [...avisos], textoOuImagem };
}
function achar(e, f) { if (f(e)) return e; for (const x of e.filhos) { const r = achar(x, f); if (r) return r; } return null; }
function escalaDe(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }
const areaAnel = p => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return s / 2; };
const positivo = p => areaAnel(p) < 0 ? p.slice().reverse() : p;

/* ------------------------------------------------------------ traço -> polígonos */
// Traço vira polígonos (todos no mesmo sentido: a união é a regra "não zero"):
// um retângulo por segmento + a junta (redonda, chanfrada ou em quina, com o
// limite de quina do SVG) + as pontas (reta, redonda ou quadrada).
export function tracoParaAneis(f, k, P) {
  const meia = f.largura * k / 2, out = [];
  if (!(meia > 0)) return out;
  const disco = q => elipse(q[0], q[1], meia, meia, Math.max(0.02, meia / 40));
  for (const l of f.linhas) {
    const p0 = l.pts.map(P), p = [];
    for (const q of p0) if (!p.length || Math.hypot(q[0] - p[p.length - 1][0], q[1] - p[p.length - 1][1]) > 1e-9) p.push(q);
    const fechado = l.fechado && p.length > 2;
    if (fechado && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-9) p.pop();
    if (p.length === 1) {       // ponto: só a ponta aparece
      if (f.ponta === 'round') out.push(disco(p[0]));
      else if (f.ponta === 'square') out.push([[p[0][0] - meia, p[0][1] - meia], [p[0][0] + meia, p[0][1] - meia], [p[0][0] + meia, p[0][1] + meia], [p[0][0] - meia, p[0][1] + meia]]);
      continue;
    }
    const nSeg = fechado ? p.length : p.length - 1;
    const dir = i => { const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    for (let i = 0; i < nSeg; i++) {
      const a = p[i], b = p[(i + 1) % p.length], [ux, uy] = dir(i), nx = -uy * meia, ny = ux * meia;
      const ea = !fechado && i === 0 && f.ponta === 'square' ? meia : 0, eb = !fechado && i === nSeg - 1 && f.ponta === 'square' ? meia : 0;
      const A = [a[0] - ux * ea, a[1] - uy * ea], B = [b[0] + ux * eb, b[1] + uy * eb];
      out.push(positivo([[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny]]));
    }
    const juntas = fechado ? p.map((_, i) => i) : p.slice(1, -1).map((_, i) => i + 1);
    for (const i of juntas) {
      const c = p[i];
      if (f.junta === 'round') { out.push(disco(c)); continue; }
      const [ax, ay] = dir((i - 1 + p.length) % p.length), [bx, by] = dir(i);
      const cruz = ax * by - ay * bx;
      if (Math.abs(cruz) < 1e-9 && ax * bx + ay * by > 0) continue;       // reta: não precisa
      const s = cruz > 0 ? -1 : 1;                                        // lado de fora da curva
      const o1 = [c[0] + s * -ay * meia, c[1] + s * ax * meia], o2 = [c[0] + s * -by * meia, c[1] + s * bx * meia];
      const sx = o1[0] + o2[0] - 2 * c[0], sy = o1[1] + o2[1] - 2 * c[1], s2 = sx * sx + sy * sy;
      if (f.junta !== 'bevel' && s2 > 1e-12) {
        const razao = 2 * meia / Math.sqrt(s2);                            // = 1/cos(meio ângulo) = limite de quina
        if (razao <= f.limite) { const t = 2 * meia * meia / s2; out.push(positivo([c, o1, [c[0] + sx * t, c[1] + sy * t], o2])); continue; }
      }
      out.push(positivo([c, o1, o2]));
    }
    if (!fechado && f.ponta === 'round') { out.push(disco(p[0])); out.push(disco(p[p.length - 1])); }
  }
  return out.map(positivo).filter(a => Math.abs(areaAnel(a)) > 1e-12);
}

/* ------------------------------------------------------------ raster (pra análise) */
// Varre um conjunto de anéis (regra nonzero/evenodd) linha a linha com 4
// sublinhas por pixel e cobertura horizontal exata; chama fn(y, cobre, x0, x1).
function varrer(aneis, regraPar, W, H, fn) {
  const E = [];
  let ymax = -Infinity;
  for (const a of aneis) for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    if (p[1] === q[1] || !isFinite(p[1]) || !isFinite(q[1])) continue;
    const sobe = p[1] < q[1], [ya, yb, xa, xb] = sobe ? [p[1], q[1], p[0], q[0]] : [q[1], p[1], q[0], p[0]];
    E.push({ y0: ya, y1: yb, x0: xa, dx: (xb - xa) / (yb - ya), w: sobe ? 1 : -1 });
    if (yb > ymax) ymax = yb;
  }
  if (!E.length) return;
  E.sort((a, b) => a.y0 - b.y0);
  const cobre = new Float32Array(W + 1);
  let prox = 0, ativos = [];
  const y0 = Math.max(0, Math.floor(E[0].y0)), y1 = Math.min(H, Math.ceil(ymax));
  // pula direto pra primeira linha (arestas que acabaram antes não entram)
  for (let y = y0; y < y1; y++) {
    let lo = W, hi = -1;
    for (let s = 0; s < 4; s++) {
      const yc = y + (s + 0.5) / 4;
      while (prox < E.length && E[prox].y0 <= yc) ativos.push(E[prox++]);
      if (ativos.length > 64 || s === 0) ativos = ativos.filter(e => e.y1 > yc);
      const cr = [];
      for (const e of ativos) if (e.y1 > yc) cr.push([e.x0 + (yc - e.y0) * e.dx, e.w]);
      if (cr.length < 2) continue;
      cr.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i + 1 < cr.length; i++) {
        wind += regraPar ? 1 : cr[i][1];
        if (regraPar ? (wind & 1) === 0 : wind === 0) continue;
        const a0 = Math.max(0, cr[i][0]), a1 = Math.min(W, cr[i + 1][0]);
        if (a1 <= a0) continue;
        const xa = Math.floor(a0), xb = Math.ceil(a1);
        if (xa < lo) lo = xa; if (xb > hi) hi = xb;
        if (xb - xa === 1) { cobre[xa] += (a1 - a0) / 4; continue; }
        cobre[xa] += (xa + 1 - a0) / 4;
        for (let x = xa + 1; x < xb - 1; x++) cobre[x] += 0.25;
        cobre[xb - 1] += (a1 - (xb - 1)) / 4;
      }
    }
    if (hi > lo) { fn(y, cobre, lo, hi); cobre.fill(0, lo, hi); }
  }
}

/**
 * rasterizarSVG(lido, ladoMax) -> { px (RGBA), w, h, k, x0, y0, dono (índice da forma
 * que manda em cada pixel, -1 = nada), formasPx:[{aneis, regra, clip}] }
 * Pinta a área do QUADRO (a mesma que o navegador mostra), px = (x - x0) * k.
 */
export function rasterizarSVG(lido, ladoMax = 1000) {
  const { x0, y0, x1, y1 } = lido.quadro;
  const bw = x1 - x0, bh = y1 - y0;
  const k = ladoMax / Math.max(bw, bh);
  const W = Math.max(8, Math.round(bw * k)), H = Math.max(8, Math.round(bh * k));
  const px = new Uint8ClampedArray(W * H * 4);
  const dono = new Int32Array(W * H).fill(-1);
  const P = ([x, y]) => [(x - x0) * k, (y - y0) * k];
  const clipsPx = new Map();
  const clipPx = c => {
    let r = clipsPx.get(c);
    if (!r) {
      const cob = new Float32Array(W * H);
      const partes = c.partes.map(pp => ({ aneis: pp.aneis.map(a => a.map(P)), regra: pp.regra }));
      for (const pp of partes) varrer(pp.aneis, pp.regra === 'evenodd', W, H, (y, cobre, lo, hi) => { for (let x = lo; x < hi; x++) { const i = y * W + x; cob[i] = Math.max(cob[i], Math.min(1, cobre[x])); } });
      r = { partes, cob };
      clipsPx.set(c, r);
    }
    return r;
  };
  const formasPx = [];
  lido.formas.forEach((f, fi) => {
    const aneis = f.tipo === 'fill' ? f.aneis.map(a => a.map(P)) : tracoParaAneis(f, k, P);
    const regra = f.tipo === 'fill' ? f.regra : 'nonzero';
    const clips = (f.clip || []).map(clipPx);
    formasPx.push({ aneis, regra, clip: clips.map(c => c.partes) });
    const [r, g, b] = f.cor, op = Math.min(1, f.opacidade == null ? 1 : f.opacidade);
    varrer(aneis, regra === 'evenodd', W, H, (y, cobre, lo, hi) => {
      for (let x = lo; x < hi; x++) {
        const i = y * W + x;
        let c = Math.min(1, cobre[x]);
        for (const cl of clips) c *= cl.cob[i];
        if (c <= 0.002) continue;
        if (c >= 0.5 && op >= 0.5) dono[i] = fi;
        c *= op;
        const o = i * 4, aA = px[o + 3] / 255, aN = c + aA * (1 - c);
        px[o] = (r * c + px[o] * aA * (1 - c)) / aN; px[o + 1] = (g * c + px[o + 1] * aA * (1 - c)) / aN; px[o + 2] = (b * c + px[o + 2] * aA * (1 - c)) / aN; px[o + 3] = aN * 255;
      }
    });
  });
  return { px, w: W, h: H, k, x0, y0, dono, formasPx };
}

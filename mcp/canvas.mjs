// "Canvas 2D" mínimo pro Node: só o que o gerador do site usa (formas,
// texto, imagem redimensionada, getImageData). Assim o MCP roda as MESMAS
// funções do site (ferDesenharForma, ferDesenharTexto, ferUsarImagem) e a
// peça sai igual à da tela.
//  - preenchimento com regra nonzero e borda suavizada (4 sub-linhas por
//    pixel, cobertura horizontal exata) — como o navegador
//  - texto por fonte TTF/OTF do sistema (opentype.js), letra a letra
import { fonteDaFamilia } from './fontes.mjs';

const cor = s => {
  // gradiente: a cor do meio (a prévia só usa na mesa)
  if (s && s._paradas) { const p = s._paradas; s = p.length ? p[Math.floor(p.length / 2)][1] : '#000'; }
  s = String(s || '#000').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(255);
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(255);
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) { const v = m[1].split(',').map(x => parseFloat(x)); return [v[0], v[1], v[2], v.length > 3 ? Math.round(v[3] * 255) : 255]; }
  return [0, 0, 0, 255];
};

export class Canvas {
  constructor(w = 300, h = 150) { this._w = w; this._h = h; this._ctx = null; }
  get width() { return this._w; }
  set width(v) { this._w = Math.max(1, v | 0); if (this._ctx) this._ctx._novo(); }
  get height() { return this._h; }
  set height(v) { this._h = Math.max(1, v | 0); if (this._ctx) this._ctx._novo(); }
  getContext() { if (!this._ctx) this._ctx = new Contexto2D(this); return this._ctx; }
}

class Contexto2D {
  constructor(cv) {
    this.canvas = cv; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1;
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this._novo();
  }
  _novo() {
    // trocar width/height apaga o canvas e o estado (como no navegador)
    this.px = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
    this._sub = []; this._atual = null;
  }
  // ---------------------------------------------------------- caminho
  beginPath() { this._sub = []; this._atual = null; }
  moveTo(x, y) { this._atual = [[x, y]]; this._sub.push(this._atual); }
  lineTo(x, y) { if (!this._atual) this.moveTo(x, y); else this._atual.push([x, y]); }
  closePath() { if (this._atual && this._atual.length) { const p = this._atual[0]; this._atual = [[p[0], p[1]]]; this._sub.push(this._atual); } }
  _ultimo() { return this._atual && this._atual.length ? this._atual[this._atual.length - 1] : null; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(cx, cy, r, a0, a1, antiHorario = false) {
    let d = a1 - a0;
    if (!antiHorario && d < 0) d = d % (2 * Math.PI) + 2 * Math.PI;
    if (antiHorario && d > 0) d = d % (2 * Math.PI) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) d = antiHorario ? -2 * Math.PI : 2 * Math.PI;
    const n = Math.max(8, Math.ceil(Math.abs(d) * Math.max(r, 1) / 1.5));
    for (let i = 0; i <= n; i++) {
      const a = a0 + d * i / n, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0 && this._atual) this.lineTo(x, y); else if (i === 0) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  arcTo(x1, y1, x2, y2, r) {
    const p0 = this._ultimo();
    if (!p0) { this.moveTo(x1, y1); return; }
    const ax = p0[0] - x1, ay = p0[1] - y1, bx = x2 - x1, by = y2 - y1;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const cruz = ax * by - ay * bx;
    if (!r || !la || !lb || Math.abs(cruz) < 1e-9) { this.lineTo(x1, y1); return; }
    const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
    const th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    const d = r / Math.tan(th / 2);
    const t1 = [x1 + ux * d, y1 + uy * d], t2 = [x1 + vx * d, y1 + vy * d];
    const bxs = ux + vx, bys = uy + vy, lbs = Math.hypot(bxs, bys) || 1, h = r / Math.sin(th / 2);
    const c = [x1 + bxs / lbs * h, y1 + bys / lbs * h];
    this.lineTo(t1[0], t1[1]);
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]), a1 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    this.arc(c[0], c[1], r, a0, a1, cruz > 0);
  }
  quadraticCurveTo(cx, cy, x, y) {
    const p = this._ultimo() || [cx, cy], n = 24;
    for (let i = 1; i <= n; i++) { const t = i / n, s = 1 - t; this.lineTo(s * s * p[0] + 2 * s * t * cx + t * t * x, s * s * p[1] + 2 * s * t * cy + t * t * y); }
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    const p = this._ultimo() || [c1x, c1y], n = 32;
    for (let i = 1; i <= n; i++) {
      const t = i / n, s = 1 - t;
      this.lineTo(s * s * s * p[0] + 3 * s * s * t * c1x + 3 * s * t * t * c2x + t * t * t * x, s * s * s * p[1] + 3 * s * s * t * c1y + 3 * s * t * t * c2y + t * t * t * y);
    }
  }
  // ---------------------------------------------------------- pintura
  fill(regra) { preencher(this, this._sub, cor(this.fillStyle), regra === 'evenodd'); }
  // contorno: cada segmento vira um retângulo da largura da linha
  stroke() {
    const m = Math.max(0.5, this.lineWidth) / 2, quads = [];
    for (const s of this._sub) for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (!L) continue;
      const nx = -dy / L * m, ny = dx / L * m;
      quads.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
    }
    for (const q of quads) preencher(this, [q], cor(this.strokeStyle));
  }
  createLinearGradient() { return { _paradas: [], addColorStop(o, c) { this._paradas.push([o, c]); } }; }
  save() { (this._pilha = this._pilha || []).push([this.fillStyle, this.strokeStyle, this.lineWidth, this.font, this.textAlign, this.textBaseline]); }
  restore() { const e = (this._pilha || []).pop(); if (e) [this.fillStyle, this.strokeStyle, this.lineWidth, this.font, this.textAlign, this.textBaseline] = e; }
  clip() {}
  setLineDash() {}
  fillRect(x, y, w, h) {
    const c = cor(this.fillStyle), W = this.canvas.width, H = this.canvas.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) misturar(this.px, (yy * W + xx) * 4, c, 1);
  }
  clearRect(x, y, w, h) {
    const W = this.canvas.width, H = this.canvas.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) this.px.fill(0, (yy * W + x0) * 4, (yy * W + x1) * 4);
  }
  getImageData(x, y, w, h) {
    const W = this.canvas.width, out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) out.set(this.px.subarray(((y + yy) * W + x) * 4, ((y + yy) * W + x + w) * 4), yy * w * 4);
    return { data: out, width: w, height: h };
  }
  // imagem decodificada ({ _px, naturalWidth, naturalHeight }) com média por
  // área (reduzir sem serrilhado), alfa pré-multiplicado
  drawImage(img, dx, dy, dw, dh) {
    const sw = img.naturalWidth, sh = img.naturalHeight, src = img._px, W = this.canvas.width, H = this.canvas.height;
    dw = dw == null ? sw : dw; dh = dh == null ? sh : dh;
    for (let y = 0; y < dh; y++) {
      const sy0 = y * sh / dh, sy1 = (y + 1) * sh / dh, ty = Math.round(dy + y);
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < dw; x++) {
        const sx0 = x * sw / dw, sx1 = (x + 1) * sw / dw, tx = Math.round(dx + x);
        if (tx < 0 || tx >= W) continue;
        let r = 0, g = 0, b = 0, a = 0, peso = 0;
        for (let yy = Math.floor(sy0); yy < Math.min(sh, Math.ceil(sy1)); yy++) {
          const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
          for (let xx = Math.floor(sx0); xx < Math.min(sw, Math.ceil(sx1)); xx++) {
            const w = wy * (Math.min(xx + 1, sx1) - Math.max(xx, sx0)), i = (yy * sw + xx) * 4, al = src[i + 3] / 255;
            r += src[i] * al * w; g += src[i + 1] * al * w; b += src[i + 2] * al * w; a += al * w; peso += w;
          }
        }
        if (!peso) continue;
        const alfa = a / peso, o = (ty * W + tx) * 4;
        if (alfa > 0) misturar(this.px, o, [r / a, g / a, b / a, 255], alfa);
      }
    }
  }
  // ---------------------------------------------------------- texto
  _fonte() {
    const f = this.font, tam = parseFloat((/(\d+(?:\.\d+)?)px/.exec(f) || [0, 10])[1]);
    const fam = (/"([^"]+)"/.exec(f) || /px\s+([^,]+)/.exec(f) || [0, 'sans-serif'])[1].trim();
    return { tam, fonte: fonteDaFamilia(fam, /\b(bold|[6-9]00)\b/.test(f)) };
  }
  _layout(txt) {
    const { tam, fonte } = this._fonte(), k = tam / fonte.unitsPerEm;
    let x = 0, prev = null; const glifos = [];
    for (const ch of String(txt)) {
      const g = fonte.charToGlyph(ch);
      if (prev) x += fonte.getKerningValue(prev, g) * k;
      glifos.push({ g, x }); x += (g.advanceWidth || 0) * k; prev = g;
    }
    return { tam, fonte, k, glifos, largura: x };
  }
  measureText(txt) { return { width: this._layout(txt).largura }; }
  fillText(txt, x, y) {
    const L = this._layout(txt), f = L.fonte, asc = f.ascender * L.k, desc = f.descender * L.k;
    let x0 = x;
    if (this.textAlign === 'center') x0 = x - L.largura / 2; else if (this.textAlign === 'right' || this.textAlign === 'end') x0 = x - L.largura;
    let base = y;                                         // alphabetic
    if (this.textBaseline === 'middle') base = y + (asc + desc) / 2;
    else if (this.textBaseline === 'top' || this.textBaseline === 'hanging') base = y + asc;
    else if (this.textBaseline === 'bottom' || this.textBaseline === 'ideographic') base = y + desc;
    const sub = [];
    for (const { g, x: gx } of L.glifos) {
      let atual = null, px = 0, py = 0;
      for (const c of g.getPath(x0 + gx, base, L.tam).commands) {
        if (c.type === 'M') { atual = [[c.x, c.y]]; sub.push(atual); }
        else if (c.type === 'L') atual.push([c.x, c.y]);
        else if (c.type === 'Q') { for (let i = 1; i <= 12; i++) { const t = i / 12, s = 1 - t; atual.push([s * s * px + 2 * s * t * c.x1 + t * t * c.x, s * s * py + 2 * s * t * c.y1 + t * t * c.y]); } }
        else if (c.type === 'C') { for (let i = 1; i <= 16; i++) { const t = i / 16, s = 1 - t; atual.push([s * s * s * px + 3 * s * s * t * c.x1 + 3 * s * t * t * c.x2 + t * t * t * c.x, s * s * s * py + 3 * s * s * t * c.y1 + 3 * s * t * t * c.y2 + t * t * t * c.y]); } }
        if (c.type !== 'Z') { px = c.x; py = c.y; }
      }
    }
    preencher(this, sub, cor(this.fillStyle));
  }
}

function misturar(px, o, c, a) {
  if (a >= 1) { px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3]; return; }
  const ad = px[o + 3] / 255, ao = a + ad * (1 - a);
  if (ao <= 0) return;
  for (let e = 0; e < 3; e++) px[o + e] = (c[e] * a + px[o + e] * ad * (1 - a)) / ao;
  px[o + 3] = ao * 255;
}

// regra nonzero (ou par-ímpar), 4 sub-linhas por pixel e cobertura
// horizontal exata
function preencher(ctx, subcaminhos, c, parImpar = false) {
  const W = ctx.canvas.width, H = ctx.canvas.height, arestas = [];
  let ymin = Infinity, ymax = -Infinity;
  for (const s of subcaminhos) {
    if (s.length < 2) continue;
    for (let i = 0; i < s.length; i++) {
      const a = s[i], b = s[(i + 1) % s.length];
      if (a[1] === b[1]) continue;
      arestas.push(a[1] < b[1] ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1], w: 1 } : { x0: b[0], y0: b[1], x1: a[0], y1: a[1], w: -1 });
      ymin = Math.min(ymin, a[1], b[1]); ymax = Math.max(ymax, a[1], b[1]);
    }
  }
  if (!arestas.length) return;
  const SUB = 4, cob = new Float32Array(W + 1);
  const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(H - 1, Math.ceil(ymax));
  arestas.sort((p, q) => p.y0 - q.y0);
  for (let y = y0; y <= y1; y++) {
    cob.fill(0);
    let usado = false, xmin = W, xmax = 0;
    for (let k = 0; k < SUB; k++) {
      const ys = y + (k + 0.5) / SUB, cortes = [];
      for (const e of arestas) {
        if (e.y0 > ys) break;
        if (e.y1 <= ys) continue;
        cortes.push({ x: e.x0 + (ys - e.y0) * (e.x1 - e.x0) / (e.y1 - e.y0), w: e.w });
      }
      if (cortes.length < 2) continue;
      cortes.sort((p, q) => p.x - q.x);
      let enr = 0;
      for (let i = 0; i < cortes.length - 1; i++) {
        enr += parImpar ? 1 : cortes[i].w;
        if (parImpar ? !(enr & 1) : !enr) continue;
        const xa = Math.max(0, cortes[i].x), xb = Math.min(W, cortes[i + 1].x);
        if (xb <= xa) continue;
        usado = true;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        xmin = Math.min(xmin, ia); xmax = Math.max(xmax, Math.min(W - 1, ib));
        if (ia === ib) { cob[ia] += (xb - xa) / SUB; continue; }
        cob[ia] += (ia + 1 - xa) / SUB;
        for (let x = ia + 1; x < ib; x++) cob[x] += 1 / SUB;
        if (ib < W) cob[ib] += (xb - ib) / SUB;
      }
    }
    if (!usado) continue;
    for (let x = xmin; x <= xmax; x++) { const a = Math.min(1, cob[x]); if (a > 0.002) misturar(ctx.px, (y * W + x) * 4, c, a * c[3] / 255); }
  }
}

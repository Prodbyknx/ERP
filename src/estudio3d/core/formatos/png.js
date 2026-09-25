// PNG mínimo (Node/servidor): ler pra RGBA e gravar RGBA. No navegador as
// fotos passam pelo <canvas>; isto serve à linha de comando e aos testes.
import { zlibSync, unzlibSync } from 'fflate';

const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function bloco(tipo, dados) {
  const out = new Uint8Array(12 + dados.length), dv = new DataView(out.buffer);
  dv.setUint32(0, dados.length); out.set(new TextEncoder().encode(tipo), 4); out.set(dados, 8);
  dv.setUint32(8 + dados.length, crc(out.subarray(4, 8 + dados.length)));
  return out;
}
export function escreverPNG(rgba, w, h) {
  const bruto = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { bruto[y * (w * 4 + 1)] = 0; bruto.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const partes = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), bloco('IHDR', ihdr), bloco('IDAT', zlibSync(bruto, { level: 6 })), bloco('IEND', new Uint8Array(0))];
  const tot = partes.reduce((s, p) => s + p.length, 0), out = new Uint8Array(tot);
  let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

// -> { w, h, rgba: Uint8Array }. Aceita cinza/RGB/paleta/cinza+alfa/RGBA, 8 ou 16 bits, sem entrelaçamento.
export function lerPNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => b[i] === v)) throw new Error('Não é um PNG.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8, w = 0, h = 0, prof = 8, tipo = 6, entrel = 0, plte = null, trns = null;
  const idat = [];
  while (o < b.length) {
    const n = dv.getUint32(o), t = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), d = b.subarray(o + 8, o + 8 + n);
    if (t === 'IHDR') { w = dv.getUint32(o + 8); h = dv.getUint32(o + 12); prof = d[8]; tipo = d[9]; entrel = d[12]; }
    else if (t === 'PLTE') plte = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
    o += 12 + n;
  }
  if (entrel) throw new Error('PNG entrelaçado não é aceito: salve de novo sem entrelaçamento.');
  if (prof !== 8 && prof !== 16) throw new Error('PNG com ' + prof + ' bits por canal não é aceito.');
  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipo];
  if (!canais) throw new Error('Tipo de PNG desconhecido.');
  const tot = idat.reduce((s, x) => s + x.length, 0), z = new Uint8Array(tot);
  let k = 0; for (const x of idat) { z.set(x, k); k += x.length; }
  const cru = unzlibSync(z), bpp = canais * prof / 8, lin = w * bpp;
  const px = new Uint8Array(h * lin);
  for (let y = 0; y < h; y++) {
    const f = cru[y * (lin + 1)], src = y * (lin + 1) + 1, dst = y * lin;
    for (let x = 0; x < lin; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, c = y ? px[dst - lin + x] : 0, ul = y && x >= bpp ? px[dst - lin + x - bpp] : 0;
      let v = cru[src + x];
      if (f === 1) v += a; else if (f === 2) v += c; else if (f === 3) v += (a + c) >> 1;
      else if (f === 4) { const p = a + c - ul, pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? c : ul; }
      px[dst + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4), passo = prof / 8;
  for (let i = 0; i < w * h; i++) {
    const g = j => px[i * bpp + j * passo];
    let r, gg, bb, al = 255;
    if (tipo === 0) { r = gg = bb = g(0); } else if (tipo === 2) { r = g(0); gg = g(1); bb = g(2); }
    else if (tipo === 3) { const q = px[i]; r = plte[q * 3]; gg = plte[q * 3 + 1]; bb = plte[q * 3 + 2]; if (trns && q < trns.length) al = trns[q]; }
    else if (tipo === 4) { r = gg = bb = g(0); al = g(1); } else { r = g(0); gg = g(1); bb = g(2); al = g(3); }
    rgba[i * 4] = r; rgba[i * 4 + 1] = gg; rgba[i * 4 + 2] = bb; rgba[i * 4 + 3] = al;
  }
  return { w, h, rgba };
}

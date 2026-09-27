// PNG e JPG -> pixels RGBA, e RGBA -> PNG (prévia). JS puro, sem nada
// nativo (roda igual no Windows, Mac e Linux).
// Limite de 40 megapixels: imagem maior (ou "bomba" de compressão) é
// recusada ANTES de descompactar.
import { unzlibSync, zlibSync } from 'fflate';
import jpeg from 'jpeg-js';

export const MAX_PIXELS = 40e6;

export function lerImagem(bytes, nome = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return lerPNG(u8);
  if (u8[0] === 0xFF && u8[1] === 0xD8) {
    const r = jpeg.decode(u8, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 1024 });
    return { largura: r.width, altura: r.height, px: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
  }
  throw new Error('Formato de imagem não suportado' + (nome ? ' (' + nome + ')' : '') + ': use PNG ou JPG.');
}

function lerPNG(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 8, w = 0, h = 0, prof = 0, tipo = 0, entrel = 0, paleta = null, trns = null;
  const idat = [];
  while (p + 8 <= u8.length) {
    const len = dv.getUint32(p), t = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]), d = u8.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); prof = d[8]; tipo = d[9]; entrel = d[12];
      if (!w || !h || w * h > MAX_PIXELS) throw new Error('Imagem grande demais (' + w + '×' + h + '). Máximo ' + MAX_PIXELS / 1e6 + ' megapixels.');
    } else if (t === 'PLTE') paleta = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (!w) throw new Error('PNG sem cabeçalho.');
  if (entrel) throw new Error('PNG entrelaçado não é suportado: salve de novo sem "entrelaçamento".');
  if (prof !== 8 && prof !== 16 && !(tipo === 3 && prof <= 8) && !(tipo === 0 && prof <= 8)) throw new Error('PNG com ' + prof + ' bits por canal não é suportado.');
  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipo];
  if (!canais) throw new Error('PNG de tipo ' + tipo + ' não é suportado.');
  const total = idat.reduce((a, b) => a + b.length, 0), junto = new Uint8Array(total);
  let o = 0; for (const b of idat) { junto.set(b, o); o += b.length; }
  const bpp = Math.max(1, (canais * prof) >> 3), linha = Math.ceil(w * canais * prof / 8);
  const cru = unzlibSync(junto, { out: new Uint8Array((linha + 1) * h) });
  // desfaz os filtros linha a linha
  const dados = new Uint8Array(linha * h);
  for (let y = 0; y < h; y++) {
    const f = cru[y * (linha + 1)], src = cru.subarray(y * (linha + 1) + 1, (y + 1) * (linha + 1)), dst = dados.subarray(y * linha, (y + 1) * linha), ant = y ? dados.subarray((y - 1) * linha, y * linha) : null;
    for (let i = 0; i < linha; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0, b = ant ? ant[i] : 0, c = ant && i >= bpp ? ant[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      dst[i] = v & 255;
    }
  }
  const px = new Uint8ClampedArray(w * h * 4);
  const amostra = (y, x, c) => {             // canal c do pixel (8 bits)
    if (prof === 16) return dados[y * linha + (x * canais + c) * 2];
    if (prof === 8) return dados[y * linha + x * canais + c];
    const bitsPorPx = prof, pos = x * bitsPorPx, byte = dados[y * linha + (pos >> 3)], sh = 8 - bitsPorPx - (pos & 7);
    return (byte >> sh) & ((1 << bitsPorPx) - 1);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o4 = (y * w + x) * 4;
    if (tipo === 3) {
      const k = amostra(y, x, 0);
      px[o4] = paleta[k * 3]; px[o4 + 1] = paleta[k * 3 + 1]; px[o4 + 2] = paleta[k * 3 + 2]; px[o4 + 3] = trns && k < trns.length ? trns[k] : 255;
    } else if (tipo === 0 || tipo === 4) {
      let g = amostra(y, x, 0); if (prof < 8) g = Math.round(g * 255 / ((1 << prof) - 1));
      px[o4] = px[o4 + 1] = px[o4 + 2] = g; px[o4 + 3] = tipo === 4 ? amostra(y, x, 1) : 255;
    } else {
      px[o4] = amostra(y, x, 0); px[o4 + 1] = amostra(y, x, 1); px[o4 + 2] = amostra(y, x, 2); px[o4 + 3] = tipo === 6 ? amostra(y, x, 3) : 255;
    }
  }
  return { largura: w, altura: h, px };
}

// RGBA -> PNG (prévias devolvidas pro Claude)
const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (a, b) => { let c = 0xFFFFFFFF; for (const u of [a, b]) for (let i = 0; i < u.length; i++) c = TAB[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function escreverPNG(px, w, h) {
  const cru = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) cru.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const pedaco = (tipo, d) => { const t = new TextEncoder().encode(tipo), o = new Uint8Array(12 + d.length), v = new DataView(o.buffer); v.setUint32(0, d.length); o.set(t, 4); o.set(d, 8); v.setUint32(8 + d.length, crc(t, d)); return o; };
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer); v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const partes = [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pedaco('IHDR', ihdr), pedaco('IDAT', zlibSync(cru, { level: 6 })), pedaco('IEND', new Uint8Array(0))];
  const out = new Uint8Array(partes.reduce((a, b) => a + b.length, 0)); let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

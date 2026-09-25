// PNG RGBA mínimo (pra salvar as "fotos" de teste e o usuário ver)
import { zlibSync } from 'fflate';
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

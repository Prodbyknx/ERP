// STL: só geometria (sem unidade, sem material). Unidade assumida: mm.
// Cor por faceta só é lida quando o arquivo segue um dos dois padrões
// conhecidos (VisCAM/SolidView ou Materialise "COLOR="); fora disso o atributo
// é lixo de exportador e é ignorado — não inventamos cor.
import { deSopa, normaisFace } from '../malha.js';
import { rgbParaHex } from '../cores.js';

function u8de(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}

export function ehBinario(u8) {
  if (u8.length < 84) return false;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 === u8.length) return true;
  // alguns exportadores deixam lixo no fim; se não parece texto, é binário
  const cab = new TextDecoder().decode(u8.subarray(0, Math.min(512, u8.length)));
  if (/^\s*solid\b/.test(cab) && /facet\s+normal/.test(new TextDecoder().decode(u8.subarray(0, Math.min(4096, u8.length))))) return false;
  // não é texto: binário — mesmo CORTADO (download incompleto tem menos
  // triângulos que o cabeçalho diz; antes caía na leitura de texto e dava
  // "não tem nenhum triângulo")
  return n > 0 && u8.length >= 84 + 50;
}

export function lerSTL(buf, nomeArquivo) {
  const u8 = u8de(buf);
  let res;
  if (ehBinario(u8)) res = lerBinario(u8);
  else res = lerTexto(new TextDecoder().decode(u8));
  if (!res.malha.idx.length) throw new Error('O STL não tem nenhum triângulo.');
  res.nome = res.nome || (nomeArquivo || 'modelo').replace(/\.[^.]+$/, '');
  return res;
}

function lerBinario(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const declarado = dv.getUint32(80, true), cabem = Math.floor((u8.length - 84) / 50);
  const n = Math.min(declarado, cabem);
  const avisos = declarado > cabem ? ['O STL está incompleto: tem ' + cabem.toLocaleString('pt-BR') + ' de ' + declarado.toLocaleString('pt-BR') + ' triângulos (download cortado?). Abri o que veio — confira a peça.'] : [];
  const cab = new TextDecoder('latin1').decode(u8.subarray(0, 80));
  const sopa = new Float32Array(n * 9);
  const attr = new Uint16Array(n);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12; // normal gravada: recalculamos, não confiamos nela
    for (let k = 0; k < 9; k++) { sopa[t * 9 + k] = dv.getFloat32(o, true); o += 4; }
    attr[t] = dv.getUint16(o, true); o += 2;
  }
  // bytes que não são um modelo (arquivo errado/corrompido): coordenada NaN,
  // infinita ou absurda em boa parte -> recusa em vez de abrir lixo
  let ruins = 0;
  for (let i = 0; i < sopa.length; i++) { const v = sopa[i]; if (!Number.isFinite(v) || Math.abs(v) > 1e6) ruins++; }
  if (sopa.length && ruins > sopa.length * 0.01) throw new Error('Não consegui ler esse STL: o conteúdo não parece um modelo 3D (arquivo corrompido ou não é STL).');
  // cores por faceta
  let paleta = null, cor = null;
  const magics = cab.indexOf('COLOR=');
  let todosViscam = n > 0;
  for (let t = 0; t < n && todosViscam; t++) if (!(attr[t] & 0x8000)) todosViscam = false;
  if (magics >= 0 || todosViscam) {
    let padrao = null;
    if (magics >= 0 && magics + 10 <= 80) padrao = rgbParaHex([u8[magics + 6], u8[magics + 7], u8[magics + 8]]);
    const idxCor = new Map();
    paleta = []; cor = new Uint16Array(n);
    const ex5 = v => (v << 3) | (v >> 2);
    for (let t = 0; t < n; t++) {
      const a = attr[t];
      let hex;
      if (magics >= 0) {
        hex = (a & 0x8000) ? padrao : rgbParaHex([ex5(a & 31), ex5((a >> 5) & 31), ex5((a >> 10) & 31)]);
      } else {
        hex = rgbParaHex([ex5((a >> 10) & 31), ex5((a >> 5) & 31), ex5(a & 31)]);
      }
      if (!hex) hex = padrao || '#B4BAC4';
      let k = idxCor.get(hex);
      if (k === undefined) { k = paleta.length; paleta.push(hex); idxCor.set(hex, k); }
      cor[t] = k;
    }
    if (paleta.length < 2) { cor = null; }
  }
  const malha = deSopa(sopa, cor);
  const nome = cab.replace(/^solid\s*/i, '').replace(/COLOR=.*$/s, '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 60);
  return { malha, paleta: cor ? paleta : null, cor: paleta && !cor ? paleta[0] : null, nome: /[A-Za-z0-9]/.test(nome) ? nome : '', avisos };
}

function lerTexto(txt) {
  const nomeM = /^\s*solid[ \t]*([^\r\n]*)/.exec(txt);
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(txt))) vals.push(+m[1], +m[2], +m[3]);
  const nt = Math.floor(vals.length / 9);
  const sopa = new Float64Array(nt * 9);
  for (let i = 0; i < nt * 9; i++) sopa[i] = vals[i];
  return { malha: deSopa(sopa), paleta: null, nome: nomeM ? nomeM[1].trim().slice(0, 60) : '' };
}

// STL binário. As coordenadas vão em float32 (o formato não tem outra opção);
// a normal é calculada dos vértices já arredondados, então bate com a face.
export function escreverSTL(malha, nome) {
  const nt = malha.idx.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  const cab = ('144 Laboratorio 3D - ' + (nome || 'peca') + ' - unidade: mm').slice(0, 80);
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < cab.length ? cab.charCodeAt(i) & 0x7f : 32);
  dv.setUint32(80, nt, true);
  const f = new Float32Array(9);
  let o = 84;
  const p = malha.pos, idx = malha.idx;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k] * 3;
      f[k * 3] = p[v]; f[k * 3 + 1] = p[v + 1]; f[k * 3 + 2] = p[v + 2];
    }
    const ux = f[3] - f[0], uy = f[4] - f[1], uz = f[5] - f[2];
    const vx = f[6] - f[0], vy = f[7] - f[1], vz = f[8] - f[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true);
    o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, f[k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  void normaisFace;
  return new Uint8Array(buf);
}

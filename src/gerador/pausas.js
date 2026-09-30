// PAUSAS NO ARQUIVO FATIADO (impressora sem AMS): recebe o .gcode.3mf que o
// Bambu Studio exporta ("Exportar arquivo fatiado da placa") ou um .gcode e
// põe a pausa de troca de filamento (ou de colocar a tag NFC) no começo da
// camada certa — igual o próprio Bambu faz quando se clica "Adicionar pausa":
// "; PAUSE_PRINTING" + o G-code de pausa da impressora (M400 U1 nas Bambu),
// logo depois da troca de camada. A pausa é achada pela ALTURA (mm), não pelo
// número da camada: vale pra qualquer altura de camada. O MD5 que acompanha o
// G-code dentro do 3MF é recalculado.
import { lerZip, escreverZip, texto as u8Texto, bytes as textoU8 } from '../estudio3d/core/formatos/zip.js';

/* ------------------------------------------------------------ MD5 (RFC 1321) */
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const T = new Int32Array(64).map((_, i) => (Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
export function md5(u8) {
  const n = u8.length, total = ((n + 8) >>> 6 << 6) + 64;
  const buf = new Uint8Array(total);
  buf.set(u8); buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (n * 8) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(n / 536870912) >>> 0, true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let o = 0; o < total; o += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(o + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + T[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  let h = '';
  for (const v of [a0, b0, c0, d0]) for (let k = 0; k < 4; k++) h += ((v >>> (8 * k)) & 255).toString(16).padStart(2, '0');
  return h.toUpperCase();
}

/* ------------------------------------------------------------ G-code */
// camadas: [{z, altura, iChange (linha do "; CHANGE_LAYER"), iPos (onde a pausa entra), temPausa}]
export function camadasDoGcode(linhas) {
  const camadas = [];
  for (let i = 0; i < linhas.length; i++) {
    if (!linhas[i].startsWith('; CHANGE_LAYER')) continue;
    const c = { iChange: i, z: null, altura: null, iPos: -1, temPausa: false };
    let iAposCabecalho = i;
    // o cabeçalho da camada: Z_HEIGHT / LAYER_HEIGHT logo abaixo
    for (let j = i + 1; j < Math.min(linhas.length, i + 6); j++) {
      const l = linhas[j];
      let m = /^; Z_HEIGHT:\s*([-\d.]+)/.exec(l); if (m) { c.z = parseFloat(m[1]); iAposCabecalho = j; continue; }
      m = /^; LAYER_HEIGHT:\s*([-\d.]+)/.exec(l); if (m) { c.altura = parseFloat(m[1]); iAposCabecalho = j; continue; }
    }
    // a pausa do Bambu sai logo depois do G-code de troca de camada (o
    // "M991 S0 P.." que avisa a impressora), antes de ir pra peça
    let k = iAposCabecalho + 1, fim = linhas.length;
    for (; k < linhas.length; k++) {
      const l = linhas[k];
      if (l.startsWith('; CHANGE_LAYER') || l.startsWith('; FEATURE:')) { fim = k; break; }
      if (l.startsWith('; PAUSE_PRINTING')) c.temPausa = true;
      if (/^M991\s+S0\s+P/.test(l) && c.iPos < 0) c.iPos = k + 1;
    }
    if (c.iPos < 0) c.iPos = Math.min(iAposCabecalho + 1, fim);
    if (c.z != null) camadas.push(c);
  }
  return camadas;
}

function pausarTexto(g, pausas, codigoPausa) {
  const linhas = g.split('\n');
  const camadas = camadasDoGcode(linhas);
  if (!camadas.length) return { erro: 'Não achei as camadas no G-code (não parece fatiado pelo Bambu Studio/Orca).' };
  const feitas = [], avisos = [];
  const inserir = new Map();     // índice da linha -> bloco
  for (const p of pausas.filter(x => x.z > 0).sort((a, b) => a.z - b.z)) {
    // a camada que imprime logo ACIMA da altura da troca (em impressão
    // sequencial, uma por objeto: toda vez que a altura passa por ela)
    const alvo = [];
    camadas.forEach((c, i) => { if (c.z > p.z + 1e-3 && (i === 0 || camadas[i - 1].z <= p.z + 1e-3)) alvo.push(i); });
    if (!alvo.length) { avisos.push('A pausa em ' + p.z.toFixed(2) + ' mm fica acima da peça (' + camadas[camadas.length - 1].z.toFixed(2) + ' mm): não entrou.'); continue; }
    for (const i of alvo) {
      const c = camadas[i];
      if (c.temPausa || inserir.has(c.iPos)) { feitas.push({ ...p, camada: i + 1, zCamada: c.z, jaTinha: true }); continue; }
      inserir.set(c.iPos, '; PAUSE_PRINTING\n' + (p.texto ? '; ' + p.texto.replace(/[\r\n]+/g, ' ') + '\n' : '') + codigoPausa.replace(/\r/g, '').replace(/\n+$/, ''));
      feitas.push({ ...p, camada: i + 1, zCamada: c.z });
    }
  }
  if (!inserir.size) return { texto: g, feitas, avisos };
  const out = [];
  for (let i = 0; i < linhas.length; i++) { if (inserir.has(i)) out.push(inserir.get(i)); out.push(linhas[i]); }
  return { texto: out.join('\n'), feitas, avisos, total: camadas.length };
}

/**
 * pausar(bytes, pausas, opc) -> { bytes, formato:'3mf'|'gcode', feitas:[{z, camada, zCamada, texto}], avisos, impressora }
 * bytes: .gcode.3mf (zip) ou .gcode (texto). pausas: [{z (mm, onde a cor nova começa), texto}]
 */
export function pausar(bytes, pausas, opc = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!pausas || !pausas.length) return { erro: 'Nenhuma pausa pra colocar.' };
  const ehZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (!ehZip) {
    const g = u8Texto(u8);
    const r = pausarTexto(g, pausas, opc.codigoPausa || 'M400 U1');
    if (r.erro) return r;
    return { bytes: textoU8(r.texto), formato: 'gcode', feitas: r.feitas, avisos: r.avisos };
  }
  let arq;
  try { arq = lerZip(u8); } catch (e) { return { erro: 'Não consegui abrir o arquivo (zip quebrado?).' }; }
  const placas = Object.keys(arq).filter(k => /^Metadata\/plate_\d+\.gcode$/.test(k)).sort();
  if (!placas.length) return { erro: 'Esse 3MF não está fatiado. No Bambu Studio: fatie a placa e use "Exportar arquivo fatiado da placa" (.gcode.3mf).' };
  let codigoPausa = opc.codigoPausa || null, impressora = null;
  const proj = arq['Metadata/project_settings.config'];
  if (proj) {
    try {
      const j = JSON.parse(u8Texto(proj));
      if (!codigoPausa && typeof j.machine_pause_gcode === 'string' && j.machine_pause_gcode.trim()) codigoPausa = j.machine_pause_gcode;
      impressora = j.printer_model || j.printer_settings_id || null;
    } catch (e) { /* segue com o padrão */ }
  }
  codigoPausa = codigoPausa || 'M400 U1';
  const feitas = [], avisos = [];
  for (const k of placas) {
    const r = pausarTexto(u8Texto(arq[k]), pausas, codigoPausa);
    if (r.erro) return r;
    const g = textoU8(r.texto);
    arq[k] = g;
    if (arq[k + '.md5']) arq[k + '.md5'] = textoU8(md5(g));
    for (const f of r.feitas) feitas.push({ ...f, placa: +/plate_(\d+)/.exec(k)[1] });
    for (const a of r.avisos) if (!avisos.includes(a)) avisos.push(a);
  }
  // mesma ordem de antes; G-code comprimido, o resto como veio
  const saida = escreverZip(Object.keys(arq).map(nome => ({ nome, dados: arq[nome], nivel: /\.(png|jpe?g)$/i.test(nome) ? 0 : 6 })));
  return { bytes: saida, formato: '3mf', feitas, avisos, impressora, codigoPausa };
}

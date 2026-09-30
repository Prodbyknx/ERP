// QR Code (modo byte, correção M, versões 1 a 10) sem dependência — pro
// verso do chaveiro (link do Instagram, WhatsApp, site). Segue a norma
// ISO/IEC 18004: Reed-Solomon em GF(256), padrões fixos, máscara com menor
// penalidade. Devolve a grade: true = módulo escuro.
const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];        // códigos de correção por bloco
const BLOCOS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];               // blocos por versão
const FORMATO_M = 0;                                                // bits do nível M

function modulosCrus(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const palavrasDados = v => Math.floor(modulosCrus(v) / 8) - ECC_M[v] * BLOCOS_M[v];

function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function divisor(grau) {
  const r = new Array(grau - 1).fill(0); r.push(1);
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], raiz); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    raiz = mul(raiz, 2);
  }
  return r;
}
function resto(dados, div) {
  const r = div.map(() => 0);
  for (const b of dados) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= mul(c, f); });
  }
  return r;
}

export function gerarQR(texto) {
  const bytes = [...new TextEncoder().encode(String(texto))];
  let v = 1;
  for (; v <= 10; v++) if (4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= palavrasDados(v) * 8) break;
  if (v > 10) throw new Error('Texto longo demais pro QR do chaveiro (máximo ~200 letras).');
  // bits: modo byte (0100) + tamanho + dados + terminador + enchimento
  const bits = [];
  const por = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  por(4, 4); por(bytes.length, v <= 9 ? 8 : 16); bytes.forEach(b => por(b, 8));
  const cap = palavrasDados(v) * 8;
  por(0, Math.min(4, cap - bits.length));
  por(0, (8 - bits.length % 8) % 8);
  for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) por(p, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; dados.push(b); }
  // blocos + correção, intercalados
  const nb = BLOCOS_M[v], ecc = ECC_M[v], cru = Math.floor(modulosCrus(v) / 8);
  const curtos = nb - cru % nb, tamCurto = Math.floor(cru / nb), div = divisor(ecc);
  const blocos = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = dados.slice(k, k + tamCurto - ecc + (i < curtos ? 0 : 1)); k += d.length;
    const e = resto(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(e));
  }
  const final = [];
  for (let i = 0; i < blocos[0].length; i++) blocos.forEach((b, j) => { if (i !== tamCurto - ecc || j >= curtos) final.push(b[i]); });

  const N = v * 4 + 17;
  const mod = Array.from({ length: N }, () => new Array(N).fill(false));
  const fixo = Array.from({ length: N }, () => new Array(N).fill(false));
  const pos = (x, y, escuro) => { mod[y][x] = escuro; fixo[y][x] = true; };
  for (let i = 0; i < N; i++) { pos(6, i, i % 2 === 0); pos(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [N - 4, 3], [3, N - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy)); pos(x, y, d !== 2 && d !== 4);
    }
  }
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2, passo = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const ps = [6]; for (let p = N - 7; ps.length < n; p -= passo) ps.splice(1, 0, p);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) pos(ps[i] + dx, ps[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const formato = mascara => {
    const d = (FORMATO_M << 3) | mascara; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) pos(8, i, bit(i));
    pos(8, 7, bit(6)); pos(8, 8, bit(7)); pos(7, 8, bit(8));
    for (let i = 9; i < 15; i++) pos(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) pos(N - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) pos(8, N - 15 + i, bit(i));
    pos(8, N - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) === 1, a = N - 11 + i % 3, c = Math.floor(i / 3); pos(a, c, bit); pos(c, a, bit); }
  }
  // dados em zigue-zague
  let i = 0;
  for (let dir = N - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < N; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j, sobe = ((dir + 1) & 2) === 0, y = sobe ? N - 1 - vert : vert;
      if (!fixo[y][x] && i < final.length * 8) { mod[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const MASCARAS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const aplicar = m => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!fixo[y][x] && MASCARAS[m](x, y)) mod[y][x] = !mod[y][x]; };
  // penalidade (regras 1, 2 e 4 da norma): escolhe a máscara mais legível
  const penalidade = () => {
    let p = 0, escuros = 0;
    for (let y = 0; y < N; y++) for (const hor of [true, false]) {
      let cor = null, run = 0;
      for (let k = 0; k < N; k++) {
        const c = hor ? mod[y][k] : mod[k][y];
        if (c === cor) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { cor = c; run = 1; }
      }
    }
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mod[y][x]) escuros++;
    return p + Math.floor(Math.abs(escuros * 20 - N * N * 10) / (N * N)) * 10;
  };
  let melhor = 0, pm = Infinity;
  for (let m = 0; m < 8; m++) { aplicar(m); formato(m); const p = penalidade(); if (p < pm) { pm = p; melhor = m; } aplicar(m); }
  aplicar(melhor); formato(melhor);
  return { versao: v, tamanho: N, modulos: mod };
}

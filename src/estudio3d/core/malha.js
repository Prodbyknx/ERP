// Malha indexada em MILÍMETROS.
//   pos: Float64Array(3 * nV)   idx: Uint32Array(3 * nT)
//   cor: Uint16Array(nT) opcional — índice na paleta da peça, por triângulo
// Toda operação que cria/remove triângulo leva 'cor' junto.
import { determinante } from './mat4.js';

export function criar(pos, idx, cor) {
  const m = {
    pos: pos instanceof Float64Array ? pos : Float64Array.from(pos),
    idx: idx instanceof Uint32Array ? idx : Uint32Array.from(idx)
  };
  if (cor) m.cor = cor instanceof Uint16Array ? cor : Uint16Array.from(cor);
  return m;
}

export const nV = m => m.pos.length / 3;
export const nT = m => m.idx.length / 3;

export function clonar(m) {
  return criar(Float64Array.from(m.pos), Uint32Array.from(m.idx), m.cor ? Uint16Array.from(m.cor) : null);
}

export function caixa(m) {
  const n = m.pos.length;
  if (!n) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const p = m.pos;
  // só os vértices usados de verdade
  const idx = m.idx;
  if (idx.length) {
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i] * 3, x = p[v], y = p[v + 1], z = p[v + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  } else return null;
  return { min: [x0, y0, z0], max: [x1, y1, z1], tam: [x1 - x0, y1 - y0, z1 - z0] };
}

export function juntarCaixas(a, b) {
  if (!a) return b; if (!b) return a;
  const min = [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])];
  const max = [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])];
  return { min, max, tam: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export function volume(m) {
  const p = m.pos, idx = m.idx;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[c + 1] * p[b + 2])
       - p[b] * (p[a + 1] * p[c + 2] - p[c + 1] * p[a + 2])
       + p[c] * (p[a + 1] * p[b + 2] - p[b + 1] * p[a + 2]);
  }
  return v / 6;
}

export function areaFace(m, t) {
  const p = m.pos, i = m.idx;
  const a = i[t * 3] * 3, b = i[t * 3 + 1] * 3, c = i[t * 3 + 2] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

export function area(m) {
  let s = 0;
  for (let t = 0; t < m.idx.length / 3; t++) s += areaFace(m, t);
  return s;
}

// normal unitária de cada face (0,0,0 se degenerada)
export function normaisFace(m) {
  const p = m.pos, idx = m.idx, nt = idx.length / 3;
  const out = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L > 0) { nx /= L; ny /= L; nz /= L; }
    out[t * 3] = nx; out[t * 3 + 1] = ny; out[t * 3 + 2] = nz;
  }
  return out;
}

export function centroidesFace(m) {
  const p = m.pos, idx = m.idx, nt = idx.length / 3;
  const out = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    out[t * 3] = (p[a] + p[b] + p[c]) / 3;
    out[t * 3 + 1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    out[t * 3 + 2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  }
  return out;
}

// Aplica a matriz nos vértices. Se a matriz espelha (det < 0), inverte a
// ordem dos triângulos — senão a peça sai "do avesso" no fatiador.
export function transformar(m, mat) {
  const n = m.pos.length, p = new Float64Array(n), s = m.pos;
  for (let i = 0; i < n; i += 3) {
    const x = s[i], y = s[i + 1], z = s[i + 2];
    p[i] = mat[0] * x + mat[4] * y + mat[8] * z + mat[12];
    p[i + 1] = mat[1] * x + mat[5] * y + mat[9] * z + mat[13];
    p[i + 2] = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
  }
  let idx = m.idx;
  if (determinante(mat) < 0) idx = inverterOrdem(m.idx);
  return criar(p, idx === m.idx ? Uint32Array.from(idx) : idx, m.cor ? Uint16Array.from(m.cor) : null);
}

export function inverterOrdem(idx) {
  const out = Uint32Array.from(idx);
  for (let t = 0; t < out.length; t += 3) { const x = out[t + 1]; out[t + 1] = out[t + 2]; out[t + 2] = x; }
  return out;
}

export function inverterFaces(m) {
  return criar(Float64Array.from(m.pos), inverterOrdem(m.idx), m.cor ? Uint16Array.from(m.cor) : null);
}

export function transladar(m, dx, dy, dz) {
  const p = Float64Array.from(m.pos);
  for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; }
  return criar(p, Uint32Array.from(m.idx), m.cor ? Uint16Array.from(m.cor) : null);
}

// Junta várias malhas numa só (sem soldar). corBase: índice de cor por malha
// quando a malha não tem cor por triângulo.
export function juntar(lista, coresBase) {
  let nv = 0, ni = 0, temCor = false;
  lista.forEach((m, k) => { nv += m.pos.length; ni += m.idx.length; if (m.cor || coresBase) temCor = true; });
  const pos = new Float64Array(nv), idx = new Uint32Array(ni), cor = temCor ? new Uint16Array(ni / 3) : null;
  let ov = 0, oi = 0;
  lista.forEach((m, k) => {
    pos.set(m.pos, ov);
    const base = ov / 3;
    for (let i = 0; i < m.idx.length; i++) idx[oi + i] = m.idx[i] + base;
    if (cor) {
      const f0 = oi / 3, nt = m.idx.length / 3;
      for (let t = 0; t < nt; t++) cor[f0 + t] = m.cor ? m.cor[t] : (coresBase ? coresBase[k] : 0);
    }
    ov += m.pos.length; oi += m.idx.length;
  });
  return criar(pos, idx, cor);
}

// Pega só as faces pedidas e renumera os vértices usados.
// faces: array/typed array de índices OU máscara Uint8Array(nT)
export function subMalha(m, faces) {
  const nt = m.idx.length / 3;
  let lista = faces;
  if (faces instanceof Uint8Array && faces.length === nt) {
    let c = 0; for (let t = 0; t < nt; t++) if (faces[t]) c++;
    lista = new Uint32Array(c); c = 0;
    for (let t = 0; t < nt; t++) if (faces[t]) lista[c++] = t;
  }
  const mapa = new Int32Array(m.pos.length / 3).fill(-1);
  const idx = new Uint32Array(lista.length * 3);
  let nv = 0;
  for (let k = 0; k < lista.length; k++) {
    const t = lista[k];
    for (let j = 0; j < 3; j++) {
      const v = m.idx[t * 3 + j];
      if (mapa[v] < 0) mapa[v] = nv++;
      idx[k * 3 + j] = mapa[v];
    }
  }
  const pos = new Float64Array(nv * 3);
  for (let v = 0; v < mapa.length; v++) {
    const n = mapa[v];
    if (n >= 0) { pos[n * 3] = m.pos[v * 3]; pos[n * 3 + 1] = m.pos[v * 3 + 1]; pos[n * 3 + 2] = m.pos[v * 3 + 2]; }
  }
  let cor = null;
  if (m.cor) { cor = new Uint16Array(lista.length); for (let k = 0; k < lista.length; k++) cor[k] = m.cor[lista[k]]; }
  return { malha: criar(pos, idx, cor), faces: lista, mapaV: mapa };
}

export function compactar(m) {
  const nt = m.idx.length / 3;
  const todas = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) todas[t] = t;
  return subMalha(m, todas).malha;
}

// Sopa de triângulos (9 números por triângulo) -> indexada, soldando só
// vértices com coordenadas IDÊNTICAS (sem perder nada). É o que STL pede.
export function deSopa(sopa, cor) {
  const nt = Math.floor(sopa.length / 9), nc = nt * 3;
  // compara os BITS do número (igualdade exata), tabela hash aberta
  const palavras = sopa instanceof Float32Array ? 3 : 6;
  const bits = new Uint32Array(sopa.buffer, sopa.byteOffset, nc * palavras);
  let cap = 1; while (cap < nc * 2) cap <<= 1;
  const tab = new Int32Array(cap).fill(-1);
  const primeiro = new Int32Array(nc);     // canto que originou cada vértice novo
  const idx = new Uint32Array(nc);
  let nv = 0;
  for (let i = 0; i < nc; i++) {
    const o = i * palavras;
    let h = 2166136261;
    for (let w = 0; w < palavras; w++) { h ^= bits[o + w]; h = Math.imul(h, 16777619); }
    let s = (h >>> 0) & (cap - 1);
    while (true) {
      const v = tab[s];
      if (v < 0) { tab[s] = nv; primeiro[nv] = i; idx[i] = nv++; break; }
      const q = primeiro[v] * palavras;
      let igual = true;
      for (let w = 0; w < palavras; w++) if (bits[q + w] !== bits[o + w]) { igual = false; break; }
      if (igual) { idx[i] = v; break; }
      s = (s + 1) & (cap - 1);
    }
  }
  const pos = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const i = primeiro[v];
    pos[v * 3] = sopa[i * 3]; pos[v * 3 + 1] = sopa[i * 3 + 1]; pos[v * 3 + 2] = sopa[i * 3 + 2];
  }
  return criar(pos, idx, cor || null);
}

// Solda vértices a menos de 'tol' mm (grade + 27 vizinhos, sem falso-negativo
// na borda da célula). Devolve { malha, mapa, fundidos }.
export function soldar(m, tol = 1e-4) {
  const nv = m.pos.length / 3, p = m.pos;
  // célula = 4·tol: só olha a vizinha quando o ponto está a menos de tol da
  // divisa (~3 consultas por vértice em vez de 27). Perto de mais de um
  // representante: fica com o de menor índice
  const inv = 1 / (4 * tol);
  const grade = new Map();
  const rep = new Int32Array(nv);
  const novoIdx = new Int32Array(nv).fill(-1);
  const pos = [];
  let fundidos = 0;
  const tol2 = tol * tol;
  const chave = (i, j, k) => i * 73856093 ^ j * 19349663 ^ k * 83492791;
  const faixa = (c, x) => { const f = x * inv - c; return f < 0.25 ? -1 : f > 0.75 ? 1 : 0; };
  for (let v = 0; v < nv; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck = Math.floor(z * inv);
    const fi = faixa(ci, x), fj = faixa(cj, y), fk = faixa(ck, z);
    let achou = -1;
    for (let di = Math.min(0, fi); di <= Math.max(0, fi); di++) for (let dj = Math.min(0, fj); dj <= Math.max(0, fj); dj++) for (let dk = Math.min(0, fk); dk <= Math.max(0, fk); dk++) {
      const l = grade.get(chave(ci + di, cj + dj, ck + dk));
      if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const u = l[q];
        if (achou >= 0 && u >= achou) break;
        const dx = pos[u * 3] - x, dy = pos[u * 3 + 1] - y, dz = pos[u * 3 + 2] - z;
        if (dx * dx + dy * dy + dz * dz <= tol2) { achou = u; break; }
      }
    }
    if (achou >= 0) { rep[v] = achou; fundidos++; continue; }
    const n = pos.length / 3;
    pos.push(x, y, z);
    rep[v] = n;
    const ch = chave(ci, cj, ck);
    const l = grade.get(ch);
    if (l) l.push(n); else grade.set(ch, [n]);
  }
  void novoIdx;
  const idx = new Uint32Array(m.idx.length);
  for (let i = 0; i < idx.length; i++) idx[i] = rep[m.idx[i]];
  return { malha: criar(Float64Array.from(pos), idx, m.cor ? Uint16Array.from(m.cor) : null), mapa: rep, fundidos };
}

// Remove triângulos (por máscara) — carrega a cor junto
export function semFaces(m, remover) {
  const nt = m.idx.length / 3;
  let c = 0;
  for (let t = 0; t < nt; t++) if (!remover[t]) c++;
  const idx = new Uint32Array(c * 3);
  const cor = m.cor ? new Uint16Array(c) : null;
  c = 0;
  for (let t = 0; t < nt; t++) {
    if (remover[t]) continue;
    idx[c * 3] = m.idx[t * 3]; idx[c * 3 + 1] = m.idx[t * 3 + 1]; idx[c * 3 + 2] = m.idx[t * 3 + 2];
    if (cor) cor[c] = m.cor[t];
    c++;
  }
  return criar(m.pos, idx, cor);
}

// Menor distância entre vértices distintos que COMPARTILHAM face — base pra
// escolher a tolerância de solda sem colar detalhe fino.
export function menorAresta(m) {
  const p = m.pos, idx = m.idx;
  let menor = Infinity, soma = 0, n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = idx[t + j] * 3, b = idx[t + (j + 1) % 3] * 3;
      if (a === b) continue;
      const d = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
      if (d > 0 && d < menor) menor = d;
      soma += d; n++;
    }
  }
  return { menor: isFinite(menor) ? menor : 0, media: n ? soma / n : 0 };
}

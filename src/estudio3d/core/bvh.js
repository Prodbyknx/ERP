// BVH de triângulos em arrays tipados (sem three.js — roda no worker).
// Divisão por SAH em baldes. Folhas com até 8 triângulos.

const FOLHA = 8;
const BALDES = 12;

export function construirBVH(m) {
  const p = m.pos, idx = m.idx, nt = idx.length / 3;
  const cx = new Float32Array(nt * 3);             // centroides
  const bb = new Float32Array(nt * 6);             // caixa de cada triângulo
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) {
      const va = p[a + k], vb = p[b + k], vc = p[c + k];
      const mn = Math.min(va, vb, vc), mx = Math.max(va, vb, vc);
      bb[t * 6 + k] = mn; bb[t * 6 + 3 + k] = mx;
      cx[t * 3 + k] = (mn + mx) * 0.5;
    }
  }
  const ordem = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) ordem[t] = t;
  const maxNos = Math.max(1, 2 * Math.ceil(nt / (FOLHA / 2)) + 1);
  let caixas = new Float32Array(maxNos * 6);
  let filhoOuInicio = new Int32Array(maxNos);      // interno: índice do filho esquerdo; folha: início
  let contagem = new Int32Array(maxNos);           // folha: nº de triângulos; interno: -1
  let nNos = 0;

  const novoNo = () => {
    if (nNos >= contagem.length) {
      const n = contagem.length * 2;
      const c2 = new Float32Array(n * 6); c2.set(caixas); caixas = c2;
      const f2 = new Int32Array(n); f2.set(filhoOuInicio); filhoOuInicio = f2;
      const k2 = new Int32Array(n); k2.set(contagem); contagem = k2;
    }
    return nNos++;
  };
  const bCont = new Int32Array(BALDES), bCaixa = new Float32Array(BALDES * 6);
  const esqA = new Float32Array(BALDES), esqN = new Int32Array(BALDES);

  const pilha = [[novoNo(), 0, nt]];
  while (pilha.length) {
    const [no, ini, fim] = pilha.pop();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity;
    for (let i = ini; i < fim; i++) {
      const t = ordem[i], o = t * 6;
      if (bb[o] < x0) x0 = bb[o]; if (bb[o + 1] < y0) y0 = bb[o + 1]; if (bb[o + 2] < z0) z0 = bb[o + 2];
      if (bb[o + 3] > x1) x1 = bb[o + 3]; if (bb[o + 4] > y1) y1 = bb[o + 4]; if (bb[o + 5] > z1) z1 = bb[o + 5];
      const q = t * 3;
      if (cx[q] < c0x) c0x = cx[q]; if (cx[q] > c1x) c1x = cx[q];
      if (cx[q + 1] < c0y) c0y = cx[q + 1]; if (cx[q + 1] > c1y) c1y = cx[q + 1];
      if (cx[q + 2] < c0z) c0z = cx[q + 2]; if (cx[q + 2] > c1z) c1z = cx[q + 2];
    }
    const o6 = no * 6;
    caixas[o6] = x0; caixas[o6 + 1] = y0; caixas[o6 + 2] = z0; caixas[o6 + 3] = x1; caixas[o6 + 4] = y1; caixas[o6 + 5] = z1;
    const n = fim - ini;
    if (n <= FOLHA) { filhoOuInicio[no] = ini; contagem[no] = n; continue; }
    const ex = c1x - c0x, ey = c1y - c0y, ez = c1z - c0z;
    const eixo = ex >= ey && ex >= ez ? 0 : (ey >= ez ? 1 : 2);
    const cmin = eixo === 0 ? c0x : eixo === 1 ? c0y : c0z;
    const ext = eixo === 0 ? ex : eixo === 1 ? ey : ez;
    let meio;
    if (ext <= 0) meio = (ini + fim) >> 1;
    else {
      bCont.fill(0);
      for (let b = 0; b < BALDES; b++) { bCaixa[b * 6] = bCaixa[b * 6 + 1] = bCaixa[b * 6 + 2] = Infinity; bCaixa[b * 6 + 3] = bCaixa[b * 6 + 4] = bCaixa[b * 6 + 5] = -Infinity; }
      const k = BALDES / ext;
      for (let i = ini; i < fim; i++) {
        const t = ordem[i];
        let b = Math.floor((cx[t * 3 + eixo] - cmin) * k); if (b >= BALDES) b = BALDES - 1;
        bCont[b]++;
        const o = t * 6, q = b * 6;
        for (let j = 0; j < 3; j++) { if (bb[o + j] < bCaixa[q + j]) bCaixa[q + j] = bb[o + j]; if (bb[o + 3 + j] > bCaixa[q + 3 + j]) bCaixa[q + 3 + j] = bb[o + 3 + j]; }
      }
      const areaDe = (a0, a1, a2, b0, b1, b2) => { const dx = b0 - a0, dy = b1 - a1, dz = b2 - a2; return dx > 0 ? (dx * dy + dy * dz + dz * dx) : 0; };
      let ax0 = Infinity, ay0 = Infinity, az0 = Infinity, ax1 = -Infinity, ay1 = -Infinity, az1 = -Infinity, cnt = 0;
      for (let b = 0; b < BALDES - 1; b++) {
        const q = b * 6;
        if (bCont[b]) {
          ax0 = Math.min(ax0, bCaixa[q]); ay0 = Math.min(ay0, bCaixa[q + 1]); az0 = Math.min(az0, bCaixa[q + 2]);
          ax1 = Math.max(ax1, bCaixa[q + 3]); ay1 = Math.max(ay1, bCaixa[q + 4]); az1 = Math.max(az1, bCaixa[q + 5]);
        }
        cnt += bCont[b];
        esqA[b] = cnt ? areaDe(ax0, ay0, az0, ax1, ay1, az1) : 0; esqN[b] = cnt;
      }
      let melhor = Infinity, corte = -1;
      ax0 = ay0 = az0 = Infinity; ax1 = ay1 = az1 = -Infinity; cnt = 0;
      for (let b = BALDES - 1; b > 0; b--) {
        const q = b * 6;
        if (bCont[b]) {
          ax0 = Math.min(ax0, bCaixa[q]); ay0 = Math.min(ay0, bCaixa[q + 1]); az0 = Math.min(az0, bCaixa[q + 2]);
          ax1 = Math.max(ax1, bCaixa[q + 3]); ay1 = Math.max(ay1, bCaixa[q + 4]); az1 = Math.max(az1, bCaixa[q + 5]);
        }
        cnt += bCont[b];
        const custo = esqN[b - 1] * esqA[b - 1] + cnt * (cnt ? areaDe(ax0, ay0, az0, ax1, ay1, az1) : 0);
        if (esqN[b - 1] > 0 && cnt > 0 && custo < melhor) { melhor = custo; corte = b; }
      }
      if (corte < 0) meio = (ini + fim) >> 1;
      else {
        let i = ini, j = fim - 1;
        while (i <= j) {
          const t = ordem[i];
          let b = Math.floor((cx[t * 3 + eixo] - cmin) * k); if (b >= BALDES) b = BALDES - 1;
          if (b < corte) i++;
          else { ordem[i] = ordem[j]; ordem[j] = t; j--; }
        }
        meio = i;
        if (meio === ini || meio === fim) meio = (ini + fim) >> 1;
      }
    }
    const e = novoNo(), d = novoNo();
    filhoOuInicio[no] = e; contagem[no] = -1;
    pilha.push([d, meio, fim], [e, ini, meio]);
  }
  return { malha: m, ordem, caixas: caixas.subarray(0, nNos * 6), filho: filhoOuInicio.subarray(0, nNos), cont: contagem.subarray(0, nNos), caixasTri: bb };
}

// Raio x triângulo (Möller–Trumbore). Devolve t ou -1.
function raioTri(p, idx, t, ox, oy, oz, dx, dy, dz) {
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-14 && det < 1e-14) return -1;
  const inv = 1 / det;
  const tx = ox - p[a], ty = oy - p[a + 1], tz = oz - p[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

function raioCaixa(cx, o, ox, oy, oz, ix, iy, iz, tmax) {
  let t0 = 0, t1 = tmax;
  let a = (cx[o] - ox) * ix, b = (cx[o + 3] - ox) * ix;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  a = (cx[o + 1] - oy) * iy; b = (cx[o + 4] - oy) * iy;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  a = (cx[o + 2] - oz) * iz; b = (cx[o + 5] - oz) * iz;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > t0) t0 = a; if (b < t1) t1 = b;
  return t0 <= t1;
}

// Primeiro acerto. ignorar: face a pular (a de origem). Devolve {t, face} ou null.
export function lancarRaio(bvh, ox, oy, oz, dx, dy, dz, tmax = Infinity, ignorar = -1, tmin = 1e-9) {
  const p = bvh.malha.pos, idx = bvh.malha.idx;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let melhor = tmax, face = -1;
  const pilha = [0];
  while (pilha.length) {
    const no = pilha.pop();
    if (!raioCaixa(bvh.caixas, no * 6, ox, oy, oz, ix, iy, iz, melhor)) continue;
    const c = bvh.cont[no];
    if (c >= 0) {
      const ini = bvh.filho[no];
      for (let i = ini; i < ini + c; i++) {
        const t = bvh.ordem[i];
        if (t === ignorar) continue;
        const d = raioTri(p, idx, t, ox, oy, oz, dx, dy, dz);
        if (d > tmin && d < melhor) { melhor = d; face = t; }
      }
    } else {
      const e = bvh.filho[no];
      pilha.push(e + 1, e);
    }
  }
  return face >= 0 ? { t: melhor, face } : null;
}

// Todos os acertos ao longo do raio (pra teste dentro/fora por paridade)
export function contarCruzamentos(bvh, ox, oy, oz, dx, dy, dz) {
  const p = bvh.malha.pos, idx = bvh.malha.idx;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const ts = [];
  const pilha = [0];
  while (pilha.length) {
    const no = pilha.pop();
    if (!raioCaixa(bvh.caixas, no * 6, ox, oy, oz, ix, iy, iz, Infinity)) continue;
    const c = bvh.cont[no];
    if (c >= 0) {
      const ini = bvh.filho[no];
      for (let i = ini; i < ini + c; i++) {
        const d = raioTri(p, idx, bvh.ordem[i], ox, oy, oz, dx, dy, dz);
        if (d > 1e-9) ts.push(d);
      }
    } else { const e = bvh.filho[no]; pilha.push(e + 1, e); }
  }
  ts.sort((a, b) => a - b);
  // acertos repetidos na mesma distância (aresta/vértice) contam uma vez
  let n = 0, ult = -1;
  for (const t of ts) { if (t - ult > 1e-7) n++; ult = t; }
  return n;
}

// distâncias de todos os cruzamentos do raio (ordenadas, sem repetir aresta)
export function cruzamentosRaio(bvh, ox, oy, oz, dx, dy, dz) {
  const p = bvh.malha.pos, idx = bvh.malha.idx;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const ts = [];
  const pilha = [0];
  while (pilha.length) {
    const no = pilha.pop();
    if (!raioCaixa(bvh.caixas, no * 6, ox, oy, oz, ix, iy, iz, Infinity)) continue;
    const c = bvh.cont[no];
    if (c >= 0) {
      const ini = bvh.filho[no];
      for (let i = ini; i < ini + c; i++) { const d = raioTri(p, idx, bvh.ordem[i], ox, oy, oz, dx, dy, dz); if (d > 1e-9) ts.push(d); }
    } else { const e = bvh.filho[no]; pilha.push(e + 1, e); }
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (const t of ts) if (!out.length || t - out[out.length - 1] > 1e-7) out.push(t);
  return out;
}

// Ponto dentro do sólido? Voto de 3 raios em direções "tortas" (evita arestas)
export function pontoDentro(bvh, x, y, z) {
  const dirs = [[0.5773, 0.5774, 0.5773], [-0.6123, 0.3536, 0.7071], [0.2673, -0.8018, -0.5345]];
  let dentro = 0;
  for (const d of dirs) if (contarCruzamentos(bvh, x, y, z, d[0], d[1], d[2]) % 2 === 1) dentro++;
  return dentro >= 2;
}

// Visita pares de triângulos cujas caixas se tocam (pra auto-interseção).
// cb(t1, t2) -> true pra parar.
export function paresProximos(bvh, cb) {
  const cxs = bvh.caixas, bb = bvh.caixasTri;
  const sobrepoe = (A, a, B, b) => !(A[a + 3] < B[b] || B[b + 3] < A[a] || A[a + 4] < B[b + 1] || B[b + 4] < A[a + 1] || A[a + 5] < B[b + 2] || B[b + 5] < A[a + 2]);
  const pilha = [0, 0];
  while (pilha.length) {
    const nb = pilha.pop(), na = pilha.pop();
    if (!sobrepoe(cxs, na * 6, cxs, nb * 6)) continue;
    const ca = bvh.cont[na], cb2 = bvh.cont[nb];
    if (ca >= 0 && cb2 >= 0) {
      const ia = bvh.filho[na], ib = bvh.filho[nb];
      for (let i = ia; i < ia + ca; i++) {
        const t1 = bvh.ordem[i];
        for (let j = (na === nb ? i + 1 : ib); j < ib + cb2; j++) {
          const t2 = bvh.ordem[j];
          if (!sobrepoe(bb, t1 * 6, bb, t2 * 6)) continue;
          if (cb(t1, t2)) return;
        }
      }
    } else if (na === nb) {
      const e = bvh.filho[na];
      pilha.push(e, e, e + 1, e + 1, e, e + 1);
    } else if (ca < 0 && (cb2 >= 0 || volumeNo(cxs, na) >= volumeNo(cxs, nb))) {
      const e = bvh.filho[na];
      pilha.push(e, nb, e + 1, nb);
    } else {
      const e = bvh.filho[nb];
      pilha.push(na, e, na, e + 1);
    }
  }
}

function volumeNo(c, n) { const o = n * 6; return (c[o + 3] - c[o]) * (c[o + 4] - c[o + 1]) * (c[o + 5] - c[o + 2]); }

// Quantas outras cascas fechadas envolvem um ponto da casca c (paridade dos
// cruzamentos só com as OUTRAS). Ímpar = c é uma cavidade (vazio por dentro).
export function dentroDeOutras(m, facesDe, c, nComp) {
  const outras = [];
  for (let k = 0; k < nComp; k++) if (k !== c) for (const f of facesDe(k)) outras.push(f);
  if (!outras.length) return 0;
  const idx = new Uint32Array(outras.length * 3);
  outras.forEach((f, i) => { idx[i * 3] = m.idx[f * 3]; idx[i * 3 + 1] = m.idx[f * 3 + 1]; idx[i * 3 + 2] = m.idx[f * 3 + 2]; });
  const bvh = construirBVH({ pos: m.pos, idx });
  const f0 = facesDe(c)[0], v = m.idx[f0 * 3] * 3;
  const votos = [[0.5773, 0.5774, 0.5775], [-0.6123, 0.3121, 0.7265], [0.2413, -0.8814, 0.4061]].map(d => contarCruzamentos(bvh, m.pos[v], m.pos[v + 1], m.pos[v + 2], d[0], d[1], d[2]) % 2);
  return votos.filter(x => x).length >= 2 ? 1 : 0;
}

// quadrado da distância ponto–triângulo (Ericson, Real-Time Collision Detection 5.1.5)
function dist2Tri(px, py, pz, P, a, b, c) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz); } else {
              const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

// distância do ponto até a malha, no máximo 'teto' (poda pela caixa dos nós)
export function distanciaAte(bvh, px, py, pz, teto = Infinity) {
  const P = bvh.malha.pos, I = bvh.malha.idx, C = bvh.caixas;
  let melhor = teto * teto;
  const pilha = [0];
  while (pilha.length) {
    const no = pilha.pop(), o = no * 6;
    const dx = Math.max(C[o] - px, 0, px - C[o + 3]), dy = Math.max(C[o + 1] - py, 0, py - C[o + 4]), dz = Math.max(C[o + 2] - pz, 0, pz - C[o + 5]);
    if (dx * dx + dy * dy + dz * dz >= melhor) continue;
    const c = bvh.cont[no];
    if (c >= 0) {
      const ini = bvh.filho[no];
      for (let i = ini; i < ini + c; i++) {
        const t = bvh.ordem[i];
        const d = dist2Tri(px, py, pz, P, I[t * 3] * 3, I[t * 3 + 1] * 3, I[t * 3 + 2] * 3);
        if (d < melhor) melhor = d;
      }
    } else { const e = bvh.filho[no]; pilha.push(e + 1, e); }
  }
  return Math.sqrt(melhor);
}

// SUAVIZAR geométrico (muda a malha exportada). Escolhido por MEDIÇÃO contra
// a verdade em modelos reais com ruído conhecido (tests/suavizar.test.mjs):
// o algoritmo antigo (Taubin uniforme + "voltar pra caixa") deixava a peça
// mais longe do original que a própria versão com ruído, inchava até 10% e
// não alcançava caroço de alguns mm. Este:
//  1) TIRA O GRÃO — filtro bilateral de normais com guia rolante (Zheng 2011,
//     Wang 2015) e os vértices seguem as normais filtradas (Sun 2007). Quina
//     viva, olho, vinco ficam; não encolhe.
//  2) TIRA O CAROÇO na escala r (mm) — difusão IMPLÍCITA das normais com
//     barreira nas quinas (Tasdizen 2002) + reconstrução global da
//     superfície (cada vértice anda só na normal; toda face pesa igual, então
//     triângulo fino de malha de IA não tomba). Não encolhe (encaixa normais,
//     não tira média de posições). Malha grande: gradiente conjugado com
//     V-ciclo de multigrade (~20 iterações em vez de ~500).
// Com seleção: só a região + uma margem entra na conta (rápido em malha
// grande) e a borda da seleção tem transição suave (sem degrau).
import { criar, caixa, volume, subMalha } from './malha.js';
import { vizinhosDoVertice, facesDoVertice, componentes, estatisticaArestas } from './topologia.js';
import { construirBVH, paresProximos } from './bvh.js';
import { triCruzaTri } from './validador.js';
import { progresso } from './progresso.js';

// ---------------------------------------------------------------- medidas
export function arestaMedia(m) {
  const P = m.pos, I = m.idx; let s = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3; s += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
  return s / Math.max(1, I.length / 3);
}

// Diagnóstico pra tela: tamanho, aresta, se é FACETADA (poucos triângulos
// pro tamanho: mexer em vértice não tira faceta, precisa dividir)
export function analisarSuavizar(m) {
  const cx = caixa(m), S = cx ? Math.max(cx.tam[0], cx.tam[1], cx.tam[2]) : 0, h = arestaMedia(m);
  let facetada = false;
  if (S > 0 && S / h < 70) {
    // faceta = curva feita de faces grandes: das arestas que dobram, boa parte
    // (em comprimento) dobra "mole", de 8° a 60° (cubo: só 90° -> não é)
    const P = m.pos, I = m.idx, nt = I.length / 3, N = new Float64Array(nt * 3), A = new Float64Array(nt);
    geomFaces(P, I, nt, N, null, A);
    const outra = new Map(); let mole = 0, dobra = 0;
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3], ch = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const o = outra.get(ch);
      if (o === undefined) { outra.set(ch, t); continue; }
      const ang = Math.acos(Math.max(-1, Math.min(1, N[t * 3] * N[o * 3] + N[t * 3 + 1] * N[o * 3 + 1] + N[t * 3 + 2] * N[o * 3 + 2]))) * 180 / Math.PI;
      if (ang < 1) continue;
      const L = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      dobra += L; if (ang > 8 && ang < 60) mole += L;
    }
    facetada = dobra > 0 && mole / dobra > 0.3;
  }
  return { tamanho: S, aresta: h, facetada, triangulos: m.idx.length / 3 };
}

// intensidade (0..1) -> escala em mm do que some (proporcional à peça)
// Leve (25%) ~1,2% da peça: grão e ondulação fina, a forma fica · Média
// (60%) ~4,7%: o caroço de modelo de IA some · Forte (90%) ~10%: liso de
// verdade (arredonda detalhe fino e enche vão estreito, como no Blender)
export function raioDaIntensidade(I, S) { return S * (0.004 + 0.12 * I * I); }

// --------------------------------------------------------------- topologia
// faces vizinhas por vértice (anel de cada face), CSR sem repetição
function anelDeFaces(I, nt, fdv) {
  const marca = new Int32Array(nt).fill(-1), ini = new Uint32Array(nt + 1);
  for (let t = 0; t < nt; t++) {
    let c = 0;
    for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; for (let q = fdv.inicio[v]; q < fdv.inicio[v + 1]; q++) { const f = fdv.lista[q]; if (marca[f] !== t) { marca[f] = t; c++; } } }
    ini[t + 1] = ini[t] + c;
  }
  marca.fill(-1);
  const lista = new Uint32Array(ini[nt]);
  for (let t = 0; t < nt; t++) {
    let o = ini[t];
    for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; for (let q = fdv.inicio[v]; q < fdv.inicio[v + 1]; q++) { const f = fdv.lista[q]; if (marca[f] !== t) { marca[f] = t; lista[o++] = f; } } }
  }
  return { inicio: ini, lista };
}

function geomFaces(P, I, nt, N, C, A) {
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1e-30;
    N[t * 3] = nx / L; N[t * 3 + 1] = ny / L; N[t * 3 + 2] = nz / L;
    if (A) A[t] = L / 2;
    if (C) { C[t * 3] = (P[a] + P[b] + P[c]) / 3; C[t * 3 + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3; C[t * 3 + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3; }
  }
}

function normaisVertice(P, I, nv) {
  const N = new Float64Array(nv * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let i = 0; i < N.length; i += 3) { const L = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= L; N[i + 1] /= L; N[i + 2] /= L; }
  return N;
}

// aspereza (graus): quanto a face típica foge da média do seu anel. MEDIANA
// (não média): numa peça limpa com quina viva, as faces da quina não podem
// parecer ruído
function aspereza(N, A, VF, nt) {
  const hist = new Float64Array(721);                // 0..180° em 0,25°, peso = área
  let total = 0;
  for (let t = 0; t < nt; t++) {
    let x = 0, y = 0, z = 0;
    for (let q = VF.inicio[t]; q < VF.inicio[t + 1]; q++) { const f = VF.lista[q], w = A[f]; x += w * N[f * 3]; y += w * N[f * 3 + 1]; z += w * N[f * 3 + 2]; }
    const L = Math.hypot(x, y, z) || 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, (x * N[t * 3] + y * N[t * 3 + 1] + z * N[t * 3 + 2]) / L))) * 180 / Math.PI;
    hist[Math.min(720, Math.round(ang * 4))] += A[t]; total += A[t];
  }
  let c = 0; for (let i = 0; i <= 720; i++) { c += hist[i]; if (c * 2 >= total) return i / 4; }
  return 0;
}

// exp(-x) por tabela (x de 0 a 16, passo 1/64): o peso de alcance não
// precisa de precisão e exp era metade do tempo em malha grande
const EXP_TAB = (() => { const t = new Float32Array(16 * 64 + 2); for (let i = 0; i < t.length; i++) t[i] = Math.exp(-i / 64); t[t.length - 1] = 0; return t; })();
const EXP_MAX = 16 * 64;

// ------------------------------------------------ etapa 1: tirar o grão
// fixo[v] = 1: vértice não se mexe (margem de contexto no modo local)
function tirarGrao(P, I, nt, nv, VF, fdv, { K, sr, V, guia = 2 }, fixo, prog) {
  const N = new Float64Array(nt * 3), C = new Float64Array(nt * 3), A = new Float64Array(nt), N2 = new Float64Array(nt * 3), G = new Float64Array(nt * 3);
  geomFaces(P, I, nt, N, C, A);
  let s = 0, c = 0;
  for (let t = 0; t < nt; t += 5) for (let q = VF.inicio[t]; q < VF.inicio[t + 1]; q++) { const f = VF.lista[q]; if (f === t) continue; s += Math.hypot(C[t * 3] - C[f * 3], C[t * 3 + 1] - C[f * 3 + 1], C[t * 3 + 2] - C[f * 3 + 2]); c++; }
  const ss = (s / Math.max(1, c)) || 1, is2 = 1 / (2 * ss * ss), ir2 = 1 / (2 * sr * sr);
  // peso espacial × área (os centros não andam durante o filtro)
  const WS = new Float32Array(VF.lista.length);
  for (let t = 0; t < nt; t++) {
    const cx = C[t * 3], cy = C[t * 3 + 1], cz = C[t * 3 + 2];
    for (let q = VF.inicio[t]; q < VF.inicio[t + 1]; q++) { const f = VF.lista[q], f3 = f * 3; WS[q] = A[f] * Math.exp(-((C[f3] - cx) ** 2 + (C[f3 + 1] - cy) ** 2 + (C[f3 + 2] - cz) ** 2) * is2); }
  }
  // guia inicial: Gaussiano (o ruído não pode parecer quina). Malha limpa
  // não usa guia: a quina já é quina e borrar ela aqui só atrapalha
  G.set(N);
  for (let g = 0; g < guia; g++) {
    for (let t = 0; t < nt; t++) {
      let x = 0, y = 0, z = 0;
      for (let q = VF.inicio[t]; q < VF.inicio[t + 1]; q++) { const f3 = VF.lista[q] * 3, w = WS[q]; x += w * G[f3]; y += w * G[f3 + 1]; z += w * G[f3 + 2]; }
      const L = Math.hypot(x, y, z) || 1; N2[t * 3] = x / L; N2[t * 3 + 1] = y / L; N2[t * 3 + 2] = z / L;
    }
    G.set(N2);
  }
  for (let k = 0; k < K; k++) {
    for (let t = 0; t < nt; t++) {
      let x = 0, y = 0, z = 0; const gx = G[t * 3], gy = G[t * 3 + 1], gz = G[t * 3 + 2];
      for (let q = VF.inicio[t]; q < VF.inicio[t + 1]; q++) {
        const f3 = VF.lista[q] * 3;
        const e = ((G[f3] - gx) ** 2 + (G[f3 + 1] - gy) ** 2 + (G[f3 + 2] - gz) ** 2) * ir2 * 64;
        const w = WS[q] * EXP_TAB[e < EXP_MAX ? e | 0 : EXP_MAX + 1];
        x += w * N[f3]; y += w * N[f3 + 1]; z += w * N[f3 + 2];
      }
      const L = Math.hypot(x, y, z) || 1; N2[t * 3] = x / L; N2[t * 3 + 1] = y / L; N2[t * 3 + 2] = z / L;
    }
    N.set(N2); G.set(N2);
    prog((k + 1) / (K + V));
  }
  // vértices seguem as normais filtradas (peso = área: triângulo degenerado
  // de STL ruim, com normal sem sentido, não puxa nada; vértice cercado só
  // de triângulo sem área fica parado)
  let aMed = 0; for (let t = 0; t < nt; t++) aMed += A[t]; aMed /= Math.max(1, nt);
  const aMin = aMed * 1e-6;
  for (let it = 0; it < V; it++) {
    for (let t = 0; t < nt; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, cc = I[t * 3 + 2] * 3; C[t * 3] = (P[a] + P[b] + P[cc]) / 3; C[t * 3 + 1] = (P[a + 1] + P[b + 1] + P[cc + 1]) / 3; C[t * 3 + 2] = (P[a + 2] + P[b + 2] + P[cc + 2]) / 3; }
    for (let v = 0; v < nv; v++) {
      if (fixo && fixo[v]) continue;
      const i0 = fdv.inicio[v], i1 = fdv.inicio[v + 1]; if (i1 === i0) continue;
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      let dx = 0, dy = 0, dz = 0, sa = 0;
      for (let q = i0; q < i1; q++) { const f = fdv.lista[q], f3 = f * 3, a = A[f]; const d = a * (N[f3] * (C[f3] - px) + N[f3 + 1] * (C[f3 + 1] - py) + N[f3 + 2] * (C[f3 + 2] - pz)); dx += N[f3] * d; dy += N[f3 + 1] * d; dz += N[f3 + 2] * d; sa += a; }
      if (!(sa > aMin)) continue;
      P[v * 3] += dx / sa; P[v * 3 + 1] += dy / sa; P[v * 3 + 2] += dz / sa;
    }
    if ((it & 3) === 3) prog((K + it + 1) / (K + V));
  }
}

// --------------------------------------------- etapa 2: tirar o caroço
// força de detalhe por vértice: quanto a normal (sem ruído) gira até a
// distância rho — não depende da densidade da malha
function forcaDetalhe(P, NV, viz, nv, rho) {
  // normal média do anel (2x) pra resíduo de ruído não parecer detalhe
  let N = NV;
  for (let k = 0; k < 2; k++) {
    const N2 = new Float64Array(N.length);
    for (let v = 0; v < nv; v++) {
      let x = N[v * 3], y = N[v * 3 + 1], z = N[v * 3 + 2];
      for (let q = viz.inicio[v]; q < viz.inicio[v + 1]; q++) { const u = viz.lista[q] * 3; x += N[u]; y += N[u + 1]; z += N[u + 2]; }
      const L = Math.hypot(x, y, z) || 1; N2[v * 3] = x / L; N2[v * 3 + 1] = y / L; N2[v * 3 + 2] = z / L;
    }
    N = N2;
  }
  const F = new Float32Array(nv), marca = new Int32Array(nv).fill(-1), fila = new Int32Array(Math.min(nv, 256)), r2 = rho * rho;
  for (let v = 0; v < nv; v++) {
    let ini = 0, fim = 0, minDot = 1; fila[fim++] = v; marca[v] = v;
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    // no máximo 256 vértices por busca (ponto repetido em STL ruim não trava)
    while (ini < fim && fim < fila.length) {
      const a = fila[ini++];
      for (let q = viz.inicio[a]; q < viz.inicio[a + 1] && fim < fila.length; q++) {
        const u = viz.lista[q]; if (marca[u] === v) continue; marca[u] = v;
        if ((P[u * 3] - px) ** 2 + (P[u * 3 + 1] - py) ** 2 + (P[u * 3 + 2] - pz) ** 2 > r2) continue;
        const d = nx * N[u * 3] + ny * N[u * 3 + 1] + nz * N[u * 3 + 2]; if (d < minDot) minDot = d;
        fila[fim++] = u;
      }
    }
    F[v] = Math.acos(Math.max(-1, Math.min(1, minDot)));
  }
  return F;
}

// pesos cotangente (sem negativos) por entrada da lista de vizinhos
function pesosCot(P, I, viz) {
  const w = new Float64Array(viz.lista.length);
  const achar = (i, j) => { for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) if (viz.lista[k] === j) return k; return -1; };
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const o = I[t + k], i = I[t + (k + 1) % 3], j = I[t + (k + 2) % 3];
    const ax = P[i * 3] - P[o * 3], ay = P[i * 3 + 1] - P[o * 3 + 1], az = P[i * 3 + 2] - P[o * 3 + 2], bx = P[j * 3] - P[o * 3], by = P[j * 3 + 1] - P[o * 3 + 1], bz = P[j * 3 + 2] - P[o * 3 + 2];
    const cot = Math.min(10, Math.max(0.01, (ax * bx + ay * by + az * bz) / (Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) || 1e-12) / 2));
    const a = achar(i, j), b = achar(j, i); if (a >= 0) w[a] += cot; if (b >= 0) w[b] += cot;
  }
  return w;
}

// (M + t L) x = M b, 3 componentes JUNTAS (uma passada pela matriz por
// iteração), gradiente conjugado com Jacobi. tol = resíduo relativo.
function difundir(B, M, W, viz, nv, t, prog, tol = 1e-4) {
  const X = Float64Array.from(B), diag = new Float64Array(nv), sw = new Float64Array(nv);
  for (let i = 0; i < nv; i++) { let s = 0; for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) s += W[k]; sw[i] = s; diag[i] = M[i] + t * s; }
  const n3 = nv * 3, r = new Float64Array(n3), z = new Float64Array(n3), p = new Float64Array(n3), Ap = new Float64Array(n3);
  const H = (v, out) => {
    for (let i = 0; i < nv; i++) {
      let sx = 0, sy = 0, sz = 0;
      for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) { const w = W[k], u = viz.lista[k] * 3; sx += w * v[u]; sy += w * v[u + 1]; sz += w * v[u + 2]; }
      const a = M[i] + t * sw[i], i3 = i * 3;
      out[i3] = a * v[i3] - t * sx; out[i3 + 1] = a * v[i3 + 1] - t * sy; out[i3 + 2] = a * v[i3 + 2] - t * sz;
    }
  };
  H(X, Ap);
  // 3 sistemas independentes com a mesma matriz: escalares por componente
  let rz0 = 0, rz1 = 0, rz2 = 0, b0 = 0, b1 = 0, bb2 = 0;
  for (let v = 0, i = 0; v < nv; v++, i += 3) {
    const m = M[v], d = 1 / diag[v];
    const r0 = m * B[i] - Ap[i], r1 = m * B[i + 1] - Ap[i + 1], rr2 = m * B[i + 2] - Ap[i + 2];
    r[i] = r0; r[i + 1] = r1; r[i + 2] = rr2;
    z[i] = r0 * d; z[i + 1] = r1 * d; z[i + 2] = rr2 * d; p[i] = z[i]; p[i + 1] = z[i + 1]; p[i + 2] = z[i + 2];
    rz0 += r0 * z[i]; rz1 += r1 * z[i + 1]; rz2 += rr2 * z[i + 2];
    b0 += (m * B[i]) ** 2; b1 += (m * B[i + 1]) ** 2; bb2 += (m * B[i + 2]) ** 2;
  }
  const t2 = tol * tol;
  let a0 = 1, a1 = 1, a2 = 1, it = 0;
  for (; it < 400 && (a0 || a1 || a2); it++) {
    H(p, Ap);
    let q0 = 0, q1 = 0, q2 = 0;
    for (let i = 0; i < n3; i += 3) { q0 += p[i] * Ap[i]; q1 += p[i + 1] * Ap[i + 1]; q2 += p[i + 2] * Ap[i + 2]; }
    const l0 = a0 ? rz0 / (q0 || 1e-300) : 0, l1 = a1 ? rz1 / (q1 || 1e-300) : 0, l2 = a2 ? rz2 / (q2 || 1e-300) : 0;
    let s0 = 0, s1 = 0, s2 = 0, n0 = 0, n1 = 0, n2 = 0;
    for (let v = 0, i = 0; v < nv; v++, i += 3) {
      const d = 1 / diag[v];
      X[i] += l0 * p[i]; X[i + 1] += l1 * p[i + 1]; X[i + 2] += l2 * p[i + 2];
      const r0 = r[i] - l0 * Ap[i], r1 = r[i + 1] - l1 * Ap[i + 1], rr2 = r[i + 2] - l2 * Ap[i + 2];
      r[i] = r0; r[i + 1] = r1; r[i + 2] = rr2;
      s0 += r0 * r0; s1 += r1 * r1; s2 += rr2 * rr2;
      z[i] = r0 * d; z[i + 1] = r1 * d; z[i + 2] = rr2 * d;
      n0 += r0 * z[i]; n1 += r1 * z[i + 1]; n2 += rr2 * z[i + 2];
    }
    if (s0 <= b0 * t2) a0 = 0; if (s1 <= b1 * t2) a1 = 0; if (s2 <= bb2 * t2) a2 = 0;
    const e0 = a0 ? n0 / (rz0 || 1e-300) : 0, e1 = a1 ? n1 / (rz1 || 1e-300) : 0, e2 = a2 ? n2 / (rz2 || 1e-300) : 0;
    rz0 = n0; rz1 = n1; rz2 = n2;
    for (let i = 0; i < n3; i += 3) { if (a0) p[i] = z[i] + e0 * p[i]; if (a1) p[i + 1] = z[i + 1] + e1 * p[i + 1]; if (a2) p[i + 2] = z[i + 2] + e2 * p[i + 2]; }
    if ((it & 7) === 7) prog(Math.min(0.95, it / 150));
  }
  return { X, its: it };
}

// ---------------------------------------------- multigrade (malha grande)
// Em malha grande o alcance é dezenas de arestas e o CG puro precisa de
// ~500 iterações por difusão. V-ciclo como precondicionador (agregação +
// Galerkin, Jacobi): ~20 iterações, mesmo resultado (< 0,01 mm).
// Agrupa o vértice com os vizinhos ligados FORTE (a barreira da quina não
// junta os dois lados); quem sobra vai pro grupo do vizinho mais forte.
function agregar(W, viz, nv) {
  const ag = new Int32Array(nv).fill(-1), forte = new Float64Array(nv); let n = 0;
  for (let i = 0; i < nv; i++) { let mx = 0; for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) if (W[k] > mx) mx = W[k]; forte[i] = mx; }
  for (let i = 0; i < nv; i++) {
    if (ag[i] >= 0) continue;
    let livre = true;
    for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) if (ag[viz.lista[k]] >= 0 && W[k] >= 0.25 * forte[i]) { livre = false; break; }
    if (!livre) continue;
    ag[i] = n;
    for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) { const j = viz.lista[k]; if (ag[j] < 0 && W[k] >= 0.25 * Math.max(forte[i], forte[j])) ag[j] = n; }
    n++;
  }
  for (let i = 0; i < nv; i++) {
    if (ag[i] >= 0) continue;
    let melhor = -1, wm = -1;
    for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) { const j = viz.lista[k]; if (ag[j] >= 0 && W[k] > wm) { wm = W[k]; melhor = ag[j]; } }
    ag[i] = melhor >= 0 ? melhor : n++;
  }
  return { ag, n };
}
// nível grosso de Galerkin (P constante por grupo). A = diag − W
function nivelGrosso(L, ag, n) {
  const diag = new Float64Array(n), mapa = new Map();
  for (let i = 0; i < L.nv; i++) {
    const I = ag[i]; diag[I] += L.diag[i];
    for (let k = L.viz.inicio[i]; k < L.viz.inicio[i + 1]; k++) {
      const J = ag[L.viz.lista[k]];
      if (J === I) diag[I] -= L.W[k]; else { const ch = I * n + J; mapa.set(ch, (mapa.get(ch) || 0) + L.W[k]); }
    }
  }
  const ini = new Uint32Array(n + 1);
  for (const ch of mapa.keys()) ini[Math.floor(ch / n) + 1]++;
  for (let I = 0; I < n; I++) ini[I + 1] += ini[I];
  const lista = new Uint32Array(ini[n]), W = new Float64Array(ini[n]), q = ini.slice(0, n);
  for (const [ch, w] of mapa) { const I = Math.floor(ch / n), k = q[I]++; lista[k] = ch - I * n; W[k] = w; }
  return { diag, W, viz: { inicio: ini, lista }, nv: n };
}
// níveis pro V-ciclo de A = diag − W (W ≥ 0 nos vizinhos), nc componentes
function hierarquia(diag, W, viz, nv, nc) {
  const niveis = [{ diag, W, viz, nv }];
  for (let L = niveis[0]; L.nv > 3000;) {
    const { ag, n } = agregar(L.W, L.viz, L.nv);
    if (n > L.nv * 0.7) break;
    L.ag = ag; L = nivelGrosso(L, ag, n); niveis.push(L);
  }
  for (const L of niveis) { L.r = new Float64Array(L.nv * nc); L.z = new Float64Array(L.nv * nc); L.Az = new Float64Array(L.nv * nc); }
  niveis.nc = nc;
  return niveis;
}
function aplicarA(L, nc, v, out) {
  const { diag, W, viz, nv } = L;
  if (nc === 1) {
    for (let i = 0; i < nv; i++) { let s = 0; for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) s += W[k] * v[viz.lista[k]]; out[i] = diag[i] * v[i] - s; }
    return;
  }
  for (let i = 0; i < nv; i++) {
    let sx = 0, sy = 0, sz = 0;
    for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) { const w = W[k], u = viz.lista[k] * 3; sx += w * v[u]; sy += w * v[u + 1]; sz += w * v[u + 2]; }
    const a = diag[i], i3 = i * 3;
    out[i3] = a * v[i3] - sx; out[i3 + 1] = a * v[i3 + 1] - sy; out[i3 + 2] = a * v[i3 + 2] - sz;
  }
}
// z = V(r) no nível l: Jacobi amortecido antes e depois, correção do grosso
function vciclo(niveis, l, r, z) {
  const L = niveis[l], nc = niveis.nc, nv = L.nv, Az = L.Az, om = 0.7;
  const jacobi = primeira => {
    if (!primeira) aplicarA(L, nc, z, Az);
    for (let i = 0; i < nv; i++) { const d = om / L.diag[i]; for (let e = 0; e < nc; e++) { const q = i * nc + e; z[q] += d * (r[q] - (primeira ? 0 : Az[q])); } }
  };
  z.fill(0);
  if (l === niveis.length - 1) { jacobi(true); for (let it = 1; it < 60; it++) jacobi(false); return; }
  jacobi(true);
  aplicarA(L, nc, z, Az);
  const C = niveis[l + 1], rc = C.r, zc = C.z, ag = L.ag;
  rc.fill(0);
  for (let i = 0; i < nv; i++) { const I = ag[i] * nc; for (let e = 0; e < nc; e++) rc[I + e] += r[i * nc + e] - Az[i * nc + e]; }
  vciclo(niveis, l + 1, rc, zc);
  for (let i = 0; i < nv; i++) { const I = ag[i] * nc; for (let e = 0; e < nc; e++) z[i * nc + e] += zc[I + e]; }
  jacobi(false);
}
// (M + tL) X = M B com CG precondicionado pelo V-ciclo (3 componentes juntas)
function difundirPCG(B, M, niveis, prog, tol = 1e-4) {
  const L = niveis[0], nv = L.nv, n3 = nv * 3;
  const X = Float64Array.from(B), r = new Float64Array(n3), z = new Float64Array(n3), p = new Float64Array(n3), Ap = new Float64Array(n3);
  aplicarA(L, 3, X, Ap);
  let b2 = 0;
  for (let i = 0; i < nv; i++) for (let e = 0; e < 3; e++) { const bi = M[i] * B[i * 3 + e]; r[i * 3 + e] = bi - Ap[i * 3 + e]; b2 += bi * bi; }
  vciclo(niveis, 0, r, z); p.set(z);
  let rz = 0; for (let i = 0; i < n3; i++) rz += r[i] * z[i];
  let it = 0;
  while (it < 200) {
    aplicarA(L, 3, p, Ap); it++;
    let pAp = 0; for (let i = 0; i < n3; i++) pAp += p[i] * Ap[i];
    const a = rz / (pAp || 1e-300); let r2 = 0;
    for (let i = 0; i < n3; i++) { X[i] += a * p[i]; r[i] -= a * Ap[i]; r2 += r[i] * r[i]; }
    if (r2 <= b2 * tol * tol) break;
    vciclo(niveis, 0, r, z);
    let rz2 = 0; for (let i = 0; i < n3; i++) rz2 += r[i] * z[i];
    const be = rz2 / (rz || 1e-300); rz = rz2;
    for (let i = 0; i < n3; i++) p[i] = z[i] + be * p[i];
    prog(Math.min(0.95, it / 30));
  }
  return { X, its: it };
}

// superfície que segue as normais N das faces:
// min Σ_f A_f Σ_arestas (n_f·(xj−xi))² + α Σ_i m_i |xi − x0i|²
// (projetado: vértice fixo não anda)
// Encaixe SÓ NA NORMAL: cada vértice anda s·n (n = normal do vértice).
// Caroço é altura ao longo da normal: sai. Deslizar de lado não existe —
// na junção côncava (orelha na cabeça) a lateral não passa por cima da
// outra face. Uma incógnita por vértice (3x menos conta).
// Toda face pesa IGUAL no encaixe (não pela área): malha de IA / decimada é
// cheia de triângulo fino (agulha); pesando por área a agulha não conta, fica
// solta, tomba e a tela mostra "papel amassado"
function encaixarNaNormal(P, P0, I, N, A0, nt, nv, alfa, fixo, prog, NV, maxIt = 400, alfaV = null, viz = null) {
  const M = new Float64Array(nv), D = new Float64Array(nv);
  const al = alfaV ? v => alfaV[v] : () => alfa;
  let a = 0; for (let t = 0; t < nt; t++) a += A0[t]; a /= Math.max(1, nt);
  // diagonal: soma de a·(n_t·n_v)² nas arestas do vértice + âncora (massa = área de verdade)
  for (let t = 0; t < nt; t++) {
    const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
    for (let k = 0; k < 3; k++) { const v = I[t * 3 + k], d = nx * NV[v * 3] + ny * NV[v * 3 + 1] + nz * NV[v * 3 + 2]; M[v] += A0[t] / 3; D[v] += a * 2 * d * d; }
  }
  let mMed = 0; for (let v = 0; v < nv; v++) mMed += M[v]; mMed /= Math.max(1, nv);
  for (let v = 0; v < nv; v++) D[v] = (fixo && fixo[v]) || !(M[v] > mMed * 1e-6) ? 0 : 1 / (D[v] + al(v) * M[v] + 1e-30);
  // H·s: termo a·(n_t·(x_j - x_i))² com x = P + s·NV
  const Hs = (S, out, anc) => {
    out.fill(0);
    for (let t = 0; t < nt; t++) {
      const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const i = I[t * 3 + k], j = I[t * 3 + (k + 1) % 3];
        const ci = nx * NV[i * 3] + ny * NV[i * 3 + 1] + nz * NV[i * 3 + 2], cj = nx * NV[j * 3] + ny * NV[j * 3 + 1] + nz * NV[j * 3 + 2];
        const d = a * (cj * S[j] - ci * S[i]);
        out[j] += cj * d; out[i] -= ci * d;
      }
    }
    if (anc) for (let v = 0; v < nv; v++) out[v] += al(v) * M[v] * S[v];
  };
  // resíduo inicial: -gradiente em s=0 (P já fora de P0 pela etapa 1: âncora puxa pra P0)
  const r = new Float64Array(nv), z = new Float64Array(nv), p = new Float64Array(nv), Ap = new Float64Array(nv), s = new Float64Array(nv);
  for (let t = 0; t < nt; t++) {
    const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const i = I[t * 3 + k], j = I[t * 3 + (k + 1) % 3];
      const ci = nx * NV[i * 3] + ny * NV[i * 3 + 1] + nz * NV[i * 3 + 2], cj = nx * NV[j * 3] + ny * NV[j * 3 + 1] + nz * NV[j * 3 + 2];
      const d = a * (nx * (P[j * 3] - P[i * 3]) + ny * (P[j * 3 + 1] - P[i * 3 + 1]) + nz * (P[j * 3 + 2] - P[i * 3 + 2]));
      r[j] -= cj * d; r[i] += ci * d;
    }
  }
  for (let v = 0; v < nv; v++) r[v] -= al(v) * M[v] * (NV[v * 3] * (P[v * 3] - P0[v * 3]) + NV[v * 3 + 1] * (P[v * 3 + 1] - P0[v * 3 + 1]) + NV[v * 3 + 2] * (P[v * 3 + 2] - P0[v * 3 + 2]));
  // malha grande: V-ciclo na matriz do encaixe (vizinho com peso a·cᵢ·cⱼ)
  let niveis = null;
  if (viz && nv >= 20000) {
    const Wd = new Float64Array(viz.lista.length), dg = new Float64Array(nv);
    const achar = (u, w) => { for (let k = viz.inicio[u]; k < viz.inicio[u + 1]; k++) if (viz.lista[k] === w) return k; return -1; };
    for (let t = 0; t < nt; t++) {
      const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const i = I[t * 3 + k], j = I[t * 3 + (k + 1) % 3];
        const w = a * (nx * NV[i * 3] + ny * NV[i * 3 + 1] + nz * NV[i * 3 + 2]) * (nx * NV[j * 3] + ny * NV[j * 3 + 1] + nz * NV[j * 3 + 2]);
        if (w > 0) { const q1 = achar(i, j), q2 = achar(j, i); if (q1 >= 0) Wd[q1] += w; if (q2 >= 0) Wd[q2] += w; }
      }
    }
    for (let v = 0; v < nv; v++) dg[v] = D[v] ? 1 / D[v] : 1e300;
    niveis = hierarquia(dg, Wd, viz, nv, 1);
  }
  const prec = niveis ? () => { vciclo(niveis, 0, r, z); for (let v = 0; v < nv; v++) if (!D[v]) z[v] = 0; } : () => { for (let v = 0; v < nv; v++) z[v] = r[v] * D[v]; };
  let b2 = 0;
  for (let v = 0; v < nv; v++) { if (!D[v]) r[v] = 0; b2 += r[v] * r[v]; }
  prec(); p.set(z);
  let rz = 0; for (let v = 0; v < nv; v++) rz += r[v] * z[v];
  let it = 0;
  for (; it < maxIt && b2 > 0; it++) {
    Hs(p, Ap, true);
    let pAp = 0; for (let v = 0; v < nv; v++) pAp += p[v] * Ap[v];
    const passo = rz / (pAp || 1e-300); let r2 = 0;
    for (let v = 0; v < nv; v++) { s[v] += passo * p[v]; if (D[v]) { r[v] -= passo * Ap[v]; r2 += r[v] * r[v]; } else r[v] = 0; }
    if (r2 < b2 * 1e-6) break;
    prec();
    let rz2 = 0; for (let v = 0; v < nv; v++) rz2 += r[v] * z[v];
    const be = rz2 / (rz || 1e-300); rz = rz2;
    for (let v = 0; v < nv; v++) p[v] = z[v] + be * p[v];
    if ((it & 7) === 7) prog(Math.min(0.95, it / (niveis ? 30 : 120)));
  }
  for (let v = 0; v < nv; v++) { P[v * 3] += s[v] * NV[v * 3]; P[v * 3 + 1] += s[v] * NV[v * 3 + 1]; P[v * 3 + 2] += s[v] * NV[v * 3 + 2]; }
  return it;
}

function dirNormal(ND, nv) { const X = new Float64Array(nv * 3); for (let v = 0; v < nv; v++) { const L = Math.hypot(ND[v * 3], ND[v * 3 + 1], ND[v * 3 + 2]) || 1; X[v * 3] = ND[v * 3] / L; X[v * 3 + 1] = ND[v * 3 + 1] / L; X[v * 3 + 2] = ND[v * 3 + 2] / L; } return X; }
function tirarCaroco(P, I, nt, nv, viz, { r, th0, h, S = 0 }, fixo, prog, marcar = () => {}) {
  const NV = normaisVertice(P, I, nv);
  const t0 = th0 * Math.PI / 180;
  // QUINA de verdade = a normal gira mais de 30° em 2 arestas (não cresce
  // com a força): encontro orelha-cabeça, aresta de peça mecânica. Caroço de
  // modelo de IA gira devagar (~10° em 2 arestas) e é alisado — antes o raio
  // crescia com a força e o caroço virava "detalhe"
  const rhoQ = Math.max(2 * h, 0.001 * S);
  const F = th0 ? forcaDetalhe(P, NV, viz, nv, rhoQ) : null;
  // barreira: plana até perto do limite e cai de uma vez (caroço não fica
  // "meio protegido"; quina de 90° fecha)
  const barreira = f => 1 / (1 + Math.pow(f / t0, 6));
  prog(0.15);
  marcar('detalhe');
  const W = pesosCot(P, I, viz);
  if (F) for (let i = 0; i < nv; i++) for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) { const f = Math.max(F[i], F[viz.lista[k]]); W[k] *= Math.max(0.002, barreira(f)); }
  const N = new Float64Array(nt * 3), A = new Float64Array(nt);
  geomFaces(P, I, nt, N, null, A);
  const M = new Float64Array(nv);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) M[I[t * 3 + k]] += A[t] / 3;
  marcar('pesos');
  // 2 passos de meia difusão: corta mais a onda curta (caroço) com o mesmo
  // efeito na forma grande
  const t = r * r / 4;
  let niveis = null;
  if (nv >= 20000) {
    const Wt = new Float64Array(W.length), dg = new Float64Array(nv);
    for (let i = 0; i < nv; i++) { let s = 0; for (let k = viz.inicio[i]; k < viz.inicio[i + 1]; k++) { Wt[k] = t * W[k]; s += Wt[k]; } dg[i] = M[i] + s; }
    niveis = hierarquia(dg, Wt, viz, nv, 3);
  }
  const dif = (B, pr) => niveis ? difundirPCG(B, M, niveis, pr) : difundir(B, M, W, viz, nv, t, pr);
  const d1 = dif(NV, f => prog(0.15 + 0.17 * f));
  const d2 = dif(d1.X, f => prog(0.32 + 0.18 * f));
  const ND = d2.X, its = d1.its + d2.its;
  marcar('difusao');
  // normal-alvo de cada face; face em detalhe/quina fica com a própria
  for (let t = 0; t < nt; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; x += ND[v]; y += ND[v + 1]; z += ND[v + 2]; }
    const L = Math.hypot(x, y, z) || 1;
    const b = F ? barreira(Math.max(F[I[t * 3]], F[I[t * 3 + 1]], F[I[t * 3 + 2]])) : 1;
    x = b * x / L + (1 - b) * N[t * 3]; y = b * y / L + (1 - b) * N[t * 3 + 1]; z = b * z / L + (1 - b) * N[t * 3 + 2];
    const L2 = Math.hypot(x, y, z) || 1; N[t * 3] = x / L2; N[t * 3 + 1] = y / L2; N[t * 3 + 2] = z / L2;
  }
  const P0 = Float64Array.from(P);
  const alfa = (h / r) ** 2;
  // âncora só na LINHA da quina VIVA (giro > 40° em 2 arestas: orelha na
  // cabeça, aresta de peça): o vértice entre os dois lados não tem normal
  // definida — solto, vira ponta. Dobra mole (bigode, ruga, 30-40°) fica
  // solta: ancorada, os vizinhos amassam em volta dela
  let alfaV = null;
  if (F) {
    const Fc = forcaDetalhe(P, NV, viz, nv, 2 * h), ta = 40 * Math.PI / 180, ka = 4;
    alfaV = new Float64Array(nv);
    for (let v = 0; v < nv; v++) { const q = 1 - 1 / (1 + Math.pow(Fc[v] / ta, 6)); alfaV[v] = alfa + ka * q * q * q * q; }
  }
  const cg = encaixarNaNormal(P, P0, I, N, A, nt, nv, alfa, fixo, f => prog(0.5 + 0.5 * f), dirNormal(ND, nv), 400, alfaV, viz);
  marcar('encaixe');
  return { difusao: its, cg };
}

function desvirar(P, P0, I, nt, fixo) {
  const n = (Q, t) => { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], wx = Q[c] - Q[a], wy = Q[c + 1] - Q[a + 1], wz = Q[c + 2] - Q[a + 2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
  let total = 0;
  for (let volta = 0; volta < 12; volta++) {
    const mover = new Set();
    for (let t = 0; t < nt; t++) {
      const x = n(P, t), y = n(P0, t);
      if (x[0] * y[0] + x[1] * y[1] + x[2] * y[2] < 0) for (let k = 0; k < 3; k++) mover.add(I[t * 3 + k]);
    }
    if (!mover.size) break;
    if (!volta) total = mover.size;
    const w = volta < 10 ? 0.5 : 1;                 // últimas voltas: volta inteiro
    for (const v of mover) { if (fixo && fixo[v]) continue; for (let e = 0; e < 3; e++) P[v * 3 + e] += w * (P0[v * 3 + e] - P[v * 3 + e]); }
  }
  return total;
}

// ------------------------------------------------------- modo local
// distância (pela malha) até a seleção: Dijkstra multi-fonte, até 'ate'
function distanciaAteSelecao(P, viz, nv, fonte, ate) {
  const D = new Float64Array(nv).fill(Infinity);
  const heap = [], push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let v = 0; v < nv; v++) if (fonte[v]) { D[v] = 0; push(0, v); }
  while (heap.length) {
    const [d, v] = pop();
    if (d > D[v] || d > ate) continue;
    for (let q = viz.inicio[v]; q < viz.inicio[v + 1]; q++) {
      const u = viz.lista[q];
      const nd = d + Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]);
      if (nd < D[u] && nd <= ate) { D[u] = nd; push(nd, u); }
    }
  }
  return D;
}

// ------------------------------------------------------- localidade
// Renumera vértices e faces pela posição (curva de Morton): vizinho na
// peça fica vizinho na memória. Em malha grande (STL de IA vem embaralhado)
// as contas passam a maior parte do tempo esperando a memória.
function reordenar(m) {
  const P = m.pos, I = m.idx, nv = P.length / 3, nt = I.length / 3, cx = caixa(m);
  const esc = 1023 / Math.max(cx.tam[0], cx.tam[1], cx.tam[2], 1e-9);
  const espalha = x => { x &= 1023; x = (x | (x << 16)) & 0x30000ff; x = (x | (x << 8)) & 0x300f00f; x = (x | (x << 4)) & 0x30c30c3; return (x | (x << 2)) & 0x9249249; };
  const chave = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) chave[v] = espalha((P[v * 3] - cx.min[0]) * esc) | (espalha((P[v * 3 + 1] - cx.min[1]) * esc) << 1) | (espalha((P[v * 3 + 2] - cx.min[2]) * esc) << 2);
  const ordem = new Uint32Array(nv); for (let v = 0; v < nv; v++) ordem[v] = v;
  ordem.sort((a, b) => chave[a] - chave[b]);
  const novo = new Uint32Array(nv); for (let k = 0; k < nv; k++) novo[ordem[k]] = k;
  const pos = new Float64Array(nv * 3);
  for (let k = 0; k < nv; k++) { const v = ordem[k]; pos[k * 3] = P[v * 3]; pos[k * 3 + 1] = P[v * 3 + 1]; pos[k * 3 + 2] = P[v * 3 + 2]; }
  // faces pela menor posição nova
  const fch = new Uint32Array(nt), fo = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) { fch[t] = Math.min(novo[I[t * 3]], novo[I[t * 3 + 1]], novo[I[t * 3 + 2]]); fo[t] = t; }
  fo.sort((a, b) => fch[a] - fch[b]);
  const idx = new Uint32Array(nt * 3);
  for (let k = 0; k < nt; k++) { const t = fo[k]; idx[k * 3] = novo[I[t * 3]]; idx[k * 3 + 1] = novo[I[t * 3 + 1]]; idx[k * 3 + 2] = novo[I[t * 3 + 2]]; }
  return { malha: criar(pos, idx), ordem };
}

// ------------------------------------------------------- segurança
// Cruzamentos NOVOS (triângulo passando a atravessar outro, que antes não
// atravessava) na região que mexeu, DENTRO da mesma casca. Malha que já
// vinha com dobra (ruído de IA/scan) pode continuar com a dobra dela; cascas
// separadas que já se atravessavam (modelo de jogo/IA) o fatiador junta —
// a suavização só não pode fazer uma superfície dobrar sobre ela mesma.
function cruzamentosNovos(m0, P1, moveu, fim, rot, limite = 2000) {
  const I = m0.idx, P0 = m0.pos, nt = I.length / 3;
  const movF = new Uint8Array(nt); const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let n = 0;
  for (let t = 0; t < nt; t++) if (moveu[I[t * 3]] || moveu[I[t * 3 + 1]] || moveu[I[t * 3 + 2]]) {
    movF[t] = 1; n++;
    for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; for (let e = 0; e < 3; e++) { const x = P1[v + e]; if (x < lo[e]) lo[e] = x; if (x > hi[e]) hi[e] = x; } }
  }
  const faces = [];
  if (!n) return { faces, completo: true };
  const folga = 1e-3 + Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.01;
  const perto = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    let fora = false;
    for (let e = 0; e < 3 && !fora; e++) { const a = P1[I[t * 3] * 3 + e], b = P1[I[t * 3 + 1] * 3 + e], c = P1[I[t * 3 + 2] * 3 + e]; if (Math.max(a, b, c) < lo[e] - folga || Math.min(a, b, c) > hi[e] + folga) fora = true; }
    if (!fora) perto[t] = 1;
  }
  const sub = subMalha(criar(P1, I), perto), fs = sub.faces, bvh = construirBVH(sub.malha);
  const tri = (P, t) => { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; return [[P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]]; };
  let visitas = 0, completo = true;
  paresProximos(bvh, (s1, s2) => {
    if ((++visitas & 4095) === 0 && Date.now() > fim) { completo = false; return true; }
    const t1 = fs[s1], t2 = fs[s2];
    if (!movF[t1] && !movF[t2]) return false;
    if (rot && rot[t1] !== rot[t2]) return false;
    const a0 = I[t1 * 3], a1 = I[t1 * 3 + 1], a2 = I[t1 * 3 + 2], b0 = I[t2 * 3], b1 = I[t2 * 3 + 1], b2 = I[t2 * 3 + 2];
    if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) return false;
    const A = tri(P1, t1), B = tri(P1, t2);
    if (!triCruzaTri(A[0], A[1], A[2], B[0], B[1], B[2])) return false;
    const A0 = tri(P0, t1), B0 = tri(P0, t2);
    if (triCruzaTri(A0[0], A0[1], A0[2], B0[0], B0[1], B0[2])) return false;
    faces.push(t1, t2);
    if (faces.length >= limite) { completo = false; return true; }
    return false;
  });
  return { faces, completo };
}
// onde cruzou, volta ao original (com transição de 2 anéis) e confere de novo
function consertarCruzamentos(m0, P1, moveu, viz, tempoMs = 12000) {
  const I = m0.idx, P0 = m0.pos, nv = P0.length / 3, fim = Date.now() + tempoMs;
  const c = componentes(m0), rot = c.n > 1 ? c.rotulo : null;
  let revertidos = 0;
  // 1ª vez que um ponto cruza: volta metade do caminho; se cruzar de novo,
  // volta tudo (o resto da suavização ali fica)
  const vezes = new Uint8Array(nv);
  for (let rodada = 0; rodada < 14; rodada++) {
    const r = cruzamentosNovos(m0, P1, moveu, fim, rot);
    if (!r.faces.length) return { revertidos, ok: true, completo: r.completo };
    if (Date.now() > fim) break;
    // anel 0 = vértices das faces que cruzaram; anéis 1 e 2 = transição
    const nivel = new Int8Array(nv).fill(-1), fila = [];
    for (const t of r.faces) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; if (nivel[v] < 0) { nivel[v] = 0; fila.push(v); } }
    for (let d = 0; d < 2 + Math.min(rodada, 4); d++) {
      const prox = [];
      for (const v of fila) for (let q = viz.inicio[v]; q < viz.inicio[v + 1]; q++) { const u = viz.lista[q]; if (nivel[u] < 0) { nivel[u] = d + 1; prox.push(u); } }
      fila.length = 0; fila.push(...prox);
    }
    const aneis = 3 + Math.min(rodada, 4);
    for (let v = 0; v < nv; v++) {
      if (nivel[v] < 0) continue;
      let k;
      const meio = vezes[v] || rodada >= 5 ? 0 : 0.5;         // depois da 5ª rodada: volta toda
      if (nivel[v] === 0) { k = meio; vezes[v] = 1; }
      else k = nivel[v] / aneis + (1 - nivel[v] / aneis) * meio;
      for (let e = 0; e < 3; e++) P1[v * 3 + e] = P0[v * 3 + e] + k * (P1[v * 3 + e] - P0[v * 3 + e]);
      if (!k) { moveu[v] = 0; revertidos++; }
    }
  }
  return { revertidos, ok: false };
}

// ---------------------------------------------------------------- principal
// opc: { intensidade 0..1 (0,5), preservar (true), mascara (Uint8Array por
// face, opcional), raio (mm, opcional: substitui a intensidade) }
export function suavizarMalha(m0, opc = {}) {
  const t0 = Date.now();
  const I0 = m0.idx, nt0 = I0.length / 3, nv0 = m0.pos.length / 3;
  if (!nt0) throw new Error('Peça vazia.');
  const inten = Math.max(0, Math.min(1, opc.intensidade == null ? 0.6 : +opc.intensidade));
  const preservar = opc.preservar !== false;
  const diag = analisarSuavizar(m0), S = diag.tamanho, h0 = diag.aresta;
  const r = opc.raio != null ? +opc.raio : raioDaIntensidade(inten, S);

  // ---- região (modo local) e pesos da transição
  let peso = null, sub = null;
  const viz0 = vizinhosDoVertice(m0);
  if (opc.mascara) {
    const fonte = new Uint8Array(nv0); let n = 0;
    for (let t = 0; t < nt0; t++) if (opc.mascara[t]) { n++; for (let k = 0; k < 3; k++) fonte[I0[t * 3 + k]] = 1; }
    if (!n) throw new Error('Nada selecionado.');
    const banda = Math.max(3 * h0, r), margem = Math.max(4 * h0, 1.5 * r);
    const D = distanciaAteSelecao(m0.pos, viz0, nv0, fonte, banda + margem);
    peso = new Float32Array(nv0);
    for (let v = 0; v < nv0; v++) { const d = D[v]; if (d === 0) peso[v] = 1; else if (d < banda) { const x = 1 - d / banda; peso[v] = x * x * (3 - 2 * x); } }
    const usar = new Uint8Array(nt0); let nu = 0;
    for (let t = 0; t < nt0; t++) if (D[I0[t * 3]] < Infinity || D[I0[t * 3 + 1]] < Infinity || D[I0[t * 3 + 2]] < Infinity) { usar[t] = 1; nu++; }
    if (nu < nt0) {
      const lista = new Uint32Array(nu); let c = 0; for (let t = 0; t < nt0; t++) if (usar[t]) lista[c++] = t;
      const mapa = new Int32Array(nv0).fill(-1), volta = []; const idx = new Uint32Array(nu * 3);
      for (let k = 0; k < nu; k++) for (let j = 0; j < 3; j++) { const v = I0[lista[k] * 3 + j]; if (mapa[v] < 0) { mapa[v] = volta.length; volta.push(v); } idx[k * 3 + j] = mapa[v]; }
      const pos = new Float64Array(volta.length * 3);
      volta.forEach((v, i) => { pos[i * 3] = m0.pos[v * 3]; pos[i * 3 + 1] = m0.pos[v * 3 + 1]; pos[i * 3 + 2] = m0.pos[v * 3 + 2]; });
      sub = { malha: criar(pos, idx), volta: Int32Array.from(volta) };
    }
  }
  let m = sub ? sub.malha : m0, volta = sub ? sub.volta : null;
  // malha grande: renumera pra localidade (volta[v] = vértice na peça)
  let reord = false;
  if (m.pos.length / 3 > 30000) {
    const r2 = reordenar(m);
    const v2 = new Int32Array(r2.ordem.length);
    for (let k = 0; k < v2.length; k++) v2[k] = volta ? volta[r2.ordem[k]] : r2.ordem[k];
    m = r2.malha; volta = v2; reord = true;
  }
  const I = m.idx, nt = I.length / 3, nv = m.pos.length / 3;
  // vértice com peso 0 (margem de contexto) não anda
  let fixo = null;
  if (peso) { fixo = new Uint8Array(nv); for (let v = 0; v < nv; v++) if (!(peso[volta ? volta[v] : v] > 0)) fixo[v] = 1; }

  const tempos = {}; let tm = Date.now();
  const marcar = k => { const a = Date.now(); tempos[k] = a - tm; tm = a; };
  const viz = sub || reord ? vizinhosDoVertice(m) : viz0, fdv = facesDoVertice(m);
  const VF = anelDeFaces(I, nt, fdv);
  marcar('topologia');
  const P = Float64Array.from(m.pos);
  progresso(0.02, 'Medindo a malha');
  const N = new Float64Array(nt * 3), A = new Float64Array(nt);
  geomFaces(P, I, nt, N, null, A);
  const asp = aspereza(N, A, VF, nt);
  // passadas do grão: pela aspereza medida × intensidade
  // grão: guia (e passadas) conforme o ruído medido
  const guia = asp > 8 ? 2 : asp > 4 ? 1 : 0;
  const K = Math.max(guia ? 3 : 1, Math.min(12, Math.round(asp / 2.5 * (0.5 + inten))));
  const faseCaroco = r >= h0;
  const pesoGrao = faseCaroco ? 0.45 : 0.95;
  marcar('aspereza');
  // malha low-poly (menos de ~20 arestas de um lado a outro da peça) não é
  // scan com ruído: filtro de grão ali só estragaria a quina
  if (S / h0 >= 20) tirarGrao(P, I, nt, nv, VF, fdv, { K, sr: preservar ? 0.3 : 0.7, V: 14, guia }, fixo, f => progresso(0.03 + pesoGrao * f, 'Tirando o grão'));
  marcar('grao');
  let est2 = null;
  // alcance grande em VÁRIAS passadas moderadas (cada uma ≤ 5% da peça,
  // somando o mesmo alcance: r² = k·rᵢ²), recalculando normal e quina a cada
  // uma — de uma vez só, o alvo fica longe demais da malha e ela amassa
  if (faseCaroco) {
    const passo = 0.05 * S, k = Math.max(1, Math.ceil((r / passo) ** 2)), ri = r / Math.sqrt(k);
    for (let i = 0; i < k; i++) est2 = tirarCaroco(P, I, nt, nv, viz, { r: ri, th0: preservar ? 30 : 0, h: h0, S }, fixo, f => progresso(0.48 + 0.5 * (i + f) / k, k > 1 ? 'Alisando os caroços (' + (i + 1) + ' de ' + k + ')' : 'Alisando os caroços'), marcar);
    if (est2) est2.passes = k;
  }

  // triângulo fino que tombou (normal invertida em relação à entrada): os
  // vértices dele voltam metade do caminho, até nenhum ficar virado — mexe na
  // escala de uma lasca, não deixa emenda
  const viradas = desvirar(P, m.pos, I, nt, fixo);
  marcar('desvirar');
  // ---- volta pra peça inteira (com a transição suave)
  let Pout;
  if (!peso && !volta) Pout = P;
  else if (!peso) { Pout = new Float64Array(m0.pos.length); for (let v = 0; v < nv; v++) { const g = volta[v] * 3; Pout[g] = P[v * 3]; Pout[g + 1] = P[v * 3 + 1]; Pout[g + 2] = P[v * 3 + 2]; } }
  else {
    Pout = Float64Array.from(m0.pos);
    for (let v = 0; v < nv; v++) {
      const g = volta ? volta[v] : v, w = peso[g]; if (!(w > 0)) continue;
      for (let e = 0; e < 3; e++) Pout[g * 3 + e] += w * (P[v * 3 + e] - m0.pos[g * 3 + e]);
    }
  }
  for (let i = 0; i < Pout.length; i++) if (!isFinite(Pout[i])) throw new Error('A suavização falhou nesta malha (conta instável). Nada foi alterado.');
  // quanto mexeu
  let desl = 0, deslMax = 0, mov = 0;
  const moveu = new Uint8Array(nv0);
  for (let v = 0; v < nv0; v++) { const d = Math.hypot(Pout[v * 3] - m0.pos[v * 3], Pout[v * 3 + 1] - m0.pos[v * 3 + 1], Pout[v * 3 + 2] - m0.pos[v * 3 + 2]); if (d > 1e-9) { desl += d; mov++; moveu[v] = 1; if (d > deslMax) deslMax = d; } }
  marcar('volta');
  // falha segura: nenhum cruzamento novo — onde surgir, aquele pedacinho
  // volta ao original; se nem assim resolver, nada muda
  let cruz = null;
  if (opc.conferir !== false) {
    progresso(0.99, 'Conferindo a peça');
    // tempo pela quantidade de triângulos (1 milhão ~ 11 s): com limite fixo a
    // peça grande parava no meio da conferência
    cruz = consertarCruzamentos(m0, Pout, moveu, viz0, Math.max(12000, nt0 * 0.03));
    marcar('conferir');
    if (!cruz.ok) {
      const e = new Error('Com essa força, uma parte fina da peça passaria a atravessar ela mesma. Nada foi alterado. Use uma intensidade menor ou selecione só a região que quer alisar.');
      e.codigo = 'cruzou'; throw e;
    }
    if (cruz.revertidos) { desl = 0; deslMax = 0; mov = 0; for (let v = 0; v < nv0; v++) { const d = Math.hypot(Pout[v * 3] - m0.pos[v * 3], Pout[v * 3 + 1] - m0.pos[v * 3 + 1], Pout[v * 3 + 2] - m0.pos[v * 3 + 2]); if (d > 1e-9) { desl += d; mov++; if (d > deslMax) deslMax = d; } } }
  }
  const malha = criar(Pout, m0.idx, m0.cor ? m0.cor : null);
  // volume só vale em peça FECHADA (aberta: a conta depende de onde fica a
  // origem e mostraria "-22%" falso)
  const fechada = estatisticaArestas(m0).abertas === 0;
  const v0 = fechada ? volume(m0) : 0, v1 = fechada ? volume(malha) : 0;
  progresso(1, 'Pronto');
  return {
    malha,
    info: {
      raio: faseCaroco ? r : 0, passadas: K, aspereza: asp, facetada: diag.facetada,
      volume: v0 ? (v1 / v0 - 1) * 100 : null, viradas, deslocamentoMedio: mov ? desl / mov : 0, deslocamentoMax: deslMax,
      vertices: mov, local: !!peso, regiao: nt, ms: Date.now() - t0, etapa2: est2, tempos, cruzamentos: cruz
    }
  };
}

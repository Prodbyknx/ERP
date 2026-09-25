// Dados de exibição de uma malha (o que a placa de vídeo desenha), calculados
// FORA da thread da tela: no Web Worker, junto com o resultado da operação.
//   pos  Float32Array(9·nT)  vértices soltos por triângulo (cor por face nítida)
//   nor  Float32Array(9·nT)  normal suave com ângulo de quebra (dobra fica marcada)
//   fn   Float32Array(3·nT)  normal de cada face (pontaria e pincel)
// O triângulo t ocupa os vértices 3t, 3t+1, 3t+2 — é assim que a tela volta
// do triângulo desenhado pra face da malha.

export const ANGULO_QUEBRA = 40;

export function prepararRender(malha, opc = {}) {
  const p = malha.pos, idx = malha.idx, nt = idx.length / 3, nv = p.length / 3;
  const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9);
  const fa = new Float32Array(nt * 3), fn = new Float32Array(nt * 3);
  const suave = opc.suave !== false;
  const cont = suave ? new Uint32Array(nv + 1) : null;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    fa[t * 3] = nx; fa[t * 3 + 1] = ny; fa[t * 3 + 2] = nz;
    const L = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx / L; fn[t * 3 + 1] = ny / L; fn[t * 3 + 2] = nz / L;
    const o = t * 9;
    pos[o] = p[a]; pos[o + 1] = p[a + 1]; pos[o + 2] = p[a + 2];
    pos[o + 3] = p[b]; pos[o + 4] = p[b + 1]; pos[o + 5] = p[b + 2];
    pos[o + 6] = p[c]; pos[o + 7] = p[c + 1]; pos[o + 8] = p[c + 2];
    if (suave) { cont[idx[t * 3] + 1]++; cont[idx[t * 3 + 1] + 1]++; cont[idx[t * 3 + 2] + 1]++; }
  }
  if (!suave) {
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      nor[o] = fn[t * 3]; nor[o + 1] = fn[t * 3 + 1]; nor[o + 2] = fn[t * 3 + 2];
    }
    return { pos, nor, fn, suave: false };
  }
  for (let v = 0; v < nv; v++) cont[v + 1] += cont[v];
  const cur = cont.slice(0, nv), lista = new Uint32Array(nt * 3);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) lista[cur[idx[t * 3 + k]]++] = t;
  // cada canto mistura só as faces vizinhas parecidas com a SUA face:
  // face plana fica plana, dobra de 40°+ fica marcada
  const lim = Math.cos(ANGULO_QUEBRA * Math.PI / 180);
  for (let t = 0; t < nt; t++) {
    const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k], o = t * 9 + k * 3;
      let sx = 0, sy = 0, sz = 0;
      for (let q = cont[v]; q < cont[v + 1]; q++) {
        const f = lista[q];
        if (fn[f * 3] * fx + fn[f * 3 + 1] * fy + fn[f * 3 + 2] * fz >= lim) { sx += fa[f * 3]; sy += fa[f * 3 + 1]; sz += fa[f * 3 + 2]; }
      }
      const L = Math.hypot(sx, sy, sz);
      if (L > 0) { nor[o] = sx / L; nor[o + 1] = sy / L; nor[o + 2] = sz / L; }
      else { nor[o] = fx; nor[o + 1] = fy; nor[o + 2] = fz; }
    }
  }
  return { pos, nor, fn, suave: true };
}

// Malha "de verdade" (pra exibir): tem pos e idx e pelo menos um triângulo
export function ehMalha(x) {
  return !!x && typeof x === 'object' && ArrayBuffer.isView(x.pos) && x.idx instanceof Uint32Array && x.idx.length >= 3;
}

// Percorre um resultado de operação e devolve as malhas (sem repetir)
export function malhasDe(obj, out = [], vistos = new Set()) {
  if (!obj || typeof obj !== 'object' || vistos.has(obj) || ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return out;
  vistos.add(obj);
  if (ehMalha(obj)) { out.push(obj); return out; }
  if (Array.isArray(obj)) { for (const x of obj) malhasDe(x, out, vistos); return out; }
  for (const k in obj) if (k[0] !== '_') malhasDe(obj[k], out, vistos);
  return out;
}

// Segmentos da seção de um plano (coordenadas locais da malha).
// plano: { n:[x,y,z], d } com n·x = d. Escreve em 'saida' (Float32Array que
// cresce) e devolve { n: floats usados, saida }.
export function segmentosDaSecao(malha, plano, saida) {
  const p = malha.pos, idx = malha.idx, nt = idx.length / 3;
  const [nx, ny, nz] = plano.n, d = plano.d;
  let buf = saida && saida.length ? saida : new Float32Array(6 * 1024);
  let n = 0;
  const dist = new Float64Array(p.length / 3);
  for (let v = 0; v < dist.length; v++) dist[v] = p[v * 3] * nx + p[v * 3 + 1] * ny + p[v * 3 + 2] * nz - d;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const da = dist[a], db = dist[b], dc = dist[c];
    if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
    let k = 0;
    const pts = [0, 0, 0, 0, 0, 0];
    const aresta = (u, w, du, dw) => {
      if (k >= 2 || (du > 0) === (dw > 0) || du === dw) return;
      const s = du / (du - dw);
      pts[k * 3] = p[u * 3] + (p[w * 3] - p[u * 3]) * s;
      pts[k * 3 + 1] = p[u * 3 + 1] + (p[w * 3 + 1] - p[u * 3 + 1]) * s;
      pts[k * 3 + 2] = p[u * 3 + 2] + (p[w * 3 + 2] - p[u * 3 + 2]) * s;
      k++;
    };
    aresta(a, b, da, db); aresta(b, c, db, dc); aresta(c, a, dc, da);
    if (k < 2) continue;
    if (n + 6 > buf.length) { const nb = new Float32Array(buf.length * 2); nb.set(buf); buf = nb; }
    for (let i = 0; i < 6; i++) buf[n + i] = pts[i];
    n += 6;
  }
  return { n, saida: buf };
}

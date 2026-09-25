// RegionSelectionEngine — seleção por região, sem pintar triângulo por triângulo.
// Máscara = Uint8Array(nT). Adjacência = vizinhasFace (Int32Array 3*nT).
import { gemeas, vizinhasFace } from './topologia.js';
import { normaisFace, centroidesFace, areaFace } from './malha.js';

export function prepararAdjacencia(m) {
  const gem = gemeas(m);
  return { gem, viz: vizinhasFace(m, gem), normais: normaisFace(m), centros: centroidesFace(m) };
}

const cosGraus = g => Math.cos(g * Math.PI / 180);

// Cresce a partir de uma face respeitando dobras (ângulo entre faces vizinhas),
// desvio da normal da semente, cor e distância. Parou numa dobra = limite da peça.
// opc.detalhe: atravessa quinas convexas (pega o detalhe inteiro de um clique).
export function crescerRegiao(m, adj, semente, opc = {}) {
  const nt = m.idx.length / 3;
  const out = new Uint8Array(nt);
  if (semente < 0 || semente >= nt) return out;
  const cosViz = cosGraus(opc.anguloVizinho != null ? opc.anguloVizinho : 30);
  const cosSem = opc.anguloSemente != null ? cosGraus(opc.anguloSemente) : -2;
  const dist2 = opc.distancia ? opc.distancia * opc.distancia : Infinity;
  const N = adj.normais, C = adj.centros;
  const sx = C[semente * 3], sy = C[semente * 3 + 1], sz = C[semente * 3 + 2];
  const snx = N[semente * 3], sny = N[semente * 3 + 1], snz = N[semente * 3 + 2];
  const corSem = m.cor && opc.mesmaCor ? m.cor[semente] : -1;
  const permitido = opc.limite || null;       // máscara opcional (ex.: só dentro da peça)
  const fila = new Int32Array(nt);
  let ini = 0, fim = 0;
  fila[fim++] = semente; out[semente] = 1;
  while (ini < fim) {
    const f = fila[ini++];
    const fnx = N[f * 3], fny = N[f * 3 + 1], fnz = N[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const o = adj.viz[f * 3 + k];
      if (o < 0 || out[o]) continue;
      if (permitido && !permitido[o]) continue;
      const onx = N[o * 3], ony = N[o * 3 + 1], onz = N[o * 3 + 2];
      if (fnx * onx + fny * ony + fnz * onz < cosViz) {
        // "detalhe inteiro": atravessa quina pra FORA (borda de cima de um botão,
        // aresta de uma estrela em relevo) e só para na dobra pra DENTRO (o
        // vale onde o detalhe encosta no corpo)
        if (!opc.detalhe) continue;
        const dx = C[o * 3] - C[f * 3], dy = C[o * 3 + 1] - C[f * 3 + 1], dz = C[o * 3 + 2] - C[f * 3 + 2];
        const L = Math.hypot(dx, dy, dz) || 1;
        const a = (fnx * dx + fny * dy + fnz * dz) / L, b = -(onx * dx + ony * dy + onz * dz) / L;
        if (!(a < -0.02 && b < -0.02)) continue;
      }
      if (snx * onx + sny * ony + snz * onz < cosSem) continue;
      if (corSem >= 0 && m.cor[o] !== corSem) continue;
      if (dist2 < Infinity) {
        const dx = C[o * 3] - sx, dy = C[o * 3 + 1] - sy, dz = C[o * 3 + 2] - sz;
        if (dx * dx + dy * dy + dz * dz > dist2) continue;
      }
      out[o] = 1; fila[fim++] = o;
    }
  }
  return out;
}

// Tudo que está ligado à face (a "casca" / ilha inteira)
export function componenteConectado(m, adj, semente) {
  return crescerRegiao(m, adj, semente, { anguloVizinho: 180 });
}

export function porCor(m, k) {
  const nt = m.idx.length / 3, out = new Uint8Array(nt);
  if (!m.cor) { if (k === 0) out.fill(1); return out; }
  for (let t = 0; t < nt; t++) if (m.cor[t] === k) out[t] = 1;
  return out;
}

export function expandir(mask, adj, passos = 1) {
  let a = mask;
  for (let p = 0; p < passos; p++) {
    const b = Uint8Array.from(a);
    for (let f = 0; f < a.length; f++) {
      if (!a[f]) continue;
      for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0) b[o] = 1; }
    }
    a = b;
  }
  return a;
}

export function reduzir(mask, adj, passos = 1) {
  let a = mask;
  for (let p = 0; p < passos; p++) {
    const b = Uint8Array.from(a);
    for (let f = 0; f < a.length; f++) {
      if (!a[f]) continue;
      for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o < 0 || !a[o]) { b[f] = 0; break; } }
    }
    a = b;
  }
  return a;
}

export function inverter(mask) { const b = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) b[i] = mask[i] ? 0 : 1; return b; }

export function uniao(a, b) { const c = Uint8Array.from(a); for (let i = 0; i < b.length; i++) if (b[i]) c[i] = 1; return c; }
export function subtrair(a, b) { const c = Uint8Array.from(a); for (let i = 0; i < b.length; i++) if (b[i]) c[i] = 0; return c; }
export function contar(mask) { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) n++; return n; }

// Regiões ligadas dentro da máscara -> { rotulo Int32Array (-1 fora), n, tamanhos }
export function regioes(mask, adj) {
  const nt = mask.length, rot = new Int32Array(nt).fill(-1);
  const tam = [];
  const fila = new Int32Array(nt);
  for (let s = 0; s < nt; s++) {
    if (!mask[s] || rot[s] >= 0) continue;
    const id = tam.length;
    let ini = 0, fim = 0, n = 0;
    fila[fim++] = s; rot[s] = id;
    while (ini < fim) {
      const f = fila[ini++]; n++;
      for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0 && mask[o] && rot[o] < 0) { rot[o] = id; fila[fim++] = o; } }
    }
    tam.push(n);
  }
  return { rotulo: rot, n: tam.length, tamanhos: tam };
}

// Tira ilhas pequenas e tapa furinhos da seleção (borda limpa pra separar)
export function limpar(mask, adj, minFaces = 8) {
  let r = regioes(mask, adj);
  const a = Uint8Array.from(mask);
  for (let f = 0; f < a.length; f++) if (a[f] && r.tamanhos[r.rotulo[f]] < minFaces) a[f] = 0;
  const inv = inverter(a);
  r = regioes(inv, adj);
  // o maior "fora" é o resto da peça; buracos pequenos dentro da seleção são tapados
  let maior = -1, mx = -1; r.tamanhos.forEach((n, i) => { if (n > mx) { mx = n; maior = i; } });
  for (let f = 0; f < a.length; f++) if (!a[f] && r.rotulo[f] !== maior && r.tamanhos[r.rotulo[f]] < minFaces) a[f] = 1;
  return a;
}

// Suaviza o limite (voto da vizinhança), sem mexer longe da borda
export function suavizarBorda(mask, adj, passos = 2) {
  let a = mask;
  for (let p = 0; p < passos; p++) {
    const b = Uint8Array.from(a);
    for (let f = 0; f < a.length; f++) {
      let dentro = a[f] ? 1 : 0, n = 1;
      for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0) { dentro += a[o] ? 1 : 0; n++; } }
      if (dentro * 2 > n) b[f] = 1; else if (dentro * 2 < n) b[f] = 0;
    }
    a = b;
  }
  return a;
}

// "Selecionar similar": faces com normal parecida (e mesma cor, se tiver) às da seleção
export function similar(m, adj, mask, opc = {}) {
  const nt = mask.length, N = adj.normais;
  let sx = 0, sy = 0, sz = 0, cores = new Set();
  for (let f = 0; f < nt; f++) if (mask[f]) { sx += N[f * 3]; sy += N[f * 3 + 1]; sz += N[f * 3 + 2]; if (m.cor) cores.add(m.cor[f]); }
  const L = Math.hypot(sx, sy, sz) || 1; sx /= L; sy /= L; sz /= L;
  const c = cosGraus(opc.angulo != null ? opc.angulo : 15);
  const out = Uint8Array.from(mask);
  for (let f = 0; f < nt; f++) {
    if (out[f]) continue;
    if (m.cor && cores.size && opc.cor !== false && !cores.has(m.cor[f])) continue;
    if (N[f * 3] * sx + N[f * 3 + 1] * sy + N[f * 3 + 2] * sz >= c) out[f] = 1;
  }
  return out;
}

// Faces dentro de uma esfera (pincel). 'somenteFrente': normal virada pra câmera.
export function facesNaEsfera(m, adj, cx, cy, cz, r, visao) {
  const nt = m.idx.length / 3, C = adj.centros, N = adj.normais, p = m.pos, idx = m.idx;
  const r2 = r * r;
  const out = [];
  for (let f = 0; f < nt; f++) {
    // qualquer vértice ou o centro dentro da esfera
    let dentro = false;
    const dx = C[f * 3] - cx, dy = C[f * 3 + 1] - cy, dz = C[f * 3 + 2] - cz;
    if (dx * dx + dy * dy + dz * dz <= r2) dentro = true;
    else for (let k = 0; k < 3 && !dentro; k++) {
      const v = idx[f * 3 + k] * 3;
      const ex = p[v] - cx, ey = p[v + 1] - cy, ez = p[v + 2] - cz;
      if (ex * ex + ey * ey + ez * ez <= r2) dentro = true;
    }
    if (!dentro) continue;
    if (visao && N[f * 3] * visao[0] + N[f * 3 + 1] * visao[1] + N[f * 3 + 2] * visao[2] > 0) continue;
    out.push(f);
  }
  return out;
}

export function areaSelecionada(m, mask) {
  let a = 0;
  for (let f = 0; f < mask.length; f++) if (mask[f]) a += areaFace(m, f);
  return a;
}

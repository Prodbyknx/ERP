// MeshValidator — diagnóstico GEOMÉTRICO (independente do que aparece na tela).
import { arestas, gemeas, estatisticaArestas, componentes, verticesNaoManifold, facesDoVertice, listasPorRotulo } from './topologia.js';
import { caixa, volume, area, areaFace, subMalha, normaisFace } from './malha.js';
import { construirBVH, paresProximos, lancarRaio, pontoDentro } from './bvh.js';

const EPS = 1e-12;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cruz(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function pesc(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vert(m, i) { return [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]; }

// Möller 97 sem o caso coplanar (encostar coplanar não conta como defeito)
export function triCruzaTri(p1, q1, r1, p2, q2, r2) {
  const n2 = cruz(sub(q2, p2), sub(r2, p2));
  const L2 = Math.sqrt(pesc(n2, n2));
  if (L2 < EPS) return false;
  const tol2 = 1e-9 * L2;
  const d1 = pesc(n2, sub(p1, p2)), e1 = pesc(n2, sub(q1, p2)), f1 = pesc(n2, sub(r1, p2));
  if ((d1 > tol2 && e1 > tol2 && f1 > tol2) || (d1 < -tol2 && e1 < -tol2 && f1 < -tol2)) return false;
  const n1 = cruz(sub(q1, p1), sub(r1, p1));
  const L1 = Math.sqrt(pesc(n1, n1));
  if (L1 < EPS) return false;
  const tol1 = 1e-9 * L1;
  const d2 = pesc(n1, sub(p2, p1)), e2 = pesc(n1, sub(q2, p1)), f2 = pesc(n1, sub(r2, p1));
  if ((d2 > tol1 && e2 > tol1 && f2 > tol1) || (d2 < -tol1 && e2 < -tol1 && f2 < -tol1)) return false;
  if (Math.abs(d1) <= tol2 && Math.abs(e1) <= tol2 && Math.abs(f1) <= tol2) return false;
  const D = cruz(n1, n2);
  let eixo = 0, melhor = Math.abs(D[0]);
  if (Math.abs(D[1]) > melhor) { melhor = Math.abs(D[1]); eixo = 1; }
  if (Math.abs(D[2]) > melhor) eixo = 2;
  if (melhor < EPS) return false;
  function intervalo(P, Q, R, dp, dq, dr) {
    const ts = [];
    const corta = (a, b, da, db) => { if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return; ts.push(a + (b - a) * (da / (da - db))); };
    corta(P[eixo], Q[eixo], dp, dq); corta(Q[eixo], R[eixo], dq, dr); corta(R[eixo], P[eixo], dr, dp);
    if (ts.length < 2) return null;
    return [Math.min(ts[0], ts[1]), Math.max(ts[0], ts[1])];
  }
  const i1 = intervalo(p1, q1, r1, d1, e1, f1), i2 = intervalo(p2, q2, r2, d2, e2, f2);
  if (!i1 || !i2) return false;
  const tol = 1e-9 * Math.max(Math.abs(i1[0]), Math.abs(i1[1]), 1);
  return !(i1[1] < i2[0] + tol || i2[1] < i1[0] + tol);
}

// Faces que se cruzam (sem contar vizinhas que dividem vértice).
export function autoInterseccoes(m, opc = {}) {
  const max = opc.max || 2000;
  const bvh = opc.bvh || construirBVH(m);
  const idx = m.idx;
  const faces = new Set();
  let pares = 0;
  const limiteTempo = opc.tempoMs ? Date.now() + opc.tempoMs : Infinity;
  let visitas = 0, completo = true;
  paresProximos(bvh, (t1, t2) => {
    if ((++visitas & 4095) === 0 && Date.now() > limiteTempo) { completo = false; return true; }
    const a0 = idx[t1 * 3], a1 = idx[t1 * 3 + 1], a2 = idx[t1 * 3 + 2];
    const b0 = idx[t2 * 3], b1 = idx[t2 * 3 + 1], b2 = idx[t2 * 3 + 2];
    if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) return false;
    if (triCruzaTri(vert(m, a0), vert(m, a1), vert(m, a2), vert(m, b0), vert(m, b1), vert(m, b2))) {
      pares++; faces.add(t1); faces.add(t2);
      if (pares >= max) { completo = false; return true; }
    }
    return false;
  });
  return { pares, faces: Uint32Array.from(faces), completo };
}

// Faces com índice repetido ou área ~0
export function facesDegeneradas(m, tolArea) {
  const nt = m.idx.length / 3, idx = m.idx;
  const cx = caixa(m);
  const diag = cx ? Math.hypot(cx.tam[0], cx.tam[1], cx.tam[2]) : 1;
  const tol = tolArea != null ? tolArea : Math.max(1e-12, diag * diag * 1e-14);
  const lista = [];
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a === b || b === c || a === c || areaFace(m, t) <= tol) lista.push(t);
  }
  return lista;
}

// Faces repetidas (mesmo trio de vértices, em qualquer ordem)
export function facesDuplicadas(m) {
  const nt = m.idx.length / 3, idx = m.idx;
  let cap = 1; while (cap < nt * 2) cap <<= 1;
  const tab = new Int32Array(cap).fill(-1);
  const dup = [];
  for (let t = 0; t < nt; t++) {
    let a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a > b) { const x = a; a = b; b = x; }
    if (b > c) { const x = b; b = c; c = x; }
    if (a > b) { const x = a; a = b; b = x; }
    let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791);
    let s = (h >>> 0) & (cap - 1);
    while (true) {
      const u = tab[s];
      if (u < 0) { tab[s] = t; break; }
      let x = idx[u * 3], y = idx[u * 3 + 1], z = idx[u * 3 + 2];
      if (x > y) { const q = x; x = y; y = q; }
      if (y > z) { const q = y; y = z; z = q; }
      if (x > y) { const q = x; x = y; y = q; }
      if (x === a && y === b && z === c) { dup.push([u, t]); break; }
      s = (s + 1) & (cap - 1);
    }
  }
  return dup;
}

// Vértices diferentes na mesma posição (a menos de tol)
export function verticesCoincidentes(m, tol) {
  const nv = m.pos.length / 3, p = m.pos;
  const inv = 1 / tol;
  const grade = new Map();
  let n = 0;
  const chave = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let v = 0; v < nv; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck = Math.floor(z * inv);
    let achou = false;
    for (let di = -1; di <= 1 && !achou; di++) for (let dj = -1; dj <= 1 && !achou; dj++) for (let dk = -1; dk <= 1 && !achou; dk++) {
      const l = grade.get(chave(ci + di, cj + dj, ck + dk));
      if (!l) continue;
      for (const u of l) {
        if (Math.abs(p[u * 3] - x) <= tol && Math.abs(p[u * 3 + 1] - y) <= tol && Math.abs(p[u * 3 + 2] - z) <= tol) { achou = true; break; }
      }
    }
    if (achou) { n++; continue; }
    const ch = chave(ci, cj, ck);
    const l = grade.get(ch); if (l) l.push(v); else grade.set(ch, [v]);
  }
  return n;
}

// Espessura: raio pra dentro a partir de cada face amostrada até sair do
// outro lado. Devolve espessura por face amostrada e o resumo.
export function espessuras(m, opc = {}) {
  const nt = m.idx.length / 3;
  const bvh = opc.bvh || construirBVH(m);
  const nrm = normaisFace(m);
  const maxAmostras = opc.amostras || 60000;
  const passo = Math.max(1, Math.floor(nt / maxAmostras));
  const esp = new Float32Array(nt).fill(NaN);
  const idx = m.idx, p = m.pos;
  const limite = opc.limite != null ? opc.limite : 0.8;
  let menor = Infinity, medidas = 0, abaixo = 0;
  for (let t = 0; t < nt; t += passo) {
    const nx = -nrm[t * 3], ny = -nrm[t * 3 + 1], nz = -nrm[t * 3 + 2];
    if (!nx && !ny && !nz) continue;
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ox = (p[a] + p[b] + p[c]) / 3, oy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, oz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const h = lancarRaio(bvh, ox, oy, oz, nx, ny, nz, Infinity, t, 1e-6);
    if (!h) continue;
    // só conta se sai pelo avesso de uma face (entrou no sólido e saiu)
    const f = h.face;
    if (nrm[f * 3] * nx + nrm[f * 3 + 1] * ny + nrm[f * 3 + 2] * nz <= 0) continue;
    esp[t] = h.t;
    medidas++;
    if (h.t < menor) menor = h.t;
    if (h.t < limite) abaixo++;
  }
  return { porFace: esp, passo, minima: isFinite(menor) ? menor : null, medidas, abaixo, limite };
}

// Regiões críticas = grupos de faces finas vizinhas
function contarRegioes(m, faces, gem) {
  const marca = new Uint8Array(m.idx.length / 3);
  faces.forEach(t => { marca[t] = 1; });
  let regioes = 0;
  for (const t0 of faces) {
    if (marca[t0] !== 1) continue;
    regioes++;
    const pilha = [t0]; marca[t0] = 2;
    while (pilha.length) {
      const t = pilha.pop();
      for (let k = 0; k < 3; k++) {
        const g = gem[t * 3 + k];
        if (g < 0) continue;
        const o = (g / 3) | 0;
        if (marca[o] === 1) { marca[o] = 2; pilha.push(o); }
      }
    }
  }
  return regioes;
}

// Diagnóstico completo
export function validar(m, opc = {}) {
  const nt = m.idx.length / 3;
  const r = {
    vertices: m.pos.length / 3, triangulos: nt,
    arestasAbertas: 0, arestasNaoManifold: 0, verticesNaoManifold: 0, orientacaoTrocada: 0,
    facesDegeneradas: 0, facesDuplicadas: 0, verticesDuplicados: 0, verticesSoltos: 0,
    componentes: 0, componentesAbertos: 0, componentesInvertidos: 0, componentesInternos: 0,
    autoInterseccoes: null, autoInterseccoesCompleto: true,
    volume: 0, area: 0, caixa: caixa(m),
    espessuraMinima: null, facesFinas: 0, regioesCriticas: 0, limiteEspessura: opc.limiteEspessura || 0.8,
    fechada: false, imprimivel: false
  };
  if (!nt) return r;
  const top = arestas(m);
  const est = estatisticaArestas(m, top);
  r.arestasAbertas = est.abertas; r.arestasNaoManifold = est.naoManifold; r.orientacaoTrocada = est.invertidas;
  const gem = gemeas(m, top);
  const fdv = facesDoVertice(m);
  r.verticesNaoManifold = verticesNaoManifold(m, gem, fdv).length;
  for (let v = 0; v < r.vertices; v++) if (fdv.inicio[v + 1] === fdv.inicio[v]) r.verticesSoltos++;
  const deg = facesDegeneradas(m);
  r.facesDegeneradas = deg.length;
  r.facesDuplicadas = facesDuplicadas(m).length;
  const d = r.caixa ? Math.hypot(r.caixa.tam[0], r.caixa.tam[1], r.caixa.tam[2]) : 1;
  r.verticesDuplicados = verticesCoincidentes(m, Math.max(1e-7, d * 1e-7));
  r.volume = volume(m);
  r.area = area(m);

  // componentes: abertos, invertidos (volume negativo) e internos (dentro de outro)
  const comp = componentes(m, top);
  r.componentes = comp.n;
  const listas = listasPorRotulo(comp.rotulo, comp.n);
  const abertaPorComp = new Uint8Array(comp.n);
  for (let e = 0; e < top.nE; e++) {
    const n = top.inicio[e + 1] - top.inicio[e];
    if (n !== 2) abertaPorComp[comp.rotulo[(top.ordem[top.inicio[e]] / 3) | 0]] = 1;
  }
  const infoComp = [];
  for (let c = 0; c < comp.n; c++) {
    const faces = listas.lista.subarray(listas.inicio[c], listas.inicio[c + 1]);
    const sm = subMalha(m, faces).malha;
    const vol = volume(sm);
    const aberta = !!abertaPorComp[c];
    if (aberta) r.componentesAbertos++;
    else if (vol < 0) r.componentesInvertidos++;
    infoComp.push({ faces: faces.length, volume: vol, aberta, caixa: caixa(sm) });
  }
  r.infoComponentes = infoComp;

  const fazerPesado = opc.completo !== false;
  let bvh = null;
  if (fazerPesado) {
    bvh = construirBVH(m);
    const ai = autoInterseccoes(m, { bvh, tempoMs: opc.tempoMs || 20000, max: opc.maxInterseccoes || 5000 });
    r.autoInterseccoes = ai.pares;
    r.autoInterseccoesCompleto = ai.completo;
    r.facesComInterseccao = ai.faces;
    // componente inteiro dentro de outro (sobra interna de modelo de IA)
    if (comp.n > 1 && comp.n < 400) {
      for (let c = 0; c < comp.n; c++) {
        const t = listas.lista[listas.inicio[c]];
        const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, cc = m.idx[t * 3 + 2] * 3;
        const x = (m.pos[a] + m.pos[b] + m.pos[cc]) / 3, y = (m.pos[a + 1] + m.pos[b + 1] + m.pos[cc + 1]) / 3, z = (m.pos[a + 2] + m.pos[b + 2] + m.pos[cc + 2]) / 3;
        // ponto de c dentro do resto (paridade conta c também: 1 cruzamento dele mesmo)
        infoComp[c].interno = pontoDentroOutros(m, bvh, comp.rotulo, c, x, y, z);
        if (infoComp[c].interno) r.componentesInternos++;
      }
    }
    const e = espessuras(m, { bvh, limite: r.limiteEspessura, amostras: opc.amostrasEspessura });
    r.espessuraMinima = e.minima;
    r.facesFinas = e.abaixo;
    r.espessuraPasso = e.passo;
    r.espessuraPorFace = e.porFace;
    const finas = [];
    for (let t = 0; t < nt; t++) if (e.porFace[t] < r.limiteEspessura) finas.push(t);
    r.regioesCriticas = e.passo === 1 ? contarRegioes(m, finas, gem) : Math.min(finas.length, contarRegioes(m, finas, gem));
  }
  r.fechada = r.arestasAbertas === 0 && r.arestasNaoManifold === 0 && r.orientacaoTrocada === 0 && r.verticesNaoManifold === 0;
  r.imprimivel = r.fechada && r.componentesInvertidos === 0 && r.facesDegeneradas === 0 && r.facesDuplicadas === 0 &&
    (r.autoInterseccoes === 0 || r.autoInterseccoes === null) && r.volume > 0;
  void pontoDentro;
  return r;
}

// dentro de algum OUTRO componente? conta cruzamentos ignorando o próprio
function pontoDentroOutros(m, bvh, rotulo, c, x, y, z) {
  const dirs = [[0.5773, 0.5774, 0.5773], [-0.6123, 0.3536, 0.7071], [0.2673, -0.8018, -0.5345]];
  let votos = 0;
  for (const d of dirs) {
    let n = 0, ox = x, oy = y, oz = z, pula = -1;
    for (let passo = 0; passo < 200; passo++) {
      const h = lancarRaio(bvh, ox, oy, oz, d[0], d[1], d[2], Infinity, pula, 1e-7);
      if (!h) break;
      if (rotulo[h.face] !== c) n++;
      ox += d[0] * h.t; oy += d[1] * h.t; oz += d[2] * h.t; pula = h.face;
    }
    if (n % 2 === 1) votos++;
  }
  return votos >= 2;
}

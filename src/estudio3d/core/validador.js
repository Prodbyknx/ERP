// MeshValidator — diagnóstico GEOMÉTRICO (independente do que aparece na tela).
import { arestas, gemeas, estatisticaArestas, componentes, verticesNaoManifold, facesDoVertice, listasPorRotulo } from './topologia.js';
import { caixa, volume, area, areaFace, subMalha, normaisFace } from './malha.js';
import { construirBVH, paresProximos, lancarRaio, pontoDentro, dentroDeOutras } from './bvh.js';
import { progresso } from './progresso.js';
import { tolSolda, tolAreaDegenerada, AREA_MINIMA_REGIAO_FINA } from './tolerancias.js';

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
      if (opc.pares) opc.pares.push(t1, t2);
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
  const tol = tolArea != null ? tolArea : tolAreaDegenerada(diag);
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

// Vértices de aresta aberta (borda de buraco / costura não soldada)
export function verticesDeBorda(m, top = arestas(m)) {
  const borda = new Uint8Array(m.pos.length / 3);
  for (let e = 0; e < top.nE; e++) {
    if (top.inicio[e + 1] - top.inicio[e] !== 1) continue;
    const h = top.ordem[top.inicio[e]], t = (h / 3) | 0, k = h % 3;
    borda[m.idx[h]] = 1; borda[m.idx[t * 3 + (k + 1) % 3]] = 1;
  }
  return borda;
}

// Vértices diferentes na mesma posição (a menos de tol).
// borda (opcional, Uint8Array por vértice: 1 = vértice de aresta aberta):
// devolve { comBorda, semBorda }. Com borda é DEFEITO (costura não soldada,
// o conserto solda). Sem borda é normal: peças que se encostam num ponto/aresta
// ou lasca fininha — soldar criaria ponto non-manifold (auditoria A5).
export function verticesCoincidentes(m, tol, borda) {
  const nv = m.pos.length / 3, p = m.pos;
  // célula = 4·tol: só olha a célula vizinha quando o ponto está a menos de
  // tol da divisa (~3 consultas por vértice em vez de 27; mesmo resultado)
  const cel = 4 * tol, inv = 1 / cel;
  const grade = new Map();
  let n = 0, comBorda = 0;
  const chave = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  const faixa = (c, x) => { const f = x * inv - c; return f < 0.25 ? -1 : f > 0.75 ? 1 : 0; };
  for (let v = 0; v < nv; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck = Math.floor(z * inv);
    const fi = faixa(ci, x), fj = faixa(cj, y), fk = faixa(ck, z);
    let achou = -1;
    for (let di = Math.min(0, fi); di <= Math.max(0, fi) && achou < 0; di++) for (let dj = Math.min(0, fj); dj <= Math.max(0, fj) && achou < 0; dj++) for (let dk = Math.min(0, fk); dk <= Math.max(0, fk) && achou < 0; dk++) {
      const l = grade.get(chave(ci + di, cj + dj, ck + dk));
      if (!l) continue;
      for (const u of l) {
        if (Math.abs(p[u * 3] - x) <= tol && Math.abs(p[u * 3 + 1] - y) <= tol && Math.abs(p[u * 3 + 2] - z) <= tol) { achou = u; break; }
      }
    }
    if (achou >= 0) { n++; if (borda && (borda[v] || borda[achou])) comBorda++; continue; }
    const ch = chave(ci, cj, ck);
    const l = grade.get(ch); if (l) l.push(v); else grade.set(ch, [v]);
  }
  return borda ? { comBorda, semBorda: n - comBorda } : n;
}

// Espessura: raio pra dentro a partir de cada face amostrada até SAIR do
// material. O raio anda de acerto em acerto contando entra/sai (face com a
// normal contra o raio = entrou em mais material; a favor = saiu): só termina
// quando sai de TODO o material. Assim casca sobreposta (que o conserto não
// juntou) não vira "parede de 0,00 mm", e vazio de peça oca continua medindo
// a parede. Face que divide vértice com a de origem (dobra/lasca da própria
// superfície) não conta como o outro lado (auditoria A6).
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
  // anda no raio somando entra(+1)/sai(−1) a partir de 'dentro'; devolve a
  // distância em que sai de todo material (ou -1). sentido = +1 pra fora, −1 pra dentro
  const vizinha = (f, va, vb, vc) => { const f0 = idx[f * 3], f1 = idx[f * 3 + 1], f2 = idx[f * 3 + 2]; return f0 === va || f0 === vb || f0 === vc || f1 === va || f1 === vb || f1 === vc || f2 === va || f2 === vb || f2 === vc; };
  function andar(t, ox, oy, oz, dx, dy, dz, dentro, ate) {
    const va = idx[t * 3], vb = idx[t * 3 + 1], vc = idx[t * 3 + 2];
    let total = 0, ignorar = t;
    for (let k = 0; k < 24; k++) {
      const h = lancarRaio(bvh, ox, oy, oz, dx, dy, dz, Infinity, ignorar, 1e-6);
      if (!h) return ate ? dentro : -1;
      total += h.t; ox += dx * h.t; oy += dy * h.t; oz += dz * h.t; ignorar = h.face;
      if (vizinha(h.face, va, vb, vc)) continue;            // dobra da própria superfície
      const dot = nrm[h.face * 3] * dx + nrm[h.face * 3 + 1] * dy + nrm[h.face * 3 + 2] * dz;
      if (ate) { if (dot > 0) dentro++; else if (dot < 0) dentro--; continue; }   // pra fora: conta em quantas cascas o ponto está
      if (dot > 0) dentro--; else if (dot < 0) dentro++;
      if (dentro <= 0) return total;
    }
    return ate ? dentro : -1;
  }
  for (let t = 0; t < nt; t += passo) {
    const nx = -nrm[t * 3], ny = -nrm[t * 3 + 1], nz = -nrm[t * 3 + 2];
    if (!nx && !ny && !nz) continue;
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ox = (p[a] + p[b] + p[c]) / 3, oy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, oz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    let e = andar(t, ox, oy, oz, nx, ny, nz, 1, false);
    // deu fino: a face pode estar DENTRO de outra casca (sobreposta). Conta pra
    // fora em quantas cascas o ponto já está e mede de novo a partir daí
    if (e >= 0 && e < limite) {
      const fora = andar(t, ox, oy, oz, -nx, -ny, -nz, 0, true);
      if (fora > 0) e = andar(t, ox, oy, oz, nx, ny, nz, fora + 1, false);
    }
    if (e < 0) continue;
    esp[t] = e;
    medidas++;
    if (e < menor) menor = e;
    if (e < limite) abaixo++;
  }
  return { porFace: esp, passo, minima: isFinite(menor) ? menor : null, medidas, abaixo, limite };
}

// Regiões finas = grupos de faces finas vizinhas, com a área de cada uma
// (amostrado de passo em passo: cada amostra vale pela área × passo)
function regioesFinas(m, faces, gem, passo) {
  const marca = new Uint8Array(m.idx.length / 3);
  faces.forEach(t => { marca[t] = 1; });
  const regioes = [];
  for (const t0 of faces) {
    if (marca[t0] !== 1) continue;
    const lista = [t0]; marca[t0] = 2;
    let area = 0;
    for (let i = 0; i < lista.length; i++) {
      const t = lista[i];
      area += areaFace(m, t) * passo;
      for (let k = 0; k < 3; k++) {
        const g = gem[t * 3 + k];
        if (g < 0) continue;
        const o = (g / 3) | 0;
        if (marca[o] === 1) { marca[o] = 2; lista.push(o); }
      }
    }
    regioes.push({ faces: lista, area });
  }
  return regioes;
}

// O que impede "pronto pra imprimir". A MESMA regra no laudo, no Início, na
// bolinha de saúde e no Preparar (antes eram 4 contas diferentes e a bolinha
// dizia "Pronto" enquanto o laudo dizia "atenção" — auditoria M3).
// Vértice repetido não entra: é sintoma de aresta aberta (que já conta).
export const DEFEITOS_GRAVES = [
  ['arestasAbertas', 'buracos'], ['arestasNaoManifold', 'arestas soltas'], ['verticesNaoManifold', 'arestas soltas'],
  ['orientacaoTrocada', 'faces viradas'], ['componentesInvertidos', 'faces viradas'], ['facesDuplicadas', 'faces repetidas'],
  ['facesDegeneradas', 'faces degeneradas'], ['autoInterseccoes', 'partes que se atravessam'], ['componentesInternos', 'sobras internas']
];
export function defeitosGraves(r) {
  let total = 0;
  const tipos = [];
  for (const [k, nome] of DEFEITOS_GRAVES) {
    const n = (r && r[k]) || 0;
    if (!n) continue;
    total += n;
    if (!tipos.includes(nome)) tipos.push(nome);
  }
  return { total, tipos };
}

// Diagnóstico completo
export function validar(m, opc = {}) {
  const nt = m.idx.length / 3;
  const r = {
    vertices: m.pos.length / 3, triangulos: nt,
    arestasAbertas: 0, arestasNaoManifold: 0, verticesNaoManifold: 0, orientacaoTrocada: 0,
    facesDegeneradas: 0, facesDuplicadas: 0, verticesDuplicados: 0, verticesSobrepostos: 0, verticesSoltos: 0,
    componentes: 0, componentesAbertos: 0, componentesInvertidos: 0, componentesInternos: 0, cavidades: 0,
    autoInterseccoes: null, autoInterseccoesCompleto: true,
    volume: 0, area: 0, caixa: caixa(m),
    espessuraMinima: null, facesFinas: 0, regioesCriticas: 0, limiteEspessura: opc.limiteEspessura || 0.8,
    fechada: false, imprimivel: false
  };
  if (!nt) return r;
  // etapas pra barra só quando a operação de cima pede (validar roda dentro de outras)
  const pg = opc.progresso ? progresso : () => {};
  pg(0.05, 'Conferindo as arestas');
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
  // vértice de aresta aberta (costura que dá pra soldar) × encostado (normal)
  const vc = verticesCoincidentes(m, tolSolda(d), verticesDeBorda(m, top));
  r.verticesDuplicados = vc.comBorda;
  r.verticesSobrepostos = vc.semBorda;
  r.volume = volume(m);
  r.area = area(m);

  // componentes: abertos, invertidos (volume negativo) e internos (dentro de outro)
  pg(0.25, 'Separando as cascas');
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
    else if (vol < 0) {
      // vazio fechado dentro de outra casca (peça oca) é cavidade, não defeito
      const cav = comp.n <= 60 && dentroDeOutras(m, k => listas.lista.subarray(listas.inicio[k], listas.inicio[k + 1]), c, comp.n);
      if (cav) r.cavidades++; else r.componentesInvertidos++;
    }
    infoComp.push({ faces: faces.length, volume: vol, aberta, caixa: caixa(sm) });
  }
  r.infoComponentes = infoComp;

  const fazerPesado = opc.completo !== false;
  let bvh = null;
  if (fazerPesado) {
    pg(0.45, 'Procurando cruzamentos');
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
        // cavidade (vazio de peça oca, volume negativo) não é sobra interna
        infoComp[c].interno = infoComp[c].volume > 0 && pontoDentroOutros(m, bvh, comp.rotulo, c, x, y, z);
        if (infoComp[c].interno) r.componentesInternos++;
      }
    }
    pg(0.8, 'Medindo a espessura');
    const e = espessuras(m, { bvh, limite: r.limiteEspessura, amostras: opc.amostrasEspessura });
    r.espessuraPasso = e.passo;
    r.espessuraPorFace = e.porFace;
    const finas = [];
    for (let t = 0; t < nt; t++) if (e.porFace[t] < r.limiteEspessura) finas.push(t);
    // região fina minúscula (face dobrada, lasca) é ruído: fica de fora da
    // contagem e da espessura mínima (senão "0,00 mm" por causa de 1 face)
    const regs = regioesFinas(m, finas, gem, e.passo);
    let ruido = 0;
    for (const g of regs) if (g.area < AREA_MINIMA_REGIAO_FINA) { for (const t of g.faces) e.porFace[t] = NaN; ruido += g.faces.length; }
    let menor = Infinity;
    for (let t = 0; t < nt; t++) if (e.porFace[t] < menor) menor = e.porFace[t];
    r.espessuraMinima = isFinite(menor) ? menor : null;
    r.facesFinas = e.abaixo - ruido;
    r.regioesCriticas = regs.filter(g => g.area >= AREA_MINIMA_REGIAO_FINA).length;
  }
  r.fechada = r.arestasAbertas === 0 && r.arestasNaoManifold === 0 && r.orientacaoTrocada === 0 && r.verticesNaoManifold === 0;
  r.imprimivel = r.fechada && defeitosGraves(r).total === 0 && r.volume > 0;
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

// Faces dos componentes que estão inteiros dentro de outro (sobra de modelo de IA)
export function facesInternas(m) {
  const top = arestas(m);
  const comp = componentes(m, top);
  const mask = new Uint8Array(m.idx.length / 3);
  if (comp.n < 2) return { mask, removidos: 0 };
  const listas = listasPorRotulo(comp.rotulo, comp.n);
  const bvh = construirBVH(m);
  let removidos = 0;
  for (let c = 0; c < comp.n; c++) {
    const t = listas.lista[listas.inicio[c]];
    const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, cc = m.idx[t * 3 + 2] * 3;
    const x = (m.pos[a] + m.pos[b] + m.pos[cc]) / 3, y = (m.pos[a + 1] + m.pos[b + 1] + m.pos[cc + 1]) / 3, z = (m.pos[a + 2] + m.pos[b + 2] + m.pos[cc + 2]) / 3;
    if (pontoDentroOutros(m, bvh, comp.rotulo, c, x, y, z)) {
      for (let i = listas.inicio[c]; i < listas.inicio[c + 1]; i++) mask[listas.lista[i]] = 1;
      removidos++;
    }
  }
  return { mask, removidos };
}

// Faces que tocam aresta aberta ou non-manifold (pro modo "problemas")
export function facesProblematicas(m) {
  const top = arestas(m);
  const mask = new Uint8Array(m.idx.length / 3);
  for (let e = 0; e < top.nE; e++) {
    const n = top.inicio[e + 1] - top.inicio[e];
    let ruim = n !== 2;
    if (!ruim) { const h0 = top.ordem[top.inicio[e]], h1 = top.ordem[top.inicio[e] + 1]; ruim = m.idx[h0] === m.idx[h1]; }
    if (ruim) for (let i = top.inicio[e]; i < top.inicio[e + 1]; i++) mask[(top.ordem[i] / 3) | 0] = n === 1 ? 1 : n > 2 ? 2 : 3;
  }
  return mask;
}


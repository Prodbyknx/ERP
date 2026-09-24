// MeshSegmentationEngine — sugere regiões que parecem peças diferentes.
// 1) cascas soltas já são peças;
// 2) dentro de cada casca: retalhos (crescimento por normal que para em dobra
//    côncava), depois junta retalhos vizinhos do mais barato pro mais caro.
//    Custo alto = fronteira côncava (onde uma orelha encontra a cabeça) e
//    "grossura" diferente (diâmetro da forma, medido por raios pra dentro).
// Não dá nome semântico: devolve Parte 01, 02... ordenadas por área.
import { prepararAdjacencia } from './selecao.js';
import { componentes, listasPorRotulo } from './topologia.js';
import { areaFace } from './malha.js';
import { construirBVH, lancarRaio } from './bvh.js';

// diâmetro da forma por face (amostrado + espalhado pros vizinhos)
export function diametroForma(m, adj, opc = {}) {
  const nt = m.idx.length / 3;
  const bvh = opc.bvh || construirBVH(m);
  const N = adj.normais, C = adj.centros;
  const alvo = opc.amostras || 20000;
  const passo = Math.max(1, Math.floor(nt / alvo));
  const sdf = new Float32Array(nt).fill(NaN);
  const cone = [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]];
  const vals = [];
  for (let f = 0; f < nt; f += passo) {
    const nx = -N[f * 3], ny = -N[f * 3 + 1], nz = -N[f * 3 + 2];
    if (!nx && !ny && !nz) continue;
    // base do cone
    const a = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = a[1] * nz - a[2] * ny, uy = a[2] * nx - a[0] * nz, uz = a[0] * ny - a[1] * nx;
    const L = Math.hypot(ux, uy, uz); ux /= L; uy /= L; uz /= L;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    vals.length = 0;
    for (const [p, q] of cone) {
      let dx = nx + p * ux + q * vx, dy = ny + p * uy + q * vy, dz = nz + p * uz + q * vz;
      const Ld = Math.hypot(dx, dy, dz); dx /= Ld; dy /= Ld; dz /= Ld;
      const h = lancarRaio(bvh, C[f * 3], C[f * 3 + 1], C[f * 3 + 2], dx, dy, dz, Infinity, f, 1e-6);
      if (h && N[h.face * 3] * dx + N[h.face * 3 + 1] * dy + N[h.face * 3 + 2] * dz > 0) vals.push(h.t);
    }
    if (vals.length) { vals.sort((x, y) => x - y); sdf[f] = vals[vals.length >> 1]; }
  }
  // espalha pros não amostrados (BFS a partir dos medidos)
  const fila = [];
  for (let f = 0; f < nt; f++) if (!isNaN(sdf[f])) fila.push(f);
  for (let i = 0; i < fila.length; i++) {
    const f = fila[i];
    for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0 && isNaN(sdf[o])) { sdf[o] = sdf[f]; fila.push(o); } }
  }
  for (let f = 0; f < nt; f++) if (isNaN(sdf[f])) sdf[f] = 1;
  return sdf;
}

// côncava? vizinho acima do plano da face
function concavidade(adj, f, o) {
  const N = adj.normais, C = adj.centros;
  const cosA = N[f * 3] * N[o * 3] + N[f * 3 + 1] * N[o * 3 + 1] + N[f * 3 + 2] * N[o * 3 + 2];
  const dx = C[o * 3] - C[f * 3], dy = C[o * 3 + 1] - C[f * 3 + 1], dz = C[o * 3 + 2] - C[f * 3 + 2];
  const lado = dx * N[f * 3] + dy * N[f * 3 + 1] + dz * N[f * 3 + 2];
  const dobra = 1 - Math.max(-1, Math.min(1, cosA));        // 0 plano .. 2 dobrado
  return lado > 1e-9 ? dobra : -dobra;                        // + côncavo, - convexo
}

export function segmentar(m, opc = {}) {
  const nt = m.idx.length / 3;
  const adj = opc.adj || prepararAdjacencia(m);
  const partesDesejadas = opc.partes || 0;                     // 0 = automático
  const rotulo = new Int32Array(nt).fill(-1);
  const comp = componentes(m);
  const listas = listasPorRotulo(comp.rotulo, comp.n);
  const areaF = new Float64Array(nt);
  let areaTotal = 0;
  for (let f = 0; f < nt; f++) { areaF[f] = areaFace(m, f); areaTotal += areaF[f]; }
  const sdf = opc.semDiametro ? null : diametroForma(m, adj, opc);
  const logS = sdf ? Float32Array.from(sdf, v => Math.log(Math.max(1e-3, v))) : null;
  const sensibilidade = opc.sensibilidade != null ? opc.sensibilidade : 0.5;   // 0 poucas partes .. 1 muitas
  let proximo = 0;
  const grupos = [];

  for (let c = 0; c < comp.n; c++) {
    const faces = listas.lista.subarray(listas.inicio[c], listas.inicio[c + 1]);
    let areaC = 0; for (const f of faces) areaC += areaF[f];
    // casca pequena ou sem dobra: vira uma parte só
    if (faces.length < 200 || areaC < areaTotal * 0.002) {
      const id = proximo++;
      for (const f of faces) rotulo[f] = id;
      grupos.push({ id, area: areaC, casca: c });
      continue;
    }
    // 1. retalhos
    const ret = new Int32Array(nt).fill(-1);
    const alvoRet = Math.max(30, Math.floor(faces.length / 400));
    const cosLim = Math.cos(28 * Math.PI / 180);
    const retInfo = [];
    const fila = [];
    for (const s of faces) {
      if (ret[s] >= 0) continue;
      const id = retInfo.length;
      ret[s] = id; fila.length = 0; fila.push(s);
      const sn = [adj.normais[s * 3], adj.normais[s * 3 + 1], adj.normais[s * 3 + 2]];
      let area = 0, somaS = 0, n = 0;
      for (let i = 0; i < fila.length; i++) {
        const f = fila[i];
        area += areaF[f]; if (logS) somaS += logS[f] * areaF[f]; n++;
        if (n > alvoRet * 4) continue;
        for (let k = 0; k < 3; k++) {
          const o = adj.viz[f * 3 + k];
          if (o < 0 || ret[o] >= 0) continue;
          if (concavidade(adj, f, o) > 0.06) continue;        // não atravessa dobra côncava
          if (adj.normais[o * 3] * sn[0] + adj.normais[o * 3 + 1] * sn[1] + adj.normais[o * 3 + 2] * sn[2] < cosLim) continue;
          ret[o] = id; fila.push(o);
        }
      }
      retInfo.push({ area, s: logS ? somaS / area : 0, pai: id });
    }
    // 2. fronteiras entre retalhos
    const fronteira = new Map();          // "a_b" -> { comp, concavo }
    for (const f of faces) {
      const a = ret[f];
      for (let k = 0; k < 3; k++) {
        const o = adj.viz[f * 3 + k];
        if (o < 0) continue;
        const b = ret[o];
        if (b <= a) continue;
        const i0 = m.idx[f * 3 + k] * 3, i1 = m.idx[f * 3 + (k + 1) % 3] * 3;
        const L = Math.hypot(m.pos[i0] - m.pos[i1], m.pos[i0 + 1] - m.pos[i1 + 1], m.pos[i0 + 2] - m.pos[i1 + 2]);
        const cv = concavidade(adj, f, o);
        const ch = a + '_' + b;
        let e = fronteira.get(ch);
        if (!e) { e = { a, b, comp: 0, conc: 0 }; fronteira.set(ch, e); }
        e.comp += L; if (cv > 0) e.conc += L * Math.min(1, cv * 4);
      }
    }
    // 3. junta do mais barato pro mais caro (union-find de retalhos)
    const pai = retInfo.map((_, i) => i);
    const achar = x => { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
    const info = retInfo.map(r => ({ area: r.area, s: r.s }));
    const arestasG = [...fronteira.values()];
    const custo = e => {
      const A = info[achar(e.a)], B = info[achar(e.b)];
      const menor = Math.min(A.area, B.area) / areaC;
      const conc = e.conc / Math.max(1e-9, e.comp);
      const dS = logS ? Math.abs(A.s - B.s) : 0;
      // retalho minúsculo sempre funde
      if (menor < 0.004) return conc * 0.1;
      return conc * 1.0 + dS * 0.6;
    };
    const limiar = 0.12 + (1 - sensibilidade) * 0.5;
    let restantes = retInfo.length;
    const alvoPartes = partesDesejadas > 0 ? Math.max(1, partesDesejadas - (comp.n - 1)) : 0;
    // reagrupa as fronteiras entre grupos já unidos
    for (let iter = 0; iter < 100000 && restantes > 1; iter++) {
      let melhor = null, mc = Infinity;
      const vistos = new Map();
      for (const e of arestasG) {
        const ra = achar(e.a), rb = achar(e.b);
        if (ra === rb) continue;
        const ch = ra < rb ? ra + '_' + rb : rb + '_' + ra;
        let g = vistos.get(ch);
        if (!g) { g = { a: ra, b: rb, comp: 0, conc: 0 }; vistos.set(ch, g); }
        g.comp += e.comp; g.conc += e.conc;
      }
      for (const g of vistos.values()) { const cst = custo(g); if (cst < mc) { mc = cst; melhor = g; } }
      if (!melhor) break;
      if (alvoPartes ? restantes <= alvoPartes : mc > limiar) break;
      const ra = achar(melhor.a), rb = achar(melhor.b);
      const A = info[ra], B = info[rb];
      const at = A.area + B.area;
      info[ra] = { area: at, s: (A.s * A.area + B.s * B.area) / at };
      pai[rb] = ra;
      restantes--;
      // fusões em lote quando há muitos retalhos (acelera): junta todos com custo quase zero
      if (restantes > 200) {
        for (const g of vistos.values()) {
          const x = achar(g.a), y = achar(g.b);
          if (x === y) continue;
          if (custo({ a: x, b: y, comp: g.comp, conc: g.conc }) < Math.min(0.02, limiar * 0.2)) {
            const X = info[x], Y = info[y], t = X.area + Y.area;
            info[x] = { area: t, s: (X.s * X.area + Y.s * Y.area) / t };
            pai[y] = x; restantes--;
          }
        }
      }
    }
    const mapa = new Map();
    for (const f of faces) {
      const r = achar(ret[f]);
      let id = mapa.get(r);
      if (id === undefined) { id = proximo++; mapa.set(r, id); grupos.push({ id, area: 0, casca: c }); }
      rotulo[f] = id;
    }
    for (const f of faces) grupos[rotulo[f]].area += areaF[f];
  }
  // renumera por área (Parte 01 = maior)
  const ord = grupos.slice().sort((a, b) => b.area - a.area);
  const novo = new Int32Array(grupos.length);
  ord.forEach((g, i) => { novo[g.id] = i; });
  for (let f = 0; f < nt; f++) rotulo[f] = novo[rotulo[f]];
  const partes = ord.map((g, i) => ({ id: i, nome: 'Parte ' + String(i + 1).padStart(2, '0'), area: g.area, casca: g.casca, faces: 0 }));
  for (let f = 0; f < nt; f++) partes[rotulo[f]].faces++;
  return { rotulo, partes, cascas: comp.n };
}

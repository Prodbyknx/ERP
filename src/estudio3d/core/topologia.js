// Topologia sem Map de string: agrupa as meias-arestas por vértice menor
// (counting sort) e ordena cada balde pelo vértice maior. Aguenta milhões de
// triângulos com memória linear.
//
// Meia-aresta h = 3*t + k vai de idx[3t+k] para idx[3t+(k+1)%3].

export function arestas(m) {
  const idx = m.idx, nh = idx.length, nv = m.pos.length / 3;
  const lo = new Uint32Array(nh), hi = new Uint32Array(nh);
  const cont = new Uint32Array(nv + 1);
  let validas = 0;
  for (let h = 0; h < nh; h++) {
    const t3 = h - (h % 3), k = h % 3;
    const a = idx[h], b = idx[t3 + (k + 1) % 3];
    if (a === b) { lo[h] = 0xFFFFFFFF; continue; }
    const l = a < b ? a : b;
    lo[h] = l; hi[h] = a < b ? b : a;
    cont[l + 1]++;
    validas++;
  }
  for (let v = 0; v < nv; v++) cont[v + 1] += cont[v];
  const ordem = new Uint32Array(validas);
  const cursor = cont.slice(0, nv);
  for (let h = 0; h < nh; h++) {
    if (lo[h] === 0xFFFFFFFF) continue;
    ordem[cursor[lo[h]]++] = h;
  }
  // ordena cada balde pelo 'hi' (baldes pequenos: inserção)
  for (let v = 0; v < nv; v++) {
    const i0 = cont[v], i1 = cont[v + 1];
    if (i1 - i0 < 2) continue;
    if (i1 - i0 > 64) {
      const sub = Array.from(ordem.subarray(i0, i1)).sort((x, y) => hi[x] - hi[y]);
      ordem.set(sub, i0);
      continue;
    }
    for (let i = i0 + 1; i < i1; i++) {
      const h = ordem[i], chave = hi[h];
      let j = i - 1;
      while (j >= i0 && hi[ordem[j]] > chave) { ordem[j + 1] = ordem[j]; j--; }
      ordem[j + 1] = h;
    }
  }
  // corridas iguais viram uma aresta
  const heAresta = new Int32Array(nh).fill(-1);
  const inicio = [];
  const v0 = [], v1 = [];
  let e = -1, ul = -1, uh = -1;
  for (let i = 0; i < validas; i++) {
    const h = ordem[i];
    if (lo[h] !== ul || hi[h] !== uh) {
      e++; ul = lo[h]; uh = hi[h];
      inicio.push(i); v0.push(ul); v1.push(uh);
    }
    heAresta[h] = e;
  }
  inicio.push(validas);
  return {
    nE: e + 1,
    heAresta,
    inicio: Uint32Array.from(inicio),
    ordem,                          // meias-arestas agrupadas por aresta
    v0: Uint32Array.from(v0), v1: Uint32Array.from(v1)
  };
}

export const heOrigem = (m, h) => m.idx[h];
export const heDestino = (m, h) => m.idx[h - (h % 3) + ((h % 3) + 1) % 3];

// Gêmea de cada meia-aresta: >=0 se a aresta tem exatamente 2 lados,
// -1 se é borda (aberta), -2 se é non-manifold (3+ faces).
export function gemeas(m, top) {
  top = top || arestas(m);
  const nh = m.idx.length;
  const gem = new Int32Array(nh).fill(-1);
  for (let e = 0; e < top.nE; e++) {
    const i0 = top.inicio[e], i1 = top.inicio[e + 1], n = i1 - i0;
    if (n === 2) { const a = top.ordem[i0], b = top.ordem[i0 + 1]; gem[a] = b; gem[b] = a; }
    else if (n > 2) for (let i = i0; i < i1; i++) gem[top.ordem[i]] = -2;
  }
  return gem;
}

// Face vizinha por aresta (Int32Array 3*nT). -1 borda, -2 non-manifold.
export function vizinhasFace(m, gem) {
  gem = gem || gemeas(m);
  const out = new Int32Array(gem.length);
  for (let h = 0; h < gem.length; h++) out[h] = gem[h] >= 0 ? (gem[h] / 3) | 0 : gem[h];
  return out;
}

// Estatística de arestas: abertas, non-manifold, com orientação trocada
export function estatisticaArestas(m, top) {
  top = top || arestas(m);
  let abertas = 0, naoManifold = 0, invertidas = 0;
  for (let e = 0; e < top.nE; e++) {
    const i0 = top.inicio[e], n = top.inicio[e + 1] - i0;
    if (n === 1) abertas++;
    else if (n > 2) naoManifold++;
    else {
      const a = top.ordem[i0], b = top.ordem[i0 + 1];
      if (m.idx[a] === m.idx[b]) invertidas++; // as duas saem do mesmo vértice
    }
  }
  return { arestas: top.nE, abertas, naoManifold, invertidas };
}

// Componentes ligados por aresta compartilhada (qualquer número de faces).
export function componentes(m, top) {
  top = top || arestas(m);
  const nt = m.idx.length / 3;
  const pai = new Int32Array(nt);
  for (let t = 0; t < nt; t++) pai[t] = t;
  const achar = x => { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
  for (let e = 0; e < top.nE; e++) {
    const i0 = top.inicio[e], i1 = top.inicio[e + 1];
    const f0 = (top.ordem[i0] / 3) | 0;
    for (let i = i0 + 1; i < i1; i++) {
      const a = achar(f0), b = achar((top.ordem[i] / 3) | 0);
      if (a !== b) pai[a] = b;
    }
  }
  const rotulo = new Int32Array(nt);
  const idRaiz = new Map();
  const tamanhos = [];
  for (let t = 0; t < nt; t++) {
    const r = achar(t);
    let id = idRaiz.get(r);
    if (id === undefined) { id = tamanhos.length; idRaiz.set(r, id); tamanhos.push(0); }
    rotulo[t] = id; tamanhos[id]++;
  }
  return { rotulo, n: tamanhos.length, tamanhos };
}

// Lista de faces de cada componente (CSR)
export function listasPorRotulo(rotulo, n) {
  const cont = new Uint32Array(n + 1);
  for (let t = 0; t < rotulo.length; t++) cont[rotulo[t] + 1]++;
  for (let i = 0; i < n; i++) cont[i + 1] += cont[i];
  const cur = cont.slice(0, n);
  const lista = new Uint32Array(rotulo.length);
  for (let t = 0; t < rotulo.length; t++) lista[cur[rotulo[t]]++] = t;
  return { inicio: cont, lista };
}

// Faces de cada vértice (CSR)
export function facesDoVertice(m) {
  const nv = m.pos.length / 3, idx = m.idx;
  const cont = new Uint32Array(nv + 1);
  for (let i = 0; i < idx.length; i++) cont[idx[i] + 1]++;
  for (let v = 0; v < nv; v++) cont[v + 1] += cont[v];
  const cur = cont.slice(0, nv);
  const lista = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) lista[cur[idx[i]]++] = (i / 3) | 0;
  return { inicio: cont, lista };
}

// Vértices vizinhos (CSR, sem repetição)
export function vizinhosDoVertice(m, top) {
  top = top || arestas(m);
  const nv = m.pos.length / 3;
  const cont = new Uint32Array(nv + 1);
  for (let e = 0; e < top.nE; e++) { cont[top.v0[e] + 1]++; cont[top.v1[e] + 1]++; }
  for (let v = 0; v < nv; v++) cont[v + 1] += cont[v];
  const cur = cont.slice(0, nv);
  const lista = new Uint32Array(top.nE * 2);
  for (let e = 0; e < top.nE; e++) {
    lista[cur[top.v0[e]]++] = top.v1[e];
    lista[cur[top.v1[e]]++] = top.v0[e];
  }
  return { inicio: cont, lista };
}

// Vértices non-manifold: as faces em volta não formam um leque só
// (duas "pontas de ampulheta" encostadas num vértice).
export function verticesNaoManifold(m, gem, fdv) {
  gem = gem || gemeas(m);
  fdv = fdv || facesDoVertice(m);
  const idx = m.idx, nv = m.pos.length / 3;
  const ruins = [];
  const visto = new Uint8Array(idx.length / 3);
  for (let v = 0; v < nv; v++) {
    const i0 = fdv.inicio[v], i1 = fdv.inicio[v + 1];
    if (i1 - i0 < 2) continue;
    // percorre o leque a partir da primeira face, atravessando arestas manifold que tocam v
    const f0 = fdv.lista[i0];
    const pilha = [f0]; visto[f0] = 1; let alcan = 1;
    while (pilha.length) {
      const f = pilha.pop();
      for (let k = 0; k < 3; k++) {
        const h = f * 3 + k;
        const a = idx[h], b = idx[f * 3 + (k + 1) % 3];
        if (a !== v && b !== v) continue;
        const g = gem[h];
        if (g < 0) continue;
        const o = (g / 3) | 0;
        if (!visto[o]) { visto[o] = 1; alcan++; pilha.push(o); }
      }
    }
    let unicas = 0;
    for (let i = i0; i < i1; i++) { const f = fdv.lista[i]; if (visto[f] !== 2) { visto[f] = 2; unicas++; } }
    for (let i = i0; i < i1; i++) visto[fdv.lista[i]] = 0;
    if (alcan < unicas) ruins.push(v);
  }
  return ruins;
}

// Laços de borda (arestas com um lado só), no sentido do triângulo dono.
// Pra tampar, a tampa percorre o laço ao contrário.
export function lacosDeBorda(m, top) {
  top = top || arestas(m);
  const idx = m.idx;
  const saidas = new Map();              // vértice -> [meias-arestas de borda saindo]
  const bordas = [];
  for (let e = 0; e < top.nE; e++) {
    const i0 = top.inicio[e];
    if (top.inicio[e + 1] - i0 !== 1) continue;
    const h = top.ordem[i0];
    bordas.push(h);
    const a = idx[h];
    const l = saidas.get(a);
    if (l) l.push(h); else saidas.set(a, [h]);
  }
  const usada = new Set();
  const lacos = [];
  for (const h0 of bordas) {
    if (usada.has(h0)) continue;
    const laco = [];
    let h = h0, ok = true, passos = 0;
    while (true) {
      usada.add(h);
      const a = idx[h], b = idx[h - (h % 3) + ((h % 3) + 1) % 3];
      laco.push(a);
      if (b === idx[h0]) break;
      const cand = saidas.get(b);
      let prox = -1;
      if (cand) for (const c of cand) if (!usada.has(c)) { prox = c; break; }
      if (prox < 0 || ++passos > 5e6) { ok = false; break; }
      h = prox;
    }
    if (ok && laco.length >= 3) lacos.push(laco);
    else if (laco.length) lacos.push({ aberto: true, vertices: laco });
  }
  return lacos.filter(l => Array.isArray(l));
}

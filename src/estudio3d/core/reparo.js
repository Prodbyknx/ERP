// MeshRepair — conserta sem inventar geometria onde não precisa.
// Ordem segura: solda -> lixo (degenerada/duplicada) -> orientação e
// separação do que é non-manifold -> fragmentos -> buracos -> normal pra fora.
import { arestas, componentes, listasPorRotulo, lacosDeBorda, facesDoVertice } from './topologia.js';
import { criar, caixa, soldar, compactar, subMalha, volume, area, semFaces } from './malha.js';
import { facesDuplicadas, verticesCoincidentes, verticesDeBorda, autoInterseccoes } from './validador.js';
import { tolSolda as tolSoldaPadrao } from './tolerancias.js';
import { triangularPoligono3D, normalNewell, baseDoPlano, lacoSeCruza } from './triangular.js';
import { construirBVH, lancarRaio, dentroDeOutras } from './bvh.js';
import { progresso } from './progresso.js';

/* ------------------------------------------------------------ passos */

export function removerDegeneradasPorIndice(m) {
  const nt = m.idx.length / 3, rem = new Uint8Array(nt);
  let n = 0;
  for (let t = 0; t < nt; t++) {
    const a = m.idx[t * 3], b = m.idx[t * 3 + 1], c = m.idx[t * 3 + 2];
    if (a === b || b === c || a === c) { rem[t] = 1; n++; }
  }
  return { malha: n ? semFaces(m, rem) : m, removidas: n };
}

// Duplicadas: mesma orientação -> fica uma; orientação oposta -> é uma
// "folha" de espessura zero, saem as duas.
export function removerDuplicadas(m) {
  const pares = facesDuplicadas(m);
  if (!pares.length) return { malha: m, removidas: 0 };
  const nt = m.idx.length / 3, rem = new Uint8Array(nt);
  const idx = m.idx;
  const mesmoSentido = (a, b) => {
    for (let k = 0; k < 3; k++) {
      if (idx[a * 3] === idx[b * 3 + k]) return idx[a * 3 + 1] === idx[b * 3 + (k + 1) % 3];
    }
    return false;
  };
  for (const [a, b] of pares) {
    if (rem[a] || rem[b]) { rem[b] = 1; continue; }
    if (mesmoSentido(a, b)) rem[b] = 1; else { rem[a] = 1; rem[b] = 1; }
  }
  let n = 0; for (let t = 0; t < nt; t++) if (rem[t]) n++;
  return { malha: semFaces(m, rem), removidas: n };
}

// Orientação coerente por componente + separa vértices onde a superfície
// não é manifold (aresta com 3+ faces, ampulheta, conflito de orientação).
export function orientarESeparar(m) {
  const top = arestas(m);
  const idx = Uint32Array.from(m.idx);
  const nt = idx.length / 3;
  const corte = new Uint8Array(top.nE);
  for (let e = 0; e < top.nE; e++) if (top.inicio[e + 1] - top.inicio[e] !== 2) corte[e] = 1;
  const outra = h => { const e = top.heAresta[h]; const i0 = top.inicio[e]; return top.ordem[i0] === h ? top.ordem[i0 + 1] : top.ordem[i0]; };
  const flip = new Int8Array(nt).fill(-1);
  let conflitos = 0, viradas = 0;
  const fila = new Int32Array(nt);
  for (let s = 0; s < nt; s++) {
    if (flip[s] >= 0) continue;
    flip[s] = 0;
    let ini = 0, fim = 0;
    fila[fim++] = s;
    while (ini < fim) {
      const f = fila[ini++];
      for (let k = 0; k < 3; k++) {
        const h = f * 3 + k, e = top.heAresta[h];
        if (e < 0 || corte[e]) continue;
        const g = outra(h), o = (g / 3) | 0;
        const mesmo = m.idx[h] === m.idx[g] ? 1 : 0;
        const precisa = flip[f] ^ mesmo;
        if (flip[o] < 0) { flip[o] = precisa; fila[fim++] = o; }
        else if (flip[o] !== precisa) { corte[e] = 1; conflitos++; }
      }
    }
    // a semente pode ser justamente uma das faces erradas: fica o sentido da
    // MAIORIA do pedaço (só as faces do contra são viradas)
    let contra = 0;
    for (let i = 0; i < fim; i++) if (flip[fila[i]] === 1) contra++;
    if (contra * 2 > fim) for (let i = 0; i < fim; i++) flip[fila[i]] ^= 1;
  }
  for (let t = 0; t < nt; t++) if (flip[t] === 1) { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; viradas++; }

  // leques por vértice
  const fdv = facesDoVertice(m);
  const nv = m.pos.length / 3;
  const novasPos = [];
  let separados = 0;
  const pai = new Int32Array(64);
  for (let v = 0; v < nv; v++) {
    const i0 = fdv.inicio[v], i1 = fdv.inicio[v + 1], n = i1 - i0;
    if (n < 2) continue;
    const loc = n <= 64 ? pai : new Int32Array(n);
    for (let i = 0; i < n; i++) loc[i] = i;
    const achar = x => { while (loc[x] !== x) { loc[x] = loc[loc[x]]; x = loc[x]; } return x; };
    const pos = new Map();
    for (let i = 0; i < n; i++) pos.set(fdv.lista[i0 + i], i);
    for (let i = 0; i < n; i++) {
      const f = fdv.lista[i0 + i];
      for (let k = 0; k < 3; k++) {
        const h = f * 3 + k;
        const a = m.idx[h], b = m.idx[f * 3 + (k + 1) % 3];
        if (a !== v && b !== v) continue;
        const e = top.heAresta[h];
        if (e < 0 || corte[e]) continue;
        const j = pos.get((outra(h) / 3) | 0);
        if (j === undefined) continue;
        const ra = achar(i), rb = achar(j);
        if (ra !== rb) loc[ra] = rb;
      }
    }
    let primeira = -1;
    const novoDe = new Map();
    for (let i = 0; i < n; i++) {
      const r = achar(i);
      if (primeira < 0) primeira = r;
      if (r === primeira) continue;
      let nvId = novoDe.get(r);
      if (nvId === undefined) {
        nvId = nv + novasPos.length / 3;
        novasPos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
        novoDe.set(r, nvId); separados++;
      }
      const f = fdv.lista[i0 + i];
      for (let k = 0; k < 3; k++) if (idx[f * 3 + k] === v) idx[f * 3 + k] = nvId;
    }
  }
  let pos = m.pos;
  if (novasPos.length) { pos = new Float64Array(m.pos.length + novasPos.length); pos.set(m.pos); pos.set(novasPos, m.pos.length); }
  return { malha: criar(pos, idx, m.cor ? Uint16Array.from(m.cor) : null), viradas, conflitos, separados };
}

// Componentes abertos minúsculos (lixo) e fechados de volume zero (folha dupla)
export function removerFragmentos(m, opc = {}) {
  const top = arestas(m);
  const comp = componentes(m, top);
  if (comp.n < 2 && !opc.forcar) return { malha: m, removidos: 0 };
  const listas = listasPorRotulo(comp.rotulo, comp.n);
  const cx = caixa(m);
  const diag = cx ? Math.hypot(cx.tam[0], cx.tam[1], cx.tam[2]) : 1;
  const areaMin = opc.areaMin != null ? opc.areaMin : Math.max(0.05, diag * diag * 1e-6);
  const aberto = new Uint8Array(comp.n);
  for (let e = 0; e < top.nE; e++) if (top.inicio[e + 1] - top.inicio[e] !== 2) aberto[comp.rotulo[(top.ordem[top.inicio[e]] / 3) | 0]] = 1;
  const rem = new Uint8Array(m.idx.length / 3);
  let removidos = 0;
  for (let c = 0; c < comp.n; c++) {
    const faces = listas.lista.subarray(listas.inicio[c], listas.inicio[c + 1]);
    const sm = subMalha(m, faces).malha;
    const a = area(sm), vol = Math.abs(volume(sm));
    const folha = !aberto[c] && a > 0 && vol / a < 1e-4;       // espessura média < 0,1 µm
    const lixo = aberto[c] && (a < areaMin || faces.length < 3);
    if (folha || lixo) { faces.forEach(t => { rem[t] = 1; }); removidos++; }
  }
  return { malha: removidos ? compactar(semFaces(m, rem)) : m, removidos };
}

/* ------------------------------------------------------------ buracos */

// Triangulação de área mínima (programação dinâmica), O(n^3). Índices locais,
// no sentido do laço.
function triangularAreaMinima(pts) {
  const n = pts.length / 3;
  const W = new Float64Array(n * n), K = new Int32Array(n * n).fill(-1);
  const ar = (i, j, k) => {
    const ux = pts[j * 3] - pts[i * 3], uy = pts[j * 3 + 1] - pts[i * 3 + 1], uz = pts[j * 3 + 2] - pts[i * 3 + 2];
    const vx = pts[k * 3] - pts[i * 3], vy = pts[k * 3 + 1] - pts[i * 3 + 1], vz = pts[k * 3 + 2] - pts[i * 3 + 2];
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  for (let d = 2; d < n; d++) {
    for (let i = 0; i + d < n; i++) {
      const j = i + d;
      let melhor = Infinity, mk = -1;
      for (let k = i + 1; k < j; k++) {
        const w = W[i * n + k] + W[k * n + j] + ar(i, k, j);
        if (w < melhor) { melhor = w; mk = k; }
      }
      W[i * n + j] = melhor; K[i * n + j] = mk;
    }
  }
  const out = [];
  const pilha = [[0, n - 1]];
  while (pilha.length) {
    const [i, j] = pilha.pop();
    if (j - i < 2) continue;
    const k = K[i * n + j];
    out.push(i, k, j);
    pilha.push([i, k], [k, j]);
  }
  return out;
}

// Laço grande e torto: divide pela corda mais curta e resolve as metades
function triangularDividindo(pts, ids) {
  const n = ids.length;
  if (n <= 3) return n === 3 ? [ids[0], ids[1], ids[2]] : [];
  if (n <= 220) {
    const sub = new Float64Array(n * 3);
    ids.forEach((v, i) => { sub[i * 3] = pts[v * 3]; sub[i * 3 + 1] = pts[v * 3 + 1]; sub[i * 3 + 2] = pts[v * 3 + 2]; });
    return triangularAreaMinima(sub).map(i => ids[i]);
  }
  let melhor = Infinity, bi = 0, bj = n >> 1;
  const passo = Math.max(1, Math.floor(n / 150));
  for (let i = 0; i < n; i += passo) {
    for (let j = i + Math.floor(n / 4); j <= i + Math.ceil(3 * n / 4) && j < n; j += passo) {
      const a = ids[i] * 3, b = ids[j] * 3;
      const d = Math.hypot(pts[a] - pts[b], pts[a + 1] - pts[b + 1], pts[a + 2] - pts[b + 2]);
      if (d < melhor) { melhor = d; bi = i; bj = j; }
    }
  }
  const A = ids.slice(bi, bj + 1), B = ids.slice(bj).concat(ids.slice(0, bi + 1));
  return triangularDividindo(pts, A).concat(triangularDividindo(pts, B));
}

function desvioDoPlano(pts, n) {
  let cx = 0, cy = 0, cz = 0;
  const k = pts.length / 3;
  for (let i = 0; i < k; i++) { cx += pts[i * 3]; cy += pts[i * 3 + 1]; cz += pts[i * 3 + 2]; }
  cx /= k; cy /= k; cz /= k;
  let mx = 0, raio = 0;
  for (let i = 0; i < k; i++) {
    const dx = pts[i * 3] - cx, dy = pts[i * 3 + 1] - cy, dz = pts[i * 3 + 2] - cz;
    mx = Math.max(mx, Math.abs(dx * n[0] + dy * n[1] + dz * n[2]));
    raio = Math.max(raio, Math.hypot(dx, dy, dz));
  }
  return { desvio: mx, raio, centro: [cx, cy, cz] };
}

// Triangula o laço (lista de vértices da malha, no sentido da borda) e devolve
// a tampa já no sentido CERTO (oposto ao da borda). opc.plana força earcut.
export function triangularLaco(pos, laco, opc = {}) {
  const n = laco.length;
  const pts = new Float64Array(n * 3);
  laco.forEach((v, i) => { pts[i * 3] = pos[v * 3]; pts[i * 3 + 1] = pos[v * 3 + 1]; pts[i * 3 + 2] = pos[v * 3 + 2]; });
  const nrm = normalNewell(pts);
  const d = desvioDoPlano(pts, nrm);
  let tris = null, metodo = '';
  const quasePlano = d.desvio <= Math.max(1e-6, d.raio * (opc.tolPlano != null ? opc.tolPlano : 0.08));
  if (n === 3) { tris = [0, 1, 2]; metodo = 'tri'; }
  else if (quasePlano || opc.plana) {
    const { u, v } = baseDoPlano(nrm);
    const xy = [];
    for (let i = 0; i < n; i++) xy.push(pts[i * 3] * u[0] + pts[i * 3 + 1] * u[1] + pts[i * 3 + 2] * u[2], pts[i * 3] * v[0] + pts[i * 3 + 1] * v[1] + pts[i * 3 + 2] * v[2]);
    if (!lacoSeCruza(xy)) { tris = triangularPoligono3D(pts, null, nrm); metodo = 'plana'; }
  }
  if (!tris || tris.length / 3 < n - 2) {
    const ids = []; for (let i = 0; i < n; i++) ids.push(i);
    tris = triangularDividindo(pts, ids); metodo = 'area-minima';
  }
  // no sentido oposto ao da borda
  const out = [];
  for (let i = 0; i < tris.length; i += 3) out.push(laco[tris[i]], laco[tris[i + 2]], laco[tris[i + 1]]);
  return { tris: out, metodo, plano: quasePlano, normal: nrm, desvio: d.desvio, raio: d.raio };
}

// Refina a tampa (divide aresta interna comprida) e alisa os vértices novos
// (Laplaciano com a borda presa). Só pra buraco que não é plano.
export function refinarEAlisar(posArr, tampa, borda, alvo, iter = 30) {
  const pos = posArr;                        // array JS (vai crescer)
  let tris = tampa.slice();
  const fixo = new Set(borda);
  const chave = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  for (let rodada = 0; rodada < 6; rodada++) {
    const mapa = new Map();
    for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3];
      const ch = chave(a, b); const l = mapa.get(ch); if (l) l.push(t); else mapa.set(ch, [t]);
    }
    const dividir = [];
    const usado = new Uint8Array(tris.length / 3);
    for (let t = 0; t < tris.length / 3; t++) {
      if (usado[t]) continue;
      let maior = 0, ka = -1;
      for (let k = 0; k < 3; k++) {
        const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3];
        const L = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
        if (L > maior) { maior = L; ka = k; }
      }
      if (maior < alvo * 1.6) continue;
      const a = tris[t * 3 + ka], b = tris[t * 3 + (ka + 1) % 3];
      const viz = mapa.get(chave(a, b));
      if (!viz || viz.length !== 2) continue;           // aresta da borda: não divide
      const o = viz[0] === t ? viz[1] : viz[0];
      if (usado[o]) continue;
      usado[t] = usado[o] = 1;
      dividir.push([t, o, a, b]);
    }
    if (!dividir.length) break;
    for (const [t, o, a, b] of dividir) {
      const m = pos.length / 3;
      pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
      for (const f of [t, o]) {
        const v = [tris[f * 3], tris[f * 3 + 1], tris[f * 3 + 2]];
        // acha a posição da aresta a-b nesta face (em qualquer sentido)
        let k = 0;
        for (; k < 3; k++) { const x = v[k], y = v[(k + 1) % 3]; if ((x === a && y === b) || (x === b && y === a)) break; }
        const x = v[k], y = v[(k + 1) % 3], z = v[(k + 2) % 3];
        tris[f * 3] = x; tris[f * 3 + 1] = m; tris[f * 3 + 2] = z;
        tris.push(m, y, z);
      }
    }
  }
  // alisamento
  const viz = new Map();
  for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3];
    if (!viz.has(a)) viz.set(a, new Set()); if (!viz.has(b)) viz.set(b, new Set());
    viz.get(a).add(b); viz.get(b).add(a);
  }
  const livres = [...viz.keys()].filter(v => !fixo.has(v));
  for (let it = 0; it < iter; it++) {
    for (const v of livres) {
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (const u of viz.get(v)) { sx += pos[u * 3]; sy += pos[u * 3 + 1]; sz += pos[u * 3 + 2]; c++; }
      if (c) { pos[v * 3] = sx / c; pos[v * 3 + 1] = sy / c; pos[v * 3 + 2] = sz / c; }
    }
  }
  return tris;
}

export function taparBuracos(m, opc = {}) {
  const lacos = lacosDeBorda(m);
  if (!lacos.length) return { malha: m, tapados: 0, ignorados: 0, maiorPerimetro: 0, metodos: {} };
  const pos = Array.from(m.pos);
  const idx = Array.from(m.idx);
  const cor = m.cor ? Array.from(m.cor) : null;
  let tapados = 0, ignorados = 0, maior = 0;
  const metodos = {};
  for (const laco of lacos) {
    let per = 0;
    for (let i = 0; i < laco.length; i++) {
      const a = laco[i] * 3, b = laco[(i + 1) % laco.length] * 3;
      per += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
    }
    if (opc.maxPerimetro && per > opc.maxPerimetro) { ignorados++; continue; }
    const r = triangularLaco(pos, laco, opc);
    let tris = r.tris;
    if (!r.plano && opc.alisar !== false && laco.length > 6) {
      tris = refinarEAlisar(pos, tris, laco, per / laco.length);
    }
    for (const v of tris) idx.push(v);
    if (cor) {
      // cor da tampa = cor da face vizinha mais comum na borda
      for (let i = 0; i < tris.length / 3; i++) cor.push(opc.corTampa != null ? opc.corTampa : 0);
    }
    metodos[r.metodo] = (metodos[r.metodo] || 0) + 1;
    tapados++;
    if (per > maior) maior = per;
  }
  return { malha: criar(Float64Array.from(pos), Uint32Array.from(idx), cor ? Uint16Array.from(cor) : null), tapados, ignorados, maiorPerimetro: maior, metodos };
}

// Auto-interseção DENTRO da mesma casca (dobra que atravessa a própria
// superfície, comum em modelo de IA): tira as faces que se cruzam e o anel em
// volta, e fecha o buraco de novo com tampa alisada. Repete algumas vezes.
// Cascas diferentes que se atravessam não entram aqui: viram um sólido só
// pelo Manifold (motor/operacoes.js), sem perder nada. opc.todas inclui os
// cruzamentos entre cascas (2ª passada, quando o Manifold recusou juntar).
export function desfazerAutoInterseccoes(m, opc = {}) {
  let removidas = 0, rodadas = 0, restantes = 0;
  for (; rodadas < (opc.rodadas || 4); rodadas++) {
    const comp = componentes(m);
    const pares = [];
    autoInterseccoes(m, { max: 50000, tempoMs: opc.tempoMs || 10000, pares });
    const nt = m.idx.length / 3, marca = new Uint8Array(nt);
    let n = 0;
    for (let i = 0; i < pares.length; i += 2) {
      const a = pares[i], b = pares[i + 1];
      if (!opc.todas && comp.rotulo[a] !== comp.rotulo[b]) continue;
      if (!marca[a]) { marca[a] = 1; n++; }
      if (!marca[b]) { marca[b] = 1; n++; }
    }
    restantes = n;
    if (!n) break;
    // muita coisa cruzando = defeito grande demais pra remendo local
    if (n > Math.max(400, nt * 0.02)) return { malha: m, removidas, restantes: n, desistiu: true };
    // folga: as faces que tocam (por vértice) as marcadas, crescendo a cada rodada
    const fdv = facesDoVertice(m);
    let tirar = marca;
    for (let anel = 0; anel <= rodadas; anel++) {
      const prox = Uint8Array.from(tirar);
      for (let t = 0; t < nt; t++) if (tirar[t]) for (let k = 0; k < 3; k++) {
        const v = m.idx[t * 3 + k];
        for (let j = fdv.inicio[v]; j < fdv.inicio[v + 1]; j++) prox[fdv.lista[j]] = 1;
      }
      tirar = prox;
    }
    let k = 0; for (let t = 0; t < nt; t++) if (tirar[t]) k++;
    m = compactar(semFaces(m, tirar));
    removidas += k;
    m = taparBuracos(m, { alisar: true }).malha;
    const o = orientarESeparar(m); m = o.malha;
    if (o.separados) m = taparBuracos(m, { alisar: true }).malha;
    m = removerFragmentos(m).malha;
  }
  return { malha: m, removidas, restantes, rodadas };
}

// Cada componente FECHADO com volume negativo é virado
export function orientarParaFora(m) {
  const top = arestas(m);
  const comp = componentes(m, top);
  const listas = listasPorRotulo(comp.rotulo, comp.n);
  const aberto = new Uint8Array(comp.n);
  for (let e = 0; e < top.nE; e++) if (top.inicio[e + 1] - top.inicio[e] !== 2) aberto[comp.rotulo[(top.ordem[top.inicio[e]] / 3) | 0]] = 1;
  const idx = Uint32Array.from(m.idx);
  let viradas = 0;
  let bvh = null;
  for (let c = 0; c < comp.n; c++) {
    const faces = listas.lista.subarray(listas.inicio[c], listas.inicio[c + 1]);
    let virar = false;
    if (!aberto[c]) {
      // casca fechada: cavidade (vazio dentro de outra) tem volume negativo de
      // propósito; só vira se o sinal não bate com o aninhamento
      // Casca dentro de (ou atravessando) outra NÃO é virada: com volume positivo
      // ela é peça sobreposta (o fatiador une; o "Consertar" junta num sólido
      // só), com negativo é o vazio de uma peça oca. Virar mudaria o que imprime.
      const vol = volume(subMalha(m, faces).malha);
      virar = vol < 0 && !(comp.n > 1 && comp.n <= 60 && dentroDeOutras(m, k => listas.lista.subarray(listas.inicio[k], listas.inicio[k + 1]), c, comp.n));
    }
    else {
      // aberto: raio pra fora a partir de algumas faces; se bate em si mesmo
      // na maioria, a normal aponta pra dentro
      bvh = bvh || construirBVH(m);
      let dentro = 0, fora = 0;
      const passo = Math.max(1, Math.floor(faces.length / 15));
      for (let i = 0; i < faces.length; i += passo) {
        const t = faces[i];
        const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, cc = m.idx[t * 3 + 2] * 3;
        const p = m.pos;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[cc] - p[a], vy = p[cc + 1] - p[a + 1], vz = p[cc + 2] - p[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const L = Math.hypot(nx, ny, nz); if (!L) continue;
        nx /= L; ny /= L; nz /= L;
        const h = lancarRaio(bvh, (p[a] + p[b] + p[cc]) / 3, (p[a + 1] + p[b + 1] + p[cc + 1]) / 3, (p[a + 2] + p[b + 2] + p[cc + 2]) / 3, nx, ny, nz, Infinity, t, 1e-6);
        if (h && comp.rotulo[h.face] === c) dentro++; else fora++;
      }
      virar = dentro > fora * 2;
    }
    if (virar) {
      for (const t of faces) { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; }
      viradas += faces.length;
    }
  }
  return { malha: criar(m.pos, idx, m.cor ? Uint16Array.from(m.cor) : null), viradas };
}

/* ------------------------------------------------------------ pipeline */

export function reparar(m0, opc = {}) {
  const passos = [];
  const pg = opc.progresso ? progresso : () => {};
  let m = m0;
  const cx = caixa(m);
  const diag = cx ? Math.hypot(cx.tam[0], cx.tam[1], cx.tam[2]) : 1;

  const c0 = compactar(m);
  if (c0.pos.length < m.pos.length) passos.push('tirou ' + (m.pos.length - c0.pos.length) / 3 + ' vértice(s) solto(s)');
  m = c0;

  pg(0.18, 'Soldando vértices repetidos');
  // mesma tolerância do laudo; só solda costura (vértice de aresta aberta)
  const tolSolda = opc.tolSolda != null ? opc.tolSolda : tolSoldaPadrao(diag);
  const borda = verticesDeBorda(m);
  if (verticesCoincidentes(m, tolSolda, borda).comBorda) {
    const s = soldar(m, tolSolda, borda);
    if (s.fundidos) passos.push('soldou ' + s.fundidos + ' vértice(s) repetido(s)');
    m = s.malha;
  }
  let r = removerDegeneradasPorIndice(m);
  if (r.removidas) passos.push('removeu ' + r.removidas + ' face(s) degenerada(s)');
  m = r.malha;
  r = removerDuplicadas(m);
  if (r.removidas) passos.push('removeu ' + r.removidas + ' face(s) repetida(s)');
  m = r.malha;

  pg(0.3, 'Acertando a orientação');
  const o = orientarESeparar(m);
  if (o.viradas) passos.push('acertou a orientação de ' + o.viradas + ' face(s)');
  if (o.separados) passos.push('separou ' + o.separados + ' ponto(s) non-manifold');
  m = o.malha;

  const f = removerFragmentos(m, opc);
  if (f.removidos) passos.push('removeu ' + f.removidos + ' fragmento(s) solto(s) sem volume');
  m = f.malha;

  if (opc.taparBuracos !== false) {
    pg(0.42, 'Fechando buracos');
    const t = taparBuracos(m, { maxPerimetro: opc.maxPerimetroBuraco, alisar: opc.alisar });
    if (t.tapados) passos.push('fechou ' + t.tapados + ' buraco(s)' + (t.maiorPerimetro ? ' (o maior com ' + t.maiorPerimetro.toFixed(1) + ' mm de contorno)' : ''));
    if (t.ignorados) passos.push(t.ignorados + ' abertura(s) grande(s) mantida(s) — acima do limite');
    m = t.malha;
    // tampa nova pode ter criado vértice non-manifold em buraco que encostava
    const o2 = orientarESeparar(m);
    m = o2.malha;
    if (o2.separados) {
      const t2 = taparBuracos(m, { alisar: opc.alisar });
      m = t2.malha;
    }
  }
  if (opc.autoInterseccoes !== false) {
    pg(0.47, 'Desfazendo dobras que se cruzam');
    const ai = desfazerAutoInterseccoes(m, opc);
    if (ai.removidas && !ai.restantes) passos.push('refez ' + ai.removidas + ' face(s) onde a superfície se cruzava');
    else if (ai.removidas) passos.push('refez ' + ai.removidas + ' face(s) onde a superfície se cruzava (ainda sobram ' + ai.restantes + ')');
    else if (ai.desistiu) passos.push(ai.restantes + ' face(s) se cruzando — muitas pra remendar sem mudar a peça');
    m = ai.malha;
  }
  pg(0.52, 'Virando pra fora');
  const pf = orientarParaFora(m);
  if (pf.viradas) passos.push('virou pra fora ' + pf.viradas + ' face(s) de peça do avesso');
  m = pf.malha;
  const f2 = removerFragmentos(m, opc);
  m = f2.malha;
  return { malha: m, passos };
}

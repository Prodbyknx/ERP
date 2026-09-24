// BooleanEngine — ponte com o Manifold (geometria exata, sempre sólido fechado).
// Cada malha que entra ganha um ID de origem e o índice de cada triângulo
// (faceID). Depois de qualquer booleana, cada triângulo de saída sabe de que
// peça e de que triângulo veio -> a cor é recuperada sem aproximação.
import { criar } from './malha.js';
import { normalizarHex, COR_PADRAO } from './cores.js';

let W = null;
export function definirManifold(modulo) { W = modulo; }
export function manifold() { if (!W) throw new Error('Motor geométrico (Manifold) não carregado.'); return W; }
export const temManifold = () => !!W;

export class Contexto {
  constructor() {
    this.paleta = [];
    this.kCor = new Map();
    this.fontes = new Map();        // originalID -> { cores: Uint16Array|null, padrao: k }
    this.vivos = [];
  }
  cor(hex) {
    const n = normalizarHex(hex) || COR_PADRAO;
    let k = this.kCor.get(n);
    if (k === undefined) { k = this.paleta.length; this.paleta.push(n); this.kCor.set(n, k); }
    return k;
  }
  guardar(x) {
    if (x && typeof x.delete === 'function') {
      this.vivos.push(x);
      if (typeof x.status === 'function') {
        const st = x.status();
        if (st !== 'NoError') { const e = new Error('Operação geométrica inválida (' + st + ').'); e.codigo = st; throw e; }
      }
    }
    return x;
  }
  liberar() { for (const x of this.vivos) { try { x.delete(); } catch (e) { /* já liberado */ } } this.vivos = []; }

  // parte: { malha, cor, paleta } -> Manifold (lança erro se não for sólido fechado)
  solido(parte, nome) {
    const { Manifold, Mesh } = manifold();
    const m = parte.malha || parte;
    const nt = m.idx.length / 3;
    const id = Manifold.reserveIDs(1);
    const faceID = new Uint32Array(nt);
    for (let t = 0; t < nt; t++) faceID[t] = t;
    const mesh = new Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(m.pos),
      triVerts: Uint32Array.from(m.idx),
      faceID,
      runOriginalID: Uint32Array.of(id),
      runIndex: Uint32Array.of(0, nt * 3)
    });
    mesh.merge();
    const man = new Manifold(mesh);
    const st = man.status();
    if (st !== 'NoError') {
      man.delete();
      const e = new Error((nome || 'A peça') + ' não é um sólido fechado (' + st + '). Rode "Analisar e reparar" antes.');
      e.codigo = st; throw e;
    }
    this.vivos.push(man);
    const padrao = this.cor(parte.cor);
    let cores = null;
    if (m.cor && parte.paleta) {
      const mapa = parte.paleta.map(h => this.cor(h));
      cores = new Uint16Array(nt);
      for (let t = 0; t < nt; t++) cores[t] = mapa[m.cor[t]] != null ? mapa[m.cor[t]] : padrao;
    }
    // origem: face da peça ORIGINAL de onde cada triângulo veio (encadeável)
    this.fontes.set(id, { cores, padrao, origem: parte.origem || null });
    return man;
  }

  // primitiva gerada aqui dentro (pino, prisma...) com cor fixa
  primitiva(man, hex) {
    const o = this.guardar(man.asOriginal());
    this.fontes.set(o.originalID(), { cores: null, padrao: this.cor(hex) });
    return o;
  }

  // Manifold -> { malha, cor, paleta } com a cor de cada triângulo
  parte(man, nome, corPreferida, comOrigem) {
    const mesh = man.getMesh();
    const nt = mesh.triVerts.length / 3;
    const pos = new Float64Array(mesh.vertProperties.length / mesh.numProp * 3);
    const np = mesh.numProp;
    for (let v = 0, n = pos.length / 3; v < n; v++) {
      pos[v * 3] = mesh.vertProperties[v * np];
      pos[v * 3 + 1] = mesh.vertProperties[v * np + 1];
      pos[v * 3 + 2] = mesh.vertProperties[v * np + 2];
    }
    const idx = Uint32Array.from(mesh.triVerts);
    const k = new Uint16Array(nt);
    const conta = new Map();
    const runs = mesh.runIndex, ids = mesh.runOriginalID, fid = mesh.faceID;
    const origem = comOrigem ? new Int32Array(nt).fill(-1) : null;
    for (let r = 0; r < ids.length; r++) {
      const f = this.fontes.get(ids[r]);
      for (let t = runs[r] / 3; t < runs[r + 1] / 3; t++) {
        if (origem && f) origem[t] = f.origem ? f.origem[fid[t]] : fid[t];
        let c = f ? (f.cores ? f.cores[fid[t]] : f.padrao) : this.cor(corPreferida || COR_PADRAO);
        if (c === undefined) c = f.padrao;
        k[t] = c;
        conta.set(c, (conta.get(c) || 0) + 1);
      }
    }
    // cor principal = a que cobre mais triângulos (ou a preferida se presente)
    let principal = corPreferida != null ? this.cor(corPreferida) : -1;
    if (principal < 0 || !conta.has(principal)) {
      let mx = -1; conta.forEach((n, c) => { if (n > mx) { mx = n; principal = c; } });
    }
    if (principal < 0) principal = this.cor(corPreferida || COR_PADRAO);
    let malha, paleta = null;
    if (conta.size > 1) {
      // paleta local compacta, com a principal na posição 0
      const locais = [principal, ...[...conta.keys()].filter(c => c !== principal)];
      const loc = new Map(locais.map((c, i) => [c, i]));
      const cor = new Uint16Array(nt);
      for (let t = 0; t < nt; t++) cor[t] = loc.get(k[t]);
      malha = criar(pos, idx, cor);
      paleta = locais.map(c => this.paleta[c]);
    } else malha = criar(pos, idx);
    const out = { nome: nome || 'peça', malha, cor: this.paleta[principal], paleta };
    if (origem) out.origem = origem;
    return out;
  }
}

// Roda fn(ctx) e libera tudo que foi criado no WASM, mesmo se der erro
export function comContexto(fn) {
  const ctx = new Contexto();
  try { return fn(ctx); } finally { ctx.liberar(); }
}

// Segmentos pra círculo de raio r ficar com aresta <= 0,25 mm
export function segmentos(r, min = 24) { return Math.max(min, Math.min(256, Math.ceil(2 * Math.PI * r / 0.25))); }

// Matriz 4x4 (coluna, 16) -> Mat4 do Manifold (também coluna, 16 números)
export const mat = m => Array.from(m);

export function caixaDe(man) { const b = man.boundingBox(); return { min: b.min, max: b.max }; }

// Guarda os dados de exibição (e a BVH de pontaria) de cada malha já
// preparada. A malha é imutável, então a chave é o próprio objeto.
// Desfazer/refazer e confirmar prévia reaproveitam daqui sem recalcular nada.
// Limite por número de triângulos (as mais antigas saem primeiro).
const LIMITE_TRIANGULOS = 2500000;

class CacheRender {
  constructor(limite) { this.mapa = new Map(); this.total = 0; this.limite = limite; }
  _tri(m) { return m.idx.length / 3; }
  obter(malha) {
    const e = this.mapa.get(malha);
    if (!e) return null;
    this.mapa.delete(malha); this.mapa.set(malha, e);      // mais recente
    return e;
  }
  guardar(malha, prep) {
    let e = this.mapa.get(malha);
    if (e) { e.prep = prep; return e; }
    e = { prep, bvh: null, pedidoBVH: false };
    this.mapa.set(malha, e);
    this.total += this._tri(malha);
    for (const [m] of this.mapa) {
      if (this.total <= this.limite || m === malha) break;
      this.mapa.delete(m);
      this.total -= this._tri(m);
    }
    return e;
  }
  limpar() { this.mapa.clear(); this.total = 0; }
}

export const cacheRender = new CacheRender(LIMITE_TRIANGULOS);

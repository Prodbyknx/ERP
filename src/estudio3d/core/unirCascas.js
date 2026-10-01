// Junta num sólido só as cascas FECHADAS de uma peça que se atravessam, se
// encostam ou ficam uma dentro da outra — o que o fatiador faria de qualquer
// jeito. Casca com volume positivo é peça; com volume negativo é o VAZIO de
// uma peça oca (bolso fechado da tag NFC, peça oca de propósito), e continua
// vazio. Casca que o Manifold não aceita (aberta, quebrada) fica de fora, do
// jeito que estava (vem em `fora`).
import { manifold } from './solidos.js';
import { arestas, componentes, listasPorRotulo } from './topologia.js';
import { criar, juntar, subMalha, volume } from './malha.js';

function fechada(m) {
  const top = arestas(m);
  for (let e = 0; e < top.nE; e++) if (top.inicio[e + 1] - top.inicio[e] !== 2) return false;
  return true;
}

/**
 * unirCascas(ctx, parte, nome) -> null (nada a juntar) |
 *   { man, antes, depois, fora: malha|null, nFora }
 * man = Manifold com as peças juntas e os vazios descontados. A origem de cada
 * triângulo (face da peça de entrada) vem em ctx.parte(man, …, true).origem.
 */
export function unirCascas(ctx, parte, nome) {
  const m = parte.malha;
  const comp = componentes(m);
  if (comp.n < 2 || comp.n > 5000) return null;
  const { Manifold } = manifold();
  const listas = listasPorRotulo(comp.rotulo, comp.n);
  const pos = [], neg = [], fora = [];
  let somaPos = 0, somaNeg = 0;
  for (let c = 0; c < comp.n; c++) {
    const faces = listas.lista.subarray(listas.inicio[c], listas.inicio[c + 1]);
    const sub = subMalha(m, faces).malha;
    const v = volume(sub);
    if (Math.abs(v) < 1e-9 || !fechada(sub)) { fora.push(faces); continue; }
    let alvo = sub;
    if (v < 0) {   // vazio: entra do lado certo pra ser descontado
      const idx = Uint32Array.from(sub.idx);
      for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
      alvo = criar(sub.pos, idx, sub.cor);
    }
    const origem = parte.origem ? Int32Array.from(faces, f => parte.origem[f]) : Int32Array.from(faces);
    let man;
    try { man = ctx.solido({ malha: alvo, cor: parte.cor, paleta: alvo.cor ? parte.paleta : null, origem }, nome); }
    catch (e) { fora.push(faces); continue; }
    if (v > 0) { pos.push(man); somaPos += v; } else { neg.push(man); somaNeg -= v; }
  }
  if (pos.length < 2) return null;
  let u = ctx.guardar(Manifold.union(pos));
  if (neg.length) u = ctx.guardar(u.subtract(ctx.guardar(Manifold.union(neg))));
  const pedacos = u.decompose();
  const depois = pedacos.filter(c => c.volume() > 0).length;
  for (const c of pedacos) c.delete();
  const esperado = somaPos - somaNeg;
  // nada se tocava: deixa a malha como estava
  if (depois === pos.length && Math.abs(u.volume() - esperado) <= 1e-5 * Math.max(1, esperado)) return null;
  let resto = null;
  if (fora.length) {
    let n = 0; for (const f of fora) n += f.length;
    const todas = new Uint32Array(n); let k = 0;
    for (const f of fora) { todas.set(f, k); k += f.length; }
    resto = subMalha(m, todas).malha;
  }
  return { man: u, antes: pos.length, depois, fora: resto, nFora: fora.length };
}

// Junta a peça que voltou do Manifold com as cascas que ficaram de fora,
// acertando o índice de cor de cada triângulo (cada uma tinha a sua paleta).
export function juntarComCores(nova, resto, parteOriginal) {
  if (!resto) return nova;
  const hexDe = (paleta, cor, i) => (paleta && paleta[i] != null ? paleta[i] : cor).toUpperCase();
  const lista = (nova.paleta || [nova.cor]).map(h => h.toUpperCase());
  const idx = h => { let i = lista.indexOf(h); if (i < 0) { lista.push(h); i = lista.length - 1; } return i; };
  const ntN = nova.malha.idx.length / 3, ntR = resto.idx.length / 3;
  const corN = new Uint16Array(ntN), corR = new Uint16Array(ntR);
  for (let t = 0; t < ntN; t++) corN[t] = idx(hexDe(nova.paleta, nova.cor, nova.malha.cor ? nova.malha.cor[t] : 0));
  for (let t = 0; t < ntR; t++) corR[t] = idx(hexDe(parteOriginal.paleta, parteOriginal.cor, resto.cor ? resto.cor[t] : 0));
  const m = juntar([criar(nova.malha.pos, nova.malha.idx, corN), criar(resto.pos, resto.idx, corR)]);
  if (lista.length < 2) return { ...nova, malha: criar(m.pos, m.idx), paleta: null };
  return { ...nova, malha: m, paleta: lista };
}

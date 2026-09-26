// Antes de cortar/separar: garante um sólido que o motor aceita, sem pedir
// nada ao usuário. 1) tenta como está; 2) não fecha -> conserto automático
// (solda, orientação, buracos) e tenta de novo; 3) cascas que se atravessam
// (braço e corpo como peças soltas sobrepostas, comum em figura) viram UM
// sólido — senão o corte sai com paredes internas e o encaixe não acha lugar.
import { manifold } from './solidos.js';
import { reparar } from './reparo.js';

export function solidoPronto(ctx, parte, avisos = []) {
  const { Manifold } = manifold();
  let s;
  try { s = ctx.solido(parte, parte.nome); }
  catch (e) {
    const r = reparar(parte.malha, {});
    try { s = ctx.solido({ ...parte, malha: r.malha, origem: null }, parte.nome); }
    catch (e2) {
      throw new Error((parte.nome || 'A peça') + ' tem defeitos que o conserto automático não resolveu (' + (e2.codigo || e2.message) + '). Use "Analisar e reparar" e depois tente de novo.');
    }
    avisos.push('Consertei a malha antes de operar' + (r.passos.length ? ': ' + r.passos.join(', ') : '') + '.');
  }
  const comps = s.decompose();
  if (comps.length > 1) {
    let soma = 0;
    for (const c of comps) soma += c.volume();
    const u = ctx.guardar(Manifold.union(comps));
    for (const c of comps) c.delete();
    if (soma - u.volume() > 1e-6 * Math.max(1, soma)) {
      avisos.push('Juntei ' + comps.length + ' cascas que se atravessavam num sólido só.');
      s = u;
    }
  } else for (const c of comps) c.delete();
  return s;
}

// Boneco de teste realista (tipo personagem de IA/escultura): 120 mm, braços
// caídos com mão e dedos (mão a ~7 mm da coxa: um plano na altura do pulso
// também corta quadril e pernas), pescoço, pés. Variantes:
//   'limpo'  — uma casca fechada (união), densa
//   'ia'     — 'limpo' com pele irregular (ruído) e mais triângulos
//   'cascas' — partes SOBREPOSTAS sem unir (como muito STL de figura)
//   'sujo'   — 'ia' com furos, triângulos invertidos e sem solda (STL cru)
import { comContexto, manifold } from '../../src/estudio3d/core/solidos.js';
import { juntar, criar } from '../../src/estudio3d/core/malha.js';

export const PONTOS_BONECO = {
  palmaD: [23.5, -1, 31], palmaE: [-23.5, -1, 31], pulsoD: [23.2, -1, 37.5],
  dedoD: [23.5, -1.2, 20], cabeca: [0, -12, 98], pescoco: [0, 0, 84], cintura: 48,
  pe: [8, -10, 3]
};

export function gerarBoneco(variante = 'limpo', opc = {}) {
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const seg = opc.segmentos || 64;
    const G = m => ctx.guardar(m);
    const esf = (c, r, s = seg) => G(G(Manifold.sphere(r, s)).translate(c));
    const elip = (c, r, s = seg) => G(G(Manifold.sphere(1, s)).scale(r)).translate(c);
    const capsula = (a, b, ra, rb = ra, s = seg) => G(Manifold.hull([esf(a, ra, s), esf(b, rb, s)]));
    const partes = [
      elip([0, 0, 60], [16, 10, 22]),                     // tronco
      elip([0, 0, 42], [15, 10, 10]),                     // quadril
      capsula([0, 0, 78], [0, 0, 88], 5),                 // pescoço
      esf([0, 0, 98], 12, seg + 32)                       // cabeça
    ];
    for (const s of [1, -1]) {
      partes.push(capsula([8 * s, 0, 40], [8 * s, 0, 7], 6.5));               // perna
      partes.push(elip([8 * s, -4, 3.5], [5, 9, 3.5]));                       // pé
      partes.push(capsula([13.5 * s, 0, 74], [21.5 * s, 0, 56], 4.8, 4.3));     // braço (sai do ombro)
      partes.push(capsula([21.5 * s, 0, 56], [23.2 * s, -1, 38], 4.2, 3.2));  // antebraço
      partes.push(elip([23.5 * s, -1, 31], [2.3, 5, 6]));                     // palma
      for (const y of [-3.3, -1.1, 1.1, 3.3]) partes.push(capsula([23.5 * s, y - 1, 26.5], [23.5 * s, y * 1.15 - 1, 18.5], 1.0, 0.85, 24)); // dedos
      partes.push(capsula([23.3 * s, -5, 31], [22.3 * s, -8.5, 26.5], 1.25, 1.0, 24));                      // polegar
    }
    const limpo = G(Manifold.union(partes));
    if (variante === 'cascas') {
      return { malha: juntar(partes.map(p => ctx.parte(p, 'x', '#999999').malha)), nome: 'boneco (cascas sobrepostas)' };
    }
    let m = limpo;
    if (variante === 'ia' || variante === 'sujo') {
      m = G(G(m.refineToLength(opc.aresta || 0.9)).warp(v => {
        const k = 0.06 * Math.sin(v[0] * 1.7 + v[2] * 0.9) * Math.cos(v[1] * 2.3 - v[2] * 0.7);
        v[0] += k; v[1] += k * 0.8; v[2] += k * 0.6;
      }));
    }
    let malha = ctx.parte(m, 'boneco', '#999999').malha;
    if (variante === 'sujo') malha = sujar(malha);
    return { malha, nome: 'boneco (' + variante + ')' };
  });
}

// defeitos típicos de STL de IA/exportação: sem solda (cada triângulo com os
// próprios vértices), buracos nas costas, alguns triângulos invertidos
function sujar(m) {
  const nt = m.idx.length / 3, pos = [], idx = [];
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let t = 0; t < nt; t++) {
    const v = [0, 1, 2].map(k => m.idx[t * 3 + k]);
    const cy = (m.pos[v[0] * 3 + 1] + m.pos[v[1] * 3 + 1] + m.pos[v[2] * 3 + 1]) / 3;
    const cz = (m.pos[v[0] * 3 + 2] + m.pos[v[1] * 3 + 2] + m.pos[v[2] * 3 + 2]) / 3;
    if (cy > 9.5 && cz > 55 && cz < 65 && rnd() < 0.08) continue;          // buraquinhos nas costas
    const ordem = rnd() < 0.002 ? [0, 2, 1] : [0, 1, 2];                    // invertidos
    const b = pos.length / 3;
    for (const k of ordem) pos.push(m.pos[v[k] * 3], m.pos[v[k] * 3 + 1], m.pos[v[k] * 3 + 2]);
    idx.push(b, b + 1, b + 2);
  }
  return criar(Float64Array.from(pos), Uint32Array.from(idx));
}

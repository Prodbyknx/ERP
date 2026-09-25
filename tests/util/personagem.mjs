// Personagem de teste parecido com modelo gerado por IA: denso (~300 mil
// triângulos), superfície irregular (ruído), detalhes pequenos e próximos,
// dobras suaves e duras, uma casca solta e pintura por triângulo.
import { comContexto, manifold } from '../../src/estudio3d/core/solidos.js';
import { criar, juntar, centroidesFace } from '../../src/estudio3d/core/malha.js';
import { esfera } from './malhas.mjs';

let s = 777;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

// esfera com ruído (a "pele" irregular de modelo de IA) e escala por eixo
function bolha(r, nivel, c, esc = [1, 1, 1], ruido = 0.02) {
  const e = esfera(1, nivel);
  const p = Float64Array.from(e.pos);
  for (let v = 0; v < p.length / 3; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const k = 1 + ruido * (Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 - x * 2.1) + 0.35 * (rnd() - 0.5));
    p[v * 3] = x * k * r * esc[0] + c[0]; p[v * 3 + 1] = y * k * r * esc[1] + c[1]; p[v * 3 + 2] = z * k * r * esc[2] + c[2];
  }
  return criar(p, e.idx);
}

export const PONTOS = {
  olhoE: [-4.5, -12.2, 46], olhoD: [4.5, -12.2, 46], raioOlho: 2.2,
  orelhaE: [-10, 0, 56], orelhaD: [10, 0, 56],
  botao: [0, -18, 20], raioBotao: 3,
  estrela: [7.5, -16.2, 28],
  laco: [9, -13, 6.5]
};

export function gerarPersonagem(opc = {}) {
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    const S = m => ctx.solido({ malha: m, cor: '#000000' });
    const partes = [
      S(bolha(18, 6, [0, 0, 18], [1, 1, 1.05], 0.015)),                   // corpo
      S(bolha(13, 6, [0, 0, 44], [1, 1, 1], 0.015)),                      // cabeça
      S(bolha(5, 5, PONTOS.orelhaE, [0.5, 1, 1.4], 0.03)),                // orelhas (pele irregular)
      S(bolha(5, 5, PONTOS.orelhaD, [0.5, 1, 1.4], 0.03)),
      S(bolha(PONTOS.raioOlho, 4, PONTOS.olhoE, [1, 1, 1], 0.005)),       // olhos: 4,6 mm entre eles
      S(bolha(PONTOS.raioOlho, 4, PONTOS.olhoD, [1, 1, 1], 0.005)),
      S(bolha(6, 5, [-9, -12, 3], [1, 1.6, 0.55], 0.01)),                // pés (pra fora do corpo)
      S(bolha(6, 5, [9, -12, 3], [1, 1.6, 0.55], 0.01))
    ];
    // botão: disco Ø6 × 1,2 saindo da barriga (dobra dura)
    const botao = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.cylinder(1.6, 3, 3, 64)).rotate([90, 0, 0])).translate([0, -17.4, 20]));
    // estrela em relevo no peito, pertinho do botão (regiões próximas)
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.2 : 3; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const estrela = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.extrude(ctx.guardar(CrossSection.ofPolygons([pts], 'EvenOdd')), 2.2)).rotate([90, 0, 0])).translate([PONTOS.estrela[0], PONTOS.estrela[1] + 1.6, PONTOS.estrela[2]]));
    // laço do sapato: anelzinho em cima do pé direito
    const laco = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.cylinder(1.4, 1.4, 1.4, 48)).subtract(ctx.guardar(ctx.guardar(Manifold.cylinder(3, 0.7, 0.7, 32)).translate([0, 0, -0.8]))))
      .translate([PONTOS.laco[0], PONTOS.laco[1], PONTOS.laco[2] - 0.6]));
    const u = ctx.guardar(Manifold.union([...partes, botao, estrela, laco]));
    const corpo = ctx.parte(u, 'personagem', '#1B1B1B').malha;
    // acessório solto (casca separada): argola ao lado
    const argola = ctx.parte(ctx.guardar(ctx.guardar(ctx.guardar(Manifold.cylinder(2, 4, 4, 64)).subtract(ctx.guardar(ctx.guardar(Manifold.cylinder(4, 2.6, 2.6, 48)).translate([0, 0, -1])))).translate([-30, 0, 0])), 'argola', '#1B1B1B').malha;
    const m = opc.argola === false ? corpo : juntar([corpo, argola]);
    // pintura: olhos brancos, botão vermelho
    const C = centroidesFace(m), nt = m.idx.length / 3, cor = new Uint16Array(nt);
    const d = (t, p) => Math.hypot(C[t * 3] - p[0], C[t * 3 + 1] - p[1], C[t * 3 + 2] - p[2]);
    for (let t = 0; t < nt; t++) {
      if ((d(t, PONTOS.olhoE) < PONTOS.raioOlho * 1.08 || d(t, PONTOS.olhoD) < PONTOS.raioOlho * 1.08) && C[t * 3 + 1] < -12.3) cor[t] = 1;
      else if (C[t * 3 + 1] < -18.2 && Math.hypot(C[t * 3], C[t * 3 + 2] - 20) < 3.05) cor[t] = 2;
    }
    return { malha: criar(m.pos, m.idx, cor), paleta: ['#1B1B1B', '#FFFFFF', '#D1242F'] };
  });
}

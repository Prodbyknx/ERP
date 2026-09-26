// DESENHAR E CRIAR: um contorno 2D desenhado na mesa (pontos em mm) vira
//   'extrudar'     — peça com espessura (placa, base, logo, suporte)
//   'revolucionar' — perfil girado em volta do eixo (vaso, puxador, botão):
//                    a linha mais à esquerda do desenho é o eixo
//   'tubo'         — caminho aberto vira tubo de diâmetro d
// Sempre sólido fechado, medidas em mm, apoiado em z = 0.
import { comContexto, manifold, segmentos } from './solidos.js';

const area = pts => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return -s / 2; };

export function criarDoDesenho(pts, tipo, opc = {}) {
  if (!pts || pts.length < 2) throw new Error('Desenhe pelo menos 2 pontos.');
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    let M;
    if (tipo === 'tubo') {
      const r = Math.max(0.2, (+opc.diametro || 4) / 2), seg = segmentos(r, 16);
      const esf = pts.map(p => ctx.guardar(ctx.guardar(Manifold.sphere(r, seg)).translate([p[0], p[1], r])));
      const pedacos = [];
      for (let i = 1; i < esf.length; i++) pedacos.push(ctx.guardar(Manifold.hull([esf[i - 1], esf[i]])));
      M = pedacos.length ? ctx.guardar(Manifold.union(pedacos)) : esf[0];
    } else {
      if (pts.length < 3) throw new Error('Feche um contorno com pelo menos 3 pontos.');
      if (Math.abs(area(pts)) < 1e-6) throw new Error('O desenho não tem área (pontos em linha).');
      let cs = ctx.guardar(CrossSection.ofPolygons([pts], 'Positive'));
      if (area(pts) < 0) cs = ctx.guardar(CrossSection.ofPolygons([pts.slice().reverse()], 'Positive'));
      const rc = +opc.cantos || 0;
      // cantos arredondados (fora e dentro), sem mudar o tamanho geral
      if (rc > 0) cs = ctx.guardar(ctx.guardar(ctx.guardar(cs.offset(-rc, 'Round', 2, 32)).offset(2 * rc, 'Round', 2, 32)).offset(-rc, 'Round', 2, 32));
      if (cs.isEmpty()) throw new Error('O contorno sumiu com esse arredondamento.');
      if (tipo === 'revolucionar') {
        const b = cs.bounds();
        const perfil = ctx.guardar(cs.translate([-b.min[0], -b.min[1]]));
        const graus = Math.max(1, Math.min(360, +opc.graus || 360));
        M = ctx.guardar(Manifold.revolve(perfil, segmentos(b.max[0] - b.min[0], 48), graus));
        // centro do giro onde estava o eixo (esquerda do desenho), de pé na mesa
        M = ctx.guardar(M.translate([b.min[0], (b.min[1] + b.max[1]) / 2, 0]));
      } else {
        const e = +opc.espessura;
        if (!(e > 0)) throw new Error('Informe a espessura (mm).');
        M = ctx.guardar(Manifold.extrude(cs, e));
      }
    }
    if (M.isEmpty()) throw new Error('Não saiu peça desse desenho.');
    const bb = M.boundingBox();
    M = ctx.guardar(M.translate([0, 0, -bb.min[2]]));
    return { malha: ctx.parte(M, 'Desenho', opc.cor || '#999999').malha, volume: M.volume() };
  });
}

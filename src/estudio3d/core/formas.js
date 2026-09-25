// Biblioteca de formas: tudo gerado pelo Manifold (sólido fechado por
// construção), em milímetros, centrado em X/Y e apoiado na mesa (z = 0).
// Cada forma tem os parâmetros que o funcionário edita, com rótulo simples.
import { comContexto, manifold, segmentos } from './solidos.js';

const P = (k, rot, padrao, extra = {}) => ({ k, rot, padrao, min: 0.1, max: 500, unid: 'mm', ...extra });
const esp = P('espessura', 'Espessura', 3, { max: 200 });

export const FORMAS = [
  // ---------- 3D
  { id: 'cubo', nome: 'Cubo', grupo: '3d', params: [P('lado', 'Lado', 20)] },
  { id: 'caixa', nome: 'Caixa', grupo: '3d', params: [P('largura', 'Largura (X)', 40), P('profundidade', 'Profundidade (Y)', 30), P('altura', 'Altura (Z)', 20), P('canto', 'Canto arredondado', 0, { min: 0 })] },
  { id: 'esfera', nome: 'Esfera', grupo: '3d', params: [P('diametro', 'Diâmetro', 20)] },
  { id: 'cilindro', nome: 'Cilindro', grupo: '3d', params: [P('diametro', 'Diâmetro', 20), P('altura', 'Altura', 20)] },
  { id: 'cone', nome: 'Cone', grupo: '3d', params: [P('diametro', 'Diâmetro da base', 20), P('diametroTopo', 'Diâmetro do topo', 0, { min: 0 }), P('altura', 'Altura', 20)] },
  { id: 'piramide', nome: 'Pirâmide', grupo: '3d', params: [P('lado', 'Lado da base', 20), P('altura', 'Altura', 20)] },
  { id: 'prisma', nome: 'Prisma', grupo: '3d', params: [P('lados', 'Lados', 6, { min: 3, max: 64, unid: '', inteiro: true }), P('diametro', 'Diâmetro', 20), P('altura', 'Altura', 20)] },
  { id: 'tubo', nome: 'Tubo', grupo: '3d', params: [P('diametro', 'Diâmetro de fora', 20), P('diametroInterno', 'Diâmetro do furo', 14), P('altura', 'Altura', 20)] },
  { id: 'anel', nome: 'Anel', grupo: '3d', params: [P('diametro', 'Diâmetro de fora', 30), P('grossura', 'Grossura', 5)] },
  { id: 'capsula', nome: 'Cápsula', grupo: '3d', params: [P('diametro', 'Diâmetro', 12), P('comprimento', 'Comprimento', 30)] },
  { id: 'hemisferio', nome: 'Meia esfera', grupo: '3d', params: [P('diametro', 'Diâmetro', 30)] },
  { id: 'placa', nome: 'Placa', grupo: '3d', params: [P('largura', 'Largura (X)', 60), P('profundidade', 'Profundidade (Y)', 40), P('espessura', 'Espessura', 2)] },
  // ---------- 2D com espessura
  { id: 'circulo', nome: 'Círculo', grupo: '2d', params: [P('diametro', 'Diâmetro', 40), esp] },
  { id: 'quadrado', nome: 'Quadrado', grupo: '2d', params: [P('lado', 'Lado', 30), esp] },
  { id: 'retangulo', nome: 'Retângulo', grupo: '2d', params: [P('largura', 'Largura', 60), P('comprimento', 'Comprimento', 30), P('canto', 'Canto arredondado', 0, { min: 0 }), esp] },
  { id: 'triangulo', nome: 'Triângulo', grupo: '2d', params: [P('lado', 'Lado', 30), esp] },
  { id: 'estrela', nome: 'Estrela', grupo: '2d', params: [P('pontas', 'Pontas', 5, { min: 3, max: 40, unid: '', inteiro: true }), P('diametro', 'Diâmetro', 40), P('miolo', 'Miolo', 45, { min: 5, max: 95, unid: '%' }), esp] },
  { id: 'hexagono', nome: 'Hexágono', grupo: '2d', params: [P('diametro', 'Diâmetro', 30), esp] },
  { id: 'poligono', nome: 'Polígono', grupo: '2d', params: [P('lados', 'Lados', 8, { min: 3, max: 64, unid: '', inteiro: true }), P('diametro', 'Diâmetro', 30), esp] },
  { id: 'coracao', nome: 'Coração', grupo: '2d', params: [P('largura', 'Largura', 40), esp] },
  { id: 'texto', nome: 'Texto', grupo: '2d', params: [P('altura', 'Largura do texto', 40), esp], texto: true },
  // ---------- peças prontas pra impressão
  { id: 'furoParafuso', nome: 'Furo p/ parafuso', grupo: 'pronta', papel: 'furo', params: [P('bitola', 'Parafuso M', 3, { min: 2, max: 12, unid: '' }), P('comprimento', 'Profundidade', 20), P('cabeca', 'Fundo da cabeça', 3, { min: 0 })] },
  { id: 'argola', nome: 'Argola de chaveiro', grupo: 'pronta', params: [P('diametro', 'Diâmetro de fora', 12), P('furo', 'Furo', 6), P('espessura', 'Espessura', 3)] },
  { id: 'pino', nome: 'Pino de encaixe', grupo: 'pronta', params: [P('diametro', 'Diâmetro', 5), P('comprimento', 'Comprimento', 12), P('chanfro', 'Chanfro', 0.5, { min: 0 })] },
  { id: 'espacador', nome: 'Espaçador', grupo: 'pronta', params: [P('diametro', 'Diâmetro de fora', 10), P('furo', 'Furo', 3.4), P('altura', 'Altura', 5)] },
  { id: 'imaFuro', nome: 'Encaixe de ímã', grupo: 'pronta', papel: 'furo', params: [P('diametro', 'Diâmetro do ímã', 8), P('altura', 'Altura do ímã', 3), P('folga', 'Folga', 0.15, { min: 0, max: 2 })] },
  { id: 'base', nome: 'Base', grupo: 'pronta', params: [P('largura', 'Largura (X)', 60), P('profundidade', 'Profundidade (Y)', 40), P('altura', 'Altura', 3), P('canto', 'Canto arredondado', 5, { min: 0 })] }
];

export const formaPorId = id => FORMAS.find(f => f.id === id) || null;
export function paramsPadrao(id) { const f = formaPorId(id); const o = {}; if (f) for (const p of f.params) o[p.k] = p.padrao; return o; }

// confere/limita os números digitados
export function normalizarParams(id, params) {
  const f = formaPorId(id);
  if (!f) throw new Error('Forma desconhecida: ' + id);
  const o = { ...params };
  for (const p of f.params) {
    let v = Number(o[p.k]);
    if (!isFinite(v)) v = p.padrao;
    v = Math.max(p.min, Math.min(p.max, v));
    if (p.inteiro) v = Math.round(v);
    o[p.k] = v;
  }
  return o;
}

function poligonoRegular(n, r, giro = Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = giro + i * 2 * Math.PI / n; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}
function coracao(largura) {
  const pts = [];
  for (let i = 0; i < 160; i++) {
    const t = i / 160 * 2 * Math.PI;
    pts.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
  }
  const s = largura / 32;
  return pts.map(p => [p[0] * s, p[1] * s]);
}

// Gera o sólido (Manifold) da forma; o contexto libera a memória.
export function gerarManifold(ctx, id, params, extras = {}) {
  const { Manifold, CrossSection } = manifold();
  const g = x => ctx.guardar(x);
  const q = normalizarParams(id, params);
  const seg = r => segmentos(r);
  const noChao = m => { const b = m.boundingBox(); return g(m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]])); };
  const extrudar = (cs, h) => noChao(g(Manifold.extrude(cs, h)));
  const retArred = (w, d, r) => {
    r = Math.max(0, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
    if (r <= 0) return g(CrossSection.square([w, d], true));
    return g(g(CrossSection.square([w - 2 * r, d - 2 * r], true)).offset(r, 'Round', 2, seg(r)));
  };
  switch (id) {
    case 'cubo': return noChao(g(Manifold.cube([q.lado, q.lado, q.lado], true)));
    case 'caixa': return extrudar(retArred(q.largura, q.profundidade, q.canto), q.altura);
    case 'esfera': return noChao(g(Manifold.sphere(q.diametro / 2, seg(q.diametro / 2))));
    case 'cilindro': return noChao(g(Manifold.cylinder(q.altura, q.diametro / 2, q.diametro / 2, seg(q.diametro / 2))));
    case 'cone': return noChao(g(Manifold.cylinder(q.altura, q.diametro / 2, Math.min(q.diametroTopo, q.diametro * 4) / 2, seg(q.diametro / 2))));
    case 'piramide': return noChao(g(g(Manifold.cylinder(q.altura, q.lado / Math.SQRT2, 0, 4)).rotate([0, 0, 45])));
    case 'prisma': return noChao(g(Manifold.cylinder(q.altura, q.diametro / 2, q.diametro / 2, q.lados)));
    case 'tubo': {
      if (q.diametroInterno >= q.diametro - 0.2) throw new Error('O furo do tubo precisa ser menor que o diâmetro de fora.');
      const a = g(Manifold.cylinder(q.altura, q.diametro / 2, q.diametro / 2, seg(q.diametro / 2)));
      const b = g(g(Manifold.cylinder(q.altura + 2, q.diametroInterno / 2, q.diametroInterno / 2, seg(q.diametroInterno / 2))).translate([0, 0, -1]));
      return noChao(g(a.subtract(b)));
    }
    case 'anel': {
      const rs = Math.min(q.grossura, q.diametro / 2 - 0.1) / 2, R = q.diametro / 2 - rs;
      if (R <= rs) throw new Error('A grossura do anel é grande demais pro diâmetro.');
      const c = g(g(CrossSection.circle(rs, seg(rs))).translate([R, 0]));
      return noChao(g(Manifold.revolve(c, seg(q.diametro / 2))));
    }
    case 'capsula': {
      const r = q.diametro / 2, L = Math.max(q.comprimento, q.diametro);
      const a = g(Manifold.sphere(r, seg(r))), b = g(g(Manifold.sphere(r, seg(r))).translate([0, 0, L - 2 * r]));
      return noChao(g(Manifold.hull([a, b])));
    }
    case 'hemisferio': return noChao(g(g(Manifold.sphere(q.diametro / 2, seg(q.diametro / 2))).trimByPlane([0, 0, 1], 0)));
    case 'placa': return noChao(g(Manifold.cube([q.largura, q.profundidade, q.espessura], true)));
    case 'circulo': return extrudar(g(CrossSection.circle(q.diametro / 2, seg(q.diametro / 2))), q.espessura);
    case 'quadrado': return extrudar(g(CrossSection.square([q.lado, q.lado], true)), q.espessura);
    case 'retangulo': return extrudar(retArred(q.largura, q.comprimento, q.canto), q.espessura);
    case 'triangulo': return extrudar(g(CrossSection.ofPolygons([poligonoRegular(3, q.lado / Math.sqrt(3))], 'EvenOdd')), q.espessura);
    case 'estrela': {
      const pts = [];
      for (let i = 0; i < q.pontas * 2; i++) { const a = Math.PI / 2 + i * Math.PI / q.pontas, r = (i % 2 ? q.miolo / 100 : 1) * q.diametro / 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      return extrudar(g(CrossSection.ofPolygons([pts], 'EvenOdd')), q.espessura);
    }
    case 'hexagono': return extrudar(g(CrossSection.ofPolygons([poligonoRegular(6, q.diametro / 2, 0)], 'EvenOdd')), q.espessura);
    case 'poligono': return extrudar(g(CrossSection.ofPolygons([poligonoRegular(q.lados, q.diametro / 2)], 'EvenOdd')), q.espessura);
    case 'coracao': return extrudar(g(CrossSection.ofPolygons([coracao(q.largura)], 'EvenOdd')), q.espessura);
    case 'texto': {
      const aneis = extras.aneis;
      if (!aneis || !aneis.length) throw new Error('Escreva o texto.');
      let x0 = Infinity, x1 = -Infinity;
      for (const a of aneis) for (const p of a) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
      const s = q.altura / Math.max(1e-9, x1 - x0);
      const cs = g(CrossSection.ofPolygons(aneis.map(a => a.map(p => [p[0] * s, p[1] * s])), 'EvenOdd'));
      return extrudar(cs, q.espessura);
    }
    case 'furoParafuso': {
      const r = (q.bitola + 0.4) / 2, rc = (q.bitola * 2 + 0.6) / 2, h = q.comprimento, hc = Math.min(q.cabeca, h - 0.5);
      let m = g(Manifold.cylinder(h, r, r, seg(r)));
      if (hc > 0) m = g(m.add(g(g(Manifold.cylinder(hc, rc, rc, seg(rc))).translate([0, 0, h - hc]))));
      return noChao(m);
    }
    case 'argola': {
      if (q.furo >= q.diametro - 0.8) throw new Error('O furo da argola precisa ser menor que o diâmetro.');
      const a = g(Manifold.cylinder(q.espessura, q.diametro / 2, q.diametro / 2, seg(q.diametro / 2)));
      const b = g(g(Manifold.cylinder(q.espessura + 2, q.furo / 2, q.furo / 2, seg(q.furo / 2))).translate([0, 0, -1]));
      return noChao(g(a.subtract(b)));
    }
    case 'pino': {
      const r = q.diametro / 2, c = Math.min(q.chanfro, r * 0.45, q.comprimento / 4), L = q.comprimento, n = seg(r);
      if (c <= 0) return noChao(g(Manifold.cylinder(L, r, r, n)));
      const partes = [g(Manifold.cylinder(c, r - c, r, n)), g(g(Manifold.cylinder(L - 2 * c, r, r, n)).translate([0, 0, c])), g(g(Manifold.cylinder(c, r, r - c, n)).translate([0, 0, L - c]))];
      return noChao(g(Manifold.hull(partes)));
    }
    case 'espacador': {
      if (q.furo >= q.diametro - 0.8) throw new Error('O furo precisa ser menor que o diâmetro.');
      const a = g(Manifold.cylinder(q.altura, q.diametro / 2, q.diametro / 2, seg(q.diametro / 2)));
      const b = g(g(Manifold.cylinder(q.altura + 2, q.furo / 2, q.furo / 2, seg(q.furo / 2))).translate([0, 0, -1]));
      return noChao(g(a.subtract(b)));
    }
    case 'imaFuro': {
      const r = q.diametro / 2 + q.folga;
      return noChao(g(Manifold.cylinder(q.altura + q.folga, r, r, seg(r))));
    }
    case 'base': return extrudar(retArred(q.largura, q.profundidade, q.canto), q.altura);
    default: throw new Error('Forma desconhecida: ' + id);
  }
}

// Forma pronta como peça { malha, cor } (malha fechada e limpa)
export function gerarForma(id, params, opc = {}) {
  return comContexto(ctx => {
    const man = gerarManifold(ctx, id, params, opc);
    if (man.isEmpty()) throw new Error('A forma ficou vazia — confira as medidas.');
    const o = ctx.primitiva(man, opc.cor || '#B4BAC4');
    const f = formaPorId(id);
    return { ...ctx.parte(o, f.nome, opc.cor || '#B4BAC4'), params: normalizarParams(id, params) };
  });
}

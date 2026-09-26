// ConnectorGenerator — encaixes entre duas peças que se tocam num plano.
// Convenção: no referencial do plano, +Z aponta pra peça A e a peça B fica
// em Z < 0. A recebe o POSITIVO (pino), B recebe o NEGATIVO (furo) já
// alargado pela folga. Nunca sai positivo dos dois lados.
//
// Folga = espaço POR LADO. Pino Ø5,00 com folga 0,25 -> furo Ø5,50.
import { manifold, segmentos } from './solidos.js';
import { espalharPontos, eixoPrincipal, distanciaBorda, dentro } from './geo2d.js';
import * as M4 from './mat4.js';

export const TIPOS_CONECTOR = [
  { id: 'cilindrico', nome: 'Pino cilíndrico' },
  { id: 'quadrado', nome: 'Pino quadrado' },
  { id: 'retangular', nome: 'Pino retangular' },
  { id: 'hexagonal', nome: 'Pino hexagonal' },
  { id: 'lingueta', nome: 'Lingueta e ranhura' },
  { id: 'andorinha', nome: 'Rabo de andorinha (desliza)' },
  { id: 'solto', nome: 'Pino solto (furo nos dois lados)' }
];

export const PADRAO_CONECTOR = {
  tipo: 'cilindrico', diametro: 5, lado: 5, largura: 4, comprimento: 8,
  profundidade: 6, folga: 0.2, folgaFundo: 0.3, quantidade: 1, chanfro: 0.4, parede: 1.2
};

// Seção do conector centrada na origem (CrossSection). 'medida' = raio do
// círculo que envolve a peça, pra calcular onde cabe.
export function formaConector(cfg) {
  const { CrossSection } = manifold();
  const t = cfg.tipo;
  if (t === 'cilindrico' || t === 'solto') {
    const r = cfg.diametro / 2;
    return { cs: CrossSection.circle(r, segmentos(r)), meiaLargura: r, raio: r, juncao: 'Round', simetrica: true };
  }
  if (t === 'quadrado') {
    const l = cfg.lado;
    return { cs: CrossSection.square([l, l], true), meiaLargura: l / 2, raio: l * Math.SQRT1_2, juncao: 'Miter', simetrica: false };
  }
  if (t === 'retangular') {
    return { cs: CrossSection.square([cfg.comprimento, cfg.largura], true), meiaLargura: cfg.largura / 2,
      raio: Math.hypot(cfg.comprimento, cfg.largura) / 2, juncao: 'Miter', simetrica: false };
  }
  if (t === 'hexagonal') {
    // diametro = entre faces (a chave que serve)
    const rc = cfg.diametro / 2 / Math.cos(Math.PI / 6);
    return { cs: CrossSection.circle(rc, 6), meiaLargura: cfg.diametro / 2, raio: rc, juncao: 'Miter', simetrica: false };
  }
  throw new Error('Tipo de conector desconhecido: ' + t);
}

// prisma da seção cs entre z0 e z1 (z0 < z1), com chanfro opcional na ponta
// de baixo. Com chanfro vira UM casco convexo (corpo + ponta menor): nada de
// união com face coplanar, que deixaria lasca na malha.
function prisma(cs, z0, z1, chanfro, meia) {
  const { Manifold } = manifold();
  const h = z1 - z0;
  if (!chanfro || chanfro <= 0 || chanfro >= h * 0.6 || chanfro >= meia * 0.7) {
    return Manifold.extrude(cs, h).translate([0, 0, z0]);
  }
  const s = Math.max(0.3, (meia - chanfro) / meia);
  const corpo = Manifold.extrude(cs, h - chanfro).translate([0, 0, z0 + chanfro]);
  const ponta = Manifold.extrude(cs.scale(s), 1e-3).translate([0, 0, z0]);
  const r = Manifold.hull([corpo, ponta]);
  corpo.delete(); ponta.delete();
  return r;
}

// Tamanho do conector pra seção: cfg.auto escolhe (~45% da largura livre,
// Ø2 a Ø8); tamanho pedido que não cabe é REDUZIDO (com aviso) em vez de pulado.
export function dimensionarConector(secao, cfg0, avisos = []) {
  const cfg = Object.assign({}, PADRAO_CONECTOR, cfg0 || {});
  if (!['cilindrico', 'solto', 'quadrado', 'hexagonal'].includes(cfg.tipo) || !secao.length) return cfg;
  const { CrossSection } = manifold();
  const cs = CrossSection.ofPolygons(secao, 'EvenOdd');
  let lo = 0, hi = Math.sqrt(Math.max(cs.area(), 0) / Math.PI) * 1.5 + 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2, o = cs.offset(-m, 'Round', 2, 24), ok = !o.isEmpty();
    o.delete(); if (ok) lo = m; else hi = m;
  }
  cs.delete();
  const rIn = lo;                                   // raio do maior círculo que cabe na seção
  const parede = Math.min(cfg.parede, Math.max(0.8, rIn * 0.3));
  const rMax = rIn - cfg.folga - parede;            // raio do conector que ainda deixa parede
  const tam = cfg.tipo === 'quadrado' ? cfg.lado * Math.SQRT1_2 : cfg.tipo === 'hexagonal' ? cfg.diametro / 2 / Math.cos(Math.PI / 6) : cfg.diametro / 2;
  let r = cfg.auto ? Math.min(4, Math.max(rIn * 0.45, Math.min(1.5, rMax))) : tam;
  if (r > rMax) r = rMax;
  if (r < 0.9) {
    // não cabe nem Ø2 com parede: explica em vez de "precisa de X mm"
    avisos.push('A seção do corte tem só ~' + (2 * rIn).toFixed(1).replace('.', ',') + ' mm de largura: não cabe pino (precisa de uns 5 mm). Saiu sem encaixe — cole as partes, ou deixe a parede mais grossa aí.');
    return { ...cfg, naoCabe: true };
  }
  const passo = v => Math.floor(v * 2) / 2;         // de 0,5 em 0,5 mm
  const antes = medidaTexto(cfg);
  if (cfg.tipo === 'quadrado') cfg.lado = Math.max(1.5, passo(r / Math.SQRT1_2));
  else if (cfg.tipo === 'hexagonal') cfg.diametro = Math.max(2, passo(r * 2 * Math.cos(Math.PI / 6)));
  else cfg.diametro = Math.max(2, passo(r * 2));
  cfg.parede = parede;
  if (cfg.auto) {
    const d = cfg.tipo === 'quadrado' ? cfg.lado : cfg.diametro;
    cfg.profundidade = Math.max(3, Math.min(10, Math.round(d * 1.4)));
  } else if (medidaTexto(cfg) !== antes) avisos.push('O conector ' + antes + ' não cabia nessa seção: usei ' + medidaTexto(cfg) + '.');
  return cfg;
}

// Onde cabem os conectores na seção do corte (em mm, no plano)
export function posicionar(secao, cfg, forma) {
  const { CrossSection } = manifold();
  const avisos = [];
  const cs = CrossSection.ofPolygons(secao, 'EvenOdd');
  const folgaLateral = cfg.tipo === 'solto' ? cfg.folga : cfg.folga;
  const recuo = forma.raio + folgaLateral + cfg.parede;
  const perm = cs.offset(-recuo, 'Round', 2, 24);
  let permitida = perm.toPolygons();
  cs.delete(); perm.delete();
  if (!permitida.length) {
    avisos.push('O corte é estreito demais pra um conector desse tamanho (precisa de ' + (recuo * 2).toFixed(1) + ' mm de largura livre).');
    return { pontos: [], avisos, angulo: 0 };
  }
  const n = Math.max(1, Math.min(12, cfg.quantidade | 0));
  const pontos = espalharPontos(permitida, n);
  // conectores não podem se encostar
  const minDist = 2 * forma.raio + 2 * folgaLateral + cfg.parede;
  const ok = [];
  for (const p of pontos) if (ok.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= minDist)) ok.push(p);
  if (ok.length < n) avisos.push('Couberam ' + ok.length + ' de ' + n + ' conectores sem encostar um no outro.');
  const eixo = eixoPrincipal(secao);
  return { pontos: ok, avisos, angulo: eixo.ang * 180 / Math.PI };
}

// Quanto material tem atrás do ponto (x,y) do plano, pro lado 'sinal' (-1 = B, +1 = A)
function espessuraDisponivel(solido, frame, x, y, sinal) {
  const o = M4.aplicarPonto(frame, x, y, sinal * 0.01);
  const L = 1000;
  const f = M4.aplicarPonto(frame, x, y, sinal * L);
  const hits = solido.rayCast(o, f);
  // o 1º acerto é a face do corte (entrando), o 2º é o fundo (saindo)
  const dist = hits.map(h => h.distance * (L - 0.01) + 0.01);
  const saidas = dist.filter(d => d > 0.02);
  if (saidas.length === 0) return 0;
  if (saidas.length === 1) return saidas[0];
  return saidas[0] < 0.05 ? saidas[1] : saidas[0];
}

// Lateral do furo não pode furar a parede da peça mais pra baixo
function cabeLateral(solidoLocal, x, y, raioLivre, z) {
  const sec = solidoLocal.slice(z);
  const pol = sec.toPolygons();
  sec.delete();
  if (!pol.length || !dentro(pol, x, y)) return false;
  return distanciaBorda(pol, x, y) >= raioLivre;
}

// Gera pino (A) e furo (B). solidoA/solidoB: Manifold de cada lado (mundo
// da peça). Devolve Manifolds em coordenadas da peça + relatório.
export function gerarConectores(ctx, { solidoA, solidoB, frame, secao, cfg }) {
  const { Manifold, CrossSection } = manifold();
  cfg = Object.assign({}, PADRAO_CONECTOR, cfg || {});
  const avisos = [];
  const inv = M4.inverter(frame);
  const locA = ctx.guardar(solidoA.transform(Array.from(inv)));
  const locB = ctx.guardar(solidoB.transform(Array.from(inv)));
  const positivos = [], negativosA = [], negativosB = [], soltos = [];
  const relatorio = [];

  if (cfg.naoCabe) return { positivos, negativosA, negativosB, soltos, relatorio, avisos };
  if (cfg.tipo === 'lingueta' || cfg.tipo === 'andorinha') {
    return gerarTrilho(ctx, { frame, secao, cfg, avisos });
  }

  const forma = formaConector(cfg);
  ctx.guardar(forma.cs);
  const pos = posicionar(secao, cfg, forma);
  avisos.push(...pos.avisos);
  const juncao = forma.juncao;
  const csFuro = ctx.guardar(forma.cs.offset(cfg.folga, juncao, 4, segmentos(forma.raio + cfg.folga)));
  const girar = !forma.simetrica ? pos.angulo : 0;
  for (const [x, y] of pos.pontos) {
    // profundidade possível em B (e em A, se o pino for solto)
    const dispB = espessuraDisponivel(solidoB, frame, x, y, -1);
    const dispA = cfg.tipo === 'solto' ? espessuraDisponivel(solidoA, frame, x, y, +1) : Infinity;
    let prof = Math.min(cfg.profundidade, dispB - cfg.folgaFundo - cfg.parede, dispA - cfg.folgaFundo - cfg.parede);
    // a lateral do furo precisa caber lá embaixo também
    const raioLivre = forma.raio + cfg.folga + Math.min(0.8, cfg.parede * 0.6);
    while (prof > 1 && !cabeLateral(locB, x, y, raioLivre, -(prof + cfg.folgaFundo))) prof -= 0.5;
    if (cfg.tipo === 'solto') while (prof > 1 && !cabeLateral(locA, x, y, raioLivre, prof + cfg.folgaFundo)) prof -= 0.5;
    if (prof < Math.min(2, cfg.profundidade)) {
      avisos.push('Sem espessura pra conector em (' + x.toFixed(1) + '; ' + y.toFixed(1) + ') — pulado.');
      continue;
    }
    if (prof < cfg.profundidade - 1e-6) avisos.push('Conector em (' + x.toFixed(1) + '; ' + y.toFixed(1) + ') ficou com ' + prof.toFixed(1) + ' mm de profundidade (faltou material pros ' + cfg.profundidade + ' mm pedidos).');
    const T = M4.multiplicar(frame, M4.multiplicar(M4.translacao(x, y, 0), M4.rotacaoEuler(0, 0, girar)));
    const Tm = Array.from(T);
    const ov = 0.02;
    if (cfg.tipo === 'solto') {
      // furo nos dois lados + pino separado
      const fB = prisma(csFuro, -(prof + cfg.folgaFundo), ov, 0, 1);
      const fA = prisma(csFuro, -ov, prof + cfg.folgaFundo, 0, 1);
      negativosB.push(ctx.guardar(fB.transform(Tm))); fB.delete();
      negativosA.push(ctx.guardar(fA.transform(Tm))); fA.delete();
      const comp = 2 * prof - 0.2;
      const pino = prisma(forma.cs, 0, comp, cfg.chanfro, forma.meiaLargura);
      // chanfro na outra ponta também
      soltos.push({ man: ctx.guardar(pino), comprimento: comp });
      relatorio.push({ x, y, profundidade: prof, pino: medidaTexto(cfg), furo: medidaTexto(cfg, cfg.folga), comprimentoPino: comp });
    } else {
      const pino = prisma(forma.cs, -prof, ov, cfg.chanfro, forma.meiaLargura);
      const furo = prisma(csFuro, -(prof + cfg.folgaFundo), 0.5, 0, 1);
      positivos.push(ctx.guardar(pino.transform(Tm))); pino.delete();
      negativosB.push(ctx.guardar(furo.transform(Tm))); furo.delete();
      relatorio.push({ x, y, profundidade: prof, pino: medidaTexto(cfg), furo: medidaTexto(cfg, cfg.folga), fundoFuro: prof + cfg.folgaFundo });
    }
  }
  void CrossSection; void Manifold;
  return { positivos, negativosA, negativosB, soltos, relatorio, avisos };
}

export function medidaTexto(cfg, folga = 0) {
  const f = 2 * folga;
  const n = v => (v + f).toFixed(2).replace('.', ',');
  if (cfg.tipo === 'cilindrico' || cfg.tipo === 'solto') return 'Ø ' + n(cfg.diametro) + ' mm';
  if (cfg.tipo === 'quadrado') return n(cfg.lado) + ' × ' + n(cfg.lado) + ' mm';
  if (cfg.tipo === 'retangular') return n(cfg.comprimento) + ' × ' + n(cfg.largura) + ' mm';
  if (cfg.tipo === 'hexagonal') return 'sextavado ' + n(cfg.diametro) + ' mm entre faces';
  return '';
}

// Lingueta (ranhura fechada) e rabo de andorinha (trilho aberto nas pontas).
// Perfil no plano (lateral, profundidade), puxado ao longo do eixo principal
// da seção do corte.
function gerarTrilho(ctx, { frame, secao, cfg, avisos }) {
  const { Manifold, CrossSection } = manifold();
  const eixo = eixoPrincipal(secao);
  const cs = ctx.guardar(CrossSection.ofPolygons(secao, 'EvenOdd'));
  const w = cfg.largura, prof = cfg.profundidade, f = cfg.folga;
  const positivos = [], negativosB = [], relatorio = [];
  const R = M4.multiplicar(M4.translacao(eixo.cx, eixo.cy, 0), M4.rotacaoEuler(0, 0, eixo.ang * 180 / Math.PI));
  const Ri = M4.inverter(R);
  let x0 = Infinity, x1 = -Infinity;
  for (const a of secao) for (const p of a) {
    const q = M4.aplicarPonto(Ri, p[0], p[1], 0);
    if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
  }
  const andorinha = cfg.tipo === 'andorinha';
  let perfil, perfilFuro;
  if (andorinha) {
    // trapézio: estreito junto ao corte, largo na ponta -> trava ao puxar
    const a = w / 2, b = w / 2 + prof * Math.tan(15 * Math.PI / 180);
    perfil = [[-a, 0.02], [a, 0.02], [b, -prof], [-b, -prof]];
    perfilFuro = [[-(a + f), 0.5], [a + f, 0.5], [b + f, -(prof + cfg.folgaFundo)], [-(b + f), -(prof + cfg.folgaFundo)]];
  } else {
    perfil = [[-w / 2, 0.02], [w / 2, 0.02], [w / 2, -prof], [-w / 2, -prof]];
    perfilFuro = [[-(w / 2 + f), 0.5], [w / 2 + f, 0.5], [w / 2 + f, -(prof + cfg.folgaFundo)], [-(w / 2 + f), -(prof + cfg.folgaFundo)]];
  }
  // extrude em Z -> (lateral, profundidade, comprimento) vira (comprimento, lateral, profundidade)
  const P = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];
  const xm = (x0 + x1) / 2;
  const noPlano = Array.from(M4.multiplicar(R, M4.translacao(xm, 0, 0)));
  const barra = (pts, comp) => {
    const csP = CrossSection.ofPolygons([pts], 'EvenOdd');
    const e = Manifold.extrude(csP, comp).translate([0, 0, -comp / 2]);
    csP.delete();
    const g = e.transform(P); e.delete();
    const r = g.transform(noPlano); g.delete();
    return ctx.guardar(r);
  };
  const L = x1 - x0;
  const comp = andorinha ? L + 20 : L - 2 * (cfg.parede + 1);
  if (L < 6 || comp < 4) {
    avisos.push('Corte curto demais pra ' + (andorinha ? 'rabo de andorinha' : 'lingueta') + '.');
    return { positivos, negativosA: [], negativosB, soltos: [], relatorio, avisos };
  }
  let pino = barra(perfil, comp);
  let furo = barra(perfilFuro, andorinha ? comp + 10 : comp + 2 * f);
  // o positivo nunca sai da silhueta da peça A no plano
  const limP = ctx.guardar(cs.offset(andorinha ? 0 : -cfg.parede, 'Round'));
  const altP = ctx.guardar(Manifold.extrude(limP, prof + 1).translate([0, 0, -(prof + 0.5)]));
  pino = ctx.guardar(pino.intersect(altP));
  if (!andorinha) {
    const limF = ctx.guardar(cs.offset(-cfg.parede + f, 'Round'));
    const altF = ctx.guardar(Manifold.extrude(limF, prof + 4).translate([0, 0, -(prof + 3)]));
    furo = ctx.guardar(furo.intersect(altF));
  }
  const F = Array.from(frame);
  positivos.push(ctx.guardar(pino.transform(F)));
  negativosB.push(ctx.guardar(furo.transform(F)));
  relatorio.push({ tipo: cfg.tipo, comprimento: andorinha ? L : comp, largura: w, profundidade: prof, folga: f });
  return { positivos, negativosA: [], negativosB, soltos: [], relatorio, avisos };
}

// ConnectorGenerator — encaixes entre duas peças que se tocam num plano.
// Convenção: no referencial do plano, +Z aponta pra peça A e a peça B fica
// em Z < 0. A recebe o POSITIVO (pino), B recebe o NEGATIVO (furo) já
// alargado pela folga. Nunca sai positivo dos dois lados.
//
// Folga = espaço POR LADO. Pino Ø5,00 com folga 0,25 -> furo Ø5,50.
import { manifold, segmentos } from './solidos.js';
import { eixoPrincipal, distanciaBorda, dentro } from './geo2d.js';
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

// Configuração normalizada. O TAMANHO de verdade (e onde fica, e quão
// fundo) sai do planejador, que olha a peça inteira abaixo do corte.
export function dimensionarConector(secao, cfg0) {
  return Object.assign({}, PADRAO_CONECTOR, cfg0 || {});
}

// ------------------------------------------------------------ PLANEJADOR
// Decide posição + tamanho + profundidade de cada pino JUNTOS, olhando a peça
// abaixo do corte em fatias de 0,5 mm (não só no fundo do furo): o furo, com
// a parede em volta, tem que caber em TODA a profundidade. Cada ilha do corte
// (duas pernas, uma mão) ganha o seu encaixe — senão sai pedaço solto. Pino
// largo e raso não segura: profundidade mínima ~0,8 × diâmetro.
const PASSO_Z = 0.5;
const circunraio = (tipo, t, cfg) => tipo === 'quadrado' ? t / Math.SQRT2 : tipo === 'hexagonal' ? t / 2 / Math.cos(Math.PI / 6) : tipo === 'retangular' ? Math.hypot(cfg.comprimento, cfg.largura) / 2 : t / 2;
function fatias(loc, sinal, zMax) {
  const out = [];
  for (let k = 0; (k + 0.5) * PASSO_Z <= zMax; k++) {
    const cs = loc.slice(sinal * (k + 0.5) * PASSO_Z);
    const pol = cs.toPolygons(); cs.delete();
    out.push(pol);
  }
  return out;
}
// raio livre em cada fatia (0 = fora da peça)
function perfil(fs, x, y) {
  const R = new Float32Array(fs.length);
  for (let k = 0; k < fs.length; k++) R[k] = fs[k].length && dentro(fs[k], x, y) ? distanciaBorda(fs[k], x, y) : 0;
  return R;
}
// quantos mm de fundo cabem pra um furo de raio rho com parede w
function fundoLivre(R, rho, w) { let k = 0; while (k < R.length && R[k] >= rho + w) k++; return k * PASSO_Z; }

export function planejarConectores(ctx, { locA, locB, secao, cfg }) {
  const { CrossSection } = manifold();
  let tipo = cfg.tipo;
  const avisos = [];
  const f = cfg.folga, fundo = cfg.folgaFundo;
  const fixo = !cfg.auto || tipo === 'retangular';
  const pedido = tipo === 'quadrado' ? cfg.lado : tipo === 'retangular' ? cfg.largura : cfg.diametro;
  // tamanhos a tentar (maior primeiro); pedido fixo: ele e, se não couber, menores
  const tams = [];
  if (fixo) { tams.push(pedido); if (tipo !== 'retangular') for (let t = Math.floor((pedido - 0.5) * 2) / 2; t >= 2; t -= 0.5) tams.push(t); }
  else for (let t = 8; t >= 2; t -= 0.5) tams.push(t);
  const pDes = t => fixo ? cfg.profundidade : Math.max(3, Math.min(10, Math.round(t * 1.4)));
  const pMin = t => Math.min(pDes(t), Math.max(2, 0.8 * t));
  const zMax = Math.max(...tams.map(pDes)) + fundo + cfg.parede + 1;
  const fB = fatias(locB, -1, zMax);
  let fA = tipo === 'solto' ? fatias(locA, +1, zMax) : null;
  // raiz do pino: material da peça de cima em volta dele logo acima do corte
  const raiz = (() => { const c = locA.slice(0.25), p = c.toPolygons(); c.delete(); return p; })();
  // ilhas do corte
  const cs = ctx.guardar(CrossSection.ofPolygons(secao, 'EvenOdd'));
  const ilhas = cs.decompose().map(c => { ctx.guardar(c); return { pol: c.toPolygons(), area: c.area() }; }).filter(i => i.area > 0.5);
  const aMax = Math.max(0, ...ilhas.map(i => i.area));
  const q = Math.max(1, Math.min(12, cfg.quantidade | 0));
  const escolhidos = [];
  ilhas.sort((a, b) => b.area - a.area);
  for (const il of ilhas) {
    const n = Math.max(1, Math.min(q, Math.round(q * il.area / aMax)));
    const { x0, x1, y0, y1 } = limites(il.pol);
    const passo = Math.max(0.3, Math.min(2, Math.sqrt(il.area) / 28));
    // menor pino possível (inclui o cilíndrico Ø2 de reserva das partes pequenas)
    // (1,5: o furo do pino de filamento, o último recurso, com parede de 0,5)
    const rMin = Math.min(Math.min(circunraio(tipo, tams[tams.length - 1], cfg), 1) + f + 0.8, 1.5);
    const cand = [];
    for (let y = y0 + passo / 2; y <= y1; y += passo) for (let x = x0 + passo / 2; x <= x1; x += passo) {
      if (!dentro(il.pol, x, y)) continue;
      const R0 = distanciaBorda(il.pol, x, y);
      if (R0 < rMin) continue;
      const RR = raiz.length && dentro(raiz, x, y) ? distanciaBorda(raiz, x, y) : 0;
      cand.push({ x, y, R0: Math.min(R0, RR + 0.8), RB: perfil(fB, x, y), RA: fA ? perfil(fA, x, y) : null });
    }
    // + o centro do maior círculo que cabe na ilha (seção fina: a grade pode
    // não cair nele, e é o único lugar onde o furo cabe)
    {
      const cm = centroMaisLonge(il.pol);
      if (cm && cm.r >= rMin * 0.9 && !cand.some(c => Math.hypot(c.x - cm.x, c.y - cm.y) < 0.05)) {
        const RR = raiz.length && dentro(raiz, cm.x, cm.y) ? distanciaBorda(raiz, cm.x, cm.y) : 0;
        cand.push({ x: cm.x, y: cm.y, R0: Math.min(cm.r, RR + 0.8), RB: perfil(fB, cm.x, cm.y), RA: fA ? perfil(fA, cm.x, cm.y) : null });
      }
    }
    const eixo = eixoPrincipal(il.pol);
    // pra cada tamanho (maior primeiro) e parede (1,2 mm; se não der, 0,8):
    // quantos pinos espalhados cabem com fundo suficiente. O furo precisa de
    // fundo (folga) + CHÃO (a parede embaixo dele) — a mesma conta que o
    // gerador confere depois (senão o planejador aprova e o gerador pula).
    // minimo: profundidade mínima aceita (pino solto de peça fina usa menos)
    const tentar = (t, w, minimo = null, folga = f) => {
      const rho = circunraio(tipo, t, cfg) + folga, ok = [];
      for (const c of cand) {
        if (c.R0 < rho + w) continue;
        let p = fundoLivre(c.RB, rho, w) - fundo - w;
        if (tipo === 'solto') { if (!c.RA) c.RA = perfil(fA, c.x, c.y); p = Math.min(p, fundoLivre(c.RA, rho, w) - fundo - w); }
        p = Math.min(pDes(t), Math.floor(p * 2) / 2);
        if (p >= (minimo != null ? minimo : pMin(t))) ok.push({ ...c, p });
      }
      if (!ok.length) return [];
      // o 1º é o mais fundo (e mais longe da borda); os outros se espalham
      ok.sort((a, b2) => b2.p - a.p || b2.R0 - a.R0);
      const sel = [ok[0]], dMin = 2 * rho + Math.max(w, 1.5);
      while (sel.length < n) {
        let melhor = null, dm = -1;
        for (const c of ok) {
          if (c.p < ok[0].p * 0.7) continue;
          let d = Infinity; for (const s2 of sel) d = Math.min(d, Math.hypot(c.x - s2.x, c.y - s2.y));
          if (d >= dMin && d > dm) { dm = d; melhor = c; }
        }
        if (!melhor) break;
        sel.push(melhor);
      }
      return sel.map(c => ({ x: c.x, y: c.y, tam: t, prof: c.p, parede: w, girar: eixo.ang * 180 / Math.PI, ...(minimo != null ? { pMin: minimo } : {}) }));
    };
    // automático: com 2+ pedidos, 2 pinos menores seguram melhor que 1 grande
    // (não deixa girar); manual: fica no tamanho pedido se couber pelo menos 1
    const alvo = fixo ? 1 : Math.min(n, 2);
    let usar = null, reserva = null;
    for (const t of tams) {
      for (const w of [cfg.parede, 0.8]) {
        const sel = tentar(t, w);
        if (!sel.length) continue;
        if (!reserva || sel.length > reserva.length) reserva = sel;
        if (sel.length >= alvo) { usar = sel; break; }
      }
      if (usar) break;
    }
    usar = usar || reserva;
    // parte pequena onde o tipo escolhido não cabe (quadrado, sextavado,
    // solto): pino cilíndrico pequeno, melhor que deixar a parte solta
    if (!usar && tipo !== 'cilindrico') {
      const tipoOrig = tipo;
      tipo = 'cilindrico';
      for (let t = Math.min(4, tams[0]); t >= 2 && !usar; t -= 0.5) for (const w of [cfg.parede, 0.8]) { const sel = tentar(t, w); if (sel.length) { usar = sel.map(x => ({ ...x, tipo: 'cilindrico' })); break; } }
      tipo = tipoOrig;
      if (usar) avisos.push('Numa parte pequena do corte o ' + (TIPOS_CONECTOR.find(x => x.id === tipoOrig) || { nome: tipoOrig }).nome.toLowerCase() + ' não cabia: usei pino cilíndrico Ø' + String(usar[0].tam).replace('.', ',') + ' ali.');
    }
    // PEÇA FINA (placa cortada na espessura, parede): não cabe furo fundo de um
    // lado só — pino SOLTO, com metade da profundidade em cada lado (furo dos
    // dois lados, o pino sai impresso à parte). Melhor que cortar sem encaixe.
    if (!usar && tipo !== 'solto') {
      const tipoOrig = tipo;
      tipo = 'solto';
      if (!fA) fA = fatias(locA, +1, zMax);
      for (let t = Math.min(5, tams[0]); t >= 2 && !usar; t -= 0.5) for (const w of [cfg.parede, 0.8]) { const sel = tentar(t, w, 1); if (sel.length) { usar = sel.map(x => ({ ...x, tipo: 'solto' })); break; } }
      tipo = tipoOrig;
      if (usar) avisos.push('Peça fina no corte: o ' + (TIPOS_CONECTOR.find(x => x.id === tipoOrig) || { nome: tipoOrig }).nome.toLowerCase() + ' não tinha fundo. Usei PINO SOLTO Ø' + String(usar[0].tam).replace('.', ',') + ' mm (furo dos dois lados, ' + String(usar[0].prof).replace('.', ',') + ' mm cada): o pino sai como peça separada.');
    }
    // ÚLTIMO RECURSO (pescoço fino, orelha, dedo): pino de FILAMENTO — furo de
    // Ø2 mm dos dois lados e um pedaço do próprio filamento 1,75 mm de pino.
    // Pino impresso tão fino quebra; o filamento não.
    if (!usar) {
      const tipoOrig = tipo;
      tipo = 'solto';
      if (!fA) fA = fatias(locA, +1, zMax);
      for (const w of [0.8, 0.5]) { const sel = tentar(1.75, w, 1.5, 0.125); if (sel.length) { usar = sel.map(x => ({ ...x, tipo: 'filamento', folga: 0.125 })); break; } }
      tipo = tipoOrig;
      if (usar) avisos.push('Seção fina (~' + (2 * distanciaMax(il.pol)).toFixed(1).replace('.', ',') + ' mm): não cabe pino impresso. Fiz furo de Ø2 mm dos dois lados pra um PINO DE FILAMENTO: corte ' + usar.length + ' pedaço(s) de filamento 1,75 mm com ' + String((2 * usar[0].prof - 0.4).toFixed(1)).replace('.', ',') + ' mm e encaixe.');
    }
    if (usar) {
      escolhidos.push(...usar);
      if (fixo && usar[0].tam !== pedido) avisos.push('O conector ' + medidaTexto({ ...cfg, diametro: pedido, lado: pedido }) + ' não cabia aqui: usei ' + medidaTexto({ ...cfg, diametro: usar[0].tam, lado: usar[0].tam }) + '.');
      if (usar.length < n) avisos.push('Couberam ' + usar.length + ' de ' + n + ' conectores nesta parte do corte sem encostar um no outro.');
    } else {
      const larg = 2 * distanciaMax(il.pol);
      // largura dá, mas não tem espessura (dos dois lados) pro furo
      const melhor = cand.reduce((a, c) => (!a || c.R0 > a.R0 ? c : a), null);
      const espB = melhor ? fundoLivre(melhor.RB, 0.01, 0) : 0;
      if (melhor && larg >= 2 * (1 + f + 0.8)) {
        avisos.push('Aqui a peça tem só ~' + espB.toFixed(1).replace('.', ',') + ' mm de espessura de cada lado do corte: o furo precisa de pelo menos ~' + (1 + fundo + 0.8).toFixed(1).replace('.', ',') + ' mm (fundo + chão). Saiu sem encaixe — cole as partes, ou corte num lugar mais grosso.');
        continue;
      }
      avisos.push(ilhas.length > 1
        ? 'Uma parte do corte com ~' + larg.toFixed(1).replace('.', ',') + ' mm de largura (área ' + il.area.toFixed(0) + ' mm²) não comporta pino com parede: fica sem encaixe — cole essa parte.'
        : 'A seção do corte tem só ~' + larg.toFixed(1).replace('.', ',') + ' mm de largura: não cabe pino com parede (precisa de uns ' + (2 * (1 + f + 0.8)).toFixed(1).replace('.', ',') + ' mm). Saiu sem encaixe — cole as partes, ou deixe a parede mais grossa aí.');
    }
  }
  return { conectores: escolhidos, avisos, ilhas: ilhas.length };
}
// maior distância à borda na ilha (pra explicar quando não cabe nada)
function limites(pol) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const a of pol) for (const p of a) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { x0, x1, y0, y1 };
}
// centro do maior círculo inscrito: grade + busca local fina
function centroMaisLonge(pol) {
  const { x0, x1, y0, y1 } = limites(pol);
  let s = Math.max(x1 - x0, y1 - y0) / 24 || 0.1, best = null;
  for (let y = y0 + s / 2; y <= y1; y += s) for (let x = x0 + s / 2; x <= x1; x += s) if (dentro(pol, x, y)) { const r = distanciaBorda(pol, x, y); if (!best || r > best.r) best = { x, y, r }; }
  if (!best) return null;
  for (let it = 0; it < 40 && s > 0.005; it++) {
    let melhorou = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = best.x + dx * s, y = best.y + dy * s;
      if (!dentro(pol, x, y)) continue;
      const r = distanciaBorda(pol, x, y);
      if (r > best.r) { best = { x, y, r }; melhorou = true; }
    }
    if (!melhorou) s /= 2;
  }
  return best;
}
function distanciaMax(pol) {
  let m = 0;
  const { x0, x1, y0, y1 } = limites(pol);
  const s = Math.max((x1 - x0), (y1 - y0)) / 40 || 0.1;
  for (let y = y0; y <= y1; y += s) for (let x = x0; x <= x1; x += s) if (dentro(pol, x, y)) m = Math.max(m, distanciaBorda(pol, x, y));
  return m;
}

// Gera pino (A) e furo (B). solidoA/solidoB: Manifold de cada lado (mundo
// da peça). Devolve Manifolds em coordenadas da peça + relatório.
export function gerarConectores(ctx, { solidoA, solidoB, frame, secao, cfg }) {
  const { Manifold } = manifold();
  cfg = Object.assign({}, PADRAO_CONECTOR, cfg || {});
  const inv = M4.inverter(frame);
  const locA = ctx.guardar(solidoA.transform(Array.from(inv)));
  const locB = ctx.guardar(solidoB.transform(Array.from(inv)));
  const positivos = [], negativosA = [], negativosB = [], soltos = [];
  const relatorio = [];

  if (cfg.tipo === 'lingueta' || cfg.tipo === 'andorinha') {
    const t = gerarTrilho(ctx, { frame, secao, cfg, locA, locB });
    if (t.relatorio.length) return t;
    // trilho não coube (parte curta/fina): pino no lugar, em vez de sair sem encaixe
    const r2 = gerarConectores(ctx, { solidoA, solidoB, frame, secao, cfg: { ...cfg, tipo: 'cilindrico', auto: true } });
    if (r2.relatorio.length) r2.avisos.unshift((cfg.tipo === 'lingueta' ? 'A lingueta' : 'O rabo de andorinha') + ' não coube aqui: usei pino no lugar.');
    else r2.avisos.unshift(...t.avisos);
    return r2;
  }
  const plano = planejarConectores(ctx, { locA, locB, secao, cfg });
  const genA = locA.genus(), genB = locB.genus();
  const avisos = plano.avisos;
  // o pino entra 0,2 mm na peça de cima (lasca de 0,02 mm dava geometria
  // quase degenerada na união); o planejador garante material ali
  const ov = 0.2;
  for (const c of plano.conectores) {
    const tipoC = c.tipo || cfg.tipo;
    const doisLados = tipoC === 'solto' || tipoC === 'filamento';
    const fol = c.folga != null ? c.folga : cfg.folga;
    const k = { ...cfg, tipo: tipoC === 'filamento' ? 'solto' : tipoC, diametro: c.tam, lado: c.tam, parede: c.parede, folga: fol };
    if (cfg.tipo === 'retangular') { k.largura = cfg.largura; k.comprimento = cfg.comprimento; }
    const forma = formaConector(k); ctx.guardar(forma.cs);
    const csFuro = ctx.guardar(forma.cs.offset(fol, forma.juncao, 4, segmentos(forma.raio + fol)));
    const girar = forma.simetrica ? 0 : c.girar;
    let prof = c.prof;
    // conferência EXATA (entre as fatias pode ter detalhe): furo + ~2/3 da
    // parede tem que ficar inteiro dentro da peça de baixo
    // raio do furo: com a folga (no quadrado/sextavado o canto cresce mais)
    const rFuro = forma.simetrica ? forma.raio + fol : forma.raio + fol / Math.cos(tipoC === 'hexagonal' ? Math.PI / 6 : Math.PI / 4);
    const conferir = (loc, sinal, p) => {
      const rr = rFuro + c.parede, h = p + cfg.folgaFundo + c.parede;
      const cil = Manifold.cylinder(h, rr, rr, 32).translate([c.x, c.y, sinal < 0 ? -h : 0]);
      const fora = cil.subtract(loc), v = fora.volume();
      cil.delete(); fora.delete();
      return v < 0.004 * Math.PI * rr * rr * h;      // tolera só o facetado da malha
    };
    const pm = c.pMin || 2;
    while (prof >= pm && !(conferir(locB, -1, prof) && (!doisLados || conferir(locA, +1, prof)))) prof -= 0.5;
    // trava exata: o furo não pode abrir túnel na peça (gênero sobe)
    const abreTunel = (loc, sinal, p) => { const h = p + cfg.folgaFundo, cil = Manifold.cylinder(h + 0.5, rFuro, rFuro, 32).translate([c.x, c.y, sinal < 0 ? -h : -0.5]), t = loc.subtract(cil), g = t.genus(); cil.delete(); t.delete(); return g > (sinal < 0 ? genB : genA); };
    while (prof >= pm && (abreTunel(locB, -1, prof) || (doisLados && abreTunel(locA, +1, prof)))) prof -= 0.5;
    if (prof < pm) { avisos.push('Sem espessura pra conector em (' + c.x.toFixed(1) + '; ' + c.y.toFixed(1) + ') — pulado.'); continue; }
    const T = Array.from(M4.multiplicar(frame, M4.multiplicar(M4.translacao(c.x, c.y, 0), M4.rotacaoEuler(0, 0, girar))));
    if (tipoC === 'filamento') {
      // só os furos: o pino é um pedaço do filamento
      const fB = prisma(csFuro, -(prof + cfg.folgaFundo), ov, 0, 1), fA = prisma(csFuro, -ov, prof + cfg.folgaFundo, 0, 1);
      negativosB.push(ctx.guardar(fB.transform(T))); fB.delete();
      negativosA.push(ctx.guardar(fA.transform(T))); fA.delete();
      const comp = +(2 * prof - 0.4).toFixed(1);
      relatorio.push({ x: c.x, y: c.y, profundidade: prof, tipo: 'filamento', filamento: true, pino: 'filamento 1,75 mm × ' + String(comp).replace('.', ',') + ' mm', furo: 'Ø ' + (1.75 + 2 * fol).toFixed(2).replace('.', ',') + ' mm', comprimentoPino: comp });
    } else if (tipoC === 'solto') {
      const fB = prisma(csFuro, -(prof + cfg.folgaFundo), ov, 0, 1), fA = prisma(csFuro, -ov, prof + cfg.folgaFundo, 0, 1);
      negativosB.push(ctx.guardar(fB.transform(T))); fB.delete();
      negativosA.push(ctx.guardar(fA.transform(T))); fA.delete();
      const comp = 2 * prof - 0.2;
      soltos.push({ man: ctx.guardar(prisma(forma.cs, 0, comp, cfg.chanfro, forma.meiaLargura)), comprimento: comp });
      relatorio.push({ x: c.x, y: c.y, profundidade: prof, pino: medidaTexto(k), furo: medidaTexto(k, cfg.folga), comprimentoPino: comp });
    } else {
      const pino = prisma(forma.cs, -prof, ov, cfg.chanfro, forma.meiaLargura);
      const furo = prisma(csFuro, -(prof + cfg.folgaFundo), 0.5, 0, 1);
      positivos.push(ctx.guardar(pino.transform(T))); pino.delete();
      negativosB.push(ctx.guardar(furo.transform(T))); furo.delete();
      relatorio.push({ x: c.x, y: c.y, profundidade: prof, pino: medidaTexto(k), furo: medidaTexto(k, cfg.folga), fundoFuro: prof + cfg.folgaFundo });
    }
    if (prof < c.prof) avisos.push('Conector em (' + c.x.toFixed(1) + '; ' + c.y.toFixed(1) + ') ficou com ' + prof.toFixed(1) + ' mm de profundidade (a peça afina ali).');
  }
  if (!relatorio.length && plano.conectores.length) avisos.push('Nenhum conector coube com parede em volta — saiu sem encaixe.');
  if (!cfg.auto && relatorio.length && cfg.tipo !== 'retangular' && relatorio.some(r => r.profundidade < cfg.profundidade - 1e-6) && !avisos.some(a => /profundidade/.test(a))) avisos.push('Faltou material pros ' + cfg.profundidade + ' mm de profundidade pedidos em algum conector.');
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

// Lingueta (ranhura fechada) e rabo de andorinha (trilho aberto nas pontas),
// uma por ILHA do corte, ao longo do eixo principal dela.
// LINGUETA segue a forma da peça de baixo em camadas de 0,5 mm: cada camada é
// recortada pela fatia da peça (acumulada: a de baixo nunca é maior que a de
// cima, então o pino desce sem travar) menos a parede — nunca vaza pro lado.
// RABO DE ANDORINHA desliza de lado, então o perfil é constante: a
// profundidade diminui até o canal caber inteiro na peça.
function gerarTrilho(ctx, { frame, secao, cfg, locA, locB }) {
  const { Manifold, CrossSection } = manifold();
  const andorinha = cfg.tipo === 'andorinha';
  const w = cfg.largura, f = cfg.folga, fundo = cfg.folgaFundo, parede = cfg.parede;
  const avisos = [], positivos = [], negativosB = [], relatorio = [];
  const cs0 = ctx.guardar(CrossSection.ofPolygons(secao, 'EvenOdd'));
  const ilhas = cs0.decompose().map(c => ctx.guardar(c)).filter(c => c.area() > 4).sort((a, b) => b.area() - a.area());
  const F = Array.from(frame);
  const PZ = 0.5, nNiveis = Math.ceil((cfg.profundidade + fundo) / PZ), nParede = Math.ceil(parede / PZ);
  // fatias acumuladas da peça de baixo, na BASE de cada camada (numa
  // superfície quase deitada a parede recua muito dentro de meia camada) e
  // indo além do fundo pela parede: acum[i] = ∩ fatias de 0 até −i·0,5 mm
  const acum = [];
  if (locB) { let at = null; for (let i = 0; i <= nNiveis + nParede; i++) { const sl = ctx.guardar(locB.slice(-Math.max(1e-3, i * PZ))); at = at ? ctx.guardar(at.intersect(sl)) : sl; acum.push(at); } }
  const generoB = locB ? locB.genus() : 0;
  const raizA = locA ? ctx.guardar(locA.slice(0.25)) : null;
  for (const ilha of ilhas) {
    const pol = ilha.toPolygons(), eixo = eixoPrincipal(pol);
    const R = M4.multiplicar(M4.translacao(eixo.cx, eixo.cy, 0), M4.rotacaoEuler(0, 0, eixo.ang * 180 / Math.PI)), Ri = M4.inverter(R);
    let x0 = Infinity, x1 = -Infinity;
    for (const a of pol) for (const p of a) { const q = M4.aplicarPonto(Ri, p[0], p[1], 0); if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; }
    const L = x1 - x0, comp = andorinha ? L + 20 : L - 2 * (parede + 1);
    if (L < 6 || comp < 4) { avisos.push('Parte do corte curta demais pra ' + (andorinha ? 'rabo de andorinha' : 'lingueta') + ' (~' + L.toFixed(0) + ' mm): fica sem encaixe — cole essa parte.'); continue; }
    const noPlano = Array.from(M4.multiplicar(R, M4.translacao((x0 + x1) / 2, 0, 0)));
    // retângulo comprido no plano (comprimento c × largura l), já no lugar
    const tira = (c, l) => { const r = CrossSection.square([c, l], true), t = r.transform(noPlanoMat2(noPlano)); r.delete(); return ctx.guardar(t); };
    if (!andorinha) {
      // perfil = o da camada mais funda (as fatias acumuladas só encolhem):
      // prisma reto, desce sem travar; o furo é esse perfil + folga e, por
      // construção, tem parede em toda a profundidade e embaixo
      const tP = tira(comp, w);
      const nFundo = Math.ceil(fundo / PZ);
      const perfilEm = k => {
        const base = acum.length ? acum[Math.min(acum.length - 1, k + nFundo + nParede)] : ilha;
        let sh = ctx.guardar(ctx.guardar(ctx.guardar(base.offset(-parede - f, 'Round')).intersect(ilha)).intersect(tP));
        if (raizA) sh = ctx.guardar(sh.intersect(raizA));
        return sh;
      };
      const topo = perfilEm(1), area0 = topo.area();
      if (area0 < w * 2) { avisos.push('Parte do corte estreita demais pra lingueta: fica sem encaixe — cole essa parte.'); continue; }
      let prof = 0, perfil = null;
      for (let k = 1; k * PZ <= cfg.profundidade + 1e-9; k++) {
        const sh = perfilEm(k);
        if (sh.area() < area0 * 0.5) break;                 // a peça afinou: a lingueta para aqui
        prof = k * PZ; perfil = sh;
      }
      if (prof < 2 || !perfil) { avisos.push('Sem espessura pra lingueta nesta parte do corte: fica sem encaixe — cole essa parte.'); continue; }
      const pino = ctx.guardar(Manifold.extrude(perfil, prof + 0.2).translate([0, 0, -prof]));
      const furo = ctx.guardar(Manifold.extrude(ctx.guardar(perfil.offset(f, 'Round')), prof + fundo + 0.5).translate([0, 0, -(prof + fundo)]));
      // trava exata: o furo não pode abrir túnel (gênero da peça de baixo sobe)
      if (locB) { const t = locB.subtract(furo), g = t.genus(); t.delete(); if (g > generoB) { avisos.push('A lingueta furaria a parede nesta parte do corte: fica sem encaixe — cole essa parte.'); continue; } }
      positivos.push(ctx.guardar(pino.transform(F)));
      negativosB.push(ctx.guardar(furo.transform(F)));
      relatorio.push({ tipo: cfg.tipo, comprimento: comp, largura: w, profundidade: prof, folga: f, x: eixo.cx, y: eixo.cy });
      if (prof < cfg.profundidade) avisos.push('Lingueta com ' + prof.toFixed(1).replace('.', ',') + ' mm de profundidade nesta parte (a peça afina embaixo).');
    } else {
      // perfil constante; o canal atravessa a peça de ponta a ponta (desliza)
      const P = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];
      const barra = (pts, c) => { const csP = CrossSection.ofPolygons([pts], 'EvenOdd'), e = Manifold.extrude(csP, c).translate([0, 0, -c / 2]); csP.delete(); const g = e.transform(P); e.delete(); const r = g.transform(noPlano); g.delete(); return ctx.guardar(r); };
      const coluna = ctx.guardar(Manifold.extrude(ilha, cfg.profundidade + fundo + 2).translate([0, 0, -(cfg.profundidade + fundo + 2)]));
      let ok = null;
      for (let prof = cfg.profundidade; prof >= 2; prof -= 0.5) {
        const a = w / 2, b = w / 2 + prof * Math.tan(15 * Math.PI / 180);
        const perfil = [[-a, 0.2], [a, 0.2], [b, -prof], [-b, -prof]];
        const perfilFuro = [[-(a + f), 0.5], [a + f, 0.5], [b + f, -(prof + fundo)], [-(b + f), -(prof + fundo)]];
        const pino = ctx.guardar(barra(perfil, comp).intersect(ctx.guardar(Manifold.extrude(ilha, prof + 1).translate([0, 0, -(prof + 0.5)]))));
        const furo = barra(perfilFuro, comp + 10);
        // o canal (com parede) não pode sair pela lateral da peça de baixo
        if (locB) {
          const perfilP = [[-(a + f + parede), 0], [a + f + parede, 0], [b + f + parede, -(prof + fundo + parede)], [-(b + f + parede), -(prof + fundo + parede)]];
          const casca = ctx.guardar(barra(perfilP, comp + 10).intersect(coluna));
          const fora = casca.subtract(locB), v = fora.volume(); fora.delete();
          if (v > 0.5) continue;
          const t = locB.subtract(furo), g = t.genus(); t.delete();
          if (g > generoB) continue;
        }
        ok = { pino, furo, prof }; break;
      }
      if (!ok) { avisos.push('Sem espessura pra rabo de andorinha nesta parte do corte: fica sem encaixe — cole essa parte.'); continue; }
      positivos.push(ctx.guardar(ok.pino.transform(F)));
      negativosB.push(ctx.guardar(ok.furo.transform(F)));
      relatorio.push({ tipo: cfg.tipo, comprimento: L, largura: w, profundidade: ok.prof, folga: f, x: eixo.cx, y: eixo.cy });
      if (ok.prof < cfg.profundidade) avisos.push('Rabo de andorinha com ' + ok.prof.toFixed(1).replace('.', ',') + ' mm de profundidade nesta parte (faltou parede pros ' + cfg.profundidade + ' mm).');
    }
  }
  return { positivos, negativosA: [], negativosB, soltos: [], relatorio, avisos };
}
// matriz 4x4 (coluna) de um referencial no plano -> 3x3 (coluna) do CrossSection.transform
function noPlanoMat2(M) { return [M[0], M[1], 0, M[4], M[5], 0, M[12], M[13], 1]; }

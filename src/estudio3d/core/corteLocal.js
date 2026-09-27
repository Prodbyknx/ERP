// Corte LOCAL e "separar parte" (mão, cabeça, braço, chifre…).
//
// O plano infinito do corte comum atravessa tudo que estiver na altura (cortar
// o pulso cortaria o quadril junto). Aqui o plano divide a peça, mas SÓ o
// pedaço ligado ao ponto clicado sai; o resto volta a ser um sólido só.
// As duas faces do corte são planas e idênticas -> dá pra pôr encaixe.
//
// acharPescoco: a partir do clique, varre planos em direção ao corpo seguindo
// a seção do membro e acha a parte mais estreita (pulso, pescoço, base do
// chifre); depois inclina o plano até a seção ficar mínima (perpendicular ao
// membro).
import { comContexto, manifold } from './solidos.js';
import { solidoPronto } from './preparo.js';
import { gerarConectores, dimensionarConector } from './conectores.js';
import { dentro, distanciaBorda } from './geo2d.js';
import { normalizarPlano } from './corte.js';
import { caixa, transladar } from './malha.js';
import * as M4 from './mat4.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

// Fatiador direto da malha (sem refazer o sólido a cada plano): contornos
// da seção no referencial F (plano z=0 de F), em 2D.
function fatiador(m) {
  const P = m.pos, I = m.idx, nv = P.length / 3;
  const d = new Float64Array(nv), X = new Float64Array(nv), Y = new Float64Array(nv);
  return F => {
    const G = M4.inverter(F);
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      let s = G[2] * x + G[6] * y + G[10] * z + G[14];
      if (s === 0) s = 1e-12;
      d[v] = s; X[v] = G[0] * x + G[4] * y + G[8] * z + G[12]; Y[v] = G[1] * x + G[5] * y + G[9] * z + G[13];
    }
    const pts = new Map(), viz = new Map();
    const ponto = (a, b) => {
      const k = a < b ? a * nv + b : b * nv + a;
      if (!pts.has(k)) { const t = d[a] / (d[a] - d[b]); pts.set(k, [X[a] + t * (X[b] - X[a]), Y[a] + t * (Y[b] - Y[a])]); }
      return k;
    };
    const ligar = (k1, k2) => { (viz.get(k1) || viz.set(k1, []).get(k1)).push(k2); (viz.get(k2) || viz.set(k2, []).get(k2)).push(k1); };
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const sa = d[a] > 0, sb = d[b] > 0, sc = d[c] > 0;
      if (sa === sb && sb === sc) continue;
      const ks = [];
      if (sa !== sb) ks.push(ponto(a, b));
      if (sb !== sc) ks.push(ponto(b, c));
      if (sc !== sa) ks.push(ponto(c, a));
      if (ks.length === 2) ligar(ks[0], ks[1]);
    }
    const usado = new Set(), lacos = [];
    for (const k0 of viz.keys()) {
      if (usado.has(k0)) continue;
      const laco = [];
      let ant = -1, k = k0;
      while (k !== undefined && !usado.has(k)) {
        usado.add(k); laco.push(pts.get(k));
        const vs = viz.get(k);
        const prox = vs[0] !== ant ? vs[0] : vs[1];
        ant = k; k = prox;
      }
      if (laco.length >= 3) lacos.push(laco);
    }
    return lacos;
  };
}

// pedaços (partes conexas com furos) da seção no plano F deslocado z
function pedacos(ctx, fat, F, z) {
  const { CrossSection } = manifold();
  const lacos = fat(z ? M4.multiplicar(F, M4.translacao(0, 0, z)) : F);
  if (!lacos.length) return [];
  const cs = ctx.guardar(CrossSection.ofPolygons(lacos, 'EvenOdd'));
  const out = [];
  for (const p of cs.decompose()) {
    const pol = p.toPolygons(), area = p.area();
    let cx = 0, cy = 0, A = 0;
    for (const r of pol) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const c = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      A += c; cx += (r[j][0] + r[i][0]) * c; cy += (r[j][1] + r[i][1]) * c;
    }
    out.push({ pol, area, c: Math.abs(A) > 1e-12 ? [cx / (3 * A), cy / (3 * A)] : r0(pol) });
    p.delete();
  }
  return out;
}
const r0 = pol => pol[0] && pol[0][0] ? [pol[0][0][0], pol[0][0][1]] : [0, 0];
// o pedaço que contém (ou está mais perto de) um ponto 2D
function pedacoDe(ps, x, y) {
  let melhor = null, dm = Infinity;
  for (const p of ps) {
    const d = dentro(p.pol, x, y) ? 0 : distanciaBorda(p.pol, x, y);
    if (d < dm) { dm = d; melhor = p; }
  }
  return melhor ? { ...melhor, dist: dm } : null;
}

function verticesDe(man) {
  const m = man.getMesh(), np = m.numProp, v = m.vertProperties, n = v.length / np;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = v[i * np]; out[i * 3 + 1] = v[i * np + 1]; out[i * 3 + 2] = v[i * np + 2]; }
  return { pos: out, idx: m.triVerts };
}

// centro de massa (tetraedros com a origem)
function centroMassa(m) {
  const p = m.pos, I = m.idx;
  let V = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const v = (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    V += v; cx += v * (p[a] + p[b] + p[c]) / 4; cy += v * (p[a + 1] + p[b + 1] + p[c + 1]) / 4; cz += v * (p[a + 2] + p[b + 2] + p[c + 2]) / 4;
  }
  return V ? [cx / V, cy / V, cz / V] : [0, 0, 0];
}

// eixo principal dos vértices perto do ponto (direção do membro)
function eixoLocal(m, p, R) {
  const P = m.pos, pts = [];
  for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i] - p[0], P[i + 1] - p[1], P[i + 2] - p[2]) < R) pts.push(i);
  if (pts.length < 8) return null;
  let mx = 0, my = 0, mz = 0;
  for (const i of pts) { mx += P[i]; my += P[i + 1]; mz += P[i + 2]; }
  mx /= pts.length; my /= pts.length; mz /= pts.length;
  const C = [0, 0, 0, 0, 0, 0];
  for (const i of pts) { const x = P[i] - mx, y = P[i + 1] - my, z = P[i + 2] - mz; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
  // potência: autovetor dominante
  let v = [1, 0.3, 0.2];
  for (let k = 0; k < 60; k++) v = unit([C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[1] * v[0] + C[3] * v[1] + C[4] * v[2], C[2] * v[0] + C[4] * v[1] + C[5] * v[2]]);
  return v;
}

// seção do membro no plano (origem o, normal n): área do pedaço que contém o
function secaoEm(ctx, fat, o, n) {
  const F = M4.doPlano(o, n);
  const p = pedacoDe(pedacos(ctx, fat, F, 0), 0, 0);
  return p && p.dist === 0 ? { area: p.area, c: M4.aplicarPonto(F, p.c[0], p.c[1], 0), pol: p.pol, F } : null;
}

function varrer(ctx, fat, p, u, passo, zMax) {
  const F = M4.doPlano(p, u);
  const serie = [];
  let ref = [0, 0], antes = 0;
  for (let z = passo * 0.5; z <= zMax; z += passo) {
    const ps = pedacos(ctx, fat, F, z);
    if (!ps.length) break;
    const q = pedacoDe(ps, ref[0], ref[1]);
    // segue SÓ o pedaço do membro: se o ponto de referência saiu dele, acabou
    const tol = serie.length ? 0.25 * Math.sqrt(antes) : 2 * passo;
    if (!q || q.dist > tol) break;
    // juntou com algo bem maior (chegou no corpo) ou se dividiu em galhos: para
    if (antes > 0 && serie.length > 2 && (q.area > 2.2 * antes || q.area < antes / 2.5)) break;
    serie.push({ z, area: q.area, c: q.c });
    ref = q.c; antes = q.area;
  }
  if (serie.length < 3) return null;
  // 1º estreitamento claro: menor que a parte (antes) e que o que vem depois
  const A = serie.map(x => x.area);
  let k = -1, claro = true;
  for (let i = 1; i < A.length - 1 && k < 0; i++) {
    if (!(A[i] <= A[i - 1] && A[i] <= A[i + 1])) continue;
    const antesMax = Math.max(...A.slice(0, i)), depoisMax = Math.max(...A.slice(i + 1));
    if (A[i] < 0.92 * antesMax && A[i] < 0.85 * depoisMax) k = i;
  }
  if (k < 0) {
    // sem estreitamento claro: o menor depois da subida inicial
    claro = false;
    let im = 0;
    while (im + 1 < A.length && A[im + 1] >= A[im] * 0.98) im++;
    k = im;
    for (let i = im; i < A.length; i++) if (A[i] < A[k]) k = i;
  }
  const s = serie[k];
  return { centro: M4.aplicarPonto(F, s.c[0], s.c[1], s.z), n: u, area: s.area, claro, largura: Math.max(...A.slice(0, k + 1)) };
}

// inclina o plano em volta do centro até a seção do membro ficar mínima
function afinar(ctx, fat, o, n0) {
  let best = secaoEm(ctx, fat, o, n0), n = n0;
  if (!best) return null;
  const F = M4.doPlano(o, n0), ex = M4.aplicarDirecao(F, 1, 0, 0), ey = M4.aplicarDirecao(F, 0, 1, 0);
  let a = 0, b = 0;
  for (const passo of [16, 8, 4, 2]) {
    let melhorou = true, voltas = 0;
    while (melhorou && voltas++ < 6) {
      melhorou = false;
      for (const [da, db] of [[passo, 0], [-passo, 0], [0, passo], [0, -passo]]) {
        const A = (a + da) * Math.PI / 180, B = (b + db) * Math.PI / 180;
        if (Math.abs(a + da) > 40 || Math.abs(b + db) > 40) continue;
        const nn = unit([n0[0] + Math.tan(A) * ex[0] + Math.tan(B) * ey[0], n0[1] + Math.tan(A) * ex[1] + Math.tan(B) * ey[1], n0[2] + Math.tan(A) * ex[2] + Math.tan(B) * ey[2]]);
        const s = secaoEm(ctx, fat, best.c, nn);
        if (s && s.area < best.area * 0.995) { best = s; n = nn; a += da; b += db; melhorou = true; }
      }
    }
  }
  return { centro: best.c, n, area: best.area, pol: best.pol };
}

// Sugestão de corte pra separar a parte clicada. p: ponto na superfície (referencial da peça)
export function acharPescoco(ctx, M, p) {
  const m = verticesDe(M), fat = fatiador(m);
  const b = M.boundingBox(), D = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const C = centroMassa(m);
  const paraC = unit([C[0] - p[0], C[1] - p[1], C[2] - p[2]]);
  const cands = [paraC];
  for (const R of [0.06 * D, 0.12 * D]) {
    let e = eixoLocal(m, p, R);
    if (!e) continue;
    if (dot(e, paraC) < 0) e = [-e[0], -e[1], -e[2]];
    if (cands.every(c => dot(c, e) < 0.97)) cands.push(e);
  }
  const passo = Math.max(0.2, D / 160);
  const res = [];
  for (const u of cands) {
    const zMax = Math.min(D, Math.max(dot([C[0] - p[0], C[1] - p[1], C[2] - p[2]], u) + 0.08 * D, 0.2 * D));
    const v = varrer(ctx, fat, p, u, passo, zMax);
    if (!v) continue;
    const f = afinar(ctx, fat, v.centro, v.n);
    if (f) res.push({ ...f, claro: v.claro, largura: v.largura });
  }
  // estreitamento claro primeiro, depois o mais fino; e a parte que sai tem
  // que ser a MENOR (clicou na mão: sai a mão, não o boneco)
  res.sort((a, b) => (b.claro - a.claro) || (a.area - b.area));
  const vt = M.volume();
  for (const r of res) {
    let n = r.n;
    if (dot(n, p) - dot(n, r.centro) < 0) n = [-n[0], -n[1], -n[2]];
    const d = dot(n, r.centro);
    const [a, b] = M.splitByPlane(n, d); b.delete();
    const comps = a.decompose(); a.delete();
    const k = componentePerto(comps, p), v = k >= 0 ? comps[k].volume() : 0;
    for (const c of comps) c.delete();
    if (v > 0 && v < 0.5 * vt) return { plano: { n, d }, centro: r.centro, area: r.area, raio: Math.sqrt(r.area / Math.PI), claro: r.claro };
  }
  throw new Error('Não achei onde separar essa parte. Use o corte com plano e ajuste a posição.');
}

function raioInscrito(pol) {
  const { CrossSection } = manifold();
  const cs = CrossSection.ofPolygons(pol, 'EvenOdd');
  let lo = 0, hi = Math.sqrt(Math.max(cs.area(), 0) / Math.PI) * 1.5 + 1;
  for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2, o = cs.offset(-m, 'Round', 2, 24), ok = !o.isEmpty(); o.delete(); if (ok) lo = m; else hi = m; }
  cs.delete();
  return lo;
}

// componente (de um Manifold decomposto) mais perto do ponto
function componentePerto(comps, p) {
  let k = -1, dm = Infinity;
  comps.forEach((c, i) => {
    const b = c.boundingBox();
    const fora = Math.hypot(Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]), Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]), Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]));
    if (fora > dm) return;
    const v = verticesDe(c).pos;
    let d = Infinity;
    for (let j = 0; j < v.length; j += 3) { const e = Math.hypot(v[j] - p[0], v[j + 1] - p[1], v[j + 2] - p[2]); if (e < d) d = e; }
    if (d < dm) { dm = d; k = i; }
  });
  return k;
}

function regiaoDaParte(ctx, det, outros, nn, dd) {
  const { Manifold } = manifold();
  const b = det.boundingBox();
  const tam = [0, 1, 2].map(i => b.max[i] - b.min[i]), m = 0.3 + 0.02 * Math.max(...tam);
  const toca = R => outros.some(o => {
    const q = o.boundingBox();
    const r = R.boundingBox();
    if ([0, 1, 2].some(i => q.min[i] > r.max[i] || q.max[i] < r.min[i])) return false;
    const x = o.intersect(R), v = x.volume(); x.delete();
    return v > 1e-6;
  });
  const caixaR = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.cube(tam.map(t => t + 2 * m))).translate(b.min.map(v => v - m))).trimByPlane(nn, dd));
  if (!toca(caixaR)) return caixaR;
  // casco convexo da parte, um pouco maior
  const c = [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2), e = 1 + m / Math.max(1e-6, Math.max(...tam) / 2);
  const casco = ctx.guardar(ctx.guardar(ctx.guardar(ctx.guardar(ctx.guardar(Manifold.hull([det])).translate(c.map(v => -v))).scale([e, e, e])).translate(c)).trimByPlane(nn, dd));
  return toca(casco) ? null : casco;
}

// Núcleo: divide U no plano e solta SÓ o componente ligado ao ponto, com
// encaixe opcional. Tudo em Manifold (sólidos fechados por construção).
export function separarNoPlano(ctx, U, plano0, ponto, opc = {}, avisos = []) {
  const { Manifold } = manifold();
  const plano = normalizarPlano(plano0);
  const lado = dot(plano.n, ponto) - plano.d >= 0 ? 1 : -1;
  const [pos, neg] = U.splitByPlane(plano.n, plano.d);
  ctx.guardar(pos); ctx.guardar(neg);
  const S = lado > 0 ? pos : neg, O = lado > 0 ? neg : pos;
  if (S.isEmpty() || O.isEmpty()) throw new Error('O plano não passa pela peça nesse ponto.');
  const comps = S.decompose().map(c => ctx.guardar(c));
  const k = componentePerto(comps, ponto);
  const outros = comps.filter((_, i) => i !== k);
  // referencial do corte com +Z pro lado da parte que sai
  const nn = lado > 0 ? plano.n : plano.n.map(x => -x), dd = lado > 0 ? plano.d : -plano.d;
  let det = comps[k], resto = O;
  if (outros.length) {
    // região que pega SÓ a parte: caixa (ou casco) em volta dela, do lado do
    // corte. Parte = peça ∩ região; resto = peça − região. Nada de juntar
    // pedaços pela face do corte (faces coincidentes deixam lasca).
    const regiao = regiaoDaParte(ctx, det, outros, nn, dd);
    if (regiao) { det = ctx.guardar(U.intersect(regiao)); resto = ctx.guardar(U.subtract(regiao)); }
    else { resto = ctx.guardar(Manifold.union([O, ...outros])); avisos.push('A parte encosta em outra do mesmo lado do corte; conferi a junção.'); }
  }
  if (resto.isEmpty()) throw new Error('O corte levaria a peça inteira.');
  const frame = M4.doPlano([nn[0] * dd, nn[1] * dd, nn[2] * dd], nn);
  const inv = Array.from(M4.inverter(frame));
  const secDet = ctx.guardar(ctx.guardar(det.transform(inv)).slice(1e-3));
  const secao = secDet.toPolygons(), areaSecao = secDet.area();
  let relatorio = [];
  const soltos = [];
  const cfg0 = opc.conector && opc.conector.tipo && opc.conector.tipo !== 'nenhum' ? opc.conector : null;
  if (cfg0 && secao.length) {
    const pinoNoResto = cfg0.ladoPino === 'B';
    const fr = pinoNoResto ? M4.multiplicar(frame, M4.rotacaoEuler(180, 0, 0)) : frame;
    const sec = pinoNoResto ? secao.map(a => a.map(q => [q[0], -q[1]])) : secao;
    const cfg = dimensionarConector(sec, cfg0, avisos);
    const g = gerarConectores(ctx, { solidoA: pinoNoResto ? resto : det, solidoB: pinoNoResto ? det : resto, frame: fr, secao: sec, cfg });
    avisos.push(...g.avisos);
    relatorio = g.relatorio;
    let a = pinoNoResto ? resto : det, bb = pinoNoResto ? det : resto;
    if (g.positivos.length) a = ctx.guardar(a.add(g.positivos.length === 1 ? g.positivos[0] : ctx.guardar(Manifold.union(g.positivos))));
    if (g.negativosB.length) bb = ctx.guardar(bb.subtract(g.negativosB.length === 1 ? g.negativosB[0] : ctx.guardar(Manifold.union(g.negativosB))));
    if (g.negativosA.length) a = ctx.guardar(a.subtract(g.negativosA.length === 1 ? g.negativosA[0] : ctx.guardar(Manifold.union(g.negativosA))));
    if (pinoNoResto) { resto = a; det = bb; } else { det = a; resto = bb; }
    soltos.push(...g.soltos);
    if (!relatorio.length) {
      for (let i = avisos.length - 1; i >= 0; i--) if (/estreito demais|pulado/.test(avisos[i])) avisos.splice(i, 1);
      if (!avisos.some(a => /não cabe pino/.test(a))) avisos.push('O encaixe não coube nessa seção (≈' + Math.sqrt(areaSecao / Math.PI * 4).toFixed(1) + ' mm). Separei sem encaixe; mova o corte pra uma parte mais grossa se quiser pino.');
    }
  }
  return { det, resto, frame, secao, areaSecao, relatorio, soltos };
}

// partes: peças de UM objeto; plano {n,d} e ponto no referencial da peça.
// Sai: A = a parte separada (lado do ponto), B = o resto (um sólido só).
export function cortarLocal(partes, plano, ponto, opc = {}) {
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const avisos = [];
    const sol = partes.map(p => solidoPronto(ctx, p, avisos));
    const U = sol.length === 1 ? sol[0] : ctx.guardar(Manifold.union(sol));
    const r = separarNoPlano(ctx, U, plano, ponto, opc, avisos);
    const extras = r.soltos.map((s, i) => ({ nome: 'Pino solto ' + (i + 1), ...ctx.parte(s.man, 'Pino solto ' + (i + 1), partes[0].cor), soltoComprimento: s.comprimento }));
    const nome = partes[0].nome || 'Peça';
    // com encaixe: limpa vértice quase repetido (2 µm) da booleana do pino
    const limpo = x => r.relatorio && r.relatorio.length ? ctx.guardar(x.simplify(2e-3)) : x;
    const A = [ctx.parte(limpo(r.det), opc.nomeParte || nome + ' (parte)', partes[0].cor, true)];
    const B = [ctx.parte(limpo(r.resto), nome, partes[0].cor, true)];
    if (extras.length) {
      let x1 = -Infinity, y0 = Infinity, z0 = Infinity;
      for (const p of [...A, ...B]) { const c = caixa(p.malha); x1 = Math.max(x1, c.max[0]); y0 = Math.min(y0, c.min[1]); z0 = Math.min(z0, c.min[2]); }
      let x = x1 + 4;
      for (const e of extras) { const c = caixa(e.malha); e.malha = transladar(e.malha, x - c.min[0], y0 - c.min[1], z0 - c.min[2]); x += c.tam[0] + 3; }
    }
    return { A, B, extras, secao: r.secao, areaSecao: r.areaSecao, frame: r.frame, relatorio: r.relatorio, avisos, volumes: [r.det.volume(), r.resto.volume()], local: true };
  });
}

// Só a sugestão (a tela mostra o plano e deixa ajustar antes de cortar)
export function sugerirSeparacao(partes, ponto, opc = {}) {
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const avisos = [];
    const sol = partes.map(p => solidoPronto(ctx, p, avisos));
    const U = sol.length === 1 ? sol[0] : ctx.guardar(Manifold.union(sol));
    const r = acharPescoco(ctx, U, ponto);
    if (opc.encaixe) {
      // o ponto mais estreito às vezes é fino demais pra pino: anda pro lado do
      // corpo (até ~1,5× a largura) e para na 1ª seção onde cabe um pino Ø3
      const m = verticesDe(U), fat = fatiador(m), n = r.plano.n;
      const passo = 0.25, lim = Math.max(3, 3 * r.raio);
      for (let s = 0; s <= lim; s += passo) {
        const o = [r.centro[0] - n[0] * s, r.centro[1] - n[1] * s, r.centro[2] - n[2] * s];
        const q = secaoEm(ctx, fat, o, n);
        if (!q) continue;
        if (raioInscrito(q.pol) >= 2.5) {
          if (s > 0) avisos.push('Afastei o corte ' + s.toFixed(1).replace('.', ',') + ' mm pro lado do corpo: no ponto mais fino não cabia encaixe.');
          return { ...r, plano: { n, d: dot(n, q.c) }, centro: q.c, area: q.area, raio: Math.sqrt(q.area / Math.PI), afastado: s, avisos };
        }
      }
      avisos.push('Perto daqui a peça é fina demais pra pino (precisa de uns 5 mm de largura); vai sem encaixe.');
    }
    return { ...r, avisos };
  });
}

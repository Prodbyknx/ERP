// ARREDONDAR (fillet) e CHANFRAR bordas de verdade: a geometria exportada tem
// o raio/chanfro, medido em mm. Borda reta entre faces planas: prisma com o
// perfil do canto (tira material na quina pra fora, põe no canto pra dentro).
// Borda circular (aro de cilindro, boca de furo, base de pino): o mesmo perfil
// girado em volta do eixo, alinhado às facetas da peça.
// Antes: confere o limite (a curva não pode passar do fim da face; duas bordas
// paralelas da mesma face dividem a largura). Depois: confere o volume tirado
// contra o esperado (se esbarrou em outra parte, avisa e não entrega).
import { comContexto, manifold, segmentos } from './solidos.js';
import { detectarArestas } from './arestas.js';
import { normaisFace } from './malha.js';
import { gemeas } from './topologia.js';
import { construirBVH, pontoDentro } from './bvh.js';
import * as M4 from './mat4.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

// perfil do canto no plano (base u1 = eixo x; u2 a θ graus). Devolve
// { pts (2D), area (sem a folga ε), tl (comprimento na face) }
function perfil(tipo, valor, teta, eps, nArco) {
  const c = Math.cos(teta), s = Math.sin(teta);
  const u2 = [c, s], bis = [Math.cos(teta / 2), Math.sin(teta / 2)];
  const out1 = [0, -1], out2 = [-s, c];                // pra fora do canto, perpendicular a cada face
  let tl, miolo, area;
  if (tipo === 'chanfro') {
    tl = valor;
    miolo = [[tl, 0], [tl * u2[0], tl * u2[1]]];
    area = 0.5 * tl * tl * s;
  } else {
    const r = valor;
    tl = r / Math.tan(teta / 2);
    const d = r / Math.sin(teta / 2), C = [bis[0] * d, bis[1] * d];
    const a1 = Math.atan2(0 - C[1], tl - C[0]);
    const T2 = [tl * u2[0], tl * u2[1]];
    let a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    // arco curto (do lado do canto)
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    miolo = [];
    for (let i = 0; i <= nArco; i++) { const a = a1 + da * i / nArco; miolo.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
    // área = losango (O,T1,C,T2) − setor do arco
    area = tl * r - 0.5 * r * r * Math.abs(da);
  }
  const T1 = miolo[0], T2 = miolo[miolo.length - 1];
  const pts = [[T1[0] + out1[0] * eps, T1[1] + out1[1] * eps], ...miolo, [T2[0] + out2[0] * eps, T2[1] + out2[1] * eps], [-bis[0] * eps * 1.5, -bis[1] * eps * 1.5]];
  return { pts, area, tl };
}

// largura livre de uma face plana a partir da borda, na direção u
function larguraFace(m, N, gem, f0, origem, u, t, ini, fim) {
  const n0 = [N[f0 * 3], N[f0 * 3 + 1], N[f0 * 3 + 2]];
  const P = m.pos, I = m.idx, visto = new Set([f0]), fila = [f0];
  let maxU = 0;
  while (fila.length) {
    const f = fila.pop();
    for (let k = 0; k < 3; k++) {
      const v = I[f * 3 + k] * 3, w = [P[v] - origem[0], P[v + 1] - origem[1], P[v + 2] - origem[2]];
      const s = t ? dot(w, t) : 0;
      if (!t || (s >= ini - 1e-6 && s <= fim + 1e-6)) maxU = Math.max(maxU, dot(w, u));
      const g = gem[f * 3 + k];
      if (g < 0) continue;
      const o = (g / 3) | 0;
      if (visto.has(o) || N[o * 3] * n0[0] + N[o * 3 + 1] * n0[1] + N[o * 3 + 2] * n0[2] < 0.9999) continue;
      visto.add(o); fila.push(o);
    }
  }
  return maxU;
}

// alcance da parede cilíndrica ao longo do eixo (até o outro aro)
function alturaParede(m, N, gem, f0, centro, eixo, sinal) {
  const P = m.pos, I = m.idx, visto = new Set([f0]), fila = [f0];
  let h = 0;
  while (fila.length) {
    const f = fila.pop();
    for (let k = 0; k < 3; k++) {
      const v = I[f * 3 + k] * 3;
      h = Math.max(h, sinal * dot([P[v] - centro[0], P[v + 1] - centro[1], P[v + 2] - centro[2]], eixo));
      const g = gem[f * 3 + k];
      if (g < 0) continue;
      const o = (g / 3) | 0;
      if (visto.has(o) || Math.abs(N[o * 3] * eixo[0] + N[o * 3 + 1] * eixo[1] + N[o * 3 + 2] * eixo[2]) > 0.2) continue;
      visto.add(o); fila.push(o);
    }
  }
  return h;
}

// limite (maior valor possível) de cada borda escolhida
export function limites(m, arestas, tipo) {
  const N = normaisFace(m), gem = gemeas(m);
  const out = [];
  const par = (a, b) => a.tipo === 'reta' && b.tipo === 'reta' && Math.abs(dot(a.t, b.t)) > 0.999;
  for (const ar of arestas) {
    const teta = ar.angulo * Math.PI / 180;
    const fator = tipo === 'chanfro' ? 1 : Math.tan(teta / 2);    // valor = tl * fator
    let tl = Infinity, motivo = '';
    if (ar.tipo === 'reta') {
      for (const [lado, u] of [[ar.lado1[0], ar.u1], [ar.lado2[0], ar.u2]]) {
        const w = larguraFace(m, N, gem, lado, ar.a, u, ar.t, 0, ar.comprimento);
        // outra borda escolhida do outro lado da mesma face divide a largura
        const divide = arestas.some(o => o !== ar && par(o, ar) && Math.abs(dot(sub(o.a, ar.a), u) - w) < Math.max(0.05, w * 0.02));
        const lim = divide ? w / 2 : w;
        if (lim < tl) { tl = lim; motivo = 'a face ao lado tem ' + w.toFixed(2).replace('.', ',') + ' mm' + (divide ? ' e as duas bordas dividem ela' : ''); }
      }
    } else if (ar.tipo === 'circulo') {
      const fW = ar.ladoPlano === 1 ? ar.lado2[0] : ar.lado1[0];
      const h = alturaParede(m, N, gem, fW, ar.centro, ar.eixo, ar.paredeSobe ? 1 : -1);
      const outroAro = arestas.some(o => o !== ar && o.tipo === 'circulo' && Math.abs(o.raio - ar.raio) < 1e-3 && Math.abs(dot(sub(o.centro, ar.centro), ar.eixo)) > 1e-3 && Math.hypot(...sub(o.centro, ar.centro)) - Math.abs(dot(sub(o.centro, ar.centro), ar.eixo)) < 1e-3);
      const limW = outroAro ? h / 2 : h;
      const limP = ar.planoParaFora ? Infinity : ar.raio;          // topo de pino: até o centro
      if (limW < tl) { tl = limW; motivo = 'a parede tem ' + h.toFixed(2).replace('.', ',') + ' mm de altura' + (outroAro ? ' e os dois aros dividem ela' : ''); }
      if (limP < tl) { tl = limP; motivo = 'o raio do cilindro é ' + ar.raio.toFixed(2).replace('.', ',') + ' mm'; }
    } else { tl = 0; motivo = 'borda curva livre (ainda não dá pra arredondar essa)'; }
    out.push({ id: ar.id, max: tl * fator * 0.995, motivo });
  }
  return out;
}

// parte: {nome, malha, cor, paleta}; ids: bordas (de detectarArestas) ou
// descritores {ponto} (o clique); opc: { tipo: 'raio'|'chanfro', valor }
export function arredondar(parte, ids, opc = {}) {
  const tipo = opc.tipo === 'chanfro' ? 'chanfro' : 'raio';
  const valor = +opc.valor;
  if (!(valor > 0)) throw new Error('Informe o tamanho (mm).');
  const m = parte.malha;
  const todas = opc.arestas || detectarArestas(m);
  const escolhidas = ids.map(i => todas[i]).filter(Boolean);
  if (!escolhidas.length) throw new Error('Escolha pelo menos uma borda.');
  const curva = escolhidas.find(a => a.tipo === 'curva');
  if (curva) throw new Error('Essa borda não é reta nem círculo (borda de forma livre): arredondar ela ainda não é possível. Use Suavizar.');
  const lim = limites(m, escolhidas, tipo);
  const pior = lim.reduce((a, b) => (a.max < b.max ? a : b));
  if (valor > pior.max + 1e-9) {
    const e = new Error((tipo === 'chanfro' ? 'Chanfro' : 'Raio') + ' de ' + fmt(valor) + ' mm não cabe: ' + pior.motivo + '. O máximo aqui é ' + fmt(pior.max) + ' mm.');
    e.limite = pior.max; throw e;
  }
  const bvh = construirBVH(m);
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    let M = ctx.solido(parte, parte.nome);
    const v0 = M.volume();
    const tirar = [], por = [];
    let esperadoTirar = 0, esperadoPor = 0;
    for (const ar of escolhidas) {
      const teta = ar.angulo * Math.PI / 180;
      const eps = Math.max(0.01, valor * 0.02);
      if (ar.tipo === 'reta') {
        const nArco = Math.max(6, Math.ceil(segmentos(valor, 12) * (Math.PI - teta) / (2 * Math.PI)));
        const pf = perfil(tipo, valor, teta, eps, nArco);
        const u1 = ar.u1, u2p = unit(sub(ar.u2, ar.u1.map(v => v * dot(ar.u2, ar.u1))));
        // pontas: estende no ar (quina livre), não estende se a peça continua
        const bis = unit([ar.u1[0] + ar.u2[0], ar.u1[1] + ar.u2[1], ar.u2[2] + ar.u1[2]]);
        const dentroMat = q => pontoDentro(bvh, q[0], q[1], q[2]);
        const livre = (q, s) => { const p = [q[0] + ar.t[0] * s + bis[0] * 0.05 * valor, q[1] + ar.t[1] * s + bis[1] * 0.05 * valor, q[2] + ar.t[2] * s + bis[2] * 0.05 * valor]; return ar.convexa ? !dentroMat(p) : false; };
        const ext = valor * 1.5;
        const e0 = livre(ar.a, -Math.max(0.02, valor * 0.1)) ? ext : 0, e1 = livre(ar.b, Math.max(0.02, valor * 0.1)) ? ext : 0;
        const L = ar.comprimento + e0 + e1;
        const cs = ctx.guardar(CrossSection.ofPolygons([pf.pts], 'EvenOdd'));
        const pr = ctx.guardar(Manifold.extrude(cs, L));
        const o = [ar.a[0] - ar.t[0] * e0, ar.a[1] - ar.t[1] * e0, ar.a[2] - ar.t[2] * e0];
        const T = [u1[0], u1[1], u1[2], 0, u2p[0], u2p[1], u2p[2], 0, ar.t[0], ar.t[1], ar.t[2], 0, o[0], o[1], o[2], 1];
        const K = ctx.guardar(pr.transform(T));
        if (ar.convexa) { tirar.push(K); esperadoTirar += pf.area * ar.comprimento; }
        else { por.push(K); esperadoPor += pf.area * ar.comprimento; }
      } else {
        // círculo: perfil no plano (ρ, z) girado no eixo, com as facetas da peça
        const n = ar.pts.length - 1;
        const pf = perfil(tipo, valor, Math.PI / 2, eps, Math.max(6, Math.ceil(segmentos(valor, 12) / 4)));
        const [ux, uy] = ar.u1p, [wx, wy] = ar.u2p;
        const pts = pf.pts.map(([x, y]) => [ar.raio + x * ux + y * wx, x * uy + y * wy]);
        if (pts.some(q => q[0] < 0)) throw new Error('O arredondamento passa do centro do cilindro.');
        const cs = ctx.guardar(CrossSection.ofPolygons([pts], 'EvenOdd'));
        const rev = ctx.guardar(Manifold.revolve(cs, n));
        // alinha a 1ª faceta com o 1º ponto da borda
        const p0 = sub(ar.pts[0], ar.centro), h = dot(p0, ar.eixo);
        const ex = unit([p0[0] - h * ar.eixo[0], p0[1] - h * ar.eixo[1], p0[2] - h * ar.eixo[2]]);
        const F = M4.doPlano(ar.centro, ar.eixo, ex);
        const K = ctx.guardar(rev.transform(Array.from(F)));
        // Pappus: volume = área × 2π × ρ do centróide
        let cx = 0, A = 0;
        const q = pts.slice(0, -1);
        for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const cr = q[j][0] * q[i][1] - q[i][0] * q[j][1]; A += cr; cx += (q[j][0] + q[i][0]) * cr; }
        const rho = A ? cx / (3 * A) : ar.raio;
        const vol = pf.area * 2 * Math.PI * Math.abs(rho);
        if (ar.convexa) { tirar.push(K); esperadoTirar += vol; } else { por.push(K); esperadoPor += vol; }
      }
    }
    if (tirar.length) M = ctx.guardar(M.subtract(tirar.length === 1 ? tirar[0] : ctx.guardar(Manifold.union(tirar))));
    if (por.length) M = ctx.guardar(M.add(por.length === 1 ? por[0] : ctx.guardar(Manifold.union(por))));
    const dv = M.volume() - v0, esperado = esperadoPor - esperadoTirar;
    // conferência: tirou/pôs o que devia (cantos que se cruzam tiram um pouco menos)
    const escala = Math.max(esperadoTirar + esperadoPor, 1e-6);
    if (Math.abs(dv - esperado) > 0.25 * escala + 0.02) {
      throw new Error('O ' + (tipo === 'chanfro' ? 'chanfro' : 'arredondamento') + ' esbarrou em outra parte da peça (mudou ' + Math.abs(dv).toFixed(2) + ' mm³, o esperado era ' + Math.abs(esperado).toFixed(2) + '). Use um valor menor.');
    }
    const p = ctx.parte(M, parte.nome, parte.cor, true);
    return { parte: { nome: parte.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }, origem: p.origem, volumeAntes: v0, volumeDepois: M.volume(), bordas: escolhidas.length, limites: lim };
  });
}

const fmt = v => (Math.round(v * 100) / 100).toString().replace('.', ',');

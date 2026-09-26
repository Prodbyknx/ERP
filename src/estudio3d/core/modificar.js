// Modificar a geometria: PUXAR/EMPURRAR uma face plana, CASCA (deixar oca
// com parede em mm, opcionalmente aberta numa face) e ESPELHAR (+ unir).
// Tudo em Manifold, com conferência do resultado (volume esperado, sem
// cruzamento) antes de entregar.
import { comContexto, manifold } from './solidos.js';
import { gemeas, facesDoVertice, vizinhosDoVertice } from './topologia.js';
import { normaisFace, areaFace, criar, juntar, caixa } from './malha.js';
import { autoInterseccoes } from './validador.js';
import { construirBVH, distanciaAte, cruzamentosRaio } from './bvh.js';
import * as M4 from './mat4.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = v => (Math.round(v * 100) / 100).toString().replace('.', ',');

// faces coplanares ligadas à face f0 (a "superfície" plana clicada)
export function facePlana(m, f0, gem = gemeas(m), N = normaisFace(m)) {
  const P = m.pos, I = m.idx;
  const n = [N[f0 * 3], N[f0 * 3 + 1], N[f0 * 3 + 2]];
  const d = dot(n, [P[I[f0 * 3] * 3], P[I[f0 * 3] * 3 + 1], P[I[f0 * 3] * 3 + 2]]);
  const cx = caixa(m), tol = Math.max(1e-5, Math.hypot(...cx.tam) * 1e-5);
  const grupo = new Set([f0]), fila = [f0];
  while (fila.length) {
    const f = fila.pop();
    for (let k = 0; k < 3; k++) {
      const g = gem[f * 3 + k];
      if (g < 0) continue;
      const o = (g / 3) | 0;
      if (grupo.has(o) || N[o * 3] * n[0] + N[o * 3 + 1] * n[1] + N[o * 3 + 2] * n[2] < 0.99999) continue;
      let ok = true;
      for (let j = 0; j < 3 && ok; j++) { const v = I[o * 3 + j] * 3; if (Math.abs(dot(n, [P[v], P[v + 1], P[v + 2]]) - d) > tol) ok = false; }
      if (!ok) continue;
      grupo.add(o); fila.push(o);
    }
  }
  let area = 0;
  for (const f of grupo) area += areaFace(m, f);
  return { faces: [...grupo], n, d, area };
}

// contorno da face plana no referencial dela (polígonos 2D com furos)
function contorno(m, grupo, gem, F) {
  const I = m.idx, P = m.pos, dentro = new Set(grupo.faces), prox = new Map();
  for (const f of grupo.faces) for (let k = 0; k < 3; k++) {
    const g = gem[f * 3 + k];
    if (g >= 0 && dentro.has((g / 3) | 0)) continue;
    prox.set(I[f * 3 + k], I[f * 3 + (k + 1) % 3]);
  }
  const Fi = M4.inverter(F), usados = new Set(), lacos = [];
  for (const v0 of prox.keys()) {
    if (usados.has(v0)) continue;
    const laco = [];
    let v = v0;
    while (v !== undefined && !usados.has(v)) {
      usados.add(v);
      const q = M4.aplicarPonto(Fi, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      laco.push([q[0], q[1]]);
      v = prox.get(v);
    }
    if (laco.length >= 3) lacos.push(laco);
  }
  return lacos;
}

// PUXAR (+mm) ou EMPURRAR (−mm) a face plana que contém a face f0
export function puxarFace(parte, f0, distancia) {
  const m = parte.malha, gem = gemeas(m), N = normaisFace(m);
  const g = facePlana(m, f0, gem, N);
  const d = +distancia;
  if (!d) throw new Error('Informe quantos mm puxar (+) ou empurrar (−).');
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    const o = g.n.map(v => v * g.d);
    const F = M4.doPlano(o, g.n);
    const lacos = contorno(m, g, gem, F);
    if (!lacos.length) throw new Error('Não achei o contorno dessa face.');
    const cs = ctx.guardar(CrossSection.ofPolygons(lacos, 'EvenOdd'));
    const ov = Math.max(0.02, Math.abs(d) * 0.01);
    const M0 = ctx.solido(parte, parte.nome), v0 = M0.volume();
    let M;
    if (d > 0) {
      const pr = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.extrude(cs, d + ov)).translate([0, 0, -ov])).transform(Array.from(F)));
      M = ctx.guardar(M0.add(pr));
    } else {
      const pr = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.extrude(cs, -d + ov)).translate([0, 0, d])).transform(Array.from(F)));
      M = ctx.guardar(M0.subtract(pr));
    }
    if (M.isEmpty()) throw new Error('Empurrar ' + fmt(-d) + ' mm apagaria a peça.');
    const dv = M.volume() - v0, esperado = cs.area() * d;
    // empurrar mais fundo que a peça tira menos que a conta: a parede acabou
    if (d < 0 && Math.abs(dv) < 0.97 * Math.abs(esperado)) throw new Error('Empurrar ' + fmt(-d) + ' mm atravessa a peça (ela não tem essa espessura atrás da face). Use um valor menor.');
    const p = ctx.parte(M, parte.nome, parte.cor, true);
    return { parte: { nome: parte.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }, area: cs.area(), volumeAntes: v0, volumeDepois: M.volume() };
  });
}

// deslocamento de cada vértice pra dentro, t mm: resolve os planos das faces
// em volta deslocados de t (mínimos quadrados, peso = ângulo no vértice).
// Quina de caixa (até 3 planos) sai exata; superfície curva e arredondada
// fica consistente (o mesmo ponto da costura vai pro mesmo lugar).
export function deslocarDentro(m, t) {
  const P = m.pos, I = m.idx, nv = P.length / 3, N = normaisFace(m), fv = facesDoVertice(m);
  const out = new Float64Array(nv * 3);
  const cosIgual = Math.cos(0.5 * Math.PI / 180);
  const ang = (f, v) => {
    const k = I[f * 3] === v ? 0 : I[f * 3 + 1] === v ? 1 : 2;
    const a = I[f * 3 + k] * 3, b = I[f * 3 + (k + 1) % 3] * 3, c = I[f * 3 + (k + 2) % 3] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const lu = Math.hypot(...u), lw = Math.hypot(...w);
    return lu && lw ? Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw)))) : 0;
  };
  for (let v = 0; v < nv; v++) {
    const fs = fv.lista.subarray(fv.inicio[v], fv.inicio[v + 1]);
    const planos = [];
    let media = [0, 0, 0];
    for (const f of fs) {
      const n = [N[f * 3], N[f * 3 + 1], N[f * 3 + 2]], w = ang(f, v);
      media = media.map((x, i) => x + n[i] * w);
      const g = planos.find(q => dot(q.n, n) > cosIgual);
      if (g) g.w += w; else planos.push({ n, w });
    }
    const Lm = Math.hypot(...media) || 1;
    const d0 = media.map(x => -t * x / Lm);
    // min Σ w (n·δ + t)² + λ|δ − δ0|²
    const A = [0, 0, 0, 0, 0, 0], bb = [0, 0, 0];
    let W = 0;
    for (const { n, w } of planos) {
      A[0] += w * n[0] * n[0]; A[1] += w * n[0] * n[1]; A[2] += w * n[0] * n[2]; A[3] += w * n[1] * n[1]; A[4] += w * n[1] * n[2]; A[5] += w * n[2] * n[2];
      for (let i = 0; i < 3; i++) bb[i] += -w * t * n[i];
      W += w;
    }
    const lam = 1e-8 * W;
    const M = [[A[0] + lam, A[1], A[2]], [A[1], A[3] + lam, A[4]], [A[2], A[4], A[5] + lam]];
    const r = [bb[0] + lam * d0[0], bb[1] + lam * d0[1], bb[2] + lam * d0[2]];
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    let dlt = d0;
    if (Math.abs(det) > 1e-12) {
      const col = (c, k) => M.map((row, i) => row.map((x, j) => (j === k ? c[i] : x)));
      const dt = X => X[0][0] * (X[1][1] * X[2][2] - X[1][2] * X[2][1]) - X[0][1] * (X[1][0] * X[2][2] - X[1][2] * X[2][0]) + X[0][2] * (X[1][0] * X[2][1] - X[1][1] * X[2][0]);
      dlt = [0, 1, 2].map(k => dt(col(r, k)) / det);
    }
    const L = Math.hypot(...dlt);
    if (L > 3 * t) dlt = dlt.map(x => x * 3 * t / L);           // bico muito fino: limita
    for (let i = 0; i < 3; i++) out[v * 3 + i] = P[v * 3 + i] + dlt[i];
  }
  return out;
}

// Parede de dentro pelo campo de distância (levelSet): dentro da peça e a
// pelo menos t mm da superfície. Serve pra qualquer forma; a resolução se
// adapta ao tamanho (quina de dentro fica com raio ~ resolução).
function internaPorDistancia(ctx, m, t, avisos) {
  const { Manifold } = manifold();
  const bvh = construirBVH(m);
  const cx = caixa(m);
  let h = Math.max(t / 4, Math.cbrt(cx.tam[0] * cx.tam[1] * cx.tam[2] / 6e5));
  if (h > 0.75 * t) avisos.push('Peça grande: a parede de dentro saiu com resolução de ' + fmt(h) + ' mm.');
  const b0 = cx.min.map(v => v + t - 2 * h), b1 = cx.max.map(v => v - t + 2 * h);
  if (b0.some((v, i) => v >= b1[i])) return null;
  // dentro/fora por colunas em Z (cruzamentos do raio), numa grade h
  const nx = Math.max(1, Math.ceil((b1[0] - b0[0]) / h)), ny = Math.max(1, Math.ceil((b1[1] - b0[1]) / h));
  const col = new Array(nx * ny);
  const z0 = cx.min[2] - 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = b0[0] + (i + 0.5) * h + 1e-4, y = b0[1] + (j + 0.5) * h + 2e-4;
    col[j * nx + i] = cruzamentosRaio(bvh, x, y, z0, 1e-7, 2e-7, 1).map(d => z0 + d);
  }
  const dentroDe = (x, y, z) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - b0[0]) / h))), j = Math.min(ny - 1, Math.max(0, Math.floor((y - b0[1]) / h)));
    const zs = col[j * nx + i];
    let k = 0; while (k < zs.length && zs[k] < z) k++;
    return (k & 1) === 1;
  };
  const teto = t + 3 * h;
  const sdf = p => {
    const d = distanciaAte(bvh, p[0], p[1], p[2], teto);
    if (d < t) return d - t;
    return dentroDe(p[0], p[1], p[2]) ? d - t : -d;
  };
  // simplify tira as lascas que a grade deixa (sem abrir a malha)
  let L = ctx.guardar(ctx.guardar(Manifold.levelSet(sdf, { min: b0, max: b1 }, h, 0)).simplify(h * 0.02));
  // bolhas minúsculas (braço/dedo quase da grossura de 2 paredes) não servem
  // pra nada e viram lascas: ficam maciças
  const comps = L.decompose();
  if (comps.length > 1) {
    const vmax = Math.max(...comps.map(c => c.volume()));
    const bons = comps.filter(c => c.volume() >= Math.max((3 * h) ** 3, 0.01 * vmax));
    if (bons.length < comps.length) {
      avisos.push((comps.length - bons.length) + ' parte(s) fina(s) ficaram maciças (não cabia miolo com essa parede).');
      L = ctx.guardar(bons.length === 1 ? bons[0].asOriginal() : Manifold.compose(bons));
    }
    for (const c of comps) c.delete();
  }
  avisos.push('Parede de dentro feita pelo campo de distância (a quina de dentro fica levemente arredondada).');
  return L;
}

// CASCA: peça oca com parede t mm. opc.abrir: faces (índices) cujas faces
// planas ficam abertas (caixa vira pote, capacete abre embaixo)
export function casca(parte, t, opc = {}) {
  t = +t;
  if (!(t > 0)) throw new Error('Informe a espessura da parede (mm).');
  const m = parte.malha;
  const cx = caixa(m);
  if (2 * t >= Math.min(...cx.tam)) throw new Error('Parede de ' + fmt(t) + ' mm não cabe: a peça tem ' + fmt(Math.min(...cx.tam)) + ' mm na parte mais fina da caixa. Use no máximo ' + fmt(Math.min(...cx.tam) / 2 * 0.9) + ' mm.');
  const posIn = deslocarDentro(m, t);
  // costura entre superfície curva e plana pode dobrar um triângulo fino:
  // suaviza o deslocamento só em volta dele até a parede de dentro não se cruzar
  {
    const viz = vizinhosDoVertice(m), P = m.pos;
    for (let volta = 0; volta < 8; volta++) {
      const ai = autoInterseccoes(criar(posIn, m.idx), { max: 2000 });
      if (!ai.pares) break;
      const alvo = new Set();
      for (const f of ai.faces) for (let k = 0; k < 3; k++) { const v = m.idx[f * 3 + k]; alvo.add(v); for (let j = viz.inicio[v]; j < viz.inicio[v + 1]; j++) alvo.add(viz.lista[j]); }
      const novo = new Map();
      for (const v of alvo) {
        const d = [0, 0, 0]; let n = 0;
        for (const u of [v, ...viz.lista.subarray(viz.inicio[v], viz.inicio[v + 1])]) { for (let e = 0; e < 3; e++) d[e] += posIn[u * 3 + e] - P[u * 3 + e]; n++; }
        novo.set(v, d.map(x => x / n));
      }
      for (const [v, d] of novo) for (let e = 0; e < 3; e++) posIn[v * 3 + e] = P[v * 3 + e] + d[e];
    }
  }
  const idxIn = new Uint32Array(m.idx.length);
  for (let i = 0; i < m.idx.length; i += 3) { idxIn[i] = m.idx[i]; idxIn[i + 1] = m.idx[i + 2]; idxIn[i + 2] = m.idx[i + 1]; }
  let interna = criar(posIn, m.idx.slice());
  // a parede de dentro não pode se cruzar nem cruzar a de fora; se cruzar
  // (costura de arredondado, parte fina), refaz a parede de dentro pelo campo
  // de distância: os pontos a exatamente t mm da superfície
  const dupla = juntar([m, criar(posIn, idxIn)]);
  const exata = autoInterseccoes(dupla, { max: 5 }).pares === 0;
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    const M0 = ctx.solido(parte, parte.nome), v0 = M0.volume();
    const avisos = [];
    let dentro;
    if (exata) dentro = ctx.solido({ malha: interna }, 'parede de dentro');
    else {
      dentro = internaPorDistancia(ctx, m, t, avisos);
      if (!dentro || dentro.isEmpty()) throw new Error('Parede de ' + fmt(t) + ' mm não cabe: a peça é fina demais pra ficar oca com essa parede. Use uma espessura menor.');
      interna = ctx.parte(dentro, 'dentro', '#000').malha;
    }
    if (opc.abrir && opc.abrir.length) {
      // face aberta: a parte de dentro atravessa a face escolhida
      const gem = gemeas(m), N = normaisFace(m);
      const feitos = new Set();
      for (const f0 of opc.abrir) {
        const g = facePlana(m, f0, gem, N);
        const chave = g.faces.slice().sort((a, b) => a - b)[0];
        if (feitos.has(chave)) continue;
        feitos.add(chave);
        // abertura = contorno da face de fora encolhido pela parede (fica a
        // borda com t mm) e atravessando do miolo até fora da peça
        const o = g.n.map(v => v * g.d);
        const F = M4.doPlano(o, g.n);
        const lacos = contorno(m, g, gem, F);
        if (!lacos.length) { avisos.push('Não consegui abrir uma das faces.'); continue; }
        const cs0 = ctx.guardar(CrossSection.ofPolygons(lacos, 'EvenOdd'));
        const cs = ctx.guardar(cs0.offset(exata ? -t : -(t + 0.01), exata ? 'Miter' : 'Round', 2, 32));
        if (cs.isEmpty()) { avisos.push('Uma das faces é estreita demais pra abrir com essa parede.'); continue; }
        const pr = ctx.guardar(ctx.guardar(ctx.guardar(Manifold.extrude(cs, 2 * t + 1)).translate([0, 0, -2 * t])).transform(Array.from(F)));
        dentro = ctx.guardar(dentro.add(pr));
      }
    }
    let M = ctx.guardar(M0.subtract(dentro));
    if (M.isEmpty()) throw new Error('A casca ficou vazia.');
    if (!exata) M = ctx.guardar(M.simplify(1e-5 * Math.max(...cx.tam)));
    const p = ctx.parte(M, parte.nome, parte.cor, true);
    return { parte: { nome: parte.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }, volumeAntes: v0, volumeDepois: M.volume(), avisos };
  });
}

// ESPELHAR no plano {eixo 0|1|2, pos (mm)} do referencial da peça.
// opc.unir: junta com o original (modela metade, espelha e une)
export function espelhar(parte, eixo, pos, opc = {}) {
  const m = parte.malha, P = Float64Array.from(m.pos);
  for (let i = eixo; i < P.length; i += 3) P[i] = 2 * pos - P[i];
  const I = new Uint32Array(m.idx.length);
  for (let i = 0; i < m.idx.length; i += 3) { I[i] = m.idx[i]; I[i + 1] = m.idx[i + 2]; I[i + 2] = m.idx[i + 1]; }
  const esp = { ...parte, malha: criar(P, I, m.cor ? Uint16Array.from(m.cor) : null) };
  if (!opc.unir) return { parte: esp };
  // UNIR: corta a peça no plano (fica o lado com mais volume), tira a tampa do
  // corte, espelha e SOLDA na costura — sem booleana, costura exata
  return comContexto(ctx => {
    const M0 = ctx.solido(parte, parte.nome);
    const n = [0, 0, 0]; n[eixo] = 1;
    const a = ctx.guardar(M0.trimByPlane(n, pos)), b = ctx.guardar(M0.trimByPlane(n.map(x => -x), -pos));
    const lado = a.volume() >= b.volume() ? a : b;
    if (lado.isEmpty()) throw new Error('A peça não chega no plano do espelho.');
    const h = ctx.parte(lado, parte.nome, parte.cor, true).malha;
    const Pm = h.pos, Im = h.idx, tol = 1e-6 * Math.max(1, Math.hypot(...caixa(h).tam));
    const noPlano = v => Math.abs(Pm[v * 3 + eixo] - pos) < tol;
    const faces = [];
    for (let t = 0; t < Im.length; t += 3) if (!(noPlano(Im[t]) && noPlano(Im[t + 1]) && noPlano(Im[t + 2]))) faces.push(Im[t], Im[t + 1], Im[t + 2]);
    if (faces.length === Im.length) throw new Error('A peça não encosta no plano do espelho: use Espelhar sem unir e junte com Combinar.');
    const nv = Pm.length / 3, P2 = new Float64Array(nv * 6);
    P2.set(Pm);
    for (let v = 0; v < nv; v++) for (let e = 0; e < 3; e++) P2[(nv + v) * 3 + e] = e === eixo ? (noPlano(v) ? Pm[v * 3 + e] : 2 * pos - Pm[v * 3 + e]) : Pm[v * 3 + e];
    // vértice da costura é o mesmo dos dois lados
    const alvo = v => noPlano(v) ? v : nv + v;
    const I2 = [];
    for (let i = 0; i < faces.length; i += 3) {
      I2.push(faces[i], faces[i + 1], faces[i + 2]);
      I2.push(alvo(faces[i]), alvo(faces[i + 2]), alvo(faces[i + 1]));
    }
    const junta = criar(P2, Uint32Array.from(I2));
    const S = ctx.solido({ malha: junta, cor: parte.cor }, parte.nome);
    const p = ctx.parte(S, parte.nome, parte.cor, false);
    return { parte: { nome: parte.nome, malha: p.malha, cor: p.cor, paleta: p.paleta }, pecas: S.decompose().length, volume: S.volume(), volumeMetade: lado.volume() };
  });
}

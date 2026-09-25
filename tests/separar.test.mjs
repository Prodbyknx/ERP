import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha, esfera } from './util/malhas.mjs';
import { separarDetalhe, separarPorCor } from '../src/estudio3d/core/separar.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, volume, centroidesFace } from '../src/estudio3d/core/malha.js';
import { prepararAdjacencia, crescerRegiao } from '../src/estudio3d/core/selecao.js';

await carregarManifold();
const solida = m => { const v = validar(m, { completo: false }); return v.fechada && v.volume > 0 && v.componentesInvertidos === 0 && v.componentes >= 1; };

// une várias malhas num sólido só (como um modelo de IA: tudo grudado numa malha)
function unir(partes) {
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const u = ctx.guardar(Manifold.union(partes.map(p => ctx.solido(p))));
    return ctx.parte(u, 'modelo', partes[0].cor);
  });
}

test('separar detalhe (orelha) de um corpo: 2 peças fechadas, posição e escala preservadas', () => {
  const corpo = { malha: esfera(20, 4), cor: '#1B1B1B' };
  const orelha = { malha: esfera(6, 3, 0, 0, 22), cor: '#1B1B1B' };
  const modelo = unir([corpo, orelha]);
  const vTotal = volume(modelo.malha);
  // seleção: faces acima de z = 19 (a orelha)
  const C = centroidesFace(modelo.malha);
  const nt = modelo.malha.idx.length / 3;
  const sel = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) if (C[t * 3 + 2] > 20.5) sel[t] = 1;
  const r = separarDetalhe({ nome: 'Personagem', ...modelo }, sel, { nomeDetalhe: 'Orelha' });
  assert.deepEqual(r.metodos, ['plano']);
  assert.ok(solida(r.principal.malha), 'principal fechada');
  assert.ok(solida(r.detalhe.malha), 'detalhe fechado');
  const vp = volume(r.principal.malha), vd = volume(r.detalhe.malha);
  assert.ok(Math.abs(vp + vd - vTotal) < 0.01 * vTotal, 'volume conservado ' + (vp + vd) + ' ' + vTotal);
  // orelha continua lá em cima, no mesmo lugar
  const cd = caixa(r.detalhe.malha);
  assert.ok(cd.max[2] > 27.9 && cd.max[2] < 28.1, 'topo da orelha ' + cd.max[2]);
  assert.ok(Math.abs((cd.min[0] + cd.max[0]) / 2) < 0.2);
  // corpo não perdeu nada fora da região
  const cp = caixa(r.principal.malha);
  assert.ok(Math.abs(cp.min[2] + 20) < 0.05 && Math.abs(cp.tam[0] - 40) < 0.1);
  assert.equal(validar(r.principal.malha, { completo: false }).componentes, 1);
});

test('separar detalhe com conector: pino no detalhe, furo no corpo', () => {
  const modelo = unir([{ malha: caixaMalha(40, 40, 10), cor: '#FFFFFF' }, { malha: caixaMalha(20, 20, 12, 10, 10, 9), cor: '#FFFFFF' }]);
  const C = centroidesFace(modelo.malha);
  const nt = modelo.malha.idx.length / 3;
  const sel = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) if (C[t * 3 + 2] > 10.01) sel[t] = 1;
  const r = separarDetalhe({ nome: 'Base', ...modelo }, sel, { conector: { tipo: 'cilindrico', diametro: 4, folga: 0.2, profundidade: 4, quantidade: 1 } });
  assert.equal(r.relatorio.length, 1, JSON.stringify(r.avisos));
  assert.ok(solida(r.principal.malha) && solida(r.detalhe.malha));
  // detalhe = bloco 20x20x11 acima de z=10 + pino (desce até 6)
  const cd = caixa(r.detalhe.malha);
  assert.ok(Math.abs(cd.min[2] - 6) < 0.01, 'ponta do pino ' + cd.min[2]);
  assert.ok(volume(r.principal.malha) < 16000);
});

test('detalhe pintado na superfície vira peça com espessura (separar por cor)', () => {
  // placa 40x40x5 com um "olho" pintado de vermelho no topo (sem relevo)
  const base = caixaMalha(40, 40, 5);
  // subdivide o topo pra ter faces pintáveis: usa uma esfera achatada? mais simples: une placa + disco fino e pinta o disco
  const olho = esfera(6, 3, 20, 20, 5);
  const modelo = unir([{ malha: base, cor: '#1B1B1B' }, { malha: olho, cor: '#1B1B1B' }]);
  const C = centroidesFace(modelo.malha);
  const nt = modelo.malha.idx.length / 3;
  const cor = new Uint16Array(nt);
  for (let t = 0; t < nt; t++) if (C[t * 3 + 2] > 5.2) cor[t] = 1;
  modelo.malha.cor = cor;
  const parte = { nome: 'Placa', malha: modelo.malha, cor: '#1B1B1B', paleta: ['#1B1B1B', '#D1242F'] };
  const v0 = volume(parte.malha);
  const r = separarPorCor(parte, { espessura: 1 });
  assert.equal(r.pecas.length, 2);
  assert.equal(r.pecas[0].cor, '#1B1B1B'); assert.equal(r.pecas[1].cor, '#D1242F');
  for (const p of r.pecas) assert.ok(solida(p.malha), p.cor);
  const soma = r.pecas.reduce((s, p) => s + volume(p.malha), 0);
  assert.ok(Math.abs(soma - v0) < 0.01 * v0, 'volume ' + soma + ' ' + v0);
  // peça vermelha tem espessura real (>= 1 mm abaixo da borda)
  const cv = caixa(r.pecas[1].malha);
  assert.ok(cv.tam[2] >= 1, 'espessura ' + cv.tam[2]);
});

test('encaixe com folga: bolso maior que a peça', () => {
  const modelo = unir([{ malha: caixaMalha(40, 40, 6), cor: '#1B1B1B' }, { malha: esfera(5, 3, 20, 20, 6), cor: '#1B1B1B' }]);
  const C = centroidesFace(modelo.malha);
  const nt = modelo.malha.idx.length / 3;
  const sel = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) if (C[t * 3 + 2] > 6.2) sel[t] = 1;
  const v0 = volume(modelo.malha);
  const r = separarDetalhe({ nome: 'P', ...modelo }, sel, { profundidade: 1.5, folga: 0.2 });
  assert.ok(solida(r.principal.malha) && solida(r.detalhe.malha));
  // com folga some material: principal + detalhe < original
  assert.ok(volume(r.principal.malha) + volume(r.detalhe.malha) < v0 - 1);
  const cd = caixa(r.detalhe.malha);
  assert.ok(cd.min[2] > 4.4 && cd.min[2] < 4.8, 'detalhe desce 1,5 mm abaixo da borda: ' + cd.min[2]);
});

test('seleção inteligente: clique na orelha cresce até a dobra', () => {
  const modelo = unir([{ malha: esfera(20, 4), cor: '#1B1B1B' }, { malha: esfera(6, 3, 0, 0, 22), cor: '#1B1B1B' }]);
  const adj = prepararAdjacencia(modelo.malha);
  const C = centroidesFace(modelo.malha);
  let topo = 0; for (let t = 1; t < C.length / 3; t++) if (C[t * 3 + 2] > C[topo * 3 + 2]) topo = t;
  const sel = crescerRegiao(modelo.malha, adj, topo, { anguloVizinho: 25 });
  let dentro = 0, fora = 0;
  for (let t = 0; t < sel.length; t++) if (sel[t]) { if (C[t * 3 + 2] > 19) dentro++; else fora++; }
  assert.ok(dentro > 50 && fora === 0, dentro + ' ' + fora);
});

// Região pintada numa superfície CURVA (faixa em volta da esfera: o plano da
// borda não serve) com espessura: vira camada que acompanha a curvatura.
test('região curva com espessura (faixa na esfera) vira camada imprimível, com e sem folga', () => {
  const m = esfera(10, 5);
  const C = centroidesFace(m), nt = m.idx.length / 3, mask = new Uint8Array(nt);
  let area = 0;
  for (let t = 0; t < nt; t++) if (Math.abs(C[t * 3 + 2]) < 3) mask[t] = 1;
  for (let t = 0; t < nt; t++) if (mask[t]) { const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3, P = m.pos;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    area += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; }
  const v0 = volume(m);
  for (const folga of [0, 0.15]) {
    const r = separarDetalhe({ nome: 'Bola', malha: m, cor: '#222222' }, mask, { profundidade: 0.8, folga, limparSelecao: false });
    assert.deepEqual(r.metodos, ['camada']);
    for (const p of [r.detalhe, r.principal]) {
      const v = validar(p.malha, { completo: true });
      assert.ok(v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.volume > 0 && v.componentesInvertidos === 0, JSON.stringify({ ai: v.autoInterseccoes, deg: v.facesDegeneradas, f: v.fechada }));
    }
    // camada de ~0,8 mm: volume ≈ área × espessura (a curvatura tira um pouco)
    const vd = volume(r.detalhe.malha);
    assert.ok(vd > area * 0.8 * 0.85 && vd < area * 0.8 * 1.02, 'volume da camada ' + vd.toFixed(1) + ' vs ' + (area * 0.8).toFixed(1));
    // sem folga as duas peças somam a original; com folga sobra o vão do fundo
    const soma = vd + volume(r.principal.malha);
    if (!folga) assert.ok(Math.abs(soma - v0) < 1e-3 * v0, 'soma ' + soma + ' vs ' + v0);
    else assert.ok(soma < v0 && soma > v0 - area * folga * 1.05, 'folga ' + (v0 - soma).toFixed(2));
    // as duas peças não se sobrepõem
    const inter = comContexto(ctx => ctx.guardar(ctx.solido({ malha: r.detalhe.malha }).intersect(ctx.solido({ malha: r.principal.malha }))).volume());
    assert.ok(inter < 1e-3, 'sobreposição ' + inter);
  }
});

test('camada mais funda que a parede: recusa com mensagem clara (não gera peça quebrada)', () => {
  // placa fina de 0,6 mm dobrada em "telha" (curva) e camada de 2 mm pedida
  const m = esfera(10, 4);
  const casca = comContexto(ctx => { const { Manifold } = manifold(); const a = ctx.solido({ malha: m }); const b = ctx.guardar(Manifold.sphere(9.4, 96)); return ctx.parte(ctx.guardar(a.subtract(b)), 'casca', '#222222'); });
  const C = centroidesFace(casca.malha), nt = casca.malha.idx.length / 3, mask = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) { const r = Math.hypot(C[t * 3], C[t * 3 + 1], C[t * 3 + 2]); if (r > 9.7 && Math.abs(C[t * 3 + 2]) < 3) mask[t] = 1; }
  assert.throws(() => separarDetalhe(casca, mask, { profundidade: 2, limparSelecao: false }), /parede|cruzaria|pegaria/);
});

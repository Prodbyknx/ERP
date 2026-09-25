// Bateria de estresse: tenta quebrar Consertar, Cortar, Selecionar e Separar
// com casos difíceis, pelo MESMO caminho que a tela usa (operações do motor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { caixaMalha, esfera, tirarFaces } from './util/malhas.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { criar, volume, caixa, centroidesFace, juntar, inverterFaces } from '../src/estudio3d/core/malha.js';
import { prepararAdjacencia, crescerRegiao, contar } from '../src/estudio3d/core/selecao.js';

await carregarManifold();

// semente fixa: o teste é sempre o mesmo
let semente = 12345;
const aleatorio = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };

function imprimivel(m, rotulo) {
  const v = validar(m, { completo: true });
  const r = { abertas: v.arestasAbertas, nm: v.arestasNaoManifold, nmv: v.verticesNaoManifold, inv: v.orientacaoTrocada + v.componentesInvertidos, deg: v.facesDegeneradas, dup: v.facesDuplicadas, ai: v.autoInterseccoes };
  const ok = !r.abertas && !r.nm && !r.nmv && !r.inv && !r.deg && !r.dup && !r.ai && v.volume > 0;
  assert.ok(ok, rotulo + ': ' + JSON.stringify(r));
  return v;
}
const perto = (a, b, tolRel, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tolRel, msg + ': ' + a.toFixed(3) + ' vs ' + b.toFixed(3));
const unir = ms => comContexto(ctx => { const { Manifold } = manifold(); const u = ctx.guardar(Manifold.union(ms.map(m => ctx.solido({ malha: m, cor: '#000000' })))); return ctx.parte(u, 'm', '#000000').malha; });
const volInter = (a, b) => comContexto(ctx => { const x = ctx.guardar(ctx.solido({ malha: a, cor: '#000000' }).intersect(ctx.solido({ malha: b, cor: '#000000' }))); return x.volume(); });
const reparar = m => executar('reparar', { parte: { nome: 'p', malha: m, cor: '#888888' }, opc: {} });

/* ================================================================ CONSERTAR */

test('CONSERTAR: esfera com 30 buracos espalhados fecha e mantém o volume', () => {
  const s = esfera(20, 4);
  const nt = s.idx.length / 3, lista = new Set();
  while (lista.size < 30) lista.add(Math.floor(aleatorio() * nt));
  const r = reparar(tirarFaces(s, [...lista]));
  imprimivel(r.parte.malha, 'buracos');
  perto(volume(r.parte.malha), volume(s), 0.01, 'volume');
});

test('CONSERTAR: calota inteira faltando (30% da esfera) fecha sem se atravessar', () => {
  const s = esfera(15, 4);
  const C = centroidesFace(s), nt = s.idx.length / 3, lista = [];
  for (let t = 0; t < nt; t++) if (C[t * 3 + 2] > 6) lista.push(t);
  const r = reparar(tirarFaces(s, lista));
  imprimivel(r.parte.malha, 'calota');
  assert.ok(volume(r.parte.malha) > 0.75 * volume(s));
});

test('CONSERTAR: 20% das faces viradas e peça do avesso voltam pro lado certo', () => {
  const s = esfera(12, 4);
  const idx = Uint32Array.from(s.idx);
  for (let t = 0; t < idx.length / 3; t++) if (aleatorio() < 0.2) { const a = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = a; }
  const r1 = reparar(criar(s.pos, idx));
  imprimivel(r1.parte.malha, 'viradas');
  perto(volume(r1.parte.malha), volume(s), 1e-6, 'volume viradas');
  const r2 = reparar(inverterFaces(s));
  imprimivel(r2.parte.malha, 'avesso');
  perto(volume(r2.parte.malha), volume(s), 1e-6, 'volume avesso');
});

test('CONSERTAR: "sopa" de triângulos (STL sem vértice compartilhado) + repetidas + degeneradas', () => {
  const s = esfera(10, 3);
  const nt = s.idx.length / 3;
  const pos = [], idx = [];
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = s.idx[t * 3 + k]; pos.push(s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]); idx.push(pos.length / 3 - 1); }
  for (let t = 0; t < 10; t++) idx.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);       // repetidas
  pos.push(1, 1, 1, 2, 2, 2, 3, 3, 3); const b = pos.length / 3; idx.push(b - 3, b - 2, b - 1); // degenerada (colinear)
  const r = reparar(criar(pos, idx));
  imprimivel(r.parte.malha, 'sopa');
  perto(volume(r.parte.malha), volume(s), 1e-6, 'volume sopa');
});

test('CONSERTAR: modelo de IA (ruído + buracos + faces viradas + lixo solto)', () => {
  const s = esfera(18, 5);
  const pos = Float64Array.from(s.pos);
  for (let v = 0; v < pos.length / 3; v++) {
    const k = 1 + 0.03 * Math.sin(pos[v * 3] * 0.9) * Math.cos(pos[v * 3 + 1] * 1.3) + 0.01 * (aleatorio() - 0.5);
    pos[v * 3] *= k; pos[v * 3 + 1] *= k; pos[v * 3 + 2] *= k;
  }
  let m = criar(pos, s.idx);
  const nt = m.idx.length / 3, tira = new Set();
  while (tira.size < 40) tira.add(Math.floor(aleatorio() * nt));
  m = tirarFaces(m, [...tira]);
  const idx = Uint32Array.from(m.idx);
  for (let t = 0; t < idx.length / 3; t++) if (aleatorio() < 0.05) { const a = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = a; }
  // lixo solto: 3 triângulos minúsculos longe
  const lixo = criar([40, 40, 40, 40.1, 40, 40, 40, 40.1, 40, -40, 0, 0, -40.05, 0, 0, -40, 0.05, 0.02], [0, 1, 2, 3, 4, 5]);
  const r = reparar(juntar([criar(m.pos, idx), lixo]));
  const v = imprimivel(r.parte.malha, 'IA');
  assert.equal(v.componentes, 1, 'lixo solto removido');
});

test('CONSERTAR: duas cascas que se atravessam viram um sólido com "Unir partes sobrepostas"', () => {
  const m = juntar([esfera(10, 3), esfera(10, 3, 12, 0, 0)]);
  const v0 = validar(m, { completo: true });
  assert.ok(v0.autoInterseccoes > 0);
  const u = executar('unirSobrepostos', { parte: { nome: 'p', malha: m, cor: '#888888' } });
  const v = imprimivel(u.parte.malha, 'unidas');
  assert.equal(v.componentes, 1);
});

test('CONSERTAR: dois cubos encostados só por uma aresta (non-manifold) ficam fechados', () => {
  const m = juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 10, 10, 0)]);
  const r = reparar(m);
  const v = validar(r.parte.malha, { completo: false });
  assert.equal(v.arestasAbertas + v.arestasNaoManifold, 0, JSON.stringify({ a: v.arestasAbertas, nm: v.arestasNaoManifold }));
  perto(volume(r.parte.malha), 2000, 1e-6, 'volume');
});

test('CONSERTAR: peça perfeita não é alterada', () => {
  const s = esfera(10, 3);
  const r = reparar(s);
  assert.equal(r.passos.length, 0, r.passos.join(';'));
  perto(volume(r.parte.malha), volume(s), 1e-6, "volume");
});

/* ================================================================ CORTAR */

const FORMAS = {
  caixa: () => caixaMalha(40, 30, 20),
  esfera: () => esfera(15, 4, 0, 0, 15),
  boneco: () => unir([esfera(14, 4, 0, 0, 14), esfera(5, 3, -10, 0, 28), esfera(5, 3, 10, 0, 28), esfera(3, 3, 0, -13, 16)]),
  placa: () => caixaMalha(60, 40, 2.4),
  anel: () => comContexto(ctx => { const { Manifold } = manifold(); const a = ctx.guardar(Manifold.cylinder(10, 20, 20, 96)); const b = ctx.guardar(ctx.guardar(Manifold.cylinder(12, 14, 14, 96)).translate([0, 0, -1])); return ctx.parte(ctx.guardar(a.subtract(b)), 'anel', '#000000').malha; })
};
const PLANOS = cx => {
  const c = [(cx.min[0] + cx.max[0]) / 2, (cx.min[1] + cx.max[1]) / 2, (cx.min[2] + cx.max[2]) / 2];
  const inc = (n) => { const L = Math.hypot(...n); const u = n.map(x => x / L); return { n: u, d: u[0] * c[0] + u[1] * c[1] + u[2] * c[2] }; };
  return {
    'Z meio': { n: [0, 0, 1], d: c[2] },
    'Z perto do fundo': { n: [0, 0, 1], d: cx.min[2] + 0.4 },
    'Z perto do topo': { n: [0, 0, 1], d: cx.max[2] - 0.4 },
    'X 25%': { n: [1, 0, 0], d: cx.min[0] + cx.tam[0] * 0.25 },
    'Y 75%': { n: [0, 1, 0], d: cx.min[1] + cx.tam[1] * 0.75 },
    'inclinado 45°': inc([1, 0, 1]),
    'inclinado qualquer': inc([0.3, 0.5, 0.8])
  };
};

for (const [nf, fazer] of Object.entries(FORMAS)) {
  test('CORTAR ' + nf + ': todos os planos saem com duas partes fechadas e volume somando igual', () => {
    const m = fazer();
    const v0 = volume(m);
    for (const [np, plano] of Object.entries(PLANOS(caixa(m)))) {
      const r = executar('cortar', { partes: [{ nome: nf, malha: m, cor: '#1F6FEB' }], plano, opc: {} });
      assert.ok(r.A.length && r.B.length, nf + '/' + np + ': faltou parte');
      for (const p of [...r.A, ...r.B]) imprimivel(p.malha, nf + '/' + np);
      const soma = [...r.A, ...r.B].reduce((s, p) => s + volume(p.malha), 0);
      perto(soma, v0, 2e-3, nf + '/' + np + ' volume');
    }
  });
}

const CONECTORES = [
  { tipo: 'cilindrico', diametro: 5, quantidade: 1 }, { tipo: 'cilindrico', diametro: 4, quantidade: 3 },
  { tipo: 'quadrado', lado: 5, quantidade: 2 }, { tipo: 'retangular', largura: 4, comprimento: 8, quantidade: 2 },
  { tipo: 'hexagonal', diametro: 6, quantidade: 1 }, { tipo: 'lingueta', largura: 4 }, { tipo: 'andorinha', largura: 5 },
  { tipo: 'solto', diametro: 5, quantidade: 2 }
];
for (const nf of ['caixa', 'esfera', 'boneco']) {
  test('ENCAIXES em ' + nf + ': peças fechadas, pino nunca nos dois lados, montadas não se atravessam', () => {
    const m = FORMAS[nf]();
    const cx = caixa(m);
    for (const c of CONECTORES) {
      for (const [np, plano] of Object.entries({ 'Z': { n: [0, 0, 1], d: (cx.min[2] + cx.max[2]) / 2 }, 'X': { n: [1, 0, 0], d: (cx.min[0] + cx.max[0]) / 2 } })) {
        const conector = { profundidade: 5, folga: 0.2, ...c };
        const r = executar('cortar', { partes: [{ nome: nf, malha: m, cor: '#1F6FEB' }], plano, opc: { conector } });
        const rot = nf + '/' + c.tipo + '/' + np;
        assert.ok(r.relatorio.length > 0 || r.avisos.length > 0, rot + ': sem relatório nem aviso');
        for (const p of [...r.A, ...r.B, ...r.extras]) imprimivel(p.malha, rot);
        // montadas: A e B não ocupam o mesmo lugar (folga respeitada)
        const A = r.A.length > 1 ? juntar(r.A.map(p => p.malha)) : r.A[0].malha;
        const B = r.B.length > 1 ? juntar(r.B.map(p => p.malha)) : r.B[0].malha;
        assert.ok(volInter(A, B) < 1e-3, rot + ': A e B se atravessam (' + volInter(A, B).toFixed(4) + ' mm³)');
        for (const x of r.extras) { assert.ok(volInter(x.malha, A) < 1e-3 && volInter(x.malha, B) < 1e-3, rot + ': pino solto colide'); }
      }
    }
  });
}

test('ENCAIXE maior que a peça (placa fina + pino fundo): avisa e não estraga as partes', () => {
  const m = FORMAS.placa();
  const r = executar('cortar', { partes: [{ nome: 'placa', malha: m, cor: '#1F6FEB' }], plano: { n: [0, 0, 1], d: 1.2 }, opc: { conector: { tipo: 'cilindrico', diametro: 5, profundidade: 6, folga: 0.2, quantidade: 2 } } });
  for (const p of [...r.A, ...r.B, ...r.extras]) imprimivel(p.malha, 'placa');
  assert.ok(r.avisos.length > 0 || r.relatorio.length === 0 || caixa(r.B[0].malha).min[2] >= -1e-6, 'sem aviso');
});

test('CORTE fora da peça ou em cima da face: erro claro, sem peça estragada', () => {
  const m = caixaMalha(20, 20, 20);
  for (const d of [50, -5, 20, 0]) {
    let erro = null, r = null;
    try { r = executar('cortar', { partes: [{ nome: 'c', malha: m, cor: '#1F6FEB' }], plano: { n: [0, 0, 1], d }, opc: {} }); } catch (e) { erro = e; }
    if (erro) assert.ok(/plano|corte|peça|lado/i.test(erro.message), 'mensagem: ' + erro.message);
    else for (const p of [...r.A, ...r.B]) imprimivel(p.malha, 'd=' + d);
  }
});

/* ================================================================ SELECIONAR + SEPARAR detalhes pequenos */

function comDetalhe(rDet) {
  // esfera grande com um detalhe pequeno em cima (tipo um "nariz")
  return unir([esfera(25, 5), esfera(rDet, 3, 0, 0, 25 + rDet * 0.4)]);
}
function cliqueNoTopo(m) {
  const C = centroidesFace(m); let melhor = 0;
  for (let t = 1; t < m.idx.length / 3; t++) if (C[t * 3 + 2] > C[melhor * 3 + 2]) melhor = t;
  return melhor;
}

for (const rDet of [1.5, 3]) {
  test('SELECIONAR detalhe de ' + rDet * 2 + ' mm num modelo de 50 mm: o clique não vaza pro corpo', () => {
    const m = comDetalhe(rDet);
    const adj = prepararAdjacencia(m);
    const sel = crescerRegiao(m, adj, cliqueNoTopo(m), { anguloVizinho: 30 });
    const n = contar(sel);
    assert.ok(n > 3, 'selecionou quase nada: ' + n);
    const C = centroidesFace(m);
    for (let t = 0; t < sel.length; t++) if (sel[t]) {
      const d = Math.hypot(C[t * 3], C[t * 3 + 1], C[t * 3 + 2] - (25 + rDet * 0.4));
      assert.ok(d < rDet * 1.6, 'vazou pro corpo: face a ' + d.toFixed(2) + ' mm do detalhe');
    }
  });

  test('SEPARAR detalhe de ' + rDet * 2 + ' mm: duas peças fechadas, volume conservado, com e sem pino', () => {
    const m = comDetalhe(rDet);
    const adj = prepararAdjacencia(m);
    const sel = crescerRegiao(m, adj, cliqueNoTopo(m), { anguloVizinho: 30 });
    const v0 = volume(m);
    for (const conector of [null, { tipo: 'cilindrico', diametro: Math.min(2, rDet), profundidade: 2, folga: 0.15 }]) {
      const r = executar('separarDetalhe', { parte: { nome: 'corpo', malha: m, cor: '#1B1B1B' }, mascara: sel, opc: { conector, nomeDetalhe: 'nariz' } });
      imprimivel(r.principal.malha, 'principal ' + rDet);
      imprimivel(r.detalhe.malha, 'detalhe ' + rDet);
      if (!conector) perto(volume(r.principal.malha) + volume(r.detalhe.malha), v0, 5e-3, 'volume');
      assert.ok(volInter(r.principal.malha, r.detalhe.malha) < 1e-3, 'peças se atravessam');
      const cd = caixa(r.detalhe.malha);
      assert.ok(cd.max[2] > 25 + rDet * 0.4 + rDet * 0.9, 'detalhe saiu do lugar');
    }
  });
}

test('SEPARAR: pino maior que o detalhe não quebra (avisa ou fica sem pino)', () => {
  const m = comDetalhe(1.5);
  const sel = crescerRegiao(m, prepararAdjacencia(m), cliqueNoTopo(m), { anguloVizinho: 30 });
  const r = executar('separarDetalhe', { parte: { nome: 'corpo', malha: m, cor: '#1B1B1B' }, mascara: sel, opc: { conector: { tipo: 'cilindrico', diametro: 6, profundidade: 5, folga: 0.2 } } });
  imprimivel(r.principal.malha, 'principal');
  imprimivel(r.detalhe.malha, 'detalhe');
  assert.ok(volInter(r.principal.malha, r.detalhe.malha) < 1e-3, 'peças se atravessam');
});

test('SEPARAR região pintada numa face plana (sem dobra) vira peça com espessura', () => {
  const m = caixaMalha(40, 40, 10);
  // subdivide a face de cima pra ter o que selecionar: usa uma caixa unida com uma "etiqueta" rente
  const base = unir([m, caixaMalha(10, 10, 0.6, 15, 15, 9.9)]);
  const C = centroidesFace(base), sel = new Uint8Array(base.idx.length / 3);
  for (let t = 0; t < sel.length; t++) if (C[t * 3 + 2] > 10.3 && C[t * 3] > 15 && C[t * 3] < 25 && C[t * 3 + 1] > 15 && C[t * 3 + 1] < 25) sel[t] = 1;
  assert.ok(contar(sel) > 0);
  const r = executar('separarDetalhe', { parte: { nome: 'base', malha: base, cor: '#1B1B1B' }, mascara: sel, opc: { profundidade: 1, folga: 0.1, nomeDetalhe: 'etiqueta' } });
  imprimivel(r.principal.malha, 'principal');
  imprimivel(r.detalhe.malha, 'etiqueta');
  assert.ok(volInter(r.principal.malha, r.detalhe.malha) < 1e-3, 'peças se atravessam');
});

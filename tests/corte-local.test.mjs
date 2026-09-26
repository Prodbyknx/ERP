// CORTE LOCAL e SEPARAR PARTE ORGÂNICA num boneco realista (mãos com dedos a
// ~7 mm da coxa, pescoço, pés), em 4 versões: limpo, "IA" denso com pele
// irregular, cascas sobrepostas e STL cru com buracos. Cada caso confere:
// 2 sólidos fechados, nenhum cruzamento NOVO, volume conservado, só a parte
// clicada saiu, encaixe que cabe (pino dentro do furo sem sobrepor) e 3MF que
// volta igual.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { gerarBoneco } from './util/boneco.mjs';
import { sugerirSeparacao, cortarLocal } from '../src/estudio3d/core/corteLocal.js';
import { cortarPorPlano } from '../src/estudio3d/core/corte.js';
import { separarDetalhe } from '../src/estudio3d/core/separar.js';
import { comContexto } from '../src/estudio3d/core/solidos.js';
import { solidoPronto } from '../src/estudio3d/core/preparo.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, centroidesFace } from '../src/estudio3d/core/malha.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';

await carregarManifold();
const BONECOS = {}; for (const v of ['limpo', 'ia', 'cascas', 'sujo']) BONECOS[v] = gerarBoneco(v);
// referência: o sólido que o motor usa (consertado / cascas unidas) e seus cruzamentos
const REF = {};
for (const [v, b] of Object.entries(BONECOS)) REF[v] = comContexto(ctx => { const s = solidoPronto(ctx, { nome: 'B', malha: b.malha, cor: '#999999' }, []); const p = ctx.parte(s, 'B', '#999999'); return { vol: s.volume(), ai: validar(p.malha, { completo: true }).autoInterseccoes }; });
const CLIQUES = { mao: [25.7, -1, 31], cabeca: [0, -12, 99], dedo: [23.5, -1.2, 19], pe: [8, -12.5, 3] };
const ESPERADO = { mao: [200, 700], cabeca: [5000, 9000], dedo: [5, 40], pe: [400, 1500] };   // mm³ da parte que sai

function valido(m, rot) {
  const v = validar(m, { completo: true });
  assert.ok(v.fechada && v.volume > 0 && !v.facesDegeneradas && v.componentesInvertidos === 0, rot + ' ' + JSON.stringify({ f: v.fechada, deg: v.facesDegeneradas, inv: v.componentesInvertidos }));
  return v;
}
const volInter = (a, b) => comContexto(ctx => ctx.guardar(ctx.solido({ malha: a }).intersect(ctx.solido({ malha: b }))).volume());

for (const v of ['limpo', 'ia', 'cascas', 'sujo']) {
  test('SEPARAR PARTE (' + v + '): mão, cabeça, dedo e pé — só a parte clicada sai, 2 sólidos válidos', () => {
    const parte = { nome: 'Boneco', malha: BONECOS[v].malha, cor: '#999999' };
    for (const [k, p] of Object.entries(CLIQUES)) {
      const t0 = Date.now();
      const s = sugerirSeparacao([parte], p);
      const ms = Date.now() - t0;
      assert.ok(ms < 6000, k + ': sugestão lenta ' + ms + ' ms');
      const r = cortarLocal([parte], s.plano, p, {});
      assert.equal(r.A.length, 1); assert.equal(r.B.length, 1);
      const va = valido(r.A[0].malha, v + ' ' + k + ' parte'), vb = valido(r.B[0].malha, v + ' ' + k + ' resto');
      assert.equal(va.componentes, 1, k + ': a parte é um pedaço só');
      assert.equal(vb.componentes, 1, k + ': o resto continua um sólido só (o plano não cortou o corpo)');
      assert.ok(va.autoInterseccoes + vb.autoInterseccoes <= REF[v].ai, k + ': cruzamento novo ' + (va.autoInterseccoes + vb.autoInterseccoes) + ' > ' + REF[v].ai);
      assert.ok(va.volume > ESPERADO[k][0] && va.volume < ESPERADO[k][1], k + ': volume da parte ' + va.volume.toFixed(0));
      assert.ok(Math.abs(va.volume + vb.volume - REF[v].vol) < 1e-3 * REF[v].vol, k + ': volume não fecha');
    }
  });
}

test('SEPARAR MÃO COM ENCAIXE: corte anda até caber pino, pino entra no furo com folga, 3MF volta igual', () => {
  for (const v of ['limpo', 'sujo']) {
    const parte = { nome: 'Boneco', malha: BONECOS[v].malha, cor: '#999999' };
    const s = sugerirSeparacao([parte], CLIQUES.mao, { encaixe: true });
    const r = cortarLocal([parte], s.plano, CLIQUES.mao, { conector: { tipo: 'cilindrico', auto: true, folga: 0.2, quantidade: 1 } });
    assert.equal(r.relatorio.length, 1, 'sem pino: ' + r.avisos.join(' | '));
    const c = r.relatorio[0], d = parseFloat(c.pino.replace(/[^\d,]/g, '').replace(',', '.')), f = parseFloat(c.furo.replace(/[^\d,]/g, '').replace(',', '.'));
    assert.ok(d >= 3, 'pino Ø' + d);
    assert.ok(Math.abs(f - d - 0.4) < 1e-6, 'furo = pino + 2×folga');
    const A = r.A[0].malha, B = r.B[0].malha;
    valido(A, 'mão'); valido(B, 'resto');
    assert.ok(volInter(A, B) < 0.01, 'pino e furo se sobrepõem');
    // 3MF (as 2 peças) volta com o mesmo volume
    const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'B', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: [{ nome: 'resto', malha: B, cor: '#999999' }, { nome: 'mão', malha: A, cor: '#999999' }] }] }, opc: {} });
    const imp = executar('importar', { nome: 'x.3mf', bytes: x.bytes, extras: {} });
    const vols = imp.objetos[0].partes.map(p => validar(p.malha, {}).volume).sort((a, b) => a - b);
    const orig = [validar(A, {}).volume, validar(B, {}).volume].sort((a, b) => a - b);
    vols.forEach((vv, i) => assert.ok(Math.abs(vv - orig[i]) < 1e-3 * orig[i], '3MF mudou o volume'));
  }
});

test('CORTE COM ENCAIXE na peça inteira: cascas sobrepostas e STL cru ganham os 2 pinos (antes: pulados / "Not manifold")', () => {
  for (const v of ['cascas', 'sujo', 'ia']) {
    const r = cortarPorPlano([{ nome: 'B', malha: BONECOS[v].malha, cor: '#999999' }], { n: [0, 0, 1], d: 48 }, { conector: { tipo: 'cilindrico', diametro: 5, profundidade: 6, folga: 0.2, quantidade: 2 } });
    assert.equal(r.relatorio.length, 2, v + ': ' + r.avisos.join(' | '));
    for (const p of [...r.A, ...r.B]) { const vv = valido(p.malha, v); assert.ok(vv.autoInterseccoes <= REF[v].ai, v + ' cruzamento novo'); }
    assert.ok(volInter(r.A[0].malha, r.B[0].malha) < 0.01);
  }
});

test('SEPARAR pela seleção (pincel na mão inteira): plano com pino; seleção parcial torta é recusada com orientação (nunca peça quebrada)', () => {
  const b = BONECOS.limpo, C = centroidesFace(b.malha), nt = C.length / 3;
  const pincel = R => { const m = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (Math.hypot(C[t * 3] - 23.5, C[t * 3 + 1] + 1.5, (C[t * 3 + 2] - 28) / 1.6) < R) m[t] = 1; return m; };
  const parte = { nome: 'B', malha: b.malha, cor: '#999999' };
  const r = separarDetalhe(parte, pincel(9), { conector: { tipo: 'cilindrico', auto: true, folga: 0.2, quantidade: 1 } });
  assert.ok(r.metodos.every(x => x === 'plano' || x === 'plano-local'), r.metodos.join());
  assert.equal(r.relatorio.length, 1, 'pino');
  valido(r.detalhe.malha, 'mão'); const vr = valido(r.principal.malha, 'resto');
  assert.equal(vr.componentes, 1);
  assert.throws(() => separarDetalhe(parte, pincel(5), {}), /Só uma parte|ajuste a seleção/);
});

test('cascas sobrepostas pela seleção: vira um sólido antes (mão sai inteira, sem sobreposição)', () => {
  const b = BONECOS.cascas, C = centroidesFace(b.malha), nt = C.length / 3, m = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) if (Math.hypot(C[t * 3] - 23.5, C[t * 3 + 1] + 1.5, (C[t * 3 + 2] - 28) / 1.6) < 9) m[t] = 1;
  const r = separarDetalhe({ nome: 'B', malha: b.malha, cor: '#999999' }, m, {});
  const vd = valido(r.detalhe.malha, 'mão'), vr = valido(r.principal.malha, 'resto');
  assert.equal(vd.autoInterseccoes, 0); assert.equal(vr.autoInterseccoes, 0); assert.equal(vr.componentes, 1);
  assert.ok(r.avisos.some(a => /cascas/.test(a)));
  assert.ok(caixa(r.detalhe.malha).tam[2] > 15, 'mão inteira');
});

test('SELECIONAR PARTE até o ponto fino (orelha/mão/cabeça num clique) e Separar essa seleção: plano, 2 sólidos', async () => {
  const { parteAlemDoPlano, prepararAdjacencia } = await import('../src/estudio3d/core/selecao.js');
  const { construirBVH, lancarRaio } = await import('../src/estudio3d/core/bvh.js');
  const { soldar } = await import('../src/estudio3d/core/malha.js');
  for (const v of ['ia', 'sujo']) {
  // 'sujo' soldado como o importador faz (o STL cru chega com buracos e invertidos)
  const m = v === 'sujo' ? soldar(BONECOS[v].malha).malha : BONECOS[v].malha, adj = prepararAdjacencia(m), bvh = construirBVH(m);
  for (const [k, p, dir] of [['mao', CLIQUES.mao, [-1, 0, 0]], ['cabeca', CLIQUES.cabeca, [0, 1, 0]]]) {
    // face clicada: raio vindo de fora na direção da peça
    const h = lancarRaio(bvh, p[0] - dir[0] * 5, p[1] - dir[1] * 5, p[2] - dir[2] * 5, dir[0], dir[1], dir[2]);
    assert.ok(h && h.face >= 0, k + ' sem face');
    const s = sugerirSeparacao([{ nome: 'B', malha: m, cor: '#999999' }], p);
    const mask = parteAlemDoPlano(m, adj, h.face, s.plano);
    const r = separarDetalhe({ nome: 'B', malha: m, cor: '#999999' }, mask, {});
    assert.ok(r.metodos.every(x => /plano/.test(x)), k + ' ' + r.metodos.join());
    const vd = valido(r.detalhe.malha, k), vr = valido(r.principal.malha, k + ' resto');
    assert.equal(vr.componentes, 1);
    assert.ok(vd.volume > ESPERADO[k][0] && vd.volume < ESPERADO[k][1], k + ' volume ' + vd.volume);
    if (v === 'sujo') assert.ok(r.avisos.some(a => /Consertei/.test(a)), 'conserto automático');
  }
  }
});

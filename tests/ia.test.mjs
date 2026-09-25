// Auditoria num personagem denso "de IA": seleção de detalhes pequenos,
// pincel, adicionar/remover, expandir/reduzir, separação, corte, reparo, cor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarManifold } from './util/manifold.mjs';
import { gerarPersonagem, PONTOS } from './util/personagem.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { comContexto } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { volume, caixa, centroidesFace, subMalha } from '../src/estudio3d/core/malha.js';
import { prepararAdjacencia, crescerRegiao, componenteConectado, expandir, reduzir, uniao, subtrair, contar, similar, facesNaEsfera, suavizarBorda, porCor } from '../src/estudio3d/core/selecao.js';
import { tirarFaces } from './util/malhas.mjs';

await carregarManifold();
const t0 = performance.now();
const { malha: M, paleta } = gerarPersonagem();
const NT = M.idx.length / 3;
const C = centroidesFace(M);
const ADJ = prepararAdjacencia(M);
console.log('# personagem: ' + NT + ' triângulos, gerado em ' + Math.round(performance.now() - t0) + ' ms');

function imprimivel(m, rot) {
  const v = validar(m, { completo: true });
  const r = { abertas: v.arestasAbertas, nm: v.arestasNaoManifold, nmv: v.verticesNaoManifold, inv: v.orientacaoTrocada + v.componentesInvertidos, deg: v.facesDegeneradas, dup: v.facesDuplicadas, ai: v.autoInterseccoes };
  assert.ok(!r.abertas && !r.nm && !r.nmv && !r.inv && !r.deg && !r.dup && !r.ai && v.volume > 0, rot + ': ' + JSON.stringify(r));
  return v;
}
const volInter = (a, b) => comContexto(ctx => ctx.guardar(ctx.solido({ malha: a, cor: '#000' }).intersect(ctx.solido({ malha: b, cor: '#000' }))).volume());
const dist = (t, p) => Math.hypot(C[t * 3] - p[0], C[t * 3 + 1] - p[1], C[t * 3 + 2] - p[2]);
// "clique": face mais perto do ponto
function clique(p) { let b = 0, bd = Infinity; for (let t = 0; t < NT; t++) { const d = dist(t, p); if (d < bd) { bd = d; b = t; } } return b; }
const tempo = (rot, f) => { const a = performance.now(); const r = f(); const ms = performance.now() - a; console.log('#   ' + rot + ': ' + Math.round(ms) + ' ms'); return r; };
const frente = (p, r) => [p[0], p[1] - r, p[2]];

test('personagem de teste é um sólido válido, denso, com 2 cascas e 3 cores', () => {
  assert.ok(NT > 200000, 'denso: ' + NT);
  const v = imprimivel(M, 'personagem');
  assert.equal(v.componentes, 2);
  assert.ok(M.cor.some(c => c === 1) && M.cor.some(c => c === 2));
});

const DETALHES = {
  'olho esquerdo': { alvo: frente(PONTOS.olhoE, PONTOS.raioOlho), centro: PONTOS.olhoE, raio: PONTOS.raioOlho * 1.35, min: 300, vol: 10 },
  'botão': { alvo: [0, -19, 20], centro: [0, -18.4, 20], raio: 3.6, min: 60, vol: 20 },
  'estrela': { alvo: [7.5, -17.3, 28], centro: [7.5, -16.8, 28], raio: 3.8, min: 20, vol: 3 },
  'orelha direita': { alvo: [10, 0, 62.8], centro: PONTOS.orelhaD, raio: 8.5, min: 1500, vol: 100 },
  'laço do sapato': { alvo: [10.05, -13, 7.35], centro: PONTOS.laco, raio: 2.4, min: 40, vol: 2 }
};

for (const [nome, d] of Object.entries(DETALHES)) {
  test('SELECIONAR ' + nome + ' com UM clique: pega o detalhe e não vaza pro corpo', () => {
    const sel = tempo('clique ' + nome, () => crescerRegiao(M, ADJ, clique(d.alvo), { anguloVizinho: 30, detalhe: true }));
    const n = contar(sel);
    let fora = 0, pior = 0;
    for (let t = 0; t < NT; t++) if (sel[t]) { const x = dist(t, d.centro); if (x > d.raio) { fora++; pior = Math.max(pior, x); } }
    assert.ok(n >= d.min, nome + ': selecionou só ' + n + ' faces');
    assert.equal(fora, 0, nome + ': ' + fora + ' faces fora do detalhe (a até ' + pior.toFixed(1) + ' mm)');
  });
}

test('SELECIONAR: olhos a 4,6 mm um do outro não se misturam; somar e tirar da seleção', () => {
  const e = crescerRegiao(M, ADJ, clique(frente(PONTOS.olhoE, PONTOS.raioOlho)), { anguloVizinho: 30, detalhe: true });
  const dd = crescerRegiao(M, ADJ, clique(frente(PONTOS.olhoD, PONTOS.raioOlho)), { anguloVizinho: 30, detalhe: true });
  for (let t = 0; t < NT; t++) assert.ok(!(e[t] && dd[t]), 'mesma face nos dois olhos');
  const ambos = uniao(e, dd);
  assert.equal(contar(ambos), contar(e) + contar(dd));
  assert.equal(contar(subtrair(ambos, dd)), contar(e));
});

test('SELECIONAR: expandir cresce, reduzir volta, suavizar e "conectado" pega só a casca certa', () => {
  const e = crescerRegiao(M, ADJ, clique(frente(PONTOS.olhoE, PONTOS.raioOlho)), { anguloVizinho: 30, detalhe: true });
  const x2 = tempo('expandir 2 anéis', () => expandir(e, ADJ, 2));
  assert.ok(contar(x2) > contar(e));
  for (let t = 0; t < NT; t++) if (e[t]) assert.ok(x2[t], 'expandir perdeu face');
  const volta = reduzir(x2, ADJ, 2);
  // expandir+reduzir = "fechar" a seleção: contém a original e fica perto dela
  for (let t = 0; t < NT; t++) if (e[t]) assert.ok(volta[t], 'reduzir tirou face da seleção original');
  assert.ok(contar(volta) <= contar(e) * 1.1, 'reduzir não voltou: ' + contar(volta) + ' vs ' + contar(e));
  const r1 = reduzir(e, ADJ, 1);
  assert.ok(contar(r1) < contar(e));
  for (let t = 0; t < NT; t++) if (r1[t]) assert.ok(e[t], 'reduzir criou face nova');
  const sv = suavizarBorda(e, ADJ, 2);
  assert.ok(Math.abs(contar(sv) - contar(e)) < contar(e) * 0.2);
  // conectado: clicar no corpo pega o personagem, não a argola solta
  const corpo = tempo('casca inteira', () => componenteConectado(M, ADJ, clique(PONTOS.botao)));
  for (let t = 0; t < NT; t++) if (corpo[t]) assert.ok(C[t * 3] > -25, 'pegou a argola solta');
  assert.ok(contar(corpo) > NT * 0.9);
});

test('SELECIONAR "mesma cor" pega os DOIS olhos e só eles; "similar" = mesma cor E mesma direção', () => {
  const k = M.cor[clique(frente(PONTOS.olhoE, PONTOS.raioOlho))];
  const s = tempo('mesma cor', () => porCor(M, k));
  let brancos = 0, sel = 0, errado = 0;
  for (let t = 0; t < NT; t++) { if (M.cor[t] === 1) brancos++; if (s[t]) { sel++; if (M.cor[t] !== 1) errado++; } }
  assert.equal(sel, brancos); assert.equal(errado, 0);
  const e = crescerRegiao(M, ADJ, clique(frente(PONTOS.olhoE, PONTOS.raioOlho)), { anguloVizinho: 30, detalhe: true });
  const sm = tempo('similar', () => similar(M, ADJ, e, {}));
  const coresSel = new Set(); for (let t = 0; t < NT; t++) if (e[t]) coresSel.add(M.cor[t]);
  let novas = 0;
  for (let t = 0; t < NT; t++) if (sm[t] && !e[t]) { novas++; assert.ok(coresSel.has(M.cor[t]), 'similar pegou cor que não estava na seleção'); }
  assert.ok(novas > 0, 'similar não achou nada parecido');
});

test('PINCEL: pinta só perto do ponto e, com "só faces viradas pra mim", não atravessa a cabeça', () => {
  const p = frente(PONTOS.olhoE, PONTOS.raioOlho);
  const visao = [0, 1, 0];     // olhando da frente pra trás (+Y)
  const f = tempo('pincel r=4', () => facesNaEsfera(M, ADJ, p[0], p[1], p[2], 4, visao));
  assert.ok(f.length > 50);
  for (const t of f) { assert.ok(dist(t, p) < 4 + 1, 'fora do pincel'); assert.ok(ADJ.normais[t * 3 + 1] < 0.05, 'pintou face de costas'); }
  // pincel grande: a nuca (y>0) nunca entra
  const g = facesNaEsfera(M, ADJ, 0, -13, 44, 16, visao);
  for (const t of g) assert.ok(C[t * 3 + 1] < 6, 'atravessou pro outro lado');
});

for (const nome of ['olho esquerdo', 'botão', 'estrela', 'orelha direita']) {
  test('SEPARAR ' + nome + ' do personagem denso: 2 peças fechadas, sem colidir, volume e lugar mantidos', () => {
    const d = DETALHES[nome];
    const sel = crescerRegiao(M, ADJ, clique(d.alvo), { anguloVizinho: 30, detalhe: true });
    const r = tempo('separar ' + nome, () => executar('separarDetalhe', { parte: { nome: 'p', malha: M, cor: '#1B1B1B', paleta }, mascara: sel, opc: { nomeDetalhe: nome } }));
    imprimivel(r.principal.malha, 'principal/' + nome);
    imprimivel(r.detalhe.malha, 'detalhe/' + nome);
    assert.ok(volInter(r.principal.malha, r.detalhe.malha) < 1e-3, 'colidem');
    const v = volume(r.principal.malha) + volume(r.detalhe.malha);
    assert.ok(Math.abs(v - volume(M)) < volume(M) * 2e-3, 'volume ' + v + ' vs ' + volume(M));
    assert.ok(volume(r.detalhe.malha) >= d.vol, 'detalhe vazio/lasca: ' + volume(r.detalhe.malha).toFixed(2) + ' mm³ (esperado >= ' + d.vol + ')');
    const cd = caixa(r.detalhe.malha);
    const cc = [(cd.min[0] + cd.max[0]) / 2, (cd.min[1] + cd.max[1]) / 2, (cd.min[2] + cd.max[2]) / 2];
    assert.ok(Math.hypot(cc[0] - d.centro[0], cc[1] - d.centro[1], cc[2] - d.centro[2]) < d.raio, 'detalhe saiu do lugar');
  });
}

test('SEPARAR POR COR no personagem: preto, branco (2 olhos) e vermelho, todos imprimíveis', () => {
  const r = tempo('separar por cor', () => executar('separarPorCor', { parte: { nome: 'p', malha: M, cor: '#1B1B1B', paleta }, opc: { espessura: 0.8, folga: 0.1 } }));
  assert.deepEqual(r.pecas.map(p => p.cor).sort(), ['#1B1B1B', '#D1242F', '#FFFFFF']);
  for (const p of r.pecas) imprimivel(p.malha, p.cor);
  const b = r.pecas.find(p => p.cor === '#FFFFFF');
  assert.equal(validar(b.malha, { completo: false }).componentes, 2, 'dois olhos');
});

test('CORTAR o personagem com 2 pinos: partes fechadas, sem colidir, medida total mantida', () => {
  const r = tempo('cortar com pinos', () => executar('cortar', { partes: [{ nome: 'p', malha: M, cor: '#1B1B1B', paleta }], plano: { n: [0, 0, 1], d: 33 }, opc: { conector: { tipo: 'cilindrico', diametro: 5, profundidade: 6, folga: 0.2, quantidade: 2 } } }));
  assert.equal(r.relatorio.length, 2);
  for (const p of [...r.A, ...r.B]) imprimivel(p.malha, 'corte');
  const A = r.A[0].malha, B = r.B[0].malha;
  assert.ok(volInter(A, B) < 1e-3, 'colidem');
  const c0 = caixa(M), ca = caixa(A), cb = caixa(B);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(Math.min(ca.min[i], cb.min[i]) - c0.min[i]) < 1e-3, 'min mudou no eixo ' + i);
    assert.ok(Math.abs(Math.max(ca.max[i], cb.max[i]) - c0.max[i]) < 1e-3, 'max mudou no eixo ' + i);
  }
  // cores seguem no lugar: olhos brancos continuam na parte de cima
  const p = r.A.concat(r.B).find(x => caixa(x.malha).max[2] > 40);
  assert.ok(p.paleta && p.paleta.includes('#FFFFFF'), 'cor dos olhos perdida');
});

test('CONSERTAR o personagem com 200 buracos e faces viradas', () => {
  const tira = new Set(); let s = 5; while (tira.size < 200) { s = (s * 1103515245 + 12345) & 0x7fffffff; tira.add(s % NT); }
  const furado = tirarFaces(M, [...tira]);
  const idx = Uint32Array.from(furado.idx);
  for (let t = 0; t < idx.length / 3; t += 17) { const a = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = a; }
  const quebrado = { ...furado, idx };
  const v0 = validar(quebrado, { completo: false });
  assert.ok(v0.arestasAbertas > 0 && v0.orientacaoTrocada > 0, 'defeitos não detectados');
  const r = tempo('consertar 200 buracos', () => executar('reparar', { parte: { nome: 'p', malha: quebrado, cor: '#1B1B1B', paleta }, opc: {} }));
  imprimivel(r.parte.malha, 'consertado');
  assert.ok(Math.abs(volume(r.parte.malha) - volume(M)) < volume(M) * 2e-3);
});

test('EXPORTAR o personagem em 3MF e reabrir: mesma medida, mesmas cores, mesmo número de triângulos', () => {
  const cena = { objetos: [{ nome: 'Personagem', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 128, 128, 0, 1], partes: [{ nome: 'p', malha: M, cor: '#1B1B1B', paleta }] }] };
  const x = tempo('exportar 3MF', () => executar('exportar3MF', { cena, opc: {} }));
  const r = tempo('reabrir 3MF', () => executar('importar', { nome: 'x.3mf', bytes: x.bytes, extras: {} }));
  const p = r.objetos[0].partes[0];
  assert.equal(p.malha.idx.length / 3, NT);
  const c0 = caixa(M), c1 = caixa(p.malha);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(c0.tam[i] - c1.tam[i]) < 1e-3);
  const cores = new Set(p.paleta || [p.cor]);
  for (const h of paleta) assert.ok(cores.has(h), 'cor ' + h + ' perdida');
  let brancos0 = 0, brancos1 = 0;
  for (let t = 0; t < NT; t++) { if (M.cor[t] === 1) brancos0++; if (p.paleta[p.malha.cor[t]] === '#FFFFFF') brancos1++; }
  assert.equal(brancos1, brancos0, 'triângulos brancos');
});

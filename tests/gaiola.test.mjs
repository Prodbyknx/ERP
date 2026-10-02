// Malha editável (modelar ponto a ponto por cima da foto): as operações e a
// peça gerada — tem que sair SÓLIDO FECHADO, sem cruzamento, com o volume certo,
// com e sem espelho, com e sem suavização.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/estudio3d/core/gaiola.js';
import { validar, autoInterseccoes } from '../src/estudio3d/core/validador.js';
import { volume } from '../src/estudio3d/core/malha.js';

const X = [1, 0, 0], Z = [0, 0, 1];
const pronto = (m, msg) => {
  const r = validar(m);
  assert.equal(r.arestasAbertas, 0, msg + ': arestas abertas');
  assert.equal(r.arestasNaoManifold, 0, msg + ': non-manifold');
  assert.equal(r.orientacaoTrocada, 0, msg + ': faces viradas');
  assert.equal(r.componentesInvertidos || 0, 0, msg + ': casca do avesso');
  const x = autoInterseccoes(m);
  assert.ok(x.completo, msg + ': conferência de cruzamento incompleta');
  assert.equal(x.pares, 0, msg + ': cruzamento');
  assert.ok(volume(m) > 0, msg + ': volume');
  return r;
};
// desenha um contorno clicando pontos (no plano da foto de frente: y = 0) e fecha no 1º
function contorno(g, pts) {
  let r = G.addPonto(g, pts[0]); g = r.g; let ant = r.i; const ini = r.i;
  for (const p of pts.slice(1)) { r = G.addPonto(g, p, ant); g = r.g; ant = r.i; }
  const f = G.ligar(g, ant, ini);
  return f;
}

test('contorno de 4 pontos fechado no 1º vira face; com espessura 3 mm sai placa fechada com o volume certo', () => {
  const { g, face } = contorno(G.novaGaiola({ espessura: 3 }), [[0, 0, 0], [40, 0, 0], [40, 0, 20], [0, 0, 20]]);
  assert.equal(face, 0);
  assert.equal(g.a.length, 0, 'as bordas soltas viraram a face');
  const { malha, info } = G.gerarMalha(g);
  assert.equal(info.aberta, false);
  pronto(malha, 'placa');
  assert.ok(Math.abs(volume(malha) - 40 * 20 * 3) < 1e-6, String(volume(malha)));
});

test('ESPELHO: meio contorno começando e terminando na linha do meio vira a peça inteira, sem costura aberta', () => {
  let g = G.novaGaiola({ espessura: 2, espelho: { eixo: 0, c: 100 } });
  // metade direita de um "losango" de 60 × 40: começa no meio (x=100), vai pra direita, volta pro meio
  const r = contorno(g, [[100, 0, 0], [130, 0, 20], [100, 0, 40]]);
  g = r.g;
  assert.equal(r.face, 0);
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'losango espelhado');
  assert.ok(Math.abs(volume(malha) - (60 * 40 / 2) * 2) < 1e-6, String(volume(malha)));
  const xs = []; for (let i = 0; i < malha.pos.length; i += 3) xs.push(malha.pos[i]);
  assert.ok(Math.abs(Math.min(...xs) - 70) < 1e-9 && Math.abs(Math.max(...xs) - 130) < 1e-9, 'os dois lados: ' + Math.min(...xs) + '..' + Math.max(...xs));
});

test('ESPELHO "e vice-versa": clicar do outro lado cria o ponto do lado de verdade; perto do meio gruda nele', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 0 } });
  g = G.addPonto(g, [10, 0, 0]).g;                       // lado de verdade: direita
  assert.deepEqual(G.paraOLado(g, [-15, 0, 5]), [15, 0, 5]);
  assert.deepEqual(G.paraOLado(g, [0.4, 0, 5], 0.5), [0, 0, 5]);
  assert.deepEqual(G.paraOLado(g, [7, 0, 5], 0.5), [7, 0, 5]);
});

test('puxar BORDA até um ponto (face por face): 3 faces seguidas viram uma faixa fechada com espessura', () => {
  let g = G.novaGaiola({ espessura: 2 });
  let r = G.addPonto(g, [0, 0, 0]); g = r.g;
  r = G.addPonto(g, [0, 0, 10], 0); g = r.g;
  let borda = [0, 1];
  for (const x of [10, 20, 30]) { const e = G.extrudarBorda(g, borda[0], borda[1], [x, 0, 5]); g = e.g; borda = e.borda; }
  assert.equal(g.f.length, 3);
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'faixa');
  assert.ok(Math.abs(volume(malha) - 30 * 10 * 2) < 1e-6, String(volume(malha)));
});

test('CUBO espelhado: só a metade fica na gaiola, a peça sai inteira e fechada; Suavizar mantém fechado e sem cruzar', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 50 } });
  g = G.comecoCubo(g, [50, 0, 10], 20, X, Z).g;
  assert.equal(g.v.length, 8);
  assert.equal(g.f.length, 5, 'a face do meio não existe (o espelho cobre)');
  assert.ok(g.v.every(p => p[0] >= 50 - 1e-9), 'só o lado direito');
  let { malha } = G.gerarMalha(g);
  pronto(malha, 'cubo espelhado');
  assert.ok(Math.abs(volume(malha) - 8000) < 1e-6, String(volume(malha)));
  for (const s of [1, 2]) {
    ({ malha } = G.gerarMalha({ ...g, suave: s }));
    pronto(malha, 'cubo suave ' + s);
    assert.ok(volume(malha) > 3000 && volume(malha) < 8000, 'suave ' + s + ': ' + volume(malha));
  }
});

test('PUXAR FACE (dar volume): cubo com a face de cima puxada 10 mm continua fechado e cresce certo', () => {
  let g = G.comecoCubo(G.novaGaiola(), [0, 0, 10], 20, X, Z).g;
  const topo = g.f.findIndex(f => f.every(i => Math.abs(g.v[i][2] - 20) < 1e-9));
  g = G.extrudarFaces(g, [topo], 10).g;
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'cubo puxado');
  assert.ok(Math.abs(volume(malha) - 20 * 20 * 30) < 1e-6, String(volume(malha)));
});

test('PUXAR FACE com espelho: a face que encosta no meio puxa sem abrir parede no meio', () => {
  let g = G.comecoCubo(G.novaGaiola({ espelho: { eixo: 0, c: 0 } }), [0, 0, 10], 20, X, Z).g;
  const topo = g.f.findIndex(f => f.every(i => Math.abs(g.v[i][2] - 20) < 1e-9));
  g = G.extrudarFaces(g, [topo], 10).g;
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'espelhado puxado');
  assert.ok(Math.abs(volume(malha) - 20 * 20 * 30) < 1e-6, String(volume(malha)));
});

test('MOVER com espelho: ponto do meio fica no meio; ponto que ia atravessar para no meio', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 0 } });
  g = G.addPonto(g, [0, 0, 0]).g; g = G.addPonto(g, [5, 0, 0]).g;
  g = G.moverPontos(g, [0, 1], [-8, 0, 3]).g;
  assert.deepEqual(g.v[0], [0, 0, 3]);
  assert.deepEqual(g.v[1], [0, 0, 3]);
});

test('JUNTAR e APAGAR: a face que fica achatada some; índices continuam certos', () => {
  let { g } = contorno(G.novaGaiola({ espessura: 2 }), [[0, 0, 0], [10, 0, 0], [10, 0, 10], [5, 0, 12], [0, 0, 10]]);
  g = G.juntarPontos(g, [3, 2]).g;          // pentágono vira quadrado
  assert.equal(g.v.length, 4);
  assert.equal(g.f[0].length, 4);
  pronto(G.gerarMalha(g).malha, 'depois de juntar');
  g = G.apagarPontos(g, [0]).g;
  assert.equal(g.f.length, 0, 'face sem o ponto sai');
  assert.equal(G.gerarMalha(g).malha, null);
});

test('FAZER FACE com 4 pontos fora de ordem: ordena em volta do centro (não sai gravata)', () => {
  let g = G.novaGaiola({ espessura: 1 });
  for (const p of [[0, 0, 0], [10, 0, 10], [10, 0, 0], [0, 0, 10]]) g = G.addPonto(g, p).g;
  g = G.fazerFace(g, [0, 1, 2, 3]).g;
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'face ordenada');
  assert.ok(Math.abs(volume(malha) - 100) < 1e-6, String(volume(malha)));
});

test('DIVIDIR BORDA põe ponto no meio e as faces vizinhas continuam fechadas', () => {
  let g = G.comecoCubo(G.novaGaiola(), [0, 0, 10], 20, X, Z).g;
  const [a, b] = g.f[0];
  g = G.dividirBorda(g, a, b).g;
  assert.equal(g.v.length, 9);
  pronto(G.gerarMalha(g).malha, 'cubo com borda dividida');
});

test('uma borda com face dos 2 lados não pode ganhar 3ª face (seria parede impossível de imprimir)', () => {
  let g = G.comecoCubo(G.novaGaiola(), [0, 0, 10], 20, X, Z).g;
  const [a, b] = g.f[0];
  const r = G.extrudarBorda(g, a, b, [0, 0, 50]);
  assert.ok(r.erro && r.g === g);
});

test('APLICAR ESPELHO: os dois lados viram pontos de verdade e a peça gerada é a mesma', () => {
  let g = G.comecoCubo(G.novaGaiola({ espelho: { eixo: 0, c: 0 } }), [0, 0, 10], 20, X, Z).g;
  const antes = G.gerarMalha(g).malha;
  g = G.aplicarEspelho(g).g;
  assert.equal(g.espelho, null);
  assert.equal(g.f.length, 10, '5 faces da metade + 5 do espelho (cada lateral fica em 2 metades)');
  const depois = G.gerarMalha(g).malha;
  pronto(depois, 'cubo com espelho aplicado');
  assert.ok(Math.abs(volume(depois) - volume(antes)) < 1e-6);
});

test('ESCALA da peça vai pra gaiola: dobrar em X dobra o volume e o espelho continua no meio', () => {
  let g = G.comecoCubo(G.novaGaiola({ espelho: { eixo: 0, c: 5 } }), [5, 0, 10], 20, X, Z).g;
  const S = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  g = G.transformarGaiola(g, S);
  assert.equal(g.espelho.c, 10);
  const m = G.gerarMalha(g).malha;
  pronto(m, 'cubo esticado');
  assert.ok(Math.abs(volume(m) - 16000) < 1e-6, String(volume(m)));
  // escala torta (com cisalhamento no eixo do espelho): o espelho é aplicado antes
  const T = [1, 0.3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const h = G.transformarGaiola(G.comecoCubo(G.novaGaiola({ espelho: { eixo: 0, c: 0 } }), [0, 0, 10], 20, X, Z).g, T);
  assert.equal(h.espelho, null);
  pronto(G.gerarMalha(h).malha, 'cubo cisalhado');
});

test('PUXAR FACE numa PLACA (face na beirada): a base fica e sai um BLOCO fechado (não um copo oco)', () => {
  let { g } = contorno(G.novaGaiola({ espessura: 3 }), [[0, 0, 0], [40, 0, 0], [40, 0, 20], [0, 0, 20]]);
  const r = G.extrudarFaces(g, [0], 15, { para: [0, -1, 0] });
  assert.equal(r.fechou, true);
  g = r.g;
  const { malha, info } = G.gerarMalha(g);
  assert.equal(info.bordasAbertas, 0, 'fechado: a espessura não entra');
  pronto(malha, 'bloco');
  assert.ok(Math.abs(volume(malha) - 40 * 20 * 15) < 1e-6, String(volume(malha)));
  // puxou pra quem olha (−Y)
  let ymin = Infinity; for (let i = 1; i < malha.pos.length; i += 3) ymin = Math.min(ymin, malha.pos[i]);
  assert.ok(Math.abs(ymin + 15) < 1e-9, String(ymin));
  // a face puxada continua escolhida e é a da frente
  assert.ok(r.faces.length === 1 && g.f[r.faces[0]].every(i => Math.abs(g.v[i][1] + 15) < 1e-9));
});

test('PUXAR FACE numa placa ESPELHADA: bloco inteiro, fechado, sem parede no meio', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 0 }, espessura: 3 });
  ({ g } = contorno(g, [[0, 0, 0], [20, 0, 0], [20, 0, 30], [0, 0, 30]]));
  g = G.extrudarFaces(g, [0], 10, { para: [0, -1, 0] }).g;
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'bloco espelhado');
  assert.ok(Math.abs(volume(malha) - 40 * 30 * 10) < 1e-6, String(volume(malha)));
});

test('contorno que CRUZA a própria linha (o "8" sem querer) é pego pelo laudo (o painel avisa)', () => {
  const { g } = contorno(G.novaGaiola({ espessura: 3 }), [[0, 0, 0], [40, 0, 20], [40, 0, 0], [0, 0, 20]]);
  const { malha } = G.gerarMalha(g);
  assert.ok(autoInterseccoes(malha).pares > 0);
});

/* ---- Desenhar unificado: o desenho vira placa / vaso / tubo pelo motor de sólidos */
import { carregarManifold } from './util/manifold.mjs';
import { criarDoDesenho } from '../src/estudio3d/core/desenho.js';
await carregarManifold();

test('FORMA do desenho: vazio, pontos, linha, contorno e malha', () => {
  let g = G.novaGaiola();
  assert.equal(G.forma(g), 'vazio');
  g = G.addPonto(g, [0, 0, 0]).g;
  assert.equal(G.forma(g), 'pontos');
  g = G.addPonto(g, [10, 0, 0], 0).g; g = G.addPonto(g, [10, 0, 10], 1).g;
  assert.equal(G.forma(g), 'linha');
  g = G.addPonto(g, [0, 0, 10], 2).g; g = G.ligar(g, 3, 0).g;
  assert.equal(G.forma(g), 'contorno');
  g = G.extrudarBorda(g, 1, 2, [20, 0, 5]).g;
  assert.equal(G.forma(g), 'malha');
});

test('CONTORNO espelhado vira PLACA pelo motor: área certa, espessura pra frente (pra quem olha)', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 100 }, frente: [0, -1, 0] });
  ({ g } = contorno(g, [[100, 50, 0], [130, 50, 20], [100, 50, 40]]));
  assert.equal(G.forma(g), 'contorno');
  const pts = G.contornoCompleto(g);
  assert.equal(pts.length, 4, 'meio contorno + o outro lado');
  const plano = G.planoDoContorno(g, pts);
  const r = criarDoDesenho(pts, 'extrudar', { espessura: 3, plano, manterPosicao: true });
  pronto(r.malha, 'placa do motor');
  assert.ok(Math.abs(volume(r.malha) - 60 * 40 / 2 * 3) < 0.5, String(volume(r.malha)));
  let ymin = Infinity, ymax = -Infinity; for (let i = 1; i < r.malha.pos.length; i += 3) { ymin = Math.min(ymin, r.malha.pos[i]); ymax = Math.max(ymax, r.malha.pos[i]); }
  assert.ok(Math.abs(ymax - 50) < 1e-6 && Math.abs(ymin - 47) < 1e-6, ymin + '..' + ymax);
});

test('VASO: meio perfil com o eixo na linha do meio vira sólido girado (cilindro 10 × 20 ≈ π·100·20)', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 0 }, frente: [0, -1, 0] });
  ({ g } = contorno(g, [[0, 0, 0], [10, 0, 0], [10, 0, 20], [0, 0, 20]]));
  const perfil = G.perfilDoVaso(g);
  const plano = G.planoDoContorno(g, perfil);
  const r = criarDoDesenho(perfil, 'revolucionar', { graus: 360, plano, manterPosicao: true });
  pronto(r.malha, 'vaso');
  assert.ok(Math.abs(volume(r.malha) - Math.PI * 100 * 20) / (Math.PI * 100 * 20) < 0.02, String(volume(r.malha)));
});

test('LINHA espelhada: começa no meio -> um caminho só passando pelo meio; vira TUBO fechado', () => {
  let g = G.novaGaiola({ espelho: { eixo: 0, c: 0 } });
  g = G.addPonto(g, [0, 0, 5]).g; g = G.addPonto(g, [20, 0, 5], 0).g; g = G.addPonto(g, [30, 0, 25], 1).g;
  assert.equal(G.forma(g), 'linha');
  const L = G.linhaCompleta(g);
  assert.equal(L.caminhos.length, 1);
  assert.equal(L.caminhos[0].length, 5);
  assert.deepEqual(L.caminhos[0][0], [-30, 0, 25]);
  const r = criarDoDesenho(L.caminhos[0], 'tubo', { diametro: 4, manterPosicao: true });
  pronto(r.malha, 'tubo');
  // linha que não encosta no meio: 2 caminhos (o lado e o espelho)
  let h = G.novaGaiola({ espelho: { eixo: 0, c: 0 } });
  h = G.addPonto(h, [5, 0, 0]).g; h = G.addPonto(h, [15, 0, 0], 0).g;
  assert.equal(G.linhaCompleta(h).caminhos.length, 2);
});

test('PLACA da malha (várias faces) também sai pra frente, do plano do desenho até a espessura', () => {
  let { g } = contorno(G.novaGaiola({ espessura: 2, frente: [0, -1, 0] }), [[0, 10, 0], [20, 10, 0], [20, 10, 10], [0, 10, 10]]);
  g = G.extrudarBorda(g, 1, 2, [30, 10, 5]).g;
  const { malha } = G.gerarMalha(g);
  pronto(malha, 'malha pra frente');
  let ymin = Infinity, ymax = -Infinity; for (let i = 1; i < malha.pos.length; i += 3) { ymin = Math.min(ymin, malha.pos[i]); ymax = Math.max(ymax, malha.pos[i]); }
  assert.ok(Math.abs(ymax - 10) < 1e-9 && Math.abs(ymin - 8) < 1e-9, ymin + '..' + ymax);
});

test('contorno em "8" (os dois laços se anulam na área): continua sendo CONTORNO no plano certo; o motor faz os 2 laços', () => {
  const { g } = contorno(G.novaGaiola({ frente: [0, -1, 0] }), [[-20, 50, 0], [20, 50, 20], [20, 50, 0], [-20, 50, 20]]);
  assert.equal(G.forma(g), 'contorno');
  const pts = G.contornoCompleto(g), plano = G.planoDoContorno(g, pts);
  assert.ok(plano && Math.abs(Math.abs(plano.n[1]) - 1) < 1e-9, 'plano de frente');
  const r = criarDoDesenho(pts, 'extrudar', { espessura: 3, plano, manterPosicao: true });
  // os dois laços: 400 mm² × 3 mm, de pé no plano de frente (o painel avisa que ficam presos por um ponto)
  assert.ok(Math.abs(volume(r.malha) - 400 * 3) < 1, String(volume(r.malha)));
  const v = validar(r.malha);
  assert.equal(v.arestasAbertas, 0);
  assert.equal(v.componentes, 2, 'os 2 laços saem separados, só se tocando: o painel avisa');
});

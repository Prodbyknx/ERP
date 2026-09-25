// Fotos -> 3D por silhuetas (sem IA), testado contra um objeto conhecido:
// o personagem denso é "fotografado" (cor + sombra + fundo branco) e o
// pipeline só recebe as imagens. Confere fechado/imprimível, altura em mm,
// fidelidade por vista, se contém o objeto, cores e o caminho pro editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { carregarManifold } from './util/manifold.mjs';
import { gerarPersonagem } from './util/personagem.mjs';
import { escreverPNG } from './util/png.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { fotosPara3D, rasterizar, eixosDaVista, VISTAS } from '../src/estudio3d/core/ia/reconstrucao.js';
import { comContexto } from '../src/estudio3d/core/solidos.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { volume, caixa, normaisFace, transladar } from '../src/estudio3d/core/malha.js';

await carregarManifold();
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const saida = path.join(raiz, 'dist', 'ia-demo'); fs.mkdirSync(saida, { recursive: true });
const { malha: P0, paleta: PAL } = gerarPersonagem({ argola: false });
// só o personagem (sem a argola solta), com o pé na mesa e centrado
const GT = (() => { const c = caixa(P0); return transladar(P0, -(c.min[0] + c.max[0]) / 2, -(c.min[1] + c.max[1]) / 2, -c.min[2]); })();
const H = caixa(GT).tam[2];
const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// "fotografa" o objeto: ortográfica, 480×480, fundo branco, sombra suave
function foto(nomeVista, W = 480) {
  const e = eixosDaVista(nomeVista), s = (H * 1.25) / W;
  const cfg = VISTAS[nomeVista].topo ? { w: W, h: W, s, cx: W / 2, cy: W / 2 } : { w: W, h: W, s, cx: W / 2, cy: W * 0.92 };
  const r = rasterizar(GT, e, cfg), N = normaisFace(GT);
  const rgba = new Uint8Array(W * W * 4).fill(255);
  for (let i = 0; i < W * W; i++) {
    const t = r.tri[i]; if (t < 0) continue;
    const c = hexRGB(PAL[GT.cor[t]] || PAL[0]);
    const luz = 0.55 + 0.45 * Math.max(0, -(N[t * 3] * e.f[0] + N[t * 3 + 1] * e.f[1] + N[t * 3 + 2] * e.f[2]));
    rgba[i * 4] = c[0] * luz; rgba[i * 4 + 1] = c[1] * luz; rgba[i * 4 + 2] = c[2] * luz;
  }
  return { vista: nomeVista, rgba, w: W, h: W };
}
const FOTOS = {}; for (const v of Object.keys(VISTAS)) FOTOS[v] = foto(v);
for (const [v, f] of Object.entries(FOTOS)) fs.writeFileSync(path.join(saida, 'foto-' + v + '.png'), escreverPNG(f.rgba, f.w, f.h));

function imprimivel(m, rot) {
  const v = validar(m, { completo: true });
  const r = { abertas: v.arestasAbertas, nm: v.arestasNaoManifold, nmv: v.verticesNaoManifold, inv: v.orientacaoTrocada + v.componentesInvertidos, deg: v.facesDegeneradas, dup: v.facesDuplicadas, ai: v.autoInterseccoes };
  assert.ok(!r.abertas && !r.nm && !r.nmv && !r.inv && !r.deg && !r.dup && !r.ai && v.volume > 0, rot + ': ' + JSON.stringify(r));
  return v;
}
const volInter = (a, b) => comContexto(ctx => ctx.guardar(ctx.solido({ malha: a, cor: '#000' }).intersect(ctx.solido({ malha: b, cor: '#000' }))).volume());
const RES = {};

for (const [rot, vistas] of [['4 vistas', ['frente', 'costas', 'esquerda', 'direita']], ['6 vistas (+ 3/4)', ['frente', 'costas', 'esquerda', 'direita', 'frenteEsquerda', 'frenteDireita']], ['9 vistas (+ cima)', Object.keys(VISTAS)]]) {
  test('FOTOS -> 3D com ' + rot + ': fechado, altura certa, silhueta confere, contém o objeto', () => {
    const r = executar('fotosPara3D', { entradas: vistas.map(v => FOTOS[v]), opc: { alturaMM: H } });
    const v = imprimivel(r.malha, rot);
    assert.equal(v.componentes, 1);
    assert.ok(Math.abs(caixa(r.malha).tam[2] - H) < H * 0.02, 'altura ' + caixa(r.malha).tam[2].toFixed(2) + ' vs ' + H.toFixed(2));
    for (const [vv, iou] of Object.entries(r.relatorio.fidelidade)) assert.ok(iou > 0.95, 'fidelidade ' + vv + ' = ' + iou.toFixed(3));
    const vg = volume(GT), vr = volume(r.malha), dentro = volInter(GT, r.malha);
    assert.ok(dentro > 0.95 * vg, 'o objeto real não cabe no modelo: ' + (dentro / vg).toFixed(3));
    RES[rot] = { triangulos: r.relatorio.triangulos, volumeSobra: (vr / vg - 1), fidelidade: r.relatorio.fidelidade, ms: r.relatorio.ms, paleta: r.paleta };
    console.log('# ' + rot + ': ' + r.relatorio.triangulos + ' triângulos, sobra de volume ' + ((vr / vg - 1) * 100).toFixed(1) + '%, ' + r.relatorio.ms + ' ms, fidelidade mínima ' + Math.min(...Object.values(r.relatorio.fidelidade)).toFixed(3) + ', cores ' + (r.paleta || [r.cor]).join(' '));
    if (rot.startsWith('9')) {
      fs.writeFileSync(path.join(saida, 'modelo-das-fotos.3mf'), executar('exportar3MF', { cena: { objetos: [{ nome: 'Modelo das fotos (9 vistas)', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 128, 128, 0, 1], partes: [{ nome: 'Modelo', malha: r.malha, cor: r.cor, paleta: r.paleta }] }] }, opc: {} }).bytes);
      RES.ultimo = r;
    }
  });
}

test('mais vistas = modelo mais justo (menos volume sobrando)', () => {
  assert.ok(RES['6 vistas (+ 3/4)'].volumeSobra < RES['4 vistas'].volumeSobra, JSON.stringify(RES));
  assert.ok(RES['9 vistas (+ cima)'].volumeSobra <= RES['6 vistas (+ 3/4)'].volumeSobra + 0.01);
});

test('CORES das fotos viram regiões: preto, branco (olhos) e vermelho (botão) -> Separar por cor imprimível', () => {
  const r = RES.ultimo;
  assert.ok(r.paleta && r.paleta.length >= 3, 'paleta ' + JSON.stringify(r.paleta));
  const lum = h => { const [a, b, c] = hexRGB(h); return 0.3 * a + 0.59 * b + 0.11 * c; };
  assert.ok(r.paleta.some(h => lum(h) > 150), 'sem região clara (olhos)');
  assert.ok(r.paleta.some(h => { const [a, b, c] = hexRGB(h); return a > 1.6 * b && a > 1.6 * c; }), 'sem região vermelha (botão)');
  const s = executar('separarPorCor', { parte: { nome: 'Modelo', malha: r.malha, cor: r.cor, paleta: r.paleta }, opc: { espessura: 0.8, folga: 0.1 } });
  assert.ok(s.pecas.length >= 3);
  for (const p of s.pecas) imprimivel(p.malha, 'cor ' + p.cor);
  // arquivo pra teste real de impressão multicor (peças no lugar, uma cor cada)
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'Modelo das fotos (cores)', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 128, 128, 0, 1], partes: s.pecas }] }, opc: {} });
  fs.writeFileSync(path.join(saida, 'modelo-das-fotos-por-cor.3mf'), x.bytes);
  assert.equal(executar('importar', { nome: 'c.3mf', bytes: x.bytes, extras: {} }).objetos[0].partes.length, s.pecas.length);
});

test('RESULTADO ENTRA NO EDITOR como modelo importado: consertar, cortar com pino e 3MF', () => {
  const r = RES.ultimo;
  const rep = executar('reparar', { parte: { nome: 'Modelo', malha: r.malha, cor: r.cor, paleta: r.paleta }, opc: {} });
  imprimivel(rep.parte.malha, 'consertado');
  const c = executar('cortar', { partes: [rep.parte], plano: { n: [0, 0, 1], d: H * 0.55 }, opc: { conector: { tipo: 'cilindrico', diametro: 5, profundidade: 5, folga: 0.2, quantidade: 1 } } });
  for (const p of [...c.A, ...c.B]) imprimivel(p.malha, 'corte');
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: 'M', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: c.A.concat(c.B) }] }, opc: {} });
  assert.equal(executar('importar', { nome: 'm.3mf', bytes: x.bytes, extras: {} }).objetos.length, 1);
});

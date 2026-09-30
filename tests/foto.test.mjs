// FOTO no gerador: detecção (foto × logo), pôster (cores chapadas, sem mancha
// que não imprime) e litofania (espessura pela luz, sólido fechado, tons certos).
// Fotos CC0/domínio público do scikit-image (tests/fixtures/fotos/LICENCA.txt).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarManifold } from './util/manifold.mjs';
import { lerImagem } from '../mcp/imagem.mjs';
import { analisar } from '../src/gerador/analise.js';
import { posterizar } from '../src/gerador/poster.js';
import { construir } from '../src/gerador/chaveiro.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { criar } from '../src/estudio3d/core/malha.js';
import * as M from '../src/gerador/mascara.js';

await carregarManifold();
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = arq => { const img = lerImagem(new Uint8Array(fs.readFileSync(arq)), arq); return analisar({ px: img.px, w: img.largura, h: img.altura }); };
const foto = n => ler(path.join(raiz, 'fotos', n));
const solida = p => { const v = validar(criar(Float64Array.from(p.malha.pos), p.malha.idx), { completo: true }); return { ok: v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.volume > 0, v }; };

test('detecção: as 3 fotos são foto; nenhuma logo de teste é', () => {
  for (const n of ['gato.jpg', 'cafe.jpg', 'astronauta.jpg']) assert.equal(foto(n).foto.provavel, true, n);
  for (const n of fs.readdirSync(path.join(raiz, 'logos')).filter(a => /\.(png|jpg)$/.test(a) && !/verdade/.test(a))) assert.equal(ler(path.join(raiz, 'logos', n)).foto.provavel, false, n);
});

test('pôster: 2–4 cores, forma certa, nenhuma mancha menor que o mínimo, chaveiro sólido', () => {
  const an = foto('gato.jpg');
  for (const [K, forma] of [[4, 'retangulo'], [3, 'redondo'], [2, 'coracao']]) {
    const p = posterizar(an, { cores: K, forma });
    assert.equal(p.modo, 'poster');
    assert.equal(p.cores.length, K, 'cores ' + forma);
    const area = M.conta(p.silhueta), n = p.W * p.H;
    const esperado = forma === 'retangulo' ? n * 0.98 : forma === 'redondo' ? Math.PI / 4 * Math.min(p.W, p.H) ** 2 : null;
    if (esperado) assert.ok(Math.abs(area - esperado) / esperado < 0.03, forma + ' área ' + area + ' x ' + esperado);
    // nenhum pedaço de cor menor que o mínimo (0,15% da forma)
    const { pedacos } = M.rotularValores(p.rotulo, p.W, p.H);
    const menor = Math.min(...pedacos.filter(x => x.valor >= 0).map(x => x.area));
    assert.ok(menor >= Math.max(12, Math.round(area * 0.0015)) * 0.5, 'mancha de ' + menor + ' px');
    const r = construir(p, { alturas: 'iguais' });
    assert.ok(!r.erro, r.erro);
    for (const q of r.partes) assert.ok(solida(q).ok, 'malha ' + q.nome);
  }
  // mesma foto, mesmo pôster (sorteio fixo)
  assert.deepEqual(posterizar(an, { cores: 4 }).cores.map(c => c.hex), posterizar(an, { cores: 4 }).cores.map(c => c.hex));
});

test('litofania: sólido fechado, espessura entre o mín e o máx, claro = fino, escuro = grosso', () => {
  const an = foto('astronauta.jpg');
  for (const forma of ['retangulo', 'redondo', 'coracao']) {
    const r = construir(an, { modelo: 'litofania', tamanhoMM: 50, litofania: { forma } });
    assert.ok(!r.erro, r.erro);
    assert.equal(r.partes.length, 1);
    assert.equal(r.partes[0].cor, '#FFFFFF');
    const s = solida(r.partes[0]);
    assert.ok(s.ok && s.v.componentes === 1, forma + ' ' + JSON.stringify({ fechada: s.v.fechada, cruz: s.v.autoInterseccoes, comp: s.v.componentes }));
    assert.ok(Math.abs(Math.max(r.medidas.largura, r.medidas.altura - (forma === 'retangulo' ? 0 : 8)) - 50) < 7, forma + ' medidas ' + JSON.stringify(r.medidas));
    assert.equal(r.argola != null, true);
  }
  // tons: a simulação contra a luz segue a claridade da foto (correlação alta)
  const r = construir(an, { modelo: 'litofania', tamanhoMM: 60, argola: { ligada: false } });
  const s = r.litofania.simulacao, esc = r.transformada.esc, [x0, , , y1] = r.litofania.caixaMM, tx = r.transformada.tx, ty = r.transformada.ty;
  const Lf = [], Ls = [];
  for (let j = 5; j < s.h - 5; j += 7) for (let i = 5; i < s.w - 5; i += 7) {
    const X = x0 + (i + 0.5) * r.litofania.passo - tx, Y = y1 - (j + 0.5) * r.litofania.passo - ty;
    const px = Math.round(X / esc), py = Math.round(-Y / esc);
    if (px < 0 || py < 0 || px >= an.W || py >= an.H) continue;
    const k = py * an.W + px, g = 0.2126 * an.rgb[k * 3] + 0.7152 * an.rgb[k * 3 + 1] + 0.0722 * an.rgb[k * 3 + 2];
    Lf.push(g); Ls.push(s.px[j * s.w + i]);
  }
  const med = a => a.reduce((x, y) => x + y, 0) / a.length, mf = med(Lf), ms = med(Ls);
  let c = 0, vf = 0, vs = 0; for (let k = 0; k < Lf.length; k++) { c += (Lf[k] - mf) * (Ls[k] - ms); vf += (Lf[k] - mf) ** 2; vs += (Ls[k] - ms) ** 2; }
  const corr = c / Math.sqrt(vf * vs);
  assert.ok(corr > 0.9, 'correlação foto × contra a luz ' + corr.toFixed(3));
  // espessura dentro dos limites; negativo inverte
  const zs = r.partes[0].malha.pos.filter((_, i) => i % 3 === 2);
  assert.ok(Math.min(...zs) === 0 && Math.max(...zs) <= r.litofania.espMax + 0.61);
  const neg = construir(an, { modelo: 'litofania', tamanhoMM: 60, argola: { ligada: false }, litofania: { inverter: true } });
  let cn = 0; for (let k = 0; k < s.px.length; k += 97) cn += (s.px[k] - ms) * (neg.litofania.simulacao.px[k] - ms);
  assert.ok(cn < 0, 'negativo inverte os tons');
});

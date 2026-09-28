// Gerador de chaveiros (motor novo, src/gerador): fidelidade nas logos de
// teste com gabarito (1 a 4 cores, texto fino, ilhas, JPG com fundo, fundo
// preto, imagem pequena) e as garantias geométricas da peça.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarManifold } from './util/manifold.mjs';
import { lerImagem } from '../mcp/imagem.mjs';
import { analisar } from '../src/gerador/analise.js';
import { construir } from '../src/gerador/chaveiro.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { criar } from '../src/estudio3d/core/malha.js';
import { rodarMotorNovo, medirNovo } from '../tools/bench-chaveiro.mjs';

await carregarManifold();
const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'logos');
const logos = JSON.parse(fs.readFileSync(path.join(pasta, 'logos.json'), 'utf8')).filter(l => !/\.svg$/.test(l.arquivo));
const imagem = nome => { const l = logos.find(x => x.nome === nome); const img = lerImagem(new Uint8Array(fs.readFileSync(path.join(pasta, l.arquivo))), l.arquivo); return { px: img.px, w: img.largura, h: img.altura }; };
const cacheAn = new Map();
const an = nome => { if (!cacheAn.has(nome)) cacheAn.set(nome, analisar(imagem(nome))); return cacheAn.get(nome); };
const solida = p => { const v = validar(criar(Float64Array.from(p.malha.pos), p.malha.idx), { completo: true }); return v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.volume > 0; };
const zDe = p => { let a = Infinity, b = -Infinity; for (let i = 2; i < p.malha.pos.length; i += 3) { a = Math.min(a, p.malha.pos[i]); b = Math.max(b, p.malha.pos[i]); } return [+a.toFixed(3), +b.toFixed(3)]; };

// ---------- fidelidade (benchmark com limites)
for (const l of logos) {
  test('fidelidade: ' + l.nome, async () => {
    const r = await rodarMotorNovo(l);
    assert.ok(!r.erro, r.erro);
    const m = medirNovo(l, r);
    assert.equal(m.coresAchadas, m.coresReais, 'cores achadas ' + m.coresAchadas + ' de ' + m.coresReais);
    assert.ok(m.coberturaPct >= 99.9, 'a peça cobre só ' + m.coberturaPct.toFixed(1) + '% da logo');
    assert.ok(m.exatidaoPct >= 96, 'cor certa em ' + m.exatidaoPct.toFixed(1) + '% da logo');
    assert.ok(m.piorCorPct >= 94, 'pior cor ' + m.piorCorPct.toFixed(1) + '%');
    assert.ok(m.deltaEMax <= 6, 'ΔE ' + m.deltaEMax.toFixed(1));
    assert.ok(m.erroBordaMM <= 0.06, 'erro de borda ' + m.erroBordaMM.toFixed(3) + ' mm');
    assert.equal(m.argolaComeArtePct, 0, 'argola em cima da arte');
    assert.ok(m.finosPreservadosPct >= 85, 'traço fino preservado ' + m.finosPreservadosPct.toFixed(0) + '%');
    for (const p of m.malha) assert.ok(p.fechada && !p.cruzamentos && !p.degeneradas, 'malha ' + p.nome + ': ' + JSON.stringify(p));
  });
}

// ---------- análise
test('análise: fundo e cor da base certos pra cada tipo de logo', () => {
  assert.equal(an('selo-2cores').modo, 'alfa');
  assert.equal(an('escudo-3cores-jpg').modo, 'fundo');
  assert.equal(an('escudo-3cores-jpg').fundo.hex, '#FFFFFF');
  // crachá: a cor de fora vira a base (uma cor a menos pra trocar)
  assert.equal(an('sol-4cores').sugestao.motivo, 'cracha');
  assert.equal(an('sol-4cores').sugestao.corBase, '#1D4ED8');
  // texto sozinho: base contrastando; fundo liso: a cor do fundo
  assert.equal(an('texto-1cor').sugestao.corBase, '#FFFFFF');
  assert.equal(an('texto-branco-fundo-preto').sugestao.corBase, '#000000');
  // hierarquia: FC dentro da faixa branca, faixa dentro do verde
  const e = an('escudo-3cores'), c = n => e.cores.find(x => x.nome === n);
  assert.equal(e.cores[c('Preto').pai].nome, 'Branco');
  assert.equal(e.cores[c('Branco').pai].nome, 'Verde');
});

test('análise: antialias não vira cor nova e ruído do JPG não vira cor', () => {
  for (const n of ['texto-1cor', 'texto-fino', 'texto-1cor-pequena', 'ilhas']) assert.equal(an(n).cores.length, 1, n);
  assert.equal(an('escudo-3cores-jpg').cores.length, 2);   // verde e preto (o branco é o fundo)
});

// ---------- geometria
test('base sai numa peça só, mesmo com partes soltas na logo (ilhas)', () => {
  const r = construir(an('ilhas'), {});
  const base = r.partes.find(p => p.nome === 'Base');
  const v = validar(criar(Float64Array.from(base.malha.pos), base.malha.idx), { completo: true });
  assert.equal(v.componentes, 1);
  assert.ok(solida(base));
});

test('argola: nunca encosta na arte e o furo passa inteiro', () => {
  for (const pos of ['topo', 'esquerda', 'direita', 'canto']) {
    const r = construir(an('texto-1cor'), { argola: { posicao: pos } });
    assert.ok(r.argola, pos);
    const a = an('texto-1cor'), { esc } = r.transformada;
    // distância do centro da argola até o pixel de arte mais perto >= raio da alça
    let dm = Infinity;
    for (let y = 0; y < a.H; y++) for (let x = 0; x < a.W; x++) if (a.silhueta[y * a.W + x]) dm = Math.min(dm, Math.hypot(x + 0.5 - r.argola.px[0], y + 0.5 - r.argola.px[1]));
    assert.ok(dm * esc >= r.argola.alcaMM, pos + ': argola a ' + (dm * esc).toFixed(2) + ' mm da arte');
  }
  // livre: soltou em cima da arte -> vai pro lugar livre mais perto
  const r = construir(an('texto-1cor'), { argola: { posicao: 'livre', ponto: { u: 0.5, v: 0.5 } } });
  assert.ok(r.argola);
});

test('alturas: degraus (dentro fica mais alto), iguais e sem AMS (cor por altura)', () => {
  const a = an('escudo-3cores');
  const deg = construir(a, {});
  const z = Object.fromEntries(deg.partes.map(p => [p.nome, zDe(p)]));
  assert.deepEqual(z.Base, [0, 2.4]);
  assert.deepEqual(z.Branco, [2.4, 3.6]);
  assert.deepEqual(z.Preto, [3.6, 4.2]);
  const ig = construir(a, { alturas: 'iguais' });
  for (const p of ig.partes) if (p.nome !== 'Base') assert.deepEqual(zDe(p), [2.4, 3.6]);
  const tr = construir(an('sol-4cores'), { estrategia: 'troca' });
  assert.equal(tr.trocas.length, 3);
  for (let i = 1; i < tr.trocas.length; i++) assert.ok(tr.trocas[i].z > tr.trocas[i - 1].z);
  for (const p of [...deg.partes, ...ig.partes, ...tr.partes]) assert.ok(solida(p), p.nome);
});

test('alturas saem em múltiplos da camada do bico (0,4 -> 0,2; 0,2 -> 0,1)', () => {
  const r = construir(an('texto-1cor'), { altBase: 2.5, altArte: 1.1, bicoMM: 0.4 });
  assert.ok([2.4, 2.6].includes(+r.alturas.base.toFixed(2)) && [1, 1.2].includes(+r.alturas.arte.toFixed(2)), JSON.stringify(r.alturas));
  const f = construir(an('texto-1cor'), { altBase: 2.45, bicoMM: 0.2 });
  assert.equal(r.perfil.camada, 0.2); assert.equal(f.perfil.camada, 0.1);
  assert.ok(Math.abs(f.alturas.base / 0.1 - Math.round(f.alturas.base / 0.1)) < 1e-6);
});

test('traço mais fino que o bico engrossa (e avisa quanto)', () => {
  const com = construir(an('texto-fino'), { tamanhoMM: 50 }), sem = construir(an('texto-fino'), { tamanhoMM: 50, engrossar: false });
  const v = r => r.partes.filter(p => p.nome !== 'Base').reduce((a, p) => a + p.volumeMM3, 0);
  assert.ok(v(com) > v(sem) * 1.05, 'engrossou');
  assert.ok(com.qualidade.itens.some(i => /engrossad/.test(i.texto)));
  // bico 0,2: o mínimo cai pela metade, engrossa menos
  const fino = construir(an('texto-fino'), { tamanhoMM: 50, bicoMM: 0.2 });
  assert.ok(v(fino) < v(com));
});

test('modelos: medalha, placa e só o contorno saem sólidos', () => {
  for (const modelo of ['medalha', 'placa', 'contorno']) {
    const r = construir(an('selo-2cores'), { modelo });
    assert.ok(!r.erro, modelo + ': ' + r.erro);
    for (const p of r.partes) assert.ok(solida(p), modelo + ' ' + p.nome);
  }
  const med = construir(an('selo-2cores'), { modelo: 'medalha', tamanhoMM: 40 });
  assert.ok(Math.abs(med.medidas.largura - med.medidas.altura) < 1.5 || med.argola, 'medalha redonda');
});

test('NFC: bolso por baixo cabe; tag grande demais avisa', () => {
  const r = construir(an('sol-4cores'), { nfc: { ligado: true, diametroMM: 25 } });
  assert.ok(r.nfc && r.nfc.modo === 'baixo');
  const semBolso = construir(an('sol-4cores'), {});
  const vb = x => x.partes.find(p => p.nome === 'Base').volumeMM3;
  assert.ok(vb(semBolso) - vb(r) > Math.PI * 12.5 * 12.5 * 0.8 * 0.9);
  const f = construir(an('sol-4cores'), { nfc: { ligado: true, modo: 'fechado', diametroMM: 25 }, altBase: 3 });
  assert.ok(f.nfc && f.nfc.camadaPausa > 1);
  const g = construir(an('texto-1cor'), { nfc: { ligado: true, diametroMM: 40 } });
  assert.ok(!g.nfc && g.avisos.some(a => /não cabe/.test(a.texto)));
});

test('juntar cores, desligar cor e trocar a cor da base', () => {
  const a = an('sol-4cores');
  const amarelo = a.cores.find(c => c.nome === 'Amarelo').id, preto = a.cores.find(c => c.nome === 'Preto').id;
  const j = construir(a, { cores: { [preto]: { juntarCom: amarelo } } });
  assert.ok(!j.partes.some(p => p.nome === 'Preto'));
  const d = construir(a, { cores: { [preto]: { desligada: true } } });
  assert.ok(!d.partes.some(p => p.nome === 'Preto'));
  const b = construir(a, { corBase: '#FFFFFF' });   // base branca: o azul volta a ser uma cor erguida
  assert.equal(b.corBase, '#FFFFFF');
  assert.ok(b.partes.some(p => p.nome === 'Azul'));
  const h = construir(a, { cores: { [amarelo]: { hex: '#FF8800' } } });
  assert.equal(h.partes.find(p => p.nome === 'Amarelo').cor, '#FF8800');
});

test('mesa: peça maior que a impressora avisa', () => {
  const r = construir(an('texto-1cor'), { tamanhoMM: 200, impressora: 'A1MINI' });
  assert.ok(r.avisos.some(a => /não cabe na mesa/.test(a.texto)));
});

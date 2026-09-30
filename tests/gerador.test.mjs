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
import { analisar, analisarSVG } from '../src/gerador/analise.js';
import { caminhoParaPontos, lerSVG } from '../src/gerador/svg.js';
import { manifold } from '../src/estudio3d/core/solidos.js';
import { construir } from '../src/gerador/chaveiro.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { criar } from '../src/estudio3d/core/malha.js';
import { rodarMotorNovo, medirNovo } from '../tools/bench-chaveiro.mjs';

await carregarManifold();
const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'logos');
const todas = JSON.parse(fs.readFileSync(path.join(pasta, 'logos.json'), 'utf8'));
const logos = todas.filter(l => !/\.svg$/.test(l.arquivo));
const imagem = nome => { const l = logos.find(x => x.nome === nome); const img = lerImagem(new Uint8Array(fs.readFileSync(path.join(pasta, l.arquivo))), l.arquivo); return { px: img.px, w: img.largura, h: img.altura }; };
const cacheAn = new Map();
const an = nome => { if (!cacheAn.has(nome)) cacheAn.set(nome, analisar(imagem(nome))); return cacheAn.get(nome); };
const solida = p => { const v = validar(criar(Float64Array.from(p.malha.pos), p.malha.idx), { completo: true }); return v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.volume > 0; };
const zDe = p => { let a = Infinity, b = -Infinity; for (let i = 2; i < p.malha.pos.length; i += 3) { a = Math.min(a, p.malha.pos[i]); b = Math.max(b, p.malha.pos[i]); } return [+a.toFixed(3), +b.toFixed(3)]; };

// ---------- fidelidade (benchmark com limites)
for (const l of todas) {
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
    // SVG lido em vetor: contorno exato (melhor que qualquer imagem)
    if (/\.svg$/.test(l.arquivo)) {
      assert.ok(r.an.vetor, 'SVG devia ser lido em vetor');
      assert.ok(m.piorCorPct >= 99, 'SVG: pior cor ' + m.piorCorPct.toFixed(2) + '%');
      assert.ok(m.erroBordaMM <= 0.01, 'SVG: erro de borda ' + m.erroBordaMM.toFixed(4) + ' mm');
    }
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

test('verso: texto colorido rente nas primeiras camadas (espelhado) ou gravado', () => {
  // "L" feito de blocos (assimétrico: mostra se espelhou)
  const w = 300, h = 200, alfa = new Uint8Array(w * h);
  for (let y = 20; y < 180; y++) for (let x = 20; x < 70; x++) alfa[y * w + x] = 255;
  for (let y = 130; y < 180; y++) for (let x = 20; x < 200; x++) alfa[y * w + x] = 255;
  const a = an('sol-4cores');
  const r = construir(a, { verso: { alfa, w, h, modo: 'cor', cor: '#FFFFFF', linhas: 1 } });
  const v = r.partes.find(p => p.nome === 'Verso');
  assert.ok(v && r.verso, 'tem verso');
  assert.deepEqual(zDe(v), [0, 0.6]);
  assert.ok(solida(v) && solida(r.partes.find(p => p.nome === 'Base')));
  // espelhado: a haste do L (esquerda na imagem) fica à DIREITA no modelo
  let sx = 0, n = 0, x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < v.malha.pos.length; i += 3) { sx += v.malha.pos[i]; n++; x0 = Math.min(x0, v.malha.pos[i]); x1 = Math.max(x1, v.malha.pos[i]); }
  assert.ok(sx / n > (x0 + x1) / 2, 'espelhado em X');
  const sem = construir(a, {});
  const vb = x => x.partes.find(p => p.nome === 'Base').volumeMM3;
  assert.ok(Math.abs(vb(sem) - vb(r) - v.volumeMM3) < 1, 'o verso sai de dentro da base (rente)');
  const g = construir(a, { verso: { alfa, w, h, modo: 'gravado' } });
  assert.ok(!g.partes.some(p => p.nome === 'Verso') && vb(g) < vb(sem) - 5, 'gravado');
  // sem AMS: vira gravado e avisa
  const t = construir(a, { estrategia: 'troca', verso: { alfa, w, h, modo: 'cor' } });
  assert.ok(!t.partes.some(p => p.nome === 'Verso') && t.dicas.some(d => /gravado/.test(d.texto)));
});

test('verso: QR code (quadradinhos exatos, cabe com margem, espelhado) e avisos de contraste', () => {
  const a = an('escudo-3cores-jpg');   // base branca: QR preto contrasta
  const r = construir(a, { tamanhoMM: 60, verso: { qr: 'https://instagram.com/144lab', modo: 'cor', cor: '#000000' } });
  const v = r.partes.find(p => p.nome === 'Verso');
  assert.ok(v && r.verso.qr, 'tem QR');
  assert.equal(r.verso.qr.versao, 3);
  assert.ok(r.verso.qr.moduloMM >= 0.95, 'módulo ' + r.verso.qr.moduloMM);
  // logo baixa e larga: o QR não cabe grande -> avisa o tamanho do quadradinho
  const p = construir(an('selo-2cores'), { tamanhoMM: 60, verso: { qr: 'https://instagram.com/144lab', modo: 'cor', cor: '#000000' } });
  assert.ok(p.avisos.some(x => /quadradinhos/.test(x.texto)));
  assert.deepEqual(zDe(v), [0, 0.6]);
  assert.ok(solida(v));
  assert.ok(!r.avisos.some(x => /QR/.test(x.texto)), JSON.stringify(r.avisos));
  // QR branco em base branca: avisa contraste; gravado: avisa que não lê
  const b = construir(a, { tamanhoMM: 60, verso: { qr: 'x', modo: 'cor', cor: '#FFFFFF' } });
  assert.ok(b.avisos.some(x => /mais escura/.test(x.texto)));
  const g = construir(a, { tamanhoMM: 60, verso: { qr: 'x', modo: 'gravado' } });
  assert.ok(g.avisos.some(x => /gravado/.test(x.texto)));
});

test('QR: gerador segue a norma (tamanho por versão, padrões de posição e temporização)', async () => {
  const { gerarQR } = await import('../src/gerador/qr.js');
  const q = gerarQR('https://instagram.com/144lab');
  assert.equal(q.tamanho, 29);
  const m = q.modulos;
  // padrão de posição (7x7) nos 3 cantos
  for (const [x0, y0] of [[0, 0], [22, 0], [0, 22]]) for (let d = 0; d < 7; d++) { assert.ok(m[y0][x0 + d] && m[y0 + 6][x0 + d] && m[y0 + d][x0] && m[y0 + d][x0 + 6]); }
  for (let i = 8; i < 21; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  assert.equal(gerarQR('a'.repeat(150)).versao, 8);
  // versões grandes (tabelas até a 40) e correção que sobe de graça quando cabe
  assert.equal(gerarQR('a'.repeat(1475)).versao, 32);
  assert.equal(gerarQR('a').nivel, 'H');
  assert.equal(gerarQR('x'.repeat(2900)).versao, 40);
  assert.throws(() => gerarQR('a'.repeat(3000)));
});

// ---------- SVG em vetor (contorno exato do arquivo)
const areaDe = pols => { const { CrossSection } = manifold(); const c = new CrossSection(pols, 'Positive'); const a = c.area(); c.delete(); return a; };
const svgChaveiro = (svg, cfg = {}) => { const a = analisarSVG(svg, { w: 500, h: 500 }); assert.ok(!a.erro && !a.voltarRaster, a.erro || 'voltarRaster'); const r = construir(a, { argola: { ligada: false }, ...cfg }); assert.ok(!r.erro, r.erro); return { a, r, cor: hex => r.vista.find(v => v.cor === hex) }; };

test('SVG: caminho (arco com flags grudadas, relativo, S/T, número colado)', () => {
  assert.deepEqual(caminhoParaPontos('M0 0a10 10 0 0120 0', 0.01)[0].pts.slice(-1)[0], [20, 0]);
  assert.deepEqual(caminhoParaPontos('M0 0a10 10 0 01 20 0', 0.01)[0].pts.slice(-1)[0], [20, 0]);
  const t = caminhoParaPontos('m10,10 20,0 0,20z m5 5 l1 1', 0.01);
  assert.deepEqual(t.map(x => x.pts[0]), [[10, 10], [15, 15]]);
  assert.equal(t[0].fechado, true);
  assert.deepEqual(caminhoParaPontos('M-1.5.5.5-1.5', 0.1)[0].pts, [[-1.5, 0.5], [0.5, -1.5]]);
  assert.deepEqual(caminhoParaPontos('M0 0Q5 10 10 0T20 0', 0.1)[0].pts.slice(-1)[0], [20, 0]);
  // S reflete o controle da C anterior: a curva passa pelo ponto do meio simétrica
  const s = caminhoParaPontos('M0 0C0 10 10 10 10 0S20 -10 20 0', 0.01)[0].pts;
  const y15 = s.reduce((a, p) => Math.abs(p[0] - 15) < Math.abs(a[0] - 15) ? p : a);
  assert.ok(Math.abs(y15[1] + 7.5) < 0.1, 'S refletido: y(15) = ' + y15[1]);
});

test('SVG: círculo sai com o raio exato (sem serrilhado de pixel)', () => {
  const { r, cor } = svgChaveiro('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="90" fill="#e11d48"/></svg>', { corBase: '#FFFFFF' });
  const v = cor('#E11D48'), pts = v.poligonos.flat();
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - 22.5) < 0.005, 'raio ' + Math.hypot(p[0] - cx, p[1] - cy));
  assert.ok(Math.abs(areaDe(v.poligonos) / (Math.PI * 22.5 ** 2) - 1) < 0.001);
  assert.ok(Math.abs(r.medidas.largura - 50) < 0.01 && Math.abs(r.medidas.altura - 50) < 0.01, 'medidas ' + r.medidas.largura + ' × ' + r.medidas.altura);
});

test('SVG: <style> com classe, transform, evenodd, use, recorte (clip-path), traço e fundo que apaga', () => {
  // anel evenodd azul + quadrado amarelo girado (use) no furo
  let x = svgChaveiro(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><style>.a{fill:#1d4ed8}.b{fill:#facc15}</style><rect id="q" width="20" height="20"/></defs>
    <path class="a" fill-rule="evenodd" d="M50 5a45 45 0 1 1 0 90a45 45 0 1 1 0-90zM50 25a25 25 0 1 0 0 50a25 25 0 1 0 0-50z"/>
    <g transform="translate(40 40) rotate(45 10 10)"><use href="#q" class="b"/></g></svg>`);
  assert.equal(x.a.cores.length, 2);
  assert.ok(Math.abs(areaDe(x.cor('#1D4ED8').poligonos) - Math.PI * (45 ** 2 - 25 ** 2) * 0.25) < 1, 'anel');
  assert.ok(Math.abs(areaDe(x.cor('#FACC15').poligonos) - 100) < 0.2, 'quadrado');
  // recorte: meio círculo preto de 40 un. = 22,5 mm
  x = svgChaveiro(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c"><rect width="50" height="100"/></clipPath><circle cx="50" cy="50" r="40" fill="#111" clip-path="url(#c)"/><rect x="60" y="30" width="30" height="40" fill="#dc2626"/></svg>`, { corBase: '#FFFFFF' });
  const xs = x.cor('#111111').poligonos.flat().map(p => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 22.5) < 0.02, 'meio círculo ' + (Math.max(...xs) - Math.min(...xs)));
  // traço: linha de 8 un. com ponta redonda vira área
  x = svgChaveiro('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 50H90" stroke="#15803d" stroke-width="8" stroke-linecap="round" fill="none"/></svg>', { corBase: '#FFFFFF' });
  const k = 45 / 88;  // 80 + 2 pontas de 4
  assert.ok(Math.abs(areaDe(x.cor('#15803D').poligonos) - (80 * 8 + Math.PI * 16) * k * k) < 1, 'traço');
  // fundo branco + círculo branco por cima do laranja: vira furo (base aparece)
  x = svgChaveiro('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="40" fill="#e8590c"/><circle cx="50" cy="50" r="15" fill="#fff"/></svg>');
  assert.equal(x.a.modo, 'fundo');
  assert.ok(Math.abs(areaDe(x.cor('#E8590C').poligonos) - Math.PI * (40 ** 2 - 15 ** 2) * (45 / 80) ** 2) < 2, 'anel laranja');
  for (const p of x.r.partes) assert.ok(solida(p), 'malha ' + p.nome);
});

test('SVG: texto em fonte ou foto dentro volta pros pixels; lixo não quebra', () => {
  assert.equal(analisarSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="0" y="30">Oi</text><rect width="10" height="10"/></svg>').voltarRaster, true);
  assert.equal(analisarSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="a.png" width="10" height="10"/><rect width="5" height="5"/></svg>').voltarRaster, true);
  assert.throws(() => lerSVG('<html></html>'), /SVG/);
  assert.throws(() => lerSVG('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), /formas/);
  // path quebrado no meio: usa o que deu pra ler
  assert.equal(lerSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z L5 x"/></svg>').formas.length, 1);
});

test('SVG: logo com 400 formas (Illustrator) monta rápido e sem canto inchado', () => {
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">';
  for (let i = 0; i < 400; i++) { const x = 20 + (i % 20) * 18, y = 20 + Math.floor(i / 20) * 18; s += `<path fill="${i % 3 ? '#111' : '#1d4ed8'}" d="M${x} ${y}h12v12h-12z"/>`; }
  const t = Date.now();
  const { r } = svgChaveiro(s + '</svg>');
  assert.ok(Date.now() - t < 6000, 'demorou ' + (Date.now() - t) + ' ms');
  // quadradinhos continuam quadrados: área exata (sem engrossar canto)
  const lado = 12 * 45 / 354;
  const nPreto = 400 - Math.ceil(400 / 3), nAzul = Math.ceil(400 / 3);
  assert.ok(Math.abs(areaDe(r.vista.find(v => v.cor === '#111111').poligonos) - nPreto * lado * lado) < 0.5);
  assert.ok(Math.abs(areaDe(r.vista.find(v => v.cor === '#1D4ED8').poligonos) - nAzul * lado * lado) < 0.5);
});

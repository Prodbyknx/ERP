// Sem AMS: 3MF de um filamento só + pausas no arquivo fatiado do Bambu
// (.gcode.3mf). O G-code de teste segue o formato que o Bambu Studio grava
// (GCode.cpp: "; CHANGE_LAYER", "; Z_HEIGHT:", "; LAYER_HEIGHT:", o
// layer_change_gcode das A1/P1/X1 com "M991 S0 P..", "; FEATURE:") e o
// project_settings.config com machine_pause_gcode = "M400 U1".
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarManifold } from './util/manifold.mjs';
import { lerImagem } from '../mcp/imagem.mjs';
import { analisar } from '../src/gerador/analise.js';
import { construir } from '../src/gerador/chaveiro.js';
import { pausar, md5, camadasDoGcode } from '../src/gerador/pausas.js';
import { lerZip, escreverZip, texto } from '../src/estudio3d/core/formatos/zip.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { criar } from '../src/estudio3d/core/malha.js';

await carregarManifold();
const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'logos');
const img = lerImagem(new Uint8Array(fs.readFileSync(path.join(pasta, 'sol-4cores.png'))), 'sol-4cores.png');
const an = analisar({ px: img.px, w: img.largura, h: img.altura });

// G-code "fatiado" no formato do Bambu, camada de 0,2 mm até a altura dada
function gcodeBambu(altura, h = 0.2) {
  const L = ['; HEADER_BLOCK_START', '; BambuStudio 02.02.00.85', '; total layer number: ' + Math.round(altura / h), '; HEADER_BLOCK_END', '; EXECUTABLE_BLOCK_START', 'M73 P0 R10', 'G28'];
  const n = Math.round(altura / h);
  for (let i = 1; i <= n; i++) {
    const z = +(i * h).toFixed(2);
    L.push('; CHANGE_LAYER', '; Z_HEIGHT: ' + z, '; LAYER_HEIGHT: ' + h, 'G1 E-.8 F1800', '; layer num/total_layer_count: ' + i + '/' + n, '; update layer progress', 'M73 L' + i, 'M991 S0 P' + (i - 1) + ' ;notify layer change',
      'G1 X100 Y100 Z' + (z + 0.4).toFixed(2) + ' F30000', 'G1 Z' + z, 'G1 E.8 F1800', '; FEATURE: Outer wall', '; LINE_WIDTH: 0.42', 'G1 X110 Y100 E.5', 'G1 X110 Y110 E.5');
  }
  L.push('; EXECUTABLE_BLOCK_END', 'M400', '');
  return L.join('\n');
}
function gcode3mf(g, extra = {}) {
  const gb = new TextEncoder().encode(g);
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  return escreverZip([
    { nome: '[Content_Types].xml', dados: '<?xml version="1.0"?><Types/>' },
    { nome: '_rels/.rels', dados: '<?xml version="1.0"?><Relationships/>' },
    { nome: '3D/3dmodel.model', dados: '<?xml version="1.0"?><model unit="millimeter"><metadata name="Application">BambuStudio-02.02.00.85</metadata><resources/><build/></model>' },
    { nome: 'Metadata/plate_1.gcode', dados: gb },
    { nome: 'Metadata/plate_1.gcode.md5', dados: crypto.createHash('md5').update(gb).digest('hex').toUpperCase() },
    { nome: 'Metadata/plate_1.png', dados: png, nivel: 0 },
    { nome: 'Metadata/project_settings.config', dados: JSON.stringify({ machine_pause_gcode: 'M400 U1', printer_model: 'Bambu Lab A1', layer_height: '0.2', ...extra }) },
    { nome: 'Metadata/slice_info.config', dados: '<?xml version="1.0"?><config><plate><metadata key="index" value="1"/></plate></config>' }
  ]);
}

test('MD5 igual ao do Node (vários tamanhos, borda de bloco)', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 70001]) {
    const u = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
    assert.equal(md5(u), crypto.createHash('md5').update(u).digest('hex').toUpperCase(), 'n=' + n);
  }
});

test('sem AMS: faixas de cor na tela, mas UM sólido de um filamento pro Bambu', () => {
  const r = construir(an, { estrategia: 'troca' });
  assert.ok(!r.erro, r.erro);
  assert.ok(r.partes.length >= 4, 'prévia com as cores');
  assert.ok(r.pecaUnica, 'peça única');
  assert.equal(r.pecaUnica.cor, r.corBase);
  const v = validar(criar(Float64Array.from(r.pecaUnica.malha.pos), r.pecaUnica.malha.idx), { completo: true });
  assert.ok(v.fechada && !v.autoInterseccoes && v.componentes === 1, JSON.stringify({ fechada: v.fechada, cruz: v.autoInterseccoes, comp: v.componentes }));
  const soma = r.partes.reduce((a, p) => a + p.volumeMM3, 0);
  assert.ok(Math.abs(r.pecaUnica.volumeMM3 - soma) / soma < 0.002, 'volume ' + r.pecaUnica.volumeMM3 + ' x ' + soma);
  // pausas = trocas (altura onde cada cor começa)
  assert.deepEqual(r.pausas.map(p => p.z), r.trocas.map(t => t.z));
  assert.ok(r.pausas.every(p => p.tipo === 'cor' && /Troque/.test(p.texto)));
  // com AMS não tem peça única nem pausa de cor
  const a = construir(an, {});
  assert.equal(a.pecaUnica, null);
  assert.equal(a.pausas.length, 0);
});

test('pausas no .gcode.3mf do Bambu: camada certa, logo depois da troca de camada, MD5 novo, resto intacto, sem repetir', () => {
  const r = construir(an, { estrategia: 'troca' });
  const g = gcodeBambu(r.medidas.espessura);
  const ent = gcode3mf(g);
  const x = pausar(ent, r.pausas.map(p => ({ z: p.z, texto: p.texto })));
  assert.ok(!x.erro, x.erro);
  assert.equal(x.formato, '3mf');
  assert.equal(x.feitas.length, r.pausas.length);
  assert.equal(x.codigoPausa, 'M400 U1');
  const antes = lerZip(ent), depois = lerZip(x.bytes);
  assert.deepEqual(Object.keys(depois).sort(), Object.keys(antes).sort(), 'mesmos arquivos');
  for (const k of Object.keys(antes)) if (!/plate_1\.gcode/.test(k)) assert.deepEqual(depois[k], antes[k], k + ' mudou');
  const novo = depois['Metadata/plate_1.gcode'];
  assert.equal(texto(depois['Metadata/plate_1.gcode.md5']), crypto.createHash('md5').update(novo).digest('hex').toUpperCase());
  const L = texto(novo).split('\n');
  const cam = camadasDoGcode(L);
  for (const p of r.pausas) {
    // a primeira camada acima da troca: Z_HEIGHT = z + 0,2 (a cor nova começa nela)
    const c = cam.find(c => Math.abs(c.z - (p.z + 0.2)) < 1e-6);
    assert.ok(c, 'camada de ' + (p.z + 0.2));
    const i = L.indexOf('; PAUSE_PRINTING', c.iChange);
    assert.ok(i > c.iChange && i < L.indexOf('; FEATURE: Outer wall', c.iChange), 'pausa antes de imprimir a camada');
    assert.match(L[i - 1], /^M991 S0 P/, 'logo depois do aviso de troca de camada');
    assert.equal(L[i + 1], '; ' + p.texto);
    assert.equal(L[i + 2], 'M400 U1');
    assert.equal(x.feitas.find(f => f.z === p.z).camada, cam.indexOf(c) + 1);
  }
  // nenhuma outra linha mudou (só entraram as pausas)
  const semPausa = L.filter((l, i) => !(l === '; PAUSE_PRINTING' || (L[i - 1] === '; PAUSE_PRINTING') || (L[i - 2] === '; PAUSE_PRINTING' && l === 'M400 U1')));
  assert.deepEqual(semPausa, g.split('\n'));
  // de novo no arquivo já pausado: não duplica
  const y = pausar(x.bytes, r.pausas.map(p => ({ z: p.z, texto: p.texto })));
  assert.equal(texto(lerZip(y.bytes)['Metadata/plate_1.gcode']).split('; PAUSE_PRINTING').length - 1, r.pausas.length);
  assert.ok(y.feitas.every(f => f.jaTinha));
});

test('pausas: G-code da impressora (outra pausa), .gcode solto, camada de 0,12, NFC e pausa acima da peça', () => {
  // G-code de pausa vindo do perfil da impressora
  const ent = gcode3mf(gcodeBambu(4), { machine_pause_gcode: 'M400 U1\nM117 troca' });
  let x = pausar(ent, [{ z: 2.4, texto: 'Troque' }]);
  let L = texto(lerZip(x.bytes)['Metadata/plate_1.gcode']).split('\n');
  const i = L.indexOf('; PAUSE_PRINTING');
  assert.deepEqual(L.slice(i, i + 4), ['; PAUSE_PRINTING', '; Troque', 'M400 U1', 'M117 troca']);
  // .gcode solto (sem 3MF) com camada de 0,12: pausa pela ALTURA
  x = pausar(new TextEncoder().encode(gcodeBambu(3.6, 0.12)), [{ z: 2.4 }, { z: 9 }]);
  assert.equal(x.formato, 'gcode');
  L = texto(x.bytes).split('\n');
  const j = L.indexOf('; PAUSE_PRINTING');
  const zAntes = L.slice(0, j).reverse().find(l => l.startsWith('; Z_HEIGHT:'));
  assert.equal(zAntes, '; Z_HEIGHT: 2.52');
  assert.equal(x.feitas.length, 1);
  assert.match(x.avisos[0], /acima da peça/);
  // NFC fechado: a pausa pra pôr a tag entra junto (com AMS também)
  const r = construir(an, { nfc: { ligado: true, modo: 'fechado', diametroMM: 25 }, altBase: 3 });
  assert.equal(r.pausas.length, 1);
  assert.equal(r.pausas[0].tipo, 'nfc');
  assert.equal(r.pausas[0].z, r.nfc.zPausa);
  // 3MF que não foi fatiado: explica o que fazer
  const cru = escreverZip([{ nome: '3D/3dmodel.model', dados: '<model/>' }]);
  assert.match(pausar(cru, [{ z: 1 }]).erro, /Exportar arquivo fatiado/);
});

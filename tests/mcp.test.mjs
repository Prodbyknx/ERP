// MCP do 144 Lab pelo PROTOCOLO de verdade: um cliente MCP (o do SDK) abre o
// servidor como processo (igual o Claude Desktop) e chama cada ferramenta.
// Confere o arquivo gravado (reabre o 3MF/STL) e as travas de segurança.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { carregarManifold } from './util/manifold.mjs';
import { comContexto, manifold } from '../src/estudio3d/core/solidos.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { criar, volume, centroidesFace } from '../src/estudio3d/core/malha.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { escreverSTL } from '../src/estudio3d/core/formatos/stl.js';
import { identidade } from '../src/estudio3d/core/mat4.js';
import { Canvas } from '../mcp/canvas.mjs';
import { escreverPNG } from '../mcp/imagem.mjs';

const W = await carregarManifold();
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let dir, entrada, saida, fora, cliente;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp144-'));
  entrada = path.join(dir, 'entrada'); saida = path.join(dir, 'saida'); fora = path.join(dir, 'fora');
  for (const p of [entrada, saida, fora]) fs.mkdirSync(p);
  // logo de 2 cores (círculo vermelho, estrela preta, fundo transparente)
  const cv = new Canvas(400, 400), c = cv.getContext('2d');
  c.fillStyle = '#d1242f'; c.beginPath(); c.arc(200, 200, 180, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#111111'; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 60 : 140, a = i / 10 * Math.PI * 2 - Math.PI / 2; c.lineTo(200 + r * Math.cos(a), 200 + r * Math.sin(a)); } c.closePath(); c.fill();
  fs.writeFileSync(path.join(entrada, 'logo.png'), escreverPNG(c.px, 400, 400));
  // esfera com buraco (STL) e esfera com ondulação (suavizar)
  const esf = comContexto(ctx => ctx.parte(ctx.guardar(manifold().Manifold.sphere(20, 96)), 'e', '#999').malha);
  const nt = esf.idx.length / 3, idx = Array.from(esf.idx).slice(0, (nt - 6) * 3);
  fs.writeFileSync(path.join(entrada, 'furada.stl'), Buffer.from(escreverSTL(criar(esf.pos, Uint32Array.from(idx)), 'furada')));
  const P = Float64Array.from(esf.pos);
  for (let v = 0; v < P.length; v += 3) { const L = Math.hypot(P[v], P[v + 1], P[v + 2]), d = 0.6 * Math.sin(P[v] * 1.3) * Math.sin(P[v + 1] * 1.1 + 0.4) * Math.sin(P[v + 2] * 1.2 + 1); for (let e = 0; e < 3; e++) P[v + e] += d * P[v + e] / L; }
  fs.writeFileSync(path.join(entrada, 'ondulada.stl'), Buffer.from(escreverSTL(criar(P, esf.idx), 'ondulada')));
  // cilindro pintado: metade de cima vermelha (3MF com cor por face)
  const cil = comContexto(ctx => ctx.parte(ctx.guardar(manifold().Manifold.cylinder(40, 20, 20, 128).refineToLength(1.5)), 'c', '#1B1B1B').malha);
  const C = centroidesFace(cil), cor = new Uint16Array(cil.idx.length / 3); for (let t = 0; t < cor.length; t++) cor[t] = C[t * 3 + 2] > 20 ? 1 : 0;
  const r3 = executar('exportar3MF', { cena: { objetos: [{ nome: 'caneca', transform: identidade(), partes: [{ nome: 'caneca', cor: '#1B1B1B', paleta: ['#1B1B1B', '#D1242F'], malha: criar(cil.pos, cil.idx, cor) }] }] }, opc: {} });
  fs.writeFileSync(path.join(entrada, 'caneca.3mf'), r3.bytes);
  fs.writeFileSync(path.join(fora, 'segredo.stl'), fs.readFileSync(path.join(entrada, 'furada.stl')));

  cliente = new Client({ name: 'teste', version: '1.0.0' });
  // MCP_SERVIDOR: roda o pacote pronto (tools/mcp.mjs) em vez do código-fonte
  const servidor = process.env.MCP_SERVIDOR || path.join(raiz, 'mcp', 'servidor.mjs');
  await cliente.connect(new StdioClientTransport({
    command: process.execPath, args: [servidor], cwd: path.dirname(servidor),
    env: { ...process.env, SAIDA_144LAB: saida, PASTAS_144LAB: entrada }, stderr: 'pipe'
  }));
});
after(async () => { if (cliente) await cliente.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const chamar = async (nome, args) => cliente.callTool({ name: nome, arguments: args }, undefined, { timeout: 240000 });
const txt = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const salvo = r => { const m = /Salvo em: (.+?) \(\d+ KB\)/.exec(txt(r)); assert.ok(m, 'sem "Salvo em": ' + txt(r)); assert.ok(fs.existsSync(m[1]), 'arquivo não existe: ' + m[1]); return m[1]; };
const abrir = arq => executar('importar', { nome: path.basename(arq), bytes: new Uint8Array(fs.readFileSync(arq)), extras: {} });
const limpo = (m, rot) => { const v = validar(m, { completo: true }); assert.ok(v.fechada && !v.autoInterseccoes && !v.arestasNaoManifold, rot + ': ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, nm: v.arestasNaoManifold })); };
const temPrevia = r => { const im = r.content.find(c => c.type === 'image'); assert.ok(im && im.mimeType === 'image/png' && Buffer.from(im.data, 'base64').length > 2000, 'sem prévia PNG'); };

test('MCP: lista as 8 ferramentas com descrição e parâmetros; stdout só com protocolo', async () => {
  const { tools } = await cliente.listTools();
  const nomes = tools.map(t => t.name).sort();
  assert.deepEqual(nomes, ['analisar_peca', 'consertar_peca', 'converter_peca', 'cortar_peca', 'gerar_chaveiro', 'pastas_do_mcp', 'separar_por_cor', 'suavizar_peca']);
  for (const t of tools) assert.ok(t.description && t.description.length > 40 && t.inputSchema && t.inputSchema.type === 'object', t.name);
  assert.equal(tools.find(t => t.name === 'analisar_peca').annotations.readOnlyHint, true);
});

test('MCP gerar_chaveiro TEXTO: 3MF com base + desenho fechados, argola no meio, prévia', async () => {
  const r = await chamar('gerar_chaveiro', { texto: 'MARIA', tamanho_mm: 50 });
  assert.ok(!r.isError, txt(r)); temPrevia(r);
  const o = abrir(salvo(r)).objetos[0];
  assert.deepEqual(o.partes.map(p => p.nome), ['Base', 'Desenho']);
  for (const p of o.partes) limpo(p.malha, p.nome);
  assert.match(txt(r), /Tamanho: 5\d,\d × \d+,\d mm/);
});

test('MCP gerar_chaveiro FORMA com tag NFC FECHADA: vão lacrado no arquivo e o Z da pausa na resposta', async () => {
  const sem = abrir(salvo(await chamar('gerar_chaveiro', { forma: 'coracao' }))).objetos[0].partes.find(p => p.nome === 'Base').malha;
  const r = await chamar('gerar_chaveiro', { forma: 'coracao', nfc: true, nfc_modo: 'fechado' });
  assert.ok(!r.isError, txt(r)); assert.match(txt(r), /PAUSE a impressão em Z = \d/);
  const com = abrir(salvo(r)).objetos[0].partes.find(p => p.nome === 'Base').malha;
  limpo(com, 'base com vão');
  const disco = Math.PI * 12.5 * 12.5 * 0.9;
  assert.ok(Math.abs(volume(sem) - volume(com) - disco) < 0.03 * disco, 'vão ' + (volume(sem) - volume(com)).toFixed(0) + ' mm³, esperado ' + disco.toFixed(0));
  const mf = new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(com.pos), triVerts: Uint32Array.from(com.idx) }));
  assert.equal(mf.decompose().length, 2, 'peça + vão'); mf.delete();
});

test('MCP gerar_chaveiro IMAGEM por cor: vermelho e preto viram peças separadas com as cores da imagem', async () => {
  const r = await chamar('gerar_chaveiro', { imagem: path.join(entrada, 'logo.png'), detalhe: 'cor', cores: 2, modelo: 'medalha' });
  assert.ok(!r.isError, txt(r)); temPrevia(r);
  const partes = abrir(salvo(r)).objetos[0].partes;
  assert.equal(partes.length, 3, partes.map(p => p.nome).join());
  const cores = partes.map(p => p.cor.toUpperCase());
  assert.ok(cores.includes('#D1242F') && cores.includes('#111111'), cores.join());
  for (const p of partes) limpo(p.malha, p.nome);
});

test('MCP analisar_peca: acha o buraco da esfera furada e não grava nada', async () => {
  const antes = fs.readdirSync(saida).length;
  const r = await chamar('analisar_peca', { arquivo: path.join(entrada, 'furada.stl') });
  assert.ok(!r.isError, txt(r)); temPrevia(r);
  assert.match(txt(r), /PROBLEMAS: .*arestas abertas/);
  assert.equal(fs.readdirSync(saida).length, antes);
});

test('MCP consertar_peca: a esfera furada sai fechada (cópia; o original fica)', async () => {
  const r = await chamar('consertar_peca', { arquivo: path.join(entrada, 'furada.stl'), formato: 'stl' });
  assert.ok(!r.isError, txt(r));
  const arq = salvo(r); assert.ok(arq.endsWith('.stl'));
  limpo(abrir(arq).objetos[0].partes[0].malha, 'consertada');
  assert.ok(!validar(abrir(path.join(entrada, 'furada.stl')).objetos[0].partes[0].malha, { completo: false }).fechada, 'mexeu no original');
});

test('MCP suavizar_peca (média): a esfera ondulada fica mais perto da esfera', async () => {
  const desvio = m => { let s = 0; const P = m.pos; for (let v = 0; v < P.length; v += 3) s += Math.abs(Math.hypot(P[v], P[v + 1], P[v + 2]) - 20); return s / (P.length / 3); };
  const d0 = desvio(abrir(path.join(entrada, 'ondulada.stl')).objetos[0].partes[0].malha);
  const r = await chamar('suavizar_peca', { arquivo: path.join(entrada, 'ondulada.stl') });
  assert.ok(!r.isError, txt(r)); temPrevia(r);
  const m = abrir(salvo(r)).objetos[0].partes[0].malha;
  limpo(m, 'suavizada');
  assert.ok(desvio(m) < d0 * 0.6, 'desvio ' + d0.toFixed(3) + ' -> ' + desvio(m).toFixed(3));
});

test('MCP cortar_peca com pinos: duas metades fechadas, apoiadas na mesa, relatório dos pinos', async () => {
  const r = await chamar('cortar_peca', { arquivo: path.join(entrada, 'ondulada.stl'), percentual: 50, pinos: 'cilindrico' });
  assert.ok(!r.isError, txt(r)); temPrevia(r);
  assert.match(txt(r), /pino Ø/);
  const objs = abrir(salvo(r)).objetos;
  assert.equal(objs.length, 2);
  for (const o of objs) { limpo(o.partes[0].malha, o.nome); const t = o.transform; let zmin = Infinity; const P = o.partes[0].malha.pos; for (let i = 2; i < P.length; i += 3) zmin = Math.min(zmin, P[i] + t[14]); assert.ok(Math.abs(zmin) < 0.01, o.nome + ' fora da mesa: z ' + zmin); }
});

test('MCP separar_por_cor: caneca pintada vira 2 peças que não se sobrepõem', async () => {
  const r = await chamar('separar_por_cor', { arquivo: path.join(entrada, 'caneca.3mf') });
  assert.ok(!r.isError, txt(r)); temPrevia(r);
  const partes = abrir(salvo(r)).objetos[0].partes;
  assert.equal(partes.length, 2);
  for (const p of partes) limpo(p.malha, p.nome);
});

test('MCP converter_peca: STL -> 3MF com a cor pedida e escala (cm -> mm)', async () => {
  const r = await chamar('converter_peca', { arquivo: path.join(entrada, 'ondulada.stl'), cor: '#2E7D32', escala: 10, nome_arquivo: 'verde' });
  assert.ok(!r.isError, txt(r));
  const arq = salvo(r); assert.ok(arq.endsWith('verde.3mf'));
  const p = abrir(arq).objetos[0].partes[0];
  assert.equal(p.cor.toUpperCase(), '#2E7D32');
  assert.match(txt(r), /Tamanho: 4\d\d,\d/);
});

test('MCP SEGURANÇA: não lê fora das pastas liberadas, não sai da pasta de saída, não sobrescreve, recusa entrada errada', async () => {
  const f = await chamar('analisar_peca', { arquivo: path.join(fora, 'segredo.stl') });
  assert.ok(f.isError && /fora das pastas liberadas/.test(txt(f)), txt(f));
  const t = await chamar('analisar_peca', { arquivo: path.join(entrada, '..', 'fora', 'segredo.stl') });
  assert.ok(t.isError, 'caminho com .. passou');
  const n1 = salvo(await chamar('gerar_chaveiro', { forma: 'estrela', nome_arquivo: '../../../escapou' }));
  assert.equal(path.dirname(n1), fs.realpathSync(saida), 'gravou fora: ' + n1);
  const n2 = salvo(await chamar('gerar_chaveiro', { forma: 'estrela', nome_arquivo: '../../../escapou' }));
  assert.notEqual(n1, n2, 'sobrescreveu');
  const e = await chamar('gerar_chaveiro', { texto: 'A', forma: 'circulo' });
  assert.ok(e.isError && /exatamente um/.test(txt(e)));
  const v = await chamar('gerar_chaveiro', { texto: 'A', tamanho_mm: 5000 });
  assert.ok(v.isError, 'tamanho absurdo passou');
  const x = await chamar('analisar_peca', { arquivo: path.join(entrada, 'logo.png') });
  assert.ok(x.isError && /Tipo de arquivo não aceito/.test(txt(x)), txt(x));
});

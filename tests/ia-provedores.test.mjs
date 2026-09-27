// Provedores trocáveis (ImageTo3DProvider) + pipeline + benchmark interno +
// servidor self-hosted (fila, token, cancelamento) — tudo de verdade:
// o servidor Python sobe aqui e gera pelo adaptador de CPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { carregarManifold } from './util/manifold.mjs';
import { cenaDeFotos } from './util/fotos.mjs';
import { escreverPNG } from './util/png.mjs';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { provedorSilhuetas, provedorServidor } from '../src/estudio3d/core/ia/provedores.js';
import { gerarDeFotos } from '../src/estudio3d/core/ia/pipeline.js';
import { validar } from '../src/estudio3d/core/validador.js';
import { caixa, transformar } from '../src/estudio3d/core/malha.js';

await carregarManifold();
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { GT, H, FOTOS } = cenaDeFotos();
const rodar = async (op, args) => executar(op, args);
const QUATRO = ['frente', 'costas', 'esquerda', 'direita'];
const entradas = vs => vs.map(v => ({ ...FOTOS[v], png: escreverPNG(FOTOS[v].rgba, FOTOS[v].w, FOTOS[v].h) }));
const BENCH = {};

function conferirObjeto(r, rot) {
  const p = r.objeto.partes[0], v = validar(p.malha, { completo: true });
  assert.ok(v.fechada && !v.autoInterseccoes && v.volume > 0, rot + ' imprimível');
  assert.ok(Math.abs(caixa(p.malha).tam[2] - H) < 0.02 * H, rot + ' altura');
  assert.ok(Math.abs(caixa(p.malha).min[2]) < 1e-6, rot + ' na mesa');
  assert.equal(r.objeto.transform.length, 16);
  const a = r.relatorio.avaliacao;
  assert.ok(a.imprimivel && a.fidelidadeMinima > 0.95, rot + ' ' + JSON.stringify(a.fidelidade));
  return a;
}

test('provedor LOCAL pelo pipeline comum: sai objeto do editor, consertado, medido', async () => {
  const prov = provedorSilhuetas(rodar);
  const r = await gerarDeFotos(prov, entradas(QUATRO), { alturaMM: H }, rodar);
  const a = conferirObjeto(r, 'local');
  assert.equal(r.relatorio.giro, 0);
  BENCH.silhuetas_local = { ...a, tempos: r.relatorio.tempos };
});

test('pipeline recusa entrada errada com mensagem clara', async () => {
  const prov = provedorSilhuetas(rodar);
  await assert.rejects(gerarDeFotos(prov, [FOTOS.frente], { alturaMM: H }, rodar), /pelo menos 2/);
  await assert.rejects(gerarDeFotos(prov, [FOTOS.frente, { ...FOTOS.costas, vista: 'frente' }], { alturaMM: H }, rodar), /mesma vista/);
  await assert.rejects(gerarDeFotos(prov, [FOTOS.frente, { ...FOTOS.costas, vista: 'embaixo' }], { alturaMM: H }, rodar), /desconhecida/);
});

test('resultado de IA com Y pra cima, girado e em outra escala volta pro lugar certo (benchmark acha o giro)', () => {
  // simula o que um modelo de IA devolve: glTF (Y pra cima, frente +Z), girado 90° e em "metros"
  const paraY = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];   // (x,y,z) -> (x,z,-y)
  const giro90 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const s = 0.001, escala = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0.3, 0.2, 0.1, 1];
  const ia = transformar(transformar(transformar(GT, giro90), paraY), escala);
  const r = executar('posProcessarIA', { partes: [{ nome: 'IA', malha: { pos: ia.pos, idx: ia.idx }, cor: '#888888' }], entradas: QUATRO.map(v => FOTOS[v]), opc: { eixoCima: 'Y', alturaMM: H } });
  assert.equal(r.relatorio.giro, 270, 'giro achado ' + r.relatorio.giro);
  assert.ok(r.relatorio.avaliacao.fidelidadeMinima > 0.97, JSON.stringify(r.relatorio.avaliacao.fidelidade));
  assert.ok(Math.abs(caixa(r.parte.malha).tam[2] - H) < 1e-6);
  // o objeto real (GT) avaliado pelo mesmo benchmark = teto de fidelidade
  BENCH.referencia_objeto_real = r.relatorio.avaliacao;
});

// ---------------------------------------------------------------- servidor
const py = spawnSync('python3', ['-c', 'import fastapi, uvicorn, PIL'], { encoding: 'utf8' });
const semServidor = py.status !== 0 ? 'python3 com fastapi/uvicorn/pillow não instalado (pip install -r servidor-ia/requirements.txt)' : false;

// segurança: fecha sem token, corpo gigante e fotos demais recusados antes
// de processar, imagem "bomba" (dimensão absurda) vira 413 e não trava
test('SERVIDOR segurança: sem IA_TOKEN não atende; corpo gigante, fotos demais, imagem bomba e força bruta no token são recusados', { skip: semServidor, timeout: 60000 }, async () => {
  const subir = async env => {
    const porta = 20000 + Math.floor(Math.random() * 2000), url = 'http://127.0.0.1:' + porta, e = { ...process.env, ...env };
    if (!('IA_TOKEN' in env)) delete e.IA_TOKEN;
    const srv = spawn('python3', ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(porta)], { cwd: path.join(raiz, 'servidor-ia'), env: e, stdio: 'pipe' });
    let log = ''; srv.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 100; i++) { try { await fetch(url + '/saude'); return { srv, url }; } catch { await new Promise(r => setTimeout(r, 150)); } }
    srv.kill(); throw new Error('não subiu: ' + log.slice(-500));
  };
  const a = await subir({});
  try {
    const r = await fetch(a.url + '/saude');
    assert.equal(r.status, 503, 'sem IA_TOKEN tem que recusar tudo');
    assert.match((await r.json()).detail, /IA_TOKEN/);
    assert.equal((await fetch(a.url + '/tarefas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"vistas":[]}' })).status, 503);
  } finally { a.srv.kill(); }
  const b = await subir({ IA_TOKEN: 'segredo-teste', IA_MAX_CORPO: '300000' });
  const cab = { Authorization: 'Bearer segredo-teste', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(b.url + '/saude', { headers: { Authorization: 'Bearer segredo-testeX' } })).status, 401);
    const grande = await fetch(b.url + '/tarefas', { method: 'POST', headers: cab, body: JSON.stringify({ modelo: 'silhuetas', vistas: [{ vista: 'frente', png: 'A'.repeat(400000) }] }) });
    assert.equal(grande.status, 413, 'corpo gigante');
    const muitas = await fetch(b.url + '/tarefas', { method: 'POST', headers: cab, body: JSON.stringify({ modelo: 'silhuetas', vistas: Array.from({ length: 13 }, (_, i) => ({ vista: 'v' + i, png: '' })) }) });
    assert.equal(muitas.status, 400, 'fotos demais');
    // PNG que diz ter 50000 × 50000 pixels (2,5 bilhões)
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(50000, 0); ihdr.writeUInt32BE(50000, 4); ihdr[8] = 8; ihdr[9] = 6;
    const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t), d, Buffer.alloc(4)]); };
    const bomba = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), ch('IHDR', ihdr), ch('IEND', Buffer.alloc(0))]);
    const rb = await fetch(b.url + '/tarefas', { method: 'POST', headers: cab, body: JSON.stringify({ modelo: 'silhuetas', vistas: [{ vista: 'frente', png: bomba.toString('base64') }] }) });
    assert.ok(rb.status === 413 || rb.status === 400, 'imagem bomba: ' + rb.status);
    assert.equal((await fetch(b.url + '/saude', { headers: cab })).status, 200, 'o servidor continua de pé');
    // erro de foto não vaza detalhe interno do Python
    const lixo = await fetch(b.url + '/tarefas', { method: 'POST', headers: cab, body: JSON.stringify({ modelo: 'silhuetas', vistas: [{ vista: 'frente', png: Buffer.from('não é imagem').toString('base64') }] }) });
    assert.equal(lixo.status, 400);
    assert.doesNotMatch(JSON.stringify(await lixo.json()), /BytesIO|0x[0-9a-f]{6}|Traceback|\/usr\//);
    // força bruta no token: já houve 2 erros (a espera do servidor subir e o token errado lá em cima);
    // mais 8 completam 10 e a próxima tentativa (mesmo com o token certo) espera
    for (let i = 0; i < 8; i++) assert.equal((await fetch(b.url + '/saude', { headers: { Authorization: 'Bearer chute' + i } })).status, 401, 'tentativa ' + (i + 3));
    const bloqueado = await fetch(b.url + '/saude', { headers: { ...cab, Origin: 'https://144lab.pages.dev' } });
    assert.equal(bloqueado.status, 429, 'força bruta tem que travar');
    assert.ok(bloqueado.headers.get('access-control-allow-origin'), 'a recusa leva CORS (o site mostra a mensagem)');
  } finally { b.srv.kill(); }
});

test('SERVIDOR self-hosted: saúde, token, fila, cancelamento e geração pelo provedor HTTP', { skip: semServidor, timeout: 120000 }, async () => {
  const porta = 18000 + Math.floor(Math.random() * 2000), url = 'http://127.0.0.1:' + porta;
  const srv = spawn('python3', ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(porta)], { cwd: path.join(raiz, 'servidor-ia'), env: { ...process.env, IA_TOKEN: 'segredo-teste' }, stdio: 'pipe' });
  let log = ''; srv.stderr.on('data', d => { log += d; }); srv.stdout.on('data', d => { log += d; });
  try {
    let ok = false;
    for (let i = 0; i < 100 && !ok; i++) { try { ok = (await fetch(url + '/saude', { headers: { Authorization: 'Bearer segredo-teste' } })).ok; } catch (e) { await new Promise(r => setTimeout(r, 150)); } }
    assert.ok(ok, 'servidor não subiu: ' + log.slice(-800));
    assert.equal((await fetch(url + '/saude')).status, 401, 'sem token tem que recusar');
    const saude = await (await fetch(url + '/saude', { headers: { Authorization: 'Bearer segredo-teste' } })).json();
    assert.ok(saude.modelos.some(m => m.id === 'silhuetas'));
    // sem GPU aqui: o adaptador de IA aparece como indisponível, com o motivo (não finge que funciona)
    assert.ok(saude.indisponiveis.some(m => m.id === 'hunyuan3d-2mv' && m.motivo), JSON.stringify(saude.indisponiveis));

    const prov = provedorServidor({ url, token: 'segredo-teste', modelo: 'silhuetas', intervaloMs: 150 });
    assert.deepEqual((await prov.disponivel()).ok, true);
    assert.equal(prov.eixoCima, 'Z');
    const semIA = provedorServidor({ url, token: 'segredo-teste', modelo: 'hunyuan3d-2mv' });
    assert.match((await semIA.disponivel()).motivo, /não tem o modelo/);

    // fila: 1ª tarefa rodando, 2ª esperando na fila -> cancela a 2ª
    const cab = { Authorization: 'Bearer segredo-teste', 'Content-Type': 'application/json' };
    const corpo = JSON.stringify({ modelo: 'silhuetas', opc: { alturaMM: H }, vistas: entradas(QUATRO).map(e => ({ vista: e.vista, png: Buffer.from(e.png).toString('base64') })) });
    const t1 = await (await fetch(url + '/tarefas', { method: 'POST', headers: cab, body: corpo })).json();
    const t2 = await (await fetch(url + '/tarefas', { method: 'POST', headers: cab, body: corpo })).json();
    const e2 = await (await fetch(url + '/tarefas/' + t2.id, { headers: cab })).json();
    assert.equal(e2.estado, 'fila'); assert.ok(e2.posicao >= 1);
    await fetch(url + '/tarefas/' + t2.id, { method: 'DELETE', headers: cab });
    assert.equal((await (await fetch(url + '/tarefas/' + t2.id, { headers: cab })).json()).erro, 'Cancelado.');
    const ruim = await fetch(url + '/tarefas', { method: 'POST', headers: cab, body: JSON.stringify({ modelo: 'silhuetas', vistas: [{ vista: 'embaixo', png: Buffer.from(entradas(['frente'])[0].png).toString('base64') }] }) });
    assert.equal(ruim.status, 400);
    assert.match((await ruim.json()).erro, /não usa as vistas/);
    for (let i = 0; i < 200; i++) { const e = await (await fetch(url + '/tarefas/' + t1.id, { headers: cab })).json(); if (e.estado !== 'fila' && e.estado !== 'rodando') { assert.equal(e.estado, 'pronto', JSON.stringify(e)); break; } await new Promise(r => setTimeout(r, 150)); }

    // geração completa pelo provedor HTTP -> mesmo pipeline -> objeto do editor
    const passos = [];
    const r = await gerarDeFotos(prov, entradas(QUATRO), { alturaMM: H }, rodar, { progresso: (f, t) => passos.push(t) });
    const a = conferirObjeto(r, 'servidor');
    assert.ok(passos.length >= 1);
    BENCH.silhuetas_servidor = { ...a, tempos: r.relatorio.tempos };
    // local e servidor rodam o mesmo gerador: benchmark tem que bater
    assert.ok(Math.abs(BENCH.silhuetas_servidor.fidelidadeMedia - BENCH.silhuetas_local.fidelidadeMedia) < 0.01);
  } finally {
    srv.kill();
  }
});

test.after(() => {
  const saida = path.join(raiz, 'dist', 'ia-demo'); fs.mkdirSync(saida, { recursive: true });
  fs.writeFileSync(path.join(saida, 'benchmark.json'), JSON.stringify(BENCH, null, 2));
});

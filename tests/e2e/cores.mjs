// E2E do SEPARAR POR COR pra fabricação, pela tela: personagem pintado
// (olhos em relevo brancos, botão vermelho) -> Separar por cor (espessura
// padrão 0,8) -> prévia diz como cada cor saiu -> Confirmar: 3 peças
// fechadas, sem cruzamento, que montadas não se sobrepõem e somam o volume
// do original; 3MF ida e volta; Ctrl+Z volta a peça pintada. Faixa pintada
// em volta de um cilindro (borda da pintura em zigue-zague): o inserto sai
// com folga dos lados e sem aviso de borda serrilhada. E pane do motor: o
// worker sobe de novo e a próxima operação funciona.
import fs from 'node:fs';
import path from 'node:path';
import { carregarManifold } from '../util/manifold.mjs';
import { gerarPersonagem } from '../util/personagem.mjs';
import { escrever3MF } from '../../src/estudio3d/core/formatos/tmf.js';
import { comContexto, manifold } from '../../src/estudio3d/core/solidos.js';
import { validar } from '../../src/estudio3d/core/validador.js';
import { volume, criar, transformar, centroidesFace } from '../../src/estudio3d/core/malha.js';
import { executar } from '../../src/estudio3d/motor/operacoes.js';
import * as M4 from '../../src/estudio3d/core/mat4.js';

export async function secaoCores({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia }) {
  const W = await carregarManifold();
  const pers = gerarPersonagem({ argola: false });
  const arq = path.join(tmp, 'personagem-3cores.3mf');
  fs.writeFileSync(arq, escrever3MF({ objetos: [{ nome: 'Personagem', transform: M4.translacao(128, 128, 0), partes: [{ nome: 'Corpo', malha: pers.malha, cor: '#1B1B1B', paleta: pers.paleta }] }] }).bytes);
  const v0 = volume(pers.malha);
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const objetos = () => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.map(o => ({ nome: o.nome, t: Array.from(o.transform), partes: o.partes.map(p => ({ cor: p.cor, paleta: p.paleta, pos: Array.from(p.malha.pos), idx: Array.from(p.malha.idx) })) })));
  const noMundo = o => o.partes.map(p => transformar(criar(Float64Array.from(p.pos), Uint32Array.from(p.idx)), o.t));
  const man = m => new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.pos), triVerts: Uint32Array.from(m.idx) }));
  const separar = async () => {
    await abrirSecao(pg, 'cor');
    if ((await pg.inputValue('[data-sec=cor] [data-a="espCor"]')) !== '0,8') throw new Error('espessura padrão não é 0,8');
    await pg.click('[data-sec=cor] [data-a="porCor"]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 180000 });
    return pg.textContent('.e3d-previa');
  };
  await passo(pg, 'personagem pintado (3 cores): Separar por cor, prévia diz como cada cor saiu, nada falhou', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', arq);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    const t = await separar();
    if (!/3 peças/.test(t)) throw new Error('prévia: ' + t);
    if (!/Como saiu:/.test(t) || /NÃO virou/.test(t)) throw new Error('resumo: ' + t);
    await confirmarPrevia(pg);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 3, null, { timeout: 20000 });
  });
  await passo(pg, 'as 3 peças: fechadas, sem cruzamento, montadas não se sobrepõem, volume somado = original (±3%)', async () => {
    const obs = await objetos();
    const cores = obs.map(o => o.partes[0].cor).sort();
    if (JSON.stringify(cores) !== JSON.stringify(['#1B1B1B', '#D1242F', '#FFFFFF'])) throw new Error('cores ' + cores);
    const ms = obs.map(o => noMundo(o)[0]);
    let vt = 0;
    ms.forEach((m, i) => {
      const v = validar(m, { completo: true });
      if (!v.fechada || v.componentesInvertidos || v.autoInterseccoes) throw new Error(cores[i] + ' fechada=' + v.fechada + ' cruz=' + v.autoInterseccoes);
      vt += v.volume;
    });
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const vi = man(ms[i]).intersect(man(ms[j])).volume();
      if (vi > 0.05) throw new Error('peças ' + i + ' e ' + j + ' se sobrepõem ' + vi.toFixed(3) + ' mm³');
    }
    if (Math.abs(vt / v0 - 1) > 0.03) throw new Error('volume ' + vt + ' x ' + v0);
  });
  await passo(pg, '3MF das peças e abrir de novo: mesmo volume; Ctrl+Z volta a peça pintada', async () => {
    await abrirSecao(pg, 'exp');
    await pg.click('[data-sec=exp] [data-a=escopo] button[data-v=tudo]');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
    const f = path.join(tmp, 'cores.3mf'); await dl.saveAs(f);
    const r = executar('importar', { nome: 'x.3mf', bytes: new Uint8Array(fs.readFileSync(f)), extras: {} });
    const obs = await objetos();
    const vTela = obs.flatMap(o => noMundo(o)).reduce((s, m) => s + volume(m), 0);
    const vArq = r.objetos.flatMap(o => o.partes.map(p => volume(transformar(p.malha, o.transform)))).reduce((s, x) => s + x, 0);
    if (Math.abs(vArq / vTela - 1) > 1e-3) throw new Error('3MF mudou o volume ' + vArq + ' x ' + vTela);
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => { const o = window.Estudio3D.estudio.cena.objetos; return o.length === 1 && o[0].partes[0].paleta && o[0].partes[0].paleta.length === 3; }, null, { timeout: 10000 });
  });
  await passo(pg, 'faixa pintada em volta do cilindro (borda em zigue-zague): inserto com folga dos lados, sem aviso de borda serrilhada', async () => {
    const cil = comContexto(ctx => ctx.parte(ctx.guardar(manifold().Manifold.cylinder(40, 15, 15, 128).refineToLength(1)), 'c', '#1B1B1B').malha);
    const C = centroidesFace(cil), cor = new Uint16Array(cil.idx.length / 3);
    for (let t = 0; t < cor.length; t++) if (C[t * 3 + 2] > 18 && C[t * 3 + 2] < 24 && Math.hypot(C[t * 3], C[t * 3 + 1]) > 14.9) cor[t] = 1;
    const f = path.join(tmp, 'faixa.3mf');
    fs.writeFileSync(f, escrever3MF({ objetos: [{ nome: 'Faixa', transform: M4.translacao(128, 128, 0), partes: [{ nome: 'Copo', malha: { ...cil, cor }, cor: '#1B1B1B', paleta: ['#1B1B1B', '#FFFFFF'] }] }] }).bytes);
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos.length = 0; }); });
    await pg.setInputFiles('.e3d input[type=file][multiple]', f);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    const t = await separar();
    if (/serrilhada|NÃO virou/.test(t) || !/2 peças/.test(t)) throw new Error('prévia: ' + t);
    await confirmarPrevia(pg);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 20000 });
    const [a, bb] = (await objetos()).map(o => noMundo(o)[0]);
    // folga: inserto e corpo não se sobrepõem e sobra vão entre eles
    const ins = volume(a) < volume(bb) ? a : bb, corpo = ins === a ? bb : a;
    const I = man(corpo).intersect(man(ins));
    if (I.volume() > 0.05) throw new Error('inserto sobrepõe o corpo ' + I.volume().toFixed(3));
    const vazio = volume(cil) - volume(corpo) - volume(ins);
    if (!(vazio > 1)) throw new Error('sem folga entre inserto e bolso (' + vazio.toFixed(2) + ' mm³)');
  });
  await passo(pg, 'pane do motor 3D: mensagem clara, o worker sobe de novo e a operação seguinte funciona', async () => {
    const r = await pg.evaluate(async () => {
      const e = window.Estudio3D.estudio, w0 = e.motor.principal.worker;
      let erro = null;
      try { await e.rodar('_simularPane', {}, 'Teste'); } catch (x) { erro = { msg: x.message, codigo: x.codigo }; }
      await new Promise(r => setTimeout(r, 50));
      if (e.motor._reiniciando) await e.motor._reiniciando;
      const o = e.cena.objetos[0], p = o.partes[0];
      const med = await e.rodar('medidas', { parte: e.parteParaMotor(p) }, 'Medidas');
      return { erro, trocou: e.motor.principal.worker !== w0 && !!e.motor.principal.worker, volume: med.volume };
    });
    if (!r.erro || r.erro.codigo !== 'wasm' || !/pane/.test(r.erro.msg)) throw new Error('erro: ' + JSON.stringify(r.erro));
    if (!r.trocou) throw new Error('worker não foi trocado');
    if (!(r.volume > 0)) throw new Error('operação depois da pane falhou');
    const toast = await pg.textContent('body');
    if (!/pane interna/.test(toast)) throw new Error('a tela não avisou da pane');
    // o console.error da pane é esperado (a tela registra todo erro de operação)
    if (pg.erros) pg.erros = pg.erros.filter(x => !/pane interna/.test(x));
  });
  await pg.context().close();
}

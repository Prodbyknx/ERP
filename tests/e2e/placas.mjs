// E2E das PLACAS pela tela: organizar cria placas sozinho, botão +, peça nova
// entra na placa ativa, levar peça pra outra placa, exportar um 3MF por
// placa (cada um na posição da placa 1), abrir de novo o "tudo num arquivo"
// e as placas voltam, clicar numa placa ativa, Preparar puxa peça pra dentro.
import fs from 'node:fs';
import path from 'node:path';
import { executar } from '../../src/estudio3d/motor/operacoes.js';
import { carregarManifold } from '../util/manifold.mjs';
import * as M4 from '../../src/estudio3d/core/mat4.js';

export async function secaoPlacas({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao }) {
  await carregarManifold();
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const E = () => pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena; return { placas: c.placas, ativa: c.placaAtiva, onde: c.objetos.map(o => c.placaDe(o)), dentro: c.objetos.map(o => { const b2 = c.caixaExata(o), k = c.placaDe(o); if (k < 0) return false; const p = c.origemPlaca(k); return b2.min[0] >= p[0] - 1e-6 && b2.min[1] >= p[1] - 1e-6 && b2.max[0] <= p[0] + c.mesa.x + 1e-6 && b2.max[1] <= p[1] + c.mesa.y + 1e-6; }) }; });
  const baixados = [];
  pg.on('download', d => baixados.push(d));

  await passo(pg, 'organizar: 6 caixas de 100×100 -> cria a placa 2 sozinho, cada uma dentro da sua placa; barra mostra as placas', async () => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    for (const [k, v] of [['largura', '100'], ['profundidade', '100'], ['altura', '20']]) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', v); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(250); }
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[1] - c.min[1] - 100) < 1e-6; }, null, { timeout: 30000 });
    for (let i = 0; i < 5; i++) { await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.duplicarObjeto(e.cena.objetos[0].id); }); }
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 6, null, { timeout: 10000 });
    await pg.click('.e3d-top [data-b=organizar]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.placas === 2, null, { timeout: 10000 });
    const e = await E();
    if (e.dentro.some(x => !x)) throw new Error('peça fora da placa: ' + JSON.stringify(e));
    if (JSON.stringify([0, 1].map(k => e.onde.filter(x => x === k).length)) !== '[4,2]') throw new Error('distribuição ' + JSON.stringify(e.onde));
    if (await pg.locator('.e3d-placas button[data-placa]').count() !== 2) throw new Error('barra de placas');
  });

  await passo(pg, 'botão + cria a placa 3 (ativa) e a esfera nova entra nela; clicar na placa 1 vazia de lado ativa ela', async () => {
    await pg.evaluate(() => window.Estudio3D.estudio.cena.selecionar(null, null));
    await pg.click('.e3d-placas [data-b=maisPlaca]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.placas === 3 && window.Estudio3D.estudio.cena.placaAtiva === 2, null, { timeout: 10000 });
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=esfera]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 7, null, { timeout: 30000 });
    const e = await E();
    if (e.onde[6] !== 2) throw new Error('esfera foi pra placa ' + (e.onde[6] + 1));
    // clicar numa área vazia da placa 1 (canto de cima, sem peça) ativa a placa 1
    await pg.evaluate(() => { const e2 = window.Estudio3D.estudio; e2.definirFerramenta('navegar'); const v = e2.visor; v.controles.target.set(128, 128, 0); v.camera.position.set(128, -150, 330); v.controles.update(); v.pedirRender(); });
    await pg.waitForTimeout(250);
    const s = await pg.evaluate(() => window.Estudio3D.estudio.visor.telaDe(245, 250, 0));
    await pg.mouse.click(s.x, s.y);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.placaAtiva === 0, null, { timeout: 5000 });
  });

  await passo(pg, 'levar uma caixa pra placa 3 (Ajustar → Placa → 3): muda de placa, continua dentro', async () => {
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    await abrirSecao(pg, 'transf');
    await pg.waitForSelector('[data-sec=transf] [data-a=blocoPlaca]:not([style*="none"])', { timeout: 5000 });
    await pg.click('[data-sec=transf] [data-a=placa] button[data-v="2"]');
    await pg.waitForFunction(() => { const c = window.Estudio3D.estudio.cena; return c.placaDe(c.objetos[0]) === 2; }, null, { timeout: 5000 });
    const e = await E();
    if (!e.dentro[0]) throw new Error('caixa fora da placa 3');
  });

  let tudo = null;
  await passo(pg, 'exportar "Todas as placas": um 3MF por placa, cada um com as peças dentro da mesa (posição da placa 1)', async () => {
    await abrirSecao(pg, 'exp');
    await pg.waitForSelector('[data-sec=exp] [data-a=escopo] button[data-v=todas].active', { timeout: 5000 });
    baixados.length = 0;
    await pg.click('[data-sec=exp] [data-a="3mf"]');
    await pg.waitForFunction(() => /arquivo\(s\)/.test(document.querySelector('[data-sec=exp] [data-a=res]').textContent), null, { timeout: 120000 });
    if (baixados.length !== 3) throw new Error(baixados.length + ' downloads');
    const nomes = baixados.map(d => d.suggestedFilename()).sort();
    if (!nomes.every((n, i) => n.endsWith(' - placa ' + (i + 1) + '.3mf'))) throw new Error('nomes ' + nomes.join(', '));
    const contagem = [];
    for (const d of baixados) {
      const arq = path.join(tmp, d.suggestedFilename()); await d.saveAs(arq);
      const r = executar('importar', { nome: 'x.3mf', bytes: new Uint8Array(fs.readFileSync(arq)), extras: {} });
      contagem.push(r.objetos.length);
      for (const o of r.objetos) {
        const pts = []; const t = o.transform || M4.identidade();
        for (const p of o.partes) for (let i = 0; i < p.malha.pos.length; i += 3) pts.push(...M4.aplicarPonto(t, p.malha.pos[i], p.malha.pos[i + 1], p.malha.pos[i + 2]));
        const bx = { min: [0, 1, 2].map(e => Math.min(...pts.filter((_, i) => i % 3 === e))), max: [0, 1, 2].map(e => Math.max(...pts.filter((_, i) => i % 3 === e))) };
        if (bx.min[0] < -1e-3 || bx.min[1] < -1e-3 || bx.max[0] > 256.001 || bx.max[1] > 256.001) throw new Error(d.suggestedFilename() + ': fora da mesa ' + bx.min + ' / ' + bx.max);
      }
    }
    if (contagem.reduce((a, x) => a + x, 0) !== 7) throw new Error('objetos por arquivo ' + contagem);
    // e o "tudo num arquivo só" pra abrir de novo
    await pg.click('[data-sec=exp] [data-a=escopo] button[data-v=tudo]');
    baixados.length = 0;
    await pg.click('[data-sec=exp] [data-a="3mf"]');
    await pg.waitForFunction(() => /3MF gerado/.test(document.querySelector('[data-sec=exp] [data-a=res]').textContent), null, { timeout: 120000 });
    tudo = path.join(tmp, 'tudo-placas.3mf'); await baixados[0].saveAs(tudo);
  });

  await passo(pg, 'Preparar pra imprimir: caixa passando da borda da placa volta pra dentro', async () => {
    // caixa da placa 1 passando 30 mm da borda da direita
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena, o = c.objetos.find(x => c.placaDe(x) === 0 && x.nome.startsWith('Caixa')); const bx = c.caixaExata(o); c.aplicar('empurrar', () => { o.transform[12] += 256 + 30 - bx.max[0]; }); });
    const antes = await E();
    if (antes.dentro[1]) throw new Error('não saiu da borda (teste)');
    await pg.click('.e3d-top [data-b=preparar]');
    await pg.waitForSelector('.e3d-preparar [data-a=exportar]', { timeout: 120000 });
    const e = await E();
    if (e.dentro.some(x => !x)) throw new Error('ainda tem peça fora: ' + JSON.stringify(e.dentro));
    if (!/trazida\(s\) pra dentro da placa/.test(await pg.textContent('.e3d-preparar'))) throw new Error('relatório não diz');
    await pg.click('.e3d-preparar .tp button');
  });
  await pg.context().close();

  const pg2 = await novaPagina(b);
  await abrirEstudio(pg2, 'file://' + teste + '/index.html');
  await passo(pg2, 'abrir o 3MF "tudo num arquivo": as 3 placas voltam e cada peça fica na sua', async () => {
    await pg2.setInputFiles('.e3d input[type=file][multiple]', tudo);
    await pg2.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 7, null, { timeout: 60000 });
    const e = await pg2.evaluate(() => { const c = window.Estudio3D.estudio.cena; return { placas: c.placas, onde: c.objetos.map(o => c.placaDe(o)) }; });
    if (e.placas !== 3) throw new Error('placas ' + e.placas);
    if (JSON.stringify([0, 1, 2].map(k => e.onde.filter(x => x === k).length)) !== '[3,2,2]') throw new Error('distribuição ' + JSON.stringify(e.onde));
  });
  await pg2.context().close();
}

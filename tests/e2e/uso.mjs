// E2E "COMO O USUÁRIO USA": só cliques e arrastes de verdade (nada de chamar
// função por dentro). Cada passo é um defeito achado na auditoria prática:
// arrastar a peça na mesa, Duplicar -> Excluir (só a cópia), Base Z depois de
// girar, pincel no topo do cilindro, corte com conector em placa fina (pino
// solto) e placa fininha (alerta "SEM conector" em destaque).
import fs from 'node:fs';
import path from 'node:path';

export async function secaoUso({ b, teste, tmp, novaPagina, passo, abrirEstudio }) {
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const sec = s => '#ferr_estudio [data-sec=' + s + '] ';
  const ferr = s => pg.click('#ferr_estudio .e3d-rail [data-ferr=' + s + ']');
  const motor = () => pg.waitForFunction(() => { const s = document.querySelector('#ferr_estudio .e3d-motor span'); return s && /pronto/.test(s.textContent); }, null, { timeout: 120000 });
  const forma = async n => { await ferr('formas'); await pg.locator(sec('formas') + 'button', { hasText: new RegExp('^' + n + '$') }).click(); await pg.waitForTimeout(250); await motor(); };
  const caixa = (i = 0) => pg.evaluate(k => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[k]); }, i);
  const nObj = () => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
  const limpar = () => pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos = []; e.cena.sel = { objeto: null, parte: null }; e.cena.multi = []; }); });
  const tela = (fx, fy, i = 0) => pg.evaluate(([fx, fy, i]) => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[i]); return e.visor.telaDe(c.min[0] + (c.max[0] - c.min[0]) * fx, c.min[1] + (c.max[1] - c.min[1]) * fy, c.max[2]); }, [fx, fy, i]);

  await passo(pg, 'USO: segurar a peça e arrastar move ela na mesa (não gira a câmera); Ctrl+Z volta', async () => {
    await forma('Cubo');
    const c0 = await caixa(), p = await tela(0.2, 0.25);
    await pg.mouse.move(p.x, p.y); await pg.mouse.down();
    for (let k = 1; k <= 10; k++) await pg.mouse.move(p.x + k * 8, p.y, { steps: 2 });
    await pg.mouse.up(); await pg.waitForTimeout(300);
    const c1 = await caixa();
    if (!(Math.abs(c1.min[0] - c0.min[0]) > 5) || Math.abs(c1.min[2]) > 1e-6) throw new Error('não moveu: ' + c0.min + ' -> ' + c1.min);
    await pg.keyboard.press('Control+z'); await pg.waitForTimeout(300);
    const c2 = await caixa();
    if (Math.abs(c2.min[0] - c0.min[0]) > 1e-6) throw new Error('Ctrl+Z não voltou');
  });

  await passo(pg, 'USO: botão direito -> Duplicar e depois Excluir apaga SÓ a cópia', async () => {
    const menu = async rot => {
      const p = await tela(0.3, 0.3, (await nObj()) - 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.locator('[role=menuitem]', { hasText: rot }).first().click(); await pg.waitForTimeout(400);
    };
    await menu('Duplicar');
    if (await nObj() !== 2) throw new Error('duplicar: ' + await nObj());
    await menu('Excluir');
    if (await nObj() !== 1) throw new Error('excluir apagou ' + (2 - await nObj()) + ' peça(s)');
  });

  await passo(pg, 'USO: depois de girar, "Base Z = 0" deixa a peça NA mesa (antes ia pra baixo dela)', async () => {
    await limpar(); await forma('Caixa');
    await ferr('transf'); await pg.waitForTimeout(200);
    await pg.click(sec('transf') + '[data-a=gy]'); await pg.waitForTimeout(200);
    for (const [k, v] of [['pz', '7'], ['pz', '0'], ['px', '100']]) { const f = pg.locator(sec('transf') + '[data-t=' + k + ']'); await f.fill(v); await f.press('Enter'); await pg.waitForTimeout(250); }
    const c = await caixa();
    if (Math.abs(c.min[2]) > 1e-6 || Math.abs((c.min[0] + c.max[0]) / 2 - 100) > 1e-6) throw new Error('base ' + c.min[2] + ', centro X ' + (c.min[0] + c.max[0]) / 2);
  });

  await passo(pg, 'USO: pincel Puxar no topo do cilindro sobe a pele (antes desfazia com "cruzamento")', async () => {
    await limpar(); await forma('Cilindro');
    await ferr('esc'); await pg.waitForTimeout(200);
    await pg.click(sec('esc') + '[data-a=tipo] button[data-v=puxar]');
    const c0 = await caixa(), p = await tela(0.5, 0.5);
    await pg.mouse.move(p.x - 15, p.y); await pg.mouse.down();
    for (let k = 0; k <= 15; k++) await pg.mouse.move(p.x - 15 + k * 2, p.y, { steps: 2 });
    await pg.mouse.up(); await pg.waitForTimeout(800); await motor();
    const c1 = await caixa(), info = await pg.textContent(sec('esc') + '[data-a=info]');
    if (!(c1.max[2] > c0.max[2] + 0.05) || /atravessar/.test(info)) throw new Error('não subiu: ' + c0.max[2] + ' -> ' + c1.max[2] + ' | ' + info);
  });

  const cortarMeio = async () => {
    await ferr('corte'); await pg.waitForTimeout(250);
    await pg.selectOption(sec('corte') + '[data-a="tipo"]', 'cilindrico');
    await pg.click(sec('corte') + '[data-a="meio"]');
    await pg.click(sec('corte') + '[data-a="ir"]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
    return (await pg.textContent('.e3d-previa')).replace(/\s+/g, ' ');
  };
  await passo(pg, 'USO: cortar placa de 6 mm na espessura com pino -> pino SOLTO (antes cortava sem nada)', async () => {
    await limpar(); await forma('Placa');
    await ferr('transf'); await pg.waitForTimeout(200);
    const f = pg.locator(sec('transf') + '[data-t=tz]'); await pg.uncheck(sec('transf') + '[data-t=prop]'); await f.fill('6'); await f.press('Enter'); await pg.waitForTimeout(300);
    const t = await cortarMeio();
    if (!/PINO SOLTO/.test(t) || !/conector/.test(t) || /SEM conector/.test(t)) throw new Error(t.slice(0, 300));
    await pg.click('.e3d-previa button.primary'); await pg.waitForTimeout(500);
    const nomes = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.map(o => o.nome));
    if (!nomes.some(n => /Pino solto/.test(n))) throw new Error('pino solto não foi pra mesa: ' + nomes);
  });
  await passo(pg, 'USO: placa de 2 mm não comporta pino -> prévia diz "Saiu SEM conector" e o botão avisa', async () => {
    await limpar(); await forma('Placa');
    const t = await cortarMeio();
    const bt = await pg.textContent('.e3d-previa button.primary');
    if (!/Saiu SEM conector/.test(t) || !/espessura/.test(t) || !/sem conector/i.test(bt)) throw new Error(t.slice(0, 300) + ' | ' + bt);
    await pg.click('.e3d-previa button:not(.primary)');
  });
  await passo(pg, 'USO: abrir STL com duas peças que se atravessam -> Consertar junta num sólido só e fica "Pronto pra fatiar" (antes o volume ia a zero)', async () => {
    await limpar();
    // STL binário: dois cubos de 20 mm, um atravessando o outro
    const tris = [];
    const cubo = (o) => { const p = [[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]].map(v => v.map((c, i) => c + o[i]));
      for (const [a, b, c] of [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]) tris.push([p[a], p[b], p[c]]); };
    cubo([0, 0, 0]); cubo([10, 10, 10]);
    const buf = Buffer.alloc(84 + tris.length * 50); buf.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.forEach((v, k) => v.forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
    const arq = path.join(tmp, 'sobrepostas.stl'); fs.writeFileSync(arq, buf);
    await pg.setInputFiles('#ferr_estudio .e3d input[type=file][multiple]', arq);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await ferr('diag');
    await pg.waitForFunction(s => /Auto-interseções\s*4/.test(document.querySelector(s).textContent), sec('diag') + '[data-a=resultado]', { timeout: 60000 });
    await pg.click(sec('diag') + '[data-a=reparar]');
    await pg.waitForFunction(s => /Pronto pra fatiar/.test(document.querySelector(s).textContent), sec('diag') + '[data-a=resultado]', { timeout: 60000 });
    const t = await pg.textContent(sec('diag') + '[data-a=resultado]');
    if (!/juntou 2 partes/.test(t) || !/Volume\s*15,00 cm³/.test(t) || !/Objetos desconectados\s*1/.test(t)) throw new Error(t.slice(0, 600));
  });
  await pg.context().close();
}

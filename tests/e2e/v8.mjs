// E2E v8 pela tela: tubo que sobe (altura por ponto), EDITAR o desenho
// depois de criado (e desfazer), perfil desenhado EM PÉ vira vaso, tubo
// SOBRE a peça, texto passando da QUINA da caixa, pincel de VINCAR.
import { validar } from '../../src/estudio3d/core/validador.js';
import { caixa } from '../../src/estudio3d/core/malha.js';

export async function secaoV8({ b, teste, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia }) {
  const pg = await novaPagina(b);
  pg.on('dialog', dl => dl.accept());
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const malha = (k, j = 0) => pg.evaluate(([i, jj]) => { const m = window.Estudio3D.estudio.cena.objetos[i].partes[jj].malha; return { pos: Array.from(m.pos), idx: Array.from(m.idx) }; }, [k, j]);
  const M = m => ({ pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) });
  const limpo = (m, rot) => { const v = validar(M(m), { completo: true }); if (!v.fechada || v.autoInterseccoes || v.facesDegeneradas) throw new Error(rot + ': ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas })); return v; };
  const nObj = () => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
  const caixaObj = k => pg.evaluate(i => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[i]); return { min: c.min, max: c.max }; }, k);
  const camera = (alvo, pos) => pg.evaluate(([a, p]) => { const v = window.Estudio3D.estudio.visor; v.controles.target.set(...a); v.camera.position.set(...p); v.controles.update(); v.pedirRender(); }, [alvo, pos]);
  const clicarEm = async (x, y, z) => { const s = await pg.evaluate(([a, b2, c]) => window.Estudio3D.estudio.visor.telaDe(a, b2, c), [x, y, z]); await pg.mouse.click(s.x, s.y); await pg.waitForTimeout(70); };
  const seg = (a, v) => pg.click('[data-sec=des] [data-a=' + a + '] button[data-v=' + v + ']');

  await passo(pg, 'tubo que sobe: 3 pontos na mesa, o do meio a 20 mm de altura -> alça em arco, sólida', async () => {
    await pg.evaluate(() => window.Estudio3D.estudio.cena.selecionar(null, null));
    await abrirSecao(pg, 'des');
    await seg('onde', 'mesa'); await seg('modo', 'tubo'); await seg('linha', 'suave');
    await camera([20, 0, 8], [20, -110, 70]); await pg.waitForTimeout(200);
    for (const [x, y] of [[0, 0], [20, 0], [40, 0]]) await clicarEm(x, y, 0);
    await clicarEm(20, 0, 0);                       // escolhe o do meio
    await pg.waitForSelector('[data-sec=des] [data-a=optAltura]:not([style*="none"])', { timeout: 5000 });
    await pg.fill('[data-sec=des] [data-a=altura]', '20'); await pg.press('[data-sec=des] [data-a=altura]', 'Enter');
    const n = await nObj();
    await pg.click('[data-sec=des] [data-a=criar]');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n, { timeout: 30000 });
    limpo(await malha(n), 'alça');
    const c = await caixaObj(n);
    if (Math.abs(c.max[2] - 24) > 0.3 || Math.abs(c.min[2]) > 1e-6 || Math.abs(c.max[0] - c.min[0] - 44) > 0.3) throw new Error('medida da alça ' + JSON.stringify(c));
  });

  await passo(pg, 'EDITAR depois de criar: escolhe a alça, "Editar o desenho", ponto do meio pra 10 mm, Atualizar; Ctrl+Z volta', async () => {
    const k = (await nObj()) - 1;
    await pg.evaluate(i => { const e = window.Estudio3D.estudio; e.cena.selecionar(e.cena.objetos[i].id, e.cena.objetos[i].partes[0].id); }, k);
    await pg.waitForSelector('[data-sec=des] [data-a=editarBarra]:not([style*="none"])', { timeout: 5000 });
    await pg.click('[data-sec=des] [data-a=editar]');
    await clicarEm(20, 0, 20);                      // o ponto do meio (lá no alto)
    await pg.waitForSelector('[data-sec=des] [data-a=optAltura]:not([style*="none"])', { timeout: 5000 });
    await pg.fill('[data-sec=des] [data-a=altura]', '10'); await pg.press('[data-sec=des] [data-a=altura]', 'Enter');
    if (await pg.textContent('[data-sec=des] [data-a=criar]') !== 'Atualizar peça') throw new Error('não entrou em edição');
    const n = await nObj();
    await pg.click('[data-sec=des] [data-a=criar]');
    await pg.waitForFunction(i => Math.abs(window.Estudio3D.estudio.cena.caixaExata(window.Estudio3D.estudio.cena.objetos[i]).max[2] - 14) < 0.3, k, { timeout: 30000 });
    if (await nObj() !== n) throw new Error('criou outra peça em vez de atualizar');
    limpo(await malha(k), 'alça editada');
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(i => Math.abs(window.Estudio3D.estudio.cena.caixaExata(window.Estudio3D.estudio.cena.objetos[i]).max[2] - 24) < 0.3, k, { timeout: 10000 });
  });

  await passo(pg, 'desenho EM PÉ (frente): perfil de 4 pontos + fechar -> Girar = vaso de pé onde foi desenhado', async () => {
    await pg.evaluate(() => window.Estudio3D.estudio.cena.selecionar(null, null));
    await seg('onde', 'frente'); await seg('modo', 'revolucionar'); await seg('linha', 'reta');
    await camera([80, 0, 10], [80, -120, 12]); await pg.waitForTimeout(200);
    for (const [x, z] of [[70, 0], [82, 0], [78, 15], [70, 15], [70, 0]]) await clicarEm(x, 0, z);
    await pg.waitForFunction(() => /fechado/.test(document.querySelector('[data-sec=des] [data-a=info]').innerHTML), null, { timeout: 5000 });
    const n = await nObj();
    await pg.click('[data-sec=des] [data-a=criar]');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n, { timeout: 30000 });
    limpo(await malha(n), 'vaso');
    const c = await caixaObj(n);
    // eixo em x = 70, raio 12, altura 15, de pé
    if (Math.abs((c.min[0] + c.max[0]) / 2 - 70) > 0.3 || Math.abs(c.max[0] - c.min[0] - 24) > 0.3 || Math.abs(c.max[2] - 15) > 0.05 || Math.abs(c.min[2]) > 0.05) throw new Error('vaso ' + JSON.stringify(c));
  });

  await passo(pg, 'tubo SOBRE a peça: 3 cliques numa esfera -> tubo colado na superfície (cipó), sólido', async () => {
    const n0 = await nObj();
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=esfera]');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n0, { timeout: 30000 });
    await pg.fill('[data-sec=formas] [data-p=diametro]', '40'); await pg.press('[data-sec=formas] [data-p=diametro]', 'Enter');
    await pg.waitForFunction(k => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[k]); return Math.abs(c.max[0] - c.min[0] - 40) < 0.5; }, n0, { timeout: 30000 });
    const c = await caixaObj(n0), ce = [0, 1, 2].map(i => (c.min[i] + c.max[i]) / 2);
    await camera(ce, [ce[0], ce[1] - 110, ce[2] + 20]); await pg.waitForTimeout(200);
    await abrirSecao(pg, 'des');
    await seg('onde', 'sobre'); await seg('linha', 'suave');
    await pg.fill('[data-sec=des] [data-a=diam]', '3');
    const R = 20;
    for (const a of [-50, 0, 50]) { const t = a * Math.PI / 180; await clicarEm(ce[0] + R * Math.sin(t), ce[1] - R * Math.cos(t), ce[2] + 6); }
    const n = await nObj();
    await pg.click('[data-sec=des] [data-a=criar]');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n, { timeout: 30000 });
    const m = await malha(n); limpo(m, 'cipó');
    let dmin = Infinity, dmax = 0;
    for (let i = 0; i < m.pos.length; i += 3) { const d = Math.hypot(m.pos[i] - ce[0], m.pos[i + 1] - ce[1], m.pos[i + 2] - ce[2]); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    if (dmin < R - 1 || dmax > R + 3.5) throw new Error('não seguiu a superfície: ' + dmin.toFixed(2) + '..' + dmax.toFixed(2));
  });

  await passo(pg, 'texto passando da QUINA: clica perto do topo da frente da caixa -> letras continuam no topo, 1 mm', async () => {
    const n0 = await nObj();
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n0, { timeout: 30000 });
    for (const [k, v] of [['largura', '40'], ['profundidade', '40'], ['altura', '20']]) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', v); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(300); }
    await pg.waitForFunction(k => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[k]); return Math.abs(c.max[2] - c.min[2] - 20) < 1e-6 && Math.abs(c.max[1] - c.min[1] - 40) < 1e-6; }, n0, { timeout: 30000 });
    const c = await caixaObj(n0), cx = (c.min[0] + c.max[0]) / 2;
    await pg.evaluate(k => { const e = window.Estudio3D.estudio; e.cena.selecionar(e.cena.objetos[k].id, e.cena.objetos[k].partes[0].id); }, n0);
    await camera([cx, c.min[1], 15], [cx, c.min[1] - 90, 50]); await pg.waitForTimeout(200);
    await abrirSecao(pg, 'relevo');
    await pg.click('[data-sec=relevo] [data-a=lado] button[data-v=ponto]');
    await clicarEm(cx, c.min[1], 17);
    await pg.fill('[data-sec=relevo] [data-a=texto]', 'I');
    await pg.fill('[data-sec=relevo] [data-a=largura]', '6');
    await pg.selectOption('[data-sec=relevo] [data-a=modo]', 'alto-cor');
    await pg.waitForTimeout(300);
    await pg.click('[data-sec=relevo] [data-a=ir]'); await confirmarPrevia(pg);
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos[k].partes.length === 2, n0, { timeout: 60000 });
    const p = await malha(n0, 1); limpo(p, 'letra na quina');
    const cp = caixa(M(p));
    if (!(cp.max[2] > c.max[2] + 0.9 && cp.max[1] > c.min[1] + 0.5)) throw new Error('não dobrou pro topo: letra ' + JSON.stringify(cp) + ' caixa ' + JSON.stringify(c));
  });

  await passo(pg, 'pincel VINCAR: arrastar na esfera faz um sulco (malha válida, mais triângulos)', async () => {
    const k = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.findIndex(o => o.nome === 'Esfera'));
    await pg.evaluate(i => { const e = window.Estudio3D.estudio; e.cena.selecionar(e.cena.objetos[i].id, e.cena.objetos[i].partes[0].id); e.enquadrar(); }, k);
    await pg.waitForTimeout(400);
    const antes = (await malha(k)).idx.length;
    await abrirSecao(pg, 'esc');
    await pg.click('[data-sec=esc] [data-a=tipo] button[data-v=vincar]');
    const c = await caixaObj(k), ce = [0, 1, 2].map(i => (c.min[i] + c.max[i]) / 2);
    const s0 = await pg.evaluate(([a, b2, cc]) => window.Estudio3D.estudio.visor.telaDe(a, b2, cc), [ce[0] - 8, c.min[1] + 2, ce[2]]);
    const s1 = await pg.evaluate(([a, b2, cc]) => window.Estudio3D.estudio.visor.telaDe(a, b2, cc), [ce[0] + 8, c.min[1] + 2, ce[2]]);
    await pg.mouse.move(s0.x, s0.y); await pg.mouse.down();
    for (let i = 1; i <= 12; i++) await pg.mouse.move(s0.x + (s1.x - s0.x) * i / 12, s0.y + (s1.y - s0.y) * i / 12, { steps: 2 });
    await pg.mouse.up();
    await pg.waitForFunction(() => /Traço aplicado/.test(document.querySelector('[data-sec=esc] [data-a=info]').textContent), null, { timeout: 30000 });
    const m = await malha(k); limpo(m, 'vincada');
    if (!(m.idx.length > antes)) throw new Error('sem detalhe no vinco');
  });
  await pg.context().close();
}

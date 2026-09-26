// E2E da modelagem orgânica: esculpir com simetria (arrastando o mouse),
// torcer com prévia, desenhar um contorno na mesa e virar peça.
// Chamado por run.mjs; dá pra rodar sozinho com um pacote de teste pronto.
import { validar } from '../../src/estudio3d/core/validador.js';
import { caixa } from '../../src/estudio3d/core/malha.js';

export async function secaoOrganico({ b, teste, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia }) {
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const malha = k => pg.evaluate(i => { const m = window.Estudio3D.estudio.cena.objetos[i].partes[0].malha; return { pos: Array.from(m.pos), idx: Array.from(m.idx) }; }, k);
  const valida = (m, rot) => {
    const M = { pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) }, v = validar(M, { completo: true });
    if (!v.fechada || v.autoInterseccoes || v.facesDegeneradas || !(v.volume > 0)) throw new Error(rot + ': ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas }));
    return { v, cx: caixa(M) };
  };
  const tela = (i, fx, fy, fz) => pg.evaluate(([k, a, b2, c]) => { const e = window.Estudio3D.estudio, x = e.cena.caixaExata(e.cena.objetos[k]); return e.visor.telaDe(x.min[0] + a * (x.max[0] - x.min[0]), x.min[1] + b2 * (x.max[1] - x.min[1]), x.min[2] + c * (x.max[2] - x.min[2])); }, [i, fx, fy, fz]);

  let antes = null;
  await passo(pg, 'esculpir: esfera, mais detalhe, traço com simetria X (os 2 lados mudam, malha fechada, sem se cruzar)', async () => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=esfera]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    await pg.fill('[data-sec=formas] [data-p=diametro]', '40'); await pg.press('[data-sec=formas] [data-p=diametro]', 'Enter');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[0] - c.min[0] - 40) < 0.5; }, null, { timeout: 30000 });
    await pg.evaluate(() => window.Estudio3D.estudio.enquadrar());
    await pg.waitForTimeout(500);
    await abrirSecao(pg, 'esc');
    const n0 = (await malha(0)).idx.length;
    await pg.click('[data-sec=esc] [data-a=refinar]');
    await pg.waitForFunction(() => /triângulos/.test(document.querySelector('[data-sec=esc] [data-a=info]').textContent), null, { timeout: 60000 });
    if ((await malha(0)).idx.length < n0) throw new Error('refinar perdeu triângulos');
    antes = await malha(0);
    await pg.click('[data-sec=esc] [data-a=sim] button[data-v=x]');
    await pg.evaluate(() => { const r = document.querySelector('[data-sec=esc] [data-a=forca]'); r.value = '0.8'; r.dispatchEvent(new Event('input')); });
    // traço na frente da esfera, lado direito
    const c = await tela(0, 0.5, 0.5, 0.5), d = await tela(0, 1, 0.5, 0.5), rpx = Math.abs(d.x - c.x);
    await pg.mouse.move(c.x + rpx * 0.35, c.y - rpx * 0.1);
    await pg.mouse.down();
    for (let k = 1; k <= 12; k++) await pg.mouse.move(c.x + rpx * (0.35 + k * 0.02), c.y - rpx * 0.1 - k, { steps: 2 });
    await pg.mouse.up();
    await pg.waitForFunction(() => /Traço aplicado/.test(document.querySelector('[data-sec=esc] [data-a=info]').textContent), null, { timeout: 30000 });
    const depois = await malha(0);
    if (depois.pos.length !== antes.pos.length) throw new Error('vértices mudaram de número');
    const { cx } = valida(depois, 'esculpida'), meio = (cx.min[0] + cx.max[0]) / 2;
    let dir = 0, esq = 0, maior = 0;
    for (let v = 0; v < antes.pos.length / 3; v++) {
      const dd = Math.hypot(depois.pos[v * 3] - antes.pos[v * 3], depois.pos[v * 3 + 1] - antes.pos[v * 3 + 1], depois.pos[v * 3 + 2] - antes.pos[v * 3 + 2]);
      if (dd > 0.05) { if (antes.pos[v * 3] > meio + 2) dir++; else if (antes.pos[v * 3] < meio - 2) esq++; }
      maior = Math.max(maior, dd);
    }
    if (!(dir > 5 && esq > 5 && maior > 0.3)) throw new Error('simetria/traço: dir ' + dir + ' esq ' + esq + ' maior ' + maior.toFixed(3));
    if (await pg.evaluate(() => !!window.Estudio3D.estudio.cena.objetos[0].forma)) throw new Error('forma continuou paramétrica depois de esculpida');
  });
  await passo(pg, 'esculpir: Ctrl+Z desfaz o traço (volta exatamente a malha de antes)', async () => {
    await pg.keyboard.press('Control+z');
    const m = await malha(0);
    if (m.pos.length !== antes.pos.length || m.pos.some((x, i) => x !== antes.pos[i])) throw new Error('não voltou');
  });
  await passo(pg, 'deformar: caixa 20×20×40, torcer 45° com prévia (topo gira, altura mantida, sólido válido)', async () => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 30000 });
    for (const [k, v] of [['largura', '20'], ['profundidade', '20'], ['altura', '40']]) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', v); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(400); }
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[1]); return Math.abs(c.max[2] - c.min[2] - 40) < 1e-6 && Math.abs(c.max[0] - c.min[0] - 20) < 1e-6; }, null, { timeout: 30000 });
    await abrirSecao(pg, 'esc');
    await pg.click('[data-sec=esc] [data-a=def] button[data-v=torcer]');
    await pg.fill('[data-sec=esc] [data-a=valDef]', '45');
    await pg.click('[data-sec=esc] [data-a=aplDef]'); await confirmarPrevia(pg);
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[1]); return c.max[0] - c.min[0] > 26; }, null, { timeout: 60000 });
    const { cx } = valida(await malha(1), 'torcida');
    if (Math.abs(cx.tam[2] - 40) > 1e-3 || cx.tam[0] > 28.4) throw new Error('medida ' + cx.tam.map(x => x.toFixed(2)).join('x'));
  });
  await passo(pg, 'desenhar: 4 cliques na mesa + fechar, espessura 3 -> peça 30×20×3 válida; desfazer tira', async () => {
    await abrirSecao(pg, 'des');
    await pg.evaluate(() => window.Estudio3D.estudio.cena.selecionar(null, null));
    // câmera olhando a área livre da mesa (como o usuário faria girando/afastando)
    const cx = await pg.evaluate(() => {
      const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[1]), x0 = Math.round(c.max[0]) + 15, y0 = Math.round(c.min[1]), v = e.visor;
      v.controles.target.set(x0 + 15, y0 + 10, 0); v.camera.position.set(x0 + 15, y0 - 120, 110); v.controles.update(); v.pedirRender();
      return [x0, y0];
    });
    await pg.waitForTimeout(300);
    const pts = [[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]].map(([x, y]) => [cx[0] + x, cx[1] + y]);
    for (const [x, y] of pts) { const s = await pg.evaluate(([a, b2]) => window.Estudio3D.estudio.visor.telaDe(a, b2, 0), [x, y]); await pg.mouse.click(s.x, s.y); await pg.waitForTimeout(80); }
    await pg.waitForFunction(() => /contorno <b>fechado/.test(document.querySelector('[data-sec=des] [data-a=info]').innerHTML), null, { timeout: 10000 });
    await pg.fill('[data-sec=des] [data-a=esp]', '3');
    await pg.click('[data-sec=des] [data-a=criar]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 3, null, { timeout: 30000 });
    const r = valida(await malha(2), 'desenhada');
    const t = await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[2]); return [0, 1, 2].map(i => c.max[i] - c.min[i]).concat(c.min[2]); });
    if (Math.abs(t[0] - 30) > 0.51 || Math.abs(t[1] - 20) > 0.51 || Math.abs(t[2] - 3) > 1e-3 || Math.abs(t[3]) > 1e-3) throw new Error('medida ' + t.map(x => x.toFixed(2)).join(' '));
    if (Math.abs(r.v.volume - t[0] * t[1] * 3) > 1) throw new Error('volume ' + r.v.volume);
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 10000 });
  });
  await pg.context().close();
}

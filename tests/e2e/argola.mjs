// E2E da ARGOLA no gerador de chaveiro: centralizada por padrão (antes ia pro
// canto do topo reto), "Centralizar" desligado volta pro ponto mais alto,
// arrastar na prévia (3D e vista de cima) põe onde soltar e ela gruda na
// peça; solta longe, encosta na borda mais perto; trocar o tamanho mantém o
// lugar; meio com vão ("U") avisa e usa o ponto mais pra fora.
export async function secaoArgola({ b, teste, novaPagina, passo }) {
  const pg = await novaPagina(b);
  await pg.goto('file://' + teste + '/index.html');
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => showTab('ferr'));
  const info = () => pg.evaluate(() => { const p = FER.peca; return { furo: p.furo, c: p.arteCaixa, seg: ferSeg('fer_argola_seg'), avisos: p.avisos, rz: FER.vista.rz, rx: FER.vista.rx, bases: p.base.length }; });
  const esperar = n => pg.waitForFunction(k => FER.peca && FER.peca.furo && FER.peca.furo.x !== k, n, { timeout: 20000 });
  // arrasta a argola até o ponto (u, v) da caixa da arte, no canvas indicado
  const arrastar = async (id, u, v) => {
    const r = await pg.evaluate(([id, u, v]) => {
      const cv = document.getElementById(id), p = FER.peca, R = cv.getBoundingClientRect(), c = p.arteCaixa;
      const cli = t => [R.left + t[0] * R.width / cv.width, R.top + t[1] * R.height / cv.height];
      return { de: cli(ferTelaDoPonto(cv, p.furo.x, p.furo.y)), para: cli(ferTelaDoPonto(cv, c.x0 + u * c.w, c.y0 + v * c.h)), x: p.furo.x };
    }, [id, u, v]);
    await pg.mouse.move(...r.de); await pg.mouse.down();
    for (let i = 1; i <= 8; i++) await pg.mouse.move(r.de[0] + (r.para[0] - r.de[0]) * i / 8, r.de[1] + (r.para[1] - r.de[1]) * i / 8);
    await pg.mouse.up();
    await esperar(r.x);
  };
  // distância (px da máscara) do centro da argola até a caixa da arte
  const naBorda = f => f.furo.x > f.c.x0 + f.c.w && f.furo.x < f.c.x0 + f.c.w + f.furo.rAlca * 2;

  await passo(pg, 'argola: forma de topo reto (quadrado) sai CENTRALIZADA por padrão; sem "Centralizar" vai pro ponto mais alto (canto)', async () => {
    await pg.click('#fer_entrada_seg button[data-v=forma]');
    await pg.click('.fer-forma[data-f=quadrado]');
    await pg.waitForFunction(() => FER.peca && FER.peca.furo, null, { timeout: 20000 });
    if (!(await pg.isChecked('#fer_argola_meio'))) throw new Error('Centralizar não veio marcado');
    const a = await info(), meio = a.c.x0 + a.c.w / 2;
    if (Math.abs(a.furo.x - meio) > 2 || a.furo.y > a.c.y0) throw new Error('não centralizou: ' + JSON.stringify(a));
    await pg.uncheck('#fer_argola_meio'); await esperar(a.furo.x);
    const b2 = await info();
    if (!(Math.abs(b2.furo.x - meio) > a.c.w * 0.2)) throw new Error('desligado deveria ir pro canto: ' + JSON.stringify(b2));
    await pg.check('#fer_argola_meio'); await esperar(b2.furo.x);
  });
  await passo(pg, 'argola: ARRASTAR no 3D pra direita da peça -> fica ali, grudada (peça inteira), vira "Livre"; a vista não gira', async () => {
    const v0 = await info();
    await arrastar('fer_cv3d', 1.04, 0.5);
    const a = await info();
    if (a.seg !== 'livre') throw new Error('não virou Livre');
    if (!naBorda(a) || Math.abs(a.furo.y - (a.c.y0 + a.c.h / 2)) > a.c.h * 0.04) throw new Error('não ficou onde soltou: ' + JSON.stringify(a));
    if (a.bases !== 1) throw new Error('argola solta da peça: ' + a.bases + ' pedaços');
    if (a.rz !== v0.rz || a.rx !== v0.rx) throw new Error('girou a vista enquanto arrastava a argola');
  });
  await passo(pg, 'argola: soltar LONGE da peça -> encosta na borda mais perto (não fica voando)', async () => {
    await arrastar('fer_cv3d', 1.6, 0.5);
    const a = await info();
    if (!naBorda(a) || a.bases !== 1) throw new Error('ficou longe/solta: ' + JSON.stringify(a));
  });
  await passo(pg, 'argola: VISTA DE CIMA também arrasta (pro canto de baixo à esquerda); trocar o tamanho mantém o lugar', async () => {
    await pg.click('#fer_vista_seg button[data-v="2d"]');
    await arrastar('fer_cv2d', 0.1, 0.98);
    const a = await info(), u = (a.furo.x - a.c.x0) / a.c.w, v = (a.furo.y - a.c.y0) / a.c.h;
    if (!(u < 0.3 && v > 0.9) || a.bases !== 1) throw new Error('não foi pro canto de baixo: ' + JSON.stringify(a));
    const e0 = await pg.evaluate(() => FER.peca.escala);
    await pg.fill('#fer_tamanho', '80'); await pg.dispatchEvent('#fer_tamanho', 'input');
    await pg.waitForFunction(e => FER.peca && FER.peca.escala !== e, e0, { timeout: 20000 });
    const b2 = await info(), u2 = (b2.furo.x - b2.c.x0) / b2.c.w, v2 = (b2.furo.y - b2.c.y0) / b2.c.h;
    if (Math.abs(u2 - u) > 0.05 || Math.abs(v2 - v) > 0.05) throw new Error('mudou de lugar com o tamanho: ' + [u, v, u2, v2].map(x => x.toFixed(3)));
    await pg.click('#fer_vista_seg button[data-v="3d"]');
  });
  await passo(pg, 'argola: voltar pra "Em cima" centraliza de novo; "Livre" sem arrastar não pula', async () => {
    await pg.click('#fer_argola_seg button[data-v=topo]');
    await pg.waitForFunction(() => { const p = FER.peca; return p && Math.abs(p.furo.x - (p.arteCaixa.x0 + p.arteCaixa.w / 2)) < 2; }, null, { timeout: 20000 });
    await pg.evaluate(() => { FER.argolaPonto = null; });
    const a = await info();
    await pg.click('#fer_argola_seg button[data-v=livre]');
    await pg.waitForTimeout(700);
    const b2 = await info();
    if (Math.hypot(b2.furo.x - a.furo.x, b2.furo.y - a.furo.y) > 2) throw new Error('pulou: ' + JSON.stringify([a.furo, b2.furo]));
    if (await pg.isVisible('#fer_argola_meio')) throw new Error('Centralizar aparece no Livre');
  });
  await passo(pg, 'argola: meio com VÃO (letra U): avisa e usa o ponto mais pra fora; peça inteira', async () => {
    await pg.click('#fer_argola_seg button[data-v=topo]');
    await pg.click('#fer_entrada_seg button[data-v=texto]');
    await pg.fill('#fer_texto', 'U');
    await pg.waitForFunction(() => FER.peca && FER.peca.furo && FER.peca.avisos.some(a => /vão/.test(a)), null, { timeout: 20000 });
    const a = await info();
    if (a.bases !== 1 || a.furo.y > a.c.y0) throw new Error('argola errada no U: ' + JSON.stringify(a));
  });
  await pg.context().close();
}

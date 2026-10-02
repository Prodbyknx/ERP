// E2E da REORGANIZAÇÃO do Estúdio 3D (uma ferramenta por tarefa), clicando
// como um iniciante: abre pelo trilho e usa os botões que aparecem.
//  SEM REPETIDO: um "Espelhar" só (Ajustar), um "Inflar" só (pincel), um
//        "Suavizar" só (Esculpir); Torcer/afunilar/dobrar só no Modificar.
//  ESPELHAR: virar no lugar (X/Y/Z) e "juntar com a original" (modela metade,
//        ganha a peça inteira; vale com a peça girada; refeito ao mudar a medida).
//  TORCER / DOBRAR no Modificar: engordar e afunilar com prévia.
//  CORTAR E SEPARAR: um botão no trilho, abas Cortar / Soltar um detalhe /
//        Por cor; cada aba liga a própria ferramenta e funciona de verdade.
//  SÓLIDO / FURO: só em Formas (some do Ajustar).
import path from 'node:path';

export async function secaoReorganizar({ b, teste, novaPagina, passo, abrirEstudio, confirmarPrevia }) {
  console.log('REORGANIZAR) uma ferramenta por tarefa: espelhar, torcer/dobrar, suavizar — sem repetido');
  const { criar, volume } = await import('../../src/estudio3d/core/malha.js');
  const { validar, autoInterseccoes } = await import('../../src/estudio3d/core/validador.js');
  const prova = process.env.PROVA_DIR;
  const foto = async (pg, nome) => { if (prova) await pg.screenshot({ path: path.join(prova, nome + '.png') }); };
  const pg = await novaPagina(b);
  const trilho = s => pg.click('.e3d-rail button[data-ferr=' + s + ']');
  const caixaDe = (i = -1) => pg.evaluate(k => { const e = window.Estudio3D.estudio, os = e.cena.objetos, o = os[k < 0 ? os.length + k : k]; return e.cena.caixaExata(o); }, i);
  const malha = (i = -1) => pg.evaluate(k => { const os = window.Estudio3D.estudio.cena.objetos, o = os[k < 0 ? os.length + k : k], m = o.partes[0].malha; return { pos: Array.from(m.pos), idx: Array.from(m.idx) }; }, i);
  const fechada = (m, msg) => {
    const x = criar(m.pos, m.idx), r = validar(x), a = autoInterseccoes(x);
    if (r.arestasAbertas || r.arestasNaoManifold || r.orientacaoTrocada || r.componentes !== 1 || a.pares || !(volume(x) > 0)) throw new Error(msg + ': abertas ' + r.arestasAbertas + ', non-manifold ' + r.arestasNaoManifold + ', viradas ' + r.orientacaoTrocada + ', pedaços ' + r.componentes + ', cruzamentos ' + a.pares);
    return volume(x);
  };
  const tam = c => c.tam.map(v => v.toFixed(2)).join('×');
  // forma nova: caixa com as medidas pedidas (como o usuário: Formas → Caixa → digita)
  async function caixaNova(l, p, a) {
    await trilho('formas');
    const n0 = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos.length === n + 1, n0, { timeout: 30000 });
    for (const [k, v] of [['largura', l], ['profundidade', p], ['altura', a]]) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', String(v)); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(300); }
    await pg.waitForFunction(([l, p, a]) => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.objetoAtual()); return Math.abs(c.tam[0] - l) < 1e-6 && Math.abs(c.tam[1] - p) < 1e-6 && Math.abs(c.tam[2] - a) < 1e-6; }, [l, p, a], { timeout: 30000 });
  }
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');

    await passo(pg, 'TRILHO: 10 botões, um por tarefa (Cortar, Selecionar e Separar viraram "Cortar e separar")', async () => {
      const r = await pg.evaluate(() => [...document.querySelectorAll('.e3d-rail button[data-ferr]')].map(b => b.textContent.trim()));
      const quer = ['Início', 'Formas', 'Modificar', 'Esculpir', 'Desenhar', 'Consertar', 'Ajustar', 'Cortar e separar', 'Texto', 'Exportar'];
      if (r.join('|') !== quer.join('|')) throw new Error('trilho: ' + r.join(', '));
      // o rótulo de duas palavras cabe no trilho (não corta nem empurra a tela)
      const cab = await pg.evaluate(() => { const b = document.querySelector('.e3d-rail button[data-ferr=cs]'), s = b.querySelector('span'); return { bw: b.clientWidth, sw: s.scrollWidth, rail: document.querySelector('.e3d-rail').scrollWidth - document.querySelector('.e3d-rail').clientWidth }; });
      if (cab.sw > cab.bw || cab.rail > 0) throw new Error('rótulo não cabe: ' + JSON.stringify(cab));
    });

    await passo(pg, 'SEM REPETIDO: um "Espelhar" só (no Ajustar), um "Inflar" só, Torcer só no Modificar, um "Suavizar" só', async () => {
      const contar = (re, sel = '.e3d button, .e3d .e3d-titulo, .e3d summary') => pg.evaluate(([re, sel]) => [...document.querySelectorAll(sel)].filter(x => new RegExp(re, 'i').test(x.textContent.trim())).map(x => (x.closest('[data-sec]') || {}).dataset?.sec || '?'), [re, sel]);
      const esp = await contar('^Espelhar', '.e3d button');
      if (esp.length !== 1 || esp[0] !== 'transf') throw new Error('Espelhar em: ' + esp.join(', '));
      const inf = await contar('^Inflar$');
      if (inf.length !== 1 || inf[0] !== 'esc') throw new Error('Inflar em: ' + inf.join(', '));
      const tor = await contar('^Torcer');
      if (!tor.length || tor.some(s => s !== 'mod')) throw new Error('Torcer em: ' + tor.join(', '));
      const suav = await contar('^Suavizar', '.e3d .e3d-titulo, .e3d button');
      if (suav.some(s => s !== 'esc')) throw new Error('"Suavizar" em: ' + suav.join(', '));
      const papel = await pg.evaluate(() => [...document.querySelectorAll('.e3d [data-a=papel]')].map(x => x.closest('[data-sec]').dataset.sec));
      if (papel.some(s => s !== 'formas')) throw new Error('Sólido/Furo em: ' + papel.join(', '));
      if (await pg.$('[data-sec=esc] [data-a=def]')) throw new Error('Esculpir ainda tem o "Deformar"');
      if (await pg.$('[data-sec=mod] [data-v=espelhar]')) throw new Error('Modificar ainda tem o "Espelhar"');
    });

    await passo(pg, 'ESCOLHA: forma nova fica sozinha escolhida (sem "2 peças · Unir" que ninguém pediu)', async () => {
      await caixaNova(10, 10, 10);
      await caixaNova(12, 12, 12);
      const m = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetosSel().length);
      if (m !== 1 || await pg.isVisible('.e3d-multi')) throw new Error(m + ' peças escolhidas sozinhas');
    });

    await passo(pg, 'ESPELHAR (virar): caixa → Ajustar → X → Espelhar: vira no lugar (mesma caixa, matriz espelhada); Ctrl+Z volta', async () => {
      await caixaNova(20, 10, 10);
      const c0 = await caixaDe();
      await trilho('transf');
      await pg.click('[data-sec=transf] [data-a=espEixo] button[data-v="0"]');
      await pg.click('[data-sec=transf] [data-a=esp]');
      const t = await pg.evaluate(() => Array.from(window.Estudio3D.estudio.objetoAtual().transform));
      const c1 = await caixaDe();
      if (!(t[0] < 0) || c1.min.some((v, i) => Math.abs(v - c0.min[i]) > 1e-6)) throw new Error('não virou no lugar: sx ' + t[0] + ' caixa ' + tam(c1));
      await pg.keyboard.press('Control+z');
      if (!(await pg.evaluate(() => window.Estudio3D.estudio.objetoAtual().transform[0] > 0))) throw new Error('Ctrl+Z não desvirou');
    });

    await passo(pg, 'ESPELHAR + JUNTAR: marca "Juntar com a original", Lado + → prévia → Aplicar: 20 vira 40 mm, peça única e fechada', async () => {
      await pg.check('[data-sec=transf] [data-a=espUnir]');
      if (!(await pg.isVisible('[data-sec=transf] [data-a=espPos]'))) throw new Error('"Onde fica o espelho" não apareceu');
      await pg.click('[data-sec=transf] [data-a=espPos] button[data-v=max]');
      const c0 = await caixaDe();
      await pg.click('[data-sec=transf] [data-a=esp]');
      await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
      await foto(pg, 'espelhar-juntar-previa');
      await confirmarPrevia(pg);
      await pg.waitForFunction(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.objetoAtual()).tam[0] > 39; }, null, { timeout: 60000 });
      const c1 = await caixaDe();
      if (Math.abs(c1.tam[0] - 40) > 1e-3 || Math.abs(c1.min[0] - c0.min[0]) > 1e-3 || Math.abs(c1.tam[1] - 10) > 1e-3) throw new Error('caixa ' + tam(c1));
      await pg.waitForTimeout(300); await foto(pg, 'espelhar-juntar-pronto');
      const v = fechada(await malha(), 'espelhada');
      if (Math.abs(v - 4000) > 1) throw new Error('volume ' + v);
      if (!/uma peça só/.test(await pg.textContent('[data-sec=transf] [data-a=espRes]'))) throw new Error('não disse o resultado');
      const ops = await pg.evaluate(() => (window.Estudio3D.estudio.objetoAtual().operacoes || []).map(o => o.tipo));
      if (ops.join() !== 'espelhar') throw new Error('operações ' + ops.join());
    });

    await passo(pg, 'ESPELHAR + JUNTAR é refeito ao mudar a medida em Formas (largura 30 → 60 mm) e Ctrl+Z desfaz', async () => {
      await trilho('formas');
      await pg.fill('[data-sec=formas] [data-p=largura]', '30'); await pg.press('[data-sec=formas] [data-p=largura]', 'Enter');
      await pg.waitForFunction(() => { const e = window.Estudio3D.estudio; return Math.abs(e.cena.caixaExata(e.objetoAtual()).tam[0] - 60) < 1e-3; }, null, { timeout: 60000 });
      fechada(await malha(), 'refeita');
      await pg.keyboard.press('Control+z');
      await pg.waitForFunction(() => { const e = window.Estudio3D.estudio; return Math.abs(e.cena.caixaExata(e.objetoAtual()).tam[0] - 40) < 1e-3; }, null, { timeout: 30000 });
    });

    await passo(pg, 'ESPELHAR + JUNTAR com a peça GIRADA 90° (X da tela, não o da peça): cresce pro lado + da tela', async () => {
      await caixaNova(20, 10, 10);
      await trilho('transf');
      await pg.click('[data-sec=transf] [data-a=gz]');
      const c0 = await caixaDe();
      if (Math.abs(c0.tam[0] - 10) > 1e-3) throw new Error('não girou: ' + tam(c0));
      await pg.click('[data-sec=transf] [data-a=espEixo] button[data-v="0"]');
      await pg.click('[data-sec=transf] [data-a=espPos] button[data-v=max]');
      if (!(await pg.isChecked('[data-sec=transf] [data-a=espUnir]'))) throw new Error('perdeu a opção juntar');
      await pg.click('[data-sec=transf] [data-a=esp]');
      await confirmarPrevia(pg);
      await pg.waitForFunction(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.objetoAtual()).tam[0] > 19; }, null, { timeout: 60000 });
      const c1 = await caixaDe();
      if (Math.abs(c1.tam[0] - 20) > 1e-3 || Math.abs(c1.tam[1] - 20) > 1e-3 || Math.abs(c1.min[0] - c0.min[0]) > 1e-3) throw new Error('girada: ' + tam(c1) + ' min x ' + c1.min[0].toFixed(2) + ' (antes ' + c0.min[0].toFixed(2) + ')');
      fechada(await malha(), 'girada');
    });

    await passo(pg, 'TORCER / DOBRAR no Modificar: "Engordar" 1 mm numa caixa 20 mm → ~22 mm, sólido fechado; a forma vira malha', async () => {
      await caixaNova(20, 20, 20);
      await trilho('mod');
      await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=deformar]');
      if (!(await pg.isVisible('[data-sec=mod] [data-a=def] button[data-v=inflar]'))) throw new Error('não mostrou as opções');
      await pg.click('[data-sec=mod] [data-a=def] button[data-v=inflar]');
      if (await pg.inputValue('[data-sec=mod] [data-a=valDef]') !== '1') throw new Error('valor inicial do Engordar');
      if (!/mm/.test(await pg.textContent('[data-sec=mod] [data-a=rotDef]'))) throw new Error('unidade do Engordar');
      await pg.click('[data-sec=mod] [data-a=ir]');
      await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
      await foto(pg, 'modificar-engordar-previa');
      await confirmarPrevia(pg);
      await pg.waitForFunction(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.objetoAtual()).tam[0] > 21; }, null, { timeout: 60000 });
      const c = await caixaDe();
      await pg.waitForTimeout(300); await foto(pg, 'modificar-engordar-pronto');
      if (c.tam.some(v => v < 21.5 || v > 22.2)) throw new Error('engordou ' + tam(c));
      fechada(await malha(), 'engordada');
      const f = await pg.evaluate(() => { const o = window.Estudio3D.estudio.objetoAtual(); return { forma: !!o.forma, ops: !!o.operacoes }; });
      if (f.forma || f.ops) throw new Error('a forma continuou paramétrica (mudar a medida desfaria o Engordar)');
      if (!/Engordar aplicado/.test(await pg.textContent('[data-sec=mod] [data-a=res]'))) throw new Error('não disse o resultado');
    });

    await passo(pg, 'TORCER / DOBRAR: "Afunilar" 0,5 em Z numa caixa 20×20×30 → topo com ~10 mm, base 20, altura 30', async () => {
      await caixaNova(20, 20, 30);
      await trilho('mod');
      await pg.click('[data-sec=mod] [data-a=ferr] button[data-v=deformar]');
      await pg.click('[data-sec=mod] [data-a=def] button[data-v=afunilar]');
      await pg.fill('[data-sec=mod] [data-a=valDef]', '0,5');
      await pg.click('[data-sec=mod] [data-a=eixoDef] button[data-v="2"]');
      await pg.click('[data-sec=mod] [data-a=ir]');
      await confirmarPrevia(pg);
      await pg.waitForFunction(() => !window.Estudio3D.estudio.objetoAtual().forma, null, { timeout: 60000 });
      const m = await malha(), c = await caixaDe();
      fechada(m, 'afunilada');
      let topo = [Infinity, -Infinity];
      const zt = Math.max(...m.pos.filter((_, i) => i % 3 === 2));
      for (let i = 0; i < m.pos.length; i += 3) if (m.pos[i + 2] > zt - 1e-6) { topo[0] = Math.min(topo[0], m.pos[i]); topo[1] = Math.max(topo[1], m.pos[i]); }
      if (Math.abs(c.tam[2] - 30) > 1e-3 || Math.abs(c.tam[0] - 20) > 1e-3 || Math.abs(topo[1] - topo[0] - 10) > 0.05) throw new Error('afunilou ' + tam(c) + ' topo ' + (topo[1] - topo[0]).toFixed(2));
      await foto(pg, 'modificar-afunilar');
    });

    await passo(pg, 'CORTAR E SEPARAR → Cortar: caixa 20 mm, "No meio" + pino → prévia → 2 peças fechadas com encaixe', async () => {
      await caixaNova(20, 20, 20);
      await trilho('cs');
      if (!(await pg.isVisible('[data-sec=cs] [data-a=aba] button.active[data-v=corte]'))) throw new Error('não abriu na aba Cortar');
      if (await pg.evaluate(() => window.Estudio3D.estudio.ferramenta) !== 'corte') throw new Error('ferramenta do corte não ligou');
      await foto(pg, 'cortar-e-separar-aba-cortar');
      const n0 = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
      await pg.selectOption('[data-sec=corte] [data-a=tipo]', 'cilindrico');
      await pg.click('[data-sec=corte] [data-a=meio]');
      await pg.click('[data-sec=corte] [data-a=ir]');
      await confirmarPrevia(pg);
      await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos.length === n + 1, n0, { timeout: 120000 });
      for (const i of [-2, -1]) fechada(await malha(i), 'parte ' + i);
      const tz = [(await caixaDe(-2)).tam[2], (await caixaDe(-1)).tam[2]];
      if (!(tz[0] > 9 && tz[1] > 9 && tz[0] + tz[1] < 30)) throw new Error('alturas ' + tz.join(', '));
    });

    await passo(pg, 'CORTAR E SEPARAR → Soltar um detalhe: tampa com botão (Unir), clique no botão → acende só ele → Separar → 2 peças', async () => {
      // tampa 30×30×6 + cilindro Ø10×6 em cima, unidos (Shift + clique, Unir)
      await caixaNova(30, 30, 6);
      const tampa = await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.objetoAtual(), c = e.cena.caixaExata(o); return { id: o.id, c: [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2] }; });
      await trilho('formas');
      await pg.click('[data-forma=cilindro]');
      await pg.waitForFunction(id => window.Estudio3D.estudio.objetoAtual().id !== id, tampa.id, { timeout: 30000 });
      for (const [k, v] of [['diametro', '10'], ['altura', '6']]) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', v); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(300); }
      await trilho('transf');
      for (const [k, v] of [['px', tampa.c[0]], ['py', tampa.c[1]], ['pz', 6]]) { await pg.fill('[data-sec=transf] [data-t=' + k + ']', String(v).replace('.', ',')); await pg.press('[data-sec=transf] [data-t=' + k + ']', 'Enter'); await pg.waitForTimeout(200); }
      // vista olhando a tampa de cima/frente (como o usuário faria girando)
      await pg.evaluate(c => { const v = window.Estudio3D.estudio.visor; v.controles.target.set(c[0], c[1], 6); v.camera.position.set(c[0] + 30, c[1] - 60, 70); v.controles.update(); v.pedirRender(); }, tampa.c);
      await pg.waitForTimeout(300);
      const botao = await pg.evaluate(c => window.Estudio3D.estudio.visor.telaDe(c[0], c[1], 12), tampa.c);
      const canto = await pg.evaluate(c => window.Estudio3D.estudio.visor.telaDe(c[0] + 12, c[1] - 12, 6), tampa.c);
      await pg.mouse.click(botao.x, botao.y);
      await pg.keyboard.down('Shift'); await pg.mouse.click(canto.x, canto.y); await pg.keyboard.up('Shift');
      await pg.locator('.e3d-multi button', { hasText: /^Unir$/ }).click();
      await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, o = e.objetoAtual(); return o && Math.abs(e.cena.caixaExata(o).tam[2] - 12) < 1e-3 && o.partes.length === 1; }, null, { timeout: 60000 });
      const nPecas = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
      const unida = await pg.evaluate(() => window.Estudio3D.estudio.objetoAtual().id);
      // agora o usuário: Cortar e separar → Soltar um detalhe → clica no botão
      await trilho('cs');
      await pg.click('[data-sec=cs] [data-a=aba] button[data-v=sep]');
      if (await pg.evaluate(() => window.Estudio3D.estudio.ferramenta) !== 'auto') throw new Error('seleção automática não ligou');
      if (!(await pg.isVisible('[data-sec=sel] [data-a=modos]')) || !(await pg.isVisible('[data-sec=sep] [data-a=ir]'))) throw new Error('passos 1 e 2 não aparecem juntos');
      await pg.mouse.move(botao.x, botao.y); await pg.waitForTimeout(200);
      await pg.mouse.click(botao.x, botao.y);
      await pg.waitForFunction(() => /faces/.test(document.querySelector('[data-sec=sep] [data-a=status]').textContent), null, { timeout: 30000 });
      await foto(pg, 'cortar-e-separar-aba-soltar');
      await pg.fill('[data-sec=sep] [data-a=nome]', 'Botão');
      await pg.click('[data-sec=sep] [data-a=ir]');
      await confirmarPrevia(pg);
      await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos.length === n + 1, nPecas, { timeout: 120000 });
      const r = await pg.evaluate(id => { const e = window.Estudio3D.estudio, os = e.cena.objetos, b = os.find(x => x.nome === 'Botão'), t = os.find(x => x.id === id), m = o => ({ pos: Array.from(o.partes[0].malha.pos), idx: Array.from(o.partes[0].malha.idx) }); return b && t && { cb: e.cena.caixaExata(b), ct: e.cena.caixaExata(t), mb: m(b), mt: m(t) }; }, unida);
      if (!r) throw new Error('não achei o "Botão" e a tampa');
      // botão de Ø10 sai com 10 mm (antes vinha 10,8: aba fina da margem do corte)
      if (Math.abs(r.cb.tam[0] - 10) > 0.02 || Math.abs(r.cb.tam[2] - 6) > 0.01 || Math.abs(r.cb.min[2] - 6) > 0.01) throw new Error('botão ' + tam(r.cb) + ' z0 ' + r.cb.min[2].toFixed(3));
      if (Math.abs(r.ct.tam[2] - 6) > 0.6) throw new Error('tampa ficou com ' + tam(r.ct));
      fechada(r.mb, 'botão'); fechada(r.mt, 'tampa');
      await foto(pg, 'cortar-e-separar-botao-separado');
    });

    await passo(pg, 'CORTAR E SEPARAR → Por cor: a aba mostra só o Separar por cor e as cascas; trocar de aba desliga a seleção', async () => {
      await pg.click('[data-sec=cs] [data-a=aba] button[data-v=cor]');
      if (!(await pg.isVisible('[data-sec=cor] [data-a=porCor]')) || await pg.isVisible('[data-sec=sep] [data-a=ir]') || await pg.isVisible('[data-sec=corte] [data-a=ir]')) throw new Error('aba Por cor mostra outra coisa');
      if (await pg.evaluate(() => window.Estudio3D.estudio.ferramenta) !== 'navegar') throw new Error('ferramenta ficou ' + await pg.evaluate(() => window.Estudio3D.estudio.ferramenta));
      await foto(pg, 'cortar-e-separar-aba-cor');
      // peça de uma cor só: avisa em vez de quebrar
      await pg.click('[data-sec=cor] [data-a=porCor]');
      await pg.waitForFunction(() => /uma cor só/.test(document.body.textContent), null, { timeout: 10000 });
      // sair do painel desliga tudo (nenhuma ferramenta presa)
      await trilho('transf');
      if (await pg.evaluate(() => window.Estudio3D.estudio.ferramenta) !== 'navegar') throw new Error('ferramenta presa ao sair');
      await trilho('cs');
      await pg.click('[data-sec=cs] [data-a=aba] button[data-v=corte]');
      if (await pg.evaluate(() => window.Estudio3D.estudio.ferramenta) !== 'corte') throw new Error('voltar pro Cortar não ligou o corte');
      await trilho('formas');
      await pg.waitForTimeout(300);
      if (await pg.evaluate(() => [window.Estudio3D.estudio.ferramenta, document.querySelectorAll('.e3d-painel details[open]').length].join()) !== 'navegar,1') throw new Error('sobrou aba aberta: ' + await pg.evaluate(() => [window.Estudio3D.estudio.ferramenta, [...document.querySelectorAll('.e3d-painel details[open]')].map(x => x.dataset.sec)].join()));
    });

    await passo(pg, 'ATALHOS ANTIGOS ainda acham o lugar: Início → "Separar por cor" abre a aba Por cor; barra da seleção → Separar abre "Soltar um detalhe"', async () => {
      await trilho('inicio');
      await pg.click('.e3d-tarefa[data-tarefa=porCor]');
      if (!(await pg.isVisible('[data-sec=cs] [data-a=aba] button.active[data-v=cor]'))) throw new Error('tarefa Por cor não abriu a aba');
      await trilho('inicio');
      await pg.click('.e3d-tarefa[data-tarefa=sep]');
      if (!(await pg.isVisible('[data-sec=cs] [data-a=aba] button.active[data-v=sep]'))) throw new Error('tarefa Separar não abriu a aba');
      await trilho('inicio');
      await pg.click('.e3d-tarefa[data-tarefa=corte]');
      if (!(await pg.isVisible('[data-sec=cs] [data-a=aba] button.active[data-v=corte]'))) throw new Error('tarefa Cortar não abriu a aba');
    });

    await passo(pg, 'ESCULPIR: só pincel (com "Alisar") e o "Suavizar a peça"; sem o bloco de deformar', async () => {
      await trilho('esc');
      const t = await pg.evaluate(() => [...document.querySelectorAll('[data-sec=esc] [data-a=tipo] button')].map(b => b.textContent));
      if (t.join() !== 'Puxar,Empurrar,Inflar,Achatar,Alisar,Vincar') throw new Error('pincel: ' + t.join());
      const tit = await pg.evaluate(() => [...document.querySelectorAll('[data-sec=esc] .e3d-titulo')].map(b => b.textContent));
      if (tit.join() !== 'Pincel,Suavizar a peça') throw new Error('títulos: ' + tit.join());
      await foto(pg, 'esculpir-painel');
    });
  } finally { await pg.context().close(); }
}

// E2E de CORRIDA: mexer na cena enquanto o motor calcula (Ctrl+Z, excluir,
// duplo clique). Antes da correção (auditoria A1–A3):
//   - cortar + Ctrl+Z no meio + confirmar APAGAVA outro objeto da mesa e
//     deixava o cortado duplicado;
//   - consertar + Ctrl+Z no meio dizia "Malha reparada" e não mudava nada;
//   - duplo clique em Consertar rodava 2 consertos; em Baixar STL, 2 downloads.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoCorrida({ b, tmp, novaPagina, passo, abrirEstudio, abrirSecao, teste }) {
  console.log('CORRIDA) mexer na cena enquanto calcula não pode estragar nada');
  const { esfera, caixaMalha } = await import('../util/malhas.mjs');
  const { escreverSTL } = await import('../../src/estudio3d/core/formatos/stl.js');
  const bola = path.join(tmp, 'corrida-bola.stl'), cubo = path.join(tmp, 'corrida-cubo.stl');
  fs.writeFileSync(bola, escreverSTL(esfera(20, 6, 0, 0, 20), 'bola'));
  fs.writeFileSync(cubo, escreverSTL(caixaMalha(20, 20, 20), 'cubo'));
  const pg = await novaPagina(b);
  const estado = () => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.map(o => o.nome + '[' + o.partes.map(p => p.malha.idx.length / 3).join(',') + ']'));
  const esperarMotor = () => pg.waitForFunction(() => { const m = window.Estudio3D.estudio.motor; return !m.principal.ocupado && !m.aux.ocupado; }, null, { timeout: 120000, polling: 100 });
  const toasts = () => pg.evaluate(() => window.__t.splice(0));
  // cena: bola + cubo; a última ação é mover o cubo (é o que o Ctrl+Z desfaz)
  async function cena() {
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos = []; }); e.cena.pilhaDesfazer = []; });
    await pg.setInputFiles('.e3d input[type=file][multiple]', bola);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.setInputFiles('.e3d input[type=file][multiple]', cubo);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 60000 });
    await esperarMotor();
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.objetos[1]; e.cena.aplicar('Mover', () => { c.transform[12] += 30; }); e.cena.selecionar(e.cena.objetos[0].id, e.cena.objetos[0].partes[0].id); });
    await toasts();
  }
  const ctrlZ = async () => { await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await pg.keyboard.press('Control+z'); };
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');
    await pg.evaluate(() => { window.__t = []; const t = document.getElementById('toast'); new MutationObserver(() => { if (t.className.includes('show')) window.__t.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true }); });

    await passo(pg, 'CORRIDA: cortar + Ctrl+Z (desfaz outra coisa) no meio do cálculo -> corte vai pra bola certa, o cubo continua', async () => {
      await cena();
      await abrirSecao(pg, 'corte');
      await pg.selectOption('[data-sec=corte] [data-a="tipo"]', 'cilindrico');
      await pg.fill('[data-sec=corte] [data-a="posmm"]', '20'); await pg.press('[data-sec=corte] [data-a="posmm"]', 'Enter');
      await pg.click('[data-sec=corte] [data-a="ir"]');
      if (!(await pg.evaluate(() => window.Estudio3D.estudio.motor.ocupado))) throw new Error('o corte não estava calculando quando apertei Ctrl+Z');
      await ctrlZ();
      await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
      await pg.click('.e3d-previa button.primary');
      await pg.waitForTimeout(300);
      const e = await estado();
      if (e.length !== 3 || !e.some(x => x.startsWith('corrida-cubo')) || e.some(x => x.startsWith('corrida-bola['))) throw new Error('cena errada depois do corte: ' + e.join(' | '));
    });

    await passo(pg, 'CORRIDA: excluir a peça no meio do corte -> nada é aplicado, aviso diz por quê, o resto da mesa fica', async () => {
      await cena();
      await abrirSecao(pg, 'corte');
      await pg.click('[data-sec=corte] [data-a="ir"]');
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.removerObjeto(e.cena.objetos[0].id); });
      await esperarMotor(); await pg.waitForTimeout(300);
      if (await pg.evaluate(() => getComputedStyle(document.querySelector('.e3d-previa')).display !== 'none')) throw new Error('mostrou prévia de peça que não existe mais');
      const e = await estado();
      if (e.length !== 1 || !e[0].startsWith('corrida-cubo')) throw new Error('cena errada: ' + e.join(' | '));
      const t = await toasts();
      if (!t.some(x => /mudou enquanto calculava/.test(x))) throw new Error('sem aviso: ' + t.join(' | '));
    });

    await passo(pg, 'CORRIDA: consertar + Ctrl+Z (desfaz outra coisa) no meio -> o conserto vale pra bola atual (fecha de verdade)', async () => {
      await cena();
      // bola estragada (3 faces a menos) e, por último, mover o cubo
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0], p = o.partes[0]; e.cena.aplicar('Estragar', () => { p.malha = { pos: p.malha.pos, idx: p.malha.idx.slice(9) }; }); e.cena.aplicar('Mover', () => { e.cena.objetos[1].transform[12] += 5; }); e.cena.selecionar(o.id, p.id); });
      await esperarMotor(); await toasts();
      await abrirSecao(pg, 'diag');
      await pg.click('[data-sec=diag] [data-a=reparar]');
      await ctrlZ();
      await esperarMotor(); await pg.waitForTimeout(500);
      const fechada = await pg.evaluate(() => /Malha fechada\s*OK/.test(document.querySelector('[data-sec=diag] [data-a=resultado]').textContent));
      const tri = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.idx.length / 3);
      if (!fechada || tri === 81917) throw new Error('não consertou a bola atual (triângulos ' + tri + ', fechada ' + fechada + ')');
    });

    await passo(pg, 'CORRIDA: consertar + Ctrl+Z que muda a PRÓPRIA peça -> descarta com aviso (não diz "Malha reparada")', async () => {
      await cena();
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0], p = o.partes[0]; e.cena.aplicar('Estragar', () => { p.malha = { pos: p.malha.pos, idx: p.malha.idx.slice(9) }; }); e.cena.selecionar(o.id, p.id); });
      await esperarMotor(); await toasts();
      await abrirSecao(pg, 'diag');
      await pg.click('[data-sec=diag] [data-a=reparar]');
      await ctrlZ();                                     // desfaz o "Estragar": a bola volta pra malha de antes
      await esperarMotor(); await pg.waitForTimeout(500);
      const t = await toasts();
      if (t.some(x => /Malha reparada/.test(x))) throw new Error('disse "Malha reparada" num conserto que não foi aplicado: ' + t.join(' | '));
      if (!t.some(x => /mudou enquanto consertava/.test(x))) throw new Error('sem aviso de descarte: ' + t.join(' | '));
      const hist = await pg.evaluate(() => window.Estudio3D.estudio.cena.pilhaDesfazer.map(u => u.rotulo));
      if (hist.includes('Reparar malha')) throw new Error('criou entrada de desfazer de um conserto descartado');
    });

    await passo(pg, 'CORRIDA: duplo clique em Consertar = 1 conserto; duplo clique em Baixar STL = 1 arquivo', async () => {
      await cena();
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0], p = o.partes[0]; e.cena.aplicar('Estragar', () => { p.malha = { pos: p.malha.pos, idx: p.malha.idx.slice(9) }; }); e.cena.selecionar(o.id, p.id); });
      await esperarMotor();
      await abrirSecao(pg, 'diag');
      await pg.dblclick('[data-sec=diag] [data-a=reparar]');
      const fila = await pg.evaluate(() => window.Estudio3D.estudio.motor.principal.ocupado);
      await esperarMotor(); await pg.waitForTimeout(300);
      const n = await pg.evaluate(() => window.Estudio3D.estudio.cena.pilhaDesfazer.filter(u => u.rotulo === 'Reparar malha').length);
      if (fila !== 1 || n !== 1) throw new Error('fila ' + fila + ', consertos no histórico ' + n);
      await abrirSecao(pg, 'exp');
      let downloads = 0; const conta = () => downloads++;
      pg.on('download', conta);
      await pg.dblclick('[data-sec=exp] [data-a="stl"]');
      await pg.waitForTimeout(2500);
      pg.off('download', conta);
      if (downloads !== 1) throw new Error(downloads + ' downloads');
    });

    await passo(pg, 'LOTE: objeto de 2 peças, o conserto de uma falha -> a outra é consertada e o aviso diz qual falhou', async () => {
      await cena();
      await pg.evaluate(() => {
        const e = window.Estudio3D.estudio, m = e.cena.objetos[0].partes[0].malha;
        const furada = { pos: m.pos, idx: m.idx.slice(9) };
        e.adicionarObjetos([{ nome: 'Duas', transform: e.cena.objetos[0].transform, partes: [{ nome: 'Boa', malha: furada, cor: '#3366AA' }, { nome: 'Ruim', malha: furada, cor: '#AA3333' }] }], { enquadrar: false });
        // simula o motor falhando só na peça "Ruim"
        const orig = e.rodar.bind(e);
        e.rodar = (op, args, rot) => op === 'reparar' && args.parte.nome === 'Ruim' ? Promise.reject(Object.assign(new Error('falha simulada'), { avisado: true })) : orig(op, args, rot);
        e._rodarOriginal = orig;
      });
      await esperarMotor(); await toasts();
      await abrirSecao(pg, 'diag');
      await pg.click('[data-sec=diag] [data-a=reparar]');
      await esperarMotor(); await pg.waitForTimeout(500);
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.rodar = e._rodarOriginal; });
      const o = await pg.evaluate(() => { const o = window.Estudio3D.estudio.cena.objetos.at(-1); return o.partes.map(p => p.nome + ':' + p.malha.idx.length / 3); });
      if (!/^Boa:(?!81917)/.test(o[0]) || o[1] !== 'Ruim:81917') throw new Error('peças: ' + o.join(' | '));
      const t = await toasts();
      if (!t.some(x => /não consegui consertar: Ruim/.test(x))) throw new Error('aviso: ' + t.join(' | '));
      const laudo = await pg.evaluate(() => document.querySelector('[data-sec=diag] [data-a=resultado]').textContent);
      if (!/Ruim: não consegui consertar: falha simulada/.test(laudo)) throw new Error('laudo sem o motivo: ' + laudo.slice(-200));
    });
  } finally {
    await pg.context().close();
  }
}

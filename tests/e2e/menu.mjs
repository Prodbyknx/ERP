// E2E do MENU DO BOTÃO DIREITO (MenuContexto em site/app.js + Estúdio 3D):
// menu do sistema no lugar do do navegador (sem "Inspecionar"), ações de cada lugar
// (área geral, 3D com peça, 3D vazio, lista de objetos), teclado (setas, Enter, Esc,
// tecla Menu), clique fora, sempre dentro da tela, campo de texto com o menu do
// navegador, arrastar com o botão direito não abre menu, e nada acumula.
export async function secaoMenu({ b, teste, novaPagina, passo, abrirEstudio, abrirSecao }) {
  console.log('MENU) botão direito: menu do sistema, contextual e acessível');
  const pg = await novaPagina(b);
  const consoleMsgs = []; pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.text().slice(0, 200)); });
  // registra se o menu do navegador foi suprimido (defaultPrevented depois do nosso ouvinte)
  await pg.addInitScript(() => { window.__nativo = []; window.addEventListener('contextmenu', e => window.__nativo.push(!e.defaultPrevented)); });
  const itens = () => pg.evaluate(() => [...document.querySelectorAll('.menu-ctx button')].map(b => b.textContent.replace(/(Ctrl\+.|Delete|F)$/, '').trim() + (b.getAttribute('aria-disabled') === 'true' ? ' (off)' : '')));
  const menus = () => pg.evaluate(() => document.querySelectorAll('.menu-ctx').length);
  const ultimoNativo = () => pg.evaluate(() => window.__nativo[window.__nativo.length - 1]);
  const clicarItem = rot => pg.evaluate(r => [...document.querySelectorAll('.menu-ctx button')].find(b => b.firstChild.textContent === r).click(), rot);
  try {
    await passo(pg, 'MENU: botão direito na área do sistema abre o menu do sistema (sem "Inspecionar") e suprime o do navegador', async () => {
      await abrirEstudio(pg, 'file://' + teste + '/index.html');
      await pg.evaluate(() => showTab('dash'));
      await pg.click('#view-dash', { button: 'right', position: { x: 300, y: 120 } });
      const l = await itens();
      if (JSON.stringify(l.map(t => t.replace(' (off)', ''))) !== JSON.stringify(['Voltar', 'Atualizar visualização', 'Modo escuro'])) throw new Error(JSON.stringify(l));
      if (l.some(t => /inspecionar|código|inspect/i.test(t))) throw new Error('tem item técnico');
      if (await ultimoNativo()) throw new Error('o menu do navegador não foi suprimido');
      const role = await pg.evaluate(() => [document.querySelector('.menu-ctx').getAttribute('role'), document.querySelector('.menu-ctx button').getAttribute('role')].join(','));
      if (role !== 'menu,menuitem') throw new Error('papéis de acessibilidade: ' + role);
    });
    await passo(pg, 'MENU: Esc fecha e devolve o foco; clique fora fecha; "Modo escuro" e "Voltar" funcionam', async () => {
      await pg.keyboard.press('Escape');
      if (await menus()) throw new Error('Esc não fechou');
      await pg.click('#view-dash', { button: 'right', position: { x: 300, y: 120 } });
      await pg.click('header .brand h1');   // clique fora, num lugar sem ação
      if (await menus()) throw new Error('clique fora não fechou');
      // voltar: vai de uma aba pra outra pelo menu lateral e volta pelo botão direito
      await pg.click('#nav-subtabs button[data-t=calc]');
      await pg.click('#view-calc', { button: 'right', position: { x: 300, y: 60 } });
      if ((await itens())[0] !== 'Voltar') throw new Error('Voltar deveria estar ativo: ' + JSON.stringify(await itens()));
      await clicarItem('Voltar');
      if (!(await pg.evaluate(() => document.getElementById('view-dash').classList.contains('active')))) throw new Error('não voltou pro Dashboard');
      await pg.click('#view-dash', { button: 'right', position: { x: 300, y: 120 } });
      await clicarItem('Modo escuro');
      if ((await pg.evaluate(() => document.documentElement.getAttribute('data-tema'))) !== 'escuro') throw new Error('tema não mudou');
      await pg.click('#view-dash', { button: 'right', position: { x: 300, y: 120 } });
      if (!(await itens()).includes('Modo claro')) throw new Error('deveria oferecer Modo claro');
      await clicarItem('Modo claro');
      if (await menus()) throw new Error('menu ficou aberto depois da ação');
    });
    await passo(pg, 'MENU: teclado — tecla Menu abre no elemento em foco, setas escolhem, Enter executa, Esc devolve o foco', async () => {
      // quem usa teclado não clicou nada no instante anterior
      await pg.focus('#btn_tema'); await pg.waitForTimeout(700);
      await pg.keyboard.press('Shift+F10');
      if (!(await menus())) throw new Error('tecla de menu não abriu');
      const foco = await pg.evaluate(() => document.activeElement.textContent);
      if (foco !== 'Voltar' && foco !== 'Atualizar visualização') throw new Error('foco não foi pro 1º item ativo: ' + foco);
      await pg.keyboard.press('ArrowDown');
      const f2 = await pg.evaluate(() => document.activeElement.firstChild && document.activeElement.firstChild.textContent);
      if (f2 !== 'Atualizar visualização' && f2 !== 'Modo escuro') throw new Error('seta não moveu: ' + f2);
      await pg.keyboard.press('Escape');
      if ((await pg.evaluate(() => document.activeElement.id)) !== 'btn_tema') throw new Error('foco não voltou pro botão');
      await pg.focus('#btn_tema'); await pg.waitForTimeout(700); await pg.keyboard.press('Shift+F10');
      await pg.keyboard.press('End'); await pg.keyboard.press('Enter');
      if ((await pg.evaluate(() => document.documentElement.getAttribute('data-tema'))) !== 'escuro') throw new Error('Enter não executou');
      await pg.evaluate(() => window.alternarTema());
    });
    await passo(pg, 'MENU: em campo de texto fica o menu do navegador (copiar/colar); perto da borda o menu fica inteiro na tela', async () => {
      await pg.evaluate(() => showTab('calc'));
      await pg.click('#c_gramas', { button: 'right' });
      if (await menus()) throw new Error('abriu o menu do sistema num campo de texto');
      if (!(await ultimoNativo())) throw new Error('suprimiu o menu do navegador no campo de texto');
      await pg.keyboard.press('Escape');
      const vp = pg.viewportSize();
      await pg.mouse.click(vp.width - 3, vp.height - 3, { button: 'right' });
      const r = await pg.evaluate(() => { const q = document.querySelector('.menu-ctx').getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; });
      if (r.l < 0 || r.t < 0 || r.r > vp.width || r.b > vp.height) throw new Error('menu saiu da tela: ' + JSON.stringify(r));
      await pg.keyboard.press('Escape');
    });
    const centro = i => pg.evaluate(k => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[k]); return e.visor.telaDe((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2); }, i);
    const direito = async (x, y, arrasto = 0) => { await pg.mouse.move(x, y); await pg.mouse.down({ button: 'right' }); if (arrasto) await pg.mouse.move(x + arrasto, y + arrasto / 2, { steps: 5 }); await pg.mouse.up({ button: 'right' }); await pg.waitForTimeout(150); };
    await passo(pg, 'MENU: Estúdio — botão direito na peça escolhe a peça e mostra as ações dela; Duplicar funciona', async () => {
      await pg.evaluate(() => showTab('ferr'));
      await abrirSecao(pg, 'formas');
      await pg.click('[data-forma=caixa]');
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.selecionar(null, null); e.enquadrar(); });
      await pg.waitForTimeout(300);
      const s = await centro(0);
      await direito(s.x, s.y);
      const l = await itens();
      for (const t of ['Duplicar', 'Renomear…', 'Esconder', 'Enquadrar', 'Cortar com encaixe…', 'Separar um detalhe…', 'Separar por cor…', 'Cor e medidas…', 'Preparar pra imprimir', 'Excluir'])
        if (!l.includes(t)) throw new Error('faltou "' + t + '": ' + JSON.stringify(l));
      if (!(await pg.evaluate(() => !!window.Estudio3D.estudio.cena.objetoSel()))) throw new Error('a peça não foi escolhida');
      await clicarItem('Duplicar');
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 10000 });
    });
    await passo(pg, 'MENU: Estúdio — no vazio aparecem as ações da cena (Desfazer desfaz); arrastar com o botão direito não abre menu', async () => {
      const vazio = await pg.evaluate(() => { const r = window.Estudio3D.estudio.visor.renderer.domElement.getBoundingClientRect(); return { x: r.left + 30, y: r.top + 30 }; });
      await direito(vazio.x, vazio.y);
      const l = await itens();
      for (const t of ['Desfazer', 'Refazer (off)', 'Selecionar tudo', 'Enquadrar tudo', 'Organizar mesa', 'Adicionar forma…', 'Abrir arquivo…'])
        if (!l.includes(t)) throw new Error('faltou "' + t + '": ' + JSON.stringify(l));
      await clicarItem('Desfazer');
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 10000 });
      await direito(vazio.x + 200, vazio.y + 100, 80);
      if (await menus()) throw new Error('abriu menu depois de arrastar (arrastar move a câmera)');
    });
    await passo(pg, 'MENU: Estúdio — botão direito na lista de objetos mostra o menu da peça; Esconder e "Mostrar" pelo menu da cena', async () => {
      await pg.evaluate(() => { const o = document.querySelector('.e3d-objetos'); if (o) o.classList.remove('recolhido'); });
      await pg.click('.e3d-obj[data-obj] .nome', { button: 'right' });
      if (!(await itens()).includes('Esconder')) throw new Error(JSON.stringify(await itens()));
      await clicarItem('Esconder');
      if (await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos[0].visivel)) throw new Error('não escondeu');
      const vazio = await pg.evaluate(() => { const r = window.Estudio3D.estudio.visor.renderer.domElement.getBoundingClientRect(); return { x: r.left + 30, y: r.top + 30 }; });
      await direito(vazio.x, vazio.y);
      await clicarItem('Mostrar a peça escondida');
      if (!(await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos[0].visivel))) throw new Error('não mostrou');
    });
    await passo(pg, 'MENU: abrir e fechar 30× não acumula menu nem ouvinte; console limpo', async () => {
      const contar = () => pg.evaluate(() => document.querySelectorAll('.menu-ctx').length);
      const cdp = await pg.context().newCDPSession(pg);
      const ouvintes = async expr => { const { result } = await cdp.send('Runtime.evaluate', { expression: expr }); return (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length; };
      const antes = [await ouvintes('window'), await ouvintes('document')];
      await pg.evaluate(() => showTab('dash'));
      for (let i = 0; i < 30; i++) { await pg.click('#view-dash', { button: 'right', position: { x: 200 + i, y: 100 } }); await pg.keyboard.press(i % 2 ? 'Escape' : 'Tab'); }
      const depois = [await ouvintes('window'), await ouvintes('document')];
      await cdp.detach();
      if (await contar()) throw new Error('menu sobrando: ' + (await contar()));
      if (depois[0] !== antes[0] || depois[1] !== antes[1]) throw new Error('ouvintes window/document: ' + antes + ' -> ' + depois);
      const ruins = consoleMsgs.filter(m => !/GL Driver|GPU stall|ERR_CERT/.test(m));
      if (ruins.length) throw new Error('console: ' + ruins.join(' | '));
    });
  } finally {
    await pg.context().close();
  }
}

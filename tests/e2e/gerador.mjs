// E2E do GERADOR DE CHAVEIRO (tela nova): logo -> análise -> chaveiro na hora,
// com as cores certas, a argola que arrasta e nunca fica na arte, paleta,
// juntar/desligar cor, tamanho/formato/sem AMS, NFC, comparar original ×
// chaveiro, 3MF que o Bambu lê, abrir no Estúdio, texto e forma — e a tela
// não trava enquanto o motor trabalha (tudo no worker).
import path from 'node:path';

export async function secaoGerador({ b, teste, tmp, raiz, novaPagina, passo, simular }) {
  const logos = path.join(raiz, 'tests', 'fixtures', 'logos');
  const pg = await novaPagina(b);
  await pg.goto('file://' + teste + '/index.html');
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => showTab('ferr'));
  const res = () => pg.evaluate(() => { const g = window.Estudio3D.gerador, r = g.res; return r && { partes: r.partes.map(p => p.nome + ' ' + p.cor), base: r.corBase, argola: r.argola, medidas: r.medidas, trocas: r.trocas, nfc: r.nfc, cfg: g.cfg }; });
  // espera um resultado NOVO (depois de mexer em algo)
  const marcar = () => pg.evaluate(() => { window.__r = window.Estudio3D.gerador.res; });
  const novo = () => pg.waitForFunction(() => { const g = window.Estudio3D.gerador; return g.res && g.res !== window.__r && !g.construindo; }, null, { timeout: 30000 });
  // abre a logo e espera o chaveiro DELA (não um recálculo da anterior)
  const abrir = async arq => {
    await marcar();
    await pg.setInputFiles('.e3g input[type=file]', path.join(logos, arq));
    const nome = arq.replace(/\.[^.]+$/, '');
    await pg.waitForFunction(n => { const g = window.Estudio3D.gerador; return g.origem && g.origem.nome === n && g.res && g.res !== window.__r && !g.construindo; }, nome, { timeout: 30000 });
  };

  await passo(pg, 'gerador: tela no padrão do Estúdio (palco 3D + painel) com as 3 entradas: imagem, nome, forma', async () => {
    await pg.waitForSelector('.e3g .e3d-palco canvas', { timeout: 60000 });
    const t = await pg.evaluate(() => ({ vazio: !!document.querySelector('.e3g-vazio .caixa'), nome: !!document.querySelector('.e3g-vazio [data-b=nome]'), formas: document.querySelectorAll('.e3g-vazio .formas button').length, bt: document.querySelector('.e3g [data-b=baixar3mf]').disabled }));
    if (!t.vazio || !t.nome || t.formas !== 8 || !t.bt) throw new Error(JSON.stringify(t));
  });

  await passo(pg, 'gerador: logo de 4 cores -> chaveiro com as 4 cores (base azul de crachá) em segundos, sem travar a tela', async () => {
    // mede o maior intervalo entre quadros enquanto o motor trabalha
    await pg.evaluate(() => { window.__gap = 0; let t = performance.now(); const f = () => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - t); t = n; if (!window.__parar) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const t0 = Date.now();
    await abrir('sol-4cores.png');
    const ms = Date.now() - t0;
    const gap = await pg.evaluate(() => { window.__parar = true; return window.__gap; });
    const r = await res();
    const nomes = r.partes.map(p => p.split(' ')[0]).sort().join();
    if (nomes !== 'Amarelo,Base,Preto,Vermelho') throw new Error('peças: ' + r.partes);
    if (r.base !== '#1D4ED8') throw new Error('base ' + r.base);
    if (ms > 15000) throw new Error('demorou ' + ms + ' ms');
    if (gap > 400) throw new Error('a tela travou ' + gap.toFixed(0) + ' ms');
    const q = await pg.textContent('.e3g-qual');
    if (!/Qualidade/.test(q) || !/4 cores/.test(q)) throw new Error('selo: ' + q);
  });

  await passo(pg, 'gerador: argola no topo, no meio, fora da arte; ARRASTAR na prévia põe onde soltar (vira "livre")', async () => {
    const a = (await res()).argola;
    if (!a || a.noVao) throw new Error('argola: ' + JSON.stringify(a));
    const m = (await res()).medidas;
    if (Math.abs(a.xMM - m.largura / 2) > 1.5 || a.yMM < m.altura - a.alcaMM * 2) throw new Error('não está no topo/meio: ' + JSON.stringify(a));
    const pts = await pg.evaluate(() => {
      const g = window.Estudio3D.gerador, r = g.res, z = r.alturas.base;
      const de = g.visor.telaDe(g.pos[0] + r.argola.xMM, g.pos[1] + r.argola.yMM, z);
      const para = g.visor.telaDe(g.pos[0] + r.medidas.largura + 4, g.pos[1] + r.medidas.altura / 2, z);
      return { de, para };
    });
    await marcar();
    await pg.mouse.move(pts.de.x, pts.de.y); await pg.mouse.down();
    for (let i = 1; i <= 10; i++) await pg.mouse.move(pts.de.x + (pts.para.x - pts.de.x) * i / 10, pts.de.y + (pts.para.y - pts.de.y) * i / 10);
    await pg.mouse.up();
    await novo();
    const r = await res();
    if (r.cfg.argola.posicao !== 'livre') throw new Error('não virou livre: ' + JSON.stringify(r.cfg.argola));
    if (!(r.argola.xMM > r.medidas.largura - r.argola.alcaMM * 2.5)) throw new Error('não foi pra direita: ' + JSON.stringify(r.argola) + ' ' + JSON.stringify(r.medidas));
    // volta ao automático
    await marcar();
    await pg.click('.e3g .e3d-painel-cab [data-v=personalizar]');
    await pg.click('.e3g .e3d-painel-corpo .seg button[data-v=topo]');
    await novo();
    if ((await res()).cfg.argola.posicao !== 'topo') throw new Error('não voltou pro topo');
  });

  await passo(pg, 'gerador: trocar cor pela paleta (PLA Basic), juntar cor e deixar cor na base', async () => {
    await pg.click('.e3g .e3d-painel-cab [data-v=padrao]');
    // amarelo -> laranja
    const linhas = await pg.$$('.e3g-cor');
    let amarelo = null;
    for (const l of linhas) if (/Amarelo/.test(await l.textContent())) amarelo = l;
    await marcar();
    await (await amarelo.$('.bola')).click();
    await pg.click('.e3g-paleta .grade button[aria-label=Laranja]');
    await novo();
    if (!(await res()).partes.includes('Amarelo #FF6A13')) throw new Error('cor: ' + (await res()).partes);
    // preto: juntar com amarelo
    let preto = null;
    for (const l of await pg.$$('.e3g-cor')) if (/Preto/.test(await l.textContent())) preto = l;
    await marcar();
    await (await preto.$('.mais')).click();
    await pg.click('.e3g-paleta .acoes button:has-text("Juntar com amarelo")');
    await novo();
    if ((await res()).partes.some(p => /^Preto/.test(p))) throw new Error('não juntou: ' + (await res()).partes);
    // vermelho: deixar na base
    let verm = null;
    for (const l of await pg.$$('.e3g-cor')) if (/Vermelho/.test(await l.textContent())) verm = l;
    await marcar();
    await (await verm.$('.mais')).click();
    await pg.click('.e3g-paleta .acoes button:has-text("Deixar na base")');
    await novo();
    if ((await res()).partes.some(p => /^Vermelho/.test(p))) throw new Error('não desligou: ' + (await res()).partes);
    // tudo de volta
    await marcar();
    await pg.click('.e3g .e3d-painel-cab [data-v=avancado]');
    await pg.click('.e3g .e3d-painel-corpo button:has-text("Voltar tudo ao automático")');
    await novo();
    if ((await res()).partes.length !== 4) throw new Error('não voltou: ' + (await res()).partes);
  });

  await passo(pg, 'gerador: tamanho digitado, formato medalha e sem AMS (troca de filamento por camada)', async () => {
    await pg.click('.e3g .e3d-painel-cab [data-v=padrao]');
    await marcar();
    const campo = pg.locator('.e3g-bloco:has-text("Tamanho") input[type=text]');
    await campo.fill('70'); await campo.press('Enter');
    await novo();
    let m = (await res()).medidas;
    if (Math.abs(Math.max(m.largura, m.altura - 8) - 70) > 9) throw new Error('tamanho: ' + JSON.stringify(m));
    await marcar();
    await pg.click('.e3g .e3d-painel-corpo .seg button[data-v=medalha]');
    await novo();
    await marcar();
    await pg.uncheck('.e3g-check:has-text("Tenho AMS") input');
    await novo();
    const r = await res();
    if (!r.trocas || r.trocas.length !== 3) throw new Error('trocas: ' + JSON.stringify(r.trocas));
    const txt = await pg.textContent('.e3g-trocas');
    if (!/camada \d+/.test(txt)) throw new Error('instrução: ' + txt);
    await marcar();
    await pg.check('.e3g-check:has-text("Tenho AMS") input');
    await pg.click('.e3g .e3d-painel-corpo .seg button[data-v=chaveiro]');
    await novo();
  });

  await passo(pg, 'gerador: bolso da tag NFC (Avançado)', async () => {
    await pg.click('.e3g .e3d-painel-cab [data-v=avancado]');
    await marcar();
    await pg.check('.e3g-check:has-text("Bolso pra tag NFC") input');
    await novo();
    const r = await res();
    if (!r.nfc || r.nfc.modo !== 'baixo') throw new Error('nfc: ' + JSON.stringify(r.nfc));
    await marcar();
    await pg.uncheck('.e3g-check:has-text("Bolso pra tag NFC") input');
    await novo();
  });

  await passo(pg, 'gerador: verso com @instagram colorido rente; digitar não perde o foco quando a prévia atualiza', async () => {
    await pg.click('.e3g .e3d-painel-cab [data-v=personalizar]');
    await marcar();
    const ta = pg.locator('.e3g-verso textarea');
    await ta.click();
    await pg.keyboard.type('@ana', { delay: 60 });
    await novo();
    await pg.keyboard.type('.doces', { delay: 40 });
    await pg.waitForTimeout(500);
    await pg.waitForFunction(() => { const g = window.Estudio3D.gerador; return g.res && g.cfg.verso.texto === '@ana.doces' && !g.construindo; }, null, { timeout: 30000 });
    await pg.waitForTimeout(300);
    const f = await pg.evaluate(() => ({ foco: document.activeElement && document.activeElement.tagName, valor: document.querySelector('.e3g-verso textarea').value, verso: window.Estudio3D.gerador.res.partes.some(p => p.nome === 'Verso'), info: window.Estudio3D.gerador.res.verso }));
    if (f.foco !== 'TEXTAREA' || f.valor !== '@ana.doces' || !f.verso || !(f.info.alturaLetraMM > 2)) throw new Error(JSON.stringify(f));
    await pg.click('.e3g .e3d-vistas [data-v=baixo]');
    await pg.screenshot({ path: path.join(tmp, 'gerador-verso.png') });
    await marcar();
    await ta.fill('');
    await novo();
    if ((await res()).partes.some(p => /^Verso/.test(p))) throw new Error('verso não saiu');
    // QR no verso: link vira quadradinhos exatos, com o tamanho informado
    await pg.click('.e3g-verso .seg button[data-v=qr]');
    await marcar();
    await pg.fill('.e3g-verso input[aria-label="QR do verso"]', 'https://instagram.com/144lab');
    await novo();
    const q = await pg.evaluate(() => window.Estudio3D.gerador.res.verso);
    if (!q || !q.qr || q.qr.versao !== 3 || !(q.qr.moduloMM > 0.9)) throw new Error('QR: ' + JSON.stringify(q));
    await pg.click('.e3g .e3d-vistas [data-v=baixo]');
    await pg.screenshot({ path: path.join(tmp, 'gerador-qr.png') });
    await marcar();
    await pg.fill('.e3g-verso input[aria-label="QR do verso"]', '');
    await novo();
    await pg.click('.e3g-verso .seg button[data-v=texto]');
    if ((await res()).partes.some(p => /^Verso/.test(p))) throw new Error('verso não saiu');
    await pg.click('.e3g .e3d-vistas [data-v=iso]');
  });

  await passo(pg, 'gerador: comparar original × chaveiro (imagem alinhada por cima da peça, de cima)', async () => {
    await pg.click('.e3g .e3d-vistas [data-b=comparar]');
    await pg.waitForTimeout(400);
    const c = await pg.evaluate(() => {
      const g = window.Estudio3D.gerador, img = document.querySelector('.e3g-comparar img').getBoundingClientRect();
      const r = g.res, pos = g.pos, z = r.medidas.espessura;
      // a caixa da logo (px da análise) na tela tem que bater com a imagem
      const cx = g.an.caixa, k = r.transformada;
      const p = (x, y) => g.visor.telaDe(pos[0] + x * k.esc + k.tx, pos[1] - y * k.esc + k.ty, z);
      const a = p(cx.x0, cx.y0), b2 = p(cx.x1 + 1, cx.y1 + 1);
      const fx = (x) => img.left + x / g.an.W * img.width, fy = y => img.top + y / g.an.H * img.height;
      return { on: document.querySelector('.e3g-comparar').classList.contains('on'), erro: Math.max(Math.abs(a.x - fx(cx.x0)), Math.abs(a.y - fy(cx.y0)), Math.abs(b2.x - fx(cx.x1 + 1)), Math.abs(b2.y - fy(cx.y1 + 1))) };
    });
    if (!c.on || c.erro > 2) throw new Error(JSON.stringify(c));
    await pg.click('.e3g .e3d-vistas [data-b=comparar]');
  });

  await passo(pg, 'gerador: JPG com fundo branco (escudo) -> base branca com a faixa, verde e preto', async () => {
    await abrir('escudo-3cores-jpg.jpg');
    const r = await res();
    const nomes = r.partes.map(p => p.split(' ')[0]).sort().join();
    if (r.base !== '#FFFFFF' || nomes !== 'Base,Preto,Verde') throw new Error(JSON.stringify(r.partes) + ' ' + r.base);
  });

  await passo(pg, 'gerador: 3MF com as cores que o Bambu lê', async () => {
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('.e3g [data-b=baixar3mf]')]);
    const arq = path.join(tmp, 'gerador-novo.3mf');
    await dl.saveAs(arq);
    const s = simular(arq);
    const vols = s.objetos.flatMap(o => o.volumes);
    if (vols.length !== 3 || vols.some(v => !v.cor_volume)) throw new Error(JSON.stringify(vols));
    const cores = vols.map(v => String(v.cor_volume).toUpperCase().slice(0, 7)).sort().join();
    if (!/#FFFFFF/.test(cores) || !/#111111/.test(cores)) throw new Error('cores: ' + cores);
  });

  await passo(pg, 'gerador: nome digitado e forma viram chaveiro', async () => {
    await pg.evaluate(() => window.Estudio3D.gerador.usarTexto('MARIA', 'Arial Black'));
    await pg.waitForFunction(() => { const g = window.Estudio3D.gerador; return g.res && g.origem.tipo === 'texto' && !g.construindo; }, null, { timeout: 30000 });
    if ((await res()).partes.length !== 2) throw new Error('texto: ' + (await res()).partes);
    await pg.evaluate(() => window.Estudio3D.gerador.usarForma('coracao'));
    await pg.waitForFunction(() => { const g = window.Estudio3D.gerador; return g.res && g.origem.tipo === 'forma' && !g.construindo; }, null, { timeout: 30000 });
  });

  await passo(pg, 'gerador: Abrir no Estúdio 3D leva a peça com as cores', async () => {
    await abrir('selo-2cores.png');
    await pg.click('.e3g [data-b=estudio]');
    await pg.waitForFunction(() => window.Estudio3D.estudio && window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    const n = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos[0].partes.map(p => p.cor).sort().join());
    if (n !== '#E8590C,#FFFFFF') throw new Error('partes no Estúdio: ' + n);
  });
  await pg.screenshot({ path: path.join(tmp, 'gerador.png') });
  await pg.context().close();
}

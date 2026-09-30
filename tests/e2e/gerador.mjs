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
    const txt = await pg.textContent('.e3g-pausas');
    if (!/Camada \d+/.test(txt) || !/um filamento só/.test(txt)) throw new Error('instrução: ' + txt);
    // 3MF sem AMS: UM objeto, UM volume, um filamento (a cor da base)
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('.e3g [data-b=baixar3mf]')]);
    const arq3mf = path.join(tmp, 'gerador-sem-ams.3mf');
    await dl.saveAs(arq3mf);
    const sim = simular(arq3mf), vols = sim.objetos.flatMap(o => o.volumes);
    if (sim.objetos.length !== 1 || vols.length !== 1 || String(vols[0].cor_volume).toUpperCase().slice(0, 7) !== r.base) throw new Error('3MF sem AMS: ' + JSON.stringify(sim.objetos));
    // arquivo fatiado (formato do Bambu) -> volta com as pausas nas camadas certas
    const { escreverZip, lerZip, texto } = await import('../../src/estudio3d/core/formatos/zip.js');
    const { md5 } = await import('../../src/gerador/pausas.js');
    const fs = await import('node:fs');
    const pausas = await pg.evaluate(() => window.Estudio3D.gerador.res.pausas);
    const alto = r.medidas.espessura, linhas = ['; HEADER_BLOCK_START', '; HEADER_BLOCK_END'];
    for (let i = 1; i <= Math.round(alto / 0.2); i++) linhas.push('; CHANGE_LAYER', '; Z_HEIGHT: ' + +(i * 0.2).toFixed(2), '; LAYER_HEIGHT: 0.2', 'M73 L' + i, 'M991 S0 P' + (i - 1) + ' ;notify layer change', '; FEATURE: Outer wall', 'G1 X1 Y1 E.1');
    const gcode = new TextEncoder().encode(linhas.join('\n'));
    const fatiado = path.join(tmp, 'chaveiro.gcode.3mf');
    fs.writeFileSync(fatiado, escreverZip([{ nome: 'Metadata/plate_1.gcode', dados: gcode }, { nome: 'Metadata/plate_1.gcode.md5', dados: md5(gcode) }, { nome: 'Metadata/project_settings.config', dados: '{"machine_pause_gcode":"M400 U1"}' }]));
    const [dl2] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.setInputFiles('.e3g-pausas input[type=file]', fatiado)]);
    if (dl2.suggestedFilename() !== 'chaveiro-com-pausas.gcode.3mf') throw new Error('nome ' + dl2.suggestedFilename());
    const saida = path.join(tmp, 'chaveiro-com-pausas.gcode.3mf');
    await dl2.saveAs(saida);
    const z = lerZip(new Uint8Array(fs.readFileSync(saida))), g = texto(z['Metadata/plate_1.gcode']);
    if (g.split('; PAUSE_PRINTING\n').length - 1 !== pausas.length || !/M400 U1/.test(g)) throw new Error('pausas no G-code: ' + (g.split('; PAUSE_PRINTING').length - 1) + ' de ' + pausas.length);
    if (texto(z['Metadata/plate_1.gcode.md5']) !== md5(z['Metadata/plate_1.gcode'])) throw new Error('MD5 não atualizado');
    for (const p of pausas) { const i = g.indexOf('; Z_HEIGHT: ' + +(p.z + 0.2).toFixed(2) + '\n'); const j = g.indexOf('; PAUSE_PRINTING', i); if (i < 0 || j < 0 || j > g.indexOf('; FEATURE', i)) throw new Error('pausa fora da camada de ' + p.z); }
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

  await passo(pg, 'gerador: SVG é lido em VETOR (contorno exato do arquivo), alinhado com a original; SVG com texto em fonte cai pros pixels com aviso', async () => {
    await abrir('sol-4cores-svg.svg');
    const r = await res();
    const nomes = r.partes.map(p => p.split(' ')[0]).sort().join();
    if (nomes !== 'Amarelo,Base,Preto,Vermelho' || r.base !== '#1D4ED8') throw new Error(JSON.stringify(r.partes) + ' ' + r.base);
    const v = await pg.evaluate(() => ({ vetor: window.Estudio3D.gerador.an.vetor, q: window.Estudio3D.gerador.res.qualidade.itens.map(x => x.titulo).join('|') }));
    if (!v.vetor || !/Contorno exato do SVG/.test(v.q)) throw new Error(JSON.stringify(v));
    // comparar: a imagem (desenhada pelo navegador) bate com a peça lida do vetor
    await pg.click('.e3g .e3d-vistas [data-b=comparar]');
    await pg.waitForTimeout(400);
    const c = await pg.evaluate(() => {
      const g = window.Estudio3D.gerador, img = document.querySelector('.e3g-comparar img').getBoundingClientRect();
      const r = g.res, pos = g.pos, z = r.medidas.espessura, cx = g.an.caixa, k = r.transformada;
      const p = (x, y) => g.visor.telaDe(pos[0] + x * k.esc + k.tx, pos[1] - y * k.esc + k.ty, z);
      const a = p(cx.x0, cx.y0), b2 = p(cx.x1 + 1, cx.y1 + 1);
      const fx = x => img.left + x / g.an.W * img.width, fy = y => img.top + y / g.an.H * img.height;
      return Math.max(Math.abs(a.x - fx(cx.x0)), Math.abs(a.y - fy(cx.y0)), Math.abs(b2.x - fx(cx.x1 + 1)), Math.abs(b2.y - fy(cx.y1 + 1)));
    });
    await pg.click('.e3g .e3d-vistas [data-b=comparar]');
    if (c > 2) throw new Error('comparar desalinhado ' + c.toFixed(1) + ' px');
    // SVG com texto em fonte: o navegador desenha o texto; o motor usa os pixels e avisa
    const fs = await import('node:fs');
    const arq = path.join(tmp, 'logo-com-texto.svg');
    fs.writeFileSync(arq, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect x="10" y="10" width="380" height="180" rx="40" fill="#15803d"/><text x="200" y="130" font-size="90" font-family="Arial" font-weight="900" text-anchor="middle" fill="#ffffff">LOJA</text></svg>');
    await marcar();
    await pg.setInputFiles('.e3g input[type=file]', arq);
    await pg.waitForFunction(() => { const g = window.Estudio3D.gerador; return g.origem && g.origem.nome === 'logo-com-texto' && g.res && g.res !== window.__r && !g.construindo; }, null, { timeout: 30000 });
    const t = await pg.evaluate(() => { const g = window.Estudio3D.gerador; return { vetor: !!g.an.vetor, avisos: g.res.avisos.map(a => a.texto).join('|'), partes: g.res.partes.map(p => p.nome) }; });
    if (t.vetor || !/TEXTO em fonte/.test(t.avisos) || t.partes.length < 2) throw new Error(JSON.stringify(t));
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

  await passo(pg, 'gerador: FOTO -> pôster automático (cores chapadas); Litofania (peça branca, prévia contra a luz, 3MF de 1 volume); volta pra logo', async () => {
    await marcar();
    await pg.setInputFiles('.e3g input[type=file]', path.join(raiz, 'tests', 'fixtures', 'fotos', 'gato.jpg'));
    const pronto = cond => pg.waitForFunction(new Function('const g = window.Estudio3D.gerador; return !!(g.res && g.res !== window.__r && !g.construindo && (' + cond + '));'), null, { timeout: 60000 });
    await pronto("g.origem.nome === 'gato' && g.an.poster");
    await pg.click('.e3g .e3d-painel-cab [data-v=padrao]');
    let t = await pg.evaluate(() => { const g = window.Estudio3D.gerador; return { cores: g.an.cores.length, partes: g.res.partes.length, seg: !!document.querySelector('.e3g [data-b=tipo] [data-v=poster].active') }; });
    if (t.cores !== 4 || t.partes < 4 || !t.seg) throw new Error('pôster: ' + JSON.stringify(t));
    await marcar();
    await pg.click('.e3g [data-b=tipo] [data-v=litofania]');
    await pronto('g.res.litofania');
    t = await pg.evaluate(() => { const g = window.Estudio3D.gerador; return { partes: g.res.partes.map(p => p.cor), antes: document.querySelector('.e3g-antes').textContent, img: document.querySelector('.e3g-antes img').src.slice(0, 21) }; });
    if (t.partes.join() !== '#FFFFFF' || !/Contra a luz/.test(t.antes) || t.img !== 'data:image/png;base64') throw new Error('litofania: ' + JSON.stringify(t));
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('.e3g [data-b=baixar3mf]')]);
    const arq = path.join(tmp, 'litofania.3mf');
    await dl.saveAs(arq);
    const vols = simular(arq).objetos.flatMap(o => o.volumes);
    if (vols.length !== 1 || !/^#FFFFFF/i.test(String(vols[0].cor_volume))) throw new Error('3MF: ' + JSON.stringify(vols));
    await marcar();
    await pg.click('.e3g [data-b=tipo] [data-v=logo]');
    await pronto('!g.an.poster && !g.res.litofania');
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

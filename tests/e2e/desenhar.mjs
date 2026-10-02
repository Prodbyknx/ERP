// E2E do DESENHAR (o painel único: desenhar + modelar + foto), clicando como
// um iniciante: abre pelo trilho e clica — sem botão de "começar" escondido.
//  FOTO: pôr pelo próprio painel, opacidade, medir em mm, arrastar (botão
//        "Arrastar a foto"), arrastar arquivo / colar, esconder / tirar, não exporta.
//  DESENHO: clique já põe ponto (na mesa, ou em cima da foto); clique no 1º
//        fecha e vira peça; Placa / Vaso / Tubo; espelho (e vice-versa);
//        face por face; fundura na vista de lado; puxar face; cubo; arredondar;
//        contorno em "8"; desfazer/refazer; exportar; editar de novo.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoDesenhar({ b, tmp, novaPagina, passo, abrirEstudio, teste }) {
  console.log('DESENHAR) clique já põe ponto; foto; placa/vaso/tubo; espelho; modelar face por face');
  const { escreverPNG } = await import('../../mcp/imagem.mjs');
  const { criar, volume } = await import('../../src/estudio3d/core/malha.js');
  const { validar, autoInterseccoes } = await import('../../src/estudio3d/core/validador.js');
  // foto: um vaso simétrico com uma barra preta de 100 px (x 50..150) no meio pra medir
  const W = 200, H = 200, px = new Uint8Array(W * H * 4).fill(255);
  for (let y = 20; y < 180; y++) { const r = 30 + 25 * Math.sin((y - 20) / 160 * Math.PI); for (let x = 0; x < W; x++) if (Math.abs(x - 100) < r) { const i = (y * W + x) * 4; px[i] = 200; px[i + 1] = 90; px[i + 2] = 40; } }
  for (let y = 95; y < 105; y++) for (let x = 50; x < 150; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  const foto = path.join(tmp, 'desenhar-vaso.png');
  fs.writeFileSync(foto, escreverPNG(px, W, H));
  const ruim = path.join(tmp, 'desenhar-ruim.png');
  fs.writeFileSync(ruim, new Uint8Array(3000).map((_, i) => (i * 31) % 256));

  const pg = await novaPagina(b);
  pg.on('dialog', d => { pg.ultimoDialogo = d.message(); d.accept(); });
  const estado = () => pg.evaluate(() => { const s = window.Estudio3D.estudio.secoes.desenhar.estado(); return { ...s, gaiola: s.gaiola && { v: s.gaiola.v, f: s.gaiola.f, a: s.gaiola.a, espelho: s.gaiola.espelho, espessura: s.gaiola.espessura, suave: s.gaiola.suave, tipo: s.gaiola.tipo } }; });
  const ocioso = () => pg.evaluate(() => window.Estudio3D.estudio.secoes.desenhar.ocioso());
  const R = () => pg.evaluate(() => { const r = window.Estudio3D.estudio.secoes.referencia.atual(); return r && { plano: r.plano, cx: r.cx, cy: r.cy, prof: r.prof, largura: r.largura, aspecto: r.aspecto, opacidade: r.opacidade }; });
  let F = null;
  const tela = (dx, dz) => pg.evaluate(([x, y, z]) => window.Estudio3D.estudio.visor.telaDe(x, y, z), [F.cx + dx, F.prof, F.cy + dz]);
  const clicar = async (dx, dz, opc) => { const p = await tela(dx, dz); await pg.mouse.click(p.x, p.y, opc); await pg.waitForTimeout(60); };
  const nObj = () => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
  const malhaDe = id => pg.evaluate(i => { const o = window.Estudio3D.estudio.cena.objeto(i); return o && { pos: Array.from(o.partes[0].malha.pos), idx: Array.from(o.partes[0].malha.idx) }; }, id);
  const fechada = (m, msg) => {
    const malha = criar(m.pos, m.idx), r = validar(malha), x = autoInterseccoes(malha);
    if (r.arestasAbertas || r.arestasNaoManifold || r.orientacaoTrocada || r.componentesInvertidos || x.pares || !(volume(malha) > 0)) throw new Error(msg + ': abertas ' + r.arestasAbertas + ', non-manifold ' + r.arestasNaoManifold + ', viradas ' + r.orientacaoTrocada + ', cruzamentos ' + x.pares + ', volume ' + volume(malha));
    return malha;
  };
  const faixa = (m, k) => { let a = Infinity, z = -Infinity; for (let i = k; i < m.pos.length; i += 3) { a = Math.min(a, m.pos[i]); z = Math.max(z, m.pos[i]); } return [a, z]; };
  const nova = () => pg.click('[data-sec=des] [data-a=nova]');
  const modo = v => pg.click('[data-sec=des] [data-a=modo] button[data-v=' + v + ']');
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');

    await passo(pg, 'INICIANTE: abre "Desenhar" pelo trilho e clica na MESA (vista 3D de sempre) -> os pontos aparecem; clique no 1º = peça', async () => {
      await pg.click('.e3d-rail button[data-ferr=des]');
      const vazio = await pg.evaluate(() => getComputedStyle(document.querySelector('.e3d-vazio')).display);
      if (vazio !== 'none') throw new Error('o cartão "Arraste seu modelo" tapa a mesa');
      const mesa = (x, y) => pg.evaluate(([x, y]) => window.Estudio3D.estudio.visor.telaDe(x, y, 0), [x, y]);
      for (const [x, y] of [[110, 110], [150, 110], [150, 140], [110, 140]]) { const p = await mesa(x, y); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(60); }
      let s = await estado();
      if (s.gaiola.v.length !== 4 || s.forma !== 'linha') throw new Error('os cliques não viraram pontos: ' + JSON.stringify({ v: s.gaiola && s.gaiola.v.length, forma: s.forma }));
      const p0 = await mesa(110, 110); await pg.mouse.click(p0.x, p0.y);
      await ocioso();
      s = await estado();
      if (!s.alvo || s.forma !== 'contorno') throw new Error('não virou peça: ' + JSON.stringify({ alvo: s.alvo, forma: s.forma }));
      const c = await pg.evaluate(i => window.Estudio3D.estudio.cena.caixaExata(window.Estudio3D.estudio.cena.objeto(i)), s.alvo);
      if (Math.abs(c.tam[0] - 40) > 0.6 || Math.abs(c.tam[1] - 30) > 0.6 || Math.abs(c.tam[2] - 3) > 1e-3 || Math.abs(c.min[2]) > 1e-3) throw new Error('placa ' + c.tam.map(v => v.toFixed(2)).join('×') + ' z0 ' + c.min[2]);
      fechada(await malhaDe(s.alvo), 'placa na mesa');
      // a peça fica escolhida: tira pra não atrapalhar os próximos passos
      await pg.keyboard.press('Control+z');
      if (await nObj()) throw new Error('Ctrl+Z não tirou a peça');
      await nova();
    });

    await passo(pg, 'FOTO: "Pôr uma foto" no próprio Desenhar -> de frente, 50%, em pé na mesa; opacidade pelo controle', async () => {
      await pg.setInputFiles('[data-sec=des] input[type=file]', foto);
      await pg.waitForFunction(() => window.Estudio3D.estudio.visor.refMeshes.size === 1, null, { timeout: 15000 });
      const r = await R();
      if (r.plano !== 'frente' || Math.abs(r.largura - 100) > 1e-6 || r.opacidade !== 0.5 || Math.abs(r.cy - 50) > 1e-6) throw new Error(JSON.stringify(r));
      await pg.evaluate(() => { const i = document.querySelector('[data-sec=des] [data-a=opac]'); i.value = 35; i.dispatchEvent(new Event('input', { bubbles: true })); });
      const op = await pg.evaluate(() => [...window.Estudio3D.estudio.visor.refMeshes.values()][0].material.opacity);
      if (Math.abs(op - 0.35) > 1e-6) throw new Error('opacidade ' + op);
      F = await R();
    });

    await passo(pg, 'MEDIR NA FOTO: "Ajustar a foto" -> "Medir" -> 2 cliques na barra + 80 mm -> escala real', async () => {
      await pg.click('[data-sec=des] [data-a=ajustes]');
      await pg.click('[data-sec=des] [data-a=medir]');
      await clicar(-25, 0); await clicar(25, 0);
      const hoje = parseFloat((await pg.inputValue('[data-sec=des] [data-a=medHoje]')).replace(',', '.'));
      if (Math.abs(hoje - 50) > 0.6) throw new Error('medida na foto ' + hoje);
      await pg.fill('[data-sec=des] [data-a=medReal]', '80');
      await pg.click('[data-sec=des] [data-a=medAplicar]');
      const r = await R();
      if (Math.abs(r.largura - 160) > 2) throw new Error('largura ' + r.largura + ' (esperado ~160)');
      if (await nObj()) throw new Error('os cliques da medida viraram peça');
      if ((await estado()).gaiola && (await estado()).gaiola.v.length) throw new Error('os cliques da medida viraram pontos');
      await pg.click('[data-sec=des] [data-a=ajustes]');
      await pg.evaluate(() => window.Estudio3D.estudio.secoes.referencia.enquadrar(window.Estudio3D.estudio.secoes.referencia.atual()));
      await pg.waitForTimeout(200);
      F = await R();
    });

    await passo(pg, 'ARRASTAR A FOTO: só com o botão "Arrastar a foto" ligado (sem ele, o clique é ponto)', async () => {
      await pg.click('[data-sec=des] [data-a=mover]');
      const r0 = await R(), c = await tela(0, 0), d = await tela(20, 0);
      await pg.mouse.move(c.x, c.y); await pg.mouse.down();
      for (let i = 1; i <= 8; i++) await pg.mouse.move(c.x + (d.x - c.x) * i / 8, c.y);
      await pg.mouse.up();
      const r = await R();
      if (Math.abs(r.cx - r0.cx - 20) > 1.5 || Math.abs(r.cy - r0.cy) > 1.5) throw new Error('moveu ' + (r.cx - r0.cx).toFixed(2));
      if ((await estado()).gaiola && (await estado()).gaiola.v.length) throw new Error('arrastar a foto pôs ponto');
      await pg.click('[data-sec=des] [data-a=mover]');
      // volta pro lugar (o resto do teste usa o meio da foto)
      await pg.click('[data-sec=des] [data-a=ajustes]');
      await pg.fill('[data-sec=des] [data-a=ph]', String(r0.cx).replace('.', ',')); await pg.press('[data-sec=des] [data-a=ph]', 'Enter');
      await pg.click('[data-sec=des] [data-a=ajustes]');
      F = await R();
    });

    await passo(pg, 'CONTORNO COM ESPELHO: liga o espelho, meio contorno do meio até o meio + clique no 1º = peça inteira, fechada, área certa', async () => {
      await pg.selectOption('[data-sec=des] [data-a=espelho]', 'sim');
      const meia = [[0, -40], [25, -40], [30, 0], [15, 30], [0, 40]];
      for (const [x, z] of meia) await clicar(x, z);
      let s = await estado();
      if (s.alvo || s.gaiola.v.length !== 5) throw new Error('rascunho: ' + JSON.stringify({ alvo: s.alvo, v: s.gaiola.v.length }));
      if (Math.abs(s.gaiola.v[0][0] - F.cx) > 1e-9 || Math.abs(s.gaiola.v[4][0] - F.cx) > 1e-9) throw new Error('não grudou na linha do meio');
      await clicar(0, -40);
      await ocioso();
      s = await estado();
      if (!s.alvo || s.forma !== 'contorno') throw new Error('não virou peça');
      const m = fechada(await malhaDe(s.alvo), 'peça espelhada');
      if (Math.abs(volume(m) - 3700 * 3) > 3700 * 3 * 0.01) throw new Error('volume ' + volume(m).toFixed(1) + ' (esperado ~11100)');
      const [x0, x1] = faixa(m, 0);
      if (Math.abs(x0 - (F.cx - 30)) > 0.3 || Math.abs(x1 - (F.cx + 30)) > 0.3) throw new Error('não saiu dos 2 lados: ' + x0 + '..' + x1);
      const [y0, y1] = faixa(m, 1);
      if (Math.abs(y1 - F.prof) > 0.01 || Math.abs(y0 - (F.prof - 3)) > 0.01) throw new Error('espessura não foi pra frente: Y ' + y0 + '..' + y1);
    });

    await passo(pg, 'VASO: na mesma peça, "Vaso (girar)" gira o meio contorno em volta da linha verde', async () => {
      const s0 = await estado();
      await pg.click('[data-sec=des] [data-a=tipo] button[data-v=vaso]');
      await ocioso();
      const m = fechada(await malhaDe(s0.alvo), 'vaso');
      const [x0, x1] = faixa(m, 0), [z0, z1] = faixa(m, 2);
      if (Math.abs((x0 + x1) / 2 - F.cx) > 0.3 || Math.abs(x1 - x0 - 60) > 0.6 || Math.abs(z1 - z0 - 80) > 0.3) throw new Error('vaso ' + [x0, x1, z0, z1].map(v => v.toFixed(1)));
      await pg.click('[data-sec=des] [data-a=tipo] button[data-v=placa]');
      await ocioso();
    });

    await passo(pg, 'DESFAZER/REFAZER: Ctrl+Z volta pro contorno aberto; Ctrl+Y traz a peça; Ctrl+Z no rascunho tira ponto', async () => {
      let s = await estado();
      const id = s.alvo;
      await pg.keyboard.press('Control+z');            // placa -> vaso
      await pg.keyboard.press('Control+z');            // vaso -> placa original
      await pg.keyboard.press('Control+z');            // tira a peça
      s = await estado();
      if (s.alvo || !s.gaiola || s.gaiola.f.length || s.gaiola.v.length !== 5) throw new Error('depois do Ctrl+Z: ' + JSON.stringify({ alvo: s.alvo, f: s.gaiola && s.gaiola.f.length }));
      await pg.keyboard.press('Control+y');
      s = await estado();
      if (s.alvo !== id || s.gaiola.f.length !== 1) throw new Error('Ctrl+Y não trouxe a peça');
      await pg.keyboard.press('Control+z');
      await pg.keyboard.press('Control+z');            // rascunho: tira o último ponto
      s = await estado();
      if (s.alvo || s.gaiola.v.length !== 4) throw new Error('Ctrl+Z no rascunho: ' + s.gaiola.v.length);
      await clicar(0, 40); await clicar(0, -40);
      await ocioso();
      s = await estado();
      if (!s.alvo || s.gaiola.f.length !== 1) throw new Error('não refez');
    });

    await passo(pg, 'FACE POR FACE: clicar numa borda e depois na foto cria uma face nova até ali (continua fechada)', async () => {
      await clicar(27.5, -20);                         // meio da borda (25,-40)–(30,0)
      let s = await estado();
      if (!s.borda) throw new Error('não escolheu a borda');
      await clicar(45, -15);
      await ocioso();
      s = await estado();
      if (s.gaiola.f.length !== 2 || s.forma !== 'malha') throw new Error('faces: ' + s.gaiola.f.length);
      fechada(await malhaDe(s.alvo), 'com a face nova');
      await pg.keyboard.press('Escape');
      if ((await estado()).borda) throw new Error('Esc não soltou a borda');
    });

    await passo(pg, 'ESPELHO "E VICE-VERSA": no "Escolhe", arrastar o ponto do lado espelhado move o de verdade; Ctrl+Z volta', async () => {
      await modo('mexer');
      let s = await estado();
      const i = s.gaiola.v.findIndex(p => Math.abs(p[0] - (F.cx + 30)) < 0.5 && Math.abs(p[2] - F.cy) < 0.5);
      const antes = s.gaiola.v[i].slice();
      const a = await tela(-30, 0), bb = await tela(-36, 0);
      await pg.mouse.move(a.x, a.y); await pg.mouse.down();
      for (let k = 1; k <= 6; k++) await pg.mouse.move(a.x + (bb.x - a.x) * k / 6, a.y);
      await pg.mouse.up(); await ocioso();
      s = await estado();
      if (Math.abs(s.gaiola.v[i][0] - F.cx - 36) > 0.6) throw new Error('foi pra ' + (s.gaiola.v[i][0] - F.cx));
      const [x0] = faixa(fechada(await malhaDe(s.alvo), 'depois de arrastar'), 0);
      if (x0 > F.cx - 44.5) throw new Error('o lado espelhado da peça não acompanhou');
      await pg.keyboard.press('Control+z');
      s = await estado();
      if (s.gaiola.v[i].some((x, k) => x !== antes[k])) throw new Error('Ctrl+Z não voltou o ponto');
    });

    await passo(pg, 'FUNDURA: na vista de LADO, arrastar um ponto dá profundidade (Y muda, X fica) e continua fechada', async () => {
      let s = await estado();
      const i = s.gaiola.v.findIndex(p => Math.abs(p[0] - (F.cx + 30)) < 0.5 && Math.abs(p[2] - F.cy) < 0.5);
      const antes = s.gaiola.v[i].slice();
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('direita'); e.visor.controles.update(); });
      await pg.waitForTimeout(200);
      const a = await pg.evaluate(p => window.Estudio3D.estudio.visor.telaDe(p[0], p[1], p[2]), antes);
      const bb = await pg.evaluate(p => window.Estudio3D.estudio.visor.telaDe(p[0], p[1] + 10, p[2]), antes);
      await pg.mouse.move(a.x, a.y); await pg.mouse.down();
      for (let k = 1; k <= 6; k++) await pg.mouse.move(a.x + (bb.x - a.x) * k / 6, a.y + (bb.y - a.y) * k / 6);
      await pg.mouse.up(); await ocioso();
      s = await estado();
      const v = s.gaiola.v[i];
      if (Math.abs(v[1] - antes[1] - 10) > 0.6 || Math.abs(v[0] - antes[0]) > 1e-6) throw new Error('de ' + antes.map(x => x.toFixed(1)) + ' pra ' + v.map(x => x.toFixed(1)));
      fechada(await malhaDe(s.alvo), 'com fundura');
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.secoes.referencia.enquadrar(e.secoes.referencia.atual()); });
      await modo('criar');
    });

    await passo(pg, 'BLOCO: contorno (espelhado) + "Puxar face" 12 mm = bloco MACIÇO pra frente', async () => {
      await nova();
      for (const [x, z] of [[0, -30], [20, -30], [20, 10], [0, 10]]) await clicar(x, z);
      await clicar(0, -30); await ocioso();
      await modo('mexer');
      await clicar(10, -10);
      let s = await estado();
      if (s.facesSel.length !== 1) throw new Error('não escolheu a face');
      await pg.fill('[data-sec=des] [data-a=puxarMm]', '12');
      await pg.click('[data-sec=des] [data-a=puxar]'); await ocioso();
      s = await estado();
      const m = fechada(await malhaDe(s.alvo), 'bloco');
      if (Math.abs(volume(m) - 40 * 40 * 12) > 1e-3) throw new Error('volume ' + volume(m));
      const [y0, y1] = faixa(m, 1);
      if (Math.abs(y1 - F.prof) > 0.01 || Math.abs(y0 - (F.prof - 12)) > 0.01) throw new Error('não puxou pra frente');
      await modo('criar');
    });

    await passo(pg, 'DICA VISUAL: desenhando, o 1º ponto da linha fica VERDE (é nele que fecha) e o atual LARANJA', async () => {
      await nova();
      for (const [x, z] of [[0, 20], [15, 20], [15, 35]]) await clicar(x, z);
      const cores = await pg.evaluate(() => { const g = window.Estudio3D.estudio.visor.raizAjuda.children.find(x => x.userData.tipo === 'gaiola'); const p = g.children.find(x => x.isPoints); return Array.from(p.geometry.getAttribute('color').array); });
      const cor = k => cores.slice(k * 3, k * 3 + 3).map(v => Math.round(v * 100) / 100).join(',');
      if (cor(0) !== '0.13,0.62,0.27') throw new Error('1º ponto não está verde: ' + cor(0));
      if (cor(3) !== '0.9,0.3,0') throw new Error('ponto atual não está laranja: ' + cor(3));
      await pg.keyboard.press('Escape');
      await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z');
      if ((await estado()).gaiola.v.length) throw new Error('Ctrl+Z não limpou o rascunho');
    });

    await passo(pg, 'CUBO + PUXAR + ARREDONDAR: "Começar com um cubo", face de cima puxada 10 mm, arredondado fechado e sem cruzar', async () => {
      await pg.click('[data-sec=des] [data-a=cubo]'); await ocioso();
      let s = await estado();
      const g = s.gaiola, tam = Math.max(10, Math.round(F.largura / 4));
      if (!s.alvo || g.f.length !== 5 || s.modo !== 'mexer') throw new Error('cubo: ' + JSON.stringify({ alvo: s.alvo, f: g.f.length, modo: s.modo }));
      let m = fechada(await malhaDe(s.alvo), 'cubo');
      if (Math.abs(volume(m) - tam ** 3) > 1e-6) throw new Error('volume do cubo ' + volume(m));
      const zTopo = Math.max(...g.v.map(p => p[2]));
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('topo'); e.enquadrar(); });
      await pg.waitForTimeout(200);
      const pt = await pg.evaluate(([x, y, z]) => window.Estudio3D.estudio.visor.telaDe(x, y, z), [F.cx + tam / 4, F.prof + tam / 4, zTopo]);
      await pg.mouse.click(pt.x, pt.y);
      s = await estado();
      if (s.facesSel.length !== 1) throw new Error('não escolheu a face de cima');
      await pg.fill('[data-sec=des] [data-a=puxarMm]', '10');
      await pg.click('[data-sec=des] [data-a=puxar]'); await ocioso();
      s = await estado();
      m = fechada(await malhaDe(s.alvo), 'cubo puxado');
      if (Math.abs(volume(m) - tam * tam * (tam + 10)) > 1e-6) throw new Error('volume puxado ' + volume(m));
      await pg.selectOption('[data-sec=des] [data-a=arred]', '1'); await ocioso();
      s = await estado();
      const ms = fechada(await malhaDe(s.alvo), 'arredondado');
      if (!(volume(ms) < volume(m) && volume(ms) > volume(m) * 0.5)) throw new Error('volume arredondado ' + volume(ms));
      const st = await pg.textContent('[data-sec=des] [data-a=status]');
      if (!/pronto pra imprimir/.test(st)) throw new Error('status: ' + st);
      await modo('criar');
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.secoes.referencia.enquadrar(e.secoes.referencia.atual()); });
    });

    await passo(pg, 'TUBO: linha aberta + "Virar tubo" = tubo fechado; contorno em "8" avisa "cruza a própria linha" e arrastar o ponto conserta', async () => {
      await nova();
      await pg.selectOption('[data-sec=des] [data-a=espelho]', '');
      for (const [x, z] of [[-30, -30], [0, -10], [30, -30]]) await clicar(x, z);
      const n = await nObj();
      await pg.click('[data-sec=des] [data-a=virarTubo]');
      await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n, { timeout: 30000 });
      await ocioso();
      fechada(await malhaDe((await estado()).alvo), 'tubo');
      // o "8" sem querer: o contorno cruza a própria linha -> o motor faz a peça inteira
      await nova();
      for (const [x, z] of [[-20, 0], [20, 20], [20, 0], [-20, 20]]) await clicar(x, z);
      await clicar(-20, 0); await ocioso();
      let s = await estado();
      if (!s.alvo || s.erro) throw new Error('o "8" não virou peça: ' + s.erro);
      let st = await pg.textContent('[data-sec=des] [data-a=status]');
      if (!/cruza a própria linha/.test(st) || /pronto pra imprimir/.test(st)) throw new Error('não avisou do cruzamento: ' + st);
      // o iniciante arrasta o ponto (20,0) pra (20,40): vira um paralelogramo, sem cruzar
      await modo('mexer');
      const a = await tela(20, 0), bb = await tela(20, 40);
      await pg.mouse.move(a.x, a.y); await pg.mouse.down();
      for (let k = 1; k <= 8; k++) await pg.mouse.move(a.x, a.y + (bb.y - a.y) * k / 8);
      await pg.mouse.up(); await ocioso();
      st = await pg.textContent('[data-sec=des] [data-a=status]');
      if (!/pronto pra imprimir/.test(st)) throw new Error('depois de arrastar: ' + st);
      s = await estado();
      fechada(await malhaDe(s.alvo), 'consertada');
      await modo('criar');
    });

    await passo(pg, 'EXPORTAR e REABRIR: as peças desenhadas saem no 3MF fechadas e imprimíveis; a foto não vai', async () => {
      await nova();
      const n = await nObj();
      await pg.click('.e3d-rail button[data-ferr=exp]');
      const op = await pg.evaluate(() => [...window.Estudio3D.estudio.visor.itens.values()].map(x => x.mesh.material.opacity));
      if (op.some(o => o < 1)) throw new Error('o raio-X ficou ligado fora do Desenhar');
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
      const arq = path.join(tmp, 'desenhar.3mf'); await dl.saveAs(arq);
      const { importarArquivo } = await import('../../src/estudio3d/core/importar.js');
      const r = importarArquivo('x.3mf', new Uint8Array(fs.readFileSync(arq)));
      if (r.objetos.length !== n) throw new Error(r.objetos.length + ' objetos no 3MF (na mesa: ' + n + ')');
      for (const o of r.objetos) for (const p of o.partes) { const v = validar(p.malha); if (!v.imprimivel) throw new Error(o.nome + ' não imprimível'); }
      if (!(await pg.evaluate(() => window.Estudio3D.estudio.visor.raizRef.visible))) throw new Error('a foto sumiu da tela');
    });

    await passo(pg, 'EDITAR DE NOVO: escolher a peça e "Editar o desenho" volta pros pontos; peça mudada por outra ferramenta pergunta antes', async () => {
      const id = await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); return o.id; });
      await pg.click('.e3d-rail button[data-ferr=des]');
      await pg.waitForSelector('[data-sec=des] [data-a=editarBloco]:not([style*="none"])', { timeout: 5000 });
      await pg.click('[data-sec=des] [data-a=editar]');
      let s = await estado();
      if (s.alvo !== id) throw new Error('não entrou na edição');
      await nova();
      await pg.evaluate(i => { const e = window.Estudio3D.estudio, o = e.cena.objeto(i); e.cena.aplicar('Consertar', () => { o.partes = [{ ...o.partes[0], malha: { pos: o.partes[0].malha.pos.slice(), idx: o.partes[0].malha.idx.slice() } }]; }); e.cena.selecionar(i, o.partes[0].id); }, id);
      pg.ultimoDialogo = null;
      await pg.click('[data-sec=des] [data-a=editar]');
      if (!/mudada por outra ferramenta/.test(pg.ultimoDialogo || '')) throw new Error('não perguntou');
      s = await estado();
      if (s.alvo !== id) throw new Error('aceitou e não entrou na edição');
      await nova();
    });

    await passo(pg, 'FOTO: arrastar imagem pro 3D e colar (Ctrl+V) adicionam; esconder e tirar; arquivo que não é imagem dá aviso', async () => {
      const n = await pg.evaluate(async () => {
        const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
        const c = cv.getContext('2d'); c.fillStyle = '#0a0'; c.fillRect(0, 0, 64, 128);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const arq = nome => new File([blob], nome, { type: 'image/png' });
        const dt1 = new DataTransfer(); dt1.items.add(arq('lado.png'));
        document.querySelector('.e3d-palco').dispatchEvent(new DragEvent('drop', { dataTransfer: dt1, bubbles: true, cancelable: true }));
        const dt2 = new DataTransfer(); dt2.items.add(arq('colada.png'));
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
        const e = window.Estudio3D.estudio;
        for (let i = 0; i < 100 && e.secoes.referencia.lista().length < 3; i++) await new Promise(r => setTimeout(r, 50));
        return e.secoes.referencia.lista().map(r => r.nome);
      });
      if (n.length !== 3) throw new Error('fotos: ' + n.join(' | '));
      await pg.click('[data-sec=des] [data-ref=ref1] [data-b=ver]');
      if (await pg.evaluate(() => window.Estudio3D.estudio.visor.refMeshes.get('ref1').visible)) throw new Error('esconder não escondeu');
      await pg.click('[data-sec=des] [data-ref=ref3] [data-b=tirar]');
      if ((await pg.evaluate(() => window.Estudio3D.estudio.visor.refMeshes.size)) !== 2) throw new Error('tirar não tirou');
      await pg.setInputFiles('[data-sec=des] input[type=file]', ruim);
      await pg.waitForTimeout(800);
      if ((await pg.evaluate(() => window.Estudio3D.estudio.secoes.referencia.lista().length)) !== 2) throw new Error('adicionou foto que não existe');
      const toast = await pg.evaluate(() => document.getElementById('toast')?.textContent || '');
      if (!/Não consegui abrir essa imagem/.test(toast)) throw new Error('sem aviso: ' + toast);
    });
  } finally {
    await pg.context().close();
  }
}

// E2E do MODELAR PONTO A PONTO por cima da foto, clicando como um iniciante:
//  - contorno de MEIO lado com o espelho: começa e termina na linha do meio,
//    clica no 1º ponto -> vira face; a peça sai inteira (os 2 lados), fechada,
//    com espessura, e com a área certa;
//  - Ctrl+Z volta pro rascunho; Ctrl+Y traz a peça de volta e continua editando;
//  - clicar numa borda e depois na foto: nasce uma face nova (face por face);
//  - arrastar o ponto do lado ESPELHADO mexe no lado de verdade (e vice-versa);
//  - cubo pronto + puxar a face de cima + suavizar: fechado e sem cruzamento;
//  - exportar 3MF e reabrir: sólido fechado, imprimível;
//  - peça mudada por outra ferramenta: editar a malha pergunta antes.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoModelar({ b, tmp, novaPagina, passo, abrirEstudio, abrirSecao, teste }) {
  console.log('MODELAR) ponto a ponto por cima da foto, com espelho');
  const { escreverPNG } = await import('../../mcp/imagem.mjs');
  const { criar, volume } = await import('../../src/estudio3d/core/malha.js');
  const { validar, autoInterseccoes } = await import('../../src/estudio3d/core/validador.js');
  // foto: um vaso simétrico (o contorno não importa pro teste, mas fica realista)
  const W = 200, H = 200, px = new Uint8Array(W * H * 4).fill(255);
  for (let y = 20; y < 180; y++) { const r = 30 + 25 * Math.sin((y - 20) / 160 * Math.PI); for (let x = 0; x < W; x++) if (Math.abs(x - 100) < r) { const i = (y * W + x) * 4; px[i] = 200; px[i + 1] = 90; px[i + 2] = 40; } }
  const foto = path.join(tmp, 'modelar-vaso.png');
  fs.writeFileSync(foto, escreverPNG(px, W, H));

  const pg = await novaPagina(b);
  pg.on('dialog', d => { pg.ultimoDialogo = d.message(); d.accept(); });
  const E = 'window.Estudio3D.estudio';
  const estado = () => pg.evaluate(() => { const s = window.Estudio3D.estudio.secoes.malha.estado(); return { ...s, gaiola: s.gaiola && { v: s.gaiola.v, f: s.gaiola.f, a: s.gaiola.a, espelho: s.gaiola.espelho, espessura: s.gaiola.espessura, suave: s.gaiola.suave } }; });
  const foto0 = () => pg.evaluate(() => { const r = window.Estudio3D.estudio.secoes.referencia.atual(); return { cx: r.cx, cy: r.cy, prof: r.prof, largura: r.largura }; });
  // ponto (mm, relativo ao centro da foto de frente) -> tela
  let F = null;
  const tela = (dx, dz) => pg.evaluate(([x, y, z]) => window.Estudio3D.estudio.visor.telaDe(x, y, z), [F.cx + dx, F.prof, F.cy + dz]);
  const clicar = async (dx, dz, opc) => { const p = await tela(dx, dz); await pg.mouse.click(p.x, p.y, opc); await pg.waitForTimeout(60); };
  const malhaDe = id => pg.evaluate(i => { const o = window.Estudio3D.estudio.cena.objeto(i); return o && { pos: Array.from(o.partes[0].malha.pos), idx: Array.from(o.partes[0].malha.idx) }; }, id);
  const sair = async () => { if (await pg.isVisible('[data-sec=malha] [data-a=pronto]')) await pg.click('[data-sec=malha] [data-a=pronto]'); };
  const fechada = (m, msg) => {
    const malha = criar(m.pos, m.idx), r = validar(malha), x = autoInterseccoes(malha);
    if (r.arestasAbertas || r.arestasNaoManifold || r.orientacaoTrocada || r.componentesInvertidos || x.pares || !(volume(malha) > 0)) throw new Error(msg + ': abertas ' + r.arestasAbertas + ', non-manifold ' + r.arestasNaoManifold + ', viradas ' + r.orientacaoTrocada + ', cruzamentos ' + x.pares + ', volume ' + volume(malha));
    return malha;
  };
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');
    await abrirSecao(pg, 'ref');
    await pg.setInputFiles('[data-sec=ref] input[type=file]', foto);
    await pg.waitForFunction(() => window.Estudio3D.estudio.visor.refMeshes.size === 1, null, { timeout: 15000 });
    F = await foto0();

    await passo(pg, 'CONTORNO COM ESPELHO: meio contorno do meio até o meio + clique no 1º ponto = a peça inteira, fechada, 3 mm, área certa', async () => {
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=novoPontos]');
      F = await foto0();
      const meia = [[0, -40], [25, -40], [30, 0], [15, 30], [0, 40]];
      for (const [x, z] of meia) await clicar(x, z);
      let s = await estado();
      if (s.editId || s.gaiola.v.length !== 5 || s.gaiola.a.length !== 4) throw new Error('rascunho: ' + JSON.stringify({ id: s.editId, v: s.gaiola.v.length, a: s.gaiola.a.length }));
      if (Math.abs(s.gaiola.v[0][0] - F.cx) > 1e-9 || Math.abs(s.gaiola.v[4][0] - F.cx) > 1e-9) throw new Error('os pontos do meio não grudaram na linha do meio: ' + s.gaiola.v[0][0] + ' / ' + s.gaiola.v[4][0] + ' (meio ' + F.cx + ')');
      await clicar(0, -40);                       // fecha no 1º
      s = await estado();
      if (!s.editId || s.gaiola.f.length !== 1) throw new Error('não virou peça com 1 face: ' + JSON.stringify({ id: s.editId, f: s.gaiola.f.length }));
      const m = fechada(await malhaDe(s.editId), 'peça espelhada');
      const v = volume(m);
      if (Math.abs(v - 3700 * 3) > 3700 * 3 * 0.01) throw new Error('volume ' + v.toFixed(1) + ' (esperado ~11100: área 3700 × 3 mm)');
      const xs = []; for (let i = 0; i < m.pos.length; i += 3) xs.push(m.pos[i]);
      if (Math.abs(Math.min(...xs) - (F.cx - 30)) > 0.3 || Math.abs(Math.max(...xs) - (F.cx + 30)) > 0.3) throw new Error('não saiu dos 2 lados: ' + Math.min(...xs).toFixed(2) + '..' + Math.max(...xs).toFixed(2));
      const raiox = await pg.evaluate(id => { const it = [...window.Estudio3D.estudio.visor.itens.values()].find(x => x.mesh.userData.objeto === id); return it && it.mesh.material.opacity; }, s.editId);
      if (!(raiox < 1)) throw new Error('raio-X desligado: ' + raiox);
    });

    await passo(pg, 'DESFAZER/REFAZER: Ctrl+Z volta pro contorno aberto; Ctrl+Y traz a peça e continua nela; Ctrl+Z no rascunho tira ponto', async () => {
      let s = await estado();
      const id = s.editId;
      await pg.keyboard.press('Control+z');
      s = await estado();
      if (s.editId || !s.gaiola || s.gaiola.f.length !== 0 || s.gaiola.v.length !== 5) throw new Error('depois do Ctrl+Z: ' + JSON.stringify({ id: s.editId, f: s.gaiola && s.gaiola.f.length }));
      if (await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length)) throw new Error('a peça continuou na mesa');
      await pg.keyboard.press('Control+y');
      s = await estado();
      if (s.editId !== id || s.gaiola.f.length !== 1) throw new Error('Ctrl+Y não trouxe a peça de volta pro painel: ' + s.editId);
      await pg.keyboard.press('Control+z');            // de novo pro rascunho
      await pg.keyboard.press('Control+z');            // rascunho: tira o último ponto
      s = await estado();
      if (s.editId || s.gaiola.v.length !== 4) throw new Error('Ctrl+Z no rascunho não tirou o ponto: ' + s.gaiola.v.length);
      // o usuário clica de novo o ponto de cima e fecha
      await clicar(0, 40); await clicar(0, -40);
      s = await estado();
      if (!s.editId || s.gaiola.f.length !== 1) throw new Error('não refez a face: ' + JSON.stringify({ id: s.editId, f: s.gaiola.f.length }));
      fechada(await malhaDe(s.editId), 'refeita');
    });

    await passo(pg, 'FACE POR FACE: clicar numa borda e depois na foto cria uma face nova até ali (continua fechada)', async () => {
      let s = await estado();
      const g = s.gaiola;
      const i25 = g.v.findIndex(p => Math.abs(p[0] - (F.cx + 25)) < 0.5 && Math.abs(p[2] - (F.cy - 40)) < 0.5);
      const i30 = g.v.findIndex(p => Math.abs(p[0] - (F.cx + 30)) < 0.5 && Math.abs(p[2] - F.cy) < 0.5);
      if (i25 < 0 || i30 < 0) throw new Error('pontos não achados');
      await clicar(27.5, -20);                         // meio da borda (25,-40)–(30,0)
      s = await estado();
      if (!s.borda) throw new Error('não escolheu a borda');
      await clicar(45, -15);
      s = await estado();
      if (s.gaiola.f.length !== 2) throw new Error('faces: ' + s.gaiola.f.length);
      fechada(await malhaDe(s.editId), 'com a face nova');
      await pg.keyboard.press('Escape');
      if ((await estado()).borda) throw new Error('Esc não soltou a borda');
    });

    await passo(pg, 'ESPELHO "E VICE-VERSA": arrastar o ponto do lado espelhado move o de verdade (e a peça acompanha); Ctrl+Z volta', async () => {
      await pg.click('[data-sec=malha] [data-a=modo] button[data-v=mexer]');
      let s = await estado();
      const i = s.gaiola.v.findIndex(p => Math.abs(p[0] - (F.cx + 30)) < 0.5 && Math.abs(p[2] - F.cy) < 0.5);
      const antes = s.gaiola.v[i].slice();
      const a = await tela(-30, 0), bb = await tela(-36, 0);  // o fantasma do ponto (30,0) fica em (-30,0)
      await pg.mouse.move(a.x, a.y); await pg.mouse.down();
      for (let k = 1; k <= 6; k++) await pg.mouse.move(a.x + (bb.x - a.x) * k / 6, a.y);
      await pg.mouse.up(); await pg.waitForTimeout(100);
      s = await estado();
      const dx = s.gaiola.v[i][0] - F.cx;
      if (Math.abs(dx - 36) > 0.6) throw new Error('o ponto de verdade foi pra ' + dx.toFixed(2) + ' (esperado 36)');
      const m = fechada(await malhaDe(s.editId), 'depois de arrastar');
      const xs = []; for (let k = 0; k < m.pos.length; k += 3) xs.push(m.pos[k]);
      if (Math.min(...xs) > F.cx - 44.5) throw new Error('o lado espelhado da peça não acompanhou');
      await pg.keyboard.press('Control+z');
      s = await estado();
      if (s.gaiola.v[i].some((x, k) => x !== antes[k])) throw new Error('Ctrl+Z não voltou o ponto: ' + s.gaiola.v[i] + ' ≠ ' + antes);
    });

    await passo(pg, 'PROFUNDIDADE: na vista de LADO, arrastar um ponto dá fundura (Y muda, X e o espelho ficam) e continua fechada', async () => {
      let s = await estado();
      const i = s.gaiola.v.findIndex(p => Math.abs(p[0] - (F.cx + 30)) < 0.5 && Math.abs(p[2] - F.cy) < 0.5);
      const antes = s.gaiola.v[i].slice();
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('direita'); e.visor.controles.update(); });
      await pg.waitForTimeout(200);
      const a = await pg.evaluate(p => window.Estudio3D.estudio.visor.telaDe(p[0], p[1], p[2]), antes);
      const bb = await pg.evaluate(p => window.Estudio3D.estudio.visor.telaDe(p[0], p[1] + 10, p[2]), antes);
      await pg.mouse.move(a.x, a.y); await pg.mouse.down();
      for (let k = 1; k <= 6; k++) await pg.mouse.move(a.x + (bb.x - a.x) * k / 6, a.y + (bb.y - a.y) * k / 6);
      await pg.mouse.up(); await pg.waitForTimeout(100);
      s = await estado();
      const v = s.gaiola.v[i];
      if (Math.abs(v[1] - antes[1] - 10) > 0.6 || Math.abs(v[0] - antes[0]) > 1e-6 || Math.abs(v[2] - antes[2]) > 0.6) throw new Error('ponto foi de ' + antes.map(x => x.toFixed(2)) + ' pra ' + v.map(x => x.toFixed(2)));
      fechada(await malhaDe(s.editId), 'com fundura');
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.secoes.referencia.enquadrar(e.secoes.referencia.atual()); });
    });

    await passo(pg, 'BLOCO: contorno (meio lado) + "Puxar face" 12 mm = bloco MACIÇO pra frente (não um copo oco)', async () => {
      await sair();
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=novoPontos]');
      F = await foto0();
      for (const [x, z] of [[0, -30], [20, -30], [20, 10], [0, 10]]) await clicar(x, z);
      await clicar(0, -30);
      let s = await estado();
      if (!s.editId || s.gaiola.f.length !== 1) throw new Error('contorno não fechou');
      // o 1º ponto fica verde enquanto desenha? (aqui já fechou; confere a cor do 'inicio' noutro passo)
      await pg.click('[data-sec=malha] [data-a=modo] button[data-v=mexer]');
      await clicar(10, -10);                           // dentro da face
      s = await estado();
      if (s.facesSel.length !== 1) throw new Error('não escolheu a face: ' + JSON.stringify(s.facesSel));
      await pg.fill('[data-sec=malha] [data-a=puxarMm]', '12');
      await pg.click('[data-sec=malha] [data-a=puxar]');
      s = await estado();
      const m = fechada(await malhaDe(s.editId), 'bloco');
      if (Math.abs(volume(m) - 40 * 40 * 12) > 1e-3) throw new Error('volume ' + volume(m) + ' (esperado ' + 40 * 40 * 12 + ')');
      let ymin = Infinity, ymax = -Infinity; for (let i = 1; i < m.pos.length; i += 3) { ymin = Math.min(ymin, m.pos[i]); ymax = Math.max(ymax, m.pos[i]); }
      if (Math.abs(ymax - F.prof) > 0.01 || Math.abs(ymin - (F.prof - 12)) > 0.01) throw new Error('não puxou pra frente: Y ' + ymin.toFixed(2) + '..' + ymax.toFixed(2) + ' (foto em ' + F.prof + ')');
      const st = await pg.textContent('[data-sec=malha] [data-a=status]');
      if (!/sólido fechado/.test(st)) throw new Error('status: ' + st);
    });

    await passo(pg, 'DICA VISUAL: desenhando, o 1º ponto da linha fica VERDE (é nele que fecha) e o atual LARANJA', async () => {
      await sair();
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=novoPontos]');
      F = await foto0();
      for (const [x, z] of [[0, 20], [15, 20], [15, 35]]) await clicar(x, z);
      const cores = await pg.evaluate(() => { const g = window.Estudio3D.estudio.visor.raizAjuda.children.find(x => x.userData.tipo === 'gaiola'); const p = g.children.find(x => x.isPoints); return Array.from(p.geometry.getAttribute('color').array); });
      // ordem das instâncias: ponto 0 (no meio: só 1), ponto 1 (+ fantasma), ponto 2 (+ fantasma)
      const cor = k => cores.slice(k * 3, k * 3 + 3).map(v => Math.round(v * 100) / 100).join(',');
      if (cor(0) !== '0.13,0.62,0.27') throw new Error('1º ponto não está verde: ' + cor(0));
      if (cor(3) !== '0.9,0.3,0') throw new Error('ponto atual não está laranja: ' + cor(3));
      await pg.keyboard.press('Escape');
      await sair();
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=descartar]');
    });

    await passo(pg, 'CUBO + PUXAR FACE + SUAVIZAR: cubo pronto, a face de cima puxada 10 mm (volume certo), suavizado fechado e sem cruzar', async () => {
      await sair();
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=novoCubo]');
      let s = await estado();
      const g = s.gaiola, tam = Math.max(10, Math.round(F.largura / 4));
      if (!s.editId || g.f.length !== 5 || s.modo !== 'mexer') throw new Error('cubo: ' + JSON.stringify({ id: s.editId, f: g.f.length, modo: s.modo }));
      let m = fechada(await malhaDe(s.editId), 'cubo');
      if (Math.abs(volume(m) - tam ** 3) > 1e-6) throw new Error('volume do cubo ' + volume(m) + ' ≠ ' + tam ** 3);
      // de cima: clicar dentro da face de cima (metade de verdade)
      const zTopo = Math.max(...g.v.map(p => p[2]));
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('topo'); e.enquadrar(); });
      await pg.waitForTimeout(200);
      const pt = await pg.evaluate(([x, y, z]) => window.Estudio3D.estudio.visor.telaDe(x, y, z), [F.cx + tam / 4, F.prof + tam / 4, zTopo]);
      await pg.mouse.click(pt.x, pt.y);
      s = await estado();
      if (s.facesSel.length !== 1 || !s.facesSel.every(fi => s.gaiola.f[fi].every(k => Math.abs(s.gaiola.v[k][2] - zTopo) < 1e-6))) throw new Error('não escolheu a face de cima: ' + JSON.stringify(s.facesSel));
      await pg.fill('[data-sec=malha] [data-a=puxarMm]', '10');
      await pg.click('[data-sec=malha] [data-a=puxar]');
      s = await estado();
      m = fechada(await malhaDe(s.editId), 'cubo puxado');
      if (Math.abs(volume(m) - tam * tam * (tam + 10)) > 1e-6) throw new Error('volume depois de puxar ' + volume(m) + ' ≠ ' + tam * tam * (tam + 10));
      await pg.selectOption('[data-sec=malha] [data-a=suave]', '1');
      s = await estado();
      if (s.gaiola.suave !== 1) throw new Error('suavizar não ligou');
      const ms = fechada(await malhaDe(s.editId), 'cubo suavizado');
      if (!(volume(ms) < volume(m) && volume(ms) > volume(m) * 0.5)) throw new Error('volume suavizado ' + volume(ms));
      const st = await pg.textContent('[data-sec=malha] [data-a=status]');
      if (!/pronto pra imprimir/.test(st)) throw new Error('status: ' + st);
    });

    await passo(pg, 'EXPORTAR e REABRIR: as 3 peças modeladas saem no 3MF fechadas e imprimíveis', async () => {
      await sair();
      const op = await pg.evaluate(() => [...window.Estudio3D.estudio.visor.itens.values()].map(x => x.mesh.material.opacity));
      if (op.some(o => o < 1)) throw new Error('o raio-X ficou ligado depois do Pronto');
      const sobra = await pg.evaluate(() => window.Estudio3D.estudio.visor.raizAjuda.children.filter(x => x.userData.tipo === 'gaiola').length);
      if (sobra) throw new Error('os pontos continuaram na tela');
      await abrirSecao(pg, 'exp');
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
      const arq = path.join(tmp, 'modelar.3mf'); await dl.saveAs(arq);
      const { importarArquivo } = await import('../../src/estudio3d/core/importar.js');
      const r = importarArquivo('x.3mf', new Uint8Array(fs.readFileSync(arq)));
      if (r.objetos.length !== 3) throw new Error(r.objetos.length + ' objetos no 3MF');
      for (const o of r.objetos) for (const p of o.partes) { const v = validar(p.malha); if (!v.imprimivel) throw new Error(o.nome + ' não imprimível: ' + JSON.stringify({ abertas: v.arestasAbertas, nm: v.arestasNaoManifold })); }
    });

    await passo(pg, 'EDITAR DE NOVO: "Editar a malha" volta pros pontos; peça mudada por outra ferramenta pergunta antes', async () => {
      const id = await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); return o.id; });
      await abrirSecao(pg, 'malha');
      await pg.waitForSelector('[data-sec=malha] [data-a=editarBloco]', { state: 'visible', timeout: 5000 });
      await pg.click('[data-sec=malha] [data-a=editar]');
      let s = await estado();
      if (!s.ativo || s.editId !== id) throw new Error('não entrou na edição');
      await sair();
      // outra ferramenta mexe na malha (simula um Consertar)
      await pg.evaluate(i => { const e = window.Estudio3D.estudio, o = e.cena.objeto(i); e.cena.aplicar('Consertar', () => { o.partes = [{ ...o.partes[0], malha: { pos: o.partes[0].malha.pos.slice(), idx: o.partes[0].malha.idx.slice() } }]; }); e.cena.selecionar(i, o.partes[0].id); }, id);
      pg.ultimoDialogo = null;
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=editar]');
      if (!/mudada por outra ferramenta/.test(pg.ultimoDialogo || '')) throw new Error('não perguntou: ' + pg.ultimoDialogo);
      s = await estado();
      if (!s.ativo) throw new Error('aceitou e não entrou na edição');
      await sair();
    });

    await passo(pg, 'CRUZOU SEM QUERER: contorno em "8" mostra o aviso "a peça se cruza"; arrastar o ponto conserta e fica pronta', async () => {
      await sair();
      await abrirSecao(pg, 'malha');
      await pg.click('[data-sec=malha] [data-a=espelho0] button[data-v=""]');
      await pg.click('[data-sec=malha] [data-a=novoPontos]');
      F = await foto0();
      for (const [x, z] of [[-20, 0], [20, 20], [20, 0], [-20, 20]]) await clicar(x, z);
      await clicar(-20, 0);
      let st = await pg.textContent('[data-sec=malha] [data-a=status]');
      if (!/a peça se cruza/.test(st)) throw new Error('não avisou do cruzamento: ' + st);
      await pg.click('[data-sec=malha] [data-a=modo] button[data-v=mexer]');
      const a = await tela(20, 0), bb = await tela(20, 40);
      await pg.mouse.move(a.x, a.y); await pg.mouse.down();
      for (let k = 1; k <= 8; k++) await pg.mouse.move(a.x, a.y + (bb.y - a.y) * k / 8);
      await pg.mouse.up(); await pg.waitForTimeout(150);
      st = await pg.textContent('[data-sec=malha] [data-a=status]');
      if (/se cruza/.test(st) || !/pronta pra imprimir/.test(st)) throw new Error('depois de arrastar: ' + st);
      const s = await estado();
      fechada(await malhaDe(s.editId), 'consertada');
      await sair();
    });
  } finally {
    await pg.context().close();
  }
}

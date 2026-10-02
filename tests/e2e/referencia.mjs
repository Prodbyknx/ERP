// E2E da FOTO DE REFERÊNCIA (modelar por cima de uma foto, como no Blender):
//  - adicionar pelo botão: a foto aparece de frente, com opacidade, e o cartão
//    "Arraste seu modelo" sai da frente;
//  - medir na foto (2 cliques + medida real) deixa a foto em escala real;
//  - arrastar a foto muda ela de lugar;
//  - Desenhar "em pé (frente)" desenha EM CIMA da foto (mesmo plano);
//  - a foto não vai pro 3MF (nem pra miniatura);
//  - arrastar imagem pro 3D e colar (Ctrl+V) também adicionam; esconder e tirar;
//  - arquivo que não é imagem de verdade: aviso, nada quebra.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoReferencia({ b, tmp, novaPagina, passo, abrirEstudio, abrirSecao, teste }) {
  console.log('FOTO DE REFERÊNCIA) pôr a foto, medir, mover, desenhar por cima, não exportar');
  const { escreverPNG } = await import('../../mcp/imagem.mjs');
  // 200×100 px, fundo branco, barra preta de 100 px (x 50..150) no meio
  const W = 200, H = 100, px = new Uint8Array(W * H * 4).fill(255);
  for (let y = 40; y < 60; y++) for (let x = 50; x < 150; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  const foto = path.join(tmp, 'ref-barra.png');
  fs.writeFileSync(foto, escreverPNG(px, W, H));
  const ruim = path.join(tmp, 'ref-ruim.png');
  fs.writeFileSync(ruim, new Uint8Array(3000).map((_, i) => (i * 31) % 256));

  const pg = await novaPagina(b);
  const R = () => pg.evaluate(() => { const r = window.Estudio3D.estudio.secoes.referencia.atual(); return r && { plano: r.plano, cx: r.cx, cy: r.cy, prof: r.prof, largura: r.largura, aspecto: r.aspecto, opacidade: r.opacidade, porCima: r.porCima, visivel: r.visivel }; });
  // ponto da foto (coordenadas no plano, em mm) -> pixel da tela
  const tela = (a, bb) => pg.evaluate(([a, bb]) => {
    const e = window.Estudio3D.estudio, r = e.secoes.referencia.atual();
    const w = r.plano === 'frente' ? [a, r.prof, bb] : r.plano === 'lado' ? [r.prof, a, bb] : [a, bb, 0.03];
    return e.visor.telaDe(w[0], w[1], w[2]);
  }, [a, bb]);
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');

    await passo(pg, 'FOTO: "Adicionar foto" põe a foto de frente, 50% de opacidade, enquadrada; o cartão vazio sai', async () => {
      await abrirSecao(pg, 'ref');
      await pg.setInputFiles('[data-sec=ref] input[type=file]', foto);
      await pg.waitForFunction(() => window.Estudio3D.estudio.visor.refMeshes.size === 1, null, { timeout: 15000 });
      const r = await R();
      if (r.plano !== 'frente' || Math.abs(r.largura - 100) > 1e-6 || Math.abs(r.aspecto - 0.5) > 1e-6 || r.opacidade !== 0.5) throw new Error(JSON.stringify(r));
      // de pé na mesa: a parte de baixo em Z = 0
      if (Math.abs(r.cy - 25) > 1e-6) throw new Error('não está em pé na mesa: centro Z ' + r.cy);
      const vazio = await pg.evaluate(() => getComputedStyle(document.querySelector('.e3d-vazio')).display);
      if (vazio !== 'none') throw new Error('o cartão "Arraste seu modelo" continua na frente da foto');
      const m = await pg.evaluate(() => { const m = [...window.Estudio3D.estudio.visor.refMeshes.values()][0]; return { op: m.material.opacity, vis: m.visible, rot: m.rotation.x }; });
      if (Math.abs(m.op - 0.5) > 1e-6 || !m.vis || Math.abs(m.rot - Math.PI / 2) > 1e-6) throw new Error('malha da foto: ' + JSON.stringify(m));
      // opacidade pelo controle
      await pg.evaluate(() => { const i = document.querySelector('[data-sec=ref] [data-a=opac]'); i.value = 30; i.dispatchEvent(new Event('input', { bubbles: true })); });
      const op = await pg.evaluate(() => [...window.Estudio3D.estudio.visor.refMeshes.values()][0].material.opacity);
      if (Math.abs(op - 0.3) > 1e-6) throw new Error('opacidade não mudou: ' + op);
    });

    await passo(pg, 'MEDIR: 2 cliques nas pontas da barra + "80 mm" -> a foto fica em escala real (a barra mede 80 mm)', async () => {
      const r0 = await R();
      // a barra vai de x=50 a 150 px na foto de 200 px -> -25 a +25 mm do centro
      await pg.click('[data-sec=ref] [data-a=medir]');
      const p1 = await tela(r0.cx - 25, r0.cy), p2 = await tela(r0.cx + 25, r0.cy);
      await pg.mouse.click(p1.x, p1.y); await pg.waitForTimeout(100);
      await pg.mouse.click(p2.x, p2.y); await pg.waitForTimeout(100);
      const hoje = await pg.inputValue('[data-sec=ref] [data-a=medHoje]');
      if (Math.abs(parseFloat(hoje.replace(',', '.')) - 50) > 0.6) throw new Error('medida na foto: ' + hoje + ' (esperado ~50)');
      await pg.fill('[data-sec=ref] [data-a=medReal]', '80');
      await pg.click('[data-sec=ref] [data-a=medAplicar]');
      const r = await R();
      const k = r.largura / 100;
      if (Math.abs(k - 80 / parseFloat(hoje.replace(',', '.'))) > 1e-6) throw new Error('escala: ' + k);
      if (Math.abs(r.largura - 160) > 2.5) throw new Error('largura depois de medir: ' + r.largura + ' (esperado ~160)');
      const painel = await pg.evaluate(() => getComputedStyle(document.querySelector('[data-sec=ref] [data-a=medPainel]')).display);
      if (painel !== 'none') throw new Error('o quadro da medida não fechou');
    });

    await passo(pg, 'ARRASTAR: segurar a foto e arrastar pra direita move a foto pra direita (e não gira a vista)', async () => {
      await pg.evaluate(() => window.Estudio3D.estudio.secoes.referencia.enquadrar(window.Estudio3D.estudio.secoes.referencia.atual()));
      await pg.waitForTimeout(300);
      const r0 = await R();
      const cam0 = await pg.evaluate(() => window.Estudio3D.estudio.visor.camera.position.toArray());
      const c = await tela(r0.cx, r0.cy), d = await tela(r0.cx + 20, r0.cy);
      await pg.mouse.move(c.x, c.y); await pg.mouse.down();
      for (let i = 1; i <= 8; i++) await pg.mouse.move(c.x + (d.x - c.x) * i / 8, c.y);
      await pg.mouse.up();
      const r = await R();
      if (Math.abs(r.cx - r0.cx - 20) > 1.5 || Math.abs(r.cy - r0.cy) > 1.5) throw new Error('moveu ' + (r.cx - r0.cx).toFixed(2) + ' × ' + (r.cy - r0.cy).toFixed(2) + ' (esperado 20 × 0)');
      const cam = await pg.evaluate(() => window.Estudio3D.estudio.visor.camera.position.toArray());
      if (cam.some((v, i) => Math.abs(v - cam0[i]) > 1e-6)) throw new Error('a vista girou junto');
      if (await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length)) throw new Error('arrastar a foto criou peça');
    });

    await passo(pg, 'DESENHAR POR CIMA: Desenhar em pé (frente) marca os pontos no plano da foto e a peça nasce ali', async () => {
      const r = await R();
      await abrirSecao(pg, 'des');
      await pg.click('[data-sec=des] [data-a=onde] button[data-v=frente]');
      const h = r.largura * r.aspecto, cs = [[-30, -h / 4], [30, -h / 4], [30, h / 4], [-30, h / 4]];
      for (const [a, bb] of cs) { const p = await tela(r.cx + a, r.cy + bb); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(60); }
      const p0 = await tela(r.cx + cs[0][0], r.cy + cs[0][1]); await pg.mouse.click(p0.x, p0.y);
      await pg.fill('[data-sec=des] [data-a=esp]', '3');
      await pg.click('[data-sec=des] [data-a=criar]');
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
      const c = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[0]); });
      if (!(c.min[1] <= r.prof + 0.01 && c.max[1] >= r.prof - 0.01)) throw new Error('a peça não está no plano da foto: Y ' + c.min[1].toFixed(2) + '..' + c.max[1].toFixed(2) + ', foto em ' + r.prof.toFixed(2));
      if (Math.abs(c.tam[0] - 60) > 1.1) throw new Error('largura da peça ' + c.tam[0] + ' (esperado 60)');
    });

    await passo(pg, 'EXPORTAR: o 3MF tem só a peça (a foto não vai), e a foto continua na tela', async () => {
      await abrirSecao(pg, 'exp');
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
      const arq = path.join(tmp, 'ref-export.3mf'); await dl.saveAs(arq);
      const { importarArquivo } = await import('../../src/estudio3d/core/importar.js');
      const r = importarArquivo('x.3mf', new Uint8Array(fs.readFileSync(arq)));
      if (r.objetos.length !== 1) throw new Error(r.objetos.length + ' objetos no 3MF');
      const vis = await pg.evaluate(() => window.Estudio3D.estudio.visor.raizRef.visible);
      if (!vis) throw new Error('a foto sumiu da tela depois de exportar');
    });

    await passo(pg, 'ARRASTAR ARQUIVO e COLAR (Ctrl+V): imagem vira foto de referência; esconder e tirar funcionam', async () => {
      await abrirSecao(pg, 'ref');
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
        return e.secoes.referencia.lista().map(r => r.nome + ':' + r.aspecto);
      });
      if (n.length !== 3 || !/lado\.png:2/.test(n[1]) || !/colada\.png:2/.test(n[2])) throw new Error('fotos: ' + n.join(' | '));
      // esconder a 1ª pela lista e tirar a última
      await pg.click('[data-sec=ref] [data-ref=ref1] [data-b=ver]');
      const vis = await pg.evaluate(() => window.Estudio3D.estudio.visor.refMeshes.get('ref1').visible);
      if (vis) throw new Error('esconder não escondeu');
      await pg.click('[data-sec=ref] [data-ref=ref3] [data-b=tirar]');
      const k = await pg.evaluate(() => [window.Estudio3D.estudio.secoes.referencia.lista().length, window.Estudio3D.estudio.visor.refMeshes.size]);
      if (k[0] !== 2 || k[1] !== 2) throw new Error('tirar: ' + k);
      // por cima das peças
      await pg.click('[data-sec=ref] [data-ref=ref2] .e3d-obj-cab');
      await pg.check('[data-sec=ref] [data-a=porCima]');
      const dt = await pg.evaluate(() => window.Estudio3D.estudio.visor.refMeshes.get('ref2').material.depthTest);
      if (dt) throw new Error('"por cima das peças" não ligou');
    });

    await passo(pg, 'ARQUIVO RUIM: ".png" que não é imagem dá aviso e não quebra nada', async () => {
      const antes = await pg.evaluate(() => window.Estudio3D.estudio.secoes.referencia.lista().length);
      await pg.setInputFiles('[data-sec=ref] input[type=file]', ruim);
      await pg.waitForTimeout(800);
      const depois = await pg.evaluate(() => window.Estudio3D.estudio.secoes.referencia.lista().length);
      if (depois !== antes) throw new Error('adicionou uma foto que não existe');
      const toast = await pg.evaluate(() => document.getElementById('toast')?.textContent || '');
      if (!/Não consegui abrir essa imagem/.test(toast)) throw new Error('sem aviso: ' + toast.slice(0, 200));
    });
  } finally {
    await pg.context().close();
  }
}

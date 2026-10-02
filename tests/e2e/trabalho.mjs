// E2E de "não perder trabalho" e "não travar" (auditoria A8, M5):
//  - peça mexida e não exportada: o navegador pergunta antes de fechar/recarregar;
//    só abrir o arquivo não conta; depois de exportar a mesa, não pergunta;
//  - "Baixar o 3MF do Estúdio" (o botão que aparece quando a sessão do ERP acaba);
//  - com o modo Defeitos/Espessura ligado, mover a peça não refaz o mapa de cor.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoTrabalho({ b, tmp, novaPagina, passo, abrirEstudio, abrirSecao, teste }) {
  console.log('TRABALHO) não perder o que foi feito no Estúdio e não travar ao mover');
  const { esfera } = await import('../util/malhas.mjs');
  const { escreverSTL } = await import('../../src/estudio3d/core/formatos/stl.js');
  const bola = path.join(tmp, 'trabalho-bola.stl');
  fs.writeFileSync(bola, escreverSTL(esfera(20, 6, 0, 0, 20), 'bola'));
  const pg = await novaPagina(b);
  const esperarMotor = () => pg.waitForFunction(() => { const m = window.Estudio3D.estudio.motor; return !m.principal.ocupado && !m.aux.ocupado; }, null, { timeout: 120000, polling: 100 });
  const perguntaAoSair = () => pg.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');
    await passo(pg, 'TRABALHO: só abrir não pergunta; mexer pergunta antes de sair; exportar a mesa tira a pergunta', async () => {
      await pg.setInputFiles('.e3d input[type=file][multiple]', bola);
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
      await esperarMotor();
      if (await perguntaAoSair()) throw new Error('perguntou só por ter aberto o arquivo');
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.aplicar('Mover', () => { o.transform[12] += 10; }); });
      if (!(await perguntaAoSair())) throw new Error('mexeu e não perguntou antes de sair');
      await abrirSecao(pg, 'exp');
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
      await dl.path();
      if (await perguntaAoSair()) throw new Error('exportou a mesa e ainda pergunta');
    });
    await passo(pg, 'TRABALHO: "Baixar o 3MF do Estúdio" (sessão encerrada) baixa a mesa inteira e reabre igual', async () => {
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.aplicar('Mover', () => { o.transform[12] += 5; }); });
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.evaluate(() => window.Estudio3D.estudio.baixarTudo3MF())]);
      const arq = path.join(tmp, 'trabalho-tudo.3mf');
      await dl.saveAs(arq);
      if (!/\.3mf$/.test(dl.suggestedFilename())) throw new Error('nome: ' + dl.suggestedFilename());
      if (await perguntaAoSair()) throw new Error('baixou e ainda pergunta');
      const { importarArquivo } = await import('../../src/estudio3d/core/importar.js');
      const r = importarArquivo('x.3mf', new Uint8Array(fs.readFileSync(arq)));
      if (r.objetos.length !== 1 || r.triangulos !== 81920) throw new Error('3MF baixado: ' + r.objetos.length + ' objeto(s), ' + r.triangulos + ' tri');
    });
    await passo(pg, 'TRAVA: modo "Defeitos" ligado — mover a peça não recalcula o mapa de cor (antes refazia tudo a cada mudança)', async () => {
      await pg.evaluate(() => window.Estudio3D.estudio.definirModoVisual('problemas'));
      await pg.waitForTimeout(300);
      const n = await pg.evaluate(() => {
        const e = window.Estudio3D.estudio, o = e.cena.objetos[0];
        let chamadas = 0; const orig = e.emitirMapa.bind(e);
        e.emitirMapa = (m, p) => { chamadas++; return orig(m, p); };
        for (let i = 0; i < 5; i++) e.cena.aplicar('Mover', () => { o.transform[12] += 1; });
        e.emitirMapa = orig;
        return chamadas;
      });
      if (n !== 0) throw new Error(n + ' recálculo(s) do mapa só por mover');
      // e muda quando a malha muda (Desfazer volta pra outra malha? não: transformar a malha)
      const m = await pg.evaluate(() => {
        const e = window.Estudio3D.estudio, p = e.cena.objetos[0].partes[0];
        let chamadas = 0; const orig = e.emitirMapa.bind(e);
        e.emitirMapa = (mm, pp) => { chamadas++; return orig(mm, pp); };
        e.cena.aplicar('Trocar malha', () => { p.malha = { pos: p.malha.pos.slice(), idx: p.malha.idx.slice() }; });
        e.emitirMapa = orig;
        return chamadas;
      });
      if (m !== 1) throw new Error('malha nova devia refazer o mapa 1 vez, refez ' + m);
      await pg.evaluate(() => window.Estudio3D.estudio.definirModoVisual('cores'));
    });
  } finally {
    await pg.context().close();
  }
}

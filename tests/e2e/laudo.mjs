// E2E do laudo (auditoria A5, M1, M3):
//  - aviso de quando o arquivo é aberto fica escrito no Consertar (antes:
//    aviso rápido coberto pelo seguinte em 0 s, e só o 1º aparecia);
//  - peças encostadas por uma aresta: laudo diz "Pontos onde partes se
//    encostam (normal)", sem atenção, e o Consertar diz "Nada pra consertar";
//  - a bolinha "Pronto pra imprimir" e o laudo seguem a mesma regra.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoLaudo({ b, tmp, novaPagina, passo, abrirEstudio, abrirSecao, teste }) {
  console.log('LAUDO) avisos do arquivo, peças encostadas e uma regra só de "pronto pra imprimir"');
  const { caixaMalha } = await import('../util/malhas.mjs');
  const { juntar } = await import('../../src/estudio3d/core/malha.js');
  const { escreverSTL } = await import('../../src/estudio3d/core/formatos/stl.js');
  const { escreverZip } = await import('../../src/estudio3d/core/formatos/zip.js');
  const encostadas = path.join(tmp, 'laudo-encostadas.stl');
  fs.writeFileSync(encostadas, escreverSTL(juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 30, 0, 0)]), 'x'));
  // 3MF com 2 avisos: unidade desconhecida + índice de vértice inválido
  const modelo = '<model unit="furlong"><resources><object id="1"><mesh><vertices>' +
    '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles>' +
    '<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="1" v3="99"/>' +
    '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
  const avisos3mf = path.join(tmp, 'laudo-avisos.3mf');
  fs.writeFileSync(avisos3mf, escreverZip([{ nome: '[Content_Types].xml', dados: '<x/>' }, { nome: '3D/3dmodel.model', dados: modelo }]));
  // duas caixas encostadas por UMA ARESTA (mesma linha de vértices)
  const aresta = path.join(tmp, 'laudo-aresta.stl');
  fs.writeFileSync(aresta, escreverSTL(juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 10, 10, 0)]), 'x'));

  const pg = await novaPagina(b);
  const esperarMotor = () => pg.waitForFunction(() => { const m = window.Estudio3D.estudio.motor; return !m.principal.ocupado && !m.aux.ocupado; }, null, { timeout: 120000, polling: 100 });
  const laudo = () => pg.evaluate(() => document.querySelector('[data-sec=diag] [data-a=resultado]').textContent);
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');
    await pg.evaluate(() => { window.__t = []; const t = document.getElementById('toast'); new MutationObserver(() => { if (t.className.includes('show')) window.__t.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true }); });
    void encostadas;

    await passo(pg, 'LAUDO: os avisos do arquivo ficam escritos no Consertar (todos), e o aviso rápido manda ver lá', async () => {
      await pg.setInputFiles('.e3d input[type=file][multiple]', avisos3mf);
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
      await esperarMotor(); await pg.waitForTimeout(400);
      const nota = await pg.evaluate(() => document.querySelector('[data-sec=diag] [data-a=avisosAbrir]')?.textContent || '');
      if (!/furlong/.test(nota) || !/índice/.test(nota)) throw new Error('nota com os avisos: ' + nota.slice(0, 200));
      const t = await pg.evaluate(() => window.__t.splice(0));
      if (!t.some(x => /2 aviso\(s\) do arquivo/.test(x))) throw new Error('aviso rápido: ' + t.join(' | '));
      if (!(await pg.evaluate(() => document.querySelector('[data-sec=diag]').open))) throw new Error('não abriu o Consertar');
    });

    await passo(pg, 'LAUDO: peças encostadas por aresta = "Pontos onde partes se encostam (normal)"; Consertar = "Nada pra consertar"', async () => {
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos = []; }); });
      await pg.setInputFiles('.e3d input[type=file][multiple]', aresta);
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
      await esperarMotor(); await pg.waitForTimeout(400);
      await abrirSecao(pg, 'diag');
      await pg.click('[data-sec=diag] [data-a=reparar]');           // 1º conserto: separa o ponto non-manifold que o STL juntou
      await esperarMotor(); await pg.waitForTimeout(400);
      await pg.evaluate(() => window.__t.splice(0));
      await pg.click('[data-sec=diag] [data-a=reparar]');           // 2º: não tem mais nada
      await esperarMotor(); await pg.waitForTimeout(400);
      const t = await pg.evaluate(() => window.__t.splice(0));
      if (!t.some(x => /Nada pra consertar/.test(x))) throw new Error('2º conserto: ' + t.join(' | '));
      const txt = await laudo();
      if (!/Pronto pra fatiar/.test(txt)) throw new Error('laudo: ' + txt.slice(0, 300));
      if (!/Vértices duplicados \(costura aberta\)\s*0/.test(txt)) throw new Error('vértices duplicados: ' + txt.slice(0, 300));
      if (!/Pontos onde partes se encostam \(normal\)\s*\d/.test(txt)) throw new Error('sem a linha dos pontos encostados');
      const hist = await pg.evaluate(() => window.Estudio3D.estudio.cena.pilhaDesfazer.filter(u => u.rotulo === 'Reparar malha').length);
      if (hist > 1) throw new Error(hist + ' consertos no histórico (o 2º não podia criar)');
      const saude = await pg.evaluate(() => document.querySelector('.e3d-saude').textContent);
      if (!/Pronto pra imprimir/.test(saude)) throw new Error('bolinha diferente do laudo: ' + saude);
    });
  } finally {
    await pg.context().close();
  }
}

// E2E de XSS pelo ARQUIVO 3D: modelo baixado da internet com código no nome
// do objeto, da peça e do material. Abrir, conferir, consertar, selecionar,
// separar e exportar não podem executar nada — o nome aparece como texto.
// (Antes da correção, só ABRIR o 3MF já executava: 'Nada selecionado em <b>' + nome.)
import fs from 'node:fs';
import path from 'node:path';

const P = k => 'ZZ"\'><img src=x onerror="(top.__xss=top.__xss||[]).push(\'' + k + '\')"><svg onload="(top.__xss=top.__xss||[]).push(\'' + k + '-svg\')">';

async function gerarArquivos(dir) {
  const { caixaMalha } = await import('../util/malhas.mjs');
  const { juntar } = await import('../../src/estudio3d/core/malha.js');
  const { escrever3MF } = await import('../../src/estudio3d/core/formatos/tmf.js');
  const M4 = await import('../../src/estudio3d/core/mat4.js');
  // peça 1: dois cubos encostados por uma aresta (o Consertar sempre tem o que dizer)
  const pecaSuja = juntar([caixaMalha(10, 10, 10), caixaMalha(10, 10, 10, 10, 10, 0)]);
  const arq3mf = path.join(dir, 'xss.3mf');
  fs.writeFileSync(arq3mf, escrever3MF({ objetos: [{ nome: 'Obj' + P('obj'), transform: M4.translacao(100, 100, 0), partes: [
    { nome: 'Peca' + P('peca'), malha: pecaSuja, cor: '#336699' },
    { nome: 'Outra' + P('outra'), malha: caixaMalha(20, 20, 20, 30, 0, 0), cor: '#cc3333' }
  ] }] }).bytes);
  // OBJ: nome do objeto e do material com código
  const c = caixaMalha(10, 10, 10);
  let obj = 'mtllib lib' + P('mtllib') + '.mtl\no Corpo' + P('objnome') + '\nusemtl Mat' + P('mat') + '\n';
  for (let v = 0; v < c.pos.length; v += 3) obj += 'v ' + c.pos[v] + ' ' + c.pos[v + 1] + ' ' + c.pos[v + 2] + '\n';
  for (let t = 0; t < c.idx.length; t += 3) obj += 'f ' + (c.idx[t] + 1) + ' ' + (c.idx[t + 1] + 1) + ' ' + (c.idx[t + 2] + 1) + '\n';
  const arqObj = path.join(dir, 'xss.obj');
  fs.writeFileSync(arqObj, obj);
  return { arq3mf, arqObj };
}

export async function secaoXSS3D({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao }) {
  console.log('XSS 3D) código no nome do objeto/peça/material de um arquivo 3D não pode rodar');
  const { arq3mf, arqObj } = await gerarArquivos(tmp);
  const pg = await novaPagina(b);
  pg.on('dialog', d => d.dismiss().catch(() => {}));
  const xss = () => pg.evaluate(() => window.__xss || []);
  const esperarMotor = () => pg.waitForFunction(() => { const m = window.Estudio3D.estudio.motor; return !m.principal.ocupado && !m.aux.ocupado; }, null, { timeout: 120000, polling: 200 });
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');
    await passo(pg, 'XSS 3D: abrir 3MF com código no nome não executa; o nome aparece como texto', async () => {
      await pg.setInputFiles('.e3d input[type=file][multiple]', arq3mf);
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
      await esperarMotor();
      // escolher cada peça (o painel Selecionar escreve "Nada selecionado em <nome>")
      for (let i = 0; i < 2; i++) { await pg.evaluate(i => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[i].id); }, i); await pg.waitForTimeout(200); }
      await pg.waitForTimeout(300);
      const x = await xss();
      if (x.length) throw new Error('executou ao abrir/escolher: ' + x.join(', '));
      const lista = await pg.evaluate(() => document.querySelector('.e3d-objetos').textContent);
      if (!lista.includes('<img src=x')) throw new Error('o nome não aparece como texto na lista: ' + lista.slice(0, 120));
    });
    await passo(pg, 'XSS 3D: exportar 3MF (aviso com o nome da peça) não executa', async () => {
      // triângulo degenerado (como sai de uma operação): a gravação avisa com o nome da peça
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, p = e.cena.objetos[0].partes[0]; e.cena.aplicar('degenerado', () => { p.malha = { pos: p.malha.pos, idx: Uint32Array.from([...p.malha.idx, 0, 0, 1]) }; }); });
      await abrirSecao(pg, 'exp');
      const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
      await dl.path();
      await pg.waitForTimeout(300);
      const res = await pg.evaluate(() => document.querySelector('[data-sec=exp] [data-a=res]').textContent);
      if (!/degenerado/.test(res) || !res.includes('<img src=x')) throw new Error('aviso da gravação não saiu como texto: ' + res.slice(0, 200));
      const x = await xss(); if (x.length) throw new Error('executou: ' + x.join(', '));
    });
    await passo(pg, 'XSS 3D: Consertar (laudo com o nome da peça) não executa', async () => {
      await pg.evaluate(() => { const e = window.Estudio3D.estudio; const o = e.cena.objetos[0]; e.cena.selecionar(o.id, null); });
      await abrirSecao(pg, 'diag');
      await pg.click('[data-sec=diag] [data-a=reparar]');
      await pg.waitForTimeout(300); await esperarMotor();
      await pg.waitForFunction(() => /Reparo:/.test(document.querySelector('[data-sec=diag] [data-a=resultado]').textContent), null, { timeout: 60000 });
      const txt = await pg.evaluate(() => document.querySelector('[data-sec=diag] [data-a=resultado]').textContent);
      if (!txt.includes('<img src=x')) throw new Error('nome não aparece como texto no "Reparo:"');
      const x = await xss(); if (x.length) throw new Error('executou: ' + x.join(', '));
    });
    await passo(pg, 'XSS 3D: selecionar faces e Separar com nome malicioso digitado não executa', async () => {
      // seleciona o topo do cubo "Outra" (2 triângulos com z = 20)
      await pg.evaluate(() => {
        const e = window.Estudio3D.estudio, o = e.cena.objetos[0], p = o.partes.find(x => x.nome.startsWith('Outra'));
        e.cena.selecionar(o.id, p.id);
        const nt = p.malha.idx.length / 3, m = new Uint8Array(nt);
        for (let t = 0; t < nt; t++) { let z = 0; for (let k = 0; k < 3; k++) z += p.malha.pos[p.malha.idx[t * 3 + k] * 3 + 2]; if (z / 3 > 19.9) m[t] = 1; }
        e.visor.definirSelecao(p.id, m); e.emitir('faces', { parte: p, n: m.reduce((a, v) => a + v, 0) });
      });
      await abrirSecao(pg, 'sep');
      const st = await pg.evaluate(() => document.querySelector('[data-sec=sep] [data-a=status]').textContent);
      if (!st.includes('<img src=x')) throw new Error('status do Separar sem o nome como texto: ' + st.slice(0, 120));
      await pg.fill('[data-sec=sep] [data-a="nome"]', 'Tampa' + P('digitado'));
      await pg.fill('[data-sec=sep] [data-a="esp"]', '1');
      await pg.click('[data-sec=sep] [data-a="ir"]');
      await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
      await pg.click('.e3d-previa button.primary');
      await pg.waitForTimeout(500);
      const res = await pg.evaluate(() => document.querySelector('[data-sec=sep] [data-a=res]').textContent);
      if (!res.includes('<img src=x')) throw new Error('resultado do Separar sem o nome como texto: ' + res.slice(0, 160));
      const x = await xss(); if (x.length) throw new Error('executou: ' + x.join(', '));
    });
    await passo(pg, 'XSS 3D: OBJ com código no nome do objeto e do material não executa', async () => {
      const n0 = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
      await pg.setInputFiles('.e3d input[type=file][multiple]', arqObj);
      await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos.length === n + 1, n0, { timeout: 60000 });
      await esperarMotor(); await pg.waitForTimeout(500);
      await abrirSecao(pg, 'sel');
      const x = await xss(); if (x.length) throw new Error('executou: ' + x.join(', '));
    });
  } finally {
    await pg.context().close();
  }
}

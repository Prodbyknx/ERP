// E2E da Parte 5 da auditoria (A9, B8, M4, M8, M9):
//  - "Copiar diagnóstico" (clique no estado do motor) traz as últimas operações,
//    com o erro e ONDE quebrou (antes: só a mensagem, sem pilha, só no console);
//  - o motor quebrando FORA de uma operação não deixa a tela "calculando" pra
//    sempre: a operação pendente falha com aviso e o motor volta;
//  - STL cortado (download incompleto) abre o que veio, com o aviso escrito;
//  - "Agrupar" da lista respeita a seleção; "Unir partes sobrepostas" saiu.
import fs from 'node:fs';
import path from 'node:path';

export async function secaoDiagnostico({ b, tmp, novaPagina, passo, abrirEstudio, abrirSecao, teste }) {
  console.log('DIAGNÓSTICO) registro de erros, motor que quebra, STL cortado, Agrupar');
  const { esfera, caixaMalha } = await import('../util/malhas.mjs');
  const { escreverSTL } = await import('../../src/estudio3d/core/formatos/stl.js');
  const lixo = path.join(tmp, 'diag-lixo.stl');
  const bytes = new Uint8Array(5000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919 + 13) % 256;
  fs.writeFileSync(lixo, bytes);
  const inteiro = escreverSTL(esfera(20, 5), 'bola');
  const n = new DataView(inteiro.buffer, inteiro.byteOffset).getUint32(80, true);
  const cortado = path.join(tmp, 'diag-cortado.stl');
  fs.writeFileSync(cortado, inteiro.slice(0, 84 + Math.floor(n / 3) * 50));
  const cubo = path.join(tmp, 'diag-cubo.stl');
  fs.writeFileSync(cubo, escreverSTL(caixaMalha(10, 10, 10), 'cubo'));
  const pg = await novaPagina(b);
  const esperarMotor = () => pg.waitForFunction(() => { const m = window.Estudio3D.estudio.motor; return !m.principal.ocupado && !m.aux.ocupado; }, null, { timeout: 120000, polling: 100 });
  try {
    await abrirEstudio(pg, 'file://' + teste + '/index.html');

    await passo(pg, 'DIAGNÓSTICO: erro do motor vai pro registro com a pilha; clique no motor copia o diagnóstico', async () => {
      await pg.setInputFiles('.e3d input[type=file][multiple]', lixo);
      await pg.waitForTimeout(1500); await esperarMotor();
      pg.erros.length = 0;                                       // o erro do arquivo de lixo é esperado (vai pro console)
      await pg.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copiado = t; return Promise.resolve(); } } }); });
      await pg.click('#ferr_estudio [data-b=motor]');
      await pg.waitForFunction(() => window.__copiado, null, { timeout: 5000 });
      const t = await pg.evaluate(() => window.__copiado);
      if (!/importar \[principal\].*ERRO: Não consegui ler esse STL/.test(t)) throw new Error('registro sem o erro: ' + t.slice(0, 400));
      if (!/\n    .*(stl|lerBinario|estudio3d\.js|Error)/i.test(t)) throw new Error('sem a pilha do erro: ' + t.slice(0, 600));
      if (!/navegador: /.test(t) || !/últimas operações/.test(t)) throw new Error('diagnóstico incompleto');
    });

    await passo(pg, 'MOTOR: quebra FORA de uma operação -> a pendente falha com aviso, nada fica "calculando", e o motor volta', async () => {
      await pg.setInputFiles('.e3d input[type=file][multiple]', cubo);
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
      await esperarMotor();
      const r = await pg.evaluate(async () => {
        const e = window.Estudio3D.estudio, p = e.cena.objetos[0].partes[0];
        const pendente = e.motor.rodar('reparar', { parte: e.parteParaMotor(p), opc: {} }).then(() => 'terminou', x => 'falhou: ' + x.message);
        // a operação entra na fila depois de alguns awaits; espera só por microtarefas
        // (a resposta do worker não chega no meio delas), então ela está pendente
        for (let i = 0; i < 1000 && !e.motor.principal.ocupado; i++) await Promise.resolve();
        if (!e.motor.principal.ocupado) return { res: 'a operação nem entrou na fila' };
        e.motor.principal.worker.onerror(new ErrorEvent('error', { message: 'teste de pane' }));
        const res = await pendente;
        await new Promise(r => setTimeout(r, 300));
        const ocupado = e.motor.principal.ocupado;
        const depois = await e.motor.rodar('medidas', { parte: e.parteParaMotor(p) }).then(x => x.volume, x => 'erro: ' + x.message);
        return { res, ocupado, depois, reg: e.motor.registro.slice(-3).map(x => x.op + ':' + (x.ok ? 'ok' : x.erro)).join(' | ') };
      });
      if (!/falhou: O motor 3D parou/.test(r.res)) throw new Error('pendente: ' + r.res);
      if (r.ocupado) throw new Error('continua "calculando"');
      if (Math.abs(r.depois - 1000) > 1e-6) throw new Error('motor não voltou: ' + r.depois);
      if (!/\(worker\):o motor parou/.test(r.reg)) throw new Error('registro: ' + r.reg);
    });

    await passo(pg, 'STL CORTADO: abre o que veio e o aviso fica escrito no Consertar', async () => {
      const n0 = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.length);
      await pg.setInputFiles('.e3d input[type=file][multiple]', cortado);
      await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n0, { timeout: 60000 });
      await esperarMotor(); await pg.waitForTimeout(300);
      const nota = await pg.evaluate(() => document.querySelector('[data-sec=diag] [data-a=avisosAbrir]')?.textContent || '');
      if (!/incompleto/.test(nota)) throw new Error('sem aviso de incompleto: ' + nota);
    });

    await passo(pg, 'AGRUPAR (lista) respeita a seleção; "Unir partes sobrepostas" não existe mais', async () => {
      await pg.setInputFiles('.e3d input[type=file][multiple]', cubo);
      await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 3, null, { timeout: 60000 });
      await esperarMotor();
      await pg.evaluate(() => { const e = window.Estudio3D.estudio, [a, , c] = e.cena.objetos; e.cena.selecionar(a.id, null); e.cena.selecionar(c.id, null, true); });
      await pg.evaluate(() => { const b = [...document.querySelectorAll('.e3d-objetos button')].find(x => x.textContent === 'Agrupar'); b.click(); });
      const partes = await pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.map(o => o.partes.length));
      if (JSON.stringify(partes.slice().sort()) !== JSON.stringify([1, 2])) throw new Error('agrupou errado: ' + JSON.stringify(partes));
      const tem = await pg.evaluate(() => [...document.querySelectorAll('button')].some(x => /Unir partes sobrepostas/.test(x.textContent)));
      if (tem) throw new Error('o botão "Unir partes sobrepostas" ainda existe');
    });
  } finally {
    await pg.context().close();
  }
}

// E2E do CORTE COM PINOS pela tela, num personagem de IA: Cortar →
// pino cilíndrico (automático, 2) → prévia → Confirmar. O corte passa pelas
// duas pernas E pelas duas mãos: cada pedaço tem que ganhar encaixe; as duas
// partes fechadas, sem cruzamento novo; montadas no lugar, pino e furo não se
// atravessam; 3MF ida e volta; Ctrl+Z volta a peça inteira. E peça de parede
// fina: sai sem encaixe e a prévia diz por quê (cole).
import fs from 'node:fs';
import path from 'node:path';
import { carregarManifold } from '../util/manifold.mjs';
import { gerarBoneco } from '../util/boneco.mjs';
import { escreverSTL } from '../../src/estudio3d/core/formatos/stl.js';
import { comContexto, manifold } from '../../src/estudio3d/core/solidos.js';
import { validar } from '../../src/estudio3d/core/validador.js';
import { volume, criar, transformar } from '../../src/estudio3d/core/malha.js';
import { componentes } from '../../src/estudio3d/core/topologia.js';
import { executar } from '../../src/estudio3d/motor/operacoes.js';
import { cortarPorPlano } from '../../src/estudio3d/core/corte.js';

export async function secaoPinos({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia }) {
  const W = await carregarManifold();
  const ia = gerarBoneco('ia').malha;
  const arq = path.join(tmp, 'boneco-ia-pinos.stl'); fs.writeFileSync(arq, Buffer.from(escreverSTL(ia, 'boneco')));
  const aiEntrada = validar(ia, { completo: true }).autoInterseccoes;
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const objetos = () => pg.evaluate(() => window.Estudio3D.estudio.cena.objetos.map(o => ({ nome: o.nome, t: Array.from(o.transform), partes: o.partes.map(p => ({ pos: Array.from(p.malha.pos), idx: Array.from(p.malha.idx) })) })));
  const noMundo = o => o.partes.map(p => transformar(criar(Float64Array.from(p.pos), Uint32Array.from(p.idx)), o.t));
  let notas = '';
  await passo(pg, 'boneco de IA: Cortar em Z na altura das mãos, pino cilíndrico automático (2), prévia diz quantos conectores', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', arq);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    await abrirSecao(pg, 'corte');
    await pg.selectOption('[data-sec=corte] [data-a="tipo"]', 'cilindrico');
    // altura das palmas das mãos (o boneco fica em pé na mesa)
    const z = await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return c.min[2] + 31; });
    await pg.fill('[data-sec=corte] [data-a="posmm"]', String(z).replace('.', ',')); await pg.press('[data-sec=corte] [data-a="posmm"]', 'Enter');
    await pg.click('[data-sec=corte] [data-a="ir"]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
    notas = await pg.textContent('.e3d-previa');
    const n = +((notas.match(/(\d+) conector/) || [])[1] || 0);
    if (n < 4) throw new Error('esperava encaixe nas 2 pernas e nas 2 mãos (>= 4), veio ' + n + ': ' + notas);
    await confirmarPrevia(pg);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length >= 2, null, { timeout: 20000 });
  });
  await passo(pg, 'partes A e B fechadas, sem cruzamento novo; montadas no lugar, pino não bate no furo; cada pedaço de baixo tem furo', async () => {
    const obs = await objetos();
    const A = obs.find(o => / A$/.test(o.nome)), B = obs.find(o => / B$/.test(o.nome));
    if (!A || !B) throw new Error('partes: ' + obs.map(o => o.nome).join(', '));
    const [mA] = noMundo(A), [mB] = noMundo(B);
    for (const [n, m] of [['A', mA], ['B', mB]]) {
      const v = validar(m, { completo: true });
      if (!v.fechada || v.componentesInvertidos) throw new Error(n + ' não fechada');
      if (v.autoInterseccoes > aiEntrada) throw new Error(n + ' cruzamento novo ' + v.autoInterseccoes);
    }
    const man = m => new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.pos), triVerts: Uint32Array.from(m.idx) }));
    const I = man(mA).intersect(man(mB));
    if (I.volume() > 0.05) throw new Error('pino bate no furo: ' + I.volume().toFixed(3) + ' mm³');
    // B = 2 pernas + 2 mãos: 4 pedaços, e CADA UM perdeu volume pro furo
    // (compara com o mesmo corte feito sem encaixe)
    const c = componentes(mB);
    if (c.n !== 4) throw new Error('B tem ' + c.n + ' pedaços');
    // altura do corte = topo da parte de baixo (os pinos de A descem abaixo dele)
    let zc = -Infinity; for (let i = 2; i < mB.pos.length; i += 3) zc = Math.max(zc, mB.pos[i]);
    const inteiro = transformar(criar(Float64Array.from(ia.pos), ia.idx), A.t);
    const base = cortarPorPlano([{ nome: 'x', malha: inteiro, cor: '#999' }], { n: [0, 0, 1], d: zc }, {});
    const pedacos = m => { const k = componentes(m); const out = []; for (let j = 0; j < k.n; j++) { const fs2 = []; for (let t = 0; t < k.rotulo.length; t++) if (k.rotulo[t] === j) fs2.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]); const sub = { pos: m.pos, idx: Uint32Array.from(fs2) }; let cx = 0, cy = 0; for (const v of fs2) { cx += m.pos[v * 3]; cy += m.pos[v * 3 + 1]; } out.push({ v: volume(sub), cx: cx / fs2.length, cy: cy / fs2.length }); } return out; };
    const antes = pedacos(base.B[0].malha), depois = pedacos(mB);
    for (const p of depois) {
      const q = antes.reduce((a2, x) => Math.hypot(x.cx - p.cx, x.cy - p.cy) < Math.hypot(a2.cx - p.cx, a2.cy - p.cy) ? x : a2);
      if (!(q.v - p.v > 1)) throw new Error('pedaço em (' + p.cx.toFixed(0) + ';' + p.cy.toFixed(0) + ') sem furo (volume ' + q.v.toFixed(1) + ' -> ' + p.v.toFixed(1) + ')');
    }
  });
  await passo(pg, '3MF das duas partes e abrir de novo: mesmo volume; Ctrl+Z volta o boneco inteiro', async () => {
    await abrirSecao(pg, 'exp');
    await pg.click('[data-sec=exp] [data-a=escopo] button[data-v=tudo]');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
    const f = path.join(tmp, 'pinos.3mf'); await dl.saveAs(f);
    const r = executar('importar', { nome: 'x.3mf', bytes: new Uint8Array(fs.readFileSync(f)), extras: {} });
    const obs = await objetos();
    const vTela = obs.flatMap(o => noMundo(o)).reduce((s, m) => s + volume(m), 0);
    const vArq = r.objetos.flatMap(o => o.partes.map(p => volume(transformar(p.malha, o.transform)))).reduce((s, x) => s + x, 0);
    if (Math.abs(vArq / vTela - 1) > 1e-3) throw new Error('3MF mudou o volume ' + vArq + ' x ' + vTela);
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 10000 });
  });
  await passo(pg, 'parede fina (casca de 1,5 mm): sai sem encaixe e a prévia explica (cole)', async () => {
    const casca = comContexto(ctx => { const M = manifold().Manifold; const e = ctx.guardar(M.cylinder(40, 20, 20, 96)), i = ctx.guardar(M.cylinder(41, 18.5, 18.5, 96).translate([0, 0, 1.5])); return ctx.parte(ctx.guardar(e.subtract(i)), 'copo', '#999').malha; });
    const f = path.join(tmp, 'copo.stl'); fs.writeFileSync(f, Buffer.from(escreverSTL(casca, 'copo')));
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos.length = 0; }); });
    await pg.setInputFiles('.e3d input[type=file][multiple]', f);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    await abrirSecao(pg, 'corte');
    await pg.selectOption('[data-sec=corte] [data-a="tipo"]', 'cilindrico');
    await pg.click('[data-sec=corte] [data-a=meio]');
    await pg.click('[data-sec=corte] [data-a="ir"]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
    const t = await pg.textContent('.e3d-previa');
    if (!/não cabe pino|cole/.test(t)) throw new Error('prévia não explica: ' + t);
    await pg.click('.e3d-previa button:not(.primary)');
  });
  await pg.context().close();
}

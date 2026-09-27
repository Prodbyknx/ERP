// E2E da SUAVIZAÇÃO pela tela, como o usuário faz: abre um boneco de IA com
// pele ondulada (STL), Esculpir → Suavizar Forte → prévia com relatório →
// Aplicar; confere que ficou mais perto do limpo, sem encolher, fechado;
// Ctrl+Z volta idêntico; 3MF ida e volta; só a seleção (o resto não mexe);
// peça facetada ganha "Arredondar as facetas"; a caixa de cálculo mostra a
// etapa e o %; Cancelar não mexe na peça e o motor continua funcionando.
import fs from 'node:fs';
import path from 'node:path';
import { carregarManifold } from '../util/manifold.mjs';
import { gerarBoneco } from '../util/boneco.mjs';
import { escreverSTL } from '../../src/estudio3d/core/formatos/stl.js';
import { comContexto, manifold } from '../../src/estudio3d/core/solidos.js';
import { validar } from '../../src/estudio3d/core/validador.js';
import { volume, criar } from '../../src/estudio3d/core/malha.js';
import { construirBVH, pontoMaisPerto } from '../../src/estudio3d/core/bvh.js';
import { executar } from '../../src/estudio3d/motor/operacoes.js';

export async function secaoSuavizar({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia }) {
  await carregarManifold();
  const limpo = gerarBoneco('limpo').malha, ia = gerarBoneco('ia').malha;
  const arqIA = path.join(tmp, 'boneco-ia.stl'); fs.writeFileSync(arqIA, Buffer.from(escreverSTL(ia, 'boneco')));
  const baixa = comContexto(ctx => ctx.parte(ctx.guardar(manifold().Manifold.sphere(20, 12)), 'x', '#999').malha);
  const arqBaixa = path.join(tmp, 'bola-facetada.stl'); fs.writeFileSync(arqBaixa, Buffer.from(escreverSTL(baixa, 'bola')));
  const bvh = construirBVH(limpo);
  const erro = m => { let s = 0; for (let v = 0; v < m.pos.length / 3; v++) s += pontoMaisPerto(bvh, m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]).d; return s / (m.pos.length / 3); };

  let pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const malha = () => pg.evaluate(() => { const o = window.Estudio3D.estudio.cena.objetos[0], m = o.partes[0].malha, t = o.transform; return { pos: Array.from(m.pos), idx: Array.from(m.idx), t: Array.from(t) }; });
  // malha no mundo (a peça importada é centralizada na mesa)
  const mundo = x => { const P = new Float64Array(x.pos.length), t = x.t; for (let i = 0; i < P.length; i += 3) { const [a, b2, c] = [x.pos[i], x.pos[i + 1], x.pos[i + 2]]; P[i] = t[0] * a + t[4] * b2 + t[8] * c + t[12]; P[i + 1] = t[1] * a + t[5] * b2 + t[9] * c + t[13]; P[i + 2] = t[2] * a + t[6] * b2 + t[10] * c + t[14]; } return criar(P, Uint32Array.from(x.idx)); };
  let antes = null, depois = null;
  await passo(pg, 'boneco de IA (120 mil triângulos, pele ondulada): Suavizar Média (padrão) -> prévia com relatório -> Aplicar: mais perto do limpo, volume igual, fechado, sem se cruzar', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', arqIA);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    await abrirSecao(pg, 'esc');
    if (!(await pg.isVisible('[data-sec=esc] [data-a=nivel] button.active[data-v="55"]'))) throw new Error('padrão não é Média');
    if (!/caroço de até/.test(await pg.textContent('[data-sec=esc] [data-a=alcance]'))) throw new Error('não diz o alcance em mm');
    if (await pg.isVisible('[data-sec=esc] [data-a=blocoFacetas]')) throw new Error('boneco denso não é facetado');
    antes = await malha();
    await pg.click('[data-sec=esc] [data-a=aplSuave]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
    const rel = await pg.textContent('[data-sec=esc] [data-a=res]');
    if (!/Volume/.test(rel) || !/mexeu até/.test(rel)) throw new Error('relatório: ' + rel);
    await confirmarPrevia(pg);
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.pos[0] !== n, antes.pos[0], { timeout: 20000 }).catch(() => {});
    depois = await malha();
    const A = criar(Float64Array.from(antes.pos), Uint32Array.from(antes.idx)), D = criar(Float64Array.from(depois.pos), Uint32Array.from(depois.idx));
    // a peça aberta pode ter sido recentrada: o limpo vai pro mesmo lugar (mesmo deslocamento do boneco de IA)
    const media = P => { const c = [0, 0, 0]; for (let i = 0; i < P.length; i++) c[i % 3] += P[i] / (P.length / 3); return c; };
    const ca = media(A.pos), ci = media(ia.pos), L = criar(Float64Array.from(limpo.pos, (x, i) => x + ca[i % 3] - ci[i % 3]), limpo.idx);
    const bvhL = construirBVH(L), err = m => { let s = 0; for (let v = 0; v < m.pos.length / 3; v++) s += pontoMaisPerto(bvhL, m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]).d; return s / (m.pos.length / 3); };
    const e0 = err(A), e1 = err(D);
    if (!(e1 < e0 * 0.85)) throw new Error('não ficou mais perto do limpo: ' + e0.toFixed(4) + ' -> ' + e1.toFixed(4));
    if (Math.abs(volume(D) / volume(A) - 1) > 0.005) throw new Error('volume mudou ' + (volume(D) / volume(A)));
    const v = validar(D, { completo: true });
    if (!v.fechada || v.autoInterseccoes > validar(A, { completo: true }).autoInterseccoes) throw new Error('malha: ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes }));
  });
  await passo(pg, 'Ctrl+Z volta EXATAMENTE a malha de antes; Refazer volta a suavizada', async () => {
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.pos[0] === n, antes.pos[0], { timeout: 10000 });
    const x = await malha();
    if (x.pos.length !== antes.pos.length || x.pos.some((p, i) => p !== antes.pos[i])) throw new Error('desfazer não voltou idêntico');
    await pg.keyboard.press('Control+y');
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.pos[0] === n, depois.pos[0], { timeout: 10000 });
  });
  await passo(pg, 'exportar 3MF e abrir de novo: mesma peça (volume igual)', async () => {
    await abrirSecao(pg, 'exp');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click('[data-sec=exp] [data-a="3mf"]')]);
    const arq = path.join(tmp, 'suavizado.3mf'); await dl.saveAs(arq);
    const r = executar('importar', { nome: 'x.3mf', bytes: new Uint8Array(fs.readFileSync(arq)), extras: {} });
    const m = r.objetos[0].partes[0].malha;
    if (Math.abs(volume(m) / volume(mundo(depois)) - 1) > 1e-3) throw new Error('3MF mudou o volume');
  });
  await passo(pg, 'SÓ A SELEÇÃO (cabeça): a cabeça alisa, as pernas não mexem nem 1 µm', async () => {
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.pos[0] === n, antes.pos[0], { timeout: 10000 });
    await pg.evaluate(() => {
      const e = window.Estudio3D.estudio, o = e.cena.objetos[0], p = o.partes[0], m = p.malha, nt = m.idx.length / 3, mask = new Uint8Array(nt);
      for (let t = 0; t < nt; t++) if (m.pos[m.idx[t * 3] * 3 + 2] > 88) mask[t] = 1;        // cabeça (z local > 88)
      e.cena.selecionar(o.id, p.id); e.visor.definirSelecao(p.id, mask);
    });
    await abrirSecao(pg, 'esc');
    await pg.click('[data-sec=esc] [data-a=aplSuave]');
    await confirmarPrevia(pg);
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.pos[0] !== n || true, antes.pos[0]);
    await pg.waitForTimeout(300);
    const x = await malha();
    let pernas = 0, cabeca = 0;
    for (let v = 0; v < x.pos.length / 3; v++) {
      const d = Math.hypot(x.pos[v * 3] - antes.pos[v * 3], x.pos[v * 3 + 1] - antes.pos[v * 3 + 1], x.pos[v * 3 + 2] - antes.pos[v * 3 + 2]);
      if (antes.pos[v * 3 + 2] < 60) pernas = Math.max(pernas, d); else if (antes.pos[v * 3 + 2] > 92) cabeca = Math.max(cabeca, d);
    }
    if (pernas !== 0) throw new Error('perna mexeu ' + pernas);
    if (!(cabeca > 0.005)) throw new Error('cabeça não mexeu');
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, p = e.cena.objetos[0].partes[0]; e.visor.definirSelecao(p.id, null); });
  });
  await passo(pg, 'caixa de cálculo mostra a etapa e o % (barra); Cancelar não mexe na peça e o motor continua', async () => {
    const x0 = await malha();
    await pg.click('[data-sec=esc] [data-a=nivel] button[data-v="85"]');
    await pg.click('[data-sec=esc] [data-a=aplSuave]');
    await pg.waitForFunction(() => /%/.test(document.querySelector('.e3d-ocupado [data-o=tempo]').textContent) && document.querySelector('.e3d-ocupado [data-o=barra]').style.display !== 'none', null, { timeout: 20000 });
    await pg.waitForSelector('.e3d-ocupado [data-o=cancelar]:visible', { timeout: 20000 });
    await pg.click('.e3d-ocupado [data-o=cancelar]');
    await pg.waitForFunction(() => !document.querySelector('.e3d-ocupado').classList.contains('on'), null, { timeout: 20000 });
    if (await pg.isVisible('.e3d-previa')) throw new Error('prévia apareceu depois de cancelar');
    const x1 = await malha();
    if (x1.pos.some((p, i) => p !== x0.pos[i])) throw new Error('cancelar mexeu na peça');
    // o motor sobe de novo: suavizar Leve funciona
    await pg.click('[data-sec=esc] [data-a=nivel] button[data-v="30"]');
    await pg.click('[data-sec=esc] [data-a=aplSuave]');
    await confirmarPrevia(pg);
  });
  await pg.context().close();

  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await passo(pg, 'bola FACETADA (poucos triângulos): aparece "Arredondar as facetas" marcado; vira bola lisa (muito mais triângulos, centros das faces na esfera)', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', arqBaixa);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.selecionar(o.id, o.partes[0].id); });
    await abrirSecao(pg, 'esc');
    await pg.waitForSelector('[data-sec=esc] [data-a=blocoFacetas]:visible', { timeout: 5000 });
    if (!(await pg.isChecked('[data-sec=esc] [data-a=facetas]'))) throw new Error('facetas não veio marcado');
    await pg.click('[data-sec=esc] [data-a=aplSuave]');
    await confirmarPrevia(pg);
    await pg.waitForFunction(n => window.Estudio3D.estudio.cena.objetos[0].partes[0].malha.idx.length > n * 20, baixa.idx.length, { timeout: 60000 });
    const m = await pg.evaluate(() => { const p = window.Estudio3D.estudio.cena.objetos[0].partes[0].malha; return { pos: Array.from(p.pos), idx: Array.from(p.idx) }; });
    const cx = [0, 1, 2].map(e => { let lo = Infinity, hi = -Infinity; for (let i = e; i < m.pos.length; i += 3) { lo = Math.min(lo, m.pos[i]); hi = Math.max(hi, m.pos[i]); } return (lo + hi) / 2; });
    let s = 0; for (let t = 0; t < m.idx.length; t += 3) { let c = [0, 0, 0]; for (let k = 0; k < 3; k++) for (let e = 0; e < 3; e++) c[e] += m.pos[m.idx[t + k] * 3 + e] / 3; s += Math.abs(Math.hypot(c[0] - cx[0], c[1] - cx[1], c[2] - cx[2]) - 20); }
    const media = s / (m.idx.length / 3);
    if (!(media < 0.15)) throw new Error('ainda facetada: centros a ' + media.toFixed(3) + ' mm da esfera');
    const v = validar({ pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) }, { completo: true });
    if (!v.fechada || v.autoInterseccoes) throw new Error('malha ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes }));
  });
  await pg.context().close();
  void erro;
}

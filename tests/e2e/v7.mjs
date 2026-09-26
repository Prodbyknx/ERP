// E2E v7 pela tela: escala vira medida em mm; pincel com detalhe automático
// numa caixa simples; curva suave (tubo em anel); texto ENVOLVENDO uma
// caneca; "Preparar pra imprimir" num STL furado e flutuando.
import fs from 'node:fs';
import path from 'node:path';
import { validar } from '../../src/estudio3d/core/validador.js';
import { caixa } from '../../src/estudio3d/core/malha.js';

export async function secaoV7({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao, confirmarPrevia }) {
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  const E = 'window.Estudio3D.estudio';
  const malha = (k, j = 0) => pg.evaluate(([i, jj]) => { const m = window.Estudio3D.estudio.cena.objetos[i].partes[jj].malha; return { pos: Array.from(m.pos), idx: Array.from(m.idx) }; }, [k, j]);
  const M = m => ({ pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) });
  const limpo = (m, rot) => { const v = validar(M(m), { completo: true }); if (!v.fechada || v.autoInterseccoes || v.facesDegeneradas) throw new Error(rot + ': ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, deg: v.facesDegeneradas })); return v; };
  const nObj = () => pg.evaluate(e => eval(e).cena.objetos.length, E);
  const forma = async (id, params, n) => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=' + id + ']');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k, n, { timeout: 30000 });
    for (const [k, v] of params) { await pg.fill('[data-sec=formas] [data-p=' + k + ']', v); await pg.press('[data-sec=formas] [data-p=' + k + ']', 'Enter'); await pg.waitForTimeout(350); }
  };

  await passo(pg, 'escala 50% vira medida real: malha 20×10×30 (pino/parede em mm valem), painel mostra 50%, desfazer volta', async () => {
    await forma('caixa', [['largura', '40'], ['profundidade', '20'], ['altura', '60']], 1);
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[2] - c.min[2] - 60) < 1e-6; }, null, { timeout: 30000 });
    await abrirSecao(pg, 'transf');
    await pg.fill('[data-sec=transf] [data-t=esc]', '50'); await pg.press('[data-sec=transf] [data-t=esc]', 'Enter');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[2] - c.min[2] - 30) < 1e-6; }, null, { timeout: 20000 });
    const t = caixa(M(await malha(0))).tam;
    if (Math.abs(t[0] - 20) > 1e-6 || Math.abs(t[2] - 30) > 1e-6) throw new Error('malha não levou a escala: ' + t.join('×'));
    const esc = await pg.inputValue('[data-sec=transf] [data-t=esc]');
    if (!/^50/.test(esc)) throw new Error('painel mostra ' + esc);
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return Math.abs(c.max[2] - c.min[2] - 60) < 1e-6; }, null, { timeout: 20000 });
  });

  await passo(pg, 'pincel com detalhe automático numa caixa de 12 triângulos: cria detalhe só debaixo do pincel, malha válida', async () => {
    const n0 = (await malha(0)).idx.length / 3;
    await pg.evaluate(e => eval(e).enquadrar(), E); await pg.waitForTimeout(400);
    await abrirSecao(pg, 'esc');
    await pg.evaluate(() => { const r = document.querySelector('[data-sec=esc] [data-a=forca]'); r.value = '0.8'; r.dispatchEvent(new Event('input')); });
    const tela = (fx, fy, fz) => pg.evaluate(([a, b2, c]) => { const e = window.Estudio3D.estudio, x = e.cena.caixaExata(e.cena.objetos[0]); return e.visor.telaDe(x.min[0] + a * (x.max[0] - x.min[0]), x.min[1] + b2 * (x.max[1] - x.min[1]), x.min[2] + c * (x.max[2] - x.min[2])); }, [fx, fy, fz]);
    const s0 = await tela(0.4, 0, 0.5), s1 = await tela(0.6, 0, 0.5);
    await pg.mouse.move(s0.x, s0.y); await pg.mouse.down();
    for (let k = 1; k <= 10; k++) await pg.mouse.move(s0.x + (s1.x - s0.x) * k / 10, s0.y + (s1.y - s0.y) * k / 10, { steps: 2 });
    await pg.mouse.up();
    await pg.waitForFunction(() => /de detalhe/.test(document.querySelector('[data-sec=esc] [data-a=info]').textContent), null, { timeout: 30000 });
    const m = await malha(0), n1 = m.idx.length / 3;
    limpo(m, 'caixa esculpida');
    if (!(n1 > n0 * 10)) throw new Error('não criou detalhe: ' + n0 + ' -> ' + n1);
    const t = caixa(M(m));
    if (!(t.tam[1] > 20.05)) throw new Error('não puxou a face: ' + t.tam[1]);
  });

  await passo(pg, 'curva suave: 4 cliques + fechar em modo tubo = anel liso, 1 peça, sem cruzamento', async () => {
    await abrirSecao(pg, 'des');
    await pg.click('[data-sec=des] [data-a=modo] button[data-v=tubo]');
    await pg.click('[data-sec=des] [data-a=linha] button[data-v=suave]');
    await pg.fill('[data-sec=des] [data-a=diam]', '3');
    await pg.evaluate(() => window.Estudio3D.estudio.cena.selecionar(null, null));
    const x0 = await pg.evaluate(() => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]), v = e.visor; const x = Math.round(c.max[0]) + 30, y = Math.round(c.min[1]); v.controles.target.set(x, y, 0); v.camera.position.set(x, y - 120, 110); v.controles.update(); v.pedirRender(); return [x, y]; });
    await pg.waitForTimeout(300);
    for (const [dx, dy] of [[15, 0], [0, 15], [-15, 0], [0, -15], [15, 0]]) { const s = await pg.evaluate(([a, b2]) => window.Estudio3D.estudio.visor.telaDe(a, b2, 0), [x0[0] + dx, x0[1] + dy]); await pg.mouse.click(s.x, s.y); await pg.waitForTimeout(60); }
    await pg.waitForFunction(() => /fechado/.test(document.querySelector('[data-sec=des] [data-a=info]').innerHTML), null, { timeout: 10000 });
    const n = await nObj();
    await pg.click('[data-sec=des] [data-a=criar]');
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos.length === k + 1, n, { timeout: 30000 });
    const v = limpo(await malha(n), 'anel');
    if (v.componentes !== 1) throw new Error('componentes ' + v.componentes);
    const t = caixa(M(await malha(n))).tam;
    if (Math.abs(t[0] - 33) > 0.6 || Math.abs(t[2] - 3) > 1e-3) throw new Error('medida do anel ' + t.map(x => x.toFixed(2)).join('×'));
  });

  await passo(pg, 'texto ENVOLVENDO a caneca Ø40: clica no lado, alto-relevo colorido, topo a 1 mm da parede em toda a volta', async () => {
    const n = await nObj();
    await forma('cilindro', [['diametro', '40'], ['altura', '60']], n + 1);
    await pg.waitForFunction(k => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[k]); return Math.abs(c.max[2] - c.min[2] - 60) < 1e-6 && Math.abs(c.max[0] - c.min[0] - 40) < 0.1; }, n, { timeout: 30000 });
    await pg.evaluate(k => { const e = window.Estudio3D.estudio; e.cena.selecionar(e.cena.objetos[k].id, e.cena.objetos[k].partes[0].id); e.enquadrar(); }, n);
    await pg.waitForTimeout(400);
    await abrirSecao(pg, 'relevo');
    await pg.click('[data-sec=relevo] [data-a=lado] button[data-v=ponto]');
    const s = await pg.evaluate(k => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[k]); return e.visor.telaDe((c.min[0] + c.max[0]) / 2, c.min[1], (c.min[2] + c.max[2]) / 2); }, n);
    await pg.mouse.click(s.x, s.y);
    await pg.fill('[data-sec=relevo] [data-a=texto]', 'ABC');
    await pg.fill('[data-sec=relevo] [data-a=largura]', '36');
    await pg.selectOption('[data-sec=relevo] [data-a=modo]', 'alto-cor');
    await pg.fill('[data-sec=relevo] [data-a=altura]', '1');
    await pg.waitForTimeout(300);
    await pg.click('[data-sec=relevo] [data-a=ir]'); await confirmarPrevia(pg);
    await pg.waitForFunction(k => window.Estudio3D.estudio.cena.objetos[k].partes.length === 2, n, { timeout: 60000 });
    const p = await malha(n, 1); limpo(p, 'letras'); limpo(await malha(n, 0), 'caneca');
    const cx = caixa(M(await malha(n, 0))), ox = (cx.min[0] + cx.max[0]) / 2, oy = (cx.min[1] + cx.max[1]) / 2;
    let rMax = 0, a0 = Infinity, a1 = -Infinity;
    for (let i = 0; i < p.pos.length; i += 3) { const dx = p.pos[i] - ox, dy = p.pos[i + 1] - oy; rMax = Math.max(rMax, Math.hypot(dx, dy)); const a = Math.atan2(dy, dx); a0 = Math.min(a0, a); a1 = Math.max(a1, a); }
    if (process.env.CAPTURAS) await pg.screenshot({ path: path.join(process.env.CAPTURAS, 'caneca.png') });
    if (rMax > 21.05) throw new Error('não envolveu (topo plano): raio máximo ' + rMax.toFixed(2));
    if (!((a1 - a0) * 20 > 30)) throw new Error('largura ao longo da parede ' + ((a1 - a0) * 20).toFixed(1) + ' mm');
  });

  await passo(pg, 'Preparar pra imprimir: STL furado e flutuando -> consertado, na mesa, relatório; 1 Ctrl+Z volta tudo', async () => {
    // cubo de 20 mm a 10 mm do chão, sem um triângulo (buraco)
    const V = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]].map(v => [v[0], v[1], v[2] + 10]);
    const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].slice(0, 11);
    const stl = 'solid f\n' + F.map(f => 'facet normal 0 0 0\nouter loop\n' + f.map(i => 'vertex ' + V[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid f\n';
    const arq = path.join(tmp, 'furado.stl'); fs.writeFileSync(arq, stl);
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.cena.aplicar('limpar', () => { e.cena.objetos = []; }); });
    await pg.setInputFiles('.e3d input[type=file][multiple]', arq);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    await pg.evaluate(() => { const e = window.Estudio3D.estudio, o = e.cena.objetos[0]; e.cena.aplicar('subir', () => { o.transform[14] += 10; }); });
    const antes = await malha(0);
    await pg.click('.e3d-top [data-b=preparar]');
    await pg.waitForSelector('.e3d-preparar [data-a=exportar]', { timeout: 120000 });
    if (process.env.CAPTURAS) await pg.screenshot({ path: path.join(process.env.CAPTURAS, 'preparar.png') });
    const txt = await pg.textContent('.e3d-preparar');
    if (!/Malha consertada/.test(txt)) throw new Error('relatório: ' + txt.slice(0, 300));
    limpo(await malha(0), 'consertada');
    const z = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[0]).min[2]; });
    if (Math.abs(z) > 1e-6) throw new Error('não foi pra mesa: z ' + z);
    await pg.click('.e3d-preparar .tp button');
    await pg.keyboard.press('Control+z');
    const m = await malha(0);
    if (m.idx.length !== antes.idx.length) throw new Error('Ctrl+Z não voltou a malha');
    const z2 = await pg.evaluate(() => { const e = window.Estudio3D.estudio; return e.cena.caixaExata(e.cena.objetos[0]).min[2]; });
    if (!(z2 > 5)) throw new Error('Ctrl+Z não voltou a posição: ' + z2);
  });
  await pg.context().close();
}

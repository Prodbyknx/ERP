// E2E: pegar um OLHO ou uma ORELHA com facilidade e separar/cortar.
// Cabeça (esfera) com dois olhos saltados e uma orelha presa por um pescoço
// fino. Passar o mouse acende a parte; um clique pega ela inteira; a barra
// que aparece em cima do 3D separa (ou separa com pino) em 2 sólidos fechados.
import fs from 'node:fs';
import path from 'node:path';
import { carregarManifold } from '../util/manifold.mjs';
import { escreverSTL } from '../../src/estudio3d/core/formatos/stl.js';
import { criar } from '../../src/estudio3d/core/malha.js';
import { validar } from '../../src/estudio3d/core/validador.js';

async function cabecaComOlhos(arq) {
  const w = await carregarManifold();
  const { Manifold } = w;
  const cabeca = Manifold.sphere(15, 96);
  const olhoE = Manifold.sphere(3.2, 48).translate([5, -13.2, 4]);
  const olhoD = Manifold.sphere(3.2, 48).translate([-5, -13.2, 4]);
  const orelha = Manifold.sphere(6, 64).scale([0.45, 1, 1.3]).translate([20, 0, 5]);
  const pescoco = Manifold.cylinder(6, 1.6, 1.6, 32).rotate([0, 90, 0]).translate([13.5, 0, 5]);
  const u = cabeca.add(olhoE).add(olhoD).add(orelha).add(pescoco).translate([0, 0, 15]);
  const m = u.getMesh();
  const pos = new Float64Array(m.vertProperties.length / m.numProp * 3);
  for (let v = 0; v < pos.length / 3; v++) for (let k = 0; k < 3; k++) pos[v * 3 + k] = m.vertProperties[v * m.numProp + k];
  fs.writeFileSync(arq, escreverSTL(criar(pos, Uint32Array.from(m.triVerts)), 'cabeca'));
  [cabeca, olhoE, olhoD, orelha, pescoco, u].forEach(x => x.delete());
}

export async function secaoParte({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao }) {
  const arq = path.join(tmp, 'cabeca-olhos.stl');
  await cabecaComOlhos(arq);
  const pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  // coordenadas do modelo (centro da cabeça no chão = origem): a caixa começa
  // 15 mm à esquerda (cabeça) e 16,4 mm à frente (olhos) desse centro
  const tela = (x, y, z) => pg.evaluate(([x, y, z]) => { const e = window.Estudio3D.estudio, c = e.cena.caixaExata(e.cena.objetos[0]); return e.visor.telaDe(c.min[0] + 15 + x, c.min[1] + 16.4 + y, c.min[2] + z); }, [x, y, z]);
  const selecionadas = () => pg.evaluate(() => { const e = window.Estudio3D.estudio, p = e.parteAtual(), m = p && e.visor.selecao(p.id); return m ? { n: m.reduce((a, v) => a + v, 0), total: m.length } : { n: 0, total: 0 }; });
  const valida = idx => pg.evaluate(i => { const p = window.Estudio3D.estudio.cena.objetos[i].partes[0].malha; return { pos: Array.from(p.pos), idx: Array.from(p.idx) }; }, idx)
    .then(m => { const v = validar({ pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) }, { completo: true }); if (!v.fechada || v.autoInterseccoes > 2 || !(v.volume > 0)) throw new Error('sólido inválido ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, vol: v.volume })); return v.volume; });

  await passo(pg, 'PARTE: passar o mouse no olho acende SÓ o olho (azul); um clique seleciona ele e aparece a barra "Separar"', async () => {
    await pg.setInputFiles('.e3d input[type=file][multiple]', arq);
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 60000 });
    await pg.evaluate(() => window.Estudio3D.estudio.visor.vista('frente'));
    await pg.evaluate(() => window.Estudio3D.estudio.visor.enquadrar());
    await abrirSecao(pg, 'sel');
    const modo = await pg.evaluate(() => window.Estudio3D.estudio.ferramenta);
    if (modo !== 'auto') throw new Error('modo padrão: ' + modo);
    const o = await tela(5, -16.2, 19);
    await pg.mouse.move(o.x - 20, o.y); await pg.mouse.move(o.x, o.y);
    await pg.waitForFunction(() => { const v = window.Estudio3D.estudio.visor; return v.realceFaces.size > 0; }, null, { timeout: 5000 });
    const acesas = await pg.evaluate(() => { const v = window.Estudio3D.estudio.visor, m = [...v.realceFaces.values()][0]; return { n: m.reduce((a, x) => a + x, 0), total: m.length }; });
    if (!(acesas.n > 20 && acesas.n < acesas.total * 0.2)) throw new Error('realce: ' + JSON.stringify(acesas));
    await pg.mouse.click(o.x, o.y);
    await pg.waitForSelector('.e3d-acaosel', { state: 'visible', timeout: 10000 });
    const s = await selecionadas();
    if (s.n !== acesas.n) throw new Error('selecionou diferente do que acendeu: ' + s.n + ' × ' + acesas.n);
  });

  await passo(pg, 'PARTE: "Separar" na barra -> prévia -> olho vira peça própria; os 2 sólidos fechados', async () => {
    await pg.click('.e3d-acaosel [data-a=separar]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
    await pg.click('.e3d-previa button.primary');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 60000 });
    const vCab = await valida(0), vOlho = await valida(1);
    if (!(vOlho > 40 && vOlho < 600 && vCab > 12000)) throw new Error('volumes: cabeça ' + vCab.toFixed(0) + ', olho ' + vOlho.toFixed(0));
    await pg.keyboard.press('Control+z');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 20000 });
  });

  await passo(pg, 'PARTE: clique na orelha pega a orelha inteira até o pescoço; "Separar com pino" encaixa de volta', async () => {
    await pg.evaluate(() => { const e = window.Estudio3D.estudio; e.visor.vista('frente'); e.visor.enquadrar(); e.cena.selecionar(null, null); });
    const f = await pg.evaluate(() => window.Estudio3D.estudio.ferramenta);
    if (f !== 'auto') throw new Error('com o Separar aberto, o clique deveria pegar a parte (ferramenta: ' + f + ')');
    const o = await tela(20, -5.8, 20);
    await pg.mouse.move(o.x, o.y);
    await pg.mouse.click(o.x, o.y);
    await pg.waitForSelector('.e3d-acaosel', { state: 'visible', timeout: 60000 });
    const s = await selecionadas();
    if (!(s.n > 50 && s.n < s.total * 0.3)) throw new Error('orelha: ' + JSON.stringify(s));
    await pg.click('.e3d-acaosel [data-a=pino]');
    await pg.waitForSelector('.e3d-previa', { state: 'visible', timeout: 120000 });
    // o pino tem que EXISTIR (a prévia diz o encaixe e não há alerta de "sem pino")
    const prev = await pg.textContent('.e3d-previa');
    if (!/Encaixe: pino/.test(prev) || /SEM pino/.test(prev)) throw new Error('separou sem pino: ' + prev.replace(/\s+/g, ' ').slice(0, 300));
    await pg.click('.e3d-previa button.primary');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 2, null, { timeout: 60000 });
    const res = await pg.textContent('[data-sec=sep] [data-a=res]');
    const vCab = await valida(0), vOrelha = await valida(1);
    if (!(vOrelha > 100 && vOrelha < 2000)) throw new Error('orelha ' + vOrelha.toFixed(0) + ' | ' + res);
    const nota = await pg.evaluate(() => document.querySelector('[data-sec=sep] [data-a=res]').innerText);
    if (!/virou um objeto/.test(nota)) throw new Error(nota);
    void vCab;
  });
  await pg.context().close();
}

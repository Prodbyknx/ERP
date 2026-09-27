// E2E do ESPAÇO PRA TAG NFC no gerador: o bolso tem que estar no arquivo
// baixado (3MF e STL), como o fatiador vê. Antes: "aberto por baixo" saía
// com 155 auto-interseções (fatias soldadas com faces duplicadas) e
// "fechado por dentro" perdia o vão (volume igual ao da peça sem tag).
// Prova: corte horizontal da base — na altura do bolso a área cai
// exatamente o disco da tag; fora dele, área cheia.
import fs from 'node:fs';
import path from 'node:path';
import { carregarManifold } from '../util/manifold.mjs';
import { executar } from '../../src/estudio3d/motor/operacoes.js';
import { validar } from '../../src/estudio3d/core/validador.js';
import { lerSTL } from '../../src/estudio3d/core/formatos/stl.js';
import { soldar } from '../../src/estudio3d/core/malha.js';
import { lerZip } from '../../src/estudio3d/core/formatos/zip.js';

export async function secaoNFC({ b, teste, tmp, novaPagina, passo }) {
  const W = await carregarManifold();
  const pg = await novaPagina(b);
  await pg.goto('file://' + teste + '/index.html');
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => showTab('ferr'));
  const baixar = async (bt, nome) => {
    await pg.waitForFunction(() => document.getElementById('fer_acoes').style.display !== 'none', null, { timeout: 20000 });
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click(bt)]);
    const arq = path.join(tmp, nome); await dl.saveAs(arq); return arq;
  };
  const base3MF = arq => executar('importar', { nome: 'x.3mf', bytes: new Uint8Array(fs.readFileSync(arq)), extras: {} }).objetos[0].partes.find(p => /base/i.test(p.nome)).malha;
  // área do corte em z (a partir do fundo da peça)
  const cortes = (m, zs) => {
    const mf = new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.pos), triVerts: Uint32Array.from(m.idx) }));
    const z0 = mf.boundingBox().min[2], a = zs.map(z => mf.slice(z0 + z).area()); mf.delete(); return a;
  };
  const limpa = (m, rot) => { const v = validar(m, { completo: true }); if (!v.fechada || v.autoInterseccoes || v.arestasNaoManifold) throw new Error(rot + ': malha ' + JSON.stringify({ f: v.fechada, ai: v.autoInterseccoes, nm: v.arestasNaoManifold })); };
  const disco = Math.PI * 12.5 * 12.5;           // tag padrão de 25 mm
  let cheia = 0;

  await passo(pg, 'NFC ABERTO POR BAIXO: 3MF baixado tem o bolso (corte a 0,3 mm perde o disco da tag; acima de 0,9 mm cheio), malha limpa; aviso diz que fica virado pra mesa', async () => {
    await pg.click('#fer_entrada_seg button[data-v=forma]');
    await pg.click('.fer-forma[data-f=quadrado]');
    await pg.waitForFunction(() => FER.peca, null, { timeout: 20000 });
    cheia = cortes(base3MF(await baixar('#fer_3mf', 'nfc-sem.3mf')), [1.5])[0];
    await pg.check('#fer_nfc');
    await pg.waitForFunction(() => FER.peca && FER.peca.nfc && FER.peca.nfc.modo === 'baixo', null, { timeout: 20000 });
    if (!/virado pra mesa/.test(await pg.textContent('.fer-nfc-info'))) throw new Error('aviso não diz onde fica o bolso');
    const m = base3MF(await baixar('#fer_3mf', 'nfc-baixo.3mf'));
    limpa(m, 'aberto por baixo');
    const [a03, a08, a15] = cortes(m, [0.3, 0.8, 1.5]);
    if (Math.abs(cheia - a03 - disco) > 0.03 * disco || Math.abs(cheia - a08 - disco) > 0.03 * disco) throw new Error('sem bolso embaixo: ' + [cheia, a03, a08].map(x => x.toFixed(0)));
    if (Math.abs(a15 - cheia) > 1) throw new Error('bolso passou do fundo: ' + a15.toFixed(0));
  });
  await passo(pg, 'NFC ABERTO POR BAIXO: o STL baixado também tem o bolso', async () => {
    // "um arquivo por cor" (padrão): zip com a base e o desenho
    const arq = await baixar('#fer_stl', 'nfc-baixo-stl.zip');
    const z = lerZip(new Uint8Array(fs.readFileSync(arq))), nome = Object.keys(z).find(k => /base\.stl$/i.test(k));
    if (!nome) throw new Error('zip sem a base: ' + Object.keys(z));
    const m = soldar(lerSTL(z[nome]).malha, 1e-6).malha;
    limpa(m, 'STL');
    const [a03, a15] = cortes(m, [0.3, 1.5]);
    if (Math.abs(cheia - a03 - disco) > 0.03 * disco || Math.abs(a15 - cheia) > 1) throw new Error('STL sem bolso: ' + [cheia, a03, a15].map(x => x.toFixed(0)));
  });
  await passo(pg, 'NFC FECHADO POR DENTRO: 3MF tem o vão escondido (cheio no fundo e na tampa, disco a menos no meio), 2 cascas, malha limpa; tela diz o Z da pausa', async () => {
    await pg.click('#fer_nfc_seg button[data-v=fechado]');
    await pg.waitForFunction(() => FER.peca && FER.peca.nfc && FER.peca.nfc.modo === 'fechado', null, { timeout: 20000 });
    const nfc = await pg.evaluate(() => ({ z0: FER.peca.nfc.zFundo, z1: FER.peca.nfc.zFundo + FER.peca.nfc.prof, alt: FER.peca.altBase }));
    if (!/Pause a impressão em/.test(await pg.textContent('.fer-nfc-info'))) throw new Error('sem Z da pausa');
    const m = base3MF(await baixar('#fer_3mf', 'nfc-fechado.3mf'));
    limpa(m, 'fechado');
    const [fundo, meio, tampa] = cortes(m, [nfc.z0 / 2, (nfc.z0 + nfc.z1) / 2, (nfc.z1 + nfc.alt) / 2]);
    if (Math.abs(fundo - cheia) > 1 || Math.abs(tampa - cheia) > 1) throw new Error('vão vazou pro fundo/tampa: ' + [fundo, tampa, cheia].map(x => x.toFixed(0)));
    if (Math.abs(cheia - meio - disco) > 0.03 * disco) throw new Error('sem vão no meio: ' + [cheia, meio].map(x => x.toFixed(0)));
    const mf = new W.Manifold(new W.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.pos), triVerts: Uint32Array.from(m.idx) }));
    const n = mf.decompose().length; mf.delete();
    if (n !== 2) throw new Error('esperava peça + vão (2 cascas), veio ' + n);
  });
  await pg.context().close();
}

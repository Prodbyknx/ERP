// E2E "ABRIR NO BAMBU STUDIO":
//  - pacote de teste (sem nuvem): o botão baixa o 3MF e explica;
//  - nuvem simulada (config + sessão + Supabase de mentira): o 3MF sobe pra
//    pasta do usuário, com o passe da sessão (sem renovar nem guardar
//    sessão), e o navegador abre bambustudio://open?file=…&name=….3mf que o
//    Bambu lê certo; o arquivo enviado é um 3MF válido;
//  - gerador de chaveiro: mesmo botão;
//  - envio demorado: aparece "Abrir agora".
import fs from 'node:fs';
import path from 'node:path';
import { executar } from '../../src/estudio3d/motor/operacoes.js';
import { carregarManifold } from '../util/manifold.mjs';

// nuvem de mentira (roda dentro da página)
const NUVEM_FALSA = atraso => {
  window.ERP_CONFIG = { url: 'https://abcdefgh.supabase.co', publicKey: 'chave-publica' };
  localStorage.setItem('sb-abcdefgh-auth-token', JSON.stringify({ access_token: 'PASSE-DA-SESSAO', refresh_token: 'NAO-USAR', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'usuario-1' } }));
  window.__nuvem = { envios: [] };
  window.supabase = {
    createClient: (url, chave, opc) => {
      window.__nuvem.cliente = { url, chave, auth: opc.auth, auth_header: opc.global.headers.Authorization };
      return {
        storage: {
          from: bucket => ({
            upload: async (caminho, blob, o) => { if (atraso) await new Promise(r => setTimeout(r, atraso)); window.__nuvem.envios.push({ bucket, caminho, tamanho: blob.size, o, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }); return { data: { path: caminho }, error: null }; },
            createSignedUrl: async (caminho, seg) => ({ data: { signedUrl: 'https://abcdefgh.supabase.co/storage/v1/object/sign/' + bucket + '/' + caminho + '?token=eyJhbGci.eyJ1cmw.assinatura' }, error: null, seg })
          })
        }
      };
    }
  };
  window.__e3dAbrirProtocolo = url => { window.__abriu = url; };
};

function comoOBambuLe(link) {
  const dec = decodeURIComponent(link), info = dec.slice(dec.indexOf('file=') + 5), j = info.indexOf('&name=');
  return { url: info.slice(0, j), nome: info.slice(j + 6) };
}

export async function secaoBambu({ b, teste, tmp, novaPagina, passo, abrirEstudio, abrirSecao }) {
  await carregarManifold();
  let pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await passo(pg, 'pacote de teste (sem nuvem): "Abrir no Bambu Studio" baixa o 3MF e explica como abrir sozinho', async () => {
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    await abrirSecao(pg, 'exp');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('[data-sec=exp] [data-a=bambu]')]);
    if (!/\.3mf$/.test(dl.suggestedFilename())) throw new Error('arquivo ' + dl.suggestedFilename());
    await pg.waitForFunction(() => /foi baixado/.test(document.querySelector('[data-sec=exp] [data-a=res]').textContent), null, { timeout: 10000 });
  });
  await pg.context().close();

  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await passo(pg, 'com nuvem: sobe o 3MF pra pasta do usuário (com o passe da sessão, sem renovar) e abre bambustudio://… que o Bambu lê certo', async () => {
    await pg.evaluate(NUVEM_FALSA, 0);
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=esfera]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    await abrirSecao(pg, 'exp');
    await pg.fill('[data-sec=exp] [data-a=nome]', 'Bola da Ana');
    await pg.click('[data-sec=exp] [data-a=bambu]');
    await pg.waitForFunction(() => !!window.__abriu, null, { timeout: 30000 });
    const n = await pg.evaluate(() => ({ abriu: window.__abriu, cli: window.__nuvem.cliente, env: window.__nuvem.envios.map(e => ({ ...e, bytes: undefined })), bytes: window.__nuvem.envios[0].bytes }));
    const e = n.env[0];
    if (e.bucket !== 'estudio3d' || e.caminho !== 'usuario-1/bambu.3mf' || !e.o.upsert || e.o.contentType !== 'model/3mf') throw new Error('envio ' + JSON.stringify(e));
    if (n.cli.auth_header !== 'Bearer PASSE-DA-SESSAO' || n.cli.auth.persistSession !== false || n.cli.auth.autoRefreshToken !== false) throw new Error('cliente ' + JSON.stringify(n.cli));
    const lido = comoOBambuLe(n.abriu);
    if (!n.abriu.startsWith('bambustudio://open?file=') || !lido.url.startsWith('https://abcdefgh.supabase.co/storage/v1/object/sign/estudio3d/usuario-1/bambu.3mf?token=') || lido.nome !== 'bola-da-ana.3mf') throw new Error('link ' + n.abriu);
    // o que subiu é um 3MF de verdade, com a esfera
    const r = executar('importar', { nome: 'x.3mf', bytes: Uint8Array.from(n.bytes), extras: {} });
    if (r.objetos.length !== 1 || !(r.triangulos > 100)) throw new Error('3MF enviado ' + r.objetos.length + ' / ' + r.triangulos);
    if (!/Abrindo no Bambu Studio/.test(await pg.textContent('[data-sec=exp] [data-a=res]'))) throw new Error('mensagem');
  });
  await passo(pg, 'Preparar pra imprimir -> "Abrir no Bambu Studio" no fim do relatório (mesmo caminho)', async () => {
    await pg.evaluate(() => { window.__abriu = null; });
    await pg.click('.e3d-top [data-b=preparar]');
    await pg.waitForSelector('.e3d-preparar [data-a=exportar]', { timeout: 120000 });
    if (!/Abrir no Bambu Studio/.test(await pg.textContent('.e3d-preparar [data-a=exportar]'))) throw new Error('botão');
    await pg.click('.e3d-preparar [data-a=exportar]');
    await pg.waitForFunction(() => !!window.__abriu, null, { timeout: 30000 });
  });
  await pg.context().close();

  pg = await novaPagina(b);
  await abrirEstudio(pg, 'file://' + teste + '/index.html');
  await passo(pg, 'envio demorado (5 s): não perde o clique — aparece "Abrir agora" e ele abre', async () => {
    await pg.evaluate(NUVEM_FALSA, 5000);
    await abrirSecao(pg, 'formas');
    await pg.click('[data-forma=caixa]');
    await pg.waitForFunction(() => window.Estudio3D.estudio.cena.objetos.length === 1, null, { timeout: 30000 });
    await abrirSecao(pg, 'exp');
    await pg.click('[data-sec=exp] [data-a=bambu]');
    await pg.waitForSelector('[data-sec=exp] [data-a=abrirAgora]', { timeout: 30000 });
    if (await pg.evaluate(() => !!window.__abriu)) throw new Error('abriu sem clique fresco');
    await pg.click('[data-sec=exp] [data-a=abrirAgora]');
    await pg.waitForFunction(() => !!window.__abriu, null, { timeout: 5000 });
  });
  await pg.context().close();

  pg = await novaPagina(b);
  await pg.goto('file://' + teste + '/index.html');
  await pg.waitForTimeout(1200);
  await passo(pg, 'gerador de chaveiro: "Abrir no Bambu Studio" manda o chaveiro (com as cores) pro Bambu', async () => {
    await pg.evaluate(NUVEM_FALSA, 0);
    await pg.evaluate(() => showTab('ferr'));
    await pg.click('#fer_entrada_seg button[data-v=texto]');
    await pg.fill('#fer_texto', 'MARIA');
    await pg.waitForFunction(() => document.getElementById('fer_acoes').style.display !== 'none', null, { timeout: 20000 });
    await pg.click('#fer_bambu');
    await pg.waitForFunction(() => !!window.__abriu, null, { timeout: 60000 });
    const n = await pg.evaluate(() => ({ abriu: window.__abriu, bytes: window.__nuvem.envios[0].bytes }));
    const arq = path.join(tmp, 'gerador-bambu.3mf'); fs.writeFileSync(arq, Uint8Array.from(n.bytes));
    const r = executar('importar', { nome: 'x.3mf', bytes: Uint8Array.from(n.bytes), extras: {} });
    const cores = new Set(r.objetos.flatMap(o => o.partes.map(p => p.cor)));
    if (cores.size < 2) throw new Error('cores ' + [...cores]);
    if (!/\.3mf$/.test(comoOBambuLe(n.abriu).nome)) throw new Error('nome');
    if (!/Abrindo no Bambu Studio/.test(await pg.textContent('#fer_bambu_res'))) throw new Error('mensagem');
  });
  await pg.context().close();
}

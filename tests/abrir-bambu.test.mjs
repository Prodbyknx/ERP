// ABRIR NO BAMBU STUDIO: o link tem que ser lido pelo Bambu do jeito que o
// código dele lê (GUI_App.cpp extract_model_download_url_from_open +
// Plater::import_model_id): decodifica tudo, pega depois de "file=", separa
// o nome no "&name=" e exige extensão .3mf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkBambu, nomeSeguro } from '../src/estudio3d/ui/bambu.js';

// o que o Bambu faz com o link (reproduzido do código-fonte)
function comoOBambuLe(link) {
  assert.ok(link.startsWith('bambustudio://open'), 'prefixo');
  const dec = decodeURIComponent(link);                  // Http::url_decode
  const i = dec.indexOf('file=');
  assert.ok(i >= 0, 'tem file=');
  const info = dec.slice(i + 5);
  const j = info.indexOf('&name=');
  assert.ok(j >= 0, 'tem &name=');
  const url = info.slice(0, j), nome = info.slice(j + 6);
  return { url, nome, extensaoOk: /\.3mf$/i.test(nome) };
}

test('BAMBU: link com o endereço assinado do Supabase e o nome volta igual do lado do Bambu', () => {
  const assinado = 'https://abcdefgh.supabase.co/storage/v1/object/sign/estudio3d/1b2c-uuid/bambu.3mf?token=eyJhbGciOi.eyJ1cmwiOiJ.sig-_x';
  const r = comoOBambuLe(linkBambu(assinado, 'Chaveiro João & Maria / placa 2'));
  assert.equal(r.url, assinado);
  assert.ok(r.extensaoOk);
  assert.equal(r.nome, 'Chaveiro Joao Maria placa 2.3mf');
  // o nome não pode quebrar o endereço nem trazer caminho de pasta
  assert.ok(!/[\/\\&?#%]/.test(r.nome.replace(/\.3mf$/, '')));
});

test('BAMBU: nome seguro (acento, barra, pontos, vazio, muito longo)', () => {
  assert.equal(nomeSeguro('Ação/..\\teste.3MF'), 'Acao .. teste');
  assert.equal(nomeSeguro(''), 'modelo');
  assert.equal(nomeSeguro('###'), 'modelo');
  assert.equal(nomeSeguro('x'.repeat(200)).length, 80);
});

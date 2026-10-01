// A geração dos pacotes para se achar chave secreta em qualquer arquivo.
// A chave pública (publishable / token anon) passa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { varrerSegredos } from '../tools/pacotes.mjs';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = papel => 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + b64({ iss: 'supabase', ref: 'abcdefghij', role: papel, iat: 1, exp: 2 }) + '.assinaturaQualquer1234';

test('varredura de segredos: acha secreta/service_role/privada, deixa passar a pública', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
  const pub = "window.ERP_CONFIG={url:'https://x.supabase.co',publicKey:'sb_publishable_Vt667mySP1lopI8X',anon:'" + jwt('anon') + "'};";
  fs.writeFileSync(path.join(d, 'config.js'), pub);
  fs.writeFileSync(path.join(d, 'index.html'), '<p>mask-image: url(x); task-list</p>');   // "sk-" dentro de palavra não é chave
  assert.deepEqual(varrerSegredos(d), []);
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'app.js'), "const k='sb_secret_AbCdEf123456';const t='" + jwt('service_role') + "';");
  fs.writeFileSync(path.join(d, 'x.txt'), '-----BEGIN PRIVATE KEY-----\nabc');
  fs.writeFileSync(path.join(d, '_headers'), 'X-Token: ghp_' + 'a'.repeat(36));
  const a = varrerSegredos(d).join(' | ');
  for (const re of [/sub\/app\.js: chave secreta do Supabase/, /sub\/app\.js: token com papel "service_role"/, /x\.txt: chave privada/, /_headers: token do GitHub/]) assert.match(a, re);
  fs.rmSync(d, { recursive: true, force: true });
});

test('varredura de segredos: os pacotes de verdade estão limpos', () => {
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  assert.deepEqual(varrerSegredos(path.join(raiz, 'site')), []);
  assert.deepEqual(varrerSegredos(path.join(raiz, 'seguranca')), []);
});

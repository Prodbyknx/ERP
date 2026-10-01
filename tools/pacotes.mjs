// Gera os dois pacotes de entrega a partir do MESMO código:
//   dist/SUBIR-NO-CLOUDFLARE.zip  -> vai pro Cloudflare (fala com o Supabase)
//   dist/144lab-teste.zip         -> abre com dois cliques, dados só no navegador
// O index.html do teste é derivado do de produção: troca só as 3 tags da nuvem
// pelo teste.js. Assim os dois nunca ficam diferentes por esquecimento.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const site = path.join(raiz, 'site');
const dist = path.join(raiz, 'dist');

const TAGS_NUVEM = [
  '<script src="config.js"></script>',
  '<script src="supabase.min.js"></script>',
  '<script src="cloud.js"></script>'
];
const SO_PRODUCAO = new Set(['config.js', 'supabase.min.js', 'cloud.js', '_headers']);
const DOCS_TESTE = ['teste.js', 'LEIA-ME.txt', 'AUDITORIA.txt', 'FERRAMENTAS.txt', 'laboratorio-fotos-3d.html', 'laboratorio-fotos-3d.js'];

export function indexDeTeste(html) {
  for (const t of TAGS_NUVEM) {
    if (!html.includes(t)) throw new Error('index.html sem a tag esperada: ' + t);
  }
  let out = html.replace(TAGS_NUVEM[0], '').replace(TAGS_NUVEM[1], '');
  out = out.replace(TAGS_NUVEM[2], '<script src="teste.js"></script>');
  if (!out.includes('<script src="html2pdf.bundle.min.js"></script>')) {
    throw new Error('index.html sem a tag do html2pdf');
  }
  return out;
}

function limpar(dir) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }

function copiarPasta(orig, dest, filtro) {
  for (const nome of fs.readdirSync(orig)) {
    if (filtro && !filtro(nome)) continue;
    const o = path.join(orig, nome), d = path.join(dest, nome);
    if (fs.statSync(o).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copiarPasta(o, d); }
    else fs.copyFileSync(o, d);
  }
}

// Nenhuma chave secreta pode sair num pacote. Varre TODO arquivo de texto e
// para a geração se achar: chave secreta do Supabase, token com papel
// service_role, chave privada, chaves de OpenAI/Anthropic/GitHub/Slack/Tripo.
// A chave PÚBLICA (sb_publishable_ ou token com papel anon) é a única permitida.
const SEGREDOS = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, 'chave secreta do Supabase'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'chave privada'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'chave da Anthropic'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, 'chave da OpenAI'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'token do GitHub'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'token do Slack'],
  [/\btsk_[A-Za-z0-9_-]{20,}/, 'chave do Tripo']
];
export function varrerSegredos(pasta) {
  const achados = [];
  const ver = (arq, txt) => {
    for (const [re, nome] of SEGREDOS) if (re.test(txt)) achados.push(path.relative(pasta, arq) + ': ' + nome);
    // tokens JWT: só o de papel "anon" pode ir para o site
    for (const m of txt.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      let papel = null;
      try { papel = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role; } catch { /* não é token */ }
      if (papel && papel !== 'anon') achados.push(path.relative(pasta, arq) + ': token com papel "' + papel + '"');
    }
  };
  const andar = d => {
    for (const nome of fs.readdirSync(d)) {
      const f = path.join(d, nome);
      if (fs.statSync(f).isDirectory()) { andar(f); continue; }
      if (!/\.(js|mjs|html|css|json|txt|md|sql|toml|env|yml|yaml|_headers)$/i.test(nome) && nome !== '_headers') continue;
      ver(f, fs.readFileSync(f, 'utf8'));
    }
  };
  andar(pasta);
  return achados;
}

function zipar(pasta, arquivoZip) {
  fs.rmSync(arquivoZip, { force: true });
  execFileSync('zip', ['-r', '-q', '-X', arquivoZip, path.basename(pasta)], { cwd: path.dirname(pasta) });
}

export function gerarPacotes() {
  fs.mkdirSync(dist, { recursive: true });
  const prod = path.join(dist, 'SUBIR-NO-CLOUDFLARE');
  const teste = path.join(dist, '144lab-teste');
  limpar(prod); limpar(teste);

  copiarPasta(site, prod);
  copiarPasta(site, teste, nome => !SO_PRODUCAO.has(nome) && nome !== 'index.html');
  fs.writeFileSync(path.join(teste, 'index.html'),
    indexDeTeste(fs.readFileSync(path.join(site, 'index.html'), 'utf8')));
  for (const d of DOCS_TESTE) fs.copyFileSync(path.join(raiz, 'teste', d), path.join(teste, d));
  // amostras geradas pelos testes (fotos sintéticas, 3MFs, benchmark), se existirem
  const amostras = path.join(teste, 'amostras');
  if (fs.existsSync(path.join(dist, 'ia-demo'))) { fs.mkdirSync(path.join(amostras, 'fotos-para-3d'), { recursive: true }); copiarPasta(path.join(dist, 'ia-demo'), path.join(amostras, 'fotos-para-3d')); }
  if (fs.existsSync(path.join(dist, 'pecas-modeladas-no-sistema.3mf'))) { fs.mkdirSync(amostras, { recursive: true }); fs.copyFileSync(path.join(dist, 'pecas-modeladas-no-sistema.3mf'), path.join(amostras, 'pecas-modeladas-no-sistema.3mf')); }

  // kit de verificação do Supabase (só no pacote de teste; nunca sobe pro Cloudflare),
  // já com o endereço e a chave PÚBLICA do config.js
  const kit = path.join(teste, 'seguranca');
  fs.mkdirSync(kit, { recursive: true });
  const cfg = fs.readFileSync(path.join(site, 'config.js'), 'utf8');
  const url = (/url:\s*'([^']+)'/.exec(cfg) || [])[1], chave = (/publicKey:\s*'([^']+)'/.exec(cfg) || [])[1];
  if (!url || !chave || !/^sb_publishable_/.test(chave)) throw new Error('config.js sem url/chave pública');
  for (const nome of fs.readdirSync(path.join(raiz, 'seguranca'))) {
    const orig = path.join(raiz, 'seguranca', nome);
    if (fs.statSync(orig).isDirectory()) { fs.mkdirSync(path.join(kit, nome), { recursive: true }); copiarPasta(orig, path.join(kit, nome)); continue; }
    let dados = fs.readFileSync(path.join(raiz, 'seguranca', nome));
    if (nome.endsWith('.html')) dados = dados.toString('utf8').replace('__SUPABASE_URL__', url).replace('__SUPABASE_CHAVE__', chave);
    fs.writeFileSync(path.join(kit, nome), dados);
  }

  const obrigatorios = ['index.html', 'app.js', 'html2pdf.bundle.min.js'];
  for (const p of [prod, teste]) {
    for (const f of obrigatorios) {
      if (!fs.existsSync(path.join(p, f))) throw new Error(path.basename(p) + ' sem ' + f);
    }
  }
  for (const p of [prod, teste]) {
    const achados = varrerSegredos(p);
    if (achados.length) throw new Error('SEGREDO no pacote ' + path.basename(p) + ' (não gerei): ' + achados.join('; '));
  }
  zipar(prod, path.join(dist, 'SUBIR-NO-CLOUDFLARE.zip'));
  zipar(teste, path.join(dist, '144lab-teste.zip'));
  return { prod, teste };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const r = gerarPacotes();
  for (const p of [r.prod, r.teste]) {
    console.log(path.basename(p) + ': ' + fs.readdirSync(p).join(', '));
  }
  console.log('zips em ' + dist);
}

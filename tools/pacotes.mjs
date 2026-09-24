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
const DOCS_TESTE = ['teste.js', 'LEIA-ME.txt', 'AUDITORIA.txt', 'FERRAMENTAS.txt'];

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

  const obrigatorios = ['index.html', 'app.js', 'html2pdf.bundle.min.js'];
  for (const p of [prod, teste]) {
    for (const f of obrigatorios) {
      if (!fs.existsSync(path.join(p, f))) throw new Error(path.basename(p) + ' sem ' + f);
    }
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

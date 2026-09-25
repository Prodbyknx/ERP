// Gera site/estudio3d.js (um arquivo só, carregado sob demanda pela aba
// Ferramentas). Dentro dele: interface + three.js + motor + worker (como texto)
// + WASM do Manifold em base64. Assim funciona até com o index.html aberto
// direto do disco (file://), sem servidor e sem CDN.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const r = p => path.resolve(raiz, p);

const comum = {
  bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], write: false,
  define: { 'import.meta.url': '"https://144lab.local/estudio3d.js"' },
  external: ['node:module'], legalComments: 'none', logLevel: 'warning'
};

export async function construir({ minificar = true, entrada = 'src/estudio3d/ui/entrada.js', saida = 'site/estudio3d.js' } = {}) {
  // no worker só entra o núcleo do three (a BVH de pontaria usa Box3/Vector3...),
  // sem o renderizador
  const w = await esbuild.build({ ...comum, entryPoints: [r('src/estudio3d/motor/worker.js')], minify: minificar, alias: { three: r('node_modules/three/build/three.core.js') } });
  const codigoWorker = w.outputFiles[0].text;
  const wasm = fs.readFileSync(r('node_modules/manifold-3d/manifold.wasm')).toString('base64');
  const versao = JSON.parse(fs.readFileSync(r('node_modules/manifold-3d/package.json'), 'utf8')).version;
  const m = await esbuild.build({
    ...comum,
    entryPoints: [r(entrada)],
    minify: minificar,
    define: {
      ...comum.define,
      __WORKER_CODIGO__: JSON.stringify(codigoWorker),
      __MANIFOLD_WASM__: JSON.stringify(wasm),
      __VERSAO_ESTUDIO__: JSON.stringify(new Date().toISOString().slice(0, 10))
    },
    banner: { js: '/* 144 Laboratorio 3D - Estudio 3D. Gerado por tools/build.mjs a partir de src/estudio3d (nao editar aqui).\n   Inclui three.js (MIT), three-mesh-bvh (MIT), Manifold ' + versao + ' (Apache-2.0), fflate (MIT), earcut (ISC). */' }
  });
  const destino = r(saida);
  fs.writeFileSync(destino, m.outputFiles[0].text);
  return { destino, bytes: fs.statSync(destino).size, worker: codigoWorker.length, wasm: wasm.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const dev = process.argv.includes('--dev');
  const x = await construir({ minificar: !dev });
  console.log('gerado', path.relative(raiz, x.destino), (x.bytes / 1024 / 1024).toFixed(2) + ' MB', '(worker ' + (x.worker / 1024).toFixed(0) + ' KB, wasm ' + (x.wasm / 1024).toFixed(0) + ' KB b64)');
}

// Linha de comando do gerador local (silhuetas, sem IA), usada pelo
// servidor-ia/ e pra testar fora do navegador:
//   node tools/fotos-para-3d.mjs --altura 60 --saida modelo.3mf frente=f.png costas=c.png esquerda=e.png direita=d.png
// Saída: 3MF (mm, com cores) + relatório JSON no stdout.
import fs from 'node:fs';
import Module from 'manifold-3d';
import { definirManifold } from '../src/estudio3d/core/solidos.js';
import { executar } from '../src/estudio3d/motor/operacoes.js';
import { lerPNG } from '../src/estudio3d/core/formatos/png.js';

const args = process.argv.slice(2), opc = { alturaMM: 60 }, entradas = [];
let saida = 'modelo.3mf';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--altura') opc.alturaMM = +args[++i];
  else if (a === '--saida') saida = args[++i];
  else if (a === '--resolucao') opc.resolucao = +args[++i];
  else if (a.includes('=')) { const [vista, arq] = a.split('='); const p = lerPNG(fs.readFileSync(arq)); entradas.push({ vista, rgba: p.rgba, w: p.w, h: p.h }); }
  else { console.error('Argumento desconhecido: ' + a); process.exit(2); }
}
if (!entradas.length) { console.error('Uso: node tools/fotos-para-3d.mjs --altura 60 --saida modelo.3mf frente=f.png ...'); process.exit(2); }
try {
  const w = await Module(); w.setup(); definirManifold(w);
  const r = executar('fotosPara3D', { entradas, opc });
  const x = executar('exportar3MF', { cena: { objetos: [{ nome: r.nome, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], partes: [{ nome: r.nome, malha: r.malha, cor: r.cor, paleta: r.paleta }] }] }, opc: {} });
  fs.writeFileSync(saida, x.bytes);
  console.log(JSON.stringify({ ok: true, saida, relatorio: r.relatorio }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, erro: e.message }));
  process.exit(1);
}

// Monta o MCP do 144 Lab pra instalar no computador (não vai pro Cloudflare):
//   dist/144lab-mcp/144lab-3d.mcpb   extensão do Claude Desktop (1 clique)
//   dist/144lab-mcp/144lab-mcp.mjs   servidor num arquivo só (Claude Code /
//                                    config manual; precisa do Node 18+)
//   dist/144lab-mcp/LEIA-ME.txt
//   dist/144lab-mcp.zip              tudo junto
// O manifesto é validado contra o esquema oficial MCPB 0.2 (tools/mcpb).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import Ajv from 'ajv';
import { extrairDoSite } from '../mcp/fonte-site.mjs';
import { escreverZip } from '../src/estudio3d/core/formatos/zip.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = p => path.join(raiz, p);
export const VERSAO_MCP = '1.0.0';

const FERRAMENTAS = [
  ['gerar_chaveiro', 'Chaveiro, medalha, placa ou contorno a partir de texto, imagem ou forma — argola, tag NFC e cores'],
  ['analisar_peca', 'Medidas, peso e problemas de impressão de um STL/3MF/OBJ'],
  ['consertar_peca', 'Fecha buracos, desvira faces e vira sólido pronto pra imprimir'],
  ['suavizar_peca', 'Alisa sem encolher (grão e caroço de modelo de IA)'],
  ['cortar_peca', 'Corta num plano com pinos de encaixe'],
  ['separar_por_cor', 'Cada cor pintada vira uma peça que encaixa'],
  ['converter_peca', 'STL/OBJ/3MF para 3MF com cor ou STL, com escala'],
  ['pastas_do_mcp', 'Onde os arquivos são salvos e lidos']
];

export function manifesto() {
  return {
    manifest_version: '0.2',
    name: '144lab-3d',
    display_name: '144 Laboratório 3D — Peças 3D',
    version: VERSAO_MCP,
    description: 'Gera chaveiro, medalha e placa (texto, imagem ou forma) e analisa, conserta, suaviza, corta com pinos, separa por cor e converte peças STL/3MF — o motor do 144 Lab, no seu computador.',
    long_description: 'Tudo roda no seu computador, sem internet e sem acessar dados do negócio. Os arquivos gerados vão pra pasta de trabalho (padrão: 144lab-mcp na sua pasta de usuário). O MCP só lê arquivos da sua pasta de usuário e das pastas que você liberar, e nunca sobrescreve um arquivo sem pedir.',
    author: { name: '144 Laboratório 3D' },
    server: {
      type: 'node',
      entry_point: 'server/144lab-mcp.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/144lab-mcp.mjs', '${user_config.outras_pastas}'],
        env: { SAIDA_144LAB: '${user_config.pasta_trabalho}' }
      }
    },
    tools: FERRAMENTAS.map(([name, description]) => ({ name, description })),
    keywords: ['impressão 3D', '3MF', 'STL', 'chaveiro', 'Bambu Studio'],
    compatibility: { platforms: ['win32', 'darwin', 'linux'], runtimes: { node: '>=18.0.0' } },
    user_config: {
      pasta_trabalho: { type: 'directory', title: 'Pasta de trabalho', description: 'Onde os arquivos gerados são salvos (e de onde dá pra ler pelo nome). Vazio = 144lab-mcp na sua pasta de usuário.', required: false },
      outras_pastas: { type: 'directory', title: 'Outras pastas pra ler', description: 'Pastas fora da sua pasta de usuário de onde o MCP pode abrir STL, 3MF e imagens (opcional).', required: false, multiple: true }
    }
  };
}

function leiaMe() {
  return `144 LABORATÓRIO 3D — MCP DE PEÇAS 3D (versão ${VERSAO_MCP})
=====================================================

O que é: um conjunto de ferramentas que o Claude usa pra criar e arrumar
peças 3D no SEU computador — o mesmo motor do sistema (gerador de chaveiro,
Estúdio 3D). Não usa internet e não acessa os dados do negócio.

FERRAMENTAS
${FERRAMENTAS.map(([n, d]) => '  ' + n.padEnd(16) + d).join('\n')}

INSTALAR NO CLAUDE DESKTOP (mais fácil)
  1. Dê dois cliques em 144lab-3d.mcpb (ou arraste o arquivo pra janela do
     Claude Desktop, em Configurações > Extensões) e confirme a instalação.
  2. Opcional: escolha a "Pasta de trabalho" (onde os arquivos são salvos).
     Sem escolher, vai pra 144lab-mcp dentro da sua pasta de usuário.
  Se aparecer erro de Node, instale o Node.js LTS (nodejs.org) e tente de novo.

INSTALAR NO CLAUDE CODE (precisa do Node.js 18 ou mais novo)
  claude mcp add 144lab-3d -- node "CAMINHO\\144lab-mcp.mjs"
  Pra escolher a pasta de trabalho:
  claude mcp add 144lab-3d -e SAIDA_144LAB="C:\\Users\\voce\\Documents\\144lab" -- node "CAMINHO\\144lab-mcp.mjs"

CONFIGURAÇÃO MANUAL (claude_desktop_config.json)
  {
    "mcpServers": {
      "144lab-3d": {
        "command": "node",
        "args": ["C:\\\\caminho\\\\144lab-mcp.mjs"],
        "env": { "SAIDA_144LAB": "C:\\\\Users\\\\voce\\\\Documents\\\\144lab" }
      }
    }
  }

PASTAS (segurança)
  - Salva SÓ na pasta de trabalho (SAIDA_144LAB). Nome de arquivo com
    caminho ("../") é limpo; nunca sobrescreve sem pedir (cria "nome (2)").
  - Lê SÓ da sua pasta de usuário (ou PASTAS_144LAB) e das pastas extras.
  - Aceita só STL, 3MF, OBJ (até 300 MB) e PNG/JPG (até 25 MB, 40 MP).

EXEMPLOS DE PEDIDO PRO CLAUDE
  "Faz um chaveiro escrito LUNA, 60 mm, fonte Arial Black, argola no meio"
  "Transforma C:\\...\\logo.png num chaveiro de 2 cores com espaço pra tag NFC"
  "Analisa o boneco.stl e conserta se tiver problema"
  "Suaviza a cabeca.3mf no médio e corta ao meio com pinos"
  "Converte peca.stl pra 3MF vermelho"
`;
}

export async function montarMCP() {
  const destino = r('dist/144lab-mcp');
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(path.join(destino, 'server'), { recursive: true });
  // 1) manifesto válido pelo esquema oficial
  const man = manifesto();
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const ok = ajv.validate(JSON.parse(fs.readFileSync(r('tools/mcpb/manifest-v0.2.schema.json'), 'utf8')), man);
  if (!ok) throw new Error('manifest.json inválido: ' + ajv.errorsText(ajv.errors));
  // 2) servidor num arquivo só (motor 3D, WASM e o gerador do site embutidos)
  const saida = path.join(destino, 'server', '144lab-mcp.mjs');
  await esbuild.build({
    entryPoints: [r('mcp/servidor.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile: saida,
    legalComments: 'none', minify: true, logLevel: 'warning',
    banner: { js: "import { createRequire as __cr144 } from 'node:module'; const require = __cr144(import.meta.url);" },
    define: {
      __WASM_B64__: JSON.stringify(fs.readFileSync(r('node_modules/manifold-3d/manifold.wasm')).toString('base64')),
      __VERSAO_MCP__: JSON.stringify(VERSAO_MCP),
      __CODIGO_GERADOR__: JSON.stringify(extrairDoSite(fs.readFileSync(r('site/app.js'), 'utf8')))
    }
  });
  const servidor = fs.readFileSync(saida);
  fs.writeFileSync(path.join(destino, 'manifest.json'), JSON.stringify(man, null, 2));
  // 3) extensão .mcpb (zip com manifest.json na raiz)
  const mcpb = escreverZip([{ nome: 'manifest.json', dados: JSON.stringify(man, null, 2) }, { nome: 'server/144lab-mcp.mjs', dados: servidor }]);
  fs.writeFileSync(path.join(destino, '144lab-3d.mcpb'), mcpb);
  fs.copyFileSync(saida, path.join(destino, '144lab-mcp.mjs'));
  fs.writeFileSync(path.join(destino, 'LEIA-ME.txt'), leiaMe());
  fs.rmSync(path.join(destino, 'server'), { recursive: true, force: true });
  fs.rmSync(path.join(destino, 'manifest.json'));
  const zip = escreverZip(['144lab-3d.mcpb', '144lab-mcp.mjs', 'LEIA-ME.txt'].map(n => ({ nome: '144lab-mcp/' + n, dados: fs.readFileSync(path.join(destino, n)) })));
  fs.writeFileSync(r('dist/144lab-mcp.zip'), zip);
  return { destino, servidor: servidor.length, mcpb: mcpb.length, zip: zip.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const x = await montarMCP();
  console.log('MCP: servidor ' + (x.servidor / 1048576).toFixed(2) + ' MB, .mcpb ' + (x.mcpb / 1048576).toFixed(2) + ' MB, zip ' + (x.zip / 1048576).toFixed(2) + ' MB em ' + path.relative(raiz, x.destino));
}

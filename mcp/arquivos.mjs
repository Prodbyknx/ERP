// Onde o MCP pode LER e GRAVAR (segurança):
//  - lê só dentro das pastas liberadas (padrão: a pasta do usuário), e só
//    extensões conhecidas, com limite de tamanho
//  - grava só na pasta de saída (padrão: ~/144lab-mcp), com nome limpo (sem
//    caminho) e sem sobrescrever, a não ser que peçam
// Variáveis: PASTAS_144LAB (lista, separada por ; no Windows e : no resto)
// e SAIDA_144LAB (pasta de saída).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LIMITE_MODELO = 300 * 1024 * 1024;
export const LIMITE_IMAGEM = 25 * 1024 * 1024;
const EXT_MODELO = ['.stl', '.3mf', '.obj'], EXT_IMAGEM = ['.png', '.jpg', '.jpeg'];

const real = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

// valor de configuração não preenchido (a extensão deixa "${user_config.x}")
const definido = v => typeof v === 'string' && v.trim() && !v.includes('${');
export function pastaSaida() {
  const p = path.resolve(definido(process.env.SAIDA_144LAB) ? process.env.SAIDA_144LAB : path.join(os.homedir(), '144lab-mcp'));
  fs.mkdirSync(p, { recursive: true });
  return real(p);
}
// leitura: PASTAS_144LAB (ou a pasta do usuário) + pastas passadas como
// argumento (a extensão do Claude Desktop passa as "outras pastas" assim)
export function pastasLiberadas() {
  const l = (definido(process.env.PASTAS_144LAB) ? process.env.PASTAS_144LAB : os.homedir()).split(path.delimiter).map(s => s.trim()).filter(Boolean);
  const args = process.argv.slice(2).filter(a => definido(a) && (() => { try { return fs.statSync(a).isDirectory(); } catch { return false; } })());
  return [...new Set([...l, ...args].map(p => real(path.resolve(p))).concat(pastaSaida()))];
}
const dentro = (p, raiz) => { const r = path.relative(raiz, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// caminho de entrada validado (existe, é arquivo, extensão e tamanho ok)
export function arquivoDeEntrada(caminho, tipo = 'modelo') {
  if (typeof caminho !== 'string' || !caminho.trim()) throw new Error('Informe o caminho do arquivo.');
  let p = caminho.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  // nome solto: procura na pasta de saída
  if (!path.isAbsolute(p) && !/[\\/]/.test(p)) p = path.join(pastaSaida(), p);
  p = path.resolve(p);
  if (!fs.existsSync(p)) throw new Error('Arquivo não encontrado: ' + p);
  const r = real(p);
  if (!pastasLiberadas().some(raiz => dentro(r, raiz))) throw new Error('Esse arquivo está fora das pastas liberadas pro MCP (' + pastasLiberadas().join(', ') + '). Mova o arquivo pra uma delas ou ajuste PASTAS_144LAB.');
  const st = fs.statSync(r);
  if (!st.isFile()) throw new Error('Não é um arquivo: ' + r);
  const ext = path.extname(r).toLowerCase(), ok = tipo === 'imagem' ? EXT_IMAGEM : EXT_MODELO;
  if (!ok.includes(ext)) throw new Error('Tipo de arquivo não aceito (' + (ext || 'sem extensão') + '). Aceito: ' + ok.join(', '));
  const lim = tipo === 'imagem' ? LIMITE_IMAGEM : LIMITE_MODELO;
  if (st.size > lim) throw new Error('Arquivo grande demais (' + (st.size / 1048576).toFixed(0) + ' MB). Máximo ' + lim / 1048576 + ' MB.');
  return { caminho: r, nome: path.basename(r), bytes: new Uint8Array(fs.readFileSync(r)) };
}

// nome de saída limpo, sempre dentro da pasta de saída
export function arquivoDeSaida(nome, extPadrao, sobrescrever = false) {
  let base = path.basename(String(nome || 'peca')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'peca';
  let ext = path.extname(base).toLowerCase();
  if (!['.stl', '.3mf', '.zip', '.png'].includes(ext)) { base += extPadrao; ext = extPadrao; }
  const pasta = pastaSaida();
  let p = path.join(pasta, base);
  if (!sobrescrever) {
    const raiz = base.slice(0, base.length - ext.length);
    for (let i = 2; fs.existsSync(p); i++) p = path.join(pasta, raiz + ' (' + i + ')' + ext);
  }
  if (!dentro(path.resolve(p), pasta)) throw new Error('Nome de arquivo inválido.');
  return p;
}

export function gravar(caminho, bytes) {
  fs.writeFileSync(caminho, bytes);
  return { caminho, kb: Math.round(fs.statSync(caminho).size / 1024) };
}

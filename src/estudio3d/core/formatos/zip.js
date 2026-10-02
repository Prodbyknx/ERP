// ZIP via fflate (roda igual no navegador, no worker e no Node)
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

// filtro(nome) opcional: só descompacta o que precisa (3MF fatiado traz o
// G-code inteiro e imagens que a leitura do modelo não usa)
export function lerZip(bytes, filtro = null) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const brutos = filtro ? unzipSync(u8, { filter: f => filtro(f.name.replace(/\\/g, '/').replace(/^\/+/, '')) }) : unzipSync(u8);
  // caminhos sem barra inicial e com '/' (alguns programas gravam '\')
  const out = {};
  for (const k of Object.keys(brutos)) out[k.replace(/\\/g, '/').replace(/^\/+/, '')] = brutos[k];
  return out;
}

// arquivos: [{ nome, dados: Uint8Array|string }] — a ordem é mantida
export function escreverZip(arquivos, nivel = 6) {
  const obj = {};
  for (const a of arquivos) {
    const d = typeof a.dados === 'string' ? strToU8(a.dados) : a.dados;
    obj[a.nome] = [d, { level: a.nivel != null ? a.nivel : nivel }];
  }
  return zipSync(obj);
}

export const texto = u8 => strFromU8(u8);
export const bytes = s => strToU8(s);

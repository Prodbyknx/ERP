// Pipeline IMAGENS -> MODELO 3D -> REPARO -> (editor). Igual pra todo
// provedor: o resultado sai no mesmo formato de um arquivo aberto no Estúdio
// ({ nome, transform, partes }) e entra por estudio.adicionarObjetos().
// rodar(op, args) = motor (Web Worker no navegador, direto no Node).
import { VISTAS } from './reconstrucao.js';

const IDENTIDADE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function conferirEntradas(provedor, entradas) {
  const vistas = entradas.map(e => e.vista);
  for (const v of vistas) if (!VISTAS[v]) throw new Error('Vista desconhecida: ' + v);
  if (new Set(vistas).size !== vistas.length) throw new Error('Tem duas fotos marcadas com a mesma vista.');
  const fora = vistas.filter(v => !provedor.vistas.aceitas.includes(v));
  if (fora.length) throw new Error(provedor.nome + ' não usa as vistas: ' + fora.map(v => VISTAS[v].nome).join(', ') + '.');
  if (vistas.length < provedor.vistas.minimo) throw new Error(provedor.nome + ' precisa de pelo menos ' + provedor.vistas.minimo + ' fotos.');
}

// opc: { alturaMM, nome, ...opções do provedor }; ctl: { progresso, sinal }
export async function gerarDeFotos(provedor, entradas, opc, rodar, ctl = {}) {
  conferirEntradas(provedor, entradas);
  const t0 = Date.now();
  const bruto = await provedor.gerar(entradas, opc, ctl);
  const tGerar = Date.now() - t0;
  let partes = bruto.partes;
  if (bruto.arquivo) {
    // mesmo caminho de "Abrir arquivo" do Estúdio
    const imp = await rodar('importar', { nome: bruto.arquivo.nome, bytes: bruto.arquivo.bytes, extras: {} });
    partes = [];
    for (const o of imp.objetos) for (const p of o.partes) partes.push(o.transform ? { ...p, malha: await aplicar(rodar, p, o.transform) } : p);
    if (!partes.length) throw new Error('O arquivo do gerador veio vazio.');
  }
  if (ctl.progresso) ctl.progresso(0.9, 'Consertando, alinhando com as fotos e medindo');
  const pos = await rodar('posProcessarIA', { partes, entradas: entradas.map(({ vista, rgba, w, h }) => ({ vista, rgba, w, h })), opc: { ...opc, eixoCima: provedor.eixoCima } });
  const relatorio = { provedor: provedor.id, ...pos.relatorio, geracao: bruto.relatorio || null, tempos: { gerarMs: tGerar, totalMs: Date.now() - t0 } };
  return { objeto: { nome: opc.nome || 'Modelo das fotos', transform: IDENTIDADE.slice(), partes: [pos.parte] }, relatorio };
}

async function aplicar(rodar, parte, T) {
  let ident = true; for (let i = 0; i < 16; i++) if (Math.abs(T[i] - IDENTIDADE[i]) > 1e-12) ident = false;
  if (ident) return parte.malha;
  const r = await rodar('transformarParte', { parte, transform: T });
  return r.parte.malha;
}

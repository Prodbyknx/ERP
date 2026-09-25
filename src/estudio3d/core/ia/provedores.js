// ImageTo3DProvider: contrato ÚNICO pra qualquer gerador de 3D por fotos.
// Trocar de modelo (silhuetas local, Hunyuan3D-2mv, TRELLIS, um que saia
// amanhã) = trocar o provedor; o resto do pipeline (consertar, alinhar,
// medir, entrar no editor) não muda.
//
// provedor = {
//   id, nome, onde: 'local' | 'servidor', licenca,
//   vistas: { aceitas: [...], minimo },       // nomes de VISTAS
//   requisitos: { gpu, vramGB },
//   eixoCima: 'Z' | 'Y',                     // convenção da malha que ele devolve
//   disponivel(): Promise<{ ok, motivo?, info? }>,
//   gerar(entradas, opc, ctl): Promise<{ partes } | { arquivo: { nome, bytes } }>
// }
// entradas: [{ vista, rgba, w, h, png? }]; ctl: { progresso(frac, texto), sinal: AbortSignal }
import { VISTAS } from './reconstrucao.js';

const TODAS = Object.keys(VISTAS);

// Local, sem IA: casca visual pelas silhuetas (CPU, ~1 s). rodar(op, args) = motor.
export function provedorSilhuetas(rodar) {
  return {
    id: 'silhuetas', nome: 'Silhuetas (local, sem IA)', onde: 'local', licenca: 'código próprio',
    vistas: { aceitas: TODAS, minimo: 2 }, requisitos: { gpu: false, vramGB: 0 }, eixoCima: 'Z',
    async disponivel() { return { ok: true } },
    async gerar(entradas, opc = {}, ctl = {}) {
      if (ctl.progresso) ctl.progresso(0.1, 'Recortando as fotos e cruzando as silhuetas');
      const r = await rodar('fotosPara3D', { entradas, opc });
      return { partes: [{ nome: r.nome, malha: r.malha, cor: r.cor, paleta: r.paleta }], relatorio: r.relatorio };
    }
  };
}

// Servidor próprio com GPU (servidor-ia/). Protocolo HTTP simples de tarefa:
//   GET  /saude                  -> { ok, gpu, vramGB, modelos: [{ id, nome, vistas, minimo, eixoCima, licenca }] }
//   POST /tarefas                -> { id }        corpo: { modelo, opc, vistas: [{ vista, png(base64) }] }
//   GET  /tarefas/{id}           -> { estado: 'fila'|'rodando'|'pronto'|'erro', posicao, progresso, erro }
//   GET  /tarefas/{id}/resultado -> arquivo (3MF/GLB/OBJ/STL), nome no cabeçalho X-Arquivo
//   DELETE /tarefas/{id}         -> cancela
export function provedorServidor(cfg) {
  const url = cfg.url.replace(/\/+$/, ''), f = cfg.fetch || globalThis.fetch.bind(globalThis);
  const cab = cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {};
  const esperar = cfg.esperar || (ms => new Promise(r => setTimeout(r, ms)));
  let info = null;
  const json = async (caminho, init = {}) => {
    const r = await f(url + caminho, { ...init, headers: { ...cab, ...(init.headers || {}) } });
    const txt = await r.text();
    let d = null; try { d = JSON.parse(txt); } catch (e) { /* não-JSON */ }
    if (!r.ok) throw new Error((d && d.erro) || ('Servidor respondeu ' + r.status));
    return d;
  };
  const p = {
    id: 'servidor:' + cfg.modelo, nome: cfg.nome || cfg.modelo, onde: 'servidor', licenca: '(ver servidor)',
    vistas: { aceitas: TODAS, minimo: 1 }, requisitos: { gpu: true, vramGB: null }, eixoCima: 'Y',
    async disponivel() {
      try {
        info = await json('/saude');
        const m = (info.modelos || []).find(x => x.id === cfg.modelo);
        if (!m) return { ok: false, motivo: 'O servidor não tem o modelo "' + cfg.modelo + '".', info };
        Object.assign(p, { nome: m.nome || p.nome, licenca: m.licenca || p.licenca, eixoCima: m.eixoCima || p.eixoCima, vistas: { aceitas: m.vistas || TODAS, minimo: m.minimo || 1 }, requisitos: { gpu: !!info.gpu, vramGB: m.vramGB || null } });
        return { ok: true, info };
      } catch (e) { return { ok: false, motivo: 'Servidor de IA fora do ar: ' + e.message }; }
    },
    async gerar(entradas, opc = {}, ctl = {}) {
      const vistas = entradas.map(e => {
        if (!e.png) throw new Error('O servidor precisa do arquivo da foto (PNG/JPG) da vista ' + e.vista + '.');
        return { vista: e.vista, png: base64(e.png) };
      });
      const { id } = await json('/tarefas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelo: cfg.modelo, opc, vistas }) });
      const cancelar = () => f(url + '/tarefas/' + id, { method: 'DELETE', headers: cab }).catch(() => {});
      if (ctl.sinal) ctl.sinal.addEventListener('abort', cancelar, { once: true });
      try {
        for (;;) {
          if (ctl.sinal && ctl.sinal.aborted) throw new Error('Cancelado.');
          const e = await json('/tarefas/' + id);
          if (e.estado === 'erro') throw new Error('O gerador falhou: ' + (e.erro || 'sem detalhe'));
          if (e.estado === 'pronto') break;
          if (ctl.progresso) ctl.progresso(e.progresso || 0, e.estado === 'fila' ? 'Na fila (' + (e.posicao || 1) + 'º)' : 'Gerando na GPU');
          await esperar(cfg.intervaloMs || 1000);
        }
        const r = await f(url + '/tarefas/' + id + '/resultado', { headers: cab });
        if (!r.ok) throw new Error('Não consegui baixar o resultado (' + r.status + ').');
        const nome = r.headers.get('X-Arquivo') || 'resultado.glb';
        return { arquivo: { nome, bytes: new Uint8Array(await r.arrayBuffer()) } };
      } finally { if (ctl.sinal) ctl.sinal.removeEventListener('abort', cancelar); }
    }
  };
  return p;
}

function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Painel 7 — exportar 3MF (Bambu Studio) e STL
import { el, baixar, avisar, nomeArquivo } from '../util.js';
import { nomeDaCor } from '../../core/cores.js';

export function montarExportar(est) {
  const d = el('details', { 'data-sec': 'exp' });
  d.innerHTML = `<summary><span class="n">7</span>Exportar</summary><div class="e3d-sec">
    <div class="field"><label>O que exportar</label>
      <div class="seg" data-a="escopo"><button type="button" data-v="tudo" class="active">Tudo na mesa</button><button type="button" data-v="sel">Só o objeto escolhido</button></div></div>
    <div class="field"><label>Nome do arquivo</label><input type="text" data-a="nome" placeholder="modelo"></div>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="3mf">Baixar 3MF (Bambu Studio / Orca)</button></div>
    <div class="e3d-nota" data-a="cores"></div>
    <p class="u">No Bambu Studio, ao abrir, ele mostra as cores do arquivo e cria os filamentos com o MESMO código de cor — confira e dê OK. Cada objeto daqui vira um objeto lá; peças de um objeto viram partes, cada uma no seu filamento. Medidas em mm, na mesma posição.</p>
    <div style="margin-top:12px;border-top:1px solid var(--line-soft);padding-top:10px">
      <div class="e3d-titulo">STL</div>
      <div class="seg" data-a="stlModo"><button type="button" data-v="obj" class="active">Um arquivo por objeto</button><button type="button" data-v="peca">Um por peça</button></div>
      <p class="u">STL não guarda cor nem material (limite do formato). Vários arquivos saem num .zip.</p>
      <div class="e3d-botoes"><button class="btn" data-a="stl">Baixar STL</button></div>
    </div>
    <div data-a="res"></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let escopo = 'tudo', stlModo = 'obj';
  const seg = (k, fn) => q(k).addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; q(k).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); fn(b.dataset.v); render(); });
  seg('escopo', v => { escopo = v; });
  seg('stlModo', v => { stlModo = v; });

  function objetos() {
    const lista = escopo === 'sel' ? [est.objetoAtual()].filter(Boolean) : est.cena.objetos.filter(o => o.visivel);
    return lista.map(o => ({ ...est.paraMotor(o), partes: o.partes.filter(p => p.visivel !== false).map(p => est.parteParaMotor(p)) })).filter(o => o.partes.length);
  }
  function render() {
    const objs = objetos();
    const cores = new Map();
    for (const o of objs) for (const p of o.partes) { cores.set(p.cor, (cores.get(p.cor) || 0) + 1); if (p.paleta) p.paleta.forEach(h => cores.set(h, cores.get(h) || 0)); }
    q('cores').innerHTML = objs.length
      ? '<b>' + objs.length + ' objeto(s), ' + cores.size + ' cor(es):</b> ' + [...cores.keys()].map((h, i) => '<span style="white-space:nowrap"><span class="e3d-bola" style="display:inline-block;vertical-align:-2px;background:' + h + '"></span> ' + (i + 1) + ': ' + nomeDaCor(h) + ' <span class="e3d-cores-hex">' + h + '</span></span>').join(' · ')
      : 'Nada pra exportar.';
    if (!q('nome').value && objs[0]) q('nome').placeholder = nomeArquivo(objs[0].nome);
  }
  async function exp3mf() {
    const objs = objetos();
    if (!objs.length) { avisar('Nada pra exportar.', 'warn'); return; }
    const fora = objs.filter(o => { const c = est.cena.caixaExata(est.cena.objetos.find(x => x.nome === o.nome) || o); return c && c.min[2] < -0.01; });
    const nome = nomeArquivo(q('nome').value || objs[0].nome);
    q('3mf').disabled = true;
    try {
      const miniatura = await est.visor.miniatura(256).catch(() => null);
      const r = await est.rodar('exportar3MF', { cena: { objetos: objs }, opc: { titulo: q('nome').value || objs[0].nome, miniatura } }, 'Exportar 3MF');
      baixar(r.bytes, nome + '.3mf', 'model/3mf');
      q('res').innerHTML = '<div class="e3d-nota ok">3MF gerado: ' + r.cores.length + ' filamento(s) na ordem ' + r.cores.map((h, i) => (i + 1) + '=' + h).join(', ') + '.' + (r.avisos.length ? '<br>' + r.avisos.join('<br>') : '') + (fora.length ? '<br>Atenção: tem objeto abaixo da mesa (Z negativo) — o Bambu vai subir ele.' : '') + '</div>';
    } finally { q('3mf').disabled = false; }
  }
  async function expStl() {
    const objs = objetos();
    if (!objs.length) { avisar('Nada pra exportar.', 'warn'); return; }
    const r = await est.rodar('exportarSTL', { cena: { objetos: objs }, opc: { porPeca: stlModo === 'peca' } }, 'Exportar STL');
    const nome = nomeArquivo(q('nome').value || objs[0].nome);
    if (r.zip) baixar(r.bytes, nome + '-stl.zip', 'application/zip');
    else baixar(r.bytes, r.nome || nome + '.stl', 'model/stl');
    q('res').innerHTML = '<div class="e3d-nota ok">' + (r.zip ? r.arquivos.length + ' arquivos STL no zip.' : 'STL gerado.') + '</div>';
  }
  q('3mf').onclick = exp3mf;
  q('stl').onclick = expStl;
  d.addEventListener('toggle', () => { if (d.open) render(); });
  est.on('mudou', () => { if (d.open) render(); });
  est.on('selecao', () => { if (d.open) render(); });
  return { el: d, render, exp3mf };
}

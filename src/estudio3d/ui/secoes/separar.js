// Painel 4 — separar para impressão: região selecionada vira peça
// independente, as DUAS fechadas; separar por cor/material e por casca.
import { el, fmt, lerNumero, avisar } from '../util.js';
import { novaParte, novoObjeto } from '../cena.js';
import { nomeDaCor } from '../../core/cores.js';
import { caixa } from '../../core/malha.js';
import * as M4 from '../../core/mat4.js';

const LEGENDA = [['#0e9f2e', 'peça que sai'], ['#6b7075', 'o que fica'], ['#0659f2', 'face nova (corte/encaixe)']];

export function montarSeparar(est) {
  const d = el('details', { 'data-sec': 'sep' });
  d.innerHTML = `<summary><span class="n">4</span>Separar para impressão</summary><div class="e3d-sec">
    <p class="u"><b>1.</b> Clique no detalhe no 3D (a seleção para na dobra). <b>2.</b> Ajuste abaixo. <b>3.</b> Veja a prévia e confirme. As duas peças saem fechadas, prontas pro fatiador. O original volta com Desfazer.</p>
    <div class="e3d-nota" data-a="status">Nenhum detalhe selecionado — clique nele no 3D.</div>
    <div class="field" style="margin-top:12px"><label>Nome da peça separada</label><input type="text" data-a="nome" placeholder="Ex.: Orelha esquerda"></div>
    <div class="field"><label>Como fechar</label>
      <div class="seg" data-a="modo"><button type="button" data-v="auto" class="active">Automático</button><button type="button" data-v="plano">Corte plano</button><button type="button" data-v="superficie">Seguir a superfície</button></div>
      <p class="u" style="margin:0">Automático: corte plano na base do detalhe (face lisa pra colar e imprimir); se o plano pegaria outra parte, segue a superfície.</p></div>
    <div class="e3d-l2">
      <div class="field"><label>Espessura extra <span class="u">mm</span></label><input type="text" data-a="esp" value="0"></div>
      <div class="field"><label>Folga do bolso <span class="u">mm por lado</span></label><input type="text" data-a="folga" value="0"></div>
    </div>
    <p class="u" style="margin-top:-4px">Espessura &gt; 0: o detalhe desce pra dentro da peça e deixa um bolso do mesmo formato — use pra olho, símbolo ou logo que é só pintura na superfície.</p>
    <div class="field"><label>Encaixe</label><select data-a="con">
      <option value="nenhum">Sem encaixe (colar)</option>
      <option value="cilindrico">Pino cilíndrico no detalhe, furo na peça</option>
      <option value="quadrado">Pino quadrado</option>
      <option value="hexagonal">Pino hexagonal</option></select></div>
    <div class="e3d-l3" data-a="conOpc" style="display:none">
      <div><label>Ø / lado</label><input type="text" data-a="cd" value="3"></div>
      <div><label>Profund.</label><input type="text" data-a="cp" value="3"></div>
      <div><label>Folga</label><input type="text" data-a="cf" value="0,2"></div>
    </div>
    <p class="u" data-a="conInfo"></p>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="ir">Pré-visualizar separação</button></div>
    <div data-a="res"></div>
    <div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">
      <div class="e3d-titulo">Separar por cor ou material</div>
      <p class="u">Cada cor vira uma peça física (corpo preto, olhos brancos, detalhe vermelho…) pra imprimir sem AMS e montar depois. Região só pintada ganha a espessura abaixo.</p>
      <div class="e3d-l2"><div class="field"><label>Espessura da peça colorida</label><input type="text" data-a="espCor" value="0,8"></div>
        <div class="field"><label>Folga do bolso</label><input type="text" data-a="folgaCor" value="0,1"></div></div>
      <div class="e3d-botoes"><button class="btn" data-a="porCor">Separar por cor</button><button class="btn" data-a="cascas" title="Cada ilha solta da malha vira um objeto">Separar cascas soltas</button></div>
    </div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let modo = 'auto';
  q('modo').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; modo = b.dataset.v; q('modo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); });
  const atualizarCon = () => {
    const t = q('con').value;
    q('conOpc').style.display = t === 'nenhum' ? 'none' : '';
    const dd = lerNumero(q('cd').value, 3), f = lerNumero(q('cf').value, 0.2);
    q('conInfo').textContent = t === 'nenhum' ? '' : 'Pino ' + fmt(dd, 2) + ' mm → furo ' + fmt(dd + 2 * f, 2) + ' mm (folga ' + fmt(f, 2) + ' por lado).';
  };
  ['con', 'cd', 'cf'].forEach(k => q(k).addEventListener('input', atualizarCon));
  atualizarCon();
  est.on('faces', ({ parte, n }) => {
    q('status').className = 'e3d-nota' + (n ? ' ok' : '');
    q('status').innerHTML = n ? '<b>' + n.toLocaleString('pt-BR') + ' faces</b> selecionadas em ' + parte.nome + '. Ajuste abaixo e veja a prévia.' : 'Nenhum detalhe selecionado — clique nele no 3D.';
  });
  est.on('nome-sugerido', n => { if (!q('nome').value || q('nome').dataset.auto) { q('nome').value = n; q('nome').dataset.auto = '1'; } });
  q('nome').addEventListener('input', () => { delete q('nome').dataset.auto; });

  // direção de "explosão" da prévia: normal do plano no mundo
  const dirMundo = (o, n) => { const v = M4.aplicarDirecao(o.transform, n[0], n[1], n[2]); const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

  async function separar() {
    const o = est.objetoAtual(), p = est.parteAtual();
    if (!o || !p) { avisar('Clique no detalhe da peça no 3D pra selecionar.', 'warn'); return; }
    const mask = est.visor.selecao(p.id);
    if (!mask) { avisar('Clique no detalhe no 3D primeiro (ou use Selecionar pra pincel).', 'warn'); return; }
    const nome = q('nome').value.trim() || 'Detalhe';
    const con = q('con').value;
    const opc = {
      modo, profundidade: lerNumero(q('esp').value, 0), folga: lerNumero(q('folga').value, 0), nomeDetalhe: nome,
      conector: con === 'nenhum' ? null : { tipo: con, diametro: lerNumero(q('cd').value, 3), lado: lerNumero(q('cd').value, 3), profundidade: lerNumero(q('cp').value, 3), folga: lerNumero(q('cf').value, 0.2), quantidade: 1, parede: 0.8 }
    };
    q('ir').disabled = true;
    q('res').innerHTML = '<div class="e3d-nota">Separando…</div>';
    let r;
    try { r = await est.rodar('separarDetalhe', { parte: est.parteParaMotor(p), mascara: mask, opc }, 'Separar'); }
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + (e.message || e) + '</div>'; return; }
    finally { q('ir').disabled = false; }
    const cd = caixa(r.detalhe.malha);
    const tam = cd ? Math.max(...cd.tam) : 10;
    const dir = r.plano ? dirMundo(o, r.plano.n) : [0, 0, 1];
    const outras = o.partes.filter(x => x.id !== p.id).map(x => ({ malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal' }));
    const notas = [];
    if (r.metodos.includes('superficie')) notas.push('Fechado seguindo a superfície');
    if (r.metodos.includes('casca')) notas.push('A seleção já era uma peça solta');
    notas.push(...r.avisos);
    if (r.relatorio.length) notas.push('Encaixe: pino ' + r.relatorio[0].pino + ', furo ' + r.relatorio[0].furo + ', ' + fmt(r.relatorio[0].profundidade, 1) + ' mm');
    q('res').innerHTML = '<div class="e3d-nota ok">Prévia pronta: confira e confirme em cima do 3D.<br>Peça separada: ' + fmt(r.volumes.detalhe / 1000, 2) + ' cm³ · fica: ' + fmt(r.volumes.principal / 1000, 2) + ' cm³</div>';
    est.mostrarPrevia({
      titulo: 'Separar "' + nome + '"',
      legenda: LEGENDA,
      objetos: [
        { transform: o.transform, partes: [...outras, { malha: r.principal.malha, papel: 'resto', origem: r.principal.origem }] },
        { transform: o.transform, deslocar: dir.map(v => v * Math.max(8, tam * 0.6)), partes: [{ malha: r.detalhe.malha, papel: 'novo', origem: r.detalhe.origem }] }
      ],
      explodir: 1,
      notas,
      textoConfirmar: 'Confirmar separação',
      confirmar: () => {
        est.cena.aplicar('Separar ' + nome, () => {
          const i = o.partes.findIndex(x => x.id === p.id);
          o.partes[i] = novaParte({ ...p, malha: r.principal.malha, paleta: r.principal.paleta, id: p.id });
          const novo = novoObjeto({ nome, transform: o.transform, partes: [{ nome, malha: r.detalhe.malha, cor: r.detalhe.cor, paleta: r.detalhe.paleta }] });
          est.cena.objetos.splice(est.cena.objetos.indexOf(o) + 1, 0, novo);
          est.cena.sel = { objeto: novo.id, parte: novo.partes[0].id };
        });
        q('res').innerHTML = '<div class="e3d-nota ok">"' + nome + '" virou um objeto próprio, na mesma posição. Pra imprimir separado, use <b>Organizar mesa</b> ou mova a peça.</div>';
        q('nome').value = '';
      },
      cancelar: () => { q('res').innerHTML = ''; }
    });
  }

  async function porCor() {
    const o = est.objetoAtual(), p = est.parteAtual();
    if (!o || !p) { avisar('Escolha a peça colorida.', 'warn'); return; }
    if (!p.paleta || p.paleta.length < 2) { avisar('Essa peça tem uma cor só. Se as cores estão em peças diferentes do objeto, use "Peças → objetos" na lista.', 'warn'); return; }
    let r;
    try { r = await est.rodar('separarPorCor', { parte: est.parteParaMotor(p), opc: { espessura: lerNumero(q('espCor').value, 0.8), folga: lerNumero(q('folgaCor').value, 0.1) } }, 'Separar por cor'); }
    catch (e) { return; }
    // como cada região de cor virou peça (a prévia não esconde o que falhou)
    const g = r.regioes || {}, esp = lerNumero(q('espCor').value, 0.8).toFixed(1).replace('.', ',');
    const como = [g.inserto && g.inserto + ' inserto(s) de ' + esp + ' mm com bolso', g.plano && g.plano + ' corte(s) no plano da divisa', g.atravessa && g.atravessa + ' atravessando parede fina', g.casca && g.casca + ' peça(s) inteira(s) (casca própria)', g.falhou && g.falhou + ' região(ões) NÃO virou(aram) peça — ficou na cor do corpo'].filter(Boolean);
    previaVarias(o, p, r.pecas.map(x => ({ ...x, nome: nomeDaCor(x.cor) + (x.cor === r.corBase ? ' (corpo)' : '') })), 'Separar por cor', (como.length ? ['Como saiu: ' + como.join(' · ') + '.'] : []).concat(r.avisos));
  }
  async function cascas() {
    const o = est.objetoAtual(), p = est.parteAtual();
    if (!o || !p) { avisar('Escolha a peça.', 'warn'); return; }
    const r = await est.rodar('separarCascas', { parte: est.parteParaMotor(p) }, 'Separar cascas');
    if (r.partes.length < 2) { avisar('A peça é uma casca só.', 'warn'); return; }
    previaVarias(o, p, r.partes.map((x, i) => ({ ...x, nome: p.nome + ' ' + String(i + 1).padStart(2, '0') })), 'Separar cascas', []);
  }
  function previaVarias(o, p, pecas, titulo, avisos) {
    const cg = caixa(p.malha);
    const centro = cg ? cg.min.map((v, k) => (v + cg.max[k]) / 2) : [0, 0, 0];
    const tam = cg ? Math.max(...cg.tam) : 20;
    const objs = pecas.map(x => {
      const c = caixa(x.malha);
      const cc = c.min.map((v, k) => (v + c.max[k]) / 2);
      let dv = [cc[0] - centro[0], cc[1] - centro[1], cc[2] - centro[2]];
      const L = Math.hypot(...dv);
      dv = L > 1e-6 ? dv.map(v => v / L * tam * 0.35) : [0, 0, 0];
      return { transform: o.transform, deslocar: M4.aplicarDirecao(o.transform, dv[0], dv[1], dv[2]), partes: [{ malha: x.malha, cor: x.cor, paleta: x.paleta, papel: 'normal' }] };
    });
    est.mostrarPrevia({
      titulo: titulo + ': ' + pecas.length + ' peças', legenda: [['#0659f2', 'face nova']], objetos: objs, explodir: 1, notas: avisos,
      confirmar: () => est.cena.aplicar(titulo, () => {
        const i = o.partes.findIndex(x => x.id === p.id);
        const primeira = pecas[0];
        o.partes[i] = novaParte({ ...p, malha: primeira.malha, cor: primeira.cor, paleta: primeira.paleta, nome: o.partes.length > 1 ? p.nome : primeira.nome, id: p.id });
        const novos = pecas.slice(1).map(x => novoObjeto({ nome: x.nome, transform: o.transform, partes: [{ nome: x.nome, malha: x.malha, cor: x.cor, paleta: x.paleta }] }));
        est.cena.objetos.splice(est.cena.objetos.indexOf(o) + 1, 0, ...novos);
      })
    });
  }

  q('ir').onclick = separar;
  q('porCor').onclick = porCor;
  q('cascas').onclick = cascas;
  d.addEventListener('toggle', () => { if (d.open && est.ferramenta === 'navegar') est.definirFerramenta('auto'); });
  // atalho da barra de seleção: "Separar" / "Separar com pino"
  return { el: d, separar: (opc = {}) => { q('con').value = opc.conector || 'nenhum'; atualizarCon(); return separar(); } };
}

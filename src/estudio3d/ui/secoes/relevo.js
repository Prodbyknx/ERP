// Painel 6 — texto, logo, desenho ou SVG na FRENTE ou no VERSO da peça,
// como alto-relevo, baixo-relevo, recorte ou peça colorida embutida.
import { el, fmt, lerNumero, avisar, debounce } from '../util.js';
import { novaParte } from '../cena.js';
import { MODOS_RELEVO, referencialSuperficie } from '../../core/relevo.js';
import { formaDeTexto, formaDeImagem, FONTES } from '../formas2d.js';
import { caixa } from '../../core/malha.js';
import * as M4 from '../../core/mat4.js';

const BASE = 100;     // forma gerada com 100 mm e escalada pro tamanho pedido

export function montarRelevo(est) {
  const d = el('details', { 'data-sec': 'relevo' });
  d.innerHTML = `<summary><span class="n">6</span>Texto, logo e relevo</summary><div class="e3d-sec">
    <p class="u">Frente e verso independentes: aplique um, confirme, depois o outro. Ex.: frente = logo, verso = telefone.</p>
    <div class="field"><label>Peça que recebe</label><select data-a="alvo"></select></div>
    <div class="field"><label>Onde</label>
      <div class="seg" data-a="lado"><button type="button" data-v="frente" class="active">Frente (cima)</button><button type="button" data-v="verso">Verso (baixo)</button><button type="button" data-v="ponto">Clicar na superfície</button></div>
      <p class="u" data-a="ladoDica" style="margin:0"></p></div>
    <div class="field"><label>O que</label>
      <div class="seg" data-a="conteudo"><button type="button" data-v="texto" class="active">Texto</button><button type="button" data-v="arquivo">Imagem / logo / SVG</button></div></div>
    <div data-a="blocoTexto">
      <textarea data-a="texto" placeholder="Ex.: (21) 99999-9999">144 LAB</textarea>
      <div class="e3d-l2" style="margin-top:6px"><select data-a="fonte">${FONTES.map(f => '<option>' + f + '</option>').join('')}</select>
        <div style="display:flex;gap:10px;align-items:center"><label class="fer-check" style="margin:0"><input type="checkbox" data-a="negrito" checked> Negrito</label><label class="fer-check" style="margin:0"><input type="checkbox" data-a="italico"> Itálico</label></div></div>
    </div>
    <div data-a="blocoArquivo" style="display:none">
      <button class="btn" data-a="escolher">Escolher PNG, JPG ou SVG</button> <span class="u" data-a="arqNome"></span>
      <label class="fer-check"><input type="checkbox" data-a="inverterImg"> Inverter (troca desenho e fundo)</label>
      <input type="file" accept="image/*,.svg" data-a="arquivo" style="display:none">
    </div>
    <div class="field" style="margin-top:10px"><label>Como</label><select data-a="modo">${MODOS_RELEVO.map(m => '<option value="' + m.id + '">' + m.nome + '</option>').join('')}</select></div>
    <div class="e3d-l3">
      <div data-m="alto"><label>Altura</label><input type="text" data-a="altura" value="1"></div>
      <div data-m="fundo"><label>Profundidade</label><input type="text" data-a="prof" value="0,6"></div>
      <div><label>Largura</label><input type="text" data-a="largura" value="40"></div>
      <div><label>Mover X</label><input type="text" data-a="dx" value="0"></div>
      <div><label>Mover Y</label><input type="text" data-a="dy" value="0"></div>
      <div><label>Girar (°)</label><input type="text" data-a="rot" value="0"></div>
      <div data-m="cor"><label>Cor</label><input type="color" data-a="cor" value="#ffffff" style="width:100%;height:34px"></div>
      <div data-m="folga"><label>Folga</label><input type="text" data-a="folga" value="0"></div>
    </div>
    <p class="u" data-a="modoDica"></p>
    <div class="e3d-botoes"><button class="btn primary largo" data-a="ir">Pré-visualizar relevo</button></div>
    <div data-a="res"></div>
  </div>`;
  const q = s => d.querySelector('[data-a="' + s + '"]');
  let lado = 'frente', conteudo = 'texto', arquivo = null;
  let forma = null, formaChave = '', ponto = null;
  let suprimir = false;       // depois de aplicar, o contorno some até mexer de novo

  const DICAS = {
    'alto': 'Sobe da superfície e vira parte da mesma peça.',
    'alto-cor': 'Sobe da superfície como peça separada de outra cor (AMS, ou pausa pra trocar filamento).',
    'baixo': 'Gravação: afunda na peça.',
    'embutido': 'Grava e preenche com outra cor, rente à superfície. Com folga, dá pra imprimir o preenchimento separado e colar.',
    'recorte': 'Vaza a peça de um lado ao outro.'
  };
  function atualizarCampos() {
    const m = q('modo').value;
    d.querySelectorAll('[data-m]').forEach(x => {
      const k = x.dataset.m;
      x.style.display = (k === 'alto' && m.startsWith('alto')) || (k === 'fundo' && (m === 'baixo' || m === 'embutido')) || (k === 'cor' && (m === 'alto-cor' || m === 'embutido')) || (k === 'folga' && m === 'embutido') ? '' : 'none';
    });
    q('modoDica').textContent = DICAS[m] + (lado === 'verso' && m.startsWith('alto') ? ' Atenção: relevo saindo pelo verso precisa de suporte.' : '');
    q('ladoDica').textContent = lado === 'frente' ? 'Face de cima da peça (maior Z).' : lado === 'verso' ? 'Face de baixo. O desenho já sai espelhado pra ler certo quando virar a peça.' : (ponto ? 'Ponto escolhido. Clique de novo pra trocar.' : 'Clique na peça, no lugar do desenho.');
  }

  function alvos() {
    const o = est.objetoAtual();
    const s = q('alvo');
    const atual = s.value;
    s.innerHTML = '';
    if (!o) { s.appendChild(el('option', { value: '' }, 'Escolha um objeto')); return; }
    // padrão: a maior peça (a base do chaveiro)
    let maior = 0, iMaior = 0;
    o.partes.forEach((p, i) => { const c = caixa(p.malha); const a = c ? c.tam[0] * c.tam[1] : 0; if (a > maior) { maior = a; iMaior = i; } });
    o.partes.forEach((p, i) => s.appendChild(el('option', { value: p.id }, p.nome)));
    s.value = o.partes.some(p => p.id === atual) ? atual : o.partes[iMaior].id;
  }

  async function obterForma() {
    let chave;
    if (conteudo === 'texto') chave = 't|' + q('texto').value + '|' + q('fonte').value + '|' + q('negrito').checked + '|' + q('italico').checked;
    else chave = 'a|' + (arquivo ? arquivo.name + arquivo.size + arquivo.lastModified : '') + '|' + q('inverterImg').checked;
    if (forma && chave === formaChave) return forma;
    if (conteudo === 'texto') forma = formaDeTexto(q('texto').value, { fonte: q('fonte').value, negrito: q('negrito').checked, italico: q('italico').checked, largura: BASE });
    else {
      if (!arquivo) throw new Error('Escolha a imagem ou o SVG.');
      forma = await formaDeImagem(arquivo, { largura: BASE, inverter: q('inverterImg').checked });
    }
    formaChave = chave;
    return forma;
  }

  function params() {
    return {
      modo: q('modo').value, lado,
      altura: lerNumero(q('altura').value, 1), profundidade: lerNumero(q('prof').value, 0.6),
      escala: lerNumero(q('largura').value, 40) / BASE,
      dx: lerNumero(q('dx').value, 0), dy: lerNumero(q('dy').value, 0), rotacao: lerNumero(q('rot').value, 0),
      cor: q('cor').value.toUpperCase(), folga: lerNumero(q('folga').value, 0),
      ponto: ponto ? ponto.local : null, normal: ponto ? ponto.normal : null
    };
  }

  // referencial da superfície (coordenadas da peça)
  function referencial(p, pr) {
    const c = caixa(p.malha);
    if (lado === 'ponto') {
      if (!ponto) return null;
      const F = M4.doPlano(ponto.local, ponto.normal, Math.abs(ponto.normal[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]);
      return M4.multiplicar(F, M4.multiplicar(M4.translacao(pr.dx, pr.dy, 0), M4.rotacaoEuler(0, 0, pr.rotacao)));
    }
    return referencialSuperficie(lado, c, { dx: pr.dx, dy: pr.dy, rotacao: pr.rotacao });
  }

  const contorno = debounce(async () => {
    const o = est.objetoAtual();
    const p = o && o.partes.find(x => x.id === q('alvo').value);
    if (!d.open || !o || !p || est.previaAtiva || suprimir) { est.visor.limparAjudas('contorno'); return; }
    let f;
    try { f = await obterForma(); } catch (e) { est.visor.limparAjudas('contorno'); q('res').innerHTML = '<div class="e3d-nota aviso">' + (e.message || e) + '</div>'; return; }
    q('res').innerHTML = '';
    const pr = params();
    const F = referencial(p, pr);
    if (!F) { est.visor.limparAjudas('contorno'); return; }
    const W = M4.multiplicar(o.transform, F);
    const lacos = f.aneis.map(a => {
      const out = new Float32Array(a.length * 3);
      a.forEach((pt, i) => { const w = M4.aplicarPonto(W, pt[0] * pr.escala, pt[1] * pr.escala, 0.08); out[i * 3] = w[0]; out[i * 3 + 1] = w[1]; out[i * 3 + 2] = w[2]; });
      return out;
    });
    est.visor.mostrarContornos(lacos, '#e54c00', 'contorno');
    const tam = f.altura * pr.escala;
    q('res').innerHTML = '<p class="u">Tamanho do desenho: ' + fmt(f.largura * pr.escala, 1) + ' × ' + fmt(tam, 1) + ' mm</p>';
  }, 120);

  async function aplicar() {
    const o = est.objetoAtual();
    const p = o && o.partes.find(x => x.id === q('alvo').value);
    if (!o || !p) { avisar('Escolha o objeto e a peça.', 'warn'); return; }
    if (lado === 'ponto' && !ponto) { avisar('Clique na superfície onde vai o desenho.', 'warn'); return; }
    let f;
    try { f = await obterForma(); } catch (e) { avisar(e.message || e, 'warn'); return; }
    const pr = params();
    const opc = { ...pr, nome: conteudo === 'texto' ? ('Texto ' + q('texto').value.split('\n')[0]).slice(0, 30) : 'Logo' };
    if (lado === 'ponto') { opc.referencial = Array.from(referencial(p, pr)); }
    const alvoIdx = o.partes.indexOf(p);
    q('ir').disabled = true;
    let r;
    try { r = await est.rodar('relevo', { partes: o.partes.map(x => est.parteParaMotor(x)), alvo: alvoIdx, forma: { aneis: f.aneis }, opc }, 'Relevo'); }
    catch (e) { q('res').innerHTML = '<div class="e3d-nota erro">' + (e.message || e) + '</div>'; return; }
    finally { q('ir').disabled = false; }
    est.visor.limparAjudas('contorno');
    est.mostrarPrevia({
      titulo: 'Relevo — ' + (MODOS_RELEVO.find(m => m.id === pr.modo) || {}).nome,
      legenda: r.indiceNova >= 0 ? [['#0e9f2e', 'peça nova (' + pr.cor + ')']] : [],
      objetos: [{ transform: o.transform, partes: r.partes.map((x, i) => ({ malha: x.malha, cor: x.cor, paleta: x.paleta, papel: i === r.indiceNova ? 'novo' : 'normal' })) }],
      notas: r.avisos,
      confirmar: () => {
        est.cena.aplicar('Relevo na ' + (lado === 'verso' ? 'verso' : lado === 'frente' ? 'frente' : 'superfície'), () => {
          o.partes = r.partes.map((x, i) => i < o.partes.length ? novaParte({ ...o.partes[i], malha: x.malha, cor: x.cor, paleta: x.paleta, id: o.partes[i].id }) : novaParte({ nome: x.nome, malha: x.malha, cor: x.cor, paleta: x.paleta }));
        });
        suprimir = true;
        est.visor.limparAjudas('contorno');
        q('res').innerHTML = '<div class="e3d-nota ok">Aplicado. ' + (r.indiceNova >= 0 ? 'A peça colorida entra no 3MF com a cor ' + pr.cor + '. ' : '') + 'Mexa em qualquer campo pra pôr outro desenho.</div>';
      },
      cancelar: () => contorno()
    });
  }

  q('lado').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    lado = b.dataset.v;
    q('lado').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    est.definirFerramenta(lado === 'ponto' ? 'relevo-ponto' : 'navegar');
    atualizarCampos(); mexeu();
  });
  q('conteudo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    conteudo = b.dataset.v;
    q('conteudo').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    q('blocoTexto').style.display = conteudo === 'texto' ? '' : 'none';
    q('blocoArquivo').style.display = conteudo === 'texto' ? 'none' : '';
    mexeu();
  });
  q('escolher').onclick = () => q('arquivo').click();
  q('arquivo').onchange = () => { arquivo = q('arquivo').files[0] || null; q('arqNome').textContent = arquivo ? arquivo.name : ''; mexeu(); };
  const mexeu = () => { suprimir = false; contorno(); };
  ['texto', 'fonte', 'negrito', 'italico', 'inverterImg', 'largura', 'dx', 'dy', 'rot', 'alvo'].forEach(k => q(k).addEventListener('input', mexeu));
  q('modo').addEventListener('change', () => { atualizarCampos(); });
  q('ir').onclick = aplicar;
  est.on('clique', ({ hit }) => {
    if (est.ferramenta !== 'relevo-ponto') return;
    const o = est.objetoAtual();
    if (!o || hit.objeto !== o.id) return;
    q('alvo').value = hit.parte;
    ponto = { local: [hit.local.x, hit.local.y, hit.local.z], normal: [hit.normalLocal.x, hit.normalLocal.y, hit.normalLocal.z] };
    atualizarCampos(); mexeu();
  });
  d.addEventListener('toggle', () => {
    if (d.open) { alvos(); atualizarCampos(); contorno(); if (lado === 'ponto') est.definirFerramenta('relevo-ponto'); }
    else { est.visor.limparAjudas('contorno'); if (est.ferramenta === 'relevo-ponto') est.definirFerramenta('navegar'); }
  });
  est.on('selecao', () => { if (d.open) { alvos(); ponto = null; suprimir = false; atualizarCampos(); contorno(); } });
  est.on('mudou', () => { if (d.open) { alvos(); contorno(); } });
  est.on('previa-fim', () => { if (d.open) contorno(); });
  atualizarCampos();
  return { el: d };
}

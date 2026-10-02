// Painel 1 — abrir e conferir a malha (diagnóstico + reparo)
import { el, esc, fmt, fmtInt, avisar } from '../util.js';
import { facesProblematicas } from '../../core/validador.js';
import { componentes } from '../../core/topologia.js';
import { srgbParaLinear } from '../../core/cores.js';

const DENSIDADE_PLA = 1.24; // g/cm³

function cor01(r, g, b) { return [srgbParaLinear(r), srgbParaLinear(g), srgbParaLinear(b)]; }
const CINZA = cor01(205, 208, 212), VERMELHO = cor01(209, 36, 47), LARANJA = cor01(245, 128, 20), MAGENTA = cor01(200, 30, 190);

// cores bem diferentes pra rótulos (cascas, partes)
export function corDeRotulo(i) {
  const h = (i * 0.61803398875) % 1, s = 0.62, v = 0.9;
  const k = n => (n + h * 6) % 6;
  const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return cor01(f(5) * 255, f(3) * 255, f(1) * 255);
}

export function montarDiagnostico(est) {
  const d = el('details', { open: true, 'data-sec': 'diag' });
  d.innerHTML = `<summary><span class="n">1</span>Abrir e conferir</summary><div class="e3d-sec">
    <p class="u">A conferência é geométrica: vale o que está no arquivo, não o que parece na tela. <b>Consertar</b> fecha buracos acompanhando a curva, desvira faces, tira sobras, refaz onde a superfície se cruza e junta partes que se atravessam num sólido só (como o fatiador faria) — o detalhe do modelo fica.</p>
    <div data-a="resultado"></div>
    <div class="e3d-botoes">
      <button class="btn primary largo" data-a="reparar">Consertar automaticamente</button>
      <button class="btn" data-a="analisar">Só conferir de novo</button>
    </div>
    <div data-a="extra"></div>
  </div>`;
  const $ = s => d.querySelector('[data-a="' + s + '"]');
  let sugestaoUnidade = null;
  const avisosAbrir = new Map();      // objeto.id -> avisos de quando o arquivo foi aberto
  let ultimoReparo = null;

  // soFaltando: só as peças sem laudo da malha atual (ex.: a que falhou no lote)
  async function analisar(o, silencioso, soFaltando) {
    o = o || est.objetoAtual();
    if (!o) { avisar('Escolha um objeto.', 'warn'); return; }
    const partes = soFaltando ? o.partes.filter(p => { const x = est.diag.get(p.id); return !x || x.malha !== p.malha; }) : o.partes;
    if (!partes.length) return;
    $('resultado').innerHTML = '<div class="e3d-nota">Analisando ' + partes.length + ' peça(s)…</div>';
    if (!est.analisando) est.analisando = new Set();
    partes.forEach(p => est.analisando.add(p.malha));
    est.renderSaude && est.renderSaude();
    try {
      for (const p of partes) {
        try {
          const rel = await est.rodar('analisar', { parte: est.parteParaMotor(p), opc: { completo: true } }, 'Analisar');
          est.diag.set(p.id, { rel, malha: p.malha });
        } catch (e) { $('resultado').innerHTML = '<div class="e3d-nota erro">' + esc(e.message || e) + '</div>'; return; }
      }
    } finally {
      partes.forEach(p => est.analisando.delete(p.malha));
      est.emitir('analisou', o);
    }
    render();
    if (est.visor.modo === 'espessura' || est.visor.modo === 'problemas') est.recalcularMapas();
    if (!silencioso) avisar('Análise pronta');
  }

  // Uma operação do painel por vez (duplo clique, clicar de novo achando que
  // travou, "Consertar o arquivo" do Início enquanto já conserta): a 2ª é ignorada.
  let trabalhando = false;
  async function sozinho(fn) {
    if (trabalhando) { avisar('Já estou consertando — espere terminar (ou clique em Cancelar).', 'warn'); return; }
    trabalhando = true;
    const b = $('reparar'); b.disabled = true;
    try { return await fn(); } finally { trabalhando = false; b.disabled = false; }
  }

  // Resultado por peça: só vale se a peça ainda é a mesma (mesmo id, mesma
  // malha que foi pro motor). Desfazer no meio, excluir ou outra operação
  // na peça -> aquele resultado é descartado e o aviso diz qual.
  function aplicarPorPeca(o, resultados, rotulo, troca) {
    const oa = est.cena.objeto(o.id);
    const valem = [], mudaram = [];
    for (const x of resultados) {
      const q = oa && oa.partes.find(y => y.id === x.p.id);
      if (q && q.malha === x.malha) valem.push({ ...x, q }); else mudaram.push(x.p.nome);
    }
    const comMudanca = valem.filter(x => troca.muda(x.r));
    if (comMudanca.length) est.cena.aplicar(rotulo, () => { for (const x of comMudanca) troca.aplicar(x.q, x.r); });
    return { oa, valem, mudaram, comMudanca };
  }

  async function reparar() {
    const o = est.objetoAtual();
    if (!o) { avisar('Escolha um objeto.', 'warn'); return; }
    const resultados = [], falharam = [];
    // modelo de várias cores = uma peça por vez; a barra mostra "peça 2 de 6" e o % do total
    est.lote = { n: o.partes.length, i: 0, desde: performance.now() };
    try {
      for (const p of o.partes) {
        est.lote.i++; est.lote.nome = p.nome;
        const malha = p.malha;
        try { resultados.push({ p, malha, r: await est.rodar('reparar', { parte: est.parteParaMotor(p), opc: {} }, 'Reparar ' + p.nome) }); }
        catch (e) {
          if (e && e.codigo === 'cancelado') return;          // Cancelar: não mexe em nada
          falharam.push({ nome: p.nome, erro: e.message || String(e) });   // segue com as outras peças
        }
      }
    } finally { est.lote = null; }
    const { oa, valem, mudaram, comMudanca } = aplicarPorPeca(o, resultados, 'Reparar malha', {
      muda: r => r.passos.length > 0,
      aplicar: (q, r) => { q.malha = r.parte.malha; q.cor = r.parte.cor; q.paleta = r.parte.paleta; }
    });
    ultimoReparo = valem.map(x => ({ nome: x.p.nome, passos: x.r.passos, solido: x.r.solido }))
      .concat(falharam.map(f => ({ nome: f.nome, passos: ['não consegui consertar: ' + f.erro] })));
    for (const x of valem) est.diag.set(x.q.id, { rel: x.r.depois, malha: x.q.malha });
    render();
    if (oa) est.emitir('analisou', oa);
    // peça que falhou (ou mudou) ficou sem laudo: confere ela em segundo plano
    if (oa && (falharam.length || mudaram.length)) analisar(oa, true, true);
    const partes = [];
    if (comMudanca.length) partes.push(o.partes.length > 1 ? 'Consertei ' + comMudanca.length + ' de ' + o.partes.length + ' peça(s) (dá pra desfazer)' : 'Malha reparada (dá pra desfazer)');
    else if (valem.length) partes.push('Nada pra consertar');
    if (falharam.length) partes.push('não consegui consertar: ' + falharam.map(f => f.nome).join(', ') + ' (motivo no laudo)');
    if (mudaram.length) partes.push(mudaram.join(', ') + ' mudou enquanto consertava — não apliquei; conserte de novo');
    avisar(partes.join(' · ') || 'Nada pra consertar', falharam.length || mudaram.length ? 'warn' : 'ok');
  }

  async function unirSobrepostos() {
    const o = est.objetoAtual(); if (!o) return;
    const res = [];
    try { for (const p of o.partes) res.push({ p, malha: p.malha, r: await est.rodar('unirSobrepostos', { parte: est.parteParaMotor(p) }, 'Unir') }); }
    catch (e) { return; }
    const { oa, mudaram } = aplicarPorPeca(o, res, 'Unir partes sobrepostas', { muda: () => true, aplicar: (q, r) => { q.malha = r.parte.malha; q.paleta = r.parte.paleta; } });
    if (mudaram.length) est.avisarMudou('Unir');
    if (oa) analisar(oa, true);
  }
  async function removerInternos() {
    const o = est.objetoAtual(); if (!o) return;
    const res = [];
    try { for (const p of o.partes) res.push({ p, malha: p.malha, r: await est.rodar('removerInternos', { parte: est.parteParaMotor(p) }, 'Remover sobras') }); }
    catch (e) { return; }
    const n = res.reduce((s, x) => s + x.r.removidos, 0);
    if (!n) { avisar('Nenhuma sobra interna.'); return; }
    const { oa, comMudanca, mudaram } = aplicarPorPeca(o, res, 'Remover sobras internas', { muda: r => r.removidos > 0, aplicar: (q, r) => { q.malha = r.parte.malha; } });
    if (mudaram.length) est.avisarMudou('Remover sobras');
    if (comMudanca.length) avisar(comMudanca.reduce((s, x) => s + x.r.removidos, 0) + ' sobra(s) interna(s) removida(s)');
    if (oa) analisar(oa, true);
  }
  async function converterUnidade(fator) {
    const o = est.objetoAtual(); if (!o) return;
    const res = [];
    try { for (const p of o.partes) res.push({ p, malha: p.malha, r: await est.rodar('escalarGeometria', { parte: est.parteParaMotor(p), fator }, 'Converter') }); }
    catch (e) { return; }
    // unidade é tudo ou nada: se alguma peça mudou no meio, não converte nenhuma
    const ficha = [{ id: o.id, malhas: new Map(res.map(x => [x.p.id, x.malha])), t: null }];
    if (!est.aplicarSeIgual(ficha, 'Converter unidade (×' + String(fator).replace('.', ',') + ')', oa => {
      for (const { p, r } of res) { const q = oa.partes.find(x => x.id === p.id); if (q) q.malha = r.parte.malha; }
      est.cena.centralizar(oa);
    })) return;
    sugestaoUnidade = null;
    est.enquadrar();
    analisar(est.cena.objeto(o.id), true);
  }

  function linha(rot, val, estado) { return '<span>' + rot + '</span><b class="' + (estado || '') + '">' + val + '</b>'; }

  function render() {
    const o = est.objetoAtual();
    const res = $('resultado'), extra = $('extra');
    extra.innerHTML = '';
    if (!o) { res.innerHTML = '<p class="u">Escolha um objeto pra ver o diagnóstico.</p>'; return; }
    const rels = o.partes.map(p => { const x = est.diag.get(p.id); return x && x.malha === p.malha ? x.rel : null; });
    if (rels.some(r => !r)) {
      res.innerHTML = '<p class="u">' + (rels.every(r => !r) ? 'Ainda não analisado.' : 'Alguma peça mudou — analise de novo.') + '</p>';
    } else {
      const soma = k => rels.reduce((s, r) => s + (r[k] || 0), 0);
      const fechada = rels.every(r => r.fechada);
      const auto = rels.some(r => r.autoInterseccoes == null) ? null : soma('autoInterseccoes');
      const esp = rels.map(r => r.espessuraMinima).filter(v => v != null);
      const cx = est.cena.caixaExata(o);
      const vol = soma('volume');
      let h = '<div class="e3d-diag">';
      h += '<div class="grupo">Integridade da malha</div>';
      h += linha('Malha fechada', fechada ? 'OK' : 'NÃO', fechada ? 'bom' : 'ruim');
      h += linha('Arestas abertas', fmtInt(soma('arestasAbertas')), soma('arestasAbertas') ? 'ruim' : 'bom');
      h += linha('Non-manifold (arestas)', fmtInt(soma('arestasNaoManifold')), soma('arestasNaoManifold') ? 'ruim' : 'bom');
      h += linha('Non-manifold (vértices)', fmtInt(soma('verticesNaoManifold')), soma('verticesNaoManifold') ? 'ruim' : 'bom');
      const inv = soma('orientacaoTrocada') + soma('componentesInvertidos');
      h += linha('Faces invertidas', fmtInt(inv), inv ? 'ruim' : 'bom');
      h += linha('Faces degeneradas', fmtInt(soma('facesDegeneradas')), soma('facesDegeneradas') ? 'atencao' : 'bom');
      h += linha('Faces repetidas', fmtInt(soma('facesDuplicadas')), soma('facesDuplicadas') ? 'ruim' : 'bom');
      h += linha('Vértices duplicados (costura aberta)', fmtInt(soma('verticesDuplicados')), soma('verticesDuplicados') ? 'atencao' : 'bom');
      // vértice no mesmo lugar SEM buraco: peças que se encostam num ponto/aresta.
      // É normal (o conserto não mexe) — só informa
      if (soma('verticesSobrepostos')) h += linha('Pontos onde partes se encostam (normal)', fmtInt(soma('verticesSobrepostos')));
      h += linha('Objetos desconectados', fmtInt(soma('componentes')), soma('componentes') > o.partes.length ? 'atencao' : 'bom');
      h += linha('Sobras internas', fmtInt(soma('componentesInternos')), soma('componentesInternos') ? 'atencao' : 'bom');
      h += linha('Auto-interseções', auto == null ? 'não medido' : fmtInt(auto) + (rels.some(r => !r.autoInterseccoesCompleto) ? '+' : ''), auto ? 'ruim' : 'bom');
      h += '<div class="grupo">Impressão</div>';
      const lim = rels[0].limiteEspessura || 0.8;
      h += linha('Espessura mínima', esp.length ? fmt(Math.min(...esp), 2) + ' mm' : '—', esp.length && Math.min(...esp) < lim ? 'atencao' : 'bom');
      h += linha('Regiões críticas (< ' + fmt(lim, 1) + ' mm)', fmtInt(soma('regioesCriticas')), soma('regioesCriticas') ? 'atencao' : 'bom');
      if (cx) h += linha('Dimensão total', fmt(cx.tam[0]) + ' × ' + fmt(cx.tam[1]) + ' × ' + fmt(cx.tam[2]) + ' mm');
      const escala = Math.abs(o.transform[0] * (o.transform[5] * o.transform[10] - o.transform[6] * o.transform[9]) - o.transform[4] * (o.transform[1] * o.transform[10] - o.transform[2] * o.transform[9]) + o.transform[8] * (o.transform[1] * o.transform[6] - o.transform[2] * o.transform[5]));
      h += linha('Volume', fmt(vol * escala / 1000, 2) + ' cm³');
      h += linha('Peso estimado (PLA maciço)', fmt(vol * escala / 1000 * DENSIDADE_PLA, 1) + ' g');
      h += linha('Triângulos', fmtInt(soma('triangulos')));
      h += '</div>';
      const tudoOk = rels.every(r => r.imprimivel);       // mesma regra do Início, da bolinha e do Preparar (defeitosGraves)
      h += tudoOk ? '<div class="e3d-nota ok">Pronto pra fatiar: sólido fechado, sem defeito de malha.</div>'
        : '<div class="e3d-nota aviso">' + (fechada ? 'A malha fecha, mas tem pontos de atenção acima.' : 'A malha tem defeitos que o fatiador pode interpretar errado. Use <b>Consertar automaticamente</b>.') + '</div>';
      if (ultimoReparo) {
        const ps = ultimoReparo.filter(x => x.passos.length);
        if (ps.length) h += '<div class="e3d-nota"><b>Reparo:</b> ' + ps.map(x => esc(x.nome) + ': ' + esc(x.passos.join('; '))).join(' · ') + '</div>';
      }
      res.innerHTML = h;
      if (auto > 0 && soma('componentes') > 1) extra.appendChild(el('button', { class: 'btn', title: 'Cascas que se atravessam viram um sólido só (o fatiador faria isso)', onclick: () => sozinho(unirSobrepostos) }, 'Unir partes sobrepostas'));
      if (soma('componentesInternos')) extra.appendChild(el('button', { class: 'btn', onclick: () => sozinho(removerInternos) }, 'Remover sobras internas'));
      if (esp.length && Math.min(...esp) < lim) extra.appendChild(el('button', { class: 'btn', onclick: () => est.definirModoVisual('espessura') }, 'Ver onde está fino'));
      if (!fechada) extra.appendChild(el('button', { class: 'btn', onclick: () => est.definirModoVisual('problemas') }, 'Ver os defeitos'));
      else if (auto > 0) extra.appendChild(el('button', { class: 'btn', title: 'Pinta de rosa onde a superfície se cruza', onclick: () => est.definirModoVisual('problemas') }, 'Ver onde se cruza'));
      extra.className = 'e3d-botoes';
    }
    // avisos de quando o arquivo foi aberto: ficam aqui (antes era um aviso
    // rápido que a mensagem seguinte cobria em 0 s, e só o 1º aparecia)
    const av = avisosAbrir.get(o.id);
    if (av && av.length) {
      const n = el('div', { class: 'e3d-nota aviso', 'data-a': 'avisosAbrir' }, el('b', null, 'Ao abrir o arquivo: '));
      av.forEach((t, i) => { if (i) n.appendChild(el('br')); n.appendChild(document.createTextNode('• ' + t)); });
      n.appendChild(el('button', { class: 'btn small', style: 'margin-left:6px', onclick: () => { avisosAbrir.delete(o.id); render(); } }, 'Entendi'));
      res.prepend(n);
    }
    if (sugestaoUnidade && sugestaoUnidade.objeto === o.id) {
      const n = el('div', { class: 'e3d-nota aviso' }, sugestaoUnidade.texto + ' ',
        el('button', { class: 'btn small', onclick: () => sozinho(() => converterUnidade(sugestaoUnidade.fator)) }, 'Converter'));
      res.prepend(n);
    }
  }

  d.querySelector('[data-a=analisar]').onclick = () => analisar();
  d.querySelector('[data-a=reparar]').onclick = () => sozinho(reparar);
  est.on('selecao', render);
  est.on('mudou', render);
  est.on('importou', ({ resultado, objetos }) => {
    ultimoReparo = null;
    if (resultado.sugestaoUnidade && objetos[0]) sugestaoUnidade = { ...resultado.sugestaoUnidade, objeto: objetos[0].id };
    if (resultado.avisos && resultado.avisos.length) for (const o of objetos) avisosAbrir.set(o.id, resultado.avisos.slice());
    // confere sozinho em segundo plano (motor auxiliar): dá pra ir usando
    for (const o of objetos) analisar(o, true);
  });

  // mapas de cor dos modos de análise
  est.registrarMapa('espessura', p => {
    const x = est.diag.get(p.id);
    const nt = p.malha.idx.length / 3;
    const out = new Float32Array(nt * 3);
    if (!x || x.malha !== p.malha || !x.rel.espessuraPorFace) { for (let t = 0; t < nt; t++) out.set(CINZA, t * 3); return out; }
    const e = x.rel.espessuraPorFace, lim = x.rel.limiteEspessura || 0.8;
    // espalha a medida pros vizinhos não amostrados
    const adj = est.adj(p.malha);
    const v = Float32Array.from(e);
    const fila = []; for (let t = 0; t < nt; t++) if (!isNaN(v[t])) fila.push(t);
    for (let i = 0; i < fila.length; i++) { const f = fila[i]; for (let k = 0; k < 3; k++) { const o = adj.viz[f * 3 + k]; if (o >= 0 && isNaN(v[o])) { v[o] = v[f]; fila.push(o); } } }
    for (let t = 0; t < nt; t++) {
      if (isNaN(v[t])) { out.set(CINZA, t * 3); continue; }
      const q = Math.max(0, Math.min(1, (v[t] - lim * 0.5) / (lim * 3)));   // vermelho fino -> verde grosso
      out.set(cor01(230 - 180 * q, 60 + 150 * q, 50 + 30 * q), t * 3);
    }
    return out;
  });
  est.registrarMapa('problemas', p => {
    const nt = p.malha.idx.length / 3;
    const out = new Float32Array(nt * 3);
    const f = facesProblematicas(p.malha);
    const x = est.diag.get(p.id);
    const inter = x && x.malha === p.malha && x.rel.facesComInterseccao ? x.rel.facesComInterseccao : null;
    for (let t = 0; t < nt; t++) out.set(f[t] === 1 ? VERMELHO : f[t] === 2 ? LARANJA : f[t] === 3 ? MAGENTA : CINZA, t * 3);
    if (inter) for (const t of inter) out.set(MAGENTA, t * 3);
    return out;
  });
  est.registrarMapa('cascas', p => {
    const nt = p.malha.idx.length / 3;
    const out = new Float32Array(nt * 3);
    const c = componentes(p.malha);
    for (let t = 0; t < nt; t++) out.set(corDeRotulo(c.rotulo[t]), t * 3);
    return out;
  });

  return { el: d, analisar, render };
}

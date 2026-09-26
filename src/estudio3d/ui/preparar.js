// PREPARAR PRA IMPRIMIR: um clique confere e arruma a mesa inteira.
// Faz sozinho (tudo num Ctrl+Z só): consertar malha (buracos, faces viradas,
// arestas soltas), tirar sobras internas, pôr cada peça na mesa, afastar
// peças que se atravessam. Só AVISA (com botão pra resolver) o que é decisão
// do usuário: maior que a mesa, muito pequena (unidade), partes finas,
// posição de impressão (pouco contato com a mesa, área que precisa de
// suporte). No fim: exportar 3MF pro Bambu.
import { el, fmt, fmtInt, avisar } from './util.js';
import * as M4 from '../core/mat4.js';

const ALTURA_MAX = 256;

// área (mm²) encostada na mesa e área que precisaria de suporte (> 45°)
export function analisarPosicao(o) {
  const T = o.transform;
  let contato = 0, suporte = 0, zMin = Infinity;
  const pts = [];
  for (const p of o.partes) {
    const P = p.malha.pos;
    for (let i = 0; i < P.length; i += 3) { const z = T[2] * P[i] + T[6] * P[i + 1] + T[10] * P[i + 2] + T[14]; if (z < zMin) zMin = z; }
    pts.push(p.malha);
  }
  const lim = Math.cos(Math.PI / 4), det = M4.determinante(T) < 0 ? -1 : 1;
  for (const m of pts) {
    const P = m.pos, I = m.idx;
    for (let t = 0; t < I.length; t += 3) {
      const w = [I[t], I[t + 1], I[t + 2]].map(v => M4.aplicarPonto(T, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
      const ux = w[1][0] - w[0][0], uy = w[1][1] - w[0][1], uz = w[1][2] - w[0][2], vx = w[2][0] - w[0][0], vy = w[2][1] - w[0][1], vz = w[2][2] - w[0][2];
      const nx = (uy * vz - uz * vy) * det, ny = (uz * vx - ux * vz) * det, nz = (ux * vy - uy * vx) * det;
      const L = Math.hypot(nx, ny, nz); if (!L) continue;
      const area = L / 2, cz = nz / L;
      if (cz > -lim) continue;                     // não olha pra baixo
      const zMax = Math.max(w[0][2], w[1][2], w[2][2]);
      if (zMax - zMin < 0.05) contato += area;     // deitada na mesa
      else suporte += area;                        // pendurada: precisa de suporte
    }
  }
  return { contato, suporte };
}

function caixasSeCruzam(a, b) {
  return a.min[0] < b.max[0] - 0.01 && b.min[0] < a.max[0] - 0.01 && a.min[1] < b.max[1] - 0.01 && b.min[1] < a.max[1] - 0.01;
}

export async function prepararParaImpressao(est) {
  const objs = est.cena.objetos.filter(o => o.visivel !== false && o.papel !== 'furo');
  if (!objs.length) { avisar('Coloque uma peça na mesa primeiro.', 'warn'); return null; }
  const painel = abrirPainel(est);
  const linha = (id, titulo) => painel.linha(id, titulo);
  const itens = [];      // relatório final
  const trocas = [];     // { o, p, malha, cor, paleta }
  try {
    // 1) conferir e consertar
    linha('malha', 'Conferindo a malha de ' + objs.reduce((s, o) => s + o.partes.length, 0) + ' peça(s)…');
    let consertos = 0, sobras = 0, restantes = 0, espMin = Infinity, lim = 0.8;
    for (const o of objs) for (const p of o.partes) {
      let parte = est.parteParaMotor(p), mudou = false;
      let rel = await est.rodar('analisar', { parte, opc: { completo: true } }, 'Conferir');
      const defeitos = r => r.arestasAbertas + r.arestasNaoManifold + r.verticesNaoManifold + r.orientacaoTrocada + r.componentesInvertidos + r.facesDuplicadas;
      if (defeitos(rel) || rel.autoInterseccoes) {
        const r = await est.rodar('reparar', { parte, opc: {} }, 'Consertar');
        if (r.passos.length) { parte = { ...parte, ...r.parte }; mudou = true; consertos += r.passos.length; rel = r.depois || rel; }
      }
      if (rel.componentesInternos) {
        const r = await est.rodar('removerInternos', { parte }, 'Tirar sobras');
        if (r.removidos) { parte = { ...parte, ...r.parte }; mudou = true; sobras += r.removidos; }
        rel = await est.rodar('analisar', { parte, opc: { completo: true } }, 'Conferir');
      }
      restantes += defeitos(rel) + (rel.autoInterseccoes || 0);
      if (rel.espessuraMinima != null) espMin = Math.min(espMin, rel.espessuraMinima);
      if (rel.limiteEspessura) lim = rel.limiteEspessura;
      if (mudou) trocas.push({ o, p, parte });
      est.diag.set(p.id, { rel, malha: mudou ? parte.malha : p.malha });
    }
    painel.fim('malha', restantes ? 'atencao' : 'bom',
      restantes ? 'Ainda tem ' + fmtInt(restantes) + ' defeito(s) na malha' : consertos || sobras ? 'Malha consertada' : 'Malha fechada, sem defeito',
      [consertos ? fmtInt(consertos) + ' conserto(s)' : '', sobras ? fmtInt(sobras) + ' sobra(s) interna(s) tirada(s)' : ''].filter(Boolean).join(' · '),
      restantes ? ['Ver em Consertar', () => est.abrirFerramenta('diag')] : null);

    // 2) aplica tudo num passo só: consertos, na mesa, sem peça atravessando outra
    let foiMesa = 0, organizou = false, coube = true;
    const cruzadas = () => { const cx = objs.map(o => est.cena.caixaExata(o)); for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) if (cx[i] && cx[j] && caixasSeCruzam(cx[i], cx[j])) return true; return false; };
    const foraDaMesa = objs.filter(o => { const c = est.cena.caixaExata(o); return c && Math.abs(c.min[2]) > 0.02; }).length;
    // peça fora de toda placa, ou passando da borda da sua placa
    const W = est.cena.mesa.x, D = est.cena.mesa.y;
    const foraDaPlaca = o => {
      const c = est.cena.caixaExata(o); if (!c) return false;
      const k = est.cena.placaDoPonto((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2);
      if (k < 0) return true;
      const p = est.cena.origemPlaca(k);
      return c.tam[0] <= W && c.tam[1] <= D && (c.min[0] < p[0] - 0.01 || c.min[1] < p[1] - 0.01 || c.max[0] > p[0] + W + 0.01 || c.max[1] > p[1] + D + 0.01);
    };
    let puxadas = 0;
    if (trocas.length || foraDaMesa || objs.some(foraDaPlaca) || (objs.length > 1 && cruzadas())) {
      est.cena.aplicar('Preparar pra imprimir', () => {
        for (const t of trocas) { t.p.malha = t.parte.malha; if (t.parte.cor) t.p.cor = t.parte.cor; if (t.parte.paleta) t.p.paleta = t.parte.paleta; }
        for (const o of objs) { const c = est.cena.caixaExata(o); if (c && Math.abs(c.min[2]) > 0.02) { est.cena.colocarNaMesa(o); foiMesa++; } }
        // passou da borda da placa: empurra pra dentro dela (fora de toda placa: vai pra ativa)
        for (const o of objs) if (foraDaPlaca(o)) {
          const c = est.cena.caixaExata(o), k = est.cena.placaDoPonto((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2);
          if (k < 0) { est.cena.centralizar(o); puxadas++; continue; }
          const p = est.cena.origemPlaca(k);
          const dx = c.min[0] < p[0] ? p[0] + 2 - c.min[0] : c.max[0] > p[0] + W ? p[0] + W - 2 - c.max[0] : 0;
          const dy = c.min[1] < p[1] ? p[1] + 2 - c.min[1] : c.max[1] > p[1] + D ? p[1] + D - 2 - c.max[1] : 0;
          o.transform = M4.multiplicar(M4.translacao(dx, dy, 0), o.transform); puxadas++;
        }
        if (objs.length > 1 && cruzadas()) { const r = est.cena.organizarMesa(); coube = r.coube; organizou = true; }
      });
    }
    linha('mesa', 'Mesa');
    const n = est.cena.placas;
    const porPlaca = n > 1 ? [...Array(n).keys()].map(k => 'placa ' + (k + 1) + ': ' + est.cena.objetosDaPlaca(k).length).join(' · ') : '';
    painel.fim('mesa', coube ? 'bom' : 'atencao', organizou ? (coube ? 'Peças afastadas (uma atravessava a outra)' : 'Tem peça maior que a mesa') : (n > 1 ? n + ' placas, tudo apoiado' : 'Todas apoiadas na mesa'),
      [foiMesa ? fmtInt(foiMesa) + ' peça(s) encostada(s) na mesa' : '', puxadas ? fmtInt(puxadas) + ' peça(s) trazida(s) pra dentro da placa' : '', porPlaca].filter(Boolean).join(' · '));

    // 3) tamanho
    linha('tam', 'Tamanho');
    const { x: mx, y: my } = est.cena.mesa;
    const grandes = objs.filter(o => { const c = est.cena.caixaExata(o); return c && (c.tam[0] > mx || c.tam[1] > my || c.tam[2] > ALTURA_MAX); });
    const pequenas = objs.filter(o => { const c = est.cena.caixaExata(o); return c && Math.max(...c.tam) < 4; });
    if (grandes.length) painel.fim('tam', 'atencao', grandes.map(o => o.nome).join(', ') + ' é maior que a mesa (' + mx + ' × ' + my + ' × ' + ALTURA_MAX + ' mm)', 'Corte em partes com encaixe ou reduza.', ['Cortar', () => { est.cena.selecionar(grandes[0].id, null); est.abrirFerramenta('corte'); }]);
    else if (pequenas.length) painel.fim('tam', 'atencao', pequenas.map(o => o.nome).join(', ') + ' tem menos de 4 mm', 'O arquivo pode estar em metros ou polegadas.', ['Ajustar tamanho', () => { est.cena.selecionar(pequenas[0].id, null); est.abrirFerramenta('transf'); }]);
    else painel.fim('tam', 'bom', 'Cabe na mesa', objs.map(o => { const c = est.cena.caixaExata(o); return o.nome + ' ' + fmt(c.tam[0], 0) + '×' + fmt(c.tam[1], 0) + '×' + fmt(c.tam[2], 0); }).slice(0, 3).join(' · '));

    // 4) partes finas
    linha('fino', 'Espessura');
    if (espMin < lim) painel.fim('fino', 'atencao', 'Parte fina: ' + fmt(espMin, 2) + ' mm', 'Abaixo de ' + fmt(lim, 1) + ' mm pode não imprimir.', ['Ver onde', () => { est.definirModoVisual('espessura'); est.abrirFerramenta('diag'); }]);
    else painel.fim('fino', 'bom', isFinite(espMin) ? 'Paredes ok (mínimo ' + fmt(espMin, 2) + ' mm)' : 'Paredes ok');

    // 5) posição de impressão (cada peça)
    linha('pos', 'Posição de impressão');
    const ruins = [];
    let supTotal = 0;
    for (const o of objs) {
      const a = analisarPosicao(o);
      supTotal += a.suporte;
      if (a.contato < 3) ruins.push({ o, a });
    }
    if (ruins.length) painel.fim('pos', 'atencao', ruins.map(r => r.o.nome).join(', ') + ': quase não encosta na mesa (' + fmt(ruins[0].a.contato, 1) + ' mm²)', 'Pode soltar da mesa. Deite numa face plana ou use borda (brim).', ['Deitar na maior face plana', () => { est.cena.selecionar(ruins[0].o.id, null); est.executarTarefa('deitar'); }]);
    else painel.fim('pos', supTotal > 50 ? 'dica' : 'bom', supTotal > 50 ? 'Precisa de suporte em ~' + fmt(supTotal / 100, 1) + ' cm²' : 'Boa base na mesa', supTotal > 50 ? 'Partes penduradas a mais de 45°: ligue "suporte" no Bambu Studio (ou gire a peça).' : '');

    // 6) furos
    const furos = est.cena.objetos.filter(o => o.papel === 'furo' && o.visivel !== false).length;
    if (furos) { linha('furo', 'Furos'); painel.fim('furo', 'dica', fmtInt(furos) + ' peça(s) marcada(s) como furo', 'Os furos são aplicados no arquivo exportado.'); }

    const tudo = painel.contar();
    painel.concluir(tudo.atencao ? tudo.atencao + ' ponto(s) pra olhar antes de imprimir' : 'Pronto pra imprimir', !tudo.atencao,
      [est.cena.placas > 1 ? 'Abrir a placa ' + (est.cena.placaAtiva + 1) + ' no Bambu Studio' : 'Abrir no Bambu Studio', () => {
        est.secoes.exportar.abrirBambu(Date.now(), painel.resultado());
      }, ['Só baixar o 3MF', () => { painel.fechar(); est.abrirFerramenta('exp'); }]]);
    itens.push(...painel.itens);
    return { itens, trocas: trocas.length };
  } catch (e) {
    painel.erro(e.message || String(e));
    return null;
  }
}

function abrirPainel(est) {
  let p = est.palco.querySelector('.e3d-preparar');
  if (p) p.remove();
  p = el('div', { class: 'e3d-preparar e3d-vidro', role: 'dialog', 'aria-label': 'Preparar pra imprimir' });
  const lista = el('div', { class: 'lst' });
  const topo = el('div', { class: 'tp' }, el('b', null, 'Preparar pra imprimir'), el('button', { class: 'btn so-ico', title: 'Fechar', onclick: () => p.remove(), html: '✕' }));
  const pe = el('div', { class: 'pe' });
  p.append(topo, lista, pe);
  est.palco.appendChild(p);
  const linhas = new Map(), itens = [];
  const ic = { bom: '✓', atencao: '!', dica: 'i', rodando: '…', erro: '✕' };
  return {
    itens,
    linha(id, titulo) {
      const r = el('div', { class: 'it rodando', 'data-p': id }, el('i', null, ic.rodando), el('div', null, el('b', null, titulo), el('span')));
      lista.appendChild(r); linhas.set(id, r);
    },
    fim(id, tipo, titulo, texto, botao) {
      const r = linhas.get(id); if (!r) return;
      r.className = 'it ' + tipo; r.querySelector('i').textContent = ic[tipo];
      r.querySelector('b').textContent = titulo; r.querySelector('span').textContent = texto || '';
      if (botao) r.querySelector('div').appendChild(el('button', { class: 'btn mini', onclick: () => { p.remove(); botao[1](); } }, botao[0]));
      itens.push({ id, tipo, titulo, texto: texto || '' });
    },
    contar() { return { atencao: itens.filter(i => i.tipo === 'atencao').length }; },
    concluir(titulo, ok, botao) {
      pe.innerHTML = '';
      pe.append(el('div', { class: 'res ' + (ok ? 'bom' : 'atencao') }, titulo), el('button', { class: 'btn primary', 'data-a': 'exportar', onclick: botao[1] }, botao[0]));
      if (botao[2]) pe.append(el('button', { class: 'btn', 'data-a': 'baixar', onclick: botao[2][1] }, botao[2][0]));
      pe.append(el('div', { 'data-a': 'resultado' }));
      if (!ok) pe.appendChild(el('p', { class: 'u' }, 'O que foi consertado sozinho volta com um Ctrl+Z.'));
    },
    erro(msg) { pe.innerHTML = ''; pe.appendChild(el('div', { class: 'e3d-nota erro' }, msg)); },
    resultado() { return pe.querySelector('[data-a=resultado]') || pe; },
    fechar() { p.remove(); }
  };
}

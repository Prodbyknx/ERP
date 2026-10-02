// Sugestões pro modelo aberto (tela Início e a bolinha de saúde no 3D).
// Olha o que já se sabe da peça — análise da malha, tamanho, posição, cores —
// e diz, em português de oficina, o que vale a pena fazer antes de imprimir.
import { fmt, fmtInt } from './util.js';
import { defeitosGraves } from '../core/validador.js';

const ALTURA_MAX = 256;   // Bambu A1 / P1 / X1

export function calcularSugestoes(est, o) {
  const out = [];
  if (!o) return out;
  const rels = o.partes.map(p => { const x = est.diag.get(p.id); return x && x.malha === p.malha ? x.rel : null; });
  const medindo = o.partes.some(p => est.analisando && est.analisando.has(p.malha));
  const soma = k => rels.reduce((s, r) => s + (r && r[k] || 0), 0);
  const c = est.cena.caixaExata(o);

  if (rels.every(Boolean)) {
    // a MESMA regra do laudo (validador.defeitosGraves): a bolinha não diz
    // "Pronto" enquanto o laudo diz "atenção" (auditoria M3)
    const graves = rels.map(defeitosGraves);
    const defeitos = graves.reduce((s, g) => s + g.total, 0);
    if (defeitos > 0) {
      const partes = [...new Set(graves.flatMap(g => g.tipos))];
      out.push({ tipo: 'ruim', ico: 'alerta', titulo: fmtInt(defeitos) + ' defeito' + (defeitos > 1 ? 's' : '') + ' na malha', texto: cap(partes.join(', ')) + ' — o fatiador pode errar.', botao: 'Consertar', acao: 'consertar' });
    }
    const esp = rels.map(r => r.espessuraMinima).filter(v => v != null);
    const lim = (rels[0] && rels[0].limiteEspessura) || 0.8;
    if (esp.length && Math.min(...esp) < lim) out.push({ tipo: 'atencao', ico: 'lupa', titulo: 'Partes finas (' + fmt(Math.min(...esp), 2) + ' mm)', texto: 'Abaixo de ' + fmt(lim, 1) + ' mm pode não imprimir.', botao: 'Ver onde', acao: 'espessura' });
    const comps = soma('componentes');
    if (comps > o.partes.length) out.push({ tipo: 'dica', ico: 'separar', titulo: fmtInt(comps) + ' peças soltas no arquivo', texto: 'Dá pra separar cada uma e imprimir à parte.', botao: 'Separar', acao: 'cascas' });
    if (!defeitos) out.push({ tipo: 'bom', ico: 'check', titulo: 'Malha fechada, sem defeito', texto: c ? fmt(c.tam[0]) + ' × ' + fmt(c.tam[1]) + ' × ' + fmt(c.tam[2]) + ' mm' : '' });
  } else if (medindo) {
    out.push({ tipo: 'dica', ico: 'lupa', titulo: 'Conferindo a malha…', texto: 'Leva uns segundos em modelo grande. Pode ir usando.', medindo: true });
  } else {
    out.push({ tipo: 'dica', ico: 'escudo', titulo: 'Malha ainda não conferida', texto: 'Veja se tem buraco ou face virada antes de imprimir.', botao: 'Conferir', acao: 'analisar' });
  }

  if (c) {
    const { x, y } = est.cena.mesa;
    if (c.tam[0] > x || c.tam[1] > y || c.tam[2] > ALTURA_MAX) {
      out.push({ tipo: 'atencao', ico: 'tesoura', titulo: 'Maior que a mesa', texto: fmt(c.tam[0], 0) + ' × ' + fmt(c.tam[1], 0) + ' × ' + fmt(c.tam[2], 0) + ' mm. Corte em partes ou reduza.', botao: 'Cortar', acao: 'corte' });
    }
    if (c.min[2] > 0.02) out.push({ tipo: 'atencao', ico: 'deitar', titulo: 'Flutuando ' + fmt(c.min[2], 1) + ' mm acima da mesa', texto: 'Encoste na mesa antes de fatiar.', botao: 'Pôr na mesa', acao: 'naMesa' });
    else if (c.min[2] < -0.02) out.push({ tipo: 'atencao', ico: 'deitar', titulo: 'Parte da peça abaixo da mesa', texto: fmt(-c.min[2], 1) + ' mm ficariam cortados.', botao: 'Pôr na mesa', acao: 'naMesa' });
    if (Math.max(c.tam[0], c.tam[1], c.tam[2]) < 4) out.push({ tipo: 'atencao', ico: 'regua', titulo: 'Muito pequena (' + fmt(Math.max(...c.tam), 2) + ' mm)', texto: 'O arquivo pode estar em metros ou polegadas.', botao: 'Ajustar tamanho', acao: 'transf' });
  }

  const cores = new Set();
  o.partes.forEach(p => { cores.add(p.cor); if (p.paleta && p.malha.cor) p.paleta.forEach(h => cores.add(h)); });
  if (o.partes.some(p => p.paleta && p.paleta.length > 1)) {
    out.push({ tipo: 'dica', ico: 'paleta', titulo: 'Pintado com ' + cores.size + ' cores', texto: 'Separe cada cor em peça pra imprimir sem AMS e montar depois.', botao: 'Separar por cor', acao: 'porCor' });
  }

  if (!out.some(s => s.tipo === 'ruim' || s.tipo === 'atencao') && rels.every(Boolean)) {
    out.push({ tipo: 'dica', ico: 'baixar', titulo: 'Tudo certo pra imprimir', texto: 'Mande pro Bambu Studio com as cores de cada peça.', botao: 'Exportar 3MF', acao: 'exp' });
  }
  const ordem = { ruim: 0, atencao: 1, dica: 2, bom: 3 };
  return out.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);
}

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

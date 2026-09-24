// Relevo em superfície: texto, logo, desenho ou SVG vira geometria de verdade.
//   alto      -> sobe da superfície e funde na peça (mesma cor)
//   alto-cor  -> sobe da superfície como PEÇA separada (outra cor, AMS)
//   baixo     -> grava pra dentro (gravação / baixo-relevo)
//   embutido  -> grava e preenche com peça de outra cor, rente à superfície
//                (com folga: bolso maior, pra imprimir separado e colar)
//   recorte   -> vaza a peça de lado a lado
// FRENTE = face de cima (+Z da peça). VERSO = face de baixo, com o desenho já
// orientado pra ler certo quando a peça é virada de lado (giro em Y).
import { comContexto, manifold, segmentos } from './solidos.js';
import * as M4 from './mat4.js';
import { dentro, caixa2D } from './geo2d.js';

export const MODOS_RELEVO = [
  { id: 'alto', nome: 'Alto-relevo (mesma cor)' },
  { id: 'alto-cor', nome: 'Alto-relevo colorido (peça separada)' },
  { id: 'baixo', nome: 'Baixo-relevo / gravação' },
  { id: 'embutido', nome: 'Embutido colorido (rente)' },
  { id: 'recorte', nome: 'Recorte vazado' }
];

// referencial da superfície. caixaPeca: {min,max} da peça alvo (coordenadas da peça)
export function referencialSuperficie(lado, caixaPeca, opc = {}) {
  const cx = (caixaPeca.min[0] + caixaPeca.max[0]) / 2 + (opc.dx || 0);
  const cy = (caixaPeca.min[1] + caixaPeca.max[1]) / 2 + (opc.dy || 0);
  let F;
  if (lado === 'verso') F = M4.doPlano([cx - 2 * (opc.dx || 0), cy, caixaPeca.min[2]], [0, 0, -1], [-1, 0, 0]);
  else if (lado === 'ponto') F = M4.doPlano(opc.ponto, opc.normal, opc.dicaX || [1, 0, 0]);
  else F = M4.doPlano([cx, cy, caixaPeca.max[2]], [0, 0, 1], [1, 0, 0]);
  const rot = opc.rotacao || 0;
  return rot ? M4.multiplicar(F, M4.rotacaoEuler(0, 0, rot)) : F;
}

// altura da superfície (ao longo da normal do referencial) sob a forma
function amostrarSuperficie(solido, F, aneis, lado) {
  const b = caixa2D(aneis);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const passo = Math.max(w, h) / 24 || 1;
  const bb = solido.boundingBox();
  const diag = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) + 10;
  let zMin = Infinity, zMax = -Infinity, amostras = 0, fora = 0;
  for (let y = b.y0; y <= b.y1 + 1e-9; y += passo) {
    for (let x = b.x0; x <= b.x1 + 1e-9; x += passo) {
      if (!dentro(aneis, x, y)) continue;
      const o = M4.aplicarPonto(F, x, y, diag);
      const f = M4.aplicarPonto(F, x, y, -diag);
      const hits = solido.rayCast(o, f);
      amostras++;
      if (!hits.length) { fora++; continue; }
      const z = diag - hits[0].distance * 2 * diag;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }
  }
  void lado;
  return { zMin: isFinite(zMin) ? zMin : 0, zMax: isFinite(zMax) ? zMax : 0, amostras, fora };
}

// partes: [{nome, malha, cor, paleta}] do objeto; alvo: índice da peça que recebe o relevo
// forma: { aneis: [[[x,y],...], ...] } em mm, centrada em (0,0)
export function aplicarRelevo(partes, alvo, forma, opc = {}) {
  const modo = opc.modo || 'alto';
  const lado = opc.lado || 'frente';
  return comContexto(ctx => {
    const { Manifold, CrossSection } = manifold();
    const avisos = [];
    const pAlvo = partes[alvo];
    if (!pAlvo) throw new Error('Escolha a peça que recebe o relevo.');
    const S = ctx.solido(pAlvo, pAlvo.nome);
    const bb = S.boundingBox();
    const F = opc.referencial ? Float64Array.from(opc.referencial) : referencialSuperficie(lado, bb, opc);
    let cs = ctx.guardar(CrossSection.ofPolygons(forma.aneis, 'EvenOdd'));
    if (opc.escala && opc.escala !== 1) cs = ctx.guardar(cs.scale(opc.escala));
    if (cs.isEmpty()) throw new Error('O desenho ficou vazio.');
    const aneis = cs.toPolygons();
    const sup = amostrarSuperficie(S, F, aneis, lado);
    if (!sup.amostras || sup.fora === sup.amostras) throw new Error('O desenho ficou fora da peça. Ajuste posição ou tamanho.');
    if (sup.fora > 0 && modo !== 'recorte') avisos.push('Parte do desenho passa da borda da peça (' + Math.round(100 * sup.fora / sup.amostras) + '%).');
    const faixa = sup.zMax - sup.zMin;
    if (faixa > 0.05 && modo !== 'recorte') avisos.push('A superfície não é plana sob o desenho (varia ' + faixa.toFixed(2) + ' mm): o topo do relevo fica plano.');
    const Fm = Array.from(F);
    const prisma = (csx, z0, z1) => ctx.guardar(ctx.guardar(ctx.guardar(Manifold.extrude(csx, z1 - z0)).translate([0, 0, z0])).transform(Fm));
    const altura = Math.max(0.05, opc.altura != null ? opc.altura : 1);
    const prof = Math.max(0.05, opc.profundidade != null ? opc.profundidade : 0.6);
    const folga = Math.max(0, opc.folga || 0);
    const corNova = opc.cor || '#FFFFFF';
    const novas = partes.map(p => p);
    let novaParte = null;
    let alvoNovo;
    if (modo === 'alto' || modo === 'alto-cor') {
      const K = prisma(cs, sup.zMin - 0.3, sup.zMax + altura);
      if (modo === 'alto') {
        alvoNovo = ctx.guardar(S.add(K));
      } else {
        alvoNovo = S;
        const peca = ctx.guardar(K.subtract(S));
        novaParte = ctx.parte(ctx.primitiva(peca, corNova), opc.nome || 'Relevo', corNova);
      }
      if (lado === 'verso') avisos.push('Relevo saindo pelo verso: a peça vai precisar de suporte ou ser impressa de lado. Pro verso, gravação ou embutido costumam ser melhores.');
    } else if (modo === 'baixo') {
      const K = prisma(cs, sup.zMin - prof, sup.zMax + 1);
      alvoNovo = ctx.guardar(S.subtract(K));
    } else if (modo === 'embutido') {
      const Kp = folga > 0 ? prisma(ctx.guardar(cs.offset(folga, 'Round', 2, segmentos(1))), sup.zMin - prof - folga, sup.zMax + 1) : prisma(cs, sup.zMin - prof, sup.zMax + 1);
      const Kd = prisma(cs, sup.zMin - prof, sup.zMax + 1);
      const peca = ctx.guardar(S.intersect(Kd));
      alvoNovo = ctx.guardar(S.subtract(Kp));
      novaParte = ctx.parte(ctx.primitiva(peca, corNova), opc.nome || 'Embutido', corNova);
      if (folga > 0) novaParte.encaixe = { folga, profundidade: prof };
    } else if (modo === 'recorte') {
      const diag = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) + 2;
      const K = prisma(cs, -diag, diag);
      alvoNovo = ctx.guardar(S.subtract(K));
    } else throw new Error('Modo de relevo desconhecido: ' + modo);
    if (alvoNovo.isEmpty()) throw new Error('O relevo consumiria a peça inteira.');
    const parteAlvo = ctx.parte(alvoNovo, pAlvo.nome, pAlvo.cor);
    novas[alvo] = parteAlvo;
    if (novaParte && novaParte.malha.idx.length) {
      if (!novaParte.nome || novaParte.nome === 'peça') novaParte.nome = opc.nome || 'Relevo';
      novas.push(novaParte);
    } else if (novaParte) avisos.push('A peça colorida ficou vazia (o desenho não encostou na superfície).');
    // espessura mínima do traço vs bico
    const bico = opc.bico || 0.4;
    const fino = ctx.guardar(cs.offset(-bico / 2, 'Round'));
    if (fino.isEmpty()) avisos.push('O traço é mais fino que o bico de ' + bico + ' mm: pode não sair na impressão. Aumente o tamanho.');
    else if (fino.area() < cs.area() * 0.35) avisos.push('Tem traços muito finos para o bico de ' + bico + ' mm.');
    if ((modo === 'baixo' || modo === 'embutido') && prof < 0.4) avisos.push('Profundidade abaixo de 0,4 mm quase não aparece.');
    return { partes: novas, avisos, referencial: Array.from(F), superficie: sup, indiceNova: novaParte ? novas.length - 1 : -1 };
  });
}

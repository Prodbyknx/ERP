// Modelagem por combinação de formas: unir, tirar uma da outra, parte comum,
// furos (objeto marcado como "furo" tira material de quem ele atravessa),
// alinhar/distribuir e duplicar em série. Tudo em geometria real (Manifold),
// e o resultado sai fechado e validado.
import { comContexto, manifold } from './solidos.js';
import { transformar, caixa } from './malha.js';
import * as M4 from './mat4.js';

const noMundo = (o, p) => ({ ...p, malha: transformar(p.malha, o.transform) });
const caixaMundo = o => { let c = null; for (const p of o.partes) { const b = caixa(transformar(p.malha, o.transform)); c = c ? { min: c.min.map((v, i) => Math.min(v, b.min[i])), max: c.max.map((v, i) => Math.max(v, b.max[i])) } : b; } return c; };
const tocam = (a, b, f = 0.01) => a && b && a.min.every((v, i) => v <= b.max[i] + f) && b.min.every((v, i) => v <= a.max[i] + f);

// sólido (Manifold) de um objeto inteiro no mundo
function solidoDoObjeto(ctx, o) {
  const { Manifold } = manifold();
  const ms = o.partes.map(p => ctx.solido(noMundo(o, p), o.nome));
  return ms.length === 1 ? ms[0] : ctx.guardar(Manifold.union(ms));
}
// resultado no referencial do objeto-base (ele mantém a própria posição)
function paraBase(base, parte) {
  return { ...parte, malha: transformar(parte.malha, M4.inverter(base.transform)) };
}

// objetos: [{ nome, transform, papel, partes:[{nome, malha, cor, paleta}] }]
// modo: 'unir' | 'subtrair' | 'intersectar'. opc.base: índice do objeto que fica.
export function combinar(objetos, modo, opc = {}) {
  if (!objetos || objetos.length < 2) throw new Error('Escolha pelo menos duas peças.');
  const iBase = opc.base || 0;
  const base = objetos[iBase];
  return comContexto(ctx => {
    const { Manifold } = manifold();
    let res, nomeRes = base.nome;
    if (modo === 'unir') {
      const solidos = objetos.filter(o => o.papel !== 'furo'), furos = objetos.filter(o => o.papel === 'furo');
      if (!solidos.length) throw new Error('Tem que ter pelo menos uma peça sólida (não furo).');
      res = ctx.guardar(Manifold.union(solidos.map(o => solidoDoObjeto(ctx, o))));
      if (furos.length) res = ctx.guardar(res.subtract(ctx.guardar(Manifold.union(furos.map(o => solidoDoObjeto(ctx, o))))));
    } else if (modo === 'subtrair') {
      const outros = objetos.filter((_, i) => i !== iBase);
      const corte = ctx.guardar(Manifold.union(outros.map(o => solidoDoObjeto(ctx, o))));
      // cada peça da base perde o material, mantendo peças e cores separadas
      const partes = [];
      for (const p of base.partes) {
        const r = ctx.guardar(ctx.solido(noMundo(base, p), base.nome).subtract(corte));
        if (!r.isEmpty()) partes.push(paraBase(base, ctx.parte(r, p.nome, p.cor)));
      }
      if (!partes.length) throw new Error('Não sobrou nada — a peça que tira material cobre a outra inteira.');
      return { nome: base.nome, transform: base.transform, partes, volume: partes.reduce((s, p) => s + volumeDe(p.malha), 0) };
    } else if (modo === 'intersectar') {
      res = solidoDoObjeto(ctx, objetos[0]);
      for (let i = 1; i < objetos.length; i++) res = ctx.guardar(res.intersect(solidoDoObjeto(ctx, objetos[i])));
      nomeRes = base.nome + ' (parte comum)';
    } else throw new Error('Operação desconhecida: ' + modo);
    if (res.isEmpty()) throw new Error(modo === 'intersectar' ? 'As peças não se encostam: não existe parte comum.' : 'O resultado ficou vazio.');
    const parte = paraBase(base, ctx.parte(res, nomeRes, base.partes[0].cor));
    return { nome: nomeRes, transform: base.transform, partes: [parte], volume: res.volume() };
  });
}

function volumeDe(m) {
  let v = 0; const p = m.pos, I = m.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

// Um objeto sólido perde o material dos furos que o atravessam.
// Devolve { partes (no referencial do alvo), furosUsados: [índices] } ou null se nenhum furo toca.
export function aplicarFuros(alvo, furos) {
  const ca = caixaMundo(alvo);
  const usados = [];
  furos.forEach((f, i) => { if (tocam(ca, caixaMundo(f))) usados.push(i); });
  if (!usados.length) return null;
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const corte = ctx.guardar(Manifold.union(usados.map(i => solidoDoObjeto(ctx, furos[i]))));
    const partes = [];
    for (const p of alvo.partes) {
      const antes = ctx.solido(noMundo(alvo, p), alvo.nome);
      const r = ctx.guardar(antes.subtract(corte));
      if (Math.abs(r.volume() - antes.volume()) < 1e-9) { partes.push(p); continue; }
      partes.push(r.isEmpty() ? null : paraBase(alvo, ctx.parte(r, p.nome, p.cor)));   // null = a peça sumiu toda
    }
    return { partes, furosUsados: usados };
  });
}

// Cena pronta pra exportar: furos aplicados em quem eles atravessam e
// objetos-furo fora do arquivo (o arquivo tem só o que imprime).
export function aplicarFurosNaCena(cena) {
  const furos = cena.objetos.filter(o => o.papel === 'furo');
  if (!furos.length) return cena;
  const objetos = [];
  for (const o of cena.objetos) {
    if (o.papel === 'furo') continue;
    const r = aplicarFuros(o, furos);
    if (!r) { objetos.push(o); continue; }
    const partes = r.partes.filter(Boolean);
    if (partes.length) objetos.push({ ...o, partes });
  }
  return { ...cena, objetos };
}

/* ---------------------------------------------------------- posicionamento */

// caixas: [{min,max}] no mundo -> deslocamento [dx,dy,dz] de cada uma
// modo: esq | centroX | dir | frente | centroY | tras | base | centroZ | topo |
//       distribuirX | distribuirY | emCima
export function alinhar(caixas, modo) {
  const n = caixas.length;
  const tot = { min: [0, 1, 2].map(i => Math.min(...caixas.map(c => c.min[i]))), max: [0, 1, 2].map(i => Math.max(...caixas.map(c => c.max[i]))) };
  const eixo = { esq: 0, centroX: 0, dir: 0, frente: 1, centroY: 1, tras: 1, base: 2, centroZ: 2, topo: 2 }[modo];
  const out = caixas.map(() => [0, 0, 0]);
  if (eixo != null) {
    for (let k = 0; k < n; k++) {
      const c = caixas[k];
      const v = modo === 'esq' || modo === 'frente' || modo === 'base' ? tot.min[eixo] - c.min[eixo]
        : modo === 'dir' || modo === 'tras' || modo === 'topo' ? tot.max[eixo] - c.max[eixo]
        : (tot.min[eixo] + tot.max[eixo]) / 2 - (c.min[eixo] + c.max[eixo]) / 2;
      out[k][eixo] = v;
    }
    return out;
  }
  if (modo === 'distribuirX' || modo === 'distribuirY') {
    const e = modo === 'distribuirX' ? 0 : 1;
    if (n < 3) return out;
    const ordem = caixas.map((c, i) => i).sort((a, b) => caixas[a].min[e] - caixas[b].min[e]);
    const soma = caixas.reduce((s, c) => s + (c.max[e] - c.min[e]), 0);
    const vao = (tot.max[e] - tot.min[e] - soma) / (n - 1);
    let x = tot.min[e];
    for (const i of ordem) { out[i][e] = x - caixas[i].min[e]; x += caixas[i].max[e] - caixas[i].min[e] + vao; }
    return out;
  }
  if (modo === 'emCima') {
    // cada peça vai pro topo da anterior (na ordem escolhida), centrada nela
    let topo = caixas[0].max[2];
    const cx = (caixas[0].min[0] + caixas[0].max[0]) / 2, cy = (caixas[0].min[1] + caixas[0].max[1]) / 2;
    for (let k = 1; k < n; k++) {
      const c = caixas[k];
      out[k] = [cx - (c.min[0] + c.max[0]) / 2, cy - (c.min[1] + c.max[1]) / 2, topo - c.min[2]];
      topo += c.max[2] - c.min[2];
    }
    return out;
  }
  throw new Error('Alinhamento desconhecido: ' + modo);
}

// n cópias andando 'passo' (mm) a cada uma: devolve as matrizes das cópias
export function duplicarEmSerie(transform, n, passo) {
  const out = [];
  for (let k = 1; k <= n; k++) out.push(M4.multiplicar(M4.translacao(passo[0] * k, passo[1] * k, passo[2] * k), transform));
  return out;
}

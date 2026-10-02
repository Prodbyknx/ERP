// MeshLoader — decide o formato e devolve objetos da cena.
// Não inventa o que o formato não tem: STL/OBJ não têm unidade (assume mm e
// só AVISA quando o tamanho sugere metro/polegada), STL não tem material.
import { lerSTL } from './formatos/stl.js';
import { lerOBJ } from './formatos/obj.js';
import { ler3MF } from './formatos/tmf.js';
import { caixa, juntarCaixas } from './malha.js';
import * as M4 from './mat4.js';

export function detectarFormato(nome, bytes) {
  const ext = String(nome || '').toLowerCase().split('.').pop();
  if (ext === 'stl' || ext === 'obj' || ext === '3mf') return ext;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0x50 && u8[1] === 0x4B) return '3mf';
  const cab = new TextDecoder().decode(u8.subarray(0, 256));
  if (/^\s*solid\b/i.test(cab)) return 'stl';
  if (/^\s*(#|v |o |g |mtllib)/m.test(cab)) return 'obj';
  return 'stl';
}

function sugestaoUnidade(cx) {
  if (!cx) return null;
  const maior = Math.max(cx.tam[0], cx.tam[1], cx.tam[2]);
  if (maior > 0 && maior < 2) return { fator: 1000, texto: 'O modelo tem ' + maior.toFixed(3) + ' de tamanho — parece estar em METROS. Converter pra mm (×1000)?' };
  if (maior >= 2 && maior < 12) return { fator: 25.4, texto: 'O modelo tem só ' + maior.toFixed(2) + ' mm — se veio em POLEGADAS, converta (×25,4).' };
  if (maior > 2000) return { fator: 0.1, texto: 'O modelo tem ' + maior.toFixed(0) + ' mm — grande demais pra impressora. Se veio em décimo de mm, converta (×0,1).' };
  return null;
}

export function importarArquivo(nome, bytes, extras = {}) {
  const fmt = detectarFormato(nome, bytes);
  const base = String(nome || 'modelo').replace(/\.[^.]+$/, '');
  let objetos = [], avisos = [];
  if (fmt === 'stl') {
    const r = lerSTL(bytes, nome);
    const parte = { nome: base, malha: r.malha, cor: r.cor || null, paleta: r.paleta || null };
    objetos = [{ nome: base, transform: M4.identidade(), partes: [parte] }];
    if (r.avisos) avisos.push(...r.avisos);
    if (r.paleta) avisos.push('O STL tem cor por faceta (' + r.paleta.length + ' cores).');
  } else if (fmt === 'obj') {
    const r = lerOBJ(bytes, extras.mtl || null, nome);
    avisos = r.avisos;
    objetos = [{ nome: base, transform: M4.identidade(), partes: r.partes.map(p => ({ nome: p.nome, malha: p.malha, cor: p.cor || null, paleta: p.paleta || null })) }];
  } else {
    const r = ler3MF(bytes, nome);
    avisos = r.avisos;
    objetos = r.objetos;
    if (r.origem === 'bambu') avisos.unshift('Projeto do Bambu Studio: cores vieram dos filamentos do projeto.');
  }
  let cx = null;
  for (const o of objetos) for (const p of o.partes) {
    const c = caixa(p.malha);
    if (!c) continue;
    const cw = { min: M4.aplicarPonto(o.transform, c.min[0], c.min[1], c.min[2]), max: M4.aplicarPonto(o.transform, c.max[0], c.max[1], c.max[2]) };
    const mn = [0, 1, 2].map(k => Math.min(cw.min[k], cw.max[k])), mx = [0, 1, 2].map(k => Math.max(cw.min[k], cw.max[k]));
    cx = juntarCaixas(cx, { min: mn, max: mx, tam: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] });
  }
  const unidade = fmt === '3mf' ? null : sugestaoUnidade(cx);
  let triangulos = 0;
  for (const o of objetos) for (const p of o.partes) triangulos += p.malha.idx.length / 3;
  return { formato: fmt, objetos, avisos, sugestaoUnidade: unidade, caixa: cx, triangulos };
}

// OBJ (+ MTL opcional). Unidade assumida: mm (o formato não grava unidade).
// Cada 'o' vira uma peça. Cor vem do Kd do material (usemtl) ou da cor por
// vértice (extensão "v x y z r g b"). Textura (map_Kd) não vira cor: avisa.
import { criar, soldar } from '../malha.js';
import { rgb01ParaHex } from '../cores.js';
import { triangularPoligono3D } from '../triangular.js';

export function lerMTL(txt) {
  const mats = {};
  let atual = null;
  for (const linha of String(txt || '').split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l[0] === '#') continue;
    const p = l.split(/\s+/);
    if (p[0] === 'newmtl') { atual = { nome: p.slice(1).join(' '), cor: null, textura: false }; mats[atual.nome] = atual; }
    else if (atual && p[0] === 'Kd' && p.length >= 4) atual.cor = rgb01ParaHex(+p[1], +p[2], +p[3]);
    else if (atual && /^map_Kd$/i.test(p[0])) atual.textura = true;
  }
  return mats;
}

export function lerOBJ(texto, mtlTexto, nomeArquivo) {
  const txt = typeof texto === 'string' ? texto : new TextDecoder().decode(texto);
  const mats = mtlTexto ? lerMTL(typeof mtlTexto === 'string' ? mtlTexto : new TextDecoder().decode(mtlTexto)) : {};
  const V = [];              // posições
  const VC = [];             // cor por vértice (0..1) ou null
  let temCorVertice = false;
  const partes = [];
  let parte = null;
  let matAtual = null;
  const avisos = new Set();
  let facesRuins = 0;
  const novaParte = nome => { parte = { nome: nome || '', faces: [], mats: [] }; partes.push(parte); };
  const mtllibs = [];

  const linhas = txt.split(/\r?\n/);
  for (let li = 0; li < linhas.length; li++) {
    let l = linhas[li];
    while (l.endsWith('\\') && li + 1 < linhas.length) l = l.slice(0, -1) + ' ' + linhas[++li];
    l = l.trim();
    if (!l || l[0] === '#') continue;
    const c0 = l.charCodeAt(0), c1 = l.charCodeAt(1);
    if (c0 === 118 && (c1 === 32 || c1 === 9)) { // 'v '
      const p = l.split(/\s+/);
      V.push(+p[1], +p[2], +p[3]);
      if (p.length >= 7) { VC.push(+p[4], +p[5], +p[6]); temCorVertice = true; } else VC.push(NaN, NaN, NaN);
    } else if (c0 === 102 && (c1 === 32 || c1 === 9)) { // 'f '
      if (!parte) novaParte('');
      const p = l.split(/\s+/);
      const ids = [];
      const nvAtual = V.length / 3;
      let ruim = false;
      for (let k = 1; k < p.length; k++) {
        const s = p[k];
        if (!s) continue;
        let i = parseInt(s, 10);
        if (!isFinite(i) || i === 0) { ruim = true; continue; }
        i = i < 0 ? nvAtual + i : i - 1;
        if (i < 0 || i >= nvAtual) { ruim = true; continue; }
        ids.push(i);
      }
      // índice que não existe: a face inteira sai (antes um quadrado com 1
      // índice ruim virava OUTRO triângulo, calado) e o aviso conta quantas
      if (ruim) facesRuins++;
      else if (ids.length >= 3) { parte.faces.push(ids); parte.mats.push(matAtual); }
    } else if (l.startsWith('o ') || l.startsWith('o\t')) {
      novaParte(l.slice(2).trim());
    } else if (l.startsWith('g ') && !parte) {
      novaParte(l.slice(2).trim());
    } else if (l.startsWith('usemtl')) {
      matAtual = l.slice(6).trim();
      const m = mats[matAtual];
      if (m && m.textura && !m.cor) avisos.add('O material "' + matAtual + '" usa textura; textura não vira cor de filamento.');
    } else if (l.startsWith('mtllib')) {
      mtllibs.push(l.slice(6).trim());
    }
  }
  if (!V.length) throw new Error('O OBJ não tem vértices.');
  if (facesRuins) avisos.add(facesRuins.toLocaleString('pt-BR') + ' face(s) apontam pra vértice que não existe no arquivo e ficaram de fora (arquivo cortado ou com erro).');
  if (mtllibs.length && !mtlTexto) avisos.add('O OBJ aponta pro material ' + mtllibs.join(', ') + '. Selecione o .mtl junto com o .obj pra trazer as cores.');

  const saida = [];
  for (const pt of partes) {
    if (!pt.faces.length) continue;
    // só os vértices usados por esta peça
    const mapa = new Map();
    const pos = [];
    const corV = [];
    const usar = v => {
      let n = mapa.get(v);
      if (n === undefined) {
        n = pos.length / 3; mapa.set(v, n);
        pos.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]);
        corV.push(VC[v * 3], VC[v * 3 + 1], VC[v * 3 + 2]);
      }
      return n;
    };
    const idx = [];
    const corFace = [];     // hex por triângulo (ou null)
    pt.faces.forEach((f, fi) => {
      const mat = pt.mats[fi] != null ? mats[pt.mats[fi]] : null;
      const hexMat = mat && mat.cor ? mat.cor : null;
      const locais = f.map(usar);
      let tris;
      if (locais.length === 3) tris = [0, 1, 2];
      else if (locais.length === 4) tris = [0, 1, 2, 0, 2, 3];
      else {
        const pts = [];
        for (const v of locais) pts.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        tris = triangularPoligono3D(pts);
      }
      for (let k = 0; k < tris.length; k += 3) {
        const a = locais[tris[k]], b = locais[tris[k + 1]], c = locais[tris[k + 2]];
        idx.push(a, b, c);
        let hex = hexMat;
        if (!hex && temCorVertice && isFinite(corV[a * 3])) {
          hex = rgb01ParaHex((corV[a * 3] + corV[b * 3] + corV[c * 3]) / 3,
            (corV[a * 3 + 1] + corV[b * 3 + 1] + corV[c * 3 + 1]) / 3,
            (corV[a * 3 + 2] + corV[b * 3 + 2] + corV[c * 3 + 2]) / 3);
        }
        corFace.push(hex);
      }
    });
    // paleta
    const paleta = [];
    const kCor = new Map();
    const cor = new Uint16Array(corFace.length);
    let algumaCor = false;
    corFace.forEach((h, t) => {
      if (h) algumaCor = true;
      const chave = h || '#B4BAC4';
      let k = kCor.get(chave);
      if (k === undefined) { k = paleta.length; paleta.push(chave); kCor.set(chave, k); }
      cor[t] = k;
    });
    let malha = criar(Float64Array.from(pos), Uint32Array.from(idx), algumaCor && paleta.length > 1 ? cor : null);
    // OBJ costuma repetir vértice por causa de UV/normal: solda só o que é idêntico
    malha = soldar(malha, 1e-9).malha;
    saida.push({
      nome: pt.nome || (nomeArquivo || 'modelo').replace(/\.[^.]+$/, ''),
      malha,
      paleta: algumaCor && paleta.length > 1 ? paleta : null,
      cor: algumaCor && paleta.length === 1 ? paleta[0] : null
    });
  }
  if (!saida.length) throw new Error('O OBJ não tem faces.');
  if (temCorVertice && saida.some(s => s.paleta && s.paleta.length > 24)) {
    avisos.add('O modelo tem cor por vértice com muitas nuances. Use "Separar por cor" pra agrupar em poucas cores de filamento.');
  }
  return { partes: saida, avisos: [...avisos], mtllibs };
}

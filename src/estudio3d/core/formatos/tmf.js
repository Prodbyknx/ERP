// 3MF — leitura e escrita.
//
// ESCRITA (compatível com o Bambu Studio, verificado no código-fonte dele):
//  - O Bambu só aplica project_settings.config quando o arquivo se declara
//    "BambuStudio-x.y" — num arquivo nosso isso seria ignorado, então NÃO
//    dependemos dele. O antigo exportador punha a cor só lá e em
//    basematerials/displaycolor, que o Bambu nem lê: por isso a cor "mudava".
//  - Cor vai na extensão Materials: <m:colorgroup> + pid/pindex por peça.
//    O Bambu (1.10 até 2.08) lê exatamente isso e cria/associa os filamentos
//    com o MESMO hex. Peça de uma cor só usa cor no objeto (sem sobrescrever
//    por triângulo) — é o caso em que o Bambu mantém a peça inteira num
//    filamento, sem "pintura".
//  - Cada objeto da cena = um objeto montado (componentes = peças) + um item
//    no build com a transformação do objeto (posição/rotação/escala em mm).
//  - model_settings.config leva nome e filamento de cada peça (na mesma ordem
//    das cores do colorgroup, que é a ordem que o Bambu usa).
//
// LEITURA: 3MF padrão (core + materials + production/p:path), projeto do
// Bambu/Orca (cor do filamento por peça + pintura por triângulo) e PrusaSlicer.
import { lerZip, escreverZip, texto as u8ParaTexto } from './zip.js';
import { escapar, decodificar } from './xml.js';
import { normalizarHex, hexComAlfa, COR_PADRAO } from '../cores.js';
import * as M4 from '../mat4.js';
import { criar } from '../malha.js';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_MAT = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const NS_PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const FATOR_UNIDADE = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/* ============================================================== ESCRITA */

function num(v, casas) {
  const s = (+v.toFixed(casas)).toString();
  return s === '-0' ? '0' : s;
}

// cena: { objetos: [{ nome, transform(Float64Array16), partes: [{ nome, malha, cor, paleta }] }] }
// opc: { titulo, casas, miniatura (Uint8Array PNG), aplicacao }
export function escrever3MF(cena, opc = {}) {
  const casas = opc.casas == null ? 5 : opc.casas;
  const avisos = [];
  // paleta global na ordem em que as cores aparecem
  const cores = [];
  const kCor = new Map();
  const idCor = h => {
    const n = normalizarHex(h) || COR_PADRAO;
    let k = kCor.get(n);
    if (k === undefined) { k = cores.length; cores.push(n); kCor.set(n, k); }
    return k;
  };
  const objetos = (cena.objetos || []).filter(o => o.partes && o.partes.some(p => p.malha && p.malha.idx.length));
  if (!objetos.length) throw new Error('Nada pra exportar.');
  // primeiro registra as cores padrão das peças (define a ordem dos filamentos)
  objetos.forEach(o => o.partes.forEach(p => idCor(p.cor)));
  objetos.forEach(o => o.partes.forEach(p => { if (p.paleta && p.malha.cor) p.paleta.forEach(idCor); }));

  const GRUPO = 1;
  let prox = 2;
  const xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  xml.push('<model unit="millimeter" xml:lang="en-US" xmlns="' + NS_CORE + '" xmlns:m="' + NS_MAT + '">\n');
  xml.push(' <metadata name="Title">' + escapar(opc.titulo || objetos[0].nome || 'modelo') + '</metadata>\n');
  xml.push(' <metadata name="Application">' + escapar(opc.aplicacao || '144 Laboratorio 3D - Estudio 3D') + '</metadata>\n');
  xml.push(' <metadata name="CreationDate">' + new Date().toISOString().slice(0, 10) + '</metadata>\n');
  xml.push(' <resources>\n');
  xml.push('  <m:colorgroup id="' + GRUPO + '">\n');
  cores.forEach(c => xml.push('   <m:color color="' + hexComAlfa(c) + '"/>\n'));
  xml.push('  </m:colorgroup>\n');

  const cfg = [];
  cfg.push('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n');
  const build = [];

  objetos.forEach(o => {
    const idsPartes = [];
    const partes = o.partes.filter(p => p.malha && p.malha.idx.length);
    partes.forEach(p => {
      const id = prox++;
      const kPadrao = idCor(p.cor);
      idsPartes.push({ id, p, kPadrao });
      const m = p.malha;
      xml.push('  <object id="' + id + '" type="model" pid="' + GRUPO + '" pindex="' + kPadrao + '" name="' + escapar(p.nome || 'peca') + '">\n');
      xml.push('   <mesh>\n    <vertices>\n');
      const pos = m.pos;
      const bloco = [];
      for (let v = 0; v < pos.length; v += 3) {
        bloco.push('     <vertex x="' + num(pos[v], casas) + '" y="' + num(pos[v + 1], casas) + '" z="' + num(pos[v + 2], casas) + '"/>\n');
        if (bloco.length > 4096) { xml.push(bloco.join('')); bloco.length = 0; }
      }
      xml.push(bloco.join('')); bloco.length = 0;
      xml.push('    </vertices>\n    <triangles>\n');
      const idx = m.idx;
      const porTri = p.paleta && m.cor ? p.paleta.map(idCor) : null;
      let degeneradas = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        if (a === b || b === c || a === c) { degeneradas++; continue; }
        let s = '     <triangle v1="' + a + '" v2="' + b + '" v3="' + c + '"';
        if (porTri) {
          const k = porTri[m.cor[t / 3]];
          if (k !== kPadrao) s += ' pid="' + GRUPO + '" p1="' + k + '"';
        }
        bloco.push(s + '/>\n');
        if (bloco.length > 4096) { xml.push(bloco.join('')); bloco.length = 0; }
      }
      xml.push(bloco.join(''));
      xml.push('    </triangles>\n   </mesh>\n  </object>\n');
      if (degeneradas) avisos.push(p.nome + ': ' + degeneradas + ' triângulo(s) degenerado(s) removido(s) na gravação.');
    });
    const idObj = prox++;
    xml.push('  <object id="' + idObj + '" type="model" name="' + escapar(o.nome || 'objeto') + '">\n   <components>\n');
    idsPartes.forEach(x => xml.push('    <component objectid="' + x.id + '"/>\n'));
    xml.push('   </components>\n  </object>\n');
    const t = M4.para3MF(o.transform || M4.identidade()).map(v => num(v, 6)).join(' ');
    build.push('  <item objectid="' + idObj + '" transform="' + t + '"/>\n');

    cfg.push(' <object id="' + idObj + '">\n');
    cfg.push('  <metadata key="name" value="' + escapar(o.nome || 'objeto') + '"/>\n');
    cfg.push('  <metadata key="extruder" value="' + (idsPartes.length ? idsPartes[0].kPadrao + 1 : 1) + '"/>\n');
    idsPartes.forEach(x => {
      cfg.push('  <part id="' + x.id + '" subtype="normal_part">\n');
      cfg.push('   <metadata key="name" value="' + escapar(x.p.nome || 'peca') + '"/>\n');
      cfg.push('   <metadata key="extruder" value="' + (x.kPadrao + 1) + '"/>\n');
      cfg.push('  </part>\n');
    });
    cfg.push(' </object>\n');
  });
  xml.push(' </resources>\n <build>\n');
  build.forEach(b => xml.push(b));
  xml.push(' </build>\n</model>\n');
  cfg.push('</config>\n');

  const arquivos = [];
  arquivos.push({ nome: '[Content_Types].xml', dados:
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '<Default Extension="config" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '</Types>\n' });
  arquivos.push({ nome: '_rels/.rels', dados:
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    (opc.miniatura ? '<Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>' : '') +
    '</Relationships>\n' });
  arquivos.push({ nome: '3D/3dmodel.model', dados: xml.join('') });
  arquivos.push({ nome: 'Metadata/model_settings.config', dados: cfg.join('') });
  if (opc.miniatura) arquivos.push({ nome: 'Metadata/thumbnail.png', dados: opc.miniatura, nivel: 0 });
  return { bytes: escreverZip(arquivos), cores, avisos };
}

/* ============================================================== LEITURA */

// leitor de tag rápido: devolve { nome, local, ini, fim, vazia, fecha, attrs(ini,fim) }
function proximaTag(s, i) {
  while (true) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return null;
    const c = s.charCodeAt(lt + 1);
    if (c === 33) { // <! comentário / CDATA / doctype
      if (s.startsWith('<!--', lt)) { const f = s.indexOf('-->', lt); i = f < 0 ? s.length : f + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { const f = s.indexOf(']]>', lt); i = f < 0 ? s.length : f + 3; continue; }
      const f = s.indexOf('>', lt); i = f < 0 ? s.length : f + 1; continue;
    }
    if (c === 63) { const f = s.indexOf('?>', lt); i = f < 0 ? s.length : f + 2; continue; }
    let j = lt + 1, aspa = 0;
    while (j < s.length) {
      const ch = s.charCodeAt(j);
      if (aspa) { if (ch === aspa) aspa = 0; }
      else if (ch === 34 || ch === 39) aspa = ch;
      else if (ch === 62) break;
      j++;
    }
    const fecha = c === 47;
    let k = lt + (fecha ? 2 : 1);
    const n0 = k;
    while (k < j) { const ch = s.charCodeAt(k); if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 47) break; k++; }
    const nome = s.slice(n0, k);
    const dp = nome.indexOf(':');
    const vazia = s.charCodeAt(j - 1) === 47;
    return { nome, local: dp < 0 ? nome : nome.slice(dp + 1), ini: lt, fim: j + 1, attrIni: k, attrFim: vazia ? j - 1 : j, vazia, fecha };
  }
}

function attrsDe(s, t) {
  const o = {};
  let i = t.attrIni;
  const f = t.attrFim;
  while (i < f) {
    while (i < f && s.charCodeAt(i) <= 32) i++;
    const n0 = i;
    while (i < f && s.charCodeAt(i) !== 61 && s.charCodeAt(i) > 32) i++;
    const nome = s.slice(n0, i);
    while (i < f && s.charCodeAt(i) !== 61) i++;
    i++;
    while (i < f && s.charCodeAt(i) <= 32) i++;
    const q = s.charCodeAt(i);
    if (q !== 34 && q !== 39) break;
    const v0 = ++i;
    while (i < f && s.charCodeAt(i) !== q) i++;
    if (nome) o[nome] = s.slice(v0, i).indexOf('&') >= 0 ? decodificar(s.slice(v0, i)) : s.slice(v0, i);
    i++;
  }
  return o;
}

function localAttr(o, local) {
  if (o[local] != null) return o[local];
  for (const k in o) { const d = k.indexOf(':'); if (d >= 0 && k.slice(d + 1) === local && !k.startsWith('xmlns')) return o[k]; }
  return undefined;
}

// malha: vértices e triângulos, direto no texto (rápido)
function lerMalha(s, ini, fim, obj) {
  const pos = [];
  const idx = [];
  const tp = [];        // [pid, p1] por triângulo, ou null
  const pinta = [];     // paint_color / mmu_segmentation por triângulo
  let temTp = false, temPinta = false;
  let i = ini;
  while (i < fim) {
    const t = proximaTag(s, i);
    if (!t || t.ini >= fim) break;
    i = t.fim;
    if (t.fecha) continue;
    if (t.local === 'vertex') {
      const a = attrsDe(s, t);
      pos.push(+a.x, +a.y, +a.z);
    } else if (t.local === 'triangle') {
      const a = attrsDe(s, t);
      idx.push(+a.v1, +a.v2, +a.v3);
      if (a.p1 != null || a.pid != null) { tp.push(a.pid != null ? +a.pid : -1, a.p1 != null ? +a.p1 : -1); temTp = true; }
      else tp.push(-1, -1);
      const pc = a.paint_color != null ? a.paint_color : localAttr(a, 'mmu_segmentation');
      if (pc) { pinta.push(pc); temPinta = true; } else pinta.push(null);
    }
  }
  obj.malha = { pos, idx };
  if (temTp) obj.triProp = tp;
  if (temPinta) obj.pintura = pinta;
}

function lerModelo(s, caminho, docs) {
  const doc = { caminho, unidade: 'millimeter', meta: {}, objetos: new Map(), bases: new Map(), grupos: new Map(), itens: [], avisos: [] };
  let i = 0, obj = null, grupoAtual = null, baseAtual = null, emBuild = false, metaNome = null, metaIni = 0;
  while (true) {
    const t = proximaTag(s, i);
    if (!t) break;
    i = t.fim;
    const L = t.local;
    if (t.fecha) {
      if (L === 'object') obj = null;
      else if (L === 'colorgroup') grupoAtual = null;
      else if (L === 'basematerials') baseAtual = null;
      else if (L === 'build') emBuild = false;
      else if (L === 'metadata' && metaNome) { doc.meta[metaNome] = decodificar(s.slice(metaIni, t.ini)).trim(); metaNome = null; }
      continue;
    }
    if (L === 'model') {
      const a = attrsDe(s, t);
      if (a.unit) doc.unidade = a.unit;
    } else if (L === 'metadata' && !obj) {
      const a = attrsDe(s, t);
      if (!t.vazia && a.name) { metaNome = a.name; metaIni = t.fim; }
    } else if (L === 'object') {
      const a = attrsDe(s, t);
      obj = { id: a.id, tipo: a.type || 'model', pid: a.pid, pindex: a.pindex, nome: a.name || '', comps: [], malha: null, doc: caminho };
      doc.objetos.set(a.id, obj);
      if (t.vazia) obj = null;
    } else if (L === 'mesh' && obj) {
      const f = s.indexOf('mesh>', t.fim);
      const fimMesh = f < 0 ? s.length : f;
      lerMalha(s, t.fim, fimMesh, obj);
      i = fimMesh;
    } else if (L === 'component' && obj) {
      const a = attrsDe(s, t);
      obj.comps.push({ id: a.objectid, tx: lerTx(a.transform), caminho: localAttr(a, 'path') });
    } else if (L === 'basematerials') {
      const a = attrsDe(s, t);
      baseAtual = []; doc.bases.set(a.id, baseAtual);
    } else if (L === 'base' && baseAtual) {
      const a = attrsDe(s, t);
      baseAtual.push({ nome: a.name || '', cor: normalizarHex(a.displaycolor) });
    } else if (L === 'colorgroup') {
      const a = attrsDe(s, t);
      grupoAtual = []; doc.grupos.set(a.id, grupoAtual);
    } else if (L === 'color' && grupoAtual) {
      const a = attrsDe(s, t);
      grupoAtual.push(normalizarHex(a.color));
    } else if (L === 'texture2dgroup' || L === 'multiproperties' || L === 'compositematerials') {
      doc.avisos.push('O 3MF usa ' + L + ' (textura/mistura). Só as cores sólidas são trazidas.');
    } else if (L === 'build') emBuild = true;
    else if (L === 'item' && emBuild) {
      const a = attrsDe(s, t);
      doc.itens.push({ id: a.objectid, tx: lerTx(a.transform), caminho: localAttr(a, 'path'), imprimivel: a.printable !== '0' });
    }
  }
  docs.set(caminho, doc);
  return doc;
}

function lerTx(s) {
  if (!s) return M4.identidade();
  const v = String(s).trim().split(/\s+/).map(Number);
  if (v.length !== 12 || !v.every(isFinite)) return M4.identidade();
  return M4.de3MF(v);
}

// Pintura do Bambu/Prusa: string hex lida de trás pra frente, 4 bits por
// nó. Devolve o estado (filamento) que ocupa mais área no triângulo.
export function decodificarPintura(str) {
  if (!str) return 0;
  const nib = [];
  for (let k = str.length - 1; k >= 0; k--) {
    const ch = str.charCodeAt(k);
    const v = ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - 55 : ch >= 97 && ch <= 102 ? ch - 87 : -1;
    if (v < 0) return 0;
    nib.push(v);
  }
  let p = 0;
  const areas = new Map();
  const prox = () => (p < nib.length ? nib[p++] : -1);
  function no(peso) {
    const code = prox();
    if (code < 0) return false;
    const lados = code & 3;
    if (lados === 0) {
      let st;
      if ((code & 12) === 12) {
        let n = prox(), k = 0;
        while (n === 15) { k++; n = prox(); }
        if (n < 0) return false;
        st = n + 15 * k + 3;
      } else st = code >> 2;
      areas.set(st, (areas.get(st) || 0) + peso);
      return true;
    }
    const filhos = lados + 1;
    for (let f = 0; f < filhos; f++) if (!no(peso / filhos)) return false;
    return true;
  }
  if (!no(1)) return 0;
  let melhor = 0, maior = -1;
  areas.forEach((a, st) => { if (a > maior) { maior = a; melhor = st; } });
  return melhor;
}

function lerConfigBambu(txt) {
  // <object id><metadata key=name value/> <part id subtype><metadata .../></part></object>
  const out = new Map();
  if (!txt) return out;
  let i = 0, obj = null, parte = null;
  while (true) {
    const t = proximaTag(txt, i);
    if (!t) break;
    i = t.fim;
    if (t.fecha) {
      if (t.local === 'part') parte = null;
      else if (t.local === 'object') obj = null;
      continue;
    }
    const a = attrsDe(txt, t);
    if (t.local === 'object') { obj = { meta: {}, partes: new Map() }; out.set(a.id, obj); if (t.vazia) obj = null; }
    else if (t.local === 'part' && obj) { parte = { meta: {}, tipo: a.subtype || 'normal_part' }; obj.partes.set(a.id, parte); if (t.vazia) parte = null; }
    else if (t.local === 'metadata' && obj && a.key != null) (parte || obj).meta[a.key] = a.value;
    else if (t.local === 'plate') { obj = null; parte = null; }
  }
  return out;
}

function acharCaminho(arquivos, caminho) {
  const c = String(caminho || '').replace(/^\/+/, '');
  if (arquivos[c]) return c;
  const baixo = c.toLowerCase();
  for (const k of Object.keys(arquivos)) if (k.toLowerCase() === baixo) return k;
  return null;
}

export function ler3MF(bytes, nomeArquivo) {
  const arquivos = lerZip(bytes);
  const avisos = [];
  let raizCaminho = null;
  const rels = acharCaminho(arquivos, '_rels/.rels');
  if (rels) {
    const r = u8ParaTexto(arquivos[rels]);
    const m = /<Relationship\b[^>]*Type="[^"]*\/3dmodel"[^>]*>/i.exec(r);
    if (m) { const tg = /Target="([^"]+)"/.exec(m[0]); if (tg) raizCaminho = acharCaminho(arquivos, tg[1]); }
  }
  if (!raizCaminho) raizCaminho = acharCaminho(arquivos, '3D/3dmodel.model');
  if (!raizCaminho) throw new Error('Não achei o modelo dentro do 3MF (3D/3dmodel.model).');

  const docs = new Map();
  const doc = nome => {
    const k = acharCaminho(arquivos, nome);
    if (!k) return null;
    return docs.get(k) || lerModelo(u8ParaTexto(arquivos[k]), k, docs);
  };
  const raiz = doc(raizCaminho);
  const fator = FATOR_UNIDADE[raiz.unidade] || 1;
  if (!FATOR_UNIDADE[raiz.unidade]) avisos.push('Unidade "' + raiz.unidade + '" desconhecida; usei milímetros.');
  const app = raiz.meta.Application || '';
  const ehBambu = /^(BambuStudio|OrcaSlicer)-/i.test(app);
  const cfgTxt = arquivos[acharCaminho(arquivos, 'Metadata/model_settings.config')];
  const cfg = lerConfigBambu(cfgTxt ? u8ParaTexto(cfgTxt) : '');
  let filamentos = [];
  const projK = acharCaminho(arquivos, 'Metadata/project_settings.config');
  if (projK) {
    try { const j = JSON.parse(u8ParaTexto(arquivos[projK])); if (Array.isArray(j.filament_colour)) filamentos = j.filament_colour.map(normalizarHex); }
    catch (e) { /* não é json */ }
  }
  const prusaCfg = acharCaminho(arquivos, 'Metadata/Slic3r_PE_model.config');
  const usarExtrusor = ehBambu && filamentos.length > 0;
  raiz.avisos.forEach(a => avisos.push(a));

  const corDeRecurso = (d, pid, k) => {
    if (pid == null || k == null || k < 0) return null;
    const g = d.grupos.get(String(pid));
    if (g) return g[k] || null;
    const b = d.bases.get(String(pid));
    if (b) return b[k] ? b[k].cor : null;
    return null;
  };

  const objetosSaida = [];
  const S = M4.escala(fator, fator, fator), Si = M4.escala(1 / fator, 1 / fator, 1 / fator);
  let contItem = 0;
  for (const it of raiz.itens) {
    contItem++;
    const dItem = it.caminho ? doc(it.caminho) : raiz;
    if (!dItem) { avisos.push('Item aponta pra arquivo inexistente: ' + it.caminho); continue; }
    const o0 = dItem.objetos.get(String(it.id));
    if (!o0) { avisos.push('Item aponta pra objeto inexistente: ' + it.id); continue; }
    if (o0.tipo !== 'model' && o0.tipo !== 'solidsupport') continue;
    const cfgObj = cfg.get(String(it.id));
    const extObj = cfgObj && cfgObj.meta.extruder ? parseInt(cfgObj.meta.extruder, 10) : 1;
    const partes = [];
    const visitar = (o, d, tx, profundidade, idComp) => {
      if (profundidade > 32) return;
      if (o.malha) {
        const cfgParte = cfgObj ? cfgObj.partes.get(String(idComp != null ? idComp : o.id)) : null;
        if (cfgParte && cfgParte.tipo && cfgParte.tipo !== 'normal_part') {
          avisos.push('Peça "' + (cfgParte.meta.name || o.nome) + '" é ' + cfgParte.tipo + ' (modificador/suporte) e ficou de fora.');
          return;
        }
        if (o.tipo === 'support' || o.tipo === 'other') return;
        const nv = o.malha.pos.length / 3;
        const pos = new Float64Array(o.malha.pos.length);
        const T = M4.multiplicar(S, tx);      // em mm, relativo ao item
        for (let v = 0; v < nv; v++) {
          const x = o.malha.pos[v * 3], y = o.malha.pos[v * 3 + 1], z = o.malha.pos[v * 3 + 2];
          pos[v * 3] = T[0] * x + T[4] * y + T[8] * z + T[12];
          pos[v * 3 + 1] = T[1] * x + T[5] * y + T[9] * z + T[13];
          pos[v * 3 + 2] = T[2] * x + T[6] * y + T[10] * z + T[14];
        }
        let idx = Uint32Array.from(o.malha.idx);
        const ntri = idx.length / 3;
        let ruins = 0;
        for (let q = 0; q < idx.length; q++) if (idx[q] >= nv) { idx[q] = 0; ruins++; }
        if (ruins) avisos.push('Peça "' + o.nome + '": ' + ruins + ' índice(s) de vértice inválido(s).');
        if (M4.determinante(tx) < 0) for (let q = 0; q < idx.length; q += 3) { const x = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = x; }
        // cor padrão da peça
        let corPadrao = null;
        const extParte = cfgParte && cfgParte.meta.extruder ? parseInt(cfgParte.meta.extruder, 10) : extObj;
        if (usarExtrusor) corPadrao = filamentos[(extParte || 1) - 1] || filamentos[0];
        if (!corPadrao) corPadrao = corDeRecurso(d, o.pid, o.pindex != null ? +o.pindex : 0);
        // cor por triângulo
        let paleta = null, cor = null;
        const temTri = o.triProp || (o.pintura && usarExtrusor);
        if (temTri) {
          const kc = new Map();
          paleta = [];
          cor = new Uint16Array(ntri);
          const reg = h => { const n = h || corPadrao || COR_PADRAO; let k = kc.get(n); if (k === undefined) { k = paleta.length; paleta.push(n); kc.set(n, k); } return k; };
          reg(corPadrao);
          for (let t = 0; t < ntri; t++) {
            let h = null;
            if (o.pintura && usarExtrusor && o.pintura[t]) {
              const st = decodificarPintura(o.pintura[t]);
              if (st > 0) h = filamentos[st - 1] || null;
            }
            if (!h && o.triProp) {
              const pid = o.triProp[t * 2] >= 0 ? o.triProp[t * 2] : o.pid;
              const p1 = o.triProp[t * 2 + 1];
              if (p1 >= 0) h = corDeRecurso(d, pid, p1);
            }
            cor[t] = reg(h);
          }
          if (paleta.length < 2) { corPadrao = paleta[0]; paleta = null; cor = null; }
        } else if (o.pintura && !usarExtrusor) {
          avisos.push('Tem pintura por triângulo, mas o arquivo não diz as cores dos filamentos.');
        }
        const nome = (cfgParte && cfgParte.meta.name) || o.nome || '';
        partes.push({ nome, malha: criar(pos, idx, cor), cor: corPadrao || COR_PADRAO, paleta, corDeclarada: !!corPadrao });
      }
      for (const c of o.comps) {
        const dc = c.caminho ? doc(c.caminho) : d;
        if (!dc) { avisos.push('Componente aponta pra arquivo inexistente: ' + c.caminho); continue; }
        const oc = dc.objetos.get(String(c.id));
        if (!oc) { avisos.push('Componente aponta pra objeto inexistente: ' + c.id); continue; }
        visitar(oc, dc, M4.multiplicar(tx, c.tx), profundidade + 1, c.id);
      }
    };
    visitar(o0, dItem, M4.identidade(), 0, null);
    if (!partes.length) continue;
    const nomeObj = (cfgObj && cfgObj.meta.name) || o0.nome || ((nomeArquivo || 'modelo').replace(/\.[^.]+$/, '') + (raiz.itens.length > 1 ? ' ' + contItem : ''));
    partes.forEach((p, k) => { if (!p.nome) p.nome = partes.length > 1 ? nomeObj + ' - peça ' + (k + 1) : nomeObj; });
    // transformação do item em mm: S * T * S^-1 (só a translação escala)
    const T = M4.multiplicar(S, M4.multiplicar(it.tx, Si));
    objetosSaida.push({ nome: nomeObj, transform: T, partes, imprimivel: it.imprimivel });
  }
  if (!objetosSaida.length) throw new Error('O 3MF não tem nenhum objeto imprimível no build.');
  return {
    objetos: objetosSaida,
    unidade: raiz.unidade,
    fator,
    aplicacao: app,
    origem: ehBambu ? 'bambu' : (prusaCfg ? 'prusa' : 'padrao'),
    filamentos,
    avisos
  };
}

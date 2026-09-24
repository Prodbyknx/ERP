/* Exportador 3MF ANTIGO (como estava no sistema antes da correção), guardado só pra
   o teste mostrar por que a cor mudava no Bambu Studio. Não é usado pelo sistema. */
/* ===
   3MF — escrita e leitura.
   Escreve no formato que o Bambu Studio e o Orca entendem de verdade:
     3D/3dmodel.model              geometria + materiais (nucleo 3MF)
     Metadata/model_settings.config  qual filamento e cada parte
     Metadata/project_settings.config  a COR de cada filamento
   O Bambu IGNORA displaycolor na hora de pintar: ele usa a cor do filamento.
   Sem project_settings.config ele mostra as cores do AMS do usuario, e por
   isso a cor "mudava" entre o sistema e o slicer.
   =========================================================================== */
(function (raiz) {
'use strict';

var MALHA = (typeof require === 'function' && typeof module !== 'undefined')
  ? null : raiz.MALHA;   // o exportador antigo não usava MALHA de verdade

function escXml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
  });
}

function hex2(v) {
  var t = Math.max(0, Math.min(255, Math.round(v))).toString(16).toUpperCase();
  return t.length < 2 ? '0' + t : t;
}
function corHex(c) { return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]); }
function hexPraRGB(h) {
  var m = /^#?([0-9a-fA-F]{6})/.exec(String(h || ''));
  if (!m) return null;
  var v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/* --------------------------------------------------------------------------
   ESCRITA
   pecas: [{ nome, cor:[r,g,b], malha:{pos,idx} }]   em MILIMETROS
   -------------------------------------------------------------------------- */
function exportar(pecas, opc) {
  opc = opc || {};
  var nome = opc.nome || 'peca';
  var casas = opc.casas == null ? 4 : opc.casas;
  function n(v) { return +v.toFixed(casas); }

  var xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push('<model unit="millimeter" xml:lang="en-US" '
    + 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
    + 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">');
  xml.push('<metadata name="Application">144 Laboratorio 3D</metadata>');
  xml.push('<metadata name="Title">' + escXml(nome) + '</metadata>');
  xml.push('<resources>');

  // materiais: id 100, um por peca, na mesma ordem das partes
  xml.push('<basematerials id="100">');
  pecas.forEach(function (p) {
    xml.push('<base name="' + escXml(p.nome || 'parte') + '" displaycolor="'
      + corHex(p.cor || [200, 200, 200]) + 'FF"/>');
  });
  xml.push('</basematerials>');

  // uma malha por peca, ids 2..N+1
  pecas.forEach(function (p, i) {
    var m = p.malha;
    xml.push('<object id="' + (i + 2) + '" type="model" pid="100" pindex="' + i
      + '" name="' + escXml(p.nome || 'parte') + '"><mesh><vertices>');
    for (var v = 0; v < m.pos.length; v += 3) {
      xml.push('<vertex x="' + n(m.pos[v]) + '" y="' + n(m.pos[v + 1]) +
               '" z="' + n(m.pos[v + 2]) + '"/>');
    }
    xml.push('</vertices><triangles>');
    for (var t = 0; t < m.idx.length; t += 3) {
      xml.push('<triangle v1="' + m.idx[t] + '" v2="' + m.idx[t + 1] +
               '" v3="' + m.idx[t + 2] + '"/>');
    }
    xml.push('</triangles></mesh></object>');
  });

  // o objeto 1 e a peca montada; e o id que o model_settings referencia
  xml.push('<object id="1" type="model" name="' + escXml(nome) + '"><components>');
  pecas.forEach(function (p, i) {
    xml.push('<component objectid="' + (i + 2) + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>');
  });
  xml.push('</components></object>');
  xml.push('</resources>');
  xml.push('<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/></build>');
  xml.push('</model>');

  // qual filamento e cada parte
  var cfg = [];
  cfg.push('<?xml version="1.0" encoding="UTF-8"?>');
  cfg.push('<config>');
  cfg.push('<object id="1">');
  cfg.push('<metadata key="name" value="' + escXml(nome) + '"/>');
  cfg.push('<metadata key="extruder" value="1"/>');
  pecas.forEach(function (p, i) {
    cfg.push('<part id="' + (i + 2) + '" subtype="normal_part">');
    cfg.push('<metadata key="name" value="' + escXml(p.nome || 'parte') + '"/>');
    cfg.push('<metadata key="extruder" value="' + (i + 1) + '"/>');
    cfg.push('<mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" '
      + 'facets_reversed="0" backwards_edges="0"/>');
    cfg.push('</part>');
  });
  cfg.push('</object>');
  cfg.push('</config>');

  // A COR de cada filamento. Sem isto o Bambu pinta com as cores do AMS.
  var cores = pecas.map(function (p) { return corHex(p.cor || [200, 200, 200]); });
  var proj = {
    version: '01.08.00.00',
    from: '144lab',
    filament_colour: cores,
    filament_type: cores.map(function () { return 'PLA'; }),
    filament_settings_id: cores.map(function () { return 'Generic PLA'; }),
    filament_ids: cores.map(function (_c, i) { return 'GFL99_' + (i + 1); })
  };

  var enc = new TextEncoder();
  return [
    { nome: '[Content_Types].xml', dados: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '<Default Extension="config" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '</Types>') },
    { nome: '_rels/.rels', dados: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel-1" ' +
      'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
      '</Relationships>') },
    { nome: '3D/3dmodel.model', dados: enc.encode(xml.join('')) },
    { nome: 'Metadata/model_settings.config', dados: enc.encode(cfg.join('')) },
    { nome: 'Metadata/project_settings.config', dados: enc.encode(JSON.stringify(proj, null, 4)) }
  ];
}

/* --------------------------------------------------------------------------
   LEITURA — parser proprio, sem DOM (funciona no node e no navegador)
   -------------------------------------------------------------------------- */

function _attrs(tag) {
  var o = {}, re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g, m;
  while ((m = re.exec(tag))) o[m[1]] = m[2];
  return o;
}

function _mult(a, b) {                 // 4x3 (3MF guarda 12 numeros)
  var r = new Array(12);
  for (var c = 0; c < 3; c++) {
    for (var l = 0; l < 3; l++) {
      r[c * 3 + l] = a[0 * 3 + l] * b[c * 3 + 0] + a[1 * 3 + l] * b[c * 3 + 1]
                   + a[2 * 3 + l] * b[c * 3 + 2];
    }
  }
  for (var k = 0; k < 3; k++) {
    r[9 + k] = a[0 * 3 + k] * b[9] + a[1 * 3 + k] * b[10] + a[2 * 3 + k] * b[11] + a[9 + k];
  }
  return r;
}
var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function _tx(t, p) {
  return [
    t[0] * p[0] + t[3] * p[1] + t[6] * p[2] + t[9],
    t[1] * p[0] + t[4] * p[1] + t[7] * p[2] + t[10],
    t[2] * p[0] + t[5] * p[1] + t[8] * p[2] + t[11]
  ];
}
function _parseTx(s) {
  if (!s) return IDENT.slice();
  var p = String(s).trim().split(/\s+/).map(Number);
  return p.length === 12 && p.every(function (x) { return isFinite(x); }) ? p : IDENT.slice();
}

/* arquivos: { 'caminho': Uint8Array | string }                              */
function ler(arquivos) {
  function txt(k) {
    var d = arquivos[k];
    if (d == null) return null;
    if (typeof d === 'string') return d;
    return new TextDecoder().decode(d);
  }
  var modelo = txt('3D/3dmodel.model');
  if (!modelo) throw new Error('3MF sem 3D/3dmodel.model');

  var unidade = (/<model[^>]*unit="([^"]+)"/.exec(modelo) || [, 'millimeter'])[1];
  var fator = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8,
                meter: 1000 }[unidade] || 1;

  // materiais
  var materiais = {};                   // "pid:indice" -> {nome, cor}
  var reBm = /<basematerials[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/basematerials>/g, mb;
  while ((mb = reBm.exec(modelo))) {
    var pid = mb[1], i = 0;
    var reB = /<base\b([^>]*)\/?>/g, bb;
    while ((bb = reB.exec(mb[2]))) {
      var a = _attrs(bb[1]);
      materiais[pid + ':' + i] = { nome: a.name || '', cor: hexPraRGB(a.displaycolor) };
      i++;
    }
  }

  // objetos
  var objetos = {};
  var reObj = /<object\b([^>]*)>([\s\S]*?)<\/object>/g, mo;
  while ((mo = reObj.exec(modelo))) {
    var at = _attrs(mo[1]), corpo = mo[2];
    var o = { id: at.id, nome: at.name || '', pid: at.pid, pindex: at.pindex,
              malha: null, comps: [] };
    var mv = /<vertices>([\s\S]*?)<\/vertices>/.exec(corpo);
    var mt = /<triangles>([\s\S]*?)<\/triangles>/.exec(corpo);
    if (mv && mt) {
      var pos = [], idx = [];
      var reV = /<vertex\b([^>]*)\/?>/g, vv;
      while ((vv = reV.exec(mv[1]))) {
        var va = _attrs(vv[1]);
        pos.push(+va.x * fator, +va.y * fator, +va.z * fator);
      }
      var reT = /<triangle\b([^>]*)\/?>/g, tt;
      while ((tt = reT.exec(mt[1]))) {
        var ta = _attrs(tt[1]);
        idx.push(+ta.v1, +ta.v2, +ta.v3);
      }
      o.malha = { pos: Float64Array.from(pos), idx: Uint32Array.from(idx) };
    }
    var mc = /<components>([\s\S]*?)<\/components>/.exec(corpo);
    if (mc) {
      var reC = /<component\b([^>]*)\/?>/g, cc;
      while ((cc = reC.exec(mc[1]))) {
        var ca = _attrs(cc[1]);
        o.comps.push({ id: ca.objectid, tx: _parseTx(ca.transform) });
      }
    }
    objetos[at.id] = o;
  }

  // model_settings: nome e filamento de cada parte
  var ajustes = {};
  var cfg = txt('Metadata/model_settings.config');
  if (cfg) {
    var reP = /<part\b([^>]*)>([\s\S]*?)<\/part>/g, mp;
    while ((mp = reP.exec(cfg))) {
      var pa = _attrs(mp[1]), meta = {};
      var reM = /<metadata\b([^>]*)\/?>/g, mm2;
      while ((mm2 = reM.exec(mp[2]))) {
        var ma = _attrs(mm2[1]);
        if (ma.key) meta[ma.key] = ma.value;
      }
      ajustes[pa.id] = meta;
    }
  }

  // cores dos filamentos
  var filamentos = [];
  var proj = txt('Metadata/project_settings.config');
  if (proj) {
    try {
      var j = JSON.parse(proj);
      if (Array.isArray(j.filament_colour)) filamentos = j.filament_colour.slice();
    } catch (e) { /* nao e json: ignora */ }
  }

  // percorre o build aplicando transformacoes
  var saida = [];
  function visitar(id, tx) {
    var o = objetos[id];
    if (!o) return;
    if (o.malha) {
      var pos = new Float64Array(o.malha.pos.length);
      for (var v = 0; v < o.malha.pos.length; v += 3) {
        var p = _tx(tx, [o.malha.pos[v], o.malha.pos[v + 1], o.malha.pos[v + 2]]);
        pos[v] = p[0]; pos[v + 1] = p[1]; pos[v + 2] = p[2];
      }
      var mat = (o.pid != null && o.pindex != null) ? materiais[o.pid + ':' + o.pindex] : null;
      var aj = ajustes[o.id] || {};
      var ext = aj.extruder ? parseInt(aj.extruder, 10) : null;
      var corFil = (ext && filamentos[ext - 1]) ? hexPraRGB(filamentos[ext - 1]) : null;
      saida.push({
        nome: aj.name || o.nome || ('parte ' + o.id),
        cor: corFil || (mat ? mat.cor : null) || [200, 200, 200],
        corMaterial: mat ? mat.cor : null,
        corFilamento: corFil,
        extruder: ext,
        malha: { pos: pos, idx: Uint32Array.from(o.malha.idx) }
      });
    }
    o.comps.forEach(function (c) { visitar(c.id, _mult(tx, c.tx)); });
  }

  var reIt = /<item\b([^>]*)\/?>/g, mi;
  while ((mi = reIt.exec(modelo))) {
    var ia = _attrs(mi[1]);
    if (ia.objectid) visitar(ia.objectid, _parseTx(ia.transform));
  }

  return { unidade: unidade, fator: fator, pecas: saida, filamentos: filamentos };
}

var API = { exportar: exportar, ler: ler, corHex: corHex, hexPraRGB: hexPraRGB };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else raiz.TREIMF = API;
void MALHA;

})(typeof self !== 'undefined' ? self : this);

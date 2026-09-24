// Leitor de XML mínimo e rápido, sem DOM (Web Worker não tem DOMParser).
// Serve pro 3MF: só precisa de tags, atributos e texto de <metadata>.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodificar(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] != null ? ENT[e] : m;
  });
}

export function escapar(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// atributos de uma string 'a="1" b=\'2\''
export function atributos(s) {
  const o = {};
  const re = /([^\s=\/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = decodificar(m[3] != null ? m[3] : m[4]);
  return o;
}

// Percorre as tags. cb(evento) com evento = { tipo:'abre'|'fecha'|'texto', nome, attrs(string), vazia, pos }
// Se cb devolver false, para.
export function percorrer(xml, cb) {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const txt = xml.slice(i, lt);
      if (txt.trim() && cb({ tipo: 'texto', texto: decodificar(txt) }) === false) return;
    }
    const c = xml.charCodeAt(lt + 1);
    if (c === 33) { // <!
      if (xml.startsWith('<!--', lt)) { const f = xml.indexOf('-->', lt + 4); i = f < 0 ? n : f + 3; continue; }
      if (xml.startsWith('<![CDATA[', lt)) {
        const f = xml.indexOf(']]>', lt + 9);
        const txt = xml.slice(lt + 9, f < 0 ? n : f);
        if (cb({ tipo: 'texto', texto: txt }) === false) return;
        i = f < 0 ? n : f + 3; continue;
      }
      const f = xml.indexOf('>', lt); i = f < 0 ? n : f + 1; continue;
    }
    if (c === 63) { const f = xml.indexOf('?>', lt); i = f < 0 ? n : f + 2; continue; } // <?
    // fim da tag, respeitando aspas
    let j = lt + 1, aspa = 0;
    while (j < n) {
      const ch = xml.charCodeAt(j);
      if (aspa) { if (ch === aspa) aspa = 0; }
      else if (ch === 34 || ch === 39) aspa = ch;
      else if (ch === 62) break;
      j++;
    }
    const corpo = xml.slice(lt + 1, j);
    i = j + 1;
    if (corpo[0] === '/') {
      if (cb({ tipo: 'fecha', nome: corpo.slice(1).trim(), pos: lt }) === false) return;
      continue;
    }
    let vazia = false, fimNome = 0;
    let s = corpo;
    if (s.endsWith('/')) { vazia = true; s = s.slice(0, -1); }
    while (fimNome < s.length && !/\s/.test(s[fimNome])) fimNome++;
    const nome = s.slice(0, fimNome);
    if (cb({ tipo: 'abre', nome, attrs: s.slice(fimNome), vazia, pos: lt }) === false) return;
    if (vazia && cb({ tipo: 'fecha', nome, pos: lt, auto: true }) === false) return;
  }
}

// prefixo:local -> [prefixo, local]
export function separarNome(n) {
  const k = n.indexOf(':');
  return k < 0 ? ['', n] : [n.slice(0, k), n.slice(k + 1)];
}

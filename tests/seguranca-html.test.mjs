// Regra de segurança do 3D: texto que vem de FORA (nome de objeto/peça/
// material lido do arquivo, mensagem de erro, aviso do motor, nome digitado)
// nunca entra em innerHTML sem esc(). Um arquivo 3D baixado da internet com
// código no nome executava dentro do ERP (auditoria, item S1).
// Este teste lê o código das telas e falha se aparecer de novo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pastas = ['src/estudio3d/ui', 'src/estudio3d/lab'];
const arquivos = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? arquivos(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);

// nomes que carregam texto de fora
const PERIGO = /\b(?:nome|name|message|avisos?|erro|alerta|passos|titulo|texto|rotulo|origem\.url|relatorio)\b/;

// tira strings literais, chamadas esc(...) (com parênteses equilibrados),
// lista.map(esc) e x.length (número)
function limpar(linha) {
  let s = linha.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  s = s.replace(/[\w$.]+\.map\(esc\)/g, 'X').replace(/[\w$.]+\.length\b/g, 'N');
  for (;;) {
    const i = s.search(/\besc\(/);
    if (i < 0) break;
    let j = i + 4, n = 1;
    while (j < s.length && n) { if (s[j] === '(') n++; else if (s[j] === ')') n--; j++; }
    s = s.slice(0, i) + 'X' + s.slice(j);
  }
  return s;
}

test('tela 3D: nenhum texto de fora entra em innerHTML sem esc()', () => {
  const ruins = [];
  for (const p of pastas) for (const f of arquivos(path.join(raiz, p))) {
    const fonte = fs.readFileSync(f, 'utf8');
    const re = /innerHTML\s*\+?=|\bhtml:\s|insertAdjacentHTML\(/g;
    let m;
    while ((m = re.exec(fonte))) {
      const linhaIni = fonte.lastIndexOf('\n', m.index) + 1, linhaFim = fonte.indexOf('\n', m.index);
      const linha = fonte.slice(linhaIni, linhaFim < 0 ? undefined : linhaFim);
      if (/html-seguro/.test(linha)) continue;              // linha revisada: só número/ícone
      // a instrução inteira (pode ter várias linhas), sem strings e sem esc(...)
      let resto = limpar(fonte.slice(m.index, m.index + 2000));
      if (/^html:/.test(resto)) {                            // só o valor da propriedade html:
        let n = 0, j = 5;
        for (; j < resto.length; j++) { const c = resto[j]; if ('([{'.includes(c)) n++; else if (')]}'.includes(c)) { if (!n) break; n--; } else if (c === ',' && !n) break; }
        resto = resto.slice(0, j);
      } else {
        const fimInstr = resto.indexOf(';');
        if (fimInstr >= 0) resto = resto.slice(0, fimInstr);
      }
      const achou = resto.replace(/innerHTML|insertAdjacentHTML|html:/g, '').match(PERIGO);
      if (achou) ruins.push(path.relative(raiz, f) + ':' + (fonte.slice(0, m.index).split('\n').length) + ' -> ' + achou[0] + ' :: ' + linha.trim().slice(0, 140));
    }
  }
  assert.deepEqual(ruins, [], 'texto de fora em innerHTML sem esc():\n' + ruins.join('\n'));
});

test('a regra pega o caso que existia (selecionar.js antigo)', () => {
  const antigo = "box.innerHTML = 'Nada selecionado em <b>' + p.nome + '</b>.';";
  assert.ok(PERIGO.test(limpar(antigo.slice(antigo.indexOf('innerHTML'))).replace(/innerHTML/g, '')));
  const novo = "box.innerHTML = 'Nada selecionado em <b>' + esc(p.nome) + '</b>.';";
  assert.ok(!PERIGO.test(limpar(novo.slice(novo.indexOf('innerHTML'))).replace(/innerHTML/g, '')));
});

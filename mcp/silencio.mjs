// No MCP por stdio, o stdout é SÓ do protocolo: qualquer console.log do
// motor quebraria a conversa com o Claude. Tudo vai pro stderr (log).
// Importado ANTES de todo o resto.
const erro = (...a) => process.stderr.write(a.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ') + '\n');
console.log = erro; console.info = erro; console.warn = erro; console.debug = erro;

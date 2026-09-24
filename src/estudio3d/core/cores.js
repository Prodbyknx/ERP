// Cores: o sistema guarda SEMPRE '#RRGGBB' (sRGB, 8 bits, maiúsculo).
// É exatamente o que o Bambu Studio lê do 3MF ('#RRGGBBAA' no m:color) e
// o que ele grava como cor de filamento. Nada de float, nada de espaço linear
// na hora de salvar: a conversão pra linear só existe no desenho da tela.

export const COR_PADRAO = '#B4BAC4';

export function normalizarHex(c) {
  if (c == null) return null;
  if (Array.isArray(c) || ArrayBuffer.isView(c)) return rgbParaHex(c);
  let s = String(c).trim();
  if (s[0] === '#') s = s.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  else if (/^[0-9a-fA-F]{4}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  else if (/^[0-9a-fA-F]{8}$/.test(s)) s = s.slice(0, 6);
  else if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.toUpperCase();
}

export function alfaDeHex(c) {
  let s = String(c || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6), 16);
  if (/^[0-9a-fA-F]{4}$/.test(s)) return parseInt(s[3] + s[3], 16);
  return 255;
}

export function hexParaRGB(h) {
  const n = normalizarHex(h);
  if (!n) return null;
  const v = parseInt(n.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbParaHex(c) {
  const h = v => {
    const t = Math.max(0, Math.min(255, Math.round(v))).toString(16).toUpperCase();
    return t.length < 2 ? '0' + t : t;
  };
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

// cor do MTL/OBJ vem em 0..1 (convenção sRGB, é o que o Bambu faz com Kd)
export function rgb01ParaHex(r, g, b) { return rgbParaHex([r * 255, g * 255, b * 255]); }

export function hexComAlfa(h) { return (normalizarHex(h) || COR_PADRAO) + 'FF'; }

// sRGB 8 bits -> linear 0..1 (só pro desenho no three.js)
export function srgbParaLinear(v8) {
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexParaLinear(h) {
  const c = hexParaRGB(h) || hexParaRGB(COR_PADRAO);
  return [srgbParaLinear(c[0]), srgbParaLinear(c[1]), srgbParaLinear(c[2])];
}

export function distanciaCor(a, b) {
  const x = hexParaRGB(a), y = hexParaRGB(b);
  if (!x || !y) return Infinity;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Paleta pra peças novas: contraste alto e fácil de nomear
export const PALETA_PECAS = ['#E54C00', '#1F6FEB', '#2DA44E', '#F2C12E', '#8250DF', '#D1242F', '#0FA3B1', '#6E7781', '#FFFFFF', '#1B1B1B'];

export function nomeDaCor(h) {
  const nomes = {
    '#FFFFFF': 'Branco', '#000000': 'Preto', '#1B1B1B': 'Preto', '#E54C00': 'Laranja 144',
    '#D1242F': 'Vermelho', '#1F6FEB': 'Azul', '#2DA44E': 'Verde', '#F2C12E': 'Amarelo',
    '#8250DF': 'Roxo', '#0FA3B1': 'Turquesa', '#6E7781': 'Cinza'
  };
  const n = normalizarHex(h);
  if (nomes[n]) return nomes[n];
  const c = hexParaRGB(n);
  if (!c) return 'Cor';
  const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 50) return 'Preto';
  if (mn > 215) return 'Branco';
  if (mx - mn < 25) return 'Cinza';
  if (r >= g && r >= b) return g > 150 ? 'Amarelo' : (g > 90 ? 'Laranja' : 'Vermelho');
  if (g >= r && g >= b) return 'Verde';
  return r > 120 ? 'Roxo' : 'Azul';
}

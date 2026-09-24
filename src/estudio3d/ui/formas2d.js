// Texto / imagem / SVG -> contorno 2D em milímetros (anéis, regra par-ímpar),
// centrado em (0,0). Usa o mesmo contorno sub-pixel do gerador (window.GEO).

function geo() {
  const G = window.GEO;
  if (!G || !G.gruposDeMascara) throw new Error('Módulo de contorno (GEO) não carregado.');
  return G;
}

// grupos (px, y pra baixo) -> anéis em mm, y pra cima, centrados, com largura alvo
function gruposParaForma(grupos, larguraMM) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of grupos) for (const p of g.externo) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  if (!isFinite(x0)) throw new Error('Nada pra transformar em relevo.');
  const s = larguraMM / Math.max(1e-9, x1 - x0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const conv = anel => anel.map(p => [(p[0] - cx) * s, -(p[1] - cy) * s]);
  const aneis = [];
  for (const g of grupos) { aneis.push(conv(g.externo)); for (const f of g.furos) aneis.push(conv(f)); }
  return { aneis, largura: (x1 - x0) * s, altura: (y1 - y0) * s, pixelMM: s };
}

function mascaraParaForma(m, larguraMM, larguraPx) {
  const G = geo();
  const escala = larguraMM / Math.max(1, larguraPx);          // mm por pixel
  const grupos = G.gruposDeMascara(m, {
    tolerancia: Math.min(4, Math.max(0.25, 0.04 / escala)),
    areaMinima: Math.max(2, (0.25 * 0.25) / (escala * escala))
  });
  if (!grupos.length) throw new Error('Não achei nenhum contorno no desenho.');
  return gruposParaForma(grupos, larguraMM);
}

function larguraConteudo(m) {
  let x0 = m.w, x1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return x1 >= x0 ? x1 - x0 + 1 : 0;
}

export const FONTES = ['Arial Black', 'Impact', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS'];

export function formaDeTexto(texto, opc = {}) {
  const G = geo();
  const linhas = String(texto || '').split(/\r?\n/).map(s => s.trimEnd()).filter((s, i, a) => s || a.length === 1);
  if (!linhas.join('').trim()) throw new Error('Escreva o texto.');
  const tam = 280;
  const peso = opc.negrito === false ? '400' : '700';
  const fonte = (opc.italico ? 'italic ' : '') + peso + ' ' + tam + 'px "' + (opc.fonte || 'Arial Black') + '", sans-serif';
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.font = fonte;
  const larg = Math.max(...linhas.map(l => ctx.measureText(l).width));
  const alturaLinha = tam * 1.18;
  cv.width = Math.min(6000, Math.ceil(larg) + 120);
  cv.height = Math.ceil(alturaLinha * linhas.length + 120);
  ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#000'; ctx.font = fonte; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  linhas.forEach((l, i) => ctx.fillText(l, cv.width / 2, 60 + alturaLinha * (i + 0.5)));
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  const m = G.mascaraDePixels(d.data, cv.width, cv.height, { limiar: 128 });
  return mascaraParaForma(m, opc.largura || 40, larguraConteudo(m));
}

function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
    img.src = src;
  });
}

// imagem (PNG/JPG/SVG) -> máscara, escolhendo sozinho: transparência, fundo liso ou claro/escuro
async function mascaraDeArquivo(file, ladoMax, opc) {
  const G = geo();
  const url = URL.createObjectURL(file);
  try {
    const img = await carregarImagem(url);
    let w = img.naturalWidth || img.width || 1000, h = img.naturalHeight || img.height || 1000;
    const k = ladoMax / Math.max(w, h);
    w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k));
    const cv = document.createElement('canvas');
    cv.width = w + 8; cv.height = h + 8;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 4, 4, w, h);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    const an = G.analisarPixels(d.data, cv.width, cv.height);
    let m;
    if (an.temAlfa) m = G.mascaraDePixels(d.data, cv.width, cv.height, { usarAlfa: true, limiar: 128, inverter: !!opc.inverter });
    else if (an.fundoLiso && an.corFundo) m = G.mascaraPorFundo(d.data, cv.width, cv.height, an.corFundo, opc.limiar != null ? opc.limiar : 60, false);
    else m = G.mascaraDePixels(d.data, cv.width, cv.height, { limiar: opc.limiar != null ? opc.limiar : G.limiarOtsu(d.data, cv.width, cv.height), inverter: !!opc.inverter });
    if (G.limparSujeira) m = G.limparSujeira(m, 0.004);
    return m;
  } finally { URL.revokeObjectURL(url); }
}

export async function formaDeImagem(file, opc = {}) {
  const ehSVG = /svg/i.test(file.type) || /\.svg$/i.test(file.name || '');
  const m = await mascaraDeArquivo(file, ehSVG ? 1800 : 1200, opc);
  return mascaraParaForma(m, opc.largura || 40, larguraConteudo(m));
}

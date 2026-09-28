// ANÁLISE DA LOGO: descobre sozinho o fundo (transparência, cor lisa na borda
// ou claro/escuro), quantas cores a logo tem de verdade (1 a 4, agrupando no
// Lab — a cor como o olho vê) e de quem é cada pixel. A borda suavizada
// (antialias) e o ruído do JPG não viram cor nova: só pixel LISO vota nas
// cores; pixel de borda fica com a cor vizinha mais parecida.
import { labDaImagem, lab, dE, hex, redimensionar, nomeDaCor } from './imagem.js';
import * as M from './mascara.js';

export const LADO_TRABALHO = 1000;   // maior lado da análise em px (imagem pequena é ampliada: contorno liso)
export const MAX_CORES = 4;

// cor dominante da moldura da imagem (2 px de borda) e quão lisa ela é
function corDaBorda(L, A, B, W, H) {
  const idx = [];
  for (let x = 0; x < W; x++) for (const y of [0, 1, H - 2, H - 1]) idx.push(y * W + x);
  for (let y = 2; y < H - 2; y++) for (const x of [0, 1, W - 2, W - 1]) idx.push(y * W + x);
  const caixas = new Map();
  for (const i of idx) {
    const k = Math.round(L[i] / 4) + ',' + Math.round(A[i] / 4) + ',' + Math.round(B[i] / 4);
    const c = caixas.get(k) || { n: 0, l: 0, a: 0, b: 0 };
    c.n++; c.l += L[i]; c.a += A[i]; c.b += B[i]; caixas.set(k, c);
  }
  let top = null;
  for (const c of caixas.values()) if (!top || c.n > top.n) top = c;
  let m = [top.l / top.n, top.a / top.n, top.b / top.n];
  // média de quem está perto da moda, e o ruído (quanto varia)
  for (let it = 0; it < 2; it++) {
    let s = [0, 0, 0], n = 0;
    for (const i of idx) if (dE([L[i], A[i], B[i]], m) < 12) { s[0] += L[i]; s[1] += A[i]; s[2] += B[i]; n++; }
    if (n) m = [s[0] / n, s[1] / n, s[2] / n];
  }
  let perto = 0, soma2 = 0;
  for (const i of idx) { const d = dE([L[i], A[i], B[i]], m); if (d < 12) { perto++; soma2 += d * d; } }
  return { lab: m, fracao: perto / idx.length, ruido: perto ? Math.sqrt(soma2 / perto) : 0 };
}

function otsu(L, n) {
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(L[i] * 2.55)))]++;
  let total = n, soma = 0; for (let i = 0; i < 256; i++) soma += i * hist[i];
  let sB = 0, wB = 0, melhor = 0, lim = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (soma - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > melhor) { melhor = v; lim = t; }
  }
  return lim / 2.55;
}

// Rgb aproximado de um Lab (só pra mostrar/exportar a cor achada)
function rgbDeLab([Lv, a, b]) {
  const fy = (Lv + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = t => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, bb = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const s = c => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };
  return [s(r), s(g), s(bb)].map(v => Math.round(v));
}

/**
 * analisar({px, w, h}) -> análise pronta pro construir:
 *  W, H (px de trabalho), fatorImg (trabalho/original), modo ('alfa'|'fundo'|'tom'),
 *  fundo {hex, rgb, nome} | null, rotulo (Int8Array, -1 = fora da logo),
 *  cores [{id, rgb, hex, nome, area, fracao, pai, nivel}], coresBrutas,
 *  silhueta (Uint8Array), caixa, ruido, sugestao {corBase, cracha}
 */
export function analisar({ px, w, h }, opc = {}) {
  const t0 = Date.now();
  const lado = opc.lado || LADO_TRABALHO;
  const maior = Math.max(w, h);
  let W = w, H = h;
  if (maior > lado * 1.05 || maior < lado * 0.7) {
    const k = lado / maior; W = Math.max(8, Math.round(w * k)); H = Math.max(8, Math.round(h * k));
    px = redimensionar(px, w, h, W, H);
  }
  const n = W * H;

  // 1. transparência?
  let transp = 0, bordaT = 0, nBorda = 0;
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] < 250) transp++;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { nBorda++; if (px[(y * W + x) * 4 + 3] < 128) bordaT++; }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { nBorda++; if (px[(y * W + x) * 4 + 3] < 128) bordaT++; }
  const { L, A, B } = labDaImagem(px, n);
  const fg = new Uint8Array(n);
  let modo, fundo = null, ruido = 0;
  if (transp > n * 0.005 && bordaT > nBorda * 0.3) {
    modo = 'alfa';
    for (let i = 0; i < n; i++) fg[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const bd = corDaBorda(L, A, B, W, H);
    ruido = bd.ruido;
    if (bd.fracao >= 0.6) {
      modo = 'fundo';
      const rgb = rgbDeLab(bd.lab);
      fundo = { lab: bd.lab, rgb, hex: hex(rgb), nome: nomeDaCor(rgb) };
      // tolerância pelo ruído medido na própria borda (JPG ruidoso = mais folga)
      const tol = Math.max(10, Math.min(28, ruido * 4 + 6));
      // distância de cor até o fundo, borrada de leve: o chuvisco do JPG na
      // borda não vira serrilhado no contorno
      const [l0, a0, b0] = bd.lab;
      const dist = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = L[i] - l0, b = A[i] - a0, c = B[i] - b0; dist[i] = Math.sqrt(a * a + b * b + c * c); }
      if (ruido > 1.5) borrarCaixa(dist, W, H, 1, 2);
      for (let i = 0; i < n; i++) fg[i] = dist[i] > tol ? 1 : 0;
    } else {
      modo = 'tom';
      const lim = otsu(L, n);
      let escBorda = 0;
      for (let x = 0; x < W; x++) { if (L[x] < lim) escBorda++; if (L[(H - 1) * W + x] < lim) escBorda++; }
      const fundoEscuro = escBorda > W;
      for (let i = 0; i < n; i++) fg[i] = (L[i] < lim) !== fundoEscuro ? 1 : 0;
    }
  }

  // 2. sujeira do JPG: pedacinho de poucos pixels some, furinho de poucos pixels tapa
  const minRuido = Math.max(3, Math.round(n / 250000));
  let limpo = M.taparFuros(fg, W, H, minRuido);
  {
    const { rot, pedacos } = M.rotular(limpo, W, H);
    const tirar = new Uint8Array(pedacos.length + 1);
    for (const p of pedacos) if (p.area <= minRuido) tirar[p.id] = 1;
    for (let i = 0; i < n; i++) if (rot[i] && tirar[rot[i]]) limpo[i] = 0;
  }
  const sil = limpo;
  const areaSil = M.conta(sil);
  if (areaSil < 30) return { erro: 'Não achei nenhum desenho na imagem.', W, H, modo };

  // 3. pixels LISOS (longe da borda da logo e sem variação de cor): só eles votam
  const d2fora = M.distancia2(sil, W, H, 0);
  const grad = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!sil[i]) continue;
    let g = 0;
    const d = j => { const a = L[i] - L[j], b = A[i] - A[j], c = B[i] - B[j]; const v = a * a + b * b + c * c; if (v > g) g = v; };
    if (x + 1 < W) d(i + 1);
    if (x > 0) d(i - 1);
    if (y + 1 < H) d(i + W);
    if (y > 0) d(i - W);
    g = Math.sqrt(g);
    grad[i] = g;
  }
  const gLiso = Math.max(5, ruido * 2.5);
  const liso = new Uint8Array(n);
  let nLiso = 0;
  for (let i = 0; i < n; i++) if (sil[i] && d2fora[i] >= 4 && grad[i] < gLiso) { liso[i] = 1; nLiso++; }
  if (nLiso < areaSil * 0.05) {   // traço todo fino: aceita pixel de borda também
    for (let i = 0; i < n; i++) if (sil[i] && grad[i] < gLiso * 2) { if (!liso[i]) nLiso++; liso[i] = 1; }
  }

  // 4. agrupamento perceptual: histograma no Lab -> junta o que o olho não separa
  const caixas = new Map();
  for (let i = 0; i < n; i++) {
    if (!liso[i]) continue;
    const k = Math.round(L[i] / 3) * 1e6 + (Math.round(A[i] / 4) + 500) * 1e3 + (Math.round(B[i] / 4) + 500);
    const c = caixas.get(k);
    if (c) { c.n++; c.l += L[i]; c.a += A[i]; c.b += B[i]; } else caixas.set(k, { n: 1, l: L[i], a: A[i], b: B[i] });
  }
  let grupos = [];
  for (const c of [...caixas.values()].sort((a, b) => b.n - a.n)) {
    const m = [c.l / c.n, c.a / c.n, c.b / c.n];
    let alvo = null, dm = 10;
    for (const g of grupos) { const d = dE(m, g.m); if (d < dm) { dm = d; alvo = g; } }
    if (alvo) { alvo.l += c.l; alvo.a += c.a; alvo.b += c.b; alvo.n += c.n; alvo.m = [alvo.l / alvo.n, alvo.a / alvo.n, alvo.b / alvo.n]; }
    else grupos.push({ n: c.n, l: c.l, a: c.a, b: c.b, m });
  }
  const juntarMaisPerto = limiar => {
    let par = null, dm = limiar;
    for (let i = 0; i < grupos.length; i++) for (let j = i + 1; j < grupos.length; j++) {
      const d = dE(grupos[i].m, grupos[j].m);
      if (d < dm) { dm = d; par = [i, j]; }
    }
    if (!par) return false;
    const [a, b] = par.map(k => grupos[k]);
    a.l += b.l; a.a += b.a; a.b += b.b; a.n += b.n; a.m = [a.l / a.n, a.a / a.n, a.b / a.n];
    grupos.splice(par[1], 1);
    return true;
  };
  while (juntarMaisPerto(16));
  // cor com pouquíssimo pixel liso é ruído ou degradê: sai da contagem
  grupos = grupos.filter(g => g.n >= Math.max(8, nLiso * 0.004));
  if (!grupos.length) grupos = [{ n: nLiso, m: [0, 0, 0] }];
  const coresBrutas = grupos.length;
  while (grupos.length > MAX_CORES) juntarMaisPerto(Infinity);
  // refina (k-médias no Lab, só pixel liso)
  let centros = grupos.map(g => g.m.slice());
  const perto = (l, a, b, cs) => { let q = 0, dm = Infinity; for (let k = 0; k < cs.length; k++) { const d = (l - cs[k][0]) ** 2 + (a - cs[k][1]) ** 2 + (b - cs[k][2]) ** 2; if (d < dm) { dm = d; q = k; } } return q; };
  for (let it = 0; it < 4; it++) {
    const s = centros.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) if (liso[i]) { const q = perto(L[i], A[i], B[i], centros); s[q][0] += L[i]; s[q][1] += A[i]; s[q][2] += B[i]; s[q][3]++; }
    centros = centros.map((c, k) => s[k][3] ? [s[k][0] / s[k][3], s[k][1] / s[k][3], s[k][2] / s[k][3]] : c);
  }

  // 5. dono de cada pixel: liso -> cor mais perto; borda -> entre as cores
  //    lisas da vizinhança (7x7), a mais parecida (o antialias fica com o lado certo)
  const K = centros.length;
  const rotulo = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (liso[i]) rotulo[i] = perto(L[i], A[i], B[i], centros);
  const R = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!sil[i] || liso[i]) continue;
    let mask = 0;
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
      const j = yy * W + xx; if (liso[j]) mask |= 1 << rotulo[j];
    }
    let q = -1, dm = Infinity;
    for (let k = 0; k < K; k++) {
      if (mask && !(mask & (1 << k))) continue;
      const d = (L[i] - centros[k][0]) ** 2 + (A[i] - centros[k][1]) ** 2 + (B[i] - centros[k][2]) ** 2;
      if (d < dm) { dm = d; q = k; }
    }
    rotulo[i] = q;
  }

  // 6. pontinho de uma cor dentro de outra (sobra de antialias/JPG) vira a vizinha
  const minMancha = Math.max(6, Math.round(n / 60000));
  {
    const { rot, pedacos } = M.rotularValores(rotulo, W, H);
    for (const p of pedacos) {
      if (p.area > minMancha) continue;
      const viz = new Map(); let fora = 0;
      for (let y = Math.max(0, p.y0 - 1); y <= Math.min(H - 1, p.y1 + 1); y++) for (let x = Math.max(0, p.x0 - 1); x <= Math.min(W - 1, p.x1 + 1); x++) {
        const i = y * W + x; if (rot[i] === p.id) continue;
        const r = rotulo[i];
        if (r < 0) fora++; else if (r !== p.valor) viz.set(r, (viz.get(r) || 0) + 1);
      }
      if (!viz.size) continue;                 // pontinho solto no fundo: é detalhe (pingo do i)
      let melhor = -1, nm = -1; viz.forEach((c, r) => { if (c > nm) { nm = c; melhor = r; } });
      if (fora > nm * 2) continue;
      for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) { const i = y * W + x; if (rot[i] === p.id) rotulo[i] = melhor; }
    }
  }

  // 6b. borda entre cores sem serrilhado: pixel que discorda de quase todos os
  //     vizinhos vai com a maioria (2 passadas)
  for (let p = 0; p < 2; p++) maioria(rotulo, W, H);

  // 7. cores finais (só as que sobraram), ordem por área
  const area = new Array(K).fill(0);
  for (let i = 0; i < n; i++) if (rotulo[i] >= 0) area[rotulo[i]]++;
  const vivos = [...Array(K).keys()].filter(k => area[k] > 0).sort((a, b) => area[b] - area[a]);
  const novo = new Int8Array(K).fill(-1); vivos.forEach((k, j) => { novo[k] = j; });
  for (let i = 0; i < n; i++) if (rotulo[i] >= 0) rotulo[i] = novo[rotulo[i]];
  const cores = vivos.map((k, j) => {
    const rgb = rgbDeLab(centros[k]);
    return { id: j, lab: centros[k], rgb, hex: hex(rgb), nome: nomeDaCor(rgb), area: area[k], fracao: area[k] / areaSil };
  });

  // 8. hierarquia: quem está dentro de quem (anel de 3 px em volta de cada cor)
  hierarquia(rotulo, cores, W, H);
  const sugestao = sugerirBase(modo, fundo, cores, rotulo, sil, W, H);

  return {
    W, H, fatorImg: W / w, modo, fundo, rotulo, cores, coresBrutas, silhueta: sil,
    caixa: M.caixa(sil, W, H), ruido, sugestao, ms: Date.now() - t0
  };
}

function borrarCaixa(c, w, h, raio, passadas) {
  const t = new Float32Array(c.length), jan = 2 * raio + 1;
  for (let p = 0; p < passadas; p++) {
    for (let y = 0; y < h; y++) { const o = y * w; let s = 0; for (let x = -raio; x <= raio; x++) s += c[o + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { t[o + x] = s / jan; s += c[o + Math.min(w - 1, x + raio + 1)] - c[o + Math.max(0, x - raio)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -raio; y <= raio; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { c[y * w + x] = s / jan; s += t[Math.min(h - 1, y + raio + 1) * w + x] - t[Math.max(0, y - raio) * w + x]; } }
  }
}

// filtro de maioria só ENTRE cores (o recorte da logo não muda): pixel com
// 6+ dos 8 vizinhos de outra cor vira essa cor
function maioria(rotulo, W, H) {
  const novo = Int8Array.from(rotulo);
  const cont = new Int32Array(16);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, r = rotulo[i];
    if (r < 0) continue;
    cont.fill(0);
    let melhor = -1, nm = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const v = rotulo[i + dy * W + dx];
      if (v < 0 || v === r) continue;
      if (++cont[v] > nm) { nm = cont[v]; melhor = v; }
    }
    if (nm >= 6) novo[i] = melhor;
  }
  rotulo.set(novo);
}

function hierarquia(rotulo, cores, W, H) {
  // quem cerca cada cor: olha 3 px pra fora em 8 direções a partir de cada pixel
  const K = cores.length, cont = cores.map(() => new Float64Array(K + 1));
  const D = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [2, -2], [-2, 2], [-2, -2]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = rotulo[y * W + x]; if (k < 0) continue;
    for (const [dx, dy] of D) {
      const xx = x + dx, yy = y + dy;
      const r = (xx < 0 || yy < 0 || xx >= W || yy >= H) ? -1 : rotulo[yy * W + xx];
      if (r !== k) cont[k][r + 1]++;
    }
  }
  for (const c of cores) {
    const v = cont[c.id], fora = v[0];
    let tot = fora, pai = null, np = 0;
    for (let r = 0; r < K; r++) { tot += v[r + 1]; if (r !== c.id && v[r + 1] > np) { np = v[r + 1]; pai = r; } }
    c.pai = (tot && fora / tot < 0.35 && pai != null) ? pai : null;
  }
  // ciclo (A dentro de B e B dentro de A): o maior vira raiz
  for (const c of cores) {
    const vistos = new Set(); let x = c;
    while (x && x.pai != null && !vistos.has(x.id)) { vistos.add(x.id); x = cores[x.pai]; }
    if (x && vistos.has(x.id)) {
      let maior = x, y = cores[x.pai];
      while (y && y !== x) { if (y.area > maior.area) maior = y; y = cores[y.pai]; }
      maior.pai = null;
    }
  }
  const nivel = c => c.pai == null ? 1 : 1 + nivel(cores[c.pai]);
  for (const c of cores) c.nivel = nivel(c);
}

// Cor da base: fundo liso da imagem -> a própria cor do fundo (a peça fica
// igual à imagem); logo "crachá" (uma cor por fora com o resto dentro) -> essa
// cor vira a base; senão, branco ou preto, o que contrastar com a arte.
function sugerirBase(modo, fundo, cores, rotulo, sil, W, H) {
  if (modo === 'fundo' && fundo) return { corBase: fundo.hex, motivo: 'fundo', cracha: null };
  const raizes = cores.filter(c => c.pai == null);
  if (cores.length >= 2 && raizes.length === 1) {
    const r = raizes[0], n = W * H;
    const mk = new Uint8Array(n);
    for (let i = 0; i < n; i++) mk[i] = rotulo[i] === r.id ? 1 : 0;
    const cheio = M.conta(M.taparFuros(mk, W, H)), silCheia = M.conta(M.taparFuros(sil, W, H));
    if (cheio >= silCheia * 0.6) return { corBase: r.hex, motivo: 'cracha', cracha: r.id };
  }
  let lm = 0, at = 0;
  for (const c of cores) { lm += c.lab[0] * c.area; at += c.area; }
  lm /= at || 1;
  return lm > 62 ? { corBase: '#1A1A1A', motivo: 'contraste', cracha: null } : { corBase: '#FFFFFF', motivo: 'contraste', cracha: null };
}

export { lab, dE };

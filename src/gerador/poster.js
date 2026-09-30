// FOTO EM PÔSTER: a foto vira 2 a 4 cores chapadas, com borda limpa, dentro
// de uma forma (retângulo, redondo, coração ou o contorno do recorte). O
// filtro de Kuwahara alisa a pele/o fundo sem borrar as bordas; o k-médias
// no Lab escolhe as cores; mancha menor do que dá pra imprimir some na
// vizinha. Sai uma análise igual à da logo: o construir faz o resto.
import { labDaImagem, redimensionar, hex, nomeDaCor } from './imagem.js';
import * as M from './mascara.js';
import { hierarquia, sugerirBase, maioria, rgbDeLab } from './analise.js';
import { mascaraForma } from './formas.js';

export const LADO_POSTER = 600;
const PL = 2.2;   // peso da claridade no agrupamento

// Kuwahara: em cada pixel, das 4 janelas (r+1)x(r+1) que encostam nele, fica a
// média da mais lisa (menor variação de claridade). Somas acumuladas: O(1)/px.
function kuwahara(L, A, B, W, H, r) {
  const W1 = W + 1, S = n => new Float64Array(W1 * (H + 1));
  const sL = S(), sL2 = S(), sA = S(), sB = S();
  for (let y = 0; y < H; y++) {
    let aL = 0, aL2 = 0, aA = 0, aB = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, o = (y + 1) * W1 + x + 1, c = y * W1 + x + 1;
      aL += L[i]; aL2 += L[i] * L[i]; aA += A[i]; aB += B[i];
      sL[o] = sL[c] + aL; sL2[o] = sL2[c] + aL2; sA[o] = sA[c] + aA; sB[o] = sB[c] + aB;
    }
  }
  const soma = (s, x0, y0, x1, y1) => s[(y1 + 1) * W1 + x1 + 1] - s[y0 * W1 + x1 + 1] - s[(y1 + 1) * W1 + x0] + s[y0 * W1 + x0];
  const nL = new Float32Array(W * H), nA = new Float32Array(W * H), nB = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let melhor = Infinity, mL = 0, mA = 0, mB = 0;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x0 = Math.max(0, Math.min(x, x + dx * r)), x1 = Math.min(W - 1, Math.max(x, x + dx * r));
      const y0 = Math.max(0, Math.min(y, y + dy * r)), y1 = Math.min(H - 1, Math.max(y, y + dy * r));
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const m = soma(sL, x0, y0, x1, y1) / n, v = soma(sL2, x0, y0, x1, y1) / n - m * m;
      if (v < melhor) { melhor = v; mL = m; mA = soma(sA, x0, y0, x1, y1) / n; mB = soma(sB, x0, y0, x1, y1) / n; }
    }
    const i = y * W + x; nL[i] = mL; nA[i] = mA; nB[i] = mB;
  }
  L.set(nL); A.set(nA); B.set(nB);
}

// k-médias (k-means++) no Lab, com sorteio fixo (mesma foto = mesmo pôster)
function kmedias(L, A, B, dentro, K) {
  let semente = 12345;
  const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
  const idx = [];
  for (let i = 0; i < dentro.length; i++) if (dentro[i]) idx.push(i);
  const passo = Math.max(1, Math.floor(idx.length / 30000));
  const am = idx.filter((_, j) => j % passo === 0);
  // claridade pesa mais que o tom: rosto e volume se leem por claro/escuro
  const d2 = (i, c) => PL * (L[i] - c[0]) ** 2 + (A[i] - c[1]) ** 2 + (B[i] - c[2]) ** 2;
  const cs = [];
  const p0 = am[Math.floor(rnd() * am.length)]; cs.push([L[p0], A[p0], B[p0]]);
  const dist = new Float64Array(am.length).fill(Infinity);
  while (cs.length < K) {
    let tot = 0;
    for (let j = 0; j < am.length; j++) { dist[j] = Math.min(dist[j], d2(am[j], cs[cs.length - 1])); tot += dist[j]; }
    if (!tot) break;
    let alvo = rnd() * tot, j = 0;
    while (j < am.length - 1 && (alvo -= dist[j]) > 0) j++;
    cs.push([L[am[j]], A[am[j]], B[am[j]]]);
  }
  for (let it = 0; it < 12; it++) {
    const s = cs.map(() => [0, 0, 0, 0]);
    for (const i of am) { let q = 0, dm = Infinity; for (let k = 0; k < cs.length; k++) { const d = d2(i, cs[k]); if (d < dm) { dm = d; q = k; } } s[q][0] += L[i]; s[q][1] += A[i]; s[q][2] += B[i]; s[q][3]++; }
    for (let k = 0; k < cs.length; k++) if (s[k][3]) cs[k] = [s[k][0] / s[k][3], s[k][1] / s[k][3], s[k][2] / s[k][3]];
  }
  return cs;
}

// mancha menor que aMin vira a cor vizinha com mais contato (repete até parar)
function tirarManchas(rot, W, H, aMin) {
  for (let volta = 0; volta < 6; volta++) {
    const { rot: pid, pedacos } = M.rotularValores(rot, W, H);
    let mudou = 0;
    for (const p of pedacos) {
      if (p.area >= aMin || p.valor < 0) continue;
      const viz = new Map();
      for (let y = Math.max(0, p.y0 - 1); y <= Math.min(H - 1, p.y1 + 1); y++) for (let x = Math.max(0, p.x0 - 1); x <= Math.min(W - 1, p.x1 + 1); x++) {
        const i = y * W + x; if (pid[i] === p.id) continue;
        const v = rot[i]; if (v < 0 || v === p.valor) continue;
        // só quem encosta (4-vizinho de um pixel do pedaço)
        if ((x > 0 && pid[i - 1] === p.id) || (x < W - 1 && pid[i + 1] === p.id) || (y > 0 && pid[i - W] === p.id) || (y < H - 1 && pid[i + W] === p.id)) viz.set(v, (viz.get(v) || 0) + 1);
      }
      if (!viz.size) continue;
      let melhor = -1, nm = -1; viz.forEach((c, v) => { if (c > nm) { nm = c; melhor = v; } });
      for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) { const i = y * W + x; if (pid[i] === p.id) rot[i] = melhor; }
      mudou++;
    }
    if (!mudou) break;
  }
}

/**
 * posterizar(an, {cores, forma}) -> análise nova (modo 'poster') pro construir.
 * forma: retangulo | redondo | coracao | contorno (usa o recorte da análise).
 */
export function posterizar(an, opc = {}) {
  const t0 = Date.now();
  const K = Math.max(2, Math.min(4, opc.cores || 4));
  let forma = opc.forma || 'retangulo';
  if (forma === 'contorno' && !(an.modo === 'alfa' || an.modo === 'fundo')) forma = 'retangulo';
  // imagem menor (600 px): sobra detalhe pra 50 mm (0,1 mm por px) e é rápido
  const k = Math.min(1, (opc.lado || LADO_POSTER) / Math.max(an.W, an.H));
  const W = Math.max(8, Math.round(an.W * k)), H = Math.max(8, Math.round(an.H * k)), n = W * H;
  const px0 = new Uint8ClampedArray(an.W * an.H * 4);
  for (let i = 0; i < an.W * an.H; i++) { px0[i * 4] = an.rgb[i * 3]; px0[i * 4 + 1] = an.rgb[i * 3 + 1]; px0[i * 4 + 2] = an.rgb[i * 3 + 2]; px0[i * 4 + 3] = 255; }
  const px = (W === an.W && H === an.H) ? px0 : redimensionar(px0, an.W, an.H, W, H);
  const { L, A, B } = labDaImagem(px, n);
  const r = Math.max(2, Math.round(Math.max(W, H) / 150));
  kuwahara(L, A, B, W, H, r);
  kuwahara(L, A, B, W, H, Math.max(1, r >> 1));
  // forma
  let dentro;
  if (forma === 'contorno') {
    const s = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s[y * W + x] = an.silhueta[Math.min(an.H - 1, Math.floor((y + 0.5) / k)) * an.W + Math.min(an.W - 1, Math.floor((x + 0.5) / k))];
    dentro = M.taparFuros(s, W, H, Math.round(n * 0.002));
  } else dentro = mascaraForma(forma, W, H);
  if (M.conta(dentro) < 100) return { erro: 'A forma ficou vazia.' };
  // cores
  const centros = kmedias(L, A, B, dentro, K);
  const rotulo = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!dentro[i]) continue;
    let q = 0, dm = Infinity;
    for (let c = 0; c < centros.length; c++) { const d = PL * (L[i] - centros[c][0]) ** 2 + (A[i] - centros[c][1]) ** 2 + (B[i] - centros[c][2]) ** 2; if (d < dm) { dm = d; q = c; } }
    rotulo[i] = q;
  }
  for (let p = 0; p < 2; p++) maioria(rotulo, W, H);
  const areaForma = M.conta(dentro);
  tirarManchas(rotulo, W, H, Math.max(12, Math.round(areaForma * (opc.manchaMin || 0.0015))));
  for (let p = 0; p < 2; p++) maioria(rotulo, W, H);
  // cores finais (por área) e a análise
  const area = new Array(centros.length).fill(0);
  for (let i = 0; i < n; i++) if (rotulo[i] >= 0) area[rotulo[i]]++;
  const vivos = [...centros.keys()].filter(c => area[c] > 0).sort((a, b) => area[b] - area[a]);
  const novo = new Int8Array(centros.length).fill(-1); vivos.forEach((c, j) => { novo[c] = j; });
  for (let i = 0; i < n; i++) if (rotulo[i] >= 0) rotulo[i] = novo[rotulo[i]];
  const cores = vivos.map((c, j) => { const rgb = rgbDeLab(centros[c]); return { id: j, lab: centros[c], rgb, hex: hex(rgb), nome: nomeDaCor(rgb), area: area[c], fracao: area[c] / areaForma }; });
  hierarquia(rotulo, cores, W, H);
  const sil = new Uint8Array(n); for (let i = 0; i < n; i++) sil[i] = rotulo[i] >= 0 ? 1 : 0;
  const sugestao = sugerirBase('poster', null, cores, rotulo, sil, W, H);
  // a imagem menor vai junto (litofania/pôster de novo a partir desta análise)
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
  return {
    W, H, fatorImg: an.fatorImg * (W / an.W), modo: 'poster', fundo: null, rotulo, cores, coresBrutas: an.coresBrutas, silhueta: sil,
    caixa: M.caixa(sil, W, H), ruido: 0, sugestao, foto: an.foto, rgb, alfa: an.alfa && forma === 'contorno' ? sil : null,
    poster: { cores: K, forma }, ms: Date.now() - t0
  };
}

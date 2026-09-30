// LITOFANIA: a foto vira uma placa branca de espessura variável — contra a
// luz, onde é fino passa luz (claro) e onde é grosso fica escuro. A espessura
// vem da claridade pela lei de Beer-Lambert (a luz cai exponencialmente com a
// espessura): assim os meios-tons aparecem como na foto, e não "estourados".
// Forma (retângulo, redondo, coração ou o recorte da foto), moldura e argola
// saem num sólido só, fechado, pronto pro Bambu.
import { manifold } from '../estudio3d/core/solidos.js';
import { perfilDe, PLA_G_CM3 } from './perfis.js';
import { criar } from '../estudio3d/core/malha.js';
import { corrigirDegeneradas } from '../estudio3d/core/limpeza.js';
import { contornoForma, mascaraPoligonos } from './formas.js';
import { poligonosMM } from './vetor.js';
import * as M from './mascara.js';
import { labDaImagem } from './imagem.js';

export const PADRAO_LITO = { forma: 'retangulo', espMin: 0.8, espMax: 3.0, moldura: 2.5, contraste: 1, inverter: false };
const ALFA = 1.25;          // atenuação do PLA branco (1/mm): 0,8 mm deixa ~16x mais luz que 3 mm
const segs = r => Math.max(24, Math.min(160, Math.ceil(2 * Math.PI * Math.abs(r) / 0.3)));

// claridade 0..1 (L* do Lab) de cada pixel da análise
function claridade(an) {
  const n = an.W * an.H, px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { px[i * 4] = an.rgb[i * 3]; px[i * 4 + 1] = an.rgb[i * 3 + 1]; px[i * 4 + 2] = an.rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
  const { L } = labDaImagem(px, n);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = L[i] / 100;
  return c;
}

/**
 * construirLitofania(an, cfg) -> o mesmo formato do construir() do chaveiro
 * (partes, medidas, argola, vista, transformada, qualidade...) + litofania
 * {simulacao:{w,h,px}, espMin, espMax, camadaSugerida}
 */
export function construirLitofania(an, cfg) {
  if (!an || !an.rgb) return { erro: 'Essa imagem não tem os pixels guardados pra litofania. Abra a foto de novo.' };
  const { CrossSection, Manifold, Mesh } = manifold();
  const vivos = [];
  const G = x => { if (x && typeof x.delete === 'function') vivos.push(x); return x; };
  const t0 = Date.now();
  try { return montar(an, cfg, CrossSection, Manifold, Mesh, G, t0); }
  finally { for (const x of vivos) { try { x.delete(); } catch (e) { /* já liberado */ } } }
}

function montar(an, cfg, CrossSection, Manifold, Mesh, G, t0) {
  const L = { ...PADRAO_LITO, ...(cfg.litofania || {}) };
  const perfil = perfilDe(cfg.impressora, cfg.bicoMM);
  const avisos = [], dicas = [];
  const espMin = Math.max(2 * perfil.camada, Math.min(L.espMin, 3)), espMax = Math.max(espMin + 0.6, Math.min(L.espMax, 8));
  const moldura = Math.max(0, Math.min(8, L.moldura));
  const { W, H } = an;
  // ---------- forma e escala (px da análise -> mm: x*esc, -y*esc)
  let forma = L.forma;
  if (forma === 'contorno' && !an.alfa) forma = 'retangulo';
  let box;                    // caixa da forma em px
  if (forma === 'contorno') { const c = M.caixa(an.alfa, W, H); box = { x0: c.x0, y0: c.y0, w: c.w, h: c.h }; }
  else if (forma === 'retangulo') box = { x0: 0, y0: 0, w: W, h: H };
  else { const s = Math.min(W, H); box = { x0: (W - s) / 2, y0: (H - s) / 2, w: s, h: s }; }
  const ladoMM = Math.max(10, cfg.tamanhoMM - 2 * moldura);
  const esc = ladoMM / Math.max(box.w, box.h);
  let formaCS;
  if (forma === 'contorno') {
    const pols = poligonosMM(M.taparFuros(an.alfa, W, H, Math.round(W * H * 0.002)), W, H, esc, { tolMM: 0.05, areaMinMM2: 4 });
    formaCS = G(new CrossSection(pols, 'EvenOdd'));
    // um pedaço só (o maior) — ilha solta não tem onde se prender
    const pedacos = formaCS.decompose();
    let maior = null; for (const p of pedacos) { G(p); if (!maior || p.area() > maior.area()) maior = p; }
    formaCS = maior;
  } else {
    const pts = contornoForma(forma, box.w * esc, box.h * esc).map(([x, y]) => [box.x0 * esc + x, -(box.y0 * esc + y)]);
    formaCS = G(new CrossSection([pts], 'NonZero'));
  }
  if (!formaCS || formaCS.isEmpty()) return { erro: 'A forma da litofania ficou vazia.' };
  const bf = formaCS.bounds();
  // ---------- grade da espessura (passo = meio bico: o detalhe que imprime)
  const X0 = bf.min[0], Y0 = bf.min[1], wMM = bf.max[0] - X0, hMM = bf.max[1] - Y0;
  const passo = Math.max(perfil.bico / 2, Math.max(wMM, hMM) / 450);
  const nx = Math.max(2, Math.ceil(wMM / passo) + 1), ny = Math.max(2, Math.ceil(hMM / passo) + 1);
  const px = passo / esc;     // px da imagem por célula
  const cl = claridade(an);
  // média da claridade na célula (caixa de px x px em volta do ponto)
  const amostra = (X, Y) => {
    const cxp = X / esc, cyp = -Y / esc, r = Math.max(0.5, px / 2);
    const xa = Math.max(0, Math.floor(cxp - r)), xb = Math.min(W - 1, Math.ceil(cxp + r)), ya = Math.max(0, Math.floor(cyp - r)), yb = Math.min(H - 1, Math.ceil(cyp + r));
    let s = 0, k = 0;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { s += cl[y * W + x]; k++; }
    return k ? s / k : 1;
  };
  const luz = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) luz[j * nx + i] = amostra(X0 + i * passo, Y0 + hMM - j * passo);
  // níveis automáticos (1% a 99% dentro da forma) + contraste
  const dentro = [];
  const pts2 = formaCS.toPolygons();
  const dentroDe = (X, Y) => { let c = false; for (const p of pts2) for (let a = 0, b = p.length - 1; a < p.length; b = a++) { const [xa, ya] = p[a], [xb, yb] = p[b]; if ((ya > Y) !== (yb > Y) && X < xa + (Y - ya) / (yb - ya) * (xb - xa)) c = !c; } return c; };
  const passoAmostra = Math.max(1, Math.floor(Math.sqrt(nx * ny / 20000)));
  for (let j = 0; j < ny; j += passoAmostra) for (let i = 0; i < nx; i += passoAmostra) if (dentroDe(X0 + i * passo, Y0 + hMM - j * passo)) dentro.push(luz[j * nx + i]);
  dentro.sort((a, b) => a - b);
  const lo = dentro.length ? dentro[Math.floor(dentro.length * 0.01)] : 0, hi = dentro.length ? dentro[Math.floor(dentro.length * 0.99)] : 1;
  const gama = 1 / Math.max(0.4, Math.min(2.5, L.contraste || 1));
  const Tmax = Math.exp(-ALFA * espMin), Tmin = Math.exp(-ALFA * espMax);
  const esp = new Float32Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) {
    let l = hi > lo ? (luz[k] - lo) / (hi - lo) : luz[k];
    l = Math.max(0, Math.min(1, l));
    if (L.inverter) l = 1 - l;
    l = Math.pow(l, gama);
    const T = Tmin + l * (Tmax - Tmin);          // quanta luz deve passar
    esp[k] = Math.max(espMin, Math.min(espMax, -Math.log(T) / ALFA));
  }
  // ---------- malha fechada da placa (topo = relevo; fundo liso na mesa)
  const nTop = nx * ny;
  const borda = [];
  for (let i = 0; i < nx; i++) borda.push(i);                         // linha de cima (j=0), esquerda->direita
  for (let j = 1; j < ny; j++) borda.push(j * nx + nx - 1);           // direita, de cima pra baixo
  for (let i = nx - 2; i >= 0; i--) borda.push((ny - 1) * nx + i);    // de baixo, direita->esquerda
  for (let j = ny - 2; j >= 1; j--) borda.push(j * nx);               // esquerda, de baixo pra cima
  const nb = borda.length;
  const pos = new Float32Array((nTop + nb + 1) * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = j * nx + i; pos[v * 3] = X0 + i * passo; pos[v * 3 + 1] = Y0 + hMM - j * passo; pos[v * 3 + 2] = esp[v]; }
  for (let b = 0; b < nb; b++) { const v = borda[b], o = (nTop + b) * 3; pos[o] = pos[v * 3]; pos[o + 1] = pos[v * 3 + 1]; pos[o + 2] = 0; }
  const centro = nTop + nb;                     // centro do fundo (leque sem triângulo achatado)
  pos[centro * 3] = X0 + wMM / 2; pos[centro * 3 + 1] = Y0 + hMM / 2; pos[centro * 3 + 2] = 0;
  const tri = [];
  for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;   // y cai com j: (a,c,b) é anti-horário visto de cima
    tri.push(a, c, b, b, c, d);
  }
  for (let b = 0; b < nb; b++) {                // paredes
    const t1 = borda[b], t2 = borda[(b + 1) % nb], b1 = nTop + b, b2 = nTop + (b + 1) % nb;
    tri.push(t1, t2, b1, t2, b2, b1);
  }
  // fundo: leque a partir do centro (a borda anda no sentido horário visto de cima -> normal pra baixo)
  for (let b = 0; b < nb; b++) tri.push(centro, nTop + b, nTop + (b + 1) % nb);
  // sentido: volume tem que dar positivo
  let vol = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]].map(v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  if (vol < 0) for (let t = 0; t < tri.length; t += 3) { const x = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = x; }
  const mesh = new Mesh({ numProp: 3, vertProperties: pos, triVerts: Uint32Array.from(tri) });
  mesh.merge();
  let placa = G(new Manifold(mesh));
  if (placa.status() !== 'NoError') return { erro: 'Falha montando a placa da litofania (' + placa.status() + ').' };
  // recorta na forma — com moldura, a placa entra 0,3 mm por baixo dela (sem
  // parede coincidente entre as duas, que vira lasca na união)
  const entra = moldura > 0 ? Math.min(0.3, moldura / 2) : 0;
  const recorte = entra ? G(formaCS.offset(entra, 'Round', 2, 64)) : formaCS;
  const prisma = G(G(recorte.extrude(espMax + 2)).translate([0, 0, -1]));
  placa = G(placa.intersect(prisma));
  // moldura: anel em volta, um pouco mais alto que a parte mais grossa
  const altMoldura = +(espMax + Math.max(0.4, 2 * perfil.camada)).toFixed(2);
  let contornoTudo = formaCS;
  let solido = placa;
  if (moldura > 0) {
    const fora = G(formaCS.offset(moldura, 'Round', 2, segs(moldura)));
    const anel = G(fora.subtract(formaCS));
    solido = G(solido.add(G(anel.extrude(altMoldura))));
    contornoTudo = fora;
  }
  // ---------- argola (encostada na moldura, com aba de reforço)
  let argola = null;
  if (cfg.argola && cfg.argola.ligada !== false) {
    const furoMM = Math.max(1.5, Math.min(12, cfg.argola.furoMM || 4)), alcaMM = furoMM / 2 + Math.max(1, Math.min(8, cfg.argola.paredeMM || 2.2));
    const b = contornoTudo.bounds(), cxm = (b.min[0] + b.max[0]) / 2, cym = (b.min[1] + b.max[1]) / 2;
    const dirs = { topo: [0, 1], esquerda: [-1, 0], direita: [1, 0], canto: [-Math.SQRT1_2, Math.SQRT1_2], baixo: [0, -1] };
    let C;
    const pol = contornoTudo.toPolygons();
    if (cfg.argola.posicao === 'livre' && cfg.argola.ponto) {
      // ponto escolhido na prévia (u, v na caixa da imagem da análise, como no chaveiro)
      const cx = an.caixa;
      C = [(cx.x0 + cfg.argola.ponto.u * cx.w) * esc, -(cx.y0 + cfg.argola.ponto.v * cx.h) * esc];
    } else {
      const d = dirs[cfg.argola.posicao] || dirs.topo;
      // ponto da borda mais longe do centro nessa direção
      let melhor = -Infinity, P = [cxm, b.max[1]];
      for (const p of pol) for (const v of p) { const s = (v[0] - cxm) * d[0] + (v[1] - cym) * d[1] - 0.02 * Math.abs((v[0] - cxm) * d[1] - (v[1] - cym) * d[0]); if (s > melhor) { melhor = s; P = v; } }
      C = [P[0] + d[0] * (alcaMM * 0.55), P[1] + d[1] * (alcaMM * 0.55)];
    }
    const alca = G(G(CrossSection.circle(alcaMM, segs(alcaMM))).translate(C));
    // aba até a moldura (reforço) e o furo
    const perto = G(G(CrossSection.circle(alcaMM * 1.8, segs(alcaMM * 1.8))).translate(C));
    const aba = G(CrossSection.hull([alca, G(contornoTudo.intersect(perto))]));
    const furo = G(G(CrossSection.circle(furoMM / 2, segs(furoMM / 2))).translate(C));
    // a aba entra 0,3 mm por cima da borda da foto (mais alta que ela: sem parede coincidente)
    const miolo = G(formaCS.offset(-0.3, 'Round', 2, 64));
    const anelArgola = G(G(alca.add(aba)).subtract(G(furo.add(miolo))));
    solido = G(solido.add(G(anelArgola.extrude(altMoldura))));
    solido = G(solido.subtract(G(G(furo.extrude(altMoldura + 2)).translate([0, 0, -1]))));
    argola = { C, furoMM, alcaMM };
  }
  // junta o que ficou a menos de 1 µm (fundo em leque + parede da moldura na
  // mesma borda): sem isso o arredondamento pra float32 cruza triângulo
  if (typeof solido.simplify === 'function') solido = G(solido.simplify(0.001));
  if (solido.status() !== 'NoError') return { erro: 'Falha na geometria da litofania (' + solido.status() + ').' };
  // ---------- posição final: canto em (0,0)
  const bb = solido.boundingBox();
  const tx = -bb.min[0], ty = -bb.min[1];
  const fin = G(solido.translate([tx, ty, 0]));
  const mm = fin.getMesh(), np = mm.numProp;
  const P3 = new Float32Array(mm.vertProperties.length / np * 3);
  for (let v = 0; v < P3.length / 3; v++) { P3[v * 3] = mm.vertProperties[v * np]; P3[v * 3 + 1] = mm.vertProperties[v * np + 1]; P3[v * 3 + 2] = mm.vertProperties[v * np + 2]; }
  const limpa = corrigirDegeneradas(criar(P3, Uint32Array.from(mm.triVerts))).malha;
  const volume = fin.volume(), gramas = volume / 1000 * PLA_G_CM3;
  const largura = bb.max[0] - bb.min[0], altura = bb.max[1] - bb.min[1], espessura = bb.max[2];
  const partes = [{ nome: 'Litofania', cor: '#FFFFFF', malha: { pos: Float32Array.from(limpa.pos), idx: Uint32Array.from(limpa.idx) }, volumeMM3: volume, gramas, genero: fin.genus() }];
  // ---------- simulação contra a luz (o que a pessoa vai ver), na grade
  const sim = new Uint8Array(nx * ny);
  const Tb = Math.exp(-ALFA * espMin);
  // fora da forma é moldura (grossa: quase não passa luz)
  const naGrade = formaCS.toPolygons().map(p => p.map(([X, Y]) => [(X - X0) / passo + 0.5, (Y0 + hMM - Y) / passo + 0.5]));
  const dentroSim = mascaraPoligonos(naGrade, nx, ny);
  const escuro = Math.round(255 * Math.exp(-ALFA * altMoldura) / Tb);
  for (let k = 0; k < nx * ny; k++) sim[k] = dentroSim[k] ? Math.round(255 * Math.min(1, Math.exp(-ALFA * esp[k]) / Tb)) : escuro;
  // ---------- relatório
  const camadaSug = perfil.bico <= 0.2 ? 0.06 : 0.1;
  const tons = Math.round((espMax - espMin) / camadaSug);
  const q = [
    { nivel: 'ok', titulo: 'Litofania ' + (L.inverter ? '(negativo)' : ''), texto: 'espessura de ' + String(espMin.toFixed(1)).replace('.', ',') + ' a ' + String(espMax.toFixed(1)).replace('.', ',') + ' mm — claro fica fino, escuro fica grosso' },
    { nivel: 'ok', titulo: 'Detalhe', texto: 'grade de ' + String(passo.toFixed(2)).replace('.', ',') + ' mm (' + nx + ' × ' + ny + ' pontos)' },
    tons >= 18 ? { nivel: 'ok', titulo: 'Tons', texto: tons + ' níveis de cinza com camada de ' + String(camadaSug).replace('.', ',') + ' mm' } : { nivel: 'dica', titulo: 'Poucos tons', texto: 'aumente a espessura máxima ou use camada mais fina' }
  ];
  if (!an.foto || !an.foto.provavel) q.push({ nivel: 'dica', titulo: 'Imagem com poucos tons', texto: 'litofania fica melhor com FOTO (rosto, pet, paisagem)' });
  dicas.push({ tipo: 'dica', texto: 'Imprima com filamento BRANCO, camada de ' + String(camadaSug).replace('.', ',') + ' mm e 100% de preenchimento (no Bambu: Preenchimento → Densidade 100%). Deitada, com o lado liso na mesa.' });
  dicas.push({ tipo: 'dica', texto: 'Veja contra a luz (janela, lanterna do celular): a foto aparece. Sem luz atrás, é só um relevo branco.' });
  if (largura > perfil.mesa[0] - 10 || altura > perfil.mesa[1] - 10) avisos.push({ tipo: 'alerta', texto: 'A peça não cabe na mesa da ' + perfil.nome + '.' });
  const camadas = Math.round(espessura / camadaSug);
  const estimativa = { camadas, trocas: 0, minutos: Math.round(volume / 5 / 60 + camadas * 0.15 + 2), purgaG: 0, gramas: +gramas.toFixed(1) };
  const vista = [{ nome: 'Litofania', cor: '#FFFFFF', poligonos: G(contornoTudo.translate([tx, ty])).toPolygons(), zTopo: altMoldura }];
  return {
    partes, medidas: { largura, altura, espessura, volumeMM3: volume, gramas },
    alturas: { base: espMin, arte: espMax - espMin, degrau: 0 }, corBase: '#FFFFFF', cracha: null, niveis: {},
    argola: argola ? { xMM: argola.C[0] + tx, yMM: argola.C[1] + ty, furoMM: argola.furoMM, alcaMM: argola.alcaMM, px: [argola.C[0] / esc, -argola.C[1] / esc], u: (argola.C[0] / esc - an.caixa.x0) / an.caixa.w, v: (-argola.C[1] / esc - an.caixa.y0) / an.caixa.h, noVao: false } : null,
    nfc: null, verso: null, trocas: null, pecaUnica: null, pausas: [],
    vista, logoMM: G(formaCS.translate([tx, ty])).toPolygons(),
    transformada: { esc, tx, ty },
    qualidade: { nivel: q.some(i => i.nivel === 'dica') ? 'boa' : 'excelente', titulo: q.some(i => i.nivel === 'dica') ? 'Qualidade boa' : 'Qualidade excelente', itens: q },
    avisos, dicas, estimativa,
    perfil: { id: perfil.id, nome: perfil.nome, bico: perfil.bico, camada: perfil.camada, ams: perfil.ams },
    // caixaMM: onde a simulação (grade) fica na peça, já na posição final
    litofania: { simulacao: { w: nx, h: ny, px: sim }, caixaMM: [X0 + tx - passo / 2, Y0 + hMM - (ny - 1) * passo + ty - passo / 2, X0 + (nx - 1) * passo + tx + passo / 2, Y0 + hMM + ty + passo / 2], espMin, espMax, camadaSugerida: camadaSug, forma, passo },
    ms: Date.now() - t0
  };
}

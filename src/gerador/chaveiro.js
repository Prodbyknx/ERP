// CONSTRUÇÃO DO CHAVEIRO: análise da logo -> peça 3D pronta pro Bambu.
// Máscara (pixel) só pra decidir; geometria em VETOR no Manifold (offset,
// união, extrusão exatos): base lisa em volta da logo, argola que nunca corta
// a arte, cores disjuntas (uma peça por cor, sem sobrepor) e alturas que
// fazem sentido pra impressão com AMS ou trocando filamento na mão.
import { manifold } from '../estudio3d/core/solidos.js';
import * as M from './mascara.js';
import { poligonosMM } from './vetor.js';
import { nomeDaCor, rgbDeHex, lab, dE } from './imagem.js';
import { perfilDe, PLA_G_CM3 } from './perfis.js';
import { criar } from '../estudio3d/core/malha.js';
import { corrigirDegeneradas } from '../estudio3d/core/limpeza.js';
import { gerarQR } from './qr.js';

export const PADRAO = {
  modelo: 'chaveiro',          // chaveiro | medalha | placa | contorno
  tamanhoMM: 50,               // maior lado da peça (sem a argola)
  altBase: 2.4, altArte: 1.2, degrauMM: 0.6,
  bordaMM: 2.5, cantoMM: 3,
  corBase: 'auto',             // 'auto' ou #RRGGBB
  cores: {},                   // {id: {hex, desligada, juntarCom}}
  estrategia: 'ams',           // ams | troca (sem AMS: cor por altura)
  alturas: 'degraus',          // degraus (o que está dentro fica mais alto) | iguais
  engrossar: true,             // traço mais fino que o bico engrossa até imprimir
  impressora: 'A1', bicoMM: 0.4,
  argola: { ligada: true, posicao: 'topo', centro: true, ponto: null, furoMM: 4, paredeMM: 2.2 },
  nfc: { ligado: false, diametroMM: 25, profundidadeMM: 0.9, modo: 'baixo', paredeMM: 1.6 },
  // verso: texto (telefone, @instagram, nome) na face de baixo, espelhado pra
  // ler certo ao virar. alfa: máscara do texto (w*h, 0..255) desenhada pela tela
  verso: { alfa: null, w: 0, h: 0, modo: 'cor', cor: '#FFFFFF', profundidadeMM: 0.6, nome: 'Verso' }
};

const segs = r => Math.max(24, Math.min(160, Math.ceil(2 * Math.PI * Math.abs(r) / 0.3)));

function mesclar(a, b) {
  const o = { ...a, ...(b || {}) };
  o.argola = { ...a.argola, ...((b && b.argola) || {}) };
  o.nfc = { ...a.nfc, ...((b && b.nfc) || {}) };
  o.verso = { ...a.verso, ...((b && b.verso) || {}) };
  o.cores = { ...((b && b.cores) || {}) };
  return o;
}

// Traço mais fino que o bico: acha a CRISTA do campo de distância (o meio de
// cada traço) onde a meia largura é menor que o mínimo e passa um disco do
// raio mínimo por ela: o traço fica com a largura do bico, centrado no lugar.
// Devolve quantos traços (pedaços compridos de crista) engrossou e a meia
// largura típica deles (px).
function engrossar(mk, W, H, rMin) {
  const d2 = M.distancia2(mk, W, H, 0), r2 = rMin * rMin;
  const semente = new Uint8Array(W * H);
  let ns = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, d = d2[i];
    if (!mk[i] || d >= r2) continue;
    if (d >= d2[i - 1] && d >= d2[i + 1] && d >= d2[i - W] && d >= d2[i + W]) { semente[i] = 1; ns++; }
  }
  if (ns < 2) return { mask: mk, n: 0, meia: null };
  const { rot, pedacos } = M.rotular(M.dilatar(semente, W, H, 1.5), W, H);
  // canto vivo também tem crista fina (vai afinando até a ponta), mas curta e
  // grudada no corpo grosso: esse não engrossa (senão o canto incha pra fora).
  // Engrossa: crista comprida (traço de verdade) ou peça toda fina (pingo, fio).
  const nSem = new Int32Array(pedacos.length + 1), toca = new Uint8Array(pedacos.length + 1);
  for (let i = 0; i < W * H; i++) { const p = rot[i]; if (!p) continue; if (semente[i]) nSem[p]++; else if (mk[i] && d2[i] >= r2) toca[p] = 1; }
  const vale = new Uint8Array(pedacos.length + 1);
  for (const p of pedacos) vale[p.id] = !toca[p.id] || nSem[p.id] >= 2.5 * rMin ? 1 : 0;
  const usar = new Uint8Array(W * H);
  let nu = 0;
  for (let i = 0; i < W * H; i++) if (semente[i] && vale[rot[i]]) { usar[i] = 1; nu++; }
  if (!nu) return { mask: mk, n: 0, meia: null };
  const longos = pedacos.filter(p => vale[p.id] && p.area >= Math.max(8, rMin * 6));
  const meias = [];
  const ehLongo = new Uint8Array(pedacos.length + 1); for (const p of longos) ehLongo[p.id] = 1;
  for (let i = 0; i < W * H; i++) if (usar[i] && ehLongo[rot[i]]) meias.push(Math.sqrt(d2[i]));
  meias.sort((a, b) => a - b);
  return { mask: M.uniao(mk, M.dilatar(usar, W, H, rMin)), n: longos.length, meia: meias.length ? meias[meias.length >> 1] : null };
}

export function construir(an, cfgUsuario) {
  if (!an || an.erro) return { erro: (an && an.erro) || 'Sem imagem.' };
  const cfg = mesclar(PADRAO, cfgUsuario);
  const { CrossSection, Manifold } = manifold();
  const vivos = [];
  const G = x => { if (x && typeof x.delete === 'function') vivos.push(x); return x; };
  const t0 = Date.now();
  try {
    return montar(an, cfg, CrossSection, Manifold, G, t0);
  } finally {
    for (const x of vivos) { try { x.delete(); } catch (e) { /* já liberado */ } }
  }
}

function montar(an, cfg, CrossSection, Manifold, G, t0) {
  const { W, H } = an, n = W * H, K = an.cores.length;
  const perfil = perfilDe(cfg.impressora, cfg.bicoMM);
  const avisos = [], dicas = [];
  const q = v => Math.max(perfil.camada, Math.round(v / perfil.camada) * perfil.camada);
  const altBase = q(cfg.altBase), altArte = q(cfg.altArte), degrau = q(Math.max(cfg.degrauMM, 2 * perfil.camada));
  const temBase = cfg.modelo !== 'contorno';

  // ---------- cores efetivas (juntar / desligar / crachá)
  const para = [...Array(K).keys()];
  for (const [id, o] of Object.entries(cfg.cores)) if (o && o.juntarCom != null && +o.juntarCom !== +id && an.cores[+o.juntarCom]) para[+id] = +o.juntarCom;
  const raiz = k => { const s = new Set(); while (para[k] !== k && !s.has(k)) { s.add(k); k = para[k]; } return k; };
  const corDe = k => ((cfg.cores[k] && cfg.cores[k].hex) || an.cores[k].hex).toUpperCase();
  let cracha = an.sugestao.cracha != null ? raiz(an.sugestao.cracha) : null;
  let corBase = (!cfg.corBase || cfg.corBase === 'auto') ? an.sugestao.corBase : cfg.corBase;
  if (cracha != null) {
    if (cfg.corBase && cfg.corBase !== 'auto' && cfg.corBase.toUpperCase() !== corDe(cracha)) cracha = null;
    else corBase = corDe(cracha);
  }
  corBase = corBase.toUpperCase();
  const erguida = k => raiz(k) === k && k !== cracha && !(cfg.cores[k] && cfg.cores[k].desligada);
  const ks = [...Array(K).keys()].filter(erguida);
  // pai entre as erguidas (sobe a cadeia até achar uma erguida)
  const paiDe = k => { let p = an.cores[k].pai, g = 0; while (p != null && g++ < 10) { const r = raiz(p); if (erguida(r) && r !== k) return r; p = an.cores[r].pai; } return null; };
  const nivel = {}; const nv = k => nivel[k] || (nivel[k] = paiDe(k) == null ? 1 : 1 + nv(paiDe(k)));
  ks.forEach(nv);

  // ---------- SVG: contorno EXATO de cada cor (formas do arquivo, em px, y pra cima)
  const vet = an.vetor ? regioesVetor(an.vetor, K, CrossSection, G) : null;
  const silVet = vet ? (vet.filter(Boolean).length ? G(CrossSection.union(vet.filter(Boolean))) : null) : null;
  if (vet && (!silVet || silVet.isEmpty())) return { erro: 'O desenho do SVG ficou vazio.' };

  // ---------- escala
  const cx = an.caixa;
  const borda = temBase ? Math.max(0, cfg.bordaMM) : 0;
  let esc;
  if (cfg.modelo === 'medalha') {
    const mx = (cx.x0 + cx.x1 + 1) / 2, my = (cx.y0 + cx.y1 + 1) / 2;
    let r2 = 0;
    if (silVet) { for (const p of silVet.toPolygons()) for (const v of p) { const d = (v[0] - mx) ** 2 + (-v[1] - my) ** 2; if (d > r2) r2 = d; } }
    else for (let y = cx.y0; y <= cx.y1; y++) for (let x = cx.x0; x <= cx.x1; x++) if (an.silhueta[y * W + x]) { const d = (x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2; if (d > r2) r2 = d; }
    esc = (cfg.tamanhoMM / 2 - borda) / Math.sqrt(r2);
  } else if (silVet) {
    const b = silVet.bounds();
    esc = (cfg.tamanhoMM - 2 * borda) / Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
  } else esc = (cfg.tamanhoMM - 2 * borda) / Math.max(cx.w, cx.h);
  if (!(esc > 0)) return { erro: 'A borda é maior que a peça: diminua a borda ou aumente o tamanho.' };
  const pxMM = 1 / esc;
  const vetMM = vet ? vet.map(c => c ? G(c.scale([esc, esc])) : null) : null;

  // ---------- máscaras de cada cor erguida (+ engrossar traço fino)
  const rot = an.rotulo, masks = {}, extra = {};
  for (const k of ks) masks[k] = new Uint8Array(n);
  let silExtra = null;
  for (let i = 0; i < n; i++) { const r = rot[i]; if (r >= 0) { const k = raiz(r); if (masks[k]) masks[k][i] = 1; } }
  const rMin = perfil.traco / 2 * pxMM;
  let engrossados = 0, meiaFina = null;
  if (cfg.engrossar && temBase && rMin >= 0.75) {
    for (const k of ks) {
      const r = engrossar(masks[k], W, H, rMin);
      if (r.mask !== masks[k]) { if (vet) extra[k] = M.menos(r.mask, masks[k]); masks[k] = r.mask; silExtra = silExtra ? M.uniao(silExtra, r.mask) : r.mask; }
      engrossados += r.n;
      if (r.meia != null) meiaFina = meiaFina == null ? r.meia : Math.min(meiaFina, r.meia);
    }
  }
  const sil = silExtra ? M.uniao(an.silhueta, silExtra) : an.silhueta;

  const suave = an.modo === 'fundo' && an.ruido > 1.5 ? 2 : 1;
  const cs = m => { const p = poligonosMM(m, W, H, esc, { tolMM: 0.02, suave }); return p.length ? G(new CrossSection(p, 'EvenOdd')) : null; };
  // SVG: a cor é a forma exata do arquivo; o que o engrossar acrescentou (em px)
  // entra por cima, com 1 px de folga pra dentro (sem fresta entre os dois)
  const extraCS = {};
  if (vet) for (const k of Object.keys(extra)) { const c = cs(extra[k]); if (c) extraCS[k] = G(c.offset(esc, 'Miter', 2)); }
  const regiaoVet = k => {
    const l = [];
    for (let j = 0; j < K; j++) if (vetMM[j] && raiz(j) === +k) l.push(vetMM[j]);
    if (extraCS[k]) l.push(extraCS[k]);
    return l.length ? (l.length === 1 ? l[0] : G(CrossSection.union(l))) : null;
  };
  const csSil = vet ? (Object.keys(extraCS).length ? G(CrossSection.union([G(silVet.scale([esc, esc])), ...Object.values(extraCS)])) : G(silVet.scale([esc, esc]))) : cs(sil);
  if (!csSil) return { erro: 'O desenho ficou vazio.' };
  const nPecas = c => { const d = c.decompose(); const k = d.length; d.forEach(x => x.delete()); return k; };
  const taparFuros = (c, aMin) => {
    const pols = c.toPolygons(), total = c.area();
    const manter = pols.filter(p => { const a = areaPol(p); return a > 0 || (-a >= aMin && -a >= total * 0.04); });
    return G(new CrossSection(manter, 'Positive'));
  };

  // ---------- base
  let base, pontes = 0;
  if (!temBase) base = csSil;
  else if (cfg.modelo === 'medalha') {
    const b = csSil.bounds(), c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    let r = 0; for (const p of csSil.toPolygons()) for (const v of p) r = Math.max(r, Math.hypot(v[0] - c[0], v[1] - c[1]));
    base = G(G(CrossSection.circle(r + borda, segs(r + borda))).translate(c));
  } else if (cfg.modelo === 'placa') {
    const b = csSil.bounds(), rc = Math.max(0.2, Math.min(cfg.cantoMM, borda + 10));
    const w = b.max[0] - b.min[0] + 2 * borda, h = b.max[1] - b.min[1] + 2 * borda;
    const miolo = G(CrossSection.square([Math.max(0.1, w - 2 * rc), Math.max(0.1, h - 2 * rc)], true));
    base = G(G(miolo.offset(rc, 'Round', 2, segs(rc))).translate([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]));
  } else {
    base = taparFuros(G(csSil.offset(borda, 'Round', 2, segs(borda))), 40);
    // logo em fundo liso (JPG): a parte da cor do fundo que atravessa a logo
    // (faixa branca do escudo) é da logo — fecha o contorno por cima dela
    const fechar = cfg.fecharMM != null ? cfg.fecharMM : an.modo === 'fundo' ? 4 : 0;
    if (fechar > 0) base = taparFuros(G(G(base.offset(fechar, 'Round', 2, segs(fechar))).offset(-fechar, 'Round', 2, segs(fechar))), 40);
    if (nPecas(base) > 1) {
      // partes soltas: fecha o contorno aos poucos até virar UMA peça (senão
      // o pedaço que não está na argola cai)
      for (const r of [0.8, 1.5, 2.5, 4, 6, 9, 13]) {
        const c = G(G(base.offset(r, 'Round', 2, segs(r))).offset(-r, 'Round', 2, segs(r)));
        if (nPecas(c) === 1) { base = taparFuros(c, 40); pontes = r; break; }
      }
      if (nPecas(base) > 1) base = G(unirComBarras(base, CrossSection, G, Math.max(1.5, borda)));
    }
  }

  // ---------- argola: nunca encosta na arte; aba de reforço até a peça
  let argola = null;
  if (temBase && cfg.argola.ligada) {
    const a = colocarArgola(sil, W, H, pxMM, cfg.argola, cx, avisos);
    if (a) {
      const C = [a.x * esc, -a.y * esc];
      const alca = G(G(CrossSection.circle(a.alcaMM, segs(a.alcaMM))).translate(C));
      const Q = [a.qx * esc, -a.qy * esc];
      const rn = a.alcaMM * 0.78;
      const aba = G(CrossSection.hull([alca, G(G(CrossSection.circle(rn, segs(rn))).translate(Q))]));
      let u = G(CrossSection.union([base, alca, aba]));
      // filete só perto da argola (junta liso com a peça)
      const perto = G(G(CrossSection.circle(a.alcaMM * 2.2, segs(a.alcaMM * 2.2))).translate(C));
      const suave = G(G(G(u.offset(1.2, 'Round', 2, 48)).offset(-1.2, 'Round', 2, 48)).intersect(perto));
      u = G(u.add(suave));
      const furo = G(G(CrossSection.circle(a.furoMM / 2, segs(a.furoMM / 2))).translate(C));
      base = G(u.subtract(furo));
      argola = { ...a, xMM: C[0], yMM: C[1], furoCS: furo };
    }
  }

  // ---------- camadas das cores (disjuntas: filho primeiro, ganha a disputa)
  const ordem = ks.slice().sort((a, b) => nivel[b] - nivel[a] || an.cores[a].area - an.cores[b].area);
  const reg = {};
  let ocupado = null;
  for (const k of ordem) {
    let c = vet ? regiaoVet(k) : cs(masks[k]);
    if (!c || c.isEmpty()) continue;
    if (temBase) c = G(c.intersect(base));
    if (ocupado) c = G(c.subtract(ocupado));
    // abertura de 0,02 mm: tira a lasca de largura ~0 que sobra entre duas
    // cores vizinhas (contornos calculados separados) — invisível na peça,
    // mas vira triângulo degenerado e parede encostada na malha
    c = G(G(c.offset(-0.02, 'Miter', 2)).offset(0.02, 'Miter', 2));
    if (c.isEmpty() || c.area() < 0.01) continue;
    reg[k] = c;
    ocupado = ocupado ? G(ocupado.add(c)) : c;
  }
  const vivas = ks.filter(k => reg[k]);
  const sumidas = ks.filter(k => !reg[k]);
  if (sumidas.length) avisos.push({ tipo: 'alerta', texto: 'A cor ' + sumidas.map(k => an.cores[k].nome).join(', ') + ' ficou pequena demais pra imprimir nesse tamanho.' });

  // ---------- sólidos por cor
  const partes = [];     // {nome, hex, man, z0, z1}
  const addSolido = (nome, hex, c, z0, z1) => {
    if (!c || c.isEmpty() || z1 - z0 < 1e-6) return;
    const s = G(G(c.extrude(z1 - z0)).translate([0, 0, z0]));
    let p = partes.find(x => x.hex === hex && x.nome === nome);
    if (p) p.man = G(p.man.add(s)); else partes.push({ nome, hex, man: s });
  };
  let baseSolido = null, nfc = null, nfcCorte = null, versoParte = null, versoInfo = null;
  const zTopo = {};
  const trocas = [];     // sem AMS: onde trocar o filamento
  if (!temBase) {
    const k0 = ks[0] != null ? ks[0] : 0;
    addSolido(an.cores[k0] ? an.cores[k0].nome : 'Peça', an.cores[k0] ? corDe(k0) : corBase, base, 0, altBase);
  } else {
    baseSolido = G(G(base.extrude(altBase)));
    if (cfg.nfc.ligado) {
      const r = bolsoNFC(base, cfg.nfc, altBase, perfil, CrossSection, G, avisos);
      if (r) { baseSolido = G(baseSolido.subtract(r.corte)); nfc = r.info; nfcCorte = r.corte; }
    }
    const v = cfg.verso;
    if (v && ((v.alfa && v.w && v.h) || v.qr)) {
      const r = textoDoVerso(base, v, argola, altBase, perfil, { ...cfg, _corBase: corBase }, CrossSection, G, avisos, dicas);
      if (r) {
        baseSolido = G(baseSolido.subtract(r.prisma));
        if (nfc && nfcCorte) r.prisma = G(r.prisma.subtract(nfcCorte));
        if (r.modo === 'cor') versoParte = { nome: v.nome || 'Verso', hex: (v.cor || '#FFFFFF').toUpperCase(), man: r.prisma };
        versoInfo = r.info;
      }
    }
    partes.push({ nome: 'Base', hex: corBase, man: baseSolido });
    if (versoParte) partes.push(versoParte);
    const filhos = k => vivas.filter(j => paiDe(j) === k);
    // pegada = a cor + tudo que fica em cima dela; fechamento de 0,02 mm solda
    // o encosto de um ponto só entre as duas (senão a malha fica "beliscada")
    const pegada = k => { let c = reg[k]; const fs = filhos(k); if (!fs.length) return c; for (const f of fs) c = G(c.add(pegada(f))); return G(G(c.offset(0.02, 'Miter', 2)).offset(-0.02, 'Miter', 2)); };
    if (cfg.estrategia === 'troca') {
      // cor por altura: cada cor ganha a sua faixa; o que está mais alto passa por
      // todas as faixas de baixo (é o que sai trocando o filamento na mão)
      const rank = vivas.slice().sort((a, b) => nivel[a] - nivel[b] || an.cores[b].area - an.cores[a].area);
      let z = altBase, debaixo = base;
      rank.forEach((k, r) => {
        const z1 = z + (r === 0 ? altArte : degrau);
        let col = null;
        for (const j of rank.slice(r)) col = col ? G(col.add(reg[j])) : reg[j];
        if (rank.length - r > 1) col = G(G(col.offset(0.02, 'Miter', 2)).offset(-0.02, 'Miter', 2));
        // cada faixa cabe dentro da de baixo (nada sobra pra fora no ar)
        if (r > 0) col = G(col.intersect(debaixo));
        debaixo = col;
        addSolido(an.cores[k].nome, corDe(k), col, z, z1);
        trocas.push({ z: +z.toFixed(2), camada: Math.round(z / perfil.camada) + 1, hex: corDe(k), nome: an.cores[k].nome });
        zTopo[k] = z1; z = z1;
      });
    } else if (cfg.alturas === 'degraus') {
      for (const k of vivas) {
        const L = nivel[k], z0 = L === 1 ? altBase : altBase + altArte + (L - 2) * degrau, z1 = L === 1 ? altBase + altArte : z0 + degrau;
        addSolido(an.cores[k].nome, corDe(k), pegada(k), z0, z1);
        zTopo[k] = z1;
      }
    } else {
      for (const k of vivas) { addSolido(an.cores[k].nome, corDe(k), reg[k], altBase, altBase + altArte); zTopo[k] = altBase + altArte; }
    }
  }

  // ---------- posição final: canto da peça em (0,0), deitada na mesa
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = 0;
  for (const p of partes) { const b = p.man.boundingBox(); bx0 = Math.min(bx0, b.min[0]); by0 = Math.min(by0, b.min[1]); bx1 = Math.max(bx1, b.max[0]); by1 = Math.max(by1, b.max[1]); bz1 = Math.max(bz1, b.max[2]); }
  const tx = -bx0, ty = -by0;
  const saida = [];
  let volTotal = 0;
  const malhaDe = m => {
    const mesh = m.getMesh(), np = mesh.numProp;
    const pos = new Float32Array(mesh.vertProperties.length / np * 3);
    for (let v = 0, nv2 = pos.length / 3; v < nv2; v++) { pos[v * 3] = mesh.vertProperties[v * np]; pos[v * 3 + 1] = mesh.vertProperties[v * np + 1]; pos[v * 3 + 2] = mesh.vertProperties[v * np + 2]; }
    // triângulo de área ~0 (vértices colineares no float32) sai
    const limpa = corrigirDegeneradas(criar(pos, Uint32Array.from(mesh.triVerts))).malha;
    return { pos: Float32Array.from(limpa.pos), idx: Uint32Array.from(limpa.idx) };
  };
  const movidas = [];
  for (const p of partes) {
    const m = G(p.man.translate([tx, ty, 0]));
    const st = m.status();
    if (st !== 'NoError') return { erro: 'Falha na geometria (' + p.nome + ': ' + st + ').' };
    const vol = m.volume();
    volTotal += vol;
    movidas.push(m);
    saida.push({ nome: p.nome, cor: p.hex, malha: malhaDe(m), volumeMM3: vol, gramas: vol / 1000 * PLA_G_CM3, genero: m.genus() });
  }
  // sem AMS: a peça vai pro Bambu como UM sólido de um filamento só (a cor
  // muda pela pausa na altura certa; as faixas coloridas são só a prévia)
  let pecaUnica = null;
  if (cfg.estrategia === 'troca' && movidas.length > 1) {
    let u = movidas[0];
    for (let i = 1; i < movidas.length; i++) u = G(u.add(movidas[i]));
    // encosto de faixas quase na mesma borda: junta vértice a menos de 1 µm (senão
    // o arredondamento pra float32 cruza triângulo no degrau)
    if (typeof u.simplify === 'function') u = G(u.simplify(0.001));
    if (u.status() === 'NoError') pecaUnica = { nome: 'Chaveiro', cor: corBase, malha: malhaDe(u), volumeMM3: u.volume(), gramas: u.volume() / 1000 * PLA_G_CM3, genero: u.genus() };
  }
  // nomes iguais (duas cores com o mesmo nome) ganham número
  const vistos = {};
  for (const p of saida) { vistos[p.nome] = (vistos[p.nome] || 0) + 1; if (vistos[p.nome] > 1) p.nome += ' ' + vistos[p.nome]; }

  // vista de cima (o que aparece de cada cor), já na posição final
  const T = c => c ? G(c.translate([tx, ty])) : null;
  const vista = [];
  const baseVisivel = temBase ? (ocupado ? G(base.subtract(ocupado)) : base) : null;
  if (baseVisivel) vista.push({ nome: 'Base', cor: corBase, poligonos: T(baseVisivel).toPolygons() });
  for (const k of vivas) vista.push({ nome: an.cores[k].nome, cor: corDe(k), id: k, poligonos: T(reg[k]).toPolygons(), zTopo: zTopo[k] });
  // contorno da LOGO (sem a borda): a silhueta, ou a silhueta fechada se precisou de ponte
 const fechouMM = cfg.modelo === 'chaveiro' ? (cfg.fecharMM != null ? cfg.fecharMM : an.modo === 'fundo' ? 4 : 0) : 0;
  const rf = borda + Math.max(pontes, fechouMM);
  const logo = (pontes || fechouMM) ? G(G(G(csSil.offset(rf, 'Round', 2, 64)).offset(-rf, 'Round', 2, 64)).add(csSil)) : csSil;
  const logoMM = T(logo).toPolygons();

  const largura = bx1 - bx0, altura = by1 - by0;
  const rel = relatorio({ an, cfg, perfil, largura, altura, espessura: bz1, saida, vivas, nivel, corDe, engrossados, meiaFina, pxMM, esc, argola, pontes, trocas, altBase, altArte, degrau, avisos, dicas, temBase, cracha, corBase });

  return {
    partes: saida,
    medidas: { largura, altura, espessura: bz1, volumeMM3: volTotal, gramas: volTotal / 1000 * PLA_G_CM3 },
    alturas: { base: altBase, arte: altArte, degrau },
    corBase, cracha, niveis: nivel,
    argola: argola ? { xMM: argola.xMM + tx, yMM: argola.yMM + ty, furoMM: argola.furoMM, alcaMM: argola.alcaMM, px: [argola.x, argola.y], u: (argola.x - cx.x0) / cx.w, v: (argola.y - cx.y0) / cx.h, noVao: !!argola.noVao } : null,
    nfc, verso: versoInfo, trocas: cfg.estrategia === 'troca' ? trocas : null, pecaUnica,
    // pausas pra pôr no arquivo fatiado: troca de filamento (sem AMS) e tag NFC
    pausas: [
      // z: onde a cor nova começa; zBarra: a altura que o Bambu mostra na barra de camadas
      ...(cfg.estrategia === 'troca' ? trocas.map(t => ({ z: t.z, zBarra: +(t.z + perfil.camada).toFixed(2), camada: t.camada, tipo: 'cor', hex: t.hex, nome: t.nome, texto: 'Troque o filamento: ' + t.nome + ' ' + t.hex })) : []),
      ...(nfc && nfc.zPausa != null ? [{ z: nfc.zPausa, zBarra: +(nfc.zPausa + perfil.camada).toFixed(2), camada: nfc.camadaPausa, tipo: 'nfc', texto: 'Coloque a tag NFC no bolso' }] : [])
    ].sort((a, b) => a.z - b.z),
    vista, logoMM,
    transformada: { esc, tx, ty },   // mm = (x_px*esc + tx, -y_px*esc + ty)
    qualidade: rel.qualidade, avisos: rel.avisos, dicas: rel.dicas, estimativa: rel.estimativa,
    perfil: { id: perfil.id, nome: perfil.nome, bico: perfil.bico, camada: perfil.camada, ams: perfil.ams },
    ms: Date.now() - t0
  };
}

// Formas do SVG na ordem da pintura: a de cima ganha. Cada cor = o que dela
// sobra visível; forma da cor do fundo (rótulo -1) apaga o que estava embaixo.
// Formas seguidas da mesma cor viram uma união só (menos operações).
function regioesVetor(v, K, CrossSection, G) {
  const regra = r => r === 'evenodd' ? 'EvenOdd' : 'NonZero';
  const yCima = aneis => aneis.map(a => a.map(p => [p[0], -p[1]]));
  const recortes = new Map();
  const deRecorte = partes => {
    let c = recortes.get(partes);
    if (!c) {
      const l = partes.map(pp => G(new CrossSection(yCima(pp.aneis), regra(pp.regra))));
      c = l.length === 1 ? l[0] : l.length ? G(CrossSection.union(l)) : null;
      recortes.set(partes, c);
    }
    return c;
  };
  const csDe = f => {
    let c = G(new CrossSection(yCima(f.aneis), regra(f.regra)));
    for (const partes of f.clip || []) { const r = deRecorte(partes); c = r ? G(c.intersect(r)) : G(c.subtract(c)); }
    return c;
  };
  const reg = new Array(K).fill(null);
  const fs = v.formas;
  for (let i = 0; i < fs.length;) {
    let j = i; while (j < fs.length && fs[j].rotulo === fs[i].rotulo) j++;
    const l = fs.slice(i, j).map(csDe).filter(c => !c.isEmpty());
    if (l.length) {
      const g = l.length === 1 ? l[0] : G(CrossSection.union(l)), r = fs[i].rotulo;
      for (let k = 0; k < K; k++) if (k !== r && reg[k]) reg[k] = G(reg[k].subtract(g));
      if (r >= 0 && r < K) reg[r] = reg[r] ? G(reg[r].add(g)) : g;
    }
    i = j;
  }
  return reg.map(c => c && !c.isEmpty() ? c : null);
}

function areaPol(p) { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return s / 2; }

// pedaços que o fechamento não juntou: barra do pedaço até o maior, pelo ponto mais perto
function unirComBarras(base, CrossSection, G, larg) {
  const pedacos = base.decompose().map(G).sort((a, b) => b.area() - a.area());
  let u = pedacos[0];
  for (const p of pedacos.slice(1)) {
    const A = u.toPolygons().flat(), B = p.toPolygons().flat();
    let best = null, dm = Infinity;
    const passoA = Math.max(1, Math.floor(A.length / 400)), passoB = Math.max(1, Math.floor(B.length / 400));
    for (let i = 0; i < A.length; i += passoA) for (let j = 0; j < B.length; j += passoB) { const d = (A[i][0] - B[j][0]) ** 2 + (A[i][1] - B[j][1]) ** 2; if (d < dm) { dm = d; best = [A[i], B[j]]; } }
    const c1 = G(G(CrossSection.circle(larg, 32)).translate(best[0])), c2 = G(G(CrossSection.circle(larg, 32)).translate(best[1]));
    u = G(CrossSection.union([u, p, G(CrossSection.hull([c1, c2]))]));
  }
  return u;
}

// Onde vai a argola (em px da análise). Regra: o disco da argola fica a pelo
// menos `folga` da arte (a arte nunca é cortada); a aba liga ela na peça.
function colocarArgola(sil, W, H, pxMM, cfgA, cx, avisos) {
  const furoMM = Math.max(1.5, Math.min(12, cfgA.furoMM)), paredeMM = Math.max(1, Math.min(8, cfgA.paredeMM));
  const alcaMM = furoMM / 2 + paredeMM;
  const dReq = (alcaMM + 0.4) * pxMM;
  // tela com margem (a argola pode sair pra fora da imagem)
  const pad = Math.ceil(dReq + 3), PW = W + 2 * pad, PH = H + 2 * pad;
  const m = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) m.set(sil.subarray(y * W, y * W + W), (y + pad) * PW + pad);
  const d2 = M.distancia2(m, PW, PH, 1);
  const D = (x, y) => {   // distância (px) até a arte, bilinear
    const X = x + pad - 0.5, Y = y + pad - 0.5;
    const x0 = Math.max(0, Math.min(PW - 2, Math.floor(X))), y0 = Math.max(0, Math.min(PH - 2, Math.floor(Y)));
    const tx = Math.max(0, Math.min(1, X - x0)), ty = Math.max(0, Math.min(1, Y - y0));
    const a = Math.sqrt(d2[y0 * PW + x0]), b = Math.sqrt(d2[y0 * PW + x0 + 1]), c = Math.sqrt(d2[(y0 + 1) * PW + x0]), d = Math.sqrt(d2[(y0 + 1) * PW + x0 + 1]);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const dirs = { topo: [0, -1], esquerda: [-1, 0], direita: [1, 0], canto: [-Math.SQRT1_2, -Math.SQRT1_2], baixo: [0, 1] };
  const dv = dirs[cfgA.posicao] || dirs.topo;
  // ponto mais avançado da arte nessa direção
  let ext = -Infinity, ex = 0, ey = 0;
  for (let y = cx.y0; y <= cx.y1; y++) for (let x = cx.x0; x <= cx.x1; x++) {
    if (!sil[y * W + x]) continue;
    const p = (x + 0.5) * dv[0] + (y + 0.5) * dv[1];
    if (p > ext + 1e-9) { ext = p; ex = x + 0.5; ey = y + 0.5; }
  }
  let c = null, noVao = false;
  if (cfgA.posicao === 'livre' && cfgA.ponto) {
    c = [cx.x0 + cfgA.ponto.u * cx.w, cx.y0 + cfgA.ponto.v * cx.h];
    if (D(c[0], c[1]) < dReq) {
      // soltou em cima da arte: vai pro lugar livre mais perto
      let best = null, bd = Infinity;
      const R = Math.ceil(dReq * 3);
      for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) {
        const x = c[0] + dx, y = c[1] + dy;
        if (x < -pad || y < -pad || x > W + pad || y > H + pad) continue;
        const dd = dx * dx + dy * dy;
        if (dd < bd && D(x, y) >= dReq) { bd = dd; best = [x, y]; }
      }
      c = best || [ex + dv[0] * dReq, ey + dv[1] * dReq];
    }
  } else if (cfgA.centro !== false && cfgA.posicao !== 'canto') {
    // no eixo do meio da logo, vindo de fora até encostar na folga
    const meio = [(cx.x0 + cx.x1 + 1) / 2, (cx.y0 + cx.y1 + 1) / 2];
    const lat = dv[0] === 0 ? [meio[0], 0] : [0, meio[1]];
    const pos = s => dv[0] === 0 ? [lat[0], s] : [s, lat[1]];
    const sIni = dv[0] + dv[1] > 0 ? (dv[0] === 0 ? H + pad - 1 : W + pad - 1) : -pad + 1;
    const passo = -(dv[0] + dv[1]);
    let s = sIni, ok = null;
    for (let g = 0; g < 4 * (W + H); g++) {
      const p = pos(s);
      if (D(p[0], p[1]) < dReq) break;
      ok = s; s += passo;
    }
    if (ok != null) {
      let a = ok, b = s;
      for (let it = 0; it < 12; it++) { const mm = (a + b) / 2, p = pos(mm); if (D(p[0], p[1]) >= dReq) a = mm; else b = mm; }
      c = pos(a);
      // afundou num vão (meio de um "U", espaço entre letras)? usa a ponta de fora
      const prof = ext - (c[0] * dv[0] + c[1] * dv[1]) - dReq;
      if (prof > dReq * 0.9) { c = null; noVao = true; }
    }
    if (!c) { c = [ex + dv[0] * dReq, ey + dv[1] * dReq]; noVao = true; }
  } else {
    c = [ex + dv[0] * dReq, ey + dv[1] * dReq];
  }
  if (noVao) avisos.push({ tipo: 'dica', texto: 'O meio da logo tem um vão: a argola foi pra ponta de fora. Arraste ela pra outro lugar se quiser.' });
  // ponto da arte mais perto (pra onde vai a aba de reforço)
  let q = [ex, ey], qd = Infinity;
  const R = Math.ceil(D(c[0], c[1]) + 3);
  for (let y = Math.max(0, Math.floor(c[1] - R)); y <= Math.min(H - 1, Math.ceil(c[1] + R)); y++) for (let x = Math.max(0, Math.floor(c[0] - R)); x <= Math.min(W - 1, Math.ceil(c[0] + R)); x++) {
    if (!sil[y * W + x]) continue;
    const d = (x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2;
    if (d < qd) { qd = d; q = [x + 0.5, y + 0.5]; }
  }
  return { x: c[0], y: c[1], qx: q[0], qy: q[1], furoMM, alcaMM, noVao };
}

// Texto do verso: máscara (px da tela) -> contorno -> cabe no miolo da base
// (longe da borda e da argola), espelhado em X (lê certo com a peça virada),
// nas primeiras camadas. 'cor' = peça colorida rente (AMS); 'gravado' = vazio.
function textoDoVerso(base, v, argola, altBase, perfil, cfg, CrossSection, G, avisos, dicas) {
  let t, qr = null;
  if (v.qr) {
    // QR: quadradinhos exatos (sem arredondar canto), linha por linha
    try { qr = gerarQR(v.qr); } catch (e) { avisos.push({ tipo: 'alerta', texto: e.message }); return null; }
    const N = qr.tamanho, rets = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N;) {
      if (!qr.modulos[y][x]) { x++; continue; }
      let x2 = x; while (x2 < N && qr.modulos[y][x2]) x2++;
      rets.push([[x, -y - 1], [x2, -y - 1], [x2, -y], [x, -y]]);
      x = x2;
    }
    t = G(new CrossSection(rets, 'NonZero'));
  } else {
    const m = new Uint8Array(v.w * v.h);
    for (let i = 0; i < m.length; i++) m[i] = v.alfa[i] >= 128 ? 1 : 0;
    const pols = poligonosMM(m, v.w, v.h, 1, { tolMM: 0.35, areaMinMM2: 2 });
    if (!pols.length) return null;
    t = G(new CrossSection(pols, 'EvenOdd'));
  }
  // miolo: base menos a margem e menos a argola (com folga)
  let miolo = G(base.offset(-Math.max(1.6, (cfg.bordaMM || 0) * 0.7), 'Round', 2, 48));
  if (argola) miolo = G(miolo.subtract(G(G(CrossSection.circle(argola.alcaMM + 1.2, 64)).translate([argola.xMM, argola.yMM]))));
  if (miolo.isEmpty()) { avisos.push({ tipo: 'alerta', texto: 'A peça é pequena demais pra texto no verso.' }); return null; }
  const fundo = pontoMaisFundo(miolo);
  const bi = miolo.bounds(), tb = t.bounds();
  const tw = tb.max[0] - tb.min[0], th = tb.max[1] - tb.min[1];
  const iw = bi.max[0] - bi.min[0], ih = bi.max[1] - bi.min[1];
  // QR: o quadrado inteiro + 2 módulos de margem clara tem que caber
  const tcx = (tb.min[0] + tb.max[0]) / 2, tcy = (tb.min[1] + tb.max[1]) / 2;
  let k = qr ? (2 * fundo.raio * 0.7) / (qr.tamanho + 4) : Math.min(0.86 * iw / tw, 0.5 * ih / th, (2 * fundo.raio * 0.95) / th);
  const cx = qr ? fundo.x : (bi.min[0] + bi.max[0]) / 2, cy = fundo.y;
  let caber = null;
  for (let it = 0; it < 14; it++) {
    const c = G(G(G(G(t.translate([-tcx, -tcy])).mirror([1, 0])).scale(k)).translate([cx, cy]));   // espelha em X
    const teste = qr ? G(G(CrossSection.square([(qr.tamanho + 4) * k, (qr.tamanho + 4) * k], true)).translate([cx, cy])) : c;
    const dentro = G(teste.intersect(miolo));
    if (dentro.area() >= teste.area() * 0.995) { caber = c; break; }
    k *= qr ? 0.94 : 0.9;
  }
  if (!caber) { avisos.push({ tipo: 'alerta', texto: 'O texto do verso não coube: use menos letras ou aumente a peça.' }); return null; }
  const alturaLetra = qr ? null : th * k / Math.max(1, v.linhas || 1);
  if (alturaLetra != null && alturaLetra < 3) avisos.push({ tipo: 'alerta', texto: 'As letras do verso ficaram com ' + alturaLetra.toFixed(1).replace('.', ',') + ' mm: pode não dar pra ler. Encurte o texto ou aumente a peça.' });
  if (qr && k < 0.8) avisos.push({ tipo: 'alerta', texto: 'O QR ficou com quadradinhos de ' + k.toFixed(2).replace('.', ',') + ' mm: o celular pode não ler. Aumente a peça ou use um link mais curto.' });
  let modo = v.modo === 'gravado' ? 'gravado' : 'cor';
  if (qr && modo === 'gravado') avisos.push({ tipo: 'alerta', texto: 'QR gravado (mesma cor) quase não lê no celular: use o verso colorido (AMS).' });
  if (qr && modo === 'cor') {
    const L = h => { const c = rgbDeHex(h) || [0, 0, 0]; return lab(c[0], c[1], c[2])[0]; };
    if (L(v.cor || '#000000') > L(cfg._corBase || '#FFFFFF') - 35) avisos.push({ tipo: 'alerta', texto: 'Pro QR ler, a cor dele tem que ser bem mais escura que a base (ex.: preto numa base clara).' });
  }
  if (modo === 'cor' && cfg.estrategia === 'troca') {
    modo = 'gravado';
    dicas.push({ tipo: 'dica', texto: 'Sem AMS o verso sai gravado (texto colorido rente precisa trocar cor na mesma camada).' });
  }
  const prof = Math.max(2 * perfil.camada, Math.round(Math.min(v.profundidadeMM, altBase - 0.8) / perfil.camada) * perfil.camada);
  const prisma = G(caber.extrude(prof));
  return { prisma, modo, info: { modo, profundidade: prof, alturaLetraMM: alturaLetra, larguraMM: tw * k, qr: qr ? { versao: qr.versao, moduloMM: k, ladoMM: qr.tamanho * k } : null } };
}

// ponto mais longe da borda de uma área (CrossSection), rasterizando a 0,25 mm
function pontoMaisFundo(cs) {
  const b = cs.bounds(), res = 0.25;
  const w = Math.ceil((b.max[0] - b.min[0]) / res) + 2, h = Math.ceil((b.max[1] - b.min[1]) / res) + 2;
  const m = new Uint8Array(w * h);
  const pols = cs.toPolygons();
  for (let y = 0; y < h; y++) {
    const Y = b.min[1] + (y + 0.5) * res, xs = [];
    for (const p of pols) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j], c = p[i];
      if ((a[1] > Y) !== (c[1] > Y)) xs.push(a[0] + (Y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
    }
    xs.sort((u, v2) => u - v2);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil((xs[k] - b.min[0]) / res - 0.5)); x <= Math.min(w - 1, Math.floor((xs[k + 1] - b.min[0]) / res - 0.5)); x++) m[y * w + x] = 1;
  }
  const d2 = M.distancia2(m, w, h, 0);
  let bi = 0; for (let i = 0; i < w * h; i++) if (d2[i] > d2[bi]) bi = i;
  return { x: b.min[0] + ((bi % w) + 0.5) * res, y: b.min[1] + (((bi / w) | 0) + 0.5) * res, raio: Math.sqrt(d2[bi]) * res };
}

// bolso da tag NFC no ponto mais "fundo" da base (mais longe da borda e do furo)
function bolsoNFC(base, cfgN, altBase, perfil, CrossSection, G, avisos) {
  const b = base.bounds(), res = 0.25;
  const w = Math.ceil((b.max[0] - b.min[0]) / res) + 2, h = Math.ceil((b.max[1] - b.min[1]) / res) + 2;
  const m = new Uint8Array(w * h);
  const pols = base.toPolygons();
  // rasteriza (par-ímpar por linha)
  for (let y = 0; y < h; y++) {
    const Y = b.min[1] + (y + 0.5) * res, xs = [];
    for (const p of pols) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j], c = p[i];
      if ((a[1] > Y) !== (c[1] > Y)) xs.push(a[0] + (Y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil((xs[k] - b.min[0]) / res - 0.5)); x <= Math.min(w - 1, Math.floor((xs[k + 1] - b.min[0]) / res - 0.5)); x++) m[y * w + x] = 1;
  }
  const d2 = M.distancia2(m, w, h, 0);
  let bi = 0; for (let i = 0; i < w * h; i++) if (d2[i] > d2[bi]) bi = i;
  const fundo = Math.sqrt(d2[bi]) * res;
  const r = cfgN.diametroMM / 2;
  if (fundo < r + cfgN.paredeMM) {
    const cabe = Math.floor((fundo - cfgN.paredeMM) * 2);
    avisos.push({ tipo: 'alerta', texto: 'A tag NFC de ' + cfgN.diametroMM + ' mm não cabe nesta peça.' + (cabe > 8 ? ' Aqui cabe até ' + cabe + ' mm, ou aumente a peça.' : ' Aumente a peça.') });
    return null;
  }
  const x = b.min[0] + ((bi % w) + 0.5) * res, y = b.min[1] + (((bi / w) | 0) + 0.5) * res;
  const prof = Math.max(perfil.camada, Math.round(cfgN.profundidadeMM / perfil.camada) * perfil.camada);
  let z0, info;
  if (cfgN.modo === 'fechado') {
    const fundoZ = Math.max(0.6, Math.round(((altBase - prof) / 2) / perfil.camada) * perfil.camada);
    const tampa = altBase - prof - fundoZ;
    if (tampa < 0.6) { avisos.push({ tipo: 'alerta', texto: 'Pra fechar a tag por dentro a base precisa de pelo menos ' + (prof + 1.2).toFixed(1) + ' mm. Aumente a base ou use "por baixo".' }); return null; }
    z0 = fundoZ;
    info = { modo: 'fechado', zPausa: +(fundoZ + prof).toFixed(2), camadaPausa: Math.round((fundoZ + prof) / perfil.camada) + 1 };
  } else {
    if (altBase - prof < 0.8) { avisos.push({ tipo: 'alerta', texto: 'Sobra pouco material em cima do bolso da tag. Aumente a base para ' + (prof + 1).toFixed(1) + ' mm.' }); return null; }
    z0 = 0; info = { modo: 'baixo' };
  }
  const corte = G(G(G(CrossSection.circle(r, segs(r))).translate([x, y])).extrude(prof));
  return { corte: G(corte.translate([0, 0, z0])), info: { ...info, xMM: x, yMM: y, diametroMM: cfgN.diametroMM, profundidade: prof } };
}

function relatorio(x) {
  const { an, cfg, perfil, largura, altura, espessura, saida, vivas, corDe, engrossados, meiaFina, pxMM, argola, pontes, trocas, altBase, altArte, avisos, dicas, temBase, cracha } = x;
  const q = [];   // {ok, titulo, texto}
  const pxOrig = pxMM / an.fatorImg;
  // resolução da imagem no tamanho pedido (SVG lido em vetor não tem resolução)
  if (an.vetor) q.push({ nivel: 'ok', titulo: 'Contorno exato do SVG', texto: an.svg.formas + ' forma(s) lidas do arquivo: a borda segue a curva do desenho' });
  else if (pxOrig >= 10) q.push({ nivel: 'ok', titulo: 'Resolução ótima', texto: Math.round(pxOrig) + ' px por mm' });
  else if (pxOrig >= 5) q.push({ nivel: 'ok', titulo: 'Resolução boa', texto: pxOrig.toFixed(1) + ' px por mm' });
  else q.push({ nivel: 'alerta', titulo: 'Imagem pequena pra esse tamanho', texto: pxOrig.toFixed(1) + ' px por mm: a borda pode sair serrilhada. Use uma imagem maior (1000 px ou mais) ou um chaveiro menor.' });
  // cores
  const nc = an.cores.length;
  q.push({ nivel: an.coresBrutas > 4 ? 'dica' : 'ok', titulo: 'Cores detectadas: ' + nc, texto: an.cores.map(c => c.nome).join(', ') + (an.coresBrutas > 4 ? ' (a imagem tem mais tons; juntei os parecidos em 4)' : '') });
  if (an.modo === 'fundo') q.push({ nivel: 'ok', titulo: 'Fundo removido', texto: 'fundo ' + an.fundo.nome.toLowerCase() + ' liso' });
  else if (an.modo === 'alfa') q.push({ nivel: 'ok', titulo: 'Fundo transparente', texto: an.vetor ? 'recorte pelo próprio desenho' : 'recorte pela transparência do PNG' });
  else q.push({ nivel: 'dica', titulo: 'Recorte por claro/escuro', texto: 'a imagem não tem fundo liso nem transparência: confira o recorte' });
  // detalhes finos
  if (engrossados) q.push({ nivel: 'dica', titulo: 'Detalhes finos reforçados', texto: engrossados + ' traço(s) mais fino(s) que ' + perfil.traco.toFixed(2).replace('.', ',') + ' mm engrossados pra imprimir com bico ' + String(perfil.bico).replace('.', ',') });
  else q.push({ nivel: 'ok', titulo: 'Detalhes imprimíveis', texto: 'nenhum traço mais fino que o bico ' + String(perfil.bico).replace('.', ',') });
  if (meiaFina != null && engrossados) {
    const minTraco = 2 * meiaFina / pxMM;   // mm
    if (minTraco < perfil.traco) {
      const precisa = Math.ceil(cfg.tamanhoMM * perfil.traco / Math.max(0.01, minTraco) / 5) * 5;
      if (precisa <= 150) dicas.push({ tipo: 'dica', texto: 'Pra os traços mais finos saírem sem engrossar: chaveiro de ' + precisa + ' mm' + (perfil.bico > 0.2 ? ' ou bico 0,2' : '') + '.' });
    }
  }
  if (an.svg) for (const t of an.svg.avisos) avisos.push({ tipo: 'alerta', texto: t });
  if (pontes) dicas.push({ tipo: 'dica', texto: 'A logo tinha partes soltas: a base junta tudo numa peça só.' });
  if (cracha != null) dicas.push({ tipo: 'dica', texto: 'A base usa a cor de fora da logo (' + an.cores[cracha].nome.toLowerCase() + '): uma cor a menos pra trocar.' });
  // mesa
  const [mx, my] = perfil.mesa;
  if (largura > mx - 10 || altura > my - 10) avisos.push({ tipo: 'alerta', texto: 'A peça (' + largura.toFixed(0) + ' × ' + altura.toFixed(0) + ' mm) não cabe na mesa da ' + perfil.nome + '.' });
  // estimativa de trocas de filamento (AMS)
  const camadas = Math.round(espessura / perfil.camada);
  let trocasAMS = 0;
  if (cfg.estrategia !== 'troca' && temBase) {
    // por camada acima da base: cores presentes nela - 1 (o Bambu encadeia a última)
    const zs = saida.filter(p => p.nome !== 'Base');
    for (let l = Math.round(altBase / perfil.camada); l < camadas; l++) {
      const z = (l + 0.5) * perfil.camada;
      let c = 0;
      for (const p of zs) { const pz = zDe(p); if (z >= pz[0] && z <= pz[1]) c++; }
      if (c) trocasAMS += c - 1 + (l === Math.round(altBase / perfil.camada) ? 1 : 0);
    }
  }
  const nTrocas = cfg.estrategia === 'troca' ? trocas.length : trocasAMS;
  const minTrocas = cfg.estrategia === 'troca' ? 0 : nTrocas * perfil.trocaS / 60;
  const volTotal = saida.reduce((a, p) => a + p.volumeMM3, 0);
  const minImpressao = volTotal / 6 / 60 + camadas * 0.12 + 1.5;   // ~6 mm³/s efetivo em peça pequena + troca de camada
  const estimativa = { camadas, trocas: nTrocas, minutos: Math.round(minImpressao + minTrocas), purgaG: cfg.estrategia === 'troca' ? 0 : +(nTrocas * perfil.purgaG).toFixed(1), gramas: +(volTotal / 1000 * PLA_G_CM3).toFixed(1) };
  if (cfg.estrategia !== 'troca' && vivas.length >= 2 && cfg.alturas === 'degraus' && nTrocas > 20) dicas.push({ tipo: 'dica', texto: 'Com "mesma altura" são menos trocas de filamento (mais rápido e menos purga).' });
  if (cfg.estrategia === 'troca' && trocas.length) dicas.push({ tipo: 'dica', texto: 'Sem AMS: no Bambu Studio, clique com o botão direito na barra de camadas e "Adicionar troca de filamento" em ' + trocas.map(t => 'camada ' + t.camada + ' (' + t.nome.toLowerCase() + ')').join(', ') + '.' });
  if (argola && argola.noVao) { /* aviso já dado */ }
  // nível geral
  const ruim = q.filter(c => c.nivel === 'alerta').length + avisos.filter(a => a.tipo === 'alerta').length;
  const dicaN = q.filter(c => c.nivel === 'dica').length;
  const nivel = ruim ? (ruim > 1 ? 'baixa' : 'regular') : dicaN > 1 ? 'boa' : 'excelente';
  const titulo = { excelente: 'Qualidade excelente', boa: 'Qualidade boa', regular: 'Atenção a 1 ponto', baixa: 'Precisa de ajuste' }[nivel];
  return { qualidade: { nivel, titulo, itens: q }, avisos, dicas, estimativa };
}
function zDe(p) { let z0 = Infinity, z1 = -Infinity; const pos = p.malha.pos; for (let i = 2; i < pos.length; i += 3) { if (pos[i] < z0) z0 = pos[i]; if (pos[i] > z1) z1 = pos[i]; } return [z0, z1]; }

export { nomeDaCor, rgbDeHex, lab, dE };

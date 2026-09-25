// Benchmark interno e pós-processo de QUALQUER gerador de 3D por fotos
// (silhuetas local, Hunyuan3D, TRELLIS...): põe o resultado no referencial
// das fotos (Z pra cima, frente pra câmera "frente", altura em mm, na mesa),
// acha o giro que bate com as fotos e mede o que importa pra imprimir.
import { caixa, transformar } from '../malha.js';
import { validar } from '../validador.js';
import { VISTAS, rasterizar } from './reconstrucao.js';

// glTF/OBJ de IA costuma vir com Y pra cima e a frente olhando pra +Z
const Y_PARA_Z = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];   // (x,y,z) -> (x,-z,y), coluna-maior
const giroZ = g => { const c = Math.round(Math.cos(g)), s = Math.round(Math.sin(g)); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

// centro XY na origem, base em z=0 e altura = alturaMM
export function normalizar(malha, opc = {}) {
  let m = opc.eixoCima === 'Y' ? transformar(malha, Y_PARA_Z) : malha;
  if (opc.giro) m = transformar(m, giroZ(opc.giro * Math.PI / 180));
  const c = caixa(m), f = opc.alturaMM ? opc.alturaMM / (c.tam[2] || 1) : 1;
  const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2;
  return transformar(m, [f, 0, 0, 0, 0, f, 0, 0, 0, 0, f, 0, -cx * f, -cy * f, -c.min[2] * f, 1]);
}

function caixaPix(d, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Silhueta do modelo na vista v, na escala da foto (mm/pixel) e com a posição
// casada pelo centro das silhuetas (o gerador pode ter deslocado o modelo sem
// errar a forma). -> { w, h, modelo: Uint8Array, foto: Uint8Array }
export function silhuetasAlinhadas(malha, v) {
  const { w, h } = v.mascara;
  const r = rasterizar(malha, v.eixos, { w, h, s: v.s, cx: v.cx, cy: v.cy });
  const a = caixaPix(r.d, w, h), b = caixaPix(v.mascara.d, w, h);
  const modelo = new Uint8Array(w * h);
  if (a && b) {
    const dx = Math.round(b.cx - a.cx), dy = VISTAS[v.vista].topo ? Math.round(b.cy - a.cy) : 0;   // lateral: a base já está na mesa
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xs = x - dx, ys = y - dy;
      if (xs >= 0 && ys >= 0 && xs < w && ys < h) modelo[y * w + x] = r.d[ys * w + xs];
    }
  }
  return { w, h, modelo, foto: v.mascara.d };
}

// IoU (0..1) da silhueta do modelo com a da foto, por vista
export function fidelidade(malha, prep) {
  const out = {};
  for (const v of prep.vistas) {
    const s = silhuetasAlinhadas(malha, v);
    let inter = 0, uni = 0;
    for (let i = 0; i < s.modelo.length; i++) { const m = s.modelo[i], f = s.foto[i]; if (m && f) inter++; if (m || f) uni++; }
    out[v.vista] = uni ? inter / uni : 0;
  }
  return out;
}

// giro em Z (0/90/180/270) que mais bate com as fotos
export function melhorGiro(malha, prep, opc = {}) {
  let melhor = null;
  for (const g of opc.giros || [0, 90, 180, 270]) {
    const m = normalizar(malha, { ...opc, giro: g });
    const f = fidelidade(m, prep), vals = Object.values(f), media = vals.reduce((s, x) => s + x, 0) / vals.length;
    if (!melhor || media > melhor.media + 1e-9) melhor = { giro: g, malha: m, fidelidade: f, media };
  }
  return melhor;
}

// números do benchmark (os mesmos pra todo gerador)
export function avaliar(malha, prep, extra = {}) {
  const v = validar(malha, { completo: true });
  const f = extra.fidelidade || fidelidade(malha, prep), vals = Object.values(f);
  const med = caixa(malha).tam;
  const imprimivel = v.fechada && !v.autoInterseccoes && !v.facesDegeneradas && v.componentesInvertidos === 0 && v.volume > 0;
  return {
    fidelidade: f,
    fidelidadeMedia: vals.reduce((s, x) => s + x, 0) / (vals.length || 1),
    fidelidadeMinima: vals.length ? Math.min(...vals) : 0,
    imprimivel, fechada: v.fechada, autoInterseccoes: v.autoInterseccoes, componentes: v.componentes,
    triangulos: malha.idx.length / 3, volumeCm3: v.volume / 1000, medidasMM: med.map(x => +x.toFixed(1)),
    ...extra.tempos ? { tempos: extra.tempos } : {},
    ...extra.reparo ? { passosDeReparo: extra.reparo.length } : {}
  };
}

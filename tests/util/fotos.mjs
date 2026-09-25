// "Fotos" sintéticas do personagem de teste: câmera ortográfica 480×480,
// fundo branco, luz suave. Mesma coisa que um guia de foto pede ao usuário.
import { gerarPersonagem } from './personagem.mjs';
import { rasterizar, eixosDaVista, VISTAS } from '../../src/estudio3d/core/ia/reconstrucao.js';
import { caixa, normaisFace, transladar } from '../../src/estudio3d/core/malha.js';

export const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function cenaDeFotos(W = 480) {
  const { malha: P0, paleta: PAL } = gerarPersonagem({ argola: false });
  // só o personagem (sem a argola solta), com o pé na mesa e centrado
  const GT = (() => { const c = caixa(P0); return transladar(P0, -(c.min[0] + c.max[0]) / 2, -(c.min[1] + c.max[1]) / 2, -c.min[2]); })();
  const H = caixa(GT).tam[2];
  function foto(nomeVista) {
    const e = eixosDaVista(nomeVista), s = (H * 1.25) / W;
    const cfg = VISTAS[nomeVista].topo ? { w: W, h: W, s, cx: W / 2, cy: W / 2 } : { w: W, h: W, s, cx: W / 2, cy: W * 0.92 };
    const r = rasterizar(GT, e, cfg), N = normaisFace(GT);
    const rgba = new Uint8Array(W * W * 4).fill(255);
    for (let i = 0; i < W * W; i++) {
      const t = r.tri[i]; if (t < 0) continue;
      const c = hexRGB(PAL[GT.cor[t]] || PAL[0]);
      const luz = 0.55 + 0.45 * Math.max(0, -(N[t * 3] * e.f[0] + N[t * 3 + 1] * e.f[1] + N[t * 3 + 2] * e.f[2]));
      rgba[i * 4] = c[0] * luz; rgba[i * 4 + 1] = c[1] * luz; rgba[i * 4 + 2] = c[2] * luz;
    }
    return { vista: nomeVista, rgba, w: W, h: W };
  }
  const FOTOS = {}; for (const v of Object.keys(VISTAS)) FOTOS[v] = foto(v);
  return { GT, H, PAL, FOTOS };
}

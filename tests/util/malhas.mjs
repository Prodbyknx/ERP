import { criar, semFaces } from '../../src/estudio3d/core/malha.js';

export function caixaMalha(x, y, z, ox = 0, oy = 0, oz = 0) {
  const pos = [0,0,0, x,0,0, x,y,0, 0,y,0, 0,0,z, x,0,z, x,y,z, 0,y,z].map((v, i) => v + [ox, oy, oz][i % 3]);
  const idx = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  return criar(pos, idx);
}

// esfera por subdivisão de icosaedro (fechada, orientada pra fora)
export function esfera(r = 10, nivel = 3, cx = 0, cy = 0, cz = 0) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
  let f = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  v = v.map(p => { const L = Math.hypot(...p); return p.map(c => c / L); });
  for (let n = 0; n < nivel; n++) {
    const meio = new Map(), nf = [];
    const m = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (meio.has(k)) return meio.get(k);
      const p = [(v[a][0]+v[b][0])/2,(v[a][1]+v[b][1])/2,(v[a][2]+v[b][2])/2]; const L = Math.hypot(...p);
      v.push(p.map(c => c / L)); meio.set(k, v.length - 1); return v.length - 1; };
    for (const [a,b,c] of f) { const ab = m(a,b), bc = m(b,c), ca = m(c,a); nf.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]); }
    f = nf;
  }
  return criar(v.flatMap(p => [p[0]*r+cx, p[1]*r+cy, p[2]*r+cz]), f.flat());
}

export function tirarFaces(m, lista) {
  const rem = new Uint8Array(m.idx.length / 3); lista.forEach(t => { rem[t] = 1; });
  return semFaces(m, rem);
}

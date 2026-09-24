// Matriz 4x4 em coluna (mesma convenção do three.js: e[12..14] = translação).
// x' = e0*x + e4*y + e8*z + e12
// O 3MF grava 12 números "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"
// no formato vetor-linha; eles caem direto em e[0,1,2, 4,5,6, 8,9,10, 12,13,14].

export function identidade() {
  const e = new Float64Array(16);
  e[0] = e[5] = e[10] = e[15] = 1;
  return e;
}

export function copiar(m) { return Float64Array.from(m); }

export function ehIdentidade(m, tol = 1e-12) {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) if (Math.abs(m[i] - I[i]) > tol) return false;
  return true;
}

// r = a * b (aplica b primeiro, depois a)
export function multiplicar(a, b) {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let l = 0; l < 4; l++) {
      r[c * 4 + l] = a[l] * b[c * 4] + a[4 + l] * b[c * 4 + 1] + a[8 + l] * b[c * 4 + 2] + a[12 + l] * b[c * 4 + 3];
    }
  }
  return r;
}

export function translacao(x, y, z) {
  const m = identidade();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function escala(sx, sy, sz) {
  const m = identidade();
  m[0] = sx; m[5] = sy; m[10] = sz;
  return m;
}

// Rotação por ângulos de Euler em GRAUS, ordem XYZ (igual ao three.js 'XYZ').
export function rotacaoEuler(rx, ry, rz) {
  const a = rx * Math.PI / 180, b = ry * Math.PI / 180, c = rz * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const m = identidade();
  // mesma fórmula de Matrix4.makeRotationFromEuler (XYZ)
  const ae = ca * cc, af = ca * sc, be = sa * cc, bf = sa * sc;
  m[0] = cb * cc; m[4] = -cb * sc; m[8] = sb;
  m[1] = af + be * sb; m[5] = ae - bf * sb; m[9] = -sa * cb;
  m[2] = bf - ae * sb; m[6] = be + af * sb; m[10] = ca * cb;
  return m;
}

// Compõe posição (mm), rotação (graus, XYZ) e escala (fator) -> T * R * S
export function compor(pos, rotGraus, esc) {
  return multiplicar(translacao(pos[0], pos[1], pos[2]),
    multiplicar(rotacaoEuler(rotGraus[0], rotGraus[1], rotGraus[2]), escala(esc[0], esc[1], esc[2])));
}

// Decompõe em posição, rotação XYZ (graus) e escala. Escala negativa vira
// espelho no eixo X (é o que dá pra representar sem ambiguidade).
export function decompor(m) {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  if (determinante(m) < 0) sx = -sx;
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  // r em coluna: r[0]=m11 r[3]=m12 r[6]=m13 / r[1]=m21 r[4]=m22 r[7]=m23 / r[2]=m31 r[5]=m32 r[8]=m33
  const m13 = r[6], m23 = r[7], m33 = r[8], m12 = r[3], m11 = r[0], m32 = r[5], m22 = r[4];
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  let rx, rz;
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }
  const g = 180 / Math.PI;
  return { pos: [m[12], m[13], m[14]], rot: [rx * g, ry * g, rz * g], esc: [sx, sy, sz] };
}

export function determinante(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}

export function inverter(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  const r = new Float64Array(16);
  r[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  r[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  r[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  r[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  r[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  r[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  r[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  r[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  r[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  r[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  r[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  r[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  r[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  r[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  r[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  r[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return r;
}

export function aplicarPonto(m, x, y, z, out) {
  out = out || [0, 0, 0];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

export function aplicarDirecao(m, x, y, z, out) {
  out = out || [0, 0, 0];
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

// Base ortonormal com o eixo Z = n. Devolve matriz que leva o plano local
// XY (z=0) para o plano que passa por 'origem' com normal 'n'.
export function doPlano(origem, n, dicaX) {
  let nx = n[0], ny = n[1], nz = n[2];
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L; ny /= L; nz /= L;
  let ux, uy, uz;
  if (dicaX) {
    const d = dicaX[0] * nx + dicaX[1] * ny + dicaX[2] * nz;
    ux = dicaX[0] - d * nx; uy = dicaX[1] - d * ny; uz = dicaX[2] - d * nz;
  }
  if (!dicaX || Math.hypot(ux, uy, uz) < 1e-9) {
    // eixo menos alinhado com n
    if (Math.abs(nx) < 0.9) { const d = nx; ux = 1 - d * nx; uy = -d * ny; uz = -d * nz; }
    else { const d = ny; ux = -d * nx; uy = 1 - d * ny; uz = -d * nz; }
  }
  const Lu = Math.hypot(ux, uy, uz);
  ux /= Lu; uy /= Lu; uz /= Lu;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const m = identidade();
  m[0] = ux; m[1] = uy; m[2] = uz;
  m[4] = vx; m[5] = vy; m[6] = vz;
  m[8] = nx; m[9] = ny; m[10] = nz;
  m[12] = origem[0]; m[13] = origem[1]; m[14] = origem[2];
  return m;
}

// 12 números no formato do 3MF
export function para3MF(m) {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]];
}

export function de3MF(v) {
  const m = identidade();
  m[0] = v[0]; m[1] = v[1]; m[2] = v[2];
  m[4] = v[3]; m[5] = v[4]; m[6] = v[5];
  m[8] = v[6]; m[9] = v[7]; m[10] = v[8];
  m[12] = v[9]; m[13] = v[10]; m[14] = v[11];
  return m;
}

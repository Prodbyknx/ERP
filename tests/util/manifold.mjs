import Module from 'manifold-3d';
import { definirManifold } from '../../src/estudio3d/core/solidos.js';
let pronto = null;
export function carregarManifold() {
  if (!pronto) pronto = Module().then(w => { w.setup(); definirManifold(w); return w; });
  return pronto;
}

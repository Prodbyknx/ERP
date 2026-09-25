// CutEngine — corte por plano com as duas metades FECHADAS (Manifold
// fecha a face do corte com a seção exata) e conectores opcionais.
// Tudo no referencial da peça (o objeto mantém sua posição/rotação/escala).
import { comContexto, manifold } from './solidos.js';
import { gerarConectores } from './conectores.js';
import * as M4 from './mat4.js';
import { caixa, transladar } from './malha.js';

export function normalizarPlano(plano) {
  const L = Math.hypot(plano.n[0], plano.n[1], plano.n[2]);
  if (!(L > 0)) throw new Error('Plano de corte sem direção.');
  return { n: [plano.n[0] / L, plano.n[1] / L, plano.n[2] / L], d: plano.d / L };
}

// Plano do mundo -> plano no referencial da peça (transform = objeto)
export function planoParaLocal(plano, transform) {
  const t = transform;
  const n = plano.n;
  // (M^T n) . x_l = d - n . translação
  const nl = [t[0] * n[0] + t[1] * n[1] + t[2] * n[2], t[4] * n[0] + t[5] * n[1] + t[6] * n[2], t[8] * n[0] + t[9] * n[1] + t[10] * n[2]];
  const dl = plano.d - (n[0] * t[12] + n[1] * t[13] + n[2] * t[14]);
  return normalizarPlano({ n: nl, d: dl });
}

export function referencialDoPlano(plano) {
  const { n, d } = normalizarPlano(plano);
  // dica de eixo X estável: para corte em Z, X do mundo
  const dica = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  return M4.doPlano([n[0] * d, n[1] * d, n[2] * d], n, dica);
}

// Seção (polígonos no referencial do plano) de um conjunto de sólidos
export function secao(ctx, solidos, frame) {
  const { Manifold } = manifold();
  const u = solidos.length === 1 ? solidos[0] : ctx.guardar(Manifold.union(solidos));
  const loc = ctx.guardar(u.transform(Array.from(M4.inverter(frame))));
  const cs = ctx.guardar(loc.slice(0));
  return { poligonos: cs.toPolygons(), area: cs.area() };
}

// partes: [{nome, malha, cor, paleta}] de UM objeto.
// opc.conector: config de conector (ver conectores.js) ou null
export function cortarPorPlano(partes, plano0, opc = {}) {
  const plano = normalizarPlano(plano0);
  return comContexto(ctx => {
    const { Manifold } = manifold();
    const avisos = [];
    const solidos = partes.map(p => ctx.solido(p, p.nome));
    const frame = referencialDoPlano(plano);
    const sec = secao(ctx, solidos, frame);
    if (!sec.poligonos.length || sec.area <= 1e-9) throw new Error('O plano não atravessa a peça.');
    const A = [], B = [];
    solidos.forEach((s, i) => {
      const [a, b] = s.splitByPlane(plano.n, plano.d);
      ctx.guardar(a); ctx.guardar(b);
      A.push({ man: a, i }); B.push({ man: b, i });
    });
    const vazioA = A.every(x => x.man.isEmpty()), vazioB = B.every(x => x.man.isEmpty());
    if (vazioA || vazioB) throw new Error('O plano não divide a peça em duas.');
    let relatorio = [], extras = [];
    if (opc.conector && opc.conector.tipo && opc.conector.tipo !== 'nenhum') {
      const naoVazio = l => l.filter(x => !x.man.isEmpty()).map(x => x.man);
      const solA = ctx.guardar(Manifold.union(naoVazio(A)));
      const solB = ctx.guardar(Manifold.union(naoVazio(B)));
      // lado que recebe o pino: A por padrão; 'B' troca os papéis
      const inverter = opc.conector.ladoPino === 'B';
      const fr = inverter ? M4.multiplicar(frame, M4.rotacaoEuler(180, 0, 0)) : frame;
      const secaoUsada = inverter ? sec.poligonos.map(a => a.map(p => [p[0], -p[1]])) : sec.poligonos;
      const g = gerarConectores(ctx, { solidoA: inverter ? solB : solA, solidoB: inverter ? solA : solB, frame: fr, secao: secaoUsada, cfg: opc.conector });
      avisos.push(...g.avisos);
      relatorio = g.relatorio;
      const ladoPos = inverter ? B : A, ladoNeg = inverter ? A : B;
      if (g.positivos.length) {
        // pino vai pra peça com maior área no corte
        let alvo = null, maior = -1;
        const inv = Array.from(M4.inverter(fr));
        for (const x of ladoPos) {
          if (x.man.isEmpty()) continue;
          const loc = ctx.guardar(x.man.transform(inv));
          const cs = ctx.guardar(loc.slice(1e-3));
          const a = cs.area();
          if (a > maior) { maior = a; alvo = x; }
        }
        const pinos = g.positivos.length === 1 ? g.positivos[0] : ctx.guardar(Manifold.union(g.positivos));
        alvo.man = ctx.guardar(alvo.man.add(pinos));
      }
      if (g.negativosB.length) {
        const furos = g.negativosB.length === 1 ? g.negativosB[0] : ctx.guardar(Manifold.union(g.negativosB));
        for (const x of ladoNeg) if (!x.man.isEmpty()) x.man = ctx.guardar(x.man.subtract(furos));
      }
      if (g.negativosA.length) {
        const furos = g.negativosA.length === 1 ? g.negativosA[0] : ctx.guardar(Manifold.union(g.negativosA));
        for (const x of ladoPos) if (!x.man.isEmpty()) x.man = ctx.guardar(x.man.subtract(furos));
      }
      g.soltos.forEach((s, k) => {
        const corPino = partes[0].cor;
        extras.push({ nome: 'Pino solto ' + (k + 1), ...ctx.parte(s.man, 'Pino solto ' + (k + 1), corPino), soltoComprimento: s.comprimento });
      });
    }
    const saida = lado => lado.filter(x => !x.man.isEmpty()).map(x => ctx.parte(x.man, partes[x.i].nome, partes[x.i].cor, true));
    const pa = saida(A), pb = saida(B);
    // pino solto nasce na origem: coloca em pé, ao lado das peças, na mesma base
    if (extras.length) {
      let x1 = -Infinity, y0 = Infinity, z0 = Infinity;
      for (const p of [...pa, ...pb]) { const c = caixa(p.malha); x1 = Math.max(x1, c.max[0]); y0 = Math.min(y0, c.min[1]); z0 = Math.min(z0, c.min[2]); }
      let x = x1 + 4;
      for (const e of extras) {
        const c = caixa(e.malha);
        e.malha = transladar(e.malha, x - c.min[0], y0 - c.min[1], z0 - c.min[2]);
        x += c.tam[0] + 3;
      }
    }
    const volA = A.reduce((s, x) => s + (x.man.isEmpty() ? 0 : x.man.volume()), 0);
    const volB = B.reduce((s, x) => s + (x.man.isEmpty() ? 0 : x.man.volume()), 0);
    return { A: pa, B: pb, extras, secao: sec.poligonos, areaSecao: sec.area, frame, relatorio, avisos, volumes: [volA, volB] };
  });
}

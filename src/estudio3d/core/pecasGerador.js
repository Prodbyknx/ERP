// Peças do gerador de chaveiro (triângulos soltos por peça) -> sólidos
// prontos pra exportar. Usado pela tela (motor no worker) e pelo MCP (motor
// direto no Node): rodar(op, args) devolve o resultado da operação.
import { criar, juntar } from './malha.js';

export async function pecasDoGerador(pecas, rodar, avisar = () => {}) {
  const saida = [];
  for (const p of pecas) {
    if (p.fatias && p.fatias.length > 1) {
      // fatias soltas (sem soldar uma na outra): a união do Manifold junta
      // as faces que se encostam e mantém o bolso / o vão da tag NFC
      try {
        const junta = juntar(p.fatias.map(f => criar(f.pos, f.idx)));
        const u = await rodar('unirSobrepostos', { parte: { nome: p.nome, malha: junta, cor: p.cor } });
        saida.push({ nome: p.nome, malha: u.parte.malha, cor: p.cor });
        continue;
      } catch (e) { avisar('fatias do gerador sem união: ' + (e.message || e)); }
    }
    const malha = criar(p.malha.pos, p.malha.idx);
    let parte = { nome: p.nome, malha, cor: p.cor };
    try {
      const r = await rodar('reparar', { parte, opc: { completo: false, taparBuracos: true } });
      parte = { nome: p.nome, malha: r.parte.malha, cor: p.cor };
      // fatias empilhadas viram um sólido só
      const u = await rodar('unirSobrepostos', { parte });
      parte = { nome: p.nome, malha: u.parte.malha, cor: p.cor };
    } catch (e) { avisar('peça do gerador sem união: ' + (e.message || e)); }
    saida.push(parte);
  }
  return saida;
}

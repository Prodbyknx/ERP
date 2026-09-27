// Progresso de operação longa (0..1 + etapa). O worker liga um relator que
// manda pra tela; fora dele (testes, modo sem worker) não faz nada.
// Limita a ~8 avisos por segundo pra não custar tempo (troca de etapa passa).
let relator = null, ultimo = 0, ultimaEtapa = null;
export function definirProgresso(fn) { relator = fn; ultimo = 0; ultimaEtapa = null; }
export function progresso(fracao, etapa) {
  if (!relator) return;
  const agora = Date.now();
  // etapa nova sempre aparece; dentro da etapa, no máximo ~8 por segundo
  if (fracao < 1 && etapa === ultimaEtapa && agora - ultimo < 120) return;
  ultimo = agora; ultimaEtapa = etapa;
  relator(Math.max(0, Math.min(1, fracao)), etapa || '');
}

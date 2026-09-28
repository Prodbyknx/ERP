// Impressoras Bambu e bicos: mesa, AMS, altura de camada e o menor traço que
// sai. As recomendações do gerador saem DAQUI (nada de número solto na tela).
export const IMPRESSORAS = {
  A1:       { nome: 'Bambu A1',      mesa: [256, 256, 256], ams: 'AMS lite', trocaS: 38 },
  A1MINI:   { nome: 'Bambu A1 mini', mesa: [180, 180, 180], ams: 'AMS lite', trocaS: 38 },
  P1S:      { nome: 'Bambu P1S',     mesa: [256, 256, 256], ams: 'AMS',      trocaS: 30 },
  P1P:      { nome: 'Bambu P1P',     mesa: [256, 256, 256], ams: 'AMS',      trocaS: 30 },
  X1C:      { nome: 'Bambu X1C',     mesa: [256, 256, 256], ams: 'AMS',      trocaS: 26 }
};
// camada: a padrão do Bambu Studio pra esse bico; traço: menor largura que
// imprime firme com parede Arachne (~0,9 do bico)
export const BICOS = {
  0.2: { camada: 0.1, primeira: 0.1, traco: 0.2, purgaG: 0.15 },
  0.4: { camada: 0.2, primeira: 0.2, traco: 0.38, purgaG: 0.35 },
  0.6: { camada: 0.3, primeira: 0.3, traco: 0.56, purgaG: 0.5 }
};
export const PLA_G_CM3 = 1.24;

export function perfilDe(impressora = 'A1', bico = 0.4) {
  const imp = IMPRESSORAS[impressora] || IMPRESSORAS.A1;
  const b = BICOS[bico] || BICOS[0.4];
  return { id: IMPRESSORAS[impressora] ? impressora : 'A1', bico: BICOS[bico] ? bico : 0.4, ...imp, ...b };
}

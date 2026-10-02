# Auditoria técnica do sistema 3D — Estúdio 3D + Gerador de chaveiros

Data: 02/10/2026 · Escopo: `src/estudio3d`, `src/gerador`, a parte 3D do `site/app.js`
(aba Ferramentas) e a integração com o ERP. O MCP ficou de fora, como pedido.

Como foi feito:
- leitura do código do motor, das telas e do núcleo geométrico;
- testes novos no Chromium (Playwright) usando o pacote de teste e clicando como o usuário;
- medições no Node com o mesmo código do motor;
- cobertura de JS do `app.js` medida com todas as abas e o gerador em uso.

Base de comparação, antes desta auditoria:
- testes unitários: 280/280 passando;
- E2E: 153/153 passando.

**Nível de evidência de cada achado:**
- **PROVADO**: reproduzido com teste, com o número medido.
- **CÓDIGO**: visto na leitura do código, sem reprodução.
- **NÃO CONFIRMADO**: hipótese; está em L.

Nada foi alterado no sistema. Este arquivo é o único acréscimo.

As correções vieram depois, em 5 partes; o que foi feito e o que ficou está em
**[M. Status das correções](#m-status-das-correções)**, no fim.

---

## A. Resumo executivo

**Estado geral.** O caminho feliz funciona e está bem coberto: 153 passos E2E cobrem quase
toda ferramenta. Os problemas reais estão em quatro lugares.

**1. Segurança: um arquivo 3D pode rodar código dentro do ERP (CRÍTICO, PROVADO).**
- O nome da peça que vem dentro do 3MF/OBJ é escrito na tela com `innerHTML`.
- Um 3MF baixado da internet, com o nome `<img src=x onerror=…>`, executou código só de ser aberto.
- A CSP de produção permite script inline, então isso também roda no site publicado.
- O token de login do Supabase fica no `localStorage`, ao alcance desse código.

**2. Corridas: mexer durante um cálculo grava o resultado no lugar errado (ALTO, PROVADO).**
- Cortar e apertar Ctrl+Z enquanto calcula: na confirmação, **some outro objeto da mesa** e
  o objeto cortado fica duplicado.
- Consertar e apertar Ctrl+Z enquanto calcula: aparece "Malha reparada" e **nada muda**.
- Duplo clique em Consertar roda **dois consertos** seguidos. Num modelo grande isso dobra o tempo
  e a barra mostra "peça 1 de 4" duas vezes. É provável que seja o "reseta, volta" que você viu.

**3. Laudo e conserto não falam a mesma língua (ALTO, PROVADO).** É a sua queixa "identifica
erros que ele mesmo não corrige".
- O conserto solda vértices com tolerância 10× maior que a do laudo. Por isso "conserta" malha perfeita.
- Peças que se encostam por uma aresta nunca estabilizam: cada clique diz "soldou / separou"
  e cria uma entrada de desfazer.
- "Espessura mínima 0,00 mm" sai falso de dois jeitos:
  - o raio bate em outra casca sobreposta (dois cubos de 10 mm deram 0,001 mm);
  - o raio bate na face vizinha de uma dobra (a cabeça de IA deu 0,0002 mm por causa de uma única face).

**4. Recursos para modelo grande (ALTO, PROVADO).**
- O histórico guarda 40 passos contados por quantidade, não por tamanho.
- Com 1,3 M triângulos, cada operação somou +45 MB que nunca voltam (266 → 625 MB em 8 passos).
  No action figure (3,7 M) a aba tende a cair.
- Se a sessão do login expira, a única saída é recarregar, e **todo o trabalho do Estúdio se perde**:
  não há aviso nem salvamento.

**Maiores oportunidades:**
- **Correção da segurança:** escapar nomes nos 17 pontos de `innerHTML` (pequeno, crítico).
- **Uma trava de "operação em andamento":**
  - conferir, na hora de aplicar, se a peça ainda é a mesma;
  - desabilitar o botão enquanto calcula;
  - isso fecha todas as corridas de uma vez.
- **Uma regra só para:**
  - tolerâncias de solda e de face degenerada;
  - "está pronto pra imprimir?" — hoje são 4 regras diferentes.
- **Remover o gerador antigo** que sobrou no `app.js`: 171 KB, 21% do arquivo, que todo usuário
  do ERP baixa e que **não roda mais** (cobertura: 353 de 3.917 linhas, só declarações).
- **Diagnóstico:** hoje erro do motor chega sem pilha, sem nome da operação e sem registro.
  Quem descobre a falha é a impressora.

---

## B. Inventário das ferramentas

Legenda E2E = coberto pelos 153 passos que passam.

**Estúdio 3D**

| Ferramenta | Estado | Problemas | Duplicada? | Observações |
|---|---|---|---|---|
| Abrir STL / OBJ / 3MF | Parcialmente funcionando | S1 (XSS por nome), M1 (aviso some), M4 (STL truncado), B2 (OBJ índice) | — | Arquivo vazio/lixo/zip sem modelo: mensagem certa (PROVADO) |
| Conferir (laudo) | Parcialmente funcionando | A5, A6 (espessura falsa), M3 (4 regras), M6 (lento com muitas cascas) | — | Roda sozinho no worker auxiliar ao abrir (OK) |
| Consertar automaticamente | Parcialmente funcionando | A2, A3, A5, A7, M6 | — | Geometria do conserto é boa; o problema é estado/relato |
| Unir partes sobrepostas | Duplicada | M8 | Sim (Consertar já faz `unirCascas`) | Aparece justo quando o Consertar não conseguiu — vai falhar igual |
| Remover sobras internas | Funcionando | — | Parcial (Consertar une; Preparar apaga) | Mesmo resultado geométrico por 2 caminhos |
| Converter unidade | Funcionando | sem try/catch (B6) | — | — |
| Modos: defeitos / cascas / espessura / partes | Funcionando | M5 (trava a tela a cada edição em modelo grande) | — | — |
| Preparar pra imprimir | Funcionando (E2E) | herda A6; botão não trava; analisa 3× em modelo grande | — | — |
| Formas (biblioteca, medidas, sólido/furo) | Funcionando (E2E) | — | — | — |
| Furo ao vivo | Parcialmente funcionando | M7 (abrir painel aplica furos sozinho), B5 (prévia falha calada) | — | — |
| Unir / Tirar / Parte comum | Funcionando (E2E) | — | `booleana` no motor duplica `combinar` (morta) | — |
| Agrupar (barra) / Juntar (lista) | Duplicada | M9 | Sim — "Juntar" = agrupar TODAS, ignora a seleção | "Juntar" soa como união booleana |
| Alinhar, Duplicar em série | Funcionando (E2E) | — | — | — |
| Modificar: arredondar, chanfrar, puxar face, oca, espelhar | Funcionando (E2E) | XSS indireto em mensagem de erro (S1) | — | — |
| Esculpir (pincéis, simetria, vincar, detalhe) | Funcionando (E2E) | — | — | — |
| Deformar / Suavizar | Funcionando (E2E) | — | — | — |
| Desenhar (contorno, giro, tubo, curva 3D, editar) | Funcionando (E2E) | — | — | — |
| Ajustar (mm, girar, deitar, cor, placa, espelhar) | Funcionando (E2E) | Espelhar fica na matriz do 3MF: não validado no Bambu (L) | — | — |
| Selecionar (região, pincel, casca, cor, partes) | Funcionando (E2E) | S1 (é aqui que o código roda ao abrir) | — | — |
| Separar detalhe (+ pino) | Parcialmente funcionando | A1 (corrida duplica o detalhe) | — | — |
| Separar por cor | Funcionando (E2E) | — | — | — |
| Separar cascas soltas | Funcionando | M6 (quadrático) | — | — |
| Cortar (plano e parte, conectores) | Parcialmente funcionando | **A1 (corrida apaga outro objeto)** | — | — |
| Texto / logo / relevo (frente, verso, quina, envolver) | Funcionando (E2E) | S1 em mensagens de erro | — | — |
| Exportar 3MF / por placa / STL | Funcionando (E2E) | B3 (STL duplo = 2 downloads), B4 (aviso por nome), L | — | — |
| Desfazer / Refazer | Funcionando | A4 (memória), causa das corridas A1 | — | — |
| Cancelar cálculo | Funcionando (E2E) | — | — | — |
| Organizar mesa / Placas | Funcionando (E2E) | — | — | — |
| Menu botão direito, lista de objetos | Funcionando (E2E) | — | — | — |
| Início / sugestões / bolinha "Pronto pra imprimir" | Parcialmente funcionando | M3 (regra diferente do laudo) | — | — |
| Modo sem worker ("modo simples") | Não foi possível validar | só entra se o navegador recusar Worker | — | Custa ~380 KB do motor duplicado na tela |

**Gerador de chaveiros**

| Ferramenta | Estado | Problemas | Duplicada? | Observações |
|---|---|---|---|---|
| Logo PNG/JPG/SVG, nome, forma, QR | Funcionando (E2E) | — | Sim: gerador ANTIGO inteiro dentro do `app.js` | — |
| Pôster / Litofania | Funcionando (E2E) | — | — | — |
| AMS / sem AMS + pausas no fatiado | Funcionando (E2E) | — | — | MD5 do G-code é refeito (OK) |
| Bolso NFC, argola | Funcionando (E2E) | — | — | — |
| 3MF / STL / SVG / Abrir no Estúdio | Funcionando (E2E) | — | — | Cores não se sobrepõem (0 mm³ nas 10 logos) e Consertar não muda o chaveiro (PROVADO) |

**Restos e partes fora da produção**

| Item | Estado | Observações |
|---|---|---|
| Gerador antigo no `app.js` (linhas 8776–13008: MALHA, TREIMF, GEO, MODELOS, FER, cópia do earcut) | Obsoleta / Não utilizada | 9% das linhas rodam (só declaração). Só o MCP e o `tools/bench-chaveiro.mjs` recortam código dele |
| `Estudio3D.pecasDoGerador / abrirDoGerador / exportar3MFGerador / exportarSTLGerador` (`entrada.js`) e `core/pecasGerador.js` | Não utilizada no site | Só o gerador antigo (morto) chama |
| Operações `booleana`, `espessura`, `medidas` | Não utilizada | `medidas` só no E2E |
| 14 exports sem uso (`clonar`, `menorAresta`, `heOrigem`…) | Não utilizada | O build já descarta |
| Laboratório Fotos→3D | Só no pacote de teste | Não auditado a fundo |
| `servidor-ia` (Python/GPU) | Não foi possível validar | Fora do site |

---

## C. Bugs encontrados

### Crítico

**S1 — Arquivo 3D executa código no ERP (XSS pelo nome da peça)** · PROVADO
- **Onde:** `ui/secoes/selecionar.js:214` (roda ao abrir), `diagnostico.js:160`
  (`x.nome` no "Reparo:"), `separar.js:59` e `:119`. Também por mensagem de erro e aviso com o
  nome dentro: `exportar.js:77`, `cortar.js:205/207/244/288/303`, `relevo.js:132/162`,
  `modificar.js:240`, `esculpir.js:141/168`, `diagnostico.js:47`.
- **Por quê:** nome de objeto e de peça vem do arquivo (3MF `name=`, OBJ `o`/`g`) e vai para
  `innerHTML` sem `esc()`. A CSP (`site/_headers`) tem `script-src 'unsafe-inline'`, então
  `onerror=` roda também em produção.
- **Reproduzir:** 3MF com a peça chamada `<img src=x onerror="window.__xss=1">`. Resultado medido:
  - ao abrir: `__xss=1`;
  - depois de Consertar: 3;
  - depois de selecionar uma face: 4.
- **Impacto:** quem abre um modelo da internet entrega a sessão do ERP. O token do Supabase fica
  no `localStorage` (padrão do supabase-js); o código injetado lê e altera clientes, vendas e
  financeiro com o perfil do usuário.
- **Causa:** HTML montado por concatenação.
- **Correção:**
  - trocar por `el(...)`/`textContent` (o `el()` já existe e é seguro) ou passar `esc()` em todo
    texto dinâmico;
  - erros e avisos do motor viram texto, nunca HTML.
- **Risco de regressão:** baixo (só muda como o texto entra).
- **Testar:** novo E2E no molde do `tests/e2e/xss.mjs`. Abrir 3MF e OBJ com nome malicioso,
  rodar Conferir, Consertar, Selecionar, Separar, Cortar com erro e Exportar; `__xss` tem que
  ficar indefinido.

### Alto

**A1 — Cortar/Separar + Desfazer durante o cálculo: apaga outro objeto ou duplica** · PROVADO
- **Onde:** `cortar.js:308-313` e `:260-264` (`splice(indexOf(o), 1, …)`); `separar.js:110-113`
  e `:162-166`.
- **Reproduzir:**
  1. Mesa com "bola" e "cubo".
  2. Cortar a bola com pino.
  3. Apertar Ctrl+Z enquanto aparece "Cortando…".
  4. Confirmar a prévia.
- **Medido:** antes `[bola, cubo]`, depois `[bola, bola A, bola B]`. O **cubo sumiu** e a bola
  original continua lá.
- **Causa:** a tela guarda o objeto `o` antes do `await`. O Desfazer troca `cena.objetos` por
  cópias, então `indexOf(o) = -1` e `splice(-1, 1, …)` apaga o **último** objeto da mesa.
- **Impacto:**
  - perde peça sem aviso (o Ctrl+Z recupera, se o usuário perceber);
  - gera geometria duplicada que vai para o 3MF.
- **Correção:**
  - ao confirmar, buscar o objeto pelo `id` e conferir que as malhas das peças ainda são as
    mesmas do início; se não, descartar o resultado com o aviso "A peça mudou enquanto
    calculava — faça de novo";
  - (melhor ainda) o Ctrl+Z durante uma operação cancela a operação.
- **Risco:** baixo.
- **Testar:** o mesmo roteiro (`d2-corrida.mjs`) vira E2E: o cubo continua e não há duplicata.

**A2 — Consertar + Desfazer durante: "Malha reparada" e nada muda** · PROVADO
- **Onde:** `diagnostico.js:58-82` (`reparar` guarda `o` e grava em `o.partes` depois do `await`).
- **Medido:**
  - o aviso diz "Malha reparada (dá pra desfazer)";
  - o histórico ganha "Reparar malha";
  - a bola continua aberta (81.917 triângulos, igual a antes).
- **Impacto:** operação dada como concluída que não aconteceu. O usuário imprime a malha estragada.
- **Correção / teste:** os mesmos do A1. O padrão se repete em ~35 pontos que esperam o motor;
  só 2 conferem se a peça mudou (`formas.js:100` e `estudio.js:1037`).

**A3 — Duplo clique em Consertar roda dois consertos** · PROVADO
- **Onde:** `diagnostico.js:178`. O botão não desabilita, não há trava, e `est.lote` é
  compartilhado entre os dois laços.
- **Medido:** 2 consertos na fila e 2 entradas "Reparar malha".
- **Impacto:**
  - no action figure, que leva minutos por peça, dobra o tempo;
  - a barra mostra "peça 1 de 4… peça 1 de 4" (provável "reseta, volta").
- **Correção:** desabilitar o botão até acabar e ignorar o clique se já houver conserto daquele
  objeto em andamento. O mesmo vale para STL (B3), Preparar e Unir.
- **Testar:** duplo clique → 1 conserto, 1 entrada no histórico.

**A4 — Histórico sem limite de memória** · PROVADO
- **Onde:** `cena.js:78` (`limite = 40`, por quantidade). Cada passo guarda a malha inteira
  (`pos` Float64 + `idx` Uint32) e mais o cache de vértices usados.
- **Medido (1,3 M triângulos):**
  - aberto: 266 MB de buffers e 904 MB de RSS da aba;
  - 8 escalas: 625 MB (+45 MB por passo, nunca volta).
- **Impacto:** no 3,7 M (≈90 MB por malha nova a cada Consertar ou Suavizar), dezenas de passos
  dão vários GB e a aba cai, levando o trabalho junto.
- **Correção:** limitar o histórico por bytes (ex.: 600 MB), descartando os passos mais antigos,
  e avisar "histórico reduzido por causa do tamanho do modelo".
- **Risco:** baixo.
- **Testar:** repetir o `d3b-memoria.mjs`: a memória fica estável depois do teto.

**A5 — Consertar relata consertos que não existem e nunca estabiliza** · PROVADO
- **Onde:** `reparo.js:459` (`tolSolda = 1e-6·diagonal`) contra `validador.js:221`
  (`verticesDuplicados` com `1e-7·diagonal`). Mais a junção de cascas que só se encostam por
  aresta ou ponto.
- **Medido:**
  - Base do chaveiro "texto-fino" do próprio gerador:
    - o laudo diz 0 degeneradas, 0 vértices duplicados e "imprimível";
    - o Consertar diz "soldou 2 vértices, removeu 4 faces degeneradas".
  - Dois cubos encostados por uma aresta:
    - toda vez o conserto diz "soldou 2 / separou 2 pontos non-manifold";
    - a malha não muda;
    - o laudo continua com "Vértices duplicados 2";
    - cada clique cria um desfazer e mostra "Malha reparada".
- **Impacto:**
  - o usuário não consegue confiar no laudo — é exatamente o "113 vértices duplicados" que sobrou
    no action figure;
  - histórico poluído.
- **Causa:** duas tolerâncias diferentes para a mesma coisa. Além disso, vértice repetido entre
  cascas fechadas que só se tocam é saída correta, mas o laudo mostra como "atenção".
- **Correção:**
  - um único módulo de tolerâncias, usado pelo laudo e pelo conserto;
  - o conserto só diz "consertou" (e só cria desfazer) se o laudo de depois tiver menos defeito
    que o de antes;
  - vértice coincidente entre cascas fechadas diferentes vira informação, não atenção.
- **Risco:** médio (mexe no núcleo). Os testes de reparo atuais (`tests/reparo.test.mjs`) cobrem.
- **Testar:**
  - Consertar 2× em qualquer peça: na 2ª, "Nada pra consertar" e nenhum desfazer novo;
  - chaveiro do gerador: "Nada pra consertar".

**A6 — "Espessura mínima" e "Partes finas" falsos (0,00 mm)** · PROVADO
- **Onde:** `validador.js:143` (`espessuras`). O raio sai para dentro da face e aceita a primeira
  face "de saída" de qualquer casca, inclusive a vizinha de aresta.
- **Medido:**
  - dois cubos de 10 mm sobrepostos 0,001 mm: "0,001 mm" e 2 regiões críticas (o sólido tem 10 mm);
  - cabeça de IA consertada: "0,0002 mm" por **uma** face cuja vizinha (2 vértices em comum) faz
    dobra.
- **Impacto:**
  - alarme falso em três telas (laudo, Início e Preparar pra imprimir): "Parte fina 0,00 mm";
  - o usuário perde tempo procurando parede fina que não existe — e para de ler os avisos
    verdadeiros.
- **Correção:**
  - ignorar acerto em face que divide vértice com a de origem;
  - com cascas se cruzando, medir por casca ou avisar "medida não confiável enquanto houver
    cruzamento";
  - "Regiões críticas" só a partir de uma área mínima (ex.: 0,5 mm²).
- **Risco:** baixo.
- **Testar:** os dois casos acima voltam 10 mm / espessura real; o teste da caixa de 4 mm
  continua 4 mm.

**A7 — Consertar várias peças: uma falha joga fora as que deram certo** · CÓDIGO
- **Onde:** `diagnostico.js:68` (`catch (e) { return; }` dentro do laço).
- **Impacto:** num modelo de 6 cores, se a 5ª peça falha depois de 10 minutos, as 4 primeiras
  consertadas se perdem e só aparece o erro da 5ª.
- **Correção:** aplicar as que deram certo e listar "Peça X: não consegui consertar (motivo)".
- **Testar:** peça que force erro no meio do lote (teste unitário com motor falso).

**A8 — Sessão encerrada apaga o trabalho do Estúdio** · CÓDIGO
- **Onde:** `cloud.js:377`. Em `SIGNED_OUT` a tela some e o único botão é "Entrar", que chama
  `location.reload()`. O Estúdio não salva nada (não há `beforeunload`, `localStorage` nem
  `IndexedDB` em `src/`).
- **Impacto:** a sessão expira, ou alguém sai em outra aba, e uma hora de corte/separação se perde
  sem chance de exportar. F5 ou fechar a aba sem querer: idem.
- **Correção:**
  - `beforeunload` quando houver objeto na mesa;
  - no bloqueio de sessão, um botão "Baixar 3MF do Estúdio antes" (o Estúdio não depende da nuvem);
  - (longo prazo) salvamento automático da cena no `IndexedDB`.
- **Testar:** simular `SIGNED_OUT` no E2E de nuvem com peça na mesa.

**A9 — Erro do motor sem diagnóstico** · PROVADO
- **Onde:**
  - `worker.js:41` manda só `e.message` (sem pilha, sem operação, sem tamanho);
  - não há `window.onerror` nem `unhandledrejection`;
  - o bundle é minificado e sem sourcemap.
- **Medido:** o console mostra `at r.onmessage (estudio3d.js:4282:737747)`, que não diz nada.
  As rejeições de `unirSobrepostos`, `removerInternos` e `converterUnidade` (sem try/catch) vão só
  para o console.
- **Impacto:** quando algo dá errado numa peça do cliente, não há como saber o quê nem onde.
- **Correção:** ver J/K (registro em memória + "Copiar diagnóstico").

### Médio e baixo (resumo)

| Sev. | Problema | Local | Impacto | Causa | Correção |
|---|---|---|---|---|---|
| Médio | **M1** Aviso de importação some (ficou **0 ms** na tela, PROVADO). Só o 1º aviso é mostrado | `diagnostico.js:184` + `estudio.js:1168` | "Peça X é suporte e ficou de fora", "índices inválidos", "unidade desconhecida" passam despercebidos | Toast único de 2,2 s; o "N triângulos" vem logo depois e cobre | Avisos de importação numa nota fixa no painel Consertar (todos) |
| Médio | **M2** Corridas em todo o resto: ~35 pontos esperam o motor e aplicam em referência guardada | `secoes/*.js` | Mesma família de A1/A2 (texto, modificar, esculpir, preparar) | Sem "geração" da peça | Helper único `aplicarSeAindaFor(objId, parteId, malha, fn)` |
| Médio | **M3** Quatro regras de "pronto pra imprimir" | `validador.js:283`, `diagnostico.js:155`, `sugestoes.js:18`, `preparar.js:59` | Bolinha diz "Pronto pra imprimir" com face degenerada enquanto o laudo diz "pontos de atenção" | Cada tela conta defeito do seu jeito | Uma função `avaliarImpressao(rel)` usada por todas |
| Médio | **M4** STL binário truncado (download incompleto) abre com "não tem nenhum triângulo" (PROVADO) | `stl.js:14` (`ehBinario`) | Mensagem errada; o arquivo parcial poderia abrir | Tamanho não bate e o arquivo cai na leitura de texto | Detectar binário pelo cabeçalho e ler o que tiver + aviso "arquivo incompleto" |
| Médio | **M5** Modos de análise recalculam na tela a cada edição (PROVADO, 1,3 M tri) | `estudio.js:604` → `recalcularMapas` | Mover 1 mm trava 402 ms (defeitos), 741 ms (cascas), 282 ms (espessura); ≈1–2 s no 3,7 M | O mapa depende só da malha, mas é refeito a cada mudança de posição | Guardar mapa por malha (`WeakMap`) |
| Médio | **M6** Muitas cascas = tempo ao quadrado (PROVADO) | `malha.js:163` (`subMalha` aloca array do tamanho de todos os vértices por casca) | Boneco "sujo" 80 mil tri: **60,7 s parado em "Conferindo a malha 2%"**; 1.000→8.000 cascas: 96→1.341 ms | O(cascas × vértices) em `validar`, `reparar`, `unirCascas`, `separarCascas`, `separarCor` | Mapa reaproveitado, limpando só os vértices tocados |
| Médio | **M7** Abrir Selecionar/Separar/Cortar/Texto/Consertar aplica os furos na geometria sozinho | `estudio.js:1070-1077` | Efeito colateral sem pedir (cria desfazer, some o objeto-furo); assíncrono, corre com a operação seguinte | Atalho para as ferramentas verem a peça furada | Perguntar ("Aplicar os furos antes?") ou aplicar só ao executar a ferramenta |
| Médio | **M8** "Unir partes sobrepostas" repete o Consertar | `diagnostico.js:163` | Botão que aparece justo quando o Consertar falhou; vai falhar igual | Duas portas para `unirCascas` | Tirar o botão; no lugar, "Ver onde se cruza" (já existe) |
| Médio | **M9** "Juntar" (lista) × "Agrupar" (barra) × "Unir" | `estudio.js:749` e `:1002` | "Juntar" agrupa **todos** os objetos visíveis, ignorando a seleção; nome sugere união | — | Um "Agrupar" só, que respeita a seleção |
| Médio | **M10** Gerador antigo morto no `app.js` | `app.js:8776-13008` | 171 KB (21%) baixados e lidos em toda página do ERP; dois geradores para manter; o MCP diz usar "o mesmo código da tela" (falso) | Migração para `src/gerador` não removeu o antigo | Passar MCP e bench para `src/gerador` e então apagar o bloco |
| Baixo | **B1** Mensagens mandam usar "Analisar e reparar", botão que não existe | `solidos.js:66`, `separar.js:663`, `preparo.js:17`, `worker.js:39`, `LEIA-ME.txt:439` | Usuário procura botão inexistente | Nome antigo | "Consertar automaticamente (painel Consertar)" |
| Baixo | **B2** OBJ com índice inválido: face pulada calada; quadrilátero com 1 índice ruim vira triângulo errado | `obj.js:57` | Geometria errada sem aviso | `continue` | Descartar a face inteira e avisar quantas |
| Baixo | **B3** Duplo clique em "Baixar STL" = 2 downloads (PROVADO) | `exportar.js:101` | Arquivo duplicado | Botão não trava | Igual ao A3 |
| Baixo | **B4** Aviso "abaixo da mesa" procura objeto pelo **nome** | `exportar.js:70` | Nome repetido pega o objeto errado | — | Usar o próprio objeto |
| Baixo | **B5** Prévia de furo que falha mostra a peça sem furo, sem aviso | `estudio.js:1036` | Usuário acha que o furo não encosta | `catch → null` | Marcar o objeto-furo com "não consegui furar aqui" |
| Baixo | **B6** `unirSobrepostos`, `removerInternos`, `converterUnidade` sem try/catch | `diagnostico.js:84-112` | Rejeição solta no console | — | try/catch como no `reparar` |
| Baixo | **B7** Nomes da caixa "calculando" só para 14 operações | `estudio.js:61` | Combinar, forma, desenho, modificar, cortar parte… mostram "Calculando…" | Lista incompleta | Completar `NOMES_OP` |
| Baixo | **B8** Erro fatal no worker depois de pronto não rejeita a fila | `cliente.js:76` | Carregando infinito (teórico; não reproduzi) | `onerror` só antes do `pronto` | Rejeitar a fila e reiniciar o canal em qualquer `onerror`/`onmessageerror` |
| Baixo | **B9** 3MF: descompacta todas as entradas (G-code, imagens) sem filtro | `zip.js:6` | Abrir `.gcode.3mf` grande gasta memória à toa | `unzipSync` sem `filter` | Filtrar para `.model`, `.rels`, `.config` |
| Baixo | **B10** Gerador entrega base com faces degeneradas (o Consertar remove 4–8) | `src/gerador` | Laudo do gerador × Consertar divergem (ver A5) | Restos do Manifold | Some com o A5 (tolerância única) |

---

## D. Erros silenciosos

Falhas que acontecem sem o usuário ser informado corretamente:

1. **A2** — "Malha reparada" sem ter reparado (Desfazer durante o conserto). PROVADO.
2. **A1** — objeto apagado ao confirmar um corte depois de um Desfazer. PROVADO.
3. **A5** — "Malha reparada" e entrada de desfazer em malha que não mudou. PROVADO.
4. **A7** — lote de conserto descartado por uma peça só. CÓDIGO.
5. **M1** — avisos de importação cobertos pelo toast seguinte (0 ms). PROVADO.
6. **B2** — face de OBJ descartada sem aviso. CÓDIGO.
7. **B5** — falha da prévia de furo vira "peça sem furo". CÓDIGO.
8. **`importarArquivos`** — `catch (e) { /* já avisado */ }` em `estudio.js:1169` também engole erro
   que não veio do motor (`lerArquivo`, `adicionarObjetos`): o arquivo não abre e nada aparece.
   CÓDIGO.
9. **B6 / A9** — rejeições sem tratamento: só no console, sem pilha útil. PROVADO.
10. **Cena.aplicar** (`cena.js:153`): se a função lançar no meio, o estado fica pela metade, sem
    desfazer e sem redesenho. CÓDIGO.
11. **"Todas as placas"** (`exportar.js:88-93`): vários downloads seguidos. O Chrome pode bloquear
    do 2º em diante enquanto a tela diz "N arquivo(s)". NÃO CONFIRMADO (ver L).
12. **Gerador antigo** (morto): `ferBaixarSTL` cai para o "caminho antigo" com `console.warn`, e
    `pecasDoGerador` engole falha de união com `console.warn`. Hoje não roda no site; volta a
    valer se alguém religar.

---

## E. Duplicações e redundâncias

| O quê | Onde | Proposta |
|---|---|---|
| **Dois geradores de chaveiro** | `app.js:8776-13008` (antigo, morto no site) × `src/gerador` (novo) | Migrar MCP/bench para `src/gerador` e apagar o antigo (−171 KB em toda página do ERP) |
| Dois reparos de malha, dois escritores de 3MF, duas cópias do earcut | `app.js` MALHA/TREIMF/EARCUT × `core/reparo.js`, `formatos/tmf.js`, `earcut` (npm) | Somem junto com o item acima (TREIMF tem 0 referências) |
| Ponte do gerador antigo | `entrada.js` (`pecasDoGerador`, `abrirDoGerador`, `exportar3MFGerador`, `exportarSTLGerador`) + `core/pecasGerador.js` | Remover com o gerador antigo |
| `booleana` × `combinar` | `operacoes.js:208` × `:222` | Remover `booleana` (ninguém chama) |
| "Unir partes sobrepostas" × Consertar | `diagnostico.js:84` | Tirar o botão (M8) |
| "Remover sobras internas" (apaga) × Consertar (une) × Preparar (apaga) | — | Um caminho: o Consertar já resolve |
| Juntar × Agrupar | lista × barra | Um "Agrupar" (M9) |
| 4 regras de "imprimível" | validador, laudo, Início, Preparar | Uma função (M3) |
| 2 tolerâncias de solda, 2 critérios de degenerada | `reparo.js` × `validador.js` | Um módulo de tolerâncias (A5) |
| Motor inteiro na tela e no worker | ~380 KB na tela só para o "modo simples" | Carregar o motor da tela só se o worker falhar (import dinâmico) |
| Operações sem uso: `espessura`, `medidas`; 14 exports mortos | `operacoes.js`, núcleo | Apagar |

---

## F. Problemas arquiteturais (separados dos bugs)

1. **Sem "operação em andamento" central.**
   - Cada painel guarda referências e aplica depois do `await`.
   - A cena não tem versão ou geração; Desfazer e Refazer trocam os objetos por cópias.
   - É a raiz de A1, A2 e M2.
   - Proposta: o `est.rodar` devolve uma "ficha" (objeto, peça e malha do início), e o
     `cena.aplicar` recusa ficha vencida. Um lugar só, em vez de 35.
2. **HTML montado por concatenação em ~30 lugares**, com `esc()` existindo e pouco usado. É a raiz
   do S1. Proposta: regra de projeto "dado nunca entra em `innerHTML`" mais um teste que procura o
   padrão.
3. **Regras de negócio da impressão espalhadas:** tolerâncias, "imprimível", "parte fina" e
   "defeito" vivem em 4–5 arquivos com números diferentes (A5, M3, A6).
4. **Histórico contado em passos, não em memória** (A4). Para modelo grande o certo é orçamento em
   bytes.
5. **Acoplamento por variáveis globais:** `gerador.js` chama `window.ferModoFerramentas` (do
   `app.js`); a tela depende de `window.toast`, `window.MenuContexto`, `window.Estudio3D`. Funciona,
   mas é contrato invisível — quem mexe no `app.js` quebra o 3D sem saber.
6. **Monólito `app.js` de 13 mil linhas**, com 21% de código morto do 3D dentro.
7. **Cópia completa da malha a cada operação** (`cliente.js:84`, `copiarArrays`). O worker não
   guarda as malhas, então cada análise, conserto, BVH ou adjacência copia tudo (≈90 MB no 3,7 M)
   na thread da tela. Proposta (longo prazo): o worker guarda a malha por id e a tela manda só o id.

---

## G. Problemas de UX

1. **O laudo não é confiável** (A5, A6, M3): o usuário vê "consertado" e "atenção" ao mesmo tempo.
   Quando o próprio conserto deixa uma coisa, o laudo devia dizer que é normal e por quê (ex.:
   "113 vértices em comum entre peças que se tocam — normal").
2. **Botões que não travam durante o cálculo** (A3, B3): Consertar, STL, Preparar, Unir. Num
   modelo grande o usuário clica de novo achando que não pegou.
3. **Avisos que somem** (M1): um toast só, por 2,2 s, e um cobre o outro. Coisa importante tem
   que ficar no painel.
4. **Trabalho perdido** (A8): sem aviso ao fechar, sem salvamento, e a sessão expirada obriga a
   recarregar.
5. **Ações durante cálculo não são impedidas nem explicadas** (A1/A2): Ctrl+Z, Excluir e mover
   funcionam no meio de um corte. Ou bloqueia, ou cancela a operação, ou avisa.
6. **Efeito colateral ao abrir um painel** (M7).
7. **Nomes confusos:**
   - "Juntar" × "Agrupar" × "Unir" (M9);
   - mensagens com "Analisar e reparar" (B1);
   - "Objetos desconectados" no laudo × "Cascas soltas" no manual.
8. **Modelo grande trava a tela nos modos de análise** (M5), e o manual diz "a tela não trava".
9. **Conserto de modelo muito grande sem estimativa de tempo:** a barra mexe por etapa, mas o
   "2% Conferindo a malha" pode ficar parado 60 s em malha com muitas cascas (M6).
10. **Positivo, e deve ficar como está:** prévia antes de confirmar, desfazer em tudo, alerta
    "Saiu SEM conector", cancelar, etapa e porcentagem na barra, menu do botão direito.

---

## H. Performance

| Gargalo | Medido | Impacto provável | Vale otimizar? |
|---|---|---|---|
| Histórico por quantidade (A4) | +45 MB por passo (1,3 M tri) | Aba cai no modelo grande | **Sim, alto** |
| `subMalha` por casca (M6) | 60,7 s parado no boneco "sujo"; ×14 de tempo para ×8 de cascas | Modelo de IA com milhares de fragmentos fica minutos em "Conferindo" | **Sim** (correção de ~10 linhas) |
| Mapas de análise refeitos ao mover (M5) | 282–741 ms por edição (1,3 M) | Tela "engasga" com o modo Defeitos/Espessura ligado | **Sim** (cache simples) |
| Gerador antigo no `app.js` (M10) | 171 KB de 801 KB | Todo usuário do ERP baixa e analisa em toda carga | Sim (médio) |
| Cópia da malha a cada operação | ≈2× a malha na thread da tela por chamada; abrir 400 MB = pico ~800 MB | Pausas de ~50–100 ms e picos de memória | Médio prazo |
| Motor duplicado na tela | ~380 KB (núcleo 239, gerador 82, Manifold JS 43, IA 12) | Carga da aba Ferramentas | Baixo |
| Recolorir tudo a cada mudança (`sincronizar` → `pintar`) | 17 ms de JS para 1,3 M; o envio para a placa depende da GPU | Pequeno | Baixo |
| Conserto de modelo limpo de 1,3 M tri | 20 s, com barra andando | OK | — |
| 6.000 cascas (72 mil tri) | laudo 6,2 s; conserto 7,9 s | OK | — |
| Bundle 3D | 2,6 MB (three 649 KB, tela 308 KB, núcleo 239 KB, WASM 705 KB em base64, worker 552 KB). Só carrega ao abrir Ferramentas | OK | — |
| `npm audit` | 0 vulnerabilidades | — | — |

---

## I. Segurança

| Risco | Evidência | Severidade |
|---|---|---|
| **S1: XSS por arquivo 3D** (nome de peça/objeto no `innerHTML`), executável em produção (`unsafe-inline`), sessão no `localStorage` | PROVADO (`__xss` 1 → 3 → 4) | **Crítico** |
| CSP com `script-src 'unsafe-inline' 'unsafe-eval'` | CÓDIGO (`_headers`). Hoje é necessário: 19 `onclick=` no `index.html`, ~39 no `app.js`, 1 script inline. Reduz a defesa de qualquer XSS | Médio (longo prazo) |
| Mensagens de erro e avisos com nome da peça vão para `innerHTML` | CÓDIGO (lista no S1) | Parte do S1 |
| Arquivo malformado: vazio, lixo, zip sem modelo, XML com índice inválido | PROVADO: mensagem certa, sem travar | OK |
| Zip enorme (`.gcode.3mf`) | 600 MB descompactados em 1,4 s no Node; no navegador é pico de memória (B9) | Baixo |
| SVG da logo | Vai por `<img>`/canvas (sem script) e pelo leitor próprio de XML | OK (leitura) |
| Chaves / segredos | Nenhuma chave no código do 3D. O token do servidor de IA só vai se configurado, e o laboratório não está em produção. `config.js` só com chaves públicas | OK |
| Dependências | `npm audit`: 0 | OK |

---

## J. Plano de ação (ordem por impacto e risco)

1. **Correções críticas**
   1. S1 — escapar ou trocar `innerHTML` nos pontos listados, e E2E com 3MF/OBJ malicioso.
2. **Alta prioridade**
   1. Ficha de operação + `aplicar` que recusa resultado vencido (A1, A2, M2).
   2. Travar botões durante a operação (A3, B3).
   3. Tolerância única e "consertou só se melhorou" (A5, B10); vértice entre cascas = informação.
   4. Espessura sem falso alarme (A6).
   5. Lote de conserto aplica o que deu certo (A7).
   6. Histórico com teto de memória (A4).
   7. Não perder trabalho: `beforeunload` e "Baixar 3MF" no bloqueio de sessão (A8).
3. **Média prioridade**
   1. Avisos de importação fixos no painel (M1).
   2. STL truncado abre o que tiver (M4).
   3. Regra única de "pronto pra imprimir" (M3).
   4. Furos sem efeito colateral (M7).
   5. Tirar "Unir partes sobrepostas" (M8).
4. **Melhorias de UX:** "Agrupar" único (M9), nomes e mensagens (B1, B7), Ctrl+Z durante o
   cálculo cancela a operação, laudo explicando o que é normal.
5. **Melhorias arquiteturais:**
   - módulo de tolerâncias;
   - função única de avaliação de impressão;
   - regra "dado não entra em `innerHTML`" com teste;
   - contrato explícito entre `app.js` e `estudio3d.js`.
6. **Otimizações:** `subMalha` (M6), mapas em cache (M5), filtro do zip (B9), motor da tela só se o
   worker falhar.
7. **Observabilidade:**
   - o worker manda `stack`, operação e número de triângulos;
   - `unhandledrejection`/`error` globais com toast e registro;
   - registro em memória das últimas ~50 operações (operação, peça, triângulos, tempo, erro);
   - botão "Copiar diagnóstico" no Estúdio;
   - sourcemap no pacote de teste.
8. **Longo prazo:**
   - apagar o gerador antigo do `app.js` depois de migrar MCP/bench (M10);
   - CSP sem `unsafe-inline` (tirar `onclick=` inline);
   - salvamento automático da cena (`IndexedDB`);
   - worker guardando as malhas (não copiar a cada operação).

---

## K. Quick wins

São mudanças pequenas e com retorno grande:

1. `esc()`/`textContent` nos 17 `innerHTML` com nome ou mensagem — fecha o S1 (crítico).
2. Desabilitar o botão enquanto a operação roda: 1 helper, usado em Consertar, STL, Preparar e Unir.
3. Na confirmação de cortar, separar e consertar, conferir `cena.objeto(id)` e a malha; se mudou,
   descartar com aviso — fecha o "some outro objeto".
4. Usar a mesma `tolSolda` no laudo e no conserto, e só criar desfazer se o defeito diminuiu.
5. Espessura: ignorar a face vizinha (dividem vértice).
6. Teto de memória no histórico.
7. `beforeunload` com objeto na mesa.
8. Mapas de análise em `WeakMap` por malha.
9. `subMalha` com mapa reaproveitado.
10. Avisos de importação no painel; trocar "Analisar e reparar" pelo nome real do botão.
11. Worker enviando `e.stack` + operação; `unhandledrejection` global.

---

## L. Precisa de investigação adicional

| Assunto | Situação | O que falta para confirmar |
|---|---|---|
| Action figure: 82 auto-interseções que sobraram | Não foi possível confirmar com as evidências disponíveis. Não reproduzi com bonecos sintéticos de até 1,9 M tri; já entrou a 2ª passada e o botão "Ver onde se cruza" | O arquivo, ou o print com "Ver onde se cruza" e o texto "Reparo:" do laudo |
| Action figure: "Vértices duplicados 113" e "Espessura 0,00" | Muito provavelmente A5 (vértices entre cascas que se tocam) e A6 (espessura medida contra a casca vizinha / face dobrada); falta o arquivo para ter certeza | Mesmo arquivo |
| Chaveiro do Flamengo descolando com 50% | Não foi possível confirmar. Nas 10 logos de teste (AMS e sem AMS) o Consertar **não muda** o chaveiro (volume, Z mínimo e área na mesa iguais) e as cores **não se sobrepõem** (0 mm³) | O arquivo (ou a imagem do escudo), se foi com AMS ou sem AMS, e se o 3MF saiu do gerador ou do Estúdio |
| "Reseta, volta" no conserto do action figure | Hipótese forte: duplo clique (A3) — dois consertos na fila e a barra voltando para "peça 1" | Confirmar se houve mais de um clique; com o A3 corrigido, não acontece mais |
| Peça espelhada (Ajustar → Espelhar) no Bambu | O 3MF leva a matriz espelhada; não validado no Bambu Studio | Abrir 1 arquivo espelhado no Bambu e conferir a peça |
| "Todas as placas" com vários downloads | O Chrome pode pedir "permitir vários downloads" e barrar do 2º em diante enquanto a tela diz "N arquivos" | Testar no Chrome do usuário com 3 placas |
| Memória real no PC do usuário com 3,7 M tri | Medido 1,3 M no Chromium de teste; o 3,7 M foi extrapolado | Gerenciador de tarefas do Chrome (Shift+Esc) durante o uso |
| Erro fatal do worker depois de pronto (B8) | Lido no código; não consegui provocar | Teste com worker que lança fora do try |
| `servidor-ia` e laboratório Fotos→3D | Fora da produção; não auditados a fundo | Auditoria própria se forem para produção |

---

### Reprodução

Os roteiros usados ficaram fora do repositório. Viram teste de regressão junto com cada correção.

- **No navegador:**
  - `d1-entradas`: arquivos ruins, XSS e avisos;
  - `d2-corrida`: Desfazer no meio, duplo clique;
  - `d3b-memoria`: histórico;
  - `d4-cobertura`: `app.js`;
  - `d5-fragmentos`, `d6-travamento`, `d7-pintar`.
- **No Node:**
  - `x1`/`x2`: espessura e vértices;
  - `x3`: conserto 2×;
  - `x4`: espessura 0,0002;
  - `x5`/`x6`: tempo por casca;
  - `x8`/`x9`: gerador sobreposição e Consertar;
  - `x10`: tolerâncias;
  - `x11`: bundle;
  - `x12`: exports mortos.

---

## M. Status das correções

Feitas em 5 partes, cada uma com teste que falhava antes e passa depois. Commits:
`64476fb` (parte 1), `1248228` (2), `7dda079` (3), `8651230` (4) e o da parte 5.

| Achado | Status | Como | Teste |
|---|---|---|---|
| **S1** XSS pelo nome da peça | Corrigido | `esc()` em todo nome, erro e aviso que entra em `innerHTML` | E2E `xss3d` (3MF e OBJ maliciosos em abrir, consertar, selecionar, separar, exportar) + `seguranca-html.test` (lê o código e falha com dado sem `esc`) |
| **A1, A2, M2** Desfazer/excluir durante o cálculo | Corrigido | "Ficha" da operação (id + malhas + posição); resultado vencido é descartado com aviso; `cena.aplicar` desfaz se der erro no meio | E2E `corrida` (6 passos), `cena.test` |
| **A3, B3** Duplo clique | Corrigido | `umaVez()` trava o botão; Consertar/Preparar com guarda própria | E2E `corrida` |
| **A4** Histórico sem limite | Corrigido | Teto de 400 MB por bytes; passos antigos saem com aviso | `cena.test` |
| **A5, B10** Conserto fantasma | Corrigido | `core/tolerancias.js`: mesma `tolSolda` no laudo e no conserto; só solda vértice de borda; vértice entre cascas = informação | `laudo.test`, E2E `laudo` |
| **A6** Espessura 0,00 falsa | Corrigido | Raio com contagem de entrada/saída, pula a face vizinha, recontagem para fora; região mínima 0,1 mm² (cabeça IA: 0,0002 → 14,7 mm) | `laudo.test` |
| **A7** Lote de conserto | Corrigido | Aplica o que deu certo, lista o que falhou | E2E `corrida` |
| **A8** Sessão encerrada apaga trabalho | Corrigido | `beforeunload` com trabalho não exportado; "Baixar o 3MF do Estúdio 3D antes" no bloqueio de sessão | E2E `trabalho` |
| **A9, B8** Erro sem diagnóstico; worker que quebra fora da operação | Corrigido | Worker manda a pilha; registro das últimas 60 operações; `unhandledrejection`/`error` globais; clique no estado do motor copia o diagnóstico; `onerror` depois de pronto rejeita a fila e reinicia o canal | E2E `diagnostico` |
| **M1** Aviso de importação some | Corrigido | Nota fixa no Consertar até "Entendi" | E2E `laudo` |
| **M3** Quatro regras de "pronto" | Corrigido | `defeitosGraves()` única, usada por laudo, bolinha, Início e Preparar | `laudo.test` |
| **M4** STL truncado | Corrigido | Lê o que veio + aviso; lixo é recusado | `arquivos-ruins.test`, E2E `diagnostico` |
| **M5** Mapas refeitos ao mover | Corrigido | Cache por malha | E2E `trabalho` |
| **M6** Tempo ao quadrado com muitas cascas | Corrigido | `subMalha` com mapa reaproveitado (boneco "sujo": 62,7 s → 2,5 s) | `desempenho.test` |
| **M7** Furos aplicados ao abrir ferramenta | Parcial | A aplicação agora usa a ficha (não corre mais com a operação seguinte) e a prévia que falha avisa (B5). Continua aplicando ao abrir Selecionar/Separar/Cortar/Texto/Consertar, com aviso e desfazer: perguntar antes mudaria o fluxo da tela | — (os E2E de furo que já existiam continuam passando) |
| **M8** "Unir partes sobrepostas" | Corrigido | Botão e operações mortas (`booleana`, `espessura`) removidos | E2E `diagnostico` |
| **M9** Juntar × Agrupar | Corrigido | Um "Agrupar" que respeita a seleção | E2E `diagnostico` |
| **M10** Gerador antigo no `app.js` | **Não feito** | O MCP (`mcp/fonte-site.mjs`) e o `tools/bench-chaveiro.mjs` leem esse código do `app.js`; apagar exige migrar o MCP antes, e o MCP ficou fora deste trabalho | — |
| **B1** "Analisar e reparar" | Corrigido | Mensagens apontam "Consertar automaticamente (painel Consertar)" | `arquivos-ruins.test` |
| **B2** OBJ com índice inválido | Corrigido | Face inteira sai + aviso com a contagem | `arquivos-ruins.test` |
| **B4** "Abaixo da mesa" pelo nome | Corrigido | Usa o próprio objeto | — |
| **B5** Prévia de furo falha calada | Corrigido | Aviso uma vez por situação | — |
| **B6** Sem try/catch | Corrigido | Todos passam por `sozinho()` + `est.rodar` | — |
| **B7** Nomes do "calculando" | Corrigido | `NOMES_OP` cobre todas as operações do Estúdio (fora as internas rápidas: `bvh`, `medidas`, `adjacencia`) | — |
| **B9** 3MF descompacta tudo | Corrigido | Filtro `.model/.rels/.config/.xml` (G-code de 600 MB: 1399 → 6 ms) | `arquivos-ruins.test` |

**Ficou para depois (longo prazo do plano J):** CSP sem `unsafe-inline`, salvamento automático
da cena (IndexedDB), worker guardando as malhas, motor da tela só se o worker falhar, sourcemap
no pacote de teste, Ctrl+Z cancelando a operação em andamento, M10.

**Continua em L (precisa do arquivo do usuário):** action figure (82 auto-interseções) e chaveiro
do Flamengo.

**Testes no fim:** unitários 298/298 (eram 280); E2E __E2E__.


# Fotos → Modelo 3D → Reparo → Edição → Separação → Impressão

Estado em 25/09/2026. Tudo que está marcado **testado** tem teste automático no
repositório; o que está marcado **não testado** está escrito, mas não rodou aqui.

## 1. O que existe e funciona hoje (testado)

| Etapa | Onde | Evidência |
|---|---|---|
| Recorte do fundo (liso ou PNG com alfa), escala por altura em mm, avisos de enquadramento | `src/estudio3d/core/ia/imagens.js`, `prepararVistas` em `reconstrucao.js` | `tests/reconstrucao.test.mjs` |
| Reconstrução multivista **sem IA** (casca visual por silhuetas, 2 a 9 vistas), sólido fechado por construção | `reconstrucao.js` (`Manifold.levelSet`) | 4, 6 e 9 vistas: fechado, altura exata, fidelidade ≥ 0,975 por vista, contém o objeto real |
| Cores das fotos (visibilidade + agrupamento + limpeza de ilhas < 2 mm²) | `coresDasFotos`, `limparIlhas` | preto, branco e vermelho do objeto de teste recuperados |
| Reparo e validação (os mesmos do editor) | `core/reparo.js`, `core/validador.js` | tudo sai sem aresta aberta nem auto-interseção |
| Separar por cor numa superfície **curva** com espessura (camada que acompanha a curvatura) | `core/separar.js` (método `camada`) | `tests/separar.test.mjs`: faixa numa esfera, com e sem folga; parede fina recusada com mensagem |
| Contrato único de gerador (`ImageTo3DProvider`) | `core/ia/provedores.js` | provedor local e provedor HTTP passam pelo mesmo pipeline |
| Pipeline comum: gerar → importar → consertar → alinhar com as fotos (Y/Z pra cima, giro, escala) → medir | `core/ia/pipeline.js`, op `posProcessarIA` | modelo "de IA" simulado (Y pra cima, girado 90°, em metros) volta pro lugar certo |
| Benchmark interno (mesmos números pra qualquer gerador) | `core/ia/avaliacao.js` | `dist/ia-demo/benchmark.json` |
| Servidor próprio (fila, 1 tarefa por vez na GPU, token, cancelar, limite, limpeza) | `servidor-ia/` (FastAPI) | `tests/ia-provedores.test.mjs` sobe o servidor de verdade e gera por HTTP |
| Resultado entra no editor | `{ nome, transform, partes }` → `estudio.adicionarObjetos` (mesmo caminho do "Abrir") | E2E: 3MF das fotos aberto no Estúdio |
| Laboratório pra testar com fotos reais (só no pacote de teste) | `teste/laboratorio-fotos-3d.html` | E2E: 6 fotos → sólido, comparação por vista, 3MF e 3MF por cor lido pelo simulador do Bambu |

**Não testado aqui:** o adaptador `servidor-ia/adaptadores/hunyuan3d_mv.py`. Este
ambiente não tem GPU e bloqueia `huggingface.co` e downloads do `github.com`,
então nenhum modelo de IA rodou e nenhum número de IA neste documento foi medido.

## 2. Arquitetura (nomes pedidos → módulos)

```
fotos ──► AIImageProcessor/SegmentationEngine (imagens.js; IA de fundo: servidor)
      ──► ViewAlignment (prepararVistas: escala, centro, avisos)
      ──► ImageTo3DProvider  ┬─ silhuetas (local, CPU)           provedores.js
                              └─ servidor HTTP ─► GenerationQueue + GPUJobManager (servidor-ia/fila.py)
                                                   └─ adaptadores: silhuetas | hunyuan3d-2mv | (próximos)
      ──► importar (mesmo do "Abrir")  ──► MeshRepair/Validator (reparo.js, validador.js)
      ──► alinhamento com as fotos + Benchmark (avaliacao.js)
      ──► editor (adicionarObjetos) ──► cortar / separar por cor (camada) / furos / exportar 3MF
```

Trocar de modelo = escrever um adaptador (Python, ~60 linhas) com `vistas`,
`eixo_cima`, `carregar()`, `gerar()`. O Estúdio não muda.

## 3. Pesquisa de modelos abertos (ETAPA 1)

| Modelo | Entrada | Licença | VRAM (fonte: página do projeto) | Situação aqui |
|---|---|---|---|---|
| **Hunyuan3D-2mv** (Tencent) | **várias vistas** (frente, esquerda, costas) | Tencent Hunyuan 3D 2.0 Community License: não vale na UE, Reino Unido e Coreia do Sul; acima de 1 milhão de usuários/mês precisa de licença | ~6 GB só a forma; ~16 GB forma + textura | adaptador escrito, **não testado** |
| TRELLIS (Microsoft, v1) | 1 imagem (multi-imagem experimental) | MIT | 16 GB | plano B |
| TRELLIS.2 (Microsoft) | 1 imagem | MIT | ≥ 24 GB, NVIDIA, Linux | caro pra começar |
| InstantMesh (Tencent ARC) | 1 imagem | Apache-2.0 | não confirmado | — |
| Step1X-3D (StepFun) | 1 imagem | Apache-2.0 | não confirmado | — |

**Decisão:** o primeiro modelo de IA é o Hunyuan3D-2mv. Foi o único modelo
aberto que encontrei com entrada multivista nativa (a prioridade pedida) e que
cabe numa GPU de 8–12 GB. O risco é a licença, que precisa ser lida antes de uso
comercial. A alternativa MIT é o TRELLIS v1. O gerador por silhuetas é o
**piso**: ele roda sem GPU, e o benchmark diz quanto a IA melhora em cima dele.

## 4. Custos e hardware

- IA de verdade precisa de GPU NVIDIA; não existe versão grátis sem custo computacional.
- Três opções: (a) um PC com RTX de 12–16 GB, que roda a forma do Hunyuan3D-2mv (6 GB); (b) uma GPU alugada por hora, ligada só quando houver fila; (c) só silhuetas, sem custo e na CPU, com menos fidelidade.
- Não pus preço por hora nem tempo por geração: os dois mudam, e eu não medi. O primeiro teste com GPU mede isso pelo benchmark (`tempos.gerarMs`).
- Pra rodar aqui na nuvem, o acesso de rede do ambiente precisa liberar `huggingface.co` (e o armazenamento dos arquivos do HF), `github.com`, `pypi.org` e `download.pytorch.org`, além de uma máquina com GPU.

## 5. Ligar o servidor

```
cd servidor-ia
pip install -r requirements.txt            # silhuetas (CPU) — funciona já
pip install -r requirements-gpu.txt        # + PyTorch CUDA + Hunyuan3D-2 (ver arquivo)
IA_TOKEN=um-segredo uvicorn app:app --host 0.0.0.0 --port 8765
```
No laboratório: Gerador → "Servidor de IA próprio", com o endereço, o token e o modelo `hunyuan3d-2mv`, e depois "Testar conexão".
O `/saude` lista os modelos prontos e os indisponíveis, cada um com o motivo. Ele não finge que um modelo funciona.

## 6. Benchmark (mesmos números pra todo gerador)

As métricas são:
- fidelidade (IoU da silhueta por vista, com a escala da foto);
- se a peça é imprimível (fechada, sem auto-interseção, volume > 0);
- triângulos, medidas em mm, volume;
- passos de conserto e tempos.

Resultados medidos com o objeto de teste (64 mm, fotos sintéticas):

| Gerador | Vistas | Fidelidade (pior vista) | Volume sobrando | Tempo |
|---|---|---|---|---|
| silhuetas | 4 | 0,983 | +28,5 % | ~1 s |
| silhuetas | 6 | 0,975 | +9,1 % | ~1,1 s |
| silhuetas | 9 | 0,975 | +5,3 % | ~1,3 s |
| objeto real (teto) | 4 | 0,996 | 0 | — |

**Primeiro teste com GPU:** rodar as mesmas fotos no `hunyuan3d-2mv` e comparar
a fidelidade e o volume sobrando. Se a fidelidade cair nas vistas laterais,
troque `esquerda`↔`left` em `MAPA`.

## 7. Limitações honestas

- **Silhuetas:** não enxergam cavidades (vão entre as pernas visto de lado, concha, xícara). Com 4 vistas sobra volume; 3/4 e de cima melhoram. Foto com perspectiva forte distorce, então use a câmera longe e com zoom.
- **Fundo:** precisa ser liso ou transparente. Fundo com cenário precisa de segmentação por IA no servidor (próxima etapa).
- **Cor:** vem da foto, com a luz do ambiente. Ilhas menores que 2 mm² viram a cor vizinha.
- **Laboratório:** é uma bancada de teste, não a interface final. A interface no Estúdio vem depois do benchmark com IA.

## 8. Próximas etapas (ordem)

1. Máquina com GPU e rede liberada: benchmark do Hunyuan3D-2mv contra as silhuetas nas mesmas fotos.
2. Híbrido: a forma da IA **cortada pela casca visual das fotos** (tira o que a IA inventou fora das silhuetas). A peça já existe: `reconstrucao.js` + booleana.
3. Segmentação de fundo por IA no servidor, pra aceitar foto com cenário.
4. Interface final no Estúdio ("Criar a partir de fotos"), com guia de foto e as mesmas métricas.
5. Impressão real das amostras (`amostras/` no pacote de teste) e ajuste de espessura e folga.

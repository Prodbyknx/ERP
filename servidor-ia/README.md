# servidor-ia

Servidor próprio de geração 3D por fotos (FastAPI), com fila, um trabalho por vez na GPU, token e cancelamento.
O Estúdio conversa com ele pelo provedor `servidor` (`src/estudio3d/core/ia/provedores.js`).

- `adaptadores/silhuetas.py`: CPU, sem IA, usa `tools/fotos-para-3d.mjs`. **Testado.**
- `adaptadores/hunyuan3d_mv.py`: Hunyuan3D-2mv, GPU. **Não testado** (sem GPU e rede bloqueada no ambiente de desenvolvimento).

Como instalar, as licenças, os custos e o benchmark estão em `docs/IA-3D.md`.

## Segurança (variáveis de ambiente)

| Variável | Padrão | O que faz |
|---|---|---|
| `IA_TOKEN` | — | Obrigatória. Sem ela o servidor responde 503 a tudo (fecha por padrão). Gere uma longa: `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `IA_SEM_TOKEN=1` | desligado | Só pra teste na própria máquina: atende sem token. |
| `IA_ORIGENS` | `*` | Sites que podem chamar pelo navegador (ex.: `https://seu-site.pages.dev`). |
| `IA_MAX_VISTAS` / `IA_MAX_BYTES` / `IA_MAX_LADO` / `IA_MAX_PIXELS` | 12 / 15 MB / 2048 / 40 MP | Limites das fotos (imagem "bomba" é recusada). |
| `IA_MAX_CORPO` | fotos × tamanho | Pedido maior é recusado (413) antes de ser lido. |
| `IA_MAX_FILA` | 20 | Fila cheia responde 429. |
| `IA_MAX_TENTATIVAS` / `IA_JANELA_TENTATIVAS` | 10 / 600 s | Quem erra o token 10 vezes em 10 min fica bloqueado (429). |

Na internet, deixe atrás de HTTPS (Cloudflare Tunnel, Caddy ou nginx) e defina `IA_ORIGENS` com o endereço do seu site.

# servidor-ia

Servidor próprio de geração 3D por fotos (FastAPI), com fila, um trabalho por vez na GPU, token e cancelamento.
O Estúdio conversa com ele pelo provedor `servidor` (`src/estudio3d/core/ia/provedores.js`).

- `adaptadores/silhuetas.py`: CPU, sem IA, usa `tools/fotos-para-3d.mjs`. **Testado.**
- `adaptadores/hunyuan3d_mv.py`: Hunyuan3D-2mv, GPU. **Não testado** (sem GPU e rede bloqueada no ambiente de desenvolvimento).

Como instalar, as licenças, os custos e o benchmark estão em `docs/IA-3D.md`.

"""Hunyuan3D-2mv (Tencent): forma 3D a partir de 1-3 vistas (frente, esquerda,
costas). Precisa de GPU NVIDIA (~6 GB de VRAM só a forma, fp16) e dos pesos
do Hugging Face (tencent/Hunyuan3D-2mv, subpasta hunyuan3d-dit-v2-mv).

NÃO TESTADO NESTE AMBIENTE (sem GPU e com huggingface.co bloqueado): o código
segue o exemplo oficial (examples/shape_gen_mv.py do repositório
Tencent-Hunyuan/Hunyuan3D-2). Na 1ª execução com GPU, rode o benchmark
(tests/servidor-ia.test.mjs / docs/IA-3D.md) pra confirmar a orientação.

Licença: Tencent Hunyuan 3D 2.0 Community License — NÃO vale na União
Europeia, Reino Unido e Coreia do Sul; acima de 1 milhão de usuários/mês
precisa de licença da Tencent; confira os termos antes de uso comercial."""
import os

from . import Adaptador

# vista do Estúdio -> chave do Hunyuan3D-2mv. ATENÇÃO: confirmar no 1º teste
# com GPU se o "left" deles é o lado esquerdo do objeto (como aqui) ou o lado
# esquerdo da imagem; o benchmark mostra (fidelidade cai se estiver trocado).
MAPA = {'frente': 'front', 'esquerda': 'left', 'costas': 'back'}


class Hunyuan3DMV(Adaptador):
    id = 'hunyuan3d-2mv'
    nome = 'Hunyuan3D-2mv (GPU)'
    vistas = list(MAPA)
    minimo = 1
    eixo_cima = 'Y'
    vram_gb = 6
    licenca = 'Tencent Hunyuan 3D 2.0 Community License (fora de UE/Reino Unido/Coreia do Sul)'
    gpu = True

    def __init__(self):
        self.pipe = None

    def disponivel(self):
        try:
            import torch  # noqa: F401
            import hy3dgen  # noqa: F401
        except Exception:
            return False, 'hy3dgen/torch não instalados (ver requirements-gpu.txt).'
        import torch
        if not torch.cuda.is_available():
            return False, 'Sem GPU CUDA.'
        return True, ''

    def carregar(self):
        if self.pipe is None:
            import torch
            from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
            self.pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                'tencent/Hunyuan3D-2mv', subfolder='hunyuan3d-dit-v2-mv', variant='fp16')
            self.torch = torch

    def descarregar(self):
        self.pipe = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    def gerar(self, pasta, vistas, opc, progresso, cancelado):
        from PIL import Image
        from hy3dgen.rembg import BackgroundRemover
        from hy3dgen.shapegen import FloaterRemover, DegenerateFaceRemover, FaceReducer
        self.carregar()
        imagens, rembg = {}, None
        for v, caminho in vistas.items():
            if v not in MAPA:
                continue
            im = Image.open(caminho).convert('RGBA')
            if im.getextrema()[3][0] == 255:        # sem transparência: tira o fundo
                rembg = rembg or BackgroundRemover()
                im = rembg(im.convert('RGB'))
            imagens[MAPA[v]] = im
        if 'front' not in imagens:
            raise RuntimeError('Hunyuan3D-2mv precisa da foto de frente.')
        progresso(0.1)
        malha = self.pipe(image=imagens, num_inference_steps=int(opc.get('passos', 30)),
                          octree_resolution=int(opc.get('octree', 380)), num_chunks=20000,
                          generator=self.torch.manual_seed(int(opc.get('semente', 12345))),
                          output_type='trimesh')[0]
        if cancelado():
            raise RuntimeError('Cancelado.')
        malha = FloaterRemover()(malha)
        malha = DegenerateFaceRemover()(malha)
        malha = FaceReducer()(malha, max_facenum=int(opc.get('maxFaces', 200000)))
        saida = os.path.join(pasta, 'modelo.obj')
        malha.export(saida)
        return saida, 'modelo-hunyuan3d-2mv.obj'

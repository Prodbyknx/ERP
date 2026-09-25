"""Adaptadores de geradores 3D. Cada um implementa a mesma interface
(ImageTo3DProvider do lado do servidor): trocar de modelo = trocar/registrar
um adaptador; a fila, o protocolo HTTP e o pós-processo no Estúdio não mudam."""


class Adaptador:
    id = ''
    nome = ''
    vistas = []          # nomes de vista do Estúdio: frente, costas, esquerda, direita, frenteEsquerda..., cima
    minimo = 1
    eixo_cima = 'Y'      # convenção da malha devolvida ('Y' = glTF/OBJ de IA, 'Z' = impressão 3D)
    vram_gb = 0
    licenca = ''
    gpu = False

    def disponivel(self):
        """-> (ok: bool, motivo: str)"""
        return True, ''

    def carregar(self):
        """Carrega pesos na memória/VRAM (chamado pela fila antes da 1ª tarefa)."""

    def descarregar(self):
        """Libera VRAM (a fila chama ao trocar de modelo)."""

    def gerar(self, pasta, vistas, opc, progresso, cancelado):
        """vistas: {vista: caminho PNG RGBA}. -> (caminho do arquivo, nome pra baixar)"""
        raise NotImplementedError

    def descricao(self):
        return {'id': self.id, 'nome': self.nome, 'vistas': self.vistas, 'minimo': self.minimo,
                'eixoCima': self.eixo_cima, 'vramGB': self.vram_gb, 'licenca': self.licenca, 'gpu': self.gpu}


def registrar_padrao():
    from .silhuetas import Silhuetas
    from .hunyuan3d_mv import Hunyuan3DMV
    lista = [Silhuetas(), Hunyuan3DMV()]
    return {a.id: a for a in lista}

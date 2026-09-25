"""GenerationQueue + GPUJobManager: uma fila, UM trabalhador (a GPU roda uma
geração por vez — duas ao mesmo tempo estouram a VRAM), um modelo carregado
por vez (trocar de modelo descarrega o anterior), cancelamento, limite de fila
e limpeza das tarefas antigas."""
import os
import shutil
import tempfile
import threading
import time
import traceback
import uuid


class Tarefa:
    def __init__(self, modelo, opc, pasta):
        self.id = uuid.uuid4().hex[:16]
        self.modelo, self.opc, self.pasta = modelo, opc, pasta
        self.vistas = {}
        self.estado, self.progresso, self.erro = 'fila', 0.0, None
        self.arquivo, self.nome_arquivo = None, None
        self.criada, self.inicio, self.fim = time.time(), None, None
        self.cancelada = False

    def resumo(self, posicao=None):
        d = {'id': self.id, 'modelo': self.modelo, 'estado': self.estado, 'progresso': round(self.progresso, 3), 'erro': self.erro}
        if posicao is not None:
            d['posicao'] = posicao
        if self.inicio:
            d['segundos'] = round((self.fim or time.time()) - self.inicio, 2)
        return d


class FilaDeGeracao:
    def __init__(self, adaptadores, max_fila=20, ttl_s=3600, pasta=None):
        self.adaptadores = adaptadores
        self.max_fila, self.ttl_s = max_fila, ttl_s
        self.pasta = pasta or tempfile.mkdtemp(prefix='fila-ia-')
        self.tarefas, self.ordem = {}, []
        self.trava = threading.Condition()
        self.carregado = None
        self.rodando = True
        self.trab = threading.Thread(target=self._trabalhador, daemon=True)
        self.trab.start()

    def enviar(self, modelo, imagens, opc):
        """imagens: {vista: PIL.Image}"""
        a = self.adaptadores.get(modelo)
        if not a:
            raise ValueError('Modelo desconhecido: %s' % modelo)
        ok, motivo = a.disponivel()
        if not ok:
            raise ValueError('%s indisponível: %s' % (a.nome, motivo))
        fora = [v for v in imagens if v not in a.vistas]
        if fora:
            raise ValueError('%s não usa as vistas: %s' % (a.nome, ', '.join(fora)))
        if len(imagens) < a.minimo:
            raise ValueError('%s precisa de pelo menos %d fotos.' % (a.nome, a.minimo))
        with self.trava:
            if sum(1 for t in self.tarefas.values() if t.estado in ('fila', 'rodando')) >= self.max_fila:
                raise OverflowError('Fila cheia, tente daqui a pouco.')
            t = Tarefa(modelo, opc, None)
            t.pasta = os.path.join(self.pasta, t.id)
            os.makedirs(t.pasta)
            for v, im in imagens.items():
                c = os.path.join(t.pasta, v + '.png')
                im.save(c)                       # PNG RGBA sem entrelaçamento
                t.vistas[v] = c
            self.tarefas[t.id] = t
            self.ordem.append(t.id)
            self.trava.notify_all()
            return t

    def estado(self, id):
        with self.trava:
            t = self.tarefas.get(id)
            if not t:
                return None
            pos = None
            if t.estado == 'fila':
                pos = 1 + sum(1 for i in self.ordem if self.tarefas[i].estado == 'fila' and self.tarefas[i].criada < t.criada)
            return t.resumo(pos)

    def cancelar(self, id):
        with self.trava:
            t = self.tarefas.get(id)
            if not t:
                return False
            t.cancelada = True
            if t.estado == 'fila':
                t.estado, t.erro = 'erro', 'Cancelado.'
            return True

    def resultado(self, id):
        t = self.tarefas.get(id)
        return (t.arquivo, t.nome_arquivo) if t and t.estado == 'pronto' else (None, None)

    def _proxima(self):
        for i in self.ordem:
            t = self.tarefas.get(i)
            if t and t.estado == 'fila':
                return t
        return None

    def _limpar(self):
        agora = time.time()
        for i in list(self.ordem):
            t = self.tarefas[i]
            if t.estado in ('pronto', 'erro') and agora - (t.fim or t.criada) > self.ttl_s:
                shutil.rmtree(t.pasta, ignore_errors=True)
                del self.tarefas[i]
                self.ordem.remove(i)

    def _trabalhador(self):
        while self.rodando:
            with self.trava:
                self._limpar()
                t = self._proxima()
                if not t:
                    self.trava.wait(timeout=5)
                    continue
                t.estado, t.inicio = 'rodando', time.time()
            a = self.adaptadores[t.modelo]
            try:
                if self.carregado is not a:
                    if self.carregado:
                        self.carregado.descarregar()
                    a.carregar()
                    self.carregado = a

                def progresso(f):
                    t.progresso = max(t.progresso, min(1.0, float(f)))
                arq, nome = a.gerar(t.pasta, t.vistas, t.opc, progresso, lambda: t.cancelada)
                if t.cancelada:
                    raise RuntimeError('Cancelado.')
                t.arquivo, t.nome_arquivo, t.progresso, t.estado = arq, nome, 1.0, 'pronto'
            except Exception as e:  # noqa: BLE001
                t.estado, t.erro = 'erro', str(e) or e.__class__.__name__
                traceback.print_exc()
            finally:
                t.fim = time.time()

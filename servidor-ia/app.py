"""Servidor de geração 3D por fotos (self-hosted). Roda na sua máquina com GPU
ou numa GPU alugada; o Estúdio conversa com ele pelo provedor "servidor"
(src/estudio3d/core/ia/provedores.js). Sem serviço pago de terceiros.

  pip install -r requirements.txt            # (+ requirements-gpu.txt pra IA)
  IA_TOKEN=um-segredo uvicorn app:app --host 0.0.0.0 --port 8765

Protocolo: GET /saude · POST /tarefas · GET /tarefas/{id} ·
GET /tarefas/{id}/resultado · DELETE /tarefas/{id}"""
import base64
import hmac
import io
import os
import time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

from adaptadores import registrar_padrao
from fila import FilaDeGeracao

TOKEN = os.environ.get('IA_TOKEN', '')
# sem token o servidor NÃO atende (fecha por padrão). Só pra teste na própria
# máquina dá pra liberar de propósito com IA_SEM_TOKEN=1
SEM_TOKEN = os.environ.get('IA_SEM_TOKEN', '') == '1'
MAX_LADO = int(os.environ.get('IA_MAX_LADO', '2048'))
MAX_BYTES = int(os.environ.get('IA_MAX_BYTES', str(15 * 1024 * 1024)))
MAX_VISTAS = int(os.environ.get('IA_MAX_VISTAS', '12'))
# corpo da requisição: as fotos em base64 (+1/3) e uma folga pro JSON
MAX_CORPO = int(os.environ.get('IA_MAX_CORPO', str(MAX_VISTAS * MAX_BYTES * 4 // 3 + 256 * 1024)))
ORIGENS = [o for o in os.environ.get('IA_ORIGENS', '*').split(',') if o]
# imagem "bomba" (dimensão absurda) vira erro claro, não trava a máquina
Image.MAX_IMAGE_PIXELS = int(os.environ.get('IA_MAX_PIXELS', str(40_000_000)))
# força bruta no token: quem erra MAX_TENTATIVAS vezes na janela espera
MAX_TENTATIVAS = int(os.environ.get('IA_MAX_TENTATIVAS', '10'))
JANELA_TENTATIVAS = int(os.environ.get('IA_JANELA_TENTATIVAS', '600'))


class LimiteDoCorpo:
    """Recusa requisição maior que MAX_CORPO antes de ler tudo na memória."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        tam = dict(scope.get('headers') or []).get(b'content-length')
        if tam is not None and tam.isdigit() and int(tam) > MAX_CORPO:
            return await JSONResponse({'erro': 'Requisição grande demais.'}, status_code=413)(scope, receive, send)
        lido = 0

        async def receber():
            nonlocal lido
            msg = await receive()
            if msg['type'] == 'http.request':
                lido += len(msg.get('body', b''))
                if lido > MAX_CORPO:
                    raise HTTPException(413, 'Requisição grande demais.')
            return msg
        return await self.app(scope, receber, send)


class LimiteDeTentativas:
    """Quem erra o token muitas vezes (força bruta) fica um tempo sem poder
    tentar de novo: responde 429 antes de chegar no servidor."""

    def __init__(self, app):
        self.app, self.erros = app, {}

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        ip, agora = (scope.get('client') or ('?',))[0], time.monotonic()
        if len(self.erros) > 10000:
            self.erros = {k: v for k, v in self.erros.items() if v and agora - v[-1] < JANELA_TENTATIVAS}
        lista = [t for t in self.erros.get(ip, ()) if agora - t < JANELA_TENTATIVAS]
        self.erros[ip] = lista
        if len(lista) >= MAX_TENTATIVAS:
            return await JSONResponse({'erro': 'Muitas tentativas com token errado. Espere alguns minutos.'}, status_code=429)(scope, receive, send)

        async def enviar(msg):
            if msg['type'] == 'http.response.start' and msg['status'] == 401:
                lista.append(time.monotonic())
            await send(msg)
        return await self.app(scope, receive, enviar)


app = FastAPI(title='144lab IA 3D')
app.add_middleware(LimiteDoCorpo)
app.add_middleware(LimiteDeTentativas)
# por último = mais de fora: até as recusas (413/429) levam o cabeçalho CORS
app.add_middleware(CORSMiddleware, allow_origins=ORIGENS, allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Authorization', 'Content-Type'], expose_headers=['X-Arquivo'])
ADAPTADORES = registrar_padrao()
FILA = FilaDeGeracao(ADAPTADORES, max_fila=int(os.environ.get('IA_MAX_FILA', '20')))


def conferir(auth):
    if not TOKEN:
        if SEM_TOKEN:
            return
        raise HTTPException(503, 'Servidor sem IA_TOKEN: defina um token (IA_TOKEN=...) antes de usar.')
    # comparação em tempo constante (não dá pra adivinhar o token pelo tempo)
    if not hmac.compare_digest((auth or '').encode(), ('Bearer ' + TOKEN).encode()):
        raise HTTPException(401, 'Token inválido.')


def erro(status, msg):
    return JSONResponse({'erro': msg}, status_code=status)


@app.get('/saude')
def saude(authorization: str = Header(default='')):
    conferir(authorization)
    gpu, vram = False, None
    try:
        import torch
        if torch.cuda.is_available():
            gpu, vram = True, round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1)
    except Exception:
        pass
    modelos = []
    for a in ADAPTADORES.values():
        ok, motivo = a.disponivel()
        d = a.descricao()
        d.update({'disponivel': ok, 'motivo': motivo})
        if ok:
            modelos.append(d)
    return {'ok': True, 'gpu': gpu, 'vramGB': vram, 'modelos': modelos,
            'indisponiveis': [{'id': a.id, 'motivo': a.disponivel()[1]} for a in ADAPTADORES.values() if not a.disponivel()[0]]}


@app.post('/tarefas')
def nova(corpo: dict, authorization: str = Header(default='')):
    conferir(authorization)
    try:
        vistas = corpo.get('vistas', [])
        if not isinstance(vistas, list) or len(vistas) > MAX_VISTAS:
            return erro(400, 'Mande de 1 a %d fotos.' % MAX_VISTAS)
        imagens = {}
        for v in vistas:
            b = base64.b64decode(v['png'])
            if len(b) > MAX_BYTES:
                return erro(413, 'Foto grande demais (%s).' % v['vista'])
            im = Image.open(io.BytesIO(b))
            im.load()
            if max(im.size) > MAX_LADO:
                im.thumbnail((MAX_LADO, MAX_LADO))
            imagens[v['vista']] = im.convert('RGBA')
        t = FILA.enviar(corpo.get('modelo', ''), imagens, corpo.get('opc') or {})
    except OverflowError as e:
        return erro(429, str(e))
    except Image.DecompressionBombError:
        return erro(413, 'Foto com dimensão grande demais.')
    except ValueError as e:
        return erro(400, str(e))
    except KeyError as e:
        return erro(400, 'Faltou o campo %s em uma das fotos.' % e)
    except (OSError, TypeError):
        # sem detalhe interno (caminho, objeto do Python): só o que a pessoa precisa saber
        return erro(400, 'Foto inválida ou corrompida.')
    return {'id': t.id}


@app.get('/tarefas/{id}')
def estado(id: str, authorization: str = Header(default='')):
    conferir(authorization)
    e = FILA.estado(id)
    return e if e else erro(404, 'Tarefa não encontrada.')


@app.get('/tarefas/{id}/resultado')
def resultado(id: str, authorization: str = Header(default='')):
    conferir(authorization)
    arq, nome = FILA.resultado(id)
    if not arq:
        return erro(404, 'Resultado não está pronto.')
    return FileResponse(arq, filename=nome, headers={'X-Arquivo': nome})


@app.delete('/tarefas/{id}')
def cancelar(id: str, authorization: str = Header(default='')):
    conferir(authorization)
    return {'ok': FILA.cancelar(id)}

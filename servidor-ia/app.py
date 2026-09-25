"""Servidor de geração 3D por fotos (self-hosted). Roda na sua máquina com GPU
ou numa GPU alugada; o Estúdio conversa com ele pelo provedor "servidor"
(src/estudio3d/core/ia/provedores.js). Sem serviço pago de terceiros.

  pip install -r requirements.txt            # (+ requirements-gpu.txt pra IA)
  IA_TOKEN=um-segredo uvicorn app:app --host 0.0.0.0 --port 8765

Protocolo: GET /saude · POST /tarefas · GET /tarefas/{id} ·
GET /tarefas/{id}/resultado · DELETE /tarefas/{id}"""
import base64
import io
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

from adaptadores import registrar_padrao
from fila import FilaDeGeracao

TOKEN = os.environ.get('IA_TOKEN', '')
MAX_LADO = int(os.environ.get('IA_MAX_LADO', '2048'))
MAX_BYTES = int(os.environ.get('IA_MAX_BYTES', str(15 * 1024 * 1024)))
ORIGENS = [o for o in os.environ.get('IA_ORIGENS', '*').split(',') if o]

app = FastAPI(title='144lab IA 3D')
app.add_middleware(CORSMiddleware, allow_origins=ORIGENS, allow_methods=['*'], allow_headers=['*'], expose_headers=['X-Arquivo'])
ADAPTADORES = registrar_padrao()
FILA = FilaDeGeracao(ADAPTADORES, max_fila=int(os.environ.get('IA_MAX_FILA', '20')))


def conferir(auth):
    if TOKEN and auth != 'Bearer ' + TOKEN:
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
        imagens = {}
        for v in corpo.get('vistas', []):
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
    except (ValueError, KeyError, OSError) as e:
        return erro(400, str(e))
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

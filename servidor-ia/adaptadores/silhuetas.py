"""Gerador local sem IA (casca visual pelas silhuetas) — o mesmo código do
Estúdio, chamado pela linha de comando do Node. Roda na CPU (~1-3 s).
Serve de referência no benchmark e de reserva quando não há GPU."""
import json
import os
import shutil
import subprocess

from . import Adaptador

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CLI = os.path.join(RAIZ, 'tools', 'fotos-para-3d.mjs')
TODAS = ['frente', 'costas', 'esquerda', 'direita', 'frenteEsquerda', 'frenteDireita', 'costasEsquerda', 'costasDireita', 'cima']


class Silhuetas(Adaptador):
    id = 'silhuetas'
    nome = 'Silhuetas (CPU, sem IA)'
    vistas = TODAS
    minimo = 2
    eixo_cima = 'Z'
    licenca = 'código próprio'

    def disponivel(self):
        if not shutil.which('node'):
            return False, 'Node.js não encontrado no servidor.'
        if not os.path.exists(CLI):
            return False, 'tools/fotos-para-3d.mjs não encontrado.'
        return True, ''

    def gerar(self, pasta, vistas, opc, progresso, cancelado):
        saida = os.path.join(pasta, 'modelo.3mf')
        cmd = ['node', CLI, '--altura', str(float(opc.get('alturaMM', 60))), '--saida', saida]
        cmd += ['%s=%s' % (v, c) for v, c in vistas.items()]
        progresso(0.2)
        p = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, timeout=600)
        try:
            r = json.loads(p.stdout.strip().splitlines()[-1])
        except Exception:
            raise RuntimeError('Falha no gerador local: ' + (p.stderr or p.stdout)[-400:])
        if not r.get('ok'):
            raise RuntimeError(r.get('erro', 'falha no gerador local'))
        return saida, 'modelo-silhuetas.3mf'

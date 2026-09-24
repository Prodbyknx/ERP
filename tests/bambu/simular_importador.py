"""Simulador do importador de 3MF do Bambu Studio (v1.10 até v2.08), só a
parte que decide COR e ESTRUTURA. Reproduz a lógica de
src/libslic3r/Format/bbs_3mf.cpp e src/slic3r/GUI/ObjColorDialog.cpp:

  - parser expat SEM namespaces: as tags são comparadas pelo nome literal
    ("m:colorgroup", "m:color", "object", "triangle"...), igual ao C++;
  - arquivo é "do Bambu" só se <metadata name="Application"> começa com
    "BambuStudio-". Se não for, project_settings.config é IGNORADO e as cores
    vêm de m:colorgroup;
  - basematerials/displaycolor NÃO é lido;
  - cor por triângulo: pid/p1 do triângulo ou pid/pindex do objeto;
  - diálogo de cores (arquivo de terceiro): volume cujos triângulos têm todos
    a cor do objeto recebe o filamento dessa cor (extruder), sem pintura.

Uso: python3 simular_importador.py arquivo.3mf  -> JSON
"""
import sys, json, zipfile
import xml.parsers.expat as expat


def ler_modelo(xml):
    st = {'app': None, 'grupos': {}, 'grupo_atual': None, 'objetos': {}, 'obj': None,
          'meta_nome': None, 'meta_txt': '', 'itens': [], 'tri_count': {}}

    def inicio(nome, a):
        if nome == 'metadata' and st['obj'] is None:
            st['meta_nome'] = a.get('name'); st['meta_txt'] = ''
        elif nome == 'm:colorgroup':
            st['grupo_atual'] = int(a['id']); st['grupos'][st['grupo_atual']] = []
        elif nome == 'm:color':
            st['grupos'][st['grupo_atual']].append(a.get('color', ''))
        elif nome == 'object':
            o = {'id': int(a['id']), 'nome': a.get('name', ''), 'pid': int(a['pid']) if 'pid' in a else -1,
                 'pindex': int(a['pindex']) if 'pindex' in a else -1, 'tris': [], 'comps': []}
            st['objetos'][o['id']] = o; st['obj'] = o
        elif nome == 'triangle' and st['obj'] is not None:
            o = st['obj']
            pid = int(a['pid']) if 'pid' in a else o['pid']
            if pid >= 0:
                p1 = int(a['p1']) if 'p1' in a else o['pindex']
                o['tris'].append((pid, p1))
            else:
                o['tris'].append((-1, -1))
        elif nome == 'component' and st['obj'] is not None:
            st['obj']['comps'].append(int(a['objectid']))
        elif nome == 'item':
            st['itens'].append(int(a['objectid']))

    def fim(nome):
        if nome == 'metadata' and st['meta_nome']:
            if st['meta_nome'] == 'Application':
                st['app'] = st['meta_txt'].strip()
            st['meta_nome'] = None
        elif nome == 'object':
            st['obj'] = None

    def dados(t):
        if st['meta_nome']:
            st['meta_txt'] += t

    p = expat.ParserCreate()          # sem namespace, como no Bambu
    p.StartElementHandler = inicio
    p.EndElementHandler = fim
    p.CharacterDataHandler = dados
    p.Parse(xml, True)
    return st


def simular(caminho):
    z = zipfile.ZipFile(caminho)
    st = ler_modelo(z.read('3D/3dmodel.model').decode('utf-8'))
    eh_bambu = bool(st['app']) and st['app'].startswith('BambuStudio-')
    # mapa cor -> filamento (ordem dos grupos por id, cores na ordem; repetida reaproveita)
    cor_ext = {}
    ordem = []
    for gid in sorted(st['grupos']):
        for c in st['grupos'][gid]:
            if c not in cor_ext:
                cor_ext[c] = len(cor_ext) + 1
                ordem.append(c)
    saida = {'eh_projeto_bambu': eh_bambu, 'filamentos': ordem, 'objetos': []}
    for oid in st['itens']:
        o = st['objetos'][oid]
        vols = o['comps'] or [oid]
        vs = []
        for vid in vols:
            v = st['objetos'][vid]
            cores = set()
            for (pid, p1) in v['tris']:
                if pid in st['grupos'] and 0 <= p1 < len(st['grupos'][pid]):
                    cores.add(st['grupos'][pid][p1])
            nivel_objeto = (v['pid'] in st['grupos'] and v['pindex'] >= 0 and
                            all(t == (v['pid'], v['pindex']) for t in v['tris']))
            cor = st['grupos'][v['pid']][v['pindex']] if nivel_objeto else None
            vs.append({'nome': v['nome'], 'triangulos': len(v['tris']),
                       'cor_volume': cor, 'filamento': cor_ext.get(cor) if cor else None,
                       'pintado': not nivel_objeto, 'cores_triangulos': sorted(cores)})
        saida['objetos'].append({'nome': o['nome'], 'volumes': vs})
    # o que o Bambu faria com project_settings num arquivo de terceiro: nada
    saida['project_settings_usado'] = eh_bambu and 'Metadata/project_settings.config' in z.namelist()
    return saida


if __name__ == '__main__':
    print(json.dumps(simular(sys.argv[1]), ensure_ascii=False))

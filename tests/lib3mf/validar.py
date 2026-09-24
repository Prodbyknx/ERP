"""Valida um 3MF com a lib3mf (biblioteca oficial do consórcio 3MF).
Uso: python3 validar.py arquivo.3mf  -> imprime JSON com o que a lib leu."""
import sys, json
import lib3mf

def main(caminho):
    w = lib3mf.get_wrapper()
    model = w.CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)          # modo estrito: qualquer desvio da norma é erro
    reader.ReadFromFile(caminho)
    avisos = [reader.GetWarning(i)[1] for i in range(reader.GetWarningCount())]
    unidade = model.GetUnit()
    grupos = {}
    grupos_obj = {}
    it = model.GetColorGroups()
    while it.MoveNext():
        g = it.GetCurrentColorGroup()
        cores = []
        ids = g.GetAllPropertyIDs()
        for pid in ids:
            c = g.GetColor(pid)
            cores.append('#%02X%02X%02X%02X' % (c.Red, c.Green, c.Blue, c.Alpha))
        grupos[g.GetResourceID()] = cores
        grupos_obj[g.GetResourceID()] = g
    objetos = []
    mi = model.GetMeshObjects()
    while mi.MoveNext():
        m = mi.GetCurrentMeshObject()
        rid, propid, tem = m.GetObjectLevelProperty()
        cor_obj = None
        if tem and rid in grupos_obj:
            c = grupos_obj[rid].GetColor(propid)
            cor_obj = '#%02X%02X%02X' % (c.Red, c.Green, c.Blue)
        props = m.GetAllTriangleProperties()
        tri_cores = set()
        for p in props:
            if p.ResourceID in grupos_obj:
                c = grupos_obj[p.ResourceID].GetColor(p.PropertyIDs[0])
                tri_cores.add('#%02X%02X%02X' % (c.Red, c.Green, c.Blue))
        objetos.append({
            'id': m.GetResourceID(), 'nome': m.GetName(), 'v': m.GetVertexCount(), 't': m.GetTriangleCount(),
            'manifold_orientado': m.IsManifoldAndOriented(),
            'cor': cor_obj, 'cores_tri': sorted(tri_cores)
        })
    comps = []
    ci = model.GetComponentsObjects()
    while ci.MoveNext():
        c = ci.GetCurrentComponentsObject()
        comps.append({'id': c.GetResourceID(), 'nome': c.GetName(), 'n': c.GetComponentCount()})
    itens = []
    bi = model.GetBuildItems()
    while bi.MoveNext():
        b = bi.GetCurrent()
        t = b.GetObjectTransform()
        itens.append({'obj': b.GetObjectResourceID(), 'transform': [t.Fields[i][j] for i in range(4) for j in range(3)]})
    print(json.dumps({'unidade': int(unidade), 'grupos': {str(k): v for k, v in grupos.items()}, 'objetos': objetos,
                      'montagens': comps, 'itens': itens, 'avisos': avisos}))

if __name__ == '__main__':
    main(sys.argv[1])

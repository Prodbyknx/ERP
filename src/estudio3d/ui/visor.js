// Viewport 3D. Z pra cima (igual Bambu/Orca), mesa com grade de 1 cm,
// câmera orbital com amortecimento, gizmo de mover/girar/escalar.
// Cor na tela: o hex salvo é sRGB; aqui vira linear pro three.js, e o
// renderer devolve sRGB -> sob luz frontal a cor bate com o hex.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import { hexParaLinear, srgbParaLinear } from '../core/cores.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const VERDE = [0.05, 0.62, 0.18];
const AZUL = [0.02, 0.35, 0.95];
const CINZA = [0.42, 0.44, 0.47];

export class Visor {
  constructor(container, cena) {
    this.cena = cena;
    this.container = container;
    this.grupos = new Map();          // objeto.id -> THREE.Group
    this.itens = new Map();           // parte.id -> item
    this.selecaoFaces = new Map();    // parte.id -> Uint8Array
    this.mapas = new Map();           // parte.id -> Float32Array(3*nT) cores linear por face (modo de análise)
    this.modo = 'cores';
    this.arame = false;
    this.sombreado = 'suave';
    this.previa = null;
    this.eventos = new Map();

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.localClippingEnabled = true;
    r.domElement.className = 'e3d-canvas';
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#eceef1');
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(128 + 180, 128 - 260, 220);

    // luz: hemisfério forte + chave suave -> cor legível de qualquer lado
    s.add(new THREE.HemisphereLight(0xffffff, 0xb9b4ad, 2.1));
    const chave = new THREE.DirectionalLight(0xffffff, 1.25);
    chave.position.set(-0.6, -0.9, 1.4);
    this.camera.add(chave);
    const fundo = new THREE.DirectionalLight(0xffffff, 0.35);
    fundo.position.set(0.8, 0.6, -0.4);
    this.camera.add(fundo);
    s.add(this.camera);

    this.raizObjetos = new THREE.Group(); s.add(this.raizObjetos);
    this.raizPrevia = new THREE.Group(); s.add(this.raizPrevia);
    this.raizAjuda = new THREE.Group(); s.add(this.raizAjuda);
    this.montarMesa();

    const c = this.controles = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.12;
    c.screenSpacePanning = true;
    c.target.set(128, 128, 0);
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.addEventListener('change', () => this.pedirRender());

    const g = this.gizmo = new TransformControls(this.camera, r.domElement);
    g.setSize(0.9);
    g.addEventListener('dragging-changed', e => {
      c.enabled = !e.value;
      if (e.value) this.emitir('gizmo-inicio');
      else this.emitir('gizmo-fim', this.gizmo.object);
    });
    g.addEventListener('objectChange', () => { this.atualizarCaixaSel(); this.emitir('gizmo-mudou', this.gizmo.object); this.pedirRender(); });
    g.addEventListener('change', () => this.pedirRender());
    this.gizmoHelper = g.getHelper();
    s.add(this.gizmoHelper);
    this.modoGizmo = 'nenhum';

    this.caixaSel = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#e54c00'));
    this.caixaSel.visible = false;
    s.add(this.caixaSel);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;

    const ro = new ResizeObserver(() => this.redimensionar());
    ro.observe(container);
    this.redimensionar();
    this.precisaRender = true;
    this.ativo = true;
    const laco = () => {
      if (this.destruido) return;
      requestAnimationFrame(laco);
      if (!this.ativo) return;
      const mexeu = this.controles.update();
      if (mexeu || this.precisaRender) {
        this.precisaRender = false;
        // olhando de baixo (verso da peça), a placa da mesa não pode tapar a vista
        if (this.placa) this.placa.visible = this.camera.position.z > 0;
        this.renderer.render(this.scene, this.camera);
      }
    };
    requestAnimationFrame(laco);
  }

  on(ev, fn) { if (!this.eventos.has(ev)) this.eventos.set(ev, []); this.eventos.get(ev).push(fn); }
  emitir(ev, d) { (this.eventos.get(ev) || []).forEach(fn => fn(d)); }
  pedirRender() { this.precisaRender = true; }

  redimensionar() {
    const w = Math.max(50, this.container.clientWidth), h = Math.max(50, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pedirRender();
  }

  montarMesa() {
    if (this.mesa) { this.scene.remove(this.mesa); this.mesa.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const { x: W, y: H } = this.cena.mesa;
    const m = this.mesa = new THREE.Group();
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: '#dcd9d4', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    placa.position.set(W / 2, H / 2, -0.02);
    placa.userData.mesa = true;
    this.placa = placa;
    m.add(placa);
    const pts = [];
    for (let x = 0; x <= W + 1e-6; x += 10) pts.push(x, 0, 0, x, H, 0);
    for (let y = 0; y <= H + 1e-6; y += 10) pts.push(0, y, 0, W, y, 0);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grade = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: '#c3beb7' }));
    grade.position.z = 0.01;
    m.add(grade);
    const borda = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)), new THREE.LineBasicMaterial({ color: '#8b857d' }));
    borda.position.set(W / 2, H / 2, 0.02);
    m.add(borda);
    // eixos XYZ no canto da mesa
    const eixo = (x, y, z, cor) => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.05, x, y, z + 0.05], 3)); return new THREE.Line(b, new THREE.LineBasicMaterial({ color: cor })); };
    m.add(eixo(30, 0, 0, '#d1242f'), eixo(0, 30, 0, '#2da44e'), eixo(0, 0, 30, '#1f6feb'));
    this.scene.add(m);
    this.pedirRender();
  }

  /* ------------------------------------------------ geometria das peças */

  construirGeometria(malha) {
    const p = malha.pos, idx = malha.idx, nt = idx.length / 3, nv = p.length / 3;
    const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9);
    // normal da face (com área) e faces de cada vértice
    const fa = new Float32Array(nt * 3), fn = new Float32Array(nt * 3);
    const cont = new Uint32Array(nv + 1);
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      fa[t * 3] = nx; fa[t * 3 + 1] = ny; fa[t * 3 + 2] = nz;
      const L = Math.hypot(nx, ny, nz) || 1;
      fn[t * 3] = nx / L; fn[t * 3 + 1] = ny / L; fn[t * 3 + 2] = nz / L;
      cont[idx[t * 3] + 1]++; cont[idx[t * 3 + 1] + 1]++; cont[idx[t * 3 + 2] + 1]++;
    }
    for (let v = 0; v < nv; v++) cont[v + 1] += cont[v];
    const cur = cont.slice(0, nv), lista = new Uint32Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) lista[cur[idx[t * 3 + k]]++] = t;
    // suave com ângulo de quebra: cada canto mistura só as faces vizinhas
    // parecidas com ELA (face plana fica plana, dobra de 40°+ fica marcada)
    const suave = this.sombreado === 'suave', lim = Math.cos(40 * Math.PI / 180);
    for (let t = 0; t < nt; t++) {
      const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k], o = t * 9 + k * 3;
        pos[o] = p[v * 3]; pos[o + 1] = p[v * 3 + 1]; pos[o + 2] = p[v * 3 + 2];
        let nx = fx, ny = fy, nz = fz;
        if (suave) {
          let sx = 0, sy = 0, sz = 0;
          for (let q = cont[v]; q < cont[v + 1]; q++) {
            const f = lista[q];
            if (fn[f * 3] * fx + fn[f * 3 + 1] * fy + fn[f * 3 + 2] * fz >= lim) { sx += fa[f * 3]; sy += fa[f * 3 + 1]; sz += fa[f * 3 + 2]; }
          }
          const L = Math.hypot(sx, sy, sz);
          if (L > 0) { nx = sx / L; ny = sy / L; nz = sz / L; }
        }
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nt * 9), 3));
    const ind = nt * 3 > 65535 ? new Uint32Array(nt * 3) : new Uint16Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) ind[i] = i;
    g.setIndex(new THREE.BufferAttribute(ind, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.computeBoundsTree();
    g.userData.normaisFace = fn;
    return g;
  }

  coresBase(parte) {
    const m = parte.malha, nt = m.idx.length / 3;
    const out = new Float32Array(nt * 3);
    const padrao = hexParaLinear(parte.cor);
    const pal = m.cor && parte.paleta ? parte.paleta.map(hexParaLinear) : null;
    for (let t = 0; t < nt; t++) {
      const c = pal ? (pal[m.cor[t]] || padrao) : padrao;
      out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2];
    }
    return out;
  }

  novoItem(obj, parte, grupo) {
    const geom = this.construirGeometria(parte.malha);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { objeto: obj.id, parte: parte.id };
    grupo.add(mesh);
    const costas = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: '#d1242f', side: THREE.BackSide }));
    costas.visible = false; costas.raycast = () => {};
    grupo.add(costas);
    const arame = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: '#17140f', wireframe: true, transparent: true, opacity: 0.28, depthTest: true }));
    arame.visible = false; arame.raycast = () => {};
    grupo.add(arame);
    const item = { mesh, costas, arame, geom, malha: parte.malha, chaveCor: '', base: null, parte };
    this.itens.set(parte.id, item);
    return item;
  }

  descartarItem(id) {
    const it = this.itens.get(id);
    if (!it) return;
    for (const m of [it.mesh, it.costas, it.arame]) { if (m.parent) m.parent.remove(m); m.material.dispose(); }
    if (it.geom.disposeBoundsTree) it.geom.disposeBoundsTree();
    it.geom.dispose();
    this.itens.delete(id);
    this.selecaoFaces.delete(id);
  }

  sincronizar() {
    const vivos = new Set(), vivosObj = new Set();
    for (const o of this.cena.objetos) {
      vivosObj.add(o.id);
      let g = this.grupos.get(o.id);
      if (!g) { g = new THREE.Group(); g.userData.objeto = o.id; this.grupos.set(o.id, g); this.raizObjetos.add(g); }
      this.aplicarMatriz(g, o.transform);
      g.visible = o.visivel !== false;
      for (const p of o.partes) {
        vivos.add(p.id);
        let it = this.itens.get(p.id);
        if (it && (it.malha !== p.malha || it.mesh.parent !== g)) { this.descartarItem(p.id); it = null; }
        if (!it) it = this.novoItem(o, p, g);
        it.parte = p;
        it.mesh.visible = p.visivel !== false;
        const chave = p.cor + '|' + (p.paleta ? p.paleta.join(',') : '');
        if (chave !== it.chaveCor) { it.chaveCor = chave; it.base = this.coresBase(p); }
        this.pintar(p.id);
      }
    }
    for (const id of [...this.itens.keys()]) if (!vivos.has(id)) this.descartarItem(id);
    for (const [id, g] of [...this.grupos]) if (!vivosObj.has(id)) { this.raizObjetos.remove(g); this.grupos.delete(id); }
    this.atualizarGizmo();
    this.atualizarCaixaSel();
    this.pedirRender();
  }

  aplicarMatriz(g, t) {
    const m = new THREE.Matrix4().fromArray(t);
    m.decompose(g.position, g.quaternion, g.scale);
    g.updateMatrixWorld(true);
  }

  // cores da parte conforme o modo de visualização + seleção por face
  pintar(parteId) {
    const it = this.itens.get(parteId);
    if (!it) return;
    const nt = it.malha.idx.length / 3;
    const attr = it.geom.getAttribute('color');
    const c = attr.array;
    const sel = this.selecaoFaces.get(parteId);
    let fonte = it.base;
    const mapa = this.mapas.get(parteId);
    if (this.modo !== 'cores' && this.modo !== 'normais' && mapa) fonte = mapa;
    const normais = this.modo === 'normais';
    const azulClaro = [srgbParaLinear(150), srgbParaLinear(178), srgbParaLinear(214)];
    for (let t = 0; t < nt; t++) {
      let r, g, b;
      if (normais) { r = azulClaro[0]; g = azulClaro[1]; b = azulClaro[2]; }
      else { r = fonte[t * 3]; g = fonte[t * 3 + 1]; b = fonte[t * 3 + 2]; }
      if (sel && sel[t]) { r = r * 0.3 + VERDE[0] * 0.7; g = g * 0.3 + VERDE[1] * 0.7; b = b * 0.3 + VERDE[2] * 0.7; }
      const o = t * 9;
      c[o] = c[o + 3] = c[o + 6] = r; c[o + 1] = c[o + 4] = c[o + 7] = g; c[o + 2] = c[o + 5] = c[o + 8] = b;
    }
    attr.needsUpdate = true;
    it.costas.visible = normais && it.mesh.visible;
    it.arame.visible = this.arame && it.mesh.visible;
    this.pedirRender();
  }
  pintarTudo() { for (const id of this.itens.keys()) this.pintar(id); }

  definirModo(m) { this.modo = m; this.pintarTudo(); }
  definirArame(v) { this.arame = !!v; this.pintarTudo(); }
  definirSombreado(s) {
    this.sombreado = s;
    for (const id of [...this.itens.keys()]) this.descartarItem(id);
    this.sincronizar();
  }

  /* ------------------------------------------------ seleção por face */

  selecao(parteId) { return this.selecaoFaces.get(parteId) || null; }
  definirSelecao(parteId, mask) {
    if (mask) this.selecaoFaces.set(parteId, mask); else this.selecaoFaces.delete(parteId);
    this.pintar(parteId);
  }
  limparSelecoes() { const ids = [...this.selecaoFaces.keys()]; this.selecaoFaces.clear(); ids.forEach(id => this.pintar(id)); }

  /* ------------------------------------------------ câmera */

  enquadrar(caixa) {
    const cx = caixa || this.cena.caixaCena();
    let centro, raio;
    if (!cx) { centro = new THREE.Vector3(this.cena.mesa.x / 2, this.cena.mesa.y / 2, 0); raio = Math.max(this.cena.mesa.x, this.cena.mesa.y) * 0.6; }
    else {
      centro = new THREE.Vector3((cx.min[0] + cx.max[0]) / 2, (cx.min[1] + cx.max[1]) / 2, (cx.min[2] + cx.max[2]) / 2);
      raio = Math.max(5, Math.hypot(cx.tam[0], cx.tam[1], cx.tam[2]) / 2);
    }
    const dir = this.camera.position.clone().sub(this.controles.target).normalize();
    if (!isFinite(dir.x) || dir.length() < 0.5) dir.set(0.45, -0.7, 0.55).normalize();
    const d = raio / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.08;
    this.controles.target.copy(centro);
    this.camera.position.copy(centro).add(dir.multiplyScalar(d));
    this.camera.near = Math.max(0.05, d / 500); this.camera.far = d * 50;
    this.camera.updateProjectionMatrix();
    this.controles.update();
    this.pedirRender();
  }

  vista(tipo) {
    const t = this.controles.target;
    const d = this.camera.position.distanceTo(t) || 300;
    const dirs = { iso: [0.45, -0.7, 0.55], frente: [0, -1, 0.0001], tras: [0, 1, 0.0001], topo: [0.0001, -0.0001, 1], baixo: [0.0001, 0.0001, -1], esquerda: [-1, 0, 0.0001], direita: [1, 0, 0.0001] };
    const v = new THREE.Vector3(...(dirs[tipo] || dirs.iso)).normalize().multiplyScalar(d);
    this.camera.position.copy(t).add(v);
    this.controles.update();
    this.pedirRender();
  }

  /* ------------------------------------------------ gizmo e caixa */

  definirGizmo(modo) { this.modoGizmo = modo; this.atualizarGizmo(); }
  atualizarGizmo() {
    const o = this.cena.objetoSel();
    const g = o ? this.grupos.get(o.id) : null;
    if (!g || this.modoGizmo === 'nenhum' || this.previa) { if (this.gizmo.object) this.gizmo.detach(); }
    else {
      this.gizmo.setMode(this.modoGizmo === 'girar' ? 'rotate' : this.modoGizmo === 'escalar' ? 'scale' : 'translate');
      if (this.gizmo.object !== g) this.gizmo.attach(g);
    }
    this.pedirRender();
  }
  atualizarCaixaSel() {
    const o = this.cena.objetoSel();
    const g = o ? this.grupos.get(o.id) : null;
    if (!g || this.previa) { this.caixaSel.visible = false; return; }
    this.caixaSel.box.setFromObject(g, true);
    this.caixaSel.visible = true;
  }
  matrizDoGrupo(g) { g.updateMatrix(); return Float64Array.from(g.matrix.elements); }

  /* ------------------------------------------------ pontaria */

  pontoTela(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  intersectar(ev, filtro) {
    this.raycaster.setFromCamera(this.pontoTela(ev), this.camera);
    const alvos = [];
    for (const it of this.itens.values()) if (it.mesh.visible && it.mesh.parent && it.mesh.parent.visible && (!filtro || filtro(it))) alvos.push(it.mesh);
    const hits = this.raycaster.intersectObjects(alvos, false);
    if (!hits.length) return null;
    const h = hits[0];
    const geom = h.object.geometry;
    const face = (geom.index.array[h.faceIndex * 3] / 3) | 0;
    const fn = geom.userData.normaisFace;
    const nLocal = new THREE.Vector3(fn[face * 3], fn[face * 3 + 1], fn[face * 3 + 2]);
    const nMundo = nLocal.clone().transformDirection(h.object.matrixWorld);
    const local = h.object.worldToLocal(h.point.clone());
    return { objeto: h.object.userData.objeto, parte: h.object.userData.parte, face, ponto: h.point.clone(), local, normal: nMundo, normalLocal: nLocal, distancia: h.distance };
  }

  // ponto do mundo -> posição na tela (clientX/clientY)
  telaDe(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  // faces da parte dentro de uma esfera (pincel), em coordenadas do mundo
  facesNaEsfera(parteId, centro, raio, somenteFrente) {
    const it = this.itens.get(parteId);
    if (!it) return [];
    const inv = it.mesh.matrixWorld.clone().invert();
    const c = centro.clone().applyMatrix4(inv);
    const esc = new THREE.Vector3(); it.mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), esc);
    const r = raio / Math.max(1e-9, Math.min(Math.abs(esc.x), Math.abs(esc.y), Math.abs(esc.z)));
    const esfera = new THREE.Sphere(c, r);
    const idx = it.geom.index.array;
    const fn = it.geom.userData.normaisFace;
    const olho = this.camera.position.clone().applyMatrix4(inv);
    const out = [];
    it.geom.boundsTree.shapecast({
      intersectsBounds: box => box.intersectsSphere(esfera) ? INTERSECTED : NOT_INTERSECTED,
      intersectsTriangle: (tri, i) => {
        if (!tri.intersectsSphere(esfera)) return false;
        const f = (idx[i * 3] / 3) | 0;
        if (somenteFrente) {
          const px = tri.a.x - olho.x, py = tri.a.y - olho.y, pz = tri.a.z - olho.z;
          if (fn[f * 3] * px + fn[f * 3 + 1] * py + fn[f * 3 + 2] * pz > 0) return false;
        }
        out.push(f);
        return false;
      }
    });
    return out;
  }

  /* ------------------------------------------------ ajudas visuais */

  limparAjudas(tipo) {
    for (const o of [...this.raizAjuda.children]) {
      if (tipo && o.userData.tipo !== tipo) continue;
      this.raizAjuda.remove(o);
      o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
    }
    if (!tipo || tipo === 'corte') this.definirRecorte(null);
    this.pedirRender();
  }

  mostrarPincel(ponto, normal, raio) {
    let anel = this.raizAjuda.children.find(o => o.userData.tipo === 'pincel');
    if (!ponto) { if (anel) anel.visible = false; this.pedirRender(); return; }
    if (!anel) {
      anel = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: '#0ea34a', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
      anel.userData.tipo = 'pincel'; anel.renderOrder = 10;
      this.raizAjuda.add(anel);
    }
    anel.visible = true;
    anel.position.copy(ponto).addScaledVector(normal, 0.05);
    anel.lookAt(ponto.clone().add(normal));
    anel.scale.setScalar(raio);
    this.pedirRender();
  }

  // plano de corte + as duas metades pintadas (sem calcular nada)
  mostrarPlanoCorte(objId, plano, tamanho) {
    this.limparAjudas('corte');
    const n = new THREE.Vector3(...plano.n).normalize();
    const centro = n.clone().multiplyScalar(plano.d);
    const g = this.grupos.get(objId);
    if (g) {
      const bb = new THREE.Box3().setFromObject(g, true);
      const c = bb.getCenter(new THREE.Vector3());
      // projeta o centro da peça no plano
      centro.copy(c).addScaledVector(n, plano.d - n.dot(c));
    }
    const q = new THREE.Mesh(new THREE.PlaneGeometry(tamanho, tamanho), new THREE.MeshBasicMaterial({ color: '#1f6feb', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    q.position.copy(centro);
    q.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.userData.tipo = 'corte';
    const borda = new THREE.LineSegments(new THREE.EdgesGeometry(q.geometry), new THREE.LineBasicMaterial({ color: '#1f6feb' }));
    q.add(borda);
    q.raycast = () => {};
    this.raizAjuda.add(q);
    this.definirRecorte({ objId, plano });
  }

  // recorte visual: parte de cima normal, parte de baixo azulada
  definirRecorte(cfg) {
    for (const [id, it] of this.itens) {
      it.mesh.material.clippingPlanes = null;
      it.mesh.material.needsUpdate = true;
      if (it.metadeB) { it.metadeB.parent && it.metadeB.parent.remove(it.metadeB); it.metadeB.material.dispose(); it.metadeB = null; }
      void id;
    }
    if (cfg) {
      const o = this.cena.objeto(cfg.objId);
      const P = new THREE.Plane(new THREE.Vector3(...cfg.plano.n).normalize(), -cfg.plano.d);
      const Pb = P.clone().negate();
      if (o) for (const p of o.partes) {
        const it = this.itens.get(p.id);
        if (!it) continue;
        it.mesh.material.clippingPlanes = [P];
        it.mesh.material.needsUpdate = true;
        const b = new THREE.Mesh(it.geom, new THREE.MeshStandardMaterial({ color: '#7fa6ff', roughness: 0.8, clippingPlanes: [Pb] }));
        b.raycast = () => {};
        it.mesh.parent.add(b);
        it.metadeB = b;
      }
    }
    this.pedirRender();
  }

  mostrarContornos(lacos3D, cor, tipo = 'contorno') {
    this.limparAjudas(tipo);
    for (const l of lacos3D) {
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', new THREE.Float32BufferAttribute(l, 3));
      const linha = new THREE.LineLoop(b, new THREE.LineBasicMaterial({ color: cor || '#e54c00', depthTest: false }));
      linha.renderOrder = 11;
      linha.userData.tipo = tipo;
      this.raizAjuda.add(linha);
    }
    this.pedirRender();
  }

  /* ------------------------------------------------ prévia */

  // objetos: [{objeto (com transform), partes:[{malha, papel:'novo'|'resto'|'normal', origem?}]}]
  mostrarPrevia(objetos, explodir = 0) {
    this.limparPrevia();
    this.previa = true;
    this.raizObjetos.visible = false;
    this.gizmo.detach();
    this.caixaSel.visible = false;
    for (const o of objetos) {
      const g = new THREE.Group();
      this.aplicarMatriz(g, o.transform);
      if (o.deslocar) g.position.add(new THREE.Vector3(...o.deslocar).multiplyScalar(explodir));
      for (const p of o.partes) {
        const geom = this.construirGeometria(p.malha);
        const cor = geom.getAttribute('color').array;
        const nt = p.malha.idx.length / 3;
        const base = p.papel === 'novo' ? VERDE : p.papel === 'resto' ? CINZA : null;
        const pal = base ? null : this.coresBase(p);
        for (let t = 0; t < nt; t++) {
          let c = base ? base : [pal[t * 3], pal[t * 3 + 1], pal[t * 3 + 2]];
          if (p.origem && p.origem[t] < 0) c = AZUL;
          for (let k = 0; k < 3; k++) { const q = t * 9 + k * 3; cor[q] = c[0]; cor[q + 1] = c[1]; cor[q + 2] = c[2]; }
        }
        g.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })));
      }
      this.raizPrevia.add(g);
    }
    this.pedirRender();
  }
  limparPrevia() {
    for (const g of [...this.raizPrevia.children]) {
      this.raizPrevia.remove(g);
      g.traverse(x => { if (x.geometry) { if (x.geometry.disposeBoundsTree) x.geometry.disposeBoundsTree(); x.geometry.dispose(); } if (x.material) x.material.dispose(); });
    }
    this.previa = null;
    this.raizObjetos.visible = true;
    this.atualizarGizmo();
    this.atualizarCaixaSel();
    this.pedirRender();
  }

  // PNG da vista atual (miniatura do 3MF)
  async miniatura(tam = 256) {
    const velho = { w: this.renderer.domElement.width, h: this.renderer.domElement.height, asp: this.camera.aspect };
    const ajudaVis = this.raizAjuda.visible, gizVis = this.gizmoHelper.visible, cxVis = this.caixaSel.visible;
    this.raizAjuda.visible = false; this.gizmoHelper.visible = false; this.caixaSel.visible = false;
    this.renderer.setSize(tam, tam, false);
    this.camera.aspect = 1; this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise(r => this.renderer.domElement.toBlob(r, 'image/png'));
    this.raizAjuda.visible = ajudaVis; this.gizmoHelper.visible = gizVis; this.caixaSel.visible = cxVis;
    this.renderer.setSize(velho.w / this.renderer.getPixelRatio(), velho.h / this.renderer.getPixelRatio(), false);
    this.redimensionar();
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  destruir() {
    this.destruido = true;
    for (const id of [...this.itens.keys()]) this.descartarItem(id);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

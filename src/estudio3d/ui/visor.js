// Viewport 3D. Z pra cima (igual Bambu/Orca), mesa com grade de 1 cm,
// câmera orbital com amortecimento, gizmo de mover/girar/escalar.
// Cor na tela: o hex salvo é sRGB; aqui vira linear pro three.js, e o
// renderer devolve sRGB -> sob luz frontal a cor bate com o hex.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import { MeshBVH } from 'three-mesh-bvh';
import { hexParaLinear, srgbParaLinear } from '../core/cores.js';
import { prepararRender, segmentosDaSecao } from '../core/render.js';
import { cacheRender } from './cacheRender.js';

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

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.localClippingEnabled = true;
    r.domElement.className = 'e3d-canvas';
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = null;           // fundo em gradiente vem do CSS (segue o tema)
    r.setClearColor(0x000000, 0);
    this.escuro = document.documentElement.dataset.tema === 'escuro';
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
    g.addEventListener('objectChange', () => { this.caixaAoArrastar(); this.emitir('gizmo-mudou', this.gizmo.object); this.pedirRender(); });
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
    const T = this.escuro ? { placa: '#2a2e35', grade: '#3b414b', borda: '#5d6571' } : { placa: '#dedbd6', grade: '#c6c1ba', borda: '#8b857d' };
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: T.placa, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    placa.position.set(W / 2, H / 2, -0.02);
    placa.userData.mesa = true;
    this.placa = placa;
    m.add(placa);
    const pts = [];
    for (let x = 0; x <= W + 1e-6; x += 10) pts.push(x, 0, 0, x, H, 0);
    for (let y = 0; y <= H + 1e-6; y += 10) pts.push(0, y, 0, W, y, 0);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grade = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: T.grade }));
    grade.position.z = 0.01;
    m.add(grade);
    const borda = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)), new THREE.LineBasicMaterial({ color: T.borda }));
    borda.position.set(W / 2, H / 2, 0.02);
    m.add(borda);
    // eixos XYZ no canto da mesa
    const eixo = (x, y, z, cor) => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.05, x, y, z + 0.05], 3)); return new THREE.Line(b, new THREE.LineBasicMaterial({ color: cor })); };
    m.add(eixo(30, 0, 0, '#d1242f'), eixo(0, 30, 0, '#2da44e'), eixo(0, 0, 30, '#1f6feb'));
    this.scene.add(m);
    this.pedirRender();
  }

  definirTema(escuro) {
    if (!!escuro === !!this.escuro) return;
    this.escuro = !!escuro;
    this.montarMesa();
  }

  /* ------------------------------------------------ geometria das peças */

  // dados de exibição: do cache (vieram prontos do worker) ou calculados aqui
  dadosRender(malha) {
    if (this.sombreado !== 'suave') return prepararRender(malha, { suave: false });
    let e = cacheRender.obter(malha);
    if (!e) e = cacheRender.guardar(malha, prepararRender(malha));
    return e.prep;
  }

  // opc.pontaria: a peça vai receber clique/pincel -> encaixa (ou pede) a BVH
  construirGeometria(malha, opc = {}) {
    const prep = this.dadosRender(malha);
    const nt = malha.idx.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(prep.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(prep.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nt * 9), 3));
    const ind = nt * 3 > 65535 ? new Uint32Array(nt * 3) : new Uint16Array(nt * 3);
    for (let i = 0; i < ind.length; i++) ind[i] = i;
    g.setIndex(new THREE.BufferAttribute(ind, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.normaisFace = prep.fn;
    g.userData.malha = malha;
    if (opc.pontaria !== false) this.encaixarBVH(g, malha);
    return g;
  }

  // BVH pronta no cache -> encaixa na hora; senão pede pro worker auxiliar.
  // Enquanto não chega, o clique funciona sem ela (um pouco mais lento) e o
  // pincel monta uma na hora se precisar.
  encaixarBVH(g, malha) {
    if (g.boundsTree) return;
    const e = cacheRender.obter(malha);
    if (e && e.bvh) { g.boundsTree = MeshBVH.deserialize(e.bvh, g, { setIndex: true }); return; }
    this.encomendarBVH(malha);
  }
  encomendarBVH(malha) {
    const e = cacheRender.obter(malha);
    if (!e || e.bvh || e.pedidoBVH || !this.pedirBVH) return;
    e.pedidoBVH = true;
    this.pedirBVH(malha).then(d => {
      if (!d) { e.pedidoBVH = false; return; }
      e.bvh = d;
      for (const it of this.itens.values()) if (it.malha === malha && !it.geom.boundsTree) it.geom.boundsTree = MeshBVH.deserialize(d, it.geom, { setIndex: true });
    }, () => { e.pedidoBVH = false; });
  }
  garantirBVH(g) { if (!g.boundsTree) g.computeBoundsTree(); return g.boundsTree; }

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

  coresFuro(m) {
    const nt = m.idx.length / 3, out = new Float32Array(nt * 3), c = hexParaLinear('#e5484d');
    for (let t = 0; t < nt; t++) { out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2]; }
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
    // peça nova de um objeto que está sendo cortado entra já recortada
    if (this.corte && this.corte.objId === obj.id) {
      mat.clippingPlanes = [this.clipA];
      const b = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: '#7fa6ff', roughness: 0.8, clippingPlanes: [this.clipB] }));
      b.raycast = () => {};
      grupo.add(b);
      item.metadeB = b;
    }
    return item;
  }

  descartarItem(id) {
    const it = this.itens.get(id);
    if (!it) return;
    for (const m of [it.mesh, it.costas, it.arame, it.metadeB]) { if (!m) continue; if (m.parent) m.parent.remove(m); m.material.dispose(); }
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
      const furo = o.papel === 'furo';
      for (const p of o.partes) {
        vivos.add(p.id);
        const mEx = this.exibir ? this.exibir(o, p) : p.malha;
        let it = this.itens.get(p.id);
        if (it && (it.malha !== mEx || it.mesh.parent !== g)) { this.descartarItem(p.id); it = null; }
        if (!it) it = this.novoItem(o, mEx === p.malha ? p : { ...p, malha: mEx }, g);
        it.parte = p;
        it.mesh.visible = p.visivel !== false;
        // furo: vermelho translúcido (mostra o que vai sair da peça)
        const mat = it.mesh.material;
        if (mat.transparent !== furo) { mat.transparent = furo; mat.opacity = furo ? 0.42 : 1; mat.depthWrite = !furo; mat.needsUpdate = true; }
        it.mesh.renderOrder = furo ? 5 : 0;
        const chave = (furo ? 'furo|' : '') + p.cor + '|' + (p.paleta ? p.paleta.join(',') : '') + '|' + it.malha.idx.length;
        if (chave !== it.chaveCor) { it.chaveCor = chave; it.base = furo ? this.coresFuro(it.malha) : this.coresBase({ ...p, malha: it.malha }); }
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
    let sel = this.selecaoFaces.get(parteId);
    if (sel && sel.length !== nt) sel = null;
    let fonte = it.base;
    let mapa = this.mapas.get(parteId);
    if (mapa && mapa.length !== nt * 3) mapa = null;        // mapa de outra geometria (ex.: prévia dos furos)
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
  // ímã: mover de 1 em 1 mm, girar de 15 em 15°, escalar de 5 em 5%
  definirIma(on) {
    this.ima = !!on;
    this.gizmo.setTranslationSnap(on ? 1 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.05 : null);
  }
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
    // as outras peças da seleção múltipla ganham caixa azul
    if (!this.caixasExtra) this.caixasExtra = [];
    const extras = this.previa ? [] : this.cena.objetosSel().filter(x => x !== o);
    while (this.caixasExtra.length < extras.length) { const h = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#1f6feb')); this.scene.add(h); this.caixasExtra.push(h); }
    this.caixasExtra.forEach((h, i) => {
      const c = extras[i] && this.cena.caixaExata(extras[i]);
      h.visible = !!c;
      if (c) { h.box.min.set(c.min[0], c.min[1], c.min[2]); h.box.max.set(c.max[0], c.max[1], c.max[2]); }
    });
    if (!g || this.previa) { this.caixaSel.visible = false; return; }
    const c = this.cena.caixaExata(o);
    if (!c) { this.caixaSel.visible = false; return; }
    this.caixaSel.box.min.set(c.min[0], c.min[1], c.min[2]);
    this.caixaSel.box.max.set(c.max[0], c.max[1], c.max[2]);
    this.caixaSel.visible = true;
  }
  caixaAoArrastar() {
    const g = this.gizmo.object;
    const o = g && this.cena.objeto(g.userData.objeto);
    if (!o) return;
    const c = this.cena.caixaExata({ ...o, transform: this.matrizDoGrupo(g) });
    if (!c) return;
    this.caixaSel.box.min.set(c.min[0], c.min[1], c.min[2]);
    this.caixaSel.box.max.set(c.max[0], c.max[1], c.max[2]);
  }
  matrizDoGrupo(g) { g.updateMatrix(); return Float64Array.from(g.matrix.elements); }

  /* ------------------------------------------------ pontaria */

  pontoTela(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  // ponto do mouse no plano da mesa (z = 0), no mundo
  // ponto onde o raio do mouse cruza o plano n·p = d (desenho em pé)
  pontoNoPlano(ev, n, d) {
    this.raycaster.setFromCamera(this.pontoTela(ev), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]), -d), p) ? p : null;
  }

  pontoNaMesa(ev) {
    this.raycaster.setFromCamera(this.pontoTela(ev), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p) ? p : null;
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
    this.garantirBVH(it.geom).shapecast({
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
      if (o === this.corte?.raiz) continue;
      this.raizAjuda.remove(o);
      o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
    }
    if (!tipo || tipo === 'corte') this.esconderCorte();
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

  /* ------------------------------------------------ plano de corte
     Montado uma vez; mover o corte só muda números (posição do plano e do
     recorte) — nada é recriado, nada é recompilado. Arrastar fica liso. */

  montarCorte() {
    if (this.corte) return this.corte;
    const raiz = new THREE.Group(); raiz.userData.tipo = 'corte-fixo';
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#1f6feb', transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    const borda = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#1f6feb', transparent: true, opacity: 0.8 }));
    quad.add(borda);
    quad.raycast = () => {};
    // seta pra arrastar (sempre visível, por cima da peça)
    const alca = new THREE.Group();
    const matAlca = new THREE.MeshBasicMaterial({ color: '#1f6feb', depthTest: false, transparent: true });
    const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 12), matAlca);
    haste.rotation.x = Math.PI / 2; haste.position.z = 0;
    const ponta1 = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 20), matAlca);
    ponta1.rotation.x = Math.PI / 2; ponta1.position.z = 0.42;
    const ponta2 = ponta1.clone(); ponta2.rotation.x = -Math.PI / 2; ponta2.position.z = -0.42;
    const bolinha = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
    // área de pegar maior que o desenho (fácil de acertar)
    const pega = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.3, 8), new THREE.MeshBasicMaterial({ visible: false }));
    pega.rotation.x = Math.PI / 2;
    alca.add(haste, ponta1, ponta2, bolinha, pega);
    alca.traverse(x => { x.renderOrder = 20; });
    const secao = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffb000', depthTest: false, transparent: true }));
    secao.renderOrder = 19; secao.frustumCulled = false; secao.raycast = () => {};
    raiz.add(quad, alca, secao);
    raiz.visible = false;
    this.raizAjuda.add(raiz);
    this.clipA = new THREE.Plane(); this.clipB = new THREE.Plane();
    this.corte = { raiz, quad, alca, pega, secao, matAlca, objId: null, plano: null, buf: null };
    return this.corte;
  }

  // mostra/atualiza o plano (mundo: n·x = d) no objeto
  // opc.centro (mundo): onde desenhar o plano; opc.local: corte só de uma
  // parte -> sem recortar a peça inteira e contorno só perto do centro
  mostrarPlanoCorte(objId, plano, tamanho, opc = {}) {
    const c = this.montarCorte();
    const n = new THREE.Vector3(...plano.n).normalize();
    const o = this.cena.objeto(objId);
    const cx = o && this.cena.caixaExata(o);
    const centroObj = opc.centro ? new THREE.Vector3(...opc.centro) : cx ? new THREE.Vector3((cx.min[0] + cx.max[0]) / 2, (cx.min[1] + cx.max[1]) / 2, (cx.min[2] + cx.max[2]) / 2) : new THREE.Vector3();
    const centro = centroObj.clone().addScaledVector(n, plano.d - n.dot(centroObj));
    c.local = opc.local ? { centro: centro.clone(), raio: tamanho * 0.6 } : null;
    c.quad.position.copy(centro);
    c.quad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    c.quad.scale.set(tamanho, tamanho, 1);
    c.alca.position.copy(centro);
    c.alca.quaternion.copy(c.quad.quaternion);
    c.alca.scale.setScalar(Math.max(4, tamanho * 0.22));
    c.centro = centro; c.n = n;
    this.clipA.set(n, -plano.d);                       // mostra o lado +n
    this.clipB.set(n.clone().negate(), plano.d);       // mostra o lado -n
    if (c.objId !== objId || c.recorteLocal !== !!opc.local) { c.objId = objId; c.recorteLocal = !!opc.local; this.aplicarRecorte(opc.local ? null : objId); }
    c.plano = { n: plano.n, d: plano.d };
    c.raiz.visible = true;
    this.agendarSecao();
    this.pedirRender();
  }

  esconderCorte() {
    if (!this.corte) return;
    this.corte.raiz.visible = false;
    if (this.corte.objId) this.aplicarRecorte(null);
    this.corte.objId = null;
    this.pedirRender();
  }

  // metade de cima com a cor da peça, de baixo azulada (só muda material ao
  // trocar de objeto; mover o plano mexe só em clipA/clipB)
  aplicarRecorte(objId) {
    for (const it of this.itens.values()) {
      if (it.mesh.material.clippingPlanes) { it.mesh.material.clippingPlanes = null; it.mesh.material.needsUpdate = true; }
      if (it.metadeB) { it.metadeB.parent && it.metadeB.parent.remove(it.metadeB); it.metadeB.material.dispose(); it.metadeB = null; }
    }
    const o = objId && this.cena.objeto(objId);
    if (o) for (const p of o.partes) {
      const it = this.itens.get(p.id);
      if (!it) continue;
      it.mesh.material.clippingPlanes = [this.clipA];
      it.mesh.material.needsUpdate = true;
      const b = new THREE.Mesh(it.geom, new THREE.MeshStandardMaterial({ color: '#7fa6ff', roughness: 0.8, clippingPlanes: [this.clipB] }));
      b.raycast = () => {};
      it.mesh.parent.add(b);
      it.metadeB = b;
    }
    this.pedirRender();
  }
  // compatibilidade: definirRecorte(null) esconde
  definirRecorte(cfg) { if (!cfg) this.esconderCorte(); else this.mostrarPlanoCorte(cfg.objId, cfg.plano, 100); }

  // contorno da seção (onde a faca passa) + medida, no próximo quadro
  agendarSecao() {
    if (this._secaoAgendada) return;
    this._secaoAgendada = true;
    requestAnimationFrame(() => { this._secaoAgendada = false; this.atualizarSecao(); });
  }
  atualizarSecao() {
    const c = this.corte;
    if (!c || !c.raiz.visible || !c.plano) return;
    const o = this.cena.objeto(c.objId);
    const g = o && this.grupos.get(o.id);
    if (!g) return;
    g.updateMatrixWorld(true);
    const M = g.matrixWorld, t = M.elements;
    // plano no referencial da peça
    const n = c.plano.n, nl = [t[0] * n[0] + t[1] * n[1] + t[2] * n[2], t[4] * n[0] + t[5] * n[1] + t[6] * n[2], t[8] * n[0] + t[9] * n[1] + t[10] * n[2]];
    const L = Math.hypot(nl[0], nl[1], nl[2]) || 1;
    const dl = (c.plano.d - (n[0] * t[12] + n[1] * t[13] + n[2] * t[14])) / L;
    const pl = { n: [nl[0] / L, nl[1] / L, nl[2] / L], d: dl };
    let total = 0, buf = c.buf;
    const partes = [];
    if (!this._bufSecao) this._bufSecao = new WeakMap();
    for (const p of o.partes) {
      if (p.visivel === false) continue;
      const r = segmentosDaSecao(p.malha, pl, this._bufSecao.get(p.malha));
      this._bufSecao.set(p.malha, r.saida);
      partes.push(r);
      total += r.n;
    }
    if (!buf || buf.length < total) buf = c.buf = new Float32Array(Math.max(6 * 1024, total * 2));
    let k = 0;
    if (c.local) {
      // corte de uma parte só: contorno só perto do centro (não o corpo todo)
      const q = new THREE.Vector3(), q2 = new THREE.Vector3(), R2 = c.local.raio * c.local.raio;
      for (const r of partes) for (let i = 0; i + 5 < r.n; i += 6) {
        q.set(r.saida[i], r.saida[i + 1], r.saida[i + 2]).applyMatrix4(M);
        q2.set(r.saida[i + 3], r.saida[i + 4], r.saida[i + 5]).applyMatrix4(M);
        if (q.distanceToSquared(c.local.centro) > R2 && q2.distanceToSquared(c.local.centro) > R2) continue;
        for (let j = 0; j < 6; j++) buf[k++] = r.saida[i + j];
      }
    } else for (const r of partes) { buf.set(r.saida.subarray(0, r.n), k); k += r.n; }
    const geo = c.secao.geometry;
    let attr = geo.getAttribute('position');
    if (!attr || attr.array !== buf) { attr = new THREE.BufferAttribute(buf, 3); attr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('position', attr); }
    attr.needsUpdate = true;
    geo.setDrawRange(0, k / 3);
    geo.computeBoundingSphere();
    c.secao.matrixAutoUpdate = false;
    c.secao.matrix.copy(M);
    c.secao.matrixWorldNeedsUpdate = true;
    // medida da seção no plano (largura × altura)
    const u = new THREE.Vector3(), v = new THREE.Vector3(), N = c.n.clone();
    u.set(Math.abs(N.z) > 0.9 ? 1 : 0, 0, Math.abs(N.z) > 0.9 ? 0 : 1).cross(N).normalize(); v.crossVectors(N, u).normalize();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const q = new THREE.Vector3();
    for (let i = 0; i < k; i += 3) {
      q.set(buf[i], buf[i + 1], buf[i + 2]).applyMatrix4(M);
      const a = q.dot(u), b = q.dot(v);
      if (a < u0) u0 = a; if (a > u1) u1 = a; if (b < v0) v0 = b; if (b > v1) v1 = b;
    }
    this.medidaSecao = k ? { largura: u1 - u0, altura: v1 - v0, segmentos: k / 6 } : null;
    this.emitir('secao', this.medidaSecao);
    this.pedirRender();
  }

  // pontaria na seta do corte (pra arrastar)
  acertouAlcaCorte(ev) {
    const c = this.corte;
    if (!c || !c.raiz.visible) return false;
    this.raycaster.setFromCamera(this.pontoTela(ev), this.camera);
    const fh = this.raycaster.firstHitOnly; this.raycaster.firstHitOnly = false;
    const h = this.raycaster.intersectObject(c.alca, true);
    this.raycaster.firstHitOnly = fh;
    return h.length > 0;
  }
  // posição d (n·x = d) sob o mouse ao arrastar a seta ao longo da normal
  dDoArrasto(ev) {
    const c = this.corte;
    this.raycaster.setFromCamera(this.pontoTela(ev), this.camera);
    const r = this.raycaster.ray;
    // ponto da reta (centro + s·n) mais perto do raio do mouse
    const w0 = c.centro.clone().sub(r.origin);
    const a = c.n.dot(c.n), b = c.n.dot(r.direction), cc = r.direction.dot(r.direction), dd = c.n.dot(w0), e = r.direction.dot(w0);
    const den = a * cc - b * b;
    if (Math.abs(den) < 1e-9) return null;
    const s = (b * e - cc * dd) / den;
    return c.n.dot(c.centro) + s;
  }
  realcarAlcaCorte(on) {
    if (!this.corte) return;
    this.corte.matAlca.color.set(on ? '#e54c00' : '#1f6feb');
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
        const geom = this.construirGeometria(p.malha, { pontaria: false });
        // a peça provavelmente vai ficar: já pede a estrutura de pontaria
        if (p.papel !== 'resto') this.encomendarBVH(p.malha);
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
    const fundo = this.scene.background;
    this.scene.background = new THREE.Color(this.escuro ? '#1b1e24' : '#eef0f3');
    this.renderer.render(this.scene, this.camera);
    this.scene.background = fundo;
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

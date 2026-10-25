// 3D map viewer. Only displays a precomputed scan bundle; no SLAM runs in the browser.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EDGE = 0x8a8f98, OBJ = 0xb4a58a, PATH = 0x378add, DOT = 0x185fa5, DOT_SEL = 0xef9f27;

function badge(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
  g.lineWidth = 5; g.strokeStyle = '#185fa5'; g.stroke();
  g.fillStyle = '#042c53'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 34);
  return new THREE.CanvasTexture(c);
}

export function createViewer(el, scan, { numbers = {}, selected = null, state = null, onSelect = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.replaceChildren(renderer.domElement);

  const { width: W, depth: D, height: H } = scan.room;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const home = { pos: [W * 0.95, H * 1.5, D * 1.5], target: [0, H * 0.35, 0] };
  const draw = () => renderer.render(scene, camera);

  const edges = (w, h, d, color, at) => {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color }));
    l.position.set(...at);
    scene.add(l);
  };
  edges(W, H, D, EDGE, [0, H / 2, 0]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  scene.add(floor);
  for (const o of scan.objects || []) edges(...o.size, OBJ, o.center);

  if (scan.trajectory?.length > 1) {
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(scan.trajectory.map((p) => new THREE.Vector3(...p))),
      new THREE.LineDashedMaterial({ color: PATH, dashSize: 0.12, gapSize: 0.08 }));
    path.computeLineDistances();
    scene.add(path);
  }

  const pins = [];
  for (const t of scan.tags || []) {
    const n = numbers[t.tagId];
    if (!n) continue;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: DOT }));
    dot.position.set(...t.position);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge(n), depthTest: false }));
    sprite.position.set(t.position[0], t.position[1] + 0.3, t.position[2]);
    sprite.userData.id = t.tagId;
    scene.add(dot, sprite);
    pins.push({ id: t.tagId, dot, sprite });
  }
  const select = (id) => {
    for (const p of pins) {
      const on = p.id === id;
      p.sprite.scale.setScalar(on ? 0.6 : 0.4);
      p.dot.material.color.setHex(on ? DOT_SEL : DOT);
    }
    draw();
  };

  const controls = new OrbitControls(camera, renderer.domElement);
  const setView = (v) => { camera.position.fromArray(v.pos); controls.target.fromArray(v.target); controls.update(); draw(); };
  controls.addEventListener('change', draw);
  controls.listenToKeyEvents(el);

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('click', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pins.map((p) => p.sprite))[0];
    if (hit) onSelect(hit.object.userData.id);
  });

  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  setView(state || home);
  select(selected);
  resize();

  return {
    select,
    reset: () => setView(home),
    getState: () => ({ pos: camera.position.toArray(), target: controls.target.toArray() }),
    dispose() { ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.forceContextLoss(); el.replaceChildren(); },
  };
}

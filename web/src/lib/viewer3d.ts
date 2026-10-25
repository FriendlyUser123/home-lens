// 3D room viewer (three.js). Ported from Dhruv's static viewer.js (web-static/viewer.js): draws a scan bundle
// (room box, objects, trajectory, tag pins) and, new here, a real PLY cloud/mesh with tags at their `position` [m].
// It only displays a scan that was computed elsewhere; no SLAM runs in the browser.
import {
  AmbientLight, BufferGeometry, CanvasTexture, Color, DoubleSide, EdgesGeometry, Group, Line, LineBasicMaterial,
  LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial, Raycaster, Scene,
  SphereGeometry, Sprite, SpriteMaterial, Vector2, Vector3, WebGLRenderer, BoxGeometry,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { robustBounds, type Cloud, type Pin, type ScanBundle, type Up, type Vec3 } from "./scan3d.ts";

const EDGE = 0x8a8f98, OBJ = 0xb4a58a, PATH = 0x378add, DOT = 0x23406b, DOT_SEL = 0xffd21f;

export interface ViewerContent {
  cloud: Cloud | null;
  bundle: ScanBundle | null;
  pins: Pin[];
  up: Up;
}

export interface Viewer {
  setContent: (c: ViewerContent) => void;
  select: (id: string | null) => void;
  /** Animates the camera to a pin. Resolves when it arrives (immediately with reduced motion). */
  flyTo: (id: string) => Promise<void>;
  reset: () => void;
  setUp: (up: Up) => void;
  dispose: () => void;
}

export interface ViewerOptions {
  onSelect?: (id: string) => void;
  reducedMotion?: boolean;
}

function badge(text: string, selected: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = selected ? "#FFD21F" : "#fff";
    g.beginPath(); g.arc(48, 48, 42, 0, 7); g.fill();
    g.lineWidth = 7; g.strokeStyle = "#17202B"; g.stroke();
    g.fillStyle = "#17202B"; g.font = "700 46px 'Barlow Condensed', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 48, 51);
  }
  return new CanvasTexture(c);
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Throws when WebGL is not available. */
export function createViewer(el: HTMLElement, opts: ViewerOptions = {}): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.replaceChildren(renderer.domElement);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1));
  const camera = new PerspectiveCamera(50, 1, 0.05, 500);
  const world = new Group();
  scene.add(world);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  let content: ViewerContent = { cloud: null, bundle: null, pins: [], up: "y" };
  let center = new Vector3(), radius = 3;
  let pinObjs: { pin: Pin; dot: Mesh; sprite: Sprite; normal: CanvasTexture; chosen: CanvasTexture }[] = [];
  let selected: string | null = null;
  let anim = 0;
  const draw = (): void => renderer.render(scene, camera);
  controls.addEventListener("change", draw);

  function clear(): void {
    world.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry && !(content.cloud && m.geometry === content.cloud.geometry)) m.geometry.dispose();
      const mat = (m as { material?: { dispose?: () => void; map?: { dispose: () => void } | null } }).material;
      mat?.map?.dispose();
      mat?.dispose?.();
    });
    world.clear();
    pinObjs = [];
  }

  const upVec = (): Vector3 => (content.up === "z" ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0));
  const toWorld = (p: Vec3): Vector3 => world.localToWorld(new Vector3(...p));

  function edges(w: number, h: number, d: number, color: number, at: Vec3): void {
    const l = new LineSegments(new EdgesGeometry(new BoxGeometry(w, h, d)), new LineBasicMaterial({ color }));
    l.position.set(...at);
    world.add(l);
  }

  function build(): void {
    world.rotation.set(content.up === "z" ? -Math.PI / 2 : 0, 0, 0);
    world.updateMatrixWorld(true);
    let min = new Vector3(-2, 0, -2), max = new Vector3(2, 2.5, 2);
    const { cloud, bundle } = content;
    if (cloud) {
      const pos = cloud.geometry.getAttribute("position");
      const b = robustBounds(pos.array as ArrayLike<number>);
      min = new Vector3(...b.min); max = new Vector3(...b.max);
      let obj: Points | Mesh;
      if (cloud.kind === "points") {
        const hasColor = !!cloud.geometry.getAttribute("color");
        obj = new Points(cloud.geometry, new PointsMaterial({ size: 0.035, sizeAttenuation: true, vertexColors: hasColor, color: hasColor ? 0xffffff : 0x4a5666 }));
      } else {
        const hasColor = !!cloud.geometry.getAttribute("color");
        obj = new Mesh(cloud.geometry, new MeshBasicMaterial({ vertexColors: hasColor, color: hasColor ? 0xffffff : 0x9aa0a6, side: DoubleSide }));
      }
      obj.frustumCulled = false;
      world.add(obj);
    }
    if (bundle) {
      const { width: W, depth: D, height: H } = bundle.room;
      if (!cloud) { min = new Vector3(-W / 2, 0, -D / 2); max = new Vector3(W / 2, H, D / 2); }
      edges(W, H, D, EDGE, [0, H / 2, 0]);
      const floor = new Mesh(new PlaneGeometry(W, D).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.18, side: DoubleSide }));
      world.add(floor);
      for (const o of bundle.objects) edges(o.size[0], o.size[1], o.size[2], OBJ, o.center);
      if (bundle.trajectory.length > 1) {
        const path = new Line(new BufferGeometry().setFromPoints(bundle.trajectory.map((p) => new Vector3(...p))), new LineDashedMaterial({ color: PATH, dashSize: 0.12, gapSize: 0.08 }));
        path.computeLineDistances();
        world.add(path);
      }
    }
    // frame the room: bounds are in local coords, so convert through the world transform
    const box = [new Vector3(min.x, min.y, min.z), new Vector3(max.x, max.y, max.z)].map((v) => world.localToWorld(v));
    const lo = new Vector3().copy(box[0]!).min(box[1]!), hi = new Vector3().copy(box[0]!).max(box[1]!);
    center = lo.clone().add(hi).multiplyScalar(0.5);
    radius = Math.max(1.5, lo.distanceTo(hi) / 2);

    const k = Math.max(0.6, Math.min(1.6, radius / 3));
    for (const pin of content.pins) {
      const dot = new Mesh(new SphereGeometry(0.07 * k), new MeshBasicMaterial({ color: DOT, depthTest: false }));
      dot.renderOrder = 2;
      dot.position.set(...pin.position);
      const normalTex = badge(pin.label, false), chosenTex = badge(pin.label, true);
      const sprite = new Sprite(new SpriteMaterial({ map: normalTex, depthTest: false, sizeAttenuation: false }));
      sprite.renderOrder = 3;
      const lift = new Vector3(0, 0, 0);
      if (content.up === "z") lift.z = 0.3 * k; else lift.y = 0.3 * k;
      sprite.position.set(pin.position[0] + lift.x, pin.position[1] + lift.y, pin.position[2] + lift.z);
      sprite.userData.id = pin.id;
      world.add(dot, sprite);
      pinObjs.push({ pin, dot, sprite, normal: normalTex, chosen: chosenTex });
    }
    applySelection();
  }

  function applySelection(): void {
    for (const p of pinObjs) {
      const on = p.pin.id === selected;
      p.sprite.scale.setScalar(on ? 0.1 : 0.07);
      p.sprite.material.map = on ? p.chosen : p.normal;
      p.sprite.material.needsUpdate = true;
      (p.dot.material as MeshBasicMaterial).color = new Color(on ? DOT_SEL : DOT);
    }
    draw();
  }

  function home(): { pos: Vector3; target: Vector3 } {
    const d = radius * 2.1;
    return { pos: center.clone().add(new Vector3(d * 0.62, d * 0.55, d * 0.62)), target: center.clone() };
  }

  function jump(pos: Vector3, target: Vector3): void {
    camera.position.copy(pos);
    controls.target.copy(target);
    controls.update();
    draw();
    el.dataset.target = target.toArray().map((n) => n.toFixed(2)).join(",");
  }

  function resize(): void {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  const ray = new Raycaster(), mouse = new Vector2();
  let down: [number, number] | null = null;
  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  dom.addEventListener("click", (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = dom.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pinObjs.map((p) => p.sprite))[0];
    if (hit) opts.onSelect?.(String(hit.object.userData.id));
  });

  function setContent(c: ViewerContent): void {
    cancelAnimationFrame(anim);
    clear();
    content = c;
    selected = null;
    build();
    resize();
    const h = home();
    jump(h.pos, h.target);
  }

  function select(id: string | null): void {
    selected = id;
    applySelection();
  }

  function flyTo(id: string): Promise<void> {
    const p = pinObjs.find((x) => x.pin.id === id);
    if (!p) return Promise.resolve();
    select(id);
    const target = toWorld(p.pin.position);
    // stand off from the pin on the side the room's middle is, a bit above it
    const up = upVec().transformDirection(world.matrixWorld);
    const away = center.clone().sub(target);
    away.addScaledVector(up, -away.dot(up));
    if (away.lengthSq() < 1e-4) away.set(1, 0, 1);
    away.normalize();
    const dist = Math.max(2.2, Math.min(4.5, radius * 0.9));
    const endPos = target.clone().addScaledVector(away, dist).addScaledVector(up, dist * 0.35);
    cancelAnimationFrame(anim);
    if (opts.reducedMotion) { jump(endPos, target); return Promise.resolve(); }
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const start = performance.now(), ms = 950;
    return new Promise<void>((resolve) => {
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / ms), e = easeInOut(t);
        jump(p0.clone().lerp(endPos, e), t0.clone().lerp(target, e));
        if (t < 1) anim = requestAnimationFrame(step); else resolve();
      };
      anim = requestAnimationFrame(step);
    });
  }

  function reset(): void {
    cancelAnimationFrame(anim);
    selected = null;
    applySelection();
    const h = home();
    jump(h.pos, h.target);
  }

  return {
    setContent,
    select,
    flyTo,
    reset,
    setUp(up) { setContent({ ...content, up }); },
    dispose() {
      cancelAnimationFrame(anim);
      ro.disconnect();
      controls.dispose();
      clear();
      renderer.dispose();
      renderer.forceContextLoss();
      el.replaceChildren();
    },
  };
}


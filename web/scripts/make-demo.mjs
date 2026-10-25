// Builds the demo scan in public/samples/demo/: a synthetic studio room as a binary PLY point cloud (z up, metres,
// offset from the origin like a real SLAM world), room-tags.json in the shared schema with a 3D `position` per tag,
// the photos, and the same room as a scan bundle (Dhruv's static-viewer format). Everything here is generated, not scanned.
// Usage: node scripts/make-demo.mjs
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "public/samples/demo");
mkdirSync(resolve(out, "photos"), { recursive: true });

let seed = 20261024;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const jit = (s) => (rnd() - 0.5) * s;

const X0 = 0.4, X1 = 5.0, Y0 = -1.5, Y1 = 2.3, H = 2.5;
const pts = [];
const add = (x, y, z, c, noise = 0.008) => {
  const k = 1 + jit(0.12);
  pts.push([x + jit(noise), y + jit(noise), z + jit(noise), c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))))]);
};
const rect = (n, a, b, f) => { for (let i = 0; i < n; i++) f(rnd(), rnd()); };
const lerp = (a, b, t) => a + (b - a) * t;

const CARPET = [150, 138, 122], WALL = [226, 222, 212], CEIL = [235, 233, 228], BED = [86, 112, 150], PILLOW = [235, 235, 240];
const WOOD = [150, 108, 70], CHAIR = [60, 64, 72], COUNTER = [92, 92, 96], CABINET = [176, 170, 158], GLASS = [168, 196, 220], DOOR = [120, 84, 56];

// floor, ceiling, four walls
rect(14000, 0, 0, (u, v) => add(lerp(X0, X1, u), lerp(Y0, Y1, v), 0, CARPET, 0.01));
rect(3000, 0, 0, (u, v) => add(lerp(X0, X1, u), lerp(Y0, Y1, v), H, CEIL));
rect(5500, 0, 0, (u, v) => add(lerp(X0, X1, u), Y0, lerp(0, H, v), inDoor(lerp(X0, X1, u), lerp(0, H, v)) ? DOOR : WALL));
rect(5500, 0, 0, (u, v) => add(lerp(X0, X1, u), Y1, lerp(0, H, v), WALL));
rect(4500, 0, 0, (u, v) => { const y = lerp(Y0, Y1, u), z = lerp(0, H, v); add(X0, y, z, inWindow(y, z) ? GLASS : WALL); });
rect(4500, 0, 0, (u, v) => add(X1, lerp(Y0, Y1, u), lerp(0, H, v), WALL));
function inDoor(x, z) { return x > 1.0 && x < 1.9 && z < 2.05; }
function inWindow(y, z) { return y > -0.4 && y < 0.8 && z > 1.0 && z < 2.0; }

const box = (n, [x0, x1], [y0, y1], [z0, z1], c, noTop = false) => {
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
  const faces = [sy * sz, sy * sz, sx * sz, sx * sz, sx * sy, noTop ? 0 : sx * sy];
  const total = faces.reduce((a, b) => a + b, 0);
  faces.forEach((a, f) => {
    const m = Math.round((n * a) / total);
    rect(m, 0, 0, (u, v) => {
      if (f === 0) add(x0, lerp(y0, y1, u), lerp(z0, z1, v), c);
      else if (f === 1) add(x1, lerp(y0, y1, u), lerp(z0, z1, v), c);
      else if (f === 2) add(lerp(x0, x1, u), y0, lerp(z0, z1, v), c);
      else if (f === 3) add(lerp(x0, x1, u), y1, lerp(z0, z1, v), c);
      else if (f === 4) add(lerp(x0, x1, u), lerp(y0, y1, v), z0, c);
      else add(lerp(x0, x1, u), lerp(y0, y1, v), z1, c);
    });
  });
};

// bed: frame + mattress + pillows + headboard against the north wall
box(2600, [0.7, 2.7], [0.7, 2.3], [0, 0.28], WOOD);
box(3400, [0.72, 2.68], [0.72, 2.28], [0.28, 0.5], BED);
box(500, [0.9, 1.5], [2.0, 2.25], [0.5, 0.58], PILLOW);
box(500, [1.9, 2.5], [2.0, 2.25], [0.5, 0.58], PILLOW);
box(900, [0.7, 2.7], [2.26, 2.3], [0.5, 1.1], WOOD);
// desk with a top, two legs' worth of side panels, and a chair
box(1500, [3.4, 4.6], [1.7, 2.3], [0.72, 0.75], WOOD);
box(500, [3.4, 3.45], [1.7, 2.3], [0, 0.72], WOOD);
box(500, [4.55, 4.6], [1.7, 2.3], [0, 0.72], WOOD);
box(700, [3.7, 4.1], [1.1, 1.5], [0.42, 0.46], CHAIR);
box(500, [3.7, 4.1], [1.46, 1.5], [0.46, 0.9], CHAIR);
// kitchenette counter on the east wall
box(2400, [4.4, 5.0], [-1.5, 0.3], [0, 0.86], CABINET);
box(900, [4.4, 5.0], [-1.5, 0.3], [0.86, 0.9], COUNTER);

// binary little-endian PLY: x y z float, red green blue uchar
const buf = Buffer.alloc(pts.length * 15);
pts.forEach(([x, y, z, c], i) => {
  const o = i * 15;
  buf.writeFloatLE(x, o); buf.writeFloatLE(y, o + 4); buf.writeFloatLE(z, o + 8);
  buf[o + 12] = c[0]; buf[o + 13] = c[1]; buf[o + 14] = c[2];
});
const header = `ply\nformat binary_little_endian 1.0\ncomment Home Lens DEMO room: synthetic points, not a real scan. Metres, z up.\nelement vertex ${pts.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
writeFileSync(resolve(out, "cloud.ply"), Buffer.concat([Buffer.from(header, "ascii"), buf]));

// tags: positions sit on the surfaces above, in the same world as cloud.ply
const T = [
  { id: 12, room: "bedroom", object: "carpet", note: "dark stain near closet, ~8 in", photo: "photos/room-bedroom-carpet.png", box: [0.52, 0.7, 0.24, 0.14], takenAt: "2025-08-01T15:31:00-04:00", frame: "frame_00031", position: [3.9, 1.0, 0.01] },
  { id: 7, room: "living room", object: "wall", note: "grey scuff by the door, ~10 in", photo: "photos/room-livingroom-wall.png", box: [0.33, 0.4, 0.16, 0.06], takenAt: "2025-08-01T15:44:00-04:00", frame: "frame_00044", position: [1.98, -1.49, 1.0] },
  { id: 21, room: "kitchen", object: "counter", note: "small burn mark near the stove", photo: "photos/room-kitchen-counter.png", box: [0.38, 0.46, 0.12, 0.06], takenAt: "2025-08-01T15:52:00-04:00", frame: "frame_00052", position: [4.72, -0.55, 0.9] },
  { id: 3, room: "bedroom", object: "blinds", note: "two bent slats", photo: "photos/room-bedroom-blinds.png", box: [0.38, 0.28, 0.24, 0.12], takenAt: "2025-08-01T15:36:00-04:00", frame: "frame_00036", position: [0.42, 0.2, 1.7] },
];
for (const t of T) copyFileSync(resolve(root, "public/samples", t.photo.replace("photos/", "")), resolve(out, t.photo));
writeFileSync(resolve(out, "room-tags.json"), JSON.stringify({
  scanId: "demo-studio-4b",
  address: "Laurel Bend Apts #4B (demo)",
  capturedAt: "2025-08-01T15:20:00-04:00",
  tags: T.map((t) => ({ ...t, confirmed: false })),
}, null, 2) + "\n");

// the same room as a bundle: centred on the origin, y up (x, y, z) = (east, up, south)
const c = [(X0 + X1) / 2, (Y0 + Y1) / 2];
const toY = ([x, y, z]) => [+(x - c[0]).toFixed(2), +z.toFixed(2), +(c[1] - y).toFixed(2)];
writeFileSync(resolve(out, "scan-bundle.json"), JSON.stringify({
  version: 1, placeholder: true, source: "Generated demo bundle, not a real scan.", scaleVerified: false,
  room: { width: X1 - X0, depth: Y1 - Y0, height: H },
  objects: [
    { name: "Bed", center: toY([1.7, 1.5, 0.3]), size: [2.0, 0.6, 1.6] },
    { name: "Desk", center: toY([4.0, 2.0, 0.38]), size: [1.2, 0.76, 0.6] },
    { name: "Counter", center: toY([4.7, -0.6, 0.45]), size: [0.6, 0.9, 1.8] },
  ],
  trajectory: [[-1.5, 1.4, 1.2], [-0.4, 1.4, 0.6], [0.8, 1.4, 0.2], [1.6, 1.4, -0.5], [0.6, 1.4, -1.2], [-0.8, 1.4, -0.6]],
  tags: T.map((t) => ({ tagId: String(t.id), position: toY(t.position) })),
}, null, 2) + "\n");
console.log(`demo: ${pts.length} points -> ${out}`);

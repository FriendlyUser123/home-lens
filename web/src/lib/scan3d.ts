// Loads a room scan from the files a person picks: room-tags.json (shared schema), cloud.ply / mesh.ply
// (any PLY three.js can read), a scan bundle JSON (Dhruv's static viewer format) and the tag photos.
// Pure parsing, no DOM, so it runs under node --test.
import type { BufferGeometry } from "three";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { parseRoomScan, type RoomScan, type RoomTag } from "./match.ts";

export type Vec3 = [number, number, number];
export type Up = "y" | "z";

/** Dhruv's scan bundle: metres, y up, room centred on the origin. */
export interface ScanBundle {
  version: number;
  scaleVerified: boolean;
  room: { width: number; depth: number; height: number };
  objects: { name: string; center: Vec3; size: Vec3 }[];
  trajectory: Vec3[];
  tags: { tagId: string; position: Vec3 }[];
}

export interface Cloud {
  geometry: BufferGeometry;
  /** a PLY with faces is drawn as a surface, one without as points */
  kind: "points" | "mesh";
  count: number;
  /** points dropped to keep the browser fast (0 when none) */
  thinnedFrom: number;
  file: string;
}

export interface Pin {
  id: string;
  position: Vec3;
  /** the number or name on the badge */
  label: string;
}

export interface LoadedScan {
  scan: RoomScan | null;
  cloud: Cloud | null;
  bundle: ScanBundle | null;
  /** which way is up in `cloud`: SLAM worlds are z up, bundles are y up */
  up: Up;
  /** plain-language things we noticed, shown to the person */
  notes: string[];
}

const MAX_POINTS = 1_200_000;

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True for the bundle format (a `room` box), false for room-tags.json. */
export function looksLikeBundle(input: unknown): boolean {
  if (!isObj(input)) return false;
  const r = input.room;
  return isObj(r) && typeof r.width === "number" && typeof r.depth === "number" && typeof r.height === "number";
}

export function parseBundle(input: unknown): ScanBundle {
  if (!looksLikeBundle(input)) throw new Error("That file is not a scan bundle.");
  const o = input as Record<string, unknown>;
  const r = o.room as Record<string, number>;
  const room = { width: r.width as number, depth: r.depth as number, height: r.height as number };
  if (![room.width, room.depth, room.height].every((n) => n > 0 && n < 200)) throw new Error("The room size in this bundle looks wrong.");
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    version: typeof o.version === "number" ? o.version : 1,
    scaleVerified: o.scaleVerified === true,
    room,
    objects: list(o.objects).flatMap((x) => {
      const q = x as Record<string, unknown>;
      return isVec3(q.center) && isVec3(q.size) ? [{ name: String(q.name ?? ""), center: q.center, size: q.size }] : [];
    }),
    trajectory: list(o.trajectory).filter(isVec3),
    tags: list(o.tags).flatMap((x) => {
      const q = x as Record<string, unknown>;
      return isVec3(q.position) && q.tagId !== undefined ? [{ tagId: String(q.tagId), position: q.position }] : [];
    }),
  };
}

/** Pins for the 3D view: every tag with a 3D spot, plus bundle tags that match no tag in the list. */
export function buildPins(tags: RoomTag[], bundle: ScanBundle | null): Pin[] {
  const pins = new Map<string, Pin>();
  for (const b of bundle?.tags ?? []) {
    const t = tags.find((x) => String(x.id) === b.tagId);
    pins.set(b.tagId, { id: b.tagId, position: b.position, label: t ? String(t.id) : b.tagId });
  }
  for (const t of tags) if (t.position) pins.set(String(t.id), { id: String(t.id), position: t.position, label: String(t.id) });
  return [...pins.values()];
}

/** Keeps at most `max` points by taking every n-th one. Colours and normals follow. */
export function thin(geometry: BufferGeometry, max = MAX_POINTS): number {
  const pos = geometry.getAttribute("position");
  const n = pos.count;
  if (n <= max) return 0;
  const step = Math.ceil(n / max);
  for (const name of Object.keys(geometry.attributes)) {
    const a = geometry.getAttribute(name);
    const size = a.itemSize;
    const Ctor = a.array.constructor as new (len: number) => typeof a.array;
    const out = new Ctor(Math.ceil(n / step) * size);
    let k = 0;
    for (let i = 0; i < n; i += step) for (let j = 0; j < size; j++) out[k++] = a.array[i * size + j] as number;
    geometry.setAttribute(name, new (a.constructor as new (arr: typeof a.array, size: number, norm: boolean) => typeof a)(out, size, a.normalized));
  }
  return n;
}

export function parsePly(buf: ArrayBuffer, file = "cloud.ply"): Cloud {
  let geometry: BufferGeometry;
  try {
    geometry = new PLYLoader().parse(buf);
  } catch {
    throw new Error(`${file} is not a PLY file we can read.`);
  }
  const count = geometry.getAttribute("position")?.count ?? 0;
  if (count === 0) throw new Error(`${file} has no points.`);
  const kind = geometry.index ? "mesh" : "points";
  const thinnedFrom = kind === "points" ? thin(geometry) : 0;
  return { geometry, kind, count: geometry.getAttribute("position").count, thinnedFrom, file };
}

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();

/** Finds a tag's photo among the picked image files (by path suffix, then by file name). */
export function resolvePhoto(photo: string, urls: Map<string, string>): string {
  if (/^(data:|blob:|https?:|\/)/i.test(photo)) return photo;
  const want = norm(photo);
  const base = want.split("/").pop() ?? want;
  let byName: string | undefined;
  for (const [key, url] of urls) {
    if (key === want || key.endsWith(`/${want}`) || want.endsWith(`/${key}`)) return url;
    if (key.split("/").pop() === base) byName ??= url;
  }
  return byName ?? photo;
}

export interface PickedFile {
  name: string;
  /** folder path when the browser gives one (directory picker) */
  path: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
  /** makes a URL for an image; only called in the browser */
  url: () => string;
}

export function fromFile(f: File): PickedFile {
  return {
    name: f.name,
    path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    type: f.type,
    arrayBuffer: () => f.arrayBuffer(),
    text: () => f.text(),
    url: () => URL.createObjectURL(f),
  };
}

const IMG = /\.(jpe?g|png|webp|gif)$/i;

/** Reads whatever was picked. Any mix works: tags, a cloud, a bundle, photos. Unknown files are noted, not fatal. */
export async function readScanFiles(files: PickedFile[]): Promise<LoadedScan> {
  const out: LoadedScan = { scan: null, cloud: null, bundle: null, up: "z", notes: [] };
  const urls = new Map<string, string>();
  for (const f of files) if (IMG.test(f.name) || f.type.startsWith("image/")) urls.set(norm(f.path), f.url());
  let tagsRaw: unknown = null;
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".ply")) {
      // prefer cloud.ply over mesh.ply when both are picked
      if (out.cloud && !/cloud/i.test(f.name)) { out.notes.push(`Skipped ${f.name}; showing ${out.cloud.file}.`); continue; }
      out.cloud = parsePly(await f.arrayBuffer(), f.name);
    } else if (lower.endsWith(".json")) {
      let j: unknown;
      try { j = JSON.parse(await f.text()); } catch { throw new Error(`${f.name} is not valid JSON.`); }
      if (looksLikeBundle(j)) out.bundle = parseBundle(j);
      else tagsRaw = j;
    } else if (!urls.has(norm(f.path))) {
      out.notes.push(`Ignored ${f.name}.`);
    }
  }
  if (tagsRaw !== null) {
    const scan = parseRoomScan(tagsRaw);
    scan.tags = scan.tags.map((t) => ({ ...t, photoName: t.photo, photo: resolvePhoto(t.photo, urls) }));
    out.scan = scan;
  }
  if (!out.scan && !out.cloud && !out.bundle) throw new Error("Pick room-tags.json, cloud.ply, or both. Add the photos if they are separate files.");
  out.up = out.cloud ? "z" : "y";
  if (out.scan && out.cloud) {
    const n = out.scan.tags.filter((t) => t.position).length;
    if (n === 0) out.notes.push("These tags have no 3D position, so no pins are shown.");
  }
  if (out.cloud?.thinnedFrom) out.notes.push(`Showing ${out.cloud.count.toLocaleString("en-US")} of ${out.cloud.thinnedFrom.toLocaleString("en-US")} points.`);
  return out;
}

/** Percentile bounds of a point cloud, so stray points do not set the camera distance. */
export function robustBounds(positions: ArrayLike<number>, lo = 0.02, hi = 0.98, sample = 20000): { min: Vec3; max: Vec3 } {
  const n = Math.floor(positions.length / 3);
  const step = Math.max(1, Math.floor(n / sample));
  const axes: number[][] = [[], [], []];
  for (let i = 0; i < n; i += step) for (let a = 0; a < 3; a++) axes[a]!.push(positions[i * 3 + a] as number);
  const q = (arr: number[], p: number): number => {
    arr.sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))] ?? 0;
  };
  return {
    min: [q(axes[0]!, lo), q(axes[1]!, lo), q(axes[2]!, lo)],
    max: [q(axes[0]!, hi), q(axes[1]!, hi), q(axes[2]!, hi)],
  };
}

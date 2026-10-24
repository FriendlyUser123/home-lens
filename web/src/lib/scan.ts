// Finds the page in a photo and flattens it, all in the browser with OpenCV.js (@techstark/opencv-js).
// If anything fails the caller keeps the raw photo.
import type CvDefault from "@techstark/opencv-js";
import { flatSize, isPlausiblePage, orderCorners, scaleQuad, type Pt, type Quad } from "./quad.ts";

type Cv = typeof CvDefault;
type Source = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

let cvP: Promise<Cv> | null = null;

/** Loads OpenCV once (about 13 MB, so only when the camera or an upload needs it). */
export function loadCv(): Promise<Cv> {
  cvP ??= (async () => {
    const mod: unknown = (await import("@techstark/opencv-js")).default;
    if (mod instanceof Promise) return (await mod) as Cv;
    const cv = mod as Cv;
    if (!cv.Mat) {
      await new Promise<void>((resolve) => {
        (cv as unknown as { onRuntimeInitialized: () => void }).onRuntimeInitialized = () => resolve();
      });
    }
    return cv;
  })();
  return cvP;
}

const size = (s: Source): { w: number; h: number } =>
  s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height };

const SMALL = 480;

/** Page corners in the source's own pixel coordinates, or null when no page-shaped region is found. */
export function detectQuad(cv: Cv, source: Source): Quad | null {
  const { w, h } = size(source);
  if (!w || !h) return null;
  const k = Math.min(1, SMALL / Math.max(w, h));
  const sw = Math.round(w * k), sh = Math.round(h * k);
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  c.getContext("2d", { willReadFrequently: true })?.drawImage(source, 0, 0, sw, sh);

  const mats: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => { mats.push(m); return m; };
  try {
    const src = keep(cv.imread(c));
    const gray = keep(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = keep(new cv.Mat());
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    const edges = keep(new cv.Mat());
    cv.Canny(blur, edges, 50, 150);
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);

    const bright = keep(new cv.Mat());
    cv.threshold(blur, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bright, bright, cv.MORPH_CLOSE, kernel);

    for (const mask of [edges, bright]) {
      const q = bestQuad(cv, mask, sw, sh, keep);
      if (q) return scaleQuad(q, 1 / k);
    }
    return null;
  } catch {
    return null;
  } finally {
    for (const m of mats) { try { m.delete(); } catch { /* already freed */ } }
  }
}

function bestQuad(cv: Cv, mask: InstanceType<Cv["Mat"]>, w: number, h: number, keep: <T extends { delete(): void }>(m: T) => T): Quad | null {
  const contours = keep(new cv.MatVector());
  const hier = keep(new cv.Mat());
  cv.findContours(mask, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  let best: { q: Quad; a: number } | null = null;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    try {
      const a = cv.contourArea(cnt);
      if (a < 0.12 * w * h) continue;
      const hull = new cv.Mat();
      cv.convexHull(cnt, hull);
      const peri = cv.arcLength(hull, true);
      // Shadows and pens cut corners, so loosen the polygon fit until it is four points.
      for (const eps of [0.02, 0.035, 0.05, 0.07]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          const d = approx.data32S;
          const pts: Pt[] = [0, 1, 2, 3].map((n) => ({ x: d[n * 2] ?? 0, y: d[n * 2 + 1] ?? 0 }));
          const q = orderCorners(pts);
          if (isPlausiblePage(q, w, h) && (!best || a > best.a)) best = { q, a };
          approx.delete();
          break;
        }
        approx.delete();
      }
      hull.delete();
    } finally {
      cnt.delete();
    }
  }
  return best?.q ?? null;
}

/** Perspective-flattens the quad out of the source. Longest side capped at 1800 px. */
export function flatten(cv: Cv, source: Source, quad: Quad): HTMLCanvasElement {
  const { w, h } = flatSize(quad);
  const src = cv.imread(source as HTMLCanvasElement);
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    cv.imshow(out, dst);
    return out;
  } finally {
    src.delete(); dst.delete(); from.delete(); to.delete(); M.delete();
  }
}

export interface Scanned {
  /** the photo as taken (shrunk), for the "page snaps flat" animation */
  raw: HTMLCanvasElement;
  quad: Quad | null;
  /** flattened page, or the raw photo when no page was found */
  page: HTMLCanvasElement;
}

/** Long side the model and OCR see. Small scans are scaled up, big photos down, so text is about the same size. */
const TARGET = 1800;

function toCanvas(s: Source, maxSide = 2400): HTMLCanvasElement {
  const { w, h } = size(s);
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d")?.drawImage(s, 0, 0, c.width, c.height);
  return c;
}

function fitTarget(c: HTMLCanvasElement): HTMLCanvasElement {
  const k = TARGET / Math.max(c.width, c.height);
  if (k > 0.8 && k < 1.25) return c;
  const o = document.createElement("canvas");
  o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
  const ctx = o.getContext("2d");
  if (ctx) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(c, 0, 0, o.width, o.height); }
  return o;
}

/** Whole pipeline for one photo. `hint` is the quad the live view already found, in this photo's coordinates. */
export async function scanPhoto(photo: Source, hint?: Quad | null): Promise<Scanned> {
  const raw = toCanvas(photo);
  let quad: Quad | null = null;
  let page = raw;
  try {
    const cv = await loadCv();
    const k = raw.width / size(photo).w;
    quad = hint ? scaleQuad(hint, k) : detectQuad(cv, raw);
    if (quad) page = flatten(cv, raw, quad);
  } catch {
    quad = null;
    page = raw;
  }
  return { raw, quad, page: fitTarget(page) };
}

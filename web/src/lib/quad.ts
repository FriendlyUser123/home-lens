// Page-corner geometry used by the scanner. Pure, so it is tested without OpenCV.

export interface Pt { x: number; y: number }
/** top-left, top-right, bottom-right, bottom-left */
export type Quad = [Pt, Pt, Pt, Pt];

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Puts four unordered points in TL, TR, BR, BL order. */
export function orderCorners(p: Pt[]): Quad {
  if (p.length !== 4) throw new Error("need four corners");
  const bySum = [...p].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...p].sort((a, b) => a.y - a.x - (b.y - b.x));
  const tl = bySum[0] as Pt;
  const br = bySum[3] as Pt;
  const tr = byDiff[0] as Pt; // smallest y - x
  const bl = byDiff[3] as Pt;
  return [tl, tr, br, bl];
}

export function area(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i] as Pt, b = q[(i + 1) % 4] as Pt;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i] as Pt, b = q[(i + 1) % 4] as Pt, c = q[(i + 2) % 4] as Pt;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** A believable page: convex, covers 12 to 94 percent of the frame, no sliver sides. */
export function isPlausiblePage(q: Quad, width: number, height: number): boolean {
  if (!isConvex(q)) return false;
  const frac = area(q) / (width * height);
  if (frac < 0.12 || frac > 0.94) return false;
  const sides = [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])];
  const minSide = Math.min(...sides), maxSide = Math.max(...sides);
  return minSide > 0.1 * Math.min(width, height) && maxSide / minSide < 4;
}

export function scaleQuad(q: Quad, k: number): Quad {
  return q.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
}

export function lerpQuad(from: Quad, to: Quad, t: number): Quad {
  return from.map((p, i) => ({ x: p.x + ((to[i] as Pt).x - p.x) * t, y: p.y + ((to[i] as Pt).y - p.y) * t })) as Quad;
}

/** Mean corner distance, to decide whether the page moved. */
export function quadShift(a: Quad, b: Quad): number {
  return a.reduce((s, p, i) => s + dist(p, b[i] as Pt), 0) / 4;
}

/** Width and height of the flattened page, from the longer of each pair of opposite sides. */
export function flatSize(q: Quad, maxSide = 1800): { w: number; h: number } {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h));
  w *= k; h *= k;
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

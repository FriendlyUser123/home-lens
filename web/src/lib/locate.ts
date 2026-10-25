// Finds where a verbatim quote from the model sits among OCR words. Never invents a location:
// if the words are not really there, it returns null and the UI shows "check this".

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** words on the same printed line share a number */
  line: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Located {
  /** inclusive word indexes into the original OCR list */
  start: number;
  end: number;
  /** share of the quote's words that were found, 0 to 1 */
  coverage: number;
  rects: Rect[];
}

const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] ?? 0;
}

/** 0 to 1. Numbers must be exact (one wrong digit is a different amount), words may have an OCR slip. */
export function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const d = lev(a, b);
  const sim = 1 - d / Math.max(a.length, b.length);
  return a.length < 4 && d > 0 ? 0 : sim;
}

const MATCH_MIN = 0.72;
const GAP = -1;
const MISS = -1.5;

export const MIN_COVERAGE = 0.7;

interface Cell { score: number; from: 0 | 1 | 2 | 3 }

/** Smith-Waterman over tokens: finds the best run of OCR words for the quote, tolerating split/merged/garbled words. */
export function locateQuote(words: OcrWord[], quote: string, minCoverage = MIN_COVERAGE): Located | null {
  const q = quote.split(/\s+/).map(norm).filter(Boolean);
  const idx: number[] = [];
  const w: string[] = [];
  words.forEach((x, i) => {
    const n = norm(x.text);
    if (n) { idx.push(i); w.push(n); }
  });
  if (q.length === 0 || w.length === 0) return null;

  const rows = q.length + 1;
  const cols = w.length + 1;
  const H: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ score: 0, from: 0 as const })));
  let best = { i: 0, j: 0, score: 0 };
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const sim = tokenSimilarity(q[i - 1] ?? "", w[j - 1] ?? "");
      const diag = (H[i - 1]?.[j - 1]?.score ?? 0) + (sim >= MATCH_MIN ? 2 * sim : MISS);
      const up = (H[i - 1]?.[j]?.score ?? 0) + GAP; // quote token missing from the page
      const left = (H[i]?.[j - 1]?.score ?? 0) + GAP; // extra OCR word in between
      const top = Math.max(0, diag, up, left);
      const from: Cell["from"] = top === 0 ? 0 : top === diag ? 1 : top === up ? 2 : 3;
      (H[i] as Cell[])[j] = { score: top, from };
      if (top > best.score) best = { i, j, score: top };
    }
  }
  if (best.score <= 0) return null;

  let i = best.i, j = best.j, matched = 0, first = -1;
  const last = j;
  while (i > 0 && j > 0 && (H[i]?.[j]?.score ?? 0) > 0) {
    const cell = H[i]?.[j] as Cell;
    if (cell.from === 1) {
      if (tokenSimilarity(q[i - 1] ?? "", w[j - 1] ?? "") >= MATCH_MIN) { matched++; first = j; }
      i--; j--;
    } else if (cell.from === 2) i--;
    else if (cell.from === 3) j--;
    else break;
  }
  if (first < 0) return null;
  const coverage = matched / q.length;
  if (coverage < minCoverage) return null;
  const start = idx[first - 1] as number;
  const end = idx[last - 1] as number;
  return { start, end, coverage, rects: rectsFor(words, start, end) };
}

/** One rectangle per printed line the run touches, so a wrapped quote gets a highlight on each line. */
export function rectsFor(words: OcrWord[], start: number, end: number, pad = 2): Rect[] {
  const byLine = new Map<number, OcrWord[]>();
  for (let k = start; k <= end; k++) {
    const x = words[k];
    if (!x) continue;
    byLine.set(x.line, [...(byLine.get(x.line) ?? []), x]);
  }
  return [...byLine.values()].map((ws) => {
    const x0 = Math.min(...ws.map((x) => x.x0));
    const y0 = Math.min(...ws.map((x) => x.y0));
    const x1 = Math.max(...ws.map((x) => x.x1));
    const y1 = Math.max(...ws.map((x) => x.y1));
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  });
}

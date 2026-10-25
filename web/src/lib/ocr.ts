import { createWorker, type Worker } from "tesseract.js";
import type { OcrWord } from "./locate.ts";

// Self-hosted copies (scripts/vendor-ocr.mjs), so recognition runs fully in the browser.
const BASE = "/vendor/tesseract";

let workerP: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  workerP ??= createWorker("eng", 1, {
    workerPath: `${BASE}/worker.min.js`,
    corePath: `${BASE}/core`,
    langPath: `${BASE}/lang`,
    gzip: true,
    cacheMethod: "none",
  });
  return workerP;
}

/** Word boxes in the pixel space of the image given. */
export async function recognizeWords(image: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const out: OcrWord[] = [];
  let line = 0;
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        for (const w of l.words) {
          if (w.text.trim()) out.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line });
        }
        line++;
      }
    }
  }
  return out;
}

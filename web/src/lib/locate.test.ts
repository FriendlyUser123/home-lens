import test from "node:test";
import assert from "node:assert/strict";
import { locateQuote, tokenSimilarity, type OcrWord } from "./locate.ts";

/** Lays words out left to right, 60 px each, one printed line per "|" break. */
function page(lines: string[]): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((l, li) => l.split(" ").forEach((t, wi) => out.push({ text: t, x0: wi * 60, y0: li * 30, x1: wi * 60 + 55, y1: li * 30 + 20, line: li })));
  return out;
}

const PAGE = page([
  "Our records show you vacated Unit 4B on October 17, 2026.",
  "Carpet replacement, bedroom (worn and stained) $480.00",
  "Professional cleaning, entire unit $175.00",
  "Maintenance fee $75.00",
]);

test("finds an exact line and boxes it", () => {
  const r = locateQuote(PAGE, "Maintenance fee $75.00");
  assert.ok(r);
  assert.equal(r.coverage, 1);
  assert.equal(r.rects.length, 1);
  assert.equal(r.rects[0]?.y, 90 - 2);
});

test("tolerates OCR slips in words", () => {
  const noisy = page(["Carpet rep1acement, bedrcom (worn and stained) $480.00"]);
  const r = locateQuote(noisy, "Carpet replacement, bedroom (worn and stained) $480.00");
  assert.ok(r);
  assert.ok(r.coverage >= 0.7);
});

test("a wrong digit in an amount is not a match", () => {
  assert.equal(tokenSimilarity("48000", "48900"), 0);
  assert.equal(locateQuote(page(["Maintenance fee $76.00"]), "Maintenance fee $75.00"), null);
});

test("a quote that is not on the page gets no highlight", () => {
  assert.equal(locateQuote(PAGE, "Pet damage, kitchen $300.00"), null);
  assert.equal(locateQuote(PAGE, ""), null);
  assert.equal(locateQuote([], "anything"), null);
});

test("a quote that wraps onto two lines gets two rectangles", () => {
  const wrapped = page(["Carpet replacement, bedroom", "(worn and stained) $480.00"]);
  const r = locateQuote(wrapped, "Carpet replacement, bedroom (worn and stained) $480.00");
  assert.ok(r);
  assert.equal(r.rects.length, 2);
});

test("picks the right line when words repeat", () => {
  const dup = page(["Cleaning fee $125.00", "Carpet cleaning $80.00"]);
  const r = locateQuote(dup, "Carpet cleaning $80.00");
  assert.ok(r);
  assert.equal(r.rects[0]?.y, 30 - 2);
});

test("date with a split token", () => {
  const r = locateQuote(PAGE, "vacated Unit 4B on October 17, 2026");
  assert.ok(r);
  assert.equal(r.coverage, 1);
});

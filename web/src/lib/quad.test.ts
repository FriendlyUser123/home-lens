import test from "node:test";
import assert from "node:assert/strict";
import { orderCorners, area, isConvex, isPlausiblePage, flatSize, lerpQuad, quadShift, type Quad } from "./quad.ts";

const P = (x: number, y: number) => ({ x, y });

test("orders corners from any input order, even on a tilted page", () => {
  const want: Quad = [P(120, 40), P(520, 90), P(480, 600), P(60, 540)];
  for (const shuffled of [[want[2], want[0], want[3], want[1]], [want[3], want[2], want[1], want[0]]]) {
    assert.deepEqual(orderCorners(shuffled as ReturnType<typeof P>[]), want);
  }
});

test("area and convexity", () => {
  const sq: Quad = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  assert.equal(area(sq), 100);
  assert.equal(isConvex(sq), true);
  assert.equal(isConvex([P(0, 0), P(10, 0), P(2, 2), P(0, 10)]), false);
});

test("plausible page: not the whole frame, not a speck", () => {
  const frame = { w: 1000, h: 800 };
  assert.equal(isPlausiblePage([P(100, 50), P(700, 60), P(690, 760), P(90, 750)], frame.w, frame.h), true);
  assert.equal(isPlausiblePage([P(0, 0), P(1000, 0), P(1000, 800), P(0, 800)], frame.w, frame.h), false);
  assert.equal(isPlausiblePage([P(0, 0), P(100, 0), P(100, 100), P(0, 100)], frame.w, frame.h), false);
});

test("flat size uses the longer opposite sides and caps", () => {
  assert.deepEqual(flatSize([P(0, 0), P(400, 0), P(400, 500), P(0, 500)]), { w: 400, h: 500 });
  const big = flatSize([P(0, 0), P(3600, 0), P(3600, 1800), P(0, 1800)]);
  assert.equal(big.w, 1800);
  assert.equal(big.h, 900);
});

test("lerp and shift", () => {
  const a: Quad = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  const b: Quad = [P(10, 0), P(20, 0), P(20, 10), P(10, 10)];
  assert.equal(quadShift(a, b), 10);
  assert.deepEqual(lerpQuad(a, b, 0.5)[0], P(5, 0));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchCharges } from "./match.ts";
import { buildPins, parseBundle, parsePly, readScanFiles, resolvePhoto, robustBounds, thin, type PickedFile } from "./scan3d.ts";

const demo = (name: string): Buffer => readFileSync(new URL(`../../public/samples/demo/${name}`, import.meta.url));
const ab = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const file = (name: string, data: Buffer, path = name): PickedFile => ({
  name, path, type: name.endsWith(".png") ? "image/png" : "",
  arrayBuffer: async () => ab(data), text: async () => data.toString("utf8"), url: () => `blob:${path}`,
});

test("demo cloud.ply loads as coloured points", () => {
  const c = parsePly(ab(demo("cloud.ply")));
  assert.equal(c.kind, "points");
  assert.ok(c.count > 40000);
  assert.ok(c.geometry.getAttribute("color"));
});

test("every demo tag sits on the cloud (a point within 6 cm)", () => {
  const c = parsePly(ab(demo("cloud.ply")));
  const pos = c.geometry.getAttribute("position").array;
  const tags = (JSON.parse(demo("room-tags.json").toString()) as { tags: { id: number; position: number[] }[] }).tags;
  for (const t of tags) {
    let best = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      best = Math.min(best, Math.hypot((pos[i] as number) - t.position[0]!, (pos[i + 1] as number) - t.position[1]!, (pos[i + 2] as number) - t.position[2]!));
    }
    assert.ok(best < 0.06, `tag ${t.id} is ${best.toFixed(3)} m from the nearest point`);
  }
});

test("robustBounds ignores stray points", () => {
  const a = new Float32Array(3 * 1000);
  for (let i = 0; i < 1000; i++) { a[i * 3] = i / 1000; a[i * 3 + 1] = 0; a[i * 3 + 2] = 0; }
  a[0] = 900;
  assert.ok(robustBounds(a).max[0] < 2);
});

test("thin keeps colours aligned and caps the count", () => {
  const c = parsePly(ab(demo("cloud.ply")));
  const n = c.count;
  assert.equal(thin(c.geometry, 10000), n);
  assert.ok(c.geometry.getAttribute("position").count <= 10000);
  assert.equal(c.geometry.getAttribute("color").count, c.geometry.getAttribute("position").count);
});

test("demo bundle parses and its tags line up with the room tags", () => {
  const b = parseBundle(JSON.parse(demo("scan-bundle.json").toString()));
  assert.equal(b.tags.length, 4);
  const scan = JSON.parse(demo("room-tags.json").toString()) as { tags: { id: number }[] };
  const pins = buildPins(scan.tags as never, b);
  assert.deepEqual(pins.map((p) => p.id).sort(), ["12", "21", "3", "7"]);
});

test("Dhruv's placeholder bundle format parses", () => {
  const b = parseBundle({ version: 1, room: { width: 5, depth: 4, height: 2.6 }, objects: [{ name: "Bed", center: [0, 0.2, 0], size: [2, 0.5, 1.6] }], trajectory: [[0, 1, 0], [1, 1, 0]], tags: [{ tagId: "t-stain", position: [0.9, 0.02, -1.3] }] });
  assert.equal(b.tags[0]?.tagId, "t-stain");
  assert.equal(buildPins([], b)[0]?.label, "t-stain");
  assert.throws(() => parseBundle({ tags: [] }));
});

test("resolvePhoto: paths, folders, data URLs", () => {
  const urls = new Map([["scan1/room-tags/photos/frame_00031.jpg", "blob:a"]]);
  assert.equal(resolvePhoto("room-tags/photos/frame_00031.jpg", urls), "blob:a");
  assert.equal(resolvePhoto("frame_00031.jpg", urls), "blob:a");
  assert.equal(resolvePhoto("data:image/png;base64,AA", urls), "data:image/png;base64,AA");
  assert.equal(resolvePhoto("missing.jpg", urls), "missing.jpg");
});

test("readScanFiles: cloud + tags + photos, any order, same path as a real scan", async () => {
  const files = [
    file("frame.png", demo("photos/room-bedroom-carpet.png"), "photos/room-bedroom-carpet.png"),
    file("cloud.ply", demo("cloud.ply")),
    file("room-tags.json", demo("room-tags.json")),
  ];
  const r = await readScanFiles(files);
  assert.equal(r.up, "z");
  assert.equal(r.cloud?.kind, "points");
  assert.equal(r.scan?.tags.length, 4);
  assert.equal(r.scan?.tags[0]?.photo, "blob:photos/room-bedroom-carpet.png");
  assert.equal(r.scan?.tags[0]?.photoName, "photos/room-bedroom-carpet.png");
  assert.deepEqual(r.scan?.tags[0]?.position, [3.9, 1, 0.01]);
  assert.equal(buildPins(r.scan!.tags, r.bundle).length, 4);
});

test("readScanFiles: bundle only is y up; junk is refused", async () => {
  const r = await readScanFiles([file("scan-bundle.json", demo("scan-bundle.json"))]);
  assert.equal(r.up, "y");
  assert.ok(r.bundle);
  await assert.rejects(() => readScanFiles([file("notes.txt", Buffer.from("x"))]));
  await assert.rejects(() => readScanFiles([file("cloud.ply", Buffer.from("not a ply"))]));
});

test("demo tags match the sample letter's charges (carpet stain, wall scuff, counter burn)", async () => {
  const r = await readScanFiles([file("room-tags.json", demo("room-tags.json"))]);
  const c = (id: string, description: string, category: string) => ({ id, description, quote: description, category });
  const m = matchCharges([
    c("a", "Carpet stain removal, bedroom closet", "carpet_flooring"),
    c("b", "Wall scuff touch-up paint, living room", "paint_walls"),
    c("c", "Kitchen countertop burn repair", "damage_repair"),
    c("d", "Professional cleaning, entire unit", "cleaning"),
  ], r.scan!.tags, { onlyConfirmed: false });
  const top = (id: string) => m.filter((x) => x.chargeId === id)[0]?.tagId;
  assert.equal(top("a"), 12);
  assert.equal(top("b"), 7);
  assert.equal(top("c"), 21);
  assert.equal(top("d"), undefined);
});

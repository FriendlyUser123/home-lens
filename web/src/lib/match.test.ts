import test from "node:test";
import assert from "node:assert/strict";
import { matchCharges, parseRoomScan, photoDate, chargeRooms, chargeObjects, type RoomTag, type ChargeText } from "./match.ts";

const tag = (id: number, room: string, object: string, note: string, confirmed = true): RoomTag =>
  ({ id, room, object, note, photo: `p${id}.png`, takenAt: "2025-08-01T10:00:00Z", confirmed });
const ch = (id: string, description: string, category = "other"): ChargeText => ({ id, description, quote: description, category });

const TAGS = [
  tag(12, "bedroom", "carpet", "dark stain near closet, ~8 in"),
  tag(7, "living room", "wall", "grey scuff by the door, ~10 in"),
  tag(21, "kitchen", "counter", "small burn mark near stove"),
  tag(3, "bedroom", "blinds", "two bent slats"),
];

test("carpet stain in the bedroom matches photo 12", () => {
  const m = matchCharges([ch("a", "Carpet stain removal, bedroom closet $210.00", "carpet_flooring")], TAGS);
  assert.equal(m[0]?.tagId, 12);
  assert.ok((m[0]?.score ?? 0) >= 0.9);
  assert.deepEqual(m[0]?.shared, ["carpet", "bedroom", "stain"]);
});

test("wall scuff in the living room matches photo 7, not the bedroom", () => {
  const m = matchCharges([ch("b", "Wall scuff repaint, living room $85.00", "paint_walls")], TAGS);
  assert.deepEqual(m.map((x) => x.tagId), [7]);
});

test("wrong room is never proposed", () => {
  const m = matchCharges([ch("c", "Carpet replacement, living room $480", "carpet_flooring")], TAGS);
  assert.equal(m.length, 0);
});

test("no room named still proposes by object, with a lower score", () => {
  const m = matchCharges([ch("d", "Carpet shampoo $80", "carpet_flooring")], TAGS);
  assert.equal(m[0]?.tagId, 12);
  assert.ok((m[0]?.score ?? 1) < 0.7);
});

test("charges with no object get nothing", () => {
  const m = matchCharges([ch("e", "Professional cleaning, entire unit $175", "cleaning"), ch("f", "Maintenance fee $75", "maintenance_fee")], TAGS);
  assert.equal(m.length, 0);
});

test("unconfirmed tags are ignored unless asked", () => {
  const tags = [tag(1, "bedroom", "carpet", "stain", false)];
  const c = [ch("a", "Carpet stain, bedroom")];
  assert.equal(matchCharges(c, tags).length, 0);
  assert.equal(matchCharges(c, tags, { onlyConfirmed: false }).length, 1);
});

test("a floor photo can back a carpet charge, weaker", () => {
  const m = matchCharges([ch("a", "Carpet stain, bedroom")], [tag(5, "bedroom", "floor", "stain")]);
  assert.equal(m.length, 1);
  assert.ok((m[0]?.score ?? 1) < 0.9);
});

test("best two per charge, highest first", () => {
  const tags = [tag(1, "bedroom", "carpet", "old stain"), tag(2, "bedroom", "carpet", "small burn"), tag(3, "bedroom", "carpet", "stain by door")];
  const m = matchCharges([ch("a", "Carpet stain, bedroom")], tags);
  assert.equal(m.length, 2);
  assert.ok((m[0]?.score ?? 0) >= (m[1]?.score ?? 1));
});

test("blinds and counters", () => {
  assert.equal(matchCharges([ch("a", "Window blinds, bent slats, bedroom $60")], TAGS)[0]?.tagId, 3);
  assert.equal(matchCharges([ch("a", "Kitchen countertop burn $140")], TAGS)[0]?.tagId, 21);
});

test("helpers", () => {
  assert.deepEqual(chargeRooms(ch("a", "Carpet shampoo, living room and hall")), ["living room", "hallway"]);
  assert.deepEqual(chargeRooms(ch("a", "Cleaning, entire unit")), []);
  assert.deepEqual(chargeObjects({ id: "a", description: "Re-key", quote: "", category: "paint_walls" }), ["wall"]);
});

test("photoDate ignores time zones", () => {
  assert.equal(photoDate("2025-08-01T23:30:00-05:00"), "Aug 1");
  assert.equal(photoDate("2025-08-01T00:10:00Z", true), "Aug 1, 2025");
});

test("parseRoomScan accepts the schema and rejects junk", () => {
  const ok = parseRoomScan({ scanId: "s", address: "a", capturedAt: "2025-08-01T00:00:00Z", tags: [
    { id: 1, room: "bedroom", object: "Carpet", note: "x", photo: "p.png", takenAt: "2025-08-01T00:00:00Z", confirmed: true, box: [0, 0, 1, 1] }] });
  assert.equal(ok.tags[0]?.object, "carpet");
  assert.throws(() => parseRoomScan(null));
  assert.throws(() => parseRoomScan({ tags: [{ id: 1 }] }));
  assert.equal(parseRoomScan({ tags: [{ id: 1, room: "attic", object: "wall", photo: "p", takenAt: "t" }] }).tags[0]?.room, "other");
});

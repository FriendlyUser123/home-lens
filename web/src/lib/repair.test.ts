import assert from "node:assert/strict";
import test from "node:test";
import { buildNotice, repairClock, repairDeadline } from "./repair.ts";
import { parseISO, toISO } from "./rules.ts";

const d = (s: string): number => {
  const v = parseISO(s);
  if (v === null) throw new Error(s);
  return v;
};

// same cases as web-static/rules.test.js
test("14 days after the notice", () => {
  assert.equal(toISO(repairDeadline(d("2026-10-24"))), "2026-11-07");
  assert.equal(toISO(repairDeadline(d("2026-12-25"))), "2027-01-08");
  assert.equal(toISO(repairDeadline(d("2028-02-20"))), "2028-03-05");
});

test("the clock counts down and passes", () => {
  const n = d("2026-10-24");
  assert.deepEqual(repairClock(n, d("2026-10-24")), { deadline: d("2026-11-07"), daysLeft: 14, state: "open" });
  assert.equal(repairClock(n, d("2026-11-07")).state, "today");
  assert.equal(repairClock(n, d("2026-11-08")).state, "passed");
  assert.equal(repairClock(n, d("2026-11-10")).daysLeft, -3);
});

test("notice has the cite, the date and the deadline", () => {
  const t = buildNotice({ issue: "Leaking pipe under the sink.", description: "Drips all day.", room: "kitchen", date: d("2026-10-24"), tenant: "Sam Lee", landlord: "Laurel Bend", address: "4B", photo: true });
  assert.match(t, /October 24, 2026/);
  assert.match(t, /§ 55\.1-1244\.1/);
  assert.match(t, /leaking pipe under the sink \(kitchen\)\./);
  assert.match(t, /by November 7, 2026/);
  assert.match(t, /A photo is attached/);
  assert.match(t, /Sam Lee/);
});

test("blanks become brackets and no photo is not claimed", () => {
  const t = buildNotice({ issue: "", description: "", room: "", date: d("2026-10-24"), tenant: "", landlord: "", address: "", photo: false });
  assert.match(t, /\[Your name\]/);
  assert.match(t, /\[Landlord or property manager\]/);
  assert.match(t, /\[Describe what you see/);
  assert.doesNotMatch(t, /photo is attached/);
});

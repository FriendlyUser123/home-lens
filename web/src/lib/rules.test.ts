import test from "node:test";
import assert from "node:assert/strict";
import { titleCaseIfShouting, extraInQuote, buildLetter, parseISO, toISO, computeClock, chipFor, quoteHasAmount, isLate, fmtLong } from "./rules.ts";

const d = (s: string): number => {
  const v = parseISO(s);
  if (v === null) throw new Error(s);
  return v;
};

test("45 days after move-out", () => {
  const c = computeClock(d("2026-10-25"), null, d("2026-10-30"));
  assert.equal(toISO(c.deadline), "2026-12-09");
  assert.equal(c.daysLeft, 40);
  assert.equal(c.state, "open");
});

test("later of lease end and move-out wins", () => {
  assert.equal(toISO(computeClock(d("2026-05-01"), d("2026-05-31"), d("2026-06-01")).deadline), "2026-07-15");
  assert.equal(toISO(computeClock(d("2026-06-05"), d("2026-05-31"), d("2026-06-06")).deadline), "2026-07-20");
});

test("contractor extension is +15", () => {
  const c = computeClock(d("2026-10-25"), null, d("2026-10-25"));
  assert.equal(toISO(c.extendedDeadline), "2026-12-24");
});

test("states", () => {
  const dl = d("2026-12-09");
  assert.equal(computeClock(d("2026-10-25"), null, dl).state, "today");
  assert.equal(computeClock(d("2026-10-25"), null, dl + 3).state, "passed");
});

test("crosses year and leap day", () => {
  assert.equal(toISO(computeClock(d("2027-12-20"), null, 0).deadline), "2028-02-03");
  assert.equal(toISO(computeClock(d("2028-01-20"), null, 0).deadline), "2028-03-05");
  assert.equal(fmtLong(d("2026-12-09")), "December 9, 2026");
});

test("bad dates rejected", () => {
  assert.equal(parseISO("2026-02-30"), null);
  assert.equal(parseISO("nope"), null);
});

test("late letter", () => {
  const c = computeClock(d("2026-10-25"), null, d("2026-12-20"));
  assert.equal(isLate(d("2026-12-10"), c), true);
  assert.equal(isLate(d("2026-12-09"), c), false);
  assert.equal(isLate(null, c), false);
});

test("chips only where a rule supports", () => {
  assert.equal(chipFor("maintenance_fee"), "fee");
  assert.equal(chipFor("carpet_flooring"), "wear");
  assert.equal(chipFor("cleaning"), "proof");
});

test("quote must contain amount", () => {
  assert.equal(quoteHasAmount("Carpet cleaning .... $150.00", 150), true);
  assert.equal(quoteHasAmount("Carpet cleaning .... $1,150.00", 150), false);
  assert.equal(quoteHasAmount("Paint $85", 150), false);
});

test("title case only shouting text", () => {
  assert.equal(titleCaseIfShouting("LAUREL BEND APARTMENTS"), "Laurel Bend Apartments");
  assert.equal(titleCaseIfShouting("Pine Row LLC"), "Pine Row LLC");
});

test("quote shown only when it adds info", () => {
  assert.equal(extraInQuote({ description: "Maintenance fee", quote: "Maintenance fee $75.00", amount: 75 }), "");
  assert.equal(extraInQuote({ description: "Cleaning fee", quote: "Cleaning fee Flat rate, all units $125.00", amount: 125 }), "Flat rate, all units");
});

test("letter is short", () => {
  const mk = (id: string, description: string, amount: number, chip: "proof" | "wear" | "fee") =>
    ({ id, description, amount, quote: "", category: "other" as const, chip, check: false });
  const clock = computeClock(d("2026-10-17"), null, d("2026-11-22"));
  const t = buildLetter({ tenantName: "Jordan Example", forwardingAddress: "1 Test St", landlordName: "Laurel Bend Apartments",
    moveOut: d("2026-10-17"), clock, today: d("2026-11-22"), letterDay: d("2026-11-20"), hasLetter: true, depositAmount: 1200,
    charges: [mk("a", "Carpet replacement, bedroom (worn)", 480, "proof"), mk("b", "Cleaning", 175, "proof"), mk("c", "Wall patching", 90, "wear"), mk("d", "Maintenance fee", 75, "fee")] });
  assert.ok(t.split(/\s+/).length <= 150, String(t.split(/\s+/).length));
});

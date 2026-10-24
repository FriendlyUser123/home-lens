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

test("confirmed evidence moves a charge into a removal request with the photo", () => {
  const mk = (id: string, description: string, amount: number, chip: "proof" | "wear" | "fee") =>
    ({ id, description, amount, quote: "", category: "other" as const, chip, check: false });
  const clock = computeClock(d("2026-10-20"), null, d("2026-11-24"));
  const t = buildLetter({ tenantName: "Jordan Example", forwardingAddress: "1 Test St", landlordName: "Laurel Bend Apartments",
    moveOut: d("2026-10-20"), clock, today: d("2026-11-24"), letterDay: d("2026-11-22"), hasLetter: true, depositAmount: 1200,
    charges: [mk("a", "Carpet stain removal, bedroom", 210, "wear"), mk("b", "Wall scuff repaint", 85, "wear"), mk("c", "Cleaning", 150, "proof")],
    evidence: [{ chargeId: "a", photoId: 12, photoDate: "Aug 1, 2025", thing: "bedroom carpet" }, { chargeId: "b", photoId: 7, photoDate: "Aug 1, 2025", thing: "living room wall" }] });
  assert.match(t, /Removal of: Carpet stain removal \$210\. This bedroom carpet damage was present at move-in \(photo #12, dated Aug 1, 2025, attached\)/);
  assert.match(t, /Receipts or records for: Cleaning \$150/);
  assert.doesNotMatch(t, /normal wear/);
  assert.ok(t.split(/\s+/).length <= 170, String(t.split(/\s+/).length));
});

test("a barred fee stays a fee request even with a photo", () => {
  const c = { id: "f", description: "Maintenance fee", amount: 75, quote: "", category: "maintenance_fee" as const, chip: "fee" as const, check: false };
  const clock = computeClock(d("2026-10-20"), null, d("2026-11-24"));
  const t = buildLetter({ tenantName: "", forwardingAddress: "", landlordName: "", moveOut: d("2026-10-20"), clock, today: d("2026-11-24"),
    letterDay: null, hasLetter: true, depositAmount: null, charges: [c], evidence: [{ chargeId: "f", photoId: 1, photoDate: "Aug 1", thing: "x" }] });
  assert.match(t, /1\. Removal of: Maintenance fee \$75 \(Va\. Code/);
});

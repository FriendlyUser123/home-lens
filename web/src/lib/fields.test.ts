import test from "node:test";
import assert from "node:assert/strict";
import { buildFields, type Reading } from "./fields.ts";
import type { OcrWord } from "./locate.ts";

const W = (text: string, i: number, line: number): OcrWord => ({ text, x0: i * 50, y0: line * 20, x1: i * 50 + 45, y1: line * 20 + 15, line });
const words = [...["Maintenance", "fee", "$75.00"].map((t, i) => W(t, i, 0)), ...["Your", "security", "deposit", "of", "$1,200.00"].map((t, i) => W(t, i, 1))];

const base: Reading = {
  letterDate: "", depositAmount: "1200", landlordName: "", moveOutDate: "",
  quotes: { letterDate: "", deposit: "Your security deposit of $1,200.00", moveOut: "" },
  charges: [
    { id: "c0", description: "Maintenance fee", amount: 75, quote: "Maintenance fee $75.00", category: "maintenance_fee", chip: "fee", check: false },
    { id: "c1", description: "Pet damage", amount: 300, quote: "Pet damage, kitchen $300.00", category: "damage_repair", chip: "proof", check: false },
  ],
  provider: "gemini", model: "m", mocked: false,
};

test("found quotes get a place, missing ones are flagged and never boxed", () => {
  const f = buildFields(base, words);
  assert.deepEqual(f.map((x) => x.id), ["deposit", "c0", "c1"]);
  assert.ok(f[0]?.where && !f[0].check);
  assert.ok(f[1]?.where && !f[1].check);
  assert.equal(f[2]?.where, null);
  assert.equal(f[2]?.check, true);
});

test("empty fields are skipped; an amount missing from its quote is flagged", () => {
  const r = { ...base, depositAmount: "900", charges: [] };
  const f = buildFields(r, words);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.check, true);
});

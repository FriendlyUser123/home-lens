// Run: node web/rules.test.js
import assert from 'node:assert/strict';
import { addDays, daysBetween, repairDeadline, depositDeadline, objectionDeadline, matchCharge, buildLetter, buildNotice } from './rules.js';

assert.equal(addDays('2026-10-17', 45), '2026-12-01');
assert.equal(depositDeadline('2026-10-17'), '2026-12-01');
assert.equal(repairDeadline('2026-10-24'), '2026-11-07');
assert.equal(objectionDeadline('2026-10-28'), '2026-11-02');
assert.equal(addDays('2028-02-28', 1), '2028-02-29');
assert.equal(addDays('2026-12-30', 3), '2027-01-02');
assert.equal(daysBetween('2026-10-24', '2026-11-07'), 14);

const tags = [
  { id: 'a', label: 'Scuff on wall', keywords: ['wall', 'mark'] },
  { id: 'b', label: 'Carpet stain', keywords: ['carpet', 'floor'] },
];
assert.equal(matchCharge('Carpet replacement', tags).id, 'b');
assert.equal(matchCharge('Carpeting', tags).id, 'b');
assert.equal(matchCharge('Painting', tags), null);
assert.equal(matchCharge('Cleaning', []), null);

const letter = buildLetter({
  moveOut: '2026-10-17', tenant: 'T', landlord: 'L', address: 'A',
  charges: [
    { label: 'Carpet', amount: 480, evidence: { tag: 'Carpet stain', room: 'Bedroom', time: 'Aug 15, 2025' } },
    { label: 'Painting', amount: 120, evidence: null },
  ],
});
assert.match(letter, /Dec 1, 2026/);
assert.match(letter, /Carpet \(\$480\.00\): my move-in photo of "Carpet stain"/);
assert.match(letter, /Painting \(\$120\.00\): I have no move-in photo/);

const notice = buildNotice({ issue: 'Leak', desc: '', room: '', date: '2026-10-24', tenant: '', landlord: '', address: '' });
assert.match(notice, /Nov 7, 2026/);
assert.match(notice, /\[Your name\]/);

console.log('rules ok');

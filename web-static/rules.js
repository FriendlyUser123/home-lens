// Pure date and text rules. No DOM, no AI: dates and letters come from code, never from the model.
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

export const addDays = (iso, n) => new Date(parse(iso) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const todayIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fmtDate = (iso) =>
  new Date(parse(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const objectionDeadline = (moveInIso) => addDays(moveInIso, 5);   // Va. Code § 55.1-1214 (per team brief)
export const repairDeadline = (noticeIso) => addDays(noticeIso, 14);     // § 55.1-1244.1(B)
export const depositDeadline = (moveOutIso) => addDays(moveOutIso, 45);  // § 55.1-1226 (per team brief)

const words = (s) => String(s).toLowerCase().match(/[a-z]{4,}/g) || [];

// Best tag whose label/keywords share a word (or word stem) with the charge. Always a "possible match":
// the UI makes the person confirm it. Returns null when nothing overlaps.
export function matchCharge(chargeLabel, tags) {
  const cw = words(chargeLabel);
  let best = null, bestScore = 0;
  for (const t of tags) {
    const tw = [...words(t.label), ...(t.keywords || []).flatMap(words)];
    const score = cw.filter((c) => tw.some((w) => w.startsWith(c) || c.startsWith(w))).length;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

const ph = (v, fallback) => (v && v.trim() ? v.trim() : fallback);

export function buildNotice({ issue, desc, room, date, tenant, landlord, address }) {
  return `${fmtDate(date)}

To: ${ph(landlord, '[Landlord or property manager]')}
Re: Written notice of a repair needed, ${ph(address, '[Unit address]')}

I am writing to give notice of a condition in my unit that I believe may fall under Va. Code § 55.1-1244.1: ${issue.toLowerCase()}${room ? ` (${room})` : ''}.
${ph(desc, '[Describe what you see, when it started, and where.]')}

Please make reasonable efforts to repair this within 14 days of this notice, by ${fmtDate(repairDeadline(date))}. Photos are attached. Please contact me to arrange access.

Sincerely,
${ph(tenant, '[Your name]')}`;
}

// charges: [{ label, amount, evidence: null | { tag, room, time } }]
export function buildLetter({ moveOut, tenant, landlord, address, charges }) {
  const lines = charges.map((c) => {
    const money = `$${Number(c.amount).toFixed(2)}`;
    return c.evidence
      ? `- ${c.label} (${money}): my move-in photo of "${c.evidence.tag}" in the ${c.evidence.room}, taken ${c.evidence.time}, shows this condition was there at move-in. The photo is attached.`
      : `- ${c.label} (${money}): I have no move-in photo for this charge. Please send the documentation for it.`;
  });
  return `To: ${ph(landlord, '[Landlord or property manager]')}
Re: Security deposit, ${ph(address, '[Unit address]')}

I moved out on ${fmtDate(moveOut)}. I understand the itemized list of deductions, or a refund, is due within 45 days (Va. Code § 55.1-1226), which is ${fmtDate(depositDeadline(moveOut))}.

I am writing about these charges:
${lines.join('\n')}

Please send the itemized list with supporting documentation, and any refund owed, by that date.

Sincerely,
${ph(tenant, '[Your name]')}

This letter is a draft based on my own records. It is information, not legal advice.`;
}

// Plain-code legal rules. The model never touches dates, math or law.
// Source: Va. Code § 55.1-1226 (deadline, records, wear and tear), § 55.1-1208(C) (maintenance/repair fees),
// § 1-210(A) (the day of the event is not counted). Checked on law.lis.virginia.gov, 2026-10-24.

export type ChipKind = "proof" | "wear" | "fee" | "none";

export const CHIP_LABEL: Record<ChipKind, string> = {
  proof: "Ask for proof",
  wear: "Possibly normal wear",
  fee: "Fee may not be allowed",
  none: "Looks fine",
};

export type Category =
  | "cleaning"
  | "carpet_flooring"
  | "paint_walls"
  | "damage_repair"
  | "unpaid_rent"
  | "late_fee"
  | "utilities"
  | "maintenance_fee"
  | "other_fee"
  | "other";

export const CATEGORIES: Category[] = [
  "cleaning",
  "carpet_flooring",
  "paint_walls",
  "damage_repair",
  "unpaid_rent",
  "late_fee",
  "utilities",
  "maintenance_fee",
  "other_fee",
  "other",
];

/** Why each chip exists, with the section that backs it. Shown behind "Why?". */
export const CHIP_WHY: Record<ChipKind, { cite: string; text: string }> = {
  proof: {
    cite: "Va. Code § 55.1-1226(A), (F)",
    text: "Deductions must be itemized in writing, and you may inspect the landlord's records of deductions during business hours.",
  },
  wear: {
    cite: "Va. Code § 55.1-1226(A)(ii)",
    text: "Damage charges are allowed \"less reasonable wear and tear\". Ordinary carpet wear or faded paint is usually wear.",
  },
  fee: {
    cite: "Va. Code § 55.1-1208(C)",
    text: "A landlord may not charge a fee for maintenance or repair of the unit unless your violation of the law caused it.",
  },
  none: { cite: "", text: "" },
};

/** Only categories with a verified rule get anything other than "Ask for proof". */
export function chipFor(category: Category): ChipKind {
  switch (category) {
    case "maintenance_fee":
      return "fee";
    case "carpet_flooring":
    case "paint_walls":
      return "wear";
    default:
      return "proof";
  }
}

// ---- dates (UTC day numbers, so DST never shifts a deadline) ----

export function parseISO(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

export function toISO(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtShort(day: number): { mon: string; d: number; year: number } {
  const dt = new Date(day * 86_400_000);
  return { mon: MONTHS[dt.getUTCMonth()] ?? "", d: dt.getUTCDate(), year: dt.getUTCFullYear() };
}

export function fmtLong(day: number): string {
  const dt = new Date(day * 86_400_000);
  return `${MONTHS_LONG[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

export function weekday(day: number): string {
  return new Date(day * 86_400_000).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export function todayLocal(override?: string | null): number {
  if (override) {
    const o = parseISO(override);
    if (o !== null) return o;
  }
  const n = new Date();
  return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86_400_000);
}

// ---- the clock ----

export interface Clock {
  /** the later of lease end and move-out */
  start: number;
  deadline: number;
  /** deadline when the landlord gave the contractor notice in time (+15 days) */
  extendedDeadline: number;
  daysLeft: number;
  state: "open" | "today" | "passed";
}

/** § 55.1-1226(A): within 45 days after the later of termination or vacating. Day 1 is the day after (§ 1-210(A)). */
export function computeClock(moveOut: number, leaseEnd: number | null, today: number): Clock {
  const start = leaseEnd === null ? moveOut : Math.max(moveOut, leaseEnd);
  const deadline = start + 45;
  const daysLeft = deadline - today;
  return {
    start,
    deadline,
    extendedDeadline: deadline + 15,
    daysLeft,
    state: daysLeft > 0 ? "open" : daysLeft === 0 ? "today" : "passed",
  };
}

export function isLate(letterDay: number | null, clock: Clock): boolean {
  return letterDay !== null && letterDay > clock.deadline;
}

// ---- charges ----

export interface Charge {
  id: string;
  description: string;
  amount: number;
  quote: string;
  category: Category;
  chip: ChipKind;
  /** quote does not contain the amount, so the user should compare with the paper */
  check: boolean;
}

export function quoteHasAmount(quote: string, amount: number): boolean {
  const digits = quote.replace(/(\d),(\d)/g, "$1$2").replace(/[^0-9.]/g, " ").split(/\s+/).filter(Boolean);
  return digits.some((t) => Math.abs(Number(t) - amount) < 0.005);
}

export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

// ---- text helpers ----

/** "LAUREL BEND APARTMENTS" -> "Laurel Bend Apartments". Mixed-case text is left alone. */
export function titleCaseIfShouting(t: string): string {
  if (!/[A-Z]/.test(t) || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What the quote says beyond the title and the amount, or "" when it only repeats them. */
export function extraInQuote(c: Pick<Charge, "description" | "quote" | "amount">): string {
  let q = c.quote.replace(/\$?\s?\d[\d,]*(\.\d+)?/g, " ");
  const t = norm(c.description);
  const nq = norm(q);
  if (nq === t || nq.startsWith(t) && nq.slice(t.length).trim().length < 3) return "";
  if (t && nq.includes(t)) q = q.replace(new RegExp(c.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  return norm(q).length < 3 ? "" : q.replace(/\s+/g, " ").trim();
}

// ---- letter ----

export interface LetterInput {
  tenantName: string;
  forwardingAddress: string;
  landlordName: string;
  moveOut: number;
  clock: Clock;
  today: number;
  charges: Charge[];
  letterDay: number | null;
  hasLetter: boolean;
  depositAmount: number | null;
  /** matches the renter confirmed against their move-in scan */
  evidence?: Evidence[];
}

export interface Evidence {
  chargeId: string;
  photoId: number;
  /** e.g. "Aug 1, 2025" */
  photoDate: string;
  /** e.g. "bedroom carpet" */
  thing: string;
}

const short = (c: Charge, withAmount: boolean): string => {
  const d = c.description.split(/[,(]/)[0]?.trim() || c.description;
  return withAmount ? `${d} ${money(c.amount)}` : d;
};

export function buildLetter(i: LetterInput): string {
  const name = i.tenantName.trim() || "[Your name]";
  const addr = i.forwardingAddress.trim() || "[Your forwarding address]";
  const to = i.landlordName.trim() || "[Landlord or property manager]";
  const L: string[] = [fmtLong(i.today), "", to, `Re: Security deposit, move-out ${fmtLong(i.moveOut)}`, "", `Dear ${to},`, ""];
  if (!i.hasLetter) {
    L.push(
      `I moved out on ${fmtLong(i.moveOut)}. Under Va. Code § 55.1-1226, my deposit${i.depositAmount !== null ? ` of ${money(i.depositAmount)}` : ""} and an itemized list of any deductions were due by ${fmtLong(i.clock.deadline)}. I have not received them. Please send both to the address below.`,
    );
  } else {
    const late = isLate(i.letterDay, i.clock) ? ` It is dated after the ${fmtLong(i.clock.deadline)} deadline.` : "";
    L.push(`I moved out on ${fmtLong(i.moveOut)} and received your list of deductions.${late} Under Va. Code § 55.1-1226, please send:`);
    const ev = new Map((i.evidence ?? []).map((e) => [e.chargeId, e]));
    // A confirmed photo is stronger than any flag, except a fee that is barred outright.
    const proven = i.charges.filter((c) => ev.has(c.id) && c.chip !== "fee");
    const rest = i.charges.filter((c) => !proven.includes(c));
    const proof = rest.filter((c) => c.chip === "proof");
    const wear = rest.filter((c) => c.chip === "wear");
    const fee = rest.filter((c) => c.chip === "fee");
    let n = 0;
    for (const c of proven) {
      const e = ev.get(c.id) as Evidence;
      L.push(`${++n}. Removal of: ${short(c, true)}. This ${e.thing} damage was present at move-in (photo #${e.photoId}, dated ${e.photoDate}, attached).`);
    }
    if (proof.length) L.push(`${++n}. Receipts or records for: ${proof.map((c) => short(c, true)).join(", ")}.`);
    if (wear.length) L.push(`${++n}. How normal wear and tear was subtracted for: ${wear.map((c) => short(c, false)).join(", ")}.`);
    if (fee.length) L.push(`${++n}. Removal of: ${fee.map((c) => short(c, true)).join(", ")} (Va. Code § 55.1-1208(C) bars maintenance and repair fees).`);
    if (n === 0) L.push("1. A copy of your records of these deductions.");
  }
  L.push("", "I also ask to inspect your deduction records. Please reply within 10 days. Thank you.", "", "Sincerely,", name, addr);
  return L.join("\n");
}

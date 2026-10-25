// Matches a landlord's move-out charges to the renter's move-in damage tags (room-tags.schema.json).
import type { Evidence } from "./rules.ts";
// Pure and deterministic: room + object + wording. The user always confirms; this only proposes.

export interface RoomTag {
  id: number;
  room: string;
  object: string;
  note: string;
  photo: string;
  box?: number[];
  takenAt: string;
  pose?: number[];
  /** 3D spot of the tag in the scan's own world, metres (optional; from the room scan) */
  position?: [number, number, number];
  /** keyframe the photo came from (optional) */
  frame?: string;
  /** the `photo` value as written in the file, kept so an export stays portable */
  photoName?: string;
  confirmed: boolean;
}

export interface RoomScan {
  scanId: string;
  address: string;
  capturedAt: string;
  tags: RoomTag[];
}

export interface ChargeText {
  id: string;
  description: string;
  quote: string;
  category: string;
}

export interface Candidate {
  chargeId: string;
  tagId: number;
  /** 0 to 1 */
  score: number;
  /** plain words both sides share, e.g. ["carpet", "bedroom", "stain"] */
  shared: string[];
}

const ROOM_WORDS: Record<string, string[]> = {
  bedroom: ["bedroom", "bed room", "master"],
  bathroom: ["bathroom", "bath", "restroom", "washroom"],
  kitchen: ["kitchen", "kitchenette"],
  "living room": ["living room", "livingroom", "living", "lounge", "family room"],
  hallway: ["hallway", "hall", "corridor", "entry", "foyer"],
  closet: ["closet", "wardrobe"],
};

const OBJECT_WORDS: Record<string, string[]> = {
  carpet: ["carpet", "carpeting", "carpets", "rug", "shampoo"],
  wall: ["wall", "walls", "paint", "repaint", "painting", "drywall", "patching", "patch", "baseboard"],
  door: ["door", "doors", "doorframe"],
  window: ["window", "windows", "screen", "pane"],
  blinds: ["blind", "blinds", "slat", "slats"],
  counter: ["counter", "countertop", "countertops", "counters"],
  floor: ["floor", "floors", "flooring", "hardwood", "tile", "vinyl", "laminate"],
  ceiling: ["ceiling", "ceilings"],
  appliance: ["appliance", "stove", "oven", "range", "fridge", "refrigerator", "dishwasher", "microwave"],
  fixture: ["fixture", "faucet", "sink", "toilet", "tub", "shower", "vanity", "light"],
};

/** How well a tag object substitutes for a charge object, e.g. a "floor" photo can back a carpet charge. */
const NEAR_OBJECT: Record<string, Record<string, number>> = {
  carpet: { floor: 0.6 },
  floor: { carpet: 0.6 },
};

/** Damage words that mean about the same thing. */
const WORDING: string[][] = [
  ["stain", "stained", "stains", "spill", "discolor", "discolored", "discoloration", "blotch"],
  ["scuff", "scuffs", "scuffed", "scrape", "scrapes", "scraped", "scratch", "scratches", "scratched", "mark", "marks"],
  ["burn", "burned", "burnt", "scorch", "scorched"],
  ["bent", "broken", "warped", "slats", "damaged"],
  ["hole", "holes", "dent", "dents", "puncture", "patch", "patching", "gouge"],
  ["crack", "cracked", "chip", "chipped", "split"],
  ["worn", "wear", "frayed", "torn", "tear"],
  ["mold", "mildew", "moisture"],
];

const GENERIC_ROOM_FOR_UNIT = /\b(entire|whole|all)\s+(unit|apartment|home)\b/;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`).test(haystack);
}

function findKeys(text: string, table: Record<string, string[]>): string[] {
  const t = ` ${words(text).join(" ")} `;
  return Object.entries(table)
    .filter(([, list]) => list.some((w) => hasPhrase(t, w)))
    .map(([k]) => k);
}

function wordingGroups(text: string): number[] {
  const w = new Set(words(text));
  const out: number[] = [];
  WORDING.forEach((g, i) => { if (g.some((x) => w.has(x))) out.push(i); });
  return out;
}

const CATEGORY_OBJECT: Record<string, string> = { carpet_flooring: "carpet", paint_walls: "wall" };

export function chargeObjects(c: ChargeText): string[] {
  const found = findKeys(`${c.description} ${c.quote}`, OBJECT_WORDS);
  if (found.length) return found;
  const hint = CATEGORY_OBJECT[c.category];
  return hint ? [hint] : [];
}

export function chargeRooms(c: ChargeText): string[] {
  const text = `${c.description} ${c.quote}`;
  if (GENERIC_ROOM_FOR_UNIT.test(text.toLowerCase())) return [];
  return findKeys(text, ROOM_WORDS);
}

export interface MatchOptions {
  /** drop tags the renter never confirmed (default true) */
  onlyConfirmed?: boolean;
  /** lowest score to propose (default 0.55) */
  threshold?: number;
  /** candidates kept per charge (default 2) */
  perCharge?: number;
}

export function scoreCharge(c: ChargeText, tag: RoomTag): Candidate | null {
  const objects = chargeObjects(c);
  const tagObject = tag.object.trim().toLowerCase();
  let obj = 0;
  for (const o of objects) {
    obj = Math.max(obj, o === tagObject ? 1 : (NEAR_OBJECT[o]?.[tagObject] ?? 0));
  }
  if (obj === 0) return null;

  const rooms = chargeRooms(c);
  const tagRoom = tag.room.trim().toLowerCase();
  // "Carpet stain, bedroom closet" names two rooms; a tag in either one counts. A different room is a miss.
  const tagRooms = new Set([tagRoom, ...findKeys(tag.note, { closet: ROOM_WORDS.closet ?? [] })]);
  let room: number;
  if (rooms.length === 0) room = 0.3;
  else if (rooms.some((r) => tagRooms.has(r))) room = 1;
  else return null;

  const cw = wordingGroups(`${c.description} ${c.quote}`);
  const tw = wordingGroups(`${tag.note} ${tag.object}`);
  const sharedGroups = cw.filter((g) => tw.includes(g));
  const wording = sharedGroups.length ? 1 : 0;

  const score = 0.5 * obj + 0.3 * room + 0.2 * wording;
  const shared: string[] = [];
  if (obj > 0) shared.push(objects.find((o) => o === tagObject) ?? tagObject);
  if (room === 1) shared.push(tagRoom);
  for (const g of sharedGroups) shared.push(WORDING[g]?.[0] ?? "");
  return { chargeId: c.id, tagId: tag.id, score: Math.round(score * 100) / 100, shared: shared.filter(Boolean) };
}

/** Best tags for every charge. Charges with no plausible tag are simply absent from the result. */
export function matchCharges(charges: ChargeText[], tags: RoomTag[], opts: MatchOptions = {}): Candidate[] {
  const { onlyConfirmed = true, threshold = 0.55, perCharge = 2 } = opts;
  const usable = tags.filter((t) => !onlyConfirmed || t.confirmed);
  const out: Candidate[] = [];
  for (const c of charges) {
    const scored = usable
      .map((t) => scoreCharge(c, t))
      .filter((x): x is Candidate => x !== null && x.score >= threshold)
      .sort((a, b) => b.score - a.score || a.tagId - b.tagId);
    out.push(...scored.slice(0, perCharge));
  }
  return out;
}

// ---- loading the hand-off file ----

export function parsePosition(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  const [x, y, z] = v as unknown[];
  return [x, y, z].every((n) => typeof n === "number" && Number.isFinite(n)) ? [x as number, y as number, z as number] : undefined;
}

const ROOMS = ["bedroom", "bathroom", "kitchen", "living room", "hallway", "closet", "other"];

/** Checks the JSON against shared/room-tags.schema.json. Throws an Error with a plain message. */
export function parseRoomScan(input: unknown): RoomScan {
  if (typeof input !== "object" || input === null) throw new Error("That file is not a room scan.");
  const o = input as Record<string, unknown>;
  if (!Array.isArray(o.tags)) throw new Error("This room scan has no tags.");
  const tags: RoomTag[] = o.tags.map((raw, i) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    if (typeof t.id !== "number" || typeof t.object !== "string" || typeof t.photo !== "string" || typeof t.takenAt !== "string") {
      throw new Error(`Tag ${i + 1} is missing a field.`);
    }
    const room = typeof t.room === "string" && ROOMS.includes(t.room) ? t.room : "other";
    return {
      id: t.id,
      room,
      object: t.object.toLowerCase(),
      note: typeof t.note === "string" ? t.note : "",
      photo: t.photo,
      box: Array.isArray(t.box) && t.box.length === 4 ? (t.box as number[]) : undefined,
      takenAt: t.takenAt,
      pose: Array.isArray(t.pose) ? (t.pose as number[]) : undefined,
      position: parsePosition(t.position),
      frame: typeof t.frame === "string" ? t.frame : undefined,
      confirmed: t.confirmed === true,
    };
  });
  return {
    scanId: String(o.scanId ?? ""),
    address: String(o.address ?? ""),
    capturedAt: String(o.capturedAt ?? ""),
    tags,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 1" or "Aug 1, 2025". Uses the date part of the ISO string so time zones never shift the day. */
export function photoDate(iso: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const day = `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}`;
  return withYear ? `${day}, ${m[1]}` : day;
}

// ---- the user's yes / no on each proposal ----

export type Decisions = Record<string, "yes" | "no">;

export const decisionKey = (c: { chargeId: string; tagId: number }): string => `${c.chargeId}:${c.tagId}`;

/** Only proposals the user said yes to, best first. A proposal is never confirmed on its own. */
export function confirmedMatches(cands: Candidate[], decisions: Decisions): Candidate[] {
  return cands.filter((c) => decisions[decisionKey(c)] === "yes");
}

/** One line of evidence per charge for the letter: the best confirmed photo. */
export function toEvidence(confirmed: Candidate[], tags: RoomTag[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const c of confirmed) {
    const tag = tags.find((t) => t.id === c.tagId);
    if (!tag || seen.has(c.chargeId)) continue;
    seen.add(c.chargeId);
    out.push({
      chargeId: c.chargeId,
      photoId: tag.id,
      photoDate: photoDate(tag.takenAt, true),
      thing: tag.room === "other" ? tag.object : `${tag.room} ${tag.object}`,
    });
  }
  return out;
}

// Report a problem: the written repair notice and its 14-day clock. Plain code, no AI.
// Ported from Dhruv's web-static/rules.js (repairDeadline, buildNotice) to TypeScript on the app's day-number dates.
// Va. Code § 55.1-1244.1 is the cite from the team brief; re-check it before relying on the wording.
import { fmtLong } from "./rules.ts";

export const REPAIR_DAYS = 14;
export const REPAIR_CITE = "Va. Code § 55.1-1244.1";

/** Last day of the 14-day window. Day 1 is the day after the notice. */
export const repairDeadline = (notice: number): number => notice + REPAIR_DAYS;

export interface RepairClock {
  deadline: number;
  daysLeft: number;
  state: "open" | "today" | "passed";
}

export function repairClock(notice: number, today: number): RepairClock {
  const deadline = repairDeadline(notice);
  const daysLeft = deadline - today;
  return { deadline, daysLeft, state: daysLeft > 0 ? "open" : daysLeft === 0 ? "today" : "passed" };
}

export interface NoticeInput {
  issue: string;
  description: string;
  room: string;
  /** the day the notice is sent, as a day number */
  date: number;
  tenant: string;
  landlord: string;
  address: string;
  /** a photo is attached */
  photo: boolean;
}

const ph = (v: string, fallback: string): string => (v.trim() ? v.trim() : fallback);

export function buildNotice(i: NoticeInput): string {
  const issue = ph(i.issue, "[the problem]").replace(/[.\s]+$/, "");
  const where = i.room.trim() ? ` (${i.room.trim()})` : "";
  return [
    fmtLong(i.date),
    "",
    `To: ${ph(i.landlord, "[Landlord or property manager]")}`,
    `Re: Written notice of a repair needed, ${ph(i.address, "[Unit address]")}`,
    "",
    `I am writing to give notice of a condition in my unit that I believe may fall under ${REPAIR_CITE}: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}${where}.`,
    ph(i.description, "[Describe what you see, when it started, and where.]"),
    "",
    `Please make reasonable efforts to repair this within ${REPAIR_DAYS} days of this notice, by ${fmtLong(repairDeadline(i.date))}. ${i.photo ? "A photo is attached. " : ""}Please contact me to arrange access.`,
    "",
    "Sincerely,",
    ph(i.tenant, "[Your name]"),
    "",
    "Keep a copy and send this in a way you can prove, such as email or certified mail.",
  ].join("\n");
}

import { CATEGORIES, chipFor, quoteHasAmount, titleCaseIfShouting, type Category, type Charge } from "./lib/rules.ts";
import type { Reading } from "./lib/fields.ts";

export interface Health {
  ok: boolean;
  provider: "ollama" | "gemini" | "mock";
  model: string;
}

interface Raw {
  letter_date: string | null;
  letter_date_quote: string;
  landlord_name: string | null;
  deposit_amount: number | null;
  deposit_amount_quote: string;
  move_out_date: string | null;
  move_out_date_quote: string;
  charges: { description: string; amount: number; quote: string; category: string }[];
  provider: Health["provider"];
  model: string;
  mocked: boolean;
}

export async function health(): Promise<Health | null> {
  try {
    const r = await fetch("/api/health");
    return r.ok ? ((await r.json()) as Health) : null;
  } catch {
    return null;
  }
}

/** Sends the flattened page to the API and returns the fields, each with the quote it came from. */
export async function readLetter(dataUrl: string, mime: string): Promise<Reading> {
  const res = await fetch("/api/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: dataUrl, mime }),
  });
  const json = (await res.json()) as Raw & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Could not read the photo.");
  const charges: Charge[] = json.charges.map((c, i) => {
    const category = (CATEGORIES as string[]).includes(c.category) ? (c.category as Category) : "other";
    return {
      id: `c${i}`,
      description: titleCaseIfShouting(c.description),
      amount: c.amount,
      quote: c.quote,
      category,
      chip: chipFor(category),
      check: !quoteHasAmount(c.quote, c.amount),
    };
  });
  return {
    letterDate: json.letter_date ?? "",
    depositAmount: json.deposit_amount === null ? "" : String(json.deposit_amount),
    landlordName: titleCaseIfShouting(json.landlord_name ?? ""),
    moveOutDate: json.move_out_date ?? "",
    quotes: { letterDate: json.letter_date_quote, deposit: json.deposit_amount_quote, moveOut: json.move_out_date_quote },
    charges,
    provider: json.provider,
    model: json.model,
    mocked: json.mocked,
  };
}

export interface IssueGuess { issue: string; room: string; description: string; model: string; mocked: boolean }

/** Gemma names the problem in a photo. The renter edits it; code writes the notice. */
export async function nameIssue(dataUrl: string): Promise<IssueGuess> {
  const res = await fetch("/api/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: dataUrl, mime: "image/jpeg" }),
  });
  const json = (await res.json()) as IssueGuess & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Could not read the photo.");
  return json;
}

import type { Located, OcrWord } from "./locate.ts";
import { locateQuote } from "./locate.ts";
import type { Charge } from "./rules.ts";
import { money, quoteHasAmount } from "./rules.ts";

export interface Reading {
  letterDate: string;
  depositAmount: string;
  landlordName: string;
  moveOutDate: string;
  quotes: { letterDate: string; deposit: string; moveOut: string };
  charges: Charge[];
  provider: "ollama" | "gemini" | "mock";
  model: string;
  mocked: boolean;
}

export interface Field {
  id: string;
  label: string;
  value: string;
  quote: string;
  /** where the quote sits on the page; null when it could not be found */
  where: Located | null;
  /** true when the user should look at the paper: quote not found, or the amount is not in it */
  check: boolean;
}

function one(id: string, label: string, value: string, quote: string, words: OcrWord[], extraCheck = false): Field | null {
  if (!value && !quote) return null;
  const where = quote ? locateQuote(words, quote) : null;
  return { id, label, value, quote, where, check: where === null || extraCheck };
}

/** Joins the model's fields with OCR word boxes. A field never gets a highlight unless its quote was really found. */
export function buildFields(r: Reading, words: OcrWord[]): Field[] {
  const out: (Field | null)[] = [
    one("letterDate", "Letter date", r.letterDate, r.quotes.letterDate, words),
    one("deposit", "Deposit held", r.depositAmount ? money(Number(r.depositAmount)) : "", r.quotes.deposit, words,
      r.depositAmount !== "" && r.quotes.deposit !== "" && !quoteHasAmount(r.quotes.deposit, Number(r.depositAmount))),
    one("moveOut", "Move-out", r.moveOutDate, r.quotes.moveOut, words),
    ...r.charges.map((c) => one(c.id, c.description, money(c.amount), c.quote, words, c.check)),
  ];
  return out.filter((f): f is Field => f !== null);
}

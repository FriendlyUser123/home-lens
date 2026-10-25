// Provider switch (default: Gemma 4 via the Gemini API). Gemma does PERCEPTION only: it reads a photo of a deduction letter into fields.
// All dates, math and legal rules live in src/lib/rules.ts.

export type Provider = "ollama" | "gemini" | "mock";

export interface ReadResult {
  letter_date: string | null;
  letter_date_quote: string;
  landlord_name: string | null;
  deposit_amount: number | null;
  deposit_amount_quote: string;
  move_out_date: string | null;
  move_out_date_quote: string;
  charges: { description: string; amount: number; quote: string; category: string }[];
  provider: Provider;
  model: string;
  /** true when the model was not actually run */
  mocked: boolean;
}

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11435";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemma-4-26b-a4b-it";

export function provider(): Provider {
  const p = (process.env.MODEL_PROVIDER ?? "gemini").toLowerCase();
  return p === "gemini" || p === "mock" ? p : "ollama";
}

const CATEGORIES = [
  "cleaning", "carpet_flooring", "paint_walls", "damage_repair", "unpaid_rent",
  "late_fee", "utilities", "maintenance_fee", "other_fee", "other",
];

const PROMPT = `You read a photo of a landlord's security deposit letter or statement. Extract only what is printed. Do not guess.
Return JSON with:
- letter_date: the date on the letter as YYYY-MM-DD, or null. letter_date_quote: the exact text you read it from, or "".
- landlord_name: the company or person who sent it, or null.
- deposit_amount: the total security deposit held, as a number, or null. deposit_amount_quote: exact text, or "".
- move_out_date: the move-out or vacated date as YYYY-MM-DD if printed, or null. move_out_date_quote: exact text, or "".
- charges: one entry for EACH deduction line (not the totals, not the refund). For each: description (short, as printed), amount (number), quote (the exact printed line, copied word for word including the amount), category.
category must be one of: ${CATEGORIES.join(", ")}.
Use maintenance_fee only for a generic maintenance or repair FEE not tied to a named damaged item. Use carpet_flooring for carpet or floor charges, paint_walls for paint or wall charges, cleaning for cleaning, utilities for water, sewer, electric or gas bills.
Copy quotes exactly. If a value is not on the paper, use null or "".`;

const SCHEMA = {
  type: "object",
  properties: {
    letter_date: { type: ["string", "null"] },
    letter_date_quote: { type: "string" },
    landlord_name: { type: ["string", "null"] },
    deposit_amount: { type: ["number", "null"] },
    deposit_amount_quote: { type: "string" },
    move_out_date: { type: ["string", "null"] },
    move_out_date_quote: { type: "string" },
    charges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          amount: { type: "number" },
          quote: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
        },
        required: ["description", "amount", "quote", "category"],
      },
    },
  },
  required: ["letter_date", "letter_date_quote", "landlord_name", "deposit_amount", "deposit_amount_quote",
    "move_out_date", "move_out_date_quote", "charges"],
};

type Raw = Omit<ReadResult, "provider" | "model" | "mocked">;

function parseJSON(text: string): Raw {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model returned no JSON");
  const o = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Raw>;
  return {
    letter_date: typeof o.letter_date === "string" ? o.letter_date : null,
    letter_date_quote: o.letter_date_quote ?? "",
    landlord_name: typeof o.landlord_name === "string" ? o.landlord_name : null,
    deposit_amount: typeof o.deposit_amount === "number" ? o.deposit_amount : null,
    deposit_amount_quote: o.deposit_amount_quote ?? "",
    move_out_date: typeof o.move_out_date === "string" ? o.move_out_date : null,
    move_out_date_quote: o.move_out_date_quote ?? "",
    charges: (Array.isArray(o.charges) ? o.charges : [])
      .filter((c) => c && typeof c.amount === "number")
      .map((c) => ({
        description: String(c.description ?? ""),
        amount: c.amount,
        quote: String(c.quote ?? "").replace(/\s+/g, " ").trim(),
        category: CATEGORIES.includes(String(c.category)) ? String(c.category) : "other",
      })),
  };
}

async function viaOllama(imageB64: string): Promise<ReadResult> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      format: SCHEMA,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: "user", content: PROMPT, images: [imageB64] }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return { ...parseJSON(data.message?.content ?? ""), provider: "ollama", model: OLLAMA_MODEL, mocked: false };
}

async function geminiText(prompt: string, imageB64: string, mime: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const call = (thinking: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: imageB64 } }] }],
        // Reading printed text needs no long reasoning: "minimal" cuts about 8 s to about 1.5 s per page.
        generationConfig: { temperature: 0, responseMimeType: "application/json", ...(thinking ? {} : { thinkingConfig: { thinkingLevel: "minimal" } }) },
      }),
    });
  let res = await call(false);
  if (res.status === 400) res = await call(true); // a model that rejects thinkingConfig still works without it
  for (let n = 0; n < 2 && (res.status === 429 || res.status >= 500); n++) {
    await new Promise((r) => setTimeout(r, 1500 * (n + 1)));
    res = await call(false);
  }
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
}

async function viaGemini(imageB64: string, mime: string): Promise<ReadResult> {
  return { ...parseJSON(await geminiText(PROMPT, imageB64, mime)), provider: "gemini", model: GEMINI_MODEL, mocked: false };
}

/** Canned output so the UI can be developed without a GPU. Only used when MODEL_PROVIDER=mock. */
function viaMock(): ReadResult {
  return {
    letter_date: "2026-11-20",
    letter_date_quote: "November 20, 2026",
    landlord_name: "Laurel Bend Apartments",
    deposit_amount: 1200,
    deposit_amount_quote: "Your security deposit of $1,200.00",
    move_out_date: "2026-10-17",
    move_out_date_quote: "you vacated Unit 4B on October 17, 2026",
    charges: [
      { description: "Carpet replacement, bedroom", amount: 480, quote: "Carpet replacement, bedroom (worn and stained) $480.00", category: "carpet_flooring" },
      { description: "Professional cleaning", amount: 175, quote: "Professional cleaning, entire unit $175.00", category: "cleaning" },
      { description: "Wall patching and repaint", amount: 90, quote: "Wall patching and repaint, living room $90.00", category: "paint_walls" },
      { description: "Maintenance fee", amount: 75, quote: "Maintenance fee $75.00", category: "maintenance_fee" },
      { description: "Unpaid water and sewer", amount: 38.5, quote: "Unpaid water and sewer, final bill $38.50", category: "utilities" },
    ],
    provider: "mock",
    model: "canned",
    mocked: true,
  };
}

export async function readDocument(imageB64: string, mime: string): Promise<ReadResult> {
  switch (provider()) {
    case "gemini":
      return viaGemini(imageB64, mime);
    case "mock":
      return viaMock();
    default:
      return viaOllama(imageB64);
  }
}

// ---- Report a problem: Gemma names what is wrong in a photo. Perception only; the renter edits it and code writes the notice. ----

export interface IssueResult {
  issue: string;
  room: string;
  description: string;
  provider: Provider;
  model: string;
  mocked: boolean;
}

const ISSUE_PROMPT = `You look at a photo a renter took of a problem in their home (a leak, mold, a broken lock, a pest, damaged flooring, no heat, and so on).
Describe only what is visible. Do not guess causes or blame anyone.
Return JSON with:
- issue: a short name of the problem, 8 words or fewer, e.g. "Water stain and drip under kitchen sink".
- room: one of bedroom, bathroom, kitchen, living room, hallway, closet, other, or "" if you cannot tell.
- description: one or two plain sentences of what is visible.
Always name the most likely visible problem, even if the photo is small or an illustration. Use "" only when nothing at all looks wrong.`;

const ROOMS = ["bedroom", "bathroom", "kitchen", "living room", "hallway", "closet", "other"];

function parseIssue(text: string): Pick<IssueResult, "issue" | "room" | "description"> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model returned no JSON");
  const o = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const room = typeof o.room === "string" && ROOMS.includes(o.room) ? o.room : "";
  return { issue: typeof o.issue === "string" ? o.issue.trim() : "", room, description: typeof o.description === "string" ? o.description.trim() : "" };
}

const ISSUE_SCHEMA = {
  type: "object",
  properties: { issue: { type: "string" }, room: { type: "string" }, description: { type: "string" } },
  required: ["issue", "room", "description"],
};

export async function nameIssue(imageB64: string, mime: string): Promise<IssueResult> {
  switch (provider()) {
    case "gemini":
    {
      // the model sometimes answers with an empty issue on the first try; one retry is cheap
      let r = parseIssue(await geminiText(ISSUE_PROMPT, imageB64, mime));
      if (!r.issue) r = parseIssue(await geminiText(ISSUE_PROMPT, imageB64, mime));
      return { ...r, provider: "gemini", model: GEMINI_MODEL, mocked: false };
    }
    case "mock":
      return { issue: "Bent window blind slats", room: "bedroom", description: "Two slats of the blind are bent and no longer lie flat.", provider: "mock", model: "canned", mocked: true };
    default: {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, think: false, format: ISSUE_SCHEMA, options: { temperature: 0, num_ctx: 8192 }, messages: [{ role: "user", content: ISSUE_PROMPT, images: [imageB64] }] }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { message?: { content?: string } };
      return { ...parseIssue(data.message?.content ?? ""), provider: "ollama", model: OLLAMA_MODEL, mocked: false };
    }
  }
}

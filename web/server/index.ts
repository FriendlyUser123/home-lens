// Tiny API. No storage, no logging of request bodies. The photo is forwarded to the model and forgotten.
import { createServer } from "node:http";
import { nameIssue, readDocument, provider, OLLAMA_MODEL, GEMINI_MODEL } from "./model.ts";

const PORT = Number(process.env.PORT ?? 8710);
const MAX_BYTES = 12 * 1024 * 1024;

async function body(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BYTES) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown): void => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      const p = provider();
      return send(200, { ok: true, provider: p, model: p === "gemini" ? GEMINI_MODEL : p === "ollama" ? OLLAMA_MODEL : "canned" });
    }
    if (req.method === "POST" && req.url === "/api/read") {
      const { image, mime } = JSON.parse(await body(req)) as { image?: string; mime?: string };
      if (!image) return send(400, { error: "no image" });
      const b64 = image.replace(/^data:[^,]*,/, "");
      return send(200, await readDocument(b64, mime ?? "image/png"));
    }
    if (req.method === "POST" && req.url === "/api/issue") {
      const { image, mime } = JSON.parse(await body(req)) as { image?: string; mime?: string };
      if (!image) return send(400, { error: "no image" });
      return send(200, await nameIssue(image.replace(/^data:[^,]*,/, ""), mime ?? "image/jpeg"));
    }
    send(404, { error: "not found" });
  } catch (e) {
    send(502, { error: e instanceof Error ? e.message : "failed" });
  }
});

server.listen(PORT, () => console.log(`home-lens api on :${PORT} (${provider()})`));

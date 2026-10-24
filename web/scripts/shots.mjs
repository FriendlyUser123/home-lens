// Headless Chrome screenshots via playwright-core (NOT the shared Playwright MCP).
// Needs `npm run dev` running and GEMINI_API_KEY exported for the real model.
// Uses a fake camera that streams public/samples/letter-photo.png. Usage: node scripts/shots.mjs [390|1440] [tag]
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const tmp = process.env.TMPDIR ?? "/home/john/.cache/tmp";
mkdirSync(tmp, { recursive: true });
const cam = resolve(tmp, "home-lens-fake-cam.y4m");
if (!existsSync(cam)) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "2", "-i", resolve("public/samples/letter-photo.png"), "-t", "1", "-pix_fmt", "yuv420p", cam]);
}
const BASE = "http://localhost:5180/?today=2026-11-25";
const only = process.argv[2];
const tag = process.argv[3] ?? "";
const sizes = [[390, 844], [1440, 900]].filter(([w]) => !only || String(w) === only);
mkdirSync("shots", { recursive: true });

for (const [w, h] of sizes) {
  const ctx = await chromium.launchPersistentContext(resolve(tmp, `home-lens-chrome-${w}`), {
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    permissions: ["camera"],
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${cam}`],
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push(String(e)));
  const shot = async (n, fullPage = true) => page.screenshot({ path: `shots/${tag}${n}-${w}.png`, fullPage });
  const t0 = Date.now();
  const lap = (s) => console.log(`${w} ${s} +${Math.round((Date.now() - t0) / 1000)}s`);

  await page.goto(BASE);
  await page.getByRole("heading", { name: "Scan your deposit letter" }).waitFor();
  await shot("1-start");

  await page.getByRole("button", { name: "Open camera" }).click();
  await page.getByText("Page found").waitFor({ timeout: 90000 });
  await page.waitForTimeout(900);
  await shot("2-camera");
  lap("camera locked");

  await page.getByRole("button", { name: "Take photo" }).click();
  await page.waitForSelector(".stage.flatten img", { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot("3-flatten");

  await page.waitForSelector(".stage.read .wb", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  await shot("4-reading-wait", false);
  await page.getByRole("heading", { name: "Here is what we found" }).waitFor({ timeout: 240000 });
  lap("model + ocr done");
  await page.waitForTimeout(900);
  await shot("5-reading-mid", false);
  await page.waitForFunction(() => !document.querySelector(".go button")?.hasAttribute("disabled"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot("6-reading", false);
  await page.getByRole("button", { name: "Check the details" }).click();

  await page.getByRole("heading", { name: "Does this match your paper?" }).waitFor();
  await page.getByRole("button", { name: /^Carpet stain removal/ }).click();
  await shot("7-confirm");
  await page.getByRole("button", { name: "Looks right" }).click();

  await page.getByRole("heading", { name: "Your landlord must answer by" }).waitFor();
  await page.waitForTimeout(600);
  await shot("8-result");
  await page.getByRole("button", { name: "Match move-in photos" }).click();

  await page.getByRole("heading", { name: "Add your move-in scan" }).waitFor();
  await shot("9-scan-load");
  await page.getByRole("button", { name: "Use the sample scan" }).click();
  await page.getByRole("heading", { name: "Do these photos match?" }).waitFor();
  await page.waitForTimeout(400);
  await shot("10-photos");
  for (;;) {
    const b = page.getByRole("button", { name: /^Confirm/ }).first();
    if (!(await b.count())) break;
    await b.click();
  }
  await shot("11-photos-confirmed");
  await page.getByRole("button", { name: /^Get my letter/ }).click();

  await page.getByRole("heading", { name: "Your letter is ready" }).waitFor();
  await page.getByLabel("Your name").fill("Jordan Example");
  await page.getByLabel("Forwarding address").fill("12 Elm St, Roanoke VA");
  await shot("12-letter");
  await page.getByRole("button", { name: "Evidence sheet" }).click();
  await page.getByRole("heading", { name: "Your evidence sheet" }).waitFor();
  await shot("13-evidence");
  lap("done");
  if (errs.length) console.log("console errors", w, errs);
  await ctx.close();
}

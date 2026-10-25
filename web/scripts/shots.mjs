// Headless Chrome walk through every screen at 390 and 1440 -> shots/ (gitignored), via playwright-core (NOT the shared Playwright MCP).
// Needs the app running (API on PORT, web on WEB_PORT) and GEMINI_API_KEY exported in the API's shell for the real model.
// The real Gemma reply for the letter and for the problem photo is recorded once (1440) and replayed at 390.
// Fake camera streams public/samples/letter-photo.png.
// Usage: PORT=8720 WEB_PORT=5190 node scripts/shots.mjs [390|1440] [tag]
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const tmp = process.env.TMPDIR ?? "/home/john/.cache/tmp";
mkdirSync(tmp, { recursive: true });
const cam = resolve(tmp, "home-lens-fake-cam.y4m");
if (!existsSync(cam)) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "2", "-i", resolve("public/samples/letter-photo.png"), "-t", "1", "-pix_fmt", "yuv420p", cam]);
}
const BASE = `http://localhost:${process.env.WEB_PORT ?? 5180}/?today=2026-11-25`;
const only = process.argv[2];
const tag = process.argv[3] ?? "";
const sizes = [[1440, 900], [390, 844]].filter(([w]) => !only || String(w) === only);
mkdirSync("shots", { recursive: true });
const cacheFile = (n) => resolve(tmp, `home-lens-gemma-${n}.json`);
if (!only || only === "1440") for (const n of ["read", "issue"]) rmSync(cacheFile(n), { force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed = true; };

for (const [w, h] of sizes) {
  const ctx = await chromium.launchPersistentContext(resolve(tmp, `home-lens-chrome-${w}`), {
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    permissions: ["camera"],
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${cam}`,
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push(String(e)));
  for (const [n, path] of [["read", "/api/read"], ["issue", "/api/issue"]]) {
    await page.route(`**${path}`, async (route) => {
      if (existsSync(cacheFile(n))) return route.fulfill({ status: 200, contentType: "application/json", body: readFileSync(cacheFile(n), "utf8") });
      const res = await route.fetch();
      const body = await res.text();
      if (res.ok()) writeFileSync(cacheFile(n), body);
      console.log(`${w} real model call ${path}: ${res.status()}`);
      return route.fulfill({ response: res, body });
    });
  }
  const shot = async (n, fullPage = true) => { await sleep(2000); await page.screenshot({ path: `shots/${tag}${n}-${w}.png`, fullPage }); };
  const target = async () => page.locator(".room3d").first().getAttribute("data-target");

  await page.goto(BASE);
  await page.getByRole("heading", { name: "Home Lens" }).waitFor();
  await shot("01-home");

  // ---- move in ----
  await page.getByRole("button", { name: /^Move in/ }).click();
  await page.getByRole("heading", { name: "Add your room scan" }).waitFor();
  await shot("02-movein-empty");
  await page.getByRole("button", { name: "Use demo scan" }).click();
  await page.getByRole("heading", { name: "Was this already damaged?" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".room3d")?.getAttribute("data-target"), null, { timeout: 30000 });
  await shot("03-movein-3d");
  for (const id of [12, 7, 21]) await page.getByRole("button", { name: new RegExp(`^Confirm\\s*tag ${id}$`) }).click();
  await page.getByRole("button", { name: /^Remove\s*tag 3$/ }).click();
  await page.getByRole("button", { name: /^Show in room\s*tag 21$/ }).click();
  await sleep(1500);
  check((await target()) === "4.72,0.90,0.55", `move in: fly to pin 21 (target ${await target()})`);
  await shot("04-movein-confirmed");
  await page.getByRole("button", { name: /^Done/ }).click();

  // ---- move out (same session, so the confirmed tags carry over) ----
  await page.getByRole("button", { name: /^Move out/ }).click();
  await page.getByRole("heading", { name: "Scan your deposit letter" }).waitFor();
  await shot("05-moveout-start");
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.getByText("Page found").waitFor({ timeout: 90000 });
  await page.waitForTimeout(900);
  await shot("06-camera");
  await page.getByRole("button", { name: "Take photo" }).click();
  await page.waitForSelector(".stage.flatten img", { timeout: 30000 });
  await page.getByRole("heading", { name: "Here is what we found" }).waitFor({ timeout: 240000 });
  await page.waitForFunction(() => !document.querySelector(".go button")?.hasAttribute("disabled"), null, { timeout: 30000 });
  await shot("07-reading", false);
  await page.getByRole("button", { name: "Check the details" }).click();
  await page.getByRole("heading", { name: "Does this match your paper?" }).waitFor();
  await shot("08-confirm");
  await page.getByRole("button", { name: "Looks right" }).click();
  await page.getByRole("heading", { name: "Your landlord must answer by" }).waitFor();
  await shot("09-result");
  await page.getByRole("button", { name: /photo match|Match move-in photos/ }).first().click();

  await page.getByRole("heading", { name: "Do these photos match?" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".room3d")?.getAttribute("data-target"), null, { timeout: 30000 });
  await sleep(1800);
  check((await target()) === "3.90,0.01,-1.00", `move out: view flew to the carpet-stain pin 12 (target ${await target()})`);
  await shot("10-photos-3d");
  await page.getByRole("button", { name: /^Show in room\s*photo 21$/ }).click();
  await sleep(1500);
  check((await target()) === "4.72,0.90,0.55", `move out: fly to the counter-burn pin 21 (target ${await target()})`);
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

  // ---- report a problem ----
  await page.getByRole("button", { name: /Home Lens, start over/ }).click();
  await page.getByRole("button", { name: /^Report a problem/ }).click();
  await page.getByRole("heading", { name: "What is wrong?" }).waitFor();
  await shot("14-report-start");
  await page.getByRole("button", { name: "Use a sample photo" }).click();
  await page.getByRole("heading", { name: "Your repair notice" }).waitFor();
  await page.waitForFunction(() => document.querySelector("input")?.value !== "", null, { timeout: 90000 });
  await page.getByLabel("Your name").fill("Jordan Example");
  await page.getByLabel("Landlord").fill("Laurel Bend Apartments");
  await page.getByLabel("Unit address").fill("Unit 4B");
  await shot("15-report-notice");

  // ---- 3D bundle format through the picker path ----
  await page.getByRole("button", { name: /Home Lens, start over/ }).click();
  await page.getByRole("button", { name: /^Move in/ }).click();
  await page.getByRole("button", { name: /scan bundle/ }).click();
  await page.waitForFunction(() => document.querySelector(".room3d")?.getAttribute("data-target"), null, { timeout: 30000 });
  await shot("16-movein-bundle");

  if (errs.length) console.log("console errors", w, errs);
  await ctx.close();
}
process.exit(failed ? 1 : 0);

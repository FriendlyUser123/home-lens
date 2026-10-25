// Renders the sample letters and room photos to PNG. Run: node scripts/make-samples.mjs
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const src = (f) => pathToFileURL(resolve("samples-src", f)).href;
const out = (f) => resolve("public/samples", f);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

async function shot(file, to, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(src(file));
  await page.screenshot({ path: out(to), fullPage: w === 800 });
  await page.close();
}

await shot("matching-letter.html", "letter-match.png", 800, 1000);
for (const n of ["bedroom-carpet", "livingroom-wall", "kitchen-counter", "bedroom-blinds"]) await shot(`room-${n}.html`, `room-${n}.png`, 640, 480);

// A phone-style photo of the matching letter lying at an angle on a desk (shows off the page flattening).
const page = await browser.newPage({ viewport: { width: 960, height: 1280 } });
await page.setContent(`<style>
body{margin:0;width:960px;height:1280px;overflow:hidden;background:
 radial-gradient(ellipse at 30% 20%,#9a8f80,#6e6558 70%);perspective:1400px}
.sheet{position:absolute;left:170px;top:150px;width:640px;box-shadow:0 30px 50px rgba(0,0,0,.45),0 4px 8px rgba(0,0,0,.4);
 transform:rotateX(14deg) rotateY(-9deg) rotateZ(-5deg);transform-origin:50% 50%}
.sheet img{width:100%;display:block}
.pen{position:absolute;left:120px;top:1110px;width:480px;height:16px;border-radius:8px;background:#1d3d6f;transform:rotate(-14deg);box-shadow:0 8px 10px rgba(0,0,0,.4)}
</style><div class="sheet"><img src="data:image/png;base64,${readFileSync(out("letter-match.png")).toString("base64")}"></div><div class="pen"></div>`);
await page.waitForTimeout(400);
await page.screenshot({ path: out("letter-photo.png") });
await browser.close();

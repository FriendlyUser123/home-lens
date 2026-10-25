// Copies the Tesseract worker, core and English data into public/vendor so OCR runs from this origin
// (no CDN, works offline, nothing about the page leaves the browser). Runs before dev and build.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const nm = resolve("node_modules");
const dest = resolve("public/vendor/tesseract");
if (existsSync(resolve(dest, "lang/eng.traineddata.gz"))) process.exit(0);
mkdirSync(resolve(dest, "core"), { recursive: true });
mkdirSync(resolve(dest, "lang"), { recursive: true });
cpSync(resolve(nm, "tesseract.js/dist/worker.min.js"), resolve(dest, "worker.min.js"));
for (const f of ["tesseract-core.wasm.js", "tesseract-core-simd.wasm.js", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  cpSync(resolve(nm, "tesseract.js-core", f), resolve(dest, "core", f));
}
cpSync(resolve(nm, "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), resolve(dest, "lang/eng.traineddata.gz"));
console.log("OCR files copied to public/vendor/tesseract");

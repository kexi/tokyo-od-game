import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-uniform-parity");
mkdirSync(out, { recursive: true });
const sources = {};
for (const file of [
  "scripts/qa/uniformUploads.ts",
  "src/render/renderer.ts",
  "scripts/qa/uniform-upload-parity.html",
  "scripts/qa/uniform-upload-parity.mjs",
  "scripts/qa/browser.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = { sources, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const url = new URL("scripts/qa/uniform-upload-parity.html", base);
const legacyOnly = Boolean(process.env.QA_PARITY_LEGACY);
report.legacyOnly = legacyOnly;
if (legacyOnly) url.searchParams.set("legacyOnly", "1");
const browser = await launch(url.href, { port: 9376 });
try {
  report.browser = (await browser.send("Browser.getVersion")).result;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await browser.evaluate("Boolean(window.__uniformUploadParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  const unavailable = !ready;
  if (unavailable) throw new Error("fixture did not load: " + browser.logs.join("\n"));
  report.rows = await browser.evaluate("window.__uniformUploadParity");
  report.logs = browser.logs;
  const errors = browser.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
  const failed = errors.length > 0;
  if (failed) throw new Error(JSON.stringify(errors));
  report.sourcesUnchanged = Object.fromEntries(
    Object.entries(sources).map(([file, hash]) => [
      file,
      createHash("sha256").update(readFileSync(file)).digest("hex") === hash,
    ]),
  );
  const sourcesChanged = Object.values(report.sourcesUnchanged).some((same) => !same);
  if (sourcesChanged) throw new Error("measurement sources changed during uniform image comparison");
  save();
  process.stdout.write(JSON.stringify({ report: join(out, "report.json"), rows: report.rows }) + "\n");
} catch (error) {
  report.failure = String(error);
  report.logs = browser.logs;
  save();
  throw error;
} finally {
  await browser.close();
}

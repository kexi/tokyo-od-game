import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-terrain-imagery");
mkdirSync(out, { recursive: true });
const sources = {};
for (const file of [
  "src/world/terrain.ts",
  "src/world/terrainMaterial.ts",
  "scripts/qa/terrain-imagery-parity.html",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const browser = await launch(new URL("scripts/qa/terrain-imagery-parity.html", base).href, { port: 9370 });
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    ready = await browser.evaluate("Boolean(window.__terrainImageryParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  const isFixtureMissing = !ready;
  if (isFixtureMissing) throw new Error("terrain imagery fixture not ready: " + browser.logs.join("\n"));
  const rows = await browser.evaluate("window.__terrainImageryParity");
  const version = (await browser.send("Browser.getVersion")).result;
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    sources,
    rows,
    version,
    host: { cpu: cpus()[0]?.model, load: loadavg() },
    logs: browser.logs,
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  const invalid = rows.filter((row) => !row.valid);
  const hasInvalid = invalid.length > 0;
  if (hasInvalid) throw new Error(JSON.stringify({ report: join(out, "report.json"), invalid }));
  const errors = browser.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
  const hasErrors = errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(errors));
  process.stdout.write(JSON.stringify({ report: join(out, "report.json"), rows }) + "\n");
} finally {
  await browser.close();
}

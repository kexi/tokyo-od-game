import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-building-gpu");
mkdirSync(out, { recursive: true });
const sources = {};
for (const file of [
  "src/world/buildings.ts",
  "src/world/buildingGpuUnload.ts",
  "src/world/facade.ts",
  "scripts/qa/building-gpu-parity.html",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const browser = await launch(new URL("scripts/qa/building-gpu-parity.html", base).href, { port: 9367 });
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    ready = await browser.evaluate("Boolean(window.__buildingGpuParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  const isFixtureMissing = !ready;
  if (isFixtureMissing)
    throw new Error("building lifecycle fixture did not load: " + browser.logs.join("\n"));
  const rows = await browser.evaluate("window.__buildingGpuParity");
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    sources,
    rows,
    logs: browser.logs,
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  const invalid = rows.filter((r) => !r.valid);
  const hasInvalidRows = invalid.length > 0;
  if (hasInvalidRows) throw new Error(JSON.stringify({ report: join(out, "report.json"), invalid }));
  const errors = browser.logs.filter((r) => r.startsWith("[error]") || r.startsWith("[exception]"));
  const hasErrors = errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(errors));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      rows: rows.map((r) => ({
        backend: r.backend,
        mode: r.mode,
        night: r.night,
        valid: r.valid,
        beforeRestoreMs: r.before?.restoreBuilds.reduce((a, b) => a + b.ms, 0),
        afterRestoreMs: r.after?.restoreBuilds.reduce((a, b) => a + b.ms, 0),
        beforeRestoreBuilds: r.before?.restoreBuilds.length,
        afterRestoreBuilds: r.after?.restoreBuilds.length,
      })),
    }) + "\n",
  );
} finally {
  await browser.close();
}

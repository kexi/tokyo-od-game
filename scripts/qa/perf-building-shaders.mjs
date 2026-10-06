import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-building-shaders");
mkdirSync(out, { recursive: true });
const sources = {};
for (const file of [
  "src/world/buildings.ts",
  "src/world/buildingFacadePlugin.ts",
  "src/world/buildingShaders.ts",
  "src/world/facadeShaderLayouts.ts",
  "src/world/facade.ts",
  "scripts/qa/building-shader-parity.html",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const fixture = new URL("scripts/qa/building-shader-parity.html", base);
const layoutsOnly = process.env.QA_LAYOUTS_ONLY === "1";
if (layoutsOnly) fixture.searchParams.set("layoutsOnly", "1");
const browser = await launch(fixture.href, { port: 9368 });
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    ready = await browser.evaluate("Boolean(window.__buildingShaderParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  const isFixtureMissing = !ready;
  if (isFixtureMissing) throw new Error("building shader fixture did not load: " + browser.logs.join("\n"));
  const rows = await browser.evaluate("window.__buildingShaderParity");
  const version = (await browser.send("Browser.getVersion")).result;
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    sources,
    host: { cpu: cpus()[0]?.model, load: loadavg() },
    version,
    rows,
    logs: browser.logs,
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  const invalid = rows.filter((row) => !row.valid);
  const hasInvalidRows = invalid.length > 0;
  if (hasInvalidRows) throw new Error(JSON.stringify({ report: join(out, "report.json"), invalid }));
  const errors = browser.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
  const hasErrors = errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(errors));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      rows: rows.map((row) => ({
        backend: row.backend,
        mode: row.mode,
        night: row.night,
        valid: row.valid,
        beforeSyncMs: row.before?.facadeSync.reduce((n, build) => n + build.ms, 0),
        afterSyncMs: row.after?.facadeSync.reduce((n, build) => n + build.ms, 0),
        beforeBuilds: row.before?.facadeSync.length,
        afterBuilds: row.after?.facadeSync.length,
        preparationMs: row.after?.preparationMs,
        cancelled: row.cancelled,
      })),
    }) + "\n",
  );
} finally {
  await browser.close();
}

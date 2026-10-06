import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-instance-shaders");
mkdirSync(out, { recursive: true });
const sources = {};
for (const file of [
  "src/game/frameWork.ts",
  "src/render/streamedInstanceShaders.ts",
  "src/world/roadInstances.ts",
  "scripts/qa/instance-shader-parity.html",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const browser = await launch(new URL("scripts/qa/instance-shader-parity.html", base).href, { port: 9373 });
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    ready = await browser.evaluate("Boolean(window.__instanceShaderParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  const missing = !ready;
  if (missing) throw new Error("instance shader fixture did not load: " + browser.logs.join("\n"));
  const rows = await browser.evaluate("window.__instanceShaderParity");
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
  const hasInvalid = invalid.length > 0;
  if (hasInvalid) throw new Error(JSON.stringify({ report: join(out, "report.json"), invalid }));
  const errors = browser.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
  const hasErrors = errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(errors));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      rows: rows.map((row) => ({
        backend: row.backend,
        night: row.night,
        valid: row.valid,
        beforeSync: row.before?.mainSync.length,
        afterSync: row.after?.mainSync.length,
        beforeCpuMs: row.before?.mainSync.reduce((n, b) => n + b.ms, 0),
        differences: row.differences,
        cancelled: row.cancelled,
      })),
    }) + "\n",
  );
} finally {
  await browser.close();
}

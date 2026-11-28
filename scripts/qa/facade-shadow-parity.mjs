import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-facade-shadow");
mkdirSync(out, { recursive: true });
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const browser = await launch(new URL("scripts/qa/facade-shadow-parity.html", base).href, { port: 9367 });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await browser.evaluate("Boolean(window.__facadeShadowParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  if (!ready) throw new Error("facade shadow fixture did not load: " + browser.logs.join("\n"));
  const rows = await browser.evaluate("window.__facadeShadowParity");
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    rows,
    logs: browser.logs,
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  const invalid = rows.filter((r) => !r.valid);
  if (invalid.length) throw new Error(JSON.stringify({ report: join(out, "report.json"), invalid }));
  const errors = browser.logs.filter((r) => r.startsWith("[error]") || r.startsWith("[exception]"));
  if (errors.length) throw new Error(JSON.stringify(errors));
  process.stdout.write(JSON.stringify({ report: join(out, "report.json"), rows }) + "\n");
} finally {
  await browser.close();
}

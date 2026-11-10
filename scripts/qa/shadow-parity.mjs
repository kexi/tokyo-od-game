import { mkdirSync, writeFileSync } from "node:fs";
import { launch } from "./browser.mjs";

const out = ".qa/perf/shadow-parity";
mkdirSync(out, { recursive: true });
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const browser = await launch(new URL("scripts/qa/shadow-parity.html", base).href, { port: 9368 });
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    ready = await browser.evaluate("Boolean(window.__shadowParity)");
    if (ready) break;
    await browser.sleep(500);
  }
  if (!ready) throw new Error("shadow fixture did not load");
  const rows = await browser.evaluate("window.__shadowParity");
  const errors = browser.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
  const report = { rows, logs: browser.logs };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.screenshot(`${out}/fixture.png`);
  const hasErrors = errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(errors));
  process.stdout.write(JSON.stringify(report) + "\n");
} finally {
  await browser.close();
}

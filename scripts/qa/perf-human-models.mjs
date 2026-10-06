import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "8c76a385ea81a65cf96e12c0572092353a2bbe32";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-human-models");
const refDir = ".qa/reference/human-models";
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
mkdirSync(out, { recursive: true });
mkdirSync(refDir, { recursive: true });
const legacy = execFileSync("git", ["show", reference + ":src/world/human.ts"], { encoding: "utf8" });
writeFileSync(join(out, "human-legacy.ts.txt"), legacy);
writeFileSync(
  join(refDir, "human.ts"),
  legacy.replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, specifier) =>
      'from "' + new URL(specifier, new URL("src/world/human.ts", url)).href + '"',
  ),
);
const sources = {};
for (const file of [
  "src/world/human.ts",
  "src/world/humanParts.ts",
  "scripts/qa/human-model-parity.html",
  "scripts/qa/perf-human-models.mjs",
  "scripts/qa/browser.mjs",
  "public/models/human.glb",
]) {
  const bytes = readFileSync(file);
  sources[file] = createHash("sha256").update(bytes).digest("hex");
  const isModel = file.endsWith(".glb");
  if (!isModel) writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), bytes);
}
const report = {
  reference,
  legacyHash: createHash("sha256").update(legacy).digest("hex"),
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
let browser;
try {
  browser = await launch(new URL("scripts/qa/human-model-parity.html", url).href, { port: 9378 });
  report.browser = (await browser.send("Browser.getVersion")).result;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await browser.evaluate("Boolean(window.__humanModelMeasurement)");
    if (ready) break;
    await browser.sleep(500);
  }
  const unavailable = !ready;
  if (unavailable) throw new Error("human fixture did not load: " + browser.logs.join("\n"));
  report.result = await browser.evaluate("window.__humanModelMeasurement");
  report.logs = browser.logs;
  const errors = report.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
  const failed = errors.length > 0;
  if (failed) throw new Error(JSON.stringify(errors));
  report.sourcesUnchanged = Object.fromEntries(
    Object.entries(sources).map(([file, hash]) => [
      file,
      createHash("sha256").update(readFileSync(file)).digest("hex") === hash,
    ]),
  );
  const changed = Object.values(report.sourcesUnchanged).some((same) => !same);
  if (changed) throw new Error("measurement sources changed");
  save();
  process.stdout.write(JSON.stringify({ report: join(out, "report.json"), result: report.result }) + "\n");
} catch (error) {
  report.failure = String(error);
  report.logs = browser?.logs;
  save();
  throw error;
} finally {
  if (browser) await browser.close();
  rmSync(join(refDir, "human.ts"), { force: true });
}

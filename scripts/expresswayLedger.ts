// The ledger tool (P2.7-4 5.4): counts the cases of a data folder again (scripts/expresswayCases.ts)
// and writes its ledger.json from them and the ledger already there (src/expressway/ledger.ts
// updateLedger): new cases come in `new`, a case whose blocks did not change is left as it is, one
// that moved keeps its decision within its cap and margin, a case no longer found is `gone`. Then
// report.json's `allowed` is decided again from the new ledger (a decision needs no rebuild).
// Run: pnpm exec tsx scripts/expresswayLedger.ts [<dir>] [--seed <ledger.json>] [--prune] [--write-budget]
// (just update-expressway-ledger dir flags; dir defaults to public/data/expressway, a label without a
// slash means .cache/expressway-area/<label>). --seed takes the decisions of another folder's ledger
// by key (a measuring folder with no ledger yet); --prune drops the gone cases; --write-budget writes
// the budget from the counts (a review settling the ratchet). The ledger has no time in it: two runs
// over the same folder write the same bytes.
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { caseContextOf, type Ledger, reallowRecord, updateLedger } from "../src/expressway/ledger.ts";
import { log } from "../src/log.ts";
import { countCases } from "./expresswayCases.ts";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "./expresswayFiles.ts";

const ROOT = join(import.meta.dirname, "..");
const isLabel = (arg: string) => !arg.includes("/");
const dirOf = (arg: string) => (isLabel(arg) ? join(ROOT, ".cache", "expressway-area", arg) : arg);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const VALUED = new Set(["--seed"]);
const positional = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith("--") && !VALUED.has(all[i - 1] ?? ""));
const given = positional[0];
const dir = given === undefined || given === "" ? DEFAULT_DATA_DIR : dirOf(given);
const seedPath = arg("seed");
const files = readExpresswayFiles(dir);
const seed = seedPath ? (JSON.parse(readFileSync(seedPath, "utf8")) as Ledger) : null;
const counted = await countCases(files);
const ledger = updateLedger(files.ledger, {
  data: {
    ranges: files.meta.ranges.map((r) => r.name),
    scope: files.meta.scope ?? null,
    objective: files.record.objective,
    extract: files.meta.extract.timestamp,
  },
  found: counted.found,
  seamProbes: counted.seamProbes,
  rules: counted.rules,
  prune: has("prune"),
  seed,
  writeBudget: has("write-budget"),
});
const text = JSON.stringify(ledger, null, 1) + "\n";
await writeFile(join(dir, "ledger.json"), text);
// The build wrote report.json's `allowed` with the ledger it had: a case decided since must reach it.
const reallowed = reallowRecord(
  files.record,
  caseContextOf(files.runs, files.record.untied, files.chunks),
  ledger,
);
if (reallowed > 0) await writeFile(join(dir, "report.json"), JSON.stringify(files.record));
const before = new Map((files.ledger?.cases ?? []).map((c) => [c.key, c]));
const statusCount = (status: string) => ledger.cases.filter((c) => c.status === status).length;
log("expressway_ledger_updated", {
  dir,
  seed: seedPath ?? null,
  cases: ledger.cases.length,
  added: ledger.cases.filter((c) => !before.has(c.key)).length,
  unchanged: ledger.cases.filter((c) => JSON.stringify(c) === JSON.stringify(before.get(c.key))).length,
  reopened: ledger.cases.filter((c) => c.status === "new" && c.previous !== null).length,
  statuses: {
    new: statusCount("new"),
    accepted: statusCount("accepted"),
    open: statusCount("open"),
    wontfix: statusCount("wontfix"),
    gone: statusCount("gone"),
  },
  byRule: ledger.cases.filter((c) => c.by === "rule").length,
  seamProbes: counted.seamProbes,
  budget: ledger.budget !== null,
  bytes: Buffer.byteLength(text),
  reallowed,
});

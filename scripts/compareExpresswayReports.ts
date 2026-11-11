// Two expressway scorecards side by side (P2.7-1, src/expressway/report.ts): every number of
// either, its value in a and b and the change, one row per number (closures list rows by root run,
// overlap pairs by a|b). The timings (`timings.*`) are shown but never count as a change; a number
// on one side only is an addition or a removal. Comparing builds of another range, --below mode or
// extract is warned about (their differences are not the compiler's).
// Run: pnpm exec tsx scripts/compareExpresswayReports.ts <a> <b> [--check]
// (just compare-expressway-reports a b; a label without a slash means .qa/expressway/<label>.report.json).
// --check: exit 1 when anything but the timings differs, 0 when the two are the same.
// P2.7-2: a version-2 report (no `partition`) still reads, its partition rows then being additions;
// anchors are keyed by run@s and blocks by id, and the blocks' solution hashes are summed up in one
// line (how many changed, and which).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { blockChanges, flattenReport, ReportSchema } from "../src/expressway/report.ts";
import { log, warn } from "../src/log.ts";

const pathOf = (arg: string) => {
  const isLabel = !arg.includes("/") && !arg.endsWith(".json");
  return isLabel ? join(import.meta.dirname, "..", ".qa", "expressway", `${arg}.report.json`) : arg;
};

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const isCheck = process.argv.includes("--check");
const [aArg, bArg] = args;
const isMissing = aArg === undefined || bArg === undefined;
if (isMissing) throw new Error("usage: compareExpresswayReports.ts <a> <b> [--check]");
const [a, b] = await Promise.all(
  [aArg, bArg].map(async (p) => ReportSchema.parse(JSON.parse(await readFile(pathOf(p), "utf8")))),
);
const fa = flattenReport(a);
const fb = flattenReport(b);
const isTiming = (k: string) => k.startsWith("timings.");
const keys = [...new Set([...fa.keys(), ...fb.keys()])].filter((k) => k !== "version");
const fmt = (v: number | undefined) => (v === undefined ? "—" : String(Math.round(v * 1e4) / 1e4));
type Row = {
  key: string;
  va?: number;
  vb?: number;
  change: "same" | "changed" | "added" | "removed" | "timing";
};
const rows: Row[] = keys.map((key) => {
  const va = fa.get(key);
  const vb = fb.get(key);
  if (isTiming(key)) return { key, va, vb, change: "timing" };
  if (va === undefined) return { key, vb, change: "added" };
  if (vb === undefined) return { key, va, change: "removed" };
  return { key, va, vb, change: va === vb ? "same" : "changed" };
});
// The run lists of the scope are strings: compared as sets.
const wantedA = new Set(a.scope.wanted);
const wantedB = new Set(b.scope.wanted);
const runsAdded = [...wantedB].filter((id) => !wantedA.has(id));
const runsRemoved = [...wantedA].filter((id) => !wantedB.has(id));
const { changed: blocksChanged, added: blocksAdded, removed: blocksRemoved } = blockChanges(a, b);
const cell = (r: Row) => {
  const delta = r.va !== undefined && r.vb !== undefined ? fmt(r.vb - r.va) : "";
  const note = r.change === "same" ? "" : r.change;
  return [r.key, fmt(r.va), fmt(r.vb), delta, note];
};
const header = ["field", a.label, b.label, "b − a", ""];
const table = rows.filter((r) => r.change !== "same").map(cell);
const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
const line = (r: string[]) =>
  r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
const isOtherBuild = a.range !== b.range || a.below !== b.below || a.extract.sha256 !== b.extract.sha256;
if (isOtherBuild)
  warn("expressway_reports_unlike", {
    a: `${a.range}/${a.below}/${a.extract.timestamp}`,
    b: `${b.range}/${b.below}/${b.extract.timestamp}`,
  });
process.stdout.write(
  [
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...table.map(line),
    `blocks: ${blocksChanged.length} changed ${blocksChanged.slice(0, 20).join(" ")} / +${blocksAdded.length} ${blocksAdded.slice(0, 20).join(" ")} / −${blocksRemoved.length} ${blocksRemoved.slice(0, 20).join(" ")}`,
    `runs of the range: +${runsAdded.length} ${runsAdded.slice(0, 20).join(" ")} / −${runsRemoved.length} ${runsRemoved.slice(0, 20).join(" ")}`,
    `extract: ${a.extract.timestamp} ${a.extract.sha256.slice(0, 12)} / ${b.extract.timestamp} ${b.extract.sha256.slice(0, 12)}`,
  ].join("\n") + "\n",
);
const count = (c: Row["change"]) => rows.filter((r) => r.change === c).length;
const changed =
  count("changed") +
  count("added") +
  count("removed") +
  runsAdded.length +
  runsRemoved.length +
  blocksChanged.length +
  blocksAdded.length +
  blocksRemoved.length;
log("expressway_reports_compared", {
  a: a.label,
  b: b.label,
  fields: rows.length,
  changed: count("changed"),
  added: count("added"),
  removed: count("removed"),
  runsAdded: runsAdded.length,
  runsRemoved: runsRemoved.length,
  blocksChanged: blocksChanged.length,
  blocksAdded: blocksAdded.length,
  blocksRemoved: blocksRemoved.length,
});
const isDifferent = changed > 0;
if (isCheck && isDifferent) process.exitCode = 1;

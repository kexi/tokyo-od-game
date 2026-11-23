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
// line (how many changed, and which). P2.7-3: builds of another objective (v1 / v2 or v2's weights)
// are warned about too. S7-1 (version 7): the `underground` numbers are rows like the rest (deferred
// runs by id, portal ends by run:end, over-approach pairs by lower|upper), and one line names what the
// numbers cannot: the deferred runs, ends, approaches and pairs on one side only and the runs deferred for another
// reason (a version-6 report beside a version-7 one: the section added).
// R1-1a (version 8): a gzip size (any field naming gzip) counts as a change only between two reports
// gzipped by the same node and zlib (`size.gzipEnv`); otherwise its row is shown as `gzip-env`, never
// counts for --check, and one line warns (expressway_reports_gzip_unlike). Why not count them: the
// same tiles gzip to other sizes under another zlib (117,542 and 115,707 bytes), so the change would
// be the machine's, not the compiler's. --check also fails b over U3's budget (`budget.ok` false,
// budget.ts), warned as expressway_budget_over.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { undergroundChanges } from "../src/expressway/belowScore.ts";
import {
  blockChanges,
  buildsUnlike,
  flattenReport,
  isGzipComparable,
  isGzipField,
  ReportSchema,
} from "../src/expressway/report.ts";
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
  change: "same" | "changed" | "added" | "removed" | "timing" | "gzip-env";
};
const envA = a.size.gzipEnv;
const envB = b.size.gzipEnv;
const isSameGzip = isGzipComparable(a, b);
const rows: Row[] = keys.map((key) => {
  const va = fa.get(key);
  const vb = fb.get(key);
  if (isTiming(key)) return { key, va, vb, change: "timing" };
  const isUncounted = isGzipField(key) && !isSameGzip && va !== vb;
  if (isUncounted) return { key, va, vb, change: "gzip-env" };
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
const under = undergroundChanges(a.underground, b.underground);
const ids = (list: string[]) => `${list.length} ${list.slice(0, 20).join(" ")}`.trimEnd();
const undergroundLine =
  under.absent !== null
    ? `underground: only in ${under.absent === "a" ? b.label : a.label} (the other is version ${under.absent === "a" ? a.version : b.version})`
    : [
        `underground: deferred +${ids(under.deferred.added)} / −${ids(under.deferred.removed)} / reason ${ids(under.deferred.reasonChanged)} / range ${ids(under.deferred.inRangeChanged)}`,
        `portals +${ids(under.portals.added)} / −${ids(under.portals.removed)} / changed ${ids(under.portals.changed)}`,
        `overApproach +${ids(under.overApproach.added)} / −${ids(under.overApproach.removed)}`,
        `besideLowered +${ids(under.besideLowered.added)} / −${ids(under.besideLowered.removed)}`,
        `approaches +${ids(under.approaches.added)} / −${ids(under.approaches.removed)}`,
        `joins +${ids(under.joins.added)} / −${ids(under.joins.removed)} / changed ${ids(under.joins.changed)}`,
        `unplanned +${ids(under.unplanned.added)} / −${ids(under.unplanned.removed)} / changed ${ids(under.unplanned.changed)}`,
      ].join("; ");
// R1-1b (version 10): the ends' rows by id and the mouths by parent, distance and child, as sets (their
// `kind`, `why`, `side` and `at` are words, which the numbers' table does not show), and the walls: the
// ends whose kind is not ground and that no run goes on from.
const endIds = (r: typeof a) => ({
  main: new Set((r.ends?.mainEnds ?? []).map((e) => `${e.id}:${e.kind ?? "?"}:${e.why}`)),
  ramp: new Set((r.ends?.rampEnds ?? []).map((e) => `${e.id}:${e.kind}:${e.why}`)),
  mouths: new Set((r.ends?.mouths ?? []).map((m) => `${m.run}@${m.s}>${m.child}:${m.why}:${m.side ?? "?"}`)),
  walls: new Set(
    [...(r.ends?.mainEnds ?? []), ...(r.ends?.rampEnds ?? [])]
      .filter((e) => e.kind !== "ground" && (e.onward ?? null) === null)
      .map((e) => e.id),
  ),
});
const ea = endIds(a);
const eb = endIds(b);
const setDiff = (x: Set<string>, y: Set<string>) => [...y].filter((k) => !x.has(k));
const endsChanged = (["main", "ramp", "mouths", "walls"] as const).reduce(
  (n, k) => n + setDiff(ea[k], eb[k]).length + setDiff(eb[k], ea[k]).length,
  0,
);
const endsLine = `ends: ${(["main", "ramp", "mouths", "walls"] as const)
  .map(
    (k) => `${k} ${ea[k].size}→${eb[k].size} +${ids(setDiff(ea[k], eb[k]))} / −${ids(setDiff(eb[k], ea[k]))}`,
  )
  .join("; ")}`;
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
const unlike = buildsUnlike(a, b);
const isUnlike = unlike !== null;
if (isUnlike) warn("expressway_reports_unlike", unlike);
const gzipRows = rows.filter((r) => r.change === "gzip-env").length;
if (!isSameGzip)
  warn("expressway_reports_gzip_unlike", {
    a: a.label,
    b: b.label,
    aEnv: envA ? `${envA.node} zlib ${envA.zlib}` : null,
    bEnv: envB ? `${envB.node} zlib ${envB.zlib}` : null,
    rows: gzipRows,
  });
const isOverBudget = b.budget !== undefined && !b.budget.ok;
if (isOverBudget) warn("expressway_budget_over", { label: b.label, ...b.budget! });
process.stdout.write(
  [
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...table.map(line),
    `blocks: ${blocksChanged.length} changed ${blocksChanged.slice(0, 20).join(" ")} / +${blocksAdded.length} ${blocksAdded.slice(0, 20).join(" ")} / −${blocksRemoved.length} ${blocksRemoved.slice(0, 20).join(" ")}`,
    `runs of the range: +${runsAdded.length} ${runsAdded.slice(0, 20).join(" ")} / −${runsRemoved.length} ${runsRemoved.slice(0, 20).join(" ")}`,
    undergroundLine,
    endsLine,
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
  blocksRemoved.length +
  under.deferred.reasonChanged.length +
  under.deferred.inRangeChanged.length +
  under.portals.changed.length +
  under.joins.changed.length +
  under.unplanned.changed.length +
  endsChanged;
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
const isFailed = isDifferent || isOverBudget;
if (isCheck && isFailed) process.exitCode = 1;

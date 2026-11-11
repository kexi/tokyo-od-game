// Two expressway builds' heights compared (P2.7-2): for every run written by both, each station of
// b against a's road surface at the same run distance (the Hermite surface the game reads,
// src/expressway/profile.ts surfaceAt), |Δz| as p50 / p90 / p99 / max over all stations, those
// within ±Q of an anchor of b's report (partition.anchors) and the rest, and the ten runs that moved
// most. One JSON log line (expressway_heights_compared), for jq.
// Run: pnpm exec tsx scripts/compareExpresswayHeights.ts <dirA> <dirB> [--report <b's report>]
// (just compare-expressway-heights a b; a label without a slash means .cache/expressway-area/<label>
// and its report .qa/expressway/<label>.report.json).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATION_STRIDE, type XwChunk, type XwTile } from "../src/expressway/format.ts";
import { surfaceAt } from "../src/expressway/profile.ts";
import { ReportSchema } from "../src/expressway/report.ts";
import { log } from "../src/log.ts";

const ROOT = join(import.meta.dirname, "..");
const isLabel = (arg: string) => !arg.includes("/");
const dirOf = (arg: string) => (isLabel(arg) ? join(ROOT, ".cache", "expressway-area", arg) : arg);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Every run's stations in order (chunk seams once), from a data folder's tiles. */
async function runsOf(dir: string): Promise<Map<string, number[]>> {
  const files = (await readdir(dir)).filter((f) => /^\d+-\d+\.json$/.test(f));
  const chunks: XwChunk[] = [];
  for (const f of files) chunks.push(...(JSON.parse(await readFile(join(dir, f), "utf8")) as XwTile).chunks);
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const out = new Map<string, number[]>();
  for (const [run, list] of byRun) {
    const st: number[] = [];
    for (const c of list.sort((p, q) => p.k - q.k))
      st.push(...(st.length === 0 ? c.st : c.st.slice(STATION_STRIDE)));
    out.set(run, st);
  }
  return out;
}

/** Nearest-rank percentiles and the maximum of |Δz|, rounded to the millimetre. */
function spread(values: number[]): { stations: number; p50: number; p90: number; p99: number; max: number } {
  const sorted = [...values].sort((p, q) => p - q);
  const at = (p: number) => {
    const isEmpty = sorted.length === 0;
    if (isEmpty) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  };
  const mm = (v: number) => Math.round(v * 1000) / 1000;
  return {
    stations: sorted.length,
    p50: mm(at(0.5)),
    p90: mm(at(0.9)),
    p99: mm(at(0.99)),
    max: mm(sorted[sorted.length - 1] ?? 0),
  };
}

const [aArg, bArg] = process.argv
  .slice(2)
  .filter((x, i, all) => !x.startsWith("--") && all[i - 1] !== "--report");
const isMissing = aArg === undefined || bArg === undefined;
if (isMissing) throw new Error("usage: compareExpresswayHeights.ts <dirA> <dirB> [--report <b's report>]");
const reportPath =
  arg("report") ?? (isLabel(bArg) ? join(ROOT, ".qa", "expressway", `${bArg}.report.json`) : undefined);
const report = reportPath ? ReportSchema.parse(JSON.parse(await readFile(reportPath, "utf8"))) : null;
const anchors = new Map<string, Array<{ s: number; q: number }>>();
for (const a of report?.partition?.anchors ?? []) anchors.set(a.run, [...(anchors.get(a.run) ?? []), a]);
const [runsA, runsB] = await Promise.all([runsOf(dirOf(aArg)), runsOf(dirOf(bArg))]);
const all: number[] = [];
const near: number[] = [];
const elsewhere: number[] = [];
const top: Array<{ run: string; maxDzM: number; s: number; nearAnchor: boolean }> = [];
const both = [...runsB.keys()].filter((id) => runsA.has(id)).sort();
for (const run of both) {
  const stA = runsA.get(run)!;
  const stB = runsB.get(run)!;
  const mine = anchors.get(run) ?? [];
  let worst = { dz: -1, s: 0, nearAnchor: false };
  for (let i = 0; i < stB.length; i += STATION_STRIDE) {
    const s = stB[i];
    const dz = Math.abs(stB[i + 3] - surfaceAt(stA, s).z);
    const isNear = mine.some((a) => Math.abs(s - a.s) <= a.q);
    all.push(dz);
    (isNear ? near : elsewhere).push(dz);
    if (dz > worst.dz) worst = { dz, s, nearAnchor: isNear };
  }
  top.push({
    run,
    maxDzM: Math.round(worst.dz * 1000) / 1000,
    s: Math.round(worst.s * 10) / 10,
    nearAnchor: worst.nearAnchor,
  });
}
top.sort((p, q) => q.maxDzM - p.maxDzM || (p.run < q.run ? -1 : 1));
log("expressway_heights_compared", {
  a: aArg,
  b: bArg,
  runs: both.length,
  onlyA: [...runsA.keys()].filter((id) => !runsB.has(id)).length,
  onlyB: [...runsB.keys()].filter((id) => !runsA.has(id)).length,
  all: spread(all),
  nearAnchors: spread(near),
  elsewhere: spread(elsewhere),
  top: top.slice(0, 10),
});

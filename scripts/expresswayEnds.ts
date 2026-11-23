// The ends of a data folder with nothing written going on (R1-1b 3.1, src/world/expresswayEnds.ts), as
// the game finds them when it builds the decks: per end its run, class, kind, the structure of the end
// chunk, the road over the ground there and the carriageway's width; the main lines' ground ends
// apart (no wall). With --report <scorecard>, its walls (`ends.mainEnds` and `ends.rampEnds` whose
// kind is not ground and that no run goes on from, report.ts version 10) against these: exit 1 when
// they differ. With --districts <stage>, the runs of those districts alone (districts.json), as a
// --districts build writes them. And each end as the game first can build it (endsAsBuilt: the 3 × 3
// tiles round its end chunk alone), against the answer over every tile: `asBuiltDiffer`, exit 1 when
// any differs (a wall would depend on the order the tiles came in). One JSON file and one log line.
//   pnpm exec tsx scripts/expresswayEnds.ts <dir> [--districts central,…] [--report <path>] [--out <file>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format.ts";
import { ReportSchema } from "../src/expressway/report.ts";
import { log } from "../src/log.ts";
import { endsAhead, endsAsBuilt, rangeOfChunks } from "../src/world/expresswayEnds.ts";
import { districtsOfFiles, readExpresswayFiles } from "./expresswayFiles.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const files = readExpresswayFiles(dir);
const stage = flag("districts")?.split(",") ?? null;
const reportPath = flag("report");
const name = files.dir.split("/").filter(Boolean).pop();
const out = flag("out") ?? `.qa/expressway/ends-${name}${stage ? `-${stage.join("+")}` : ""}.json`;

const district = stage ? districtsOfFiles(files) : null;
const isIn = (run: string) => district === null || stage!.includes(district.get(run) ?? "outside");
const runs = new Map<string, XwTileRun>();
for (const r of files.runs)
  if (isIn(r.id)) runs.set(r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end });
const byRun = new Map<string, XwChunk[]>();
for (const [run, list] of files.byRun) if (isIn(run)) byRun.set(run, [...list]);
const answers = endsAhead(runs, (run) => rangeOfChunks(byRun.get(run) ?? [], STATION_STRIDE));

const r2 = (v: number) => Math.round(v * 100) / 100;
type Row = {
  id: string;
  run: string;
  cls: string;
  side: "start" | "end";
  kind: string;
  into: string | null;
  structure: string;
  overGroundM: number;
  widthM: number;
  why: string;
  /** Runs hung by a junction at the node that do not go on beyond it (R1-1b 3.3). */
  junctionChildren: string[];
};
const rows: Row[] = [];
const groundMains: Row[] = [];
for (const [key, a] of answers) {
  const [run, side] = key.split(":") as [string, "start" | "end"];
  const summary = runs.get(run)!;
  const e = summary[side];
  const chunks = byRun.get(run) ?? [];
  const c = side === "start" ? chunks[0] : chunks[chunks.length - 1];
  const o = side === "start" ? 0 : c.st.length - STATION_STRIDE;
  const sE = c.st[o];
  const junctionChildren = [...runs.values()]
    .filter((r) =>
      (["start", "end"] as const).some(
        (at) =>
          r[at].kind === "junction" && r[at].parent === run && Math.abs((r[at].parentS ?? -1) - sE) <= 1e-3,
      ),
    )
    .map((r) => r.id)
    .sort();
  const row: Row = {
    id: key,
    run,
    cls: summary.cls,
    side,
    kind: e.kind,
    into: e.into ?? null,
    structure: c.structure,
    overGroundM: r2(c.st[o + 3] - c.st[o + 5]),
    widthM: r2(c.lanes * c.laneWidth + c.shoulderL + c.shoulderR),
    why: a.why,
    junctionChildren,
  };
  const isGroundMain = e.kind === "ground" && summary.cls === "expressway";
  if (isGroundMain) groundMains.push(row);
  if (!a.ahead) rows.push(row);
}
const count = (pick: (r: Row) => boolean) => rows.filter(pick).length;
const isMain = (r: Row) => r.cls === "expressway";
const table = {
  mainOpen: count((r) => isMain(r) && r.kind !== "portal"),
  mainOpenByStructure: Object.fromEntries(
    ["viaduct", "embankment", "cut", "tunnel"].map((s) => [
      s,
      count((r) => isMain(r) && r.kind !== "portal" && r.structure === s),
    ]),
  ),
  mainPortal: count((r) => isMain(r) && r.kind === "portal"),
  mainGround: groundMains.length,
  rampOpen: count((r) => !isMain(r) && r.kind !== "portal"),
  rampPortal: count((r) => !isMain(r) && r.kind === "portal"),
  withJunctionChild: count((r) => r.junctionChildren.length > 0),
  tunnel: count((r) => r.structure === "tunnel"),
};
const walls = rows.map((r) => r.id).sort();
let againstReport: { report: string; missing: string[]; extra: string[] } | null = null;
if (reportPath) {
  const report = ReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  const listed = [...(report.ends?.mainEnds ?? []), ...(report.ends?.rampEnds ?? [])]
    .filter((e) => e.kind !== "ground" && (e.onward ?? null) === null)
    .map((e) => e.id);
  const want = new Set(listed);
  const got = new Set(walls);
  againstReport = {
    report: reportPath,
    missing: [...want].filter((id) => !got.has(id)).sort(),
    extra: [...got].filter((id) => !want.has(id)).sort(),
  };
}
// Why only without --districts: a stage's folder is its own build (--districts), whose tiles hold its
// runs alone; picking them out of a fuller folder's tiles is not what the game reads.
const asBuiltDiffer =
  stage === null
    ? [...endsAsBuilt(files.tiles, files.meta.zoom)]
        .filter(([key, a]) => answers.get(key)?.ahead !== a.ahead)
        .map(([key, a]) => ({ id: key, asBuilt: a.why, full: answers.get(key)?.why ?? null }))
    : [];
const result = {
  dir: files.dir,
  districts: stage,
  table,
  walls: rows,
  groundMains,
  againstReport,
  asBuiltDiffer,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
log("expressway_ends_counted", {
  dir: files.dir,
  out,
  districts: stage,
  walls: walls.length,
  ...table,
  missing: againstReport?.missing ?? [],
  extra: againstReport?.extra ?? [],
  asBuiltDiffer: asBuiltDiffer.map((d) => d.id),
});
const isDifferent =
  (againstReport !== null && (againstReport.missing.length > 0 || againstReport.extra.length > 0)) ||
  asBuiltDiffer.length > 0;
process.exitCode = isDifferent ? 1 : 0;

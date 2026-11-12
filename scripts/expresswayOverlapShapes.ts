// The not-allowed overlaps of a build in the five shapes of S6's 0.3 節 (knowledge/expressway-generation.md
// 「P2.7-6 PR 4」), per kind, as one log line: joined (a junction or a shared parent: the scorecard's
// overlapPairs `joined`) or not; from one surface (a forbidden station within FROM_SAME_M along its
// run of a station at |Δz| ≤ ONE_SURFACE_M, the two parting from one surface) or mid-way; and a level
// all but (min |Δz| ≥ LEVEL_ALL_BUT_M) before those.
// Run: pnpm exec tsx scripts/expresswayOverlapShapes.ts <label> [<base label>] (just count-overlap-shapes
// <label> [base]): the build folder .cache/expressway-area/<label> and its scorecard
// .qa/expressway/<label>.report.json. With a base, also the base's parallel-ramp pairs joined from one
// surface followed into this build (how many are still not allowed: S6 PR 4's bar), and the stations
// of the pairs joined (from one surface or mid-way).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { XwChunk } from "../src/expressway/format.ts";
import { pairStations, SAME_SURFACE_M } from "../src/expressway/overlap.ts";
import { ReportSchema } from "../src/expressway/report.ts";
import { log } from "../src/log.ts";

/** A station this near one surface counts as "one surface" for where a pair parts from. */
const ONE_SURFACE_M = 0.2;
/** How far along the run a forbidden station may be from such a station and still part from it. */
const FROM_SAME_M = 25;
/** 0.3 節's "a level all but": a thinner girder (0.5 m) would make it a level apart. */
const LEVEL_ALL_BUT_M = 5.7;

const SHAPES = ["joinedFromSame", "joinedMidway", "apartFromSame", "apartMidway", "levelAllBut"] as const;
type Shape = (typeof SHAPES)[number];

const ROOT = join(import.meta.dirname, "..");
const label = process.argv[2];
const baseLabel = process.argv[3];
const isMissing = label === undefined;
if (isMissing) throw new Error("give the build's label (.cache/expressway-area/<label>)");

/** Each not-allowed pair of a build ("a|b", a < b) with its kind, shape and stations. */
function shapesOf(build: string): Map<string, { kind: string; shape: Shape; stations: number }> {
  const dir = join(ROOT, ".cache", "expressway-area", build);
  const seen = new Set<string>();
  const chunks: XwChunk[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d+-\d+\.json$/.test(f)))
    for (const c of JSON.parse(readFileSync(join(dir, f), "utf8")).chunks as XwChunk[]) {
      const isSeen = seen.has(c.id);
      if (isSeen) continue;
      seen.add(c.id);
      chunks.push(c);
    }
  const report = ReportSchema.parse(
    JSON.parse(readFileSync(join(ROOT, ".qa", "expressway", `${build}.report.json`), "utf8")),
  );
  const byPair = new Map<string, Array<{ run: string; s: number; dz: number; levelApart: number }>>();
  for (const p of pairStations(chunks)) {
    const key = p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    byPair.set(key, [
      ...(byPair.get(key) ?? []),
      { run: p.a, s: p.sa, dz: Math.abs(p.dz), levelApart: p.levelApart },
    ]);
  }
  const out = new Map<string, { kind: string; shape: Shape; stations: number }>();
  for (const o of report.overlapPairs.filter((p) => !p.allowed)) {
    const key = o.a < o.b ? `${o.a}|${o.b}` : `${o.b}|${o.a}`;
    const stations = byPair.get(key) ?? [];
    const forbidden = stations.filter((x) => x.dz > SAME_SURFACE_M && x.dz < x.levelApart);
    const near = stations.filter((x) => x.dz <= ONE_SURFACE_M);
    const isFromSame = forbidden.some((f) =>
      near.some((q) => q.run === f.run && Math.abs(q.s - f.s) <= FROM_SAME_M),
    );
    const isLevelAllBut = o.minDzM >= LEVEL_ALL_BUT_M;
    const shape: Shape = isLevelAllBut
      ? "levelAllBut"
      : o.joined
        ? isFromSame
          ? "joinedFromSame"
          : "joinedMidway"
        : isFromSame
          ? "apartFromSame"
          : "apartMidway";
    out.set(key, { kind: o.kind, shape, stations: o.stations });
  }
  return out;
}

const shapes = shapesOf(label);
const tally: Record<string, Record<Shape, { pairs: number; stations: number }>> = {};
for (const o of shapes.values()) {
  const t = (tally[o.kind] ??= Object.fromEntries(
    SHAPES.map((s) => [s, { pairs: 0, stations: 0 }]),
  ) as Record<Shape, { pairs: number; stations: number }>);
  t[o.shape].pairs++;
  t[o.shape].stations += o.stations;
}
const isJoinedParallel = (o: { kind: string; shape: Shape }) =>
  o.kind === "parallel-ramp" && (o.shape === "joinedFromSame" || o.shape === "joinedMidway");
const joinedStations = [...shapes.values()].filter(isJoinedParallel).reduce((n, o) => n + o.stations, 0);
const isTracked = baseLabel !== undefined;
const tracked = isTracked
  ? (() => {
      const base = [...shapesOf(baseLabel).entries()].filter(
        ([, o]) => o.kind === "parallel-ramp" && o.shape === "joinedFromSame",
      );
      return {
        base: baseLabel,
        pairs: base.length,
        stillNotAllowed: base.filter(([k]) => shapes.has(k)).length,
      };
    })()
  : null;
log("expressway_overlap_shapes", { label, byKind: tally, joinedStations, tracked });

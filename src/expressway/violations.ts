import { isAllowed } from "./allowlist";
import {
  checkChunkJoin,
  checkClearance,
  checkCover,
  checkGrade,
  checkGroundEnd,
  checkJunction,
  checkPlan,
  checkSuperelevation,
  checkSurface,
  checkVerticalCurves,
  climbingEnds,
  isTunnelFreeRun,
} from "./checks";
import { STATION_STRIDE, type XwChunk, type XwDiagnostic, type XwRunSummary } from "./format";
import { checkHeightStructures } from "./heightStructures";

/**
 * The checks of knowledge/road-redesign-plan.md 4.4 over built files, counted per property, as the
 * data test (tests/expresswayData.test.ts) runs them: T1 grade, T2 vertical curves and the Hermite
 * surface between stations, T3 joins (within a run and at a junction whose parent is in the files),
 * T4 clearance (the climbs from low ends and the allowed open-ground miss excepted), T5 ground ends,
 * T6 plan (the ramp radii the ledger accepts: `rampFloor`, ledger.ts rampFloorOf), T7 superelevation, T12 tunnel cover. The scorecard carries the
 * counts (P2.7-1: 「T1〜T7 違反 0」 is a shipping condition) and the first violations of each.
 * Why not the data test alone: it stops at the first property that fails and only on one folder.
 */
export const PROPERTIES = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T12", "T13"] as const;
export type Property = (typeof PROPERTIES)[number];

export type Violations = Record<Property, { count: number; first: string[] }>;

/** How many of each property's violations the scorecard lists. */
const FIRST = 5;

export function violationsOf(
  meta: { runs: readonly XwRunSummary[]; diagnostics: readonly XwDiagnostic[] },
  chunks: XwChunk[],
  rampFloor: (run: string) => number | undefined = () => undefined,
  /** The files name "height-structures" (P2.7-6): T13 judges the structures; else it has nothing to judge. */
  isHeight = false,
): Violations {
  const runs = new Map(meta.runs.map((r) => [r.id, r]));
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  for (const list of byRun.values()) list.sort((a, b) => a.k - b.k);
  const found = Object.fromEntries(PROPERTIES.map((p) => [p, [] as string[]])) as Record<Property, string[]>;
  const openShort = (id: string) => {
    const d = meta.diagnostics.find(
      (x) => x.run === id && x.kind === "below_open_ground_floor" && isAllowed(x),
    );
    return d ? Number(/^([\d.]+) m under/.exec(d.detail)![1]) + 0.01 : 0;
  };
  for (const c of chunks) {
    const run = runs.get(c.run)!;
    found.T1.push(...checkGrade(c, run));
    found.T2.push(...checkVerticalCurves(c), ...checkSurface(c));
    // A structure's run is not classified: its assumed floors are judged as by the tags (review W6).
    found.T4.push(
      ...checkClearance(
        c,
        run,
        climbingEnds(run, runs),
        openShort(c.run),
        isHeight && run.structure === null,
      ),
    );
    found.T6.push(...checkPlan(c, run, rampFloor(c.run)).problems);
    found.T7.push(...checkSuperelevation(c));
  }
  for (const r of meta.runs) {
    const list = byRun.get(r.id);
    if (!list) continue;
    for (let i = 1; i < list.length; i++) found.T3.push(...checkChunkJoin(list[i - 1], list[i]));
    for (const [atStart, end] of [
      [true, r.start],
      [false, r.end],
    ] as const) {
      const isJoined = end.kind === "junction" || end.kind === "seam";
      const parent = isJoined ? byRun.get(end.parent!) : undefined;
      if (!parent) continue;
      found.T3.push(...checkJunction(atStart ? list[0] : list[list.length - 1], atStart, end.grade!, parent));
    }
    found.T5.push(...checkGroundEnd(list[0], r, true), ...checkGroundEnd(list[list.length - 1], r, false));
    const first = list[0].st;
    const last = list[list.length - 1].st;
    const ends = { z0: first[3], z1: last[last.length - STATION_STRIDE + 3] };
    const isTunnelFree = isHeight && isTunnelFreeRun(list, r, ends);
    for (const c of list) found.T12.push(...checkCover(c, r, ends, isTunnelFree));
    if (isHeight) found.T13.push(...checkHeightStructures(list, r.below === true));
  }
  return Object.fromEntries(
    PROPERTIES.map((p) => [p, { count: found[p].length, first: found[p].slice(0, FIRST) }]),
  ) as Violations;
}

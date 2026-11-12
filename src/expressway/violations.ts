import { CASE_MARGIN, isAllowed } from "./allowlist";
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
  checkSeamHeading,
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
  // A height build's ramp under the assumed radius is a ledger case (ramp-radius, listed `new` until a
  // review decides it) as soon as it is reported (ramp_radius), so T6 and T3 hold it to its own OSM
  // radius as they hold a decided one (less CASE_MARGIN): counted once, in the ledger. Why only there:
  // the runs at grade (S6 PR 2) bring OSM's tight ramp ends (R 7.8 m) in, and a build by the tags keeps
  // the scorecard it had.
  const reported = new Map<string, number>();
  for (const d of isHeight ? meta.diagnostics : []) {
    const m = d.kind === "ramp_radius" ? /R=([\d.]+) m/.exec(d.detail) : null;
    if (m) reported.set(d.run, Number(m[1]) - CASE_MARGIN.radiusM);
  }
  const floorOf = (run: string) => rampFloor(run) ?? reported.get(run);
  const runs = new Map(meta.runs.map((r) => [r.id, r]));
  const isGroundBuild = meta.runs.some((r) => r.ground === true);
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
    found.T6.push(...checkPlan(c, run, floorOf(c.run)).problems);
    found.T7.push(...checkSuperelevation(c));
  }
  for (const r of meta.runs) {
    const list = byRun.get(r.id);
    if (!list) continue;
    for (let i = 1; i < list.length; i++)
      // The ramp's floor for T3's heading only in a height build: a build by the tags keeps T3 as it was
      // (review W9: a decided ramp-radius would have eased its heading too).
      found.T3.push(...checkChunkJoin(list[i - 1], list[i], isHeight ? floorOf(r.id) : undefined));
    for (const [atStart, end] of [
      [true, r.start],
      [false, r.end],
    ] as const) {
      const isJoined = end.kind === "junction" || end.kind === "seam";
      const parent = isJoined ? byRun.get(end.parent!) : undefined;
      if (!parent) continue;
      found.T3.push(...checkJunction(atStart ? list[0] : list[list.length - 1], atStart, end.grade!, parent));
      // A seam is one road going on (S6 PR 2): its end sections meet square, the same heading both sides
      // (review W1). Only with runs at grade, where every seam's heading is read across the runs.
      const isSeamChecked = isGroundBuild && end.kind === "seam";
      if (isSeamChecked)
        found.T3.push(
          ...checkSeamHeading(atStart ? list[0] : list[list.length - 1], atStart, end.parentS!, parent),
        );
    }
    found.T5.push(...checkGroundEnd(list[0], r, true), ...checkGroundEnd(list[list.length - 1], r, false));
    const first = list[0].st;
    const last = list[list.length - 1].st;
    // The descent from the portals starts at the ground there, as the compiler's (setupBelow's portalZ).
    // Why only in a height build: there a below run may seam to a run at grade (S6 PR 2) whose road
    // stands up to its band off the ground, and the road's height read as the portal's put ceilings
    // where the compiler had none (23594607, 21 in ship/all). A build by the tags keeps the road's.
    const ends = isHeight
      ? { z0: first[5], z1: last[last.length - STATION_STRIDE + 5] }
      : { z0: first[3], z1: last[last.length - STATION_STRIDE + 3] };
    const isTunnelFree = isHeight && isTunnelFreeRun(list, r, ends);
    // A run at grade's cuts are T13's (its road is within a band of the ground, no ceiling). A viaduct
    // -tagged run's cuts keep T12 (review W10): they are deeper than the dead band by what they are.
    const isJudgedCover = !(isHeight && r.ground === true);
    if (isJudgedCover) for (const c of list) found.T12.push(...checkCover(c, r, ends, isTunnelFree));
    if (isHeight) found.T13.push(...checkHeightStructures(list, r.below === true, r.ground === true));
  }
  return Object.fromEntries(
    PROPERTIES.map((p) => [p, { count: found[p].length, first: found[p].slice(0, FIRST) }]),
  ) as Violations;
}

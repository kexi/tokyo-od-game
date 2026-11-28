import type { District } from "../../src/expressway/districts.ts";
import type { XwFiles } from "../../src/expressway/files.ts";
import type { DeckRoute } from "./deckRoutes.ts";

/**
 * How much of a district a drive table drives (R1-5 PR B B3, `just measure-route-coverage`): for each
 * written run, the lanes some route drives on it (a cruise or wall route's lane on every run it
 * prefers), as a share of the run's length × lanes; and each run no route drives, with why. Pure.
 *
 * Why lanes 1+ of the main lines are not counted as missing: the user's decision of 2026-11-24 leaves
 * them to the probes and the views (districtRoutes.ts); they are listed under `lanesByDecision`.
 */
export type Coverage = {
  /** Driven length × lanes over all length × lanes of the district's written runs. */
  share: number;
  /** The same over lane 0 of the main lines, all lanes of the ramps (what the table is to drive). */
  shareOfPlan: number;
  lanesByDecision: number;
  /** Runs of the district no route drives, with why (none may be without one). */
  undriven: Array<{ run: string; why: string }>;
};

export function routeCoverage(
  files: Pick<XwFiles, "runs" | "byRun" | "closed">,
  districts: ReadonlyMap<string, District>,
  district: string,
  routes: readonly DeckRoute[],
  uncovered: ReadonlyArray<{ run: string; why: string }>,
): Coverage {
  const driven = new Map<string, Set<number>>();
  const add = (run: string, lane: number) => driven.set(run, (driven.get(run) ?? new Set()).add(lane));
  for (const r of routes) {
    const isAuto = r.kind === "auto";
    if (isAuto) continue;
    const lane = r.kind === "wall" ? r.lane : (r.lane ?? 0);
    for (const run of r.prefer) add(run, lane);
  }
  let all = 0;
  let got = 0;
  let plan = 0;
  let gotPlan = 0;
  let lanesByDecision = 0;
  const undriven: Coverage["undriven"] = [];
  for (const run of [...files.runs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const isHere = districts.get(run.id) === district && files.byRun.has(run.id);
    if (!isHere) continue;
    const chunks = files.byRun.get(run.id)!;
    const lanes = Math.max(1, ...chunks.map((c) => c.lanes));
    const set = driven.get(run.id) ?? new Set<number>();
    all += run.lengthM * lanes;
    got += run.lengthM * Math.min(lanes, set.size);
    const isLine = run.cls !== "ramp";
    const planned = isLine ? 1 : lanes;
    plan += run.lengthM * planned;
    gotPlan += run.lengthM * Math.min(planned, [...set].filter((l) => l < planned).length);
    if (isLine) lanesByDecision += lanes - 1;
    const isUndriven = set.size === 0;
    if (!isUndriven) continue;
    const why =
      uncovered.find((u) => u.run === run.id)?.why ?? "no route (and no reason: a gap in the generator)";
    undriven.push({ run: run.id, why });
  }
  for (const u of uncovered) {
    const isListed = undriven.some((x) => x.run === u.run);
    if (!isListed) undriven.push(u);
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    share: round(got / Math.max(1, all)),
    shareOfPlan: round(gotPlan / Math.max(1, plan)),
    lanesByDecision,
    undriven,
  };
}

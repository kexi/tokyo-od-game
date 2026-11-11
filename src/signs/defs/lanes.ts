// The lane patterns of 進行方向別通行区分 that are drawn ahead of time. Edit the lists here; the
// rest comes from the game's assumedLanes and public/data/turnlanes. Then `just make-sign-registry`
// and `just make-sign-textures` (knowledge/sign-system.md).
import { laneKey, laneSign, type LaneSpec } from "../lanes";
import type { LaneRender } from "../schema";

/** The 図示 of 別表第二 図 166–169 (327の7-A…D). */
const ILLUSTRATED: LaneSpec[][] = [
  ["left;through", "through", "right"],
  ["left;through"],
  ["left"],
  ["through"],
];

/** The exits a junction approach can have, as assumedLanes is asked for them. */
const EXIT_SETS: ReadonlyArray<ReadonlyArray<"left" | "through" | "right">> = [
  ["through"],
  ["left", "through"],
  ["through", "right"],
  ["left", "through", "right"],
  ["left", "right"],
  ["left"],
  ["right"],
];

/** Lane counts the game assumes a pattern for (regulations.ts resolveLaneUse caps the count at 5). */
const MAX_ASSUMED_LANES = 6;

/** 専用・優先 lanes on 327の4 / 327の5, after 図 162–164 (the 路線バス等 and 自転車 marks). */
const USE_EXAMPLES: LaneSpec[][] = [
  [{ dirs: "left;through", use: "bus" }, "through", "right"],
  [{ dirs: "left;through", use: "bus_priority" }, "through", "right"],
  [{ dirs: "left;through", use: "bus" }, "through", "through", "right"],
  [{ dirs: "left;through", use: "bus_priority" }, "through", "through", "right"],
  [{ dirs: "through", use: "bicycle" }, "through", "right"],
];

export type LaneSources = {
  /** turn:lanes values of public/data/turnlanes (z14 tiles in file-name order, rows in order). */
  turnlanes: readonly string[];
  /** src/world/regulations.ts assumedLanes: the usual pattern for n lanes and the exits. */
  assumed: (n: number, exits: Set<"left" | "through" | "right">) => readonly string[][];
};

/**
 * Pre-rendered 進行方向別通行区分 lane patterns, in render order, each counted where it first
 * appears: the 図示, every pattern assumedLanes gives for 1–6 lanes and each set of exits, every
 * turn:lanes value of the data, then the 専用・優先 examples. File and plate follow from the key
 * (registry.ts laneFile / lanePlate), the number from the lanes (lanes.ts laneSign).
 *
 * Why derive instead of listing them: the list is what the game may ask for, so it has to follow
 * the data (`just fetch-regs`) and the game's rule; a written-out list had to be redone by hand each time.
 */
export function laneRenders(src: LaneSources): LaneRender[] {
  const out = new Map<string, LaneRender>();
  const add = (lanes: string | readonly LaneSpec[]) => {
    const key = laneKey(lanes);
    if (!out.has(key)) out.set(key, { lanes: key, sign: laneSign(lanes) });
  };
  for (const lanes of ILLUSTRATED) add(lanes);
  for (let n = 1; n <= MAX_ASSUMED_LANES; n++)
    for (const exits of EXIT_SETS) add(src.assumed(n, new Set(exits)));
  for (const value of src.turnlanes) add(value);
  for (const lanes of USE_EXAMPLES) add(lanes);
  return [...out.values()];
}

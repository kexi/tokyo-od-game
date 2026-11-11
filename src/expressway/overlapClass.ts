import { overlapSize } from "./allowlist";
import type { XwClass, XwDiagnostic, XwTileRun } from "./format";

/**
 * The kinds of deck overlap (deck_overlap) the scorecard counts apart (P2.7-1), because each needs
 * a different cure in the later stages:
 * - nose: two runs joined at a junction (one hangs from the other, or both from one run) whose
 *   overlap stays within 0.5 m: the nose of a diverge or merge just off one surface.
 * - parallel-ramp: a main line and a ramp beside it at heights apart (a ramp running up or down
 *   along the main line within OSM's ±1.5 m).
 * - changeover: two main lines more than 0.5 m apart: the two directions passing between two
 *   levels and side by side (都心環状線, 芝浦).
 * - other: the rest (ramps over ramps, streets, a near-surface pair not joined).
 * Why 0.5 m: P2.5's breakdown of the universe's 232 pairs split there (114 under 0.5 m, taken there as noses).
 */
export type OverlapClass = "nose" | "parallel-ramp" | "changeover" | "other";

export const OVERLAP_CLASSES: readonly OverlapClass[] = ["nose", "parallel-ramp", "changeover", "other"];

/** The largest |Δz| of a nose (m). */
export const NOSE_MAX_DZ_M = 0.5;

export type OverlapPair = {
  a: string;
  b: string;
  stations: number;
  minDzM: number;
  maxDzM: number;
  allowed: boolean;
};

/** The pair of a deck_overlap diagnostic ("with b: N stations, |Δz| lo–hi m, …"), null for others. */
export function overlapPair(d: XwDiagnostic): OverlapPair | null {
  const isOverlap = d.kind === "deck_overlap";
  if (!isOverlap) return null;
  const other = /^with ([^:]+):/.exec(d.detail);
  const size = overlapSize(d.detail);
  const low = /\|Δz\| ([\d.]+)–/.exec(d.detail);
  if (!other || !size || !low) return null;
  return {
    a: d.run,
    b: other[1],
    stations: size.stations,
    minDzM: Number(low[1]),
    maxDzM: size.maxDzM,
    allowed: d.allowed,
  };
}

/** Parents (junction or seam) of each run's two ends. */
function parentsOf(run: Pick<XwTileRun, "start" | "end">): string[] {
  return [run.start.parent, run.end.parent].filter((p): p is string => p !== undefined);
}

/** Whether two runs meet at a junction: one is the other's parent, or they share a parent. */
export function isJoined(
  a: Pick<XwTileRun, "id" | "start" | "end">,
  b: Pick<XwTileRun, "id" | "start" | "end">,
): boolean {
  const pa = parentsOf(a);
  const pb = parentsOf(b);
  const isParent = pa.includes(b.id) || pb.includes(a.id);
  if (isParent) return true;
  return pa.some((p) => pb.includes(p));
}

/**
 * The ledger's kind of a deck_overlap pair (P2.7-4): `touchdown` for a pair the plan does not hold a
 * level apart (compile.ts markSharedTouchdowns, report.json `untied`: two main lines coming down to
 * the same place, whether to accept or treat as one surface is S5's), else the scorecard's class.
 * Why not a fifth class of the scorecard: its `overlaps` keep the four kinds of P2.7-1, comparable
 * with the reports before.
 */
export type OverlapKind = OverlapClass | "touchdown";

export function overlapKindOf(
  pair: Pick<OverlapPair, "maxDzM">,
  clsA: XwClass,
  clsB: XwClass,
  joined: boolean,
  untied: boolean,
): OverlapKind {
  if (untied) return "touchdown";
  return classifyOverlap(pair, clsA, clsB, joined);
}

export function classifyOverlap(
  pair: Pick<OverlapPair, "maxDzM">,
  clsA: XwClass,
  clsB: XwClass,
  joined: boolean,
): OverlapClass {
  const isNear = pair.maxDzM <= NOSE_MAX_DZ_M;
  const isNose = isNear && joined;
  if (isNose) return "nose";
  if (isNear) return "other";
  const mains = [clsA, clsB].filter((c) => c === "expressway").length;
  const ramps = [clsA, clsB].filter((c) => c === "ramp").length;
  const isParallelRamp = mains === 1 && ramps === 1;
  if (isParallelRamp) return "parallel-ramp";
  const isChangeover = mains === 2;
  return isChangeover ? "changeover" : "other";
}

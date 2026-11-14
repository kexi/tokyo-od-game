// Which flags of scripts/expressway.ts are for measuring only, so never write public/data/expressway
// (a build without --out): the reason to stop, or null when the build may write the shipped folder.

export type BuildFlags = {
  hasOut: boolean;
  /** --below all: the tunnels and cuts kept (measuring). */
  isBelowAll: boolean;
  /** --partition blocks (P2.7-2: blocks move the decks). */
  isBlocks: boolean;
  /** --objective v1 (the objective before P2.7-5, kept to compare against). */
  isV1: boolean;
  /** The v2 weight flags given (grade-change, reach, reach-below, target-scale): a sweep. */
  v2Flags: readonly string[];
  /** --structures tags (the structures by OSM's tags; height is the default since S6 PR 7c). */
  isTags?: boolean;
  /** --ground skip (the runs at grade left out; compile is the default since S6 PR 7c). */
  isGroundSkip?: boolean;
  /** --touchdown mains (S6 PR 3's all is the default since PR 7c). */
  isTouchdownMains?: boolean;
  /** --companions off (S6 PR 3's on is the default since PR 7c). */
  isCompanionsOff?: boolean;
  /** --companion-weight given (a sweep of the companions' weight; 1 by default). */
  isCompanionWeight?: boolean;
  /** --ramp-shift (S6 PR 4 案 A: ramps moved off the main lines they overlap). */
  isRampShift?: boolean;
  /** --nose-surface overlap (S6 PR 4 案 B: one surface wherever two runs that meet overlap). */
  isNoseOverlap?: boolean;
  /** --hold-mains on (S6 PR 6: a main line off its own line near a junction is the ramp's miss). */
  isHoldMains?: boolean;
  /** --low-span-soffit (S6 PR 7a2: the low spans' least soffit, a sweep). */
  isLowSpanSweep?: boolean;
};

const MEASURE = "give --out (just measure-expressway-area)";

/**
 * The reason a build must not write the shipped folder, or null. Why the v2 weights too (PR #71
 * review W3): a sweep's weight (`--reach 600`) without --out overwrote the shipped data with decks
 * that no review had seen.
 */
export function shippedFolderRefusal(f: BuildFlags): string | null {
  if (f.hasOut) return null;
  if (f.isBelowAll) return `--below all is for measuring: ${MEASURE}`;
  if (f.isBlocks) return `--partition blocks is for measuring: ${MEASURE}`;
  if (f.isV1) return `--objective v1 is for comparing: ${MEASURE}`;
  const isSweep = f.v2Flags.length > 0;
  if (isSweep) return `--${f.v2Flags[0]} is for a sweep of the v2 weights: ${MEASURE}`;
  if (f.isHoldMains) return `--hold-mains on is for measuring until it is the default: ${MEASURE}`;
  if (f.isRampShift) return `--ramp-shift is for measuring until it is the default: ${MEASURE}`;
  if (f.isNoseOverlap) return `--nose-surface overlap is for measuring until it is the default: ${MEASURE}`;
  if (f.isLowSpanSweep) return `--low-span-soffit is for a sweep of the low spans: ${MEASURE}`;
  // S6 PR 7c: the network's flags are the default; the values before them are for comparing.
  if (f.isTags) return `--structures tags is for comparing with the structures by height: ${MEASURE}`;
  if (f.isGroundSkip) return `--ground skip is for comparing with the runs at grade compiled: ${MEASURE}`;
  if (f.isTouchdownMains) return `--touchdown mains is for comparing with all: ${MEASURE}`;
  if (f.isCompanionsOff) return `--companions off is for comparing with on: ${MEASURE}`;
  if (f.isCompanionWeight) return `--companion-weight is for a sweep of the companions' weight: ${MEASURE}`;
  return null;
}

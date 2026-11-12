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
  return null;
}

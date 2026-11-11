import type { Bbox } from "./compile";
import type { XwChunk } from "./format";

/**
 * Named build ranges for `scripts/expressway.ts --range` (several with commas: their runs are
 * built together). `hamazakibashi` is P1's test section: 都心環状線 between 浜崎橋 JCT and 芝公園, with
 * the 芝公園 entrance and exit (one pair of ramps). `rainbow` is P7's: 11号台場線 from its approach
 * out of 芝浦 to the 台場 exit, over the Rainbow Bridge (upper floor), and the 臨港道路 on the lower
 * floor from the 芝浦 loop to the 台場 streets (structures.ts).
 */
export const RANGES = {
  hamazakibashi: { minLon: 139.7475, minLat: 35.6515, maxLon: 139.759, maxLat: 35.6555 },
  rainbow: { minLon: 139.7555, minLat: 35.6335, maxLon: 139.779, maxLat: 35.647 },
} as const satisfies Record<string, Bbox>;

export type RangeName = keyof typeof RANGES;

/** The ranges the data is built for by default (`scripts/expressway.ts` without --range). */
export const DEFAULT_RANGES: readonly RangeName[] = ["hamazakibashi", "rainbow"];

/**
 * `--range` as the build script reads it: named ranges joined by commas (their runs are built
 * together), `all` for the whole universe (boxes null), the defaults when absent.
 */
export function parseRanges(arg: string | undefined): { names: RangeName[]; boxes: Bbox[] | null } {
  const value = arg ?? DEFAULT_RANGES.join(",");
  if (value === "all") return { names: [], boxes: null };
  const names = value.split(",");
  for (const name of names) {
    const isKnown = name in RANGES;
    if (!isKnown) throw new Error(`unknown --range ${name} (${Object.keys(RANGES).join(", ")}, all)`);
  }
  const known = names as RangeName[];
  return { names: known, boxes: known.map((n) => RANGES[n]) };
}

/** Order of chunks in a tile: by run, then along it (byte-stable output). */
export function compareChunks(a: XwChunk, b: XwChunk): number {
  return a.run < b.run ? -1 : a.run > b.run ? 1 : a.k - b.k;
}

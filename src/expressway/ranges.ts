import type { Bbox } from "./compile";
import type { XwChunk } from "./format";

/**
 * Named build ranges for `scripts/expressway.ts --range`. P1 builds only the test section: 都心環状線
 * between 浜崎橋 JCT and 芝公園, with the 芝公園 entrance and exit (one pair of ramps).
 */
export const RANGES = {
  hamazakibashi: { minLon: 139.7475, minLat: 35.6515, maxLon: 139.759, maxLat: 35.6555 },
} as const satisfies Record<string, Bbox>;

export type RangeName = keyof typeof RANGES;

/** Order of chunks in a tile: by run, then along it (byte-stable output). */
export function compareChunks(a: XwChunk, b: XwChunk): number {
  return a.run < b.run ? -1 : a.run > b.run ? 1 : a.k - b.k;
}

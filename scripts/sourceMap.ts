/**
 * The original position of a generated one, from a source map's `mappings` (v3). Used by the dev
 * log sink to turn a stack frame in the served JavaScript into the TypeScript file:line.
 *
 * Why not the `source-map` packages: they are not dependencies of this project (only of tools
 * deep in node_modules), and the lookup needs ~40 lines of base64 VLQ.
 */

export type SourceMapLike = { mappings: string; sources: readonly (string | null)[] };
export type Original = { source: string; line: number; column: number };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...B64].map((c, i) => [c, i]));

/** The numbers of one segment ("AAgBC" → [0, 0, 16, 1]). */
export function decodeSegment(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const c of segment) {
    const digit = DIGIT.get(c);
    if (digit === undefined) throw new Error(`not base64 VLQ: ${c}`);
    value += (digit & 31) << shift;
    const hasMore = (digit & 32) !== 0;
    if (hasMore) {
      shift += 5;
      continue;
    }
    // The lowest bit is the sign.
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return out;
}

/**
 * The original of the generated `line` / `column` (both 0-based): the last mapped segment on that
 * line at or before the column. Null when the line maps to nothing.
 */
export function originalPosition(map: SourceMapLike, line: number, column: number): Original | null {
  // Source, line and column are deltas across the whole map: walk every line up to the target.
  let source = 0;
  let srcLine = 0;
  let srcColumn = 0;
  const lines = map.mappings.split(";");
  let best: Original | null = null;
  for (let l = 0; l <= line && l < lines.length; l++) {
    let genColumn = 0;
    for (const segment of lines[l].split(",")) {
      if (segment === "") continue;
      const f = decodeSegment(segment);
      genColumn += f[0];
      if (f.length < 4) continue;
      source += f[1];
      srcLine += f[2];
      srcColumn += f[3];
      const isCandidate = l === line && genColumn <= column;
      if (!isCandidate) continue;
      const name = map.sources[source];
      if (name) best = { source: name, line: srcLine, column: srcColumn };
    }
  }
  return best;
}

import type { XwTileRun } from "../expressway/format";

/**
 * Which ends of the loaded runs have nothing written going on beyond them (R1-1b 3.1): the ends that
 * expresswayDeck.ts closes with a wall. Pure, from the tiles' run summaries (`start` / `end`: kind,
 * parent, parentS) and each run's run-distance range as far as its chunks are loaded. Why not a flag
 * in the tiles ("wall here"): the default tiles would move, and --districts picks the runs just before
 * writing, so one chunk is an end in one stage and not in the next (T8). Why not `kind: "open"` alone:
 * 9 of the default range's 12 open ends have a seam child going on (24402609:end …), and a portal or
 * an end whose parent is not written has nothing beyond either. Why not the scorecard's list of ends:
 * the game never reads report.json.
 */

/** How near two run distances are to be one node: the same as expresswayRoads.ts's ends on a parent. */
export const END_NODE_EPS_M = 1e-3;

export type EndSide = "start" | "end";

/** A run's run distances as far as its chunks are loaded: `s1` null until its last chunk is. */
export type RunRange = { s0: number; s1: number | null };

export type EndAnswer =
  | { ahead: true; why: "ground" | "seam-child" | "onward" | "on-parent" | "parent-goes-on"; via?: string }
  | { ahead: false; why: "dead" | "parent-dead"; via?: string };

const isNear = (a: number | undefined, b: number | null) =>
  a !== undefined && b !== null && Math.abs(a - b) <= END_NODE_EPS_M;

/**
 * The answer for run `id`'s end `side` (R1-1b 3.1, top to bottom):
 * (a) a ground end: the road goes on at the ground;
 * (b) a loaded run seamed on at that run distance;
 * (c) a loaded run hung by a junction at the node and going on beyond it (this run's end meets its
 *     start, this run's start its end);
 * (d) hung on a loaded parent: inside the parent, the road goes on; at the parent's end, as that end
 *     (going on where this run's end meets the parent's start, or its start the parent's end);
 * (e) else nothing goes on: a dead end. `seen` stops a loop of (d).
 */
export function endAhead(
  runs: ReadonlyMap<string, XwTileRun>,
  rangeOf: (run: string) => RunRange | null,
  id: string,
  side: EndSide,
  seen: Set<string> = new Set(),
): EndAnswer {
  const run = runs.get(id);
  const range = rangeOf(id);
  if (!run || !range) return { ahead: false, why: "dead" };
  const key = `${id}:${side}`;
  const isLoop = seen.has(key);
  if (isLoop) return { ahead: false, why: "dead" };
  seen.add(key);
  const e = run[side];
  if (e.kind === "ground") return { ahead: true, why: "ground" };
  const sE = side === "start" ? range.s0 : range.s1;
  const others = [...runs.values()].filter((r) => r.id !== id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const hangsHere = (r: XwTileRun, at: EndSide) => {
    const c = r[at];
    return c.parent === id && isNear(c.parentS, sE);
  };
  const seamed = others.find((r) =>
    (["start", "end"] as const).some((at) => r[at].kind === "seam" && hangsHere(r, at)),
  );
  if (seamed) return { ahead: true, why: "seam-child", via: seamed.id };
  // The child's end that meets this end of the parent and leaves it going on: its start at the
  // parent's end, its end at the parent's start.
  const childSide: EndSide = side === "end" ? "start" : "end";
  const onward = others.find((r) => r[childSide].kind === "junction" && hangsHere(r, childSide));
  if (onward) return { ahead: true, why: "onward", via: onward.id };
  const isHung = (e.kind === "junction" || e.kind === "seam") && e.parent !== undefined && runs.has(e.parent);
  if (!isHung) return { ahead: false, why: "dead" };
  const parent = e.parent!;
  const pRange = rangeOf(parent);
  const isAtStart = pRange !== null && isNear(e.parentS, pRange.s0);
  const isAtEnd = pRange !== null && isNear(e.parentS, pRange.s1);
  const isInside = !isAtStart && !isAtEnd;
  if (isInside) return { ahead: true, why: "on-parent", via: parent };
  const pSide: EndSide = isAtStart ? "start" : "end";
  // This run's end on the parent's start (or its start on the parent's end): the parent goes on.
  const isThrough = (side === "end" && pSide === "start") || (side === "start" && pSide === "end");
  if (isThrough) return { ahead: true, why: "parent-goes-on", via: parent };
  const p = endAhead(runs, rangeOf, parent, pSide, seen);
  return p.ahead
    ? { ahead: true, why: "parent-goes-on", via: parent }
    : { ahead: false, why: "parent-dead", via: parent };
}

/** Every loaded run's two ends' answers, by `run:side`, in id order (the same whatever order the runs came in). */
export function endsAhead(
  runs: ReadonlyMap<string, XwTileRun>,
  rangeOf: (run: string) => RunRange | null,
): Map<string, EndAnswer> {
  const out = new Map<string, EndAnswer>();
  for (const id of [...runs.keys()].sort())
    for (const side of ["start", "end"] as const) out.set(`${id}:${side}`, endAhead(runs, rangeOf, id, side));
  return out;
}

/** A run's range from its loaded chunks (k order): the first station's s, the last's once its last chunk (no `next`) is in. */
export function rangeOfChunks(
  chunks: ReadonlyArray<{ k: number; st: ArrayLike<number>; next: string | null }>,
  stride: number,
): RunRange | null {
  const isEmpty = chunks.length === 0;
  if (isEmpty) return null;
  const sorted = [...chunks].sort((a, b) => a.k - b.k);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const isFirstIn = first.k === 0;
  const isLastIn = last.next === null;
  return { s0: isFirstIn ? first.st[0] : Number.NaN, s1: isLastIn ? last.st[last.st.length - stride] : null };
}

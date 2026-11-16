// How far the buildings' current load has got, from the tiles renderer's own counts. Pure: the state
// goes in with this frame's numbers and comes out with the progress. src/world/buildings.ts steps one
// per renderer each frame.
//
// Why not the library's loadProgress: 3d-tiles-renderer ends a download's job when the response
// headers arrive and reads the body outside its queue, so its `isLoading` turns false and
// loadProgress returns 1 with tiles still downloading (X1 timelines: 4–96 tiles, the last arriving
// 2–14 s later; the loading screen closed with 0–2 of 7 nearby tiles shown). Its stats keep counting
// them until the body is in, and those are public, so the count is redone here instead of changing
// the library. Why not wait for a quiet spell (the QA shots' quietS): it would make every load wait
// that long, and the counts already say when nothing is left.

/** This frame's counts of one renderer. */
export type LoadCounts = {
  /** Tiles queued, downloading or parsing (stats.queued + downloading + parsing). */
  remaining: number;
  /** Tiles finished since the renderer began, ever growing (load-model, load-tileset, load-error). */
  finished: number;
};

export type LoadState = {
  progress: number;
  /** `finished` when the current load began (remaining rose from 0). */
  finishedAtStart: number;
  /** When remaining last became 0 (ms), or null while some remain. */
  zeroSince: number | null;
};

/**
 * How long nothing may remain before the load counts as done (ms). A tileset is nested (the root,
 * a prefecture, a municipality, its tiles): between one level finishing and the next being queued,
 * nothing remains for a moment. Measured on main before choosing (scripts/qa/timeline-buildings.ts,
 * knowledge/plateau-buildings.md): within a load such gaps were one frame (9–24 ms) at 東京駅・川崎駅・
 * 川口駅 and 610 ms once, after the warp to 川口駅; so above 610 ms and under twice that. Gaps of 1.5 s
 * and more came only between loads (the camera leaving the title screen, the car set on a street).
 */
export const LOAD_HOLD_MS = 800;
/**
 * What progress reads while nothing remains but the hold has not passed: all of what is known is in,
 * yet the screen's 0.999 must not be met. Above 0.95, so a warp (which lands at 95 % of this load)
 * is not held by it.
 */
const HOLDING = 0.998;

export function startLoad(now: number): LoadState {
  return { progress: HOLDING, finishedAtStart: 0, zeroSince: now };
}

/**
 * The next state: while tiles remain, the share of this load finished (finished since it began over
 * finished + remaining), never 1; once none remain, HOLDING until `hold` ms have passed with none,
 * then 1. A load begins when remaining rises from 0, so tiles held from an earlier place (after a
 * warp) do not count. Failed and refused tiles are not remaining (one failure must not hold the
 * screen to its limit).
 */
export function stepLoad(state: LoadState, counts: LoadCounts, now: number, hold = LOAD_HOLD_MS): LoadState {
  const isLoading = counts.remaining > 0;
  if (isLoading) {
    const isNewLoad = state.zeroSince !== null;
    const finishedAtStart = isNewLoad ? counts.finished : state.finishedAtStart;
    const done = counts.finished - finishedAtStart;
    const progress = Math.min(HOLDING, done / (done + counts.remaining));
    return { progress, finishedAtStart, zeroSince: null };
  }
  const zeroSince = state.zeroSince ?? now;
  const isHeldLongEnough = now - zeroSince >= hold;
  return { progress: isHeldLongEnough ? 1 : HOLDING, finishedAtStart: state.finishedAtStart, zeroSince };
}

import type { Segment } from "../world/roads";
import type { Approach } from "../world/trafficControl";

/** What stopAheadWithin needs of the road graph and of the signals (RoadGraph, TrafficControl). */
export type StopAheadWorld = {
  nodes: ReadonlyMap<number, readonly number[]>;
  segments: readonly Segment[];
  nextStop(seg: Segment, dir: 1 | -1, s: number): { approach: Approach; dist: number } | null;
};

/**
 * The nearest stop line or signal within `range` m ahead of a car on `seg` travelling `dir`, `s` m
 * along it (travel distance): on this segment, or past its end on any segment going on from the
 * node it runs into. For 第75条の8第1項 (法令の規定により一時停止する場合): a car waiting at a red
 * light is not 駐停車.
 *
 * Why past the segment's end: the line a car waits at can stand on the next segment. At the foot of
 * the 汐留出口 ramp (24402125:2) the light is on the street the ramp runs into, so the ramp's own
 * segment had no stop ahead, and an autopilot waiting at the red was booked xwStopping (D1). Why one
 * segment on and not along a route: the player drives without one, and every way on from the node
 * leads to the same junction; a range of 40 m (main.ts) does not reach a second one.
 */
export function stopAheadWithin(
  world: StopAheadWorld,
  seg: Segment,
  dir: 1 | -1,
  s: number,
  range: number,
): { approach: Approach; dist: number } | null {
  const here = world.nextStop(seg, dir, s);
  const isHereInRange = here !== null && here.dist < range;
  if (isHereInRange) return here;
  const toEnd = seg.length - s;
  const isEndInRange = toEnd < range;
  if (!isEndInRange) return null;
  const node = dir === 1 ? seg.to : seg.from;
  let best: { approach: Approach; dist: number } | null = null;
  for (const id of world.nodes.get(node) ?? []) {
    const next = world.segments[id];
    const isSame = next === undefined || next.id === seg.id;
    if (isSame) continue;
    const onDir: 1 | -1 = next.from === node ? 1 : -1;
    // Its travel distance where the car is now: short of its start by what is left of this one.
    const onward = world.nextStop(next, onDir, -toEnd);
    const isNearer = onward !== null && onward.dist < range && (best === null || onward.dist < best.dist);
    if (isNearer) best = onward;
  }
  return best;
}

import type { Segment } from "./roads";

/**
 * 進路変更禁止 (道路交通法 第26条の2第3項): where a 車両通行帯 is bounded by the yellow lane line
 * (標示 102 の 2, JARTIC 52・119 → Segment.noLaneChange), a car keeps the lane it is in. One
 * definition of "where" and "which lane" for everything that cares: the violation check in
 * main.ts, the yellow lines roadSurface.ts paints (lanes ≥ 2), the route's lane plan (drivePath.ts,
 * the green arrows), the autopilot and the navi's lane advice. A second copy of the arithmetic
 * would let the arrows cross a line the checker books.
 */

/** Whether changing lanes on this segment is 進路変更禁止違反 (yellow lane lines between lanes). */
export function isLaneChangeBanned(seg: Segment): boolean {
  return seg.noLaneChange && seg.lanes >= 2;
}

/** Width of one lane of `n` in the direction of travel (the painted 車線境界線 split it evenly). */
export function laneWidth(seg: Segment, n = seg.lanes): number {
  const span = seg.oneway === 0 ? seg.line.width / 2 : seg.line.width;
  return span / Math.max(1, n);
}

/**
 * Lane (0 = by the left kerb) of a point `leftOfTravel` metres left of the centreline, counted
 * the way the lines are painted. Not clamped: below 0 is beyond the left edge, ≥ n across the
 * centre line (or the right edge of a one-way street).
 */
export function laneOfOffset(seg: Segment, leftOfTravel: number, n = seg.lanes): number {
  return Math.floor((seg.line.width / 2 - leftOfTravel) / laneWidth(seg, n));
}

/**
 * The offsets (metres left of the centreline) a path in `lane` may take on this segment, kept
 * `margin` inside its painted lines so that rounding never puts it over one.
 */
export function laneBand(
  seg: Segment,
  lane: number,
  n = seg.lanes,
  margin = 0.5,
): { min: number; max: number } {
  const w = laneWidth(seg, n);
  const inset = Math.min(margin, w / 4);
  const left = seg.line.width / 2 - lane * w;
  return { min: left - w + inset, max: left - inset };
}

/**
 * The lane a car is in, `leftOfTravel` metres left of the centreline, or null when it is not on
 * this direction's carriageway (on the pavement, across the centre line).
 */
export function laneOfPoint(seg: Segment, leftOfTravel: number): number | null {
  const lane = laneOfOffset(seg, leftOfTravel);
  return lane >= 0 && lane < seg.lanes ? lane : null;
}

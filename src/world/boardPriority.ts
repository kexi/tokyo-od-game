/**
 * How much the BoardFacePool (boardFacePool.ts) wants a board's drawn face: kept apart, with no
 * three.js or canvas, so the rule is tested on its own (tests/guideLayout.test.ts).
 */

/** Smaller is wanted sooner: −(apparent size × facing), pushed after all when on another level. */
export function boardPriority(b: {
  width: number;
  distance: number;
  /** cos of the angle between the board's normal and the way to the eye (≤ 0: seen from behind). */
  facing: number;
  isOtherLevel: boolean;
}): number {
  const apparent = b.width / Math.max(1, b.distance);
  // A board seen edge-on or from behind keeps a little weight: the eye may turn round.
  const squareness = Math.max(0.1, b.facing);
  const score = apparent * squareness;
  return (b.isOtherLevel ? 1 : 0) - score;
}

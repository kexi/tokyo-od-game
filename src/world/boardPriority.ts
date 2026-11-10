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

/** What rankBoards needs of a board: its key, where its face is and looks, its width and level. */
export type RankedBoard = {
  key: string;
  pos: { x: number; z: number };
  normal: { x: number; z: number };
  width: number;
  level: number;
};

/**
 * Every user's boards ranked together as seen from `eye` (BoardFacePool, G5 review W5): those
 * within `range`, the `count` most wanted, one per content key (the better placed board speaks for
 * a twin). A user's list never pushes out another's except by priority.
 */
export function rankBoards<B extends RankedBoard>(
  users: ReadonlyArray<readonly B[]>,
  eye: { x: number; z: number },
  eyeLevel: number,
  limits: { range: number; count: number },
): Array<{ b: B; priority: number }> {
  const ranked: Array<{ b: B; priority: number }> = [];
  for (const boards of users)
    for (const b of boards) {
      const dx = eye.x - b.pos.x;
      const dz = eye.z - b.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= limits.range) continue;
      const facing = distance > 1e-6 ? (dx * b.normal.x + dz * b.normal.z) / distance : 1;
      const priority = boardPriority({
        width: b.width,
        distance,
        facing,
        isOtherLevel: b.level !== eyeLevel,
      });
      ranked.push({ b, priority });
    }
  const chosen: Array<{ b: B; priority: number }> = [];
  const seen = new Set<string>();
  for (const r of ranked.toSorted((p, q) => p.priority - q.priority)) {
    const isFull = chosen.length >= limits.count;
    if (isFull) break;
    if (seen.has(r.b.key)) continue;
    seen.add(r.b.key);
    chosen.push(r);
  }
  return chosen;
}

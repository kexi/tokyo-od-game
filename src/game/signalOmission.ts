import type { Turn } from "./navigation";

/**
 * 合図 (道路交通法 第53条): a turn or a lane change needs the indicator for its side to have been on
 * within the last SIGNAL_RECENT_MS (it cancels itself as the wheel comes back, so "on now" is too
 * strict). main.ts judges a turn 25 m past the junction, a lane change as it is counted.
 *
 * All times are the game's clock (frameClock.ts gameStep), the one the car moves by. Why not the
 * wall clock (as before): at frames over MAX_FRAME_S the car covers a sixth of the road in the
 * same wall time, and the 6 s ran out between the indicator going off and the car reaching the
 * point 25 m on — the autopilot, which signals, was booked (knowledge/game-clock.md).
 */
export const SIGNAL_RECENT_MS = 6000;

export type SignalSide = "left" | "right";

/** When each indicator was last on (game ms; -Infinity: never). */
export type IndicatorMemory = Record<SignalSide, number>;

/** The indicator a turn needs (null: straight on, or a slight bend that needs none). */
export function turnSignalSide(turn: Turn): SignalSide | null {
  const isLeft = turn === "left" || turn === "slightLeft";
  if (isLeft) return "left";
  const isRight = turn === "right" || turn === "uturn";
  if (isRight) return "right";
  return null;
}

/** Remember the indicators on in this frame at `now`. */
export function noteIndicators(memory: IndicatorMemory, left: boolean, right: boolean, now: number): void {
  if (left) memory.left = now;
  if (right) memory.right = now;
}

/** A move to `side` at `now` without that side's indicator in the last SIGNAL_RECENT_MS. */
export function isSignalOmitted(side: SignalSide | null, now: number, memory: IndicatorMemory): boolean {
  if (side === null) return false;
  return now - memory[side] > SIGNAL_RECENT_MS;
}

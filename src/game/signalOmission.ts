import type { Vector3 } from "three";
import { classifyTurn, type Turn } from "./navigation";

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

/** A turn at a junction is judged this far past the junction's node (main.ts). */
export const TURN_JUDGED_M = 25;

/** A junction the car is going through: the approach's direction and the node (main.ts turnAt). */
export type TurnWatch = { tIn: Vector3; node: Vector3 };

/**
 * Whether the car is still in a turn at a junction: watched from 20 m before the node until the
 * turn is judged TURN_JUDGED_M past it, and heading away from the approach (classifyTurn: not
 * straight on). The lane checks (合図 for a lane change, 進路変更禁止) count no lane then: the
 * curve of a turn may end lanes over from where it crosses into the new street, and that is the
 * turn, signalled for its own side (施行令 第21条: until the turn is over), not a lane change. The
 * lane the car is in past TURN_JUDGED_M is the one held from there.
 *
 * Why not count from the moment the car runs along the new street (as before): a right turn out
 * of the lane by the centre line into lane 0 of 3 crosses two lane lines in its last 13 m with the
 * car already along the street, booked as a lane change with no 合図 (丸の内二丁目, D2 (a)). Why
 * the 25 m the turn is judged at, not a new distance: the turn's own check already takes the turn
 * as over there. Straight on through a junction changes nothing: a lane change there is counted.
 */
export function isInTurn(watch: TurnWatch | null, pos: Vector3, forward: Vector3): boolean {
  if (watch === null) return false;
  const isPastJudged = Math.hypot(pos.x - watch.node.x, pos.z - watch.node.z) > TURN_JUDGED_M;
  if (isPastJudged) return false;
  const along = forward.clone().setY(0);
  if (along.lengthSq() < 1e-9) return false;
  return classifyTurn(watch.tIn, along.normalize()) !== "straight";
}

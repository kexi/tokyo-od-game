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

/**
 * A junction the car is going through (main.ts turnAt): the approach's direction, the node, and
 * when the watch began (game ms, 20 m before the node).
 */
export type TurnWatch = { tIn: Vector3; node: Vector3; since: number };

/**
 * Whether the car is still in a turn at a junction: watched from 20 m before the node until the
 * turn is judged TURN_JUDGED_M past it, and on a street that leaves the approach other than
 * straight on (`along`: the street under the car, in the way it drives it; classifyTurn). The lane
 * checks (合図 for a lane change, 進路変更禁止) count no lane then: the curve of a turn may end lanes
 * over from where it crosses into the new street, and that is the turn, signalled for its own side
 * (施行令 第21条: until the turn is over), not a lane change. The lane the car is in past
 * TURN_JUDGED_M is the one held from there. Off any street (`along` null): not in a turn.
 *
 * Why not count from the moment the car runs along the new street (as before): a right turn out
 * of the lane by the centre line into lane 0 of 3 crosses two lane lines in its last 13 m with the
 * car already along the street, booked as a lane change with no 合図 (丸の内二丁目, D2 (a)). Why
 * the street's direction, not the car's heading: a move across lanes at 22–32° just before a
 * junction is on the approach, and the lane checks count it as they always did. Why the 25 m the
 * turn is judged at, not a new distance: the turn's own check already takes the turn as over there.
 */
export function isInTurn(watch: TurnWatch | null, pos: Vector3, along: Vector3 | null): boolean {
  if (watch === null || along === null) return false;
  const isPastJudged = Math.hypot(pos.x - watch.node.x, pos.z - watch.node.z) > TURN_JUDGED_M;
  if (isPastJudged) return false;
  const flat = along.clone().setY(0);
  if (flat.lengthSq() < 1e-9) return false;
  return classifyTurn(watch.tIn, flat.normalize()) !== "straight";
}

/**
 * Whether a turn judged now misses its 合図: none of the turn's side within SIGNAL_RECENT_MS, and
 * none since the watch began either. Why the watch too: a car that signalled, turned and then
 * crawled to the point 25 m on (a queue past the junction) ran out the 6 s with the indicator
 * already cancelled by the wheel, and was booked (汐留, pre-wait 20, 1 in 3: d104-review W3).
 */
export function isTurnSignalOmitted(
  side: SignalSide | null,
  now: number,
  memory: IndicatorMemory,
  watch: TurnWatch,
): boolean {
  if (!isSignalOmitted(side, now, memory)) return false;
  const isOnDuringWatch = side !== null && memory[side] >= watch.since;
  return !isOnDuringWatch;
}

/** What violation_booked records with a missed 合図: each indicator's last on, and the turn's watch. */
export type SignalRecord = {
  /** Game ms since the left / right indicator was last on (null: never). */
  leftAgoMs: number | null;
  rightAgoMs: number | null;
  /** The car's distance from the junction's node (m), and game ms since its watch began. */
  fromNodeM: number | null;
  watchedMs: number | null;
};

/** The SignalRecord at `now` (the watch: the turn being judged; none for a lane change). */
export function signalRecord(
  memory: IndicatorMemory,
  now: number,
  watch: TurnWatch | null = null,
  pos: Vector3 | null = null,
): SignalRecord {
  const ago = (t: number) => (Number.isFinite(t) ? Math.round(now - t) : null);
  const hasWatch = watch !== null && pos !== null;
  return {
    leftAgoMs: ago(memory.left),
    rightAgoMs: ago(memory.right),
    fromNodeM: hasWatch ? Math.round(Math.hypot(pos.x - watch.node.x, pos.z - watch.node.z) * 10) / 10 : null,
    watchedMs: watch ? Math.round(now - watch.since) : null,
  };
}

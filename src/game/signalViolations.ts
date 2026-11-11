import { Vector3 } from "three";
import { log } from "../log";
import {
  MOVEMENTS,
  crossingVerdict,
  isBooked,
  letsDriverGo,
  type Movement,
  type Permission,
} from "../signals/plan";
import {
  RedLightJudge,
  type CrossingOutcome,
  type CrossingPermissions,
  type SignalCrossing,
} from "../signals/redLight";
import type { Approach, TrafficControl } from "../world/trafficControl";

/**
 * Seconds after an arrow goes out during which crossing under it is still not booked. The plans go
 * from 赤＋矢印 straight to 全赤 (no yellow in between, plan.ts), so a car already committed to the
 * line when the arrow goes out gets the grace a yellow would give. 3 s: the yellow the game uses.
 */
export const ARROW_GRACE_S = 3;

type Signals = Pick<TrafficControl, "permits" | "permitsBefore">;

/**
 * What each movement may do at `ap` when the car crosses (施行令第2条 via TrafficControl.permits): `go`
 * also where the movement was `go` just before (ARROW_GRACE_S) and is `stop` now — an arrow that has
 * only just gone out. Why only `go` before: after a yellow (stopIfAble) the red is booked as ever.
 */
export function signalCrossing(control: Signals, ap: Approach, hasStopped = false): SignalCrossing {
  const permissionOf = (m: Movement): Permission => {
    const now = control.permits(ap, m);
    const wasGo = letsDriverGo(control.permitsBefore(ap, m, ARROW_GRACE_S));
    const isJustOut = crossingVerdict(now) === "booked" && wasGo;
    return isJustOut ? "go" : now;
  };
  return {
    approachId: ap.id,
    permissions: Object.fromEntries(MOVEMENTS.map((m) => [m, permissionOf(m)])) as CrossingPermissions,
    line: ap.a.clone().add(ap.b).multiplyScalar(0.5),
    tIn: ap.travel,
    node: ap.node,
    exitM: ap.exitM,
    hasStopped,
  };
}

/** Which 信号無視 a booking is: 赤色等 (赤・黄), or 点滅 (赤の点滅 without the 一時停止, T4). */
export type SignalViolationKind = "signal" | "signalFlashing";

/**
 * 信号無視 for the player's car, from the stop lines it crosses: the glue between TrafficControl and
 * RedLightJudge (src/signals/redLight.ts), with its logging. `book` is called once per violation.
 */
export class SignalViolationCheck {
  private readonly judge = new RedLightJudge();
  private readonly travel = new Vector3();

  constructor(
    private readonly control: Signals,
    private readonly book: (now: number, kind: SignalViolationKind) => void,
  ) {}

  /** Whether a crossing under an arrow is waiting for the arm the car leaves by. */
  get isHolding(): boolean {
    return this.judge.isHolding;
  }

  /**
   * One law-check step: the car moved from `prev` to `cur` (facing `forward`), crossing the stop
   * lines `crossed` (TrafficControl.crossed, every kind; only signals are looked at here).
   * `hasStoppedAt(ap)`: whether the car stood still just short of that line (the 一時停止 that
   * 赤色の灯火の点滅 asks; the same test as the stop sign's in main.ts).
   */
  step(
    crossed: readonly Approach[],
    prev: Vector3,
    cur: Vector3,
    forward: Vector3,
    now: number,
    hasStoppedAt: (ap: Approach) => boolean = () => false,
  ): void {
    // The way the car is moving (not facing: it may be reversing), or its nose when it stands.
    const moved = this.travel.copy(cur).sub(prev).setY(0);
    const isMoving = moved.lengthSq() > 0.05 * 0.05;
    const travel = isMoving ? moved.normalize() : moved.copy(forward).setY(0).normalize();
    for (const ap of crossed) {
      if (ap.kind !== "signal") continue;
      this.settle(this.judge.crossed(signalCrossing(this.control, ap, hasStoppedAt(ap)), now, travel), now);
    }
    this.settle(this.judge.update(cur, travel, now), now);
  }

  /** The car stopped being driven, or jumped: any hold is dropped unbooked. */
  reset(now: number): void {
    if (this.judge.isHolding) this.settle(this.judge.reset(now), now);
  }

  private settle(outcomes: CrossingOutcome[], now: number): void {
    for (const o of outcomes) {
      const approachId = o.crossing.approachId;
      if (o.kind === "held") {
        const allowed = MOVEMENTS.filter(
          (m) => !isBooked(crossingVerdict(o.crossing.permissions[m], o.crossing.hasStopped)),
        );
        log("signal_crossing_held", { approachId, allowed });
        continue;
      }
      if (o.kind === "violation") this.book(now, o.flashing ? "signalFlashing" : "signal");
      const isImmediate = o.kind === "violation" && o.movement === null;
      if (isImmediate) continue; // 赤 with no arrow: booked at the line as ever (violation_booked says so)
      log("signal_crossing_resolved", {
        approachId,
        outcome: o.kind,
        movement: o.kind === "dropped" ? null : o.movement,
        reason: o.kind === "dropped" ? o.reason : undefined,
        heldMs: Math.round(o.heldMs),
      });
    }
  }
}

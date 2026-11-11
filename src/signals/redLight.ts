import { movementOf } from "./movement";
import { MOVEMENTS, crossingVerdict, type Movement, type Permission } from "./plan";

/** A horizontal point or direction (x east, z south). */
type Flat = { x: number; z: number };

/** What each movement was allowed when the car crossed the stop line (permits, 施行令第2条). */
export type CrossingPermissions = Record<Movement, Permission>;

/** A stop-line crossing of a signal approach, as the violation check sees it. */
export type SignalCrossing = {
  approachId: number;
  permissions: CrossingPermissions;
  /** Middle of the stop line, and the unit way in across it. */
  line: Flat;
  tIn: Flat;
  /** The junction node the approach arrives at. */
  node: Flat;
  /** How far from `node` the car has left the junction (its box plus a margin), metres. */
  exitM: number;
};

/** How a crossing came out. `held` says whether it waited for the exit arm. */
export type CrossingOutcome =
  | { kind: "held"; crossing: SignalCrossing }
  | { kind: "violation"; crossing: SignalCrossing; movement: Movement | null; heldMs: number }
  | { kind: "permitted" | "unconfirmed"; crossing: SignalCrossing; movement: Movement; heldMs: number }
  | {
      kind: "dropped";
      crossing: SignalCrossing;
      reason: "backedOut" | "reset";
      heldMs: number;
    };

/** Behind the stop line by more than this (metres), a held car has backed out of the junction. */
const BACKED_OUT_M = 1;
/** Right of the stop line's middle by more than this (metres), a car is on the oncoming side. */
const OPPOSITE_SIDE_M = 1;

/**
 * 信号無視 judged with arrows (design 5.4). At the stop line:
 * - every movement at `stop` (赤, no arrow): a violation there and then, as before arrows;
 * - no movement at `stop` (青, 黄): nothing — 黄 is not booked, as before (the driver may have been
 *   too close to stop safely, which 第2条 allows and the game cannot tell);
 * - some movements allowed and others not (an arrow over 赤): **held**, and judged by the arm the
 *   car leaves the junction by — a violation only if that movement was at `stop` when it crossed.
 * A held car that stops inside the junction stays held (the crossing, not the leaving, is what
 * 第2条 forbids, so the light it crossed on decides however long it waits). One that backs out
 * behind the stop line is dropped without a booking: its movement is unknown and the safe side is
 * not to book. Leaving the car (or a jump) drops the hold the same way. A new stop line crossed
 * while still held settles the old hold first, by the way the car is moving then: it has left that
 * junction, whatever the distance said.
 */
export class RedLightJudge {
  private held: { crossing: SignalCrossing; since: number } | null = null;

  /** Whether a crossing is waiting for its exit arm. */
  get isHolding(): boolean {
    return this.held !== null;
  }

  /** The car crossed `crossing`'s stop line into the junction at `now` (ms), moving along `travel`. */
  crossed(crossing: SignalCrossing, now: number, travel: Flat = crossing.tIn): CrossingOutcome[] {
    const out = this.settle(travel, now);
    const allowed = MOVEMENTS.filter((m) => crossingVerdict(crossing.permissions[m]) !== "booked");
    const isRedEveryWay = allowed.length === 0;
    if (isRedEveryWay) return [...out, { kind: "violation", crossing, movement: null, heldMs: 0 }];
    const isOpenEveryWay = allowed.length === MOVEMENTS.length;
    if (isOpenEveryWay) return out;
    this.held = { crossing, since: now };
    return [...out, { kind: "held", crossing }];
  }

  /**
   * Each frame while driving: the car at `pos`, moving along `travel` (unit). Resolves the hold once
   * the car is `exitM` from the node, by the movement `travel` makes from the way in.
   */
  update(pos: Flat, travel: Flat, now: number): CrossingOutcome[] {
    const held = this.held;
    if (!held) return [];
    const c = held.crossing;
    const behind = (pos.x - c.line.x) * c.tIn.x + (pos.z - c.line.z) * c.tIn.z;
    // To the left of the way in (leftOf(tIn) = (tIn.z, −tIn.x)): the approach's own lanes. A 転回
    // comes back past the line on the other side and is judged at exitM like any movement.
    const leftward = (pos.x - c.line.x) * c.tIn.z - (pos.z - c.line.z) * c.tIn.x;
    const isOnApproachSide = leftward > -OPPOSITE_SIDE_M;
    const isBackedOut = behind < -BACKED_OUT_M && isOnApproachSide;
    if (isBackedOut) return this.drop("backedOut", now);
    const fromNode = Math.hypot(pos.x - c.node.x, pos.z - c.node.z);
    const hasLeft = fromNode > c.exitM;
    if (!hasLeft) return [];
    return this.settle(travel, now);
  }

  /** The car stopped being driven (on foot, warped, the game reset): drop any hold unbooked. */
  reset(now: number): CrossingOutcome[] {
    return this.drop("reset", now);
  }

  /** Decide the hold (if any) by the movement `travel` makes from its way in. */
  private settle(travel: Flat, now: number): CrossingOutcome[] {
    const held = this.held;
    if (!held) return [];
    this.held = null;
    const c = held.crossing;
    const movement = movementOf(c.tIn, travel);
    const verdict = crossingVerdict(c.permissions[movement]);
    const heldMs = now - held.since;
    if (verdict === "booked") return [{ kind: "violation", crossing: c, movement, heldMs }];
    const kind = verdict === "unconfirmed" ? "unconfirmed" : "permitted";
    return [{ kind, crossing: c, movement, heldMs }];
  }

  private drop(reason: "backedOut" | "reset", now: number): CrossingOutcome[] {
    const held = this.held;
    if (!held) return [];
    this.held = null;
    return [{ kind: "dropped", crossing: held.crossing, reason, heldMs: now - held.since }];
  }
}

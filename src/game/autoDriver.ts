import { Vector3 } from "three";
import { steerLimit, WHEELBASE, type DriveInput } from "../physics/vehicle";
import type { LaneUse, TurnRule } from "../world/regulations";
import { laneOffset, leftOf, speedLimit, type RoadGraph, type Segment } from "../world/roads";
import type { GameClock } from "../world/ruleTime";
import type { TrafficControl } from "../world/trafficControl";
import { laneCentre } from "./drivePath";
import { axisAt, laneAt, planRoute, progressOn, type Route } from "./navigation";

export { laneCentre } from "./drivePath";

/**
 * Self-driving that keeps every rule (the robotaxi and the player's 自動運転モード): it drives the
 * legal route (one-way streets, 通行禁止 and 指定方向外進行禁止 in force), keeps left in its lane
 * at or under the limit, slows for turns, stops at the stop line for red and for yellow when it
 * can (施行令 第2条), stops fully at 一時停止 (第43条), and waits for cars and people ahead.
 * Like a driver it only works the wheel and the pedals (DriveInput) of a car that the physics
 * moves: steering by pure pursuit of a point ahead on the route's driven path (in the lane and
 * round each corner as 第34条 has it, the curve the navigation shows), speed by feed-forward plus a
 * proportional term.
 */
export type DriveWorld = {
  graph: RoadGraph;
  control: TrafficControl;
  turnRules: TurnRule[];
  clock: GameClock;
  /** Things to keep clear of: traffic cars, parked cars, pedestrians in the road. */
  obstacles: Vector3[];
  /** PLATEAU paving: a lane that would put the car on it is not a lane (GSI 幅員 incl. 歩道). */
  isPavement?: (x: number, z: number) => boolean;
  /** 進行方向別通行区分 at junction approaches (第35条第1項). */
  laneUse?: readonly LaneUse[];
  /**
   * 緊急自動車 in an emergency (赤色の警光灯・サイレン): may go on at a red signal after slowing
   * to make sure it is safe (第39条第2項), so it creeps through instead of waiting.
   */
  isEmergency?: boolean;
};

const ACCEL = 1.8; // m/s², gentle for passengers
const BRAKE = 4.5;
const TURN_SPEED = 4.2; // m/s (15 km/h) through left/right turns
const STOP_GAP = 3.2; // front bumper this far before a stop line / obstacle
const OFF_ROUTE = 14; // m from the route (bumped, spun): plan again from where the car is
// Throttle that balances the chassis' linear damping at a speed (0.12·m·v / engine force).
const DRAG_THROTTLE = 0.029;
const HOLD: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false, brakeOnly: true };

/** Where the car actually is: chassis position, heading (atan2(x, z)) and forward speed (m/s). */
export type CarPose = { position: Vector3; yaw: number; speed: number };

const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
const SIGNAL_BEFORE = 30; // 右左折の合図は 30 m 手前から (施行令 第21条)
const LATERAL_ACCEL = 2.5; // m/s² round the bends of a street

const KERB_CLEARANCE = 1.4; // car centre from the kerb: half the width plus a margin

/**
 * Distance left of `p` to the kerb: where PLATEAU paving starts, scanning out from the centreline
 * in 25 cm steps (GSI 幅員 includes the pavements, so the road width alone puts cars on them).
 * Infinity without paving data or paving within `max`.
 */
export function kerbLeft(
  p: Vector3,
  dir: Vector3,
  max: number,
  isPavement: ((x: number, z: number) => boolean) | undefined,
): number {
  if (!isPavement) return Infinity;
  for (let d = 0.5; d <= max; d += 0.25) {
    if (isPavement(p.x + dir.z * d, p.z - dir.x * d)) return d;
  }
  return Infinity;
}

/** Lateral offset (left of the centreline) to drive at, kept clear of the kerb. */
export function keepLeftOffset(
  seg: Segment,
  lane: number,
  p: Vector3,
  dir: Vector3,
  isPavement?: (x: number, z: number) => boolean,
  lanes = seg.lanes,
  // Without 車両通行帯 the rule is 左側寄り (第18条第1項), one-way or not.
  wanted = lanes > 1 ? laneCentre(seg, lane, lanes) : laneOffset(seg),
): number {
  const kerb = kerbLeft(p, dir, seg.line.width / 2 + 1, isPavement);
  const isTwoWay = seg.oneway === 0;
  // Two-way: stay left of the centreline even on a narrow carriageway.
  return Math.min(wanted, Math.max(isTwoWay ? 1 : -Infinity, kerb - KERB_CLEARANCE));
}

export class AutoDriver {
  route: Route | null = null;
  speed = 0;
  /** Last known pose of the car (radians, atan2(x, z)). */
  readonly position = new Vector3();
  yaw = 0;
  /** Whether it is braking (for the brake lamps). */
  braking = false;
  /** 合図: the indicator to show (lane changes and turns). */
  signal: "left" | "right" | null = null;
  /** Current lane (0 = leftmost) and lateral offset from the centreline (left = +). */
  lane = 0;
  private lateral: number | null = null;
  private creep = false;
  private at = 0;
  private hint = 0;
  private served = -1; // 一時停止 approach already stopped at
  private waited = 0;
  private readonly target = new Vector3();
  private graph: RoadGraph | null = null;

  get remaining(): number {
    return this.route ? this.route.length - this.at : 0;
  }

  heading(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Where the car is before the first update (for planning from there). */
  place(pos: Vector3, yaw: number): void {
    this.position.copy(pos);
    this.yaw = yaw;
  }

  /** Plan a route to `target` from where the car is (or from a given street position). */
  plan(world: DriveWorld, target: Vector3, from?: { seg: Segment; s: number; dir: 1 | -1 }): boolean {
    this.graph = world.graph;
    this.target.copy(target);
    let start = from;
    if (!start) {
      const hit = world.graph.nearest(this.position, 25, isDrivable);
      if (!hit) return false;
      start = { seg: hit.seg, s: hit.s, dir: hit.dir.dot(this.heading()) >= 0 ? 1 : -1 };
    }
    const route = planRoute(world.graph, start, target, world.clock, world.turnRules, "car", world.laneUse);
    if (!route) return false;
    this.route = route;
    this.at = 0;
    this.hint = 0;
    this.served = -1;
    this.lateral = null;
    return true;
  }

  /** Re-anchoring: shift the pose and the route rigidly. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    offset(this.position);
    this.yaw += yawDelta;
    offset(this.target);
    if (this.route) for (const p of this.route.points) offset(p);
  }

  /**
   * One look at the road: from where the car is, the wheel and pedals to drive on, the distance
   * moved since the last look, and whether the route is done (stopped at its end).
   */
  update(dt: number, world: DriveWorld, car: CarPose): { input: DriveInput; moved: number; done: boolean } {
    const moved = Math.hypot(car.position.x - this.position.x, car.position.z - this.position.z);
    this.position.copy(car.position);
    this.yaw = car.yaw;
    this.speed = car.speed;
    // A new road graph (area change, re-anchoring): plan again from where the car is.
    if (world.graph !== this.graph && this.route) this.plan(world, this.target);
    let route = this.route;
    if (!route) return { input: HOLD, moved, done: false };
    let p = progressOn(route, this.position, this.hint);
    if (p.off > OFF_ROUTE && this.plan(world, this.target) && this.route) {
      route = this.route;
      p = progressOn(route, this.position, 0);
    }
    this.hint = p.index;
    this.at = p.at;
    const remaining = route.length - this.at;
    const isAtEnd = remaining < 1;
    let want = isAtEnd ? 0 : this.cruise(route);
    // Ease to a stop at the kerb at the end of the route.
    want = Math.min(want, Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, remaining - 0.5)));
    const block = this.blockAhead(route, world, dt);
    if (block < Infinity) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, block - STOP_GAP)));
    // Through a red as an emergency vehicle: slowly enough to stop for anyone crossing.
    if (this.creep) want = Math.min(want, 15 / 3.6);
    this.creep = false;
    const steer = this.steerFor(route, dt, world);
    const input = this.pedals(want, steer);
    this.braking = input.brake > 0.05 || Math.abs(this.speed) < 0.1;
    // The road map only covers ~1 km round the car: at its edge, wait for the next one.
    return { input, moved, done: isAtEnd && Math.abs(this.speed) < 0.3 && route.reachesTarget };
  }

  /** Accelerator or brake toward the wanted speed; at a standstill, hold the brake. */
  private pedals(want: number, steer: number): DriveInput {
    const v = this.speed;
    if (want < 0.15 && v < 0.8) return { ...HOLD, steer };
    const err = want - v;
    if (err > -0.5) {
      // Capped at a gentle ACCEL (m·a / engine force on top of the drag).
      const cap = DRAG_THROTTLE * v + (ACCEL * 1250) / 5200;
      const throttle = Math.min(cap, Math.max(0, DRAG_THROTTLE * want + 0.28 * err));
      return { throttle, brake: 0, steer, handbrake: false, brakeOnly: true };
    }
    const brake = Math.min(1, Math.max(0.05, -err * 0.3));
    return { throttle: 0, brake, steer, handbrake: false, brakeOnly: true };
  }

  /** Speed to aim for on this stretch: the limit, less for the next turn. */
  private cruise(route: Route): number {
    const k = this.stepIndex(route);
    const seg = route.steps[k].seg;
    let v = Math.max(5, speedLimit(seg) / 3.6 - 1.5);
    // At turn speed (徐行, 第34条) where each turn's curve starts, and through it; along a bend of
    // the street no faster than its radius allows.
    for (const c of route.corners) {
      if (c.to <= this.at) continue;
      if (c.from - this.at > 150) break;
      const isTurn = c.kind === "left" || c.kind === "right" || c.kind === "uturn";
      const vCorner = isTurn ? TURN_SPEED : Math.max(TURN_SPEED, Math.sqrt(LATERAL_ACCEL * c.radius));
      v = Math.min(v, Math.sqrt(vCorner * vCorner + 2 * 2.5 * Math.max(0, c.from - this.at)));
    }
    // Turns without a curve of their own (a corner too cramped to round).
    const next = route.maneuvers.find((m) => m.at > this.at - 2);
    const isRounded = next !== undefined && route.corners.some((c) => c.from <= next.at && next.at <= c.to);
    if (next && !isRounded) {
      const d = Math.max(0, next.at - this.at - 6);
      const vTurn = next.turn === "slightLeft" || next.turn === "slightRight" ? 7 : TURN_SPEED;
      v = Math.min(v, Math.sqrt(vTurn * vTurn + 2 * 2.5 * d));
    }
    return v;
  }

  /** Distance to the nearest reason to stop ahead: a stop line, a car, a person. */
  private blockAhead(route: Route, world: DriveWorld, dt: number): number {
    let block = Infinity;
    const k = this.stepIndex(route);
    const st = route.steps[k];
    const travel = route.stepEntry[k] + (this.at - route.stepStart[k]);
    const next = world.control.nextStop(st.seg, st.dir, travel);
    if (next) {
      const { approach, dist } = next;
      if (approach.kind === "signal") {
        const state = world.control.state(approach);
        const canStop = dist > (this.speed * this.speed) / (2 * BRAKE);
        const mustStop = state === "red" || (state === "yellow" && canStop);
        if (mustStop && world.isEmergency) this.creep = true;
        else if (mustStop) block = dist;
      } else if (this.served !== approach.id) {
        const isStanding = dist < STOP_GAP + 0.6 && this.speed < 0.1;
        this.waited = isStanding ? this.waited + dt : 0;
        if (this.waited > 1.5) {
          this.served = approach.id;
          this.waited = 0;
        } else block = dist;
      }
    }
    const dir = this.heading();
    for (const o of world.obstacles) {
      const dx = o.x - this.position.x;
      const dz = o.z - this.position.z;
      const ahead = dx * dir.x + dz * dir.z;
      const lateral = Math.abs(dx * dir.z - dz * dir.x);
      if (ahead > 0.5 && ahead < 40 && lateral < 1.7) block = Math.min(block, ahead - 2.4);
    }
    return block;
  }

  private stepIndex(route: Route): number {
    let i = Math.max(1, this.hint);
    while (i < route.cum.length - 1 && route.cum[i] < this.at) i++;
    return route.stepOf[Math.min(i, route.stepOf.length - 1)] ?? 0;
  }

  /**
   * The wheel: the lane the route plans (eased across over a few seconds; one off PLATEAU paving,
   * clear of the kerb, never across a yellow line), 合図, then pure pursuit — steer along the arc
   * through a point a speed-dependent distance ahead on the path, shifted by how far the car's lane
   * differs from the planned one. Through a corner it follows the curve itself.
   */
  private steerFor(route: Route, dt: number, world: DriveWorld): number {
    const k = this.stepIndex(route);
    const seg = route.steps[k].seg;
    const plan = laneAt(route, this.at, this.hint);
    // The street's own centreline, for the paving and kerb checks (the path is in the lane).
    const { pos: centre, dir } = axisAt(route, this.at);
    if (dir.lengthSq() < 1e-6) dir.copy(this.heading());
    const lanes = plan.count;
    let lane = seg.noLaneChange ? Math.min(this.lane, lanes - 1) : plan.lane;
    const onPavement = (i: number) => {
      const p = centre.clone().add(leftOf(dir, laneCentre(seg, i, lanes)));
      return world.isPavement?.(p.x, p.z) ?? false;
    };
    while (lane < lanes - 1 && onPavement(lane)) lane++;
    this.lane = lane;
    const wanted = lane === plan.lane ? plan.offset : laneCentre(seg, lane, lanes);
    const target = plan.corner
      ? plan.offset
      : keepLeftOffset(seg, lane, centre, dir, world.isPavement, lanes, wanted);
    this.lateral ??= target;
    // Fast enough to keep up with the plan's own easing (1 m per 10 m travelled); on a curve the
    // planned offset is only interpolated between two streets, so the car simply follows the curve.
    const rate = Math.max(0.8, Math.abs(this.speed) * 0.12) * dt;
    const gap = plan.corner ? 0 : target - this.lateral;
    this.lateral = plan.corner ? target : this.lateral + Math.max(-rate, Math.min(rate, gap));
    // 合図: through a turn's curve, while moving across lanes, and from 30 m before a turn.
    const next = route.maneuvers.find((m) => m.at > this.at);
    const isTurning = next && next.at - this.at < SIGNAL_BEFORE && next.turn !== "straight";
    const corner = route.corners.find((c) => c.from <= this.at && this.at < c.to);
    const cornerSide =
      corner?.kind === "left"
        ? "left"
        : corner?.kind === "right" || corner?.kind === "uturn"
          ? "right"
          : null;
    this.signal =
      cornerSide ??
      (Math.abs(gap) > 0.3
        ? gap > 0
          ? "left"
          : "right"
        : isTurning
          ? next.turn === "left" || next.turn === "slightLeft"
            ? "left"
            : "right"
          : null);
    // Pure pursuit: curvature 2·y / d² to the look-ahead point (y = its offset to the left).
    const lookahead = Math.min(18, Math.max(5, 4.5 + 0.55 * Math.abs(this.speed)));
    const along = Math.min(route.length, this.at + lookahead);
    const aim = this.pathAt(route, along);
    const aimDir = this.pathAt(route, Math.min(route.length, along + 2))
      .sub(aim)
      .setY(0);
    if (aimDir.lengthSq() < 1e-6) aimDir.copy(dir);
    aim.add(leftOf(aimDir.normalize(), this.lateral - plan.offset));
    const f = this.heading();
    const dx = aim.x - this.position.x;
    const dz = aim.z - this.position.z;
    const left = dx * f.z - dz * f.x;
    const curvature = (2 * left) / Math.max(1, dx * dx + dz * dz);
    const angle = Math.atan(curvature * WHEELBASE);
    return Math.max(-1, Math.min(1, angle / steerLimit(this.speed)));
  }

  /** Point on the route's driven path at route distance `d`. */
  private pathAt(route: Route, d: number): Vector3 {
    let i = 1;
    while (i < route.cum.length - 1 && route.cum[i] < d) i++;
    const a = route.points[i - 1];
    const b = route.points[i];
    const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
    return a.clone().lerp(b, Math.min(1, Math.max(0, t)));
  }
}

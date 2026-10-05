import { Vector3 } from "three";
import { steerLimit, WHEELBASE, type DriveInput } from "../physics/vehicle";
import type { LaneUse, TurnRule } from "../world/regulations";
import { laneOffset, leftOf, speedLimit, type RoadGraph, type Segment } from "../world/roads";
import { inForce, type GameClock } from "../world/ruleTime";
import type { TrafficControl } from "../world/trafficControl";
import {
  backOffPath,
  HALF_LENGTH,
  HALF_WIDTH,
  isPushing,
  ManoeuvrePlanner,
  ManoeuvreRunner,
  manoeuvrePedals,
  StuckWatch,
  type ManoeuvreArea,
  type PathPose,
  type Pose,
} from "./autoRecovery";
import {
  crossingsAhead,
  followSpeed,
  IN_LANE,
  judgeAhead,
  junctionsAhead,
  OWN_HALF,
  PASS_GAP,
  passPlan,
  placeOnRoute,
  QUEUE_GAP,
  type CrossingRef,
  type DriveObstacle,
  type JunctionAhead,
  type Seen,
  type Verdict,
} from "./autoTraffic";
import { laneCentre } from "./drivePath";
import { axisAt, laneAt, planRoute, progressOn, type Route } from "./navigation";

export { laneCentre } from "./drivePath";
export type { DriveObstacle } from "./autoTraffic";

/**
 * Self-driving that keeps every rule (the robotaxi and the player's 自動運転モード): it drives the
 * legal route (one-way streets, 通行禁止 and 指定方向外進行禁止 in force), keeps left in its lane
 * at or under the limit, slows for turns, stops at the stop line for red and for yellow when it
 * can (施行令 第2条), stops fully at 一時停止 (第43条), and waits for people ahead.
 * Like a driver it only works the wheel and the pedals (DriveInput) of a car that the physics
 * moves: steering by pure pursuit of a point ahead on the route's driven path (in the lane and
 * round each corner as 第34条 has it, the curve the navigation shows), speed by feed-forward plus a
 * proportional term.
 *
 * Round other traffic (autoTraffic.ts): it keeps the 車間距離 of 第26条, waits in a queue, passes a
 * parked or stalled car where 第17条第5項・第30条 allow, yields at junctions (第36条・第37条・
 * 第43条) and does not enter a junction or crosswalk it could not leave (第50条). Off its lane
 * (autoRecovery.ts) — on a pavement, facing the wrong way, nose to a wall, at a dead end — it works
 * out a manoeuvre with reversing and 切り返し; stuck, it backs off and tries again, and after a few
 * failed goes it gives up (`gaveUp`) for the caller to hand the car back.
 */
export type DriveWorld = {
  graph: RoadGraph;
  control: TrafficControl;
  turnRules: TurnRule[];
  clock: GameClock;
  /** People in the road (and anything else to wait for): never passed. */
  obstacles: Vector3[];
  /** Vehicles about (traffic, parked cars, the player's car), to follow, queue behind or pass. */
  vehicles?: DriveObstacle[];
  /** PLATEAU paving: a lane that would put the car on it is not a lane (GSI 幅員 incl. 歩道). */
  isPavement?: (x: number, z: number) => boolean;
  /** 進行方向別通行区分 at junction approaches (第35条第1項). */
  laneUse?: readonly LaneUse[];
  /** 横断歩道 (第30条第3号・第50条第2項). */
  crossings?: readonly CrossingRef[];
  /**
   * Whether the car's body at a pose (chassis centre x, z and heading) is clear of buildings, poles
   * and the other fixed colliders (autoRecovery.ts rapierClearance). Without it manoeuvres only
   * avoid the vehicles and people listed here.
   */
  isClear?: (x: number, z: number, yaw: number) => boolean;
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
const DEG = Math.PI / 180;
/** Off its lane: further than this from the path, or turned further than MISALIGNED from it. */
const OFF_LANE = 4.5;
const MISALIGNED = 50 * DEG;
/** Stuck this many times without getting 25 m on: give up. */
const MAX_ATTEMPTS = 3;
const ATTEMPT_PROGRESS = 25;
/** Waiting behind a blockage it may not pass (or something it cannot judge) this long: give up. */
const BLOCKED_GIVE_UP = 30;
const UNSURE_GIVE_UP = 60;
/** A 転回 at the start costs this much route (m) when choosing which way to go. */
const TURN_ROUND_COST = 60;
const SIGNAL_LEAD = 3; // s of 合図 before moving across (施行令 第21条: 3 秒前)
const PASS_TOP = 20 / 3.6; // m/s beside a parked car
const SLOW = 10 / 3.6; // 徐行 into a junction where the other road has priority (第36条第3項)
const YIELD_TIME = 4.5; // s: a vehicle this close in time to the junction has to be let by
const SIGHT = 60; // m: how far off a stopped vehicle is watched (to tell it has stalled)
const PLAN_MS = 4; // ms of manoeuvre search per look
/** A pass is weighed only this close behind the blockage (m, bumper to bumper). */
const PASS_DECIDE = 25;
/** Room (m) a gentle swing out by pure pursuit needs; closer, the pull-out is a manoeuvre. */
const SWING_OUT = 14;

/** Where the car actually is: chassis position, heading (atan2(x, z)) and forward speed (m/s). */
export type CarPose = { position: Vector3; yaw: number; speed: number };

const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
const SIGNAL_BEFORE = 30; // 右左折の合図は 30 m 手前から (施行令 第21条)
const LATERAL_ACCEL = 2.5; // m/s² round the bends of a street

const KERB_CLEARANCE = 1.4; // car centre from the kerb: half the width plus a margin
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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

/** 転回禁止 (JARTIC 51) in force on a street (第25条の2第2項). */
export function isUturnBanned(seg: Segment, clock: GameClock): boolean {
  return seg.rules.some((r) => r.code === 51 && inForce(r.time, clock));
}

/**
 * Why the car is manoeuvring: off its lane, a dead end to turn in, stuck, turning back, or pulling
 * out round a blockage from close behind it.
 */
type Why = "align" | "uturn" | "stuck" | "reroute" | "pass";
type Mode =
  | { kind: "drive" }
  | { kind: "plan"; planner: ManoeuvrePlanner; why: Why }
  | { kind: "run"; runner: ManoeuvreRunner; why: Why; side: "left" | "right" | null; signalled: number };

/** Passing a blockage: 合図 (3 s), out beside it, back into the lane. */
type Pass = {
  phase: "signal" | "out" | "back";
  shift: number;
  endAt: number;
  t: number;
  chain: Set<DriveObstacle>;
  /** When the 合図 to go back in started (s into the pass), once the front is past the line. */
  backSignal: number | null;
  /** Seconds standing still while pulling out (came up short: pull out by manoeuvre instead). */
  standing: number;
};

export type DriveResult = {
  input: DriveInput;
  moved: number;
  done: boolean;
  /** Stuck after every go, or blocked where it may not pass: the caller takes the car back. */
  gaveUp: "stuck" | "blocked" | null;
};

export class AutoDriver {
  route: Route | null = null;
  speed = 0;
  /** Last known pose of the car (radians, atan2(x, z)). */
  readonly position = new Vector3();
  yaw = 0;
  /** Whether it is braking (for the brake lamps). */
  braking = false;
  /** In reverse (後退灯, 施行令 第21条). */
  reversing = false;
  /** 合図: the indicator to show (lane changes and turns). */
  signal: "left" | "right" | null = null;
  /** Current lane (0 = leftmost) and lateral offset from the centreline (left = +). */
  lane = 0;
  /** Why it stopped for good (see DriveResult). */
  gaveUp: "stuck" | "blocked" | null = null;
  private lateral: number | null = null;
  private creep = false;
  private at = 0;
  private hint = 0;
  private served = -1; // 一時停止 approach already stopped at
  private waited = 0;
  private readonly target = new Vector3();
  private graph: RoadGraph | null = null;
  private mode: Mode = { kind: "drive" };
  private readonly watch = new StuckWatch();
  private attempts = 0;
  private readonly attemptFrom = new Vector3();
  private lastSteer = 0;
  private readonly stood = new Map<object, number>();
  private pass: Pass | null = null;
  private passShift = 0;
  private blockedFor = 0;
  private unsureFor = 0;
  private rerouted = false;
  /** Seconds of the right 合図 still to show before moving off from a standstill (施行令 第21条). */
  private moveOff = 0;
  /** The 発進 合図 was given at this standstill: not again before the car has moved. */
  private hasSignalledOff = false;
  /** Bumper gap to the vehicle in front (m), from the last look. */
  private frontGap = Infinity;

  get remaining(): number {
    return this.route ? this.route.length - this.at : 0;
  }

  /** What it is doing, for the HUD and the logs. */
  get activity(): "drive" | "manoeuvre" | "pass" | "gaveUp" {
    if (this.gaveUp) return "gaveUp";
    if (this.mode.kind !== "drive") return "manoeuvre";
    return this.pass ? "pass" : "drive";
  }

  heading(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Where the car is before the first update (for planning from there). */
  place(pos: Vector3, yaw: number): void {
    this.position.copy(pos);
    this.yaw = yaw;
  }

  /**
   * Plan a route to `target` from where the car is (or from a given street position). From the
   * nearest street, only its legal way on a one-way street; on a two-way street the way the car
   * faces unless the other way is much shorter (turning round costs TURN_ROUND_COST), and never a
   * turn round where 転回禁止 is in force (第25条の2第2項).
   */
  plan(world: DriveWorld, target: Vector3, from?: { seg: Segment; s: number; dir: 1 | -1 }): boolean {
    this.graph = world.graph;
    this.target.copy(target);
    const route = from ? this.routeFrom(world, target, from) : this.bestStart(world, target);
    if (!route) return false;
    const isSameStart =
      this.route?.steps[0].seg === route.steps[0].seg && this.route?.steps[0].dir === route.steps[0].dir;
    // A manoeuvre under way aims at the old route's lane: keep it when the new route starts alike.
    if (!isSameStart) this.mode = { kind: "drive" };
    // A new route is a fresh start (a patrol re-planning its chase tries again).
    this.gaveUp = null;
    this.attempts = 0;
    this.rerouted = false;
    // Standing (at the kerb, a taxi with its passenger in): 発進 is moving out to the right. A
    // re-plan while the 合図 runs keeps its count, and once given it is not given again at the same
    // standstill: a patrol re-plans its chase every 2 s, which restarted the 3 s count for good.
    const isStanding = Math.abs(this.speed) < 0.3;
    if (!isStanding) this.moveOff = 0;
    else if (this.moveOff <= 0 && !this.hasSignalledOff) this.moveOff = SIGNAL_LEAD;
    this.route = route;
    this.at = 0;
    this.hint = 0;
    this.served = -1;
    this.lateral = null;
    this.pass = null;
    this.passShift = 0;
    return true;
  }

  /** Start again after giving up (the robotaxi's remote assistance): plan anew from here. */
  retry(world: DriveWorld): boolean {
    this.blockedFor = 0;
    this.unsureFor = 0;
    this.rerouted = false;
    this.mode = { kind: "drive" };
    this.watch.reset();
    return this.plan(world, this.target);
  }

  private routeFrom(world: DriveWorld, target: Vector3, start: { seg: Segment; s: number; dir: 1 | -1 }) {
    return planRoute(world.graph, start, target, world.clock, world.turnRules, "car", world.laneUse);
  }

  /**
   * The street to start from. First the old way: the street the car stands on, the way it faces
   * (legal there). Failing that — on a pavement or a plaza, facing the wrong way on a one-way
   * street, on a street that leads nowhere — every open street within 25 m (60 m, 120 m from a
   * plaza), each legal way, scored by the route's length plus how far off the carriageway the car
   * is (×3) plus turning round (TURN_ROUND_COST, never where 転回禁止 is in force); the best few are
   * planned and the cheapest kept. The manoeuvre into the lane follows (offLane).
   */
  private bestStart(world: DriveWorld, target: Vector3): Route | null {
    const graph = world.graph;
    const here = this.position;
    const heading = this.heading();
    const hit = graph.nearest(here, 25, isDrivable);
    if (hit) {
      const facing: 1 | -1 = hit.dir.dot(heading) >= 0 ? 1 : -1;
      const isOnIt = Math.abs(hit.lateral) < hit.seg.line.width / 2 + 0.5;
      const isLegal = hit.seg.oneway === 0 || hit.seg.oneway === facing;
      const isFacing = Math.abs(hit.dir.dot(heading)) > 0.7;
      const route =
        isOnIt && isLegal && isFacing && !hit.seg.closed
          ? this.routeFrom(world, target, { seg: hit.seg, s: hit.s, dir: facing })
          : null;
      if (route) return route;
    }
    for (const radius of [25, 60, 120]) {
      type Start = { seg: Segment; s: number; dir: 1 | -1; extra: number };
      const starts: Start[] = [];
      for (const seg of graph.segments) {
        if (!isDrivable(seg) || seg.closed) continue;
        const q = graph.nearestOn(seg, here);
        if (q.dist > radius) continue;
        const along = graph.sample(seg, q.s).dir.dot(heading);
        const off = Math.max(0, q.dist - seg.line.width / 2);
        const ways: Array<1 | -1> = seg.oneway !== 0 ? [seg.oneway] : [1, -1];
        for (const dir of ways) {
          const isTurnRound = along * dir < -0.3;
          const isBanned = isTurnRound && off === 0 && isUturnBanned(seg, world.clock);
          if (isBanned) continue;
          const turn = ((1 - along * dir) / 2) * TURN_ROUND_COST;
          starts.push({ seg, s: q.s, dir, extra: off * 3 + turn });
        }
      }
      let best: { route: Route; cost: number } | null = null;
      for (const st of starts.toSorted((a, b) => a.extra - b.extra).slice(0, 6)) {
        const route = this.routeFrom(world, target, st);
        if (!route) continue;
        // Dead-end U-turns on the way are manoeuvres too.
        const uturns = route.maneuvers.filter((m) => m.turn === "uturn").length;
        const cost = route.length + st.extra + uturns * 100;
        if (!best || cost < best.cost) best = { route, cost };
      }
      if (best) return best.route;
    }
    return null;
  }

  /** Re-anchoring: shift the pose and the route rigidly. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    offset(this.position);
    this.yaw += yawDelta;
    offset(this.target);
    if (this.route) for (const p of this.route.points) offset(p);
    // A manoeuvre is planned in the old frame: work it out again from where the car is.
    this.mode = { kind: "drive" };
    this.watch.reset();
  }

  /**
   * One look at the road: from where the car is, the wheel and pedals to drive on, the distance
   * moved since the last look, whether the route is done (stopped at its end), and whether it
   * gave up.
   */
  update(dt: number, world: DriveWorld, car: CarPose): DriveResult {
    const moved = Math.hypot(car.position.x - this.position.x, car.position.z - this.position.z);
    this.position.copy(car.position);
    this.yaw = car.yaw;
    this.speed = car.speed;
    this.reversing = false;
    // A new road graph (area change, re-anchoring): plan again from where the car is.
    if (world.graph !== this.graph && this.route) this.plan(world, this.target);
    this.trackStops(world, dt);
    const out = (input: DriveInput, done = false): DriveResult => {
      this.braking = (input.brake > 0.05 && input.brakeOnly !== false) || Math.abs(this.speed) < 0.1;
      this.lastSteer = input.steer;
      return { input, moved, done, gaveUp: this.gaveUp };
    };
    if (this.gaveUp) {
      this.signal = null;
      return out(HOLD);
    }
    let route = this.route;
    if (!route) return out(HOLD);
    let p = progressOn(route, this.position, this.hint);
    if (this.mode.kind !== "drive") {
      this.hint = p.index;
      this.at = p.at;
      return out(this.manoeuvre(dt, world, route));
    }
    if (p.off > OFF_ROUTE && this.plan(world, this.target) && this.route) {
      route = this.route;
      p = progressOn(route, this.position, 0);
    }
    this.hint = p.index;
    this.at = p.at;
    // Off its lane: stop, then work out how to get back into it.
    const why = this.offLane(route, world, p.off);
    if (why) {
      this.pass = null;
      this.passShift = 0;
      if (Math.abs(this.speed) > 0.4) return out({ ...HOLD, steer: 0 });
      this.startPlanning(world, route, why);
      return out(HOLD);
    }
    const remaining = route.length - this.at;
    const isAtEnd = remaining < 1;
    let want = isAtEnd ? 0 : this.cruise(route);
    // Ease to a stop at the kerb at the end of the route.
    want = Math.min(want, Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, remaining - 0.5)));
    const block = this.blockAhead(route, world, dt);
    if (block < Infinity) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, block - STOP_GAP)));
    want = Math.min(want, this.traffic(route, world, dt));
    // Through a red as an emergency vehicle: slowly enough to stop for anyone crossing.
    if (this.creep) want = Math.min(want, 15 / 3.6);
    this.creep = false;
    const steer = this.steerFor(route, dt, world);
    // 発進: from a standstill out into the traffic, 合図 3 s first (進路を右方に変える, 施行令
    // 第21条) — not where it waits at a stop line or in a queue, where it only goes on.
    const isMovingOff = this.moveOff > 0 && want > 0.5 && Math.abs(this.speed) < 0.3;
    if (isMovingOff && block > 15 && this.frontGap > 15) {
      this.moveOff -= dt;
      if (this.moveOff <= 0) this.hasSignalledOff = true;
      this.signal = "right";
      return out({ ...HOLD, steer });
    }
    if (Math.abs(this.speed) > 0.5 || block <= 15 || this.frontGap <= 15) this.moveOff = 0;
    if (Math.abs(this.speed) > 0.5) this.hasSignalledOff = false;
    const input = this.pedals(want, steer);
    if (this.gaveUp) return out(HOLD);
    // Pressing on and not moving (a wall, a kerb, a pole, a car it did not know of): back off.
    if (this.watch.update(dt, this.position, isPushing(input))) {
      this.failAttempt();
      if (!this.gaveUp) this.startBackOff(world, route);
      return out(HOLD);
    }
    if (this.attempts > 0 && this.position.distanceTo(this.attemptFrom) > ATTEMPT_PROGRESS) this.attempts = 0;
    // The road map only covers ~1 km round the car: at its edge, wait for the next one.
    return out(input, isAtEnd && Math.abs(this.speed) < 0.3 && route.reachesTarget);
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

  /** Distance to the nearest reason to stop ahead: a stop line, a person. */
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
        // 第43条: after the full stop, on only when nobody on the crossing road has to be let by.
        const isClearToGo = this.waited > 1.5 && !this.mustYield(route, world, true);
        if (isClearToGo) {
          this.served = approach.id;
          this.waited = 0;
        } else block = dist;
      }
    }
    const dir = this.heading();
    for (const o of world.obstacles) {
      const dx = o.x - this.position.x;
      const dz = o.z - this.position.z;
      const isItself = dx * dx + dz * dz < 1;
      if (isItself) continue;
      const ahead = dx * dir.x + dz * dir.z;
      const lateral = Math.abs(dx * dir.z - dz * dir.x);
      if (ahead > 0.5 && ahead < 40 && lateral < 1.7) block = Math.min(block, ahead - 2.4);
    }
    return block;
  }

  /**
   * Seconds each vehicle in sight (60 m) has stood still, by its key, for telling a stalled car:
   * the driver can only count from when it could see it.
   */
  private trackStops(world: DriveWorld, dt: number): void {
    const present = new Set<object>();
    for (const o of world.vehicles ?? []) {
      const isInSight = o.position.distanceTo(this.position) < SIGHT;
      if (!o.key || !isInSight) continue;
      present.add(o.key);
      const isStill = o.kind === "parked" || Math.abs(o.speed ?? 0) < 0.3;
      this.stood.set(o.key, isStill ? (this.stood.get(o.key) ?? 0) + dt : 0);
    }
    for (const key of this.stood.keys()) if (!present.has(key)) this.stood.delete(key);
  }

  /** The vehicles and people about, placed on the route (60 m back to 220 m ahead). */
  private look(route: Route, world: DriveWorld): Seen[] {
    const seen: Seen[] = [];
    // Far enough ahead for oncoming traffic to be seen through a whole pass (第17条第5項).
    const from = this.at - 60;
    const to = this.at + 220;
    const add = (o: DriveObstacle) => {
      const dx = o.position.x - this.position.x;
      const dz = o.position.z - this.position.z;
      const d2 = dx * dx + dz * dz;
      const isItself = d2 < 1;
      if (isItself || d2 > 240 * 240) return;
      const place = placeOnRoute(route, o.position, from, to, Math.max(1, this.hint - 15));
      if (!place || place.dist > 12) return;
      const h = o.heading;
      const along =
        h === undefined ? 0 : (o.speed ?? 0) * (Math.sin(h) * place.dir.x + Math.cos(h) * place.dir.z);
      const stoppedFor = o.kind === "parked" ? Infinity : o.key ? (this.stood.get(o.key) ?? 0) : 0;
      const half = o.halfLength ?? (o.kind === "person" ? 0.4 : 2.25);
      seen.push({ o, at: place.at, lateral: place.lateral, half, along, stoppedFor });
    };
    for (const o of world.vehicles ?? []) add(o);
    for (const p of world.obstacles) add({ position: p, kind: "person" });
    return seen.toSorted((a, b) => a.at - b.at);
  }

  /**
   * The traffic ahead: the speed it allows (第26条 車間距離 to the car in front, the stops of
   * 第36条・第37条・第50条), and passing a blockage (第17条第5項, see autoTraffic.ts passPlan).
   */
  private traffic(route: Route, world: DriveWorld, dt: number): number {
    const seen = this.look(route, world);
    // Where the car's nose is across the path (it leads in a pass).
    const nose = this.position.clone().addScaledVector(this.heading(), 1.6);
    const own =
      placeOnRoute(route, nose, this.at - 6, this.at + 10, Math.max(1, this.hint - 4))?.lateral ?? 0;
    const vehicles = seen.filter((s) => s.o.kind !== "person");
    // Lined up with the street (not crossing it in a junction).
    const isAligned = (s: Seen) => {
      const h = s.o.heading;
      if (h === undefined) return true;
      const d = axisAt(route, Math.min(route.length, Math.max(0, s.at))).dir;
      return Math.abs(Math.sin(h) * d.x + Math.cos(h) * d.z) > 0.5;
    };
    const inLane = vehicles.filter(
      (s) => s.at > this.at + 0.5 && Math.abs(s.lateral) < IN_LANE && isAligned(s),
    );
    const people = seen
      .filter((s) => s.o.kind === "person" && Math.abs(s.lateral) < IN_LANE)
      .map((s) => s.at);
    const verdict = judgeAhead(inLane, (at) => this.isWaitingPoint(route, world, at), people);
    let cap = Infinity;
    this.frontGap = Infinity;
    // 第26条: behind whatever is in front of the car now (in its lane, or beside the line it passes).
    const band = this.pass ? 1.95 : IN_LANE;
    const front = vehicles.find((s) => s.at > this.at + 0.5 && Math.abs(s.lateral - own) < band);
    if (front) {
      const gap = front.at - front.half - (this.at + OWN_HALF);
      this.frontGap = gap;
      const isPassing = this.pass?.phase !== "signal" && (this.pass?.chain.has(front.o) ?? false);
      const standstill = isPassing ? 1 : verdict.kind === "queue" || front.along > 1 ? QUEUE_GAP : PASS_GAP;
      cap = Math.min(cap, followSpeed(gap - standstill));
    }
    cap = Math.min(cap, this.junctions(route, world, vehicles));
    // Road users on this street (not on one alongside, within the 12 m the look takes in).
    const width = route.steps[this.stepIndex(route)].seg.line.width;
    const onStreet = seen.filter((s) => Math.abs(s.lateral) < width);
    this.passing(route, world, verdict, onStreet, dt);
    if (this.pass && this.pass.phase !== "signal") cap = Math.min(cap, PASS_TOP);
    return cap;
  }

  /** The 合図, the shift out and back, and whether a blockage may be passed at all. */
  private passing(route: Route, world: DriveWorld, verdict: Verdict, others: Seen[], dt: number): void {
    const k = this.stepIndex(route);
    const seg = route.steps[k].seg;
    const plan = laneAt(route, this.at, this.hint);
    const ahead = { from: this.at - 5, to: this.at + 120 };
    const permit = (chain: readonly Seen[]) =>
      passPlan({
        at: this.at,
        speed: this.speed,
        chain,
        others,
        junctions: junctionsAhead(route, world.graph, world.control, ahead.from, ahead.to),
        crossings: crossingsAhead(route, world.crossings ?? [], ahead.from, ahead.to),
        route,
        laneOffset: plan.offset,
        seg,
      });
    const pass = this.pass;
    if (!pass) {
      this.passShift = 0;
      this.unsureFor = verdict.kind === "unsure" && this.speed < 0.3 ? this.unsureFor + dt : 0;
      if (this.unsureFor > UNSURE_GIVE_UP) this.whenBlocked(world, route);
      if (verdict.kind !== "blockage") {
        this.blockedFor = 0;
        return;
      }
      // Weighed close behind it, as a driver does (and with the oncoming traffic of then): early
      // enough at speed that after the 3 s 合図 there is still room to swing out.
      const gap = verdict.leader.at - verdict.leader.half - (this.at + OWN_HALF);
      if (gap > Math.max(PASS_DECIDE, SWING_OUT + SIGNAL_LEAD * this.speed)) return;
      const ok = permit(verdict.chain);
      if ("shift" in ok) {
        const chain = new Set(verdict.chain.map((s) => s.o));
        this.pass = {
          phase: "signal",
          shift: ok.shift,
          endAt: ok.endAt,
          t: 0,
          chain,
          backSignal: null,
          standing: 0,
        };
        this.blockedFor = 0;
        return;
      }
      this.blockedFor = this.speed < 0.3 ? this.blockedFor + dt : this.blockedFor;
      if (this.blockedFor > BLOCKED_GIVE_UP) this.whenBlocked(world, route);
      return;
    }
    pass.t += dt;
    const chain = others.filter((s) => pass.chain.has(s.o));
    const head = chain[chain.length - 1];
    if (pass.phase === "signal") {
      const gap = chain.length ? chain[0].at - chain[0].half - (this.at + OWN_HALF) : 0;
      const isClose = gap < 15 || this.speed < 0.3;
      if (pass.t < SIGNAL_LEAD || !isClose) return;
      const ok = chain.length ? permit(chain) : null;
      if (!ok || !("shift" in ok)) {
        this.pass = null;
        return;
      }
      pass.phase = "out";
      pass.shift = ok.shift;
      pass.endAt = ok.endAt;
      this.passShift = ok.shift;
      if (gap < SWING_OUT) this.startPullOut(world, route, chain, ok.shift);
      return;
    }
    if (pass.phase === "out") {
      const isNoseBeside = head !== undefined && this.at + OWN_HALF > chain[0].at - chain[0].half;
      // Swinging out came up short (stopped behind it, still in its way): pull out by manoeuvre.
      pass.standing = !isNoseBeside && Math.abs(this.speed) < 0.1 ? pass.standing + dt : 0;
      if (pass.standing > 2) {
        pass.standing = 0;
        this.startPullOut(world, route, chain, pass.shift);
        return;
      }
      // Not yet beside the line and something comes: back into the lane and wait again.
      if (!isNoseBeside && chain.length) {
        const ok = permit(chain);
        if (!("shift" in ok)) {
          this.pass = null;
          this.passShift = 0;
          return;
        }
      }
      if (head) pass.endAt = head.at + head.half + OWN_HALF + 2;
      const isFrontPast = !head || this.at + OWN_HALF > head.at + head.half;
      if (isFrontPast && pass.backSignal === null) pass.backSignal = pass.t;
      const isClear = this.at >= pass.endAt;
      const isSignalled = pass.backSignal !== null && pass.t - pass.backSignal >= SIGNAL_LEAD;
      if (isClear && isSignalled) {
        pass.phase = "back";
        this.passShift = 0;
      }
      return;
    }
    // Back in the lane: done once the car is there.
    const isBack = this.lateral === null || Math.abs(this.lateral - plan.offset) < 0.3;
    if (isBack) this.pass = null;
  }

  /**
   * Blocked for good where it may not pass: turn round onto another way to the target if the
   * street allows it (two-way, no 転回禁止), once; else give up.
   */
  private whenBlocked(world: DriveWorld, route: Route): void {
    this.blockedFor = 0;
    this.unsureFor = 0;
    const k = this.stepIndex(route);
    const st = route.steps[k];
    const canTurn = !this.rerouted && st.seg.oneway === 0 && !isUturnBanned(st.seg, world.clock);
    if (canTurn) {
      const s = world.graph.nearestOn(st.seg, this.position).s;
      const back: 1 | -1 = st.dir === 1 ? -1 : 1;
      const other = this.routeFrom(world, this.target, { seg: st.seg, s, dir: back });
      // Only a way round that does not come back up this street in the blocked direction.
      const isAround = other !== null && !other.steps.some((x) => x.seg === st.seg && x.dir === st.dir);
      if (other && isAround) {
        this.rerouted = true;
        this.route = other;
        this.at = 0;
        this.hint = 0;
        this.lateral = null;
        this.startPlanning(world, other, "reroute");
        return;
      }
    }
    this.gaveUp = "blocked";
  }

  /**
   * Where a stopped car may be waiting for something (a queue, not a blockage): a red or yellow
   * light or a 一時停止 just ahead of it, a junction, a crosswalk.
   */
  private isWaitingPoint(route: Route, world: DriveWorld, at: number): boolean {
    const k = this.stepAt(route, at);
    const st = route.steps[k];
    const travel = route.stepEntry[k] + (at - route.stepStart[k]);
    const stop = world.control.nextStop(st.seg, st.dir, travel - 2);
    const isAtStop =
      stop !== null &&
      stop.dist < 17 &&
      (stop.approach.kind === "stop" || world.control.state(stop.approach) !== "green");
    if (isAtStop) return true;
    const isAtJunction = junctionsAhead(route, world.graph, world.control, at - 2, at + 20).length > 0;
    const isAtCrossing = crossingsAhead(route, world.crossings ?? [], at - 2, at + 10).length > 0;
    return isAtJunction || isAtCrossing;
  }

  /**
   * Junctions ahead: the speed that lets the car stop where it must.
   * - 第50条: not into a junction box (or onto a crosswalk) when the traffic beyond would leave it
   *   standing there.
   * - 第37条: turning right, let oncoming traffic by (waiting just short of the junction centre).
   * - 第36条: where no signal controls it, let by traffic from a priority or clearly wider road, and
   *   on equal roads traffic from the left; 徐行 into a junction whose crossing road has priority.
   */
  private junctions(route: Route, world: DriveWorld, vehicles: readonly Seen[]): number {
    let cap = Infinity;
    const front = this.at + OWN_HALF;
    // Front bumper a metre short of route distance `at`.
    const stopBefore = (at: number) => {
      const d = at - 1 - front;
      cap = Math.min(cap, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, d)));
    };
    const zones: Array<{ start: number; end: number }> = [];
    const list = junctionsAhead(route, world.graph, world.control, this.at - 30, this.at + 70);
    for (const j of list) zones.push({ start: j.at - j.half, end: j.at + j.half });
    for (const c of crossingsAhead(route, world.crossings ?? [], this.at - 10, this.at + 70))
      zones.push({ start: c - 2, end: c + 2 });
    for (const z of zones) {
      const isInside = front > z.start + 0.5;
      if (isInside) continue;
      // The first slow car in our lane past the start of the zone: room for us beyond it?
      const beyond = vehicles.find(
        (s) => s.at + s.half > z.start && Math.abs(s.lateral) < IN_LANE && s.along < 2,
      );
      if (!beyond) continue;
      const room = beyond.at - beyond.half - z.end;
      if (room < 2 * OWN_HALF + 1.5) stopBefore(z.start);
    }
    for (const j of list) {
      const isPast = front > j.at + j.half;
      if (isPast) continue;
      const turn = route.maneuvers.find((m) => Math.abs(m.at - j.at) < 1)?.turn;
      // Waiting to turn right where the turn's curve begins, still clear of the oncoming lane (the
      // curve heads across it toward the inside of the centre); once on the curve, it is committed.
      const isRight = turn === "right" || turn === "slightRight";
      const curve = route.corners.find((c) => c.from <= j.at && j.at <= c.to + 1);
      const waitAt = Math.min(j.at - 1, curve ? curve.from + 1 : j.at - j.half);
      const isBeforeTurn = front < waitAt + 0.5;
      if (isRight && isBeforeTurn && this.oncoming(j, world).length) stopBefore(waitAt);
      if (j.signalled) continue;
      const isEntered = front > j.at - j.half;
      if (isEntered) continue;
      const yieldTo = this.crossing(j, world, false);
      if (yieldTo.priority)
        cap = Math.min(cap, Math.sqrt(SLOW * SLOW + 2 * 2.5 * Math.max(0, j.at - j.half - front - 1)));
      if (yieldTo.must) stopBefore(j.at - j.half);
    }
    return cap;
  }

  /** Oncoming vehicles that will reach (or are in) junction `j` within YIELD_TIME (第37条). */
  private oncoming(j: JunctionAhead, world: DriveWorld): DriveObstacle[] {
    return (world.vehicles ?? []).filter((o) => {
      if (o.kind !== "vehicle" || o.heading === undefined) return false;
      const hx = Math.sin(o.heading);
      const hz = Math.cos(o.heading);
      const isOpposite = hx * j.inDir.x + hz * j.inDir.z < -0.7;
      if (!isOpposite) return false;
      const dx = j.pos.x - o.position.x;
      const dz = j.pos.z - o.position.z;
      const toNode = dx * hx + dz * hz;
      const across = Math.abs(dx * hz - dz * hx);
      const isOnStreet = across < j.inSeg.line.width / 2 + 2;
      const v = Math.max(0, o.speed ?? 0);
      const isComing = toNode > -j.half && (toNode < j.half + 2 || (v > 0.5 && toNode / v < YIELD_TIME));
      return isOnStreet && isComing && toNode < 80;
    });
  }

  /**
   * Crossing traffic at an unsignalled junction (第36条): whether the crossing road has priority over
   * ours (a centre line — GSI 5.5 m and wider — against none, or clearly wider: 1.5×), and whether a
   * vehicle with the right of way is close enough in time that we must let it by. `all`: let every
   * crossing vehicle by (after a 一時停止, 第43条).
   */
  private crossing(j: JunctionAhead, world: DriveWorld, all: boolean): { priority: boolean; must: boolean } {
    const ours = j.inSeg.line.width;
    const widest = Math.max(0, ...j.others.map((s) => s.line.width));
    const isOursPriority = ours >= 5.5 && widest < 5.5;
    const priority = !isOursPriority && ((widest >= 5.5 && ours < 5.5) || widest >= ours * 1.5);
    const left = leftOf(j.inDir, 1);
    const must = (world.vehicles ?? []).some((o) => {
      if (o.kind !== "vehicle" || o.heading === undefined) return false;
      const hx = Math.sin(o.heading);
      const hz = Math.cos(o.heading);
      const isCrossing = Math.abs(hx * j.inDir.x + hz * j.inDir.z) < 0.7;
      if (!isCrossing) return false;
      const dx = j.pos.x - o.position.x;
      const dz = j.pos.z - o.position.z;
      const toNode = dx * hx + dz * hz;
      const across = Math.abs(dx * hz - dz * hx);
      const v = Math.max(0, o.speed ?? 0);
      const isComing =
        across < 6 && toNode > -2 && (toNode < j.half + 2 || (v > 0.5 && toNode / v < YIELD_TIME));
      if (!isComing || toNode > 40) return false;
      const isFromLeft = -dx * left.x + -dz * left.z > 0;
      return all || priority || (!isOursPriority && isFromLeft);
    });
    return { priority, must };
  }

  /** At a 一時停止: the junction just ahead has crossing traffic to let by. */
  private mustYield(route: Route, world: DriveWorld, all: boolean): boolean {
    const j = junctionsAhead(route, world.graph, world.control, this.at, this.at + 25)[0];
    return j ? this.crossing(j, world, all).must : false;
  }

  private stepIndex(route: Route): number {
    let i = Math.max(1, this.hint);
    while (i < route.cum.length - 1 && route.cum[i] < this.at) i++;
    return route.stepOf[Math.min(i, route.stepOf.length - 1)] ?? 0;
  }

  /** Step of the route at route distance `at`. */
  private stepAt(route: Route, at: number): number {
    let k = 0;
    while (k < route.stepStart.length - 1 && route.stepStart[k + 1] <= at) k++;
    return k;
  }

  /**
   * The wheel: the lane the route plans (eased across over a few seconds; one off PLATEAU paving,
   * clear of the kerb, never across a yellow line), 合図, then pure pursuit — steer along the arc
   * through a point a speed-dependent distance ahead on the path, shifted by how far the car's lane
   * differs from the planned one. Through a corner it follows the curve itself. Passing a blockage
   * shifts the lane to the right by what the pass needs.
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
    const target =
      (plan.corner ? plan.offset : keepLeftOffset(seg, lane, centre, dir, world.isPavement, lanes, wanted)) +
      this.passShift;
    this.lateral ??= target;
    // Fast enough to keep up with the plan's own easing (1 m per 10 m travelled); on a curve the
    // planned offset is only interpolated between two streets, so the car simply follows the curve.
    // Pulling out round a blockage and back goes quicker (a 3 m shift in about 12 m).
    const pace = this.pass ? 0.35 : 0.12;
    const rate = Math.max(this.pass ? 1.5 : 0.8, Math.abs(this.speed) * pace) * dt;
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
    // A pass: right from 3 s before pulling out until beside the line, left from 3 s before going back.
    const pass = this.pass;
    if (pass) {
      const isGoingBack = pass.phase === "back" || pass.backSignal !== null;
      const isBackIn = pass.phase === "back" && Math.abs(gap) <= 0.3;
      this.signal = !isGoingBack ? "right" : isBackIn ? null : "left";
    }
    // Pure pursuit: curvature 2·y / d² to the look-ahead point (y = its offset to the left).
    // Pulling out round a blockage: a shorter look-ahead turns the wheel out sooner.
    const nearest = this.pass?.phase === "out" ? 3.5 : 5;
    const lookahead = Math.min(18, Math.max(nearest, 4.5 + 0.55 * Math.abs(this.speed)));
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

  // ---------- Off the lane: manoeuvres (autoRecovery.ts) ----------

  /**
   * Whether the car has to manoeuvre into its lane: standing (or crashed) on a pavement or off every
   * carriageway, turned more than 50° from its way, or more than 4.5 m from its lane; or at a dead
   * end's U-turn, which no car turns in one go.
   */
  private offLane(route: Route, world: DriveWorld, off: number): Why | null {
    const pos = this.position;
    const isOnPavement = world.isPavement?.(pos.x, pos.z) ?? false;
    const isOffRoad = world.graph.carriagewaysAt(pos, 1).length === 0;
    const d = this.pathAt(route, Math.min(route.length, this.at + 1)).sub(
      this.pathAt(route, Math.max(0, this.at - 1)),
    );
    const yawError = d.lengthSq() > 1e-6 ? Math.abs(wrap(Math.atan2(d.x, d.z) - this.yaw)) : 0;
    const isSlow = Math.abs(this.speed) < 3;
    const isLost = isOnPavement || off > OFF_LANE || (isSlow && (isOffRoad || yawError > MISALIGNED));
    if (isLost) return "align";
    const uturn = route.corners.find((c) => c.kind === "uturn" && c.from - this.at < 5 && c.to > this.at);
    return uturn ? "uturn" : null;
  }

  /**
   * Poses along the lane to get into: chassis centres on the driven path (or `shift` metres left
   * of it, beside a blockage), its direction.
   */
  private laneGoal(route: Route, from: number, length: number, shift = 0): Pose[] {
    const goal: Pose[] = [];
    for (let d = from; d <= Math.min(route.length, from + length); d += 1) {
      const p = this.pathAt(route, d);
      const q = this.pathAt(route, Math.min(route.length, d + 1));
      const r = this.pathAt(route, Math.max(0, d - 1));
      const dir = q.sub(r).setY(0);
      if (dir.lengthSq() < 1e-6) continue;
      dir.normalize();
      p.add(leftOf(dir, shift));
      goal.push({ x: p.x, z: p.z, yaw: Math.atan2(dir.x, dir.z) });
    }
    return goal;
  }

  /**
   * Where the search may take the car. Its body must be clear of fixed colliders (isClear) and of the
   * vehicles and people about. From the road it stays on the carriageway — never onto a pavement
   * (第17条第1項); from a pavement or a plaza it may cross them, at three times the cost per metre,
   * so it leaves them by the shortest way.
   */
  private area(world: DriveWorld): ManoeuvreArea {
    const here = this.position;
    const probe = new Vector3();
    const onRoad = (x: number, z: number) => {
      const isPaved = world.isPavement?.(x, z) ?? false;
      return !isPaved && world.graph.carriagewaysAt(probe.set(x, 0, z), 0.3).length > 0;
    };
    const startsOnRoad = onRoad(here.x, here.z);
    const near = this.near(world);
    return {
      isFree: (x, z, yaw) => (world.isClear?.(x, z, yaw) ?? true) && !near.some((o) => touches(x, z, yaw, o)),
      costAt: (x, z) => (onRoad(x, z) ? 1 : startsOnRoad ? Infinity : 3),
    };
  }

  /** Vehicles and people within 60 m (not the car itself). */
  private near(world: DriveWorld): DriveObstacle[] {
    const here = this.position;
    const isNear = (p: Vector3) => p.distanceTo(here) > 1 && p.distanceTo(here) < 60;
    return [
      ...(world.vehicles ?? []).filter((o) => isNear(o.position)),
      ...world.obstacles.filter(isNear).map((p): DriveObstacle => ({ position: p, kind: "person" })),
    ];
  }

  private startPlanning(world: DriveWorld, route: Route, why: Why, lane?: Pose[]): void {
    const from =
      why === "uturn"
        ? (route.corners.find((c) => c.kind === "uturn" && c.to > this.at)?.to ?? this.at) + 2
        : this.at + 2;
    const goal = lane ?? this.laneGoal(route, from, 32);
    const start = { x: this.position.x, z: this.position.z, yaw: this.yaw };
    // From far out on a plaza: room (and nodes) enough to reach the street.
    const far = Math.min(...goal.map((g) => Math.hypot(g.x - start.x, g.z - start.z)));
    const reach = Math.max(45, far + 25);
    const budget = reach > 45 ? 30000 : 20000;
    this.mode = {
      kind: "plan",
      planner: new ManoeuvrePlanner(start, goal, this.area(world), budget, reach),
      why,
    };
    this.watch.reset(this.position);
  }

  /**
   * Pulling out round a blockage from close behind it: a manoeuvre (a reverse first if it must) to
   * the pass line beside the first car of the line — the search keeps the body clear of it, where
   * a pure-pursuit swing from a few metres behind clipped its corner or stopped short.
   */
  private startPullOut(world: DriveWorld, route: Route, chain: readonly Seen[], shift: number): void {
    const first = chain[0];
    if (!first) return;
    // The pass line: `shift` from the driven path (as the lane target is, see steerFor).
    const lane = this.laneGoal(route, first.at - first.half, 2 * first.half + 6, shift);
    this.startPlanning(world, route, "pass", lane);
  }

  /** Stuck: reverse 3 m (opposite lock first) where the body has room, then drive on. */
  private startBackOff(world: DriveWorld, route: Route, metres = 3): void {
    const start = { x: this.position.x, z: this.position.z, yaw: this.yaw };
    const path = backOffPath(start, this.lastSteer, this.area(world).isFree, metres);
    if (!path) {
      this.startPlanning(world, route, "stuck");
      return;
    }
    // Reversing at once: the back-off needs no 3 s of 合図, only the 後退灯.
    this.mode = {
      kind: "run",
      runner: new ManoeuvreRunner(path),
      why: "stuck",
      side: null,
      signalled: SIGNAL_LEAD,
    };
    this.watch.reset(this.position);
  }

  private failAttempt(): void {
    if (this.attempts === 0) this.attemptFrom.copy(this.position);
    this.attempts++;
    if (this.attempts > MAX_ATTEMPTS) this.gaveUp = "stuck";
  }

  /** Planning or driving a manoeuvre: the pedals and wheel for this look. */
  private manoeuvre(dt: number, world: DriveWorld, route: Route): DriveInput {
    const mode = this.mode;
    // A pull-out keeps its pass (driving on beside the line after it); anything else ends one.
    const isPullOut = mode.kind !== "drive" && mode.why === "pass";
    if (!isPullOut) {
      this.pass = null;
      this.passShift = 0;
    }
    if (mode.kind === "plan") {
      this.signal = null;
      // A few milliseconds a look: the car stands still while it works the way out.
      const state = mode.planner.step(2000, performance.now() + PLAN_MS);
      if (state === "searching") return HOLD;
      const path = mode.planner.result;
      if (state === "found" && path) {
        if (path.length < 2) {
          this.mode = { kind: "drive" };
          return HOLD;
        }
        const start = { x: this.position.x, z: this.position.z, yaw: this.yaw };
        // A pull-out was signalled for 3 s already (the pass's 合図, right).
        const side = isPullOut ? "right" : sideOf(path, start);
        this.mode = {
          kind: "run",
          runner: new ManoeuvreRunner(path),
          why: mode.why,
          side,
          signalled: isPullOut ? SIGNAL_LEAD : 0,
        };
        return HOLD;
      }
      // No way out round the blockage: back to waiting behind it.
      if (isPullOut) {
        this.mode = { kind: "drive" };
        this.pass = null;
        this.passShift = 0;
        return HOLD;
      }
      // No way found: count it as a failed go and back off to look again from elsewhere.
      this.failAttempt();
      if (this.gaveUp) return HOLD;
      this.startBackOff(world, route);
      return HOLD;
    }
    if (mode.kind !== "run") return HOLD;
    const runner = mode.runner;
    this.signal = mode.side;
    // 後退灯 from when it is about to reverse (施行令 第21条: その行為をしようとするとき).
    this.reversing = runner.gear < 0;
    // Before moving off: 合図 for 3 s (施行令 第21条), and only when nobody's normal way is disturbed
    // (第25条の2第1項: 横断・転回・後退). The same look before each stretch in reverse.
    if (runner.isStretchStart) {
      if (mode.signalled < SIGNAL_LEAD) {
        mode.signalled += dt;
        return HOLD;
      }
      const isReverse = runner.gear < 0;
      const isFirst = mode.signalled < SIGNAL_LEAD + dt * 1.5;
      if ((isReverse || isFirst) && this.disturbs(runner.remainingPoses(), world)) return HOLD;
    }
    mode.signalled += dt;
    const pose = { x: this.position.x, z: this.position.z, yaw: this.yaw };
    const step = runner.update(dt, pose, this.speed);
    if (step.done) {
      this.mode = { kind: "drive" };
      this.lateral = null;
      this.watch.reset(this.position);
      return { ...HOLD, brake: 0, brakeOnly: true, throttle: 0.1 };
    }
    if (step.lost) {
      this.startPlanning(world, route, mode.why);
      return HOLD;
    }
    // Someone moved into the next few metres (the fixed colliders were checked by the plan).
    const near = this.near(world);
    const isBlocked = runner
      .remainingPoses()
      .slice(2, 14)
      .some((p) => near.some((o) => touches(p.x, p.z, p.yaw, o)));
    if (isBlocked && !step.atCusp) return HOLD;
    const input = manoeuvrePedals(step.want, this.speed, step.steer);
    this.reversing = step.gear < 0 || this.speed < -0.1;
    // Stuck on the way: going forward, back off; in reverse, look for another way from here.
    if (this.watch.update(dt, this.position, isPushing(input))) {
      this.failAttempt();
      if (this.gaveUp) return HOLD;
      if (step.gear > 0) this.startBackOff(world, route);
      else this.startPlanning(world, route, "stuck");
      return HOLD;
    }
    return input;
  }

  /**
   * 第25条の2第1項: would reversing or turning here disturb anyone? A vehicle that will be inside the
   * manoeuvre's area (its path + 3 m) within 6 s at its speed, or a person within 1.5 m of it.
   */
  private disturbs(poses: Pose[], world: DriveWorld): boolean {
    if (poses.length === 0) return false;
    const minX = Math.min(...poses.map((p) => p.x)) - 3;
    const maxX = Math.max(...poses.map((p) => p.x)) + 3;
    const minZ = Math.min(...poses.map((p) => p.z)) - 3;
    const maxZ = Math.max(...poses.map((p) => p.z)) + 3;
    const isIn = (x: number, z: number, m = 0) =>
      x > minX - m && x < maxX + m && z > minZ - m && z < maxZ + m;
    const isPersonNear = world.obstacles.some((p) => p.distanceTo(this.position) > 1 && isIn(p.x, p.z, 1.5));
    if (isPersonNear) return true;
    return (world.vehicles ?? []).some((o) => {
      const isItself = o.position.distanceTo(this.position) < 1;
      const v = o.speed ?? 0;
      if (isItself || o.kind !== "vehicle" || Math.abs(v) < 0.5 || o.heading === undefined) return false;
      for (let t = 0; t <= 6; t += 0.5) {
        const x = o.position.x + Math.sin(o.heading) * v * t;
        const z = o.position.z + Math.cos(o.heading) * v * t;
        if (isIn(x, z)) return true;
      }
      return false;
    });
  }
}

/** 合図 for a manoeuvre: the way it turns (a 転回 always right, 施行令 第21条), or the way it moves over. */
function sideOf(path: readonly PathPose[], start: Pose): "left" | "right" | null {
  const end = path[path.length - 1];
  const turned = wrap(end.yaw - start.yaw);
  if (Math.abs(turned) > 2.3) return "right";
  if (Math.abs(turned) > 0.35) return turned > 0 ? "left" : "right";
  const lateral = (end.x - start.x) * Math.cos(start.yaw) - (end.z - start.z) * Math.sin(start.yaw);
  if (Math.abs(lateral) < 0.5) return null;
  return lateral > 0 ? "left" : "right";
}

/**
 * Whether the car's body at a chassis-centre pose (with 15 cm to spare) touches a road user: a
 * vehicle as a box along its heading, a person as a 0.4 m disc.
 */
function touches(x: number, z: number, yaw: number, o: DriveObstacle): boolean {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dx = o.position.x - x;
  const dz = o.position.z - z;
  if (dx * dx + dz * dz > 64) return false;
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  if (o.kind === "person" || o.heading === undefined) {
    const r = o.kind === "person" ? 0.4 : 1.2;
    return Math.abs(along) < HALF_LENGTH + 0.15 + r && Math.abs(across) < HALF_WIDTH + 0.15 + r;
  }
  // Two boxes: separated along one of the four axes (SAT).
  const half = o.halfLength ?? 2.25;
  const gx = Math.sin(o.heading);
  const gz = Math.cos(o.heading);
  const axes: Array<[number, number]> = [
    [fx, fz],
    [fz, -fx],
    [gx, gz],
    [gz, -gx],
  ];
  return axes.every(([ax, az]) => {
    const reachA =
      (HALF_LENGTH + 0.15) * Math.abs(ax * fx + az * fz) + (HALF_WIDTH + 0.15) * Math.abs(ax * fz - az * fx);
    const reachB = half * Math.abs(ax * gx + az * gz) + 0.95 * Math.abs(ax * gz - az * gx);
    return Math.abs(dx * ax + dz * az) < reachA + reachB;
  });
}

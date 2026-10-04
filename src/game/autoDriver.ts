import { Vector3 } from "three";
import type { TurnRule } from "../world/regulations";
import { laneOffset, leftOf, speedLimit, type RoadGraph, type Segment } from "../world/roads";
import type { GameClock } from "../world/ruleTime";
import type { TrafficControl } from "../world/trafficControl";
import { planRoute, progressOn, type Route } from "./navigation";

/**
 * Self-driving that keeps every rule (the robotaxi and the player's 自動運転モード): it drives the
 * legal route (one-way streets, 通行禁止 and 指定方向外進行禁止 in force), keeps left in its lane
 * at or under the limit, slows for turns, stops at the stop line for red and for yellow when it
 * can (施行令 第2条), stops fully at 一時停止 (第43条), and waits for cars and people ahead.
 * It moves a pose (position on the ground, yaw); the owner puts a model or a body there.
 */
export type DriveWorld = {
  graph: RoadGraph;
  control: TrafficControl;
  turnRules: TurnRule[];
  clock: GameClock;
  /** Things to keep clear of: traffic cars, parked cars, pedestrians in the road. */
  obstacles: Vector3[];
};

const ACCEL = 1.8; // m/s², gentle for passengers
const BRAKE = 4.5;
const TURN_SPEED = 4.2; // m/s (15 km/h) through left/right turns
const STOP_GAP = 3.2; // front bumper this far before a stop line / obstacle

const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;

export class AutoDriver {
  route: Route | null = null;
  speed = 0;
  /** Ground position in the lane and heading (radians, atan2(x, z)). */
  readonly position = new Vector3();
  yaw = 0;
  /** Whether it is braking (for the brake lamps). */
  braking = false;
  private at = 0;
  private hint = 0;
  private served = -1; // 一時停止 approach already stopped at
  private waited = 0;
  private readonly target = new Vector3();
  private graph: RoadGraph | null = null;

  constructor(private readonly groundAt: (x: number, z: number) => number | null) {}

  get remaining(): number {
    return this.route ? this.route.length - this.at : 0;
  }

  heading(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Put the car at a pose without driving there. */
  place(pos: Vector3, yaw: number): void {
    const g = this.groundAt(pos.x, pos.z) ?? pos.y;
    this.position.set(pos.x, g, pos.z);
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
    const route = planRoute(world.graph, start, target, world.clock, world.turnRules);
    if (!route) return false;
    this.route = route;
    this.at = 0;
    this.hint = 0;
    this.served = -1;
    return true;
  }

  /** Re-anchoring: shift the pose and the route rigidly. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    offset(this.position);
    this.yaw += yawDelta;
    offset(this.target);
    if (this.route) for (const p of this.route.points) offset(p);
  }

  /** Advance; returns the distance moved, and whether the route is done (stopped at its end). */
  update(dt: number, world: DriveWorld): { moved: number; done: boolean } {
    // A new road graph (area change, re-anchoring): plan again from where the car is.
    if (world.graph !== this.graph && this.route) this.plan(world, this.target);
    const route = this.route;
    if (!route) return { moved: 0, done: false };
    const remaining = route.length - this.at;
    const isAtEnd = remaining < 0.5;
    let want = isAtEnd ? 0 : this.cruise(route);
    // Ease to a stop at the kerb at the end of the route.
    want = Math.min(want, Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, remaining - 0.3)));
    const block = this.blockAhead(route, world, dt);
    if (block < Infinity) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, block - STOP_GAP)));
    this.braking = want < this.speed - 0.2 || this.speed < 0.1;
    this.speed += Math.max(-BRAKE * dt, Math.min(ACCEL * dt, want - this.speed));
    if (this.speed < 0.05 && want < 0.05) this.speed = 0;
    const moved = this.speed * dt;
    this.at = Math.min(route.length, this.at + moved);
    this.pose(route);
    // The road map only covers ~1 km round the car: at its edge, wait for the next one.
    return { moved, done: isAtEnd && this.speed === 0 && route.reachesTarget };
  }

  /** Speed to aim for on this stretch: the limit, less for the next turn. */
  private cruise(route: Route): number {
    const k = this.stepIndex(route);
    const seg = route.steps[k].seg;
    let v = Math.max(5, speedLimit(seg) / 3.6 - 1.5);
    const next = route.maneuvers.find((m) => m.at > this.at - 2);
    if (next) {
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
        if (state === "red" || (state === "yellow" && canStop)) block = dist;
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
    const p = progressOn(route, this.position, this.hint);
    this.hint = p.index;
    let i = this.hint;
    while (i < route.cum.length - 1 && route.cum[i] < this.at) i++;
    return route.stepOf[Math.min(i, route.stepOf.length - 1)] ?? 0;
  }

  /** Lane position at the current distance, heading toward a point a few metres on. */
  private pose(route: Route): void {
    const here = this.pointAt(route, this.at);
    const look = this.pointAt(route, Math.min(route.length, this.at + 4));
    const dir = look.clone().sub(here).setY(0);
    if (dir.lengthSq() > 1e-4) {
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * 0.35;
    }
    const g = this.groundAt(here.x, here.z) ?? this.position.y;
    this.position.set(here.x, g, here.z);
  }

  /** Route point at distance `d`, moved into the left lane of the street it is on. */
  private pointAt(route: Route, d: number): Vector3 {
    let i = 1;
    while (i < route.cum.length - 1 && route.cum[i] < d) i++;
    const a = route.points[i - 1];
    const b = route.points[i];
    const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
    const p = a.clone().lerp(b, Math.min(1, Math.max(0, t)));
    const lane = laneOffset(route.steps[route.stepOf[i]]?.seg);
    const dir = b.clone().sub(a).setY(0);
    if (dir.lengthSq() > 1e-6) p.add(leftOf(dir.normalize(), lane));
    return p;
  }
}

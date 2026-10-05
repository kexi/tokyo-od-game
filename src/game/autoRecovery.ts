import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { steerLimit, WHEELBASE, type DriveInput } from "../physics/vehicle";

/**
 * 自動運転の復帰: getting a car that is not in its lane — on a pavement or a plaza after a 移動 or
 * a crash, spun round, facing the wrong way, nose against a wall, at the end of a dead end — back
 * into the lane facing the way the route goes, as a driver does it: a forward arc where there is
 * room, otherwise back up and go again (切り返し) as often as it takes.
 *
 * The manoeuvre comes from a Hybrid A* search over short arcs of the car's own kinematics
 * (forward and reverse, five steering angles); every swept pose is checked against the fixed
 * colliders (buildings, poles, gantries: a Rapier box query) and the people and vehicles about.
 * The path found is then driven by pure pursuit at walking pace, stopping at each change of gear.
 * Why not a fixed recipe (reverse 3 m, then full lock): it fails as soon as there is a pole or a
 * wall where the recipe goes, and a dead end narrower than the turning circle needs several goes.
 */

/** A pose of the chassis centre (x, z) and its heading (atan2(x, z) of forward, + = left). */
export type Pose = { x: number; z: number; yaw: number };
export type Gear = 1 | -1;
/** A point of a manoeuvre: rear-axle pose and the gear that reaches it. */
export type PathPose = Pose & { gear: Gear };

/** Half the car's body (physics/vehicle.ts HALF) and the rear axle behind the chassis centre. */
export const HALF_WIDTH = 0.92;
export const HALF_LENGTH = 2.15;
const REAR = WHEELBASE / 2;
const MARGIN_SIDE = 0.12;
const MARGIN_END = 0.25;

// Curvature of the rear axle's path at the planned lock. The kinematic model gives 0.21 /m at full
// lock and walking pace, but the physics car's front tyres slip: measured headlessly it turns its
// centre on 5.3 m (rear axle 0.194 /m). Planning at 0.175 /m (5.7 m) leaves the pursuit room to
// catch up after each change of gear.
const KAPPA = 0.175;
const CURVES = [-KAPPA, -KAPPA / 2, 0, KAPPA / 2, KAPPA];
const STEP = 1; // m per arc
const SUBSTEPS = 2; // body checks per arc
const CELL = 0.4; // m, search grid
const YAW_BINS = 48; // 7.5°
const REVERSE_COST = 1.8; // reversing is slower and blind: prefer forward
const SWITCH_COST = 4; // each stop to change gear
const STEER_COST = 0.3;
const MAX_REVERSE = 6; // m in one go: reversing kept short (第25条の2: only as far as needed)
const REACH = 45; // m from the start the search may go (by default)
const HEURISTIC_WEIGHT = 1.5;
const GOAL_DISTANCE = 0.8; // m from a lane pose
const GOAL_YAW = 0.22; // rad (12.6°): pure pursuit takes over from there

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const forwardOf = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

/** Rear axle from the chassis centre (and back). */
export function rearOf(p: Pose): Pose {
  return { x: p.x - Math.sin(p.yaw) * REAR, z: p.z - Math.cos(p.yaw) * REAR, yaw: p.yaw };
}
export function centreOf(p: Pose): Pose {
  return { x: p.x + Math.sin(p.yaw) * REAR, z: p.z + Math.cos(p.yaw) * REAR, yaw: p.yaw };
}

/**
 * Move the rear axle `d` metres (negative: backwards) along an arc of curvature `kappa` (+ = to the
 * left): the bicycle model, as physics/vehicle.ts coast() integrates it.
 */
export function arc(p: Pose, kappa: number, d: number): Pose {
  if (Math.abs(kappa) < 1e-6)
    return { x: p.x + Math.sin(p.yaw) * d, z: p.z + Math.cos(p.yaw) * d, yaw: p.yaw };
  const yaw = p.yaw + kappa * d;
  return {
    x: p.x + (Math.cos(p.yaw) - Math.cos(yaw)) / kappa,
    z: p.z + (Math.sin(yaw) - Math.sin(p.yaw)) / kappa,
    yaw,
  };
}

/** What the search may use: where the body is clear and what each metre there costs. */
export type ManoeuvreArea = {
  /** The car's body at this chassis-centre pose touches nothing solid and nobody. */
  isFree: (x: number, z: number, yaw: number) => boolean;
  /** Cost factor of a metre with the chassis centre here: 1 on the carriageway, Infinity: never. */
  costAt: (x: number, z: number) => number;
};

type SearchNode = {
  x: number;
  z: number;
  yaw: number;
  gear: Gear | 0;
  kappa: number;
  g: number;
  f: number;
  reverseRun: number;
  parent: SearchNode | null;
};

/**
 * Hybrid A* from the car's pose to any of `goal` (chassis-centre poses along its lane, ~1 m apart),
 * run a slice at a time (step) so a long search never stalls a frame.
 */
export class ManoeuvrePlanner {
  result: PathPose[] | null = null;
  expanded = 0;
  private readonly open: SearchNode[] = [];
  private readonly best = new Map<number, number>();
  private readonly free = new Map<number, boolean>();
  private readonly cost = new Map<number, number>();
  private readonly origin: Pose;
  private state: "searching" | "found" | "failed" = "searching";

  constructor(
    start: Pose,
    private readonly goal: readonly Pose[],
    private readonly area: ManoeuvreArea,
    private readonly budget = 20000,
    /** How far from the start the search may go (m): further for a car far out on a plaza. */
    private readonly reach = REACH,
  ) {
    this.origin = start;
    const rear = rearOf(start);
    const node: SearchNode = { ...rear, gear: 0, kappa: 0, g: 0, f: 0, reverseRun: 0, parent: null };
    node.f = HEURISTIC_WEIGHT * this.heuristic(start);
    if (goal.length === 0) this.state = "failed";
    else if (this.isGoal(start)) {
      this.result = [];
      this.state = "found";
    } else this.push(node);
  }

  /**
   * Expand up to `expansions` nodes, stopping early at `until` (performance.now() ms) so a frame
   * keeps its time; the search ends found or failed within its budget.
   */
  step(expansions: number, until = Infinity): "searching" | "found" | "failed" {
    for (let i = 0; i < expansions && this.state === "searching"; i++) {
      const isOutOfTime = i % 16 === 15 && performance.now() > until;
      if (isOutOfTime) break;
      const node = this.pop();
      if (!node || this.expanded >= this.budget) {
        this.state = "failed";
        break;
      }
      this.expanded++;
      const hit = this.expand(node);
      if (hit) {
        this.result = this.trace(hit);
        this.state = "found";
      }
    }
    return this.state;
  }

  private expand(n: SearchNode): SearchNode | null {
    for (const gear of [1, -1] as const) {
      const reverseRun = gear < 0 ? (n.gear < 0 ? n.reverseRun : 0) + STEP : 0;
      if (reverseRun > MAX_REVERSE) continue;
      for (const kappa of CURVES) {
        let p: Pose = n;
        let metres = 0;
        let isBlocked = false;
        for (let k = 1; k <= SUBSTEPS && !isBlocked; k++) {
          p = arc(n, kappa, (gear * STEP * k) / SUBSTEPS);
          const c = centreOf(p);
          const factor = this.costAt(c.x, c.z);
          isBlocked = !Number.isFinite(factor) || !this.isFree(c);
          metres += (STEP / SUBSTEPS) * factor;
        }
        if (isBlocked) continue;
        const c = centreOf(p);
        if (Math.hypot(c.x - this.origin.x, c.z - this.origin.z) > this.reach) continue;
        const isSwitch = n.gear !== 0 && n.gear !== gear;
        const g =
          n.g +
          metres * (gear < 0 ? REVERSE_COST : 1) +
          (isSwitch ? SWITCH_COST : 0) +
          (STEER_COST * Math.abs(kappa - n.kappa)) / KAPPA;
        const next: SearchNode = { ...p, gear, kappa, g, f: 0, reverseRun, parent: n };
        if (this.isGoal(c)) return next;
        const key = this.key(p, gear);
        if (g >= (this.best.get(key) ?? Infinity) - 1e-6) continue;
        this.best.set(key, g);
        next.f = g + HEURISTIC_WEIGHT * this.heuristic(c);
        this.push(next);
      }
    }
    return null;
  }

  private isGoal(c: Pose): boolean {
    return this.goal.some(
      (g) => Math.hypot(g.x - c.x, g.z - c.z) < GOAL_DISTANCE && Math.abs(wrap(g.yaw - c.yaw)) < GOAL_YAW,
    );
  }

  /**
   * Distance to the nearest lane pose plus a turning term (half a turn ≈ 12.6 m), at the cost per
   * metre where the car is: across a plaza (×3) the search heads for the street instead of
   * flooding the open ground round the car with equally cheap-looking turns (the plain distance
   * ran out of its 15,000 nodes 38 m out on a forecourt).
   */
  private heuristic(c: Pose): number {
    let h = Infinity;
    for (const g of this.goal)
      h = Math.min(h, Math.hypot(g.x - c.x, g.z - c.z) + 4 * Math.abs(wrap(g.yaw - c.yaw)));
    const factor = this.costAt(c.x, c.z);
    return h * (Number.isFinite(factor) ? factor : 1);
  }

  private isFree(c: Pose): boolean {
    const key =
      Math.round(c.x * 10) * 73856093 + Math.round(c.z * 10) * 19349663 + Math.round(wrap(c.yaw) * 30);
    let ok = this.free.get(key);
    if (ok === undefined) {
      ok = this.area.isFree(c.x, c.z, c.yaw);
      this.free.set(key, ok);
    }
    return ok;
  }

  private costAt(x: number, z: number): number {
    const key = Math.round(x / 0.25) * 73856093 + Math.round(z / 0.25);
    let c = this.cost.get(key);
    if (c === undefined) {
      c = this.area.costAt(x, z);
      this.cost.set(key, c);
    }
    return c;
  }

  private key(p: Pose, gear: Gear): number {
    const ix = Math.round((p.x - this.origin.x) / CELL) + 512;
    const iz = Math.round((p.z - this.origin.z) / CELL) + 512;
    const iy = ((Math.round(wrap(p.yaw) / ((2 * Math.PI) / YAW_BINS)) % YAW_BINS) + YAW_BINS) % YAW_BINS;
    return ((ix * 1024 + iz) * YAW_BINS + iy) * 2 + (gear > 0 ? 1 : 0);
  }

  /** The rear-axle path from the start, every 25 cm, with the gear of each stretch. */
  private trace(end: SearchNode): PathPose[] {
    const chain: SearchNode[] = [];
    for (let n: SearchNode | null = end; n; n = n.parent) chain.unshift(n);
    const first = chain[1];
    const path: PathPose[] = [{ x: chain[0].x, z: chain[0].z, yaw: chain[0].yaw, gear: first.gear as Gear }];
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1];
      const n = chain[i];
      const gear = n.gear as Gear;
      for (let k = 1; k <= 4; k++) path.push({ ...arc(from, n.kappa, (gear * STEP * k) / 4), gear });
    }
    return path;
  }

  private push(n: SearchNode): void {
    const h = this.open;
    h.push(n);
    for (let i = h.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (h[up].f <= h[i].f) break;
      [h[up], h[i]] = [h[i], h[up]];
      i = up;
    }
  }

  private pop(): SearchNode | undefined {
    const h = this.open;
    const top = h[0];
    const last = h.pop();
    if (h.length && last) {
      h[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && h[l].f < h[m].f) m = l;
        if (r < h.length && h[r].f < h[m].f) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Backing off when stuck: `metres` straight back or on either lock, the first whose swept body is
 * clear. Opposite lock first: reversing with the wheel turned the other way swings the nose toward
 * where the car was trying to steer, so the next go forward clears what stopped it.
 */
export function backOffPath(
  start: Pose,
  lastSteer: number,
  isFree: ManoeuvreArea["isFree"],
  metres = 3,
): PathPose[] | null {
  const opposite = lastSteer > 0.05 ? -KAPPA : lastSteer < -0.05 ? KAPPA : 0;
  const tries = [opposite, 0, -opposite, KAPPA, -KAPPA].filter((k, i, all) => all.indexOf(k) === i);
  for (const kappa of tries) {
    const rear = rearOf(start);
    const path: PathPose[] = [{ ...rear, gear: -1 }];
    let isClear = true;
    for (let d = 0.25; d <= metres + 1e-6 && isClear; d += 0.25) {
      const p = arc(rear, kappa, -d);
      const c = centreOf(p);
      isClear = isFree(c.x, c.z, c.yaw);
      path.push({ ...p, gear: -1 });
    }
    if (isClear) return path;
  }
  return null;
}

export type ManoeuvreStep = {
  /** Speed to drive at (m/s, negative backwards) and the wheel (−1…1, + = left). */
  want: number;
  steer: number;
  gear: Gear;
  done: boolean;
  /** More than 1.3 m off the path: plan again. */
  lost: boolean;
  /** Stopped to change gear. */
  atCusp: boolean;
};

const LOOK = 1.8; // m ahead on the path for the pure pursuit at walking pace
const FORWARD_PACE = 1.3; // m/s (4.7 km/h)
const REVERSE_PACE = 0.9; // m/s (3.2 km/h): 後退 short and slow
const CUSP_DWELL = 0.4; // s at a standstill before the other gear

/**
 * Drives a planned manoeuvre: each stretch of one gear by pure pursuit of its rear-axle path (the
 * same geometry backwards: an arc through the target behind), easing to a stop where the gear
 * changes. The last forward stretch runs on into normal driving.
 */
export class ManoeuvreRunner {
  readonly segments: PathPose[][] = [];
  private readonly cum: number[][] = [];
  private seg = 0;
  private hint = 1;
  private dwell = 0;
  private cusp = false;

  constructor(path: readonly PathPose[]) {
    for (let i = 1; i < path.length; i++) {
      const isNew = i === 1 || path[i].gear !== path[i - 1].gear;
      if (isNew) this.segments.push([{ ...path[i - 1], gear: path[i].gear }]);
      this.segments[this.segments.length - 1].push(path[i]);
    }
    for (const s of this.segments) {
      const c = [0];
      for (let i = 1; i < s.length; i++)
        c.push(c[i - 1] + Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z));
      this.cum.push(c);
    }
  }

  get gear(): Gear {
    return this.segments[this.seg]?.[1]?.gear ?? 1;
  }

  /** Metres left in reverse (this stretch and the ones after), for the 第25条の2 look round. */
  get isReverseAhead(): boolean {
    return this.segments.slice(this.seg).some((s) => s[1]?.gear === -1);
  }

  /** Chassis-centre poses still to drive, from where the car is on this stretch on. */
  remainingPoses(): Pose[] {
    const rest = this.segments
      .slice(this.seg)
      .flatMap((s, k) => (k === 0 ? s.slice(Math.max(0, this.hint - 1)) : s));
    return rest.map((p) => centreOf(p));
  }

  get isDone(): boolean {
    return this.seg >= this.segments.length;
  }

  /** At the start of a stretch (standing, before moving off). */
  get isStretchStart(): boolean {
    return this.hint <= 1 && !this.cusp;
  }

  update(dt: number, centre: Pose, speed: number): ManoeuvreStep {
    const pts = this.segments[this.seg];
    const cum = this.cum[this.seg];
    if (!pts) return { want: 0, steer: 0, gear: 1, done: true, lost: false, atCusp: false };
    const gear = pts[1]?.gear ?? 1;
    const isLast = this.seg === this.segments.length - 1;
    const rear = rearOf(centre);
    // Where the rear axle is along this stretch.
    let best = { s: 0, d: Infinity, i: this.hint };
    for (let i = Math.max(1, this.hint - 4); i < Math.min(pts.length, this.hint + 16); i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = cum[i] - cum[i - 1];
      const t =
        len < 1e-6
          ? 0
          : Math.min(
              1,
              Math.max(0, ((rear.x - a.x) * (b.x - a.x) + (rear.z - a.z) * (b.z - a.z)) / (len * len)),
            );
      const d = Math.hypot(a.x + (b.x - a.x) * t - rear.x, a.z + (b.z - a.z) * t - rear.z);
      if (d < best.d) best = { s: cum[i - 1] + len * t, d, i };
    }
    this.hint = best.i;
    const total = cum[cum.length - 1];
    const remaining = total - best.s;
    if (this.cusp) {
      const next = this.segments[this.seg + 1];
      const isStill = Math.abs(speed) < 0.08;
      this.dwell = isStill ? this.dwell + dt : 0;
      const steer = next ? this.steerTo(rear, next, 0, speed) : 0;
      if (this.dwell >= CUSP_DWELL) {
        this.seg++;
        this.hint = 1;
        this.cusp = false;
      }
      return { want: 0, steer, gear, done: this.isDone, lost: false, atCusp: true };
    }
    if (remaining < 0.12) {
      if (isLast) {
        this.seg++;
        return { want: gear > 0 ? FORWARD_PACE : 0, steer: 0, gear, done: true, lost: false, atCusp: false };
      }
      this.cusp = true;
      this.dwell = 0;
      return { want: 0, steer: 0, gear, done: false, lost: false, atCusp: true };
    }
    const pace = gear > 0 ? FORWARD_PACE : REVERSE_PACE;
    // Ease into each stop to change gear (0.5 m/s²); the last forward stretch runs on.
    const ease = isLast && gear > 0 ? pace : Math.sqrt(2 * 0.5 * Math.max(0, remaining - 0.05));
    const want = gear * Math.max(0.15, Math.min(pace, ease));
    const steer = this.steerTo(rear, pts, best.s, speed);
    return { want, steer, gear, done: false, lost: best.d > 1.3, atCusp: false };
  }

  /** Pure pursuit: the arc from the rear axle through the path point `look` metres on. */
  private steerTo(rear: Pose, pts: PathPose[], s: number, speed: number): number {
    const target = pointAlong(pts, s + LOOK);
    const f = forwardOf(rear.yaw);
    const dx = target.x - rear.x;
    const dz = target.z - rear.z;
    const left = dx * f.z - dz * f.x;
    const curvature = (2 * left) / Math.max(0.5, dx * dx + dz * dz);
    return Math.max(-1, Math.min(1, Math.atan(curvature * WHEELBASE) / steerLimit(Math.abs(speed))));
  }
}

/** Point `s` metres along a polyline, carried on straight past its end. */
function pointAlong(pts: readonly Pose[], s: number): { x: number; z: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (acc + len >= s && len > 1e-6) {
      const t = (s - acc) / len;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
      };
    }
    acc += len;
  }
  const a = pts[Math.max(0, pts.length - 2)];
  const b = pts[pts.length - 1];
  const len = Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z));
  const over = s - acc;
  // A one-point stretch: carry on along the heading (in the travel direction of its gear).
  if (pts.length < 2) return { x: b.x + Math.sin(b.yaw) * over, z: b.z + Math.cos(b.yaw) * over };
  return { x: b.x + ((b.x - a.x) / len) * over, z: b.z + ((b.z - a.z) / len) * over };
}

/**
 * Pedals for walking pace in either gear: the accelerator forward; backwards the brake pedal
 * without `brakeOnly`, which the car takes as reverse at a standstill (physics/vehicle.ts), and
 * the brake with `brakeOnly` to slow down.
 */
export function manoeuvrePedals(want: number, v: number, steer: number): DriveInput {
  const hold: DriveInput = { throttle: 0, brake: 1, steer, handbrake: false, brakeOnly: true };
  if (Math.abs(want) < 0.05) return hold;
  const isWrongWay = want > 0 ? v < -0.15 : v > 0.15;
  if (isWrongWay) return hold;
  const err = Math.abs(want) - Math.abs(v); // + = faster in the wanted direction
  if (err < -0.15) return { ...hold, brake: Math.min(1, 0.1 - err * 0.8) };
  if (want > 0)
    return {
      throttle: Math.min(0.35, Math.max(0, 0.08 + 0.3 * err)),
      brake: 0,
      steer,
      handbrake: false,
      brakeOnly: true,
    };
  return {
    throttle: 0,
    brake: Math.min(0.6, Math.max(0.05, 0.22 + 0.4 * err)),
    steer,
    handbrake: false,
    brakeOnly: false,
  };
}

/**
 * Stuck: pressing on (accelerator or reverse) for 1.5 s while the car has not moved 35 cm — against
 * a wall, a kerb, a pole or another car.
 */
export class StuckWatch {
  private still = 0;
  private readonly anchor = new Vector3(Infinity, 0, 0);

  update(dt: number, position: Vector3, isPushing: boolean): boolean {
    const hasMoved = Math.hypot(position.x - this.anchor.x, position.z - this.anchor.z) > 0.35;
    if (!isPushing || hasMoved) {
      this.anchor.copy(position);
      this.still = 0;
      return false;
    }
    this.still += dt;
    return this.still > 1.5;
  }

  reset(position?: Vector3): void {
    this.still = 0;
    if (position) this.anchor.copy(position);
    else this.anchor.set(Infinity, 0, 0);
  }
}

/** Whether a drive input presses on (accelerator, or the brake pedal as reverse). */
export const isPushing = (input: DriveInput) =>
  input.throttle > 0.08 || (input.brake > 0.1 && !input.brakeOnly);

/**
 * The fixed colliders around a pose (buildings, sign and signal poles, orbis gantries, parked
 * traffic cars): a Rapier box query of the car's body (12 cm to spare at the sides, 25 cm at the
 * ends, where a stop to change gear may run on) from 45 cm to 1.45 m
 * above the ground there, so the road, the 15 cm kerbs and the paving never count. Moving things
 * (vehicles, people) are left to the driver's own list of them. Why not shape casts along each arc:
 * a cast only sweeps a straight line without turning the box, and a box query every half metre
 * covers a 4.3 m car's swept path.
 */
export function rapierClearance(
  world: RAPIER.World,
  groundAt: (x: number, z: number) => number | null,
): (x: number, z: number, yaw: number) => boolean {
  const box = new RAPIER.Cuboid(HALF_WIDTH + MARGIN_SIDE, 0.5, HALF_LENGTH + MARGIN_END);
  const flags =
    RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
    RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  return (x, z, yaw) => {
    const ground = groundAt(x, z);
    if (ground === null) return true;
    const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    return world.intersectionWithShape({ x, y: ground + 0.95, z }, rotation, box, flags) === null;
  };
}

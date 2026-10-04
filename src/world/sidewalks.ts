import { Vector3 } from "three";
import type { Crossing } from "./regulations";
import { leftOf, type RoadGraph, type Segment } from "./roads";

/**
 * Where pedestrians walk: along the streets of the road graph on the pavement beside the
 * carriageway, round the corners at junctions, and across the road only at a crosswalk (the
 * JARTIC 横断歩道 when there is one near, else the junction mouth), waiting for the signal or
 * for the player's car. Streets narrower than 5.5 m have no pavement, so people keep to the
 * right-hand edge facing the traffic (道路交通法 第10条第1項).
 */
export type Walk = {
  seg: Segment;
  dir: 1 | -1;
  /** Which side of the segment's own direction (+1 left of from → to). */
  side: 1 | -1;
  s: number;
  lateral: number;
  leg: Leg | null;
};

type Leg = {
  points: Vector3[];
  i: number;
  /** Index of the far kerb: before heading there, wait until crossing is allowed. */
  crossTo: number;
  crossSeg: Segment | null;
  next: Omit<Walk, "leg">;
};

type Arm = { seg: Segment; leaves: boolean; dir: Vector3 };
type MouthCrossing = { points: Vector3[]; seg: Segment };

export type Step = { target: Vector3; waiting: boolean; face: Vector3 | null; crossing: boolean };

/** Signal lookup: null where no signal governs the spot (see TrafficControl.mayCross). */
export type CrossingSignal = (seg: Segment, near: Vector3) => boolean | null;
export type Car = { pos: Vector3; speed: number; forward: Vector3 };

const NARROW = 5.5;
const hash = (a: number, b: number) => (((a * 73856093) ^ (b * 19349663)) >>> 0) / 4294967296;

export class SidewalkNetwork {
  private readonly lateralCache = new Map<string, number>();
  private serial = 0;

  constructor(
    readonly graph: RoadGraph,
    private readonly crossings: Crossing[],
    private readonly mayCross: CrossingSignal,
    private readonly isOpen: (x: number, z: number) => boolean,
  ) {}

  /** Joins the nearest street within 25 m, on the side of it the person stands on. */
  attach(pos: Vector3, id: number): Walk | null {
    const hit = this.graph.nearest(pos, 25, isWalkable);
    if (!hit) return null;
    const seg = hit.seg;
    const side: 1 | -1 = hit.lateral >= 0 ? 1 : -1;
    // On a street without pavement, walk so that this edge is on the right (facing traffic).
    const dir: 1 | -1 = seg.line.width < NARROW ? (side === 1 ? -1 : 1) : hash(id, seg.id) < 0.5 ? 1 : -1;
    return { seg, dir, side, s: hit.s, lateral: this.lateralFor(seg, side, id), leg: null };
  }

  /** Point on the walking line of a street. */
  point(seg: Segment, s: number, side: 1 | -1, lateral: number, out = new Vector3()): Vector3 {
    const { pos, dir } = this.graph.sample(seg, s);
    return out.copy(pos).add(leftOf(dir, side * lateral));
  }

  /** Moves a walker on by `dist` metres and returns where they should be. */
  advance(w: Walk, dist: number, id: number, car: Car, current: Vector3): Step {
    if (w.leg) return this.followLeg(w, current, car);
    const from = w.s;
    w.s += w.dir * dist;
    const crossing = this.crossingPassed(w, from, id);
    if (crossing) return this.followLeg(w, current, car);
    const inset = this.endInset(w);
    const isAtEnd = w.dir === 1 ? w.s >= w.seg.length - inset : w.s <= inset;
    if (isAtEnd) {
      this.leaveStreet(w, id);
      if (w.leg) return this.followLeg(w, current, car);
    }
    return { target: this.point(w.seg, w.s, w.side, w.lateral), waiting: false, face: null, crossing: false };
  }

  /** Pavement offset from the centreline: beside the carriageway where that is open ground. */
  private lateralFor(seg: Segment, side: 1 | -1, id: number): number {
    const half = seg.line.width / 2;
    if (seg.line.width < NARROW) return Math.max(0.4, half - 0.5);
    const key = `${seg.id}:${side}`;
    let base = this.lateralCache.get(key);
    if (base === undefined) {
      base = half - 0.6; // no room beside the carriageway: keep to its edge
      for (const o of [1.6, 1.0, 0.6]) {
        const isClear = [0.25, 0.5, 0.75].every((t) => {
          const p = this.point(seg, seg.length * t, side, half + o);
          return this.isOpen(p.x, p.z);
        });
        if (isClear) {
          base = half + o;
          break;
        }
      }
      this.lateralCache.set(key, base);
    }
    // People spread a little across the pavement.
    return base > half ? base + (hash(id, 7) - 0.5) * 0.6 : base;
  }

  private endInset(w: Walk): number {
    return Math.min(w.seg.length / 2, this.endInsetAt(w.dir === 1 ? w.seg.to : w.seg.from, w.seg));
  }

  /** Mid-block 横断歩道 on this street: some people cross there. */
  private crossingPassed(w: Walk, from: number, id: number): boolean {
    for (const c of this.crossings) {
      if (c.seg !== w.seg) continue;
      const passed = w.dir === 1 ? from < c.s && w.s >= c.s : from > c.s && w.s <= c.s;
      if (!passed || hash(id, Math.round(c.s * 10) + c.seg.id) > 0.3) continue;
      const side: 1 | -1 = w.side === 1 ? -1 : 1;
      const half = c.seg.line.width / 2;
      const a = this.point(c.seg, c.s, w.side, half + 0.4);
      const b = this.point(c.seg, c.s, side, half + 0.4);
      const next = { seg: w.seg, dir: w.dir, side, s: c.s, lateral: this.lateralFor(w.seg, side, id) };
      w.leg = {
        points: [a, b, this.point(w.seg, c.s, side, next.lateral)],
        i: 0,
        crossTo: 1,
        crossSeg: c.seg,
        next,
      };
      return true;
    }
    return false;
  }

  /**
   * At the end of a street the walker stands on a corner between their street (arm A) and the
   * next arm round on their side (N). From there they turn the corner onto N, cross N's mouth to
   * the next corner (then walk on along N's far side or turn onto the arm after it), or cross
   * their own street. Each crossing spans exactly one road, at its crosswalk.
   */
  private leaveStreet(w: Walk, id: number): void {
    const node = w.dir === 1 ? w.seg.to : w.seg.from;
    const arms = this.arms(node);
    const a = arms.find((x) => x.seg === w.seg);
    if (!a || arms.length < 2) {
      w.dir = w.dir === 1 ? -1 : 1; // dead end: turn back
      return;
    }
    // Side of A as seen leaving the node (the walker faces into the node).
    const side = (a.leaves ? w.side : -w.side) as 1 | -1;
    const other = -side as 1 | -1;
    const n = this.neighbour(arms, a, side);
    const roll = hash(id, ++this.serial);
    if (arms.length === 2 || roll < 0.4) {
      this.onto(w, n, other, id, null);
      return;
    }
    if (roll < 0.8) {
      // Cross N, then walk on along its far side or round onto the arm after it.
      const after = this.neighbour(arms, n, side);
      const crossing = this.mouth(n, other);
      if (hash(id, this.serial * 5) < 0.5 || after === a) this.onto(w, n, side, id, crossing);
      else this.onto(w, after, other, id, crossing);
      return;
    }
    // Cross the street they came along and walk back down its other side.
    this.onto(w, a, other, id, this.mouth(a, side));
  }

  /** Where a street's pavement ends at a junction: the kerb line of the crossing roads. */
  private endInsetAt(node: number, seg: Segment): number {
    const ids = this.graph.nodes.get(node) ?? [];
    if (ids.length < 3) return 0.5;
    let widest = 0;
    for (const id of ids)
      if (this.graph.segments[id] !== seg) widest = Math.max(widest, this.graph.segments[id].line.width);
    return widest / 2 + 1.2;
  }

  /** Walkable arms at a node with their direction leaving it. */
  private arms(node: number): Arm[] {
    return (this.graph.nodes.get(node) ?? [])
      .map((i) => this.graph.segments[i])
      .filter(isWalkable)
      .map((seg) => {
        const leaves = seg.from === node;
        const s = leaves ? Math.min(3, seg.length) : Math.max(0, seg.length - 3);
        const dir = this.graph
          .sample(seg, s)
          .dir.clone()
          .multiplyScalar(leaves ? 1 : -1);
        return { seg, leaves, dir };
      });
  }

  /** The next arm round from `from` toward its `side` (+1 left, −1 right, seen leaving the node). */
  private neighbour(arms: Arm[], from: Arm, side: 1 | -1): Arm {
    let best = from;
    let bestAngle = Infinity;
    const left = leftOf(from.dir, 1);
    for (const arm of arms) {
      if (arm === from) continue;
      let angle = Math.atan2(left.dot(arm.dir) * side, from.dir.dot(arm.dir));
      if (angle <= 0) angle += Math.PI * 2;
      if (angle < bestAngle) {
        bestAngle = angle;
        best = arm;
      }
    }
    return best;
  }

  /**
   * Kerb-to-kerb crossing of an arm's mouth, starting from its `nearSide` (seen leaving the
   * node): the JARTIC 横断歩道 on that arm if one lies within 15 m of the pavement corner, else
   * where the corners end.
   */
  private mouth(arm: Arm, nearSide: 1 | -1): MouthCrossing {
    const seg = arm.seg;
    const node = arm.leaves ? seg.from : seg.to;
    const inset = Math.min(seg.length / 2, this.endInsetAt(node, seg));
    const fromNode = (x: number) => (arm.leaves ? x : seg.length - x);
    const c = this.crossings
      .filter((x) => x.seg === seg && fromNode(x.s) < inset + 15)
      .sort((x, y) => fromNode(x.s) - fromNode(y.s))[0];
    const s = c ? c.s : arm.leaves ? inset : seg.length - inset;
    const segSide = (k: 1 | -1) => (arm.leaves ? k : -k) as 1 | -1;
    const half = seg.line.width / 2 + 0.4;
    const near = this.point(seg, s, segSide(nearSide), half);
    const far = this.point(seg, s, segSide(-nearSide as 1 | -1), half);
    return { points: [near, far], seg };
  }

  /** Continue along `arm`, away from the node, on `side` (seen leaving the node). */
  private onto(w: Walk, arm: Arm, side: 1 | -1, id: number, crossing: MouthCrossing | null): void {
    const seg = arm.seg;
    const node = arm.leaves ? seg.from : seg.to;
    const inset = Math.min(seg.length / 2, this.endInsetAt(node, seg));
    const segSide = (arm.leaves ? side : -side) as 1 | -1;
    const lateral = this.lateralFor(seg, segSide, id);
    const s = arm.leaves ? inset : seg.length - inset;
    const next = { seg, dir: (arm.leaves ? 1 : -1) as 1 | -1, side: segSide, s, lateral };
    const start = this.point(seg, s, segSide, lateral);
    w.leg = crossing
      ? { points: [...crossing.points, start], i: 0, crossTo: 1, crossSeg: crossing.seg, next }
      : { points: [start], i: 0, crossTo: -1, crossSeg: null, next };
  }

  private followLeg(w: Walk, current: Vector3, car: Car): Step {
    const leg = w.leg as Leg;
    const target = leg.points[leg.i];
    const isThere = Math.hypot(target.x - current.x, target.z - current.z) < 0.35;
    if (isThere && leg.i + 1 === leg.crossTo && leg.crossSeg) {
      const far = leg.points[leg.crossTo];
      const mid = target.clone().add(far).multiplyScalar(0.5);
      if (!this.mayGo(leg.crossSeg, mid, car)) return { target, waiting: true, face: far, crossing: false };
    }
    if (isThere) {
      leg.i++;
      if (leg.i >= leg.points.length) {
        Object.assign(w, leg.next);
        w.leg = null;
        return {
          target: this.point(w.seg, w.s, w.side, w.lateral),
          waiting: false,
          face: null,
          crossing: false,
        };
      }
    }
    return { target: leg.points[leg.i], waiting: false, face: null, crossing: leg.i === leg.crossTo };
  }

  /** Green for walkers at a signal; elsewhere, only when the player's car is not bearing down. */
  private mayGo(seg: Segment, mid: Vector3, car: Car): boolean {
    const signal = this.mayCross(seg, mid);
    if (signal !== null) return signal;
    const to = mid.clone().sub(car.pos).setY(0);
    const isComing =
      car.speed > 2 && to.length() < 12 + car.speed * 2.5 && to.normalize().dot(car.forward) > 0.5;
    return !isComing;
  }
}

const isWalkable = (seg: Segment) => seg.line.kind !== "highway";

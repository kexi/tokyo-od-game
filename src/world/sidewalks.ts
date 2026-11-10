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
  /** 歩車分離's 斜め横断: the crossing goes corner to opposite corner on the diagonal's walk light. */
  diagonal?: boolean;
  /** Index of the 押ボタン箱 the walker goes to first and presses (-1: none on this crossing). */
  pressAt: number;
  next: Omit<Walk, "leg">;
};

type Arm = { seg: Segment; leaves: boolean; dir: Vector3 };
type MouthCrossing = { points: Vector3[]; seg: Segment | null; diagonal?: boolean };

export type Step = { target: Vector3; waiting: boolean; face: Vector3 | null; crossing: boolean };

/** Signal lookup: null where no signal governs the spot (see TrafficControl.mayCross). */
export type CrossingSignal = (seg: Segment, near: Vector3) => boolean | null;
/**
 * The 押ボタン of push-button crossings (TrafficControl.buttonStand / pressButton): where a walker
 * crossing `seg` at `near` from `kerb` stands to press it (null: no button), and the press.
 */
export type CrossingButton = {
  stand(seg: Segment, near: Vector3, kerb: Vector3): Vector3 | null;
  press(seg: Segment, near: Vector3): void;
};
const NO_BUTTONS: CrossingButton = { stand: () => null, press: () => undefined };
/**
 * 歩車分離 (TrafficControl.mayCrossDiagonal): whether a walker may start along the diagonal of the
 * scramble junction near `near` now; null where no scramble signal governs.
 */
export type DiagonalSignal = (near: Vector3, needS?: number) => boolean | null;
const NO_DIAGONAL: DiagonalSignal = () => null;
export type Car = { pos: Vector3; speed: number; forward: Vector3 };

const NARROW = 5.5;
/** A walker's pace when the caller gives none (m/s): the usual figure for planning crossings. */
const WALK_MPS = 1.3;
const hash = (a: number, b: number) => (((a * 73856093) ^ (b * 19349663)) >>> 0) / 4294967296;

export class SidewalkNetwork {
  private readonly lateralCache = new Map<string, number>();
  /** The pace of the walker being moved (advance's caller says it): how long a diagonal takes. */
  private speedMps = WALK_MPS;
  private serial = 0;

  constructor(
    readonly graph: RoadGraph,
    private readonly crossings: Crossing[],
    private readonly mayCross: CrossingSignal,
    private readonly isOpen: (x: number, z: number) => boolean,
    private readonly isPavement: (x: number, z: number) => boolean = () => false,
    private readonly buttons: CrossingButton = NO_BUTTONS,
    private readonly diagonal: DiagonalSignal = NO_DIAGONAL,
  ) {}

  forgetLaterals(): void {
    this.lateralCache.clear();
  }

  /**
   * Is (x, z) carriageway a pedestrian may only enter at a crossing? Streets of 5.5 m and more,
   * except where PLATEAU maps pavement and on streets closed to traffic (歩行者用道路).
   */
  isRoadway(x: number, z: number): boolean {
    if (this.isPavement(x, z)) return false;
    const p = new Vector3(x, 0, z);
    return this.graph.carriagewaysAt(p, -0.4).some((c) => c.seg.line.width >= NARROW && !c.seg.closed);
  }

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
  advance(w: Walk, dist: number, id: number, car: Car, current: Vector3, speedMps = WALK_MPS): Step {
    this.speedMps = speedMps;
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

  /**
   * Walking line offset from the centreline: the PLATEAU 歩道 strip when there is one, else just
   * beyond the carriageway where that is open ground, else the carriageway's edge.
   */
  private lateralFor(seg: Segment, side: 1 | -1, id: number): number {
    const half = seg.line.width / 2;
    if (seg.line.width < NARROW) return Math.max(0.4, half - 0.5);
    const key = `${seg.id}:${side}`;
    let base = this.lateralCache.get(key);
    if (base === undefined) {
      base = this.pavementLateral(seg, side) ?? this.besideCarriageway(seg, side);
      this.lateralCache.set(key, base);
    }
    const isEdge = base === half - 0.2;
    // People spread a little across the pavement.
    return isEdge ? base : base + (hash(id, 7) - 0.5) * 0.6;
  }

  private besideCarriageway(seg: Segment, side: 1 | -1): number {
    const half = seg.line.width / 2;
    for (const o of [1.6, 1.0, 0.6]) {
      const isClear = [0.25, 0.5, 0.75].every((t) => {
        const p = this.point(seg, seg.length * t, side, half + o);
        return this.isOpen(p.x, p.z);
      });
      if (isClear) return half + o;
    }
    // No room beside the carriageway: its very edge (still outside the roadway test).
    return half - 0.2;
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
      // At a push-button crossing, to the box on this end's pole first, then to the kerb.
      const stand = this.buttons.stand(c.seg, c.pos, a);
      const before = stand ? [stand] : [];
      w.leg = {
        points: [...before, a, b, this.point(w.seg, c.s, side, next.lateral)],
        i: 0,
        crossTo: before.length + 1,
        crossSeg: c.seg,
        diagonal: false,
        next,
        pressAt: stand ? 0 : -1,
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
    // 歩車分離: some go corner to opposite corner on the diagonal (斜め横断) — across N and the arm
    // after it in one walk — and walk on along that arm's far side.
    const after = this.neighbour(arms, n, side);
    const isScramble = arms.length >= 4 && after !== a && this.diagonal(this.nodePos(node)) !== null;
    const isDiagonal = isScramble && roll < 0.6;
    if (isDiagonal) {
      const from = this.mouth(n, other).points[0];
      const to = this.mouth(after, other).points[1];
      this.onto(w, after, side, id, { points: [from, to], seg: null, diagonal: true });
      return;
    }
    if (roll < 0.8) {
      // Cross N, then walk on along its far side or round onto the arm after it.
      const crossing = this.mouth(n, other);
      if (hash(id, this.serial * 5) < 0.5 || after === a) this.onto(w, n, side, id, crossing);
      else this.onto(w, after, other, id, crossing);
      return;
    }
    // Cross the street they came along and walk back down its other side.
    this.onto(w, a, other, id, this.mouth(a, side));
  }

  /**
   * The middle of a PLATEAU 歩道 strip beside this side of the street, scanning outwards from
   * the centreline (GSI 幅員 sometimes includes the pavement, sometimes not), or null if none.
   */
  private pavementLateral(seg: Segment, side: 1 | -1): number | null {
    const at = [0.25, 0.5, 0.75].map((t) => seg.length * t);
    let start: number | null = null;
    for (let l = 1; l <= seg.line.width / 2 + 8; l += 0.5) {
      const hits = at.filter((s) => {
        const p = this.point(seg, s, side, l);
        return this.isPavement(p.x, p.z);
      }).length;
      if (hits >= 2 && start === null) start = l;
      if (start !== null && (hits < 2 || l - start >= 3)) return start + Math.min(1.2, (l - start) / 2);
    }
    return null;
  }

  /** Where a graph node is (the end of one of its segments). */
  private nodePos(node: number): Vector3 {
    const id = this.graph.nodes.get(node)?.[0];
    if (id === undefined) return new Vector3();
    const seg = this.graph.segments[id];
    return (seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1]).clone();
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
    if (crossing) {
      w.leg = {
        points: [...crossing.points, start],
        i: 0,
        crossTo: 1,
        crossSeg: crossing.seg,
        diagonal: crossing.diagonal ?? false,
        next,
        pressAt: -1,
      };
      return;
    }
    // Round the corner on the pavement: via a point pushed out from the junction, not a chord
    // that could clip the carriageway.
    const centre = arm.leaves ? seg.pts[0] : seg.pts[seg.pts.length - 1];
    const here = this.point(w.seg, w.s, w.side, w.lateral);
    const a = here.clone().sub(centre).setY(0);
    const b = start.clone().sub(centre).setY(0);
    const out = a.clone().normalize().add(b.clone().normalize());
    const points = [start];
    if (out.lengthSq() > 0.05) {
      points.unshift(centre.clone().add(out.normalize().multiplyScalar(Math.max(a.length(), b.length()))));
    }
    w.leg = { points, i: 0, crossTo: -1, crossSeg: null, diagonal: false, next, pressAt: -1 };
  }

  private followLeg(w: Walk, current: Vector3, car: Car): Step {
    const leg = w.leg as Leg;
    const target = leg.points[leg.i];
    const isThere = Math.hypot(target.x - current.x, target.z - current.z) < 0.35;
    const crossMid = () => {
      const kerb = leg.points[leg.crossTo - 1];
      return kerb.clone().add(leg.points[leg.crossTo]).multiplyScalar(0.5);
    };
    const hasButton = leg.pressAt >= 0 && leg.crossSeg !== null;
    if (isThere && hasButton && leg.i === leg.pressAt && leg.crossSeg)
      this.buttons.press(leg.crossSeg, crossMid());
    const isAtDiagonalKerb = isThere && leg.diagonal && leg.i + 1 === leg.crossTo;
    const diagonalM = leg.crossTo > 0 ? leg.points[leg.crossTo - 1].distanceTo(leg.points[leg.crossTo]) : 0;
    const needS = diagonalM / Math.max(0.3, this.speedMps);
    if (isAtDiagonalKerb && !this.mayGoDiagonal(crossMid(), car, needS)) {
      return { target, waiting: true, face: leg.points[leg.crossTo], crossing: false };
    }
    if (isThere && leg.i + 1 === leg.crossTo && leg.crossSeg) {
      const far = leg.points[leg.crossTo];
      const mid = crossMid();
      if (!this.mayGo(leg.crossSeg, mid, car)) {
        // Pressed while waiting, whatever the leg: a press made while the last walk was still to
        // come was already served, and a walker who came without a box on their path (a box on
        // the other side of the pole, a leg begun before the network was rebuilt) would otherwise
        // wait at 赤 for good. A press at a crossing that is not push-button does nothing.
        this.buttons.press(leg.crossSeg, mid);
        return { target, waiting: true, face: far, crossing: false };
      }
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

  /** The diagonal's walk light at a scramble junction; dark or gone, as at an unsignalled crossing. */
  private mayGoDiagonal(mid: Vector3, car: Car, needS: number): boolean {
    const signal = this.diagonal(mid, needS);
    if (signal !== null) return signal;
    return this.isCarClear(mid, car);
  }

  /** Green for walkers at a signal; elsewhere, only when the player's car is not bearing down. */
  private mayGo(seg: Segment, mid: Vector3, car: Car): boolean {
    const signal = this.mayCross(seg, mid);
    if (signal !== null) return signal;
    return this.isCarClear(mid, car);
  }

  /** Whether the player's car is not bearing down on `mid`. */
  private isCarClear(mid: Vector3, car: Car): boolean {
    const to = mid.clone().sub(car.pos).setY(0);
    const isComing =
      car.speed > 2 && to.length() < 12 + car.speed * 2.5 && to.normalize().dot(car.forward) > 0.5;
    return !isComing;
  }
}

const isWalkable = (seg: Segment) => seg.line.kind !== "highway";

import { Vector3 } from "three";
import type { RoadGraph, Segment } from "../world/roads";
import type { TrafficControl } from "../world/trafficControl";
import type { Route } from "./navigation";

/**
 * 自動運転と他の交通: what the self-driving car makes of the vehicles round it. A vehicle stopped
 * ahead is either part of a queue (for a signal, a 一時停止, a junction, a jam: it will move, so
 * wait behind it) or a blockage (a parked car, a car that has stood with nothing in front of it for
 * a while: pass it where the law allows, 第17条第5項第3号). Plus the 車間距離 (第26条), the places
 * where passing is not allowed (第30条), the look at oncoming and following traffic before moving
 * across (第17条第5項・第26条の2第2項・第28条第4項), yielding at junctions (第36条・第37条・第43条)
 * and not entering a junction or a crosswalk it could not leave (第50条).
 */

/** A road user the driver can see, from the traffic and parking systems (read-only). */
export type DriveObstacle = {
  position: Vector3;
  /** vehicle: in traffic (it may move off); parked: left at the kerb (it will not); person: on foot. */
  kind: "vehicle" | "parked" | "person";
  /** Forward speed (m/s) and heading (atan2(x, z)). */
  speed?: number;
  heading?: number;
  /** Half its length: 2.25 m for a car, more for a bus or a truck. */
  halfLength?: number;
  /** The same thing from one look to the next (its scene object), to time how long it has stood. */
  key?: object;
};

/**
 * Half the length of a traffic model (vehicleModels.ts kinds, null: an ordinary car), from the
 * measured glb sizes (knowledge/large-vehicles-blender.md, police-vehicles-blender.md).
 */
export function halfLengthOf(kind: string | null): number {
  const halves: Record<string, number> = {
    bus: 5.25,
    truck10t: 6,
    truck8t: 4.4,
    motorbike: 1.05,
    patrol: 2.47,
    unmarked: 2.47,
    shirobai: 1.08,
  };
  return (kind && halves[kind]) || 2.25;
}

/** A 横断歩道 across a street: the street, the distance along it, the place. */
export type CrossingRef = { seg: Segment; s: number; pos: Vector3 };

/** An obstacle placed on the route: route distance of its centre and offset left of the driven path. */
export type Seen = {
  o: DriveObstacle;
  at: number;
  lateral: number;
  half: number;
  /** Speed along the route (+ the same way, − oncoming). */
  along: number;
  /** Seconds it has stood still (0 while moving). */
  stoppedFor: number;
};

export const OWN_HALF = 2.15;
const OWN_WIDTH_HALF = 0.92;
const OTHER_WIDTH_HALF = 0.95;
/** 側方間隔 kept to a parked or stopped car when passing (m between the bodies). */
export const SIDE_GAP = 0.6;
/** In our lane: closer to the path than our half width + theirs (and a little). */
export const IN_LANE = 1.7;
/** 停止時の車間 behind a car in a queue, and behind one that may have to be passed (room to pull out). */
export const QUEUE_GAP = 2.5;
export const PASS_GAP = 6;
/** Standing this long with nothing ahead of it to wait for: stalled (故障・事故・停車) — a blockage. */
export const STALL_SECONDS = 10;
/** 第30条第3号: no passing in a junction, at a crosswalk, or within 30 m before them. */
export const NO_PASS_BEFORE = 30;
const REACTION = 0.75; // s
const FOLLOW_DECEL = 4; // m/s², a firm stop
const PASS_SPEED = 4.5; // m/s while beside the obstacle (16 km/h: 側方間隔 is small)

/**
 * 第26条: the gap to the car ahead must let us stop if it stops suddenly — reaction plus braking,
 * v·0.75 s + v²/(2·4 m/s²): 37 m at 50 km/h (the textbook "speed − 15" is 35 m), 13 m at 25 km/h.
 * Returns the fastest speed (m/s) whose stopping distance fits in `gap` metres.
 */
export function followSpeed(gap: number): number {
  if (gap <= 0) return 0;
  const a = FOLLOW_DECEL;
  return Math.max(0, -a * REACTION + Math.sqrt(a * a * REACTION * REACTION + 2 * a * gap));
}

/** Route distance and signed offset (left +) of `p` on the driven path within [from, to]. */
export function placeOnRoute(
  route: Route,
  p: Vector3,
  from: number,
  to: number,
  /** A path index near `from` (the driver's progress), to start the search from. */
  hint = 1,
): { at: number; lateral: number; dir: Vector3; dist: number } | null {
  let best: { at: number; lateral: number; d: number; i: number } | null = null;
  let i = Math.max(1, Math.min(hint, route.cum.length - 1));
  while (i > 1 && route.cum[i - 1] > from) i--;
  while (i < route.cum.length - 1 && route.cum[i] < from) i++;
  for (; i < route.points.length && route.cum[i - 1] <= to; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) continue;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (len * len)));
    const cx = a.x + ex * t;
    const cz = a.z + ez * t;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (best && d >= best.d) continue;
    // Left of travel (dx, dz) is (dz, −dx) in this frame.
    const lateral = ((p.x - cx) * ez - (p.z - cz) * ex) / len;
    best = { at: route.cum[i - 1] + (route.cum[i] - route.cum[i - 1]) * t, lateral, d, i };
  }
  if (!best) return null;
  const a = route.points[best.i - 1];
  const b = route.points[best.i];
  // `dist` > |lateral|: the point lies off either end of the window, not beside the path.
  return { at: best.at, lateral: best.lateral, dir: b.clone().sub(a).setY(0).normalize(), dist: best.d };
}

/** A junction on the route ahead: where it is (route distance of its node), its half size. */
export type JunctionAhead = {
  at: number;
  node: number;
  pos: Vector3;
  /** Half the width of the widest crossing street: the box is at ± this from the node. */
  half: number;
  /** Arriving street and direction. */
  inSeg: Segment;
  inDir: Vector3;
  /** Other streets at the node (for priority, 第36条). */
  others: Segment[];
  /** Signalled for us (交通整理の行われている交差点). */
  signalled: boolean;
};

/** Junctions (nodes of three or more streets) on the route between `from` and `to`. */
export function junctionsAhead(
  route: Route,
  graph: RoadGraph,
  control: TrafficControl,
  from: number,
  to: number,
): JunctionAhead[] {
  const out: JunctionAhead[] = [];
  for (let k = 1; k < route.steps.length; k++) {
    const at = route.stepStart[k];
    if (at < from) continue;
    if (at > to) break;
    const prev = route.steps[k - 1];
    const node = prev.dir === 1 ? prev.seg.to : prev.seg.from;
    const ids = graph.nodes.get(node) ?? [];
    if (ids.length < 3) continue;
    const others = ids
      .map((id) => graph.segments[id])
      .filter((s) => s !== prev.seg && s !== route.steps[k].seg);
    const half = Math.max(3, ...others.map((s) => s.line.width / 2));
    const pos = prev.dir === 1 ? prev.seg.pts[prev.seg.pts.length - 1] : prev.seg.pts[0];
    const before = prev.dir === 1 ? prev.seg.pts[prev.seg.pts.length - 2] : prev.seg.pts[1];
    const inDir = pos.clone().sub(before).setY(0).normalize();
    // The stop line of a signal for this approach stands just before the box.
    const travelEnd = route.stepEntry[k - 1] + (at - route.stepStart[k - 1]);
    const stop = control.nextStop(prev.seg, prev.dir, Math.max(0, travelEnd - 40));
    const signalled = stop !== null && stop.approach.kind === "signal" && stop.dist < 45;
    out.push({ at, node, pos, half, inSeg: prev.seg, inDir, others, signalled });
  }
  return out;
}

/** Crosswalks across the route's streets between `from` and `to` (route distance, exact). */
export function crossingsAhead(
  route: Route,
  crossings: readonly CrossingRef[],
  from: number,
  to: number,
): number[] {
  const out: number[] = [];
  for (const c of crossings) {
    route.steps.forEach((st, k) => {
      if (st.seg !== c.seg) return;
      const travel = st.dir === 1 ? c.s : st.seg.length - c.s;
      const at = route.stepStart[k] + (travel - route.stepEntry[k]);
      const end = k + 1 < route.stepStart.length ? route.stepStart[k + 1] : route.length;
      const isOnStep = at >= route.stepStart[k] - 0.5 && at <= end + 0.5;
      if (isOnStep && at >= from && at <= to) out.push(at);
    });
  }
  return out.toSorted((a, b) => a - b);
}

export type Verdict =
  | { kind: "clear" }
  /** Moving along ahead of us, or stopped for a reason: wait behind it. */
  | { kind: "queue"; leader: Seen }
  /** Stopped with nothing to wait for (parked, stalled): pass all of `chain` if the law allows. */
  | { kind: "blockage"; leader: Seen; chain: Seen[] }
  /** Stopped, reason unknown yet: wait well back (room to pull out) and watch. */
  | { kind: "unsure"; leader: Seen };

/**
 * What the nearest vehicle in our lane ahead is doing. Stopped vehicles are followed forward to
 * the head of their line. A parked head (and a line of parked cars) is a blockage at once: it will
 * not move, wherever it stands. Otherwise a head stopped at a red/yellow light or a 一時停止, near a
 * junction or a crosswalk, or behind a person, makes a queue; one that has stood STALL_SECONDS with
 * none of those is stalled, and the line a blockage once all of it has stood that long (cars waiting
 * behind a parked car do not pass it here, so they stay put too). Anything moving along with us is
 * traffic to follow.
 */
export function judgeAhead(
  inLane: readonly Seen[],
  isWaitingPoint: (at: number) => boolean,
  people: readonly number[],
): Verdict {
  const leader = inLane[0];
  if (!leader) return { kind: "clear" };
  const isMoving = (s: Seen) => s.o.kind !== "parked" && s.along > 1;
  if (isMoving(leader)) return { kind: "queue", leader };
  const chain: Seen[] = [leader];
  for (const next of inLane.slice(1)) {
    const head = chain[chain.length - 1];
    const gap = next.at - next.half - (head.at + head.half);
    if (gap > 12) break;
    // Traffic moving off ahead of the line: a jam that is clearing.
    if (isMoving(next)) return { kind: "queue", leader };
    chain.push(next);
  }
  const head = chain[chain.length - 1];
  const isLineStuck = chain.every((s) => s.o.kind === "parked" || s.stoppedFor >= STALL_SECONDS);
  const isAllParked = chain.every((s) => s.o.kind === "parked");
  if (isAllParked) return { kind: "blockage", leader, chain };
  const isPersonAhead = people.some((at) => at > head.at && at - head.at < head.half + 8);
  if (isPersonAhead || isWaitingPoint(head.at + head.half)) return { kind: "queue", leader };
  if (isLineStuck) return { kind: "blockage", leader, chain };
  return { kind: "unsure", leader };
}

export type PassPlan = {
  /** Lateral shift (m, negative = to the right) that clears the line by SIDE_GAP. */
  shift: number;
  /** Route distance where the car can turn back in: past the head with the rear clear. */
  endAt: number;
};

/**
 * Whether and how to pass a blockage (第17条第5項第3号: 障害のため左側部分を通行することが
 * できないとき, はみ出しはできるだけ少なく), checking what the game can model:
 * - 第30条: not in a junction, at a crosswalk, or within 30 m before them (applied to stalled and
 *   parked vehicles alike: the conservative reading), nor round a corner of the route;
 * - the body stays on the carriageway after the shift;
 * - 第17条第5項・第28条第4項: oncoming traffic clear for the whole pass with time to spare, and
 *   nothing stopped in the way on the right;
 * - 第26条の2第2項・第29条: no vehicle coming up from behind (or already passing) where it moves to.
 * Returns why not, or the plan.
 */
export function passPlan(args: {
  at: number;
  speed: number;
  chain: readonly Seen[];
  others: readonly Seen[];
  junctions: readonly JunctionAhead[];
  crossings: readonly number[];
  route: Route;
  /** Offset of the lane we drive in, left of the centreline (m), and the street there. */
  laneOffset: number;
  seg: Segment;
}): PassPlan | { why: "place" | "corner" | "width" | "oncoming" | "behind" } {
  const { at, chain, others, route, seg } = args;
  const head = chain[chain.length - 1];
  const shift = Math.min(
    0,
    Math.min(...chain.map((s) => s.lateral)) - (OTHER_WIDTH_HALF + OWN_WIDTH_HALF + SIDE_GAP),
  );
  const endAt = head.at + head.half + OWN_HALF + 2;
  // The whole pass: from pulling out (now) to being back in the lane (~10 m after endAt).
  const passEnd = endAt + 10;
  const isInZone = (start: number, end: number) => at < end && passEnd > start;
  const isNearJunction = args.junctions.some((j) => isInZone(j.at - j.half - NO_PASS_BEFORE, j.at + j.half));
  const isNearCrossing = args.crossings.some((c) => isInZone(c - 2 - NO_PASS_BEFORE, c + 2));
  if (isNearJunction || isNearCrossing) return { why: "place" };
  // 道路の曲がり角付近 (第30条第1号): any turn or a bend sharper than a gentle curve.
  const isCorner = route.corners.some(
    (c) => c.from < passEnd && c.to > at && (c.kind !== "bend" || c.radius < 60),
  );
  if (isCorner) return { why: "corner" };
  // The body's right edge after the shift must stay on the carriageway (a margin to the kerb).
  const rightEdge = args.laneOffset + shift - OWN_WIDTH_HALF;
  if (rightEdge < -seg.line.width / 2 + 0.3) return { why: "width" };
  // Band we sweep while beside the line: our centre at `shift` from the path.
  const lo = shift - OWN_WIDTH_HALF - OTHER_WIDTH_HALF - 0.3;
  const hi = shift + OWN_WIDTH_HALF + OTHER_WIDTH_HALF + 0.3;
  const isInBand = (s: Seen) => s.lateral > lo && s.lateral < hi;
  // Time for the pass: signal 3 s, out, beside, signal 3 s, back (施行令 第21条).
  const seconds = 6 + (passEnd - at) / PASS_SPEED;
  for (const s of others) {
    if (chain.includes(s)) continue;
    const isOncoming = s.along < -0.5;
    if (isOncoming && s.at > at) {
      // It must still be beyond the end of the pass when we are done, with 20 m to spare.
      const reach = s.at - -s.along * seconds;
      if (reach < passEnd + 20) return { why: "oncoming" };
      continue;
    }
    // Stopped or slow (a person too) where we would drive: no way through.
    const isInTheWay = isInBand(s) && s.at > at - OWN_HALF && s.at < passEnd + 5 && s.along < PASS_SPEED;
    if (isInTheWay) return { why: "oncoming" };
    // Coming up behind on the right faster than we will be (第26条の2第2項), or passing already (第29条).
    const isBehind = isInBand(s) && s.at < at && s.at > at - 50 && s.along > args.speed + 0.5;
    if (isBehind) return { why: "behind" };
  }
  return { shift, endAt };
}

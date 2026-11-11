import { Vector3 } from "three";
import { laneCentreOffset, laneWidth } from "../world/laneChange";
import { onTrunk, runOf, type LaneLink } from "../world/laneLinks";
import type { RoadGraph, Segment } from "../world/roads";
import { brakeNeeded, MERGE_LAW } from "./expresswayLaw";
import type { Route } from "./navigation";

/**
 * 合流 on the expressway, for the self-driving car (autoDriver.ts) and the traffic AI
 * (traffic-ai.ts): on the ramp's last stretch the car matches its speed to the main line's and
 * comes in only into a gap, letting by every main-line car it would otherwise make brake
 * (道路交通法 第75条の6第1項: 本線車道を通行する自動車の進行妨害をしてはならない). The test of a gap
 * is the one the law check books (expresswayLaw.ts judgeMerge), with a margin, so a car that
 * yields as this says is never booked for it.
 */

/** A main-line vehicle approaching the merge point. */
export type MainCar = {
  /** Metres before the merge point along the main line (negative: past it). */
  toMerge: number;
  /** Its speed (m/s). */
  speed: number;
  /** Half its length (m). */
  half: number;
};

/** How far before the merge point the gap is looked for (m). */
export const MERGE_LOOK_M = 150;
/** Half the merging car's length (m). */
const OWN_HALF = 2.25;
/** The merging car keeps at least this much more than the follower's reaction distance (m). */
const MARGIN_M = 6;
/** A follower may have to ease off this much at most (m/s², well under the 急ブレーキ of the check). */
const EASE_MS2 = 1.5;
/** Closer than this to the merge point a car still in conflict stops at the end of the ramp (m). */
const STOP_BEFORE_M = 12;
/** A main-line car ahead at the merge point with at least this gap to the car's front is not in the way (m). */
const AHEAD_CLEAR_M = 2;
/**
 * How far before the node the ramp's lane runs beside the main line's, where the graph cannot tell
 * (taperOf measures it per merge: 72–83 m at the test section's entrances, P6 review).
 */
const TAPER_M = 25;
/** Slowest progress assumed on the way to the merge point (m/s): a standing car moves off. */
const MIN_PROGRESS = 4;

/**
 * The speed (m/s) to approach a merge point `toMerge` metres ahead at, and whether that is giving
 * way: arriving at `speed`, each main-line car that would then be behind the car closer than its
 * reaction distance and a margin, or have to brake more than EASE_MS2, is let by first (the car
 * arrives no sooner than the follower's back plus a following gap has passed). Infinity when
 * nothing is in the way or the merge is still farther than MERGE_LOOK_M.
 */
export function mergeSpeedCap(
  toMerge: number,
  speed: number,
  cars: readonly MainCar[],
  /** How far before the node the ramp's lane meets the main line's (taperOf), m. */
  taper = TAPER_M,
): { cap: number; yielding: boolean } {
  const isFar = toMerge > MERGE_LOOK_M + taper;
  if (isFar) return { cap: Infinity, yielding: false };
  // Where the ramp's lane starts to run beside the main line's (the taper), the cars are side by
  // side already: the gap is judged there, not at the node.
  const toZone = Math.max(0, toMerge - taper);
  const arriveIn = toZone / Math.max(speed, MIN_PROGRESS);
  const aheadClear = Math.max(AHEAD_CLEAR_M, speed * 0.5);
  let cap = Infinity;
  for (const raw of cars) {
    const car = { ...raw, toMerge: raw.toMerge - taper };
    const isLongPast = car.toMerge < -(car.half + OWN_HALF + 40);
    // A main-line car standing in a queue is no gap to wait for: the ramp's car follows the queue
    // in when it moves (zip). Waiting for it to pass would wait for ever.
    const isStandingMainCar = car.speed < 1;
    if (isLongPast || isStandingMainCar) continue;
    // Where its centre is when the merging car reaches the merge point: + still before it (behind).
    const rel = car.toMerge - car.speed * arriveIn;
    const halves = car.half + OWN_HALF;
    const isAhead = rel <= 0;
    // Ahead of the car with a bumper or two between them: it follows that car in (第26条 is the
    // follower's business once in the lane).
    const isClearAhead = isAhead && -rel - halves >= aheadClear;
    if (isClearAhead) continue;
    const behind = rel - halves;
    const room = car.speed * MERGE_LAW.reactionS + MARGIN_M;
    const isGap =
      !isAhead && behind >= room && brakeNeeded(speed, { gapM: behind, speed: car.speed }) <= EASE_MS2;
    if (isGap) continue;
    // Let it by: arrive once its back and a following gap are past the merge point.
    const clear = car.toMerge + car.half + OWN_HALF + speed * MERGE_LAW.reactionS + 4;
    const passIn = clear / Math.max(car.speed, 1);
    cap = Math.min(cap, toZone / Math.max(passIn, 1e-3));
    if (toZone < STOP_BEFORE_M) cap = 0;
  }
  return { cap, yielding: cap < Infinity };
}

/** A vehicle about, as the drivers see it (position, heading atan2(x, z), speed m/s, half length). */
export type Other = { position: Vector3; heading: number; speed: number; half: number };

/**
 * The vehicles in a merge's main-line lane `lane` near it, placed along the main line's own
 * polyline (laneLinks.ts onTrunk: the distance follows the curves, the height its surface): in the
 * lane (centre within 1.9 m of the lane's), on its level (2.5 m) and going its way.
 */
export function mainCarsAt(
  graph: RoadGraph,
  link: LaneLink,
  others: readonly Other[],
  lane: number,
): MainCar[] {
  if (link.trunk === null) return [];
  const centre = laneCentreOffset(graph.segments[link.trunk], lane);
  const out: MainCar[] = [];
  for (const o of others) {
    const at = onTrunk(graph, link, o.position);
    if (!at) continue;
    const isInLane = Math.abs(at.lateral - centre) < 1.9;
    const isOnLevel = at.surfaceY === null || Math.abs(o.position.y - at.surfaceY) < SAME_LEVEL_M;
    const isAligned = Math.sin(o.heading) * at.dir.x + Math.cos(o.heading) * at.dir.z > 0.7;
    if (!isInLane || !isOnLevel || !isAligned) continue;
    out.push({ toMerge: at.toNode, speed: o.speed, half: o.half });
  }
  return out;
}

/** A car's body stands this far above the deck at most (ride height and the slope under it, m). */
const SAME_LEVEL_M = 2.5;

const tapers = new WeakMap<LaneLink, number>();
/**
 * How far before the node a merge's ramp lane comes to run beside the main line's lane (m): the
 * last point, walking back up the ramp, where its centre is within one lane width of the merge
 * lane's centre. In the data 72–83 m (the OSM lines taper the ramp in); TAPER_M where it cannot
 * be told.
 */
export function taperOf(graph: RoadGraph, link: LaneLink): number {
  const cached = tapers.get(link);
  if (cached !== undefined) return cached;
  const trunk = link.trunk === null ? null : graph.segments[link.trunk];
  let taper = TAPER_M;
  if (trunk) {
    const centre = laneCentreOffset(trunk, link.toLane);
    // Walking back up the ramp over its chunks (a ramp's last chunk can be shorter than the taper).
    let ramp: Segment | undefined = graph.segments[link.from];
    let behind = 0;
    walk: for (let hop = 0; ramp && hop < 4; hop++) {
      const here: Segment = ramp;
      const width = Math.max(laneWidth(trunk), laneWidth(here));
      for (let back = 0; back <= here.length; back += 2) {
        const s = here.oneway === -1 ? back : here.length - back;
        const at = onTrunk(graph, link, graph.sample(here, s).pos);
        const isBeside = at !== null && Math.abs(at.lateral - centre) <= width;
        if (!isBeside) break walk;
        taper = behind + back;
      }
      behind += here.length;
      const start = here.oneway === -1 ? here.to : here.from;
      ramp = (graph.nodes.get(start) ?? [])
        .map((id) => graph.segments[id])
        .find((o) => o !== here && runOf(o) === runOf(here));
    }
  }
  tapers.set(link, taper);
  return taper;
}

/** Sideways grip a driver keeps to on the expressway's curves (m/s²): as round a street's bends. */
const BEND_LATERAL = 2.5;
/** Braking for a curve ahead (m/s²). */
const BEND_BRAKE = 2;
/** Each look at the curvature spans this much path (m). */
const BEND_WINDOW = 15;

/**
 * The speed (m/s) the expressway's curves ahead on the route's driven path allow: over the next
 * 150 m, the turn of the path over each BEND_WINDOW gives a radius, and the car is at most at
 * √(a·R) there, braking in time. Why not drivePath's corners: a chunk bends in many kinks of a
 * degree or two, below what drivePath rounds, so the car would take a 20 km/h ramp at the limit.
 */
export function bendSpeedAhead(route: Route, at: number): number {
  let v = Infinity;
  const end = Math.min(route.length - BEND_WINDOW, at + 150);
  const cursor = { i: 1 };
  while (cursor.i < route.cum.length - 1 && route.cum[cursor.i] < at) cursor.i++;
  for (let d = at; d <= end; d += 5) {
    const a = pointAt(route, d, { ...cursor });
    const b = pointAt(route, d + BEND_WINDOW / 2, { ...cursor });
    const c = pointAt(route, d + BEND_WINDOW, { ...cursor });
    while (cursor.i < route.cum.length - 1 && route.cum[cursor.i] < d + 5) cursor.i++;
    const h1 = Math.atan2(b.x - a.x, b.z - a.z);
    const h2 = Math.atan2(c.x - b.x, c.z - b.z);
    const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
    const span = a.distanceTo(c);
    const isStraight = turn < 1e-3 || span < 1;
    if (isStraight) continue;
    const radius = span / turn;
    const vBend = Math.sqrt(BEND_LATERAL * radius);
    const ahead = Math.max(0, d - at);
    v = Math.min(v, Math.sqrt(vBend * vBend + 2 * BEND_BRAKE * ahead));
  }
  return v;
}

/** The path point at route distance d, searching on from `from.i` (a point at or before it). */
function pointAt(route: Route, d: number, from: { i: number }): Vector3 {
  let i = Math.max(1, from.i - 1);
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.points[i - 1];
  const b = route.points[i];
  const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
  return a.clone().lerp(b, Math.min(1, Math.max(0, t)));
}

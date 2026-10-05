import { Vector3 } from "three";
import type { RouteInfo } from "../world/guidePlan";
import type { RoadGraph, Segment } from "../world/roads";
import type { Route, TravelMode } from "./navigation";

/**
 * The way ahead of the player as stretches of streets, for what the nav panel tells about it
 * (junction names, 一時停止, オービス, limits, closures): along the route when there is one, along
 * the street being followed when there is not.
 *
 * A step covers `length` metres of `seg` in the travel direction `dir`, from `entry` metres along
 * the street (measured in the travel direction), and begins `start` metres from the player (≤ 0
 * for the street the player is on). A point `x` metres along the street (travel direction) is
 * `start + x - entry` metres ahead.
 */
export type AheadStep = { seg: Segment; dir: 1 | -1; start: number; entry: number; length: number };

/** A name on the map (交差点名 from OSM signal or junction=yes nodes). */
export type NamedPoint = { pos: Vector3; name: string };

/** Metres along a street in the travel direction for the along-coordinates distance `s`. */
export const travelOf = (seg: Segment, dir: 1 | -1, s: number): number => (dir === 1 ? s : seg.length - s);

/** Metres ahead of the player of the point `x` metres along the step's street, or null off the step. */
export function distanceOn(step: AheadStep, x: number): number | null {
  const isOnStep = x >= step.entry - 0.5 && x <= step.entry + step.length + 0.5;
  if (!isOnStep) return null;
  return step.start + x - step.entry;
}

/** The node a step arrives at. */
export const endNode = (step: { seg: Segment; dir: 1 | -1 }): number =>
  step.dir === 1 ? step.seg.to : step.seg.from;

/** Position of a graph node (y = 0), or null for a node without streets. */
export function nodePos(graph: RoadGraph, node: number): Vector3 | null {
  const id = graph.nodes.get(node)?.[0];
  if (id === undefined) return null;
  const seg = graph.segments[id];
  return (seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1]).clone();
}

/** The route from route distance `at` on, as far as `range` metres. */
export function routeAhead(route: Route, at: number, range: number): AheadStep[] {
  const steps: AheadStep[] = [];
  for (let k = 0; k < route.steps.length; k++) {
    const begin = route.stepStart[k];
    const end = k + 1 < route.steps.length ? route.stepStart[k + 1] : route.length;
    if (end <= at) continue;
    if (begin - at > range) break;
    const { seg, dir } = route.steps[k];
    steps.push({ seg, dir, start: begin - at, entry: route.stepEntry[k], length: end - begin });
  }
  return steps;
}

const DEG = Math.PI / 180;
const FOLLOW_MAX_TURN = 40; // a continuation turning more than this is a turn, not the same street
const SAME_ROAD_BONUS = 15; // degrees: the same numbered or named road wins over a straighter side street

/** Unit travel direction where a step leaves its start (atEnd false) or reaches its end (true). */
export function travelDir(graph: RoadGraph, seg: Segment, dir: 1 | -1, atEnd: boolean): Vector3 {
  const s = atEnd === (dir === 1) ? Math.max(0, seg.length - 2) : Math.min(2, seg.length);
  return graph.sample(seg, s).dir.clone().multiplyScalar(dir);
}

/**
 * Where the player's street leads with no route: at each junction the way on that turns least
 * (under 40°, the same numbered or named road first), as far as `range` metres or a dead end.
 * Closed streets are kept (the panel warns of them); by car one-way streets are only entered the
 * right way.
 */
export function roadAhead(
  graph: RoadGraph,
  from: { seg: Segment; s: number; dir: 1 | -1 },
  range: number,
  opts: { mode: TravelMode; routes?: ReadonlyMap<number, RouteInfo> },
): AheadStep[] {
  const steps: AheadStep[] = [];
  const seen = new Set<number>();
  const key = opts.routes?.get(from.seg.id)?.key ?? "";
  let seg = from.seg;
  let dir = from.dir;
  let entry = travelOf(seg, dir, from.s);
  let start = 0;
  while (start < range && !seen.has(seg.id)) {
    seen.add(seg.id);
    const length = Math.max(0, seg.length - entry);
    steps.push({ seg, dir, start, entry, length });
    start += length;
    const end = endNode({ seg, dir });
    const out = travelDir(graph, seg, dir, true);
    let best: { seg: Segment; dir: 1 | -1; score: number } | null = null;
    for (const id of graph.nodes.get(end) ?? []) {
      const next = graph.segments[id];
      if (next === seg || next.line.kind === "highway") continue;
      const nextDir: 1 | -1 = next.from === end ? 1 : -1;
      const isAgainstOneway = opts.mode === "car" && next.oneway !== 0 && next.oneway !== nextDir;
      if (isAgainstOneway) continue;
      const cos = Math.max(-1, Math.min(1, travelDir(graph, next, nextDir, false).dot(out)));
      const turn = Math.acos(cos) / DEG;
      const isSameRoad = key !== "" && opts.routes?.get(next.id)?.key === key;
      const score = turn - (isSameRoad ? SAME_ROAD_BONUS : 0);
      const isBetter = !best || score < best.score;
      if (turn < FOLLOW_MAX_TURN && isBetter) best = { seg: next, dir: nextDir, score };
    }
    if (!best) break;
    seg = best.seg;
    dir = best.dir;
    entry = 0;
  }
  return steps;
}

/**
 * 交差点名 near a point, as car navigation reads it ("日比谷" → "日比谷交差点"). 60 m by default:
 * big junctions are boxes of several GSI nodes and the name sits on one signal or junction node.
 */
export function junctionLabel(names: readonly NamedPoint[], pos: Vector3, radius = 60): string | null {
  let best: string | null = null;
  let bestD = radius;
  for (const n of names) {
    const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
    if (d >= bestD) continue;
    bestD = d;
    best = n.name;
  }
  if (!best) return null;
  return best.endsWith("交差点") ? best : `${best}交差点`;
}

/**
 * Named junctions along the way ahead (the junction nodes the steps arrive at), nearest first,
 * each name once, at most `max` within `range` metres. 40 m: closer than the turn lookup, so a
 * name across a short side street is not given to this junction.
 */
export function junctionsAhead(
  graph: RoadGraph,
  steps: readonly AheadStep[],
  names: readonly NamedPoint[],
  max = 3,
  range = 1000,
): Array<{ distance: number; name: string; pos: Vector3 }> {
  const out: Array<{ distance: number; name: string; pos: Vector3 }> = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const distance = step.start + step.length;
    if (distance > range || out.length >= max) break;
    if (distance < 5) continue;
    const node = endNode(step);
    const isJunction = (graph.nodes.get(node)?.length ?? 0) >= 3;
    if (!isJunction) continue;
    const pos = nodePos(graph, node);
    const name = pos ? junctionLabel(names, pos, 40) : null;
    if (!pos || !name || seen.has(name)) continue;
    seen.add(name);
    out.push({ distance, name, pos });
  }
  return out;
}

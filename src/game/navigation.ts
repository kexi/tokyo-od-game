import { Vector3 } from "three";
import { isInForce, type LaneDirection, type LaneUse, type TurnRule } from "../world/regulations";
import type { GameClock } from "../world/ruleTime";
import { leftOf, type RoadGraph, type Segment } from "../world/roads";
import { drivePath, type Corner, type LanePlan } from "./drivePath";

/**
 * カーナビ: a legal route over the road graph around the player and turn-by-turn guidance
 * ("およそ 300 メートル先、右方向です"). Routes obey one-way streets and 通行禁止 (with their time
 * windows, days and exclusions, via RoadGraph.setClock) and 指定方向外進行禁止 in force, so
 * following the guidance never books a violation. The graph only covers the area around the player; a farther target is routed to
 * the reachable road closest to it, and the route is planned again as the graph moves along.
 */
export type Turn = "straight" | "slightLeft" | "left" | "slightRight" | "right" | "uturn";
export type Step = { seg: Segment; dir: 1 | -1 };
/** A turn to announce: route distance of its node, the node, and the travel direction arriving. */
export type Maneuver = { at: number; turn: Turn; pos: Vector3; node: number; dir: Vector3 };
export type Route = {
  steps: Step[];
  maneuvers: Maneuver[];
  /**
   * The way to go, from the start position to the end. By car the driven path (drivePath): in the
   * lane and round each corner the way 第34条 has it; on foot the streets' centrelines.
   */
  points: Vector3[];
  /** Route distance at each point, measured along the centrelines (what `at` and maneuvers use). */
  cum: number[];
  /** Index into `steps` for each point (a junction point belongs to the step it leaves). */
  stepOf: number[];
  /** The lane planned at each point (all 0 on foot). */
  lanes: LanePlan[];
  /** The rounded corners, by route distance. */
  corners: Corner[];
  /** レーン案内 for the 進行方向別通行区分 approaches on the route (car routes). */
  hints: LaneHint[];
  /** Route distance where each step starts, and the travel distance along its segment there. */
  stepStart: number[];
  stepEntry: number[];
  length: number;
  /** False when the target lies outside the graph and the route ends at the nearest road. */
  reachesTarget: boolean;
};

/** Turn class the law checks use (指定方向外進行禁止 masks): 1 left, 2 straight, 4 right. */
export function turnBit(tIn: Vector3, tOut: Vector3): number {
  const side = leftOf(tIn, 1).dot(tOut);
  return side > 0.57 ? 1 : side < -0.57 ? 4 : 2;
}

/** Finer class for guidance: the angle between the incoming and outgoing directions. */
export function classifyTurn(tIn: Vector3, tOut: Vector3): Turn {
  const angle = (Math.atan2(leftOf(tIn, 1).dot(tOut), tIn.dot(tOut)) * 180) / Math.PI; // + = left
  if (Math.abs(angle) > 150) return "uturn";
  if (angle > 50) return "left";
  if (angle > 22) return "slightLeft";
  if (angle < -50) return "right";
  if (angle < -22) return "slightRight";
  return "straight";
}

/**
 * レーン案内 at a junction on the route: the lanes of a 進行方向別通行区分 approach (left first),
 * which of them lead the route's way, and the way it goes there.
 */
export type LaneHint = {
  at: number;
  node: number;
  /** The approach (the step that arrives at the junction). */
  seg: Segment;
  dir: 1 | -1;
  lanes: LaneDirection[][];
  ok: boolean[];
  take: Turn;
};

/** Lane (0 = leftmost) a point is in on a designated approach of `n` lanes. */
export function laneIndex(graph: RoadGraph, seg: Segment, dir: 1 | -1, n: number, p: Vector3): number {
  const leftOfTravel = graph.nearestOn(seg, p).lateral * dir;
  const span = seg.oneway === 0 ? seg.line.width / 2 : seg.line.width;
  const lane = Math.floor((seg.line.width / 2 - leftOfTravel) / (span / n));
  return Math.max(0, Math.min(n - 1, lane));
}

const ACCEPTS: Record<Turn, LaneDirection[]> = {
  straight: ["through"],
  slightLeft: ["slight_left", "left", "through"],
  left: ["left", "slight_left"],
  slightRight: ["slight_right", "right", "through"],
  right: ["right", "slight_right"],
  uturn: ["reverse", "right"],
};

/** Whether a lane allowing `set` may be used to go `turn` (第35条第1項). */
export function laneAllows(set: LaneDirection[], turn: Turn): boolean {
  return set.some((d) => ACCEPTS[turn].includes(d));
}

/** The street centreline at route distance d (whatever the path does there). */
export function axisAt(route: Route, d: number): { pos: Vector3; dir: Vector3 } {
  let k = 0;
  while (k < route.stepStart.length - 1 && route.stepStart[k + 1] <= d) k++;
  const st = route.steps[k];
  const seg = st.seg;
  const travel = route.stepEntry[k] + (d - route.stepStart[k]);
  const s = Math.min(seg.length, Math.max(0, st.dir === 1 ? travel : seg.length - travel));
  let i = 1;
  while (i < seg.cum.length - 1 && seg.cum[i] < s) i++;
  const a = seg.pts[i - 1];
  const b = seg.pts[i];
  const t = (s - seg.cum[i - 1]) / Math.max(1e-6, seg.cum[i] - seg.cum[i - 1]);
  const dir = b.clone().sub(a).setY(0).normalize().multiplyScalar(st.dir);
  return { pos: a.clone().lerp(b, Math.min(1, Math.max(0, t))), dir };
}

/** The planned lane at route distance d, the offset interpolated between path points. */
export function laneAt(route: Route, d: number, hint = 1): LanePlan {
  let i = Math.max(1, Math.min(hint, route.cum.length - 1));
  while (i > 1 && route.cum[i - 1] > d) i--;
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.lanes[i - 1];
  const b = route.lanes[i];
  if (!a || !b) return a ?? b ?? { offset: 0, lane: 0, count: 1, corner: false };
  const t = Math.min(
    1,
    Math.max(0, (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1])),
  );
  return { ...(t < 0.5 ? a : b), offset: a.offset + (b.offset - a.offset) * t, corner: a.corner || b.corner };
}

/** Lane hints along a route, for every designated approach it passes through. */
export function laneHints(route: Route, laneUse: readonly LaneUse[]): LaneHint[] {
  const byApproach = new Map(laneUse.map((u) => [`${u.seg.id}:${u.dir}`, u]));
  const hints: LaneHint[] = [];
  for (let k = 0; k < route.steps.length - 1; k++) {
    const step = route.steps[k];
    const use = byApproach.get(`${step.seg.id}:${step.dir}`);
    if (!use) continue;
    const at = route.stepStart[k + 1];
    // Directions well before and after the junction box (its short inner segments mislead).
    const arrive = axisAt(route, at)
      .pos.sub(axisAt(route, Math.max(0, at - 15)).pos)
      .setY(0);
    const leave = axisAt(route, Math.min(route.length, at + 25))
      .pos.sub(axisAt(route, at).pos)
      .setY(0);
    if (arrive.lengthSq() < 1e-6 || leave.lengthSq() < 1e-6) continue;
    const take = classifyTurn(arrive.normalize(), leave.normalize());
    const ok = use.lanes.map((set) => laneAllows(set, take));
    if (!ok.some(Boolean)) continue;
    hints.push({ at, node: use.node, seg: step.seg, dir: step.dir, lanes: use.lanes, ok, take });
  }
  return hints;
}

export const TURN_WORDS: Record<Turn, string> = {
  straight: "直進",
  slightLeft: "斜め左方向",
  left: "左方向",
  slightRight: "斜め右方向",
  right: "右方向",
  uturn: "U ターン",
};

// Extra cost (metres) for turning: right turns wait for oncoming traffic in Japan.
const TURN_COST: Record<Turn, number> = {
  straight: 0,
  slightLeft: 4,
  left: 10,
  slightRight: 6,
  right: 25,
  uturn: 400,
};

const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
const isWalkable = (seg: Segment) => seg.line.kind !== "highway";

/** Who the route is for: cars obey one-way streets, turn bans and closures; walkers do not. */
export type TravelMode = "car" | "walk";
const exitNode = (st: Step) => (st.dir === 1 ? st.seg.to : st.seg.from);
/** Travel direction at the end (or start) of a step. */
const tangent = (graph: RoadGraph, st: Step, atEnd: boolean) => {
  const s = atEnd === (st.dir === 1) ? Math.max(0, st.seg.length - 2) : Math.min(2, st.seg.length);
  return graph.sample(st.seg, s).dir.clone().multiplyScalar(st.dir);
};

export function planRoute(
  graph: RoadGraph,
  start: { seg: Segment; s: number; dir: 1 | -1 },
  target: Vector3,
  clock: GameClock,
  turnRules: TurnRule[],
  mode: TravelMode = "car",
  /** 進行方向別通行区分, for the lanes of a car's path. */
  laneUse: readonly LaneUse[] = [],
): Route | null {
  const isWalk = mode === "walk";
  const usable = isWalk ? isWalkable : (seg: Segment) => isDrivable(seg) && !seg.closed;
  // Where the target meets each street; the goal is the closest street (and any within 30 m of it).
  const proj = new Map<number, { s: number; dist: number }>();
  let nearest = Infinity;
  for (const seg of graph.segments) {
    if (!usable(seg)) continue;
    const p = graph.nearestOn(seg, target);
    proj.set(seg.id, { s: p.s, dist: p.dist });
    nearest = Math.min(nearest, p.dist);
  }
  if (!Number.isFinite(nearest)) return null;
  const isGoal = (seg: Segment) => (proj.get(seg.id)?.dist ?? Infinity) <= nearest + 30;
  // Driving past the goal point costs nothing extra, but a street far from the target is worse.
  const goalCost = (st: Step, entered: number) => {
    const p = proj.get(st.seg.id);
    if (!p) return Infinity;
    const along = st.dir === 1 ? p.s - entered : entered - p.s;
    return along < 0 ? Infinity : along + p.dist * 2;
  };

  const key = (st: Step) => st.seg.id * 2 + (st.dir === 1 ? 1 : 0);
  const rulesAt = new Map<string, TurnRule[]>();
  for (const r of turnRules) {
    if (isWalk || !isInForce(r, clock)) continue;
    const k = `${r.node}:${r.approach.id}:${r.dir}`;
    rulesAt.set(k, [...(rulesAt.get(k) ?? []), r]);
  }
  const startStep: Step = { seg: start.seg, dir: start.dir };
  const best = new Map<number, number>(); // step key → cost at its exit node
  const prev = new Map<number, Step>();
  // Goal entries carry the step they were reached from: the same street can be both a goal
  // (stop part-way along it) and a through street with a different best predecessor.
  type Entry = { cost: number; step: Step; goal: boolean; from: Step | null };
  const open: Entry[] = [];
  const push = (cost: number, step: Step, goal: boolean, from: Step | null = null) => {
    open.push({ cost, step, goal, from });
    // Small graphs (~1,200 segments): a sorted insert keeps the code short and fast enough.
    for (let i = open.length - 1; i > 0 && open[i].cost > open[i - 1].cost; i--) {
      [open[i], open[i - 1]] = [open[i - 1], open[i]];
    }
  };
  const remaining = start.dir === 1 ? start.seg.length - start.s : start.s;
  best.set(key(startStep), remaining);
  push(remaining, startStep, false);
  if (isGoal(start.seg)) {
    const c = goalCost(startStep, start.s);
    if (Number.isFinite(c)) push(c, startStep, true);
  }

  let goal: Entry | null = null;
  while (open.length) {
    const entry = open.pop() as Entry;
    const { cost, step } = entry;
    if (entry.goal) {
      goal = entry;
      break;
    }
    if (cost > (best.get(key(step)) ?? Infinity)) continue;
    const node = exitNode(step);
    const ids = graph.nodes.get(node) ?? [];
    const tIn = tangent(graph, step, true);
    const bans = rulesAt.get(`${node}:${step.seg.id}:${step.dir}`) ?? [];
    for (const id of ids) {
      const seg = graph.segments[id];
      if (!usable(seg)) continue; // incl. 通行禁止 in force (車両通行止め, 歩行者用道路 …) for cars
      const dir: 1 | -1 = seg.from === node ? 1 : -1;
      if (seg === step.seg && ids.length > 1) continue; // U-turn only at a dead end
      if (!isWalk && seg.oneway !== 0 && seg.oneway !== dir) continue;
      const next: Step = { seg, dir };
      const tOut = tangent(graph, next, false);
      if (bans.some((r) => !(r.mask & turnBit(tIn, tOut)))) continue;
      const turn = classifyTurn(tIn, tOut);
      // Drivers: narrow streets are slower, prefer the main roads like a real navigator.
      // Walkers: the shortest way, with a little extra for each road to cross.
      const slow = !isWalk && seg.line.width < 5.5 ? 1.4 : 1;
      const base = cost + (isWalk ? (turn === "straight" ? 0 : 3) : TURN_COST[turn]);
      const through = base + seg.length * slow;
      if (through < (best.get(key(next)) ?? Infinity)) {
        best.set(key(next), through);
        prev.set(key(next), step);
        push(through, next, false);
      }
      if (isGoal(seg)) {
        const g = goalCost(next, dir === 1 ? 0 : seg.length);
        if (Number.isFinite(g)) push(base + g * slow, next, true, step);
      }
    }
  }
  if (!goal) return null;

  const steps: Step[] = [goal.step];
  let cur = goal.from;
  for (let guard = 0; cur && guard < graph.segments.length * 2; guard++) {
    steps.unshift(cur);
    if (key(cur) === key(startStep)) break;
    cur = prev.get(key(cur)) ?? null;
  }
  const endS = proj.get(goal.step.seg.id)?.s ?? 0;
  const route = buildRoute(graph, steps, start.s, endS, nearest < 40);
  if (isWalk) return route;
  // By car: the lanes and the curves through the corners (drivePath), with the レーン案内 they follow.
  const hints = laneHints(route, laneUse);
  return { ...route, ...drivePath(graph, route, hints), hints };
}

/**
 * Centreline polyline and maneuvers for a step list starting at `startS` and ending at `endS`:
 * every vertex of the streets plus points at most 5 m apart, so route distances are exact.
 */
function buildRoute(
  graph: RoadGraph,
  steps: Step[],
  startS: number,
  endS: number,
  reachesTarget: boolean,
): Route {
  const points: Vector3[] = [];
  const cum: number[] = [];
  const stepOf: number[] = [];
  const stepEntry: number[] = [];
  const stepStart: number[] = [];
  const maneuvers: Maneuver[] = [];
  let travelled = 0;
  steps.forEach((st, i) => {
    const isFirst = i === 0;
    const isLast = i === steps.length - 1;
    const entry = st.dir === 1 ? 0 : st.seg.length;
    const exit = st.dir === 1 ? st.seg.length : 0;
    const from = isFirst ? startS : entry;
    const to = isLast ? endS : exit;
    stepStart.push(travelled);
    stepEntry.push(st.dir === 1 ? from : st.seg.length - from);
    // Distances along the segment to sample: both ends, the vertices between, every ≤ 5 m.
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const marks = [lo, ...st.seg.cum.filter((c) => c > lo + 1e-6 && c < hi - 1e-6), hi];
    const ss: number[] = [];
    marks.forEach((m, k) => {
      if (k > 0) {
        const gap = m - marks[k - 1];
        const n = Math.ceil(gap / 5);
        for (let q = 1; q < n; q++) ss.push(marks[k - 1] + (gap * q) / n);
      }
      ss.push(m);
    });
    if (from > to) ss.reverse();
    // The junction point was the previous step's last point.
    ss.forEach((s, k) => {
      if (points.length && k === 0) return;
      points.push(graph.sample(st.seg, s).pos.clone());
      cum.push(travelled + Math.abs(s - from));
      stepOf.push(i);
    });
    travelled += Math.abs(to - from);
  });
  // Turns at each node between steps.
  for (let i = 1; i < steps.length; i++) {
    const tIn = tangent(graph, steps[i - 1], true);
    const turn = classifyTurn(tIn, tangent(graph, steps[i], false));
    const node = exitNode(steps[i - 1]);
    const atNode = steps[i].dir === 1 ? steps[i].seg.pts[0] : steps[i].seg.pts[steps[i].seg.pts.length - 1];
    const isJunction = (graph.nodes.get(node)?.length ?? 0) >= 3;
    if (turn !== "straight" && (isJunction || turn === "uturn")) {
      maneuvers.push({ at: stepStart[i], turn, pos: atNode.clone(), node, dir: tIn });
    }
  }
  return {
    steps,
    maneuvers,
    points,
    cum,
    stepOf,
    lanes: points.map(() => ({ offset: 0, lane: 0, count: 1, corner: false })),
    corners: [],
    hints: [],
    stepStart,
    stepEntry,
    length: travelled,
    reachesTarget,
  };
}

/** Distance along the route of the point nearest to p, searching around the last known index. */
export function progressOn(route: Route, p: Vector3, hint = 0): { at: number; off: number; index: number } {
  let best = { at: 0, off: Infinity, index: hint };
  const lo = Math.max(1, hint - 20);
  const hi = Math.min(route.points.length - 1, hint + 60);
  for (let i = lo; i <= hi; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
    const off = Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
    // Route distance, not length along the path: they differ in the lane and on the curves.
    if (off < best.off)
      best = { at: route.cum[i - 1] + (route.cum[i] - route.cum[i - 1]) * t, off, index: i };
  }
  return best;
}

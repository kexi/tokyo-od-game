import { Vector3 } from "three";
import { isInForce, type TurnRule } from "../world/regulations";
import { leftOf, type RoadGraph, type Segment } from "../world/roads";

/**
 * カーナビ: a legal route over the road graph around the player and turn-by-turn guidance
 * ("およそ 300 メートル先、右方向です"). Routes obey one-way streets (with their time windows, via
 * RoadGraph.setClock) and 指定方向外進行禁止 in force, so following the guidance never books a
 * violation. The graph only covers the area around the player; a farther target is routed to
 * the reachable road closest to it, and the route is planned again as the graph moves along.
 */
export type Turn = "straight" | "slightLeft" | "left" | "slightRight" | "right" | "uturn";
export type Step = { seg: Segment; dir: 1 | -1 };
export type Maneuver = { at: number; turn: Turn; pos: Vector3 };
export type Route = {
  steps: Step[];
  maneuvers: Maneuver[];
  /** Polyline from the start position to the end, with cumulative distances. */
  points: Vector3[];
  cum: number[];
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
  minutes: number,
  turnRules: TurnRule[],
): Route | null {
  // Where the target meets each street; the goal is the closest street (and any within 30 m of it).
  const proj = new Map<number, { s: number; dist: number }>();
  let nearest = Infinity;
  for (const seg of graph.segments) {
    if (!isDrivable(seg)) continue;
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
    if (!isInForce(r, minutes)) continue;
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
      if (!isDrivable(seg)) continue;
      const dir: 1 | -1 = seg.from === node ? 1 : -1;
      if (seg === step.seg && ids.length > 1) continue; // U-turn only at a dead end
      if (seg.oneway !== 0 && seg.oneway !== dir) continue;
      const next: Step = { seg, dir };
      const tOut = tangent(graph, next, false);
      if (bans.some((r) => !(r.mask & turnBit(tIn, tOut)))) continue;
      const turn = classifyTurn(tIn, tOut);
      // Narrow streets are slower; prefer the main roads like a real navigator.
      const slow = seg.line.width < 5.5 ? 1.4 : 1;
      const base = cost + TURN_COST[turn];
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
  return buildRoute(graph, steps, start.s, proj.get(goal.step.seg.id)?.s ?? 0, nearest < 40);
}

/** Polyline and maneuvers for a step list starting at `startS` and ending at `endS`. */
function buildRoute(
  graph: RoadGraph,
  steps: Step[],
  startS: number,
  endS: number,
  reachesTarget: boolean,
): Route {
  const points: Vector3[] = [];
  const maneuvers: Maneuver[] = [];
  const along = (st: Step, from: number, to: number) => {
    const out: Vector3[] = [];
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / 5));
    for (let i = 0; i <= n; i++) out.push(graph.sample(st.seg, from + ((to - from) * i) / n).pos.clone());
    return out;
  };
  steps.forEach((st, i) => {
    const isFirst = i === 0;
    const isLast = i === steps.length - 1;
    const entry = st.dir === 1 ? 0 : st.seg.length;
    const exit = st.dir === 1 ? st.seg.length : 0;
    const from = isFirst ? startS : entry;
    const to = isLast ? endS : exit;
    const pts = along(st, from, to);
    if (points.length) pts.shift();
    points.push(...pts);
  });
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
  // Turns at each node between steps; distances measured along the polyline.
  let travelled = steps[0].dir === 1 ? steps[0].seg.length - startS : startS;
  for (let i = 1; i < steps.length; i++) {
    const turn = classifyTurn(tangent(graph, steps[i - 1], true), tangent(graph, steps[i], false));
    const node = exitNode(steps[i - 1]);
    const atNode = steps[i].dir === 1 ? steps[i].seg.pts[0] : steps[i].seg.pts[steps[i].seg.pts.length - 1];
    const isJunction = (graph.nodes.get(node)?.length ?? 0) >= 3;
    if (turn !== "straight" && (isJunction || turn === "uturn")) {
      maneuvers.push({ at: travelled, turn, pos: atNode.clone() });
    }
    travelled += steps[i].seg.length;
  }
  return { steps, maneuvers, points, cum, length: cum[cum.length - 1], reachesTarget };
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
    if (off < best.off) best = { at: route.cum[i - 1] + Math.sqrt(len2) * t, off, index: i };
  }
  return best;
}

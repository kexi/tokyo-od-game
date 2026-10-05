import { Vector3 } from "three";
import { t } from "../i18n";
import type { RouteInfo } from "../world/guidePlan";
import type { RoadGraph, Segment } from "../world/roads";
import { endNode, junctionLabel, nodePos, travelDir, type NamedPoint } from "./navAhead";
import { axisAt, classifyTurn, type Route, type Step, type Turn } from "./navigation";

/**
 * 直進案内 and the order of what the nav panel shows next.
 *
 * Japanese car navigation does not call every junction passed straight on, only the ones where a
 * driver could go wrong or wants a landmark. The rule here (knowledge/nav-panel.md):
 *
 * - **major**: a signalled junction (a signal faces the route's approach) where the route crosses
 *   another main road (an OSM numbered or named road matched to the street, or a GSI 国道・都道)
 *   and goes straight through the whole crossing box;
 * - **fork**: any junction where going straight is not obvious: another way leaves within 35° of
 *   the route (a Y fork), or the numbered or named road being followed turns off there while the
 *   route goes on straight.
 *
 * A junction less than 120 m after a turn or the last guided one is left out. Both kinds show
 * 「○○交差点を直進」 with the 交差点拡大図 in the last 300 m; only the named ones are spoken, once
 * (NavGuide). Why not speak the unnamed ones: 「この先、直進です」 every few hundred metres of an
 * arterial tells the driver nothing the road does not, and crowds the turn calls.
 */

/** The parts of a trafficControl Approach the guidance reads (Approach fits it). */
export type ApproachLike = {
  seg: Segment;
  dir: 1 | -1;
  at: number;
  kind: "signal" | "stop";
  controller: { nodes: number[] } | null;
};

export type StraightGuide = {
  /** Route distance where the route enters the junction. */
  at: number;
  /** The junction's centre (the mean of its nodes). */
  pos: Vector3;
  /** Travel direction arriving. */
  dir: Vector3;
  node: number;
  name: string | null;
  reason: "major" | "fork";
};

const CROSSING_COS = Math.cos((35 * Math.PI) / 180); // arms closer than this to the route's line run along it
const FORK_SPREAD = 35; // degrees between the route and another way for a Y fork
const FORK_MAX = 60; // …as long as that way still heads on, not off to the side
const BEND_MIN = 20; // degrees the followed road must turn off by to count as leaving the route
const BOX_LINK = 25; // ways shorter than this at a crossing are links inside the box
// m after a turn or the last guided junction: closer ones are not guided (on real data named ones
// came as close as 30 m, two calls and two close-ups in a few seconds).
const MIN_SPACING = 120;
const DEG = 180 / Math.PI;

const stepKey = (st: { seg: Segment; dir: 1 | -1 }) => `${st.seg.id}:${st.dir}`;
const signedAngle = (from: Vector3, to: Vector3) =>
  Math.atan2(from.z * to.x - from.x * to.z, from.dot(to)) * DEG; // + = left (x east, z south)

/** Whether a street is a main road for the guidance: matched to an OSM route, or a GSI 国道・都道. */
export const isMainRoad = (seg: Segment, routes: ReadonlyMap<number, RouteInfo>): boolean =>
  routes.has(seg.id) || seg.line.kind === "national" || seg.line.kind === "prefectural";

/** Whether a main road crosses the route at a junction box (an arm off the route's line). */
function crossesMainRoad(
  graph: RoadGraph,
  members: ReadonlySet<number>,
  arrive: Vector3,
  routes: ReadonlyMap<number, RouteInfo>,
): boolean {
  for (const node of members) {
    for (const id of graph.nodes.get(node) ?? []) {
      const seg = graph.segments[id];
      const other = seg.from === node ? seg.to : seg.from;
      const isInside = members.has(other) || seg.line.kind === "highway";
      if (isInside) continue;
      const away = travelDir(graph, seg, seg.from === node ? 1 : -1, false);
      const isAlongRoute = Math.abs(away.dot(arrive)) > CROSSING_COS;
      if (!isAlongRoute && isMainRoad(seg, routes)) return true;
    }
  }
  return false;
}

/** A Y fork, or the followed road turning off, at the node between two route steps. */
function isUnclearStraight(
  graph: RoadGraph,
  arrive: Step,
  leave: Step,
  routes: ReadonlyMap<number, RouteInfo>,
): boolean {
  const node = endNode(arrive);
  const tIn = travelDir(graph, arrive.seg, arrive.dir, true);
  const outAngle = signedAngle(tIn, travelDir(graph, leave.seg, leave.dir, false));
  const inKey = routes.get(arrive.seg.id)?.key ?? "";
  const leavesRoad = inKey !== "" && routes.get(leave.seg.id)?.key !== inKey;
  for (const id of graph.nodes.get(node) ?? []) {
    const seg = graph.segments[id];
    const isRouteStreet = seg === arrive.seg || seg === leave.seg;
    if (isRouteStreet || seg.line.kind === "highway" || seg.length < BOX_LINK) continue;
    const dir: 1 | -1 = seg.from === node ? 1 : -1;
    const isAgainstOneway = seg.oneway !== 0 && seg.oneway !== dir;
    if (isAgainstOneway) continue;
    const angle = signedAngle(tIn, travelDir(graph, seg, dir, false));
    const isFork = Math.abs(angle - outAngle) < FORK_SPREAD && Math.abs(angle) < FORK_MAX;
    const isRoadTurningOff = leavesRoad && routes.get(seg.id)?.key === inKey && Math.abs(angle) >= BEND_MIN;
    if (isFork || isRoadTurningOff) return true;
  }
  return false;
}

/** The junctions of a car route to guide straight on (see the rule above), in route order. */
export function straightGuides(
  graph: RoadGraph,
  route: Route,
  ctx: {
    approaches: readonly ApproachLike[];
    names: readonly NamedPoint[];
    routes: ReadonlyMap<number, RouteInfo>;
  },
): StraightGuide[] {
  const signals = new Map<string, ApproachLike>();
  for (const ap of ctx.approaches) if (ap.kind === "signal" && ap.controller) signals.set(stepKey(ap), ap);
  const guides: StraightGuide[] = [];
  let passed = -Infinity; // route distance where the last junction looked at was left
  let lastGuided = -Infinity; // route distance of the last guided junction
  for (let k = 0; k < route.steps.length - 1; k++) {
    const step = route.steps[k];
    const at = route.stepStart[k + 1];
    const node = endNode(step);
    const isJunction = (graph.nodes.get(node)?.length ?? 0) >= 3;
    // The inner nodes of a crossing box already looked at.
    if (!isJunction || at <= passed + 1) continue;
    const signal = signals.get(stepKey(step));
    const members = new Set(signal?.controller?.nodes ?? [node]);
    members.add(node);
    // Where the route leaves the crossing (the step after the last one ending at a member).
    let j = k + 1;
    while (j < route.steps.length && members.has(endNode(route.steps[j]))) j++;
    if (j >= route.steps.length) break; // the route ends inside it: that is the goal
    const leaveAt = route.stepStart[j];
    passed = leaveAt;
    const hasTurn = route.maneuvers.some((m) => m.at > at - 10 && m.at < leaveAt + 10);
    const isTooClose =
      at - lastGuided < MIN_SPACING || route.maneuvers.some((m) => m.at <= at && at - m.at < MIN_SPACING);
    if (hasTurn || isTooClose) continue;
    // Directions well before and after the box: its short inner links mislead.
    const arrive = axisAt(route, at)
      .pos.sub(axisAt(route, Math.max(0, at - 20)).pos)
      .setY(0);
    const leave = axisAt(route, Math.min(route.length, leaveAt + 25))
      .pos.sub(axisAt(route, leaveAt).pos)
      .setY(0);
    const hasDirections = arrive.lengthSq() > 1e-6 && leave.lengthSq() > 1e-6;
    if (!hasDirections) continue;
    arrive.normalize();
    if (classifyTurn(arrive, leave.normalize()) !== "straight") continue;
    const isMajor = signal !== undefined && crossesMainRoad(graph, members, arrive, ctx.routes);
    const isFork = !isMajor && isUnclearStraight(graph, step, route.steps[k + 1], ctx.routes);
    if (!isMajor && !isFork) continue;
    const centre = new Vector3();
    let n = 0;
    for (const m of members) {
      const p = nodePos(graph, m);
      if (!p) continue;
      centre.add(p);
      n++;
    }
    if (n > 0) centre.divideScalar(n);
    lastGuided = at;
    guides.push({
      at,
      pos: centre,
      dir: arrive,
      node,
      name: junctionLabel(ctx.names, centre),
      reason: isMajor ? "major" : "fork",
    });
  }
  return guides;
}

/** One thing the panel tells about: a turn, a junction passed straight on, or the goal. */
export type GuidePoint = {
  kind: "turn" | "straight" | "goal";
  at: number;
  turn: Turn;
  pos: Vector3;
  dir: Vector3;
  name: string | null;
};

/** Within this of a turn or a guided straight-on junction the panel shows its 交差点拡大図. */
export const CLOSE_RANGE = 300;

/**
 * What the panel shows at route distance `at`: the main guidance (the next turn, or a guided
 * straight-on junction when it comes first and is within 300 m) and the list of what follows it
 * (the next turns, then the goal), `size` items at most.
 */
export function nextGuidance(
  route: Route,
  straights: readonly StraightGuide[],
  turnNames: ReadonlyArray<string | null>,
  at: number,
  size = 3,
): { primary: GuidePoint | null; list: GuidePoint[] } {
  const turns: GuidePoint[] = [];
  route.maneuvers.forEach((m, i) => {
    if (m.at > at + 2)
      turns.push({
        kind: "turn",
        at: m.at,
        turn: m.turn,
        pos: m.pos,
        dir: m.dir,
        name: turnNames[i] ?? null,
      });
  });
  const straight = straights.find((g) => g.at > at + 2 && g.at - at < CLOSE_RANGE);
  const first = turns[0] ?? null;
  const isStraightFirst = straight !== undefined && (!first || straight.at < first.at);
  const primary: GuidePoint | null = isStraightFirst
    ? {
        kind: "straight",
        at: straight.at,
        turn: "straight",
        pos: straight.pos,
        dir: straight.dir,
        name: straight.name,
      }
    : first;
  const list = turns.filter((g) => g !== primary).slice(0, size);
  if (list.length < size) {
    const end = route.points[route.points.length - 1] ?? new Vector3();
    list.push({
      kind: "goal",
      at: route.length,
      turn: "straight",
      pos: end,
      dir: new Vector3(),
      name: t(route.reachesTarget ? "nav.goal" : "nav.goalOffMap"),
    });
  }
  return { primary, list };
}

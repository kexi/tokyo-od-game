import { Vector3 } from "three";
import { LocalFrame } from "../geo/frame";
import { onLogLine, type LogFields } from "../log";
import { RoadGraph, type RoadGraphSnapshot } from "../world/roads";
import type { LaneUse, TurnRule } from "../world/regulations";
import type { GameClock } from "../world/ruleTime";
import { drivingRoute, type RouteStart, type RouteWorld } from "./drivingRoute";
import type { Route } from "./navigation";

type Point = [number, number, number];
export type DrivingRouteInput = {
  graph: RoadGraphSnapshot;
  turnRules: Array<Omit<TurnRule, "approach"> & { approach: number }>;
  laneUse: Array<Omit<LaneUse, "seg"> & { seg: number }>;
  clock: GameClock;
  position: Point;
  yaw: number;
  target: Point;
  from?: Omit<RouteStart, "seg"> & { seg: number };
};
export type PackedRoute = Omit<Route, "steps" | "points" | "maneuvers" | "hints"> & {
  steps: Array<{ seg: number; dir: 1 | -1 }>;
  points: Point[];
  maneuvers: Array<Omit<Route["maneuvers"][number], "pos" | "dir"> & { pos: Point; dir: Point }>;
  hints: Array<Omit<Route["hints"][number], "seg"> & { seg: number }>;
};
export type DrivingRouteData = {
  route: PackedRoute | null;
  diagnostics: LogFields<"route_lane_blocked">[];
  computeMs: number;
};
export type DrivingRouteReply = { id: number; data: DrivingRouteData } | { id: number; error: string };

const point = (p: Vector3): Point => [p.x, p.y, p.z];
const vector = (p: Point): Vector3 => new Vector3(...p);

export function drivingRouteInput(
  world: RouteWorld,
  position: Vector3,
  yaw: number,
  target: Vector3,
  from?: RouteStart,
): DrivingRouteInput {
  return {
    graph: world.graph.snapshot(),
    turnRules: world.turnRules.map((rule) => ({ ...rule, approach: rule.approach.id })),
    laneUse: (world.laneUse ?? []).map((rule) => ({ ...rule, seg: rule.seg.id })),
    clock: { ...world.clock },
    position: point(position),
    yaw,
    target: point(target),
    from: from ? { ...from, seg: from.seg.id } : undefined,
  };
}

export function packDrivingRoute(route: Route | null): PackedRoute | null {
  const hasRoute = route !== null;
  if (!hasRoute) return null;
  return {
    ...route,
    steps: route.steps.map((step) => ({ ...step, seg: step.seg.id })),
    points: route.points.map(point),
    maneuvers: route.maneuvers.map((m) => ({ ...m, pos: point(m.pos), dir: point(m.dir) })),
    hints: route.hints.map((hint) => ({ ...hint, seg: hint.seg.id })),
  };
}

export function restoreDrivingRoute(route: PackedRoute | null, graph: RoadGraph): Route | null {
  const hasRoute = route !== null;
  if (!hasRoute) return null;
  const segment = (id: number) => {
    const seg = graph.segments[id];
    const isValid = Number.isInteger(id) && seg !== undefined && seg.id === id;
    if (!isValid) throw new Error(`invalid driving route segment ${id}`);
    return seg;
  };
  return {
    ...route,
    steps: route.steps.map((step) => ({ ...step, seg: segment(step.seg) })),
    points: route.points.map(vector),
    maneuvers: route.maneuvers.map((m) => ({ ...m, pos: vector(m.pos), dir: vector(m.dir) })),
    hints: route.hints.map((hint) => ({ ...hint, seg: segment(hint.seg) })),
  };
}

export function computeDrivingRoute(input: DrivingRouteInput): DrivingRouteData {
  const start = performance.now();
  // Snapshot points are already local; restore performs no geographic projection.
  const graph = RoadGraph.restore(input.graph, new LocalFrame(0, 0, 0));
  const world: RouteWorld = {
    graph,
    clock: input.clock,
    turnRules: input.turnRules.map((rule) => ({ ...rule, approach: graph.segments[rule.approach] })),
    laneUse: input.laneUse.map((rule) => ({ ...rule, seg: graph.segments[rule.seg] })),
  };
  const diagnostics: LogFields<"route_lane_blocked">[] = [];
  const stop = onLogLine((_line, entry) => {
    const isLaneDiagnostic = entry.event === "route_lane_blocked";
    if (!isLaneDiagnostic) return;
    diagnostics.push({
      turns: entry.turns as number,
      attempt: entry.attempt as number,
      replanned: entry.replanned as boolean,
    });
  });
  try {
    const from = input.from ? { ...input.from, seg: graph.segments[input.from.seg] } : undefined;
    const route = drivingRoute(world, vector(input.position), input.yaw, vector(input.target), from);
    return { route: packDrivingRoute(route), diagnostics, computeMs: performance.now() - start };
  } finally {
    stop();
  }
}

import { Vector3 } from "three";
import { laneOfPoint } from "../world/laneChange";
import { isInForce, type LaneUse, type TurnRule } from "../world/regulations";
import type { RoadGraph, Segment } from "../world/roads";
import { inForce, type GameClock } from "../world/ruleTime";
import { planRoute, type Route } from "./navigation";

export type RouteWorld = {
  graph: RoadGraph;
  turnRules: TurnRule[];
  clock: GameClock;
  laneUse?: readonly LaneUse[];
};
export type RouteStart = { seg: Segment; s: number; dir: 1 | -1 };
const TURN_ROUND_COST = 60;
const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
/** 転回禁止 (JARTIC 51) in force on a street (第25条の2第2項). */
export function isUturnBanned(seg: Segment, clock: GameClock): boolean {
  return seg.rules.some((r) => r.code === 51 && inForce(r.time, clock));
}

/** Select a legal starting street and route, without physics, drawing or driver state. */
export function drivingRoute(
  world: RouteWorld,
  position: Vector3,
  yaw: number,
  target: Vector3,
  from?: RouteStart,
): Route | null {
  const routeFrom = (start: RouteStart) => {
    const leftOfTravel = world.graph.nearestOn(start.seg, position).lateral * start.dir;
    const lane = laneOfPoint(start.seg, leftOfTravel) ?? 0;
    return planRoute(
      world.graph,
      { ...start, lane },
      target,
      world.clock,
      world.turnRules,
      "car",
      world.laneUse,
    );
  };
  const hasStart = from !== undefined;
  if (hasStart) return routeFrom(from);
  const graph = world.graph;
  const heading = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const hit = graph.nearest(position, 25, isDrivable);
  const hasHit = hit !== null;
  if (hasHit) {
    const facing: 1 | -1 = hit.dir.dot(heading) >= 0 ? 1 : -1;
    const isOnIt = Math.abs(hit.lateral) < hit.seg.line.width / 2 + 0.5;
    const isLegal = hit.seg.oneway === 0 || hit.seg.oneway === facing;
    const isFacing = Math.abs(hit.dir.dot(heading)) > 0.7;
    const route =
      isOnIt && isLegal && isFacing && !hit.seg.closed
        ? routeFrom({ seg: hit.seg, s: hit.s, dir: facing })
        : null;
    const hasRoute = route !== null;
    if (hasRoute) return route;
  }
  for (const radius of [25, 60, 120]) {
    type Start = RouteStart & { extra: number };
    const starts: Start[] = [];
    for (const seg of graph.segments) {
      const isUsable = isDrivable(seg) && !seg.closed;
      if (!isUsable) continue;
      const q = graph.nearestOn(seg, position);
      const isBeyondRadius = q.dist > radius;
      if (isBeyondRadius) continue;
      const along = graph.sample(seg, q.s).dir.dot(heading);
      const off = Math.max(0, q.dist - seg.line.width / 2);
      const ways: Array<1 | -1> = seg.oneway !== 0 ? [seg.oneway] : [1, -1];
      for (const dir of ways) {
        const isTurnRound = along * dir < -0.3;
        const isBanned = isTurnRound && off === 0 && isUturnBanned(seg, world.clock);
        if (isBanned) continue;
        const turn = ((1 - along * dir) / 2) * TURN_ROUND_COST;
        starts.push({ seg, s: q.s, dir, extra: off * 3 + turn });
      }
    }
    let best: { route: Route; cost: number } | null = null;
    for (const st of starts.toSorted((a, b) => a.extra - b.extra).slice(0, 6)) {
      const route = routeFrom(st);
      const hasRoute = route !== null;
      if (!hasRoute) continue;
      const uturns = route.maneuvers.filter((m) => m.turn === "uturn").length;
      const cost = route.length + st.extra + uturns * 100;
      const isBetter = best === null || cost < best.cost;
      if (isBetter) best = { route, cost };
    }
    const found = best;
    const hasBest = found !== null;
    if (hasBest) return found.route;
  }
  return null;
}

/** Fractional game minutes change each frame; compare the rules that affect route selection. */
export function routingState(world: RouteWorld): string {
  const state: Array<number | boolean | string> = [];
  for (const seg of world.graph.segments) {
    state.push(seg.oneway, seg.closed, seg.lanes, seg.noLaneChange, seg.line.width, seg.line.kind);
    state.push(isUturnBanned(seg, world.clock));
  }
  for (const rule of world.turnRules)
    state.push(rule.node, rule.approach.id, rule.dir, rule.mask, isInForce(rule, world.clock));
  for (const rule of world.laneUse ?? [])
    state.push(rule.node, rule.seg.id, rule.dir, JSON.stringify(rule.lanes));
  return JSON.stringify(state);
}

import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import { drivingRoute, routingState, type RouteWorld } from "../src/game/drivingRoute";
import { computeDrivingRoute, drivingRouteInput, restoreDrivingRoute } from "../src/game/drivingRouteData";

const frame = new LocalFrame(35.68, 139.76, 40);
const road = (coords: number[]): RoadLine => ({ coords, width: 8, kind: "local", oneway: 0 });
const fixture = () => {
  const graph = new RoadGraph(
    [road([139.76, 35.68, 139.76, 35.682]), road([139.76, 35.682, 139.762, 35.682])],
    frame,
  );
  const world: RouteWorld = { graph, clock: gameClock(2026, 10, 1, 600), turnRules: [], laneUse: [] };
  return {
    world,
    position: graph.sample(graph.segments[0], 20).pos,
    target: graph.sample(graph.segments[1], 100).pos,
  };
};

describe("driving route transport", () => {
  it.each(["lane", "reverse", "offroad"])(
    "restores the complete %s route and live road references",
    (placement) => {
      const { world, position, target } = fixture();
      const isOffroad = placement === "offroad";
      if (isOffroad) position.x += 20;
      const yaw = placement === "reverse" ? 0 : Math.PI;
      const expected = drivingRoute(world, position, yaw, target);
      expect(expected).not.toBeNull();
      const input = structuredClone(drivingRouteInput(world, position, yaw, target));
      const data = structuredClone(computeDrivingRoute(input));
      const actual = restoreDrivingRoute(data.route, world.graph);
      expect(actual).toStrictEqual(expected);
      expect(actual?.steps.every((step) => step.seg === world.graph.segments[step.seg.id])).toBe(true);
      expect(actual?.points.every((point) => point instanceof Vector3)).toBe(true);
      expect(actual?.maneuvers.every((m) => m.pos instanceof Vector3 && m.dir instanceof Vector3)).toBe(true);
      const before = world.graph.segments[0].pts[0].clone();
      input.graph.segments[0].pts[0][0] += 999;
      expect(world.graph.segments[0].pts[0]).toStrictEqual(before);
    },
  );

  it("keeps a supplied street start and the carriageway lane", () => {
    const { world, position, target } = fixture();
    position.x += 2;
    const from = { seg: world.graph.segments[0], s: 20, dir: 1 as const };
    const expected = drivingRoute(world, position, Math.PI, target, from);
    const data = computeDrivingRoute(
      structuredClone(drivingRouteInput(world, position, Math.PI, target, from)),
    );
    expect(restoreDrivingRoute(structuredClone(data.route), world.graph)).toStrictEqual(expected);
  });

  it("does not reopen closed snapshot streets when restoring the worker's graph", () => {
    const { world, position, target } = fixture();
    for (const seg of world.graph.segments) seg.closed = true;
    const data = computeDrivingRoute(structuredClone(drivingRouteInput(world, position, Math.PI, target)));
    expect(data.route).toBeNull();
    expect(restoreDrivingRoute(data.route, world.graph)).toBeNull();
  });

  it("rejects a returned route referring to a street absent from the current graph", () => {
    const { world, position, target } = fixture();
    const data = computeDrivingRoute(drivingRouteInput(world, position, Math.PI, target));
    expect(data.route).not.toBeNull();
    data.route!.steps[0].seg = world.graph.segments.length;
    expect(() => restoreDrivingRoute(data.route, world.graph)).toThrow("invalid driving route segment");
  });
});

describe("routing rule state", () => {
  it("keeps fractional time changes but invalidates a changed active turn-round restriction", () => {
    const { world } = fixture();
    world.graph.segments[0].rules.push({ code: 51, time: { on: [[600, 610, 0]], off: [] } });
    world.clock.minutes = 600.1;
    const initial = routingState(world);
    world.clock.minutes = 600.2;
    expect(routingState(world)).toBe(initial);
    world.clock.minutes = 610;
    expect(routingState(world)).not.toBe(initial);
  });

  it("invalidates changed one-way and closed flags", () => {
    const { world } = fixture(),
      initial = routingState(world);
    world.graph.segments[0].oneway = -1;
    expect(routingState(world)).not.toBe(initial);
    world.graph.segments[0].oneway = 0;
    world.graph.segments[0].closed = true;
    expect(routingState(world)).not.toBe(initial);
  });
});

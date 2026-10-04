import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { classifyTurn, planRoute, progressOn } from "../src/game/navigation";
import type { TurnRule } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950; // degrees per metre
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
// Streets on a 100 m grid: x = east metres, y = north metres from (35.68, 139.76).
const road = (x0: number, y0: number, x1: number, y1: number, oneway: RoadLine["oneway"] = 0): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width: 8,
  oneway,
  kind: "local",
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const startOn = (graph: RoadGraph, x: number, y: number, heading: Vector3) => {
  const hit = graph.nearest(at(x, y), 5);
  if (!hit) throw new Error("no street");
  return { seg: hit.seg, s: hit.s, dir: (hit.dir.dot(heading) >= 0 ? 1 : -1) as 1 | -1 };
};
const NORTH = new Vector3(0, 0, -1);

// A plus-shaped junction at (0, 100) with arms 100 m long, and a ring around it to reroute by.
const grid = () => [
  road(0, 0, 0, 100), // south arm
  road(0, 100, 0, 200), // north arm
  road(0, 100, 100, 100), // east arm
  road(0, 100, -100, 100), // west arm
  road(-100, 100, -100, 200),
  road(-100, 200, 0, 200),
  road(100, 100, 100, 200),
  road(100, 200, 0, 200),
];

describe("car navigation over the road graph", () => {
  it("classifies turns by the angle between the streets (left-hand traffic agnostic)", () => {
    const north = new Vector3(0, 0, -1);
    expect(classifyTurn(north, new Vector3(1, 0, 0))).toBe("right");
    expect(classifyTurn(north, new Vector3(-1, 0, 0))).toBe("left");
    expect(classifyTurn(north, new Vector3(0.3, 0, -1).normalize())).toBe("straight");
    expect(classifyTurn(north, new Vector3(0, 0, 1))).toBe("uturn");
  });

  it("announces the right turn at the junction 100 m ahead", () => {
    const graph = new RoadGraph(grid(), frame);
    const route = planRoute(graph, startOn(graph, 0, 10, NORTH), at(80, 100), 600, []);
    expect(route?.reachesTarget).toBe(true);
    expect(route?.maneuvers.map((m) => m.turn)).toEqual(["right"]);
    expect(route?.maneuvers[0].at).toBeCloseTo(90, 0);
    expect(route?.length).toBeCloseTo(170, -1);
  });

  it("goes around a one-way street instead of driving against it", () => {
    const lines = grid();
    lines[2] = road(100, 100, 0, 100, 1); // east arm: one way, westbound only
    const graph = new RoadGraph(lines, frame);
    const route = planRoute(graph, startOn(graph, 0, 10, NORTH), at(80, 100), 600, []);
    // North to the top junction and right along the ring (the corner after it is a bend, not a
    // junction, so it is not announced); never along the one-way street against its flow.
    expect(route?.maneuvers.map((m) => [m.turn, Math.round(m.at)])).toEqual([["right", 190]]);
    expect(route?.steps.every((st) => st.seg.oneway === 0 || st.seg.oneway === st.dir)).toBe(true);
  });

  it("obeys 指定方向外進行禁止 that is in force, and only then", () => {
    const graph = new RoadGraph(grid(), frame);
    const south = graph.nearest(at(0, 50), 5)?.seg;
    if (!south) throw new Error("no south arm");
    const node = south.to;
    // From the south arm, only straight on and left are allowed (右折禁止), 7:00–19:00.
    const rule: TurnRule = { node, approach: south, dir: 1, mask: 3, start: 420, end: 1140 };
    // Daytime: straight on through the banned junction, right at the next one.
    const daytime = planRoute(graph, startOn(graph, 0, 10, NORTH), at(80, 100), 600, [rule]);
    expect(daytime?.maneuvers.map((m) => [m.turn, Math.round(m.at)])).toEqual([["right", 190]]);
    const night = planRoute(graph, startOn(graph, 0, 10, NORTH), at(80, 100), 1300, [rule]);
    expect(night?.maneuvers.map((m) => [m.turn, Math.round(m.at)])).toEqual([["right", 90]]);
  });

  it("tracks progress along the route and how far the car strays from it", () => {
    const graph = new RoadGraph(grid(), frame);
    const route = planRoute(graph, startOn(graph, 0, 10, NORTH), at(80, 100), 600, []);
    if (!route) throw new Error("no route");
    const p = progressOn(route, at(3, 60));
    expect(p.at).toBeCloseTo(50, 0);
    expect(p.off).toBeCloseTo(3, 0);
  });
});

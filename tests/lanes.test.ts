import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { laneAllows, laneHints, planRoute } from "../src/game/navigation";
import { assumedLanes, type LaneDirection, type LaneUse } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const road = (x0: number, y0: number, x1: number, y1: number): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width: 16,
  oneway: 0,
  kind: "prefectural",
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
// A crossroads at (0, 100).
const cross = () => [
  road(0, 0, 0, 100),
  road(0, 100, 0, 200),
  road(0, 100, 100, 100),
  road(0, 100, -100, 100),
];
const all = new Set<LaneDirection>(["left", "through", "right"]);

describe("進行方向別通行区分 assumed where JARTIC lists it without per-lane directions", () => {
  it("uses 左折・直進 | 直進 | 右折 for three lanes", () => {
    expect(assumedLanes(3, all)).toEqual([["left", "through"], ["through"], ["right"]]);
  });

  it("uses 左折・直進 | 直進・右折 for two lanes", () => {
    expect(assumedLanes(2, all)).toEqual([
      ["left", "through"],
      ["through", "right"],
    ]);
  });

  it("only offers the directions the junction has (a T-junction has no 直進)", () => {
    expect(assumedLanes(2, new Set<LaneDirection>(["left", "right"]))).toEqual([["left"], ["right"]]);
  });
});

describe("lanes allowed for a turn (第35条第1項)", () => {
  it("lets a 直進・右折 lane turn right but not a 左折・直進 one", () => {
    expect(laneAllows(["through", "right"], "right")).toBe(true);
    expect(laneAllows(["left", "through"], "right")).toBe(false);
  });

  it("counts a slight turn as either the turn or straight on", () => {
    expect(laneAllows(["through"], "slightRight")).toBe(true);
    expect(laneAllows(["left"], "slightRight")).toBe(false);
  });
});

describe("レーン案内 along a route", () => {
  const graph = new RoadGraph(cross(), frame);
  const south = graph.segments.find(
    (s) => s.pts[0].distanceTo(at(0, 0)) < 1 || s.pts.at(-1)!.distanceTo(at(0, 0)) < 1,
  )!;
  const dir: 1 | -1 = south.pts.at(-1)!.distanceTo(at(0, 100)) < 1 ? 1 : -1;
  const node = dir === 1 ? south.to : south.from;
  const use: LaneUse = { seg: south, dir, node, lanes: [["left", "through"], ["right"]], source: "osm" };
  const start = (() => {
    const hit = graph.nearest(at(0, 10), 5)!;
    return { seg: hit.seg, s: hit.s, dir: (hit.dir.dot(new Vector3(0, 0, -1)) >= 0 ? 1 : -1) as 1 | -1 };
  })();
  const clock = gameClock(2026, 10, 1, 600);

  it("lights only the 右折 lane for a right turn", () => {
    const route = planRoute(graph, start, at(80, 100), clock, [])!;
    const [hint] = laneHints(route, [use]);
    expect(hint.take).toBe("right");
    expect(hint.ok).toEqual([false, true]);
  });

  it("lights only the 左折・直進 lane for straight on", () => {
    const route = planRoute(graph, start, at(0, 180), clock, [])!;
    const [hint] = laneHints(route, [use]);
    expect(hint.take).toBe("straight");
    expect(hint.ok).toEqual([true, false]);
  });
});

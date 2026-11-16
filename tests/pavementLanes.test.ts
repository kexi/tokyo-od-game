import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { pavementLaneFloor } from "../src/game/autoDriver";
import { laneCentre } from "../src/game/drivePath";
import { planRoute, type Route } from "../src/game/navigation";
import { laneOfOffset } from "../src/world/laneChange";
import { leftOf, RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";

/**
 * The autopilot's lanes on a street whose GSI 幅員 includes its pavements (D2, 大手町一丁目): lane 0
 * is laid out over the pavement. What this guarantees, with PLATEAU paving over lane 0's centre:
 * the planned path keeps to the first lane clear of the paving all along (no point on the paving, no
 * change of the lane the violation check counts), the left turn is planned from that lane, a car
 * starting outside the lanes starts in the nearest usable one, and with no paving data the plan is
 * as before (lane 0).
 */

// Local frame: x east, z south; the helpers take x east, y north metres.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const line = (pts: Array<[number, number]>, width: number): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  oneway: 0,
  kind: "local",
});
const clock = gameClock(2026, 10, 1, 600);

/**
 * A 35 m street east–west (y = 0), three lanes a direction (as JARTIC gives 大手町's 903), with an
 * 8 m street across its far end.
 */
function graph(): RoadGraph {
  const g = new RoadGraph(
    [
      line(
        [
          [-200, 0],
          [0, 0],
        ],
        35,
      ),
      line(
        [
          [0, -120],
          [0, 0],
          [0, 120],
        ],
        8,
      ),
    ],
    frame,
  );
  // The lane count the matched regulations give (RoadGraph would estimate one from a local road).
  for (const seg of g.segments) if (seg.line.width === 35) (seg as { lanes: number }).lanes = 3;
  return g;
}

const wide = (g: RoadGraph) => g.segments.find((s) => s.line.width === 35) as Segment;
/** Metres north of the 35 m street's centreline (left of travel going east). */
const north = (p: Vector3) => -p.z + at(0, 0).z;

/**
 * PLATEAU paving over the outer part of the 35 m street on both sides: from `edge` m out from the
 * centreline to its edge, along the street (not the cross street, x < -1).
 */
const paving =
  (edge: number) =>
  (x: number, z: number): boolean => {
    const p = new Vector3(x, 0, z);
    const isAlong = p.x < at(-1, 0).x;
    return isAlong && Math.abs(north(p)) > edge && Math.abs(north(p)) < 17.5;
  };

function plan(g: RoadGraph, isPavement: ((x: number, z: number) => boolean) | undefined, lane = 0): Route {
  const seg = wide(g);
  const hit = g.nearestOn(seg, at(-180, 0));
  const dir = (seg.pts[1].x > seg.pts[0].x ? 1 : -1) as 1 | -1;
  const route = planRoute(
    g,
    { seg, s: hit.s, dir, lane },
    at(0, 100),
    clock,
    [],
    "car",
    [],
    true,
    isPavement ? pavementLaneFloor(isPavement) : undefined,
  );
  if (!route) throw new Error("no route");
  return route;
}

/** The path's points on the 35 m street (before the turn's curve), with the lane each is in. */
function alongWide(route: Route, seg: Segment) {
  return route.points.flatMap((p, i) => {
    const isOnIt = route.steps[route.stepOf[i]].seg === seg && !route.lanes[i].corner && route.cum[i] > 10;
    if (!isOnIt) return [];
    return [{ p, lane: laneOfOffset(seg, north(p)), lanePlanned: route.lanes[i].lane }];
  });
}

describe("lanes under PLATEAU paving on a street whose 幅員 includes its pavements (D2)", () => {
  const g = graph();
  const seg = wide(g);
  const lane0 = laneCentre(seg, 0, seg.lanes);
  const lane1 = laneCentre(seg, 1, seg.lanes);
  // The paving reaches 1 m inside lane 0's centre: over its centre, short of the line to lane 1.
  const edge = lane0 - 1;
  const isPavement = paving(edge);

  it("has lanes to choose from (the setting this test is about)", () => {
    expect(seg.lanes).toBeGreaterThanOrEqual(2);
    expect(isPavement(at(-100, lane0).x, at(-100, lane0).z)).toBe(true);
    expect(isPavement(at(-100, lane1).x, at(-100, lane1).z)).toBe(false);
  });

  it("plans the whole street in the first lane clear of the paving, never over it", () => {
    const pts = alongWide(plan(g, isPavement), seg);
    expect(pts.length).toBeGreaterThan(10);
    expect(new Set(pts.map((q) => q.lane))).toEqual(new Set([1]));
    expect(pts.filter((q) => isPavement(q.p.x, q.p.z))).toEqual([]);
  });

  it("plans the left turn from that lane: the leftmost the car may take", () => {
    const route = plan(g, isPavement);
    const turn = route.maneuvers.find((m) => m.turn === "left");
    expect(turn).toBeDefined();
    const before = alongWide(route, seg).at(-1);
    expect(before?.lanePlanned).toBe(1);
  });

  it("starts a car standing outside the lanes (on the paving) in the nearest usable lane", () => {
    const pts = alongWide(plan(g, isPavement, 0), seg);
    expect(pts[0].lane).toBe(1);
  });

  it("keeps lane 0 where there is no paving data (streets as before)", () => {
    const pts = alongWide(plan(g, undefined), seg);
    expect(new Set(pts.map((q) => q.lane))).toEqual(new Set([0]));
  });

  // B, the other way (lane 0's line shifted in off the paving, 1 m clear of its edge): the car's
  // 1.8 m body would reach over the line between lanes 0 and 1, which the violation check counts.
  it("leaves the path inside one painted lane, where a shifted lane-0 line would straddle two", () => {
    const shifted = edge - 1;
    const body = (offset: number) => [laneOfOffset(seg, offset + 0.9), laneOfOffset(seg, offset - 0.9)];
    const [leftA, rightA] = body(lane1);
    expect(leftA).toBe(rightA);
    const [leftB, rightB] = body(shifted);
    expect(leftB).not.toBe(rightB);
    expect(leftOf(new Vector3(1, 0, 0), 1).z).toBeLessThan(0); // north is left of travel east
  });
});

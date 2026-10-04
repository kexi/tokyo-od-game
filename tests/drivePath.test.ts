import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import {
  CENTRE_GAP,
  CENTRE_HUG,
  cornerPath,
  deflection,
  MIN_RADIUS,
  type CornerSpec,
} from "../src/game/drivePath";
import { planRoute, progressOn, type Route } from "../src/game/navigation";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { laneOffset, leftOf, RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";

// Local frame: x east, z south. These helpers take x east, y north metres.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const line = (pts: Array<[number, number]>, width = 8, oneway: RoadLine["oneway"] = 0): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  oneway,
  kind: "local",
});
const clock = gameClock(2026, 10, 1, 600);
const NORTH = new Vector3(0, 0, -1);
const EAST = new Vector3(1, 0, 0);
const WEST = new Vector3(-1, 0, 0);
const dirOf = (deg: number) =>
  new Vector3(Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180)); // compass bearing
const startOn = (graph: RoadGraph, x: number, y: number, heading: Vector3) => {
  const hit = graph.nearest(at(x, y), 6);
  if (!hit) throw new Error("no street");
  return { seg: hit.seg, s: hit.s, dir: (hit.dir.dot(heading) >= 0 ? 1 : -1) as 1 | -1 };
};
/** The largest gap between path points and the largest turn from one piece to the next. */
const roughness = (route: Route) => {
  let gap = 0;
  let kink = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i]
      .clone()
      .sub(route.points[i - 1])
      .setY(0);
    gap = Math.max(gap, a.length());
    if (i < 2 || a.lengthSq() < 1e-6) continue;
    const b = route.points[i - 1]
      .clone()
      .sub(route.points[i - 2])
      .setY(0);
    if (b.lengthSq() < 1e-6) continue;
    kink = Math.max(kink, Math.abs(deflection(b.normalize(), a.normalize())));
  }
  return { gap, kink: (kink * 180) / Math.PI };
};
const plan = (graph: RoadGraph, from: [number, number], heading: Vector3, to: [number, number]): Route => {
  const route = planRoute(graph, startOn(graph, from[0], from[1], heading), at(to[0], to[1]), clock, []);
  if (!route) throw new Error("no route");
  // Smooth enough to drive and draw: no jumps, no sharp kinks (the curves are sampled ≤ 1 m).
  const { gap, kink } = roughness(route);
  expect(gap).toBeLessThan(5.5);
  expect(kink).toBeLessThan(12);
  return route;
};
/** Metres left of the line through `p` along `dir` (negative: right of it). */
const leftOfLine = (q: Vector3, p: Vector3, dir: Vector3) => leftOf(dir, 1).dot(q.clone().sub(p).setY(0));
/** The path point nearest to `o`, the travel direction there and the distance. */
const closest = (points: Vector3[], o: Vector3) => {
  let best = { i: 0, d: Infinity };
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - o.x, p.z - o.z);
    if (d < best.d) best = { i, d };
  });
  const i = Math.min(Math.max(1, best.i), points.length - 1);
  const dir = points[i]
    .clone()
    .sub(points[i - 1])
    .setY(0)
    .normalize();
  return { ...best, p: points[best.i], dir };
};
const curveOf = (spec: Partial<CornerSpec> & Pick<CornerSpec, "kind" | "inDir" | "outDir">) => {
  const path = cornerPath({
    centre: new Vector3(),
    inOffset: 2,
    outOffset: 2,
    inHalf: 4,
    outHalf: 4,
    ...spec,
  });
  if (!path) throw new Error("no curve");
  return path;
};

describe("one corner's curve (第34条)", () => {
  it("turns left in a tight arc from the left lane into the new road's left lane (第1項)", () => {
    const c = curveOf({ kind: "left", inDir: NORTH, outDir: WEST });
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    // Starts in the approach lane (2 m left of its centreline), ends in the exit lane.
    expect(leftOfLine(first, new Vector3(), NORTH)).toBeCloseTo(2, 5);
    expect(leftOfLine(last, new Vector3(), WEST)).toBeCloseTo(2, 5);
    expect(c.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    // Never crosses either centre line: it keeps to the corner between the two left halves.
    for (const p of c.points) {
      expect(leftOfLine(p, new Vector3(), NORTH)).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(leftOfLine(p, new Vector3(), WEST)).toBeGreaterThanOrEqual(2 - 1e-6);
    }
    // A tight turn: it starts within the junction's reach, not 20 m before it.
    expect(c.back).toBeLessThan(10);
  });

  it("turns right passing just inside the junction centre, the centre on the driver's left (第2項)", () => {
    const c = curveOf({ kind: "right", inDir: NORTH, outDir: EAST, inOffset: CENTRE_HUG, outOffset: 2 });
    const o = new Vector3();
    const near = closest(c.points, o);
    // 交差点の中心の直近の内側: the centre is passed at CENTRE_GAP, on the left of the car.
    expect(near.d).toBeGreaterThan(CENTRE_GAP - 0.1);
    expect(near.d).toBeLessThan(CENTRE_GAP + 0.3);
    expect(leftOfLine(o, near.p, near.dir)).toBeGreaterThan(0);
    expect(c.inside).toBeGreaterThanOrEqual(CENTRE_GAP - 1e-6);
    // From beside the centre line into the far side's left lane.
    expect(leftOfLine(c.points[0], o, NORTH)).toBeCloseTo(CENTRE_HUG, 5);
    expect(leftOfLine(c.points[c.points.length - 1], o, EAST)).toBeCloseTo(2, 5);
  });

  it("is tangent to both lanes at a skewed (Y) junction", () => {
    for (const [kind, outBearing] of [
      ["left", -60],
      ["left", -125],
      ["right", 60],
      ["right", 130],
    ] as const) {
      const outDir = dirOf(outBearing);
      const c = curveOf({ kind, inDir: NORTH, outDir, inOffset: kind === "right" ? CENTRE_HUG : 2 });
      const pts = c.points;
      const head = pts[1].clone().sub(pts[0]).normalize();
      const tail = pts[pts.length - 1]
        .clone()
        .sub(pts[pts.length - 2])
        .normalize();
      expect(Math.abs(deflection(NORTH, head))).toBeLessThan(0.15);
      expect(Math.abs(deflection(outDir, tail))).toBeLessThan(0.15);
      expect(leftOfLine(pts[pts.length - 1], new Vector3(), outDir)).toBeCloseTo(2, 5);
      if (kind === "right") expect(c.inside).toBeGreaterThan(0);
    }
  });

  it("turns right out of a one-way street from its right edge, inside the centre (第4項)", () => {
    const c = curveOf({
      kind: "right",
      inDir: NORTH,
      outDir: EAST,
      inOffset: -2.25,
      outOffset: 2,
      fromOneWay: true,
    });
    expect(leftOfLine(c.points[0], new Vector3(), NORTH)).toBeCloseTo(-2.25, 5);
    for (const p of c.points) expect(leftOfLine(p, new Vector3(), NORTH)).toBeLessThanOrEqual(-2.25 + 1e-6);
    expect(c.inside).toBeGreaterThan(0);
  });

  it("fits a cramped corner: never starts further back than it may", () => {
    const c = curveOf({ kind: "left", inDir: NORTH, outDir: WEST, maxBack: 4, maxAhead: 4 });
    expect(c.back).toBeLessThanOrEqual(4 + 1e-6);
    expect(c.ahead).toBeLessThanOrEqual(4 + 1e-6);
  });

  it("makes a U-turn at a dead end as a half loop through the right into the other lane", () => {
    const c = curveOf({ kind: "uturn", inDir: NORTH, outDir: NORTH.clone().negate() });
    expect(leftOfLine(c.points[0], new Vector3(), NORTH)).toBeCloseTo(2, 5);
    expect(leftOfLine(c.points[c.points.length - 1], new Vector3(), NORTH)).toBeCloseTo(-2, 5);
    // Not past the end of the street.
    for (const p of c.points) expect(-p.z).toBeLessThanOrEqual(1e-6);
  });
});

// A crossroads of 8 m two-way streets at (0, 100), arms 100 m.
const cross = (width = 8, oneway: RoadLine["oneway"] = 0) => [
  line(
    [
      [0, 0],
      [0, 100],
    ],
    width,
    oneway,
  ),
  line(
    [
      [0, 100],
      [0, 200],
    ],
    width,
    oneway,
  ),
  line(
    [
      [0, 100],
      [100, 100],
    ],
    width,
  ),
  line(
    [
      [0, 100],
      [-100, 100],
    ],
    width,
  ),
];

describe("the path of a route through a junction", () => {
  it("keeps the route distances: the turn is still announced at the junction", () => {
    const route = plan(new RoadGraph(cross(), frame), [0, 10], NORTH, [80, 100]);
    expect(route.maneuvers.map((m) => [m.turn, Math.round(m.at)])).toEqual([["right", 90]]);
    expect(route.length).toBeCloseTo(170, 0);
    expect(route.cum.every((c, i) => i === 0 || c >= route.cum[i - 1])).toBe(true);
  });

  it("turns right from beside the centre line, just inside the centre, into the far left lane", () => {
    const route = plan(new RoadGraph(cross(), frame), [0, 10], NORTH, [80, 100]);
    const o = at(0, 100);
    const near = closest(route.points, o);
    expect(near.d).toBeGreaterThan(CENTRE_GAP - 0.1);
    expect(near.d).toBeLessThan(CENTRE_GAP + 0.3);
    expect(leftOfLine(o, near.p, near.dir)).toBeGreaterThan(0); // the centre on the driver's left
    // 第34条第2項: by the centre line just before the junction, the left lane 70 m before it.
    expect(leftOfLine(route.points[route.cum.findIndex((c) => c >= 80)], at(0, 0), NORTH)).toBeCloseTo(
      CENTRE_HUG,
      1,
    );
    expect(leftOfLine(route.points[route.cum.findIndex((c) => c >= 20)], at(0, 0), NORTH)).toBeCloseTo(2, 1);
    // After the turn: the left lane of the far side, 2 m north of the east arm's centreline.
    expect(leftOfLine(route.points[route.cum.findIndex((c) => c >= 140)], at(0, 100), EAST)).toBeCloseTo(
      2,
      1,
    );
    expect(route.corners.map((c) => c.kind)).toEqual(["right"]);
  });

  it("turns left hugging the kerb into the left lane", () => {
    const route = plan(new RoadGraph(cross(), frame), [0, 10], NORTH, [-80, 100]);
    const o = at(0, 100);
    for (const p of route.points) {
      // Left of both centre lines all the way: no corner cut across the oncoming lanes.
      const isNear = p.distanceTo(o) < 30;
      if (!isNear) continue;
      expect(leftOfLine(p, o, NORTH)).toBeGreaterThan(1.9);
      expect(leftOfLine(p, o, WEST)).toBeGreaterThan(1.9);
    }
    const [corner] = route.corners;
    expect(corner.kind).toBe("left");
    expect(corner.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    expect(corner.radius).toBeLessThan(8);
  });

  it("goes straight on in its lane, with no curve", () => {
    const route = plan(new RoadGraph(cross(), frame), [0, 10], NORTH, [0, 180]);
    expect(route.corners).toEqual([]);
    for (const p of route.points)
      expect(leftOfLine(p, at(0, 0), NORTH)).toBeCloseTo(laneOffset(route.steps[0].seg), 3);
  });

  it("turns right at a T-junction from the stem, inside the centre", () => {
    const lines = cross().filter((_, i) => i !== 1); // no north arm
    const route = plan(new RoadGraph(lines, frame), [0, 10], NORTH, [80, 100]);
    const near = closest(route.points, at(0, 100));
    expect(leftOfLine(at(0, 100), near.p, near.dir)).toBeGreaterThan(0);
    expect(near.d).toBeGreaterThan(CENTRE_GAP - 0.1);
  });

  it("turns at a skewed junction tangent to the streets", () => {
    // The exit leaves at 60° east of north (a slight right is a bend; this is a right turn).
    const lines = [
      line([
        [0, 0],
        [0, 100],
      ]),
      line([
        [0, 100],
        [86.6, 150],
      ]),
      line([
        [0, 100],
        [-100, 100],
      ]),
    ];
    const route = plan(new RoadGraph(lines, frame), [0, 10], NORTH, [70, 140]);
    expect(route.corners.map((c) => c.kind)).toEqual(["right"]);
    const near = closest(route.points, at(0, 100));
    expect(leftOfLine(at(0, 100), near.p, near.dir)).toBeGreaterThan(0);
    const exit = dirOf(60);
    const after = route.points[route.cum.findIndex((c) => c >= 140)];
    expect(leftOfLine(after, at(0, 100), exit)).toBeCloseTo(2, 1);
  });

  it("keeps to the centre of a narrow street without a centre line, and turns wide enough to drive", () => {
    const route = plan(new RoadGraph(cross(4), frame), [0, 10], NORTH, [-80, 100]);
    expect(leftOfLine(route.points[3], at(0, 0), NORTH)).toBeCloseTo(0, 3); // 4 m: no lane to keep to
    expect(route.corners[0].radius).toBeGreaterThanOrEqual(MIN_RADIUS);
  });

  it("turns right out of a one-way street from its right edge (第4項)", () => {
    // The north–south street is one way northbound, 9 m wide.
    const route = plan(new RoadGraph(cross(9, 1), frame), [0, 10], NORTH, [80, 100]);
    const [corner] = route.corners;
    // By the right edge (a quarter of the width in) before the curve; the left part 50 m before.
    const approach = route.points.filter((_, i) => route.cum[i] > 60 && route.cum[i] < corner.from);
    const rightmost = Math.min(...approach.map((p) => leftOfLine(p, at(0, 0), NORTH)));
    expect(rightmost).toBeCloseTo(-2.25, 1);
    expect(leftOfLine(route.points[route.cum.findIndex((c) => c >= 40)], at(0, 0), NORTH)).toBeCloseTo(0, 3);
    expect(corner.kind).toBe("right");
    expect(route.corners[0].inside).toBeGreaterThan(0);
  });

  it("turns right onto a dual carriageway across the median, onto the far carriageway only", () => {
    // East–west road with a median: westbound carriageway at y = 96, eastbound at y = 104 (left-hand
    // traffic: eastbound on the north side); a side road from the south crosses both.
    const lines = [
      line(
        [
          [-100, 104],
          [0, 104],
          [100, 104],
        ],
        7,
        1,
      ),
      line(
        [
          [100, 96],
          [0, 96],
          [-100, 96],
        ],
        7,
        1,
      ),
      line([
        [0, 0],
        [0, 96],
      ]),
      line([
        [0, 96],
        [0, 104],
      ]),
      line([
        [0, 104],
        [0, 200],
      ]),
    ];
    const route = plan(new RoadGraph(lines, frame), [0, 10], NORTH, [80, 104]);
    expect(route.corners.map((c) => c.kind)).toEqual(["right"]);
    for (let i = 1; i < route.points.length; i++) {
      const p = route.points[i];
      const dir = p
        .clone()
        .sub(route.points[i - 1])
        .setY(0)
        .normalize();
      // On the westbound carriageway the path only crosses it (heading north-ish), never along it.
      const isOnNear =
        Math.abs(leftOfLine(p, at(0, 96), EAST)) < 3.5 && Math.abs(leftOfLine(p, at(0, 0), NORTH)) < 20;
      if (isOnNear) expect(dir.dot(NORTH)).toBeGreaterThan(0.7);
    }
    // It ends eastbound on the far carriageway.
    const last = route.points[route.points.length - 1];
    expect(Math.abs(leftOfLine(last, at(0, 104), EAST))).toBeLessThan(1);
  });

  it("goes round a roundabout clockwise along its left edge: in by a left turn, out by a left turn (第35条の2)", () => {
    // A one-way ring (clockwise seen from above, radius 20 m round (0, 100)) with roads from the south and the west.
    const ring: Array<[number, number]> = [];
    for (let k = 0; k <= 12; k++) {
      // Clockwise from the south point: south → west → north → east.
      const a = Math.PI + (k * Math.PI * 2) / 12;
      ring.push([20 * Math.sin(a), 100 + 20 * Math.cos(a)]);
    }
    const lines = [
      line(ring.slice(0, 4), 7, 1),
      line(ring.slice(3, 7), 7, 1),
      line(ring.slice(6, 10), 7, 1),
      line(ring.slice(9, 13), 7, 1),
      line([
        [0, 0],
        [0, 80],
      ]),
      line([
        [20, 100],
        [120, 100],
      ]),
    ];
    // In from the south, round three quarters, out to the east.
    const route = plan(new RoadGraph(lines, frame), [0, 10], NORTH, [100, 100]);
    const kinds = route.corners.map((c) => c.kind);
    expect(kinds[0]).toBe("left");
    expect(kinds[kinds.length - 1]).toBe("left");
    expect(kinds.slice(1, -1).every((k) => k === "bend")).toBe(true);
    // Never across to the ring's inner edge.
    for (const p of route.points) expect(p.distanceTo(at(0, 100))).toBeGreaterThan(20 - 3.5);
  });
});

/**
 * How far the car's centre is from the kerbs of the crossroads at `o` (8 m streets), the corners
 * rounded at 3 m — about a 2 m 隅切り; GSI has no corner geometry.
 */
const kerbClearance = (p: Vector3, o: Vector3) => {
  const x = Math.abs(p.x - o.x);
  const y = Math.abs(p.z - o.z);
  const r = 3;
  return Math.hypot(Math.max(0, 4 + r - x), Math.max(0, 4 + r - y)) - r;
};

describe("the autopilot drives the path the navigation shows", () => {
  const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
  const worldOf = (graph: RoadGraph): DriveWorld => ({
    graph,
    control: noSignals,
    turnRules: [],
    clock,
    obstacles: [],
  });
  /** Kinematic bicycle model with the physics car's limits; returns the track. */
  const drive = (graph: RoadGraph, target: [number, number]) => {
    const driver = new AutoDriver();
    const start = at(-2, 10);
    let yaw = Math.PI; // north
    driver.place(start, yaw);
    if (!driver.plan(worldOf(graph), at(target[0], target[1]))) throw new Error("no route");
    const pos = start.clone();
    let v = 0;
    let steer = 0;
    const track: Array<{ pos: Vector3; v: number; yaw: number }> = [];
    const dt = 1 / 30;
    for (let t = 0; t < 60; t += dt) {
      const out = driver.update(dt, worldOf(graph), { position: pos, yaw, speed: v });
      if (out.done) break;
      steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
      yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
      pos.x += Math.sin(yaw) * v * dt;
      pos.z += Math.cos(yaw) * v * dt;
      track.push({ pos: pos.clone(), v, yaw });
    }
    return { driver, track };
  };

  it("turns right inside the centre and never drives on the right of a street (第17条)", () => {
    const graph = new RoadGraph(cross(), frame);
    const { driver, track } = drive(graph, [80, 100]);
    const o = at(0, 100);
    let nearest = Infinity;
    for (const { pos, v, yaw } of track) {
      nearest = Math.min(nearest, pos.distanceTo(o));
      // The body (half width 0.85 m) clear of the kerbs.
      expect(kerbClearance(pos, o)).toBeGreaterThan(0.85);
      const hit = graph.nearest(pos, 10);
      const isInJunction = pos.distanceTo(o) < 6; // crossing the oncoming half is the right turn itself
      if (!hit || isInJunction) continue;
      const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const align = f.dot(hit.dir);
      // The game's 右側通行 check: aligned with a street, over 10 km/h, 0.8 m right of its centre.
      const isRightSide = v * 3.6 > 10 && Math.abs(align) > 0.8 && hit.lateral * Math.sign(align) < -0.8;
      expect(isRightSide).toBe(false);
    }
    // It passed the centre on the inside, not through it.
    expect(nearest).toBeGreaterThan(0.4);
    const route = driver.route;
    if (!route) throw new Error("no route");
    const end = track[track.length - 1].pos;
    expect(progressOn(route, end, route.points.length - 30).off).toBeLessThan(0.6);
  });

  it("turns left without crossing the centre line or mounting the kerb", () => {
    const graph = new RoadGraph(cross(), frame);
    const { track } = drive(graph, [-80, 100]);
    const o = at(0, 100);
    for (const { pos, yaw } of track) {
      expect(kerbClearance(pos, o)).toBeGreaterThan(0.85);
      const hit = graph.nearest(pos, 10);
      if (!hit) continue;
      const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const leftOfTravel = hit.lateral * Math.sign(f.dot(hit.dir) || 1);
      expect(leftOfTravel).toBeGreaterThan(0.85); // its right side never over the centre line
    }
  });
});

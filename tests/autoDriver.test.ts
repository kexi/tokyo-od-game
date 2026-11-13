import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, laneCentre, type DriveWorld } from "../src/game/autoDriver";
import { steerLimit, WHEELBASE, type DriveInput } from "../src/physics/vehicle";
import { OSM_EXPRESSWAY_KIND } from "../src/world/roadClass";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const road = (x0: number, y0: number, x1: number, y1: number, width = 8): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width,
  oneway: 0,
  kind: "local",
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
// An L: 200 m north, then a right turn and 150 m east.
const lShape = () => [road(0, 0, 0, 200), road(0, 200, 150, 200)];
const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
const worldOf = (graph: RoadGraph): DriveWorld => ({
  graph,
  control: noSignals,
  turnRules: [],
  clock: gameClock(2026, 10, 1, 600),
  obstacles: [],
});

/** Kinematic bicycle model with the physics car's limits: it only obeys the wheel and pedals. */
function simulate(driver: AutoDriver, world: DriveWorld, start: Vector3, yaw: number, seconds: number) {
  const pos = start.clone();
  let v = 0;
  let steer = 0;
  let worstOffset = 0;
  let done = false;
  const dt = 1 / 30;
  for (let t = 0; t < seconds && !done; t += dt) {
    const out = driver.update(dt, world, { position: pos, yaw, speed: v });
    const input: DriveInput = out.input;
    done = out.done;
    steer += (input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
    v = Math.max(0, v + (input.throttle * 4.16 - 0.12 * v - input.brake * 7) * dt);
    yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
    pos.x += Math.sin(yaw) * v * dt;
    pos.z += Math.cos(yaw) * v * dt;
    const hit = world.graph.nearest(pos, 20);
    if (hit) worstOffset = Math.max(worstOffset, Math.abs(hit.lateral));
  }
  return { pos, done, worstOffset };
}

describe("self-driving lane positions (第18条・第20条)", () => {
  const seg = (width: number, lanes: number, oneway: 0 | 1 = 0) =>
    ({ line: { width }, lanes, oneway }) as unknown as Segment;

  it("puts each lane between the painted 車線境界線 of its direction", () => {
    const s = seg(25, 3);
    // 3 lanes a direction need 3 × 3.25 m and a 0.5 m shoulder: the lanes' edge is 0.5 m inside 10.25 m.
    const edge = 3 * 3.25;
    for (let i = 0; i < 3; i++) {
      const c = laneCentre(s, i);
      expect(c).toBeLessThan(edge - i * 3.25);
      expect(c).toBeGreaterThan(edge - (i + 1) * 3.25);
    }
  });

  it("numbers lanes from the left: lane 0 is the one by the kerb", () => {
    const s = seg(25, 3);
    expect(laneCentre(s, 0)).toBeGreaterThan(laneCentre(s, 2));
  });

  it("keeps the lane centre inside the 0.5 m shoulder, so the body (0.85 m half width) clears the edge", () => {
    expect(laneCentre(seg(6, 2), 0)).toBeLessThanOrEqual(3 - 0.5 - 0.85 + 0.3);
    // Where the 幅員 holds the pavement, the lanes keep 3.25 m and stay off the kerb.
    expect(laneCentre(seg(30, 2), 0)).toBeCloseTo(2 * 3.25 - 3.25 / 2, 9);
  });
});

describe("self-driving by wheel and pedals", () => {
  it("starts from the road beside the one it stands on when only that one leads to the target (S6 PR 7c1)", () => {
    // Two one-way roads north, 4 m apart (two runs on one slab, as 45021972 on 45021976's): the
    // nearer one ends at y 200, the other goes on to the target. Every start is first aimed at the
    // road nearest the target; only failing that at what it reaches (planRoute's aimInReach), which
    // for the nearer road is its own dead end.
    const dead: RoadLine = { ...road(0, 0, 0, 200), oneway: 1 };
    const on: RoadLine = { ...road(4, 0, 4, 400), oneway: 1 };
    const graph = new RoadGraph([dead, on], frame);
    const driver = new AutoDriver();
    driver.place(at(0.5, 100), Math.PI);
    expect(driver.plan(worldOf(graph), at(4, 390))).toBe(true);
    expect(driver.route!.reachesTarget).toBe(true);
    expect(driver.route!.steps[0].seg.line).toBe(graph.segments.find((s) => s.length > 300)!.line);
  });

  describe("standing still on a ramp's at-grade connector (汐留出口's foot, at the red)", () => {
    // An off-ramp's ground connector (OSM, 4 m) running south down to a street. carriagewaysAt
    // indexes the streets only (usesGroundSurface), so on the connector it finds nothing: the car
    // counted as off every road and 切り返し'd forward over the stop line (信号無視).
    const connector: RoadLine = {
      ...road(0, 150, 0, 0, 4),
      oneway: 1,
      kind: OSM_EXPRESSWAY_KIND,
      source: "osm",
      cls: "ramp",
      structure: "ground",
      level: 0,
    };
    const graph = new RoadGraph([road(-200, 0, 0, 0, 10), road(0, 0, 200, 0, 10), connector], frame);
    const ramp = graph.segments.find((seg) => seg.line.cls === "ramp")!;
    /** Standing `side` m left of the connector's centreline at y = 100, facing down it. */
    const standAt = (side: number) => {
      const { pos, dir } = graph.sample(ramp, 50);
      const start = pos.clone().add(new Vector3(dir.z, 0, -dir.x).multiplyScalar(side));
      const yaw = Math.atan2(dir.x, dir.z);
      const driver = new AutoDriver();
      driver.place(start, yaw);
      expect(driver.plan(worldOf(graph), at(-150, 0))).toBe(true);
      for (let t = 0; t < 1; t += 1 / 30)
        driver.update(1 / 30, worldOf(graph), { position: start, yaw, speed: 0 });
      return { activity: driver.activity, lostWhy: driver.lostWhy };
    };

    it("counts the connector the route runs along as road, up to 1 m past its half width", () => {
      expect(standAt(0)).toEqual({ activity: "drive", lostWhy: null });
      expect(standAt(2.9)).toEqual({ activity: "drive", lostWhy: null });
      expect(standAt(-2.9)).toEqual({ activity: "drive", lostWhy: null });
    });

    it("still aligns a slow car standing off every road beside its path", () => {
      expect(standAt(3.1)).toEqual({ activity: "manoeuvre", lostWhy: "offRoad" });
      expect(standAt(-3.1)).toEqual({ activity: "manoeuvre", lostWhy: "offRoad" });
    });
  });

  it("follows the street round a right turn and stops at the destination", () => {
    const graph = new RoadGraph(lShape(), frame);
    const driver = new AutoDriver();
    const start = at(1.5, 5);
    driver.place(start, Math.PI); // heading north (-Z)
    expect(driver.plan(worldOf(graph), at(120, 200))).toBe(true);
    const { pos, done, worstOffset } = simulate(driver, worldOf(graph), start, Math.PI, 90);
    expect(done).toBe(true);
    expect(pos.distanceTo(at(120, 200))).toBeLessThan(6);
    // Never off the 8 m carriageway by more than a wheel's width (corner cut included).
    expect(worstOffset).toBeLessThan(4.5);
  });

  it("drives at or under the statutory limit and holds the brake once stopped", () => {
    const graph = new RoadGraph(lShape(), frame);
    const driver = new AutoDriver();
    const start = at(1.5, 5);
    driver.place(start, Math.PI);
    driver.plan(worldOf(graph), at(0, 150));
    let top = 0;
    const pos = start.clone();
    let v = 0;
    let last: DriveInput | null = null;
    for (let t = 0; t < 60; t += 1 / 30) {
      const out = driver.update(1 / 30, worldOf(graph), { position: pos, yaw: Math.PI, speed: v });
      last = out.input;
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) / 30);
      pos.z -= v / 30;
      top = Math.max(top, v);
    }
    expect(top * 3.6).toBeLessThanOrEqual(60);
    expect(last?.brake).toBe(1);
    expect(last?.brakeOnly).toBe(true);
  });
});

import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, laneCentre, type DriveWorld } from "../src/game/autoDriver";
import { steerLimit, WHEELBASE, type DriveInput } from "../src/physics/vehicle";
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
    const laneWidth = 12.5 / 3;
    for (let i = 0; i < 3; i++) {
      const c = laneCentre(s, i);
      expect(c).toBeLessThan(12.5 - i * laneWidth);
      expect(c).toBeGreaterThan(12.5 - (i + 1) * laneWidth);
    }
  });

  it("numbers lanes from the left: lane 0 is the one by the kerb", () => {
    const s = seg(25, 3);
    expect(laneCentre(s, 0)).toBeGreaterThan(laneCentre(s, 2));
  });

  it("keeps the car at least 1.6 m inside the edge, as GSI 幅員 can include the pavement", () => {
    expect(laneCentre(seg(6, 2), 0)).toBeLessThanOrEqual(3 - 1.6);
  });
});

describe("self-driving by wheel and pedals", () => {
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

import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, type DriveObstacle, type DriveWorld } from "../src/game/autoDriver";
import type { Route } from "../src/game/navigation";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";

// D4: the autopilot's car in front while the car runs at a slant to its path (大手町一丁目, 区間 192:
// 5–7° off it, at 55 km/h). These drive the AutoDriver on a plain street, so they hold whatever
// the road data does (after G1 the 大手町 drift is expected to go, and the drives no longer show it).

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const at = (x: number, y: number) =>
  frame
    .toLocal(35.68 + y * LAT, 139.76 + x / (111_320 * Math.cos((35.68 * Math.PI) / 180)), frame.origin.h)
    .setY(0);
/** A 12 m one-way street 600 m north (60 km/h, 施行令 第11条). */
const street: RoadLine = {
  coords: [139.76, 35.68, 139.76, 35.68 + 600 * LAT],
  width: 12,
  oneway: 1,
  kind: "local",
};
const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
const OWN_HALF = 2.15;
const OTHER_HALF = 2.25;
/** Stopping distance at v (m/s): 0.75 s to react and 4 m/s² (followSpeed's REACTION and FOLLOW_DECEL). */
const stoppingDistance = (v: number) => v * 0.75 + (v * v) / 8;

function along(route: Route, d: number): { pos: Vector3; dir: Vector3 } {
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.points[i - 1];
  const b = route.points[i];
  const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
  return { pos: a.clone().lerp(b, Math.min(1, Math.max(0, t))), dir: b.clone().sub(a).setY(0).normalize() };
}

function plannedDriver() {
  const graph = new RoadGraph([street], frame);
  const driver = new AutoDriver();
  driver.place(at(0, 20), 0);
  const world: DriveWorld = {
    graph,
    control: noSignals,
    turnRules: [],
    clock: gameClock(2026, 10, 1, 600),
    obstacles: [],
    vehicles: [],
  };
  expect(driver.plan(world, at(0, 590))).toBe(true);
  return { driver, world, route: driver.route! };
}

describe("the car in front while the autopilot runs at a slant to its path (D4)", () => {
  it("T-f7: picks a car standing on its course 70 m ahead at a stopping distance or more, and stops short of it", () => {
    const { driver, world, route } = plannedDriver();
    const start = along(route, 60);
    // 3.5° to the right of the path, the wheel held: the car keeps its slant as 大手町's kerb kept
    // it (D2). Why not let the driver steer: on a plain street it turns back onto its path, and
    // the slant this test is about never lasts. Why 3.5° from the path and not 6° from 2 m off it:
    // at 6° the car is 4.5 m off its path (OFF_LANE) after 43 m and stops for that, before the car
    // 70 m ahead could matter; at 3.5° it is 4.3 m off at 70 m.
    const slant = (3.5 * Math.PI) / 180;
    const right = new Vector3(-start.dir.z, 0, start.dir.x);
    const heading = start.dir.clone().multiplyScalar(Math.cos(slant)).addScaledVector(right, Math.sin(slant));
    const yaw = Math.atan2(heading.x, heading.z);
    const key = {};
    const standing: DriveObstacle = {
      position: start.pos.clone().addScaledVector(heading, 70),
      kind: "vehicle",
      speed: 0,
      heading: yaw,
      key,
      source: "traffic",
    };
    world.vehicles = [standing];
    const pos = start.pos.clone();
    let v = 55 / 3.6;
    let pickedAt: { gap: number; v: number } | null = null;
    let nearest = Infinity;
    let lost: string | null = null;
    const dt = 1 / 30;
    for (let t = 0; t < 20 && (v > 0.05 || t < 1); t += dt) {
      const out = driver.update(dt, world, { position: pos, yaw, speed: v });
      lost ??= driver.lostWhy;
      // The gap the driver followed by (its look's bumper to bumper), not the log's candidates:
      // those list only the first 60 m.
      const isPicked = driver.frontPickKey === key;
      const gap = driver.why?.front?.gap;
      if (isPicked && !pickedAt && gap !== undefined) pickedAt = { gap, v };
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
      pos.addScaledVector(heading, v * dt);
      nearest = Math.min(nearest, pos.distanceTo(standing.position));
    }
    // The case holds only while the car is on its lane by the driver's own test.
    expect(lost).toBeNull();
    expect(pickedAt).not.toBeNull();
    expect(pickedAt!.gap).toBeGreaterThanOrEqual(stoppingDistance(pickedAt!.v));
    // Stopped short: the two bodies (half lengths 2.15 + 2.25 m) never meet along the course.
    expect(nearest).toBeGreaterThan(OWN_HALF + OTHER_HALF);
    expect(v).toBeLessThan(0.1);
  });

  it("T-f8: on its path, never takes a queue standing in the lane alongside (3.25 m across) for the car in front, nor slows more than before for it", () => {
    const { driver, world, route } = plannedDriver();
    const start = along(route, 60);
    const keys = [{}, {}, {}, {}];
    world.vehicles = keys.map((key, i): DriveObstacle => {
      const p = along(route, 100 + i * 7);
      const right = new Vector3(-p.dir.z, 0, p.dir.x);
      return {
        position: p.pos.clone().addScaledVector(right, 3.25),
        kind: "vehicle",
        speed: 0,
        heading: Math.atan2(p.dir.x, p.dir.z),
        key,
        source: "traffic",
      };
    });
    const pos = start.pos.clone();
    let yaw = Math.atan2(start.dir.x, start.dir.z);
    let v = 50 / 3.6;
    let steer = 0;
    let slowest = Infinity;
    let picked = false;
    const dt = 1 / 30;
    for (let t = 0; t < 12; t += dt) {
      const out = driver.update(dt, world, { position: pos, yaw, speed: v });
      picked ||= keys.includes(driver.frontPick?.picked as object);
      steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
      yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
      pos.x += Math.sin(yaw) * v * dt;
      pos.z += Math.cos(yaw) * v * dt;
      const isBeside = driver.remaining > 0 && Math.abs(pos.distanceTo(along(route, 115).pos)) < 40;
      if (isBeside) slowest = Math.min(slowest, v * 3.6);
    }
    expect(picked).toBe(false);
    // The slowest speed beside the queue as main drove it before the D4 fix (km/h, measured).
    expect(Math.abs(slowest - SLOWEST_BESIDE_QUEUE_KMH)).toBeLessThanOrEqual(0.5);
  });
});

/** T-f8's slowest speed beside the queue on main before the D4 fix (km/h, measured at bd7d931 + #116). */
const SLOWEST_BESIDE_QUEUE_KMH = 53.49;

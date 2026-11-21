import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, type DriveObstacle, type DriveWorld } from "../src/game/autoDriver";
import type { Route } from "../src/game/navigation";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";
import { TrafficAI } from "../src/world/traffic-ai";

vi.mock("../src/game/carModel", () => ({ createLowCar: () => new Group() }));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
/** A 12 m one-way street 400 m north. */
const street: RoadLine = {
  coords: [139.76, 35.68, 139.76, 35.68 + 400 * LAT],
  width: 12,
  oneway: 1,
  kind: "local",
};
const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;

/** The point `d` m along the route's path and the path's heading there. */
function along(route: Route, d: number): { pos: Vector3; dir: Vector3 } {
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.points[i - 1];
  const b = route.points[i];
  const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
  return { pos: a.clone().lerp(b, Math.min(1, Math.max(0, t))), dir: b.clone().sub(a).setY(0).normalize() };
}
/** `p` moved `left` m to the left of `dir` (left of travel is (dz, −dx) in this frame). */
const leftOf = (p: Vector3, dir: Vector3, left: number) =>
  p.clone().add(new Vector3(dir.z, 0, -dir.x).multiplyScalar(left));

/**
 * A driver planned to `targetY` m up the street, its car on the path 50 m up it (heading along
 * the path), and the world with these vehicles (placed by `place` from the route).
 */
function setUp(targetY: number, place: (route: Route) => DriveObstacle[]) {
  const graph = new RoadGraph([street], frame);
  const driver = new AutoDriver();
  const start = at(0, 40);
  driver.place(start, 0);
  const world: DriveWorld = {
    graph,
    control: noSignals,
    turnRules: [],
    clock: gameClock(2026, 10, 1, 600),
    obstacles: [],
  };
  expect(driver.plan(world, at(0, targetY))).toBe(true);
  const route = driver.route!;
  const car = along(route, 10);
  world.vehicles = place(route);
  const pose = { position: car.pos, yaw: Math.atan2(car.dir.x, car.dir.z), speed: 8 };
  driver.update(1 / 30, world, pose);
  return { driver, route, car };
}

describe("the autopilot's pick of the car in front, for the log (D4 autopilot_front_pick)", () => {
  it("lists a vehicle on the path ahead as a candidate, across from the nose, and the nearest in the band as picked", () => {
    const near = { key: {} };
    const wide = { key: {} };
    const { driver } = setUp(390, (route) => {
      const a = along(route, 40);
      const b = along(route, 55);
      return [
        {
          position: leftOf(a.pos, a.dir, 0.5),
          kind: "vehicle",
          speed: 0,
          heading: 0,
          key: near.key,
          source: "traffic",
        },
        { position: leftOf(b.pos, b.dir, 3), kind: "parked", heading: 0, key: wide.key, source: "parked" },
      ];
    });
    const pick = driver.frontPick!;
    expect(pick.tick).toBe(driver.ticks);
    expect(pick.picked).toBe(near.key);
    const a = pick.candidates.find((c) => c.key === near.key)!;
    const b = pick.candidates.find((c) => c.key === wide.key)!;
    expect(a.ahead).toBeCloseTo(30, 0);
    expect(a.fromOwn).toBeCloseTo(0.5 - pick.own, 1);
    expect(a.picked).toBe(true);
    expect(a.source).toBe("traffic");
    expect(b.fromOwn).toBeCloseTo(3 - pick.own, 1);
    expect(b.picked).toBe(false);
    expect(pick.dropped).toEqual([]);
  });

  it("names a vehicle straight ahead that the look leaves out: past the route's end (offPath) or on another level", () => {
    const pastEnd = { key: {} };
    const above = { key: {} };
    // The route ends about 25 m ahead of the car: a car 45 m up the street is 20 m off its path.
    const { driver, car } = setUp(75, () => [
      { position: car0(45), kind: "vehicle", speed: 0, heading: 0, key: pastEnd.key, source: "traffic" },
      {
        position: car0(15).setY(10),
        kind: "vehicle",
        speed: 0,
        heading: 0,
        key: above.key,
        source: "patrol",
      },
    ]);
    function car0(ahead: number) {
      return at(0, 50 + ahead);
    }
    const pick = driver.frontPick!;
    expect(car.pos.distanceTo(at(0, 50))).toBeLessThan(5);
    expect(pick.candidates.map((c) => c.key)).not.toContain(pastEnd.key);
    const dropped = new Map(pick.dropped.map((d) => [d.key, d]));
    expect(dropped.get(pastEnd.key)?.why).toBe("offPath");
    expect(dropped.get(pastEnd.key)?.ahead).toBeCloseTo(45, -1);
    expect(dropped.get(above.key)?.why).toBe("level");
    expect(dropped.get(above.key)?.source).toBe("patrol");
    expect(pick.picked).toBeNull();
  });
});

describe("TrafficAI.keyOf (the accident line's otherKind and otherRef)", () => {
  it("tells a traffic car from a kerbside parked car by its collider, by the key the look knows it by, and nothing for a handle it does not know", () => {
    // Narrow streets, where cars are parked (as retireObject.test.ts).
    const lines: RoadLine[] = Array.from({ length: 100 }, (_, i) => ({
      coords: [139.76, 35.68 + i * 0.001, 139.761 + i * 0.0000037, 35.68 + i * 0.001],
      width: 6,
      kind: "local",
      oneway: 0,
    }));
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const ai = new TrafficAI(new Scene(), world, () => 0);
    try {
      const graph = new RoadGraph(lines, frame);
      ai.setGraph(graph);
      ai.isSeen = () => true;
      const seg = graph.segments[0];
      ai.placeCar(seg, 30, 0);
      const near = graph.sample(seg, 60).pos.clone();
      ai.update(1 / 60, near, near, new Vector3(0, 0, 1), 0);
      ai.update(1 / 60, near, near, new Vector3(0, 0, 1), 0);
      const inside = ai as unknown as {
        cars: Array<{ object: object; body: { collider(i: number): { handle: number } | null } | null }>;
        parked: Array<{ object: object; body: { collider(i: number): { handle: number } | null } }>;
      };
      const car = inside.cars[0];
      const parked = inside.parked[0];
      expect(car?.body).toBeTruthy();
      expect(parked).toBeDefined();
      expect(ai.keyOf(car.body!.collider(0)!.handle)).toEqual({ source: "traffic", key: car.object });
      expect(ai.keyOf(parked.body.collider(0)!.handle)).toEqual({ source: "parked", key: parked.object });
      expect(ai.parkedPoses().some((p) => p.key === parked.object)).toBe(true);
      expect(ai.keyOf(987654)).toBeNull();
    } finally {
      world.free();
    }
  });
});

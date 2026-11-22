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
// 5–7° off it, at 55 km/h), and the same choice where the car follows its path round turns and
// bends (the v2 rule must not take in the cars beside them: #125 did). These drive the AutoDriver
// on plain streets, so they hold whatever the road data does (after G1 the 大手町 drift is expected
// to go, and the drives no longer show it). Places are east x, north y in metres.

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const line = (pts: Array<[number, number]>, width: number, oneway: 0 | 1): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  oneway,
  kind: "local",
});
/** A 12 m one-way street 600 m north (60 km/h, 施行令 第11条). */
const street = line(
  [
    [0, 0],
    [0, 600],
  ],
  12,
  1,
);
const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
const OWN_HALF = 2.15;
const OTHER_HALF = 2.25;
/** Stopping distance at v (m/s): 0.75 s to react and 4 m/s² (followSpeed's REACTION and FOLLOW_DECEL). */
const stoppingDistance = (v: number) => v * 0.75 + (v * v) / 8;
/** How much later than main a turn may arrive (s): the v2 trial's worst was 0.3 s. */
const LATER_S = 0.5;
const DT = 1 / 30;

/**
 * The times main (before the D4 fix) arrived in the turn and bend cases (s, measured on 667d13c +
 * the D4 instruments with this file's drive), and T-f8's slowest speed beside the queue (km/h).
 */
const MAIN = {
  leftOncoming8: 28.3,
  leftQueue8: 28.3,
  leftOncoming12: 28.0,
  rightKerb12: [28.933, 28.933],
  bend: { 30: [26.467, 26.467], 60: [29.567, 29.567], 120: [35.8, 35.8] },
  frontLeaves: 38.967,
  backToLine: 31.933,
  nearOncoming: 28.3,
  slowestBesideQueueKmh: 53.49,
} as const;

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

/** A standing car at (x, y) heading toward (x + hx, y + hy), gone from `until` s on if given. */
type Standing = { x: number; y: number; hx: number; hy: number; until?: number };

/**
 * Drives the autopilot from `start` (heading `startDir`) to `goal` as tests/autoDriver.test.ts's
 * simulate does (the wheel and pedals as the driver gives them, 30 fps), with standing cars about,
 * for up to `seconds`. `planFrom`: where it plans from, if not the start (a start beside the line).
 * Returns when it arrived (s, NaN if not), whether it ever took one of the cars for the car in front.
 */
function drive(
  roads: RoadLine[],
  start: [number, number],
  startDir: [number, number],
  goal: [number, number],
  cars: Standing[],
  seconds = 90,
  planFrom?: [number, number],
) {
  const graph = new RoadGraph(roads, frame);
  const driver = new AutoDriver();
  const p0 = at(start[0], start[1]);
  const d0 = at(start[0] + startDir[0], start[1] + startDir[1])
    .sub(p0)
    .normalize();
  let yaw = Math.atan2(d0.x, d0.z);
  const keys = cars.map(() => ({}));
  const vehicles = cars.map((c, i): DriveObstacle => {
    const p = at(c.x, c.y);
    const d = at(c.x + c.hx, c.y + c.hy)
      .sub(p)
      .normalize();
    return {
      position: p,
      kind: "vehicle",
      speed: 0,
      heading: Math.atan2(d.x, d.z),
      key: keys[i],
      source: "traffic",
    };
  });
  const world: DriveWorld = {
    graph,
    control: noSignals,
    turnRules: [],
    clock: gameClock(2026, 10, 1, 600),
    obstacles: [],
    vehicles,
  };
  driver.place(planFrom ? at(planFrom[0], planFrom[1]) : p0, yaw);
  expect(driver.plan(world, at(goal[0], goal[1]))).toBe(true);
  const pos = p0.clone();
  let v = 0;
  let steer = 0;
  let arrived = Number.NaN;
  let tookOne = false;
  for (let t = 0; t < seconds && Number.isNaN(arrived); t += DT) {
    world.vehicles = vehicles.filter((_, i) => cars[i].until === undefined || t < cars[i].until!);
    const out = driver.update(DT, world, { position: pos, yaw, speed: v });
    tookOne ||= keys.includes(driver.frontPickKey as object);
    steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, DT * 8);
    v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * DT);
    yaw += ((v * Math.tan(steer)) / WHEELBASE) * DT;
    pos.x += Math.sin(yaw) * v * DT;
    pos.z += Math.cos(yaw) * v * DT;
    if (out.done) arrived = t;
  }
  return { arrived, tookOne };
}

/**
 * The car at a slant with the wheel held: `runIn` m on its path at 55 km/h, then `deg` to the
 * right of it, the pedals the driver's; a car standing `dist` m on along the slanted course from
 * where it turned off. Checked at the first stop (after it, main's car runs off its lane and its
 * moves would mix in); with `after` s more, the fastest it went after the stop.
 */
function slantDrive(deg: number, dist: number, runIn = 0, after = 0) {
  const { driver, world, route } = plannedDriver();
  const start = along(route, 60);
  const slant = (deg * Math.PI) / 180;
  const right = new Vector3(-start.dir.z, 0, start.dir.x);
  const heading = start.dir.clone().multiplyScalar(Math.cos(slant)).addScaledVector(right, Math.sin(slant));
  const yawOn = Math.atan2(start.dir.x, start.dir.z);
  const yawOff = Math.atan2(heading.x, heading.z);
  const turnOff = start.pos.clone().addScaledVector(start.dir, runIn);
  const key = {};
  const standing: DriveObstacle = {
    position: turnOff.clone().addScaledVector(heading, dist),
    kind: "vehicle",
    speed: 0,
    heading: yawOff,
    key,
    source: "traffic",
  };
  world.vehicles = [standing];
  const pos = start.pos.clone();
  let v = 55 / 3.6;
  let run = 0;
  let picked: { gap: number; v: number } | null = null;
  let nearest = Infinity;
  let lost: string | null = null;
  let stoppedAt: number | null = null;
  let fastestAfter = 0;
  for (let t = 0; t < 40; t += DT) {
    const isOff = run >= runIn;
    const out = driver.update(DT, world, { position: pos, yaw: isOff ? yawOff : yawOn, speed: v });
    // The gap the driver followed by (its look's bumper to bumper), not the log's candidates:
    // those list only the first 60 m.
    const gap = driver.why?.front?.gap;
    const isFirstPick = driver.frontPickKey === key && picked === null && gap !== undefined;
    if (isFirstPick) picked = { gap, v };
    // On the run-in the car holds 55 km/h: the standing car is not on its course yet.
    v = isOff ? Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * DT) : 55 / 3.6;
    pos.addScaledVector(isOff ? heading : start.dir, v * DT);
    run += v * DT;
    if (stoppedAt === null) {
      lost ??= driver.lostWhy;
      nearest = Math.min(nearest, pos.distanceTo(standing.position));
    }
    const hasStopped = isOff && v < 0.05;
    if (hasStopped && stoppedAt === null) stoppedAt = t;
    if (stoppedAt !== null) fastestAfter = Math.max(fastestAfter, v);
    const isDone = stoppedAt !== null && t > stoppedAt + after;
    if (isDone) break;
  }
  return { lost, picked, nearest, fastestAfter, stoppedAt };
}

/** The checks of T-f7, T-f7b and T-f9 at the first stop. */
function expectStoppedShort(r: ReturnType<typeof slantDrive>) {
  // On its lane by the driver's own test.
  expect(r.lost).toBeNull();
  expect(r.picked).not.toBeNull();
  expect(r.picked!.gap).toBeGreaterThanOrEqual(stoppingDistance(r.picked!.v));
  // The two bodies (half lengths 2.15 + 2.25 m) never meet along the course.
  expect(r.nearest).toBeGreaterThan(OWN_HALF + OTHER_HALF);
}

describe("the car in front while the autopilot runs at a slant to its path (D4)", () => {
  it("T-f7: 6° off its path from the start at 55 km/h, a car standing 50 m on its course: taken for the car in front at a stopping distance or more, and stopped short of on its lane", () => {
    expectStoppedShort(slantDrive(6, 50));
  });

  it("T-f7b: 3.5° off, the car 70 m on (#125's T-f7): the same", () => {
    expectStoppedShort(slantDrive(3.5, 70));
  });

  it("T-f9: 30 m on its path, then 5° off it (大手町's way), a car 55 m on from where it turned off: the same", () => {
    expectStoppedShort(slantDrive(5, 55, 30));
  });

  it("T-f10: stopped behind the car of T-f7 and T-f9, it does not move off for 20 s more", () => {
    for (const r of [slantDrive(6, 50, 0, 20), slantDrive(5, 55, 30, 20)]) {
      expect(r.stoppedAt).not.toBeNull();
      expect(r.fastestAfter).toBeLessThan(0.1);
    }
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
    for (let t = 0; t < 12; t += DT) {
      const out = driver.update(DT, world, { position: pos, yaw, speed: v });
      picked ||= keys.includes(driver.frontPickKey as object);
      steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, DT * 8);
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * DT);
      yaw += ((v * Math.tan(steer)) / WHEELBASE) * DT;
      pos.x += Math.sin(yaw) * v * DT;
      pos.z += Math.cos(yaw) * v * DT;
      const isBeside = driver.remaining > 0 && Math.abs(pos.distanceTo(along(route, 115).pos)) < 40;
      if (isBeside) slowest = Math.min(slowest, v * 3.6);
    }
    expect(picked).toBe(false);
    expect(Math.abs(slowest - MAIN.slowestBesideQueueKmh)).toBeLessThanOrEqual(0.5);
  });
});

// 200 m north, then a left turn and 150 m west, two-way.
const leftTurn = (w: number) => [
  line(
    [
      [0, 0],
      [0, 200],
    ],
    w,
    0,
  ),
  line(
    [
      [0, 200],
      [-150, 200],
    ],
    w,
    0,
  ),
];
const fromSouth: [number, number] = [-1.5, 100];
const north: [number, number] = [0, 1];
const west: [number, number] = [-120, 200];
/** Arrived, and no later than main by more than LATER_S. */
const expectOnTime = (arrived: number, main: number) => {
  expect(Number.isNaN(arrived)).toBe(false);
  expect(arrived).toBeLessThanOrEqual(main + LATER_S);
};

describe("the car in front where the autopilot follows its path round turns and bends (D4 v2)", () => {
  it("T-h1: a left turn does not stand for the oncoming cars waiting in the street turned into (8 m and 12 m)", () => {
    expectOnTime(
      drive(leftTurn(8), fromSouth, north, west, [{ x: -10, y: 202, hx: 1, hy: 0 }]).arrived,
      MAIN.leftOncoming8,
    );
    const queue = [0, 1, 2].map((i): Standing => ({ x: -12 - i * 7, y: 201.5, hx: 1, hy: 0 }));
    expectOnTime(drive(leftTurn(8), fromSouth, north, west, queue).arrived, MAIN.leftQueue8);
    expectOnTime(
      drive(leftTurn(12), fromSouth, north, west, [{ x: -12, y: 201.5, hx: 1, hy: 0 }]).arrived,
      MAIN.leftOncoming12,
    );
  });

  it("T-h2: a right turn does not stand for a car at the kerb outside it (2.88 m from the path, 12 m street)", () => {
    const rightTurn = [
      line(
        [
          [0, 0],
          [0, 200],
        ],
        12,
        0,
      ),
      line(
        [
          [0, 200],
          [150, 200],
        ],
        12,
        0,
      ),
    ];
    [12, 16].forEach((x, i) => {
      const r = drive(rightTurn, fromSouth, north, [120, 200], [{ x, y: 204.5, hx: 1, hy: 0 }]);
      expectOnTime(r.arrived, MAIN.rightKerb12[i]);
    });
  });

  it("T-h3: round a bend (radius 30, 60, 120 m) it does not stand for a queue in the lane alongside, outside or inside", () => {
    for (const R of [30, 60, 120] as const) {
      // 150 m north, then a quarter arc to the right, then 150 m east (one-way 12 m).
      const pts: Array<[number, number]> = [
        [0, 0],
        [0, 150],
      ];
      for (let a = 5; a <= 90; a += 5) {
        const r = (a * Math.PI) / 180;
        pts.push([R - R * Math.cos(r), 150 + R * Math.sin(r)]);
      }
      pts.push([R + 150, 150 + R]);
      [3.25, -3.25].forEach((side, i) => {
        // On the arc at radius R + side (+: the outside, left of travel), every 4° or 7 m from 20° to 76°.
        const cars: Standing[] = [];
        for (let a = 20; a <= 76; a += Math.max(4, (7 / R) * (180 / Math.PI))) {
          const r = (a * Math.PI) / 180;
          cars.push({
            x: R - (R + side) * Math.cos(r),
            y: 150 + (R + side) * Math.sin(r),
            hx: Math.sin(r),
            hy: Math.cos(r),
          });
        }
        const r = drive([line(pts, 12, 1)], [0, 60], north, [R + 120, 150 + R], cars);
        expectOnTime(r.arrived, MAIN.bend[R][i]);
      });
    }
  });

  it("T-h4: stood in a left turn behind the car in front until it leaves at 25 s, an oncoming car beside: on once it has gone", () => {
    const cars: Standing[] = [
      { x: -16, y: 198.4, hx: -1, hy: 0, until: 25 },
      { x: -10, y: 202, hx: 1, hy: 0 },
    ];
    expectOnTime(drive(leftTurn(8), fromSouth, north, west, cars).arrived, MAIN.frontLeaves);
  });

  it("T-h5: standing on its path turned 20° to the right of it, it does not take a car 9.6 m on and 3.6 m to the right for the car in front", () => {
    const { driver, world, route } = plannedDriver();
    const start = along(route, 60);
    const a = (20 * Math.PI) / 180;
    const right = new Vector3(-start.dir.z, 0, start.dir.x);
    const heading = start.dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
    const key = {};
    world.vehicles = [
      {
        position: start.pos.clone().addScaledVector(start.dir, 9.6).addScaledVector(right, 3.6),
        kind: "vehicle",
        speed: 0,
        heading: Math.atan2(start.dir.x, start.dir.z),
        key,
        source: "traffic",
      },
    ];
    let picked = 0;
    for (let i = 0; i < 90; i++) {
      driver.update(DT, world, { position: start.pos, yaw: Math.atan2(heading.x, heading.z), speed: 0 });
      if (driver.frontPickKey === key) picked++;
    }
    expect(picked).toBe(0);
  });

  it("T-h6: starting 2 m beside its line and steering back onto it, it is not held by a queue in the lane beyond the line", () => {
    const queue = [0, 1, 2, 3].map((i): Standing => ({ x: -3.25, y: 95 + i * 7, hx: 0, hy: 1 }));
    const r = drive([street], [2, 60], north, [0, 400], queue, 60, [0, 60]);
    expectOnTime(r.arrived, MAIN.backToLine);
  });

  it("T-h7: a left turn past an oncoming car 2.3 m from its path (8 m street) still arrives", () => {
    const r = drive(leftTurn(8), fromSouth, north, west, [{ x: -16, y: 200.7, hx: 1, hy: 0 }]);
    expect(Number.isNaN(r.arrived)).toBe(false);
    // Reported, not held to a line (the v2 trial was 4.4 s later than main): the gap between the
    // bodies there is under 0.5 m, and slowing for it is accepted (D4 v2-5).
    expect(r.arrived - MAIN.nearOncoming).toBeLessThan(90);
  });
});

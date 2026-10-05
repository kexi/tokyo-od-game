import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The real physics car, without its glTF body (loaded by the browser): wheels and lamps only.
vi.mock("../src/game/carModel", () => ({
  WHEEL_RADIUS: 0.36,
  createCarModel: () => {
    const wheels = [0, 1, 2, 3].map(() => new Group().add(new Group()));
    return { root: new Group(), wheels, headlights: [], setLights: () => {} };
  },
}));

import { AutoDriver, type DriveObstacle, type DriveWorld } from "../src/game/autoDriver";
import { rapierClearance } from "../src/game/autoRecovery";
import { followSpeed } from "../src/game/autoTraffic";
import { LocalFrame } from "../src/geo/frame";
import { Vehicle } from "../src/physics/vehicle";
import { applyRegulations, type RegulationData } from "../src/world/regulations";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { Approach, TrafficControl } from "../src/world/trafficControl";

/**
 * 自動運転の復帰と他の交通: the AutoDriver on the real physics car (Rapier raycast vehicle, the
 * game's 60 Hz steps, the driver looking 30 times a second) in a small street scene of box
 * colliders for buildings, poles and parked cars. Positions are metres east (x) and north (y).
 */
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const road = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  oneway: 0 | 1 = 0,
): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width,
  oneway,
  kind: "local",
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
/** Back to metres east / north. */
const en = (p: Vector3) => {
  const g = frame.toGeodetic(p);
  return { x: (g.lon - 139.76) / LON, y: (g.lat - 35.68) / LAT };
};
/** Compass heading (0 = north, clockwise) to the game's yaw (atan2 of forward x, z). */
const yawOf = (deg: number) => Math.PI - (deg * Math.PI) / 180;
const compass = (yaw: number) => (((((Math.PI - yaw) * 180) / Math.PI) % 360) + 360) % 360;
const angleOff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;

type Box = { x: number; y: number; hx: number; hy: number; h?: number; yaw?: number };

type Scene = {
  lines: RoadLine[];
  buildings?: Box[];
  /** Parked cars at the kerb: solid, and in the driver's list as parked. */
  parked?: Array<{ x: number; y: number; heading: number }>;
  /** Cars standing in traffic (a queue): solid, in the list as vehicles at a standstill. */
  standing?: Array<{ x: number; y: number; heading: number }>;
  pavement?: Array<{ x0: number; x1: number; y0: number; y1: number }>;
  start: { x: number; y: number; heading: number };
  target: { x: number; y: number };
  control?: (graph: RoadGraph) => TrafficControl;
  crossings?: (graph: RoadGraph) => DriveWorld["crossings"];
  /** Without the Rapier clearance the driver only knows its lists (the stuck tests). */
  blind?: boolean;
  /** Solid but unknown to the driver (not in any list, and blind). */
  hidden?: Box[];
  /** Traffic moving at a steady speed (in the list only; the test checks the distance kept). */
  movers?: Array<{ x: number; y: number; heading: number; speed: number }>;
};

type Frame = {
  t: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  signal: "left" | "right" | null;
  reversing: boolean;
  activity: string;
};

function build(scene: Scene) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
  const solids = new Set<number>();
  const box = (b: Box, y = (b.h ?? 8) / 2, hy = (b.h ?? 8) / 2) => {
    const c = at(b.x, b.y);
    const q = { x: 0, y: Math.sin(-(b.yaw ?? 0) / 2), z: 0, w: Math.cos(-(b.yaw ?? 0) / 2) };
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.hx, hy, b.hy).setTranslation(c.x, y, c.z).setRotation(q),
    );
    solids.add(collider.handle);
  };
  for (const b of scene.buildings ?? []) box(b);
  for (const b of scene.hidden ?? []) box(b);
  // Pavements: 15 cm slabs, as PLATEAU paving is in the game.
  for (const p of scene.pavement ?? []) {
    const c = at((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((p.x1 - p.x0) / 2, 0.075, (p.y1 - p.y0) / 2).setTranslation(c.x, 0.075, c.z),
    );
  }
  const vehicles: DriveObstacle[] = [];
  const carBox = (x: number, y: number, heading: number) => {
    const c = at(x, y);
    const yaw = yawOf(heading);
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.92, 0.6, 2.15).setTranslation(c.x, 0.86, c.z).setRotation(q),
    );
    solids.add(collider.handle);
    return { position: c.setY(0.86), heading: yaw };
  };
  for (const p of scene.parked ?? [])
    vehicles.push({ ...carBox(p.x, p.y, p.heading), kind: "parked", speed: 0, key: {} });
  for (const p of scene.standing ?? [])
    vehicles.push({ ...carBox(p.x, p.y, p.heading), kind: "vehicle", speed: 0, key: {} });
  const movers = (scene.movers ?? []).map((m) => {
    const o: DriveObstacle = {
      position: at(m.x, m.y).setY(0.86),
      heading: yawOf(m.heading),
      kind: "vehicle",
      speed: m.speed,
      key: {},
    };
    vehicles.push(o);
    return o;
  });
  const isPavement = (x: number, z: number) => {
    const p = en(new Vector3(x, 0, z));
    return (scene.pavement ?? []).some((r) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1);
  };
  const graph = new RoadGraph(scene.lines, frame);
  const drive: DriveWorld = {
    graph,
    control: scene.control?.(graph) ?? noSignals,
    turnRules: [],
    clock: gameClock(2026, 10, 1, 600),
    obstacles: [],
    vehicles,
    isPavement: scene.pavement ? isPavement : undefined,
    crossings: scene.crossings?.(graph),
    isClear: scene.blind ? undefined : rapierClearance(world, () => 0),
  };
  const car = new Vehicle(world);
  const start = at(scene.start.x, scene.start.y);
  const ground = isPavement(start.x, start.z) ? 0.15 : 0;
  car.teleport(start.clone().setY(ground + 0.9), yawOf(scene.start.heading));
  const driver = new AutoDriver();
  driver.place(car.position(), car.yaw());
  world.step();
  return { world, solids, graph, drive, car, driver, movers, target: at(scene.target.x, scene.target.y) };
}

/**
 * Run the scene for `seconds`: each 1/30 s the driver looks (and the lamps follow it), the car
 * takes two physics steps. Returns every look and the hits on anything solid.
 */
function run(scene: Scene, seconds: number, until?: (f: Frame) => boolean, replanEvery = 0) {
  const s = build(scene);
  const planned = s.driver.plan(s.drive, s.target);
  const queue = new RAPIER.EventQueue(true);
  const frames: Frame[] = [];
  let hits = 0;
  let gaveUp: string | null = null;
  let closest = Infinity;
  let worst = 0;
  let total = 0;
  let replannedAt = 0;
  for (let t = 0; t < seconds; t += 1 / 30) {
    // A patrol re-plans its chase every 2 s toward the car (policePatrol.ts).
    const isReplan = replanEvery > 0 && t - replannedAt >= replanEvery;
    if (isReplan) {
      replannedAt = t;
      s.driver.plan(s.drive, s.target);
    }
    for (const m of s.movers) {
      const yaw = m.heading ?? 0;
      m.position.x += (Math.sin(yaw) * (m.speed ?? 0)) / 30;
      m.position.z += (Math.cos(yaw) * (m.speed ?? 0)) / 30;
      closest = Math.min(
        closest,
        Math.hypot(m.position.x - s.car.position().x, m.position.z - s.car.position().z),
      );
    }
    const pose = { position: s.car.position(), yaw: s.car.yaw(), speed: s.car.forwardSpeed() };
    const t0 = performance.now();
    const out = s.driver.update(1 / 30, s.drive, pose);
    worst = Math.max(worst, performance.now() - t0);
    total += performance.now() - t0;
    gaveUp = out.gaveUp;
    const p = en(pose.position);
    const f: Frame = {
      t,
      x: p.x,
      y: p.y,
      heading: compass(pose.yaw),
      speed: pose.speed,
      signal: s.driver.signal,
      reversing: s.driver.reversing,
      activity: s.driver.activity,
    };
    frames.push(f);
    if (process.env.TRACE && frames.length % Number(process.env.EVERY ?? 15) === 1) {
      const m = (
        s.driver as unknown as { mode: { kind: string; why?: string; planner?: { expanded: number } } }
      ).mode;
      console.log(
        t.toFixed(1),
        f.x.toFixed(2),
        f.y.toFixed(2),
        f.heading.toFixed(0),
        f.speed.toFixed(2),
        f.signal,
        f.reversing,
        f.activity,
        m.kind,
        m.why ?? "",
        m.planner?.expanded ?? "",
        out.input.throttle.toFixed(2),
        out.input.brake.toFixed(2),
        out.input.steer.toFixed(2),
        out.input.brakeOnly,
      );
    }
    if (until?.(f)) break;
    for (let k = 0; k < 2; k++) {
      s.car.update(1 / 60, out.input);
      s.world.step(queue);
      queue.drainCollisionEvents((a, b, started) => {
        const isOurs = a === s.car.chassis.handle || b === s.car.chassis.handle;
        const other = a === s.car.chassis.handle ? b : a;
        if (started && isOurs && s.solids.has(other)) {
          hits++;
          if (process.env.TRACE)
            console.log(
              "HIT at",
              t.toFixed(2),
              en(s.car.position()),
              compass(s.car.yaw()).toFixed(0),
              s.car.forwardSpeed().toFixed(2),
            );
        }
      });
    }
  }
  if (process.env.PERF)
    console.log("PERF worst update ms", worst.toFixed(2), "mean", (total / frames.length).toFixed(3));
  return { planned, frames, hits, gaveUp, closest, last: frames[frames.length - 1], driver: s.driver };
}

/** Goes in reverse: stretches of reversing with the 後退灯 on. */
const reverseGoes = (frames: Frame[]) => {
  let goes = 0;
  let was = false;
  for (const f of frames) {
    // Under its own power (a bounce off a wall is not a go).
    const isBack = f.reversing && f.speed < -0.2;
    if (isBack && !was) goes++;
    was = isBack;
  }
  return goes;
};

/** In the northbound lane of a two-way street along x = 0 (lane centre `lane` m west), heading north. */
const inLane = (f: Frame, lane: number, heading = 0) =>
  Math.abs(f.x + lane) < 0.7 && angleOff(f.heading, heading) < 10;

/** A crosswalk across the first street at 95 m north. */
const crosswalkAt95 = (graph: RoadGraph) => {
  const seg = graph.segments[0];
  return [{ seg, s: graph.nearestOn(seg, at(0, 95)).s, pos: at(0, 95) }];
};

/** A signal at 100 m north on the first street, red for good. */
const redAt100 = (graph: RoadGraph) => {
  const seg: Segment = graph.segments[0];
  const stopAt = graph.nearestOn(seg, at(0, 100)).s;
  const approach = { id: 1, seg, dir: 1, at: stopAt, kind: "signal" } as unknown as Approach;
  return {
    nextStop: (s: Segment, dir: 1 | -1, travel: number) =>
      s === seg && dir === 1 && stopAt - travel > -0.5 ? { approach, dist: stopAt - travel } : null,
    state: () => "red",
  } as unknown as TrafficControl;
};

/** Where the car was `t` seconds in (or at the end). */
const when = (r: ReturnType<typeof run>, t: number) => r.frames.find((f) => f.t >= t) ?? r.last;

/** The gap (m) at which followSpeed allows `kmh`. */
const gapFor = (kmh: number) => {
  let gap = 0;
  while (followSpeed(gap) < kmh / 3.6) gap += 0.1;
  return gap;
};

beforeAll(async () => {
  await RAPIER.init();
});

describe("getting onto the road from anywhere (autoRecovery.ts)", () => {
  // A two-way street (8 m) running north, a 4 m pavement and shop fronts on its east side.
  const street: Scene = {
    lines: [road(0, -150, 0, 260, 8)],
    pavement: [{ x0: 4, x1: 8, y0: -150, y1: 260 }],
    buildings: [
      { x: 14.5, y: 25, hx: 6, hy: 10 },
      { x: 14.5, y: 62, hx: 6, hy: 12 },
      // A sign post at the kerb, just ahead of the car's nose.
      { x: 4.6, y: 34, hx: 0.12, hy: 0.12, h: 4 },
    ],
    start: { x: 6, y: 42, heading: 180 },
    target: { x: 0, y: 220 },
  };

  it("from the pavement facing the wrong way, gets into its lane heading the right way without touching anything", () => {
    // What it guarantees: a car left on the pavement facing south (the route goes north) leaves
    // the pavement by a manoeuvre the planner checked against the buildings and the post, signals
    // first, and ends in the northbound lane (2 m west of the centre line) heading north — then
    // drives on along the route.
    const r = run(street, 70, (f) => f.y > 120);
    expect(r.planned).toBe(true);
    expect(r.hits).toBe(0);
    const firstMove = r.frames.find((f) => Math.abs(f.speed) > 0.2);
    const signalled = r.frames.filter((f) => firstMove && f.t < firstMove.t && f.signal !== null);
    expect(signalled.length / 30).toBeGreaterThanOrEqual(2.9); // 施行令 第21条: 3 s before moving across
    const joined = r.frames.find((f) => inLane(f, 2));
    expect(joined).toBeDefined();
    expect(r.last.y).toBeGreaterThan(120);
    expect(r.gaveUp).toBeNull();
  });

  it("nose against a wall: reverses (後退灯 on) and gets back into its lane", () => {
    // What it guarantees: a car turned 60° toward the buildings with its nose 8 cm off the wall
    // (a narrow street, no pavement) backs away instead of grinding into the wall, shows the
    // reverse lamps while reversing, and ends heading north in its lane, touching nothing.
    const scene: Scene = {
      lines: [road(0, -100, 0, 260, 6)],
      buildings: [
        { x: 3.2 + 6, y: 80, hx: 6, hy: 120 },
        { x: -3.2 - 6, y: 80, hx: 6, hy: 120 },
      ],
      start: { x: 0.8, y: 50, heading: 60 },
      target: { x: 0, y: 220 },
    };
    const r = run(scene, 60, (f) => f.y > 110);
    expect(r.hits).toBe(0);
    expect(reverseGoes(r.frames)).toBeGreaterThanOrEqual(1);
    const backing = r.frames.filter((f) => f.speed < -0.2);
    expect(backing.every((f) => f.reversing)).toBe(true);
    // Short and slow: never faster than 5 km/h backwards.
    expect(Math.min(...r.frames.map((f) => f.speed))).toBeGreaterThan(-5 / 3.6);
    expect(r.frames.some((f) => inLane(f, 1))).toBe(true);
    expect(r.last.y).toBeGreaterThan(110);
  });

  it("standing in a station forecourt 35 m from the street (東京駅丸の内 repro): plans and drives out onto it", () => {
    // What it guarantees: planning no longer needs a street within 25 m of the car (the old
    // search), and the car pulls out across the open forecourt — clear of the station building
    // behind it — into a lane of the street, heading along it.
    const scene: Scene = {
      lines: [road(0, -200, 0, 300, 9)],
      buildings: [{ x: 75, y: 40, hx: 20, hy: 60 }],
      start: { x: 38, y: 40, heading: 90 },
      target: { x: 0, y: 250 },
    };
    const r = run(scene, 80, (f) => f.y > 110);
    expect(r.planned).toBe(true);
    expect(r.hits).toBe(0);
    expect(r.frames.some((f) => inLane(f, 2.25))).toBe(true);
    expect(r.last.y).toBeGreaterThan(110);
  });

  it("at the closed end of a narrow dead end, turns round by 切り返し", () => {
    // What it guarantees: in a 7.5 m street walled on three sides (narrower than the car can
    // turn in one go: it needs 11.6 m), facing the end with the target behind it, the car turns
    // round in several goes forward and back — never touching the walls — and drives off the
    // other way.
    const scene: Scene = {
      lines: [road(0, -150, 0, 60, 7.5)],
      buildings: [
        { x: 3.75 + 5, y: 0, hx: 5, hy: 80 },
        { x: -3.75 - 5, y: 0, hx: 5, hy: 80 },
        { x: 0, y: 66, hx: 9, hy: 3 },
      ],
      start: { x: -1.5, y: 52, heading: 0 },
      target: { x: 0, y: -120 },
    };
    const r = run(scene, 90, (f) => f.y < 0);
    expect(r.hits).toBe(0);
    expect(reverseGoes(r.frames)).toBeGreaterThanOrEqual(1);
    expect(r.last.y).toBeLessThan(0);
    expect(angleOff(r.last.heading, 180)).toBeLessThan(15);
  });
});

describe("moving off (発進)", () => {
  it("signals right for 3 s before moving off from the kerb, and not in a queue", () => {
    // What it guarantees: 施行令 第21条 — standing at the kerb when the route starts, the car
    // shows the right indicator for 3 s and only then moves out; standing behind a queue at a red
    // light it shows nothing extra (it only goes on with the queue).
    const lines = [road(0, -60, 0, 420, 7)];
    const kerb = run({ lines, start: { x: -1.8, y: 5, heading: 0 }, target: { x: 0, y: 380 } }, 8);
    const first = kerb.frames.find((f) => Math.abs(f.speed) > 0.2);
    const before = kerb.frames.filter((f) => first && f.t < first.t);
    expect(before.filter((f) => f.signal === "right").length / 30).toBeGreaterThanOrEqual(2.9);
    const standing = [{ x: -1.5, y: 14, heading: 0 }];
    const queued = run(
      { lines, standing, control: redAt100, start: { x: -1.5, y: 5, heading: 0 }, target: { x: 0, y: 380 } },
      5,
    );
    expect(queued.frames.some((f) => f.signal === "right")).toBe(false);
  });

  it("still moves off when its route is planned again every 2 s, as a pursuing patrol's is", () => {
    // What it guarantees: a re-plan during the 3 s 合図 keeps the count and, once given, the 合図
    // is not given again at the same standstill — a patrol re-planning every 2 s stood still for
    // good behind a stopped car (seen in the game), signalling right and never moving off.
    const lines = [road(0, -60, 0, 420, 7)];
    const r = run({ lines, start: { x: -1.8, y: 5, heading: 0 }, target: { x: 0, y: 380 } }, 8, undefined, 2);
    const first = r.frames.find((f) => Math.abs(f.speed) > 0.2);
    expect(first?.t ?? Infinity).toBeLessThan(4);
  });
});

describe("stuck: backing off and giving up", () => {
  it("nose into a wall it was not told of: backs off with opposite lock and tries again", () => {
    // What it guarantees: without the collider look-up the driver only finds the wall by
    // pressing on without moving; after 1.5 s of that it reverses a few metres (the stuck
    // recovery), and it gets round on a later go.
    const scene: Scene = {
      lines: [road(0, -100, 0, 260, 6)],
      buildings: [
        { x: 3.2 + 6, y: 80, hx: 6, hy: 120 },
        { x: -3.2 - 6, y: 80, hx: 6, hy: 120 },
      ],
      start: { x: 0.8, y: 50, heading: 60 },
      target: { x: 0, y: 220 },
      blind: true,
    };
    const r = run(scene, 70, (f) => f.y > 100);
    expect(reverseGoes(r.frames)).toBeGreaterThanOrEqual(1);
    expect(r.gaveUp).toBeNull();
    expect(r.last.y).toBeGreaterThan(100);
  });

  it("a wall across the road it cannot see: gives up cleanly after three backs-off", () => {
    // What it guarantees: when going on keeps failing it does not keep ramming: three tries
    // (each a reverse), then `gaveUp` = "stuck" and the brake held, the car standing still.
    const scene: Scene = {
      lines: [road(0, -100, 0, 260, 8)],
      hidden: [{ x: 0, y: 40, hx: 6, hy: 0.5, h: 2 }],
      start: { x: -2, y: 5, heading: 0 },
      target: { x: 0, y: 200 },
      blind: true,
    };
    const r = run(scene, 120);
    expect(r.gaveUp).toBe("stuck");
    expect(reverseGoes(r.frames)).toBe(3);
    const after = r.frames.slice(-60);
    expect(after.every((f) => Math.abs(f.speed) < 0.05)).toBe(true);
    expect(r.last.y).toBeLessThan(40);
  });
});

describe("queues and blockages (autoTraffic.ts)", () => {
  // A two-way street 7 m wide: lanes 1.5 m either side of the centre line.
  const lines = [road(0, -60, 0, 420, 7)];
  const parkedAt80 = [{ x: -2.4, y: 80, heading: 0 }];

  it("passes a car parked in its lane with the oncoming lane clear, and returns to the lane", () => {
    // What it guarantees: 第17条第5項第3号 — the parked car is a blockage; with nothing coming
    // it signals right for 3 s, moves out only as far as needed (0.6 m 側方間隔), passes without
    // touching it, signals left and is back in its lane 1.5 m west of the centre line.
    const r = run(
      { lines, parked: parkedAt80, start: { x: -1.5, y: 5, heading: 0 }, target: { x: 0, y: 380 } },
      60,
      (f) => f.y > 150,
    );
    expect(r.hits).toBe(0);
    expect(r.last.y).toBeGreaterThan(150);
    const out = r.frames.find((f) => f.x > -1.0);
    expect(out).toBeDefined();
    const rightBefore = r.frames.filter(
      (f) => out && f.t < out.t && f.t > out.t - 3.2 && f.signal === "right",
    );
    expect(rightBefore.length / 30).toBeGreaterThanOrEqual(2.9);
    // はみ出し as little as needed: the centre never more than 0.4 m right of the centre line.
    expect(Math.max(...r.frames.map((f) => f.x))).toBeLessThan(0.4);
    expect(r.frames.some((f) => f.y > 85 && f.y < 120 && f.signal === "left")).toBe(true);
    expect(Math.abs(r.last.x + 1.5)).toBeLessThan(0.4);
  });

  it("waits for an oncoming car to go by before passing (第17条第5項・第28条第4項)", () => {
    // What it guarantees: a car coming the other way at 40 km/h, which would meet it beside the
    // parked car, is let by first: the car stays in its lane behind the parked car until the
    // oncoming car has passed, then passes, keeping well clear of it.
    const movers = [{ x: 1.5, y: 260, heading: 180, speed: 40 / 3.6 }];
    const r = run(
      { lines, parked: parkedAt80, movers, start: { x: -1.5, y: 5, heading: 0 }, target: { x: 0, y: 380 } },
      60,
      (f) => f.y > 150,
    );
    expect(r.hits).toBe(0);
    expect(r.closest).toBeGreaterThan(2.5);
    const out = r.frames.find((f) => f.x > -1.0);
    // The oncoming car passes y = 80 about 16 s in: the car pulls out only after that.
    expect(out?.t ?? 0).toBeGreaterThan((260 - 80) / (40 / 3.6));
    expect(r.last.y).toBeGreaterThan(150);
  });

  it("treats a car standing with nothing ahead of it for 10 s as stalled, and passes it", () => {
    // What it guarantees: a vehicle (not parked) stopped in the lane with no signal, junction,
    // crosswalk or person ahead of it is waited behind at first (it may move off), and passed
    // once it has stood STALL_SECONDS.
    const standing = [{ x: -1.5, y: 120, heading: 0 }];
    const r = run(
      { lines, standing, start: { x: -1.5, y: 5, heading: 0 }, target: { x: 0, y: 380 } },
      70,
      (f) => f.y > 190,
    );
    expect(r.hits).toBe(0);
    const stopped = r.frames.find((f) => f.t > 3 && Math.abs(f.speed) < 0.05);
    const out = r.frames.find((f) => f.x > -1.0);
    expect(stopped).toBeDefined();
    expect((out?.t ?? 0) - (stopped?.t ?? 0)).toBeGreaterThan(3);
    // It stood well back (PASS_GAP): room to pull out round it.
    expect((stopped?.y ?? 0) + 2.15).toBeLessThan(120 - 2.25 - 4);
    expect(r.last.y).toBeGreaterThan(190);
  });

  it("does not pass it within 30 m before a crosswalk (第30条第3号): waits, then gives up", () => {
    // What it guarantees: with a crosswalk 15 m beyond the parked car the pass would end inside
    // the no-passing zone, so the car waits behind it in its lane (never moving out), and after
    // 30 s with no other way round it gives up as "blocked" for the caller to take over.
    const r = run(
      {
        lines,
        parked: parkedAt80,
        crossings: crosswalkAt95,
        start: { x: -1.5, y: 5, heading: 0 },
        target: { x: 0, y: 380 },
      },
      70,
    );
    expect(r.hits).toBe(0);
    expect(Math.max(...r.frames.map((f) => f.x))).toBeLessThan(-1.0);
    expect(Math.max(...r.frames.map((f) => f.y))).toBeLessThan(80 - 4.3);
    expect(r.gaveUp).toBe("blocked");
  });

  it("does not pass it within 30 m before a junction either", () => {
    // What it guarantees: the same rule for 交差点 — a side street joins 20 m beyond the parked car.
    const withJunction = [road(0, -60, 0, 100, 7), road(0, 100, 0, 420, 7), road(0, 100, 120, 100, 6)];
    const r = run(
      {
        lines: withJunction,
        parked: parkedAt80,
        start: { x: -1.5, y: 5, heading: 0 },
        target: { x: 0, y: 380 },
      },
      40,
    );
    expect(r.hits).toBe(0);
    expect(Math.max(...r.frames.map((f) => f.x))).toBeLessThan(-1.0);
    expect(Math.max(...r.frames.map((f) => f.y))).toBeLessThan(80 - 4.3);
  });

  it("waits in a queue at a red light and never passes it", () => {
    // What it guarantees: two cars standing at a red signal are a queue, not a blockage: the car
    // stops behind the last one with a gap (2.5 m), stays in its lane for the whole red, and
    // does not give up.
    const standing = [
      { x: -1.5, y: 96.5, heading: 0 },
      { x: -1.5, y: 89.5, heading: 0 },
    ];
    const r = run(
      { lines, standing, control: redAt100, start: { x: -1.5, y: 5, heading: 0 }, target: { x: 0, y: 380 } },
      70,
    );
    expect(r.hits).toBe(0);
    expect(Math.max(...r.frames.map((f) => f.x))).toBeLessThan(-1.0);
    const front = r.last.y + 2.15;
    expect(front).toBeLessThan(89.5 - 2.15 - 1.5);
    expect(front).toBeGreaterThan(89.5 - 2.15 - 5);
    expect(r.gaveUp).toBeNull();
  });
});

describe("junctions (第36条・第37条・第50条)", () => {
  // A crossroads of two 9 m two-way streets at 100 m north, no signals.
  const cross = [
    road(0, -60, 0, 100, 9),
    road(0, 100, 0, 300, 9),
    road(-120, 100, 0, 100, 9),
    road(0, 100, 120, 100, 9),
  ];

  it("turning right, lets an oncoming car through first (第37条)", () => {
    // What it guarantees: with a car coming the other way, the right turn waits short of the
    // junction centre (still facing north) until it has gone through, then turns, never close to it.
    const movers = [{ x: 2.25, y: 230, heading: 180, speed: 10 }];
    const r = run(
      { lines: cross, movers, start: { x: -2.25, y: 5, heading: 0 }, target: { x: 90, y: 100 } },
      50,
      (f) => f.x > 40,
    );
    const through = when(r, (230 - 100) / 10);
    expect(through.y).toBeLessThan(99);
    expect(angleOff(through.heading, 0)).toBeLessThan(15);
    expect(r.closest).toBeGreaterThan(3);
    expect(r.last.x).toBeGreaterThan(40);
  });

  it("at a junction without signals, lets a car from the left go first (第36条第1項)", () => {
    // What it guarantees: on equal roads the car coming from the left has the right of way: the
    // car stops before the junction while it crosses, then goes on north.
    const movers = [{ x: -64, y: 102.25, heading: 90, speed: 8 }];
    const r = run(
      { lines: cross, movers, start: { x: -2.25, y: 5, heading: 0 }, target: { x: 0, y: 260 } },
      40,
      (f) => f.y > 150,
    );
    const crossing = when(r, 64 / 8);
    expect(crossing.y + 2.15).toBeLessThan(100 - 4.5);
    expect(r.closest).toBeGreaterThan(3);
    expect(r.last.y).toBeGreaterThan(150);
  });

  it("does not enter a junction it could not leave (第50条)", () => {
    // What it guarantees: a car standing just past the junction leaves no room beyond it, so the
    // car waits before the junction box instead of stopping inside it.
    const standing = [{ x: -2.25, y: 108, heading: 0 }];
    const r = run(
      { lines: cross, standing, start: { x: -2.25, y: 5, heading: 0 }, target: { x: 0, y: 260 } },
      25,
    );
    expect(r.hits).toBe(0);
    expect(Math.max(...r.frames.map((f) => f.y)) + 2.15).toBeLessThan(100 - 4.5);
  });
});

describe("following distance (第26条)", () => {
  it("keeps a gap that grows with speed: 37 m at 50 km/h, 13 m at 25 km/h", () => {
    // What it guarantees: the speed allowed behind a car is the one whose stopping distance
    // (0.75 s reaction + 4 m/s² braking) fits the gap.
    expect(gapFor(50)).toBeGreaterThan(33);
    expect(gapFor(50)).toBeLessThan(40);
    expect(gapFor(25)).toBeGreaterThan(10);
    expect(gapFor(25)).toBeLessThan(15);
  });
});

describe("a 指定方向外進行禁止 that would leave no way on (東京駅丸の内 forecourt)", () => {
  it("is dropped, so the street it was snapped to is not a dead end", () => {
    // What it guarantees: a left-only rule snapped onto a node where no street turns left (the
    // apex of a loop: the road bends round to the right) is not applied — it made planning from
    // the loop fail everywhere — while a rule that does leave a way on is kept.
    // A loop: north 60 m, a right bend, back south; and a street on north from the apex.
    const lines = [
      road(0, 0, 0, 60, 9, 1),
      road(0, 60, 10, 55, 9, 1),
      road(10, 55, 10, 0, 9, 1),
      road(0, 60, 0, 160, 5),
    ];
    const graph = new RoadGraph(lines, frame);
    const data = {
      laneArrows: [],
      turnlanes: [],
      speed: [],
      speedZone: [],
      oneway: [],
      crosswalk: [],
      stopLine: [],
      stopSign: [],
      sections: [],
      turns: [] as number[][],
      noOvertake: [],
      lanes: [],
      noLaneChange: [],
      signals: [],
      closures: [],
      junctions: [],
      footbridges: [],
    } satisfies RegulationData;
    const apex = [139.76, 35.68 + 60 * LAT];
    const entry = [139.76, 35.68 + 40 * LAT];
    data.turns.push([...apex, ...entry, 1, 1, 0, 1440, 0, 0]); // left only: no street goes left
    data.turns.push([...apex, ...entry, 6, 1, 0, 1440, 0, 0]); // straight or right: kept
    const rules = applyRegulations(graph, data, frame).turnRules;
    expect(rules.map((r) => r.mask)).toEqual([6]);
  });
});

describe("planning from a stopped car (東京駅丸の内 repro)", () => {
  it("starts from the carriageway the car stands on, the legal way, even beside another one", () => {
    // What it guarantees: a car facing north at the edge of the northbound carriageway of a
    // one-way pair, nearer the centre line of the southbound one, plans northbound from its own
    // carriageway — not up the southbound one against its one-way.
    const lines = [
      road(0, -100, 0, 300, 9, 1),
      road(9, 300, 9, -100, 9, 1),
      road(0, 300, 9, 300, 9),
      road(0, -100, 9, -100, 9),
    ];
    const graph = new RoadGraph(lines, frame);
    const world: DriveWorld = {
      graph,
      control: noSignals,
      turnRules: [],
      clock: gameClock(2026, 10, 1, 600),
      obstacles: [],
    };
    const driver = new AutoDriver();
    driver.place(at(4.7, 50), yawOf(0));
    expect(driver.plan(world, at(0, 250))).toBe(true);
    const first = driver.route?.steps[0];
    expect(first?.seg.line.coords[1]).toBeLessThan(first?.seg.line.coords[3] ?? 0); // the northbound line
    expect(first?.dir).toBe(1);
  });
});

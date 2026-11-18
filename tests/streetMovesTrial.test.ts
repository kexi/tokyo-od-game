// P2.7 R1-2b 手順 0b, the trial on a small network (not for main): a street's line moved off an
// expressway's site, (1) a two-way street split round a site in its middle into two one-way lines,
// one each side, and (2) a one-way street moved to its left of travel, each line bent back onto the
// street's at the junctions either side. What it checks: the autopilot and a traffic car drive
// through both junctions and past the site without leaving the road or entering the site's band.
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { LocalFrame } from "../src/geo/frame";
import { steerLimit, WHEELBASE, type DriveInput } from "../src/physics/vehicle";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import { TrafficAI } from "../src/world/traffic-ai";
import type { TrafficControl } from "../src/world/trafficControl";

vi.mock("../src/game/carModel", () => ({ createLowCar: () => new Group() }));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
type XY = [number, number];
const line = (pts: XY[], oneway: 0 | 1, width: number): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  kind: "local",
  oneway,
});
const at = ([x, y]: XY) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
/** Plane (x east, y north) of a local point. */
const xy = (p: Vector3): XY => [p.x, -p.z];

/** The site: a slab 4 m either side of y = 0 from x 60 to 240; its band (+ 1 m) is |y| < 5. */
const isInBand = ([x, y]: XY) => x > 60 && x < 240 && Math.abs(y) < 5;
/** How far the moved lines stand off the old centre line, and over what length they bend. */
const OFF = 7.5;
const BEND = 40;

/** (1) A two-way 40 m street split at x 0 and x 300 into an eastbound line north and a westbound one south. */
const split = () => [
  // The approaches drawn away from the split: the AI takes a placed car on a two-way street against
  // its coords here (its draw's parity does not change between updates), so the car drives in.
  line(
    [
      [0, 0],
      [-200, 0],
    ],
    0,
    40,
  ),
  line(
    [
      [0, 0],
      [0, 120],
    ],
    0,
    9,
  ),
  line(
    [
      [0, 0],
      [BEND, OFF],
      [300 - BEND, OFF],
      [300, 0],
    ],
    1,
    6,
  ),
  line(
    [
      [300, 0],
      [300 - BEND, -OFF],
      [BEND, -OFF],
      [0, 0],
    ],
    1,
    6,
  ),
  line(
    [
      [300, 0],
      [500, 0],
    ],
    0,
    40,
  ),
  line(
    [
      [300, 0],
      [300, -120],
    ],
    0,
    9,
  ),
];
/** (2) A one-way 20 m street east, its line moved north (its left) between x 0 and x 300. */
const shifted = () => [
  line(
    [
      [-200, 0],
      [0, 0],
    ],
    1,
    20,
  ),
  line(
    [
      [0, 0],
      [0, 120],
    ],
    0,
    9,
  ),
  line(
    [
      [0, 0],
      [BEND, OFF],
      [300 - BEND, OFF],
      [300, 0],
    ],
    1,
    20,
  ),
  line(
    [
      [300, 0],
      [500, 0],
    ],
    1,
    20,
  ),
  line(
    [
      [300, 0],
      [300, -120],
    ],
    0,
    9,
  ),
];

const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
const worldOf = (graph: RoadGraph): DriveWorld => ({
  graph,
  control: noSignals,
  turnRules: [],
  clock: gameClock(2026, 10, 1, 600),
  obstacles: [],
});

/** tests/autoDriver.test.ts's kinematic bicycle: the car obeys only the wheel and pedals. */
function drive(graph: RoadGraph, from: XY, yaw: number, to: XY, seconds: number) {
  const driver = new AutoDriver();
  const world = worldOf(graph);
  const pos = at(from);
  driver.place(pos, yaw);
  const planned = driver.plan(world, at(to));
  let v = 0;
  let steer = 0;
  let done = false;
  const lost: string[] = [];
  const track: XY[] = [];
  const dt = 1 / 30;
  for (let t = 0; t < seconds && !done; t += dt) {
    const out = driver.update(dt, world, { position: pos, yaw, speed: v });
    const input: DriveInput = out.input;
    done = out.done;
    if (driver.lostWhy !== null) lost.push(driver.lostWhy);
    steer += (input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
    v = Math.max(0, v + (input.throttle * 4.16 - 0.12 * v - input.brake * 7) * dt);
    yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
    pos.x += Math.sin(yaw) * v * dt;
    pos.z += Math.cos(yaw) * v * dt;
    track.push(xy(pos));
  }
  return { planned, done, end: xy(pos), lost, track };
}

type Car = { seg: Segment; s: number; dir: 1 | -1; object: Group };
/**
 * A traffic car placed `s` along `seg` after `warm` updates, run for `seconds`; its positions (plane).
 * The AI draws a two-way street's direction and each junction's exit at random: `warm` varies the
 * draws.
 */
function trafficRun(
  lines: RoadLine[],
  pick: (g: RoadGraph) => Segment,
  s: number,
  seconds: number,
  warm = 0,
) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const graph = new RoadGraph(lines, frame);
  for (const seg of graph.segments) seg.limit = 40;
  const ai = new TrafficAI(new Scene(), world, () => 0);
  // Every place counts as seen: the AI spawns none of its own (a car appears only out of view), so
  // the placed car runs alone. Why not the AI's own crowd: on a network this small it jams the junctions.
  ai.isSeen = () => true;
  ai.setGraph(graph);
  const start = pick(graph);
  // The focus (and the player) 120 m off the street: within the AI's despawn radius of the whole run.
  const far = at([150, 120]);
  for (let i = 0; i < warm; i++) ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
  const before = new Set((ai as unknown as { cars: Car[] }).cars);
  ai.placeCar(start, s, 8);
  ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
  const cars = (ai as unknown as { cars: Car[] }).cars;
  const car = cars.find((c) => c.seg === start && !before.has(c));
  const track: XY[] = [];
  if (!car) return track;
  for (let t = 0; t < seconds; t += 1 / 60) {
    ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
    track.push(xy(car.object.position));
  }
  world.free();
  return track;
}

const eastOf = (g: RoadGraph) =>
  g.segments.find((s) => {
    const [x0] = xy(s.pts[0]);
    const [x1] = xy(s.pts[s.pts.length - 1]);
    return Math.min(x0, x1) < -100 && Math.max(x0, x1) > -1;
  })!;
const westOf = (g: RoadGraph) =>
  g.segments.find((s) => {
    const [x0] = xy(s.pts[0]);
    const [x1] = xy(s.pts[s.pts.length - 1]);
    return Math.min(x0, x1) > 299 && Math.max(x0, x1) > 450;
  })!;

describe("R1-2b trial: a two-way street split round a site in its middle (手順 0b)", () => {
  const graph = new RoadGraph(split(), frame);

  it("the autopilot drives east through both junctions and past the site, never in its band", () => {
    const r = drive(graph, [-150, 1.6], Math.PI / 2, [450, 1.6], 120);
    expect([r.planned, r.done, r.lost]).toEqual([true, true, []]);
    expect(r.track.filter(isInBand)).toEqual([]);
  });

  it("the autopilot drives west the same way", () => {
    const r = drive(graph, [450, -1.6], -Math.PI / 2, [-150, -1.6], 120);
    expect([r.planned, r.done, r.lost]).toEqual([true, true, []]);
    expect(r.track.filter(isInBand)).toEqual([]);
  });

  it("traffic cars go through east and west, never in the band", () => {
    // Twenty draws each way on the street as it is (two-way approaches, side streets): every
    // car's track stays out of the band, and some go right through the split.
    let east = 0;
    let west = 0;
    for (let warm = 0; warm < 20; warm++)
      for (const [pick, sign] of [
        [eastOf, 1],
        [westOf, -1],
      ] as const) {
        // Eastbound without the side street at x 0: the AI's draw there always takes it (its parity
        // does not change between updates), and the split's branches still make x 0 a junction.
        const lines =
          sign === 1 ? split().filter((l) => !(l.width === 9 && l.coords[1] < l.coords[3])) : split();
        const track = trafficRun(lines, pick, sign === 1 ? 180 : 20, 60, warm * 7);
        expect(track.filter(isInBand)).toEqual([]);
        const xs = track.map(([x]) => x);
        const isThrough =
          sign === 1
            ? Math.min(...xs) < 0 && Math.max(...xs) > 300
            : Math.max(...xs) > 300 && Math.min(...xs) < 0;
        if (isThrough && sign === 1) east++;
        if (isThrough && sign === -1) west++;
      }
    expect(east).toBeGreaterThan(0);
    expect(west).toBeGreaterThan(0);
  });
});

describe("R1-2b trial: a one-way street moved to its left of travel (手順 0b)", () => {
  const graph = new RoadGraph(shifted(), frame);

  it("the autopilot drives through both junctions and past the site, never in its band", () => {
    const r = drive(graph, [-150, 0], Math.PI / 2, [450, 0], 120);
    expect([r.planned, r.done, r.lost]).toEqual([true, true, []]);
    expect(r.track.filter(isInBand)).toEqual([]);
  });

  it("a traffic car goes through, never in the band", () => {
    const track = trafficRun(
      shifted().filter((l) => l.width !== 9),
      eastOf,
      20,
      60,
    );
    expect(track.filter(isInBand)).toEqual([]);
    const xs = track.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
  });
});

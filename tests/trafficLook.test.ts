// D3 (b)(e): a traffic car's look ahead along its lane, and the speed it can stop from in what it
// sees. The player's car stands still in each case (the look takes it in as any obstacle).
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { MassClass } from "../src/physics/masses";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { followTarget, TrafficAI } from "../src/world/traffic-ai";

vi.mock("../src/game/carModel", () => ({ createLowCar: () => new Group() }));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
type XY = [number, number];
/** A line through points given in metres (x east, y north). */
const line = (pts: XY[], oneway: 0 | 1, width = 12): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  kind: "local",
  oneway,
});
/** Where a point given in metres (x east, y north) is in the local frame. */
const at = ([x, y]: XY) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
/** `from` moved `m` metres on a heading `deg` clockwise from north. */
const go = (from: XY, deg: number, m: number): XY => {
  const r = (deg * Math.PI) / 180;
  return [from[0] + m * Math.sin(r), from[1] + m * Math.cos(r)];
};
/** `p` moved `m` metres to the right of a heading `deg` clockwise from north. */
const right = (p: XY, deg: number, m: number): XY => go(p, deg + 90, m);

type Car = {
  id: number;
  serial: number;
  seg: Segment;
  s: number;
  dir: 1 | -1;
  speed: number;
  half: number;
  decel: number;
  accel: number;
  object: Group;
};
type Inside = {
  cars: Car[];
  pose(g: RoadGraph, c: Car): { pos: Vector3; dir: Vector3 };
  look(
    g: RoadGraph,
    c: Car,
    pos: Vector3,
    dir: Vector3,
    p: Vector3,
    pf: Vector3,
    ps: number,
  ): { gap: number };
  massOf(kind: MassClass, v: null, serial: number): { decel: number; accel: number };
};

/** The traffic on `lines` (limit 60), all of it in view: none of its own cars appear, only ours. */
function traffic(lines: RoadLine[]) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const graph = new RoadGraph(lines, frame);
  for (const seg of graph.segments) seg.limit = 60;
  const ai = new TrafficAI(new Scene(), world, () => 0);
  ai.isSeen = () => true;
  ai.setGraph(graph);
  return { world, graph, ai, inside: ai as unknown as Inside };
}

/**
 * One car placed `startS` m along the first segment at `kmh`, driven until it stands or 40 s
 * towards the player's car standing at `player`: the closest the centres came, where it stood.
 */
function approach(
  lines: RoadLine[],
  startS: number,
  player: Vector3,
  kmh: number,
  tune?: (c: Car, i: Inside) => void,
) {
  const { world, graph, ai, inside } = traffic(lines);
  try {
    ai.placeCar(graph.segments[0], startS, kmh / 3.6);
    const fwd = new Vector3(0, 0, -1);
    ai.update(1 / 60, player, player, fwd, 0);
    const c = inside.cars[0];
    tune?.(c, inside);
    let closest = Infinity;
    let stoodAt: number | null = null;
    for (let i = 0; i < 60 * 40; i++) {
      ai.update(1 / 60, player, player, fwd, 0);
      const d = Math.hypot(c.object.position.x - player.x, c.object.position.z - player.z);
      closest = Math.min(closest, d);
      if (c.speed < 0.05 && i > 60) {
        stoodAt = d;
        break;
      }
    }
    return { closest, stoodAt, half: c.half };
  } finally {
    world.free();
  }
}

/** Kept clear: never closer than its half + the player's 2.15 m + 1 m, stood at least standstill − 0.5. */
const isClear = (r: { closest: number; stoodAt: number | null; half: number }) =>
  r.closest >= r.half + 2.15 + 1.0 && (r.stoodAt ?? 0) >= 4.75 + r.half - 0.5;

describe("a traffic car's look along its lane (D3 (b))", () => {
  it("T-b1: stops clear of a car standing 12 m past a 20° bend, coming at 55 km/h from 150 m back", () => {
    const bend = go([0, 0], 0, 170);
    const lines = [line([[0, 0], bend, go(bend, 20, 80)], 1)];
    const r = approach(lines, 20, at(go(bend, 20, 12)), 55);
    expect(r.closest, `closest ${r.closest.toFixed(2)}`).toBeGreaterThanOrEqual(r.half + 3.15);
    expect(isClear(r), `stood ${r.stoodAt?.toFixed(2)}`).toBe(true);
  });

  it("T-b2: does the same on 東京駅南口's piece (+16° for 20 m, then −20°), the car 1.8 m right of the lane", () => {
    const a = go([0, 0], 0, 130);
    const b = go(a, 16, 20);
    const lines = [line([[0, 0], a, b, go(b, -4, 80)], 1)];
    const r = approach(lines, 0, at(right(go(b, -4, 12), -4, 1.8)), 55);
    expect(isClear(r), `closest ${r.closest.toFixed(2)} stood ${r.stoodAt?.toFixed(2)}`).toBe(true);
  });

  it("T-b3: stops past a 90° left turn behind a car standing 10 m round the corner", () => {
    const corner: XY = [0, 150];
    const lines = [line([[0, 0], corner], 1), line([corner, go(corner, -90, 150)], 1)];
    const r = approach(lines, 20, at(go(corner, -90, 10)), 50);
    expect(isClear(r), `closest ${r.closest.toFixed(2)} stood ${r.stoodAt?.toFixed(2)}`).toBe(true);
  });

  it("T-b4: takes in nothing 3 m aside of its lane past a bend (out of both the line and the straight band)", () => {
    const bend = go([0, 0], 0, 170);
    const lines = [line([[0, 0], bend, go(bend, 20, 80)], 1)];
    const { world, graph, ai, inside } = traffic(lines);
    try {
      ai.placeCar(graph.segments[0], 150, 0);
      const player = at(right(go(bend, 20, 12), 20, 3));
      ai.update(1 / 60, player, player, new Vector3(0, 0, -1), 0);
      const c = inside.cars[0];
      const { pos, dir } = inside.pose(graph, c);
      expect(inside.look(graph, c, pos, dir, player, new Vector3(0, 0, -1), 0).gap).toBe(Infinity);
    } finally {
      world.free();
    }
  });

  it("T-b5: reads the same gap as before on a straight road (the line and the band agree)", () => {
    const lines = [
      line(
        [
          [0, 0],
          [0, 400],
        ],
        1,
      ),
    ];
    const { world, graph, ai, inside } = traffic(lines);
    try {
      ai.placeCar(graph.segments[0], 100, 0);
      const player = at([0, 140]);
      ai.update(1 / 60, player, player, new Vector3(0, 0, -1), 0);
      const c = inside.cars[0];
      const { pos, dir } = inside.pose(graph, c);
      const straight = new Vector3().subVectors(player, pos).dot(dir);
      expect(inside.look(graph, c, pos, dir, player, new Vector3(0, 0, -1), 0).gap).toBeCloseTo(straight, 2);
    } finally {
      world.free();
    }
  });
});

const KINDS: Array<{ name: MassClass; half: number }> = [
  { name: "sedan", half: 2.25 },
  { name: "jpnTaxi", half: 2.25 },
  { name: "motorbike", half: 1.05 },
  { name: "bus", half: 5.25 },
  { name: "truck8t", half: 4.4 },
  { name: "truck10t", half: 6.0 },
];

describe("the speed a traffic car can stop from (D3 (e))", () => {
  it("T-e1: every cruise tier of every kind stops clear of a car standing on a straight 60 km/h road", () => {
    const lines = [
      line(
        [
          [0, 0],
          [0, 400],
        ],
        1,
      ),
    ];
    const failed: string[] = [];
    for (const k of KINDS) {
      for (let tier = 0; tier < 5; tier++) {
        const kmh = 60 * (0.75 + tier * 0.06);
        const r = approach(lines, 150, at([0, 300]), kmh, (c, inside) => {
          c.serial = tier;
          c.half = k.half;
          const m = inside.massOf(k.name, null, tier);
          c.decel = m.decel;
          c.accel = m.accel;
          c.speed = kmh / 3.6;
        });
        if (!isClear(r))
          failed.push(
            `${k.name} ${kmh.toFixed(1)} km/h: ${r.closest.toFixed(2)} m, stood ${r.stoodAt?.toFixed(2)}`,
          );
      }
    }
    expect(failed).toEqual([]);
  });

  it("T-e2: leaves a car's gap behind one at its own speed as it was, up to 40 km/h", () => {
    // The old rule's steady gap at speed v is standstill + v / 0.8; the cap lies above v there for a
    // car (5 m/s²) up to 45 km/h and for a heavy one (4.05 m/s²) up to 36 km/h.
    for (const { standstill, a, top } of [
      { standstill: 7, a: 5, top: 40 },
      { standstill: 10, a: 4.05, top: 36 },
    ]) {
      for (let kmh = 5; kmh <= top; kmh += 5) {
        const v = kmh / 3.6;
        expect(followTarget(standstill + v / 0.8, standstill, 60 / 3.6, a)).toBeCloseTo(v, 6);
      }
    }
    // Nothing seen: cruise, as before.
    expect(followTarget(Infinity, 7, 15, 5)).toBe(15);
  });
});

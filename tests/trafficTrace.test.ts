import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Scene, Vector3 } from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { onLogLine, type LogEntry } from "../src/log";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { TrafficAI } from "../src/world/traffic-ai";

vi.mock("../src/game/carModel", () => ({ createLowCar: () => new Group() }));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const C = [139.76, 35.68];
const D = 0.0018; // ≈ 160 m
/** One 12 m one-way street, west to east through C, in two pieces that meet at C (one road onward). */
const street: RoadLine[] = [
  { coords: [C[0] - D, C[1], C[0], C[1]], width: 12, kind: "local", oneway: 1 },
  { coords: [C[0], C[1], C[0] + D, C[1]], width: 12, kind: "local", oneway: 1 },
];

type Car = {
  id: number;
  serial: number;
  seg: Segment;
  s: number;
  dir: 1 | -1;
  rear: Vector3;
  speed: number;
  firstSeen: { m: number; kmh: number } | null;
  body: { collider(i: number): { handle: number } | null } | null;
  object: { position: Vector3 };
};
type Inside = { cars: Car[] };

/**
 * The traffic on the street, the camera's focus 400 m to the side: no car of its own appears (every
 * spot is over 350 m off), and a placed one is never taken away (under 450 m).
 */
function build() {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const graph = new RoadGraph(street, frame);
  const ai = new TrafficAI(new Scene(), world, () => 0);
  ai.setGraph(graph);
  const focus = graph
    .sample(graph.segments[0], graph.segments[0].length)
    .pos.clone()
    .add(new Vector3(0, 0, 400));
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) ai.update(1 / 60, focus, focus, new Vector3(0, 0, 1), 0);
  };
  return { world, graph, ai, inside: ai as unknown as Inside, step, focus };
}

let lines: LogEntry[] = [];
let off: (() => void) | null = null;
const tap = () => {
  lines = [];
  off = onLogLine((_, entry) => lines.push(entry));
};
afterEach(() => {
  off?.();
  off = null;
});

describe("traffic trace (D3 instruments)", () => {
  it("numbers the cars in the order they appear and keeps the number when a car picks its road", () => {
    const { world, graph, inside, step, ai } = build();
    try {
      const west = graph.segments.find((seg) => seg.line === street[0]) ?? graph.segments[0];
      // Two cars on the western piece, heading for the joint at C.
      ai.placeCar(west, 100, 8);
      step(1);
      ai.placeCar(west, 60, 8);
      step(1);
      expect(inside.cars.map((c) => c.id)).toEqual([1, 2]);
      const first = inside.cars[0];
      const serialBefore = first.serial;
      // On past the joint: it picks the eastern piece, drawing on its random state.
      step(60 * 12);
      const after = inside.cars.find((c) => c.id === 1);
      expect(after).toBeDefined();
      expect(after?.seg).not.toBe(west);
      expect(after?.serial).not.toBe(serialBefore);
      // The draw is the one it always was: one step of upcoming()'s generator per road picked.
      expect(after?.serial).toBe((serialBefore * 1103515245 + 12345) >>> 0);
    } finally {
      world.free();
    }
  });

  it("logs one traffic_car_put_back for a car moved 10 m off its lane unseen, none for its first placing", () => {
    const { world, graph, inside, step, ai } = build();
    try {
      tap();
      ai.placeCar(graph.segments[0], 80, 0);
      step(3);
      expect(lines.filter((l) => l.event === "traffic_car_put_back")).toHaveLength(0);
      const car = inside.cars[0];
      car.rear.add(new Vector3(0, 0, 10));
      step(1);
      const putBack = lines.filter((l) => l.event === "traffic_car_put_back");
      expect(putBack).toHaveLength(1);
      expect(putBack[0]).toMatchObject({ carId: car.id, isSeen: false });
      expect(putBack[0].offLaneM as number).toBeGreaterThan(8);
    } finally {
      world.free();
    }
  });

  it("keeps where the look last began to see the player without a break, not an earlier sighting", () => {
    const { world, graph, inside, ai } = build();
    try {
      ai.isSeen = () => true; // no car of the traffic's own appears
      const seg = graph.segments[0];
      ai.placeCar(seg, 20, 8);
      const fwd = new Vector3(0, 0, 1);
      const lanePlayer = (s: number) => graph.sample(seg, s).pos.clone();
      // The player's car 90 m on along the street (well in the look), then 6 m aside for 1 s.
      const ahead = lanePlayer(110);
      const aside = ahead.clone().add(new Vector3(0, 0, 6));
      const run = (p: Vector3, frames: number) => {
        for (let i = 0; i < frames; i++) ai.update(1 / 60, p, p, fwd, 0);
      };
      run(ahead, 30);
      const car = inside.cars[0];
      const far = car.firstSeen?.m ?? NaN;
      run(aside, 60);
      expect(car.firstSeen).toBeNull();
      run(ahead, 2);
      const near = car.firstSeen?.m ?? NaN;
      expect(far).toBeGreaterThan(80);
      expect(near).toBeLessThan(far - 5);
    } finally {
      world.free();
    }
  });

  it("names the traffic car by the handle of its collider, and nothing for a handle it does not know", () => {
    const { world, graph, inside, ai } = build();
    try {
      ai.isSeen = () => true;
      const seg = graph.segments[0];
      ai.placeCar(seg, 60, 0);
      const near = graph.sample(seg, 90).pos.clone();
      ai.update(1 / 60, near, near, new Vector3(0, 0, 1), 0);
      ai.update(1 / 60, near, near, new Vector3(0, 0, 1), 0);
      const car = inside.cars[0];
      const handle = car.body?.collider(0)?.handle;
      expect(handle).toBeDefined();
      expect(ai.contactInfo(handle ?? -1)?.carId).toBe(car.id);
      expect(ai.contactInfo(987654)).toBeNull();
    } finally {
      world.free();
    }
  });
});

// D3 (d)(a): a traffic car's place along its lane follows it round a corner onto the next road, and
// a car off its lane is not put back on it within 60 m of the player's car.
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
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
type XY = [number, number];
const line = (pts: XY[], oneway: 0 | 1, width = 12): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  kind: "local",
  oneway,
});
const at = ([x, y]: XY) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);

type Car = {
  id: number;
  seg: Segment;
  s: number;
  rear: Vector3;
  speed: number;
  object: Group;
};
type Inside = { cars: Car[]; pose(g: RoadGraph, c: Car): { pos: Vector3; dir: Vector3 } };

function traffic(lines: RoadLine[], seen: boolean) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const graph = new RoadGraph(lines, frame);
  for (const seg of graph.segments) seg.limit = 60;
  const ai = new TrafficAI(new Scene(), world, () => 0);
  ai.isSeen = () => seen;
  ai.setGraph(graph);
  return { world, graph, ai, inside: ai as unknown as Inside };
}

let lines: LogEntry[] = [];
let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
});
const tap = () => {
  lines = [];
  off = onLogLine((_, entry) => lines.push(entry));
};

/** North on a one-way street to a node at (0, 200), then a two-way street turning `deg` (left +). */
const corner = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  const node: XY = [0, 200];
  return [
    line([[0, 0], node], 1),
    line([node, [node[0] - 150 * Math.sin(r), node[1] + 150 * Math.cos(r)]], 0),
  ];
};

describe("a traffic car round a corner (D3 (d))", () => {
  for (const seen of [false, true]) {
    it(`T-d1: turns without a put-back, under 8 m off its lane, onto the next road (${seen ? "seen" : "unseen"})`, () => {
      const failed: string[] = [];
      for (const deg of [90, 100, 119, -90]) {
        const { world, graph, ai, inside } = traffic(corner(deg), seen);
        try {
          const approach = graph.segments.find((s) => s.oneway === 1) ?? graph.segments[0];
          const exit = graph.segments.find((s) => s !== approach) ?? graph.segments[1];
          const far = at([400, 100]);
          ai.placeCar(approach, 140, 10);
          ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
          const c = inside.cars[0];
          let prev = c.object.position.clone();
          let maxJump = 0;
          let maxOff = 0;
          for (let i = 0; i < 60 * 25; i++) {
            ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
            const p = c.object.position;
            maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.z - prev.z) - (c.speed / 60 + 0.2));
            const lane = inside.pose(graph, c).pos;
            maxOff = Math.max(maxOff, Math.hypot(p.x - lane.x, p.z - lane.z));
            prev = p.clone();
          }
          const isClear = maxJump <= 0 && maxOff < 8 && c.seg === exit;
          if (!isClear)
            failed.push(
              `${deg}°: jump ${maxJump.toFixed(2)} m, off ${maxOff.toFixed(2)} m, on exit ${c.seg === exit}`,
            );
        } finally {
          world.free();
        }
      }
      expect(failed).toEqual([]);
    });
  }

  it("T-d2: keeps a car standing on its lane just before a left turn on its own road", () => {
    const { world, graph, ai, inside } = traffic(corner(90), true);
    try {
      const approach = graph.segments.find((s) => s.oneway === 1) ?? graph.segments[0];
      // The player's car stands on the corner: the traffic car stops behind it, short of the node.
      const player = at([0, 200]);
      ai.placeCar(approach, 150, 8);
      for (let i = 0; i < 60 * 15; i++) ai.update(1 / 60, player, player, new Vector3(0, 0, -1), 0);
      const c = inside.cars[0];
      expect(c.speed).toBeLessThan(0.05);
      expect(c.seg).toBe(approach);
    } finally {
      world.free();
    }
  });

  for (const deg of [0, 10]) {
    it(`T-d3: moves on to the next road where it did before, straight on and at a ${deg}° fork (${deg}°)`, () => {
      const node: XY = [0, 200];
      const r = (deg * Math.PI) / 180;
      const lines = [
        line([[0, 0], node], 1),
        line([node, [node[0] + 150 * Math.sin(r), node[1] + 150 * Math.cos(r)]], 1),
      ];
      const { world, graph, ai, inside } = traffic(lines, true);
      try {
        const approach = graph.segments.find((s) => s.line === lines[0]) ?? graph.segments[0];
        const far = at([400, 100]);
        ai.placeCar(approach, 150, 8);
        ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
        const c = inside.cars[0];
        let handedAt: number | null = null;
        let lastS = c.s;
        for (let i = 0; i < 60 * 15 && handedAt === null; i++) {
          ai.update(1 / 60, far, far, new Vector3(0, 0, -1), 0);
          if (c.seg !== approach) handedAt = lastS;
          lastS = c.s;
        }
        expect(handedAt).not.toBeNull();
        // The last place on the approach before the move: within 0.1 m of its end, less 0.05 m.
        expect(Math.abs((handedAt ?? 0) - (approach.length - 0.05))).toBeLessThan(0.1 + c.speed / 30);
      } finally {
        world.free();
      }
    });
  }
});

describe("putting a car back on its lane near the player's car (D3 (a))", () => {
  /** A car placed and settled on a straight one-way street, then moved 10 m aside, unseen. */
  const moved = (playerAt: number) => {
    const lines = [
      line(
        [
          [0, 0],
          [0, 400],
        ],
        1,
      ),
    ];
    const { world, graph, ai, inside } = traffic(lines, false);
    const seg = graph.segments[0];
    tap();
    const player = graph
      .sample(seg, playerAt)
      .pos.clone()
      .add(new Vector3(20, 0, 0));
    ai.placeCar(seg, 100, 0);
    for (let i = 0; i < 3; i++) ai.update(1 / 60, player, player, new Vector3(0, 0, -1), 0);
    const c = inside.cars[0];
    c.rear.add(new Vector3(10, 0, 0));
    const before = c.object.position.clone();
    for (let i = 0; i < 3; i++) ai.update(1 / 60, player, player, new Vector3(0, 0, -1), 0);
    return { world, c, before, ai, graph, inside };
  };

  it("T-a1: leaves it where it is with the spot it would land on 30 m from the player, saying so once", () => {
    const { world, c, before } = moved(125);
    try {
      expect(lines.filter((l) => l.event === "traffic_car_put_back")).toHaveLength(0);
      const held = lines.filter((l) => l.event === "traffic_car_put_back_held");
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ carId: c.id });
      expect(Math.hypot(c.object.position.x - before.x, c.object.position.z - before.z)).toBeLessThan(1);
    } finally {
      world.free();
    }
  });

  it("T-a2: puts it back with the spot 80 m from the player", () => {
    const { world } = moved(180);
    try {
      expect(lines.filter((l) => l.event === "traffic_car_put_back")).toHaveLength(1);
      expect(lines.filter((l) => l.event === "traffic_car_put_back_held")).toHaveLength(0);
    } finally {
      world.free();
    }
  });

  it("T-a3: still places a car the QA put 20 m from the player on its lane at its first update", () => {
    const lines = [
      line(
        [
          [0, 0],
          [0, 400],
        ],
        1,
      ),
    ];
    const { world, graph, ai, inside } = traffic(lines, false);
    try {
      const seg = graph.segments[0];
      const player = graph.sample(seg, 120).pos.clone();
      ai.placeCar(seg, 100, 0);
      ai.update(1 / 60, player, player, new Vector3(0, 0, -1), 0);
      const c = inside.cars[0];
      expect(Number.isFinite(c.rear.x)).toBe(true);
      const lane = inside.pose(graph, c).pos;
      expect(Math.hypot(c.object.position.x - lane.x, c.object.position.z - lane.z)).toBeLessThan(1);
    } finally {
      world.free();
    }
  });
});

import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadGraphSnapshot, type RoadLine, type Segment } from "../src/world/roads";

const frame = new LocalFrame(35.68, 139.76, 40);
const surface = (seg: Segment) => seg.line.kind !== "highway";
const open = (seg: Segment) => !seg.closed && seg.oneway !== -1;
type Path = { points: Array<[number, number]>; kind?: RoadLine["kind"]; width?: number };

function graphFrom(paths: Path[]): RoadGraph {
  const segments: RoadGraphSnapshot["segments"] = paths.map(({ points, kind = "local", width = 6 }, id) => {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    return {
      id,
      line: { coords: points.flat(), width, kind, oneway: 0 },
      pts: points.map(([x, z]) => [x, 0, z]),
      cum,
      length: cum.at(-1)!,
      from: id * 2,
      to: id * 2 + 1,
      oneway: 0,
      onewayRule: null,
      limit: null,
      limitKind: "statutory",
      noOvertake: false,
      noLaneChange: false,
      lanes: 1,
      rules: [],
      closures: [],
      closed: false,
    };
  });
  return RoadGraph.restore({ segments, nodes: new Map(), pieces: null }, frame);
}

// Exhaustive reference from before spatial pruning: verify the query's observable result.
function exhaustive(graph: RoadGraph, p: Vector3, maxDist: number, accept = (_seg: Segment) => true) {
  let best: ReturnType<RoadGraph["nearest"]> = null;
  let bestD = maxDist;
  const ab = new Vector3();
  const ap = new Vector3();
  for (const seg of graph.segments) {
    const isAccepted = accept(seg);
    if (!isAccepted) continue;
    for (let i = 1; i < seg.pts.length; i++) {
      const a = seg.pts[i - 1];
      ab.copy(seg.pts[i]).sub(a);
      const len2 = ab.x * ab.x + ab.z * ab.z;
      const isDegenerate = len2 < 1e-6;
      if (isDegenerate) continue;
      ap.set(p.x - a.x, 0, p.z - a.z);
      const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.z * ab.z) / len2));
      const d = Math.hypot(a.x + ab.x * t - p.x, a.z + ab.z * t - p.z);
      const isOutside = d >= bestD;
      if (isOutside) continue;
      bestD = d;
      const len = Math.sqrt(len2);
      const dir = new Vector3(ab.x / len, 0, ab.z / len);
      best = { seg, s: seg.cum[i - 1] + len * t, lateral: ap.x * dir.z - ap.z * dir.x, dir };
    }
  }
  return best;
}

describe("nearest road spatial queries", () => {
  it("matches exhaustive projection for negative cells, curves, radii and source filters", () => {
    const graph = graphFrom(
      Array.from({ length: 300 }, (_, i) => {
        const x = (i % 20) * 64 - 640;
        const z = Math.floor(i / 20) * 64 - 480;
        return {
          points: [
            [x - 33, z - 15],
            [x, z],
            [x + 25, z - 32],
          ],
          kind: i % 7 === 0 ? "highway" : "local",
        };
      }),
    );
    const filters = [
      (_seg: Segment) => true,
      (seg: Segment) => seg.line.kind !== "highway",
      (seg: Segment) => seg.id % 3 === 0,
    ];
    for (let i = 0; i < 180; i++) {
      const p = new Vector3(((i * 977) % 1600) - 800, i, ((i * 619) % 1200) - 600);
      for (const radius of [0, 0.1, 3, 15, 40, 200, 1e6, Infinity]) {
        for (const accept of filters)
          expect(graph.nearest(p, radius, accept)).toEqual(exhaustive(graph, p, radius, accept));
      }
    }
  });

  it("retains strict radius exclusion and the original winner for equal distances", () => {
    const graph = graphFrom([
      {
        points: [
          [-100, -10],
          [100, -10],
        ],
      },
      {
        points: [
          [-100, 10],
          [100, 10],
        ],
      },
      {
        points: [
          [-1000, -1000],
          [1000, 1000],
        ],
        kind: "highway",
      },
    ]);
    const p = new Vector3(0, 50, 0);
    expect(graph.nearest(p, 10, surface)).toBeNull();
    expect(graph.nearest(p, 10.001, surface)!.seg).toBe(graph.segments[0]);
    expect(graph.nearest(p, 10.001, surface)).toEqual(exhaustive(graph, p, 10.001, surface));
  });

  it("finds long pieces crossing a query cell and skips zero-length pieces", () => {
    const graph = graphFrom([
      {
        points: [
          [-1000, 32],
          [-1000, 32],
          [1000, 32],
          [1000, 32.0005],
        ],
      },
      {
        points: [
          [-1000, -32],
          [1000, -32],
        ],
      },
    ]);
    for (const x of [-32.001, -32, -0.001, 0, 31.999, 32, 32.001]) {
      const p = new Vector3(x, 0, 31.9);
      expect(graph.nearest(p, 0.2)).toEqual(exhaustive(graph, p, 0.2));
      expect(graph.nearest(p, 0.2)?.seg).toBe(graph.segments[0]);
    }
  });

  it("includes highways in nearest queries while excluding them from surface carriageways", () => {
    const graph = graphFrom([
      {
        points: [
          [-300, 0],
          [300, 0],
        ],
        kind: "highway",
        width: 12,
      },
      {
        points: [
          [-300, 20],
          [300, 20],
        ],
      },
    ]);
    const p = new Vector3(0, 0, 0);
    expect(graph.nearest(p, 40)!.seg).toBe(graph.segments[0]);
    expect(graph.nearest(p, 40, (seg) => seg.line.kind !== "highway")!.seg).toBe(graph.segments[1]);
    expect(graph.carriagewaysAt(p)).toEqual([]);
    expect(graph.carriagewaysAt(new Vector3(0, 0, 20)).map((row) => row.seg)).toEqual([graph.segments[1]]);
  });

  it("evaluates changed closures and one-way filters at query time", () => {
    const graph = graphFrom([
      {
        points: [
          [-300, 0],
          [300, 0],
        ],
      },
      {
        points: [
          [-300, 5],
          [300, 5],
        ],
      },
    ]);
    const p = new Vector3();
    expect(graph.nearest(p, 15, open)!.seg).toBe(graph.segments[0]);
    graph.segments[0].closed = true;
    expect(graph.nearest(p, 15, open)!.seg).toBe(graph.segments[1]);
    graph.segments[1].oneway = -1;
    expect(graph.nearest(p, 15, open)).toBeNull();
    graph.segments[0].closed = false;
    expect(graph.nearest(p, 15, open)!.seg).toBe(graph.segments[0]);
  });

  it("preserves precomputed queries across structured clone and restores legacy lazy snapshots", () => {
    const graph = graphFrom([
      {
        points: [
          [-1000, 0],
          [1000, 0],
        ],
        kind: "highway",
      },
      {
        points: [
          [-1000, 33],
          [1000, 33],
        ],
      },
    ]);
    const data = structuredClone(graph.snapshot());
    expect(data.pieces?.size).toBeGreaterThan(0);
    const restored = RoadGraph.restore(data, frame);
    const legacy = RoadGraph.restore({ ...data, pieces: null }, frame);
    for (const p of [new Vector3(32, 0, -0.1), new Vector3(-32, 0, 33.1)]) {
      expect(restored.nearest(p, 3)?.seg.id).toBe(exhaustive(graph, p, 3)?.seg.id);
      expect(legacy.nearest(p, 3)?.seg.id).toBe(exhaustive(graph, p, 3)?.seg.id);
    }
    const dataBefore = data.pieces;
    restored.nearest(new Vector3(), 40);
    expect(restored.snapshot().pieces).toBe(dataBefore);
  });

  it("keeps empty, unbounded, negative and extreme-coordinate query behavior", () => {
    const graph = graphFrom([
      {
        points: [
          [-100, 0],
          [100, 0],
        ],
      },
    ]);
    for (const p of [
      new Vector3(),
      new Vector3(Infinity, 0, 0),
      new Vector3(NaN, 0, 0),
      new Vector3(1e308, 0, -1e308),
    ]) {
      for (const radius of [-1, 0, 1, NaN, Infinity, 1e308]) {
        expect(graph.nearest(p, radius)).toEqual(exhaustive(graph, p, radius));
      }
    }
    expect(graphFrom([]).nearest(new Vector3(), 40)).toBeNull();
  });
});

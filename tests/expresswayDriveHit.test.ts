import { describe, expect, it } from "vitest";
import { insideHit } from "../src/debug/expresswayDrive";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";

// The drive hook's surface under the car (P2.7-5, 4.4's |dy|): a hit clamped to the end of one chunk
// while the car is already on the next one must be measured on the next one. Two chunks of one run
// at 5 % (posted 60 then 50, as 45021976:10 → :11), joined at a node.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const deck = (y0: number, y1: number, xid: string, limit: number, ids: [string, string]): RoadLine => ({
  coords: [139.76, 35.68 + y0 * LAT, 139.76, 35.68 + y1 * LAT],
  width: 9.25,
  oneway: 1,
  kind: "highway",
  source: "osm",
  cls: "expressway",
  structure: "viaduct",
  level: 1,
  xid,
  limit,
  nodeIds: ids,
});

describe("insideHit: the drive hook's surface past a seam", () => {
  const graph = new RoadGraph(
    [deck(-100, 0, "45021976:10", 60, ["a", "j"]), deck(0, 100, "45021976:11", 50, ["j", "b"])],
    frame,
  );
  const [first, next] = ["45021976:10", "45021976:11"].map((x) =>
    graph.segments.find((s) => s.line.xid === x)!,
  );
  // 5 % up the whole way, the joint at 10 m.
  first.elev = [5, 10];
  next.elev = [10, 15];

  it("measures 3 m past the seam on the next chunk (within 1 cm of its face), not at the first's clamped end", () => {
    const p = frame.toLocal(35.68 + 3 * LAT, 139.76, frame.origin.h).setY(10.15 + 0.5);
    const clamped = { seg: first, s: first.length };
    const hit = insideHit(graph, p, clamped);
    expect(hit.seg).toBe(next);
    const face = graph.surfaceY(next, hit.s)!;
    expect(Math.abs(face - 10.15)).toBeLessThan(0.01);
    // The clamped end would have read 10.00: the 0.15 m the drive took for a bump.
    expect(Math.abs(graph.surfaceY(first, first.length)! - 10)).toBeLessThan(0.01);
  });

  it("leaves a hit inside its segment as it is", () => {
    const p = frame.toLocal(35.68 - 50 * LAT, 139.76, frame.origin.h).setY(8);
    const inside = { seg: first, s: 50 };
    expect(insideHit(graph, p, inside)).toBe(inside);
  });
});

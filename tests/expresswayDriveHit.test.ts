import { describe, expect, it } from "vitest";
import { insideHit, rideHit } from "../src/debug/expresswayDrive";
import { LocalFrame } from "../src/geo/frame";
import { MERGE_MAX_DZ } from "../src/world/expresswayMerge";
import { CAR_RIDE_HEIGHT } from "../src/physics/carBody";
import { DECK_REACH, RoadGraph, type RoadLine, type Segment } from "../src/world/roads";

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

describe("insideHit across runs (S6 PR 7c1, F4: a viaduct seamed into a ground run)", () => {
  // 4853798 → 203873824 at −9 %: the viaduct's last chunk and the ground run's first, two runs
  // joined at the seam's node.
  const graph = new RoadGraph(
    [deck(-100, 0, "4853798:3", 40, ["a", "seam"]), deck(0, 100, "203873824:0", 40, ["seam", "b"])],
    frame,
  );
  const [viaduct, ground] = ["4853798:3", "203873824:0"].map((x) =>
    graph.segments.find((s) => s.line.xid === x)!,
  );
  viaduct.elev = [9, 0];
  ground.elev = [0, -9];

  it("measures 3 m before the seam on the viaduct (within 1 cm of its face), not at the ground run's clamped start", () => {
    const p = frame.toLocal(35.68 - 3 * LAT, 139.76, frame.origin.h).setY(0.27 + 0.5);
    const clamped = { seg: ground, s: 0 };
    const hit = insideHit(graph, p, clamped);
    expect(hit.seg).toBe(viaduct);
    expect(Math.abs(graph.surfaceY(viaduct, hit.s)! - 0.27)).toBeLessThan(0.01);
  });

  it("does not take a deck of another run that does not meet it at that end", () => {
    const apart = new RoadGraph(
      [deck(-100, 0, "4853798:3", 40, ["a", "x"]), deck(0, 100, "203873824:0", 40, ["y", "b"])],
      frame,
    );
    const g = apart.segments.find((s) => s.line.xid === "203873824:0")!;
    const p = frame.toLocal(35.68 - 3 * LAT, 139.76, frame.origin.h).setY(1);
    const clamped = { seg: g, s: 0 };
    expect(insideHit(apart, p, clamped)).toBe(clamped);
  });
});

describe("rideHit: the ride on the autopilot's route (review of 7c1, A)", () => {
  // A ramp 1.6 m over a main line along the same plan line (24402125:2 over 45068170:0): a car on
  // the ramp is within SURFACE_GATE of both, and locate answers the main line (deckRank).
  const main = deck(-100, 100, "45068170:0", 60, ["m0", "m1"]);
  const ramp: RoadLine = { ...deck(-50, 50, "24402125:2", 40, ["r0", "r1"]), cls: "ramp" };
  const graph = new RoadGraph([main, ramp], frame);
  const [m, r] = ["45068170:0", "24402125:2"].map((x) => graph.segments.find((s) => s.line.xid === x)!);
  m.elev = [0, 0];
  r.elev = [1.6, 1.6];
  const p = frame.toLocal(35.68, 139.76, frame.origin.h).setY(1.6 + 0.8);

  it("measures a car on the ramp of its route against the ramp (within 1 cm)", () => {
    const hit = rideHit(graph, p, [], new Set([r]));
    expect(hit?.seg).toBe(r);
    expect(Math.abs(graph.surfaceY(r, hit!.s)! - 1.6)).toBeLessThan(0.01);
  });

  it("falls back to the graph's locate off the route (a car on the main line under the ramp: the main line)", () => {
    // Before R1-4a-1 this asked at the car on the ramp and held the main line below as locate's answer
    // there: the mix-up R1-4a-1 fixed (roads.ts deckUnderCar). The ramp's side is below (locate: the deck a car stands on).
    const onMain = frame.toLocal(35.68, 139.76, frame.origin.h).setY(0 + 0.8);
    expect(rideHit(graph, onMain, [], null)?.seg).toBe(m);
    expect(rideHit(graph, onMain, [], new Set())?.seg).toBe(m);
  });
});

describe("locate: the deck a car stands on, where another deck passes within SURFACE_GATE (R1-4a-1)", () => {
  // A main line (60 km/h) and a ramp (40 km/h) along one plan line, the ramp `dz` over (or under) the
  // main line: the car's body centre is CAR_RIDE_HEIGHT over the road it is on (as vehicle.position()).
  const pair = (dz: number) => {
    const main = deck(-100, 100, "45068170:0", 60, ["m0", "m1"]);
    const ramp: RoadLine = { ...deck(-50, 50, "24402125:2", 40, ["r0", "r1"]), cls: "ramp" };
    const graph = new RoadGraph([main, ramp], frame);
    const [m, r] = ["45068170:0", "24402125:2"].map((x) => graph.segments.find((s) => s.line.xid === x)!);
    m.elev = [0, 0];
    r.elev = [dz, dz];
    return { graph, m, r };
  };
  const carOn = (seg: Segment, east = 0) =>
    frame.toLocal(35.68, 139.76 + east / 90_400, frame.origin.h).setY(seg.elev![0] + CAR_RIDE_HEIGHT);

  it("answers the ramp for a car on it 1.6 m over the main line, and the main line for a car under it", () => {
    const { graph, m, r } = pair(1.6);
    expect(graph.locate(carOn(r), 30)?.seg).toBe(r);
    expect(graph.locate(carOn(m), 30)?.seg).toBe(m);
  });

  it("answers the ramp for a car on it 1.6 m under the main line, and the main line for a car on that", () => {
    const { graph, m, r } = pair(-1.6);
    expect(graph.locate(carOn(r), 30)?.seg).toBe(r);
    expect(graph.locate(carOn(m), 30)?.seg).toBe(m);
  });

  it("keeps deckRank's main line on one surface (within MERGE_MAX_DZ) and parts the two just past it", () => {
    const one = pair(MERGE_MAX_DZ - 0.01);
    expect(one.graph.locate(carOn(one.r), 30)?.seg).toBe(one.m);
    expect(one.graph.locate(carOn(one.m), 30)?.seg).toBe(one.m);
    const two = pair(MERGE_MAX_DZ + 0.01);
    expect(two.graph.locate(carOn(two.r), 30)?.seg).toBe(two.r);
    expect(two.graph.locate(carOn(two.m), 30)?.seg).toBe(two.m);
  });

  it("answers the ramp for a car beyond its carriageway's edge within DECK_REACH, over the main line", () => {
    const { graph, r } = pair(1.6);
    const beyond = r.line.width / 2 + DECK_REACH / 2;
    expect(graph.locate(carOn(r, beyond), 30)?.seg).toBe(r);
  });
});

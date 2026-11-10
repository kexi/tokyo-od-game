import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { carriagewayWidth, laneWidth, resolveSection, sectionOf } from "../src/world/laneChange";
import { computeRoadNetwork, restoreRoadNetwork } from "../src/world/roadNetworkData";
import type { RegulationData } from "../src/world/regulations";
import { RoadGraph, SURFACE_GATE, type RoadLine } from "../src/world/roads";

/** Regulation data with nothing in it: the pass runs, and resets what JARTIC owns. */
const EMPTY_REGS: RegulationData = {
  speed: [],
  speedZone: [],
  oneway: [],
  crosswalk: [],
  stopLine: [],
  stopSign: [],
  sections: [],
  turns: [],
  closures: [],
  noOvertake: [],
  lanes: [],
  noLaneChange: [],
  laneArrows: [],
  signals: [],
  junctions: [],
  footbridges: [],
  turnlanes: [],
};

// Local frame: x east, z south. These helpers take x east, y north metres.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const line = (pts: Array<[number, number]>, extra: Partial<RoadLine> = {}): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width: 12,
  oneway: 0,
  kind: "local",
  ...extra,
});

const DECK_Y = 8;

/**
 * A street running north on x = 0 with a cross street at y = 0, and an expressway deck (level 1,
 * 8 m up) right above the street from y = -200 to 200, its ends on the street's own points. The
 * deck's heights are set the way P3 will set them from the compiled stations.
 */
function stacked() {
  const street = line([
    [0, -200],
    [0, 0],
    [0, 200],
  ]);
  const cross = line([
    [-150, 0],
    [0, 0],
    [150, 0],
  ]);
  const deck = line(
    [
      [0, -200],
      [0, 200],
    ],
    { source: "osm", cls: "expressway", structure: "viaduct", level: 1, xid: "c1:0", width: 9.25, oneway: 1 },
  );
  const graph = new RoadGraph([street, cross, deck], frame);
  const top = graph.segments.find((s) => s.line.level === 1);
  if (!top) throw new Error("no deck");
  top.elev = top.pts.map(() => DECK_Y);
  return { graph, top };
}

describe("layered road graph (level, surfaceY, nearestOnSurface)", () => {
  it("keeps decks out of the ground junctions: the deck's ends share points but not nodes", () => {
    const { graph, top } = stacked();
    for (const node of [top.from, top.to]) expect(graph.nodes.get(node)).toEqual([top.id]);
    // The street is still split at the cross street, as before levels.
    const ground = graph.segments.filter((s) => s.line.level === undefined);
    expect(ground).toHaveLength(4);
  });

  it("joins a ramp to the deck at its top and to the street at its foot by node id, across levels", () => {
    // Deck (level 1) east along y = 300 ending at node d1; the ramp runs from d1 down to node g1,
    // the middle point of a ground street running north on x = 200.
    const deck = line(
      [
        [-200, 300],
        [0, 300],
      ],
      { source: "osm", cls: "expressway", structure: "viaduct", level: 1, oneway: 1, nodeIds: ["d0", "d1"] },
    );
    const ramp = line(
      [
        [0, 300],
        [100, 300],
        [200, 200],
      ],
      { source: "osm", cls: "ramp", structure: "viaduct", level: 1, oneway: 1, nodeIds: ["d1", "", "g1"] },
    );
    const street = line(
      [
        [200, 0],
        [200, 200],
        [200, 400],
      ],
      { nodeIds: ["", "g1", ""] },
    );
    const graph = new RoadGraph([deck, ramp, street], frame);
    const rampSeg = graph.segments.find((s) => s.line.cls === "ramp");
    const deckSeg = graph.segments.find((s) => s.line.cls === "expressway");
    if (!rampSeg || !deckSeg) throw new Error("no ramp or deck");
    // Top: the deck's end and the ramp's start are one node.
    expect(deckSeg.to).toBe(rampSeg.from);
    // Foot: the street is split at g1, and both halves meet the ramp there.
    const halves = graph.segments.filter((s) => s.line.cls === undefined);
    expect(halves).toHaveLength(2);
    expect(graph.nodes.get(rampSeg.to)?.toSorted()).toEqual(
      [rampSeg.id, ...halves.map((h) => h.id)].toSorted(),
    );
    // A car can drive deck → ramp → street.
    expect(graph.exits(deckSeg.to, deckSeg.id)).toContain(rampSeg);
    expect(graph.exits(rampSeg.to, rampSeg.id).length).toBe(2);
  });

  it("logs a line whose level and structure contradict, and builds it as given", () => {
    const reports: unknown[] = [];
    const bad = line(
      [
        [0, 0],
        [0, 100],
      ],
      { level: 2 },
    );
    const graph = new RoadGraph([bad], frame, (d) => reports.push(d));
    expect(graph.segments).toHaveLength(1);
    expect(reports).toEqual([
      {
        event: "road_level_mismatch",
        fields: { count: 1, examples: [{ level: 2, structure: "ground", xid: null }] },
      },
    ]);
  });

  it("takes a line's own section and posted limit, and keeps them through the regulation pass", () => {
    const section = {
      lanes: 2,
      laneWidth: 3.25,
      shoulderL: 1.25,
      shoulderR: 0.75,
      median: 0,
      basis: "statute" as const,
    };
    const deck = line(
      [
        [0, 0],
        [0, 100],
      ],
      { cls: "expressway", structure: "viaduct", level: 1, oneway: 1, width: 8.5, section, limit: 50 },
    );
    const data = computeRoadNetwork({ lines: [deck], regs: EMPTY_REGS, origin: frame.origin });
    const seg = restoreRoadNetwork(data, frame).graph.segments[0];
    expect(seg).toMatchObject({ lanes: 2, limit: 50, limitKind: "sign" });
    expect(sectionOf(seg)).toBe(seg.line.section);
  });

  it("answers nearest and carriagewaysAt from the ground only, so old callers see the street", () => {
    const { graph, top } = stacked();
    const p = at(1, 100);
    const hit = graph.nearest(p, 20);
    expect(hit?.seg.line.level).toBeUndefined();
    expect(graph.nearest(p, 20, (s) => s === top)).toBeNull();
    expect(graph.carriagewaysAt(p).every((c) => c.seg !== top)).toBe(true);
  });

  it("picks the deck for a car up on it and the street for a car under it", () => {
    const { graph, top } = stacked();
    const onDeck = at(1, 100).setY(DECK_Y + 0.5);
    expect(graph.nearestOnSurface(onDeck, 20)?.seg).toBe(top);
    const below = at(1, 100).setY(0.3);
    const street = graph.nearestOnSurface(below, 20)?.seg;
    expect(street).toBeDefined();
    expect(street).not.toBe(top);
    expect(street?.line.level).toBeUndefined();
  });

  it("finds no road between the levels, beyond the 2.5 m gate of either surface", () => {
    const { graph } = stacked();
    expect(graph.nearestOnSurface(at(1, 100).setY(DECK_Y / 2), 20)).toBeNull();
    expect(graph.nearestOnSurface(at(1, 100).setY(SURFACE_GATE - 0.01), 20)).not.toBeNull();
  });

  it("reads the deck's own heights and the terrain under ground roads in surfaceY", () => {
    const { graph, top } = stacked();
    top.elev = [6, 10];
    expect(graph.surfaceY(top, top.length / 2)).toBeCloseTo(8, 6);
    expect(graph.surfaceY(top, 0)).toBe(6);
    graph.ground = (x) => 30 + x * 0.01;
    const street = graph.segments.find((s) => s.line.level === undefined);
    if (!street) throw new Error("no street");
    const { pos } = graph.sample(street, 10);
    expect(graph.surfaceY(street, 10)).toBeCloseTo(30 + pos.x * 0.01, 9);
    // A deck answers from its heights, not the terrain under it.
    expect(graph.surfaceY(top, 0)).toBe(6);
  });

  it("carries the new line fields and the deck heights through the worker's snapshot", () => {
    const deck = line(
      [
        [0, -200],
        [0, 200],
      ],
      { source: "osm", cls: "ramp", structure: "viaduct", level: 2, xid: "r:3", ref: "C1", limit: 50 },
    );
    const data = computeRoadNetwork({ lines: [deck], regs: null, origin: frame.origin });
    data.graph.segments[0].elev = [5, 7];
    const { graph } = restoreRoadNetwork(structuredClone(data), frame);
    const seg = graph.segments[0];
    expect(seg.line).toMatchObject({
      source: "osm",
      cls: "ramp",
      structure: "viaduct",
      level: 2,
      xid: "r:3",
    });
    expect(seg.line).toMatchObject({ ref: "C1", limit: 50 });
    expect(seg.elev).toEqual([5, 7]);
  });

  it("leaves a GSI line's snapshot as it was: no new keys appear when the fields are absent", () => {
    const data = computeRoadNetwork({
      lines: [
        line([
          [0, 0],
          [0, 100],
        ]),
      ],
      regs: null,
      origin: frame.origin,
    });
    const seg = data.graph.segments[0];
    expect(Object.keys(seg.line).toSorted()).toEqual(["coords", "kind", "oneway", "width"]);
    expect("elev" in seg).toBe(false);
  });
});

describe("one cross-section for every lane count (resolveSection, sectionOf)", () => {
  it("takes JARTIC's count first, OSM's next, and the width last, and says which", () => {
    expect(resolveSection(20, false, { jartic: 2, osm: 3 })).toMatchObject({ lanes: 2, basis: "jartic" });
    expect(resolveSection(20, false, { osm: 3 })).toMatchObject({ lanes: 3, basis: "osm" });
    expect(resolveSection(20, false, {})).toMatchObject({ lanes: 1, basis: "width" });
    expect(resolveSection(20, false, {}, "byWidth")).toMatchObject({ lanes: 3, basis: "width" });
    expect(resolveSection(20, false, { resolved: 2 }, "byWidth")).toMatchObject({
      lanes: 2,
      basis: "jartic",
    });
  });

  it("reads a JARTIC count too big for one direction as both directions, capped at 2.75 m a lane", () => {
    expect(resolveSection(14, false, { jartic: 4 }).lanes).toBe(2);
    expect(resolveSection(14, true, { jartic: 4 }).lanes).toBe(4);
    expect(resolveSection(8, true, { jartic: 4 }).lanes).toBe(2);
  });

  it("assumes 2 to 4 lanes where JARTIC lists the section with the count blank", () => {
    expect(resolveSection(8, false, { jartic: 0 }).lanes).toBe(2);
    expect(resolveSection(40, false, { jartic: 0 }).lanes).toBe(4);
  });

  it("splits a GSI street's direction evenly, with no shoulders or median (the old lane width)", () => {
    const graph = new RoadGraph(
      [
        line(
          [
            [0, 0],
            [0, 100],
          ],
          { width: 13 },
        ),
      ],
      frame,
    );
    const seg = graph.segments[0];
    seg.lanes = 2;
    expect(sectionOf(seg)).toMatchObject({
      lanes: 2,
      laneWidth: 13 / 2 / 2,
      shoulderL: 0,
      shoulderR: 0,
      median: 0,
    });
    seg.oneway = 1;
    expect(laneWidth(seg)).toBe(13 / 2);
    expect(carriagewayWidth(seg.line)).toBe(13);
  });

  it("takes the shoulders and median of a line's own section off the lanes", () => {
    const section = {
      lanes: 2,
      laneWidth: 3.25,
      shoulderL: 1.25,
      shoulderR: 0.75,
      median: 0,
      basis: "statute" as const,
    };
    const graph = new RoadGraph(
      [
        line(
          [
            [0, 0],
            [0, 100],
          ],
          { width: 8.5, oneway: 1, section },
        ),
      ],
      frame,
    );
    expect(laneWidth(graph.segments[0], section.lanes)).toBeCloseTo(3.25, 9);
  });
});

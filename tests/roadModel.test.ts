import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import {
  carriagewayWidth,
  laneLeftEdge,
  laneWidth,
  resolveSection,
  sectionOf,
  streetRoom,
} from "../src/world/laneChange";
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
  roadlanes: [],
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
  it("takes JARTIC's count first, OSM's next, and one lane last, and says which", () => {
    const osm = { forward: 3, backward: 3 };
    expect(resolveSection(26, false, { jartic: 2, osm })).toMatchObject({ lanes: 2, basis: "jartic" });
    expect(resolveSection(26, false, { osm })).toMatchObject({ lanes: 3, basis: "osm" });
    expect(resolveSection(26, false, {})).toMatchObject({ lanes: 1, basis: "width" });
  });

  it("gives one lane wherever neither JARTIC nor OSM gives a count, one-way or not, at any width", () => {
    for (const width of [2.5, 4.3, 9, 12.9, 13, 16, 22, 30, 70]) {
      expect(resolveSection(width, false).lanes, `two-way ${width}`).toBe(1);
      expect(resolveSection(width, true).lanes, `one-way ${width}`).toBe(1);
    }
  });

  it("caps the carriageway at lanes × 3.25 m plus 0.5 m shoulders (構造令 第5条・第8条) inside the room", () => {
    const wide = resolveSection(30, false, { jartic: 2 });
    expect(wide.carriageway).toBe(2 * 2 * 3.25 + 2 * 0.5);
    expect(wide.laneWidth).toBe(3.25);
    expect(wide).toMatchObject({ shoulderL: 0.5, shoulderR: 0.5, median: 0 });
    // A room narrower than that squeezes the lanes instead.
    const narrow = resolveSection(12, false, { jartic: 2 });
    expect(narrow.carriageway).toBe(12);
    expect(narrow.laneWidth).toBe((12 / 2 - 0.5) / 2);
    // One-way: the lanes sit between both shoulders.
    expect(resolveSection(9, true, { jartic: 2 }).laneWidth).toBe(3.25);
  });

  it("checks every count against one room: the 幅員 less two pavements from 13 m, or OSM's width", () => {
    expect(streetRoom(12.9, false)).toEqual({ room: 12.9, fitting: 2 });
    expect(streetRoom(25, false)).toEqual({ room: 18, fitting: 3 });
    expect(streetRoom(25, false, 25)).toEqual({ room: 25, fitting: 4 });
    // JARTIC 4 on 25 m does not fit one direction of the 18 m room at 3 m a lane: both directions'.
    expect(resolveSection(25, false, { jartic: 4 })).toMatchObject({ lanes: 2, basis: "jartic" });
    // OSM's width is the carriageway's: no pavement taken off it.
    expect(resolveSection(14, false, { osmWidth: 14, osm: { forward: 2, backward: 2 } })).toMatchObject({
      lanes: 2,
      carriageway: 14,
    });
  });

  it("keeps OSM's lanes by direction along the coords, and lays out the larger count both ways", () => {
    const section = resolveSection(30, false, { osm: { forward: 3, backward: 2 } });
    expect(section).toMatchObject({ forward: 3, backward: 2, lanes: 3, basis: "osm" });
    // One carriageway of a divided road matched only: the other direction is taken alike.
    expect(resolveSection(30, false, { osm: { forward: 2, backward: 0 } })).toMatchObject({
      forward: 2,
      backward: 2,
    });
    // A one-way street against its coords has its lanes backward.
    expect(resolveSection(9, -1, { osm: { forward: 0, backward: 2 } })).toMatchObject({
      forward: 0,
      backward: 2,
      lanes: 2,
    });
    // More lanes than the room takes at 2.75 m are cut to what fits.
    expect(resolveSection(9, false, { osm: { forward: 3, backward: 3 } }).lanes).toBe(1);
  });

  it("reads a JARTIC count too big for one direction as both directions, capped at 2.75 m a lane", () => {
    expect(resolveSection(12, false, { jartic: 4 }).lanes).toBe(2);
    expect(resolveSection(12, true, { jartic: 4 }).lanes).toBe(4);
    expect(resolveSection(8, true, { jartic: 4 }).lanes).toBe(2);
  });

  it("assumes 2 to 4 lanes where JARTIC lists the section with the count blank, never more than fit", () => {
    expect(resolveSection(12, false, { jartic: 0 }).lanes).toBe(2);
    expect(resolveSection(40, false, { jartic: 0 }).lanes).toBe(4);
    // 4.3 m two-way holds one lane a direction at 2.75 m: not two of 0.8 m.
    const narrow = resolveSection(4.3, false, { jartic: 0 });
    expect(narrow.lanes).toBe(1);
    expect(narrow.laneWidth).toBeGreaterThan(1);
  });

  it("takes a hand-set lane count as an assumption, keeping the recorded 中央帯", () => {
    expect(resolveSection(12, false, { lanes: 2 }).basis).toBe("assumption");
    const graph = new RoadGraph(
      [
        line(
          [
            [0, 0],
            [0, 100],
          ],
          { width: 40 },
        ),
      ],
      frame,
    );
    const seg = graph.segments[0];
    seg.section = resolveSection(40, false, { osm: { forward: 3, backward: 3 }, osmSeparation: 13 });
    seg.lanes = 3;
    const median = seg.section.median;
    expect(median).toBeGreaterThan(0);
    seg.lanes = 2;
    expect(sectionOf(seg).median).toBe(median);
  });

  it("splits a GSI street's direction evenly inside the shoulders of its section", () => {
    const graph = new RoadGraph(
      [
        line(
          [
            [0, 0],
            [0, 100],
          ],
          { width: 12 },
        ),
      ],
      frame,
    );
    const seg = graph.segments[0];
    seg.lanes = 2;
    // 12 m with two lanes a direction: needs 14 m, so the room caps it and the lanes squeeze.
    expect(sectionOf(seg)).toMatchObject({
      lanes: 2,
      laneWidth: (12 / 2 - 0.5) / 2,
      shoulderL: 0.5,
      median: 0,
    });
    expect(laneLeftEdge(seg)).toBe(12 / 2 - 0.5);
    seg.oneway = 1;
    expect(laneWidth(seg)).toBe(3.25);
    expect(carriagewayWidth(seg)).toBe(2 * 3.25 + 1);
  });

  it("records the section on the segment when the graph is built, and the line keeps its 幅員", () => {
    const graph = new RoadGraph(
      [
        line(
          [
            [0, 0],
            [0, 100],
          ],
          { width: 22 },
        ),
      ],
      frame,
    );
    const seg = graph.segments[0];
    expect(seg.section).toMatchObject({ lanes: 1, basis: "width", carriageway: 7.5 });
    expect(seg.lanes).toBe(1);
    expect(seg.line.width).toBe(22);
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

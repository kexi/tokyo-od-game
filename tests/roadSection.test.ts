import { describe, expect, it } from "vitest";
import { wayLanes, widthMetres } from "../scripts/roadLanes";
import { STREET_ASSUMPTIONS } from "../src/world/streetAssumptions";
import { LocalFrame } from "../src/geo/frame";
import { laneBand } from "../src/world/laneChange";
import { applyRegulations, type AppliedRegulations, type RegulationData } from "../src/world/regulations";
import { planMarkings } from "../src/world/roadMarkings";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { PLACES, placeFrame, roadsOf, tileData } from "./roadFixtures";

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
/** lon/lat pairs for points x east, y north metres from the frame's origin. */
const coords = (pts: Array<[number, number]>) => pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]);
const street = (pts: Array<[number, number]>, width: number, oneway: RoadLine["oneway"] = 0): RoadLine => ({
  coords: coords(pts),
  width,
  oneway,
  kind: "local",
});
const empty = (): RegulationData => ({
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
});
/** An OSM street way as roadlanes stores it (src/world/roadLanesData.ts). */
const way = (
  forward: number,
  backward: number,
  oneway: 0 | 1,
  pts: Array<[number, number]>,
  widthDm = 0,
  layer = 0,
) => [forward, backward, oneway, widthDm, layer, ...coords(pts)];
const sectionOfSeg = (seg: Segment) => seg.section;

describe("OSM street lanes as read at build time (scripts/roadLanes.ts)", () => {
  it("puts every lane of a one-way way forward, and reverses the coords of oneway=-1", () => {
    expect(wayLanes({ highway: "primary", oneway: "yes", lanes: "3" })).toMatchObject({
      forward: 3,
      backward: 0,
      oneway: 1,
      reversed: false,
    });
    expect(wayLanes({ highway: "primary", oneway: "-1", lanes: "2" })).toMatchObject({
      forward: 2,
      reversed: true,
    });
  });

  it("splits a two-way way's lanes by lanes:forward / lanes:backward, else half each (an odd one is a turn lane)", () => {
    expect(wayLanes({ lanes: "4" })).toMatchObject({ forward: 2, backward: 2, oneway: 0 });
    expect(wayLanes({ lanes: "3" })).toMatchObject({ forward: 1, backward: 1 });
    expect(wayLanes({ lanes: "5", "lanes:forward": "3" })).toMatchObject({ forward: 3, backward: 2 });
    expect(wayLanes({ lanes: "1" })).toMatchObject({ forward: 1, backward: 1 });
  });

  it("reads width in metres only, and skips a way with nothing the game reads", () => {
    expect(widthMetres("12")).toBe(12);
    expect(widthMetres("12.5 m")).toBe(12.5);
    expect(widthMetres("40'")).toBe(0);
    expect(widthMetres("1")).toBe(0);
    expect(wayLanes({ width: "9 m" })).toMatchObject({ forward: 0, backward: 0, widthDm: 90 });
    expect(wayLanes({ highway: "residential" })).toBeNull();
  });
});

describe("the street assumptions are kept apart from the statute values (streetAssumptions.ts)", () => {
  it("says of every assumption that it is unverified, and why", () => {
    for (const [name, entry] of Object.entries(STREET_ASSUMPTIONS)) {
      expect(entry.verified, name).toBe(false);
      expect(entry.reason.length, name).toBeGreaterThan(10);
    }
  });
});

describe("OSM street lanes leave out what cannot lie on a GSI ground centreline", () => {
  it("drops tunnels and underground ways, and keeps a bridge's layer for the matcher", () => {
    expect(wayLanes({ lanes: "4", tunnel: "yes" })).toBeNull();
    expect(wayLanes({ lanes: "4", layer: "-1" })).toBeNull();
    expect(wayLanes({ lanes: "4", bridge: "yes", layer: "1" })).toMatchObject({ layer: 1, forward: 2 });
  });
});

describe("OSM lanes matched onto the GSI centrelines (applyRegulations)", () => {
  it("takes a way carrying both directions only within 6 m of the centreline, as JARTIC's lines", () => {
    const graph = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          30,
        ),
      ],
      frame,
    );
    const data = empty();
    data.roadlanes = [
      way(3, 3, 0, [
        [9, 0],
        [9, 300],
      ]),
    ];
    applyRegulations(graph, data, frame, () => {});
    expect(sectionOfSeg(graph.segments[0])?.basis).toBe("width");
  });

  it("takes a bridge way (OSM layer 1) only onto a GSI 橋", () => {
    const plain = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          30,
        ),
      ],
      frame,
    );
    const bridge = new RoadGraph(
      [
        {
          ...street(
            [
              [0, 0],
              [0, 300],
            ],
            30,
          ),
          bridge: true,
        },
      ],
      frame,
    );
    const data = empty();
    data.roadlanes = [
      way(
        3,
        3,
        0,
        [
          [0, 0],
          [0, 300],
        ],
        0,
        1,
      ),
    ];
    applyRegulations(plain, data, frame, () => {});
    applyRegulations(bridge, data, frame, () => {});
    expect(sectionOfSeg(plain.segments[0])?.basis).toBe("width");
    expect(sectionOfSeg(bridge.segments[0])).toMatchObject({ basis: "osm", lanes: 3 });
  });

  it("takes a divided road's two one-way carriageways as the lanes of the GSI centreline between them", () => {
    const graph = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          30,
        ),
      ],
      frame,
    );
    const data = empty();
    data.roadlanes = [
      way(3, 0, 1, [
        [6, 0],
        [6, 300],
      ]),
      way(3, 0, 1, [
        [-6, 300],
        [-6, 0],
      ]),
    ];
    applyRegulations(graph, data, frame, () => {});
    const seg = graph.segments[0];
    expect(seg.lanes).toBe(3);
    expect(sectionOfSeg(seg)).toMatchObject({ basis: "osm", forward: 3, backward: 3 });
  });

  it("takes the gap between a divided road's carriageways, less one carriageway, as its 中央帯", () => {
    const graph = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          34,
        ),
      ],
      frame,
    );
    const data = empty();
    // 34 m less two 3.5 m pavements leaves 27 m of room, enough for the median.
    // Ways 6.5 m either side: 13 m apart, less a 0.5 m shoulder and 3 × 3.25 m lanes, is 2.75 m.
    data.roadlanes = [
      way(3, 0, 1, [
        [6.5, 0],
        [6.5, 300],
      ]),
      way(3, 0, 1, [
        [-6.5, 300],
        [-6.5, 0],
      ]),
    ];
    applyRegulations(graph, data, frame, () => {});
    const seg = graph.segments[0];
    const section = sectionOfSeg(seg)!;
    expect(section.median).toBeCloseTo(13 - 0.5 - 3 * 3.25, 1);
    expect(section.carriageway).toBeCloseTo(2 * (0.5 + 3 * 3.25) + section.median, 6);
    expect(section.laneWidth).toBeCloseTo(3.25, 6);
    // No lane reaches into the median: the inner lane's band stays outside its half.
    expect(laneBand(seg, 2).min).toBeGreaterThan(section.median / 2);
    // Painted: no 中央線, an edge line along each side of the median.
    const lines = planMarkings(graph, seg, { hasMarkings: true } as AppliedRegulations).lines;
    expect(lines.some((l) => l.kind === "centre")).toBe(false);
    const edges = lines
      .filter((l) => l.kind === "edge")
      .map((l) => l.offset)
      .toSorted((x, y) => x - y);
    expect(edges[1]).toBeCloseTo(-section.median / 2, 6);
    expect(edges[2]).toBeCloseTo(section.median / 2, 6);
  });

  it("reads a two-way way drawn against the segment with its directions swapped", () => {
    const graph = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          30,
        ),
      ],
      frame,
    );
    const data = empty();
    data.roadlanes = [
      way(1, 2, 0, [
        [0, 300],
        [0, 0],
      ]),
    ];
    applyRegulations(graph, data, frame, () => {});
    expect(sectionOfSeg(graph.segments[0])).toMatchObject({ forward: 2, backward: 1, lanes: 2 });
  });

  it("does not give a narrow street the lanes of the arterial carriageway 5 m beside it", () => {
    const graph = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          30,
        ),
        street(
          [
            [12, 0],
            [12, 300],
          ],
          4.3,
        ),
      ],
      frame,
    );
    const data = empty();
    // The arterial's carriageways 7 m either side of its centreline: the eastern one is nearer the
    // side street's centreline (5 m) than the arterial's, yet its 3 lanes do not fit 4.3 m.
    data.roadlanes = [
      way(3, 0, 1, [
        [7, 0],
        [7, 300],
      ]),
      way(3, 0, 1, [
        [-7, 300],
        [-7, 0],
      ]),
    ];
    applyRegulations(graph, data, frame, () => {});
    const [arterial, side] = graph.segments;
    expect(sectionOfSeg(side)?.basis).toBe("width");
    expect(side.lanes).toBe(1);
    expect(sectionOfSeg(arterial)?.basis).toBe("osm");
  });

  it("lets JARTIC's 車両通行帯 win, read as both directions' total when that is nearer OSM's total", () => {
    const graph = new RoadGraph(
      [
        street(
          [
            [0, 0],
            [0, 300],
          ],
          35,
        ),
      ],
      frame,
    );
    const data = empty();
    data.lanes = [
      [
        5,
        ...coords([
          [0, 0],
          [0, 300],
        ]),
      ],
    ];
    data.roadlanes = [
      way(3, 3, 0, [
        [0, 0],
        [0, 300],
      ]),
    ];
    applyRegulations(graph, data, frame, () => {});
    expect(sectionOfSeg(graph.segments[0])).toMatchObject({ basis: "jartic", lanes: 3 });
  });
});

describe("the sections at three places (frozen tiles of tests/fixtures/sign-placement)", () => {
  for (const place of PLACES) {
    it(`gives the pinned spread of lane counts and their evidence at ${place.name}`, () => {
      const data = tileData(place.tile);
      const frameOf = placeFrame(place.tile);
      const graph = new RoadGraph(roadsOf(data), frameOf, () => {});
      applyRegulations(graph, data, frameOf, () => {});
      const spread: Record<string, number> = {};
      for (const seg of graph.segments) {
        const key = `${seg.section?.basis ?? "line"} ${seg.lanes}`;
        spread[key] = (spread[key] ?? 0) + 1;
      }
      const sorted = Object.fromEntries(Object.entries(spread).toSorted(([a], [b]) => a.localeCompare(b)));
      expect(sorted).toMatchSnapshot();
      // Every street rests on some evidence, and the carriageway never exceeds the GSI 幅員.
      for (const seg of graph.segments) {
        const section = seg.section;
        if (!section) continue;
        expect(section.carriageway).toBeLessThanOrEqual(seg.line.width + 1e-9);
        expect(section.laneWidth).toBeGreaterThan(0);
      }
    });
  }
});

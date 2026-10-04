import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { anchors, M_LAT as LAT_M, M_LON as LON_M, parseCoords, streamCsv, turnMask } from "../scripts/jartic";
import { LocalFrame } from "../src/geo/frame";
import { LineGrid, SIGN, applyRegulations, type RegulationData } from "../src/world/regulations";
import { RoadGraph, speedLimit, type RoadLine } from "../src/world/roads";
import { CYCLE, lightState, segmentsIntersect } from "../src/world/trafficControl";

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LAT = 1 / 110_950; // degrees per metre of latitude near Tokyo
const empty = (): RegulationData => ({
  speed: [],
  speedZone: [],
  oneway: [],
  crosswalk: [],
  stopLine: [],
  stopSign: [],
  signs: [],
  noOvertake: [],
  lanes: [],
  noLaneChange: [],
  signals: [],
});
// East–west street along lat 35.68; coordinates run west → east.
const street = (lat = 35.68, width = 9): RoadLine => ({
  coords: [139.76, lat, 139.762, lat],
  width,
  oneway: 0,
  kind: "local",
});

describe("JARTIC CSV parsing", () => {
  it("handles quoted commas, doubled quotes and line breaks inside quotes across chunk edges", () => {
    const rows: string[][] = [];
    const csv = 'a,"b,c","d""e"\r\n1,"multi\nline",3\n';
    streamCsv(new TextEncoder().encode(csv), (r) => rows.push(r), 5);
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "multi\nline", "3"],
    ]);
  });

  it("decodes Shift_JIS even when a double-byte character straddles two chunks", () => {
    const rows: string[][] = [];
    // 「東京」 in Shift_JIS = 93 8C 8B 9E
    streamCsv(new Uint8Array([0x93, 0x8c, 0x8b, 0x9e, 0x2c, 0x41, 0x0a]), (r) => rows.push(r), 1);
    expect(rows).toEqual([["東京", "A"]]);
  });

  it("reads 「経度 緯度;…」 coordinate lists and skips blanks", () => {
    expect(parseCoords("139.1 35.2;139.3 35.4;")).toEqual([139.1, 35.2, 139.3, 35.4]);
    expect(parseCoords("")).toEqual([]);
  });
});

describe("matching regulations onto the road graph", () => {
  it("takes the one-way direction from the JARTIC line's travel order and honours its hours", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    // Westbound only (travel order east → west), 07:00–09:00, digitised 2 m north of the centreline.
    data.oneway.push([420, 540, 139.7622, 35.68 + 2 * M_LAT, 139.7598, 35.68 + 2 * M_LAT]);
    applyRegulations(graph, data, frame);
    const seg = graph.segments[0];
    expect(seg.onewayRule).toEqual({ dir: -1, start: 420, end: 540 });
    graph.setClock(8 * 60);
    expect(seg.oneway).toBe(-1);
    expect(graph.exits(seg.from, -1)).toEqual([]); // cannot enter eastbound at the west end
    graph.setClock(12 * 60);
    expect(seg.oneway).toBe(0);
  });

  it("ignores one-way lines that cross the street instead of running along it", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.oneway.push([0, 1440, 139.761, 35.6801, 139.761, 35.6799]);
    applyRegulations(graph, data, frame);
    expect(graph.segments[0].onewayRule).toBeNull();
  });

  it("prefers a posted limit, then an area limit, then the statutory estimate", () => {
    const posted = street(35.68);
    const zoned = street(35.682);
    const plain = street(35.684);
    const graph = new RoadGraph([posted, zoned, plain], frame);
    const data = empty();
    data.speed.push([30, 139.76, 35.68, 139.762, 35.68]);
    // ゾーン30 polygon well around the middle street (its edges are ≥ 8 m away).
    data.speedZone.push([
      30, 139.7595, 35.6815, 139.7625, 35.6815, 139.7625, 35.6825, 139.7595, 35.6825, 139.7595, 35.6815,
    ]);
    applyRegulations(graph, data, frame);
    const [a, b, c] = graph.segments;
    expect([a.limitKind, speedLimit(a)]).toEqual(["sign", 30]);
    expect([b.limitKind, speedLimit(b)]).toEqual(["zone", 30]);
    expect([c.limitKind, speedLimit(c)]).toEqual(["statutory", 60]);
  });

  it("does not put the arterial that bounds a zone inside it", () => {
    const graph = new RoadGraph([street(35.6815)], frame);
    const data = empty();
    data.speedZone.push([
      30, 139.7595, 35.6815, 139.7625, 35.6815, 139.7625, 35.6825, 139.7595, 35.6825, 139.7595, 35.6815,
    ]);
    applyRegulations(graph, data, frame);
    expect(graph.segments[0].limitKind).toBe("statutory");
  });

  it("assigns a stop line to the traffic whose left (keep-left) half it lies on", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.stopLine.push([139.7615, 35.68 + 2 * M_LAT]); // north half: eastbound lane
    data.stopLine.push([139.7605, 35.68 - 2 * M_LAT]); // south half: westbound lane
    const applied = applyRegulations(graph, data, frame);
    expect(applied.stopLines.map((l) => l.dir)).toEqual([1, -1]);
    // `at` is measured along the travel direction: the eastbound line is 3/4 of the way east.
    const len = graph.segments[0].length;
    expect(applied.stopLines[0].at / len).toBeCloseTo(0.75, 1);
    expect(applied.stopLines[1].at / len).toBeCloseTo(0.75, 1);
  });

  it("drops crosswalks that are not on a street of this graph", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.crosswalk.push([139.761, 35.68 + 6 * M_LAT, 139.761, 35.68 - 6 * M_LAT]);
    data.crosswalk.push([139.761, 35.69, 139.761, 35.6901]);
    expect(applyRegulations(graph, data, frame).crossings).toHaveLength(1);
  });
});

describe("spatial index", () => {
  it("finds the nearest piece and filters by direction", () => {
    const grid = new LineGrid<string>();
    grid.add("ew", [new Vector3(0, 0, 0), new Vector3(20, 0, 0)]);
    grid.add("ns", [new Vector3(10, 0, -10), new Vector3(10, 0, 10)]);
    expect(grid.nearest(9, 1, 5)?.owner).toBe("ns");
    const alongX = (dx: number) => Math.abs(dx) > 0.9;
    expect(grid.nearest(9, 1, 5, alongX)?.owner).toBe("ew");
    expect(grid.nearest(9, 30, 5)).toBeNull();
  });
});

describe("two-phase signals", () => {
  it("never shows green or yellow to both axes at once", () => {
    for (let t = 0; t < CYCLE * 3; t += 0.25) {
      const open = (axis: 0 | 1) => lightState(t, 17, axis) !== "red";
      expect(open(0) && open(1)).toBe(false);
    }
  });

  it("runs green → yellow → red with an all-red clearance before the cross street", () => {
    expect(lightState(0, 0, 0)).toBe("green");
    expect(lightState(21, 0, 0)).toBe("yellow");
    expect(lightState(23.5, 0, 0)).toBe("red");
    expect(lightState(23.5, 0, 1)).toBe("red");
    expect(lightState(26, 0, 1)).toBe("green");
    expect(lightState(26 - CYCLE, 0, 1)).toBe("green"); // negative times wrap
  });

  it("detects a car crossing a stop line only on a proper crossing", () => {
    const a = new Vector3(0, 0, -3);
    const b = new Vector3(0, 0, 3);
    expect(segmentsIntersect(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), a, b)).toBe(true);
    expect(segmentsIntersect(new Vector3(-2, 0, 0), new Vector3(-1, 0, 0), a, b)).toBe(false);
    expect(segmentsIntersect(new Vector3(-1, 0, 4), new Vector3(1, 0, 4), a, b)).toBe(false);
  });
});

describe("sign anchors from regulated sections (build time)", () => {
  it("puts a sign 3 m into the section and repeats it along long sections", () => {
    const line = [139.76, 35.68, 139.76 + 700 / LON_M, 35.68]; // 700 m due east
    const a = anchors(line, 300);
    expect(a.map(([lon]) => Math.round((lon - 139.76) * LON_M))).toEqual([3, 303, 603]);
    expect(a.every(([, , heading]) => heading === 90)).toBe(true);
  });

  it("reads 指定方向外進行禁止 arrows relative to the approach", () => {
    const center = [139.76, 35.68];
    const south = [139.76, 35.68 - 100 / LAT_M]; // approaching northbound
    const west = [139.76 - 50 / LON_M, 35.68];
    const north = [139.76, 35.68 + 50 / LAT_M];
    const east = [139.76 + 50 / LON_M, 35.68];
    expect(turnMask(center, south, west)).toBe(1); // left
    expect(turnMask(center, south, north)).toBe(2); // straight
    expect(turnMask(center, south, east)).toBe(4); // right
    expect(turnMask(center, south, [...west, ...north])).toBe(3); // 右折禁止 = left + straight
  });
});

describe("signs and lane rules on the road graph", () => {
  const eastbound = 90;

  it("stands a sign at the left kerb of the traffic it faces", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.signs.push([SIGN.speed, 40, 139.761, 35.68, eastbound]);
    const [sign] = applyRegulations(graph, data, frame).signs;
    expect(sign.value).toBe(40);
    // Left of eastbound traffic is north (−z); 9 m road → 4.5 + 0.7 m from the centreline.
    const centre = frame.toLocal(35.68, 139.761, frame.origin.h);
    expect(sign.pos.z - centre.z).toBeCloseTo(-5.2, 0);
    expect(sign.travel.x).toBeGreaterThan(0.99);
  });

  it("faces 車両進入禁止 only at wrong-way traffic of a one-way street", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.oneway.push([0, 1440, 139.762, 35.68, 139.76, 35.68]); // westbound only
    data.signs.push([SIGN.noEntry, 0, 139.7612, 35.68, eastbound]); // against the flow: kept
    data.signs.push([SIGN.speed, 30, 139.7608, 35.68, eastbound]); // against the flow: dropped
    data.signs.push([SIGN.speed, 30, 139.7605, 35.68, 270]); // with the flow: kept
    const signs = applyRegulations(graph, data, frame).signs;
    expect(signs.map((s) => [s.type, Math.sign(s.travel.x)])).toEqual([
      [SIGN.noEntry, 1],
      [SIGN.speed, -1],
    ]);
  });

  it("drops 車両進入禁止 on a two-way street", () => {
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.signs.push([SIGN.noEntry, 0, 139.761, 35.68, eastbound]);
    expect(applyRegulations(graph, data, frame).signs).toHaveLength(0);
  });

  it("takes yellow centre lines, lane counts and 進路変更禁止 from JARTIC sections", () => {
    const wide = street(35.68, 22);
    const plain = street(35.684, 9);
    const graph = new RoadGraph([wide, plain], frame);
    const data = empty();
    data.noOvertake.push([139.76, 35.68, 139.762, 35.68]);
    data.lanes.push([3, 139.76, 35.68, 139.762, 35.68]);
    data.noLaneChange.push([139.76, 35.68, 139.762, 35.68]);
    applyRegulations(graph, data, frame);
    const [a, b] = graph.segments;
    expect([a.noOvertake, a.lanes, a.noLaneChange]).toEqual([true, 3, true]);
    expect([b.noOvertake, b.lanes, b.noLaneChange]).toEqual([false, 1, false]);
  });

  it("treats a lane count that cannot fit one direction as the total for both", () => {
    const graph = new RoadGraph([street(35.68, 16)], frame);
    const data = empty();
    data.lanes.push([4, 139.76, 35.68, 139.762, 35.68]); // 4 × 3 m > 8 m per direction
    applyRegulations(graph, data, frame);
    expect(graph.segments[0].lanes).toBe(2);
  });
});

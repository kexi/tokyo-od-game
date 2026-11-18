import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { LocalFrame } from "../src/geo/frame";
import { steerLimit, WHEELBASE, type DriveInput } from "../src/physics/vehicle";
import type { XwRoadInput, XwSite } from "../src/world/expresswayRoads";
import { laneBand, laneCentreOffset, resolveSection } from "../src/world/laneChange";
import { emptyRegulations } from "../scripts/gameStreets";
import type { RegulationData } from "../src/world/regulations";
import { buildRoadNetwork } from "../src/world/roadNetworkData";
import { junctionClearance, planMarkings } from "../src/world/roadMarkings";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { BandDiagnostic } from "../src/world/streetBands";
import { islandCells, islandPolygons, stripsAt, SiteIndex } from "../src/world/streetBands";
import type { TrafficControl } from "../src/world/trafficControl";

// A street east along lat 35.68 from x −150 to 300 m, 40 m 幅員, in pieces at x 0 (a bend-free seam
// of two lines, as a tile's edge makes) and x 150 (a side street north); plane metres to lon/lat as
// in tests/autoDriver.test.ts.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const ll = (x: number, y: number) => [139.76 + x * LON, 35.68 + y * LAT];
const road = (x0: number, y0: number, x1: number, y1: number, width = 40, oneway: 0 | 1 = 0): RoadLine => ({
  coords: [...ll(x0, y0), ...ll(x1, y1)],
  width,
  oneway,
  kind: "local",
});
const streets = (oneway: 0 | 1 = 0) => [
  road(-150, 0, 0, 0, 40, oneway),
  road(0, 0, 150, 0, 40, oneway),
  road(150, 0, 300, 0, 40, oneway),
  road(150, 0, 150, 120, 9),
];
/** An embankment's slab along the street from x0 to x1, `y` north of its centre line, half `half` wide. */
const site = (chunk: string, x0: number, x1: number, y: number, half: number): XwSite => {
  const coords: number[] = [];
  const s: number[] = [];
  for (let x = x0; x <= x1; x += 10) {
    coords.push(...ll(x, y));
    s.push(x - x0);
  }
  return { chunk, coords, s, z: s.map(() => 11), ground: s.map(() => 10), halfWidth: half, ends: [] };
};
const xw = (sites: XwSite[]): XwRoadInput => ({ lines: [], ends: [], sites });
const build = (sites: XwSite[], regs: RegulationData | null = null, oneway: 0 | 1 = 0) => {
  const logs: BandDiagnostic[] = [];
  const net = buildRoadNetwork(
    streets(oneway),
    xw(sites),
    regs,
    frame,
    () => {},
    () => {},
    (d) => logs.push(d),
  );
  return { ...net, logs };
};
const along = (graph: RoadGraph, x: number) =>
  graph.segments.find((s) => {
    const a = s.pts[0].x;
    const b = s.pts[s.pts.length - 1].x;
    const isEastWest = Math.abs(s.pts[0].z - s.pts[s.pts.length - 1].z) < 1;
    return isEastWest && Math.min(a, b) <= x && x <= Math.max(a, b);
  })!;
/** JARTIC 車両通行帯 of 4 a way traced along the whole street. */
const fourLanes = () => {
  const r = emptyRegulations();
  r.lanes.push([4, ...ll(-150, 0), ...ll(300, 0)]);
  return r;
};
/** The lanes' centres of a segment, left of its coords, each way it is driven. */
const centresOf = (seg: Segment) => {
  const out: number[] = [];
  for (const d of [1, -1] as const) {
    const isDriven = seg.oneway === 0 || seg.oneway === d;
    if (!isDriven) continue;
    for (let lane = 0; lane < seg.lanes; lane++) out.push(d * laneCentreOffset(seg, lane));
  }
  return out;
};

describe("resolveSection with bands (P2.7 R1-2a, memo 3.3)", () => {
  it("is the section it always was without bands, with an empty list, and with an OSM median alone", () => {
    for (const evidence of [{}, { jartic: 3 }, { osm: { forward: 2, backward: 2 }, osmSeparation: 12 }])
      expect(resolveSection(30, 0, { ...evidence, bands: [] })).toEqual(resolveSection(30, 0, evidence));
  });

  it("keeps the geometry where no lane's centre lies in a band, marking it clear", () => {
    const plain = resolveSection(40, 0, { jartic: 2 });
    const banded = resolveSection(40, 0, { jartic: 2, bands: [{ right: 15, left: 19, source: "xw-site" }] });
    expect(banded.bandClass).toBe("clear");
    expect({ ...banded, bands: undefined, bandClass: undefined, bandRoom: undefined }).toEqual({
      ...plain,
      bands: undefined,
      bandClass: undefined,
      bandRoom: undefined,
    });
  });

  it("gives a band over the centre line a median that keeps every lane out of it (A)", () => {
    const band = { right: -5, left: 5, source: "xw-site" as const };
    const s = resolveSection(40, 0, { bands: [band] });
    expect(s.bandClass).toBe("A");
    expect(s.median).toBe(10);
    expect(s.unbanded).toMatchObject({ lanes: 1, carriageway: 7.5, median: 0 });
  });

  it("leaves a one-way street with a band over its centre line as it was, its class for R1-2b (B1 / C)", () => {
    const plain = resolveSection(9, 1, {});
    const s = resolveSection(9, 1, { bands: [{ right: -3, left: 3, source: "xw-site" }] });
    expect(["B1", "C"]).toContain(s.bandClass);
    expect([s.lanes, s.carriageway, s.median, s.laneWidth]).toEqual([
      plain.lanes,
      plain.carriageway,
      plain.median,
      plain.laneWidth,
    ]);
  });
});

describe("bands on the network (streetBands.ts, in the worker)", () => {
  const middle = [site("E:0", 160, 290, 0, 4)];

  it("bands the segment the site runs along and the one straight on before it (memo 3.4), and leaves the lines and every other segment as without", () => {
    const plain = build([]);
    const banded = build(middle);
    expect(banded.graph.segments.map((s) => s.pts)).toEqual(plain.graph.segments.map((s) => s.pts));
    const seg = along(banded.graph, 200);
    expect(seg.section?.bandClass).toBe("A");
    expect(seg.section?.median).toBeCloseTo(10, 2);
    // Lane 0 moves 5 m: 5 ÷ LANE_SLOPE + BAN_LEAD = 60 m before the site, which starts 10 m past
    // the junction: the band is carried on over the 150 m before it, and no further.
    const before = along(banded.graph, 100);
    expect(before.section?.bandExtended).toBe(true);
    expect(before.section?.median).toBeCloseTo(seg.section!.median, 9);
    for (const s of banded.graph.segments.filter((x) => x !== seg && x !== before)) {
      const twin = plain.graph.segments[s.id];
      expect(s.section).toEqual(twin.section);
      expect(s.bands).toBeUndefined();
    }
    expect(banded.logs.map((d) => d.event)).toEqual(["street_band_applied", "street_bands_chained"]);
  });

  it("keeps every lane's band (laneBand) of the given section clear of the site's band", () => {
    const { graph } = build(middle, fourLanes());
    const seg = along(graph, 200);
    const bands = seg.bands!;
    for (let lane = 0; lane < seg.lanes; lane++) {
      const { min, max } = laneBand(seg, lane);
      // Left of travel both ways: along the coords as is, against them mirrored.
      for (const [lo, hi] of [
        [min, max],
        [-max, -min],
      ])
        for (const b of bands) expect(hi <= b.right || lo >= b.left).toBe(true);
    }
  });

  it("leaves a one-way street it cannot fix as it was and says so (street_band_unresolved)", () => {
    const plain = build([], null, 1);
    const { graph, logs } = build(middle, null, 1);
    const seg = along(graph, 200);
    expect(seg.section?.carriageway).toBe(along(plain.graph, 200).section?.carriageway);
    expect(logs.map((d) => d.event)).toEqual(["street_band_unresolved"]);
  });

  it("never changes a JARTIC one-way's direction for a band", () => {
    const regs = fourLanes();
    regs.oneway.push([0, ...ll(150, 0), ...ll(300, 0)]);
    const plain = build([], regs);
    const banded = build(middle, regs);
    expect(along(banded.graph, 200).onewayRule).toEqual(along(plain.graph, 200).onewayRule);
  });

  it("paints no centre line on the median and an edge line either side of it", () => {
    const { graph, applied } = build(middle);
    const seg = along(graph, 200);
    const plan = planMarkings(graph, seg, applied);
    expect(plan.lines.some((l) => l.kind === "centre")).toBe(false);
    const edges = plan.lines.filter((l) => l.kind === "edge").map((l) => l.offset);
    const half = seg.section!.median / 2;
    expect(edges.some((o) => Math.abs(o - half) < 1e-9)).toBe(true);
    expect(edges.some((o) => Math.abs(o + half) < 1e-9)).toBe(true);
  });

  it("caps the carriageway at the nearer inner edge of two side bands, no lane in either (A')", () => {
    // Two decks either side, as central's 817: bands [-19.4, -10.6] and [5.8, 15.4].
    const sides = [site("N:0", 160, 290, 10.6, 3.8), site("S:0", 160, 290, -15, 3.4)];
    const { graph } = build(sides, fourLanes());
    const seg = along(graph, 200);
    expect(seg.section?.bandClass).toBe("A'");
    expect(seg.lanes).toBe(1);
    expect(seg.section?.carriageway).toBeCloseTo(11.6, 1);
    for (const c of centresOf(seg))
      for (const b of seg.bands!) expect(c <= b.right || c >= b.left).toBe(true);
  });
});

describe("the medians' islands (memo 3.6, U8)", () => {
  const middle = [site("E:0", 160, 290, 0, 4)];

  it("lie in the median outside the slab, short of the junction, and nowhere without a band's median", () => {
    const { graph } = build(middle);
    const cells = islandCells(graph, middle, frame);
    expect(cells.length).toBeGreaterThan(0);
    const seg = along(graph, 200);
    const node = seg.pts[0].x < seg.pts[seg.pts.length - 1].x ? seg.from : seg.to;
    const clear = junctionClearance(graph, node);
    const index = new SiteIndex(middle, frame);
    for (const c of cells) {
      expect(c.seg).toBe(seg.id);
      expect(Math.min(c.s0, c.s1)).toBeGreaterThanOrEqual(clear - 1e-9);
      expect(c.right).toBeGreaterThanOrEqual(-seg.section!.median / 2 - 1e-9);
      expect(c.left).toBeLessThanOrEqual(seg.section!.median / 2 + 1e-9);
      for (const s of [c.s0, (c.s0 + c.s1) / 2, c.s1]) {
        const { pos, dir } = graph.sample(seg, s);
        for (const strip of stripsAt({ x: pos.x, z: pos.z }, { x: dir.x, z: dir.z }, seg.line.width, index))
          expect(c.left <= strip.innerRight + 1e-9 || c.right >= strip.innerLeft - 1e-9).toBe(true);
      }
    }
    expect(islandCells(build([]).graph, [], frame)).toEqual([]);
  });

  it("are left out wherever PLATEAU already paves", () => {
    const { graph } = build(middle);
    const cells = islandCells(graph, middle, frame);
    expect(islandPolygons(graph, cells, frame, () => true)).toEqual([]);
    expect(islandPolygons(graph, cells, frame, () => false)).toHaveLength(cells.length);
  });
});

const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
const worldOf = (graph: RoadGraph): DriveWorld => ({
  graph,
  control: noSignals,
  turnRules: [],
  clock: gameClock(2026, 10, 1, 600),
  obstacles: [],
});
/** tests/autoDriver.test.ts's kinematic bicycle: the car obeys only the wheel and pedals. */
function drive(graph: RoadGraph, from: Vector3, to: Vector3, seconds: number) {
  const driver = new AutoDriver();
  const world = worldOf(graph);
  driver.place(from, Math.PI / 2);
  const planned = driver.plan(world, to);
  const pos = from.clone();
  let yaw = Math.PI / 2;
  let v = 0;
  let steer = 0;
  let done = false;
  const lost: string[] = [];
  const track: Vector3[] = [];
  const dt = 1 / 30;
  for (let t = 0; t < seconds && !done; t += dt) {
    const out = driver.update(dt, world, { position: pos, yaw, speed: v });
    const input: DriveInput = out.input;
    done = out.done;
    if (driver.lostWhy !== null) lost.push(driver.lostWhy);
    steer += (input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
    v = Math.max(0, v + (input.throttle * 4.16 - 0.12 * v - input.brake * 7) * dt);
    yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
    pos.x += Math.sin(yaw) * v * dt;
    pos.z += Math.cos(yaw) * v * dt;
    track.push(pos.clone());
  }
  return { planned, done, pos, lost, track };
}

describe("driving through the node between a banded segment and a plain one (memo 6 の 10)", () => {
  const at = (x: number) => frame.toLocal(...([35.68, 139.76 + x * LON] as [number, number]), 40).setY(0);

  it("drives from 4 lanes a way onto 1 (lane 0 moving about 9 m across) without leaving its lane or the road", () => {
    const sides = [site("N:0", 160, 290, 10.6, 3.8), site("S:0", 160, 290, -15, 3.4)];
    const { graph } = build(sides, fourLanes());
    const before = along(graph, -75);
    const carried = along(graph, 100);
    const after = along(graph, 200);
    expect(before.lanes).toBe(4);
    expect(carried.section?.bandExtended).toBe(true);
    expect(after.lanes).toBe(1);
    // The jump is now at x 0, 160 m before the first slab.
    const jump = Math.abs(laneCentreOffset(before, 0) - laneCentreOffset(carried, 0));
    expect(jump).toBeGreaterThan(8.5);
    const start = at(-130).add(new Vector3(0, 0, -laneCentreOffset(before, 0)));
    const { planned, done, pos, lost, track } = drive(graph, start, at(280), 120);
    expect(planned).toBe(true);
    expect(done).toBe(true);
    expect(pos.distanceTo(at(280))).toBeLessThan(8);
    expect(lost).toEqual([]);
    // Past the junction's clearance on the banded segment, never inside a band (the slabs' walls).
    for (const p of track) {
      const isOnBanded = p.x > 175 && p.x < 285;
      if (!isOnBanded) continue;
      const lateral = -p.z;
      for (const b of after.bands!) expect(lateral <= b.right || lateral >= b.left).toBe(true);
    }
  });

  it("drives a median segment's whole length and on past it, as it would a plain street", () => {
    const { graph } = build([site("E:0", 160, 290, 0, 4)], fourLanes());
    const before = along(graph, 100);
    const start = at(20).add(new Vector3(0, 0, -laneCentreOffset(before, 0)));
    const { done, lost } = drive(graph, start, at(280), 120);
    expect(done).toBe(true);
    expect(lost).toEqual([]);
  });
});

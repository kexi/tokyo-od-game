import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { network, walkUpstream as walkOsm } from "../scripts/orbis";
import { LocalFrame } from "../src/geo/frame";
import {
  crossing,
  photographs,
  planSites,
  planWarnings,
  walkUpstream,
  type OrbisSite,
} from "../src/world/orbis";
import type { OrbisEntry } from "../src/world/orbisData";
import { RoadGraph, type RoadLine } from "../src/world/roads";

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LAT = 1 / 110_950; // degrees per metre of latitude near Tokyo
const M_LON = M_LAT / Math.cos((35.68 * Math.PI) / 180);

/** East–west street along lat 35.68 from `x0` to `x1` metres east of the origin (west → east). */
const street = (x0: number, x1: number, width = 14, kind: RoadLine["kind"] = "national"): RoadLine => ({
  coords: [139.76 + x0 * M_LON, 35.68, 139.76 + x1 * M_LON, 35.68],
  width,
  oneway: 0,
  kind,
});

/** Longitude `x` metres east of the origin. */
const lon = (x: number) => 139.76 + x * M_LON;

/** A device `north` metres north of the street at `east` metres east of the origin. */
const device = (east: number, north: number, extra: Partial<OrbisEntry> = {}): OrbisEntry => ({
  id: 1,
  lon: 139.76 + east * M_LON,
  lat: 35.68 + north * M_LAT,
  bearing: 90,
  source: "oneway",
  lanes: 2,
  maxspeed: 0,
  road: "primary",
  elevated: false,
  name: "",
  signs: [],
  ...extra,
});

/** Graph of a 3 km street in 500 m segments joined end to end, its limit posted at 50 km/h. */
function longStreet(width = 14): RoadGraph {
  const lines = [0, 500, 1000, 1500, 2000, 2500].map((x) => street(x, x + 500, width));
  const g = new RoadGraph(lines, frame);
  for (const seg of g.segments) seg.limit = 50;
  return g;
}

const east = (x: number, z = 0) => new Vector3(x, 0, z);
// In the local frame +X is east and −Z north; a car in the eastbound kerb lane is north of the
// centreline (left-hand traffic), i.e. at negative z.
const pass = (site: OrbisSite, z: number, from = -3, to = 3): [Vector3, Vector3] => [
  east(site.line.x + from, z),
  east(site.line.x + to, z),
];

describe("orbis placement", () => {
  it("faces the OSM bearing and stands a gantry over two or more lanes, a pole over one", () => {
    const g = longStreet();
    const [gantry] = planSites(g, [device(2000, 0)], frame, 5000);
    expect(gantry.travel.x).toBeCloseTo(1);
    expect(gantry.kind).toBe("gantry");
    expect(gantry.lanes).toBe(2);
    const [pole] = planSites(g, [device(2000, 0, { lanes: 1, bearing: 270 })], frame, 5000);
    expect(pole.travel.x).toBeCloseTo(-1);
    expect(pole.kind).toBe("pole");
  });

  it("takes the direction from the side of the road the device stands at when OSM has none", () => {
    const g = longStreet();
    // North of an east–west street: on the left of the eastbound traffic.
    const [north] = planSites(g, [device(2000, 6, { bearing: null, source: "none" })], frame, 5000);
    expect(north.travel.x).toBeCloseTo(1);
    const [south] = planSites(g, [device(2000, -6, { bearing: null, source: "none" })], frame, 5000);
    expect(south.travel.x).toBeCloseTo(-1);
    // On the centreline: both directions.
    const both = planSites(g, [device(2000, 0, { bearing: null, source: "none" })], frame, 5000);
    expect(both.map((s) => Math.sign(s.travel.x)).toSorted()).toEqual([-1, 1]);
  });

  it("leaves out viaduct devices, and expressway devices off expressways", () => {
    const g = longStreet();
    expect(planSites(g, [device(2000, 0, { elevated: true })], frame, 5000)).toEqual([]);
    expect(planSites(g, [device(2000, 0, { road: "motorway" })], frame, 5000)).toEqual([]);
    const highway = new RoadGraph([street(0, 3000, 14, "highway")], frame);
    const [site] = planSites(highway, [device(2000, 0, { road: "motorway" })], frame, 5000);
    expect(site.threshold).toBe(40);
  });
});

describe("orbis detection", () => {
  const g = longStreet();
  const [site] = planSites(g, [device(2000, 0)], frame, 5000);

  it("fires only for the enforced direction", () => {
    const [a, b] = pass(site, -5.25);
    expect(crossing(site, a, b)).not.toBeNull();
    expect(crossing(site, b, a)).toBeNull();
    // Not crossing the line (both points before it).
    expect(crossing(site, east(site.line.x - 9, -3.5), east(site.line.x - 3, -3.5))).toBeNull();
  });

  it("knows the lane it covers: kerb lane 0, the next lane 1, nothing on the oncoming half", () => {
    // Half width 7 m, two lanes of 3.5 m on the left of travel (north for eastbound).
    expect(crossing(site, ...pass(site, -5.25))).toBe(0);
    expect(crossing(site, ...pass(site, -1.75))).toBe(1);
    expect(crossing(site, ...pass(site, 2))).toBeNull();
    expect(crossing(site, ...pass(site, -9))).toBeNull();
  });

  it("photographs 30 km/h or more over the limit on a street (limit 50 here), 40 on an expressway", () => {
    const [a, b] = pass(site, -5.25);
    expect(site.limit).toBe(50);
    expect(photographs(site, a, b, 79)).toBeNull();
    expect(photographs(site, a, b, 80)).toBe(0);
    const expressway = { ...site, threshold: 40 };
    expect(photographs(expressway, a, b, 89)).toBeNull();
    expect(photographs(expressway, a, b, 90)).toBe(0);
  });

  it("ignores a jump (respawn, warp) across the line and a car crossing it sideways", () => {
    expect(crossing(site, ...pass(site, -3.5, -30, 30))).toBeNull();
    expect(crossing(site, east(site.line.x - 1, -9), east(site.line.x + 1, -1))).toBeNull();
  });
});

describe("orbis warning signs", () => {
  it("walks the graph up the road 1.5 km and 200 m before the device, across segment ends", () => {
    const g = longStreet();
    const [site] = planSites(g, [device(2400, 0)], frame, 5000);
    const warnings = planWarnings(g, [site.entry], [site], frame, [1500, 200], 5000);
    expect(warnings.map((w) => w.before)).toEqual([1500, 200]);
    for (const w of warnings) {
      // Before the device (west of it for eastbound traffic), on the left kerb, facing travel.
      expect(site.line.x - w.pos.x).toBeCloseTo(w.before, -1);
      expect(w.pos.z).toBeLessThan(-7);
      expect(w.travel.x).toBeCloseTo(1);
    }
  });

  it("drops a sign the graph does not reach (the road ends first)", () => {
    const g = longStreet();
    const [site] = planSites(g, [device(1000, 0)], frame, 5000);
    expect(planWarnings(g, [site.entry], [site], frame, [1500, 200], 5000).map((w) => w.before)).toEqual([
      200,
    ]);
    expect(walkUpstream(g, site.seg, site.s, site.dir, 1500)).toBeNull();
  });

  it("stands OSM's sign points on the road, only those for the enforced direction", () => {
    const g = longStreet();
    const entry = device(2400, 0, {
      signs: [
        [lon(900), 35.68 + 4 * M_LAT, 90, 1500, 90],
        [lon(2200), 35.68 + 4 * M_LAT, 90, 200, 90],
        [lon(2600), 35.68 - 4 * M_LAT, 270, 200, 270], // the westbound side's: not this site's
      ],
    });
    const [site] = planSites(g, [entry], frame, 5000);
    const warnings = planWarnings(g, [site.entry], [site], frame, [1500, 200], 5000);
    expect(warnings.map((w) => [w.before, Math.round(w.pos.x / 100) * 100])).toEqual([
      [1500, 900],
      [200, 2200],
    ]);
  });

  it("places a device's far sign while the device itself is beyond the graph's reach", () => {
    const g = longStreet();
    const entry = device(2400, 0, {
      signs: [
        [lon(900), 35.68 + 4 * M_LAT, 90, 1500, 90],
        [lon(2200), 35.68 + 4 * M_LAT, 90, 200, 90],
      ],
    });
    // Reach 1300 m from the origin: the device (2.4 km east) and its near sign are out, the far one in.
    expect(planSites(g, [entry], frame)).toEqual([]);
    const warnings = planWarnings(g, [entry], [], frame);
    expect(warnings.map((w) => w.before)).toEqual([1500]);
    // Viaduct devices have no signs on the streets below.
    expect(planWarnings(g, [{ ...entry, elevated: true }], [], frame)).toEqual([]);
  });

  it("follows the straight way at an OSM way end and stops where the road turns off", () => {
    // Two ways meeting at node 2 heading east, and a side street leaving north there.
    const coords = new Map<number, [number, number]>([
      [1, [139.76, 35.68]],
      [2, [139.76 + 1000 * M_LON, 35.68]],
      [3, [139.76 + 2000 * M_LON, 35.68]],
      [4, [139.76 + 1000 * M_LON, 35.68 + 800 * M_LAT]],
    ]);
    const net = network(
      [
        { id: 10, refs: [1, 2], tags: { highway: "primary", name: "A" } },
        { id: 11, refs: [2, 3], tags: { highway: "primary", name: "A" } },
        { id: 12, refs: [4, 2], tags: { highway: "tertiary", name: "B" } },
      ],
      coords,
    );
    // Device at node 3's end of way 11, enforcing eastbound; 1.5 km up the road is on way 10.
    const points = walkOsm(net, { wi: 1, k: 0, t: 1, d: 1 }, [1500, 200, 2500]);
    expect(points.map((p) => p[3])).toEqual([200, 1500]);
    const at1500 = points[1];
    expect((at1500[0] - 139.76) / M_LON).toBeCloseTo(500, -1);
    expect(at1500[2]).toBe(90);
  });
});

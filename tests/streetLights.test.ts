import { PhysicalLightingModel } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { GRAPHICS } from "../src/device";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import {
  darkness,
  edgeFade,
  filmWetness,
  groundLux,
  kelvinRgb,
  lampOn,
  lampSpecFor,
  luminaire,
  nearestLamps,
  placeLamps,
  puddleCover,
  puddleLevel,
  rippleAmount,
  stations,
  StreetMaterial,
} from "../src/world/streetLights";

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LON = 1 / 110_950 / Math.cos((35.68 * Math.PI) / 180);

/** East–west street along lat 35.68 from x0 to x1 metres east of the origin. */
const street = (x0: number, x1: number, width: number, kind: RoadLine["kind"] = "local"): RoadLine => ({
  coords: [139.76 + x0 * M_LON, 35.68, 139.76 + x1 * M_LON, 35.68],
  width,
  oneway: 0,
  kind,
});

/** Lamps along a 400 m east–west street, split by the side they stand on. */
const sides = (width: number) => {
  const graph = new RoadGraph([street(0, 400, width)], frame);
  const lamps = placeLamps(graph);
  return { lamps, north: lamps.filter((l) => l.z < 0), south: lamps.filter((l) => l.z > 0) };
};
const nearestGap = (x: number, list: number[]) => Math.min(...list.map((y) => Math.abs(y - x)));
/** The luminaire's relative intensity `deg` degrees from the nadir. */
const atAngle = (deg: number) => luminaire(Math.cos((deg * Math.PI) / 180));

describe("lighting class by carriageway width (道路照明施設設置基準)", () => {
  it("keeps the spacing within 3.5 H and picks the arrangement by width against the mounting height", () => {
    for (const width of [5.5, 9, 16, 22, 30]) {
      const spec = lampSpecFor(width, "local");
      expect(spec).not.toBeNull();
      if (!spec) continue;
      expect(spec.spacing).toBeLessThanOrEqual(3.5 * spec.height);
      expect(spec.spacing).toBeGreaterThanOrEqual(30);
      const isOneSideAllowed = width <= spec.height;
      const isStaggerAllowed = width <= 1.5 * spec.height;
      if (spec.arrangement === "one-side") expect(isOneSideAllowed).toBe(true);
      if (spec.arrangement === "staggered") expect(isStaggerAllowed).toBe(true);
      if (spec.arrangement === "opposite") expect(isStaggerAllowed).toBe(false);
    }
  });

  it("gives narrow streets small, sparser 防犯灯 and the elevated 首都高 none", () => {
    const residential = lampSpecFor(4.3, "narrow");
    const street9 = lampSpecFor(9, "local");
    expect(residential?.height).toBeLessThan(7);
    expect(residential?.candela).toBeLessThan(street9?.candela ?? 0);
    expect(residential?.spacing).toBeGreaterThan(street9?.spacing ?? Infinity);
    expect(lampSpecFor(22, "highway")).toBeNull();
  });
});

describe("stations along a segment", () => {
  it("spreads lamps evenly with half a spacing at each end, so segments join about one spacing apart", () => {
    const s = stations(140, 35);
    expect(s).toHaveLength(4);
    expect(s[0]).toBeCloseTo(17.5);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeCloseTo(35);
  });

  it("offsets the other side of a staggered street by half a spacing", () => {
    expect(stations(140, 35, true)).toEqual([0, 35, 70, 105, 140]);
  });

  it("puts one lamp mid-way on a short segment and none on a stub", () => {
    expect(stations(20, 35)).toEqual([10]);
    expect(stations(8, 35)).toEqual([]);
  });
});

describe("placeLamps", () => {
  it("lights a 9 m street from one side only, every 35 m, the poles just behind the kerb", () => {
    const { lamps, north, south } = sides(9);
    expect(Math.min(north.length, south.length)).toBe(0);
    const xs = lamps.map((l) => l.x).toSorted((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(400 / Math.round(400 / 35), 0);
    for (const l of lamps) {
      expect(Math.abs(l.z)).toBeGreaterThan(4.5);
      expect(Math.abs(l.z)).toBeLessThan(6);
      // The arm reaches over the carriageway.
      expect(Math.sign(l.az)).toBe(-Math.sign(l.z));
    }
  });

  it("staggers a 16 m street: both sides, each lamp half way between the two opposite it", () => {
    const { north, south } = sides(16);
    expect(north.length).toBeGreaterThan(5);
    expect(south.length).toBeGreaterThan(5);
    const a = north.map((l) => l.x).toSorted((p, q) => p - q);
    const b = south.map((l) => l.x).toSorted((p, q) => p - q);
    for (const x of a.slice(1, -1)) expect(nearestGap(x, b)).toBeCloseTo(400 / Math.round(400 / 38) / 2, 0);
  });

  it("pairs the lamps of a 22 m street across it (向き合わせ)", () => {
    const { north, south } = sides(22);
    expect(north.length).toBe(south.length);
    for (const l of north) expect(south.some((m) => Math.abs(m.x - l.x) < 0.5)).toBe(true);
  });

  it("keeps poles out of a crossing street's carriageway", () => {
    const cross: RoadLine = {
      coords: [139.76 + 200 * M_LON, 35.68 - 150 / 110_950, 139.76 + 200 * M_LON, 35.68 + 150 / 110_950],
      width: 16,
      oneway: 0,
      kind: "local",
    };
    const graph = new RoadGraph([street(0, 400, 16), cross], frame);
    const crossX = graph.segments[1].pts[0].x;
    // Its own lamps stand 0.6 m behind its kerbs (8.6 m from its centreline); none inside.
    for (const l of placeLamps(graph)) expect(Math.abs(l.x - crossX) < 8 && Math.abs(l.z) < 150).toBe(false);
  });
});

describe("photometry", () => {
  it("is a cut-off batwing: stronger towards 60–70° than at the nadir, nothing above 80°", () => {
    expect(atAngle(0)).toBeCloseTo(1);
    expect(atAngle(65)).toBeGreaterThan(atAngle(0));
    expect(atAngle(82)).toBe(0);
    expect(atAngle(95)).toBe(0);
  });

  it("lights a 35 m one-sided layout with an illuminance uniformity near the 0.4 the standard asks", () => {
    const spec = lampSpecFor(9, "local");
    if (!spec) throw new Error("no spec");
    // Two neighbouring lamps; the darkest point is half way between them.
    const at = (d: number) => groundLux(spec, d) + groundLux(spec, spec.spacing - d);
    const samples = Array.from({ length: 36 }, (_, i) => at((i * spec.spacing) / 35));
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    expect(Math.min(...samples) / mean).toBeGreaterThan(0.3);
    expect(groundLux(spec, 0)).toBeGreaterThan(10);
    expect(groundLux(spec, 0)).toBeLessThan(30);
  });

  it("switches lamps on through dusk one by one, earlier under rain clouds", () => {
    expect(lampOn(darkness(0.1, false), 0.2)).toBe(0);
    expect(lampOn(darkness(1, false), 0.32)).toBe(1);
    expect(lampOn(darkness(0.2, true), 0.25)).toBeGreaterThan(lampOn(darkness(0.2, false), 0.25));
  });

  it("colours LED 4000 K warm white and 高圧ナトリウム 2100 K orange", () => {
    const [r4, g4, b4] = kelvinRgb(4000);
    const [r2, g2, b2] = kelvinRgb(2100);
    expect(r4).toBe(1);
    expect(g4).toBeGreaterThan(0.75);
    expect(b4).toBeLessThan(g4);
    expect(r2).toBe(1);
    expect(g2).toBeLessThan(0.6);
    expect(b2).toBeLessThan(0.15);
  });
});

describe("wet surfaces", () => {
  it("is dry with no water and soaked, with puddles in the hollows, after rain", () => {
    expect(filmWetness(0, 1)).toBe(0);
    expect(puddleCover(0, 2)).toBe(0);
    expect(filmWetness(1, 0.55)).toBe(1);
    expect(puddleCover(1, 1.0)).toBe(1);
    expect(puddleCover(1, 0.5)).toBe(0);
  });

  it("lets the puddles in the gutter outlast the wet film while drying", () => {
    const average = 0.55;
    const gutter = 1.25;
    // Somewhere on the way down from soaked, average spots are dry but the gutter still holds water.
    const drying = Array.from({ length: 101 }, (_, i) => 1 - i / 100);
    const dryAt = drying.find((w) => filmWetness(w, average) === 0) ?? 0;
    const goneAt = drying.find((w) => puddleCover(w, gutter) === 0) ?? 0;
    expect(dryAt).toBeGreaterThan(goneAt);
    expect(puddleCover(dryAt, gutter)).toBe(1);
  });

  it("raises the water line steadily with wetness", () => {
    for (let w = 0.05; w < 1; w += 0.05) expect(puddleLevel(w + 0.05)).toBeLessThanOrEqual(puddleLevel(w));
  });

  it("rings the puddles more densely in heavier rain", () => {
    expect(rippleAmount(0)).toBe(0);
    expect(rippleAmount(8)).toBeGreaterThan(rippleAmount(1));
    expect(rippleAmount(50)).toBe(1);
  });
});

describe("nearest-lamp selection", () => {
  it("returns the n nearest live lamps, nearest first, and the distance of the first one left out", () => {
    const xs = new Float32Array([50, 10, 30, 20, 40, 5]);
    const zs = new Float32Array(6);
    const live = new Uint8Array([1, 1, 1, 1, 1, 0]);
    const out = new Int32Array(3);
    const dist = new Float32Array(3);
    const { count, cutoff } = nearestLamps(xs, zs, live, 0, 0, 3, out, dist);
    expect(count).toBe(3);
    expect([...out]).toEqual([1, 3, 2]);
    expect(cutoff).toBe(40);
    // Faded to nothing by the time a lamp would drop out of the set.
    expect(edgeFade(dist[0], cutoff)).toBe(1);
    expect(edgeFade(cutoff, cutoff)).toBe(0);
  });

  it("matches a full sort on a random field", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = 500;
    const xs = Float32Array.from({ length: n }, () => rand() * 1000);
    const zs = Float32Array.from({ length: n }, () => rand() * 1000);
    const live = Uint8Array.from({ length: n }, () => (rand() < 0.9 ? 1 : 0));
    const out = new Int32Array(16);
    const dist = new Float32Array(16);
    const { cutoff } = nearestLamps(xs, zs, live, 500, 500, 16, out, dist);
    const sorted = [...xs.keys()]
      .filter((i) => live[i])
      .map((i) => ({ i, d: Math.hypot(xs[i] - 500, zs[i] - 500) }))
      .toSorted((a, b) => a.d - b.d);
    expect([...out]).toEqual(sorted.slice(0, 16).map((e) => e.i));
    expect(cutoff).toBeCloseTo(sorted[16].d, 4);
  });
});

/** 画質 › 雨の路面, as the settings screen sets it. */
const withWetRoads = (wetRoads: "off" | "simple" | "full") =>
  GRAPHICS.set({ ...GRAPHICS.settings, wetRoads });

describe("StreetMaterial", () => {
  it("puts the water in the colour, roughness and normal stages and the lamps in its lighting", () => {
    withWetRoads("full");
    const m = new StreetMaterial("asphalt", { hasStreet: true });
    expect(m.colorNode).not.toBeNull();
    expect(m.roughnessNode).not.toBeNull();
    expect(m.normalNode).not.toBeNull();
    expect(m.setupLightingModel()).toBeInstanceOf(PhysicalLightingModel);
    expect(m.customProgramCacheKey()).toContain("street-asphalt-true-full");
  });

  it("compiles no water for 雨の路面 なし and brings it back when switched on", () => {
    withWetRoads("full");
    const m = new StreetMaterial("paving");
    const version = m.version;
    withWetRoads("off");
    expect(m.colorNode).toBeNull();
    expect(m.normalNode).toBeNull();
    expect(m.version).toBeGreaterThan(version);
    expect(m.customProgramCacheKey()).toContain("street-paving-false-off");
    withWetRoads("simple");
    expect(m.colorNode).not.toBeNull();
    expect(m.customProgramCacheKey()).toContain("-simple");
  });

  it("shares one graph between materials of a kind, and keeps kinds apart", () => {
    withWetRoads("full");
    const white = new StreetMaterial("paint", { hasStreet: true, color: 0xffffff });
    const yellow = new StreetMaterial("paint", { hasStreet: true, color: 0xf2b705 });
    const kerb = new StreetMaterial("concrete");
    expect(yellow.colorNode).toBe(white.colorNode);
    expect(kerb.colorNode).not.toBe(white.colorNode);
    expect(kerb.customProgramCacheKey()).not.toEqual(white.customProgramCacheKey());
  });
});

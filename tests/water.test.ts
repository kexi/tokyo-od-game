import { describe, expect, it } from "vitest";
import { jstHourOfYear, parseTideTable, TK_DATUM } from "../src/world/tide";
import {
  applyGauges,
  chooseLevel,
  DECK_CLEARANCE,
  deckHeights,
  coverage,
  dilate,
  isClipEdge,
  rasterize,
  triangulate,
  waterPolygons,
  type Gauge,
} from "../src/world/waterGeometry";

// Tile space has y down: clockwise on screen is the MVT outer-ring winding.
const square = (x0: number, y0: number, x1: number, y1: number, outer = true) => {
  const pts = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return outer ? pts : pts.toReversed();
};

const gauge = (g: Partial<Gauge>): Gauge => ({
  name: "g",
  river: "r",
  lat: 0,
  lon: 0,
  level: 0,
  range: 1.5,
  tidal: true,
  surveyed: null,
  ...g,
});

/** A day of the JMA tide-table text: 24 hourly heights, the date and station, filler. */
const line = (yy: number, mm: number, dd: number, cm: number[]) =>
  cm.map((v) => String(v).padStart(3)).join("") +
  `${String(yy).padStart(2)}${String(mm).padStart(2)}${String(dd).padStart(2)}TK` +
  "9999".repeat(14);

describe("water polygons from GSI waterarea tiles", () => {
  it("puts a tile's rings in global z16 units with their holes", () => {
    const polys = waterPolygons(
      [square(1024, 1024, 3072, 3072), square(1800, 1800, 2200, 2200, false)],
      10,
      20,
      4096,
    );
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(2);
    expect(Math.min(...polys[0][0].filter((_, i) => i % 2 === 0))).toBeCloseTo(10.25, 9);
    expect(Math.max(...polys[0][0].filter((_, i) => i % 2 === 1))).toBeCloseTo(20.75, 9);
  });

  it("triangulates around a hole, every triangle facing up in the game frame", () => {
    const [poly] = waterPolygons(
      [square(0, 0, 4096, 4096), square(1024, 1024, 3072, 3072, false)],
      0,
      0,
      4096,
    );
    const tris = triangulate(poly);
    const pts = poly.flat();
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((k) => [pts[k * 2], pts[k * 2 + 1]]);
      // Seen from above (x east, z south), up-facing triangles turn anticlockwise: negative here.
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      expect(cross).toBeLessThan(0);
      area += -cross / 2;
    }
    // The ring minus the hole: 1 − 0.25 of the tile.
    expect(area).toBeCloseTo(0.75, 9);
  });

  it("rasterizes by pixel centres with holes left dry", () => {
    const [poly] = waterPolygons(
      [square(0, 0, 4096, 4096), square(1024, 1024, 3072, 3072, false)],
      0,
      0,
      4096,
    );
    const mask = rasterize([poly], 0, 0, 1, 8);
    const wet = mask.reduce((a, v) => a + v, 0);
    expect(wet).toBe(64 - 16);
    expect(mask[3 * 8 + 3]).toBe(0);
    expect(mask[0]).toBe(1);
  });

  it("covers shore pixels by the share that is water", () => {
    // Water x < 2.5 pixels of an 8-pixel raster.
    const [poly] = waterPolygons([square(0, 0, 1280, 4096)], 0, 0, 4096);
    const cov = coverage([poly], 0, 0, 1, 8);
    expect(cov[3 * 8 + 1]).toBe(255);
    expect(cov[3 * 8 + 2]).toBeCloseTo(128, -1);
    expect(cov[3 * 8 + 3]).toBe(0);
  });

  it("grows the ground's cut-out a pixel past the shore", () => {
    const size = 8;
    const mask = new Uint8Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < 5; i++) mask[j * size + i] = 255; // water x < 5
    const out = dilate(mask, size);
    expect(out[3 * size + 5]).toBe(255); // one pixel onto the land
    expect(out[3 * size + 6]).toBe(0);
    expect(out[3 * size + 0]).toBe(255);
  });

  it("tells clip edges on the tile square from shores", () => {
    expect(isClipEdge(5, 7.2, 5, 7.6, 5, 7)).toBe(true);
    expect(isClipEdge(5.3, 8, 5.9, 8, 5, 7)).toBe(true);
    expect(isClipEdge(5.3, 7.2, 5.9, 7.4, 5, 7)).toBe(false);
  });
});

describe("water surface level", () => {
  const MEAN = 0.059;

  it("gives tidal water the mean tide, not the moment of the survey", () => {
    // 隅田川 at 両国: DEM5A caught the river at −0.52 m (a low tide).
    const choice = chooseLevel({ surveyed: [-0.52, -0.53, -0.5, 1.4], filled: [], land: [] }, MEAN);
    expect(choice).toMatchObject({ level: MEAN, tide: 1, source: "tide" });
    expect(choice.surveyed).toBeCloseTo(-0.52, 2);
  });

  it("keeps water held above the tide at its surveyed surface", () => {
    // 千鳥ヶ淵: DEM5A 16.7–17.9 m on the moat.
    const choice = chooseLevel({ surveyed: [17.0, 17.1, 17.3, 16.7, 17.9], filled: [], land: [20] }, MEAN);
    expect(choice.tide).toBe(0);
    expect(choice.level).toBeCloseTo(17.0, 5);
  });

  it("finds the open sea where DEM5A has nothing and the filled DEM is 0", () => {
    const choice = chooseLevel({ surveyed: [], filled: [0, 0, 0, 0], land: [] }, MEAN);
    expect(choice).toMatchObject({ level: MEAN, tide: 1 });
  });

  it("treats blank water between lowland banks as tidal", () => {
    // 隅田川 at 駒形: DEM5A blank on the river, DEM10B fills it at +2.2 m, banks from +1.54 m.
    const choice = chooseLevel({ surveyed: [], filled: [2.2, 2.2, 2.2], land: [1.54, 1.6, 2.4, 3.0] }, MEAN);
    expect(choice).toMatchObject({ level: MEAN, tide: 1, source: "tide" });
  });

  it("sets a blank canal below the lowest bank rather than at the sea", () => {
    // 旧中川: DEM5A blank on the water, banks sloping to −1.54 m, DEM10B filled with 0.
    const choice = chooseLevel({ surveyed: [], filled: [0, 0, 0], land: [-1.54, -0.76, 1.0, 3.6] }, MEAN);
    expect(choice.tide).toBe(0);
    expect(choice.level).toBeLessThan(-1.54);
  });

  const bay = { mean: MEAN, range: 1.52, still: MEAN };

  it("raises tidal water to a gauge's typical level next to it, fading with distance", () => {
    // 神田川 at 飯田橋: typical +0.73 m, daily range ~1 m.
    const base = chooseLevel({ surveyed: [0.17, 0.18, 0.2], filled: [], land: [] }, MEAN);
    const iidabashi = gauge({ level: 0.73, range: 1.0 });
    const at = applyGauges(base, [{ gauge: iidabashi, metres: 0 }], bay);
    expect(at.level).toBeCloseTo(0.73, 5);
    expect(at.tide).toBeCloseTo(1.0 / 1.52, 5);
    const far = applyGauges(base, [{ gauge: iidabashi, metres: 1200 }], bay);
    expect(far.level).toBeGreaterThan(MEAN);
    expect(far.level).toBeLessThan(0.73);
  });

  it("shifts a held river's survey by the gauge's (typical − surveyed)", () => {
    // 田島橋 (神田川, 高田馬場): typical +8.52 m where DEM5A reads +8.66 m.
    const base = chooseLevel({ surveyed: [8.7, 8.71, 8.75], filled: [], land: [] }, MEAN);
    const tajima = gauge({ level: 8.52, range: 0.1, tidal: false, surveyed: 8.66 });
    const at = applyGauges(base, [{ gauge: tajima, metres: 0 }], bay);
    expect(at.level).toBeCloseTo(8.7 - 0.14, 5);
    expect(at.tide).toBe(0);
  });

  it("ignores a gauge on other water (a moat beside the river)", () => {
    const base = chooseLevel({ surveyed: [5.0, 5.1, 5.2], filled: [], land: [] }, MEAN);
    const river = gauge({ level: 0.73 });
    expect(applyGauges(base, [{ gauge: river, metres: 200 }], bay)).toEqual(base);
  });
});

describe("bridge decks", () => {
  it("joins the banks without a step and clears the water in the middle", () => {
    const h = deckHeights(120, 2, 3.0, 2.2, 0.06);
    expect(h).toHaveLength(61);
    expect(h[0]).toBeCloseTo(3.0, 9);
    expect(h[60]).toBeCloseTo(2.2, 9);
    for (const v of h) expect(v).toBeGreaterThanOrEqual(2.2 - 1e-9);
    // Arched: the middle stands above the straight line between the banks.
    expect(h[30]).toBeGreaterThan(2.6);
  });

  it("ramps up from low banks to the clearance, no steeper than 8 %", () => {
    const h = deckHeights(60, 2, 0.4, 0.4, 0.06);
    expect(Math.max(...h)).toBeGreaterThanOrEqual(0.06 + DECK_CLEARANCE - 1e-9);
    for (let k = 1; k < h.length; k++) expect(Math.abs(h[k] - h[k - 1]) / 2).toBeLessThanOrEqual(0.08 + 0.02);
  });
});

describe("JMA tide table (東京 TK)", () => {
  it("reads hourly heights above the datum as T.P. metres", () => {
    const days = Array.from({ length: 365 }, (_, d) =>
      line(
        26,
        1,
        1 + (d % 28),
        Array.from({ length: 24 }, (_unused, h) => 100 + h),
      ),
    );
    const table = parseTideTable(days.join("\n"));
    expect(table?.year).toBe(2026);
    expect(table?.hourly).toHaveLength(365 * 24);
    expect(table?.hourly[5]).toBeCloseTo(1.05 + TK_DATUM, 5);
  });

  it("counts the hours of the year in JST", () => {
    // 2026-01-01 00:30 JST is 2025-12-31 15:30 UTC.
    const at = jstHourOfYear(new Date(Date.UTC(2025, 11, 31, 15, 30)));
    expect(at).toEqual({ year: 2026, hours: 0.5 });
  });
});

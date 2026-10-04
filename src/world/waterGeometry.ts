import { ShapeUtils, Vector2 } from "three";
import { polygonsOf } from "./pavements";

/**
 * Pure parts of the water layer (GSI 地理院ベクトルタイル `waterarea`): polygons in global tile
 * units, triangulation, rasters for point tests and the terrain cut-out, the choice of surface
 * level, and the profile of a bridge deck over the water. No three.js scene objects, no fetches.
 */

/** Zoom of the GSI vector tiles the water comes from (the same tiles as the roads). */
export const WATER_ZOOM = 16;

/**
 * A polygon in global z16 tile units (Web Mercator: x east, y south, 1 = one z16 tile): the outer
 * ring first, then its holes, each flat [x0, y0, x1, y1, …] without the closing repeat. As in MVT,
 * water is on the right of every edge (outer rings clockwise with y down, holes anticlockwise).
 */
export type WaterPolygon = number[][];

type Pt = { x: number; y: number };

/** MVT rings of one tile → water polygons in global units, clipped to the tile square. */
export function waterPolygons(rings: Pt[][], tileX: number, tileY: number, extent: number): WaterPolygon[] {
  return polygonsOf(rings, extent).map((poly) =>
    poly.map((ring) => ring.flatMap((p) => [tileX + p.x / extent, tileY + p.y / extent])),
  );
}

/** Triangles of a polygon as indices into its rings' points taken in order (outer, then holes). */
export function triangulate(poly: WaterPolygon): number[] {
  const rings = poly.map((ring) => {
    const pts: Vector2[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) pts.push(new Vector2(ring[i], ring[i + 1]));
    return pts;
  });
  if (rings.length === 0 || rings[0].length < 3) return [];
  const flat = rings.flat();
  const out: number[] = [];
  for (const [a, b, c] of ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
    // Wind each triangle to face up in the game frame (x east, z south, y up): with y down in tile
    // space, a triangle is anticlockwise seen from above when its shoelace sum is negative.
    const pa = flat[a];
    const pb = flat[b];
    const pc = flat[c];
    const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if (Math.abs(cross) < 1e-18) continue;
    if (cross < 0) out.push(a, b, c);
    else out.push(a, c, b);
  }
  return out;
}

/**
 * Even–odd raster of the polygons over the square [x0, x0 + span]² (global units), `size` pixels a
 * side, 1 where a pixel's centre is water. Scanline fill: each row crosses every edge once at most.
 */
export function rasterize(
  polys: WaterPolygon[],
  x0: number,
  y0: number,
  span: number,
  size: number,
): Uint8Array {
  const out = new Uint8Array(size * size);
  const px = span / size;
  const xs: number[] = [];
  for (let j = 0; j < size; j++) {
    const y = y0 + (j + 0.5) * px;
    xs.length = 0;
    for (const poly of polys) {
      for (const ring of poly) {
        const n = ring.length / 2;
        for (let i = 0, k = n - 1; i < n; k = i++) {
          const ay = ring[i * 2 + 1];
          const by = ring[k * 2 + 1];
          const isCrossing = ay > y !== by > y;
          if (!isCrossing) continue;
          const ax = ring[i * 2];
          const bx = ring[k * 2];
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * size;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel centres x0 + (i + 0.5)·px inside [xa, xb).
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / px - 0.5));
      const i1 = Math.min(size - 1, Math.ceil((xs[k + 1] - x0) / px - 0.5) - 1);
      for (let i = i0; i <= i1; i++) out[row + i] = 1;
    }
  }
  return out;
}

/**
 * Anti-aliased raster (0–255 = share of the pixel that is water), `sub` scanlines per pixel with exact
 * horizontal coverage. The ground's cut-out is drawn from it with bilinear filtering and a 50 %
 * threshold, which puts the cut on the shore to a fraction of a pixel instead of in 1 m steps.
 */
export function coverage(
  polys: WaterPolygon[],
  x0: number,
  y0: number,
  span: number,
  size: number,
  sub = 4,
): Uint8Array {
  const px = span / size;
  const acc = new Float32Array(size * size);
  const xs: number[] = [];
  for (let j = 0; j < size; j++) {
    for (let r = 0; r < sub; r++) {
      const y = y0 + (j + (r + 0.5) / sub) * px;
      xs.length = 0;
      for (const poly of polys) {
        for (const ring of poly) {
          const n = ring.length / 2;
          for (let i = 0, k = n - 1; i < n; k = i++) {
            const ay = ring[i * 2 + 1];
            const by = ring[k * 2 + 1];
            if (ay > y === by > y) continue;
            xs.push(ring[i * 2] + ((y - ay) / (by - ay)) * (ring[k * 2] - ring[i * 2]));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // The run [xa, xb) in pixel units, clamped to the raster.
        const xa = Math.max(0, (xs[k] - x0) / px);
        const xb = Math.min(size, (xs[k + 1] - x0) / px);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.min(size - 1, Math.floor(xb));
        const row = j * size;
        if (ia === ib) {
          acc[row + ia] += (xb - xa) / sub;
          continue;
        }
        acc[row + ia] += (ia + 1 - xa) / sub;
        for (let i = ia + 1; i < ib; i++) acc[row + i] += 1 / sub;
        if (ib < size) acc[row + ib] += (xb - ib) / sub;
      }
    }
  }
  const out = new Uint8Array(size * size);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(Math.min(1, acc[k]) * 255);
  return out;
}

/**
 * Grow the water by one pixel (each pixel takes the most water of itself and its 4 neighbours), so
 * the ground's cut-out reaches just past the shore wall: from the water the wall's face then stands
 * in front of the cut, and from the land the gap shows the wall's own top. Why not cut inside the
 * wall (erode): on a steep bank the ground left over the water is a sloped lip that shows above the
 * wall (神田川 at 御茶ノ水).
 */
export function dilate(mask: Uint8Array, size: number): Uint8Array {
  const out = mask.slice();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let v = mask[k];
      if (i > 0) v = Math.max(v, mask[k - 1]);
      if (i < size - 1) v = Math.max(v, mask[k + 1]);
      if (j > 0) v = Math.max(v, mask[k - size]);
      if (j < size - 1) v = Math.max(v, mask[k + size]);
      out[k] = v;
    }
  }
  return out;
}

/**
 * Is the edge from a to b (global units) part of the tile square's border? Such edges come from
 * clipping the polygon at the tile, not from a shore, and get no wall.
 */
export function isClipEdge(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tileX: number,
  tileY: number,
): boolean {
  const eps = 1e-7;
  for (const v of [tileX, tileX + 1]) if (Math.abs(ax - v) < eps && Math.abs(bx - v) < eps) return true;
  for (const v of [tileY, tileY + 1]) if (Math.abs(ay - v) < eps && Math.abs(by - v) < eps) return true;
  return false;
}

/**
 * Tide in Tokyo (東京・晴海, JMA station TK): heights in T.P. metres. The tidal reaches of the rivers
 * and canals follow it; water whose surveyed surface lies outside this band is held by locks or
 * weirs (the 江東 inner rivers at A.P. −1 m, the moats, the upper rivers) and keeps its own level.
 */
export const TIDE = {
  /** The band a surveyed tidal water surface falls in (2026 predictions: −1.35 … +0.97 m). */
  bandLow: -1.25,
  bandHigh: 1.0,
};

export type LevelChoice = {
  /** Orthometric height (T.P. m) of the still water surface, without the tide. */
  level: number;
  /** How much of the bay's tide the water follows: 1 in the bay, less up a river, 0 when held. */
  tide: number;
  source: "tide" | "dem" | "bank" | "station" | "unknown";
  /** The surveyed surface (DEM5A) the choice started from, when there was one. */
  surveyed: number | null;
};

/** The p-quantile (0…1) of values, by sorting a copy (nearest rank). */
export function quantile(values: readonly number[], p: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const k = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[k];
}

/** DEM samples around a point of a water polygon (T.P. m), split by what they fall on. */
export type LevelSamples = {
  /** DEM5A as surveyed, at water pixels (empty where DEM5A has no value on the water). */
  surveyed: readonly number[];
  /** The game's filled DEM at water pixels (DEM10B or 0 where DEM5A has none: the open sea). */
  filled: readonly number[];
  /** DEM5A on the land just around the water. */
  land: readonly number[];
};

/**
 * Surface level near a point of a water polygon from the DEM alone.
 * - GSI's laser DEM (DEM5A) keeps the water surface as it was during the survey (隅田川 at 両国
 *   −0.52 m, 日本橋川 +0.15 m, 千鳥ヶ淵 +17.0 m), so a low quantile of the surveyed water pixels is
 *   the surveyed surface, robust to bank pixels that fall inside the polygon.
 * - A surveyed surface inside the tidal band is tidal water: it gets the mean tide level instead of
 *   the moment of the survey (the shader adds the predicted tide). Outside the band the surveyed
 *   surface is held by a lock or weir, or is a pond or an upper river, and is kept.
 * - DEM5A is often blank on wide water (隅田川 at 駒形, the sea), and DEM10B fills it with values
 *   near the banks', so blank water is judged by its shores: the sea when no land is near, tidal
 *   between lowland banks, and otherwise 1.5 m below the lowest bank nearby (旧中川 in the 江東
 *   zero-metre zone, beside banks sloping down to −1.5 m, is held near A.P. −1 m by locks).
 */
const inBand = (h: number) => h >= TIDE.bandLow && h <= TIDE.bandHigh;

export function chooseLevel(samples: LevelSamples, meanTide: number): LevelChoice {
  const isSurveyed = samples.surveyed.length >= 3;
  if (isSurveyed) {
    const surface = quantile(samples.surveyed, 0.2);
    if (inBand(surface)) return { level: meanTide, tide: 1, source: "tide", surveyed: surface };
    return { level: surface, tide: 0, source: "dem", surveyed: surface };
  }
  const filled = samples.filled.length >= 3 ? quantile(samples.filled, 0.2) : Number.NaN;
  const hasLand = samples.land.length > 0;
  if (!hasLand) {
    // Open water out of sight of land: the sea when the filled DEM is at sea level; mid-river
    // (DEM10B's fill there is the banks') it takes after the shore (see fillUnknown).
    const isSea = !Number.isFinite(filled) || inBand(filled);
    if (isSea) return { level: meanTide, tide: 1, source: "tide", surveyed: null };
    return { level: Number.NaN, tide: Number.NaN, source: "unknown", surveyed: null };
  }
  const land = quantile(samples.land, 0.1);
  // Lowland shores (embankments up to T.P. +4 m: 隅田川 at 駒形, blank in DEM5A, banks at +1.5 m)
  // hold tidal water, except land already below sea level, the 江東 zero-metre zone, whose inner
  // rivers are held below it by locks.
  const isTidalShore = land >= 0 && land < LOWLAND;
  if (isTidalShore) return { level: meanTide, tide: 1, source: "tide", surveyed: null };
  return { level: land - 1.5, tide: 0, source: "bank", surveyed: null };
}

/**
 * Points of a ring that chooseLevel could not judge (mid-river, where a tile edge cuts the water)
 * take the choice of the nearest judged point along the ring; a ring with none is the sea's.
 */
export function fillUnknown(choices: LevelChoice[], meanTide: number): LevelChoice[] {
  const n = choices.length;
  const known = choices.map((c) => c.source !== "unknown");
  if (!known.some(Boolean))
    return choices.map(() => ({ level: meanTide, tide: 1, source: "tide", surveyed: null }));
  return choices.map((c, i) => {
    if (known[i]) return c;
    for (let d = 1; d < n; d++) {
      if (known[(i + d) % n]) return choices[(i + d) % n];
      if (known[(i - d + n) % n]) return choices[(i - d + n) % n];
    }
    return c;
  });
}

/** Banks lower than this (T.P. m) are the tidal lowland's, when DEM5A has no water surface. */
const LOWLAND = 4;

/** A water-level gauge (水位観測所) with its typical level, from public/data/water-levels.json. */
export type Gauge = {
  name: string;
  river: string;
  lat: number;
  lon: number;
  /** Typical (median) water level, T.P. m. */
  level: number;
  /** Mean daily range (m); with `tidal`, how far the tide reaches up the river. */
  range: number;
  tidal: boolean;
  /** DEM5A's surveyed surface at the gauge (T.P. m), or null where it has none. */
  surveyed: number | null;
};

/**
 * The bay the gauges are compared with: its mean and mean daily range over the gauges' sample
 * days (an offset is a gauge's typical level minus that mean), and the still level tidal water is
 * built at (the year's mean, which the predicted tide is added to).
 */
export type Bay = { mean: number; range: number; still: number };

/** How far a gauge's reading is carried along the water (m), and how far off a level may be. */
export const GAUGE_REACH = 1500;
const SAME_WATER = 2.5;

/**
 * Correct a DEM-based level with the gauges nearby (observations win over the survey's moment):
 * - Gauges more than SAME_WATER off the local surface are another river (a moat beside 神田川, a
 *   tributary above its weir) and are ignored.
 * - Near a tidal gauge the water is tidal, at the bay's mean plus the gauge's offset (神田川 at 飯田橋
 *   stands +0.67 m above the bay's mean) and with the gauge's share of the bay's daily range.
 * - Near gauges on held water, the surveyed surface is shifted by each gauge's (typical − surveyed),
 *   since a narrow channel's DEM5A pixels mix in the banks and read high by up to ~1 m.
 * Each gauge weighs 1 − (d / GAUGE_REACH)², and the correction fades out where the weights sum < 1.
 */
export function applyGauges(
  choice: LevelChoice,
  near: ReadonlyArray<{ gauge: Gauge; metres: number }>,
  bay: Bay,
): LevelChoice {
  const local = choice.surveyed ?? choice.level;
  const usable = near.filter(
    ({ gauge, metres }) => metres < GAUGE_REACH && Math.abs(gauge.level - local) < SAME_WATER,
  );
  const weigh = (list: typeof usable) =>
    list.map(({ gauge, metres }) => ({ gauge, w: 1 - (metres / GAUGE_REACH) ** 2 }));
  const tidal = weigh(usable.filter(({ gauge }) => gauge.tidal));
  if (tidal.length > 0) {
    const sum = tidal.reduce((a, { w }) => a + w, 0);
    const reach = Math.min(1, sum);
    const offset = tidal.reduce((a, { gauge, w }) => a + w * (gauge.level - bay.mean), 0) / sum;
    const share =
      tidal.reduce((a, { gauge, w }) => a + w * Math.min(1.2, Math.max(0.2, gauge.range / bay.range)), 0) /
      sum;
    const base = choice.tide > 0 ? 1 : share;
    return {
      level: bay.still + offset * reach,
      tide: base + (share - base) * reach,
      source: "station",
      surveyed: choice.surveyed,
    };
  }
  const held = weigh(usable.filter(({ gauge }) => !gauge.tidal && gauge.surveyed !== null));
  if (held.length === 0 || choice.surveyed === null) return choice;
  const sum = held.reduce((a, { w }) => a + w, 0);
  const shift =
    held.reduce((a, { gauge, w }) => a + w * (gauge.level - (gauge.surveyed ?? gauge.level)), 0) / sum;
  // Held water: the gauge decides it is not tidal even where the survey fell inside the tidal band
  // (古川 at 四ノ橋 sits at +0.24 m behind its weir).
  return {
    level: choice.surveyed + shift * Math.min(1, sum),
    tide: 0,
    source: "station",
    surveyed: choice.surveyed,
  };
}

/** Gradient of a bridge's approach: the deck rises from each bank at most this much per metre. */
const RAMP = 0.08;
/** Clearance of the deck over the mean water level away from the abutments (m). */
export const DECK_CLEARANCE = 1.2;

/**
 * Heights of a bridge deck along a road crossing water, from bank A (at 0) to bank B (at length).
 * The deck runs straight between the bank heights, arched a little (real bridges have a camber of
 * a few per mille to ~1 % over long spans), held at least DECK_CLEARANCE over the water but
 * reaching that height no steeper than RAMP from each abutment, so the road has no step.
 */
export function deckHeights(
  length: number,
  step: number,
  bankA: number,
  bankB: number,
  water: number,
): number[] {
  // Every `step` from bank A (callers index the profile by s / step); the last point is bank B.
  const n = Math.max(1, Math.ceil(length / step - 1e-9));
  const camber = Math.min(1.2, length * 0.006);
  const floor = water + DECK_CLEARANCE;
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const s = Math.min(k * step, length);
    const t = s / length;
    const straight = bankA + (bankB - bankA) * t + 4 * camber * t * (1 - t);
    const ramped = Math.min(bankA + RAMP * s, bankB + RAMP * (length - s));
    out.push(Math.max(straight, Math.min(floor, ramped)));
  }
  return out;
}

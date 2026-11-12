import { ST, STATION_STRIDE, type XwChunk } from "../expressway/format";
import { planeAt } from "../expressway/geo";
import { PARAPET_HEIGHT, PARAPET_WIDTH } from "../expressway/assumptions";
import { cutWallHeight } from "../expressway/below";
import { frameAt, surfaceHeight, surfaceSamples } from "../expressway/profile";
import { carriagewayWidth } from "../expressway/section";
import { TERRAIN_ZOOM } from "../config";
import { latToTileY, lonToTileX } from "../geo/tiles";
import {
  DECK_SLAB_M,
  EMBANKMENT_FOOT_M,
  EMBANKMENT_SAMPLE_M,
  EMBANKMENT_SIDE_REACH,
  embankmentBounds,
  otherDecksAt,
} from "./expresswayBore";
import type { GroundCuts } from "./groundCuts";
import { CUT_SUBDIVISIONS } from "./terrainCut";
import { STREET_LIFT_M } from "./terrainSurface";

/**
 * Whether the ground or a street stands through an expressway's carriageway (P2.7-6 PR 7b, `just
 * check-expressway-terrain`): over a chunk's carriageway every ALONG_M along and ACROSS_M across,
 * the drawn terrain's height (terrainSurface.ts meshHeightAt, given as `groundAt`) where the
 * terrain is not cut away for the expressway (groundCuts.ts, as the game cuts it), against the road
 * (profile.ts, flat across as the game draws it). Pure: the script reads the DEM, the holes and the
 * streets and hands them in.
 */

/** Spacing of the probe points along the road and across it (m). */
export const ALONG_M = 1;
export const ACROSS_M = 0.5;
/** A point counts where the terrain stands over the road less this (m): the asphalt's own z-fighting margin. */
export const OVER_ROAD_M = 0.02;
/**
 * Points this close to where the road leaves the ground's cut-out are told apart (`atEnd`): a tunnel's
 * mouth (the ground over it is the tunnel's cover, and the 坑門 stands over the hole's edge,
 * expresswayBore.ts headwallQuads) and a run's ground, portal or open end (the road meets the ground,
 * an untraced tunnel or the range's edge there, and the hole stops). Why 2 m: the mask's pixels are
 * ~2 m, so the hole's end fades over one. Why apart, not dropped: they are real (at a ground end the
 * drawn ground's 15 m triangles stand off the DEM the end was set on), but no hole can take them
 * away without cutting the street that goes on from there.
 */
export const END_M = 2;
/** The terrain collider's pieces where a hole touches it (terrainCut.ts: a ~15.5 m cell in CUT_SUBDIVISIONS). */
const COLLIDER_PIECE_M = 15.5 / CUT_SUBDIVISIONS;

/** A street's centreline (lon/lat pairs) and width, as the game lays it (roadTiles.ts). */
export type ProbeStreet = { coords: readonly number[]; width: number; bridge?: boolean };

export type ProbeHit = {
  chunk: string;
  run: string;
  structure: XwChunk["structure"];
  /** Run distance and offset left of the centre (m). */
  s: number;
  u: number;
  lat: number;
  lon: number;
  /** How far the terrain (or street) stands over the road less OVER_ROAD_M (m). */
  overM: number;
  /** "drawn": the terrain's mesh shows there; "collider": only its collider is left there. */
  kind: "drawn" | "collider" | "street";
  /** Within END_M of a tunnel mouth or a run's ground, portal or open end. */
  atEnd: boolean;
};

export type ChunkProbe = { points: number; hits: ProbeHit[] };

/** The holes as the game reads them: the drawn mask (bilinear, cut over half) and the collider's exact test. */
export type HoleTests = {
  isDrawnCut(lon: number, lat: number): boolean;
  isColliderCut(lon: number, lat: number): boolean;
  /** The holes' own polygons at the point alone (no piece round it). */
  isExactCut(lon: number, lat: number): boolean;
};

/**
 * The drawn and collider tests of GroundCuts. The drawn one samples the z15 mask (cutAt, 512² rows
 * north first) bilinearly at texel centres, as the terrain's material does (terrain.ts: LinearFilter,
 * kept where the share is ≤ 0.5). The collider's is the exact polygon test at the point or within
 * COLLIDER_PIECE_M / 2 of it: the game drops every ~1 m piece of the terrain's collider that the hole
 * touches at a corner or its middle (terrainCut.ts). Why not the exact test alone: on a station where
 * two chunks' holes meet, the point lies on both edges and the even–odd test takes it as in neither.
 */
export function holeTests(cuts: GroundCuts): HoleTests {
  const exact = new Map<string, ReturnType<GroundCuts["cutTest"]>>();
  const isDrawnCut = (lon: number, lat: number) => {
    const gx = lonToTileX(lon, TERRAIN_ZOOM);
    const gy = latToTileY(lat, TERRAIN_ZOOM);
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    const mask = cuts.cutAt(x, y);
    if (!mask) return false;
    const { data, size } = mask;
    const tx = (gx - x) * size - 0.5;
    const ty = (gy - y) * size - 0.5;
    const i0 = Math.floor(tx);
    const j0 = Math.floor(ty);
    const fx = tx - i0;
    const fy = ty - j0;
    const px = (i: number, j: number) =>
      data[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))];
    const top = px(i0, j0) * (1 - fx) + px(i0 + 1, j0) * fx;
    const bottom = px(i0, j0 + 1) * (1 - fx) + px(i0 + 1, j0 + 1) * fx;
    const share = (top * (1 - fy) + bottom * fy) / 255;
    return share > 0.5;
  };
  const isExactCut = (lon: number, lat: number) => {
    const gx = lonToTileX(lon, TERRAIN_ZOOM);
    const gy = latToTileY(lat, TERRAIN_ZOOM);
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    const key = `${x}/${y}`;
    if (!exact.has(key)) exact.set(key, cuts.cutTest(x, y));
    const test = exact.get(key)!;
    return test !== null && test(gx - x, gy - y);
  };
  const isColliderCut = (lon: number, lat: number) => {
    const dLat = COLLIDER_PIECE_M / 2 / 110574;
    const dLon = COLLIDER_PIECE_M / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
    const around: Array<[number, number]> = [
      [0, 0],
      [dLon, 0],
      [-dLon, 0],
      [0, dLat],
      [0, -dLat],
    ];
    return around.some(([a, b]) => isExactCut(lon + a, lat + b));
  };
  return { isDrawnCut, isColliderCut, isExactCut };
}

/** Where the tunnel mouths among some chunks' portals are ([lon, lat] on the centre line). */
export function tunnelMouths(chunks: readonly Pick<XwChunk, "portals" | "st">[]): Array<[number, number]> {
  return chunks.flatMap((c) =>
    (c.portals ?? [])
      .filter((p) => (p.from === "tunnel") !== (p.to === "tunnel"))
      .map((p): [number, number] => {
        const f = frameAt(c.st, p.s);
        return [f.lon, f.lat];
      }),
  );
}

/** Squared distance (m²) from a point to a segment, in a local plane (x east, y north). */
function distance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
  const dx = ax + ex * t - px;
  const dy = ay + ey * t - py;
  return dx * dx + dy * dy;
}

/**
 * Probe one chunk's carriageway. `groundAt(lat, lon)` is the drawn terrain (T.P. m); `streets` the
 * ground-level streets near it. A street counts where its footprint (half its width from the
 * centreline) covers a point that is not in a hole (the game drops a street triangle with a corner in
 * one: groundCuts.ts dropCut) and its asphalt (terrain + STREET_LIFT_M) stands over the road.
 */
export function probeChunk(
  chunk: XwChunk,
  holes: HoleTests,
  groundAt: (lat: number, lon: number) => number,
  streets: readonly ProbeStreet[] = [],
  ends: ReadonlyArray<readonly [number, number]> = tunnelMouths([chunk]),
): ChunkProbe {
  const st = chunk.st;
  const n = st.length / STATION_STRIDE;
  const hits: ProbeHit[] = [];
  const hasLength = n >= 2;
  if (!hasLength) return { points: 0, hits };
  const plane = planeAt(st[ST.lon], st[ST.lat]);
  const hw = carriagewayWidth(chunk) / 2;
  const s0 = st[ST.s];
  const s1 = st[(n - 1) * STATION_STRIDE + ST.s];
  // The streets as segments in the chunk's plane, with their half widths squared.
  const segments: Array<[number, number, number, number, number]> = [];
  for (const street of streets) {
    const half = street.width / 2;
    for (let i = 0; i + 3 < street.coords.length; i += 2) {
      const [ax, ay] = plane.toXY(street.coords[i], street.coords[i + 1]);
      const [bx, by] = plane.toXY(street.coords[i + 2], street.coords[i + 3]);
      segments.push([ax, ay, bx, by, half * half]);
    }
  }
  const isOnStreet = (x: number, y: number) =>
    segments.some(([ax, ay, bx, by, h2]) => distance2(x, y, ax, ay, bx, by) <= h2);
  const endXY = ends.map(([lon, lat]) => plane.toXY(lon, lat));
  const isNearEnd = (x: number, y: number) => endXY.some(([ex, ey]) => Math.hypot(x - ex, y - ey) <= END_M);
  let points = 0;
  const steps = Math.max(1, Math.round((s1 - s0) / ALONG_M));
  const across = Math.round((2 * hw) / ACROSS_M);
  for (let k = 0; k <= steps; k++) {
    const s = s0 + ((s1 - s0) * k) / steps;
    const f = frameAt(st, s);
    // The direction of travel from the plan a little either side (the stations are straight between).
    const a = frameAt(st, Math.max(s0, s - 0.5));
    const b = frameAt(st, Math.min(s1, s + 0.5));
    const [ax, ay] = plane.toXY(a.lon, a.lat);
    const [bx, by] = plane.toXY(b.lon, b.lat);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const lx = -(by - ay) / len;
    const ly = (bx - ax) / len;
    const [cx, cy] = plane.toXY(f.lon, f.lat);
    const atEnd = isNearEnd(cx, cy);
    for (let j = 0; j <= across; j++) {
      const u = -hw + (2 * hw * j) / across;
      const x = cx + lx * u;
      const y = cy + ly * u;
      const [lon, lat] = plane.toLonLat(x, y);
      const road = surfaceHeight(f, u, false) - OVER_ROAD_M;
      points++;
      const isDrawnCut = holes.isDrawnCut(lon, lat);
      const isColliderCut = holes.isColliderCut(lon, lat);
      const isAllCut = isDrawnCut && isColliderCut;
      const hasStreets = segments.length > 0;
      if (isAllCut && !hasStreets) continue;
      const ground = groundAt(lat, lon);
      const at = { chunk: chunk.id, run: chunk.run, structure: chunk.structure, s, u, lat, lon, atEnd };
      const overM = ground - road;
      const isOver = overM > 0;
      if (isOver && !isDrawnCut) hits.push({ ...at, overM, kind: "drawn" });
      else if (isOver && !isColliderCut) hits.push({ ...at, overM, kind: "collider" });
      const streetOver = ground + STREET_LIFT_M - road;
      const isStreetOut = streetOver > 0 && !isColliderCut && isOnStreet(x, y);
      if (isStreetOut) hits.push({ ...at, overM: streetOver, kind: "street" });
    }
  }
  return { points, hits };
}

/** A point beside an embankment's wall where the drawn terrain passes its top or its foot. */
export type WallHit = {
  chunk: string;
  s: number;
  side: "left" | "right";
  lat: number;
  lon: number;
  overM: number;
  kind: "top" | "foot";
};

/** Across the wall's outer side where the probe reads the terrain (m past the slab's edge). */
const WALL_PROBE_M = [0, 0.25, 0.5];

/**
 * Whether the drawn terrain (`groundAt`, T.P. m) beside an embankment's walls stands over their top
 * or under their foot, every ALONG_M along and WALL_PROBE_M across, against the walls as the deck
 * draws them (expresswayDeck.ts, embankmentBounds: at each ring the terrain there and on to its
 * neighbours gives the foot, its lowest less EMBANKMENT_FOOT_M, and the top, cutWallHeight over its
 * highest; straight between the rings, here profile.ts surfaceSamples: the deck has more where it is
 * merged). A side with a same-surface partner has no wall;
 * the probe does not know the partners and reads both sides, but not where the terrain is cut away
 * (`holes`: a deck alongside, where the wall stays a parapet) (review of PR 7b, W3 and S-1).
 */
export function probeWalls(
  chunk: XwChunk,
  groundAt: (lat: number, lon: number) => number,
  holes: HoleTests | null = null,
  others: Iterable<XwChunk> = [],
): WallHit[] {
  if (chunk.structure !== "embankment") return [];
  const st = chunk.st;
  const plane = planeAt(st[ST.lon], st[ST.lat]);
  const edge = carriagewayWidth(chunk) / 2 + PARAPET_WIDTH.value;
  const s0 = st[ST.s];
  const s1 = st[st.length - STATION_STRIDE + ST.s];
  /** The plan point u metres left of the centre line at s, and the road there. */
  const pointAt = (s: number, u: number) => {
    const f = frameAt(st, s);
    const a = frameAt(st, Math.max(s0, s - 0.5));
    const b = frameAt(st, Math.min(s1, s + 0.5));
    const [ax, ay] = plane.toXY(a.lon, a.lat);
    const [bx, by] = plane.toXY(b.lon, b.lat);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const [cx, cy] = plane.toXY(f.lon, f.lat);
    const [lon, lat] = plane.toLonLat(cx - ((by - ay) / len) * u, cy + ((bx - ax) / len) * u);
    return { lon, lat, road: f.z };
  };
  const rings = surfaceSamples(st).map((x) => x.s);
  const relAt = (s: number, u: number) => {
    const p = pointAt(s, u);
    return groundAt(p.lat, p.lon) - p.road;
  };
  const decksAt = otherDecksAt(chunk, others, plane.toXY);
  /** Whether a side is open at s as the deck reads it (expresswayDeck.ts openOf): some of its ground is left. */
  const isOpenAt = (s: number, sign: 1 | -1) =>
    EMBANKMENT_SIDE_REACH.some((d) => {
      const p = pointAt(s, sign * (edge + d));
      const [x, y] = plane.toXY(p.lon, p.lat);
      return !decksAt(x, y).some((deck) => deck.cutsGround);
    });
  /** Each ring's foot and top on one side, as the deck takes them (embankmentBounds). */
  const wallsOf = (sign: 1 | -1) => {
    const reach = EMBANKMENT_SIDE_REACH.map((d) => sign * (edge + d));
    const atRing = rings.map((s) => reach.map((u) => relAt(s, u)));
    const between = rings.slice(0, -1).map((a, k) => {
      const b = rings[k + 1];
      const count = Math.ceil((b - a) / EMBANKMENT_SAMPLE_M) - 1;
      const ys: number[] = [];
      for (let q = 1; q <= count; q++)
        for (const u of reach) ys.push(relAt(a + ((b - a) * q) / (count + 1), u));
      return ys;
    });
    return embankmentBounds(atRing, between).map(({ low, high }, k) => ({
      foot: Math.min(-DECK_SLAB_M, low - EMBANKMENT_FOOT_M),
      top: isOpenAt(rings[k], sign) ? cutWallHeight(0, high, PARAPET_HEIGHT.value) : PARAPET_HEIGHT.value,
    }));
  };
  const hits: WallHit[] = [];
  for (const sign of [1, -1] as const) {
    const walls = wallsOf(sign);
    let k = 0;
    const steps = Math.max(1, Math.round((s1 - s0) / ALONG_M));
    for (let q = 0; q <= steps; q++) {
      const s = s0 + ((s1 - s0) * q) / steps;
      while (k + 2 < rings.length && rings[k + 1] < s) k++;
      const t = Math.min(1, Math.max(0, (s - rings[k]) / (rings[k + 1] - rings[k] || 1)));
      const top = walls[k].top + (walls[k + 1].top - walls[k].top) * t;
      const foot = walls[k].foot + (walls[k + 1].foot - walls[k].foot) * t;
      const side = sign > 0 ? ("left" as const) : ("right" as const);
      for (const d of WALL_PROBE_M) {
        const p = pointAt(s, sign * (edge + d));
        // In a hole (another deck's beside, where the wall stays a parapet) no terrain is drawn to
        // meet the wall; elsewhere it is read, on the closed sides too (7b2). The mask's 2 m pixels
        // fray a hole's edge, so the exact test too.
        const isCut = holes !== null && (holes.isDrawnCut(p.lon, p.lat) || holes.isExactCut(p.lon, p.lat));
        if (isCut) continue;
        const y = groundAt(p.lat, p.lon) - p.road;
        const at = { chunk: chunk.id, s, side, lat: p.lat, lon: p.lon };
        if (y > top) hits.push({ ...at, overM: y - top, kind: "top" });
        if (y < foot) hits.push({ ...at, overM: foot - y, kind: "foot" });
      }
    }
  }
  return hits;
}

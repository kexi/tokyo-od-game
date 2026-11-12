import {
  CUT_WALL,
  PARAPET_HEIGHT,
  TUNNEL_LAMPS,
  TUNNEL_ROOF,
  TUNNEL_WALKWAY,
} from "../expressway/assumptions";
import { cutWallHeight, HEAD_OVER_GROUND_M, isHoleAt, TUNNEL_INNER_HEIGHT_M } from "../expressway/below";
import { ST, STATION_STRIDE, type XwChunk } from "../expressway/format";
import { carriagewayWidth } from "../expressway/section";
import type { WaterPolygon } from "./waterGeometry";

/**
 * The cross-sections of a chunk below the ground (P9, format.ts XwChunk.structure): a tunnel's box
 * (floor, inspection walkways, walls, ceiling, and its outer shell where a portal shows it) and a
 * cut's floor between retaining walls up to the ground. expresswayDeck.ts extrudes these loops along
 * the same rings as a viaduct's deck, so the floor is the graph's surfaceY there too (T11). Pure: no
 * scene objects; the terrain's cut-out (`boreHoles`) is in lon/lat.
 *
 * The faces carry their kind in the vertex colour (BORE_COLOURS), as the deck's do: P4's textures
 * are put on by kind once that branch is merged.
 */

const H = TUNNEL_INNER_HEIGHT_M;
const ROOF = TUNNEL_ROOF.value.slab;
const WALK = TUNNEL_WALKWAY.value.width;
const CURB = TUNNEL_WALKWAY.value.curb;
const WALL = CUT_WALL.value.thickness;
/** Where across a cut a wall's own ground is taken (m past its inner face): the face, the outer face and the hole's edge beyond. */
export const CUT_WALL_GROUND_REACH = [0, WALL, WALL + 1] as const;
/** Thickness of a tunnel's side walls (the box's outer shell). */
const TUNNEL_WALL = 0.6;
/** Floor slab under the road (as the deck's SLAB). */
const FLOOR = 0.35;
/** A tunnel's 坑門 (headwall) reaches this far past the box's sides and this far over the ground. */
const HEAD_SIDE = 1.2;
const HEAD_OVER_GROUND = HEAD_OVER_GROUND_M;

/** Vertex colours by face kind (linear RGB, as the deck's ASPHALT / CONCRETE). */
export const BORE_COLOURS = {
  road: [0.16, 0.16, 0.17],
  /** Tunnel lining (内装板): pale, so the lamps light it. */
  lining: [0.74, 0.73, 0.68],
  ceiling: [0.3, 0.3, 0.3],
  walkway: [0.52, 0.51, 0.48],
  /** Retaining walls of a cut and the tunnel's outer shell and headwall. */
  retaining: [0.6, 0.59, 0.55],
} as const;

export type BoreFace = { colour: readonly number[]; solid: boolean };

const road: BoreFace = { colour: BORE_COLOURS.road, solid: true };
const lining: BoreFace = { colour: BORE_COLOURS.lining, solid: true };
const ceiling: BoreFace = { colour: BORE_COLOURS.ceiling, solid: true };
const walkway: BoreFace = { colour: BORE_COLOURS.walkway, solid: true };
const wall: BoreFace = { colour: BORE_COLOURS.retaining, solid: true };
const shell: BoreFace = { colour: BORE_COLOURS.retaining, solid: false };
/**
 * The tunnel's outer walls and roof top: solid, so a street crossing a portal's hole (the roof near
 * the ground, the terrain cut away over it) rides over the roof instead of falling in (206524230 at
 * 麻布台's north portal, review of P9). Buried, the terrain covers them and nothing reaches them.
 */
const outer: BoreFace = { colour: BORE_COLOURS.retaining, solid: true };

/**
 * The faces between consecutive corners of `boreLoop`, by structure. The first three corners are
 * the road's right end, its middle and its left end, as the deck's (paintTriangles reads them), the
 * middle at the right end (one face across: no edge along the centre line where cars drive, as the
 * deck's). Tunnel: road, left curb,
 * walkway, wall, ceiling, right wall, walkway, curb, then the outer shell, seen only where the
 * ground is cut away: under the floor (not solid), the outer walls and the roof's top (solid), and
 * the bottom (not solid). Cut: road, left
 * wall's inner face and top, outer face, underside, right outer face, top and inner face.
 */
export const BORE_FACES: Readonly<Record<"tunnel" | "cut", readonly BoreFace[]>> = {
  tunnel: [
    road,
    road,
    lining,
    walkway,
    lining,
    ceiling,
    lining,
    walkway,
    lining,
    shell,
    outer,
    outer,
    outer,
    shell,
  ],
  cut: [road, road, wall, wall, shell, shell, shell, wall, wall],
};

/**
 * A below chunk's cross-section at one ring as a corner loop (left = +u), `at(u, v)` giving the
 * local point u metres left of the centre and v above its centre height, `lift(u)` the road's
 * height there (the bank). `groundV` is the ground over the centre, relative to the centre's height.
 */
export function boreLoop(
  structure: "tunnel" | "cut",
  hw: number,
  at: (u: number, v: number) => number[],
  lift: (u: number) => number,
  groundV: number,
  sides: { left: number; right: number } | null = null,
): number[][] {
  const lL = lift(hw);
  const lR = lift(-hw);
  if (structure === "cut") {
    // Each wall to the ground at its own side where that is higher than over the centre (P2.7-5:
    // the street on 麻布台's east side stood over the wall's top, a strip of sky under it). Why not
    // the centre's ground for both, as before: it is one DEM point, and the ground falls across.
    const gL = Math.max(groundV, sides?.left ?? -Infinity);
    const gR = Math.max(groundV, sides?.right ?? -Infinity);
    const hL = cutWallHeight(lL, gL, PARAPET_HEIGHT.value);
    const hR = cutWallHeight(lR, gR, PARAPET_HEIGHT.value);
    return [
      at(-hw, lR),
      at(-hw, lR),
      at(hw, lL),
      at(hw, lL + hL),
      at(hw + WALL, lL + hL),
      at(hw + WALL, lL - FLOOR),
      at(-hw - WALL, lR - FLOOR),
      at(-hw - WALL, lR + hR),
      at(-hw, lR + hR),
      at(-hw, lR),
    ];
  }
  const w = hw + WALK;
  const o = w + TUNNEL_WALL;
  return [
    at(-hw, lR),
    at(-hw, lR),
    at(hw, lL),
    at(hw, lL + CURB),
    at(w, lL + CURB),
    at(w, lL + H),
    at(-w, lR + H),
    at(-w, lR + CURB),
    at(-hw, lR + CURB),
    at(-hw, lR),
    at(-o, lR - FLOOR),
    at(-o, lR + H + ROOF),
    at(o, lL + H + ROOF),
    at(o, lL - FLOOR),
    at(-o, lR - FLOOR),
  ];
}

/**
 * A tunnel's 坑門 at a portal ring: a frame round the bore from the floor to above the ground (so the
 * cut-away terrain's edge is behind it), as quads [a, b, c, d] in loop order.
 */
export function headwallQuads(
  hw: number,
  at: (u: number, v: number) => number[],
  groundV: number,
): number[][][] {
  const w = hw + WALK;
  const o = w + TUNNEL_WALL + HEAD_SIDE;
  const top = Math.max(H + ROOF + HEAD_OVER_GROUND, groundV + HEAD_OVER_GROUND);
  return [
    [at(w, -FLOOR), at(o, -FLOOR), at(o, top), at(w, top)],
    [at(-o, -FLOOR), at(-w, -FLOOR), at(-w, top), at(-o, top)],
    [at(-w, H), at(w, H), at(w, top), at(-w, top)],
  ];
}

/**
 * The ceiling lamps of a tunnel chunk, as quads hanging just under the ceiling at both walls, every
 * TUNNEL_LAMPS.pitch from the run's start (so they line up across chunks). `pointAt(s, u, v)` gives
 * the local point at run distance s; the chunk covers [s0, s1].
 */
export function lampQuads(
  hw: number,
  s0: number,
  s1: number,
  pointAt: (s: number, u: number, v: number) => number[],
): number[][][] {
  const { pitch, length } = TUNNEL_LAMPS.value;
  const out: number[][][] = [];
  const u0 = hw + WALK - 0.5;
  const u1 = hw + WALK - 0.2;
  const v = H - 0.04;
  for (let s = Math.ceil(s0 / pitch) * pitch; s + length <= s1; s += pitch) {
    for (const sign of [1, -1]) {
      out.push([
        pointAt(s, sign * u0, v),
        pointAt(s, sign * u1, v),
        pointAt(s + length, sign * u1, v),
        pointAt(s + length, sign * u0, v),
      ]);
    }
  }
  return out;
}

/** Half the width a below chunk takes in plan: walls and walkways included (the terrain's cut-out). */
export function boreHalfWidth(chunk: XwChunk): number {
  const hw = carriagewayWidth(chunk) / 2;
  return chunk.structure === "tunnel" ? hw + WALK + TUNNEL_WALL + HEAD_SIDE : hw + WALL;
}

/** Margin of the terrain's cut-out past the walls (the terrain's triangles are ~15 m). */
const HOLE_MARGIN = 0.3;

export { isHoleAt };

/**
 * The terrain's cut-out over a below chunk (water.ts's polygons: global tile units at `zoom`, x
 * east, y south): one polygon per stretch of consecutive stations that need a hole, the left edge
 * forward and the right edge back. `toTile(lon, lat)` maps to tile units.
 */
export function boreHoles(
  chunk: XwChunk,
  toTile: (lon: number, lat: number) => [number, number],
): WaterPolygon[] {
  const isBelow = chunk.structure === "tunnel" || chunk.structure === "cut";
  if (!isBelow) return [];
  const structure = chunk.structure as "tunnel" | "cut";
  const n = chunk.st.length / STATION_STRIDE;
  const w = boreHalfWidth(chunk) + HOLE_MARGIN;
  const out: WaterPolygon[] = [];
  let left: number[] = [];
  let right: number[] = [];
  const flush = () => {
    const hasArea = left.length >= 4;
    if (hasArea) {
      const ring = [...left];
      for (let i = right.length - 2; i >= 0; i -= 2) ring.push(right[i], right[i + 1]);
      out.push([ring]);
    }
    left = [];
    right = [];
  };
  for (let i = 0; i < n; i++) {
    const o = i * STATION_STRIDE;
    const lon = chunk.st[o + ST.lon];
    const lat = chunk.st[o + ST.lat];
    const isHole = isHoleAt(structure, chunk.st[o + ST.z], chunk.st[o + ST.ground]);
    if (!isHole) {
      flush();
      continue;
    }
    const a = Math.max(0, i - 1) * STATION_STRIDE;
    const b = Math.min(n - 1, i + 1) * STATION_STRIDE;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110574;
    const dx = (chunk.st[b + ST.lon] - chunk.st[a + ST.lon]) * kx;
    const dy = (chunk.st[b + ST.lat] - chunk.st[a + ST.lat]) * ky;
    const len = Math.hypot(dx, dy) || 1;
    // Left of travel in east/north metres: (−dy, dx).
    const lx = (-dy / len) * w;
    const ly = (dx / len) * w;
    left.push(...toTile(lon + lx / kx, lat + ly / ky));
    right.push(...toTile(lon - lx / kx, lat - ly / ky));
  }
  flush();
  return out;
}

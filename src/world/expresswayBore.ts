import {
  CUT_WALL,
  PARAPET_HEIGHT,
  PARAPET_WIDTH,
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

/**
 * Whether the terrain is cut over a chunk (boreHoles): a tunnel near its portals, a cut, and an
 * embankment (P2.7-6 PR 7b) all along its slab, so the bumpy DEM never stands through its road where
 * the road is near or under the ground (R1・W5). Why the whole embankment, not only where its road is
 * low: the slab and the walls cover the hole wherever it is, and one rule needs no threshold.
 */
export function cutsGround(chunk: Pick<XwChunk, "structure">): boolean {
  return chunk.structure === "tunnel" || chunk.structure === "cut" || chunk.structure === "embankment";
}

/** Thickness of a deck's slab (expresswayDeck.ts SLAB; here so the terrain probe can read it in Node). */
export const DECK_SLAB_M = 0.35;
/** Where beside an embankment's slab edge the terrain is read (m past it): the wall's foot and top. */
export const EMBANKMENT_SIDE_REACH = [0, 0.5] as const;
/** An embankment's wall reaches this far under the lowest terrain beside it (no sky under its foot). */
export const EMBANKMENT_FOOT_M = 0.3;

/**
 * Beside an embankment's walled side, a strip of collider (not drawn) this wide on the drawn terrain
 * from the slab's edge: the terrain's own collider drops every ~1 m piece its hole touches
 * (terrainCut.ts), which left no ground beside the wall (review of PR 7b, W4).
 */
export const EMBANKMENT_APRON_M = 1.5;
/** Spacing of the terrain reads along an embankment's sides between its rings (m). */
export const EMBANKMENT_SAMPLE_M = 4;

/**
 * The terrain an embankment's wall at each ring must meet, relative to the road: the lowest and the
 * highest of the reads at that ring (`atRing[i]`) and along the stretches to its neighbours
 * (`between[i]`: ring i to i + 1). The deck takes its foot under the lowest and its top over the
 * highest and draws the wall straight between rings, so the drawn terrain's 15.5 m triangles, which
 * bend between two rings, stay above the foot and under the top (review of PR 7b, W3: from the ring
 * alone a wall's foot stood up to 2.7 m over the terrain on ship). Shared by expresswayDeck.ts and
 * the terrain probe (terrainProbe.ts).
 */
export function embankmentBounds(
  atRing: ReadonlyArray<readonly number[]>,
  between: ReadonlyArray<readonly number[]>,
): Array<{ low: number; high: number }> {
  return atRing.map((here, i) => {
    const all = [...here, ...(between[i - 1] ?? []), ...(between[i] ?? [])];
    return { low: Math.min(...all), high: Math.max(...all) };
  });
}

/** Beyond a deck's slab edge, how far its hole may reach (a cut's walls and margin). */
const HOLE_NEIGHBOUR_M = 0.3;
/**
 * A deck whose road stands this far over or under the point's (T.P. m) is not beside it but over
 * or under it (a viaduct above, a tunnel under its cover): the ground beside is still open
 * (re-review S-a: 4848757:0 under a viaduct, a wall left at the parapet with the ground over it).
 */
const LEVEL_APART_M = 3;
/** A run's own end in otherDeckFootprint: points within this of its end station along it are off it (m). */
const SQUARE_END_M = 0.5;
/** Other chunks with a station box within this of a chunk's (degrees, ~60 m) are its neighbours. */
const NEIGHBOUR_REACH_DEG = 0.0006;

/** Each chunk's stations' box [lon0, lat0, lon1, lat1], kept per chunk object (they never change). */
const stationBoxes = new WeakMap<XwChunk, [number, number, number, number]>();
function stationBox(c: XwChunk): [number, number, number, number] {
  const known = stationBoxes.get(c);
  if (known) return known;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    x0 = Math.min(x0, c.st[i + ST.lon]);
    x1 = Math.max(x1, c.st[i + ST.lon]);
    y0 = Math.min(y0, c.st[i + ST.lat]);
    y1 = Math.max(y1, c.st[i + ST.lat]);
  }
  const box: [number, number, number, number] = [x0, y0, x1, y1];
  stationBoxes.set(c, box);
  return box;
}

/**
 * A test of whether a plane point (`toXY`'s units, metres) lies on the deck or in the hole of a
 * chunk of another run near `chunk` (among `candidates`): within its slab's half width +
 * HOLE_NEIGHBOUR_M of its centre line, its road within LEVEL_APART_M of `z` (T.P., the asking road). Shared by expresswayDeck.ts (whether an embankment's side is
 * open: its wall rises and its apron lies only there) and the terrain probe. A run's own end is
 * square (a deck ends square there): past the first station of a run's first chunk or the last of
 * its last the point is off it. Why not round there as a centre line's distance does: at a seam to
 * another run the embankment's last ring was taken as on the next run's deck and its wall fell to
 * the parapet beside ground 2.5 m over it (1059139534:17 s 2304.1 before 4854085's portal: review
 * of PR 7b, W-C).
 */
export function otherDeckFootprint(
  chunk: XwChunk,
  candidates: Iterable<XwChunk>,
  toXY: (lon: number, lat: number) => [number, number],
): (x: number, y: number, z: number) => boolean {
  const [x0, y0, x1, y1] = stationBox(chunk);
  const r = NEIGHBOUR_REACH_DEG;
  const others: Array<{
    pts: Array<[number, number]>;
    zs: number[];
    half: number;
    isStart: boolean;
    isEnd: boolean;
  }> = [];
  for (const c of candidates) {
    // Its own run goes on along the same line: its next chunk is this deck, not one beside it.
    if (c.run === chunk.run) continue;
    const [cx0, cy0, cx1, cy1] = stationBox(c);
    const isNear = cx1 >= x0 - r && cx0 <= x1 + r && cy1 >= y0 - r && cy0 <= y1 + r;
    if (!isNear) continue;
    const pts: Array<[number, number]> = [];
    const zs: number[] = [];
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      pts.push(toXY(c.st[i + ST.lon], c.st[i + ST.lat]));
      zs.push(c.st[i + ST.z]);
    }
    const half = carriagewayWidth(c) / 2 + PARAPET_WIDTH.value + HOLE_NEIGHBOUR_M;
    others.push({ pts, zs, half, isStart: c.prev === null, isEnd: c.next === null });
  }
  return (x, y, z) =>
    others.some(({ pts, zs, half, isStart, isEnd }) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const ex = bx - ax;
        const ey = by - ay;
        const len2 = ex * ex + ey * ey;
        const raw = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
        // Square, and SQUARE_END_M short of the end station: a point beside a seam station projects
        // a few centimetres onto the next run's first segment on a bend.
        const len = Math.sqrt(len2);
        const isBeforeStart = isStart && i === 0 && raw * len < SQUARE_END_M;
        const isPastEnd = isEnd && i + 2 === pts.length && (1 - raw) * len < SQUARE_END_M;
        if (isBeforeStart || isPastEnd) continue;
        const t = Math.min(1, Math.max(0, raw));
        const isOn = Math.hypot(ax + ex * t - x, ay + ey * t - y) <= half;
        const isLevel = Math.abs(zs[i] + (zs[i + 1] - zs[i]) * t - z) < LEVEL_APART_M;
        if (isOn && isLevel) return true;
      }
      return false;
    });
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
  if (!cutsGround(chunk)) return [];
  const isEmbankment = chunk.structure === "embankment";
  const n = chunk.st.length / STATION_STRIDE;
  // An embankment's hole is its slab's width and no more: its walls stand at the slab's edges down
  // past the ground, so the terrain meets them. Why not a cut's margin past the walls: beside the
  // low side of an embankment that strip would open on the void under the wall's foot.
  const w = isEmbankment
    ? carriagewayWidth(chunk) / 2 + PARAPET_WIDTH.value
    : boreHalfWidth(chunk) + HOLE_MARGIN;
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
    const isHole =
      isEmbankment ||
      isHoleAt(chunk.structure as "tunnel" | "cut", chunk.st[o + ST.z], chunk.st[o + ST.ground]);
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
    // Back past a chunk's start, HOLE_SEAM_M along its first interval, where the chunk before it in
    // its run cuts the ground at that station too: two chunks' holes meet at one station square to
    // each one's own interval, and on a bend that left a wedge of ground between them on the outer
    // side (1059139534:15 | :16, 0.92 m over the road at the wall, the terrain probe). The start
    // alone: the later chunk's reach closes the wedge, and a chunk's own portal says what the one
    // before it is (format.ts: a portal is in the chunk after the change). Why not past a tunnel
    // whose roof is under cover there, a viaduct or a run's end: the ground over the tunnel is its
    // cover (737538573:0 | :1, the street over 麻布台's north portal: review of PR 7b, C1), under a
    // viaduct nothing needs it, and past a ground end the street goes on (dropCut).
    const isFirst = i === 0 && chunk.prev !== null;
    const isSeam = isFirst && cutsGroundBefore(chunk, chunk.st[o + ST.z], chunk.st[o + ST.ground]);
    const back = [(-dx * HOLE_SEAM_M) / len / kx, (-dy * HOLE_SEAM_M) / len / ky] as const;
    const put = (dLon: number, dLat: number) => {
      left.push(...toTile(lon + dLon + lx / kx, lat + dLat + ly / ky));
      right.push(...toTile(lon + dLon - lx / kx, lat + dLat - ly / ky));
    };
    if (isSeam) put(back[0], back[1]);
    put(0, 0);
    // And on past a chunk's end, where its road is at the ground and no tunnel roof is under cover
    // there (whatever comes next then cuts the ground too or stands at it): where the next chunk is
    // narrower (fewer lanes) its reach back stops at its own walls, and the ground stood in the
    // corner of the wider one's end (1059139534:15 | :16, 0.92 m over the road at the wall).
    const isLast = i === n - 1 && chunk.next !== null;
    const z = chunk.st[o + ST.z];
    const ground = chunk.st[o + ST.ground];
    const isAtGround = isHoleAt("tunnel", z, ground) && z - ground < SEAM_AT_GROUND_M;
    if (isLast && isAtGround) put(-back[0], -back[1]);
  }
  flush();
  return out;
}

/**
 * Whether the chunk before this one in its run cuts the ground at their shared station (z, ground):
 * its structure is the `from` of a portal at this chunk's start, else this chunk's own.
 */
function cutsGroundBefore(chunk: XwChunk, z: number, ground: number): boolean {
  const s0 = chunk.st[ST.s];
  const portal = (chunk.portals ?? []).find((p) => Math.abs(p.s - s0) < 1e-6);
  const before = portal ? portal.from : chunk.structure;
  if (before === "cut" || before === "embankment") return true;
  return before === "tunnel" && isHoleAt("tunnel", z, ground);
}

/**
 * How far a hole reaches back past a chunk's start into the chunk before it (boreHoles), m: a bend
 * of 15° at the shared station is closed out to the walls (tests/expresswayGradeStructures.test.ts).
 */
const HOLE_SEAM_M = 1;
/** A road this little over the ground at a chunk's end has its hole reach on past it (boreHoles). */
const SEAM_AT_GROUND_M = 1;

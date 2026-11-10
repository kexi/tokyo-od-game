import RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
  type Matrix4,
  Mesh,
  type Quaternion,
  type Scene,
  Vector3,
} from "three";
import { PARAPET_HEIGHT, PARAPET_WIDTH, ZEBRA } from "../expressway/assumptions";
import {
  PIER_STRIDE,
  STATION_STRIDE,
  XW_VERSION,
  type XwChunk,
  type XwMeta,
  type XwRunSummary,
  type XwTile,
} from "../expressway/format";
import { haversine, tileKey } from "../expressway/geo";
import { ST, surfaceAt } from "../expressway/profile";
import { carriagewayWidth } from "../expressway/section";
import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import type { LocalFrame } from "../geo/frame";
import { error, log, warn } from "../log";
import { reanchorBody } from "../physics/reanchor";
import { type DeckCutGeodetic, deckCutPoints } from "./deckCuts";
import { createDeckMaterial, DECK_COLOURS, deckSurfaceAttribute } from "./deckSurface";
import {
  dashWindows,
  DeckIndex,
  type DeckSide,
  planDeckMarkings,
  type RingSides,
  type XwMarkingPlan,
  zebraStripes,
} from "./expresswayMarkings";
import {
  type ChunkRings,
  chunkRings,
  type DeckRing,
  DeckMerge,
  type GeoToLocal,
  liftAt,
  MERGE_RAMP,
  MERGE_SKIRT,
  MERGE_TUCK,
  openSide,
  type MergeSkip,
  ringBetween,
  ringPoint,
} from "./expresswayMerge";
import { type Ellipsoidal, expresswayRoadInput, type XwRoadInput } from "./expresswayRoads";

/**
 * Expressway decks from public/data/expressway (knowledge/road-redesign-plan.md 4.5). Each ≤ 300 m
 * chunk is extruded once along its rings (profile.ts surfaceSamples) — deck slab, 壁高欄, the box
 * girder's webs and soffit, its painted lines (expresswayMarkings.ts) — with its piers baked into
 * the same mesh, and kept until the player is far away: the road network's 300 m rebuilds never
 * touch it.
 *
 * Near the player (COLLIDER_RADIUS_M) a chunk also has a fixed body: a trimesh of the slab's top
 * and the 壁高欄 (the same vertices the mesh draws, so the collider is the drawn surface and the
 * graph's surfaceY: knowledge/road-redesign-plan.md 4.4 T11) and a cuboid per pier. A chunk without
 * one is not offered to the car (isSolid, isReadyNear).
 *
 * Positions come from lon/lat and the T.P. elevation plus the geoid through the local frame, like
 * the terrain, so a deck stands at the height the compiler gave it over the same DEM. On a change
 * of origin the meshes and bodies are moved by the frame's rigid transform (as water.ts moves its
 * decks); a body made later from a mesh built in an older frame starts from that frame's transform.
 */

export type { GeoToLocal };

const Z = 14;
const RENDER_RADIUS_M = 1500;
const DROP_RADIUS_M = 1900;
/** Colliders within this of the player (設計書 4.5: about 400 m), dropped beyond the second. */
export const COLLIDER_RADIUS_M = 400;
const COLLIDER_DROP_M = 550;
/** A car this close to a chunk without a body is held (main.ts freezes it, as over the terrain). */
const HOLD_RADIUS_M = 60;
/** The longest a car is held for a missing collider before it is let go (with a warning). */
export const HOLD_MAX_MS = 5000;
/** A refresh hands the frame back once a slice has used this much (FrameWork's own budget). */
const SLICE_BUDGET_MS = 4;
const MOVE_BEFORE_UPDATE_M = 120;
/** Road-graph lines for the chunks this close to the network's centre (its tiles are ~1.8 km). */
const GRAPH_RADIUS_M = 1300;
const SLAB = 0.35;
/** The box girder's bottom flange as a share of the deck width. */
const GIRDER_BOTTOM_SHARE = 0.55;
const PIER_ALONG = 2.2;
const PIER_ACROSS_SHARE = 0.4;
const PIER_FOOT = 0.6;
/** Paint stands this far over the slab (no z-fighting at a few hundred metres). */
const PAINT_LIFT = 0.012;

// The flat colours say which surface a face is; deckSurface.ts textures each from them.
const {
  asphalt: ASPHALT,
  concrete: CONCRETE,
  soffit: SOFFIT,
  pier: PIER,
  paintWhite: PAINT_WHITE,
  paintYellow: PAINT_YELLOW,
} = DECK_COLOURS;

export type DeckArrays = { position: Float32Array; color: Float32Array };
/** Triangles of the slab's top and the 壁高欄 (local frame of the build), for the trimesh. */
export type ColliderArrays = { position: Float32Array; index: Uint32Array };
/** A pier's box: centre, half extents (along, up, across) and the yaw of `along` (local frame). */
export type PierBox = { centre: Vector3; half: Vector3; yaw: number };

/** What the deck builder knows of the other decks (rails, merges and markings where they meet). */
export type DeckContext = { index: DeckIndex };

/** A cross-section's corners in the local frame, in loop order (see SECTION_FACES). */
type Corners = number[][];

/**
 * The faces between consecutive corners of a cross-section, drawn left → right over the top:
 * 0–1 the road (split at the centre so a cut deck's road meets the master's face at the seam and
 * still lies on its own surface at the centre), 2 the strip from the road's end to a 壁高欄 that
 * stands back from it (hidden under the master), 3–5 the left 壁高欄's inner face, top and outer
 * face, 6 the slab's bottom out to its edge, 7 the girder's web, 8 the soffit, 9–14 the right side
 * mirrored. A face with nothing to show (no wall, no cut) has zero area and is left out.
 */
const ROAD_FACES = new Set([0, 1]);
/** The faces a car meets: the road and both 壁高欄 (a car on a deck alongside meets the outer face). */
const SOLID_FACES = new Set([0, 1, 3, 4, 5, 11, 12, 13]);
const SOFFIT_FACE = 8;
const faceColour = (k: number) => (ROAD_FACES.has(k) ? ASPHALT : k === SOFFIT_FACE ? SOFFIT : CONCRETE);

/**
 * The extruded deck of one chunk as non-indexed triangles (flat-shaded concrete, painted lines on
 * top), in local coordinates, with its collider's triangles and pier boxes. `bank` tilts the slab
 * by the compiled superelevation (off by default, knowledge/road-redesign-plan.md 4.3 の 4). With a
 * context, the decks it shares one surface with are made one slab with it (expresswayMerge.ts).
 */
export function* deckArraySteps(
  chunk: XwChunk,
  place: GeoToLocal,
  bank = false,
  context: DeckContext | null = null,
): Generator<
  void,
  {
    arrays: DeckArrays;
    stations: Vector3[];
    tangents: Vector3[];
    collider: ColliderArrays;
    piers: PierBox[];
    marks: XwMarkingPlan;
    rings: DeckRing[];
    sides: RingSides[];
    /** Stretches of a "same" pair left apart (expressway_merge_skipped). */
    skipped: MergeSkip[];
  }
> {
  const n = chunk.st.length / STATION_STRIDE;
  const centre: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STATION_STRIDE;
    const lon = chunk.st[o + ST.lon];
    const lat = chunk.st[o + ST.lat];
    centre.push(place.frame.toLocal(lat, lon, place.ellipsoidal(lat, lon, chunk.st[o + ST.z])));
  }
  // Rings where profile.ts samples the surface; the graph's segments (expresswayRoads.ts) have a
  // point at every one of them, so surfaceY is the face too.
  const own = chunkRings(chunk, place, bank);
  yield;
  const merge = context ? new DeckMerge(context.index, place, bank) : null;
  const baseSides: RingSides[] = [];
  for (const r of own.rings) {
    baseSides.push(merge ? merge.sides(own, r) : { left: openSide(own), right: openSide(own) });
    // Every 8 rings: a ring whose master is itself checked (masterShortfall) costs two sides.
    const checkpoint = baseSides.length % 8 === 0;
    if (checkpoint) yield;
  }
  const { rings, sides, closing } = merge
    ? yield* refineRings(own, baseSides, merge)
    : { rings: own.rings, sides: baseSides, closing: new Set<number>() };
  yield;
  const m = rings.length;
  const gw = own.edge * GIRDER_BOTTOM_SHARE;
  const ph = PARAPET_HEIGHT.value;
  const corners = (i: number): Corners => {
    const r = rings[i];
    const sd = sides[i];
    const lift = (u: number) => liftAt(r, u, bank);
    const at = (u: number, v: number) => ringPoint(r, u, v).toArray();
    // The girder never reaches below the ground: near a ground end it shortens into a wall.
    const clear = r.c.y - r.groundY;
    const depth = Math.max(SLAB, Math.min(chunk.girder, clear + 0.3));
    let lo = -sd.right.reach;
    let hi = sd.left.reach;
    const seamL = sd.left.seam ? [sd.left.seam.x, sd.left.seam.y, sd.left.seam.z] : null;
    const seamR = sd.right.seam ? [sd.right.seam.x, sd.right.seam.y, sd.right.seam.z] : null;
    const isClosed = closing.has(i) || hi - lo <= 1e-3;
    let road: Corners;
    if (isClosed) {
      // Nothing of the road shows: its corners meet at the cut. On the ring where the road closes
      // that is the master's edge itself; elsewhere a little under the master's face, so the
      // triangles towards the next ring never lie level with it (no flickering slivers).
      const seam = seamL ?? seamR;
      const u = Math.min(own.edge, Math.max(-own.edge, (lo + hi) / 2));
      const seamV = seam ? seam[1] - r.c.y : lift(u);
      const point = closing.has(i) && seam ? seam : at(u, Math.min(lift(u), seamV) - MERGE_TUCK);
      lo = u;
      hi = u;
      road = [point, point, point];
    } else {
      const right = seamR ?? at(lo, lift(lo));
      const left = seamL ?? at(hi, lift(hi));
      // From a seam the road climbs (or drops) to its own surface over MERGE_RAMP, then runs on it.
      // Without one the middle corner is the right end: one face across, as before P3.5. Why not a
      // corner at the centre always: a ray exactly along that edge may slip between its triangles
      // (Rapier's trimesh), and on an ordinary deck every car and test drives along the centre.
      let middle = right;
      if (seamR && !seamL) {
        const u = Math.min(hi, lo + MERGE_RAMP);
        middle = at(u, lift(u));
      } else if (seamL && !seamR) {
        const u = Math.max(lo, hi - MERGE_RAMP);
        middle = at(u, lift(u));
      } else if (seamL && seamR) {
        middle = right.map((v, k) => (v + left[k]) / 2);
      }
      road = [right, middle, left];
    }
    const side = (sign: 1 | -1, s: DeckSide, end: number[], endU: number): Corners => {
      const w = s.wall;
      const slabBottom = at(sign * own.edge, lift(sign * own.edge) - SLAB);
      const girder = at(sign * gw, -depth);
      if (!w) return [end, end, end, at(endU, lift(endU) - SLAB), slabBottom, girder];
      // A wall whose road does not run up to it stands partly on the master's slab: its inner face
      // starts below the road, so the master's face (up to MERGE_MAX_DZ lower) meets it.
      const isAtWall = !isClosed && Math.abs(sign * endU - w.inner) < 1e-6;
      const inner = sign * w.inner;
      const outer = sign * w.outer;
      return [
        at(inner, lift(inner) - (isAtWall ? 0 : MERGE_SKIRT)),
        at(inner, lift(inner) + ph),
        at(outer, lift(outer) + ph),
        at(outer, lift(outer) - SLAB),
        slabBottom,
        girder,
      ];
    };
    const left = side(1, sd.left, road[2], hi);
    const right = side(-1, sd.right, road[0], lo).toReversed();
    const loop = [...road, ...left, ...right];
    loop.push(loop[0]);
    return loop;
  };
  const pos: number[] = [];
  const col: number[] = [];
  const solid: number[] = [];
  const sections = [corners(0)];
  for (let i = 1; i < m; i++) {
    const prev = sections[i - 1];
    const cur = corners(i);
    sections.push(cur);
    for (let k = 0; k + 1 < cur.length; k++) {
      const a = prev[k];
      const b = prev[k + 1];
      const c = cur[k + 1];
      const d = cur[k];
      const colour = faceColour(k);
      const isSolid = SOLID_FACES.has(k);
      // Faces wind so their front is outward for a loop drawn left → right over the top.
      for (const tri of [
        [a, d, c],
        [a, c, b],
      ]) {
        const isDegenerate = triangleArea2(tri[0], tri[1], tri[2]) < 1e-8;
        if (isDegenerate) continue;
        for (const p of tri) pos.push(p[0], p[1], p[2]);
        for (let v = 0; v < 3; v++) col.push(...colour);
        if (isSolid) for (const p of tri) solid.push(p[0], p[1], p[2]);
      }
    }
    const checkpoint = i % 16 === 0;
    if (checkpoint) yield;
  }
  const marks = planDeckMarkings(
    chunk,
    rings.map((r, i) => ({ s: r.frame.s, sides: sides[i] })),
  );
  yield* paintTriangles(marks, rings, sections, pos, col);
  const stationTangents = rings.flatMap((r) => (r.isStation ? [r.t] : []));
  const piers = pierTriangles(chunk, place, stationTangents, pos, col);
  const index = new Uint32Array(solid.length / 3);
  for (let i = 0; i < index.length; i++) index[i] = i;
  return {
    arrays: { position: new Float32Array(pos), color: new Float32Array(col) },
    stations: centre,
    tangents: stationTangents,
    collider: { position: new Float32Array(solid), index },
    piers,
    marks,
    rings,
    sides,
    skipped: merge?.skipped.get(chunk.id) ?? [],
  };
}

/** Twice the area of a triangle (the length of its edges' cross product). */
function triangleArea2(a: number[], b: number[], c: number[]): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Whether some of a ring's road shows (its two ends do not meet). */
const isOpen = (sd: RingSides) => sd.left.reach + sd.right.reach > 1e-3;
const hasSeam = (sd: RingSides) => sd.left.seam !== null || sd.right.seam !== null;

/**
 * More rings where decks are made one (expresswayMerge.ts), between two rings of the chunk:
 * - one through each of the master's edge vertices where this deck is cut at its edge, so the cut
 *   follows the master's edge polyline vertex for vertex (a straight cut between the rings' own seam
 *   points left gaps and overlaps of up to ~6 cm on curves: the sagitta of the two decks' different
 *   ring spacings);
 * - where the road closes (its visible width passes zero), one ring whose road ends on the master's
 *   edge, so the triangles beside it end there;
 * - where a 壁高欄 starts or stops, two rings at one place, the wall's state before and after, so it
 *   ends square instead of sloping down over the whole interval (the ramp of two walls crossing at a
 *   nose; and a 0.36 m step against the master's road beside it).
 * Events are found by bisection to 1/4096 of the interval (≤ 5 mm).
 *
 * The new rings lie on the straight pieces between the old ones: the slab's face, and so the
 * graph's surfaceY along the centre (expresswayRoads.ts has a point at the old rings only), does
 * not change.
 */
function* refineRings(
  own: ChunkRings,
  baseSides: RingSides[],
  merge: DeckMerge,
): Generator<void, { rings: DeckRing[]; sides: RingSides[]; closing: Set<number> }> {
  const base = own.rings;
  const rings: DeckRing[] = [base[0]];
  const sides: RingSides[] = [baseSides[0]];
  const closing = new Set<number>();
  const edgeCache = new Map<string, Vector3[][]>();
  const edgesOf = (run: string, edge: 1 | -1) => {
    const key = `${run}|${edge}`;
    let lines = edgeCache.get(key);
    if (!lines) {
      lines = merge.edgeLines(run, edge, own);
      edgeCache.set(key, lines);
    }
    return lines;
  };
  for (let i = 0; i + 1 < base.length; i++) {
    // A slice per few intervals: a 浜崎橋-sized JCT bisects many events in one chunk.
    const checkpoint = i % 6 === 5;
    if (checkpoint) yield;
    const a = base[i];
    const b = base[i + 1];
    const sa = baseSides[i];
    const sb = baseSides[i + 1];
    type Extra = { tau: number; ring: DeckRing; sides: RingSides; isClosing: boolean };
    const extra: Extra[] = [];
    const sidesAt = (tau: number) => merge.sides(own, ringBetween(a, b, tau, false));
    /** The last τ where `holds` is as at a and the first where it is as at b. */
    const bisect = (holds: (sd: RingSides) => boolean) => {
      let lo = 0;
      let hi = 1;
      let atLo = sa;
      let atHi = sb;
      const want = holds(sa);
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        const sd = sidesAt(mid);
        if (holds(sd) === want) [lo, atLo] = [mid, sd];
        else [hi, atHi] = [mid, sd];
      }
      return { lo, hi, atLo, atHi };
    };
    const masters = new Map<string, { run: string; edge: 1 | -1 }>();
    for (const sd of [sa, sb])
      for (const s of [sd.left, sd.right])
        if (s.seamOf) masters.set(`${s.seamOf.run}|${s.seamOf.edge}`, s.seamOf);
    const ex = b.c.x - a.c.x;
    const ez = b.c.z - a.c.z;
    const len2 = ex * ex + ez * ez;
    for (const { run, edge } of masters.values()) {
      for (const line of edgesOf(run, edge))
        for (const e of line) {
          const isAfterA = (e.x - a.c.x) * a.t.x + (e.z - a.c.z) * a.t.z > 0.01;
          const isBeforeB = (e.x - b.c.x) * b.t.x + (e.z - b.c.z) * b.t.z < -0.01;
          if (!isAfterA || !isBeforeB || len2 < 1e-9) continue;
          const tau = ((e.x - a.c.x) * ex + (e.z - a.c.z) * ez) / len2;
          const isInside = tau > 1e-3 && tau < 1 - 1e-3;
          if (!isInside) continue;
          const ring = ringBetween(a, b, tau, true);
          extra.push({ tau, ring, sides: merge.sides(own, ring), isClosing: false });
        }
    }
    const closes = isOpen(sa) !== isOpen(sb) && (hasSeam(sa) || hasSeam(sb));
    if (closes) {
      const { hi, atHi, lo, atLo } = bisect(isOpen);
      // The open one of the two: its road is a sliver whose corners meet at the seam.
      const [tau, sd] = isOpen(atHi) ? [hi, atHi] : [lo, atLo];
      extra.push({ tau, ring: ringBetween(a, b, tau, false), sides: sd, isClosing: true });
    }
    for (const key of ["left", "right"] as const) {
      const hasWall = (sd: RingSides) => sd[key].wall !== null;
      // Where the seam starts sliding off the master's face (seamWeight leaves 1): one ring
      // there, so the stretch at the face is exact and only the sliding stretch is linear.
      const isExact = (sd: RingSides) => sd[key].seam === null || sd[key].seamWeight >= 1;
      const slides = isExact(sa) !== isExact(sb);
      if (slides) {
        const { lo, atLo, hi, atHi } = bisect(isExact);
        const [tau, sd] = isExact(atLo) ? [lo, atLo] : [hi, atHi];
        extra.push({ tau, ring: ringBetween(a, b, tau, false), sides: sd, isClosing: false });
      }
      const switches = hasWall(sa) !== hasWall(sb);
      if (!switches) continue;
      const { lo, hi, atLo, atHi } = bisect(hasWall);
      const tau = (lo + hi) / 2;
      const ring = ringBetween(a, b, tau, false);
      // Both at one place: the faces between them are the wall's square end.
      extra.push({ tau: tau - 1e-9, ring, sides: atLo, isClosing: false });
      extra.push({ tau: tau + 1e-9, ring, sides: atHi, isClosing: false });
    }
    let last = -1;
    for (const x of extra.toSorted((p, q) => p.tau - q.tau)) {
      const isRepeat = x.tau - last < 1e-4 && !x.isClosing && x.ring !== rings[rings.length - 1];
      if (isRepeat) continue;
      last = x.tau;
      if (x.isClosing) closing.add(rings.length);
      rings.push(x.ring);
      sides.push(x.sides);
    }
    rings.push(b);
    sides.push(sb);
  }
  return { rings, sides, closing };
}

/**
 * The plan's lines and 導流帯 as thin white quads PAINT_LIFT over the road, between the rings they
 * span (positions linear between two rings, as the slab's faces are). The road's top at offset u on
 * a ring is the polyline of its three road corners; past a cut deck's road end the master's face
 * continues level with the seam, which a 導流帯 crosses. A step per line or 導流帯 (the FrameWork
 * splits there), and the rings are found by bisection: the linear scans made a chunk's paint one
 * 5–12 ms slice (review of P3).
 */
function* paintTriangles(
  marks: XwMarkingPlan,
  rings: DeckRing[],
  sections: Corners[],
  pos: number[],
  col: number[],
): Generator<void> {
  const ss = rings.map((r) => r.frame.s);
  /** Index of the last ring at or before s (0 … n − 2). */
  const below = (s: number) => {
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const isBefore = ss[mid] <= s;
      if (isBefore) lo = mid;
      else hi = mid;
    }
    return Math.min(lo, ss.length - 2);
  };
  // Each ring's road corners as (offset, height over the centre): offsets along its own line.
  const profile = sections.map((corners, i) => {
    const r = rings[i];
    return corners.slice(0, 3).map((p) => ({
      u: (p[0] - r.c.x) * r.t.z - (p[2] - r.c.z) * r.t.x,
      v: p[1] - r.c.y,
    }));
  });
  const heightAt = (i: number, u: number) => {
    const [a, b, c] = profile[i];
    if (u <= a.u) return a.v;
    if (u >= c.u) return c.v;
    const [p, q] = u <= b.u ? [a, b] : [b, c];
    return p.v + ((q.v - p.v) * (u - p.u)) / (q.u - p.u || 1);
  };
  const at = (s: number, u: number) => {
    const i = below(s);
    const t = Math.min(1, Math.max(0, (s - ss[i]) / (ss[i + 1] - ss[i] || 1)));
    const a = ringPoint(rings[i], u, heightAt(i, u) + PAINT_LIFT);
    const b = ringPoint(rings[i + 1], u, heightAt(i + 1, u) + PAINT_LIFT);
    return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t];
  };
  const quad = (p: number[][], colour: number[]) => {
    pos.push(...p[0], ...p[3], ...p[2], ...p[0], ...p[2], ...p[1]);
    for (let v = 0; v < 6; v++) col.push(...colour);
  };
  // A strip along s from a to b at offset u, cut at the rings so it lies on the faces.
  const strip = (a: number, b: number, u: number, width: number, colour: number[]) => {
    const cuts = [a];
    for (let k = below(a) + 1; k < ss.length && ss[k] < b; k++) if (ss[k] > a) cuts.push(ss[k]);
    cuts.push(b);
    for (let k = 1; k < cuts.length; k++) {
      const s0 = cuts[k - 1];
      const s1 = cuts[k];
      quad(
        [at(s0, u + width / 2), at(s0, u - width / 2), at(s1, u - width / 2), at(s1, u + width / 2)],
        colour,
      );
    }
  };
  for (const line of marks.lines) {
    const colour = line.colour === "yellow" ? PAINT_YELLOW : PAINT_WHITE;
    for (const [a, b] of dashWindows(line)) strip(a, b, line.offset, line.width, colour);
    yield;
  }
  const outline = ZEBRA.value.outline;
  for (const zebra of marks.zebras) {
    for (let k = 1; k < zebra.s.length; k++) {
      for (const border of [zebra.inner, zebra.outer]) {
        const s0 = zebra.s[k - 1];
        const s1 = zebra.s[k];
        quad(
          [
            at(s0, border[k - 1] + outline / 2),
            at(s0, border[k - 1] - outline / 2),
            at(s1, border[k] - outline / 2),
            at(s1, border[k] + outline / 2),
          ],
          PAINT_WHITE,
        );
      }
    }
    for (const q of zebraStripes(zebra))
      quad(
        q.map(([s, u]) => at(s, u)),
        PAINT_WHITE,
      );
    yield;
  }
}

/**
 * Piers at the compiled distances (they never move between builds), as boxes from 0.6 m into the
 * ground to the girder's soffit, in the chunk's own triangles. Why not an InstancedMesh per chunk
 * (knowledge/road-redesign-plan.md 4.5): with ~40 chunks drawn that doubled the draw calls (and the
 * shadow pass's), which showed up as slower ordinary frames in the A/B; a box is 36 vertices, so
 * baking costs nothing. The same boxes are the piers' cuboid colliders.
 */
function pierTriangles(
  chunk: XwChunk,
  place: GeoToLocal,
  tangents: Vector3[],
  pos: number[],
  col: number[],
): PierBox[] {
  const across =
    (carriagewayWidth(chunk) + 2 * PARAPET_WIDTH.value) * GIRDER_BOTTOM_SHARE * 2 * PIER_ACROSS_SHARE;
  const count = chunk.piers.length / PIER_STRIDE;
  const boxes: PierBox[] = [];
  for (let p = 0; p < count; p++) {
    const s = chunk.piers[p * PIER_STRIDE];
    const groundTp = chunk.piers[p * PIER_STRIDE + 1];
    const i = stationIndexAt(chunk, s);
    const s0 = chunk.st[i * STATION_STRIDE];
    const s1 = chunk.st[(i + 1) * STATION_STRIDE];
    const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)));
    const lon = chunk.st[i * STATION_STRIDE + 1] * (1 - t) + chunk.st[(i + 1) * STATION_STRIDE + 1] * t;
    const lat = chunk.st[i * STATION_STRIDE + 2] * (1 - t) + chunk.st[(i + 1) * STATION_STRIDE + 2] * t;
    // On the plan line between the stations, at the height of the Hermite surface there.
    const c = place.frame.toLocal(lat, lon, place.ellipsoidal(lat, lon, surfaceAt(chunk.st, s).z));
    const bottom = place.frame.toLocal(lat, lon, place.ellipsoidal(lat, lon, groundTp)).y - PIER_FOOT;
    const top = c.y - chunk.girder + 0.05;
    const isTooShort = top - bottom < 0.5;
    if (isTooShort) continue;
    const f = tangents[i]
      .clone()
      .lerp(tangents[i + 1], t)
      .normalize();
    const l = new Vector3(f.z, 0, -f.x);
    const corner = (a: number, b: number, y: number) => [
      c.x + f.x * a * (PIER_ALONG / 2) + l.x * b * (across / 2),
      y,
      c.z + f.z * a * (PIER_ALONG / 2) + l.z * b * (across / 2),
    ];
    const ring: Array<[number, number]> = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ];
    for (let k = 0; k < 4; k++) {
      const [a1, b1] = ring[k];
      const [a2, b2] = ring[(k + 1) % 4];
      const p1 = corner(a1, b1, bottom);
      const p2 = corner(a2, b2, bottom);
      const p3 = corner(a2, b2, top);
      const p4 = corner(a1, b1, top);
      pos.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
      for (let v = 0; v < 6; v++) col.push(...PIER);
    }
    boxes.push({
      centre: new Vector3(c.x, (top + bottom) / 2, c.z),
      half: new Vector3(PIER_ALONG / 2, (top - bottom) / 2, across / 2),
      yaw: Math.atan2(f.x, f.z),
    });
  }
  return boxes;
}

type Built = {
  chunk: XwChunk;
  mesh: Mesh;
  lon: number;
  lat: number;
  /** The frame the mesh's and the collider's vertices were made in. */
  frame: LocalFrame;
  collider: ColliderArrays;
  piers: PierBox[];
  body: RAPIER.RigidBody | null;
};

/** Whether meta.json is of the format this code reads (format.ts XW_VERSION). */
export function isSupportedMeta(meta: Pick<XwMeta, "version">): boolean {
  return meta.version === XW_VERSION;
}

/** The fixed body of a chunk: its trimesh and pier cuboids, placed in the current frame. */
export function createDeckBody(
  world: RAPIER.World,
  collider: ColliderArrays,
  piers: readonly PierBox[],
  toCurrent: { matrix: Matrix4; rotation: Quaternion } | null,
): { body: RAPIER.RigidBody; colliders: RAPIER.Collider[] } {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliders: RAPIER.Collider[] = [];
  const hasTriangles = collider.index.length >= 3;
  if (hasTriangles)
    colliders.push(
      world.createCollider(
        RAPIER.ColliderDesc.trimesh(collider.position, collider.index).setFriction(1.0),
        body,
      ),
    );
  for (const p of piers) {
    const half = Math.sin(p.yaw / 2);
    const desc = RAPIER.ColliderDesc.cuboid(p.half.z, p.half.y, p.half.x)
      .setTranslation(p.centre.x, p.centre.y, p.centre.z)
      .setRotation({ x: 0, y: half, z: 0, w: Math.cos(p.yaw / 2) });
    colliders.push(world.createCollider(desc, body));
  }
  // Made from vertices of an older frame: carried over like every body on a change of origin.
  if (toCurrent) reanchorBody(body, toCurrent.matrix, toCurrent.rotation);
  return { body, colliders };
}

export class ExpresswayDecks {
  private meta: Promise<XwMeta | null> | null = null;
  private runs: ReadonlyMap<string, XwRunSummary> = new Map();
  private readonly tiles = new Map<string, Promise<XwTile | null>>();
  /** Chunks of the tiles read so far, by id (what the graph and the neighbour tests see). */
  private readonly known = new Map<string, XwChunk>();
  private index: DeckIndex = new DeckIndex(new Map());
  private readonly built = new Map<string, Built>();
  private readonly colliderHandles = new Set<number>();
  /** Chunks whose deck failed to build: not tried again, and they hold no car. */
  private readonly failed = new Set<string>();
  /** Since when each chunk near the car has had no collider (isReadyNear's time limit). */
  private readonly heldSince = new Map<string, number>();
  private holdExpired = false;
  /** meta.json answered with nothing usable: no decks will come. */
  private hasNoData = false;
  private readonly work = new SerialWork();
  /** Shared by every chunk's mesh, made at the first one (the textures load only with decks). */
  private material: Material | null = null;
  private centre: { lat: number; lon: number } | null = null;
  /** The centre of the last refresh that finished (every collider in reach of it built). */
  private settled: { lat: number; lon: number } | null = null;
  private frame: LocalFrame;

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World | null,
    private readonly ellipsoidal: Ellipsoidal,
    frame: LocalFrame,
    private readonly base: string,
    private readonly bank = false,
  ) {
    this.frame = frame;
  }

  /** Bring the decks around a point in (and drop far ones); cheap to call every frame. */
  update(lat: number, lon: number): void {
    const last = this.centre;
    const hasMoved = !last || haversine(lon, lat, last.lon, last.lat) > MOVE_BEFORE_UPDATE_M;
    if (!hasMoved) return;
    this.centre = { lat, lon };
    void this.work
      .run(() => this.refresh(lat, lon))
      .catch((error: unknown) => warn("expressway_tile_failed", { key: "update", error: String(error) }));
  }

  /** The local frame moved (floating origin): carry every deck and body by the same rigid transform. */
  setFrame(frame: LocalFrame): void {
    const m = frame.transformFrom(this.frame);
    const q = frame.rotationFrom(this.frame);
    this.frame = frame;
    for (const b of this.built.values()) {
      b.mesh.applyMatrix4(m);
      if (b.body) reanchorBody(b.body, m, q);
    }
  }

  /** How many chunks are drawn (for checks). */
  chunkCount(): number {
    return this.built.size;
  }

  /** How many chunks have a collider (for checks). */
  colliderCount(): number {
    let n = 0;
    for (const b of this.built.values()) if (b.body) n++;
    return n;
  }

  /** Whether the chunk has its collider: a car may be put on it, the graph may offer it. */
  isSolid(xid: string): boolean {
    return this.built.get(xid)?.body != null;
  }

  /**
   * Whether every deck within HOLD_RADIUS_M of a point has its collider (a car there may run).
   * Chunks of tiles not read yet do not hold anything: there is nothing to fall through yet.
   */
  isReadyNear(lat: number, lon: number, now = performance.now()): boolean {
    const waiting: string[] = [];
    for (const c of this.known.values()) {
      const isNear = distanceTo(c, lon, lat) < HOLD_RADIUS_M;
      const isWaiting = isNear && !this.isSolid(c.id) && !this.failed.has(c.id);
      if (isWaiting) waiting.push(c.id);
    }
    for (const id of this.heldSince.keys()) if (!waiting.includes(id)) this.heldSince.delete(id);
    if (waiting.length === 0) {
      this.holdExpired = false;
      return true;
    }
    for (const id of waiting) if (!this.heldSince.has(id)) this.heldSince.set(id, now);
    const heldMs = now - Math.min(...waiting.map((id) => this.heldSince.get(id)!));
    // Not forever (a refresh that never comes must not freeze the game): let go after HOLD_MAX_MS.
    const isExpired = heldMs > HOLD_MAX_MS;
    if (!isExpired) return false;
    if (!this.holdExpired) warn("expressway_hold_expired", { chunks: waiting, heldMs: Math.round(heldMs) });
    this.holdExpired = true;
    return true;
  }

  /**
   * Whether the decks around a point are complete: the last refresh that finished was there (a
   * warp lands only then, knowledge/road-redesign-plan.md 4.5). True when there is no data at all.
   */
  isSettledAt(lat: number, lon: number): boolean {
    // No data at all (meta.json missing or of another version): nothing to wait for. Not before the
    // first answer: right after update() the meta is still on its way.
    const isOff = this.hasNoData;
    if (isOff) return true;
    const s = this.settled;
    return s !== null && haversine(lon, lat, s.lon, s.lat) <= MOVE_BEFORE_UPDATE_M;
  }

  /**
   * The deck surface under (x, y, z) in the current frame: the highest deck collider hit by a ray
   * down from y, or null where there is none. For groundY(x, z, nearY) in main.ts.
   */
  surfaceBelow(x: number, y: number, z: number): number | null {
    const world = this.world;
    const hasColliders = world !== null && this.colliderHandles.size > 0;
    if (!hasColliders) return null;
    const hit = world.castRay(
      new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }),
      60,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.colliderHandles.has(collider.handle),
    );
    return hit ? y - hit.timeOfImpact : null;
  }

  /**
   * The road-graph input for the chunks around a point (expresswayRoads.ts): every chunk of the
   * tiles there within GRAPH_RADIUS_M, frame-free. Null without data.
   */
  async roadInput(lat: number, lon: number): Promise<XwRoadInput | null> {
    const meta = await this.loadMeta();
    if (!meta) return null;
    const chunks = (await this.chunksAround(meta, lat, lon)).filter(
      (c) => distanceTo(c, lon, lat) <= GRAPH_RADIUS_M,
    );
    return expresswayRoadInput(chunks, meta.runs, this.ellipsoidal);
  }

  private loadMeta(): Promise<XwMeta | null> {
    this.meta ??= fetch(`${this.base}data/expressway/meta.json`)
      .then((r) => (r.ok ? (r.json() as Promise<XwMeta>) : null))
      .catch((error: unknown) => {
        warn("expressway_tile_failed", { key: "meta", error: String(error) });
        return null;
      })
      .then((meta) => {
        if (meta === null) {
          this.meta = null;
          this.hasNoData = true;
          return null;
        }
        // Another format (old tiles in a cache, a half-deployed build) would be read wrongly:
        // no decks, and not asked again (a version never changes under a running page).
        if (!isSupportedMeta(meta)) {
          warn("expressway_tile_failed", {
            key: "meta",
            error: `version ${String(meta.version)} ≠ ${XW_VERSION}`,
          });
          this.hasNoData = true;
          return null;
        }
        this.runs = new Map(meta.runs.map((r) => [r.id, r]));
        this.index = new DeckIndex(this.runs);
        this.hasNoData = false;
        return meta;
      });
    return this.meta;
  }

  private loadTile(key: string): Promise<XwTile | null> {
    let p = this.tiles.get(key);
    if (!p) {
      p = fetch(`${this.base}data/expressway/${key}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<XwTile>) : null))
        .catch((error: unknown) => {
          warn("expressway_tile_failed", { key, error: String(error) });
          return null;
        })
        .then((tile) => {
          // A failure is not remembered: the next refresh asks again (a dropped connection is not
          // a missing tile; meta.json says which tiles exist).
          if (tile === null) this.tiles.delete(key);
          const fresh: XwChunk[] = [];
          for (const c of tile?.chunks ?? []) {
            if (!this.known.has(c.id)) fresh.push(c);
            this.known.set(c.id, c);
            this.index.add(c);
          }
          this.announceCuts(fresh);
          return tile;
        });
      this.tiles.set(key, p);
    }
    return p;
  }

  /**
   * Called with the cut points (deckCuts.ts, ellipsoidal heights) of every chunk as its tile is
   * read: main.ts hands them to the buildings, which cut what stands into the decks (P4).
   */
  onCutPoints: ((points: DeckCutGeodetic[]) => void) | null = null;
  // Set it before the first update(): the tiles read before it is set are not announced again.

  private announceCuts(chunks: readonly XwChunk[]): void {
    const listener = this.onCutPoints;
    if (!listener || chunks.length === 0) return;
    // Isolated: this runs inside loadTile's promise, and a throw here would leave a rejected
    // promise in this.tiles, so the tile's decks would never be built.
    try {
      const points = chunks.flatMap((c) =>
        deckCutPoints(c).map((p) => ({
          lat: p.lat,
          lon: p.lon,
          h: this.ellipsoidal(p.lat, p.lon, p.soffitTp),
          top: this.ellipsoidal(p.lat, p.lon, p.roadTp),
        })),
      );
      listener(points);
    } catch (failure) {
      error("expressway_cuts_failed", { chunks: chunks.length, error: String(failure) });
    }
  }

  /** The listed tiles of the 3 × 3 around a point (z14, ~2 km: every deck near it is in one). */
  private tilesNear(meta: XwMeta, lat: number, lon: number): Promise<Array<XwTile | null>> {
    const listed = new Set(meta.tiles);
    const [cx, cy] = tileKey(lon, lat, Z).split("-").map(Number);
    const keys: string[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.push(`${cx + dx}-${cy + dy}`);
    return Promise.all(keys.filter((k) => listed.has(k)).map((k) => this.loadTile(k)));
  }

  /**
   * The tiles round a chunk (scripts/expressway.ts files a chunk under its middle station, at most
   * 150 m from any part of it, so every chunk it shares a surface with is in one of them).
   */
  private async tilesAround(meta: XwMeta, c: XwChunk): Promise<boolean> {
    const mid = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
    const tiles = await this.tilesNear(meta, c.st[mid + ST.lat], c.st[mid + ST.lon]);
    return tiles.every((t) => t !== null);
  }

  private async chunksAround(meta: XwMeta, lat: number, lon: number): Promise<XwChunk[]> {
    const tiles = await this.tilesNear(meta, lat, lon);
    // A chunk is in one tile only; by id all the same, so a repeat could never be built twice.
    const byId = new Map<string, XwChunk>();
    for (const c of tiles.flatMap((t) => t?.chunks ?? [])) if (!byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()];
  }

  private async refresh(lat: number, lon: number): Promise<void> {
    const started = performance.now();
    const meta = await this.loadMeta();
    if (!meta) return;
    const chunks = await this.chunksAround(meta, lat, lon);
    const wanted = chunks
      .map((c) => ({ c, d: distanceTo(c, lon, lat) }))
      .filter(({ c, d }) => d <= RENDER_RADIUS_M && !this.built.has(c.id) && !this.failed.has(c.id))
      .sort((a, b) => a.d - b.d);
    const work = new FrameWork();
    let bodyMsMax = 0;
    const yieldFrame = () => work.yield();
    const yieldIfSpent = async () => {
      const isSpent = work.spentMs() >= SLICE_BUDGET_MS;
      if (isSpent) await yieldFrame();
    };
    const addBodyMeasured = (b: Built) => {
      const t0 = performance.now();
      work.measure(() => this.addBody(b));
      bodyMsMax = Math.max(bodyMsMax, performance.now() - t0);
    };
    let dropped = 0;
    let builtCount = 0;
    let bodies = 0;
    let bodiesDropped = 0;
    for (const [id, b] of this.built) {
      const d = haversine(lon, lat, b.lon, b.lat);
      const isFar = d > DROP_RADIUS_M;
      const isOutOfReach = distanceTo(b.chunk, lon, lat) > COLLIDER_DROP_M;
      if (isOutOfReach && b.body) {
        this.removeBody(b);
        bodiesDropped++;
      }
      if (!isFar) continue;
      this.dispose(b);
      this.built.delete(id);
      dropped++;
    }
    const isSuperseded = () => this.centre?.lat !== lat || this.centre?.lon !== lon;
    // Colliders first for decks already drawn that the player now nears.
    for (const b of this.built.values()) {
      if (isSuperseded()) break;
      const isInReach = !b.body && distanceTo(b.chunk, lon, lat) <= COLLIDER_RADIUS_M;
      if (!isInReach) continue;
      await yieldIfSpent();
      addBodyMeasured(b);
      bodies++;
    }
    for (const { c, d } of wanted) {
      // The player has moved on and a newer refresh is queued: stop here, it builds what is near now.
      if (isSuperseded()) break;
      const frame = this.frame;
      const place = { frame, ellipsoidal: this.ellipsoidal };
      // One chunk that fails (bad data, a bug) must not stop the others nor hold the car: it is
      // left out from then on, with one warning.
      try {
        // The decks it is made one with must be known first, or its slab would depend on which
        // tiles happened to be read (and its master's rails on whether it had been built).
        // A tile that failed to load may hold the deck it is one slab with: built now, its slab
        // would differ from the one built later. It waits for the next refresh (the tile is asked
        // again, loadTile forgets a failure).
        const hasNeighbours = await this.tilesAround(meta, c);
        if (!hasNeighbours) continue;
        const result = await work.run(deckArraySteps(c, place, this.bank, { index: this.index }));
        for (const x of result.skipped)
          log("expressway_merge_skipped", {
            chunk: c.id,
            with: x.with,
            reason: x.reason,
            s0: Math.round(x.s0 * 10) / 10,
            s1: Math.round(x.s1 * 10) / 10,
            maxDzM: Math.round(x.maxDzM * 1000) / 1000,
          });
        await yieldIfSpent();
        const built = work.measure(() => this.publish(c, result, frame));
        // Built in the frame of its start: carry it over if the origin moved meanwhile.
        const hasMoved = frame !== this.frame;
        if (hasMoved) built.mesh.applyMatrix4(this.frame.transformFrom(frame));
        this.built.set(c.id, built);
        builtCount++;
        const isInReach = d <= COLLIDER_RADIUS_M;
        if (isInReach) {
          await yieldIfSpent();
          addBodyMeasured(built);
          bodies++;
        }
      } catch (error) {
        this.failed.add(c.id);
        warn("expressway_chunk_failed", { chunk: c.id, error: String(error) });
      }
      // A new mesh's first draw costs the GPU too: give rendering its own frame.
      await yieldFrame();
    }
    if (!isSuperseded()) this.settled = { lat, lon };
    const hasChanged = builtCount > 0 || dropped > 0 || bodies > 0 || bodiesDropped > 0;
    if (!hasChanged) return;
    log("expressway_decks_built", {
      chunks: this.built.size,
      built: builtCount,
      dropped,
      colliders: this.colliderCount(),
      collidersBuilt: bodies,
      collidersDropped: bodiesDropped,
      cpuMs: Math.round(work.cpuMs * 10) / 10,
      maxSliceMs: Math.round(work.maxSliceMs * 10) / 10,
      sliceP50Ms: quantile([...work.slices, work.spentMs()], 0.5),
      sliceP90Ms: quantile([...work.slices, work.spentMs()], 0.9),
      bodyMsMax: Math.round(bodyMsMax * 10) / 10,
      durationMs: Math.round(performance.now() - started),
    });
  }

  private publish(
    chunk: XwChunk,
    result: { arrays: DeckArrays; collider: ColliderArrays; piers: PierBox[] },
    frame: LocalFrame,
  ): Built {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(result.arrays.position, 3));
    g.setAttribute("color", new Float32BufferAttribute(result.arrays.color, 3));
    g.setAttribute(
      "aDeck",
      new Float32BufferAttribute(deckSurfaceAttribute(result.arrays.position, result.arrays.color), 3),
    );
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.material ??= createDeckMaterial();
    const mesh = new Mesh(g, this.material);
    mesh.name = `expressway-${chunk.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const mid = Math.floor(chunk.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
    return {
      chunk,
      mesh,
      lon: chunk.st[mid + 1],
      lat: chunk.st[mid + 2],
      frame,
      collider: result.collider,
      piers: result.piers,
      body: null,
    };
  }

  private addBody(b: Built): void {
    const world = this.world;
    if (!world || b.body) return;
    const isSameFrame = b.frame === this.frame;
    const toCurrent = isSameFrame
      ? null
      : { matrix: this.frame.transformFrom(b.frame), rotation: this.frame.rotationFrom(b.frame) };
    const { body, colliders } = createDeckBody(world, b.collider, b.piers, toCurrent);
    b.body = body;
    for (const c of colliders) this.colliderHandles.add(c.handle);
  }

  private removeBody(b: Built): void {
    const body = b.body;
    if (!body || !this.world) return;
    for (let i = 0; i < body.numColliders(); i++) this.colliderHandles.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
    b.body = null;
  }

  private dispose(b: Built): void {
    this.removeBody(b);
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
  }
}

/** The q-quantile of slice lengths (ms, one decimal), 0 without any. */
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = xs.toSorted((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
}

function stationIndexAt(chunk: XwChunk, s: number): number {
  const n = chunk.st.length / STATION_STRIDE;
  let i = 0;
  while (i < n - 2 && chunk.st[(i + 1) * STATION_STRIDE] < s) i++;
  return i;
}

/** Nearest distance from a point to a chunk's stations (every fourth, and the last), metres. */
export function distanceTo(c: XwChunk, lon: number, lat: number): number {
  let best = Infinity;
  for (let i = 0; i < c.st.length; i += STATION_STRIDE * 4)
    best = Math.min(best, haversine(lon, lat, c.st[i + 1], c.st[i + 2]));
  const last = c.st.length - STATION_STRIDE;
  return Math.min(best, haversine(lon, lat, c.st[last + 1], c.st[last + 2]));
}

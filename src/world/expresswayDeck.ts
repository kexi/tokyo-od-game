import RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Matrix4,
  Mesh,
  MeshStandardMaterial,
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
import { haversine, planeAt, tileKey } from "../expressway/geo";
import {
  frameAt,
  ST,
  type SurfaceFrame,
  surfaceAt,
  surfaceHeight,
  surfaceSamples,
} from "../expressway/profile";
import { carriagewayWidth } from "../expressway/section";
import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import type { LocalFrame } from "../geo/frame";
import { log, warn } from "../log";
import { reanchorBody } from "../physics/reanchor";
import {
  dashWindows,
  DeckIndex,
  planDeckMarkings,
  type RingSides,
  type XwMarkingPlan,
  zebraStripes,
} from "./expresswayMarkings";
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

export type GeoToLocal = {
  frame: LocalFrame;
  /** WGS84 ellipsoidal height of an orthometric (T.P.) one at a point. */
  ellipsoidal: Ellipsoidal;
};

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

const ASPHALT = [0.16, 0.16, 0.17];
const CONCRETE = [0.66, 0.65, 0.61];
const SOFFIT = [0.48, 0.47, 0.44];
const PIER = [0.62, 0.61, 0.57];
const PAINT_WHITE = [0.86, 0.86, 0.84];
const PAINT_YELLOW = [0.85, 0.64, 0.1];

export type DeckArrays = { position: Float32Array; color: Float32Array };
/** Triangles of the slab's top and the 壁高欄 (local frame of the build), for the trimesh. */
export type ColliderArrays = { position: Float32Array; index: Uint32Array };
/** A pier's box: centre, half extents (along, up, across) and the yaw of `along` (local frame). */
export type PierBox = { centre: Vector3; half: Vector3; yaw: number };

/** What the deck builder knows of the other decks (rails and markings where they meet). */
export type DeckContext = { index: DeckIndex };

/**
 * The extruded deck of one chunk as non-indexed triangles (flat-shaded concrete, painted lines on
 * top), in local coordinates, with its collider's triangles and pier boxes. `bank` tilts the slab
 * by the compiled superelevation (off by default, knowledge/road-redesign-plan.md 4.3 の 4).
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
  // Cross-sections ("rings") where profile.ts samples the surface: every station and as many more
  // as the Hermite surface needs to stay within 1 cm of the slab's straight faces. The graph's
  // segments (expresswayRoads.ts) have a point at every ring, so surfaceY is the face too.
  const rings: Ring[] = surfaceSamples(chunk.st).map(({ i, t }) => {
    const o = i * STATION_STRIDE;
    return ringAt(chunk, place, o, Math.min(o + STATION_STRIDE, (n - 1) * STATION_STRIDE), t);
  });
  yield;
  const m = rings.length;
  const tangents = rings.map((_, i) => {
    const a = rings[Math.max(0, i - 1)].c;
    const b = rings[Math.min(m - 1, i + 1)].c;
    return new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  });
  // The ends take the compiled heading, which the neighbouring chunk shares: a one-sided difference
  // here left the deck edges up to 0.31 m apart at seams on curves.
  tangents[0] = headingTangent(chunk, 0, chunk.h0, place);
  tangents[m - 1] = headingTangent(chunk, n - 1, chunk.h1, place);
  const hw = carriagewayWidth(chunk) / 2;
  const pw = PARAPET_WIDTH.value;
  const ph = PARAPET_HEIGHT.value;
  const edge = hw + pw;
  const gw = edge * GIRDER_BOTTOM_SHARE;
  const sides: RingSides[] = [];
  for (const side of ringSides(chunk, rings, context)) {
    sides.push(side);
    const checkpoint = sides.length % 24 === 0;
    if (checkpoint) yield;
  }
  // Cross-section corners [lateral (left +), vertical]; consecutive pairs are faces. A side whose
  // 壁高欄 is not built (it would stand on another deck) keeps its corners at the slab's top.
  const section = (i: number) => {
    const f = rings[i].frame;
    // The girder never reaches below the ground: near a ground end it shortens into a wall.
    const clear = rings[i].c.y - rings[i].groundY;
    const depth = Math.max(SLAB, Math.min(chunk.girder, clear + 0.3));
    // Offsets from the centre of the shared surface contract (profile.ts surfaceHeight).
    const lift = (u: number) => surfaceHeight(f, u, bank) - f.z;
    const left = sides[i].left.rail ? ph : 0;
    const right = sides[i].right.rail ? ph : 0;
    return [
      [-hw, lift(-hw)],
      [hw, lift(hw)],
      [hw, lift(hw) + left],
      [edge, lift(edge) + left],
      [edge, lift(edge) - SLAB],
      [gw, -depth],
      [-gw, -depth],
      [-edge, lift(-edge) - SLAB],
      [-edge, lift(-edge) + right],
      [-hw, lift(-hw) + right],
      [-hw, lift(-hw)],
    ];
  };
  // The faces a car meets: the road and the 壁高欄's inner faces, tops and outer faces (a car on a
  // deck alongside meets the outer one). A dropped rail's top is the slab beyond the carriageway,
  // driven on where two decks are one.
  const SOLID_FACES = new Set([0, 1, 2, 3, 7, 8, 9]);
  const faceColour = (k: number) => (k === 0 ? ASPHALT : k === 5 ? SOFFIT : CONCRETE);
  const pos: number[] = [];
  const col: number[] = [];
  const solid: number[] = [];
  const point = (i: number, u: number, v: number) => {
    const t = tangents[i];
    // Left of travel: the tangent turned 90° anticlockwise seen from above (+y up, −z north).
    const lx = t.z;
    const lz = -t.x;
    const c = rings[i].c;
    return [c.x + lx * u, c.y + v, c.z + lz * u];
  };
  const sections = [section(0)];
  for (let i = 1; i < m; i++) {
    const prev = sections[i - 1];
    const cur = section(i);
    sections.push(cur);
    for (let k = 0; k + 1 < cur.length; k++) {
      const a = point(i - 1, prev[k][0], prev[k][1]);
      const b = point(i - 1, prev[k + 1][0], prev[k + 1][1]);
      const c = point(i, cur[k + 1][0], cur[k + 1][1]);
      const d = point(i, cur[k][0], cur[k][1]);
      // Faces wind so their front is outward for a loop drawn left → right over the top.
      pos.push(...a, ...d, ...c, ...a, ...c, ...b);
      const colour = faceColour(k);
      for (let v = 0; v < 6; v++) col.push(...colour);
      if (SOLID_FACES.has(k)) solid.push(...a, ...d, ...c, ...a, ...c, ...b);
    }
    const checkpoint = i % 16 === 0;
    if (checkpoint) yield;
  }
  const marks = planDeckMarkings(
    chunk,
    rings.map((r, i) => ({ s: r.frame.s, sides: sides[i] })),
  );
  yield* paintTriangles(marks, rings, sections, point, pos, col);
  const stationTangents = rings.flatMap((r, i) => (r.isStation ? [tangents[i]] : []));
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
  };
}

/** The sides of every ring as the other loaded decks leave them (all rails up without a context). */
function* ringSides(chunk: XwChunk, rings: Ring[], context: DeckContext | null): Generator<RingSides> {
  const open = { rail: true, joined: null, otherLaneEdge: null };
  if (!context) {
    for (const _ of rings) yield { left: open, right: open };
    return;
  }
  const deck = { half: carriagewayWidth(chunk) / 2, shoulderL: chunk.shoulderL, shoulderR: chunk.shoulderR };
  const plane = planeAt(rings[0].frame.lon, rings[0].frame.lat);
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    const isFirst = i === 0;
    const isLast = i === rings.length - 1;
    let h: number;
    if (isFirst) h = chunk.h0;
    else if (isLast) h = chunk.h1;
    else {
      const [ax, ay] = plane.toXY(rings[i - 1].frame.lon, rings[i - 1].frame.lat);
      const [bx, by] = plane.toXY(rings[i + 1].frame.lon, rings[i + 1].frame.lat);
      h = Math.atan2(by - ay, bx - ax);
    }
    yield context.index.sides(chunk.run, r.frame.lon, r.frame.lat, r.frame.z, h, deck);
  }
}

/**
 * The plan's lines and 導流帯 as thin white quads PAINT_LIFT over the slab, between the rings they
 * span (positions linear between two rings, as the slab's faces are). A step per line or 導流帯 (the
 * FrameWork splits there), and the rings are found by bisection: the linear scans made a chunk's
 * paint one 5–12 ms slice (review of P3).
 */
function* paintTriangles(
  marks: XwMarkingPlan,
  rings: Ring[],
  sections: number[][][],
  point: (i: number, u: number, v: number) => number[],
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
  const ringAtS = (s: number) => {
    const i = below(s);
    const t = Math.min(1, Math.max(0, (s - ss[i]) / (ss[i + 1] - ss[i] || 1)));
    return { i, t };
  };
  // The road's top is section corner 0 → 1 (flat across unless banked): its height at offset u.
  const at = (s: number, u: number) => {
    const { i, t } = ringAtS(s);
    const hw = sections[i][1][0];
    const v0 = sections[i][0][1] + ((sections[i][1][1] - sections[i][0][1]) * (u + hw)) / (2 * hw);
    const v1 =
      sections[i + 1][0][1] + ((sections[i + 1][1][1] - sections[i + 1][0][1]) * (u + hw)) / (2 * hw);
    const a = point(i, u, v0 + PAINT_LIFT);
    const b = point(i + 1, u, v1 + PAINT_LIFT);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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

type Ring = { c: Vector3; groundY: number; frame: SurfaceFrame; isStation: boolean };

/** The cross-section at fraction t from station offset o to q (t = 0: the station itself). */
function ringAt(chunk: XwChunk, place: GeoToLocal, o: number, q: number, t: number): Ring {
  const st = chunk.st;
  const s = st[o + ST.s] + (st[q + ST.s] - st[o + ST.s]) * t;
  // The station itself is read as stored (no interpolation error at the seams between chunks).
  const f = t === 0 ? frameAt(st, st[o + ST.s]) : frameAt(st, s);
  const z = t === 0 ? st[o + ST.z] : f.z;
  const lon = t === 0 ? st[o + ST.lon] : f.lon;
  const lat = t === 0 ? st[o + ST.lat] : f.lat;
  return {
    c: place.frame.toLocal(lat, lon, place.ellipsoidal(lat, lon, z)),
    groundY: place.frame.toLocal(lat, lon, place.ellipsoidal(lat, lon, f.ground)).y,
    frame: { ...f, lon, lat, z },
    isStation: t === 0,
  };
}

/** The local-frame direction of a compiled heading at station i (a short step along it, mapped). */
function headingTangent(chunk: XwChunk, i: number, heading: number, place: GeoToLocal): Vector3 {
  const o = i * STATION_STRIDE;
  const lon = chunk.st[o + 1];
  const lat = chunk.st[o + 2];
  const step = 1e-5;
  const kx = Math.cos((lat * Math.PI) / 180);
  const p = place.frame.toLocal(lat, lon, 0);
  const q = place.frame.toLocal(lat + Math.sin(heading) * step, lon + (Math.cos(heading) * step) / kx, 0);
  return new Vector3(q.x - p.x, 0, q.z - p.z).normalize();
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
  // Double-sided like the bridge decks in water.ts: the faces wind outward, but a deck seen from
  // under its overhang must never show a hole if one face is turned the wrong way.
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
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
          for (const c of tile?.chunks ?? []) {
            this.known.set(c.id, c);
            this.index.add(c);
          }
          return tile;
        });
      this.tiles.set(key, p);
    }
    return p;
  }

  private async chunksAround(meta: XwMeta, lat: number, lon: number): Promise<XwChunk[]> {
    const listed = new Set(meta.tiles);
    const [cx, cy] = tileKey(lon, lat, Z).split("-").map(Number);
    const keys: string[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.push(`${cx + dx}-${cy + dy}`);
    const tiles = await Promise.all(keys.filter((k) => listed.has(k)).map((k) => this.loadTile(k)));
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
        const result = await work.run(deckArraySteps(c, place, this.bank, { index: this.index }));
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
    g.computeVertexNormals();
    g.computeBoundingSphere();
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

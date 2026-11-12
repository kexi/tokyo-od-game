import { Vector3 } from "three";
import { SAME_SURFACE_ALLOWED_DZ_M } from "../expressway/allowlist";
import { PARAPET_WIDTH } from "../expressway/assumptions";
import { STATION_STRIDE, type XwChunk, type XwClass, type XwRunSummary } from "../expressway/format";
import { SAME_SURFACE_M } from "../expressway/overlap";
import {
  frameAt,
  ST,
  surfaceAt,
  type SurfaceFrame,
  surfaceHeight,
  surfaceSamples,
} from "../expressway/profile";
import { carriagewayWidth } from "../expressway/section";
import type { LocalFrame } from "../geo/frame";
import { type DeckIndex, type DeckSide, type RingSides, roleOf } from "./expresswayMarkings";
import type { Ellipsoidal } from "./expresswayRoads";

/**
 * Where two decks of one surface become one slab (knowledge/road-redesign-plan.md 4.2, P3.5).
 *
 * The compiler couples the runs whose carriageways lie over one another and records the stretches
 * on each chunk (`decks`: the other run, the relation, [s0, s1]). Where the relation is "same" the
 * two decks are within 5 cm of each other, and drawn as two slabs they flickered (each showed
 * through the other) and a car crossing from one to the other met a step of up to 5 cm. Here the
 * decks of such a pair are made one:
 *
 * - Same direction (a 分合流): the deck that ends on the other (the ramp, `roleOf` "child"; between
 *   two that do not, the lower-ranked one) is cut at the other's slab edge. Its road surface stops
 *   on that edge, at the other deck's face height there (`seam`, a point of the other deck's own
 *   edge vertices), so the two faces meet with no step; the overlapping part is the other deck's
 *   face alone. The other deck (the master) drops its 壁高欄 on that side wherever the cut deck's
 *   slab reaches past its edge and runs its road out to its slab edge instead.
 * - Opposite directions (the two carriageways of C1 side by side): one slab, cut in the middle of
 *   the overlap, with one 分離壁 there (the run that sorts first builds it; `water.ts`'s
 *   otherDeckAt keeps one rail between two bridge decks the same way).
 *
 * Which decks are paired comes from `chunk.decks` alone (DeckIndex.partnersAt). Where they stand
 * comes from the decks' own rings in the local frame, the same vertices their meshes are made of,
 * so a seam is exact to the float. Why not NEIGHBOUR_DZ over all loaded decks (P3, W7): it found
 * pairs the compiler had not coupled and missed none it had, but its answer depended on heights
 * within 1.5 m, which near a two-level changeover paired decks a level apart.
 */

export type GeoToLocal = {
  frame: LocalFrame;
  /** WGS84 ellipsoidal height of an orthometric (T.P.) one at a point. */
  ellipsoidal: Ellipsoidal;
  /**
   * The terrain's ellipsoidal height at a point (the DEM the ground is drawn from), where known: a
   * cut's retaining walls reach it at their own positions (P2.7-5). Absent: the station's ground only.
   */
  groundAt?: (lat: number, lon: number) => number | null;
};

/** A cross-section of a deck in the local frame: the centre, its direction along the deck, the surface there. */
export type DeckRing = {
  c: Vector3;
  /** Horizontal unit tangent (direction of travel). Left of travel is (t.z, 0, −t.x). */
  t: Vector3;
  groundY: number;
  frame: SurfaceFrame;
  isStation: boolean;
};

/** A chunk's rings as its deck is built, with its section (metres from the centre). */
export type ChunkRings = {
  chunk: XwChunk;
  rings: DeckRing[];
  /** Half the carriageway (to the 壁高欄's inner face) and to the slab edge. */
  hw: number;
  edge: number;
  /** The lanes' left and right edges (left +). */
  laneL: number;
  laneR: number;
  bank: boolean;
  /** Plan extent in the local frame (x, z), for finding the decks near another. */
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
};

/**
 * Decks farther apart than this at a ring are not made one there, whatever the relation says: the
 * compiler couples the pair softly (|Δz| ≤ 5 cm, overlap.ts SAME_SURFACE_M) and its allowlist accepts
 * up to SAME_SURFACE_ALLOWED_DZ_M (0.14 m at 浜崎橋 JCT) as one surface and metres at the C1
 * changeover, where one slab would be a cliff. 1 cm over the allowlist, so every accepted miss is
 * drawn as one slab (tests/expresswayData.test.ts lists the same stretches past it).
 */
export const MERGE_MAX_DZ = SAME_SURFACE_ALLOWED_DZ_M + 0.01;
/**
 * Up to this the seam stands at the master's face exactly; from here to MERGE_MAX_DZ it slides to
 * the cut deck's own height (seamY = ownY + (masterY − ownY)·w), so where the pair lets go the road
 * runs on with no step across travel (review of P3.5, W1: a 0.15 m face across the road at the guard).
 */
export const MERGE_FULL_DZ = SAME_SURFACE_M;
/** How far below the master's face the hidden corners of a cut deck are put (no coplanar slivers). */
export const MERGE_TUCK = 0.03;
/**
 * How far below its own road a 壁高欄 standing partly on the master's slab starts (the master's face
 * may be up to MERGE_MAX_DZ lower there: no slit under the wall).
 */
export const MERGE_SKIRT = 0.2;
/**
 * Over this much of a cut deck's road next to the seam it goes from the master's face height to its
 * own (≤ MERGE_MAX_DZ: ≤ 15 % across, ≤ 3 % at the 5 cm the compiler aims at). Why not to the centre:
 * where the centre is a few centimetres from the seam that was a kerb-like step under the wheels.
 */
export const MERGE_RAMP = 1;

const PARAPET = PARAPET_WIDTH.value;

/** The cross-section at fraction t from station offset o to q (t = 0: the station itself). */
function ringAt(chunk: XwChunk, place: GeoToLocal, o: number, q: number, t: number) {
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
  const lon = chunk.st[o + ST.lon];
  const lat = chunk.st[o + ST.lat];
  const step = 1e-5;
  const kx = Math.cos((lat * Math.PI) / 180);
  const p = place.frame.toLocal(lat, lon, 0);
  const q = place.frame.toLocal(lat + Math.sin(heading) * step, lon + (Math.cos(heading) * step) / kx, 0);
  return new Vector3(q.x - p.x, 0, q.z - p.z).normalize();
}

const ringCache = new WeakMap<LocalFrame, WeakMap<XwChunk, ChunkRings[]>>();

/**
 * The rings of a chunk ("cross-sections" where profile.ts samples the surface: every station and as
 * many more as the Hermite surface needs to stay within 1 cm of the slab's straight faces), with
 * their tangents: central differences, and at the ends the compiled heading, which the neighbouring
 * chunk shares (a one-sided difference left the deck edges up to 0.31 m apart at seams on curves).
 * Cached per frame and chunk object (a cut deck reads its master's rings). Why not by chunk id: a
 * test or a reloaded tile may hand another object under the same id.
 */
export function chunkRings(chunk: XwChunk, place: GeoToLocal, bank = false): ChunkRings {
  let cache = ringCache.get(place.frame);
  const cached = cache?.get(chunk)?.[bank ? 1 : 0];
  if (cached) return cached;
  const n = chunk.st.length / STATION_STRIDE;
  const base = surfaceSamples(chunk.st).map(({ i, t }) => {
    const o = i * STATION_STRIDE;
    return ringAt(chunk, place, o, Math.min(o + STATION_STRIDE, (n - 1) * STATION_STRIDE), t);
  });
  const m = base.length;
  const rings: DeckRing[] = base.map((r, i) => {
    const a = base[Math.max(0, i - 1)].c;
    const b = base[Math.min(m - 1, i + 1)].c;
    return { ...r, t: new Vector3(b.x - a.x, 0, b.z - a.z).normalize() };
  });
  rings[0].t = headingTangent(chunk, 0, chunk.h0, place);
  rings[m - 1].t = headingTangent(chunk, n - 1, chunk.h1, place);
  const hw = carriagewayWidth(chunk) / 2;
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const r of rings) {
    box.minX = Math.min(box.minX, r.c.x);
    box.maxX = Math.max(box.maxX, r.c.x);
    box.minZ = Math.min(box.minZ, r.c.z);
    box.maxZ = Math.max(box.maxZ, r.c.z);
  }
  const out: ChunkRings = {
    chunk,
    rings,
    hw,
    edge: hw + PARAPET,
    laneL: hw - chunk.shoulderL,
    laneR: -(hw - chunk.shoulderR),
    bank,
    box,
  };
  if (!cache) {
    cache = new WeakMap();
    ringCache.set(place.frame, cache);
  }
  const both = cache.get(chunk) ?? [];
  both[bank ? 1 : 0] = out;
  cache.set(chunk, both);
  return out;
}

/** Height offset of the surface `u` metres left of a ring's centre (profile.ts surfaceHeight). */
export function liftAt(ring: Pick<DeckRing, "frame">, u: number, bank: boolean): number {
  return surfaceHeight(ring.frame, u, bank) - ring.frame.z;
}

/** A deck's point `u` metres left of a ring's centre, `v` above its centre height. */
export function ringPoint(ring: Pick<DeckRing, "c" | "t">, u: number, v: number): Vector3 {
  return new Vector3(ring.c.x + ring.t.z * u, ring.c.y + v, ring.c.z - ring.t.x * u);
}

/** A run's rings joined across its consecutive chunks, with the section at each ring. */
type Line = {
  rings: DeckRing[];
  /** The chunk each ring belongs to (its own sides, for a master that is itself cut). */
  owner: ChunkRings[];
  edge: number[];
  laneL: number[];
  laneR: number[];
  bank: boolean;
};

type Foot = { line: Line; k: number; tau: number; point: Vector3; tangent: Vector3 };

/** Where a ring's cross-section line meets one edge of another deck: offset along the line and the point. */
type Crossing = { u: number; point: Vector3; edge: 1 | -1 };

/** Plan cross product a × b of (x, z) vectors. */
const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;

/** The side of a ring with no other deck: road to the 壁高欄's inner face, rail at its place. */
export function openSide(own: Pick<ChunkRings, "hw" | "edge">): DeckSide {
  return {
    joined: null,
    otherLaneEdge: null,
    reach: own.hw,
    wall: { inner: own.hw, outer: own.edge },
    seam: null,
    seamOf: null,
    seamWeight: 1,
  };
}

/** Order of the classes as masters: the main line, then a structure's street, then a ramp. */
const CLASS_RANK: Readonly<Record<XwClass, number>> = { expressway: 0, street: 1, ramp: 2 };

/**
 * Rank of a deck among same-direction peers: by class (CLASS_RANK), then by id; a total order, so
 * of two decks exactly one outranks the other. Why not "the main line, else neither" (P3.5): with a
 * street (P7) a street and a ramp each took the other for its master (45177678 × 4848755).
 */
export function outranks(
  runs: ReadonlyMap<string, Pick<XwRunSummary, "cls">>,
  a: string,
  b: string,
): boolean {
  const ra = CLASS_RANK[runs.get(a)?.cls ?? "ramp"];
  const rb = CLASS_RANK[runs.get(b)?.cls ?? "ramp"];
  if (ra !== rb) return ra < rb;
  return a < b;
}

/**
 * The geometry of the merges in one local frame. One per deck build: the rings it reads are cached
 * per frame (chunkRings), the lines per chunk here.
 */
export class DeckMerge {
  private readonly lines = new Map<string, Line[]>();

  constructor(
    private readonly index: DeckIndex,
    private readonly place: GeoToLocal,
    private readonly bank = false,
  ) {}

  ringsOf(chunk: XwChunk): ChunkRings {
    return chunkRings(chunk, this.place, this.bank);
  }

  /**
   * The rings of `run` near `own`'s chunk (its known chunks whose plan extent comes within 40 m),
   * joined across consecutive chunks (the seam ring is shared, so it is kept once).
   */
  private linesNear(run: string, own: ChunkRings): Line[] {
    const key = `${run}|${own.chunk.id}`;
    const hit = this.lines.get(key);
    if (hit) return hit;
    const reach = 40;
    const near = this.index
      .chunksOf(run)
      .map((c) => this.ringsOf(c))
      .filter(
        (r) =>
          r.box.maxX >= own.box.minX - reach &&
          r.box.minX <= own.box.maxX + reach &&
          r.box.maxZ >= own.box.minZ - reach &&
          r.box.minZ <= own.box.maxZ + reach,
      );
    const out: Line[] = [];
    let prevK = -2;
    for (const r of near) {
      const isNext = r.chunk.k === prevK + 1 && out.length > 0;
      const line: Line = isNext
        ? out[out.length - 1]
        : { rings: [], owner: [], edge: [], laneL: [], laneR: [], bank: r.bank };
      if (!isNext) out.push(line);
      // The seam ring is shared, so it is kept once; but where the section changes there (a 4-lane
      // master narrowing to 2 lanes at a split) it is kept twice, with each chunk's edge, so the edge
      // polyline steps square at the seam. Why not once: the edge then slanted from the wide to the
      // narrow width over the next ring interval, a cut deck met that slant instead of the narrow
      // edge, and a sliver between them was left uncovered (813455519:0 s 4.6–6.6 under 45554540).
      const isSameEdge = isNext && Math.abs(line.edge[line.edge.length - 1] - r.edge) < 1e-6;
      const from = isNext && isSameEdge ? 1 : 0;
      for (let i = from; i < r.rings.length; i++) {
        line.rings.push(r.rings[i]);
        line.owner.push(r);
        line.edge.push(r.edge);
        line.laneL.push(r.laneL);
        line.laneR.push(r.laneR);
      }
      prevK = r.chunk.k;
    }
    this.lines.set(key, out);
    return out;
  }

  /** The nearest point of another run's centre line to p (plan), on the lines near `own`. */
  private footOf(lines: Line[], p: Vector3): Foot | null {
    let best: Foot | null = null;
    let bestD = Infinity;
    for (const line of lines) {
      for (let k = 0; k + 1 < line.rings.length; k++) {
        const a = line.rings[k].c;
        const b = line.rings[k + 1].c;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-9) continue;
        const tau = Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / len2));
        const d = Math.hypot(a.x + ex * tau - p.x, a.z + ez * tau - p.z);
        if (d >= bestD) continue;
        bestD = d;
        best = { line, k, tau, point: a.clone().lerp(b, tau), tangent: new Vector3() };
      }
    }
    if (!best) return null;
    const { line, k, tau } = best;
    best.tangent = line.rings[k].t
      .clone()
      .lerp(line.rings[k + 1].t, tau)
      .normalize();
    return best;
  }

  /** The point of a line's left (+1) or right (−1) slab edge at ring k: its mesh vertex there. */
  private edgePoint(line: Line, k: number, sign: 1 | -1): Vector3 {
    const r = line.rings[k];
    const u = sign * line.edge[k];
    return ringPoint(r, u, liftAt(r, u, line.bank));
  }

  /**
   * Where the cross-section line of `ring` meets the other deck's left (+1) or right (−1) slab edge
   * near the foot: the edge is the polyline of that deck's own edge vertices, so a point on it lies
   * on the other deck's face to the float. Null where the line meets no segment there.
   */
  private crossEdge(ring: DeckRing, foot: Foot, sign: 1 | -1): Crossing | null {
    const lx = ring.t.z;
    const lz = -ring.t.x;
    const { line } = foot;
    let best: Crossing | null = null;
    for (let k = Math.max(0, foot.k - 6); k < Math.min(line.rings.length - 1, foot.k + 7); k++) {
      const p = this.edgePoint(line, k, sign);
      const q = this.edgePoint(line, k + 1, sign);
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const den = cross(lx, lz, ex, ez);
      const isParallel = Math.abs(den) < 1e-9;
      if (isParallel) continue;
      const wx = p.x - ring.c.x;
      const wz = p.z - ring.c.z;
      const tau = cross(wx, wz, lx, lz) / den;
      const isOnSegment = tau >= -1e-9 && tau <= 1 + 1e-9;
      if (!isOnSegment) continue;
      const u = cross(wx, wz, ex, ez) / den;
      const isNearer = best === null || Math.abs(u) < Math.abs(best.u);
      if (isNearer) best = { u, point: p.clone().lerp(q, Math.min(1, Math.max(0, tau))), edge: sign };
    }
    return best;
  }

  /**
   * The other deck's edge vertices on its left (+1) or right (−1) near `own`, as polylines: a cut
   * deck puts a ring through each one inside a cut stretch (expresswayDeck.ts), so its seam follows
   * the master's edge vertex for vertex.
   */
  edgeLines(run: string, sign: 1 | -1, own: ChunkRings): Vector3[][] {
    return this.linesNear(run, own).map((line) => line.rings.map((_, k) => this.edgePoint(line, k, sign)));
  }

  /**
   * Where a pair the compiler made one surface was left apart, by chunk: the other run, why, the
   * s range and the largest miss (expresswayDeck.ts logs one expressway_merge_skipped per chunk).
   * Only rings inside an unpadded "same" stretch count: past its end the decks are meant to part.
   */
  readonly skipped = new Map<string, MergeSkip[]>();

  private skip(own: ChunkRings, s: number, other: string, reason: MergeSkip["reason"], dz: number): void {
    const isInStretch = own.chunk.decks.some(
      (d) => d.with === other && d.relation === "same" && s >= d.s0 && s <= d.s1,
    );
    if (!isInStretch) return;
    const list = this.skipped.get(own.chunk.id) ?? [];
    const last = list.find((x) => x.with === other && x.reason === reason);
    if (last) {
      last.s0 = Math.min(last.s0, s);
      last.s1 = Math.max(last.s1, s);
      last.maxDzM = Math.max(last.maxDzM, Math.abs(dz));
    } else list.push({ with: other, reason, s0: s, s1: s, maxDzM: Math.abs(dz) });
    this.skipped.set(own.chunk.id, list);
  }

  /** What one partner is at a ring: its foot, where its slab crosses this ring's line, its height. */
  private partnerAt(own: ChunkRings, ring: DeckRing, other: string) {
    const foot = this.footOf(this.linesNear(other, own), ring.c);
    if (!foot) return null;
    const lx = ring.t.z;
    const lz = -ring.t.x;
    const d = (foot.point.x - ring.c.x) * lx + (foot.point.z - ring.c.z) * lz;
    const left = this.crossEdge(ring, foot, 1);
    const right = this.crossEdge(ring, foot, -1);
    // Where the cross-section misses one of its edges (its run ends there) the pair is left apart.
    if (!left || !right) return null;
    const [lo, hi] = left.u < right.u ? [left, right] : [right, left];
    const isOverlapping = lo.u < own.edge && hi.u > -own.edge;
    if (!isOverlapping) return null;
    // Heights compared where this deck's centre is: the other's face there (its centre plus its
    // bank × the offset of this centre in its own frame), against this centre. Both centres are
    // read from the compiled surfaces (the Hermite of each chunk at the ring's s and at the foot's).
    // Why not the meshes' centres (ring.c.y, foot.point.y): those lie on the chords between rings,
    // up to 1 cm off each surface, so the miss read from them was 1–16 mm off the data's; the seam
    // then left the master's face (seamWeight) and let go up to 0.6 m away from where the data's
    // |Δz| crosses MERGE_FULL_DZ and MERGE_MAX_DZ, and stood 3–4 mm off that face where the data
    // has the pair within 5 cm (S6 PR 5: 45019020:40・:41, 4848889:0), or let go where the data
    // still has it within MERGE_MAX_DZ (24402125:0, a 15.8 cm face over the master's edge).
    const { line, k, tau } = foot;
    const r = line.rings[k];
    const q = line.rings[k + 1];
    const theirU = (ring.c.x - foot.point.x) * foot.tangent.z - (ring.c.z - foot.point.z) * foot.tangent.x;
    const theirLift = liftAt(r, theirU, line.bank) * (1 - tau) + liftAt(q, theirU, line.bank) * tau;
    const footS = r.frame.s + (q.frame.s - r.frame.s) * tau;
    const theirChunk = chunkHolding(line.owner[k].chunk, line.owner[k + 1].chunk, footS);
    const dz = compiledZ(theirChunk, footS) + theirLift - compiledZ(own.chunk, ring.frame.s);
    return { other, foot, d, lo, hi, dz, isSameWay: foot.tangent.dot(ring.t) > 0 };
  }

  /**
   * The two sides of a ring of `own` as the decks it shares a surface with leave them (DeckSide):
   * where its road ends, which 壁高欄 stand, the seam on a master's edge, and what the markings need.
   *
   * Same-direction partners first, then opposite ones, so the answer does not depend on the order of
   * `decks`: a seam on a same-direction master is kept (an opposite deck beyond it does not move the
   * road's end off the master's face), and the master's road out to its edge is then cut back by a
   * 分離壁 there. `depth` 1 is a master's own sides, read to see whether it is cut itself.
   */
  sides(own: ChunkRings, ring: DeckRing, depth = 0): RingSides {
    const run = own.chunk.run;
    const out: RingSides = { left: openSide(own), right: openSide(own) };
    const partners = this.index
      .partnersAt(own.chunk, ring.frame.s)
      .map((other) => this.partnerAt(own, ring, other))
      .filter((p) => p !== null)
      .toSorted((a, b) => Number(b.isSameWay) - Number(a.isSameWay));
    for (const p of partners) {
      // The side the other deck lies on; at a nose (centres on one point) its left.
      const sign: 1 | -1 = p.d >= 0 ? 1 : -1;
      const sideKey = sign > 0 ? "left" : "right";
      const isApart = Math.abs(p.dz) > MERGE_MAX_DZ;
      if (p.isSameWay) {
        const isMaster = outranksAsMaster(this.index, run, p.other);
        if (isApart) {
          this.skip(own, ring.frame.s, p.other, "level_apart", p.dz);
          if (!isMaster) this.letGo(out, own, p.lo, p.hi, sign);
          continue;
        }
        // A master whose own road is closed here (tucked under its own master, as 1号羽田線's end is
        // under C1 at 浜崎橋) shows no face to meet: the pair is left to the decks that do show.
        // Why not cut at its edge anyway: the seam would hang over nothing (holes at 813455519:0).
        const isHidden = isMaster && depth === 0 && this.isMasterClosed(p.foot);
        if (isHidden) continue;
        const shortfall = isMaster && depth === 0 ? this.masterShortfall(p.foot, ring) : 0;
        this.joinSameWay(out, own, ring, { ...p, sign, isMaster, shortfall });
        continue;
      }
      if (isApart) {
        this.skip(own, ring.frame.s, p.other, "level_apart", p.dz);
        continue;
      }
      const side = out[sideKey];
      // A seam on a same-direction master stays: the road ends on that master's face.
      if (side.seam) continue;
      // 分離壁 in the middle of the overlap, once it is a wall wide: below that the two rails at
      // their own places already overlap each other, and moving one to the middle would jump.
      const nearEnd = sign > 0 ? p.lo.u : p.hi.u;
      const overlap = sign * (sign * own.edge - nearEnd);
      const isWide = overlap >= PARAPET;
      if (!isWide) continue;
      const middle = Math.abs((sign * own.edge + nearEnd) / 2);
      const keepsWall = run < p.other;
      const reach = keepsWall ? middle - PARAPET / 2 : middle;
      out[sideKey] = {
        ...side,
        reach: Math.min(side.reach, reach),
        wall: keepsWall ? { inner: middle - PARAPET / 2, outer: middle + PARAPET / 2 } : null,
      };
    }
    return out;
  }

  /** Whether a master's road is closed at the foot: nothing of it shows (tucked under its own master). */
  private isMasterClosed(foot: Foot): boolean {
    const { line, k, tau } = foot;
    const at = ringBetween(line.rings[k], line.rings[k + 1], tau, false);
    const master = ownerHolding(line, k, at.frame.s);
    const sd = this.sides(master, at, 1);
    return sd.left.reach + sd.right.reach <= 1e-3;
  }

  /**
   * How far a master's own road stops short of its slab edge on the side facing this ring (0: it
   * runs out to its edge, or its own 壁高欄 stands at its place). Short where a 分離壁 stands on that
   * side (it shares a slab with an opposite carriageway there) or it is itself cut by its own master:
   * a seam on its nominal edge would then meet no face of it.
   */
  private masterShortfall(foot: Foot, ring: DeckRing): number {
    const { line, k, tau } = foot;
    const at = ringBetween(line.rings[k], line.rings[k + 1], tau, false);
    const master = ownerHolding(line, k, at.frame.s);
    const sd = this.sides(master, at, 1);
    const u = (ring.c.x - at.c.x) * at.t.z - (ring.c.z - at.c.z) * at.t.x;
    const side = u >= 0 ? sd.left : sd.right;
    const isOwnWall =
      side.wall !== null && Math.abs(side.wall.inner - master.hw) < 1e-3 && side.seam === null;
    if (isOwnWall) return 0;
    return Math.max(0, master.edge - side.reach);
  }

  /**
   * A master whose pair has let go (MERGE_MAX_DZ): its 壁高欄 returns only where it stands clear of
   * the other deck's carriageway; over it the road still runs out to the slab edge (the two faces are
   * then a step apart, never a wall in the other's shoulder: review of P3.5, W1 at 4853798 s 198).
   */
  private letGo(out: RingSides, own: ChunkRings, lo: Crossing, hi: Crossing, sign: 1 | -1): void {
    const side = out[sign > 0 ? "left" : "right"];
    // Its carriageway: its slab less the parapets at both edges.
    const [from, to] = [lo.u + PARAPET, hi.u - PARAPET];
    const reachesWall = sign > 0 ? to > own.hw && from < own.edge : from < -own.hw && to > -own.edge;
    if (!reachesWall) return;
    side.wall = null;
    side.reach = Math.max(side.reach, own.edge);
  }

  /** One same-direction partner's effect on a ring (DeckMerge.sides). */
  private joinSameWay(
    out: RingSides,
    own: ChunkRings,
    ring: DeckRing,
    p: {
      lo: Crossing;
      hi: Crossing;
      sign: 1 | -1;
      d: number;
      dz: number;
      foot: Foot;
      other: string;
      isMaster: boolean;
      shortfall: number;
    },
  ): void {
    const { lo, hi, sign, d, foot, other, isMaster } = p;
    const sideKey = sign > 0 ? "left" : "right";
    const { line, k, tau } = foot;
    const at = (arr: number[]) => arr[k] + (arr[k + 1] - arr[k]) * tau;
    // Its lanes in this deck's offsets (it runs the same way: its left is ours).
    const itsLeft = d + at(line.laneL);
    const itsRight = d + at(line.laneR);
    const nearEdge = sign > 0 ? Math.min(itsLeft, itsRight) : Math.max(itsLeft, itsRight);
    const side = out[sideKey];
    const isNearer = side.otherLaneEdge === null || Math.abs(nearEdge) < Math.abs(side.otherLaneEdge);
    if (isNearer) {
      side.joined = isMaster ? "child" : "parent";
      side.otherLaneEdge = nearEdge;
    }
    if (isMaster) {
      // Cut at its edge: the road ends on its near edge, at its face there (sliding to this deck's
      // own height as the miss grows past MERGE_FULL_DZ). A side whose slab edge lies on it loses
      // its rail (it would stand in the other deck's carriageway).
      const end = sign > 0 ? lo : hi;
      // A master whose road stops short of its edge (masterShortfall) is met where its road ends,
      // under the 分離壁 or at the seam that cut it: this deck's road runs on towards the master's centre to meet it.
      // Why not leave the pair apart there: the two faces would overlap again and flicker.
      const reach = sign * end.u + p.shortfall;
      const lx = ring.t.z;
      const lz = -ring.t.x;
      const point = end.point.clone().add(new Vector3(sign * lx * p.shortfall, 0, sign * lz * p.shortfall));
      // Where the master's edge lies in this deck's parapet zone the road runs out to it (the wall
      // there goes, below), so the two still meet.
      const isNearerCut = side.seam === null || reach < side.reach;
      if (isNearerCut) {
        const w = seamWeight(p.dz);
        const ownY = ring.c.y + liftAt(ring, sign * reach, own.bank);
        side.reach = reach;
        side.seam = new Vector3(point.x, ownY + (point.y - ownY) * w, point.z);
        side.seamOf = { run: other, edge: end.edge };
        side.seamWeight = w;
      }
      for (const key of ["left", "right"] as const) {
        const edgeU = key === "left" ? own.edge : -own.edge;
        const isOnIt = edgeU >= lo.u && edgeU <= hi.u;
        if (isOnIt) out[key].wall = null;
      }
      // Covered past the centre, the near reach goes below zero; past the far end, nothing of this
      // deck shows (−right.reach ≥ left.reach) and expresswayDeck.ts tucks the ring under the master.
      return;
    }
    // This deck is the master: where the other's slab reaches past this edge, this rail would stand
    // inside the one slab; the road runs out to the slab edge instead.
    const farEnd = sign > 0 ? hi.u : lo.u;
    const isPast = sign * farEnd > own.edge;
    if (!isPast) return;
    side.wall = null;
    side.reach = Math.max(side.reach, own.edge);
  }
}

/** A stretch of a "same" pair left apart at a chunk (expressway_merge_skipped). */
export type MergeSkip = {
  with: string;
  /** level_apart: |Δz| > MERGE_MAX_DZ there. */
  reason: "level_apart";
  s0: number;
  s1: number;
  maxDzM: number;
};

/** A chunk's compiled surface height (T.P. m) at run distance s, s held within the chunk. */
function compiledZ(chunk: XwChunk, s: number): number {
  const st = chunk.st;
  const held = Math.min(Math.max(s, st[ST.s]), st[st.length - STATION_STRIDE + ST.s]);
  return surfaceAt(st, held).z;
}

/**
 * The chunk rings of a line's segment k (its two rings' owners) whose stations hold s. Why not by
 * τ < 0.5 (P3.5): at a chunk seam that picked the chunk whose stations end short of s, and its
 * compiled height (compiledZ holds s at the chunk's end) was up to 0.29 m off (0.48 m in ship;
 * review of PR 5, W1).
 */
function ownerHolding(line: Line, k: number, s: number): ChunkRings {
  const a = line.owner[k];
  const b = line.owner[k + 1];
  return chunkHolding(a.chunk, b.chunk, s) === a.chunk ? a : b;
}

/** Of the chunks of a segment's two rings (one, or two at a chunk seam), the one whose stations hold s. */
function chunkHolding(a: XwChunk, b: XwChunk, s: number): XwChunk {
  const isSame = a === b;
  if (isSame) return a;
  const end = a.st[a.st.length - STATION_STRIDE + ST.s];
  return s <= end ? a : b;
}

/**
 * How far the seam stands at the master's face (1) or at the cut deck's own height (0): a smoothstep
 * of the miss between MERGE_FULL_DZ and MERGE_MAX_DZ, flat at both ends. Why not linear (P3.5): at the
 * let-go point the seam then leaves the cut deck's own height at full slope, (MERGE_MAX_DZ / 0.1 m) ×
 * the change of the miss; with rings 0.1 m apart there (expresswayDeck.ts LET_GO_RINGS_M, then every 0.1 m) 6 let-go
 * points of ship still climbed 1.1–2.8 mm over 4 cm along travel (LET_GO_MAX_STEP_M 1 mm), 1 with it.
 * The seam probes' `expected` ((1 − w)·|Δz| of the data, scripts/expresswaySeams.ts) is not the mesh's
 * step: between rings the seam is linear in s, and the decks lie on chords up to 1 cm off the data.
 */
export function seamWeight(dz: number): number {
  const miss = Math.abs(dz);
  const x = Math.min(1, Math.max(0, (MERGE_MAX_DZ - miss) / (MERGE_MAX_DZ - MERGE_FULL_DZ)));
  return x * x * (3 - 2 * x);
}

/** A ring on the straight piece between two rings (the slab's face there, unchanged). */
export function ringBetween(a: DeckRing, b: DeckRing, tau: number, alongChord: boolean): DeckRing {
  const lerp = (x: number, y: number) => x + (y - x) * tau;
  const c = a.c.clone().lerp(b.c, tau);
  // Through a master's edge vertex the ring runs square to the chord: the vertex, the chord's
  // perpendicular foot, lies on its cross-section line exactly.
  const t = alongChord
    ? new Vector3(b.c.x - a.c.x, 0, b.c.z - a.c.z).normalize()
    : a.t.clone().lerp(b.t, tau).normalize();
  const f = a.frame;
  const g = b.frame;
  return {
    c,
    t,
    groundY: lerp(a.groundY, b.groundY),
    frame: {
      s: lerp(f.s, g.s),
      lon: lerp(f.lon, g.lon),
      lat: lerp(f.lat, g.lat),
      z: lerp(f.z, g.z),
      grade: lerp(f.grade, g.grade),
      bank: lerp(f.bank, g.bank),
      ground: lerp(f.ground, g.ground),
    },
    isStation: false,
  };
}

/** Whether `other` is the master over `run` (run is the one cut): the parent, or the higher rank. */
function outranksAsMaster(index: DeckIndex, run: string, other: string): boolean {
  const role = roleOf(index.runs, run, other);
  if (role === "child") return true;
  if (role === "parent") return false;
  return outranks(index.runs, other, run);
}

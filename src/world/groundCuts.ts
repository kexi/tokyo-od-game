import type { XwChunk } from "../expressway/format";
import { TERRAIN_ZOOM } from "../config";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";
import { boreHoles } from "./expresswayBore";
import type { GroundWater } from "./terrain";
import { coverage, WATER_ZOOM, type WaterPolygon } from "./waterGeometry";

/**
 * A point test over a z15 chunk (u east, v south, 0–1), with `near`: whether a box of the chunk
 * meets any hole's bounding box (a quick reject before the exact test).
 */
export type CutTest = ((u: number, v: number) => boolean) & {
  near(u0: number, v0: number, u1: number, v1: number): boolean;
};

/** Pixels a side of a z15 chunk's cut-out (~2 m: the walls are drawn to the hole's edge). */
const SIZE = 512;

/**
 * The terrain's cut-outs (P9): the water layer's (rivers, the bay) and, over the expressway's cuts
 * and the portals of its tunnels, the ground taken away so the road below shows (expresswayBore.ts
 * boreHoles). The terrain asks one provider (GroundWater); this one answers for both. The expressway
 * part is also offered as an exact test (`cutTest`): the terrain clips its collider to the holes
 * (terrainCut.ts), where water only drops the triangles wholly on it (a triangle spanning a cut would
 * roof it over, and dropping whole triangles left the ground beside a portal bare).
 *
 * Why not cut the terrain's mesh itself: its 15 m grid cannot follow a 12 m wide cut, and the water
 * already cuts the ground by a mask per z15 chunk, which this extends.
 */
export class GroundCuts implements GroundWater {
  /** Expressway holes by z15 chunk ("x/y"), in global z16 tile units (as water polygons). */
  private readonly holes = new Map<string, WaterPolygon[]>();
  private readonly versions = new Map<string, number>();
  private readonly cache = new Map<string, { version: number; data: Uint8Array }>();
  private readonly seen = new Set<string>();
  /**
   * Every hole in the order it came: `ringsLonLat` lists them so, and CutRelay takes the new ones
   * from its end. Why not the z15 map's order: a later hole in an earlier key landed mid-list and
   * the relay skipped it (PR #71 review W2).
   */
  private readonly arrivals: WaterPolygon[] = [];

  constructor(private readonly water: GroundWater | null) {}

  /** Cut the ground over a chunk of the expressway (nothing for a viaduct). Idempotent per chunk. */
  addChunk(chunk: XwChunk): void {
    if (this.seen.has(chunk.id)) return;
    this.seen.add(chunk.id);
    const polys = boreHoles(chunk, (lon, lat) => [lonToTileX(lon, WATER_ZOOM), latToTileY(lat, WATER_ZOOM)]);
    const k = 2 ** (WATER_ZOOM - TERRAIN_ZOOM);
    for (const poly of polys) {
      this.arrivals.push(poly);
      const ring = poly[0];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i + 1 < ring.length; i += 2) {
        x0 = Math.min(x0, ring[i]);
        x1 = Math.max(x1, ring[i]);
        y0 = Math.min(y0, ring[i + 1]);
        y1 = Math.max(y1, ring[i + 1]);
      }
      for (let ty = Math.floor(y0 / k); ty <= Math.floor(y1 / k); ty++) {
        for (let tx = Math.floor(x0 / k); tx <= Math.floor(x1 / k); tx++) {
          const key = `${tx}/${ty}`;
          this.holes.set(key, [...(this.holes.get(key) ?? []), poly]);
          this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
        }
      }
    }
  }

  /** Every hole as a lon/lat ring, in the order they came (the buildings leave out what stands in one). */
  ringsLonLat(): Array<Array<[number, number]>> {
    const out: Array<Array<[number, number]>> = [];
    for (const poly of this.arrivals) {
      const ring: Array<[number, number]> = [];
      for (let i = 0; i + 1 < poly[0].length; i += 2)
        ring.push([tileXToLon(poly[0][i], WATER_ZOOM), tileYToLat(poly[0][i + 1], WATER_ZOOM)]);
      out.push(ring);
    }
    return out;
  }

  /** Whether any hole has been cut (the road surfaces and pavements skip their test without one). */
  isEmpty(): boolean {
    return this.holes.size === 0;
  }

  /** Whether a point (lon/lat) lies in a hole: the ground there is taken away for a cut or portal. */
  containsLonLat(lon: number, lat: number): boolean {
    const x = lonToTileX(lon, WATER_ZOOM);
    const y = latToTileY(lat, WATER_ZOOM);
    const k = 2 ** (WATER_ZOOM - TERRAIN_ZOOM);
    const polys = this.holes.get(`${Math.floor(x / k)}/${Math.floor(y / k)}`) ?? [];
    return polys.some((poly) => isInside(poly[0], x, y));
  }

  /**
   * Whether a ring (flat lon/lat pairs) reaches into a hole: a vertex or a point every ~2 m of its
   * edges in one, or a hole's vertex inside it. The pavements drop such a polygon (its kerb and
   * collider would roof the cut over); a ring wholly inside a hole is caught by its vertices.
   */
  touchesLonLat(ring: readonly number[]): boolean {
    if (this.isEmpty()) return false;
    const n = ring.length / 2;
    const STEP_DEG = 2e-5;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = [ring[i * 2], ring[i * 2 + 1]];
      const [bx, by] = [ring[((i + 1) % n) * 2], ring[((i + 1) % n) * 2 + 1]];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP_DEG));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        if (this.containsLonLat(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
      }
    }
    const tiles: number[] = [];
    for (let i = 0; i < n; i++)
      tiles.push(lonToTileX(ring[i * 2], WATER_ZOOM), latToTileY(ring[i * 2 + 1], WATER_ZOOM));
    for (const polys of this.holes.values())
      for (const poly of polys)
        for (let i = 0; i + 1 < poly[0].length; i += 2)
          if (isInside(tiles, poly[0][i], poly[0][i + 1])) return true;
    return false;
  }

  versionAt(x: number, y: number): number {
    // Distinct for every pair of versions (the water's count up by small steps).
    return (this.water?.versionAt(x, y) ?? 0) * 4096 + (this.versions.get(`${x}/${y}`) ?? 0);
  }

  maskAt(x: number, y: number): { data: Uint8Array; size: number } | null {
    const wet = this.water?.maskAt(x, y) ?? null;
    const cut = this.cutAt(x, y);
    if (!cut) return wet;
    if (!wet) return cut;
    // Both: drawn at the finer of the two sizes (nearest pixel), the larger share per pixel.
    const size = Math.max(wet.size, cut.size);
    const data = new Uint8Array(size * size);
    const sample = (m: { data: Uint8Array; size: number }, i: number, j: number) =>
      m.data[Math.floor((j * m.size) / size) * m.size + Math.floor((i * m.size) / size)];
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) data[j * size + i] = Math.max(sample(wet, i, j), sample(cut, i, j));
    return { data, size };
  }

  /**
   * The exact test of the expressway's holes over a z15 chunk (u east, v south, 0–1 across it), or
   * null when none reaches it: the terrain clips its collider to it (terrainCut.ts).
   */
  cutTest(x: number, y: number): CutTest | null {
    const polys = this.holes.get(`${x}/${y}`);
    if (!polys) return null;
    const k = 2 ** (WATER_ZOOM - TERRAIN_ZOOM);
    const boxes = polys.map((poly) => boxOf(poly[0]));
    const test = (u: number, v: number) => {
      const px = (x + u) * k;
      const py = (y + v) * k;
      return polys.some((poly, n) => {
        const [x0, y0, x1, y1] = boxes[n];
        const isNear = px >= x0 && px <= x1 && py >= y0 && py <= y1;
        return isNear && isInside(poly[0], px, py);
      });
    };
    // The holes' boxes in the chunk's 0–1 units: most triangles are far from all of them.
    const near = (u0: number, v0: number, u1: number, v1: number) =>
      boxes.some(
        ([x0, y0, x1, y1]) => u1 >= x0 / k - x && u0 <= x1 / k - x && v1 >= y0 / k - y && v0 <= y1 / k - y,
      );
    return Object.assign(test, { near });
  }

  /** The expressway's holes alone over a z15 chunk (rows north first, 0–255), or null if none. */
  cutAt(x: number, y: number): { data: Uint8Array; size: number } | null {
    const key = `${x}/${y}`;
    const polys = this.holes.get(key);
    if (!polys) return null;
    const version = this.versions.get(key)!;
    const cached = this.cache.get(key);
    const isFresh = cached !== undefined && cached.version === version;
    if (isFresh) return { data: cached!.data, size: SIZE };
    const k = 2 ** (WATER_ZOOM - TERRAIN_ZOOM);
    // One polygon at a time: the raster is even–odd, and two stretches that overlap on a curve would
    // cancel where they overlap. The shares added (up to all of a pixel), not the larger kept: two chunks' holes meet edge to
    // edge at their shared station, and with the larger the pixels on that line kept half each, so
    // the terrain showed through as a seam across the road (P2.7-6 PR 7b, the terrain probe: every
    // point over a road there was on such a line). Where two overlap the sum only cuts a little more.
    const data = new Uint8Array(SIZE * SIZE);
    for (const poly of polys) {
      const one = coverage([poly], x * k, y * k, k, SIZE);
      for (let i = 0; i < one.length; i++) data[i] = Math.min(255, data[i] + one[i]);
    }
    this.cache.set(key, { version, data });
    return { data, size: SIZE };
  }
}

/** Even–odd point-in-polygon of a flat ring [x0, y0, x1, y1, …]. */
function isInside(ring: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[i * 2 + 1];
    const yj = ring[j * 2 + 1];
    const isCrossing = yi > y !== yj > y;
    if (!isCrossing) continue;
    const xCross = ring[i * 2] + ((y - yi) / (yj - yi)) * (ring[j * 2] - ring[i * 2]);
    if (x < xCross) inside = !inside;
  }
  return inside;
}

/** Bounding box [x0, y0, x1, y1] of a flat ring. */
function boxOf(ring: readonly number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]);
    x1 = Math.max(x1, ring[i]);
    y0 = Math.min(y0, ring[i + 1]);
    y1 = Math.max(y1, ring[i + 1]);
  }
  return [x0, y0, x1, y1];
}

/** The road triangles (indices into `pos`, x y z per vertex) left once those in a hole are dropped. */
export function dropCut(
  pos: readonly number[],
  idx: number[],
  cut: (x: number, z: number) => boolean,
): number[] {
  const kept: number[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const x = (pos[a] + pos[b] + pos[c]) / 3;
    const z = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    // Any corner in the hole as well as the centre: a long road triangle with its centre outside
    // reached into the cut as a wedge through the retaining wall (P2.7-5, 麻布台's south portal).
    // Why not clip at the outline: the walls stand over the hole's edge, so a triangle short of it
    // leaves no gap to see; a clip of every road triangle against every ring costs far more.
    const isCut = cut(x, z) || cut(pos[a], pos[a + 2]) || cut(pos[b], pos[b + 2]) || cut(pos[c], pos[c + 2]);
    if (!isCut) kept.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return kept;
}

type Ring = Array<[number, number]>;

/**
 * When the streets and pavements are laid again round new holes (main.ts): the holes not laid round
 * yet, and those that came while the streets were loading, held until the load is done. Why held:
 * the pavements of that load come on their own and may already be built without the hole, and the
 * relay used to be skipped then and never run, so a PLATEAU 歩道 kept its kerb inside 麻布台's box
 * as a pale slab (P2.7-5; the view shooter's --pick found an unnamed Mesh 4.5 m off, no vertex colour).
 */
export class CutRelay {
  private relayed = 0;
  private pending: Ring[] = [];

  /**
   * The holes to lay round now, given every hole so far, whether one of them lies in the area laid
   * and whether the streets are loading; null when there is nothing to lay (or it waits for the load).
   */
  take(
    holes: readonly Ring[],
    isInArea: (rings: readonly Ring[]) => boolean,
    isLoading: boolean,
  ): Ring[] | null {
    const fresh = [...this.pending, ...holes.slice(this.relayed)];
    this.relayed = holes.length;
    this.pending = [];
    const isNothing = fresh.length === 0 || !isInArea(fresh);
    if (isNothing) return null;
    if (isLoading) {
      this.pending = fresh;
      return null;
    }
    return fresh;
  }

  /** Whether holes wait for the load to finish. */
  get hasPending(): boolean {
    return this.pending.length > 0;
  }
}

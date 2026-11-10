import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  type Scene,
  Vector3,
} from "three";
import { PARAPET_HEIGHT, PARAPET_WIDTH } from "../expressway/assumptions";
import {
  PIER_STRIDE,
  STATION_STRIDE,
  XW_VERSION,
  type XwChunk,
  type XwMeta,
  type XwTile,
} from "../expressway/format";
import { haversine, tileKey } from "../expressway/geo";
import {
  chordDeviation,
  frameAt,
  ST,
  type SurfaceFrame,
  surfaceAt,
  surfaceHeight,
} from "../expressway/profile";
import { carriagewayWidth } from "../expressway/section";
import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import type { LocalFrame } from "../geo/frame";
import { log, warn } from "../log";

/**
 * Expressway decks from public/data/expressway (設計書 4.5, P1: drawing only). Each ≤ 300 m chunk is
 * extruded once along its stations — deck slab, 壁高欄, the box girder's webs and soffit — with its
 * piers baked into the same mesh, and kept until the player is far away: the road network's 300 m
 * rebuilds never touch it. No colliders and nothing in the road graph yet (P3).
 *
 * Positions come from lon/lat and the T.P. elevation plus the geoid through the local frame, like
 * the terrain, so a deck stands at the height the compiler gave it over the same DEM. On a change
 * of origin the meshes are moved by the frame's rigid transform (as water.ts moves its decks).
 */

export type GeoToLocal = {
  frame: LocalFrame;
  /** WGS84 ellipsoidal height of an orthometric (T.P.) one at a point. */
  ellipsoidal(lat: number, lon: number, orthometric: number): number;
};

const Z = 14;
const RENDER_RADIUS_M = 1500;
const DROP_RADIUS_M = 1900;
const MOVE_BEFORE_UPDATE_M = 120;
const SLAB = 0.35;
/** The box girder's bottom flange as a share of the deck width. */
const GIRDER_BOTTOM_SHARE = 0.55;
const PIER_ALONG = 2.2;
const PIER_ACROSS_SHARE = 0.4;
const PIER_FOOT = 0.6;
/** Largest gap between the Hermite surface and the slab's flat faces between two cross-sections. */
const SURFACE_TOLERANCE = 0.01;
const MAX_PIECES = 8;

const ASPHALT = [0.16, 0.16, 0.17];
const CONCRETE = [0.66, 0.65, 0.61];
const SOFFIT = [0.48, 0.47, 0.44];
const PIER = [0.62, 0.61, 0.57];

export type DeckArrays = { position: Float32Array; color: Float32Array };

/**
 * The extruded deck of one chunk as non-indexed triangles (flat-shaded concrete), in local
 * coordinates. `bank` tilts the slab by the compiled superelevation (off in P1, 設計書 4.3 の 4).
 */
export function* deckArraySteps(
  chunk: XwChunk,
  place: GeoToLocal,
  bank = false,
): Generator<void, { arrays: DeckArrays; stations: Vector3[]; tangents: Vector3[] }> {
  const n = chunk.st.length / STATION_STRIDE;
  const centre: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STATION_STRIDE;
    const lon = chunk.st[o + ST.lon];
    const lat = chunk.st[o + ST.lat];
    centre.push(place.frame.toLocal(lat, lon, place.ellipsoidal(lat, lon, chunk.st[o + ST.z])));
  }
  // Cross-sections ("rings") at every station and, inside an interval, as many more as the Hermite
  // surface needs to stay within SURFACE_TOLERANCE of the slab's straight faces. The plan position
  // is linear between stations; the elevation is the shared surface (profile.ts), not the chord.
  const rings: Ring[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STATION_STRIDE;
    rings.push(ringAt(chunk, place, o, o, 0));
    const isLast = i === n - 1;
    if (isLast) break;
    const q = o + STATION_STRIDE;
    const h = chunk.st[q + ST.s] - chunk.st[o + ST.s];
    const deviation = chordDeviation(
      h,
      chunk.st[o + ST.grade],
      chunk.st[q + ST.grade],
      chunk.st[q + ST.z] - chunk.st[o + ST.z],
    );
    const pieces = Math.min(MAX_PIECES, Math.max(1, Math.ceil(Math.sqrt(deviation / SURFACE_TOLERANCE))));
    for (let k = 1; k < pieces; k++) rings.push(ringAt(chunk, place, o, q, k / pieces));
  }
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
  // Cross-section corners [lateral (left +), vertical, colour]; consecutive pairs are faces.
  const section = (i: number) => {
    const f = rings[i].frame;
    // The girder never reaches below the ground: near a ground end it shortens into a wall.
    const clear = rings[i].c.y - rings[i].groundY;
    const depth = Math.max(SLAB, Math.min(chunk.girder, clear + 0.3));
    // Offsets from the centre of the shared surface contract (profile.ts surfaceHeight).
    const lift = (u: number) => surfaceHeight(f, u, bank) - f.z;
    return [
      [-hw, lift(-hw)],
      [hw, lift(hw)],
      [hw, lift(hw) + ph],
      [edge, lift(edge) + ph],
      [edge, lift(edge) - SLAB],
      [gw, -depth],
      [-gw, -depth],
      [-edge, lift(-edge) - SLAB],
      [-edge, lift(-edge) + ph],
      [-hw, lift(-hw) + ph],
      [-hw, lift(-hw)],
    ];
  };
  const faceColour = (k: number) => (k === 0 ? ASPHALT : k === 5 ? SOFFIT : CONCRETE);
  const pos: number[] = [];
  const col: number[] = [];
  const point = (i: number, u: number, v: number) => {
    const t = tangents[i];
    // Left of travel: the tangent turned 90° anticlockwise seen from above (+y up, −z north).
    const lx = t.z;
    const lz = -t.x;
    const c = rings[i].c;
    return [c.x + lx * u, c.y + v, c.z + lz * u];
  };
  let prev = section(0);
  for (let i = 1; i < m; i++) {
    const cur = section(i);
    for (let k = 0; k + 1 < cur.length; k++) {
      const a = point(i - 1, prev[k][0], prev[k][1]);
      const b = point(i - 1, prev[k + 1][0], prev[k + 1][1]);
      const c = point(i, cur[k + 1][0], cur[k + 1][1]);
      const d = point(i, cur[k][0], cur[k][1]);
      // Faces wind so their front is outward for a loop drawn left → right over the top.
      pos.push(...a, ...d, ...c, ...a, ...c, ...b);
      const colour = faceColour(k);
      for (let v = 0; v < 6; v++) col.push(...colour);
    }
    prev = cur;
    const checkpoint = i % 16 === 0;
    if (checkpoint) yield;
  }
  const stationTangents = rings.flatMap((r, i) => (r.isStation ? [tangents[i]] : []));
  pierTriangles(chunk, place, stationTangents, pos, col);
  return {
    arrays: { position: new Float32Array(pos), color: new Float32Array(col) },
    stations: centre,
    tangents: stationTangents,
  };
}

/**
 * Piers at the compiled distances (they never move between builds), as boxes from 0.6 m into the
 * ground to the girder's soffit, in the chunk's own triangles. Why not an InstancedMesh per chunk
 * (設計書 4.5): with ~40 chunks drawn that doubled the draw calls (and the shadow pass's), which
 * showed up as slower ordinary frames in the A/B; a box is 36 vertices, so baking costs nothing.
 */
function pierTriangles(
  chunk: XwChunk,
  place: GeoToLocal,
  tangents: Vector3[],
  pos: number[],
  col: number[],
): void {
  const across =
    (carriagewayWidth(chunk) + 2 * PARAPET_WIDTH.value) * GIRDER_BOTTOM_SHARE * 2 * PIER_ACROSS_SHARE;
  const count = chunk.piers.length / PIER_STRIDE;
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
  }
}

type Ring = { c: Vector3; groundY: number; frame: SurfaceFrame; isStation: boolean };

/** The cross-section at fraction t from station offset o to q (t = 0: the station itself). */
function ringAt(chunk: XwChunk, place: GeoToLocal, o: number, q: number, t: number): Ring {
  const st = chunk.st;
  const s = st[o + ST.s] + (st[q + ST.s] - st[o + ST.s]) * t;
  // The station itself is read as stored (no interpolation error at the seams between chunks).
  const f = t === 0 ? frameAt(st, st[o + ST.s]) : frameAt(st, s);
  const z = t === 0 ? st[o + ST.z] : f.z;
  return {
    c: place.frame.toLocal(f.lat, f.lon, place.ellipsoidal(f.lat, f.lon, z)),
    groundY: place.frame.toLocal(f.lat, f.lon, place.ellipsoidal(f.lat, f.lon, f.ground)).y,
    frame: { ...f, z },
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

type Built = { mesh: Mesh; lon: number; lat: number };

/** Whether meta.json is of the format this code reads (format.ts XW_VERSION). */
export function isSupportedMeta(meta: Pick<XwMeta, "version">): boolean {
  return meta.version === XW_VERSION;
}

export class ExpresswayDecks {
  private meta: Promise<XwMeta | null> | null = null;
  private readonly tiles = new Map<string, Promise<XwTile | null>>();
  private readonly built = new Map<string, Built>();
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
  private frame: LocalFrame;

  constructor(
    private readonly scene: Scene,
    private readonly ellipsoidal: GeoToLocal["ellipsoidal"],
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

  /** The local frame moved (floating origin): carry every deck by the same rigid transform. */
  setFrame(frame: LocalFrame): void {
    const m = frame.transformFrom(this.frame);
    this.frame = frame;
    for (const b of this.built.values()) {
      b.mesh.applyMatrix4(m);
    }
  }

  /** How many chunks are drawn (for checks). */
  chunkCount(): number {
    return this.built.size;
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
          return null;
        }
        // Another format (old tiles in a cache, a half-deployed build) would be read wrongly:
        // no decks, and not asked again (a version never changes under a running page).
        if (!isSupportedMeta(meta)) {
          warn("expressway_tile_failed", {
            key: "meta",
            error: `version ${String(meta.version)} ≠ ${XW_VERSION}`,
          });
          return null;
        }
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
          return tile;
        });
      this.tiles.set(key, p);
    }
    return p;
  }

  private async refresh(lat: number, lon: number): Promise<void> {
    const started = performance.now();
    const meta = await this.loadMeta();
    if (!meta) return;
    const listed = new Set(meta.tiles);
    const [cx, cy] = tileKey(lon, lat, Z).split("-").map(Number);
    const keys: string[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.push(`${cx + dx}-${cy + dy}`);
    const tiles = await Promise.all(keys.filter((k) => listed.has(k)).map((k) => this.loadTile(k)));
    const wanted = tiles
      .flatMap((t) => t?.chunks ?? [])
      .map((c) => ({ c, d: distanceTo(c, lon, lat) }))
      .filter(({ c, d }) => d <= RENDER_RADIUS_M && !this.built.has(c.id))
      .sort((a, b) => a.d - b.d);
    const work = new FrameWork();
    let dropped = 0;
    let builtCount = 0;
    for (const [id, b] of this.built) {
      const isFar = haversine(lon, lat, b.lon, b.lat) > DROP_RADIUS_M;
      if (!isFar) continue;
      this.dispose(b);
      this.built.delete(id);
      dropped++;
    }
    for (const { c } of wanted) {
      // The player has moved on and a newer refresh is queued: stop here, it builds what is near now.
      const isSuperseded = this.centre?.lat !== lat || this.centre?.lon !== lon;
      if (isSuperseded) break;
      const frame = this.frame;
      const place = { frame, ellipsoidal: this.ellipsoidal };
      const { arrays } = await work.run(deckArraySteps(c, place, this.bank));
      const built = work.measure(() => this.publish(c, arrays));
      // Built in the frame of its start: carry it over if the origin moved meanwhile.
      const hasMoved = frame !== this.frame;
      if (hasMoved) {
        const m = this.frame.transformFrom(frame);
        built.mesh.applyMatrix4(m);
      }
      this.built.set(c.id, built);
      builtCount++;
      // A new mesh's first draw costs the GPU too: give rendering its own frame.
      await work.yield();
    }
    const hasChanged = builtCount > 0 || dropped > 0;
    if (!hasChanged) return;
    log("expressway_decks_built", {
      chunks: this.built.size,
      built: builtCount,
      dropped,
      cpuMs: Math.round(work.cpuMs * 10) / 10,
      maxSliceMs: Math.round(work.maxSliceMs * 10) / 10,
      durationMs: Math.round(performance.now() - started),
    });
  }

  private publish(chunk: XwChunk, arrays: DeckArrays): Built {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(arrays.position, 3));
    g.setAttribute("color", new Float32BufferAttribute(arrays.color, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new Mesh(g, this.material);
    mesh.name = `expressway-${chunk.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const mid = Math.floor(chunk.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
    return { mesh, lon: chunk.st[mid + 1], lat: chunk.st[mid + 2] };
  }

  private dispose(b: Built): void {
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
  }
}

function stationIndexAt(chunk: XwChunk, s: number): number {
  const n = chunk.st.length / STATION_STRIDE;
  let i = 0;
  while (i < n - 2 && chunk.st[(i + 1) * STATION_STRIDE] < s) i++;
  return i;
}

function distanceTo(c: XwChunk, lon: number, lat: number): number {
  let best = Infinity;
  for (let i = 0; i < c.st.length; i += STATION_STRIDE * 4)
    best = Math.min(best, haversine(lon, lat, c.st[i + 1], c.st[i + 2]));
  const last = c.st.length - STATION_STRIDE;
  return Math.min(best, haversine(lon, lat, c.st[last + 1], c.st[last + 2]));
}

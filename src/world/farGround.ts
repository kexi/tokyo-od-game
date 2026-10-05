import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  type Scene,
} from "three";
import {
  attribute,
  dot,
  float,
  length,
  max,
  mix,
  modelWorldMatrix,
  positionGeometry,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, type WebGPURenderer } from "three/webgpu";
import { GSI, TERRAIN_ZOOM } from "../config";
import { QUALITY } from "../device";
import { geodeticToEcef } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import { decodeGsiDem, latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";
import { valueNoise } from "../render/shaderMath";
import { facadeUniforms } from "./facade";

/**
 * The ground beyond the streamed world, to the horizon: GSI's coarse DEM (dem_png, DEM10B resampled)
 * and seamless photo at z10 or z11 around the player (device.ts VIEW), with Earth's curvature
 * exact (vertices are geodetic points in ECEF, relative to each tile's centre, as the near terrain's
 * are). It is what the far towers and the far skyline stand on: before it, nothing was drawn past
 * the near terrain (1–3.5 km) but haze, and a tower 10 km off rose out of the fog-coloured edge
 * with nothing under it.
 *
 * - The near terrain's square (Terrain.coverage) is cut out of it in the shader, so the two never
 *   overlap; the terrain hides its chunks outside that square.
 * - Land is raised by CARPET (the low city's mean height) from the building load radius outwards:
 *   seen from afar the 2–6 storey blocks merge into a surface that hides the lower floors of what
 *   stands behind them, as real streets hide the foot of a distant tower. Near the player the
 *   ground stays at street level under the streamed buildings.
 * - The sea (no DEM value) sits SEA_LEVEL below T.P. 0, out of the way of the near water layer's
 *   surfaces, and is glossy.
 * - At night the city glows: CITY_GLOW over built-up land (not where the photo is green: parks, the
 *   palace, riverbanks), in patches of a few hundred metres.
 * Cost: 9 tiles of 16² cells (低) or 25 of 32² (中・高・最高): one draw call each, 4.6k / 51k
 * triangles, 256² photos (3 / 9 MB of texture with mipmaps), 1.4 / 3.5 MB downloaded once per
 * ring. Why not more near terrain chunks: a z15 chunk is a 64² grid with a 1–4 MB photo canvas,
 * so 30 km would need hundreds of them.
 */

/** Metres the low city adds to the land seen from afar. */
export const CARPET = 12;
/** Metres over which the carpet rises, outwards from the building load radius. */
const CARPET_RAMP = 700;
/** The far sea's height (T.P. m): below the near water layer's levels, which are near T.P. 0. */
export const SEA_LEVEL = -1.5;
/** Linear radiance of built-up land at night (the near city's lit windows, lamps and signs, averaged). */
const CITY_GLOW = 0.14;
/** Tiles fetched at once (DEM, its neighbours and the photo each), after the near terrain's centre. */
const MAX_CONCURRENT_LOADS = 2;

/** A rectangle of z15 tiles: x0 ≤ x < x1, y0 ≤ y < y1. */
export type TileRect = { x0: number; y0: number; x1: number; y1: number };

/** Width (m, east–west) of a tile of `zoom` at latitude `lat`. */
export const tileWidth = (zoom: number, lat: number) =>
  (40_075_016.7 / 2 ** zoom) * Math.cos((lat * Math.PI) / 180);

/**
 * The least distance (m) from a player anywhere in the centre tile to the edge of a ring of `ring`
 * tiles on each side: what the fog's floor may assume is drawn (environment.ts).
 */
export const farGroundReach = (zoom: number, ring: number, lat = 35.68) => ring * tileWidth(zoom, lat);
/** This device's reach (device.ts VIEW: ≥ 31 km on every 描画距離). */
export const FAR_GROUND_REACH = farGroundReach(QUALITY.farGroundZoom, QUALITY.farGroundRing);

/** The tiles of the ring around a place, nearest first. */
export function farTilesAround(
  lat: number,
  lon: number,
  zoom: number,
  ring: number,
): Array<{ x: number; y: number; ring: number }> {
  const cx = Math.floor(lonToTileX(lon, zoom));
  const cy = Math.floor(latToTileY(lat, zoom));
  const out: Array<{ x: number; y: number; ring: number }> = [];
  for (let dy = -ring; dy <= ring; dy++)
    for (let dx = -ring; dx <= ring; dx++)
      out.push({ x: cx + dx, y: cy + dy, ring: Math.max(Math.abs(dx), Math.abs(dy)) });
  return out.toSorted((a, b) => a.ring - b.ring);
}

/** A DEM tile: 256² orthometric heights (NaN: no value, the sea). */
export type DemTile = Float32Array;

/**
 * Height (T.P. m) and how much of it is sea (0–1) at a place in the tile (px, py in its pixels,
 * 0–256, pixel-corner convention as DemStore.sampleGlobal), bilinear; past the tile's last pixel the
 * neighbour's first is read (`east`, `south`, `southEast`), so neighbouring tiles share their edge
 * vertices exactly and meet without a crack.
 */
export function sampleDem(
  tile: DemTile,
  px: number,
  py: number,
  east: DemTile | null = null,
  south: DemTile | null = null,
  southEast: DemTile | null = null,
): { height: number; sea: number } {
  const x = Math.max(0, px);
  const y = Math.max(0, py);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const at = (i: number, j: number) => {
    const isEast = i > 255;
    const isSouth = j > 255;
    const source = isEast && isSouth ? southEast : isEast ? east : isSouth ? south : tile;
    return source ? source[(j & 255) * 256 + (i & 255)] : tile[Math.min(255, j) * 256 + Math.min(255, i)];
  };
  let height = 0;
  let sea = 0;
  for (const [i, j, w] of [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const) {
    const v = at(i, j);
    const isSea = Number.isNaN(v);
    sea += isSea ? w : 0;
    height += (isSea ? SEA_LEVEL : v) * w;
  }
  // Mostly sea: at the sea's level, so the shore does not stand up out of it.
  return { height: sea > 0.5 ? SEA_LEVEL : height, sea };
}

/**
 * A far tile's grid: positions (ECEF, relative to `centre`), photo uv, and `aFar` = (sea share,
 * z15 tile x and y relative to `ref`, for the near terrain's cut-out). `ellipsoidal` turns T.P.
 * heights into WGS84 heights (+ the geoid's undulation), as the near terrain and the landmarks do.
 */
export function farTileGeometry(
  x: number,
  y: number,
  zoom: number,
  segments: number,
  heightAt: (px: number, py: number) => { height: number; sea: number },
  ellipsoidal: (lat: number, lon: number, orthometric: number) => number,
  ref: { x: number; y: number },
): { geometry: BufferGeometry; centre: Vector3; up: Vector3 } {
  const s = segments;
  const midLat = tileYToLat(y + 0.5, zoom);
  const midLon = tileXToLon(x + 0.5, zoom);
  const c = geodeticToEcef(midLat, midLon, 40);
  const centre = new Vector3(c.x, c.y, c.z);
  const up = centre.clone().normalize();
  const positions = new Float32Array((s + 1) * (s + 1) * 3);
  const uvs = new Float32Array((s + 1) * (s + 1) * 2);
  const far = new Float32Array((s + 1) * (s + 1) * 3);
  const toZ15 = 2 ** (TERRAIN_ZOOM - zoom);
  for (let j = 0; j <= s; j++) {
    const lat = tileYToLat(y + j / s, zoom);
    for (let i = 0; i <= s; i++) {
      const lon = tileXToLon(x + i / s, zoom);
      const { height, sea } = heightAt((i / s) * 256, (j / s) * 256);
      const p = geodeticToEcef(lat, lon, ellipsoidal(lat, lon, height));
      const k = j * (s + 1) + i;
      positions.set([p.x - centre.x, p.y - centre.y, p.z - centre.z], k * 3);
      uvs.set([i / s, 1 - j / s], k * 2);
      far.set([sea, (x + i / s) * toZ15 - ref.x, (y + j / s) * toZ15 - ref.y], k * 3);
    }
  }
  const indices = new Uint32Array(s * s * 6);
  let n = 0;
  for (let j = 0; j < s; j++)
    for (let i = 0; i < s; i++) {
      const a = j * (s + 1) + i;
      const b = a + 1;
      const c2 = a + (s + 1);
      // Counter-clockwise from above (north = −j), as the near terrain's chunks.
      indices.set([a, c2, b, b, c2, c2 + 1], n);
      n += 6;
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("aFar", new BufferAttribute(far, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // The carpet raises the land after the bounds are taken.
  if (geometry.boundingSphere) geometry.boundingSphere.radius += CARPET;
  return { geometry, centre, up };
}

type FarTile = {
  key: string;
  x: number;
  y: number;
  mesh: Mesh<BufferGeometry, MeshStandardNodeMaterial> | null;
  centre: Vector3 | null;
  photo: Texture | null;
};

/** Where the far ground's tiles come from (GSI's; tests pass their own). */
export type FarGroundSources = {
  dem(zoom: number, x: number, y: number): Promise<DemTile | null>;
  photo(zoom: number, x: number, y: number): Promise<Texture | null>;
};

/** What the far ground needs of the renderer. */
export type FarGroundRenderer = Pick<WebGPURenderer, "getMaxAnisotropy"> &
  Partial<Pick<WebGPURenderer, "compileAsync">>;

async function fetchDem(zoom: number, x: number, y: number): Promise<DemTile | null> {
  try {
    const res = await fetch(GSI.dem10(zoom, x, y));
    if (!res.ok) return null;
    // Colour management or premultiplication would corrupt the packed elevation bits.
    const bitmap = await createImageBitmap(await res.blob(), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba = ctx.getImageData(0, 0, 256, 256).data;
    const out = new Float32Array(256 * 256);
    for (let i = 0; i < out.length; i++) out[i] = decodeGsiDem(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    return out;
  } catch {
    return null;
  }
}

async function fetchPhoto(zoom: number, x: number, y: number): Promise<CanvasTexture | null> {
  try {
    const res = await fetch(GSI.photo(zoom, x, y));
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const photo = new CanvasTexture(canvas);
    photo.colorSpace = SRGBColorSpace;
    return photo;
  } catch {
    return null;
  }
}

/** GSI's dem_png and seamless photo. */
export const GSI_SOURCES: FarGroundSources = { dem: fetchDem, photo: fetchPhoto };

/**
 * What the far ground holds, for tests and the console. Bounded: `meshes` ≤ (2·ring+1)² (9 or 25),
 * `demCached` ≤ (2·ring+2)² (16 or 36: the ring and its east and south neighbours), `loading` ≤
 * MAX_CONCURRENT_LOADS; `built − disposed` = `meshes`.
 */
export type FarGroundStats = {
  tiles: number;
  meshes: number;
  demCached: number;
  loading: number;
  built: number;
  disposed: number;
};

export class FarGround {
  private readonly tiles = new Map<string, FarTile>();
  private readonly dem = new Map<string, Promise<DemTile | null>>();
  private loading = 0;
  private built = 0;
  private disposed = 0;
  /** The ring for the player's tile (recomputed only when that tile changes). */
  private ringKey = "";
  private wanted: Array<{ x: number; y: number; ring: number }> = [];
  /** DEM tiles the ring needs: its own and their east and south neighbours. */
  private needed = new Set<string>();
  /** The material's pipeline, built off the frame once before the first tile shows. */
  private compiled: Promise<void> | null = null;
  private frame: LocalFrame;
  private readonly zoom = QUALITY.farGroundZoom;
  private readonly ring = QUALITY.farGroundRing;
  private readonly segments = QUALITY.farGroundSegments;
  /** z15 tile the cut-out's coordinates count from (fixed: float32 keeps metres near it). */
  private readonly ref: { x: number; y: number };
  // Shared by every tile's material.
  private readonly player = uniform(new Vector2());
  private readonly ramp = uniform(
    new Vector2(QUALITY.buildingLoadRadius, QUALITY.buildingLoadRadius + CARPET_RAMP),
  );
  /** The near terrain's square (TileRect relative to ref); empty when it has none yet. */
  private readonly hole = uniform(new Vector4(0, 0, 0, 0));
  private readonly tmp = new Matrix4();
  private readonly tmpV = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly renderer: FarGroundRenderer,
    private readonly ellipsoidal: (lat: number, lon: number, orthometric: number) => number,
    frame: LocalFrame,
    private readonly sources: FarGroundSources = GSI_SOURCES,
  ) {
    this.frame = frame;
    this.ref = {
      x: Math.floor(lonToTileX(frame.origin.lon, TERRAIN_ZOOM)),
      y: Math.floor(latToTileY(frame.origin.lat, TERRAIN_ZOOM)),
    };
  }

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
    for (const t of this.tiles.values()) this.place(t);
  }

  /** Per frame: the player's place and the near terrain's square of z15 tiles (null: none yet). */
  update(lat: number, lon: number, nearSquare: TileRect | null): void {
    const p = this.frame.toLocal(lat, lon, this.frame.origin.h, this.tmpV);
    this.player.value.set(p.x, p.z);
    const r = this.ref;
    if (nearSquare)
      this.hole.value.set(nearSquare.x0 - r.x, nearSquare.y0 - r.y, nearSquare.x1 - r.x, nearSquare.y1 - r.y);
    else this.hole.value.set(0, 0, 0, 0);
    // Not before the chunk under the player is built: the same GSI server sends both.
    const isNearReady = nearSquare !== null;
    if (!isNearReady) return;
    const ringKey = `${Math.floor(lonToTileX(lon, this.zoom))}/${Math.floor(latToTileY(lat, this.zoom))}`;
    const isNewRing = ringKey !== this.ringKey;
    if (isNewRing) this.moveRing(ringKey, lat, lon);
    const hasAll = this.tiles.size >= this.wanted.length;
    if (hasAll) return;
    for (const w of this.wanted) {
      const key = `${w.x}/${w.y}`;
      const isKnown = this.tiles.has(key);
      if (isKnown || this.loading >= MAX_CONCURRENT_LOADS) continue;
      const tile: FarTile = { key, x: w.x, y: w.y, mesh: null, centre: null, photo: null };
      this.tiles.set(key, tile);
      this.loading++;
      void this.build(tile).finally(() => this.loading--);
    }
  }

  dispose(): void {
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.dem.clear();
  }

  get stats(): FarGroundStats {
    let meshes = 0;
    for (const t of this.tiles.values()) if (t.mesh) meshes++;
    return {
      tiles: this.tiles.size,
      meshes,
      demCached: this.dem.size,
      loading: this.loading,
      built: this.built,
      disposed: this.disposed,
    };
  }

  /** A new ring: tiles that left it are disposed, DEM tiles it no longer needs dropped. */
  private moveRing(ringKey: string, lat: number, lon: number): void {
    this.ringKey = ringKey;
    this.wanted = farTilesAround(lat, lon, this.zoom, this.ring);
    const keys = new Set(this.wanted.map((w) => `${w.x}/${w.y}`));
    for (const [key, t] of this.tiles) {
      const isKept = keys.has(key);
      if (isKept) continue;
      this.disposeTile(t);
      this.tiles.delete(key);
    }
    this.needed = new Set();
    for (const w of this.wanted)
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ])
        this.needed.add(`${w.x + dx}/${w.y + dy}`);
    for (const key of this.dem.keys()) if (!this.needed.has(key)) this.dem.delete(key);
  }

  private demTile(x: number, y: number): Promise<DemTile | null> {
    const key = `${x}/${y}`;
    let p = this.dem.get(key);
    if (!p) {
      p = this.sources.dem(this.zoom, x, y);
      // Cached only while the ring needs it (a fetch started for a ring since left is not kept).
      if (this.needed.has(key)) this.dem.set(key, p);
    }
    return p;
  }

  private async build(tile: FarTile): Promise<void> {
    const { x, y } = tile;
    const [dem, east, south, southEast, photo] = await Promise.all([
      this.demTile(x, y),
      this.demTile(x + 1, y),
      this.demTile(x, y + 1),
      this.demTile(x + 1, y + 1),
      this.sources.photo(this.zoom, x, y),
    ]);
    const isGone = this.tiles.get(tile.key) !== tile;
    if (isGone || !dem) {
      photo?.dispose();
      return;
    }
    const { geometry, centre, up } = farTileGeometry(
      x,
      y,
      this.zoom,
      this.segments,
      (px, py) => sampleDem(dem, px, py, east, south, southEast),
      this.ellipsoidal,
      this.ref,
    );
    if (photo) photo.anisotropy = Math.min(8, this.renderer.getMaxAnisotropy());
    const mesh = new Mesh(geometry, this.material(photo, up));
    mesh.name = `far-ground-${this.zoom}-${x}-${y}`;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    tile.mesh = mesh;
    tile.centre = centre;
    tile.photo = photo;
    this.built++;
    this.place(tile);
    // The first tile's pipeline is built asynchronously before any tile shows (the node material
    // is the same graph for every tile): a synchronous first draw stalled the frame.
    this.compiled ??= this.precompile(mesh);
    await this.compiled;
    const isStillWanted = this.tiles.get(tile.key) === tile;
    if (isStillWanted) this.scene.add(mesh);
  }

  private async precompile(mesh: Mesh): Promise<void> {
    const compile = this.renderer.compileAsync;
    if (!compile) return;
    try {
      await compile.call(this.renderer, mesh, new PerspectiveCamera(), this.scene);
    } catch {
      // Drawn and built on first use instead.
    }
  }

  private place(tile: FarTile): void {
    if (!tile.mesh || !tile.centre) return;
    tile.mesh.matrix.multiplyMatrices(this.frame.ecefToLocal, this.tmp.makeTranslation(tile.centre));
    tile.mesh.matrixWorldNeedsUpdate = true;
  }

  /**
   * The tile's material: the photo (or a city grey), the carpet raised in the vertex stage, the near
   * terrain's square cut out, glossy sea, and the city's glow at night.
   */
  private material(photo: Texture | null, up: Vector3): MeshStandardNodeMaterial {
    const m = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    m.name = "far-ground";
    const aFar = attribute<"vec3">("aFar", "vec3");
    const sea = smoothstep(0.3, 0.7, aFar.x);
    // How: the carpet is raised along the tile's own up (its ECEF radial), by the horizontal
    // distance of the unraised vertex from the player in the game frame.
    const world = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;
    const fromPlayer = length(world.xz.sub(this.player));
    const raise = smoothstep(this.ramp.x, this.ramp.y, fromPlayer).mul(sea.oneMinus()).mul(CARPET);
    m.positionNode = positionGeometry.add(vec3(up.x, up.y, up.z).mul(raise));
    // Leave the near terrain's square to it (its own photo and DEM are finer).
    const t = aFar.yz;
    const h = this.hole;
    const isInSquare = t.x
      .greaterThanEqual(h.x)
      .and(t.x.lessThan(h.z))
      .and(t.y.greaterThanEqual(h.y))
      .and(t.y.lessThan(h.w));
    m.maskNode = isInSquare.not();
    const land = photo ? texture(photo, uv()).rgb : vec3(0.18, 0.18, 0.17);
    const water = vec3(0.025, 0.04, 0.05);
    m.colorNode = mix(land, water, sea);
    m.roughnessNode = mix(float(0.95), float(0.12), sea);
    // Lights over built-up land: not where the photo is green (parks, the palace, riverbanks).
    const greenness = land.g.sub(max(land.r, land.b));
    const builtUp = smoothstep(0.035, 0.0, greenness).mul(sea.oneMinus());
    const patches = valueNoise(t.mul(3)).mul(0.9).add(0.55);
    const luma = dot(land, vec3(0.2126, 0.7152, 0.0722));
    // Brighter blocks (roofs, roads) light up more than dark ones; warm sodium and white LED mixed.
    const glow = vec3(1, 0.78, 0.52)
      .mul(CITY_GLOW)
      .mul(patches)
      .mul(select(luma.greaterThan(0.25), float(1.2), float(0.85)));
    m.emissiveNode = glow.mul(builtUp).mul(facadeUniforms.uNight);
    return m;
  }

  private disposeTile(t: FarTile): void {
    if (!t.mesh) return;
    this.disposed++;
    this.scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    t.photo?.dispose();
    t.mesh.material.dispose();
  }
}

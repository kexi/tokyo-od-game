import RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  LinearFilter,
  Matrix4,
  Mesh,
  RedFormat,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { texture, uv, vec2 } from "three/tsl";
import { MeshStandardNodeMaterial, type TextureNode, type WebGPURenderer } from "three/webgpu";
import {
  GSI,
  PLATEAU_ORTHO,
  TERRAIN_COLLIDER_RADIUS,
  TERRAIN_SEGMENTS,
  TERRAIN_ZOOM,
  type GroundStyle,
} from "../config";
import { QUALITY } from "../device";
import { geodeticToEcef } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";
import type { DemStore } from "./dem";
import { FarGround, type TileRect } from "./farGround";

type Chunk = {
  x: number;
  y: number;
  mesh: Mesh<BufferGeometry, MeshStandardNodeMaterial>;
  centerEcef: Vector3;
  collider: RAPIER.Collider | null;
  imageryZoom: number;
  imageryStyle: GroundStyle;
  imageryLoading: boolean;
  /** The chunk's water cut-out (see GroundWater): its texture is the node's value. */
  water: TextureNode;
  waterMask: Uint8Array | null;
  waterSize: number;
  waterVersion: number;
};

/**
 * What the water layer tells the ground: inside rivers, canals and the sea its own surface replaces
 * the terrain (the DEM keeps the water as surveyed, often above today's level), and the terrain has
 * no collider there, so the car falls in rather than driving on the water.
 */
export type GroundWater = {
  /** Changes whenever the water known inside the z15 chunk changes. */
  versionAt(x: number, y: number): number;
  /** Water over the z15 chunk (rows north first, 0–255 = share of the pixel) or null when it has none. */
  maskAt(x: number, y: number): { data: Uint8Array; size: number } | null;
};

/** No water: one dry texel, filtered like the masks that replace it (they share the sampler). */
const NO_WATER = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat);
NO_WATER.magFilter = LinearFilter;
NO_WATER.minFilter = LinearFilter;
NO_WATER.needsUpdate = true;

const S = TERRAIN_SEGMENTS;
const MAX_CONCURRENT_BUILDS = 3;
const RENDER_RADIUS = QUALITY.terrainRadius;
/** Imagery zoom by ring: sharpest under the player, capped on phones (2048² canvases are heavy). */
const imageryZoom = (ring: number) =>
  Math.min(
    QUALITY.maxImageryZoom,
    ring === 0 ? TERRAIN_ZOOM + 3 : ring === 1 ? TERRAIN_ZOOM + 2 : TERRAIN_ZOOM + 1,
  );

/**
 * Ground built from GSI DEM tiles, one chunk per z15 tile, draped with GSI imagery.
 * Vertices are stored relative to each chunk's ECEF centre so re-anchoring the local frame only
 * changes mesh matrices; physics colliders (which need local coordinates) are rebuilt instead.
 */
export class Terrain {
  private readonly chunks = new Map<string, Chunk>();
  private readonly building = new Set<string>();
  private frame: LocalFrame;
  private style: GroundStyle = "photo";
  private readonly tmpMatrix = new Matrix4();
  private water: GroundWater | null = null;
  /** The ground beyond these chunks, to the horizon (farGround.ts). */
  private readonly far: FarGround;
  /** The square of chunks drawn (all built), which the far ground leaves out; null before any. */
  private square: TileRect | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly dem: DemStore,
    private readonly renderer: WebGPURenderer,
    frame: LocalFrame,
  ) {
    this.frame = frame;
    this.far = new FarGround(scene, renderer, (lat, lon, h) => dem.ellipsoidal(lat, lon, h), frame);
  }

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
    this.far.setFrame(frame);
    for (const chunk of this.chunks.values()) {
      this.placeMesh(chunk);
      // Rebuild immediately: leaving the car without ground for even a frame drops it through.
      if (!chunk.collider) continue;
      this.removeCollider(chunk);
      this.createCollider(chunk);
    }
  }

  setWater(water: GroundWater): void {
    this.water = water;
  }

  setStyle(style: GroundStyle): void {
    this.style = style;
  }

  getStyle(): GroundStyle {
    return this.style;
  }

  /** True once the chunk under the given point has a physics collider. */
  hasColliderAt(lat: number, lon: number): boolean {
    const x = Math.floor(lonToTileX(lon, TERRAIN_ZOOM));
    const y = Math.floor(latToTileY(lat, TERRAIN_ZOOM));
    return this.chunks.get(`${x}/${y}`)?.collider != null;
  }

  update(lat: number, lon: number): void {
    const cx = Math.floor(lonToTileX(lon, TERRAIN_ZOOM));
    const cy = Math.floor(latToTileY(lat, TERRAIN_ZOOM));

    const wanted: Array<{ x: number; y: number; ring: number }> = [];
    for (let dy = -RENDER_RADIUS; dy <= RENDER_RADIUS; dy++) {
      for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
        wanted.push({ x: cx + dx, y: cy + dy, ring: Math.max(Math.abs(dx), Math.abs(dy)) });
      }
    }
    wanted.sort((a, b) => a.ring - b.ring);

    for (const w of wanted) {
      const key = `${w.x}/${w.y}`;
      const isQueued = this.chunks.has(key) || this.building.has(key);
      if (isQueued || this.building.size >= MAX_CONCURRENT_BUILDS) continue;
      this.building.add(key);
      void this.buildChunk(w.x, w.y, w.ring).finally(() => this.building.delete(key));
    }

    let createdCollider = false;
    let refreshedWater = false;
    for (const [key, chunk] of this.chunks) {
      const ring = Math.max(Math.abs(chunk.x - cx), Math.abs(chunk.y - cy));
      if (ring > RENDER_RADIUS + 1) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
        continue;
      }
      // New water re-cuts one chunk per frame: its mask texture and, near the player, the collider.
      const waterVersion = this.water?.versionAt(chunk.x, chunk.y) ?? 0;
      if (waterVersion !== chunk.waterVersion && !refreshedWater) {
        this.applyWater(chunk, waterVersion);
        refreshedWater = true;
      }
      const wantsCollider = ring <= TERRAIN_COLLIDER_RADIUS;
      // One trimesh per frame keeps collider creation from causing visible hitches.
      if (wantsCollider && !chunk.collider && !createdCollider) {
        this.createCollider(chunk);
        createdCollider = true;
      } else if (!wantsCollider && chunk.collider) {
        this.removeCollider(chunk);
      }
      // z18 (~0.5 m/px) under the car, z17 next ring, z16 at the fog edge.
      const zoom = imageryZoom(ring);
      // Upgrade when approaching; downgrade only when two levels too sharp (bounded GPU memory
      // without thrashing at ring boundaries).
      const needsImagery =
        chunk.imageryZoom < zoom || chunk.imageryZoom > zoom + 1 || chunk.imageryStyle !== this.style;
      if (needsImagery && !chunk.imageryLoading) void this.loadImagery(chunk, zoom);
    }
    this.square = builtSquare(cx, cy, RENDER_RADIUS, (x, y) => this.chunks.has(`${x}/${y}`));
    this.showSquare(this.square);
    this.far.update(lat, lon, this.square);
  }

  /** The square of z15 chunks drawn around the player (the far ground leaves it out), or null. */
  coverage(): TileRect | null {
    return this.square;
  }

  /** Chunks inside the square are drawn; the rest (kept for a while past the radius) are not. */
  private showSquare(square: TileRect | null): void {
    for (const chunk of this.chunks.values()) {
      const isInside =
        square !== null &&
        chunk.x >= square.x0 &&
        chunk.x < square.x1 &&
        chunk.y >= square.y0 &&
        chunk.y < square.y1;
      chunk.mesh.visible = isInside;
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    this.far.dispose();
  }

  private async buildChunk(x: number, y: number, ring: number): Promise<void> {
    // Corner samples at i = S read pixel 0 of the east/south neighbours, so load those too.
    await Promise.all([
      this.dem.load(x, y),
      this.dem.load(x + 1, y),
      this.dem.load(x, y + 1),
      this.dem.load(x + 1, y + 1),
    ]);

    const midLat = tileYToLat(y + 0.5, TERRAIN_ZOOM);
    const midLon = tileXToLon(x + 0.5, TERRAIN_ZOOM);
    const c = geodeticToEcef(midLat, midLon, 40);
    const centerEcef = new Vector3(c.x, c.y, c.z);

    const positions = new Float32Array((S + 1) * (S + 1) * 3);
    const uvs = new Float32Array((S + 1) * (S + 1) * 2);
    for (let j = 0; j <= S; j++) {
      const lat = tileYToLat(y + j / S, TERRAIN_ZOOM);
      for (let i = 0; i <= S; i++) {
        const lon = tileXToLon(x + i / S, TERRAIN_ZOOM);
        const orthometric = this.dem.sampleGlobal((x + i / S) * 256, (y + j / S) * 256);
        const p = geodeticToEcef(lat, lon, this.dem.ellipsoidal(lat, lon, orthometric));
        const k = j * (S + 1) + i;
        positions[k * 3] = p.x - centerEcef.x;
        positions[k * 3 + 1] = p.y - centerEcef.y;
        positions[k * 3 + 2] = p.z - centerEcef.z;
        uvs[k * 2] = i / S;
        uvs[k * 2 + 1] = 1 - j / S;
      }
    }
    const indices = new Uint32Array(S * S * 6);
    let n = 0;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const a = j * (S + 1) + i;
        const b = a + 1;
        const c2 = a + (S + 1);
        const d = c2 + 1;
        // Counter-clockwise when viewed from above (north = -j direction).
        indices.set([a, c2, b, b, c2, d], n);
        n += 6;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new MeshStandardNodeMaterial({ color: 0x8a8f86, roughness: 0.97, metalness: 0 });
    const water = texture(NO_WATER);
    const mesh = new Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.name = `terrain-${x}-${y}`;

    const chunk: Chunk = {
      x,
      y,
      mesh,
      centerEcef,
      collider: null,
      imageryZoom: 0,
      imageryStyle: this.style,
      imageryLoading: false,
      water,
      waterMask: null,
      waterSize: 0,
      waterVersion: -1,
    };
    this.placeMesh(chunk);
    this.scene.add(mesh);
    this.chunks.set(`${x}/${y}`, chunk);
    void this.loadImagery(chunk, imageryZoom(ring));
  }

  private placeMesh(chunk: Chunk): void {
    const t = this.tmpMatrix.makeTranslation(chunk.centerEcef);
    chunk.mesh.matrix.multiplyMatrices(this.frame.ecefToLocal, t);
    chunk.mesh.matrixWorldNeedsUpdate = true;
  }

  private createCollider(chunk: Chunk): void {
    const src = chunk.mesh.geometry.getAttribute("position") as BufferAttribute;
    const verts = new Float32Array(src.count * 3);
    const v = new Vector3();
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(chunk.mesh.matrix);
      verts.set([v.x, v.y, v.z], i * 3);
    }
    const index = chunk.mesh.geometry.getIndex();
    if (!index) return;
    const desc = RAPIER.ColliderDesc.trimesh(
      verts,
      this.dryTriangles(chunk, index.array),
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    ).setFriction(1.0);
    chunk.collider = this.world.createCollider(desc);
  }

  /**
   * The chunk's triangles minus those lying wholly on water (all three corners and the middle):
   * the riverbed of the DEM is not ground to drive on. Triangles reaching a bank stay, so the
   * shore and streams narrower than the grid (~15 m) keep their ground.
   */
  private dryTriangles(chunk: Chunk, index: ArrayLike<number>): Uint32Array {
    const mask = chunk.waterMask;
    if (!mask) return new Uint32Array(index);
    const size = chunk.waterSize;
    const isWet = (i: number, j: number) => {
      const px = Math.min(size - 1, Math.floor((i / S) * size));
      const py = Math.min(size - 1, Math.floor((j / S) * size));
      return mask[py * size + px] >= 128;
    };
    const kept: number[] = [];
    for (let t = 0; t + 2 < index.length; t += 3) {
      const corners = [index[t], index[t + 1], index[t + 2]].map((k) => [
        k % (S + 1),
        Math.floor(k / (S + 1)),
      ]);
      const ci = (corners[0][0] + corners[1][0] + corners[2][0]) / 3;
      const cj = (corners[0][1] + corners[1][1] + corners[2][1]) / 3;
      const isOnWater = corners.every(([i, j]) => isWet(i, j)) && isWet(ci, cj);
      if (!isOnWater) kept.push(index[t], index[t + 1], index[t + 2]);
    }
    return new Uint32Array(kept);
  }

  private applyWater(chunk: Chunk, version: number): void {
    chunk.waterVersion = version;
    const mask = this.water?.maskAt(chunk.x, chunk.y) ?? null;
    if (chunk.water.value !== NO_WATER) chunk.water.value.dispose();
    chunk.waterMask = mask?.data ?? null;
    chunk.waterSize = mask?.size ?? 0;
    if (mask) {
      const maskTexture = new DataTexture(mask.data, mask.size, mask.size, RedFormat);
      maskTexture.magFilter = LinearFilter;
      maskTexture.minFilter = LinearFilter;
      maskTexture.needsUpdate = true;
      chunk.water.value = maskTexture;
    } else {
      chunk.water.value = NO_WATER;
    }
    if (!chunk.collider) return;
    this.removeCollider(chunk);
    this.createCollider(chunk);
  }

  private removeCollider(chunk: Chunk): void {
    if (!chunk.collider) return;
    this.world.removeCollider(chunk.collider, false);
    chunk.collider = null;
  }

  private async loadImagery(chunk: Chunk, zoom: number): Promise<void> {
    chunk.imageryLoading = true;
    const style = this.style;
    const n = 2 ** (zoom - TERRAIN_ZOOM);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256 * n;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#5d6b6e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const jobs: Promise<void>[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const tx = chunk.x * n + i;
        const ty = chunk.y * n + j;
        const url = style === "photo" ? GSI.photo(zoom, tx, ty) : PLATEAU_ORTHO(zoom, tx, ty);
        jobs.push(
          fetch(url)
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
            .then((b) => createImageBitmap(b))
            .then((bmp) => {
              ctx.drawImage(bmp, i * 256, j * 256);
              bmp.close();
            })
            .catch(() => undefined),
        );
      }
    }
    await Promise.all(jobs);
    chunk.imageryLoading = false;
    const isDisposed = !this.chunks.has(`${chunk.x}/${chunk.y}`);
    if (isDisposed) return;
    const photo = new CanvasTexture(canvas);
    photo.colorSpace = SRGBColorSpace;
    photo.anisotropy = Math.min(8, this.renderer.getMaxAnisotropy());
    const material = chunk.mesh.material;
    material.map?.dispose();
    material.map = photo;
    material.color.set(0xffffff);
    // Cut the water out of the ground: the photo there shows the river from above, and the water
    // layer draws the surface and the shore walls instead. Only once the photo is on, which is
    // also when the river would show as ground. The mask's rows run north first (v = 1 here).
    material.maskNode ??= chunk.water.sample(vec2(uv().x, uv().y.oneMinus())).r.lessThanEqual(0.5);
    material.needsUpdate = true;
    chunk.imageryZoom = zoom;
    chunk.imageryStyle = style;
  }

  private disposeChunk(chunk: Chunk): void {
    this.removeCollider(chunk);
    if (chunk.water.value !== NO_WATER) chunk.water.value.dispose();
    this.scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.map?.dispose();
    chunk.mesh.material.dispose();
  }
}

/**
 * The widest square of z15 chunks round (cx, cy), up to `radius` rings, whose chunks are all built
 * (`isBuilt`), or null when the centre is not. Why a square of built chunks, not every chunk there
 * is: the far ground is cut out exactly there, so a chunk still loading leaves the far ground in its
 * place, never a hole.
 */
export function builtSquare(
  cx: number,
  cy: number,
  radius: number,
  isBuilt: (x: number, y: number) => boolean,
): TileRect | null {
  let reach = -1;
  for (let r = 0; r <= radius; r++) {
    let isComplete = true;
    for (let dy = -r; dy <= r && isComplete; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const isRing = Math.max(Math.abs(dx), Math.abs(dy)) === r;
        if (isRing && !isBuilt(cx + dx, cy + dy)) {
          isComplete = false;
          break;
        }
      }
    if (!isComplete) break;
    reach = r;
  }
  if (reach < 0) return null;
  return { x0: cx - reach, y0: cy - reach, x1: cx + reach + 1, y1: cy + reach + 1 };
}

/**
 * Height (T.P. m) of the drawn ground at a point: the chunks' grid triangles (TERRAIN_SEGMENTS per
 * z15 tile, ~15 m), which is what a wall must meet, rather than the 5 m DEM between grid points.
 */
export function meshHeightAt(dem: DemStore, lat: number, lon: number): number {
  const gi = lonToTileX(lon, TERRAIN_ZOOM) * S;
  const gj = latToTileY(lat, TERRAIN_ZOOM) * S;
  const i0 = Math.floor(gi);
  const j0 = Math.floor(gj);
  const u = gi - i0;
  const v = gj - j0;
  const h = (i: number, j: number) => dem.sampleGlobal((i / S) * 256, (j / S) * 256);
  // Each cell is split along its b–c diagonal (see buildChunk): corner a = (i, j) on one side.
  const isNearA = u + v <= 1;
  if (isNearA) {
    const a = h(i0, j0);
    return a + u * (h(i0 + 1, j0) - a) + v * (h(i0, j0 + 1) - a);
  }
  const d = h(i0 + 1, j0 + 1);
  return d + (1 - u) * (h(i0, j0 + 1) - d) + (1 - v) * (h(i0 + 1, j0) - d);
}

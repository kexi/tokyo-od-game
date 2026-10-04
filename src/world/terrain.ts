import RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from "three";
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

type Chunk = {
  x: number;
  y: number;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  centerEcef: Vector3;
  collider: RAPIER.Collider | null;
  imageryZoom: number;
  imageryStyle: GroundStyle;
  imageryLoading: boolean;
};

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

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly dem: DemStore,
    private readonly renderer: WebGLRenderer,
    frame: LocalFrame,
  ) {
    this.frame = frame;
  }

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
    for (const chunk of this.chunks.values()) {
      this.placeMesh(chunk);
      // Rebuild immediately: leaving the car without ground for even a frame drops it through.
      if (!chunk.collider) continue;
      this.removeCollider(chunk);
      this.createCollider(chunk);
    }
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
    for (const [key, chunk] of this.chunks) {
      const ring = Math.max(Math.abs(chunk.x - cx), Math.abs(chunk.y - cy));
      if (ring > RENDER_RADIUS + 1) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
        continue;
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
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
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

    const material = new MeshStandardMaterial({ color: 0x8a8f86, roughness: 0.97, metalness: 0 });
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
      new Uint32Array(index.array),
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    ).setFriction(1.0);
    chunk.collider = this.world.createCollider(desc);
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
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    chunk.mesh.material.map?.dispose();
    chunk.mesh.material.map = texture;
    chunk.mesh.material.color.set(0xffffff);
    chunk.mesh.material.needsUpdate = true;
    chunk.imageryZoom = zoom;
    chunk.imageryStyle = style;
  }

  private disposeChunk(chunk: Chunk): void {
    this.removeCollider(chunk);
    this.scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.map?.dispose();
    chunk.mesh.material.dispose();
  }
}

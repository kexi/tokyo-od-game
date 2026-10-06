import RAPIER from "@dimforge/rapier3d-compat";
import { reanchorCollider } from "../physics/reanchor";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  GLTFExtensionsPlugin,
  LoadRegionPlugin,
  SphereRegion,
  UnloadTilesPlugin,
} from "3d-tiles-renderer/plugins";
import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  Matrix4,
  Mesh,
  Sphere,
  Vector2,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
} from "three";
import { BUILDING_COLLIDER_RADIUS, PLATEAU_TILESET } from "../config";
import { QUALITY } from "../device";
import type { LocalFrame } from "../geo/frame";
import {
  addFacadeAttribute,
  facadeMaterial,
  farFacadeMaterial,
  facadeUniforms,
  setFacadeOrigin,
  updateFacadeClock,
} from "./facade";
import { sharedDraco } from "../render/draco";
import { BuildingMetadataPlugin } from "./buildingMetadata";

type Model = {
  scene: Object3D;
  visible: boolean;
  sphere: Sphere | null;
  collider: RAPIER.Collider | null;
};

// The streamed town; beyond it the far skyline (below) has only the coarse tiles. Why a radius:
// the Tokyo-wide tileset would otherwise fill the LRU with coarse tiles of distant wards and
// starve nearby detail.
const LOAD_RADIUS = QUALITY.buildingLoadRadius;
// Full detail in every direction around the car so colliders exist behind/beside it too.
const DETAIL_RADIUS = 250;
/** Colliders go only this far beyond their radius, so one is not rebuilt at the edge every tick. */
const COLLIDER_HYSTERESIS = 60;
const COLLIDER_BUDGET_MS = 4;
/**
 * The far skyline's first PLATEAU level per municipality must be at least this coarse (m): Taito's
 * tileset is a quadtree whose first content is already the full detail (errors 32–64 m, ~0.8 MB a
 * tile, 14 MB for the ward), which a skyline 10 km off does not need.
 */
const FIRST_MIN_ERROR = 100;
/**
 * The far skyline's LRU: geometry bytes (its tiles are ~0.2–1.2k triangles, ~20–80 KB on the GPU
 * each) and items (tiles with content plus the ~30–50 municipalities' tileset.json pointers).
 */
export const FAR_CACHE = {
  minBytes: (QUALITY.isMobile ? 16 : 40) * 1024 ** 2,
  maxBytes: (QUALITY.isMobile ? 24 : 64) * 1024 ** 2,
  minItems: 200,
  maxItems: 320,
};
/** Milliseconds after which the far skyline starts even if the town is still loading. */
const FAR_START_MS = 15_000;
/** Main-thread milliseconds a frame may spend preparing far tiles (the rest wait, hidden). */
const FAR_PREPARE_BUDGET_MS = 4;

/** A tile as the tiles renderer's preprocessNode hands it to plugins (the tileset JSON, extended). */
export type TileNode = {
  content?: { uri?: string };
  geometricError: number;
  children?: TileNode[];
  internal?: { depthFromRenderedParent: number; hasUnrenderableContent?: boolean };
};

const isRenderable = (t: TileNode) => Boolean(t.content?.uri && !/\.json$/i.test(t.content.uri));

/**
 * Prune a tileset's JSON tree, in place, so that only coarse levels remain: a tile with content
 * stops (becomes a leaf) as soon as a child is finer than `minError`; a tile without (a group)
 * drops children with content finer than `minError`, or than FIRST_MIN_ERROR for the first content
 * under it (`hasContentAbove` false). The whole tree at once, when its root arrives: the renderer
 * preprocesses children lazily, and the subtrees it never reaches (out of the region, out of view)
 * would otherwise stay in memory at full detail (a ward's tileset.json is 100–200 KB of JSON).
 */
export function pruneTree(
  tile: TileNode,
  minError: number,
  firstMinError = FIRST_MIN_ERROR,
  hasContentAbove = false,
): void {
  const children = tile.children ?? [];
  if (children.length === 0) return;
  const hasContent = isRenderable(tile);
  if (hasContent) {
    const hasFiner = children.some((c) => c.geometricError < minError);
    if (hasFiner) {
      tile.children = [];
      return;
    }
  } else {
    const least = hasContentAbove ? minError : firstMinError;
    tile.children = children.filter((c) => !isRenderable(c) || c.geometricError >= least);
  }
  for (const c of tile.children ?? []) pruneTree(c, minError, firstMinError, hasContentAbove || hasContent);
}

/**
 * A tiles-renderer plugin keeping the tileset to its coarse levels: each tileset's tree is pruned
 * (pruneTree) as its root is preprocessed (no parent, or a parent pointing at a tileset.json).
 */
class CoarseTilesPlugin {
  readonly name = "COARSE_TILES_PLUGIN";
  constructor(private readonly minError: number) {}
  preprocessNode(tile: TileNode, _dir: string, parent: TileNode | null): void {
    const isTilesetRoot = !parent || parent.internal?.hasUnrenderableContent === true;
    if (!isTilesetRoot) return;
    pruneTree(tile, this.minError, FIRST_MIN_ERROR, (parent?.internal?.depthFromRenderedParent ?? 0) > 0);
  }
}

/** What preparing a far tile's meshes needs from the buildings (the landmarks' cut-outs). */
export type FarTileHost = { cut(geometry: BufferGeometry, ecef: Float32Array): void };

/**
 * Turn a far tile's meshes into the far skyline's: façade attribute, landmark cut-outs, the shared
 * simplified material, no shadows; its batch and feature tables dropped (they hold the whole b3dm,
 * ~150 KB, mostly attribute JSON, and nothing reads them). The tile's own materials are disposed:
 * the renderer disposes only those (it listed them before load-model), never the shared one.
 */
export function prepareFarTile(scene: Object3D, host: FarTileHost): void {
  Object.assign(scene, { batchTable: null, featureTable: null });
  scene.updateMatrixWorld(true);
  const v = new Vector3();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geometry = o.geometry as BufferGeometry;
    const pos = geometry.getAttribute("position");
    const ecef = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      ecef.set([v.x, v.y, v.z], i * 3);
    }
    const ids = geometry.getAttribute("_batchid") ?? geometry.getAttribute("_feature_id_0");
    addFacadeAttribute(geometry, ecef, ids ? (i) => ids.getX(i) : null);
    host.cut(geometry, ecef);
    o.castShadow = false;
    o.receiveShadow = false;
    const own = o.material as Material;
    if (own !== farFacadeMaterial()) own.dispose();
    o.material = farFacadeMaterial();
  });
}

/**
 * The far skyline's tiles renderer: the PLATEAU tileset kept to its coarse levels within `region`.
 * Why no UnloadTilesPlugin (the near town has one): it disposes the *current* material of a tile
 * that leaves the view, here the one material every far tile shares, so each turn of the camera
 * dropped the skyline's pipeline and every far mesh rebuilt its node material (the title screen's
 * slow pan at 大泉学園 grew the heap by ~1.2 GB in 50 s and once hung the loading). Far tiles are
 * small and stay on the GPU until the LRU (FAR_CACHE) evicts them.
 */
export function createFarTiles(
  url: string,
  region: SphereRegion,
  dracoLoader: ReturnType<typeof sharedDraco>,
  minError: number,
  errorTarget: number,
): TilesRenderer {
  const tiles = new TilesRenderer(url);
  tiles.registerPlugin(new BuildingMetadataPlugin());
  tiles.registerPlugin(new GLTFExtensionsPlugin({ rtc: true, dracoLoader }));
  tiles.registerPlugin(new CoarseTilesPlugin(minError));
  const regions = new LoadRegionPlugin();
  regions.addRegion(region);
  tiles.registerPlugin(regions);
  tiles.errorTarget = errorTarget;
  tiles.lruCache.minBytesSize = FAR_CACHE.minBytes;
  tiles.lruCache.maxBytesSize = FAR_CACHE.maxBytes;
  tiles.lruCache.minSize = FAR_CACHE.minItems;
  tiles.lruCache.maxSize = FAR_CACHE.maxItems;
  return tiles;
}

/**
 * PLATEAU building tiles streamed straight from the public CORS-enabled catalogue, plus Rapier
 * trimesh colliders generated on demand from the tiles that are visible near the player.
 */
export class Buildings {
  tiles!: TilesRenderer;
  private readonly models = new Map<Object3D, Model>();
  private readonly draco = sharedDraco();
  private frame: LocalFrame;
  private lastColliderTick = 0;
  private readonly maskRegion = new SphereRegion({ mask: true, errorTarget: 1e9 });
  private readonly detailRegion = new SphereRegion({ mask: false });
  loadedCount = 0;
  /** Footprints (local XZ rings) of buildings drawn by hero models instead (landmarks). */
  private hidden: Vector3[][] = [];
  private hiddenRings: Array<Array<[number, number]>> = [];
  /**
   * The far skyline: the same tileset again, kept to its coarse levels (each ward's largest ~20–80
   * buildings, its towers among them) out to QUALITY.farBuildingRadius, with the simplified façade
   * and no colliders or shadows. Started once the town around the player has loaded.
   */
  private far: TilesRenderer | null = null;
  private readonly farRegion = new SphereRegion({ mask: true, errorTarget: 1e9 });
  private readonly createdAt = performance.now();
  /** Far tiles loaded (for the console). */
  farLoadedCount = 0;
  /** Far tiles loaded but not yet prepared (hidden until then, a few milliseconds a frame). */
  private readonly farPending: Object3D[] = [];
  /** False until the far façade's pipeline is built (asynchronously, before any far tile shows). */
  private isFarCompiled = false;

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly camera: Camera,
    /** What the tiles need to know of the renderer: the canvas size, for the screen-space error. */
    private readonly renderer: {
      getSize(target: Vector2): Vector2;
      compileAsync?(object: Object3D, camera: Camera, targetScene?: Scene | null): Promise<unknown>;
    },
    frame: LocalFrame,
  ) {
    this.frame = frame;
    setFacadeOrigin(frame);
    this.createTiles();
  }

  /**
   * Leave out PLATEAU buildings inside these lon/lat rings (a landmark model stands there). Their
   * triangles are also what the colliders are made of, so the footprints get walls of their own:
   * without them the car drove straight through 東京駅.
   */
  hideFootprints(rings: Array<Array<[number, number]>>): void {
    this.hiddenRings = rings;
    this.hidden = rings.map((r) => r.map(([lon, lat]) => this.frame.toLocal(lat, lon, this.frame.origin.h)));
    if (this.footprintCollider) this.world.removeCollider(this.footprintCollider, false);
    this.footprintCollider = null;
    const vertices: number[] = [];
    const indices: number[] = [];
    // Each edge a wall from well below to well above street level (Tokyo's ground is −5 to 40 m
    // from the frame's origin height); walls only — nothing drives on a landmark's roof.
    for (const ring of this.hidden)
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const base = vertices.length / 3;
        vertices.push(a.x, -60, a.z, b.x, -60, b.z, b.x, 120, b.z, a.x, 120, a.z);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
    if (indices.length === 0) return;
    const desc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices),
    ).setFriction(0.6);
    this.footprintCollider = this.world.createCollider(desc);
  }

  private footprintCollider: RAPIER.Collider | null = null;

  /**
   * Collapse the triangles whose centre lies inside a hidden footprint (degenerate triangles draw
   * nothing), so the landmark model does not fight the PLATEAU copy of the same building.
   */
  private cutFootprints(geometry: BufferGeometry, ecef: Float32Array): void {
    const m = this.frame.ecefToLocal.elements;
    const n = ecef.length / 3;
    const lx = new Float32Array(n);
    const lz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = ecef[i * 3];
      const y = ecef[i * 3 + 1];
      const z = ecef[i * 3 + 2];
      lx[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      lz[i] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const boxes = this.hidden.map((ring) => {
      const xs = ring.map((p) => p.x);
      const zs = ring.map((p) => p.z);
      return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    });
    const inside = (x: number, z: number) =>
      this.hidden.some((ring, k) => {
        const [x0, x1, z0, z1] = boxes[k];
        if (x < x0 || x > x1 || z < z0 || z > z1) return false;
        let isIn = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i];
          const b = ring[j];
          if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) isIn = !isIn;
        }
        return isIn;
      });
    const index = geometry.getIndex();
    const tris = index ? index.count / 3 : n / 3;
    let cut = 0;
    for (let t = 0; t < tris; t++) {
      const [a, b, c] = index
        ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
        : [t * 3, t * 3 + 1, t * 3 + 2];
      if (!inside((lx[a] + lx[b] + lx[c]) / 3, (lz[a] + lz[b] + lz[c]) / 3)) continue;
      cut++;
      if (index) {
        index.setX(t * 3 + 1, a);
        index.setX(t * 3 + 2, a);
      } else {
        const pos = geometry.getAttribute("position");
        pos.setXYZ(b, pos.getX(a), pos.getY(a), pos.getZ(a));
        pos.setXYZ(c, pos.getX(a), pos.getY(a), pos.getZ(a));
      }
    }
    if (cut && index) index.needsUpdate = true;
    else if (cut) geometry.getAttribute("position").needsUpdate = true;
  }

  setFrame(frame: LocalFrame): void {
    const matrix = frame.transformFrom(this.frame);
    const rotation = frame.rotationFrom(this.frame);
    this.frame = frame;
    if (this.hiddenRings.length) this.hideFootprints(this.hiddenRings);
    this.applyFrame();
    if (this.far) this.applyFrameTo(this.far);
    setFacadeOrigin(frame);
    for (const model of this.models.values()) {
      model.sphere = null;
      if (!model.collider) continue;
      reanchorCollider(model.collider, matrix, rotation);
    }
  }

  /** Whether a collider is a building's (a tile's, or a landmark's footprint walls). */
  isCollider(handle: number): boolean {
    if (this.footprintCollider?.handle === handle) return true;
    for (const model of this.models.values()) if (model.collider?.handle === handle) return true;
    return false;
  }

  /** Synchronously build every collider near a point (used before spawning the car). */
  buildCollidersNear(point: Vector3): number {
    let count = 0;
    for (const model of this.models.values()) {
      model.sphere ??= this.computeSphere(model.scene);
      const distance = model.sphere.center.distanceTo(point) - model.sphere.radius;
      if (!model.visible || distance > BUILDING_COLLIDER_RADIUS || model.collider) continue;
      this.createCollider(model);
      count++;
    }
    return count;
  }

  /** 0 = day, 1 = night: how much the lit windows show against the daylight. */
  setNightFactor(f: number): void {
    facadeUniforms.uNight.value = f;
  }

  /**
   * Per frame: the game time (which windows are lit: offices empty out after the evening, homes
   * after midnight, shops at closing time) and how wet the walls are (0–1, Environment.wetness).
   */
  setFacadeClock(gameTime: Date, wetness: number): void {
    updateFacadeClock(gameTime, wetness, performance.now() / 1000);
  }

  /** Why not setResolutionFromRenderer: it is typed for WebGLRenderer, and reads only the size. */
  private setResolution(tiles: TilesRenderer): void {
    const size = this.renderer.getSize(new Vector2());
    tiles.setResolution(this.camera, size.x, size.y);
  }

  onResize(): void {
    this.setResolution(this.tiles);
    if (this.far) this.setResolution(this.far);
  }

  update(player: Vector3, now: number): void {
    this.camera.updateMatrixWorld();
    // Regions live in the tileset's (ECEF) frame.
    const centerEcef = player.clone().applyMatrix4(this.frame.localToEcef);
    this.maskRegion.sphere.set(centerEcef, LOAD_RADIUS);
    this.detailRegion.sphere.set(centerEcef, DETAIL_RADIUS);
    this.farRegion.sphere.set(centerEcef, QUALITY.farBuildingRadius);
    this.tiles.update();
    // After the town (they share the network): the skyline is for the distance.
    const isTownLoaded = this.loadedCount > 0 && this.tiles.loadProgress >= 0.999;
    const isLate = now - this.createdAt > FAR_START_MS;
    if (!this.far && (isTownLoaded || isLate)) this.far = this.createFarTiles();
    this.far?.update();
    this.prepareFarTiles();
    const isColliderTick = now - this.lastColliderTick > 100;
    if (!isColliderTick) return;
    this.lastColliderTick = now;

    // A tile gets its collider once it has been shown near the player and keeps it until it is far
    // or unloaded. Why not follow visibility: tiles leave the frustum when the driver looks aside
    // and a parent hides while its children take over, and either dropped the walls for a moment
    // (one rebuild per tick) — long enough to drive through. Overlapping parent/child walls are fine.
    const wanted: Array<{ model: Model; distance: number }> = [];
    for (const model of this.models.values()) {
      model.sphere ??= this.computeSphere(model.scene);
      const distance = model.sphere.center.distanceTo(player) - model.sphere.radius;
      const isFar = distance > BUILDING_COLLIDER_RADIUS + COLLIDER_HYSTERESIS;
      if (isFar && model.collider) this.removeCollider(model);
      const isWanted = !model.collider && model.visible && distance < BUILDING_COLLIDER_RADIUS;
      if (isWanted) wanted.push({ model, distance });
    }
    // Closest first, within a few milliseconds a tick so building them never stalls a frame.
    wanted.sort((a, b) => a.distance - b.distance);
    const start = performance.now();
    for (const { model } of wanted) {
      this.createCollider(model);
      if (performance.now() - start > COLLIDER_BUDGET_MS) break;
    }
  }

  /** 0..1 progress of the current tile request set; drives the loading screen. */
  loadProgress(): number {
    return this.tiles.loadProgress;
  }

  private createTiles(): void {
    const tiles = new TilesRenderer(PLATEAU_TILESET);
    tiles.registerPlugin(new BuildingMetadataPlugin());
    tiles.registerPlugin(new GLTFExtensionsPlugin({ rtc: true, dracoLoader: this.draco }));
    tiles.registerPlugin(new UnloadTilesPlugin());
    const regions = new LoadRegionPlugin();
    regions.addRegion(this.maskRegion);
    regions.addRegion(this.detailRegion);
    tiles.registerPlugin(regions);
    tiles.errorTarget = QUALITY.isMobile ? 26 : 16;
    this.detailRegion.errorTarget = tiles.errorTarget;
    tiles.lruCache.minBytesSize = QUALITY.buildingCacheBytes * 0.6;
    tiles.lruCache.maxBytesSize = QUALITY.buildingCacheBytes;
    tiles.setCamera(this.camera);
    this.setResolution(tiles);

    tiles.addEventListener("load-model", ({ scene }) => {
      this.loadedCount++;
      // Not yet attached to the group: world matrices are in the tileset's ECEF frame here.
      scene.updateMatrixWorld(true);
      const v = new Vector3();
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const geometry = o.geometry as BufferGeometry;
        const pos = geometry.getAttribute("position");
        const ecef = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          ecef.set([v.x, v.y, v.z], i * 3);
        }
        // getX, not .array: the id attribute may be interleaved with the vertex data.
        const ids = geometry.getAttribute("_batchid") ?? geometry.getAttribute("_feature_id_0");
        addFacadeAttribute(geometry, ecef, ids ? (i) => ids.getX(i) : null);
        if (this.hidden.length) this.cutFootprints(geometry, ecef);
        // Building shadows double the draw calls; phones skip them (the car still casts one).
        o.castShadow = !QUALITY.isMobile;
        o.receiveShadow = true;
        o.material = this.adaptMaterial(o.material as Material);
      });
      this.models.set(scene, { scene, visible: false, sphere: null, collider: null });
    });
    tiles.addEventListener("dispose-model", ({ scene }) => {
      const model = this.models.get(scene);
      if (model) this.removeCollider(model);
      this.models.delete(scene);
      // The façade materials replaced the tile's own after the renderer listed what to dispose.
      scene.traverse((o) => {
        if (o instanceof Mesh) (o.material as Material).dispose();
      });
    });
    tiles.addEventListener("tile-visibility-change", ({ scene, visible }) => {
      const model = this.models.get(scene);
      if (model) model.visible = visible;
    });

    this.tiles = tiles;
    this.scene.add(tiles.group);
    this.applyFrame();
  }

  private applyFrame(): void {
    this.applyFrameTo(this.tiles);
  }

  private applyFrameTo(tiles: TilesRenderer): void {
    const group = tiles.group;
    group.matrixAutoUpdate = false;
    group.matrix.copy(this.frame.ecefToLocal);
    group.updateMatrixWorld(true);
  }

  /** The far skyline's tiles renderer (see `far`). */
  private createFarTiles(): TilesRenderer {
    const tiles = createFarTiles(
      PLATEAU_TILESET,
      this.farRegion,
      this.draco,
      QUALITY.farBuildingMinError,
      QUALITY.farBuildingErrorTarget,
    );
    tiles.setCamera(this.camera);
    this.setResolution(tiles);
    tiles.addEventListener("load-model", ({ scene }) => {
      this.farLoadedCount++;
      // Prepared later, within a frame budget: several tiles can land in one frame.
      scene.visible = false;
      this.farPending.push(scene);
    });
    tiles.addEventListener("dispose-model", ({ scene }) => {
      const at = this.farPending.indexOf(scene);
      if (at >= 0) this.farPending.splice(at, 1);
    });
    this.scene.add(tiles.group);
    this.applyFrameTo(tiles);
    void this.compileFar();
    return tiles;
  }

  /**
   * Build the far façade's pipeline off the frame, on a stand-in mesh with its attributes: drawn
   * for the first time inside a frame, the node material's build and the pipeline stalled it.
   */
  private async compileFar(): Promise<void> {
    try {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("facade", new BufferAttribute(new Float32Array(6), 2));
      const stand = new Mesh(geometry, farFacadeMaterial());
      await this.renderer.compileAsync?.(stand, this.camera, this.scene);
      geometry.dispose();
    } catch {
      // Built on first use instead.
    } finally {
      this.isFarCompiled = true;
    }
  }

  /** Prepare waiting far tiles until FAR_PREPARE_BUDGET_MS is spent (at least one a frame). */
  private prepareFarTiles(): void {
    if (!this.isFarCompiled) return;
    const start = performance.now();
    const host: FarTileHost = {
      cut: (geometry, ecef) => {
        if (this.hidden.length) this.cutFootprints(geometry, ecef);
      },
    };
    while (this.farPending.length > 0) {
      const scene = this.farPending.shift() as Object3D;
      prepareFarTile(scene, host);
      scene.visible = true;
      if (performance.now() - start > FAR_PREPARE_BUDGET_MS) break;
    }
  }

  /** Far tiles waiting to be prepared (for tests and the console). */
  get farPendingCount(): number {
    return this.farPending.length;
  }

  private adaptMaterial(material: Material): Material {
    // LOD1 ships plain grey materials; replace them with the procedural façade so windows,
    // block colours and night lighting appear without any texture download.
    material.dispose();
    return facadeMaterial();
  }

  /**
   * A tile's mesh-to-local (game frame) matrix, whether or not the renderer has it under the group
   * right now. A hidden tile hangs nowhere, and its world matrix is then the tileset's ECEF: a
   * sphere taken from that lay ~6,370 km off and was cached, so the tile never got its walls (the
   * car drove through the buildings beside it); a collider rebuilt from it on re-anchoring as well.
   */
  private localMatrix(o: Object3D, into: Matrix4): Matrix4 {
    let up: Object3D | null = o;
    while (up && up !== this.tiles.group) up = up.parent;
    const isUnderGroup = up === this.tiles.group;
    return isUnderGroup
      ? into.copy(o.matrixWorld)
      : into.multiplyMatrices(this.frame.ecefToLocal, o.matrixWorld);
  }

  private computeSphere(scene: Object3D): Sphere {
    scene.updateMatrixWorld(true);
    const box = new Box3();
    const part = new Box3();
    const m = new Matrix4();
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      box.union(part.copy(o.geometry.boundingBox).applyMatrix4(this.localMatrix(o, m)));
    });
    return box.getBoundingSphere(new Sphere());
  }

  private createCollider(model: Model): void {
    const vertices: number[] = [];
    const indices: number[] = [];
    const v = new Vector3();
    const m = new Matrix4();
    model.scene.updateMatrixWorld(true);
    model.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const pos = o.geometry.getAttribute("position") as BufferAttribute | undefined;
      if (!pos) return;
      const base = vertices.length / 3;
      const toLocal = this.localMatrix(o, m);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
        vertices.push(v.x, v.y, v.z);
      }
      const index = o.geometry.getIndex();
      if (index) {
        for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
      } else {
        for (let i = 0; i < pos.count; i++) indices.push(base + i);
      }
    });
    if (indices.length < 3) return;
    const desc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices),
    ).setFriction(0.6);
    model.collider = this.world.createCollider(desc);
  }

  private removeCollider(model: Model): void {
    if (!model.collider) return;
    this.world.removeCollider(model.collider, false);
    model.collider = null;
  }
}

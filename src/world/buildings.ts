import RAPIER from "@dimforge/rapier3d-compat";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  GLTFExtensionsPlugin,
  LoadRegionPlugin,
  SphereRegion,
  UnloadTilesPlugin,
} from "3d-tiles-renderer/plugins";
import {
  type BufferGeometry,
  Box3,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  Vector3,
  type BufferAttribute,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { BUILDING_COLLIDER_RADIUS, PLATEAU_TILESET } from "../config";
import { QUALITY } from "../device";
import type { LocalFrame } from "../geo/frame";
import { addFacadeAttribute, applyFacade, facadeUniforms, setFacadeOrigin } from "./facade";

type Model = {
  scene: Object3D;
  visible: boolean;
  sphere: Sphere | null;
  collider: RAPIER.Collider | null;
};

// Beyond the fog nothing is visible, so do not spend cache on it (Tokyo-wide tileset would
// otherwise fill the 0.4 GB LRU with coarse tiles of distant wards and starve nearby detail).
const LOAD_RADIUS = QUALITY.buildingLoadRadius;
// Full detail in every direction around the car so colliders exist behind/beside it too.
const DETAIL_RADIUS = 250;
/** Colliders go only this far beyond their radius, so one is not rebuilt at the edge every tick. */
const COLLIDER_HYSTERESIS = 60;
const COLLIDER_BUDGET_MS = 4;

/**
 * PLATEAU building tiles streamed straight from the public CORS-enabled catalogue, plus Rapier
 * trimesh colliders generated on demand from the tiles that are visible near the player.
 */
export class Buildings {
  tiles!: TilesRenderer;
  private readonly models = new Map<Object3D, Model>();
  private readonly draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  private frame: LocalFrame;
  private lastColliderTick = 0;
  private readonly maskRegion = new SphereRegion({ mask: true, errorTarget: 1e9 });
  private readonly detailRegion = new SphereRegion({ mask: false });
  loadedCount = 0;
  /** Footprints (local XZ rings) of buildings drawn by hero models instead (landmarks). */
  private hidden: Vector3[][] = [];
  private hiddenRings: Array<Array<[number, number]>> = [];

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly camera: Camera,
    private readonly renderer: WebGLRenderer,
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
    this.frame = frame;
    if (this.hiddenRings.length) this.hideFootprints(this.hiddenRings);
    this.applyFrame();
    setFacadeOrigin(frame);
    for (const model of this.models.values()) {
      model.sphere = null;
      if (!model.collider) continue;
      this.removeCollider(model);
      this.createCollider(model);
    }
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

  /** 0 = day, 1 = night: lights up a random share of the procedural windows. */
  setNightFactor(f: number): void {
    facadeUniforms.uNight.value = f;
  }

  onResize(): void {
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
  }

  update(player: Vector3, now: number): void {
    this.camera.updateMatrixWorld();
    // Regions live in the tileset's (ECEF) frame.
    const centerEcef = player.clone().applyMatrix4(this.frame.localToEcef);
    this.maskRegion.sphere.set(centerEcef, LOAD_RADIUS);
    this.detailRegion.sphere.set(centerEcef, DETAIL_RADIUS);
    this.tiles.update();
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
    tiles.setResolutionFromRenderer(this.camera, this.renderer);

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
    const group = this.tiles.group;
    group.matrixAutoUpdate = false;
    group.matrix.copy(this.frame.ecefToLocal);
    group.updateMatrixWorld(true);
  }

  private adaptMaterial(material: Material): Material {
    // LOD1 ships plain grey materials; replace them with the procedural façade so windows,
    // block colours and night lighting appear without any texture download.
    material.dispose();
    const facade = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    applyFacade(facade);
    return facade;
  }

  private computeSphere(scene: Object3D): Sphere {
    scene.updateMatrixWorld(true);
    return new Box3().setFromObject(scene).getBoundingSphere(new Sphere());
  }

  private createCollider(model: Model): void {
    const vertices: number[] = [];
    const indices: number[] = [];
    const v = new Vector3();
    model.scene.updateMatrixWorld(true);
    model.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const pos = o.geometry.getAttribute("position") as BufferAttribute | undefined;
      if (!pos) return;
      const base = vertices.length / 3;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
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

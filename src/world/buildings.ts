import RAPIER from "@dimforge/rapier3d-compat";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  GLTFExtensionsPlugin,
  LoadRegionPlugin,
  SphereRegion,
  UnloadTilesPlugin,
} from "3d-tiles-renderer/plugins";
import {
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
import type { LocalFrame } from "../geo/frame";
import { applyFacade, facadeUniforms, setFacadeOrigin } from "./facade";

type Model = {
  scene: Object3D;
  visible: boolean;
  sphere: Sphere | null;
  collider: RAPIER.Collider | null;
};

// Beyond the fog nothing is visible, so do not spend cache on it (Tokyo-wide tileset would
// otherwise fill the 0.4 GB LRU with coarse tiles of distant wards and starve nearby detail).
const LOAD_RADIUS = 2800;
// Full detail in every direction around the car so colliders exist behind/beside it too.
const DETAIL_RADIUS = 250;

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

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
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

    let built = false;
    for (const model of this.models.values()) {
      model.sphere ??= this.computeSphere(model.scene);
      const distance = model.sphere.center.distanceTo(player) - model.sphere.radius;
      const isNear = model.visible && distance < BUILDING_COLLIDER_RADIUS;
      if (isNear && !model.collider && !built) {
        this.createCollider(model);
        built = true;
      } else if (!isNear && model.collider) {
        this.removeCollider(model);
      }
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
    tiles.errorTarget = 16;
    this.detailRegion.errorTarget = tiles.errorTarget;
    tiles.lruCache.minBytesSize = 0.5 * 1024 ** 3;
    tiles.lruCache.maxBytesSize = 0.8 * 1024 ** 3;
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);

    tiles.addEventListener("load-model", ({ scene }) => {
      this.loadedCount++;
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.castShadow = true;
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

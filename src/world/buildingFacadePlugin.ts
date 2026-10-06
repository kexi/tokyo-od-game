import { BufferAttribute, Mesh, type Object3D } from "three";
import type { Tile } from "3d-tiles-renderer/core";
import { BuildingFacadeCompute } from "./buildingFacadeCompute";

/** The standard parser awaits this hook before marking the tile loaded or displaying it. */
export class BuildingFacadePlugin {
  readonly name = "BUILDING_FACADE_PLUGIN";
  private readonly prepared = new WeakMap<Mesh, Float32Array>();
  private readonly pending = new Map<Tile, AbortController>();
  private disposed = false;

  constructor(
    private readonly compute = new BuildingFacadeCompute(),
    private readonly prepareScene?: (scene: Object3D, tile: Tile, signal: AbortSignal) => Promise<void>,
  ) {}

  async processTileModel(scene: Object3D, tile: Tile): Promise<void> {
    const controller = new AbortController();
    this.pending.set(tile, controller);
    let startedScenePreparation = false;
    try {
      // These matrices are still in ECEF, independent of a floating-origin change during the wait.
      scene.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      scene.traverse((object) => {
        const isMesh = object instanceof Mesh;
        if (isMesh) meshes.push(object);
      });
      for (const mesh of meshes) {
        const data = await this.compute.prepare(
          mesh.geometry,
          mesh.matrixWorld,
          tile.content?.uri ?? "building",
        );
        mesh.geometry.setAttribute("facade", new BufferAttribute(data.facade, 2));
        this.prepared.set(mesh, data.ecef);
      }
      const isCancelled = this.disposed || controller.signal.aborted;
      if (isCancelled) throw new DOMException("building preparation disposed", "AbortError");
      startedScenePreparation = !!this.prepareScene;
      await this.prepareScene?.(scene, tile, controller.signal);
      const wasCancelled = this.disposed || controller.signal.aborted;
      if (wasCancelled) throw new DOMException("building preparation disposed", "AbortError");
    } finally {
      const releasePreparedGpu = startedScenePreparation && (this.disposed || controller.signal.aborted);
      // The tile loader has not recorded this scene yet, so its abort path cannot release our GPU work.
      if (releasePreparedGpu)
        scene.traverse((item) => {
          const isMesh = item instanceof Mesh;
          if (!isMesh) return;
          item.geometry.dispose();
          const materials = Array.isArray(item.material) ? item.material : [item.material];
          for (const material of materials) material.dispose();
        });
      const isCurrent = this.pending.get(tile) === controller;
      if (isCurrent) this.pending.delete(tile);
    }
  }

  disposeTile(tile: Tile): void {
    this.pending.get(tile)?.abort();
  }

  takeEcef(mesh: Mesh): Float32Array {
    const ecef = this.prepared.get(mesh);
    this.prepared.delete(mesh);
    const isUnprepared = !ecef;
    if (isUnprepared) throw new Error("Building tile loaded before façade preparation finished");
    return ecef;
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.pending.values()) controller.abort();
    this.compute.dispose();
  }
}

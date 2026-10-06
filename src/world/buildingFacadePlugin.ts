import { BufferAttribute, Mesh, type Object3D } from "three";
import type { Tile } from "3d-tiles-renderer/core";
import { BuildingFacadeCompute } from "./buildingFacadeCompute";

/** The standard parser awaits this hook before marking the tile loaded or displaying it. */
export class BuildingFacadePlugin {
  readonly name = "BUILDING_FACADE_PLUGIN";
  private readonly prepared = new WeakMap<Mesh, Float32Array>();

  constructor(private readonly compute = new BuildingFacadeCompute()) {}

  async processTileModel(scene: Object3D, tile: Tile): Promise<void> {
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
  }

  takeEcef(mesh: Mesh): Float32Array {
    const ecef = this.prepared.get(mesh);
    this.prepared.delete(mesh);
    const isUnprepared = !ecef;
    if (isUnprepared) throw new Error("Building tile loaded before façade preparation finished");
    return ecef;
  }

  dispose(): void {
    this.compute.dispose();
  }
}

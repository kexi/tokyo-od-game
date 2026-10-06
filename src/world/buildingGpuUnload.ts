import { UnloadTilesPlugin } from "3d-tiles-renderer/plugins";
import type { BufferGeometry, Object3D } from "three";

/** Release the large vertex buffers while the CPU tile cache still owns its façade materials. */
export class BuildingGpuUnloadPlugin extends UnloadTilesPlugin {
  unloadTileFromGPU(scene: Object3D | null): boolean {
    scene?.traverse((object) => {
      const geometry = (object as Object3D & { geometry?: BufferGeometry }).geometry;
      // Material disposal deletes the render objects and their shared shader state, even when
      // the tile stays in the CPU cache. The dispose-model handler releases them on eviction.
      geometry?.dispose();
    });
    return true;
  }
}

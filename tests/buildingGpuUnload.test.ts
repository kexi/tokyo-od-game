import type RAPIER from "@dimforge/rapier3d-compat";
import type { Tile } from "3d-tiles-renderer/core";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { GRAPHICS } from "../src/device";
import { LocalFrame } from "../src/geo/frame";
import { BuildingGpuUnloadPlugin } from "../src/world/buildingGpuUnload";
import { Buildings } from "../src/world/buildings";
import { BuildingFacadePlugin } from "../src/world/buildingFacadePlugin";

describe("cached building GPU resources", () => {
  it("releases vertex buffers without changing the CPU geometry or disposing its material", () => {
    const geometry = new BoxGeometry();
    const material = new MeshStandardMaterial();
    const model = new Group();
    model.add(new Mesh(geometry, material));
    const attributes = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]),
    );
    const index = geometry.index!.array.slice();
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");

    expect(new BuildingGpuUnloadPlugin().unloadTileFromGPU(model)).toBe(true);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).not.toHaveBeenCalled();
    for (const [name, values] of Object.entries(attributes))
      expect(geometry.getAttribute(name).array).toEqual(values);
    expect(geometry.index!.array).toEqual(index);
    material.dispose();
  });

  it("updates hidden cached façades when window settings change, then releases them on CPU eviction", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const settings = GRAPHICS.settings;
    GRAPHICS.set({ ...settings, windows: "flat" });
    const buildings = new Buildings(
      new Scene(),
      {} as RAPIER.World,
      new PerspectiveCamera(),
      { getSize: (target) => target.set(800, 600) },
      new LocalFrame(35.681236, 139.767125, 0),
    );
    const model = new Group();
    const original = new MeshStandardMaterial();
    const mesh = new Mesh(new BoxGeometry(10, 20, 10), original);
    model.add(mesh);
    const tile = { engineData: { scene: model } } as unknown as Tile;
    const originalDisposal = vi.spyOn(original, "dispose");
    try {
      const preparation = buildings.tiles.getPluginByName("BUILDING_FACADE_PLUGIN") as BuildingFacadePlugin;
      await preparation.processTileModel(model, tile);
      buildings.tiles.dispatchEvent({ type: "load-model", scene: model, tile, url: "test.b3dm" });
      expect(originalDisposal).toHaveBeenCalledOnce();
      const facade = mesh.material;
      const key = facade.customProgramCacheKey();
      const facadeDisposal = vi.spyOn(facade, "dispose");
      const geometryDisposal = vi.spyOn(mesh.geometry, "dispose");
      buildings.tiles.dispatchEvent({ type: "update-before" });
      buildings.tiles.visibleTiles.add(tile);
      buildings.tiles.dispatchEvent({ type: "tile-visibility-change", scene: model, tile, visible: true });
      buildings.tiles.visibleTiles.delete(tile);
      buildings.tiles.dispatchEvent({ type: "tile-visibility-change", scene: model, tile, visible: false });
      await Promise.resolve();
      expect(geometryDisposal).toHaveBeenCalledOnce();
      GRAPHICS.set({ ...settings, windows: "rooms" });
      expect(facade.customProgramCacheKey()).not.toBe(key);
      expect(facadeDisposal).not.toHaveBeenCalled();
      buildings.tiles.dispatchEvent({ type: "dispose-model", scene: model, tile });
      expect(facadeDisposal).toHaveBeenCalledOnce();
      const disposedKey = facade.customProgramCacheKey();
      GRAPHICS.set({ ...settings, windows: "lit" });
      expect(facade.customProgramCacheKey()).toBe(disposedKey);
    } finally {
      GRAPHICS.set(settings);
      mesh.geometry.dispose();
      mesh.material.dispose();
      buildings.tiles.dispose();
      vi.unstubAllGlobals();
    }
  });
});

import { Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, BoxGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import { prepareBuildingShaders } from "../src/world/buildingShaders";

describe("streamed building shader preparation", () => {
  it("compiles the real tile in its destination scene before restoring mixed culling flags", async () => {
    const object = new Group(),
      scene = new Scene(),
      camera = new PerspectiveCamera();
    const first = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const second = new Mesh(first.geometry, first.material);
    second.frustumCulled = false;
    object.add(first, second);
    const geometry = first.geometry,
      material = first.material;
    const compileAsync = vi.fn(async (tile, view, target) => {
      expect(tile).toBe(object);
      expect(view).toBe(camera);
      expect(target).toBe(scene);
      expect(first.frustumCulled).toBe(false);
      expect(second.frustumCulled).toBe(false);
      expect(scene.children).not.toContain(object);
    });
    await prepareBuildingShaders(object, camera, scene, { compileAsync });
    expect(compileAsync).toHaveBeenCalledOnce();
    expect(first.frustumCulled).toBe(true);
    expect(second.frustumCulled).toBe(false);
    expect(first.geometry).toBe(geometry);
    expect(first.material).toBe(material);
  });

  it("recompiles a window setting changed while shader preparation was waiting", async () => {
    const object = new Group(),
      mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    object.add(mesh);
    const compileAsync = vi.fn(async () => {});
    compileAsync.mockImplementationOnce(async () => {
      mesh.material.needsUpdate = true;
    });
    await prepareBuildingShaders(object, new PerspectiveCamera(), new Scene(), { compileAsync });
    expect(compileAsync).toHaveBeenCalledTimes(2);
    expect(mesh.frustumCulled).toBe(true);
  });

  it("restores culling and leaves loader-owned geometry and material alive after a compile failure", async () => {
    const object = new Group(),
      mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    object.add(mesh);
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose"),
      materialDispose = vi.spyOn(mesh.material, "dispose");
    await expect(
      prepareBuildingShaders(object, new PerspectiveCamera(), new Scene(), {
        compileAsync: async () => {
          throw new Error("pipeline unavailable");
        },
      }),
    ).rejects.toThrow("pipeline unavailable");
    expect(mesh.frustumCulled).toBe(true);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it("keeps the existing first-draw path when the renderer has no compiler", async () => {
    const object = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    await prepareBuildingShaders(object, new PerspectiveCamera(), new Scene(), {});
    expect(object.frustumCulled).toBe(true);
  });
});

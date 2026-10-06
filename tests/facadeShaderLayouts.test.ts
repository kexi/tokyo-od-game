import { InterleavedBufferAttribute, PerspectiveCamera, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { FacadeShaderLayouts } from "../src/world/facadeShaderLayouts";

describe("retained PLATEAU shader layouts", () => {
  it("prepares both surveyed layouts outside the scene and releases vertices while retaining materials", async () => {
    const scene = new Scene(),
      camera = new PerspectiveCamera();
    const geometryDisposed: unknown[] = [],
      materialDisposed: unknown[] = [];
    const compileAsync = vi.fn(async (group, view, target) => {
      expect(view).toBe(camera);
      expect(target).toBe(scene);
      expect(group.parent).toBe(null);
      expect(group.children).toHaveLength(2);
      const [batch, feature] = group.children;
      expect(Object.keys(batch.geometry.attributes).toSorted()).toEqual([
        "_batchid",
        "facade",
        "normal",
        "position",
      ]);
      const id = feature.geometry.getAttribute("_feature_id_0");
      expect(id).toBeInstanceOf(InterleavedBufferAttribute);
      expect(id.data.stride).toBe(2);
      expect(id.offset).toBe(0);
      for (const mesh of group.children) {
        expect(mesh.receiveShadow).toBe(true);
        expect(mesh.frustumCulled).toBe(false);
        expect(mesh.geometry.getAttribute("position").count).toBe(3);
        const geometry = vi.spyOn(mesh.geometry, "dispose"),
          material = vi.spyOn(mesh.material, "dispose");
        geometryDisposed.push(geometry);
        materialDisposed.push(material);
      }
    });
    const layouts = new FacadeShaderLayouts(camera, scene, { compileAsync });
    await layouts.prepare();
    await layouts.prepare();
    expect(compileAsync).toHaveBeenCalledOnce();
    for (const dispose of geometryDisposed) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposed) expect(dispose).not.toHaveBeenCalled();
    layouts.dispose();
    for (const dispose of materialDisposed) expect(dispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });

  it("shares a pending preparation and releases retained materials after disposal during the build", async () => {
    const scene = new Scene(),
      camera = new PerspectiveCamera();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const disposals: unknown[] = [];
    const compileAsync = vi.fn((group) => {
      for (const mesh of group.children) disposals.push(vi.spyOn(mesh.material, "dispose"));
      return held;
    });
    const layouts = new FacadeShaderLayouts(camera, scene, { compileAsync });
    const first = layouts.prepare(),
      second = layouts.prepare();
    expect(compileAsync).toHaveBeenCalledOnce();
    layouts.dispose();
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    await layouts.prepare();
    expect(compileAsync).toHaveBeenCalledOnce();
  });

  it("does not mark a failed preparation ready and can retry", async () => {
    const compileAsync = vi.fn(async () => {});
    compileAsync.mockRejectedValueOnce(new Error("compile failed"));
    const layouts = new FacadeShaderLayouts(new PerspectiveCamera(), new Scene(), { compileAsync });
    await expect(layouts.prepare()).rejects.toThrow("compile failed");
    await layouts.prepare();
    expect(compileAsync).toHaveBeenCalledTimes(2);
    layouts.dispose();
  });
});

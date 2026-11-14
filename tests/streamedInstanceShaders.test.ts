import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  RenderTarget,
  Scene,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { StreamedInstanceShaders } from "../src/render/streamedInstanceShaders";

function fixture() {
  const scene = new Scene(),
    camera = new PerspectiveCamera(),
    target = new RenderTarget();
  const geometry = new BoxGeometry(),
    material = new MeshStandardMaterial();
  const first = new InstancedMesh(geometry, material, 2),
    second = new InstancedMesh(geometry, material, 2);
  second.frustumCulled = false;
  scene.add(first, second);
  let currentTarget: RenderTarget | null = new RenderTarget();
  let face = 3,
    level = 2;
  const renderer = {
    compileAsync: vi.fn(async () => {}),
    hasInitialized: () => true,
    getRenderTarget: () => currentTarget,
    setRenderTarget: (value: RenderTarget | null, cubeFace = 0, mipmapLevel = 0) => {
      currentTarget = value;
      face = cubeFace;
      level = mipmapLevel;
    },
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => level,
  };
  const preparer = new StreamedInstanceShaders(renderer, scene, camera, target);
  return { scene, camera, target, first, second, renderer, preparer, geometry, material };
}

describe("streamed instance shader preparation", () => {
  it("hides the whole batch while pending and restores the active render target before yielding", async () => {
    const f = fixture(),
      oldTarget = f.renderer.getRenderTarget();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.renderer.compileAsync.mockImplementationOnce((...args: unknown[]) => {
      expect(args).toEqual([f.first, f.camera, f.scene]);
      expect(f.renderer.getRenderTarget()).toBe(f.target);
      expect(f.first.visible).toBe(true);
      expect(f.first.frustumCulled).toBe(false);
      expect(f.second.visible).toBe(false);
      return held;
    });
    const pending = f.preparer.prepare();
    expect(f.first.visible).toBe(false);
    expect(f.second.visible).toBe(false);
    expect(f.first.frustumCulled).toBe(true);
    expect(f.renderer.getRenderTarget()).toBe(oldTarget);
    expect(f.renderer.getActiveCubeFace()).toBe(3);
    expect(f.renderer.getActiveMipmapLevel()).toBe(2);
    release();
    await pending;
    expect(f.first.visible).toBe(true);
    expect(f.second.visible).toBe(true);
    expect(f.first.frustumCulled).toBe(true);
    expect(f.second.frustumCulled).toBe(false);
    expect(f.first.geometry).toBe(f.geometry);
    expect(f.first.material).toBe(f.material);
  });

  it("retains prepared identities but recompiles changed materials, instance colors and replacements", async () => {
    const f = fixture();
    await f.preparer.prepare();
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(2);
    f.material.needsUpdate = true;
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(4);
    f.first.setColorAt(0, new Color(0xff0000));
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(5);
    f.first.removeFromParent();
    const grown = new InstancedMesh(f.geometry, f.material, 8);
    f.scene.add(grown);
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(6);
  });

  it("retries a material changed while its asynchronous build was pending", async () => {
    const f = fixture();
    f.renderer.compileAsync.mockImplementationOnce(async () => {
      f.material.needsUpdate = true;
    });
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(3);
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(3);
  });

  it("does not reveal disposed objects and releases instance resources allocated after disposal", async () => {
    const f = fixture();
    const dispose = vi.spyOn(f.first, "dispose");
    const geometryDispose = vi.spyOn(f.geometry, "dispose"),
      materialDispose = vi.spyOn(f.material, "dispose");
    f.renderer.compileAsync.mockImplementationOnce(async () => {
      f.first.removeFromParent();
      f.first.dispose();
      f.second.removeFromParent();
    });
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledOnce();
    expect(f.first.parent).toBe(null);
    expect(f.first.visible).toBe(false);
    expect(f.second.parent).toBe(null);
    expect(f.second.visible).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it("uses first-draw fallback after compilation rejects without hiding later objects or retrying forever", async () => {
    const f = fixture(),
      oldTarget = f.renderer.getRenderTarget();
    f.renderer.compileAsync.mockRejectedValueOnce(new Error("pipeline unavailable"));
    await f.preparer.prepare();
    expect(f.first.visible).toBe(true);
    expect(f.second.visible).toBe(true);
    expect(f.renderer.getRenderTarget()).toBe(oldTarget);
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(2);
  });

  it("skips invisible, empty and non-instanced objects and keeps the fallback for unsupported renderers", async () => {
    const f = fixture();
    f.first.visible = false;
    f.second.count = 0;
    f.scene.add(new Mesh(f.geometry, f.material));
    await f.preparer.prepare();
    expect(f.renderer.compileAsync).not.toHaveBeenCalled();
    f.first.visible = true;
    const unsupported = { ...f.renderer, compileAsync: undefined };
    await new StreamedInstanceShaders(unsupported, f.scene, f.camera, f.target).prepare();
    expect(f.first.visible).toBe(true);
    const uninitialized = { ...f.renderer, hasInitialized: () => false };
    await new StreamedInstanceShaders(uninitialized, f.scene, f.camera, f.target).prepare();
    expect(f.first.visible).toBe(true);
    expect(f.renderer.compileAsync).not.toHaveBeenCalled();
  });
});

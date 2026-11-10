import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  type ShadowMapType,
  VSMShadowMap,
} from "three";
import { LightsNode, type NodeMaterial, type Renderer } from "three/webgpu";
import { StableShadowNode, useStableShadows } from "../src/render/stableShadow";

function fixture(shadowType: ShadowMapType = PCFShadowMap) {
  const light = new DirectionalLight();
  const node = new StableShadowNode(light);
  const scene = new Scene();
  scene.overrideMaterial = node.getShadowMaterial();
  const geometry = new BoxGeometry();
  const object = new Mesh(geometry);
  object.castShadow = true;
  const camera = new PerspectiveCamera();
  const group = new Group();
  const lights = new LightsNode();
  const renderObject = vi.fn((_object, renderScene, _camera, _geometry, source) => {
    const shadow = renderScene.overrideMaterial as NodeMaterial;
    // Three's public renderObject applies the source alpha test to the shadow override.
    shadow.alphaTest = source.alphaTest;
  });
  const renderer = {
    shadowMap: { type: shadowType },
    getMRT: () => null,
    renderObject,
  } as unknown as Renderer;
  const draw = node.getShadowRenderObjectFunction(renderer);
  const render = (source: MeshBasicMaterial) => {
    let material: NodeMaterial | undefined;
    object.onBeforeShadow = (_renderer, _object, _camera, _shadowCamera, _geometry, override) => {
      material = override as NodeMaterial;
    };
    draw(object, scene, camera, geometry, source, group, lights);
    return material!;
  };
  return { node, light, scene, object, renderer, draw, render, renderObject };
}

describe("stable shadow overrides", () => {
  it("keeps cutout and opaque shadows stable when they alternate across frames", () => {
    const { node, render } = fixture();
    const opaque = new MeshBasicMaterial();
    const cutout = new MeshBasicMaterial({ alphaTest: 0.5 });
    const opaqueShadow = render(opaque);
    const cutoutShadow = render(cutout);
    const versions = [opaqueShadow.version, cutoutShadow.version];
    for (let frame = 0; frame < 20; frame++) {
      expect(render(opaque)).toBe(opaqueShadow);
      expect(render(cutout)).toBe(cutoutShadow);
    }
    expect(opaqueShadow).not.toBe(cutoutShadow);
    expect([opaqueShadow.version, cutoutShadow.version]).toEqual(versions);
    expect(opaqueShadow.alphaTest).toBe(0);
    expect(cutoutShadow.alphaTest).toBe(0.5);
    expect((cutoutShadow as NodeMaterial & { isShadowPassMaterial: boolean }).isShadowPassMaterial).toBe(
      true,
    );
    node.dispose();
  });

  it("invalidates the changed source and gives a replacement material its own override", () => {
    const { node, render } = fixture();
    const source = new MeshBasicMaterial();
    const other = new MeshBasicMaterial();
    const shadow = render(source);
    const otherShadow = render(other);
    const version = shadow.version;
    const otherVersion = otherShadow.version;
    source.needsUpdate = true;
    expect(render(source)).toBe(shadow);
    expect(shadow.version).toBeGreaterThan(version);
    expect(render(other).version).toBe(otherVersion);
    source.alphaTest = 0.5;
    expect(render(source).alphaTest).toBe(0.5);
    expect(render(new MeshBasicMaterial())).not.toBe(shadow);
    node.dispose();
  });

  it("releases disposed source overrides and recreates them if the source is reused", async () => {
    const { node, render } = fixture();
    const source = new MeshBasicMaterial();
    const shadow = render(source);
    const disposed = vi.fn();
    shadow.addEventListener("dispose", disposed);
    source.dispose();
    await Promise.resolve();
    expect(disposed).toHaveBeenCalledOnce();
    const replacement = render(source);
    expect(replacement).not.toBe(shadow);
    const replacementDisposed = vi.fn();
    replacement.addEventListener("dispose", replacementDisposed);
    node.dispose();
    expect(replacementDisposed).toHaveBeenCalledOnce();
    source.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(replacementDisposed).toHaveBeenCalledOnce();
  });

  it("releases a render object only once when both source and override are disposed", async () => {
    const { node, render } = fixture();
    const source = new MeshBasicMaterial();
    const shadow = render(source);
    const release = vi.fn(() => {
      source.removeEventListener("dispose", release);
      shadow.removeEventListener("dispose", release);
    });
    // Three's render object listens to both materials and removes both listeners on release.
    source.addEventListener("dispose", release);
    shadow.addEventListener("dispose", release);
    source.dispose();
    await Promise.resolve();
    expect(release).toHaveBeenCalledOnce();
    node.dispose();
  });

  it("preserves shadow callbacks and restores the scene override after an exception", () => {
    const { node, render, renderObject, scene, object } = fixture();
    const source = new MeshBasicMaterial();
    const previous = scene.overrideMaterial;
    object.onAfterShadow = vi.fn();
    const shadow = render(source);
    expect(object.onAfterShadow).toHaveBeenCalledWith(
      expect.anything(),
      object,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      shadow,
      expect.anything(),
    );
    expect(scene.overrideMaterial).toBe(previous);
    renderObject.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    expect(() => render(source)).toThrow("render failed");
    expect(scene.overrideMaterial).toBe(previous);
    node.dispose();
  });

  it("retains non-caster, VSM receiver and allowOverride rules from Three", () => {
    const pcf = fixture();
    pcf.object.castShadow = false;
    pcf.object.receiveShadow = true;
    pcf.render(new MeshBasicMaterial());
    expect(pcf.renderObject).not.toHaveBeenCalled();
    const vsm = fixture(VSMShadowMap);
    vsm.object.castShadow = false;
    vsm.object.receiveShadow = true;
    const source = new MeshBasicMaterial();
    expect(vsm.render(source)).not.toBe(vsm.scene.overrideMaterial);
    source.allowOverride = false;
    expect(vsm.render(source)).toBe(vsm.scene.overrideMaterial);
    pcf.node.dispose();
    vsm.node.dispose();
  });

  it("installs the custom shadow node before the light is compiled", () => {
    const light = new DirectionalLight();
    useStableShadows(light);
    expect(light.shadow.shadowNode).toBeInstanceOf(StableShadowNode);
    light.shadow.shadowNode?.dispose();
  });
});

import { DirectionalLight } from "three";
import { ShadowNode, type NodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { facadeMaterial } from "../src/world/facade";

// The façade's shadow shortcut (surface() returns vec4(0, 0, 0, 1) in the shadow pass) rests on
// two things in three. If an update changes either, the shortcut stops being taken without an
// error (the shadows stay right, only the build cost comes back): these tests fail instead.
// Not covered here: that three draws the shadow pass with its override as builder.material
// (Renderer.js, the shadow pass's material). Only the browser parity (just measure-facade-shadows)
// sees that, by its check that the new shadow fragment is shorter than the old; it is not in CI.
describe("the opaque façade's shadow shortcut (src/world/facade.ts surface)", () => {
  it("is told the shadow pass by three's own shadow material, which carries isShadowPassMaterial", () => {
    const light = new DirectionalLight();
    // The shadow pass of a directional light, as the light sets it up for the renderer.
    const material = new ShadowNode(light, light.shadow).getShadowMaterial() as NodeMaterial & {
      isShadowPassMaterial?: boolean;
    };
    expect(material.isShadowPassMaterial).toBe(true);
  });

  it("sits in the façade's colorNode, which three copies into the shadow pass's alpha", () => {
    const material = facadeMaterial();
    try {
      expect(material.colorNode?.isNode).toBe(true);
      // No map and no castShadowNode: the shadow's alpha comes from colorNode alone.
      expect(material.map).toBeNull();
      expect(material.castShadowNode).toBeNull();
    } finally {
      material.dispose();
    }
  });

  it("returns a constant for three's shadow material and the colour graph otherwise", () => {
    const light = new DirectionalLight();
    const shadow = new ShadowNode(light, light.shadow).getShadowMaterial();
    const material = facadeMaterial();
    type Built = { node?: { isConstNode?: boolean } };
    type Call = { node: { shaderNode: { jsFunc: (builder: unknown) => Built } } };
    try {
      // colorNode is Fn(...)() wrapped in a VarNode; the Fn's own function is what three calls per build.
      const call = (material.colorNode as unknown as Call).node;
      expect(call.shaderNode.jsFunc({ material: shadow }).node?.isConstNode).toBe(true);
      expect(call.shaderNode.jsFunc({ material }).node?.isConstNode).not.toBe(true);
    } finally {
      material.dispose();
    }
  });
});

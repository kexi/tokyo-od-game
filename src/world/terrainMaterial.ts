import { context, materialReference, uv, vec2 } from "three/tsl";
import type { Texture } from "three";
import type { MeshStandardNodeMaterial, Node } from "three/webgpu";

// Texture references yield vec4 samples; the upstream raw-reference declaration lacks TSL chaining.
const waterSample = materialReference("terrainWaterMap", "texture") as unknown as Node<"vec4">;
const waterMask = context(waterSample, {
  getUV: () => vec2(uv().x, uv().y.oneMinus()),
}).r.lessThanEqual(0.5);

/** Share shader code while the material reference keeps each chunk's current mask separate. */
export function bindTerrainMask(material: MeshStandardNodeMaterial, mask: Texture): void {
  // A per-chunk TextureNode in maskNode would give identical shaders different cache keys.
  Object.assign(material, { terrainWaterMap: mask });
  material.maskNode = waterMask;
}

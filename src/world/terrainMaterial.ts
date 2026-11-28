import { context, materialReference, uv, vec2 } from "three/tsl";
import type { Texture } from "three";
import type { MeshStandardNodeMaterial, Node } from "three/webgpu";

// Texture references yield vec4 samples; the upstream raw-reference declaration lacks TSL chaining.
const waterSample = materialReference("terrainWaterMap", "texture") as unknown as Node<"vec4">;
const waterMask = context(waterSample, {
  getUV: () => vec2(uv().x, uv().y.oneMinus()),
}).r.lessThanEqual(0.5);

/**
 * Share shader code while the material reference keeps each chunk's current mask separate.
 * How: three's materialReference reads `terrainWaterMap` from the material being drawn (each render
 * object's own binding), as three's own `map` does. The premise: terrain chunks cast no shadow. In a
 * shadow pass the material drawn is three's shadow material, which has no `terrainWaterMap`, so the
 * mask would break there without a word; a chunk that casts shadows needs a maskShadowNode made with
 * a reference bound to its own material (as Renderer._getShadowNodes does for `map`).
 */
export function bindTerrainMask(material: MeshStandardNodeMaterial, mask: Texture): void {
  // A per-chunk TextureNode in maskNode would give identical shaders different cache keys.
  // Why not keep the chunk's TextureNode and only swap its value: the first build already keyed
  // each chunk's program by its own node, so every chunk would still compile once.
  Object.assign(material, { terrainWaterMap: mask });
  material.maskNode = waterMask;
}

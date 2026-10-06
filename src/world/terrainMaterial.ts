import { context, materialReference, uv, vec2 } from "three/tsl";
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from "three";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";

const WHITE_MAP = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_MAP.magFilter = LinearFilter;
WHITE_MAP.minFilter = LinearMipmapLinearFilter;
WHITE_MAP.generateMipmaps = true;
WHITE_MAP.flipY = true;
WHITE_MAP.colorSpace = SRGBColorSpace;
WHITE_MAP.needsUpdate = true;

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

/** The dry placeholder keeps the original grey ground while sharing the later imagery program. */
export function createTerrainMaterial(dry: Texture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0x8a8f86,
    roughness: 0.97,
    metalness: 0,
    map: WHITE_MAP,
  });
  bindTerrainMask(material, dry);
  return material;
}

/** Replace values, not the shader graph, when an image or a different imagery level arrives. */
export function setTerrainImagery(material: MeshStandardNodeMaterial, photo: Texture, mask: Texture): void {
  disposeTerrainImagery(material);
  material.map = photo;
  material.color.set(0xffffff);
  bindTerrainMask(material, mask);
}

export function disposeTerrainImagery(material: MeshStandardNodeMaterial): void {
  // The single white texel belongs to every still-loading chunk, not the retiring one.
  const ownsMap = material.map !== null && material.map !== WHITE_MAP;
  if (ownsMap) material.map!.dispose();
}

import { DataTexture, RedFormat } from "three";
import { texture, uv, vec2 } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { expect, it } from "vitest";
import { bindTerrainMask } from "../src/world/terrainMaterial";

it("reuses Three's program key across distinct chunk masks and later texture replacements", () => {
  const masks = [1, 4, 16].map(
    (size, i) => new DataTexture(new Uint8Array(size * size).fill(i * 127), size, size, RedFormat),
  );
  const old = masks.map((mask) => {
    const material = new MeshStandardNodeMaterial();
    material.maskNode = texture(mask).sample(vec2(uv().x, uv().y.oneMinus())).r.lessThanEqual(0.5);
    return material;
  });
  const materials = masks.map((mask) => {
    const material = new MeshStandardNodeMaterial();
    bindTerrainMask(material, mask);
    return material;
  });
  try {
    expect(new Set(old.map((m) => m.customProgramCacheKey())).size).toBe(masks.length);
    const keys = materials.map((m) => m.customProgramCacheKey());
    expect(new Set(keys).size).toBe(1);
    for (let i = 0; i < materials.length; i++) {
      bindTerrainMask(materials[i], masks[(i + 1) % masks.length]);
      materials[i].needsUpdate = true;
      expect(materials[i].customProgramCacheKey()).toBe(keys[i]);
    }
  } finally {
    for (const material of [...old, ...materials]) material.dispose();
    for (const mask of masks) mask.dispose();
  }
});

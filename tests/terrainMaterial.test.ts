import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, SRGBColorSpace } from "three";
import { texture, uv, vec2 } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { expect, it, vi } from "vitest";
import {
  bindTerrainMask,
  createTerrainMaterial,
  disposeTerrainImagery,
  setTerrainImagery,
} from "../src/world/terrainMaterial";

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

it("keeps the shared placeholder alive when another loading chunk is disposed or receives imagery", () => {
  const dry = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat);
  const first = createTerrainMaterial(dry),
    second = createTerrainMaterial(dry);
  const placeholder = first.map!,
    releasePlaceholder = vi.spyOn(placeholder, "dispose");
  const photo = new DataTexture(new Uint8Array([0, 10, 20, 255]), 1, 1),
    replacement = new DataTexture(new Uint8Array([30, 40, 50, 255]), 1, 1);
  const releasePhoto = vi.spyOn(photo, "dispose"),
    releaseReplacement = vi.spyOn(replacement, "dispose");
  disposeTerrainImagery(first);
  first.dispose();
  setTerrainImagery(second, photo, dry);
  expect(releasePlaceholder).not.toHaveBeenCalled();
  expect(second.map).toBe(photo);
  setTerrainImagery(second, replacement, dry);
  expect(releasePhoto).toHaveBeenCalledOnce();
  expect(releaseReplacement).not.toHaveBeenCalled();
  disposeTerrainImagery(second);
  expect(releaseReplacement).toHaveBeenCalledOnce();
  expect(releasePlaceholder).not.toHaveBeenCalled();
  second.dispose();
  dry.dispose();
});

it("keeps the program graph and material version while changing imagery sizes and water masks", () => {
  const dry = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat),
    wet = new DataTexture(new Uint8Array(16).fill(255), 4, 4, RedFormat);
  const material = createTerrainMaterial(dry),
    key = material.customProgramCacheKey(),
    version = material.version;
  const reference = material as MeshStandardNodeMaterial & { terrainWaterMap: DataTexture };
  expect(reference.terrainWaterMap).toBe(dry);
  for (const size of [16, 32, 8]) {
    const photo = new DataTexture(new Uint8Array(size * size * 4).fill(255), size, size);
    photo.colorSpace = SRGBColorSpace;
    photo.magFilter = LinearFilter;
    photo.minFilter = LinearMipmapLinearFilter;
    setTerrainImagery(material, photo, wet);
    expect(reference.terrainWaterMap).toBe(wet);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(material.version).toBe(version);
    expect(material.color.getHex()).toBe(0xffffff);
  }
  disposeTerrainImagery(material);
  material.dispose();
  dry.dispose();
  wet.dispose();
});

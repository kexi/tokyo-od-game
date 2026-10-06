import { describe, expect, it, vi } from "vitest";
import { B3DMLoaderBase } from "3d-tiles-renderer/core";
import { BuildingMetadataPlugin, omitBuildingBatchTable } from "../src/world/buildingMetadata";

function tile(
  binaryFeature = false,
  extraBatchPadding = 0,
  glbPadding = 4,
  extraFeaturePadding = 0,
): ArrayBuffer {
  const feature = binaryFeature
    ? '{"BATCH_LENGTH":2,"RTC_CENTER":{"byteOffset":0}}'
    : '{"BATCH_LENGTH":2,"RTC_CENTER":[1,2,3]}';
  const featureBytes = Math.ceil((28 + feature.length) / 8) * 8 - 28 + extraFeaturePadding;
  const featureBinaryBytes = binaryFeature ? 16 : 0;
  const batch = '{"name":["a","b"],"height":{"byteOffset":0,"componentType":"FLOAT","type":"SCALAR"}}';
  const batchBytes = Math.ceil(batch.length / 8) * 8 + extraBatchPadding;
  const glbStart = 28 + featureBytes + featureBinaryBytes + batchBytes + 8;
  const buffer = new ArrayBuffer(glbStart + 20 + glbPadding);
  const bytes = new Uint8Array(buffer);
  const header = new DataView(buffer);
  [0x6d643362, 1, buffer.byteLength, featureBytes, featureBinaryBytes, batchBytes, 8].forEach((v, i) =>
    header.setUint32(i * 4, v, true),
  );
  bytes.fill(32, 28, 28 + featureBytes);
  bytes.set(new TextEncoder().encode(feature), 28);
  if (binaryFeature) {
    [1, 2, 3].forEach((v, i) => header.setFloat32(28 + featureBytes + i * 4, v, true));
  }
  const batchStart = 28 + featureBytes + featureBinaryBytes;
  bytes.fill(32, batchStart, batchStart + batchBytes);
  bytes.set(new TextEncoder().encode(batch), batchStart);
  header.setFloat32(batchStart + batchBytes, 5, true);
  header.setFloat32(batchStart + batchBytes + 4, 10, true);
  [0x46546c67, 2, 20, 0, 0x4e4f534a].forEach((v, i) => header.setUint32(glbStart + i * 4, v, true));
  return buffer;
}

describe("unused building properties", () => {
  it.each([false, true])(
    "keeps RTC_CENTER, building count and every GLB byte including padding (binary RTC %s)",
    (binary) => {
      const original = tile(binary);
      const unchanged = original.slice(0);
      const loader = new B3DMLoaderBase();
      const before = loader.parse(original);
      const compact = omitBuildingBatchTable(original);
      const after = loader.parse(compact);
      expect(compact.byteLength).toBeLessThan(original.byteLength);
      expect(original).toEqual(unchanged);
      expect(after.featureTable.getData("BATCH_LENGTH", 1)).toEqual(
        before.featureTable.getData("BATCH_LENGTH", 1),
      );
      expect(after.featureTable.getData("RTC_CENTER", 1, "FLOAT", "VEC3")).toEqual(
        before.featureTable.getData("RTC_CENTER", 1, "FLOAT", "VEC3"),
      );
      expect(after.glbBytes).toEqual(before.glbBytes);
      expect(after.batchTable.count).toBe(before.batchTable.count);
      expect(after.batchTable.getKeys()).toEqual([]);
      expect(before.batchTable.getPropertyArray("height")).toEqual(new Float32Array([5, 10]));
      expect(omitBuildingBatchTable(compact)).toBe(compact);
    },
  );

  it("leaves unsupported, empty and structurally invalid content to the original parser", () => {
    const mutations = [
      [0, 0],
      [4, 2],
      [8, 0],
      [12, 0],
      [12, 0xffffffff],
      [16, 0xffffffff],
      [20, 0],
      [20, 0xffffffff],
      [24, 0xffffffff],
    ];
    for (const [offset, value] of mutations) {
      const buffer = tile();
      new DataView(buffer).setUint32(offset!, value!, true);
      expect(omitBuildingBatchTable(buffer)).toBe(buffer);
    }
    for (const length of [0, 4, 27]) {
      const buffer = new ArrayBuffer(length);
      expect(omitBuildingBatchTable(buffer)).toBe(buffer);
    }
    const wrongGlb = tile();
    const view = new DataView(wrongGlb);
    const start = 28 + [12, 16, 20, 24].reduce((sum, offset) => sum + view.getUint32(offset, true), 0);
    for (const [offset, value] of [
      [0, 0],
      [4, 1],
      [8, 11],
      [8, 0xffffffff],
    ]) {
      const buffer = wrongGlb.slice(0);
      new DataView(buffer).setUint32(start + offset!, value!, true);
      expect(omitBuildingBatchTable(buffer)).toBe(buffer);
    }
  });

  it("aligns the new container when the published batch table or GLB tail was not padded", () => {
    const loader = new B3DMLoaderBase();
    for (const original of [tile(false, 4), tile(false, 4, 0), tile(false, 0, 0)]) {
      const before = loader.parse(original);
      const compact = omitBuildingBatchTable(original);
      const after = loader.parse(compact);
      expect(compact).not.toBe(original);
      expect(compact.byteLength % 8).toBe(0);
      const declared = new DataView(before.glbBytes.buffer, before.glbBytes.byteOffset).getUint32(8, true);
      expect(after.glbBytes.slice(0, declared)).toEqual(before.glbBytes.slice(0, declared));
      expect(after.glbBytes.slice(before.glbBytes.length).every((v) => v === 0)).toBe(true);
      expect(after.featureTable.header).toEqual(before.featureTable.header);
    }
  });

  it.each([false, true])(
    "keeps feature-table values when its original end is not on an 8-byte boundary (binary RTC %s)",
    (binary) => {
      const original = tile(binary, 0, 4, 4);
      const loader = new B3DMLoaderBase();
      const before = loader.parse(original);
      const compact = omitBuildingBatchTable(original);
      const after = loader.parse(compact);
      expect(compact).not.toBe(original);
      expect(compact.byteLength % 8).toBe(0);
      expect(after.featureTable.header).toEqual(before.featureTable.header);
      expect(after.featureTable.getData("RTC_CENTER", 1, "FLOAT", "VEC3")).toEqual(
        before.featureTable.getData("RTC_CENTER", 1, "FLOAT", "VEC3"),
      );
      expect(after.featureTable.getData("BATCH_LENGTH", 1)).toEqual(
        before.featureTable.getData("BATCH_LENGTH", 1),
      );
      expect(after.glbBytes).toEqual(before.glbBytes);
    },
  );

  it("uses the standard renderer for geometry and forwards the same tile, URL and cancellation signal", async () => {
    const plugin = new BuildingMetadataPlugin();
    const parseTile = vi.fn().mockResolvedValue(undefined);
    const renderer = { parseTile };
    plugin.init(renderer as never);
    const buffer = tile();
    const node = {} as never;
    const signal = new AbortController().signal;
    await plugin.parseTile(buffer, node, "b3dm", "https://example.invalid/a.b3dm", signal);
    expect(parseTile).toHaveBeenCalledOnce();
    const [compact, forwardedNode, extension, url, forwardedSignal] = parseTile.mock.calls[0]!;
    expect(compact.byteLength).toBeLessThan(buffer.byteLength);
    expect(forwardedNode).toBe(node);
    expect(extension).toBe("b3dm");
    expect(url).toBe("https://example.invalid/a.b3dm");
    expect(forwardedSignal).toBe(signal);
    expect(plugin.parseTile(new ArrayBuffer(12), node, "glb", url, signal)).toBeNull();
    expect(parseTile).toHaveBeenCalledOnce();
  });
});

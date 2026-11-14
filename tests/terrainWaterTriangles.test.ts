import { describe, expect, it } from "vitest";
import { dryTerrainTriangles } from "../src/world/terrainWaterTriangles";

describe("terrain ground on water boundaries", () => {
  it("keeps an independent copy of the complete terrain when there is no water mask", () => {
    const index = new Uint32Array([0, 2, 6, 2, 8, 6]);
    const kept = dryTerrainTriangles(index, null, 0, 2);
    expect(kept).toEqual(index);
    index[0] = 8;
    expect(kept[0]).toBe(0);
  });

  it.each([127, 128])("treats mask value %i with the same water threshold as the surface", (value) => {
    const index = new Uint32Array([0, 2, 6]);
    const kept = dryTerrainTriangles(index, new Uint8Array(9).fill(value), 3, 2);
    expect(Array.from(kept)).toEqual(value === 127 ? [0, 2, 6] : []);
  });

  it("keeps shoreline ground when any one corner is dry", () => {
    const mask = new Uint8Array(9).fill(255);
    mask[0] = 0;
    expect(Array.from(dryTerrainTriangles([0, 2, 6, 2, 8, 6], mask, 3, 2))).toEqual([0, 2, 6]);
  });

  it("keeps ground with a dry centre even when all three corners are wet", () => {
    const mask = new Uint8Array(9).fill(255);
    mask[4] = 0;
    expect(Array.from(dryTerrainTriangles([0, 2, 6], mask, 3, 2))).toEqual([0, 2, 6]);
  });

  it("clamps the last terrain row and column into the mask and keeps winding unchanged", () => {
    const mask = new Uint8Array(16).fill(255);
    mask[15] = 0;
    expect(Array.from(dryTerrainTriangles([8, 5, 2, 0, 1, 3], mask, 4, 2))).toEqual([8, 5, 2]);
  });

  it("leaves no indices or retained backing storage under fully wet ground", () => {
    const kept = dryTerrainTriangles([0, 2, 6, 2, 8, 6], new Uint8Array(9).fill(255), 3, 2);
    expect(kept).toHaveLength(0);
    expect(kept.buffer.byteLength).toBe(0);
  });

  it("keeps dry ground without exposing the source index storage", () => {
    const index = new Uint32Array([0, 2, 6, 2, 8, 6]);
    const kept = dryTerrainTriangles(index, new Uint8Array(9), 3, 2);
    expect(kept).toEqual(index);
    expect(kept.buffer).not.toBe(index.buffer);
  });
});

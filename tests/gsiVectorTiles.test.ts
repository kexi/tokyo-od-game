import { afterEach, expect, it, vi } from "vitest";
import { gsiVectorTile } from "../src/world/gsiVectorTiles";
import { vectorTileCompute } from "../src/world/vectorTileCompute";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const empty = { source: "gsi" as const, roads: [], water: [] };

it("shares both the fetch and decoded roads/water result for simultaneous consumers", async () => {
  const fetchTile = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(1),
  }));
  vi.stubGlobal("fetch", fetchTile);
  const decode = vi.spyOn(vectorTileCompute, "decode").mockResolvedValue(empty);
  const a = gsiVectorTile(16, 1, 1),
    b = gsiVectorTile(16, 1, 1);
  expect(a).toBe(b);
  expect(await a).toBe(empty);
  expect(await gsiVectorTile(16, 1, 1)).toBe(empty);
  expect(fetchTile).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
});

it("caches missing tiles without parsing them and retries other HTTP failures", async () => {
  const fetchTile = vi
    .fn()
    .mockResolvedValueOnce({ status: 404, ok: false })
    .mockResolvedValueOnce({ status: 500, ok: false })
    .mockResolvedValueOnce({ status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  vi.stubGlobal("fetch", fetchTile);
  const decode = vi.spyOn(vectorTileCompute, "decode").mockResolvedValue(empty);
  expect(await gsiVectorTile(16, 2, 1)).toBeNull();
  expect(await gsiVectorTile(16, 2, 1)).toBeNull();
  await expect(gsiVectorTile(16, 3, 1)).rejects.toThrow("HTTP 500");
  expect(await gsiVectorTile(16, 3, 1)).toBe(empty);
  expect(fetchTile).toHaveBeenCalledTimes(3);
  expect(decode).toHaveBeenCalledOnce();
});

it("releases failed parsing entries so the same tile can be loaded again", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) })),
  );
  vi.spyOn(vectorTileCompute, "decode")
    .mockRejectedValueOnce(new Error("bad PBF"))
    .mockResolvedValueOnce(empty);
  await expect(gsiVectorTile(16, 4, 1)).rejects.toThrow("bad PBF");
  expect(await gsiVectorTile(16, 4, 1)).toBe(empty);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Geoid } from "../src/geo/geoid";
import { tileXToLon, tileYToLat } from "../src/geo/tiles";
import { DemStore } from "../src/world/dem";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
  const dem = new DemStore(new Geoid(null));
  const loaded = new Map<string, Float32Array>();
  Reflect.set(dem, "loaded", loaded);
  return { dem, loaded };
}

describe("live DEM height queries", () => {
  it("interpolates within a tile and across its east, south and corner boundaries", () => {
    const { dem, loaded } = fixture();
    for (const [key, h] of [
      ["0/0", 10],
      ["1/0", 20],
      ["0/1", 30],
      ["1/1", 50],
    ] as const)
      loaded.set(key, new Float32Array(65536).fill(h));
    expect(dem.sampleGlobal(10.5, 20.25)).toBe(10);
    expect(dem.sampleGlobal(255.5, 20.25)).toBe(15);
    expect(dem.sampleGlobal(10.5, 255.25)).toBe(15);
    expect(dem.sampleGlobal(255.5, 255.25)).toBe(21.25);
  });

  it("uses zero for missing neighbours and sees a newly arrived or replaced tile immediately", () => {
    const { dem, loaded } = fixture();
    const lat = tileYToLat(0.5, 15),
      lon = tileXToLon(0.5, 15);
    expect(dem.heightAt(lat, lon)).toBeNull();
    expect(dem.sampleGlobal(255.5, 255.5)).toBe(0);
    loaded.set("0/0", new Float32Array(65536).fill(8));
    expect(dem.heightAt(lat, lon)).not.toBeNull();
    expect(dem.sampleGlobal(255.5, 255.5)).toBe(2);
    loaded.set("0/0", new Float32Array(65536).fill(16));
    expect(dem.sampleGlobal(10.5, 20.5)).toBe(16);
    expect(dem.sampleGlobal(255.5, 255.5)).toBe(4);
  });

  it("preserves negative pixel coordinates and NaN samples without filtering them", () => {
    const { dem, loaded } = fixture();
    const tile = new Float32Array(65536).fill(-7);
    loaded.set("-1/-1", tile);
    loaded.set("0/-1", new Float32Array(65536).fill(5));
    expect(dem.sampleGlobal(-10.5, -20.25)).toBe(-7);
    expect(dem.sampleGlobal(-0.5, -20.25)).toBe(-1);
    tile[245 * 256 + 245] = Number.NaN;
    expect(dem.sampleGlobal(-10.5, -10.5)).toBeNaN();
    expect(dem.sampleGlobal(Number.NaN, 0)).toBeNaN();
  });
});

describe("surveyed water-height queries", () => {
  function surveyedFixture() {
    const dem = new DemStore(new Geoid(null));
    const ready = new Map<string, Float32Array | null>();
    Reflect.set(dem, "surveyedReady", ready);
    return { dem, ready };
  }

  it("retains nearest-pixel samples across negative coordinates, tile changes and NaN", () => {
    const { dem, ready } = surveyedFixture();
    const negative = new Float32Array(65536).fill(-7);
    negative[255 * 256 + 255] = Number.NaN;
    ready.set("-1/-1", negative);
    ready.set("0/-1", new Float32Array(65536).fill(5));
    const get = vi.spyOn(ready, "get");
    expect(dem.surveyedAt(-10.5, -20.25)).toBe(-7);
    expect(dem.surveyedAt(-1.5, -2.25)).toBe(-7);
    expect(dem.surveyedAt(-0.5, -0.5)).toBeNaN();
    expect(get).toHaveBeenCalledTimes(1);
    expect(dem.surveyedAt(0.5, -0.5)).toBe(5);
    expect(dem.surveyedAt(-10.5, -20.25)).toBe(-7);
    expect(get).toHaveBeenCalledTimes(3);
    expect(dem.surveyedAt(Number.NaN, 0)).toBeNaN();
  });

  it("sees a missing or cached surveyed tile arrive through loadSurveyed", async () => {
    const { dem, ready } = surveyedFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "12,e" })),
    );
    expect(dem.surveyedAt(0, 0)).toBeNaN();
    await dem.loadSurveyed(0, 0);
    expect(dem.surveyedAt(0, 0)).toBe(12);
    expect(dem.surveyedAt(1, 0)).toBeNaN();
    ready.set("1/0", new Float32Array(65536).fill(7));
    expect(dem.surveyedAt(256, 0)).toBe(7);
    await dem.loadSurveyed(1, 0);
    expect(dem.surveyedAt(256, 0)).toBe(12);
    expect(dem.surveyedAt(257, 0)).toBeNaN();
  });
});

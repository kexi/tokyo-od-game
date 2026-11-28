import { describe, expect, it } from "vitest";
import { Geoid } from "../src/geo/geoid";
import { tileXToLon, tileYToLat } from "../src/geo/tiles";
import { DemStore } from "../src/world/dem";

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

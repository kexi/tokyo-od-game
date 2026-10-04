import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ecefToGeodetic, geodeticToEcef, haversineMeters } from "../src/geo/ellipsoid";
import { LocalFrame } from "../src/geo/frame";
import { Geoid } from "../src/geo/geoid";
import { jstDateAt, jstHour, sunPosition } from "../src/geo/sun";
import { decodeGsiDem, latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles";

const TOCHO = { lat: 35.68955, lon: 139.69235 };

describe("WGS84 conversions", () => {
  it("round-trips geodetic -> ECEF -> geodetic to sub-millimetre", () => {
    const p = geodeticToEcef(TOCHO.lat, TOCHO.lon, 243.0);
    const g = ecefToGeodetic(p.x, p.y, p.z);
    expect(g.lat).toBeCloseTo(TOCHO.lat, 9);
    expect(g.lon).toBeCloseTo(TOCHO.lon, 9);
    expect(g.h).toBeCloseTo(243.0, 3);
  });

  it("measures Tokyo Station to Tocho at roughly 6.6 km", () => {
    const d = haversineMeters(35.681236, 139.767125, TOCHO.lat, TOCHO.lon);
    expect(d).toBeGreaterThan(6400);
    expect(d).toBeLessThan(6900);
  });
});

describe("LocalFrame (x = east, y = up, -z = north)", () => {
  const frame = new LocalFrame(TOCHO.lat, TOCHO.lon, 40);

  it("places the origin at (0,0,0)", () => {
    const v = frame.toLocal(TOCHO.lat, TOCHO.lon, 40);
    expect(v.length()).toBeLessThan(1e-6);
  });

  it("maps north to -Z, east to +X and height to +Y", () => {
    const north = frame.toLocal(TOCHO.lat + 0.001, TOCHO.lon, 40);
    const east = frame.toLocal(TOCHO.lat, TOCHO.lon + 0.001, 40);
    const up = frame.toLocal(TOCHO.lat, TOCHO.lon, 140);
    expect(north.z).toBeLessThan(-100);
    expect(Math.abs(north.x)).toBeLessThan(0.01);
    expect(east.x).toBeGreaterThan(80);
    expect(Math.abs(east.z)).toBeLessThan(0.01);
    expect(up.y).toBeCloseTo(100, 6);
  });

  it("round-trips local -> geodetic", () => {
    const local = new Vector3(812.5, 3.25, -431.75);
    const g = frame.toGeodetic(local);
    const back = frame.toLocal(g.lat, g.lon, g.h);
    expect(back.distanceTo(local)).toBeLessThan(1e-4);
  });

  it("re-anchoring preserves world points (floating origin)", () => {
    const next = new LocalFrame(TOCHO.lat + 0.013, TOCHO.lon - 0.017, 31);
    const m = next.transformFrom(frame);
    const p = frame.toLocal(35.7, 139.7, 55);
    const expected = next.toLocal(35.7, 139.7, 55);
    expect(p.clone().applyMatrix4(m).distanceTo(expected)).toBeLessThan(1e-4);
  });

  it("shows why a single tangent plane cannot cover 23 wards (curvature drop > 10 m at 15 km)", () => {
    const far = frame.toLocal(TOCHO.lat, TOCHO.lon + 0.165, 40); // ~15 km east
    expect(far.y).toBeLessThan(-10);
  });
});

describe("tile math and GSI DEM decoding", () => {
  it("round-trips lon/lat through tile coordinates", () => {
    const x = lonToTileX(TOCHO.lon, 15);
    const y = latToTileY(TOCHO.lat, 15);
    expect(tileXToLon(x, 15)).toBeCloseTo(TOCHO.lon, 9);
    expect(tileYToLat(y, 15)).toBeCloseTo(TOCHO.lat, 9);
    expect(Math.floor(x)).toBe(29099);
  });

  it("decodes positive, negative and no-data elevations per the GSI spec", () => {
    expect(decodeGsiDem(0, 15, 160)).toBeCloseTo(40.0, 6); // 4000 * 0.01
    expect(decodeGsiDem(255, 255, 156)).toBeCloseTo(-1.0, 6); // 2^24 - 100
    expect(Number.isNaN(decodeGsiDem(128, 0, 0))).toBe(true);
  });
});

describe("geoid grid", () => {
  const grid = { lat0: 35, lon0: 139, dLat: 1, dLon: 1, nLat: 2, nLon: 2, values: [30, 32, 34, 36] };

  it("interpolates bilinearly inside the grid", () => {
    expect(new Geoid(grid).undulation(35.5, 139.5)).toBeCloseTo(33, 6);
  });

  it("clamps outside the grid and falls back without data", () => {
    expect(new Geoid(grid).undulation(40, 150)).toBeCloseTo(36, 6);
    expect(new Geoid(null).undulation(35.6, 139.7)).toBeGreaterThan(35);
  });
});

describe("sun position", () => {
  it("puts the sun high in the south around noon in Tokyo and below the horizon at midnight", () => {
    const noon = sunPosition(jstDateAt(11.75, new Date("2026-06-21T03:00:00Z")), TOCHO.lat, TOCHO.lon);
    expect(noon.elevation).toBeGreaterThan(75);
    expect(noon.azimuth).toBeGreaterThan(150);
    expect(noon.azimuth).toBeLessThan(210);
    const midnight = sunPosition(jstDateAt(0, new Date("2026-06-21T03:00:00Z")), TOCHO.lat, TOCHO.lon);
    expect(midnight.elevation).toBeLessThan(-20);
  });

  it("rises in the east in the morning", () => {
    const morning = sunPosition(jstDateAt(6.5, new Date("2026-10-04T03:00:00Z")), TOCHO.lat, TOCHO.lon);
    expect(morning.elevation).toBeGreaterThan(0);
    expect(morning.azimuth).toBeGreaterThan(70);
    expect(morning.azimuth).toBeLessThan(120);
  });

  it("converts between JST clock hours and instants", () => {
    expect(jstHour(jstDateAt(17.5))).toBeCloseTo(17.5, 6);
  });
});

describe("e-Stat 町丁 lookup (public/data/areas.json)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { AreaIndex } = await import("../src/geo/areas");
  const index = new AreaIndex(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "data", "areas.json"), "utf8")),
  );

  it("resolves landmarks to the right ward and town", () => {
    expect(index.lookup(35.6896, 139.6917)).toMatchObject({ ward: "新宿区", town: "西新宿二丁目" });
    expect(index.lookup(35.6812, 139.7671)).toMatchObject({ ward: "千代田区", town: "丸の内一丁目" });
    expect(index.lookup(35.658, 139.7016)?.ward).toBe("渋谷区");
  });

  it("returns null outside the 23 wards (Tama, sea)", () => {
    expect(index.lookup(35.6553, 139.3389)).toBeNull(); // 八王子
    expect(index.lookup(35.55, 139.9)).toBeNull(); // Tokyo Bay
  });
});

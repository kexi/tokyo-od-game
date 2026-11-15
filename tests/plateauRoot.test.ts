import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EllipsoidRegion, OBB, WGS84_ELLIPSOID } from "3d-tiles-renderer/three";
import { SphereRegion } from "3d-tiles-renderer/plugins";
import { Sphere, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PLATEAU_SOURCES } from "../src/config";
import { detectQuality, GRAPHICS, VIEW } from "../src/device";
import { geodeticToEcef } from "../src/geo/ellipsoid";
import { GatedSphereRegion, isGateOpen } from "../src/world/buildings";
import {
  gatesOf,
  normalizeGate,
  plateauRoot,
  plateauRootText,
  regionOf,
  type Region,
  type RootTile,
  type RootTileset,
} from "../src/world/plateauRoot";

const FILE = join(import.meta.dirname, "..", "public", "data", "plateau", "tileset.json");
const bundled = JSON.parse(readFileSync(FILE, "utf8")) as RootTileset;
const bundledGates = gatesOf(bundled, PLATEAU_SOURCES);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Whether region `inner` (west, south, east, north, low, high) lies within `outer`. */
const holds = (outer: number[], inner: number[]) =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3] &&
  inner[4] >= outer[4] &&
  inner[5] <= outer[5];
/** Every content URI in the tree. */
const uris = (t: RootTile): string[] => [
  ...(t.content ? [t.content.uri] : []),
  ...(t.children ?? []).flatMap(uris),
];
const at = (lat: number, lon: number, radius: number, h = 40) => {
  const p = geodeticToEcef(lat, lon, h);
  return new Sphere(new Vector3(p.x, p.y, p.z), radius);
};
/** A tile's bounding volume that the plain sphere test always passes (the box is reached). */
const reached = { intersectsSphere: () => true };
const missed = { intersectsSphere: () => false };
const gated = (gate: Region[]) => ({ extras: { gate } });
type Args = Parameters<SphereRegion["intersectsTile"]>;
const ask = (r: SphereRegion, volume: object, tile: object = {}) =>
  r.intersectsTile(volume as Args[0], tile as Args[1], {} as Args[2]);

describe("the PLATEAU root tileset", () => {
  const children = bundled.root.children ?? [];

  it("has one child per prefecture of PLATEAU_SOURCES, in order, pointing at that prefecture's tileset over its box", () => {
    expect(children).toHaveLength(PLATEAU_SOURCES.length);
    expect(children.map((c) => c.content?.uri)).toEqual(PLATEAU_SOURCES.map((s) => s.url));
    expect(new Set(PLATEAU_SOURCES.map((s) => s.code)).size).toBe(PLATEAU_SOURCES.length);
    for (const [i, s] of PLATEAU_SOURCES.entries()) {
      const region = children[i].boundingVolume.region;
      expect(region.slice(0, 4)).toEqual([
        rad(s.box.west),
        rad(s.box.south),
        rad(s.box.east),
        rad(s.box.north),
      ]);
      expect(region).toEqual(regionOf(s.box));
      expect(holds(bundled.root.boundingVolume.region, region)).toBe(true);
    }
  });

  it("gives every prefecture but Tokyo a gate of regions inside its box, and Tokyo none", () => {
    for (const [i, s] of PLATEAU_SOURCES.entries()) {
      const gate = children[i].extras?.gate;
      if (!s.gated) {
        expect(gate, s.name).toBeUndefined();
        continue;
      }
      expect(gate?.length, s.name).toBeGreaterThan(0);
      for (const r of gate ?? []) expect(holds(children[i].boundingVolume.region, r), s.name).toBe(true);
    }
    expect(PLATEAU_SOURCES.find((s) => s.code === "13")?.gated).toBe(false);
  });

  it("is what the table and its own gates write, with no content of its own and only https tileset.json below", () => {
    // Offline: the gates' contents are --check's (just check-plateau-root) to compare with the service.
    expect(readFileSync(FILE, "utf8")).toBe(plateauRootText(PLATEAU_SOURCES, bundledGates));
    expect(bundled.root.content).toBeUndefined();
    const all = uris(bundled.root);
    expect(all).toHaveLength(PLATEAU_SOURCES.length);
    for (const u of all) expect(u).toMatch(/^https:\/\/.+tileset\.json$/);
  });

  it("refuses to write a gated prefecture without its gate, and writes a gate in one order whatever it is given in", () => {
    expect(() => plateauRoot(PLATEAU_SOURCES, {})).toThrow(/no gate/);
    const a = [0.1, 0.2, 0.3, 0.4, -50, 500];
    const b = [0.05, 0.2, 0.3, 0.4, -50, 500];
    expect(normalizeGate([a, b, a])).toEqual([b, a]);
  });
});

describe("the gated load region", () => {
  const kanagawa = bundledGates["14"];

  it("answers as a SphereRegion for a tile without a gate", () => {
    const sphere = at(35.68, 139.76, 1600);
    const plain = new SphereRegion({ sphere });
    const gate = new GatedSphereRegion({ mask: true });
    gate.sphere.copy(sphere);
    const volumes = [reached, missed];
    for (const v of volumes) expect(ask(gate, v)).toBe(ask(plain, v));
  });

  it("keeps a gated tile out unless the sphere touches one of the gate's regions, to a metre at its edge", () => {
    const region = new GatedSphereRegion({ mask: true });
    // Reaching the prefecture's box is not enough: Tokyo Station, far from every Kanagawa municipality.
    region.sphere.copy(at(35.68075, 139.76345, 1600));
    expect(ask(region, reached, gated(kanagawa))).toBe(false);
    expect(ask(region, missed, gated(kanagawa))).toBe(false);
    // One region, and a point 3 km west of its west edge: the sphere 1 m past the box opens it.
    const [west, south, east, north, low, high] = kanagawa[0];
    const box = new OBB();
    new EllipsoidRegion(
      ...WGS84_ELLIPSOID.radius.toArray(),
      south,
      north,
      west,
      east,
      low,
      high,
    ).getBoundingBox(box.box, box.transform);
    box.update();
    const mid = ((south + north) / 2) * (180 / Math.PI);
    const centre = at(mid, (west * 180) / Math.PI - 0.033, 1, 0).center;
    const d = box.distanceToPoint(centre);
    expect(d).toBeGreaterThan(1000);
    region.sphere.set(centre, d + 1);
    expect(ask(region, reached, gated([kanagawa[0]]))).toBe(true);
    region.sphere.set(centre, d - 1);
    expect(ask(region, reached, gated([kanagawa[0]]))).toBe(false);
  });

  it("gates the far skyline by the near sphere, not by its own", () => {
    const near = new GatedSphereRegion({ mask: true });
    const far = new GatedSphereRegion({ mask: true, gateSphere: near.sphere });
    // At Tokyo Station a 26 km skyline reaches Kawasaki; the 1.6 km town does not.
    near.sphere.copy(at(35.68075, 139.76345, 1600));
    far.sphere.copy(at(35.68075, 139.76345, 26000));
    expect(isGateOpen(kanagawa, far.sphere)).toBe(true);
    expect(ask(far, reached, gated(kanagawa))).toBe(false);
    // The near sphere moved to Kawasaki Station (the same object): the skyline's gate opens with it.
    near.sphere.copy(at(35.5313, 139.697, 1600));
    expect(ask(far, reached, gated(kanagawa))).toBe(true);
  });

  it("keeps all three prefectures shut at Tokyo Station and by the 旧江戸川, and opens Kanagawa at Kawasaki and Saitama at Kawaguchi", () => {
    // Every near sphere the game can have: each 描画距離 on a PC, on a phone by default (the setting's
    // radius) and on a phone with ?phoneTown=full (低's 1.6 km whatever the setting).
    const views = Object.keys(VIEW) as Array<keyof typeof VIEW>;
    expect(views).toHaveLength(3);
    const radii = views.flatMap((viewDistance) => {
      const g = { ...GRAPHICS.settings, viewDistance };
      return [
        detectQuality(g, false, null),
        detectQuality(g, true, null),
        detectQuality(g, true, "full"),
      ].map((q) => q.buildingLoadRadius);
    });
    expect(new Set(radii)).toEqual(new Set([1600, 2800, 4000]));
    for (const r of new Set(radii)) {
      for (const code of ["14", "11", "12"]) {
        expect(
          isGateOpen(bundledGates[code], at(35.68075, 139.76345, r)),
          `Tokyo Station ${code} ${r} m`,
        ).toBe(false);
      }
      expect(isGateOpen(bundledGates["12"], at(35.683, 139.889, r)), `旧江戸川 12 ${r} m`).toBe(false);
      expect(isGateOpen(bundledGates["14"], at(35.5313, 139.697, r)), `Kawasaki 14 ${r} m`).toBe(true);
      expect(isGateOpen(bundledGates["11"], at(35.8017, 139.7173, r)), `Kawaguchi 11 ${r} m`).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { Matrix4, Object3D, Vector3 } from "three";
import { VIEW } from "../src/device";
import { LocalFrame } from "../src/geo/frame";
import { Geoid } from "../src/geo/geoid";
import { haversineMeters } from "../src/geo/ellipsoid";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles";
import { hazeCover, LIGHT_FLOOR } from "../src/world/atmosphere";
import { pruneTree, type TileNode } from "../src/world/buildings";
import {
  CARPET,
  farGroundReach,
  farTileGeometry,
  farTilesAround,
  sampleDem,
  SEA_LEVEL,
  tileWidth,
} from "../src/world/farGround";
import { landmarkPose } from "../src/world/landmarks";
import { builtSquare } from "../src/world/terrain";

/** 大泉学園 (west Nerima), where the user looked at Tokyo Tower from. */
const OIZUMI = { lat: 35.75, lon: 139.586 };
const STATION = { lat: 35.6813763, lon: 139.7660621, baseHeight: 3.4, heading: 287.05 };
const TOWER = { lat: 35.658592, lon: 139.74545, baseHeight: 18.5, heading: 124.5 };
const SKYTREE = { lat: 35.7100392, lon: 139.810708, baseHeight: 1.9, heading: 353.8 };
const geoid = new Geoid(null);
const ellipsoidal = (lat: number, lon: number, h: number) => h + geoid.undulation(lat, lon);

describe("the far ground's ring", () => {
  it("is the (2r+1)² tiles round the player's, nearest first", () => {
    const tiles = farTilesAround(OIZUMI.lat, OIZUMI.lon, 11, 2);
    expect(tiles).toHaveLength(25);
    const cx = Math.floor(lonToTileX(OIZUMI.lon, 11));
    const cy = Math.floor(latToTileY(OIZUMI.lat, 11));
    expect(tiles[0]).toEqual({ x: cx, y: cy, ring: 0 });
    const rings = tiles.map((t) => t.ring);
    expect(rings).toEqual(rings.toSorted((a, b) => a - b));
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(25);
  });

  it("reaches 31 km or more every way on every 描画距離, past the far skyline and the towers", () => {
    for (const view of Object.values(VIEW)) {
      const reach = farGroundReach(view.farGroundZoom, view.farGroundRing);
      expect(reach).toBeGreaterThan(31_000);
      expect(reach).toBeGreaterThan(view.farBuildingRadius);
    }
    // Tokyo Tower and the Skytree from 大泉学園: within it, so they stand on ground.
    const toTower = haversineMeters(OIZUMI.lat, OIZUMI.lon, TOWER.lat, TOWER.lon);
    const toSkytree = haversineMeters(OIZUMI.lat, OIZUMI.lon, SKYTREE.lat, SKYTREE.lon);
    expect(toTower).toBeLessThan(farGroundReach(10, 1));
    expect(toSkytree).toBeLessThan(farGroundReach(10, 1));
    expect(tileWidth(11, 35.68)).toBeCloseTo(15_895, -1);
  });

  it("leaves the near terrain the widest square of built chunks round the player", () => {
    const built = new Set([
      "10/10",
      "9/9",
      "10/9",
      "11/9",
      "9/10",
      "11/10",
      "9/11",
      "10/11",
      "11/11",
      "12/12",
    ]);
    const isBuilt = (x: number, y: number) => built.has(`${x}/${y}`);
    expect(builtSquare(10, 10, 2, isBuilt)).toEqual({ x0: 9, y0: 9, x1: 12, y1: 12 });
    expect(builtSquare(10, 10, 0, isBuilt)).toEqual({ x0: 10, y0: 10, x1: 11, y1: 11 });
    // One chunk of the first ring missing: only the centre.
    built.delete("11/9");
    expect(builtSquare(10, 10, 2, isBuilt)).toEqual({ x0: 10, y0: 10, x1: 11, y1: 11 });
    expect(builtSquare(20, 20, 2, isBuilt)).toBeNull();
  });
});

/** A DEM tile from a function of its pixel. */
const ramp = (f: (i: number, j: number) => number) => {
  const t = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) t[j * 256 + i] = f(i, j);
  return t;
};

describe("the far ground's heights", () => {
  it("meets the next tile without a crack (the edge reads the neighbour's first pixel)", () => {
    const west = ramp((i) => i * 0.1);
    const east = ramp((i) => 25.6 + i * 0.1);
    for (const py of [0, 37.5, 128, 255]) {
      const edgeOfWest = sampleDem(west, 256, py, east).height;
      const edgeOfEast = sampleDem(east, 0, py).height;
      expect(edgeOfWest).toBeCloseTo(edgeOfEast, 5);
    }
  });

  it("puts the sea (no DEM value) at SEA_LEVEL, below the near water layer", () => {
    const bay = ramp((i) => (i < 128 ? 4 : Number.NaN));
    expect(sampleDem(bay, 200, 100)).toEqual({ height: SEA_LEVEL, sea: 1 });
    expect(sampleDem(bay, 20, 100)).toEqual({ height: 4, sea: 0 });
    expect(SEA_LEVEL).toBeLessThan(-1);
  });

  it("stands Tokyo Station's, Tokyo Tower's and the Skytree's far models on it from 5–20 km, curvature and all", () => {
    for (const lm of [STATION, TOWER, SKYTREE]) {
      // A far tile with a grid vertex exactly at the landmark: z11, 32 cells, the vertex nearest it.
      const zoom = 11;
      const s = 32;
      const gx = lonToTileX(lm.lon, zoom);
      const gy = latToTileY(lm.lat, zoom);
      const x = Math.floor(gx);
      const y = Math.floor(gy);
      const i = Math.round((gx - x) * s);
      const j = Math.round((gy - y) * s);
      const at = {
        lat: tileYToLat(y + j / s, zoom),
        lon: tileXToLon(x + i / s, zoom),
        baseHeight: lm.baseHeight,
        heading: 0,
      };
      const { geometry, centre } = farTileGeometry(
        x,
        y,
        zoom,
        s,
        () => ({ height: lm.baseHeight, sea: 0 }),
        ellipsoidal,
        { x: 0, y: 0 },
      );
      for (const from of [
        { lat: at.lat + 0.045, lon: at.lon },
        { lat: at.lat, lon: at.lon - 0.16 },
        OIZUMI,
      ]) {
        const d = haversineMeters(from.lat, from.lon, at.lat, at.lon);
        const frame = new LocalFrame(from.lat, from.lon, 40);
        const ground = new Vector3()
          .fromBufferAttribute(geometry.getAttribute("position"), j * (s + 1) + i)
          .applyMatrix4(
            new Matrix4().multiplyMatrices(frame.ecefToLocal, new Matrix4().makeTranslation(centre)),
          );
        const base = landmarkPose(at, frame, ellipsoidal, new Object3D()).position;
        // Float32 positions relative to an ~8 km tile's centre: within a few centimetres.
        expect(base.distanceTo(ground)).toBeLessThan(0.05);
        // Both are below the frame's tangent plane by the curvature drop d²/2R (plus the height).
        const drop = (d * d) / (2 * 6_371_000);
        const expected = ellipsoidal(at.lat, at.lon, lm.baseHeight) - 40 - drop;
        expect(Math.abs(base.y - expected)).toBeLessThan(0.05 * drop + 0.2);
        expect(d).toBeGreaterThan(4_000);
      }
    }
  });

  it("raises the land by the low city's height, enough to hide a far tower's foot, not its body", () => {
    expect(CARPET).toBeGreaterThanOrEqual(8);
    expect(CARPET).toBeLessThan(0.1 * 333);
  });
});

const tile = (error: number, children: TileNode[] = [], uri: string | null = "data/x.b3dm"): TileNode => ({
  geometricError: error,
  ...(uri ? { content: { uri } } : {}),
  children,
});
/** As the far skyline's plugin does it: the whole tree when its root arrives. */
const preprocess = (t: TileNode, minError: number): TileNode => {
  pruneTree(t, minError);
  return t;
};
/** The geometric errors of the content tiles left. */
const contents = (t: TileNode): number[] => [
  ...(t.content?.uri?.endsWith(".b3dm") ? [t.geometricError] : []),
  ...(t.children ?? []).flatMap(contents),
];

/** 港区: every level has content, coarse to fine (errors from its tileset.json). */
const minato = () =>
  tile(454, [
    tile(408, [tile(250, [tile(0)]), tile(120, [tile(0)])]),
    tile(247, [tile(160, [tile(0)]), tile(170, [tile(0)])]),
    tile(236, [tile(67, [tile(0)])]),
    tile(454, [tile(222, [tile(0)])]),
  ]);
/** 台東区: empty groups down to the full detail (errors 32–64, ~0.8 MB a tile). */
const taito = () => tile(1e100, [tile(1e100, [tile(64, [tile(16)]), tile(32, [tile(16)])], null)], null);

describe("the far skyline's PLATEAU levels", () => {
  it("keeps a ward's root and the coarser of its children (中・高・最高: 150 m)", () => {
    const kept = contents(preprocess(minato(), 150));
    // 236 has a 67 m child: it stops there. 408 stops (a 120 m child); 247 keeps 160 and 170.
    expect(kept.toSorted((a, b) => b - a)).toEqual([454, 454, 408, 247, 236, 222, 170, 160]);
    expect(Math.min(...kept)).toBeGreaterThanOrEqual(150);
  });

  it("keeps only the coarsest level on 低 (200 m)", () => {
    const kept = contents(preprocess(minato(), 200));
    expect(Math.min(...kept)).toBeGreaterThanOrEqual(200);
    expect(kept).not.toContain(0);
  });

  it("leaves a tileset whose first content is already the full detail out", () => {
    expect(contents(preprocess(taito(), 150))).toEqual([]);
  });

  it("keeps the presets' radii and levels as budgeted (knowledge/far-skyline.md)", () => {
    expect(VIEW.near.farBuildingMinError).toBeGreaterThan(VIEW.medium.farBuildingMinError);
    expect(VIEW.near.farBuildingRadius).toBeLessThan(VIEW.medium.farBuildingRadius);
    expect(VIEW.far.farBuildingRadius).toBeGreaterThanOrEqual(VIEW.medium.farBuildingRadius);
    for (const v of Object.values(VIEW)) expect(v.farBuildingMinError).toBeGreaterThanOrEqual(100);
  });
});

describe("the haze over the far city", () => {
  it("covers a dark wall as Beer–Lambert does", () => {
    for (const tau of [0.1, 1, 3, 8]) expect(hazeCover(tau, 0, 0.5)).toBeCloseTo(1 - Math.exp(-tau), 9);
  });

  it("lets a light far brighter than the haze keep LIGHT_FLOOR of itself at any depth", () => {
    // Tokyo Tower lit (1.3) 8 km off in rain (τ ≈ 7.4) against the night haze (0.11).
    const cover = hazeCover(7.4, 0, 1.3 / 0.11);
    expect(1 - cover).toBeGreaterThan(LIGHT_FLOOR * 0.99);
    // Beer–Lambert alone leaves 6·10⁻⁴.
    expect(Math.exp(-7.4)).toBeLessThan(1e-3);
  });

  it("still ends in the haze's colour at the edge of the drawn world (the linear floor)", () => {
    expect(hazeCover(7.4, 1, 20)).toBe(1);
  });
});

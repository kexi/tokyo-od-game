import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CUT_WALL, TUNNEL_WALKWAY } from "../src/expressway/assumptions";
import { TUNNEL_INNER_HEIGHT_M } from "../src/expressway/below";
import type { XwChunk, XwPortal } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { carriagewayWidth } from "../src/expressway/section";
import { LocalFrame } from "../src/geo/frame";
import { latToTileY, lonToTileX } from "../src/geo/tiles";
import { createDeckBody, deckArraySteps, type GeoToLocal, tunnelPoint } from "../src/world/expresswayDeck";
import { BORE_FACES, boreHoles, boreLoop } from "../src/world/expresswayBore";
import { GroundCuts } from "../src/world/groundCuts";

beforeAll(() => RAPIER.init());

// Synthetic chunks going east near 芝公園 (P9): a tunnel and a cut, road at T.P. 10 m, level.
const plane = planeAt(139.75, 35.65);
const N = 36.9; // a constant geoid
const frame = new LocalFrame(35.65, 139.751, 40);
const place: GeoToLocal = { frame, ellipsoidal: (_lat, _lon, h) => h + N };
const ROAD = 10;

function chunkOf(structure: "tunnel" | "cut", ground: number, portals?: XwPortal[]): XwChunk {
  const st: number[] = [];
  for (let s = 0; s <= 100; s += 10) {
    const [lon, lat] = plane.toLonLat(100 + s, 0);
    st.push(s, lon, lat, ROAD, 0, ground, 0);
  }
  return {
    id: "B:0",
    run: "B",
    chain: "B",
    k: 0,
    cls: "expressway",
    ref: "C1",
    name: null,
    structure,
    ...(portals ? { portals } : {}),
    over: null,
    lanes: 2,
    laneWidth: 3.25,
    shoulderL: 1.25,
    shoulderR: 0.75,
    basis: "statute",
    V: 60,
    maxspeed: null,
    vh: 50,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    h0: 0,
    h1: 0,
    girder: 0,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
  };
}

function built(chunk: XwChunk) {
  const steps = deckArraySteps(chunk, place);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));
function worldWith(chunk: XwChunk) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  const b = built(chunk);
  createDeckBody(world, b.collider, b.piers, null);
  world.step();
  return world;
}

/** The road's centre at run distance s (local), the local "north" (left of travel) and "east". */
function centreAt(s: number) {
  const [lon, lat] = plane.toLonLat(100 + s, 0);
  return frame.toLocal(lat, lon, ROAD + N);
}
const cast = (
  world: RAPIER.World,
  from: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
) => {
  const hit = world.castRay(new RAPIER.Ray(from, dir), 60, true);
  return hit ? hit.timeOfImpact : null;
};
const HW = (2 * 3.25 + 1.25 + 0.75) / 2;

describe("トンネルの断面（expresswayBore.ts、P9）", () => {
  const chunk = chunkOf("tunnel", 30);

  it("the section's loops and face tables agree, and the road is the first three corners as on a deck", () => {
    const at = (u: number, v: number) => [u, v, 0];
    for (const structure of ["tunnel", "cut"] as const) {
      const loop = boreLoop(structure, HW, at, () => 0, 5);
      expect(loop.length - 1).toBe(BORE_FACES[structure].length);
      expect(loop.slice(0, 3).map((p) => p[1])).toEqual([0, 0, 0]);
      expect(loop[0][0]).toBe(-HW);
      expect(loop[2][0]).toBe(HW);
    }
    expect(carriagewayWidth(chunk) / 2).toBe(HW);
  });

  it("the collider has the floor at the road (T11, ≤ 1 cm), the ceiling at the inner height and the walls past the walkways", () => {
    const world = worldWith(chunk);
    for (const s of [15.013, 47.013, 83.013]) {
      const c = centreAt(s);
      const floor = cast(world, { x: c.x, y: c.y + 2, z: c.z + 0.37 }, { x: 0, y: -1, z: 0 });
      expect(floor).not.toBeNull();
      expect(Math.abs(floor! - 2)).toBeLessThan(0.01);
      const roof = cast(world, { x: c.x, y: c.y + 1, z: c.z + 0.37 }, { x: 0, y: 1, z: 0 });
      expect(roof).not.toBeNull();
      expect(Math.abs(roof! + 1 - TUNNEL_INNER_HEIGHT_M)).toBeLessThan(0.01);
      // North is −z in the local frame and left of travel (east).
      for (const dz of [-1, 1]) {
        const side = cast(world, { x: c.x, y: c.y + 1, z: c.z }, { x: 0, y: 0, z: dz });
        expect(side).not.toBeNull();
        expect(Math.abs(side! - (HW + TUNNEL_WALKWAY.value.width))).toBeLessThan(0.02);
      }
      // At the curb's height the curb stops a wheel at the carriageway's edge.
      const curb = cast(world, { x: c.x, y: c.y + 0.1, z: c.z }, { x: 0, y: 0, z: -1 });
      expect(Math.abs(curb! - HW)).toBeLessThan(0.02);
    }
  });

  it("its roof top is solid (a street crossing a portal's hole rides over it), at inner height + roof slab", () => {
    const world = worldWith(chunk);
    const c = centreAt(47.013);
    const top = cast(world, { x: c.x, y: c.y + 30, z: c.z + 0.37 }, { x: 0, y: -1, z: 0 });
    expect(top).not.toBeNull();
    expect(Math.abs(30 - top! - (TUNNEL_INNER_HEIGHT_M + 0.8))).toBeLessThan(0.02);
  });

  it("lamps hang just under the ceiling all along it; a cut has none", () => {
    const b = built(chunk);
    expect(b.lamps.length).toBeGreaterThan(0);
    const c = centreAt(50);
    for (let i = 1; i < b.lamps.length; i += 3) {
      expect(b.lamps[i] - c.y).toBeGreaterThan(TUNNEL_INNER_HEIGHT_M - 0.1);
      expect(b.lamps[i] - c.y).toBeLessThan(TUNNEL_INNER_HEIGHT_M);
    }
    expect(built(chunkOf("cut", 15)).lamps.length).toBe(0);
  });

  it("a portal into the tunnel has a solid 坑門 above the bore; without one nothing stops a ray there", () => {
    const at = centreAt(0);
    const from = { x: at.x - 5, y: at.y + TUNNEL_INNER_HEIGHT_M + 0.5, z: at.z };
    const withPortal = worldWith(chunkOf("tunnel", 30, [{ s: 0, from: "cut", to: "tunnel" }]));
    expect(cast(withPortal, from, { x: 1, y: 0, z: 0 })).toBeCloseTo(5, 1);
    const without = worldWith(chunk);
    expect(cast(without, from, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});

describe("掘割の断面（P9）", () => {
  const chunk = chunkOf("cut", 15);

  it("retaining walls stand at the carriageway's edge and rise past the ground by CUT_WALL.above", () => {
    const world = worldWith(chunk);
    const c = centreAt(47.013);
    const side = cast(world, { x: c.x, y: c.y + 1, z: c.z }, { x: 0, y: 0, z: -1 });
    expect(Math.abs(side! - HW)).toBeLessThan(0.02);
    const top = cast(world, { x: c.x, y: c.y + 20, z: c.z - (HW + 0.25) }, { x: 0, y: -1, z: 0 });
    const groundY = frame.toLocal(...geo(47.013), 15 + N).y;
    expect(Math.abs(c.y + 20 - top! - (groundY + CUT_WALL.value.above))).toBeLessThan(0.02);
  });

  it("has nothing of its own beside the walls (the terrain keeps the ground there: terrainCut.ts), and nothing over the road", () => {
    const world = worldWith(chunk);
    const c = centreAt(47.013);
    for (const dz of [-1, 1]) {
      const hit = cast(world, { x: c.x, y: c.y + 20, z: c.z + dz * (HW + 6) }, { x: 0, y: -1, z: 0 });
      expect(hit).toBeNull();
    }
    const up = cast(world, { x: c.x, y: c.y + 1, z: c.z }, { x: 0, y: 1, z: 0 });
    expect(up).toBeNull();
  });
});

/** lat, lon of run distance s on the synthetic line. */
function geo(s: number): [number, number] {
  const [lon, lat] = plane.toLonLat(100 + s, 0);
  return [lat, lon];
}

describe("地形の切り欠き（groundCuts.ts、P9）", () => {
  const toTile = (lon: number, lat: number): [number, number] => [lonToTileX(lon, 16), latToTileY(lat, 16)];

  it("a cut is cut out all along; a deep tunnel not at all; a tunnel with the ground near its roof is", () => {
    expect(boreHoles(chunkOf("cut", 15), toTile)).toHaveLength(1);
    expect(boreHoles(chunkOf("tunnel", 30), toTile)).toHaveLength(0);
    expect(boreHoles(chunkOf("tunnel", 14), toTile)).toHaveLength(1);
  });

  it("the terrain's mask is the cut over the cut and nothing far from it, and the water's where there is no cut", () => {
    const water = {
      versionAt: () => 1,
      maskAt: () => ({ data: new Uint8Array(4).fill(0), size: 2 }),
    };
    const cuts = new GroundCuts(water);
    const before = cuts.versionAt(...z15(50));
    cuts.addChunk(chunkOf("cut", 15));
    const [x, y] = z15(50);
    expect(cuts.versionAt(x, y)).not.toBe(before);
    const cut = cuts.cutAt(x, y)!;
    const [px, py] = pixel(50, 0, cut.size);
    expect(cut.data[py * cut.size + px]).toBe(255);
    // 30 m north of the centre line: outside the walls.
    const [qx, qy] = pixel(50, 30, cut.size);
    expect(cut.data[qy * cut.size + qx]).toBe(0);
    const mask = cuts.maskAt(x, y)!;
    expect(mask.size).toBe(cut.size);
    expect(mask.data.reduce((a, b) => Math.max(a, b), 0)).toBe(255);
    // A chunk added twice is cut once (the version moves once).
    const v = cuts.versionAt(x, y);
    cuts.addChunk(chunkOf("cut", 15));
    expect(cuts.versionAt(x, y)).toBe(v);
  });

  function z15(s: number): [number, number] {
    const [lat, lon] = geo(s);
    return [Math.floor(lonToTileX(lon, 15)), Math.floor(latToTileY(lat, 15))];
  }
  function pixel(s: number, north: number, size: number): [number, number] {
    const [lon, lat] = plane.toLonLat(100 + s, north);
    const [x, y] = z15(s);
    return [Math.floor((lonToTileX(lon, 15) - x) * size), Math.floor((latToTileY(lat, 15) - y) * size)];
  }
});

describe("トンネルの中の判定（tunnelPoint、P9）", () => {
  const chunk = chunkOf("tunnel", 30);
  const ellipsoidal = (_lat: number, _lon: number, h: number) => h + N;

  it("a point on the road under the roof is inside; above the roof or beside the walls it is not", () => {
    const [lat, lon] = geo(40);
    expect(tunnelPoint(chunk, lat, lon, ROAD + N + 1.5, ellipsoidal)).toBe(40);
    expect(tunnelPoint(chunk, lat, lon, ROAD + N + 12, ellipsoidal)).toBeNull();
    const [, lonFar] = geo(40);
    const [, latFar] = plane.toLonLat(140, 30);
    expect(tunnelPoint(chunk, latFar, lonFar, ROAD + N + 1.5, ellipsoidal)).toBeNull();
  });

  it("between stations the distance is the projection on the centre line, not the nearest station (no steps in the shelter)", () => {
    for (const s of [43.7, 45, 47.2]) {
      const [lat, lon] = geo(s);
      expect(tunnelPoint(chunk, lat, lon, ROAD + N + 1.5, ellipsoidal)).toBeCloseTo(s, 1);
    }
    // 3 m left of the centre: still inside (walls at 5 m), at the same distance along.
    const [lon, lat] = plane.toLonLat(145, 3);
    expect(tunnelPoint(chunk, lat, lon, ROAD + N + 1.5, ellipsoidal)).toBeCloseTo(45, 1);
  });
});

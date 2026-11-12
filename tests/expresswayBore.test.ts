import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
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
import { CutRelay, dropCut, GroundCuts } from "../src/world/groundCuts";

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

  it("raises each cut wall to the ground at its own side where that is higher than over the centre (P2.7-5)", () => {
    const at = (u: number, v: number) => [u, v, 0];
    const above = CUT_WALL.value.above;
    const top = (loop: number[][], side: 1 | -1) =>
      Math.max(...loop.filter((p) => Math.sign(p[0]) === side).map((p) => p[1]));
    // The centre's ground 5 m over the road; the street on the right 5.6 m, the left lower (4 m).
    const loop = boreLoop("cut", HW, at, () => 0, 5, { left: 4, right: 5.6 });
    expect(top(loop, -1)).toBeCloseTo(5.6 + above, 9);
    // Never lower than over the centre: the lower side keeps the centre's height.
    expect(top(loop, 1)).toBeCloseTo(5 + above, 9);
    // Without the sides, both from the centre as before.
    const plain = boreLoop("cut", HW, at, () => 0, 5);
    expect(top(plain, -1)).toBeCloseTo(5 + above, 9);
    expect(top(plain, 1)).toBeCloseTo(5 + above, 9);
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

describe("一般道の路面を穴で切る（roadSurface.ts dropCut、P2.7-5）", () => {
  it("drops a road triangle with any corner in the hole, not only its centre (the wedge through the wall)", () => {
    // The hole: x > 10. A long triangle reaching 2 m into it with its centre outside, one wholly out.
    const pos = [0, 0, 0, 12, 0, 1, 0, 0, 2, -5, 0, 0, -1, 0, 0, -5, 0, 1];
    const kept = dropCut(pos, [0, 1, 2, 3, 4, 5], (x) => x > 10);
    expect(kept).toEqual([3, 4, 5]);
  });
});

describe("穴の後から一般道・歩道を敷き直す時（CutRelay、P2.7-5）", () => {
  const ring = (x: number): Array<[number, number]> => [
    [x, 0],
    [x + 1, 0],
    [x, 1],
  ];
  const near = () => true;
  it("lays round a hole that came after the streets at once", () => {
    const relay = new CutRelay();
    expect(relay.take([ring(0)], near, false)).toEqual([ring(0)]);
    expect(relay.take([ring(0)], near, false)).toBeNull();
  });
  it("holds a hole that came while the streets were loading and lays round it when they are done (the slab in the box)", () => {
    const relay = new CutRelay();
    expect(relay.take([ring(0)], near, true)).toBeNull();
    expect(relay.hasPending).toBe(true);
    // Another hole during the same load joins it.
    expect(relay.take([ring(0), ring(5)], near, true)).toBeNull();
    expect(relay.take([ring(0), ring(5)], near, false)).toEqual([ring(0), ring(5)]);
    expect(relay.hasPending).toBe(false);
  });
  it("does nothing for holes outside the area laid", () => {
    const relay = new CutRelay();
    expect(relay.take([ring(0)], () => false, false)).toBeNull();
    expect(relay.hasPending).toBe(false);
  });
});

describe("麻布台の箱（737538573:2 s 515–596 の掘割）の中に一般道・歩道の面が無い（実データ、P2.7-5）", () => {
  const files = readExpresswayFiles();
  const box = files.chunks.find((c) => c.id === "737538573:2")!;
  const half = carriagewayWidth(box) / 2;
  const frame = new LocalFrame(box.st[2], box.st[1], 0);
  /** Points on the road under the box every 2 m along and 1 m across: where a ray from the camera lands. */
  const samples: Array<[number, number]> = [];
  for (let i = 0; i + 7 < box.st.length; i += 7) {
    const [lon0, lat0, lon1, lat1] = [box.st[i + 1], box.st[i + 2], box.st[i + 8], box.st[i + 9]];
    const plane = planeAt(lon0, lat0);
    const [dx, dy] = plane.toXY(lon1, lat1);
    const len = Math.hypot(dx, dy);
    for (let f = 0; f < len; f += 2) {
      const s = box.st[i] + f;
      // s 490–513 has the ground over the box's roof (no hole: a 歩道 there lies on the ground above).
      const isInBox = s >= 515 && s <= 596;
      if (!isInBox) continue;
      for (let w = -half + 0.5; w <= half - 0.5; w += 1)
        samples.push(plane.toLonLat((dx / len) * f - (dy / len) * w, (dy / len) * f + (dx / len) * w));
    }
  }
  /** A PLATEAU 歩道 over the whole box (a lon/lat ring) and a street's triangles across it (local x, z). */
  const lons = samples.map(([lon]) => lon);
  const lats = samples.map(([, lat]) => lat);
  const M = 1e-4;
  const [w, e, so, n] = [
    Math.min(...lons) - M,
    Math.max(...lons) + M,
    Math.min(...lats) - M,
    Math.max(...lats) + M,
  ];
  const pavement = [w, so, e, so, e, n, w, n];
  const corners = [
    [w, so],
    [e, so],
    [e, n],
    [w, n],
  ].map(([lon, lat]) => frame.toLocal(lat, lon, 0));
  const street: number[] = [];
  const idx: number[] = [];
  const STEPS = 40;
  for (let b = 0; b <= STEPS; b++)
    for (let a = 0; a <= STEPS; a++) {
      const [u, v] = [a / STEPS, b / STEPS];
      const at = (k: "x" | "z") =>
        (1 - v) * ((1 - u) * corners[0][k] + u * corners[1][k]) +
        v * ((1 - u) * corners[3][k] + u * corners[2][k]);
      street.push(at("x"), 0, at("z"));
    }
  for (let b = 0; b < STEPS; b++)
    for (let a = 0; a < STEPS; a++) {
      const k = b * (STEPS + 1) + a;
      idx.push(k, k + 1, k + STEPS + 1, k + 1, k + STEPS + 2, k + STEPS + 1);
    }
  /** Lay the pavement and the street round the holes as main.ts does (pavementsOffCuts, roadSurface's dropCut). */
  const lay = (cuts: GroundCuts) => {
    const cutAt = (x: number, z: number) => {
      const g = frame.toGeodetic(new Vector3(x, 0, z));
      return cuts.containsLonLat(g.lon, g.lat);
    };
    return {
      pavements: cuts.touchesLonLat(pavement) ? [] : [pavement],
      triangles: cuts.isEmpty() ? idx : dropCut(street, idx, cutAt),
    };
  };
  /** How many of the box's samples a ray down finds a pavement or street face at. */
  const facesInBox = (laid: ReturnType<typeof lay>) =>
    samples.filter(([lon, lat]) => {
      const isOnPavement = laid.pavements.some((p) => isInRing(p, lon, lat));
      const p = frame.toLocal(lat, lon, 0);
      return isOnPavement || isOnTriangle(street, laid.triangles, p.x, p.z);
    }).length;

  it("the box's open cut is a hole all over the samples", () => {
    const cuts = new GroundCuts(null);
    cuts.addChunk(box);
    expect(samples.length).toBeGreaterThan(250);
    expect(samples.every(([lon, lat]) => cuts.containsLonLat(lon, lat))).toBe(true);
  });
  it("the hole read before the streets: nothing is laid in the box", () => {
    const cuts = new GroundCuts(null);
    cuts.addChunk(box);
    expect(facesInBox(lay(cuts))).toBe(0);
  });
  it("the hole read while the streets were loading, the pavements already built: held, laid round after the load, nothing in the box", () => {
    const cuts = new GroundCuts(null);
    const relay = new CutRelay();
    expect(facesInBox(lay(cuts))).toBe(samples.length);
    cuts.addChunk(box);
    expect(relay.take(cuts.ringsLonLat(), () => true, true)).toBeNull();
    expect(relay.take(cuts.ringsLonLat(), () => true, false)).toHaveLength(1);
    expect(facesInBox(lay(cuts))).toBe(0);
  });
  /**
   * The two PLATEAU 交通島 (港区 LOD2 AuxiliaryTrafficArea, 島) over the box, as read on 2026-11-12: the
   * "pole and arm" of tunnel-toward-exit and the pale band of north-exit-driver were the kerb and top
   * of the first, laid inside the box (the view shooter's --pick: `pavements`, 61–94 m, s 530–575).
   */
  const ISLANDS = [
    [
      139.7385282, 35.6635884, 139.7385231, 35.6635874, 139.7385188, 35.6635886, 139.7385163, 35.6635912,
      139.7385154, 35.6635947, 139.7385163, 35.6636005, 139.7385183, 35.6636108, 139.7385212, 35.6636244,
      139.7385226, 35.6636269, 139.7385253, 35.6636292, 139.7385287, 35.6636303, 139.7385317, 35.6636307,
      139.7385359, 35.6636291, 139.7385387, 35.6636258, 139.7385391, 35.6636239, 139.7385368, 35.6636143,
      139.7385336, 35.663603, 139.7385327, 35.6635944, 139.7385312, 35.6635908,
    ],
    [
      139.7387017, 35.6647973, 139.7386619, 35.6646288, 139.738594, 35.6643372, 139.7384737, 35.6638098,
      139.7384723, 35.6638115, 139.7384693, 35.6638171, 139.7384673, 35.6638226, 139.7384665, 35.6638289,
      139.7384658, 35.6638348, 139.7384675, 35.6638412, 139.7384702, 35.6638546, 139.738477, 35.6638849,
      139.7384854, 35.6639206, 139.7385035, 35.6639957, 139.7385154, 35.664048, 139.7385322, 35.6641218,
      139.7385409, 35.6641605, 139.738554, 35.6642179, 139.7385685, 35.6642797, 139.7385767, 35.6643177,
      139.7385919, 35.6643821, 139.7386031, 35.6644478, 139.7386113, 35.6644988, 139.7386183, 35.6645346,
      139.7386205, 35.6645488, 139.7386295, 35.6645994, 139.7386426, 35.6646692, 139.7386539, 35.6647396,
      139.7386654, 35.664802,
    ],
  ];
  it("the PLATEAU 交通島 over the box stand in it before the hole and are left out once it is laid round, whatever the order", () => {
    const inBox = (rings: number[][]) =>
      samples.filter(([lon, lat]) => rings.some((r) => isInRing(r, lon, lat))).length;
    const relay = new CutRelay();
    const cuts = new GroundCuts(null);
    const before = ISLANDS.filter((r) => !cuts.touchesLonLat(r));
    expect(inBox(before)).toBeGreaterThan(0);
    // The hole comes while the streets load, the islands already built: held, then laid round.
    cuts.addChunk(box);
    expect(relay.take(cuts.ringsLonLat(), () => true, true)).toBeNull();
    expect(relay.take(cuts.ringsLonLat(), () => true, false)).toHaveLength(1);
    const after = ISLANDS.filter((r) => !cuts.touchesLonLat(r));
    expect(after).toHaveLength(0);
    expect(inBox(after)).toBe(0);
  });
  it("the hole read after the streets: laid round at once, nothing in the box", () => {
    const cuts = new GroundCuts(null);
    const relay = new CutRelay();
    expect(facesInBox(lay(cuts))).toBe(samples.length);
    cuts.addChunk(box);
    expect(relay.take(cuts.ringsLonLat(), () => true, false)).toHaveLength(1);
    expect(facesInBox(lay(cuts))).toBe(0);
  });
});

function isInRing(ring: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]];
    const isCrossing = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (isCrossing) inside = !inside;
  }
  return inside;
}

function isOnTriangle(pos: readonly number[], idx: readonly number[], x: number, z: number): boolean {
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    if (isInRing([pos[a], pos[a + 2], pos[b], pos[b + 2], pos[c], pos[c + 2]], x, z)) return true;
  }
  return false;
}

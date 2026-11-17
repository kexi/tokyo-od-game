import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PARAPET_HEIGHT, PARAPET_WIDTH } from "../src/expressway/assumptions";
import type { XwChunk, XwRunSummary } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { frameAt } from "../src/expressway/profile";
import { LocalFrame } from "../src/geo/frame";
import { createDeckBody, deckArraySteps, type GeoToLocal } from "../src/world/expresswayDeck";
import { DeckIndex } from "../src/world/expresswayMarkings";
import {
  chunkRings,
  DeckMerge,
  MERGE_FULL_DZ,
  MERGE_MAX_DZ,
  MERGE_SKIRT,
} from "../src/world/expresswayMerge";
import { isSlidingSeamStep, seamCases } from "../src/expressway/ledger";
import { sectionWidth } from "../src/world/laneChange";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import { framesOf, probeGenerated } from "../scripts/expresswaySeams";

// The 分離壁 between two same-direction decks that have let go of one surface (A1, 汐留,
// expresswayMerge.ts dividerOf): a main line P going east and a one-lane ramp Q ending on it, Q's
// centre d(x) metres to P's left and dz(x) above it. P's lanes' left edge is 3.0 m left of its
// centre, Q's lanes' right edge 1.875 m right of its own: the lanes' edges are g = d − 4.875 apart.

beforeAll(() => RAPIER.init());

const plane = planeAt(139.75, 35.65);
const N = 36.9;
const frame = new LocalFrame(35.65, 139.751, 40);
const place: GeoToLocal = { frame, ellipsoidal: (_lat, _lon, h) => h + N };
const PARAPET = PARAPET_WIDTH.value;
/** P's lanes' left edge and Q's lanes' right edge, from each centre. */
const P_LANE = 3.0;
const Q_LANE = 1.875;
const Z = 10;

const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));

function chunk(id: string, step: number, at: (x: number) => [number, number, number, number]): XwChunk {
  const st: number[] = [];
  for (let x = 0; x <= 200 + 1e-9; x += step) {
    const [px, py, z, g] = at(x);
    const [lon, lat] = plane.toLonLat(px, py);
    st.push(x, lon, lat, z, 0, 3, g);
  }
  const isRamp = id.startsWith("Q");
  return {
    id,
    run: id.split(":")[0],
    chain: id.split(":")[0],
    k: 0,
    cls: isRamp ? "ramp" : "expressway",
    ref: null,
    name: null,
    structure: "viaduct",
    over: null,
    lanes: isRamp ? 1 : 2,
    laneWidth: 3.25,
    shoulderL: isRamp ? 1 : 1.25,
    shoulderR: isRamp ? 0.5 : 0.75,
    basis: "assumption",
    V: 60,
    maxspeed: 50,
    vh: 50,
    gmax: 0.05,
    g0: at(0)[3],
    g1: at(200)[3],
    h0: 0,
    h1: 0,
    girder: 2.2,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [{ with: isRamp ? "P" : "Q", relation: "same", s0: 0, s1: 200 }],
    prev: null,
    next: null,
  };
}

/** P and Q as above, built one slab where they meet; the sides, rings and colliders of both. */
function pair(d: (x: number) => number, dz: (x: number) => number) {
  const slope = (f: (x: number) => number, x: number) => (f(x + 0.01) - f(x - 0.01)) / 0.02;
  const p = chunk("P:0", 10, (x) => [x, 0, Z, 0]);
  const q = chunk("Q:0", 5, (x) => [x, d(x), Z + dz(x), slope(dz, x)]);
  q.h0 = Math.atan(slope(d, 0));
  q.h1 = Math.atan(slope(d, 200));
  const summary = (id: string, cls: "expressway" | "ramp", start: object) =>
    ({ id, cls, start, end: { kind: "open" }, chunks: [`${id}:0`] }) as unknown as XwRunSummary;
  const runs = [
    summary("P", "expressway", { kind: "open" }),
    summary("Q", "ramp", { kind: "junction", parent: "P", parentS: 0 }),
  ];
  const index = new DeckIndex(new Map(runs.map((r) => [r.id, r])));
  index.add(p);
  index.add(q);
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  const build = (c: XwChunk) => {
    const steps = deckArraySteps(c, place, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    createDeckBody(world, r.value.collider, r.value.piers, null);
    return r.value;
  };
  const out = { P: build(p), Q: build(q) };
  world.step();
  return { ...out, world, d, dz };
}
type Pair = ReturnType<typeof pair>;

/** A local point at plane (x, y), height h (T.P.). */
const at = (x: number, y: number, h: number) => {
  const [lon, lat] = plane.toLonLat(x, y);
  return frame.toLocal(lat, lon, h + N);
};
/** The T.P. height of the first face below (x, y, from), or null. */
const downAt = (world: RAPIER.World, x: number, y: number, from: number) => {
  const p = at(x, y, from);
  const hit = world.castRay(new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }), 40, true);
  return hit ? from - hit.timeOfImpact : null;
};
/** The sides of a deck's ring nearest after s (the facing side: P's left, Q's right). */
const facing = (b: Pair["P"], s: number, side: "left" | "right") => {
  const i = b.rings.findIndex((r) => r.frame.s >= s);
  return b.sides[i][side];
};
/** Every ring side of both decks that faces the other, with its deck's lanes' edge there. */
const facingSides = (x: Pair) => [
  ...x.P.sides.map((sd, i) => ({ deck: "P", s: x.P.rings[i].frame.s, side: sd.left, lane: P_LANE })),
  ...x.Q.sides.map((sd, i) => ({ deck: "Q", s: x.Q.rings[i].frame.s, side: sd.right, lane: Q_LANE })),
];

/** Rays down every `du` across [y0, y1] at x: the faces' heights (null: none). */
const across = (world: RAPIER.World, x: number, y0: number, y1: number, du: number, from = Z + 4) => {
  const out: Array<{ y: number; h: number | null }> = [];
  for (let y = y0; y <= y1 + 1e-9; y += du) out.push({ y, h: downAt(world, x, y, from) });
  return out;
};

/** 9: inside both decks' lanes (0.05 m in from their edges) nothing solid stands 0.2–2.0 m over the road. */
function expectClearLanes(x: Pair, xs: number[]) {
  for (const px of xs) {
    const dx = x.d(px);
    for (const { y, h } of across(x.world, px, -3.45, P_LANE - 0.05, 0.25, Z + 2))
      expect(h, `P x ${px} y ${y.toFixed(2)}`).toBeCloseTo(Z, 1);
    const top = Z + x.dz(px);
    for (const { y, h } of across(x.world, px, dx - Q_LANE + 0.05, dx + 1.325, 0.25, top + 2))
      expect(Math.abs(h! - top), `Q x ${px} y ${y.toFixed(2)}`).toBeLessThan(0.03);
  }
}

/** 10: between the lanes' edges every 0.1 m a ray from above meets a road or the wall's top (no hole). */
function expectNoHole(x: Pair, xs: number[]) {
  for (const px of xs) {
    const low = Z + Math.min(0, x.dz(px));
    for (const { y, h } of across(x.world, px, P_LANE + 0.01, x.d(px) - Q_LANE - 0.01, 0.1))
      expect(h ?? -Infinity, `x ${px} y ${y.toFixed(2)}`).toBeGreaterThan(low - 0.03);
  }
}

/** 20: no 分離壁's face (nor a nose step's cut) stands inside either deck's lanes, at any ring. */
function expectFacesOffLanes(x: Pair) {
  for (const f of facingSides(x)) {
    if (f.side.clearTo === null) continue;
    expect(f.side.clearTo, `${f.deck} s ${f.s.toFixed(2)}`).toBeGreaterThanOrEqual(f.lane - 1e-6);
  }
}

const MID = [60.3, 100.7, 140.1];

describe("a 分離壁 between two same-direction decks a level apart (A1, expresswayMerge.ts dividerOf)", () => {
  it("1: stands one wall between the lanes where they are PARAPET or more apart, both its faces off both lanes", () => {
    const x = pair(
      () => 5.6,
      () => 0.5,
    );
    const q = facing(x.Q, 100, "right");
    const p = facing(x.P, 100, "left");
    expect(q.wall).not.toBeNull();
    expect(q.wall!.outer - q.wall!.inner).toBeCloseTo(PARAPET, 9);
    expect(q.wall!.inner).toBeGreaterThanOrEqual(Q_LANE - 1e-9);
    expect(5.6 - q.wall!.outer).toBeGreaterThanOrEqual(P_LANE - 1e-9);
    expect(p.wall).toBeNull();
    // Across at x 100.7: one stretch higher than Q's face (the wall's top), 0.5 m wide, between the lanes.
    const high = across(x.world, 100.7, 0.5, 5.1, 0.02).filter((r) => r.h !== null && r.h > Z + 0.5 + 0.5);
    const runs = high.filter((r, i) => i === 0 || r.y - high[i - 1].y > 0.03).length;
    expect(runs).toBe(1);
    expect(high[high.length - 1].y - high[0].y).toBeCloseTo(PARAPET, 1);
    expect(high[0].y).toBeGreaterThanOrEqual(P_LANE - 0.02);
    expect(high[high.length - 1].y).toBeLessThanOrEqual(5.6 - Q_LANE + 0.02);
    expectClearLanes(x, MID);
    expectNoHole(x, MID);
    expectFacesOffLanes(x);
  });

  it("2: makes the wall as wide as the gap where the lanes are DIVIDER_MIN to PARAPET apart, in neither lane", () => {
    const x = pair(
      () => 5.25,
      () => 0.5,
    );
    const q = facing(x.Q, 100, "right");
    // P's lanes' edge as Q reads it (the plan's 5.25 m is a little shorter on the ground).
    const other = Math.abs(q.otherLaneEdge!);
    expect(other - Q_LANE).toBeCloseTo(0.375, 1);
    expect(q.wall!.outer - q.wall!.inner).toBeCloseTo(other - Q_LANE, 6);
    expect(q.wall!.inner).toBeCloseTo(Q_LANE, 6);
    expect(q.wall!.outer).toBeCloseTo(other, 6);
    expectClearLanes(x, MID);
    expectNoHole(x, MID);
    expectFacesOffLanes(x);
  });

  it("15, 17–18: fills the gap between the lanes' edges with a wall where they are under DIVIDER_MIN apart: no hole, the lanes clear", () => {
    const x = pair(
      () => 5.0,
      () => 0.2,
    );
    const q = facing(x.Q, 100, "right");
    const p = facing(x.P, 100, "left");
    // The higher deck's wall from its lanes' edge to P's (as Q reads it), the lower deck none.
    expect(q.wall!.inner).toBeCloseTo(Q_LANE, 6);
    expect(q.wall!.outer).toBeCloseTo(Math.abs(q.otherLaneEdge!), 6);
    expect(q.wall!.outer - q.wall!.inner).toBeCloseTo(0.125, 1);
    expect(p.wall).toBeNull();
    // The lower road (P, the master: Q ends on it) runs on to its slab edge under the wall and Q's
    // slab, its lanes' edge clear.
    expect(p.reach).toBeCloseTo(4.75, 6);
    expect(p.clearTo).toBeCloseTo(P_LANE, 6);
    for (const px of MID) {
      const low = Z - 0.03;
      for (const r of across(x.world, px, P_LANE, 5.0 - Q_LANE, 0.05))
        expect(r.h ?? -Infinity, `x ${px} y ${r.y.toFixed(2)}`).toBeGreaterThan(low);
    }
    expectClearLanes(x, MID);
    expectFacesOffLanes(x);
  });

  it("16: makes that wall as high as the drop past MERGE_MAX_DZ, up to a 壁高欄 (0.16 → 0.01, 0.65 → 0.5, 1.25 and more → 1.1 m)", () => {
    for (const [dz, rise] of [
      [0.16, 0.01],
      [0.65, 0.5],
      [1.25, 1.1],
      [2.0, 1.1],
    ]) {
      const x = pair(
        () => 5.0,
        () => dz,
      );
      const q = facing(x.Q, 100, "right");
      expect(q.wall, `dz ${dz}`).not.toBeNull();
      // Within the slab's chords (1 cm); a full wall states no rise of its own (a 壁高欄's).
      expect(q.divider!.rise ?? PARAPET_HEIGHT.value, `dz ${dz}`).toBeCloseTo(rise, 1);
      expect(Math.abs((q.divider!.rise ?? PARAPET_HEIGHT.value) - rise), `dz ${dz}`).toBeLessThanOrEqual(
        0.011,
      );
      // Its top over Q's road, read by a ray from above in the middle of the gap.
      const top = downAt(x.world, 100.7, 5.0 - Q_LANE - 0.06, Z + dz + 3)!;
      expect(top - (Z + dz), `dz ${dz}`).toBeCloseTo(rise, 1);
    }
  });

  it("17, 19: makes a plate where the lanes' edges touch (g = 0): a ray meets it from both decks, and the roads either side of the line", () => {
    // 4.8876 m in the plan is the two lanes' edges touching on the ground (planeAt's scale is 0.2 % off).
    const x = pair(
      () => 4.8876,
      () => 2.0,
    );
    const q = facing(x.Q, 100, "right");
    expect(q.wall!.outer - q.wall!.inner).toBeLessThan(0.01);
    expect(q.wall!.outer - q.wall!.inner).toBeGreaterThanOrEqual(0);
    const plate = 4.8876 - Q_LANE;
    for (const px of MID) {
      // From Q's lane 0.5 m over its road towards P, and from P's lane 0.5 m over its road towards Q.
      for (const [fromY, h, dir] of [
        [plate + 1.0, Z + 2.0 + 0.5, -1],
        [plate - 1.0, Z + 0.5, 1],
      ]) {
        const o = at(px, fromY, h);
        const t = at(px, fromY + dir, h).sub(o);
        const hit = x.world.castRay(new RAPIER.Ray(o, t), 3, true);
        expect(hit, `x ${px} from ${fromY.toFixed(2)}`).not.toBeNull();
        expect(fromY + dir * hit!.timeOfImpact, `x ${px}`).toBeCloseTo(plate, 1);
      }
      // 1 cm either side of the line: Q's road above, P's below.
      expect(downAt(x.world, px, plate + 0.03, Z + 6)).toBeCloseTo(Z + 2.0, 1);
      expect(downAt(x.world, px, plate - 0.03, Z + 1)).toBeCloseTo(Z, 1);
    }
    expectClearLanes(x, MID);
    expectFacesOffLanes(x);
  });

  it("4: leaves the sides as before A1 where the lanes overlap (g < 0, a 合流's wedge)", () => {
    const x = pair(
      () => 4.7,
      () => 0.5,
    );
    // As before: the ramp keeps its own 壁高欄 at its place; the main line lets go (letGo): no wall,
    // its road out to its slab edge.
    const q = facing(x.Q, 100, "right");
    const p = facing(x.P, 100, "left");
    expect([q.reach, q.wall, q.clearTo, q.divider]).toEqual([
      2.375,
      { inner: 2.375, outer: 2.875 },
      null,
      null,
    ]);
    expect([p.reach, p.wall, p.clearTo, p.divider]).toEqual([4.75, null, null, null]);
  });

  it("5: leaves each deck's own wall at its place where the slabs overlap by less than PARAPET", () => {
    const x = pair(
      () => 7.3,
      () => 0.5,
    );
    expect(facing(x.Q, 100, "right").wall).toEqual({ inner: 2.375, outer: 2.875 });
    expect(facing(x.P, 100, "left").wall).toEqual({ inner: 4.25, outer: 4.75 });
    expect(facingSides(x).every((f) => f.side.clearTo === null)).toBe(true);
  });

  it("6: makes one slab as before where the pair is within MERGE_MAX_DZ: no 分離壁, the ramp cut on the main line's edge", () => {
    const x = pair(
      () => 5.6,
      () => 0.03,
    );
    expect(facingSides(x).every((f) => f.side.clearTo === null && f.side.divider === null)).toBe(true);
    expect(facing(x.Q, 100, "right").seam).not.toBeNull();
    expect(facing(x.P, 100, "left").wall).toBeNull();
  });

  it("7–8: stands the wall on the higher deck, its outer face down past the lower face, nothing of that deck past it", () => {
    for (const dz of [0.5, -0.5]) {
      const x = pair(
        () => 5.6,
        () => dz,
      );
      const isQUp = dz > 0;
      const up = isQUp ? facing(x.Q, 100, "right") : facing(x.P, 100, "left");
      const down = isQUp ? facing(x.P, 100, "left") : facing(x.Q, 100, "right");
      expect(up.wall, `dz ${dz}`).not.toBeNull();
      expect(down.wall, `dz ${dz}`).toBeNull();
      // The outer face's plan position (y), from P's centre.
      const outerY = isQUp ? 5.6 - up.wall!.outer : up.wall!.outer;
      // 7: a level ray 5 cm over the lower road, from its lanes towards the other deck, meets the wall's face.
      const lowY = Z + Math.min(0, dz) + 0.05;
      const fromY = isQUp ? 2.0 : 5.6 - 1.0;
      const dir = isQUp ? 1 : -1;
      for (const px of MID) {
        const o = at(px, fromY, lowY);
        const t = at(px, fromY + dir, lowY).sub(o);
        const hit = x.world.castRay(new RAPIER.Ray(o, t), 10, true);
        expect(hit, `dz ${dz} x ${px}`).not.toBeNull();
        expect(fromY + dir * hit!.timeOfImpact, `dz ${dz} x ${px}`).toBeCloseTo(outerY, 1);
      }
      // 8: the higher deck's road, slab and girder lie on its own side of the wall's outer face.
      const pos = (isQUp ? x.Q : x.P).arrays.position;
      for (let i = 0; i < pos.length; i += 3) {
        // Past both ends the other deck's line ends (no partner there): its own section.
        const [px, y] = xyOf(pos[i], pos[i + 2]);
        const isInside = px > 10 && px < 190;
        if (!isInside) continue;
        // 2 cm: the plan's metres are 0.2 % off the ground's (planeAt's sphere).
        const isPast = isQUp ? y < outerY - 0.02 : y > outerY + 0.02;
        expect(isPast, `dz ${dz} vertex y ${y.toFixed(3)}`).toBe(false);
      }
    }
  });

  it("19: stops a car body thrown at the plate at 108 km/h (continuous collision, as the game's chassis)", () => {
    const x = pair(
      () => 4.8876,
      () => 2.0,
    );
    const plate = 4.8876 - Q_LANE;
    x.world.gravity = { x: 0, y: -9.81, z: 0 };
    for (const px of [80.3, 120.7]) {
      // A car's box (vehicle.ts HALF, 1.8 × 1.4 × 4.5 m) on Q's road, 1.5 m from the plate, flung sideways.
      const at0 = at(px, plate + 1.5, Z + 2.0 + 0.75);
      const body = x.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(at0.x, at0.y, at0.z).setCcdEnabled(true),
      );
      // Its length along travel (east, the local x), its width across towards the plate.
      x.world.createCollider(RAPIER.ColliderDesc.cuboid(2.25, 0.7, 0.9).setDensity(150), body);
      const toward = at(px, plate, Z)
        .sub(at(px, plate + 1, Z))
        .normalize();
      body.setLinvel({ x: toward.x * 30, y: 0, z: toward.z * 30 }, true);
      let deepest = Infinity;
      for (let i = 0; i < 90; i++) {
        x.world.step();
        const t = body.translation();
        deepest = Math.min(deepest, xyOf(t.x, t.z)[1]);
      }
      // It reached the plate (its side against it) and its centre never got past by more than its half
      // width, still on Q's road (it did not fall through the deck instead).
      expect(deepest, `x ${px}`).toBeLessThan(plate + 0.9 + 0.1);
      expect(deepest, `x ${px}`).toBeGreaterThan(plate + 0.9 - 0.05);
      expect(body.translation().y, `x ${px}`).toBeGreaterThan(at0.y - 1);
      x.world.removeRigidBody(body);
    }
  });

  it("keeps the 分離壁 on a side where another partner lets go with its lanes over this deck's (three decks: P over Q with a wall, P over S with a wedge)", () => {
    // Q 0.5 m under P, its lanes 0.725 m off P's (a wall on P); S 0.8 m under P, its lanes over P's
    // (g < 0: P lets go of it, which once took P's wall away too: ship 44804029:4 s 511–617).
    const slope = (f: (x: number) => number, x: number) => (f(x + 0.01) - f(x - 0.01)) / 0.02;
    const p = chunk("P:0", 10, (x) => [x, 0, Z, 0]);
    const q = chunk("Q:0", 5, () => [0, 0, 0, 0]);
    const mk = (id: string, d: number, dz: number) => {
      const c = chunk(id, 5, (x) => [x, d, Z + dz, slope(() => dz, x)]);
      Object.assign(c, { cls: "ramp", lanes: 1, shoulderL: 1, shoulderR: 0.5 });
      c.decks = [{ with: "P", relation: "same", s0: 0, s1: 200 }];
      return c;
    };
    void q;
    const qq = mk("Q:0", 5.6, -0.5);
    const ss = mk("S:0", 4.6, -0.8);
    p.decks = [
      { with: "Q", relation: "same", s0: 0, s1: 200 },
      { with: "S", relation: "same", s0: 0, s1: 200 },
    ];
    const summary = (id: string, cls: "expressway" | "ramp", start: object) =>
      ({ id, cls, start, end: { kind: "open" }, chunks: [`${id}:0`] }) as unknown as XwRunSummary;
    const runs = [
      summary("P", "expressway", { kind: "open" }),
      summary("Q", "ramp", { kind: "junction", parent: "P", parentS: 0 }),
      summary("S", "ramp", { kind: "junction", parent: "P", parentS: 0 }),
    ];
    const index = new DeckIndex(new Map(runs.map((r) => [r.id, r])));
    for (const c of [p, qq, ss]) index.add(c);
    const steps = deckArraySteps(p, place, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    const i = r.value.rings.findIndex((x) => x.frame.s >= 100);
    const left = r.value.sides[i].left;
    expect(left.wall).not.toBeNull();
    expect(left.divider).not.toBeNull();
    expect(left.wall!.inner).toBeGreaterThanOrEqual(P_LANE - 1e-6);
  });

  it("draws one face in the plane of the wall's outer face: the slab's bottom runs up behind it (no second face over it, the dark wedge of round 1)", () => {
    const x = pair(
      () => 5.6,
      () => 3.0,
    );
    const q = facing(x.Q, 100, "right");
    const outerY = 5.6 - q.wall!.outer;
    const P = x.Q.arrays.position;
    let area = 0;
    for (let i = 0; i < P.length; i += 9) {
      const vs = [0, 3, 6].map((k) => new Vector3(P[i + k], P[i + k + 1], P[i + k + 2]));
      const xy = vs.map((v) => xyOf(v.x, v.z));
      const isInPlane = xy.every(([px, py]) => px > 60 && px < 140 && Math.abs(py - outerY) < 0.02);
      if (!isInPlane) continue;
      area += vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).length() / 2;
    }
    // The face from the wall's top (1.1 m over Q's road) to MERGE_SKIRT under P's (3 m lower), once.
    const expected = (140 - 60) * (PARAPET_HEIGHT.value + 3.0 + MERGE_SKIRT);
    expect(area / expected).toBeGreaterThan(0.85);
    expect(area / expected).toBeLessThan(1.15);
  });

  it("stands no 分離壁 on a side one slab with a deck joined beside it: P keeps its road out to its edge under C's seam, D below (a1-answer5 2, test 1)", () => {
    const x = threeDecks(-5);
    const inside = x.P.sides.filter((_, i) => x.P.rings[i].frame.s > 20 && x.P.rings[i].frame.s < 180);
    expect(inside.every((sd) => sd.left.clearTo === null && sd.left.divider === null)).toBe(true);
    expect(inside.every((sd) => sd.left.reach >= 4.75 - 1e-6)).toBe(true);
    // Under C's seam (on P's edge) P's face: rays just inside and outside the edge meet a face at Z.
    for (const px of MID)
      for (const y of [4.7, 4.74, 4.76, 4.8])
        expect(downAt(x.world, px, y, Z + 1), `x ${px} y ${y}`).toBeCloseTo(Z, 1);
  });

  it("lets the deck above not drop a 分離壁 to P's lanes where P's side is one slab with C (test 2)", () => {
    const x = threeDecks(5);
    const inside = x.D.sides.filter((_, i) => x.D.rings[i].frame.s > 20 && x.D.rings[i].frame.s < 180);
    expect(inside.every((sd) => sd.right.divider === null)).toBe(true);
    // Between P's lanes and C nothing solid stands over the road (0.2–2 m).
    for (const px of MID)
      for (const y of [3.05, 3.3, 3.6, 4.0])
        expect(downAt(x.world, px, y, Z + 2), `x ${px} y ${y}`).toBeCloseTo(Z, 1);
  });

  it("stands the 分離壁 again where C ends: past it P's side is a 縁, with no hole at the change (test 3)", () => {
    const x = threeDecks(-5, 100);
    const after = x.P.sides.filter((_, i) => x.P.rings[i].frame.s > 130 && x.P.rings[i].frame.s < 190);
    expect(after.length).toBeGreaterThan(2);
    expect(after.every((sd) => sd.left.clearTo !== null && sd.left.wall !== null)).toBe(true);
    for (let px = 95; px <= 135; px += 0.7)
      for (const y of [1, 2, 2.9])
        expect(downAt(x.world, px, y, Z + 2), `x ${px.toFixed(1)} y ${y}`).toBeCloseTo(Z, 1);
  });

  it("counts no drop with no wall where a deck one slab with P lies past P's edge (test 5)", () => {
    const frames = [{ lat: 35.65, lon: 139.751 }];
    const three = threeDecks(-5);
    const withC = probeGenerated(three.chunks, three.runs as never, frames);
    worlds.push(...withC.worlds);
    // Inside the decks: before their first station (the padded stretch reaches past it) nothing is built.
    expect(withC.bare.filter((b) => b.s > 5 && b.s < 195)).toEqual([]);
  });

  it("keeps the seam on the master's face where the ramp comes out of a 分離壁 and crosses the master's height a few metres on (28188173:1's shape): no seam_step", () => {
    // Q 0.5 m over P with a 分離壁 to x 60, then coming down 3 cm per metre: one slab from x 71.7,
    // through P's height at x 76.7, apart again (below) past x 81.7.
    const frames = [{ lat: 35.65, lon: 139.751 }];
    const runs = [
      { id: "P", cls: "expressway", start: { kind: "open" }, end: { kind: "open" }, chunks: ["P:0"] },
      {
        id: "Q",
        cls: "ramp",
        start: { kind: "junction", parent: "P", parentS: 0 },
        end: { kind: "open" },
        chunks: ["Q:0"],
      },
    ];
    const chunks = [
      chunk("P:0", 10, (px) => [px, 0, Z, 0]),
      (() => {
        const q = chunk("Q:0", 5, (px) => {
          const dz = px < 60 ? 0.5 : 0.5 - 0.03 * (px - 60);
          return [px, 5.6, Z + dz, px < 60 ? 0 : -0.03];
        });
        return q;
      })(),
    ];
    const out = probeGenerated(chunks, runs as never, frames);
    worlds.push(...out.worlds);
    const steps = seamCases(out.seams, out.cuts, [], { fullDz: MERGE_FULL_DZ, maxDz: MERGE_MAX_DZ }).filter(
      (c) => c.kind === "seam_step" && !isSlidingSeamStep(c.measured),
    );
    expect(out.seams.length).toBeGreaterThan(10);
    expect(steps.map((c) => `${c.key} ${JSON.stringify(c.measured)}`)).toEqual([]);
  });

  it("11: moves the wall's centre less than PARAPET / 2 between neighbouring rings, from the let-go point on", () => {
    // Q climbs off P's face from x 40 (lets go at x 46) while drifting out (g 0.43 → 1.2 m).
    const x = pair(
      (px) => 5.3 + 0.004 * px,
      (px) => (px < 40 ? 0.03 : 0.03 + 0.02 * (px - 40)),
    );
    const centres = x.Q.sides.flatMap((sd) =>
      sd.right.wall && sd.right.divider ? [(sd.right.wall.inner + sd.right.wall.outer) / 2] : [],
    );
    expect(centres.length).toBeGreaterThan(20);
    for (let i = 1; i < centres.length; i++)
      expect(Math.abs(centres[i] - centres[i - 1])).toBeLessThanOrEqual(PARAPET / 2);
    expectFacesOffLanes(x);
  });

  it("20: keeps the wall under 2 cm in a window of a 0.16 m drop between two stretches of one slab (45021972:3's shape)", () => {
    const x = pair(
      () => 5.0,
      (px) => 0.03 + 0.13 * dropWindow(px),
    );
    const rises = x.Q.sides.flatMap((sd) =>
      sd.right.divider ? [sd.right.divider.rise ?? PARAPET_HEIGHT.value] : [],
    );
    expect(rises.length).toBeGreaterThan(3);
    expect(Math.max(...rises)).toBeLessThanOrEqual(0.02);
    expect(x.Q.steps.length).toBe(1);
    expect(x.Q.steps[0].s0).toBeGreaterThan(75);
    expect(x.Q.steps[0].s1).toBeLessThan(125);
    expect(x.Q.walls).toEqual([]);
  });

  it("21: keeps the wall's width and place where g crosses DIVIDER_MIN, and closes the full wall's end where it gets lower", () => {
    // g 0.725 → 0 over x 0 → 145 (the plan's metres; on the ground near x 93 it crosses 0.25 m): the
    // full wall goes on as a 0.35 m one there (the drop 0.5 m).
    const x = pair(
      (px) => 5.6 - 0.005 * px,
      () => 0.5,
    );
    expect(x.Q.walls.length).toBe(1);
    const end = x.Q.walls[0].s1;
    expect(end).toBeGreaterThan(90);
    expect(end).toBeLessThan(96);
    expect(Math.abs(x.Q.steps[0].s0 - end)).toBeLessThan(0.01);
    // Both walls from Q's lanes' edge, 0.25 m wide, either side of the place.
    const before = x.Q.sides.filter(
      (_, i) => Math.abs(x.Q.rings[i].frame.s - end) < 1 && x.Q.rings[i].frame.s < end,
    );
    const after = x.Q.sides.filter(
      // Past the two rings at the place (the last full sample is a bisection's, just short of them).
      (_, i) => Math.abs(x.Q.rings[i].frame.s - end) < 1 && x.Q.rings[i].frame.s > end + 0.01,
    );
    for (const sd of [...before, ...after]) {
      expect(sd.right.wall!.inner).toBeCloseTo(Q_LANE, 6);
      expect(sd.right.wall!.outer - sd.right.wall!.inner).toBeCloseTo(0.25, 1);
    }
    expect(after.map((sd) => sd.right.divider?.rise?.toFixed(3) ?? "full")).toEqual(after.map(() => "0.350"));
    // Into the full wall's end from 2 m past it, over the low wall (0.7 m over Q's road), across its 0.25 m.
    const top = Z + 0.5 + 0.7;
    const d = x.d(end);
    for (const y of [d - Q_LANE - 0.05, d - Q_LANE - 0.125, d - Q_LANE - 0.2]) {
      const o = at(end + 2, y, top);
      const t = at(end + 1, y, top).sub(o);
      const hit = x.world.castRay(new RAPIER.Ray(o, t), 10, true);
      expect(hit, `y ${y}`).not.toBeNull();
      expect(Math.abs(end + 2 - hit!.timeOfImpact - end), `y ${y}`).toBeLessThan(0.1);
    }
  });

  it("puts two rings at one place where the lower deck comes to stand by the wall (the let-go point), so its road leaves no slit", () => {
    const x = pair(
      () => 5.6,
      (px) => (px < 40 ? 0.03 : 0.03 + 0.02 * (px - 40)),
    );
    const flips = x.P.rings.flatMap((r, i) => {
      const next = x.P.rings[i + 1];
      const isPair = next !== undefined && next === r;
      return isPair && x.P.sides[i].left.clearTo === null && x.P.sides[i + 1].left.clearTo !== null
        ? [r.frame.s]
        : [];
    });
    expect(flips.length).toBe(1);
    expect(flips[0]).toBeGreaterThan(44);
    expect(flips[0]).toBeLessThan(48);
    for (let px = flips[0] - 1; px <= flips[0] + 1; px += 0.05)
      for (const { y, h } of across(x.world, px, P_LANE, 4.75, 0.05))
        expect(h ?? -Infinity, `x ${px.toFixed(2)} y ${y.toFixed(2)}`).toBeGreaterThan(Z - 0.03);
  });

  it("lets the master stand by the wall only where the deck cut at its edge has let go too: its lanes stay clear (汐留 s 4951's shape)", () => {
    // Q climbs off P's face from x 40 while closing in on it: P reads |Δz| at Q's point 0.3 m on (its
    // foot), so P lets go of the pair before Q; P keeps one slab with Q there, its lanes clear. (The
    // generated data's 汐留, test 13, is where drawing P's road back on its own word put Q's road over
    // P's lane 0; this net does not reach that shape, it guards the order of the two let-go points.)
    const x = pair(
      (px) => 7.5 - 0.05 * px,
      (px) => (px < 40 ? 0.03 : 0.03 + 0.02 * (px - 40)),
    );
    for (let px = 44; px <= 48; px += 0.02)
      for (const u of [P_LANE - 0.05, P_LANE - 0.5, P_LANE - 1.0]) {
        const h = downAt(x.world, px, u, Z + 2);
        expect(h, `x ${px.toFixed(2)} u ${u}`).not.toBeNull();
        expect(Math.abs(h! - Z), `x ${px.toFixed(2)} u ${u}`).toBeLessThan(0.03);
      }
  });
});

/** 0 → 1 over x 75–80, 1 → 0 over 120–125 (smoothstep): a window of a drop with one slab either side. */
function dropWindow(px: number): number {
  const up = Math.min(1, Math.max(0, (px - 75) / 5));
  const down = Math.min(1, Math.max(0, (125 - px) / 5));
  const t = Math.min(up, down);
  return t * t * (3 - 2 * t);
}

/**
 * Three decks (a1-answer5 2): P (main line) going east; C a one-lane ramp ending on P, one slab with
 * it (at its height), d 4.0 m to its left over x [0, cEnd]; D a one-lane ramp ending on P, 5 m off
 * P's height (dzD), its lanes' right edge 0.3 m outside P's lanes' left edge (d 5.175 m).
 */
function threeDecks(dzD: number, cEnd = 200) {
  const p = chunk("P:0", 10, (x) => [x, 0, Z, 0]);
  const ramp = (id: string, d: number, dz: number, end: number) => {
    const c = chunk(id, 5, (x) => [x, d, Z + dz, 0]);
    const keep = c.st.filter((_, i) => c.st[i - (i % 7)] <= end + 1e-9);
    Object.assign(c, { cls: "ramp", lanes: 1, shoulderL: 1, shoulderR: 0.5, st: keep });
    c.decks = [{ with: "P", relation: "same", s0: 0, s1: end }];
    return c;
  };
  const c = ramp("C:0", 4.0, 0.0, cEnd);
  const dd = ramp("D:0", 5.175, dzD, 200);
  dd.decks = [
    { with: "P", relation: "same", s0: 0, s1: 200 },
    { with: "C", relation: dzD > 0 ? "above" : "below", s0: 0, s1: cEnd },
  ];
  c.decks = [...c.decks, { with: "D", relation: dzD > 0 ? "below" : "above", s0: 0, s1: cEnd }];
  p.decks = [
    { with: "C", relation: "same", s0: 0, s1: cEnd },
    { with: "D", relation: "same", s0: 0, s1: 200 },
  ];
  const summary = (id: string, cls: "expressway" | "ramp", start: object) =>
    ({ id, cls, start, end: { kind: "open" }, chunks: [`${id}:0`] }) as unknown as XwRunSummary;
  const runs = [
    summary("P", "expressway", { kind: "open" }),
    summary("C", "ramp", { kind: "junction", parent: "P", parentS: 0 }),
    summary("D", "ramp", { kind: "junction", parent: "P", parentS: 0 }),
  ];
  const index = new DeckIndex(new Map(runs.map((r) => [r.id, r])));
  for (const x of [p, c, dd]) index.add(x);
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  const build = (x: XwChunk) => {
    const steps = deckArraySteps(x, place, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    createDeckBody(world, r.value.collider, r.value.piers, null);
    return r.value;
  };
  const out = { P: build(p), C: build(c), D: build(dd) };
  world.step();
  return { ...out, world, chunks: [p, c, dd], runs };
}

/** Plan (x, y) (east, north, m) of a local point near the frame's origin. */
function xyOf(lx: number, lz: number): [number, number] {
  const g = frame.toGeodetic(new Vector3(lx, 0, lz));
  return plane.toXY(g.lon, g.lat);
}

describe("the generated data's 分離壁 (A1)", () => {
  const g = readExpresswayFiles();
  let probed: ReturnType<typeof probeGenerated>;
  beforeAll(() => {
    probed = probeGenerated(g.chunks, g.runs, framesOf(g.tiles, g.meta.zoom));
    worlds.push(...probed.worlds.splice(0));
  }, 120_000);
  /** The three pairs A1 was measured on (the plan's 8.6 list): a 分離壁's cases outside them are not foreseen. */
  const PAIRS = ["24402125|24402611", "45019020|45554540", "45021972|4848762"];
  const pairOf = (chunk: string, other: string) =>
    [chunk.slice(0, chunk.lastIndexOf(":")), other].toSorted().join("|");

  it("14: has its thin walls and nose steps on the three pairs foreseen only, as the ledger lists them", () => {
    const thin = probed.dividers.flatMap((d) => d.thin.map(() => pairOf(d.chunk, d.with)));
    const steps = probed.steps.map((s) => pairOf(s.chunk, s.with));
    const sortedPairs = PAIRS.map((p) => p.split("|").toSorted().join("|"));
    for (const p of [...thin, ...steps]) expect(sortedPairs, p).toContain(p);
    const ledger = g.ledger!.cases.filter((c) => c.status !== "gone");
    expect(ledger.filter((c) => c.kind === "thin-divider").length).toBe(thin.length);
    expect(ledger.filter((c) => c.kind === "nose-step").length).toBe(steps.length);
  });

  it("22: leaves no drop without a wall: wherever a pair has let go with its lanes apart, a ray from the higher lanes meets a wall half its due height (min(|Δz| − MERGE_MAX_DZ, PARAPET_HEIGHT))", () => {
    expect(probed.bare.map((b) => `${b.chunk}|${b.with} s ${b.s.toFixed(1)} dz ${b.dzM.toFixed(2)}`)).toEqual(
      [],
    );
  });

  it("12–13, 20: keeps every 分離壁 and nose step off the lanes, and the lanes clear and the gap covered (内回り lane 0 at 汐留 included)", () => {
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const frames = framesOf(g.tiles, g.meta.zoom);
    const bad: string[] = [];
    let checked = 0;
    // The decks of every stretch with a 分離壁 or a step, in a world of their own frame.
    const places = [...probed.dividers, ...probed.steps].map((x) => x.chunk);
    for (const id of new Set(places)) {
      const c = g.chunks.find((x) => x.id === id)!;
      const m = Math.floor(c.st.length / 14) * 7;
      const near = frames.reduce((best, a) =>
        Math.hypot(c.st[m + 1] - a.lon, c.st[m + 2] - a.lat) <
        Math.hypot(c.st[m + 1] - best.lon, c.st[m + 2] - best.lat)
          ? a
          : best,
      );
      const f = new LocalFrame(near.lat, near.lon, 40);
      const pl: GeoToLocal = { frame: f, ellipsoidal: (_a, _b, h) => h + N };
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      worlds.push(world);
      const builtOwn: Array<ReturnType<typeof buildIn>> = [];
      for (const x of g.chunks.filter((x) => isWithin(x, c.st[m + 1], c.st[m + 2], 800))) {
        const b = buildIn(x, pl, index);
        createDeckBody(world, b.collider, b.piers, null);
        if (x.id === id) builtOwn.push(b);
      }
      world.step();
      const b = builtOwn[0];
      const laneL = sectionWidth(c) / 2 - c.shoulderL;
      const laneR = sectionWidth(c) / 2 - c.shoulderR;
      b.rings.forEach((r, i) => {
        for (const sign of [1, -1] as const) {
          const side = sign > 0 ? b.sides[i].left : b.sides[i].right;
          if (side.clearTo === null) continue;
          const lane = sign > 0 ? laneL : laneR;
          const other = Math.abs(side.otherLaneEdge!);
          const where = `${id} s ${r.frame.s.toFixed(2)}`;
          // 20: this deck's face (wall or cut) off its own lanes; a wall's other face off the other's.
          if (side.clearTo < lane - 1e-6) bad.push(`${where} face ${side.clearTo.toFixed(3)} < lane ${lane}`);
          if (side.wall && side.wall.outer > other + 1e-6)
            bad.push(`${where} outer ${side.wall.outer.toFixed(3)} > ${other.toFixed(3)}`);
          // The rays go halfway to the next ring where it stands by the wall too (at a ring itself a ray
          // may run down the seam between two triangles; where a wall starts it runs down its end).
          const next = b.rings[i + 1];
          const nextSide = next === undefined ? null : sign > 0 ? b.sides[i + 1].left : b.sides[i + 1].right;
          const isInterval = next !== undefined && nextSide!.clearTo !== null && next.c.distanceTo(r.c) > 0.1;
          if (!isInterval) continue;
          const c = r.c.clone().lerp(next.c, 0.5);
          const t = r.t.clone().lerp(next.t, 0.5).normalize();
          // 9 on this deck: 0.05–1.0 m inside its lanes a ray from 2 m over the road meets the road.
          const pt = (u: number, v: number) =>
            new Vector3(c.x + t.z * u * sign, c.y + v, c.z - t.x * u * sign);
          for (const u of [lane - 0.05, lane - 0.5, lane - 1.0]) {
            const o = pt(u, 2);
            const hit = world.castRay(new RAPIER.Ray(o, { x: 0, y: -1, z: 0 }), 5, true);
            const isRoad = hit !== null && Math.abs(2 - hit.timeOfImpact) < 0.03;
            if (!isRoad)
              bad.push(
                `${where} lane ${u.toFixed(2)} hit ${hit ? (2 - hit.timeOfImpact).toFixed(2) : "none"}`,
              );
          }
          // 10: between the lanes' edges every 0.1 m a ray meets a face no lower than both roads.
          // No lower than the lower road: this one, or (on the higher deck) its riser's drop less the skirt.
          const drop = Math.max(side.divider?.drop ?? 0, nextSide!.divider?.drop ?? 0);
          const low = Math.min(0, -drop + MERGE_SKIRT);
          for (let u = lane + 0.02; u <= other - 0.02; u += 0.1) {
            const o = pt(u, 6);
            const hit = world.castRay(new RAPIER.Ray(o, { x: 0, y: -1, z: 0 }), 20, true);
            const isCovered = hit !== null && 6 - hit.timeOfImpact > low - 0.03;
            if (!isCovered)
              bad.push(
                `${where} gap ${u.toFixed(2)} hit ${hit ? (6 - hit.timeOfImpact).toFixed(3) : "none"} low ${low.toFixed(3)}`,
              );
          }
          checked++;
        }
      });
    }
    expect(bad.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  }, 240_000);

  it("gives the same side at depth 1 (what the deck cut at a master's edge reads) as at depth 0 (what the master builds), on every ring with a 分離壁", () => {
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const ids = new Set([...probed.dividers, ...probed.steps].flatMap((x) => [x.chunk]));
    const frames = framesOf(g.tiles, g.meta.zoom);
    const bad: string[] = [];
    let checked = 0;
    for (const id of ids) {
      const c = g.chunks.find((x) => x.id === id)!;
      const partners = g.chunks.filter((x) => c.decks.some((d) => d.with === x.run && d.relation === "same"));
      for (const own of [c, ...partners]) {
        const m = Math.floor(own.st.length / 14) * 7;
        const near = frames.reduce((best, a) =>
          Math.hypot(own.st[m + 1] - a.lon, own.st[m + 2] - a.lat) <
          Math.hypot(own.st[m + 1] - best.lon, own.st[m + 2] - best.lat)
            ? a
            : best,
        );
        const pl: GeoToLocal = {
          frame: new LocalFrame(near.lat, near.lon, 40),
          ellipsoidal: (_a, _b, h) => h + N,
        };
        const merge = new DeckMerge(index, pl, false);
        const rings = chunkRings(own, pl, false);
        for (const ring of rings.rings) {
          const s0 = merge.sides(rings, ring, 0);
          const s1 = merge.sides(rings, ring, 1);
          for (const key of ["left", "right"] as const) {
            const isDivided = s0[key].clearTo !== null || s1[key].clearTo !== null;
            if (!isDivided) continue;
            const pick = (x: (typeof s0)["left"]) => [
              x.reach.toFixed(4),
              JSON.stringify(x.wall),
              x.clearTo?.toFixed(4) ?? null,
            ];
            const isSame = JSON.stringify(pick(s0[key])) === JSON.stringify(pick(s1[key]));
            if (!isSame)
              bad.push(
                `${own.id} s ${ring.frame.s.toFixed(2)} ${key} ${JSON.stringify(pick(s0[key]))} vs ${JSON.stringify(pick(s1[key]))}`,
              );
            checked++;
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  }, 120_000);

  it("never asks sides() deeper than 2 (a master asks the deck cut at its edge, which asks no one)", () => {
    const spy = vi.spyOn(DeckMerge.prototype, "sides");
    try {
      const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
      for (const c of g.chunks) index.add(c);
      for (const id of new Set([...probed.dividers, ...probed.steps].map((x) => x.chunk))) {
        const c = g.chunks.find((x) => x.id === id)!;
        const fr = frameAt(c.st, c.st[0]);
        buildIn(c, { frame: new LocalFrame(fr.lat, fr.lon, 40), ellipsoidal: (_a, _b, h) => h + N }, index);
      }
      pair(
        () => 5.6,
        (px) => (px < 40 ? 0.03 : 0.03 + 0.02 * (px - 40)),
      );
      const depths = spy.mock.calls.map((call) => (call[2] as number | undefined) ?? 0);
      expect(depths.length).toBeGreaterThan(100);
      expect(Math.max(...depths)).toBe(2);
    } finally {
      spy.mockRestore();
    }
  }, 120_000);

  it("closes every 分離壁's end where it jogs across (divider-jog): a ray along travel through the band the higher deck's rail moves meets its end face", () => {
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const bad: string[] = [];
    let checked = 0;
    // The higher deck's jogs past PARAPET / 2 (the ledger's divider-jog). Why not the lower deck's
    // too: below the higher slab the 分離壁 is one sheet (its outer face) hanging into the room under
    // the higher deck; behind it there is nothing to close, as under main's two-level stretches.
    const jogs = probed.jogs.filter((j) => j.isUpper && j.jogM > PARAPET / 2);
    expect(jogs.length).toBe(3);
    for (const j of jogs) {
      const c = g.chunks.find((x) => x.id === j.chunk)!;
      const fr = frameAt(c.st, j.s);
      const f = new LocalFrame(fr.lat, fr.lon, 40);
      const pl: GeoToLocal = { frame: f, ellipsoidal: (_a, _b, h) => h + N };
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      worlds.push(world);
      for (const x of g.chunks.filter((x) => isWithin(x, fr.lon, fr.lat, 300))) {
        const b = buildIn(x, pl, index);
        createDeckBody(world, b.collider, b.piers, null);
      }
      world.step();
      // From 1.5 m on the plain side of the place (before a start, past an end), straight along the
      // deck's direction there towards it (past a run's end the next run carries on: not this chunk's
      // stations).
      const dir = j.end === "start" ? 1 : -1;
      const clamp = (x: number) => Math.max(c.st[0], Math.min(c.st[c.st.length - 7], x));
      const a0 = frameAt(c.st, clamp(j.s - 0.25));
      const a1 = frameAt(c.st, clamp(j.s + 0.25));
      const fwd = f
        .toLocal(a1.lat, a1.lon, a1.z + N)
        .sub(f.toLocal(a0.lat, a0.lon, a0.z + N))
        .setY(0)
        .normalize();
      const here = frameAt(c.st, clamp(j.s));
      const p = f.toLocal(here.lat, here.lon, here.z + N).addScaledVector(fwd, -dir * 1.5);
      const t = fwd.clone().multiplyScalar(dir);
      // The band the rail's face moves through.
      const lo = Math.min(j.fromU, j.toU) + 0.05;
      const hi = Math.max(j.fromU, j.toU) - 0.05;
      for (const h of [0.5])
        for (let u = lo; u <= hi + 1e-9; u += 0.1) {
          // Left of travel from the forward direction (a ray back along travel points the other way).
          const o = new Vector3(p.x + t.z * dir * u * j.side, p.y + h, p.z - t.x * dir * u * j.side);
          const hit = world.castRay(new RAPIER.Ray(o, t), 3, true);
          const isClosed = hit !== null && Math.abs(hit.timeOfImpact - 1.5) < 0.3;
          if (!isClosed)
            bad.push(
              `${j.chunk}|${j.with} ${j.end} s ${j.s.toFixed(1)} u ${u.toFixed(2)} h ${h}: ${hit ? hit.timeOfImpact.toFixed(2) : "none"}`,
            );
          checked++;
        }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  }, 120_000);

  it("13: leaves 内回り 24402611's lanes 0 and 1 clear along 汐留 (s 4857–5043): the road under each ray, nothing over it", () => {
    const run = g.chunks.filter((c) => c.run === "24402611");
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const mid = run.find((c) => c.st[0] <= 4950 && c.st[c.st.length - 7] >= 4950)!;
    const fr = frameAt(mid.st, 4950);
    const f = new LocalFrame(fr.lat, fr.lon, 40);
    const pl: GeoToLocal = { frame: f, ellipsoidal: (_a, _b, h) => h + N };
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    for (const c of g.chunks) {
      if (!isWithin(c, fr.lon, fr.lat, 600)) continue;
      const b = buildIn(c, pl, index);
      createDeckBody(world, b.collider, b.piers, null);
    }
    world.step();
    let checked = 0;
    // Off the rings' own distances (0.13 m past each 0.5 m): a ray down a ring's edge across the road may
    // slip between its triangles (Rapier).
    for (let s = 4857.13; s <= 5043; s += 0.5) {
      const c = run.find((x) => x.st[0] <= s && x.st[x.st.length - 7] >= s)!;
      const a = frameAt(c.st, s);
      const b = frameAt(c.st, s + 0.5);
      const p = f.toLocal(a.lat, a.lon, a.z + N);
      const q = f.toLocal(b.lat, b.lon, b.z + N);
      const t = q.clone().sub(p).setY(0).normalize();
      const laneL = sectionWidth(c) / 2 - c.shoulderL;
      // Lane 0 and lane 1, from 0.05 m in from the lanes' left edge to their middle.
      for (let u = laneL - 0.05; u >= laneL - 2 * c.laneWidth + 0.05; u -= 0.25) {
        const o = new Vector3(p.x + t.z * u, p.y + 2, p.z - t.x * u);
        const hit = world.castRay(new RAPIER.Ray(o, { x: 0, y: -1, z: 0 }), 5, true);
        expect(hit, `s ${s} u ${u.toFixed(2)}`).not.toBeNull();
        expect(2 - hit!.timeOfImpact, `s ${s} u ${u.toFixed(2)}`).toBeCloseTo(0, 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);

  it("closes 4848762's wall at the wall where it comes back to one slab with 45021972 (s 522.4): nothing across its right lane", () => {
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const c = g.chunks.find((x) => x.id === "4848762:2")!;
    const fr = frameAt(c.st, 522);
    const f = new LocalFrame(fr.lat, fr.lon, 40);
    const pl: GeoToLocal = { frame: f, ellipsoidal: (_a, _b, h) => h + N };
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    for (const x of g.chunks.filter((x) => isWithin(x, fr.lon, fr.lat, 400))) {
      const b = buildIn(x, pl, index);
      createDeckBody(world, b.collider, b.piers, null);
    }
    world.step();
    const point = (s: number, u: number) => {
      const a = frameAt(c.st, s);
      const b = frameAt(c.st, s + 0.5);
      const p = f.toLocal(a.lat, a.lon, a.z + N + 0.5);
      const q = f.toLocal(b.lat, b.lon, b.z + N + 0.5);
      const t = q.clone().sub(p).setY(0).normalize();
      return new Vector3(p.x + t.z * u, p.y, p.z - t.x * u);
    };
    // Its right lane: 0.25–3.5 m right of the centre (u negative), 0.5 m over the road, s 516 → 528.
    for (const u of [-0.5, -1.875, -2.8, -3.3]) {
      const o = point(516, u);
      const to = point(528, u);
      const dir = to.clone().sub(o);
      const hit = world.castRay(new RAPIER.Ray(o, dir.clone().normalize()), dir.length(), true);
      expect(hit, `u ${u}${hit ? ` at ${hit.timeOfImpact.toFixed(2)} m` : ""}`).toBeNull();
    }
  }, 60_000);

  it("puts the lower deck's two rings at one place even where its let-go point lies on the master's edge vertex (45554540:34 s 7985.98)", () => {
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const c = g.chunks.find((x) => x.id === "45554540:34")!;
    const fr = frameAt(c.st, 7986);
    const b = buildIn(
      c,
      { frame: new LocalFrame(fr.lat, fr.lon, 40), ellipsoidal: (_a, _b, h) => h + N },
      index,
    );
    const pairs = b.rings.flatMap((r, i) =>
      b.rings[i + 1] === r && (b.sides[i].left.clearTo === null) !== (b.sides[i + 1].left.clearTo === null)
        ? [r.frame.s]
        : [],
    );
    expect(pairs.some((s) => Math.abs(s - 7985.98) < 0.05)).toBe(true);
  }, 60_000);
});

function buildIn(c: XwChunk, pl: GeoToLocal, index: DeckIndex) {
  const steps = deckArraySteps(c, pl, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Whether a station of a chunk lies within `m` metres (plan) of a point. */
function isWithin(c: XwChunk, lon: number, lat: number, m: number): boolean {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  for (let o = 0; o < c.st.length; o += 7)
    if (Math.hypot((c.st[o + 1] - lon) * kx, (c.st[o + 2] - lat) * 110_574) < m) return true;
  return false;
}

/**
 * Q closing on P's line by `slope` a metre (0.1°: 2 mm, as 28127732:1 on 44351599 at s 303.7; d = 5.6 m
 * at x 100), above P (sign 1) or below it (−1) with |Δz| growing 5 cm a metre (that ramp's grade
 * against the main line's) and crossing MERGE_MAX_DZ at x 100.01, between two probes 2 cm apart.
 */
function slantedLetGo(sign: 1 | -1, slope = -0.002) {
  return pair(
    (px) => 5.6 + slope * (px - 100),
    (px) => sign * (px < 98 ? 0.05 : 0.15 + 0.05 * (px - 100.01)),
  );
}

/** The seam probe of the ledger at P's left slab edge (4.75 m), x: the faces 2 mm inside and outside. */
function seamAt(x: Pair, px: number) {
  const top = Z + Math.max(0, x.dz(px)) + 0.5;
  return { inside: downAt(x.world, px, 4.75 - 0.002, top), outside: downAt(x.world, px, 4.75 + 0.002, top) };
}

describe("the let-go point of two decks whose lines are not parallel (a1-answer6, partnerSeesDivider)", () => {
  for (const sign of [1, -1] as const)
    it(`keeps P's face on its edge up to the let-go point and covers the gap past it, Q ${sign > 0 ? "above" : "below"} P (ship 28127732:1 s 303.7's shape)`, () => {
      const x = slantedLetGo(sign);
      for (let px = 99.7; px <= 100.3 + 1e-9; px += 0.02) {
        const isMerged = Math.abs(x.dz(px)) <= MERGE_MAX_DZ;
        if (isMerged) {
          const { inside, outside } = seamAt(x, px);
          expect(inside, `x ${px.toFixed(2)} inside`).not.toBeNull();
          expect(outside, `x ${px.toFixed(2)} outside`).not.toBeNull();
          expect(Math.abs(inside! - Z), `x ${px.toFixed(2)} inside face`).toBeLessThan(0.01);
          continue;
        }
        const low = Z + Math.min(0, x.dz(px));
        for (const { y, h } of across(x.world, px, P_LANE + 0.01, x.d(px) - Q_LANE - 0.01, 0.1, Z + 2))
          expect(h ?? -Infinity, `x ${px.toFixed(2)} y ${y.toFixed(2)}`).toBeGreaterThan(low - 0.03);
      }
    });

  it("lets P and Q stand by the wall from the same ring where the lines are parallel", () => {
    const x = slantedLetGo(1, 0);
    const firstWall = (b: Pair["P"], side: "left" | "right") =>
      b.rings[b.sides.findIndex((sd) => sd[side].clearTo !== null)].frame.s;
    expect(Math.abs(firstWall(x.P, "left") - firstWall(x.Q, "right"))).toBeLessThan(0.01);
  });
});

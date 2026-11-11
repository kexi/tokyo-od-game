import { describe, expect, it } from "vitest";
import { CLEARANCE_M, featureCeilings, indexCutPoints, type LocalCutPoint } from "../src/world/buildingCut";

/** An LOD1-style box (8 vertices, 12 triangles) from (x0, z0) to (x1, z1), `bottom` (0) to `top`. */
function box(x0: number, z0: number, x1: number, z1: number, top: number, bottom = 0) {
  const v: Array<[number, number, number]> = [];
  for (const y of [bottom, top])
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ])
      v.push([x, y, z]);
  const quads = [
    [4, 5, 6, 7], // roof
    [0, 1, 2, 3], // floor
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const index = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { v, index };
}

/** Boxes as one tile's geometry, feature id = the box's position in the list. */
function tile(boxes: ReturnType<typeof box>[]) {
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const ids: number[] = [];
  const index: number[] = [];
  boxes.forEach((b, id) => {
    const base = x.length;
    for (const [vx, vy, vz] of b.v) {
      x.push(vx);
      y.push(vy);
      z.push(vz);
      ids.push(id);
    }
    index.push(...b.index.map((i) => i + base));
  });
  return { x, y, z, ids, index };
}

// A deck along x at z = 0, its soffit at y = 10 and road at 12, cut points every 2 m over z −5 … 5.
const deck: LocalCutPoint[] = [];
for (let x = -40; x <= 40; x += 2) for (const z of [-5, -2.5, 0, 2.5, 5]) deck.push({ x, y: 10, z, top: 12 });

const ceilingsOf = (boxes: ReturnType<typeof box>[], points = deck) => {
  const t = tile(boxes);
  return featureCeilings(t.x, t.y, t.z, t.index, (i) => t.ids[i], indexCutPoints(points));
};

describe("buildings standing into a deck (buildingCut.ts)", () => {
  it("cuts a building across the deck to just under the soffit", () => {
    const c = ceilingsOf([box(-6, -20, 6, 20, 30)]);
    expect(c.get(0)).toBeCloseTo(10 - CLEARANCE_M, 6);
  });

  it("leaves a building whose roof is under the soffit (it stands under the viaduct)", () => {
    expect(ceilingsOf([box(-6, -20, 6, 20, 8)]).size).toBe(0);
  });

  it("leaves a building beside the deck, however tall", () => {
    expect(ceilingsOf([box(-6, 7, 6, 30, 60)]).size).toBe(0);
  });

  it("finds a building that only clips the deck's edge", () => {
    const c = ceilingsOf([box(-6, 4, 6, 30, 30)]);
    expect(c.has(0)).toBe(true);
  });

  it("cuts only the crossing building of a tile, by its feature id", () => {
    const c = ceilingsOf([box(-60, 20, -50, 30, 40), box(10, -8, 20, 8, 25), box(50, -30, 60, -20, 40)]);
    expect([...c.keys()]).toEqual([1]);
  });

  it("takes the lowest soffit the roof covers (a deck on a grade)", () => {
    const sloped = deck.map((p) => ({ ...p, y: 10 + p.x * 0.05 }));
    const c = ceilingsOf([box(-10, -20, 10, 20, 30)], sloped);
    expect(c.get(0)).toBeCloseTo(10 - 0.5 - CLEARANCE_M, 6);
  });

  it("leaves a structure spanning the deck with the 4.5 m clearance under it (a deck between buildings)", () => {
    expect(ceilingsOf([box(-3, -20, 3, 20, 20, 12 + 4.5)]).size).toBe(0);
  });

  it("cuts a structure across the deck lower than the clearance (the car would hit it)", () => {
    expect(ceilingsOf([box(-3, -20, 3, 20, 20, 15)]).get(0)).toBeCloseTo(10 - CLEARANCE_M, 6);
  });

  it("finds nothing without cut points", () => {
    expect(ceilingsOf([box(-6, -20, 6, 20, 30)], []).size).toBe(0);
  });
});

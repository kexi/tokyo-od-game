import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { END_FACE_M, laneOverSite, MIN_LENGTH_M, type SiteLine } from "../scripts/expresswaySiteLanes";

/** A straight slab along x from 0 to 100 m (run distance = x), its edge 5 m off the centre line. */
const site: SiteLine = {
  centre: [0, 25, 50, 75, 100].map((x) => new Vector3(x, 0, 0)),
  s: [0, 25, 50, 75, 100],
  edgeM: 5,
};
/** A lane's centre points one metre apart from (x, z) along the unit direction (dx, dz). */
const lane = (x: number, z: number, n: number, dx = 1, dz = 0) =>
  Array.from({ length: n }, (_, i) => new Vector3(x + dx * i, 0, z + dz * i));

describe("the lanes probe's judgement (expresswaySiteLanes.ts, A2)", () => {
  it("counts a lane whose centre runs MIN_LENGTH_M (3 m) within the slab's edge, and not one of 2 m", () => {
    expect(MIN_LENGTH_M).toBe(3);
    expect(laneOverSite(lane(10, 4, 3), site)).toEqual({ lengthM: 3, nearestM: 4, s0: 10, s1: 12 });
    expect(laneOverSite(lane(10, 4, 2), site)).toBeNull();
  });

  it("counts a lane exactly on the edge (dist ≤ edge), and not one 0.01 m outside it", () => {
    expect(laneOverSite(lane(10, 5, 20), site)?.lengthM).toBe(20);
    expect(laneOverSite(lane(10, 5.01, 20), site)).toBeNull();
  });

  it("does not count the points past the slab's end faces (before its first, after its last station)", () => {
    expect(END_FACE_M).toBe(0.5);
    // Up to and past the first station: the points up to s 0.5 face the end, not the slab.
    expect(laneOverSite(lane(-10, 1, 11), site)).toBeNull();
    const across = laneOverSite(lane(-10, 1, 20), site)!;
    expect([across.lengthM, across.s0, across.s1]).toEqual([9, 1, 9]);
    // Past the last station.
    expect(laneOverSite(lane(99.6, 1, 10), site)).toBeNull();
  });

  it("counts of a lane crossing the slab at a slant only what runs within the edge", () => {
    const d = Math.SQRT1_2;
    // Through (50, 0) at 45°: |z| ≤ 5 for 15 of the points one metre apart (t = −7 … 7).
    const over = laneOverSite(lane(50 - 20 * d, -20 * d, 41, d, d), site)!;
    expect(over.lengthM).toBe(15);
    expect(over.nearestM).toBeCloseTo(0, 6);
    expect(over.s0).toBeCloseTo(50 - 7 * d, 6);
    expect(over.s1).toBeCloseTo(50 + 7 * d, 6);
    // Square across: the slab's width, 11 points.
    expect(laneOverSite(lane(50, -20, 41, 0, 1), site)?.lengthM).toBe(11);
  });
});

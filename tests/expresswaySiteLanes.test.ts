import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  END_FACE_M,
  JOIN_GAP_M,
  laneOverSite,
  mergeSitePlaces,
  MIN_LENGTH_M,
  type SiteLanes,
  type SiteLine,
  sitePlaceKeys,
} from "../scripts/expresswaySiteLanes";

/** A straight slab along x from 0 to 100 m (run distance = x), its edge 5 m off the centre line. */
const site: SiteLine = {
  centre: [0, 25, 50, 75, 100].map((x) => new Vector3(x, 0, 0)),
  s: [0, 25, 50, 75, 100],
  edgeM: 5,
};
/** A lane's centre points one metre apart from (x, z) along the unit direction (dx, dz). */
const lane = (x: number, z: number, n: number, dx = 1, dz = 0) =>
  Array.from({ length: n }, (_, i) => new Vector3(x + dx * i, 0, z + dz * i));
const place = (over: Partial<SiteLanes>): SiteLanes => ({
  run: "7",
  chunk: "7:0",
  s0: 0,
  s1: 10,
  lengthM: 10,
  streetM: 9,
  nearestM: 1,
  lanes: 1,
  ...over,
});

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

describe("the lanes probe's places and their keys (expresswaySiteLanes.ts, A2)", () => {
  it("merges places of one run and width within JOIN_GAP_M (1 m), even across a chunk's end", () => {
    expect(JOIN_GAP_M).toBe(1);
    const merged = mergeSitePlaces([
      place({ chunk: "7:1", s0: 300.5, s1: 320, lengthM: 20, nearestM: 0.4, lanes: 2 }),
      place({ chunk: "7:0", s0: 280, s1: 299.6, lengthM: 19, nearestM: 0.2, lanes: 1 }),
    ]);
    expect(merged).toEqual([place({ chunk: "7:0", s0: 280, s1: 320, lengthM: 20, nearestM: 0.2, lanes: 2 })]);
  });

  it("keeps apart places of another width, of another run, or more than 1 m apart", () => {
    const merged = mergeSitePlaces([
      place({ s0: 0, s1: 10 }),
      place({ s0: 5, s1: 20, streetM: 4.3 }),
      place({ s0: 11.2, s1: 30 }),
      place({ run: "8", chunk: "8:0", s0: 10.5, s1: 12 }),
    ]);
    expect(merged.map((p) => [p.run, p.streetM, p.s0, p.s1])).toEqual([
      ["7", 9, 0, 10],
      ["7", 4.3, 5, 20],
      ["7", 9, 11.2, 30],
      ["8", 9, 10.5, 12],
    ]);
  });

  it("numbers each run's places of one width from 1 in order of s0, in the list's own order", () => {
    const keys = sitePlaceKeys([
      place({ s0: 38.2, s1: 61 }),
      place({ s0: 36.5, s1: 87.1, streetM: 4.3 }),
      place({ s0: 1.3, s1: 36.4 }),
      place({ run: "8", s0: 50, s1: 60 }),
    ]);
    expect(keys).toEqual([
      "lane-in-site:7|w9|2",
      "lane-in-site:7|w4.3|1",
      "lane-in-site:7|w9|1",
      "lane-in-site:8|w9|1",
    ]);
  });
});

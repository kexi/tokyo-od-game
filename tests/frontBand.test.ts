import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { isInFrontBand, slantOnPath } from "../src/game/autoTraffic";

// D4: which vehicles may be the car in front (AutoDriver.traffic()): those across the path between
// where the nose is now and where it heads, the band wide on both sides.

const north = new Vector3(0, 0, 1);
/** The heading `deg` degrees to the right of north (right of travel is (−dz, dx)). */
const headingRight = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return new Vector3(-Math.sin(a) * north.z, 0, Math.cos(a));
};

describe("the band a car in front is looked for in (D4)", () => {
  it("T-f1: with no slant it is the nose's lateral ± the band, as the look before D4", () => {
    for (const own of [-4, -2.37, 0, 1.2]) {
      for (let lateral = -8; lateral <= 8; lateral += 0.25) {
        for (const ahead of [1, 15, 40, 200]) {
          const before = Math.abs(lateral - own) < 1.7;
          expect(isInFrontBand(lateral, own, 0, ahead, 1.7)).toBe(before);
        }
      }
    }
  });

  it("T-f2: takes in the car the staged drive had dead ahead 29.7 m on (own −2.37 m, slant −0.113, it at −5.53 m)", () => {
    expect(Math.abs(-5.53 - -2.37) < 1.7).toBe(false);
    expect(isInFrontBand(-5.53, -2.37, -0.113, 29.7, 1.7)).toBe(true);
  });

  it("T-f3: takes in the car the staged drive had 1.1 m to its right 19.2 m on (own −2.44 m, it at −5.52 m)", () => {
    expect(Math.abs(-5.52 - -2.44) < 1.7).toBe(false);
    expect(isInFrontBand(-5.52, -2.44, -0.113, 19.2, 1.7)).toBe(true);
  });

  it("T-f4: at a slant, keeps a car near the nose's lateral now, on the side the car leaves", () => {
    expect(isInFrontBand(-2.37 + 1.5, -2.37, -0.113, 20, 1.7)).toBe(true);
    expect(isInFrontBand(-2.37 + 1.5, -2.37, -0.113, 60, 1.7)).toBe(true);
  });

  it("T-f5: takes in a car between the lateral now and the one headed for, far enough on that the two bands part", () => {
    // 50 m on at −0.113 the car heads for −5.65 m: the bands are −1.7…1.7 and −7.35…−3.95.
    expect(isInFrontBand(-2.8, 0, -0.113, 50, 1.7)).toBe(true);
    expect(isInFrontBand(-2.8, 0, 0, 50, 1.7)).toBe(false);
    // Not past the band on the far side of where it heads, nor the near side of where it is.
    expect(isInFrontBand(-7.5, 0, -0.113, 50, 1.7)).toBe(false);
    expect(isInFrontBand(1.8, 0, -0.113, 50, 1.7)).toBe(false);
  });

  it("T-f6: no slant in a pass, nor when the car is not lined up with its path (0.5 or under)", () => {
    expect(slantOnPath(headingRight(6), north, false)).toBeCloseTo(-Math.tan((6 * Math.PI) / 180), 6);
    expect(slantOnPath(headingRight(6), north, true)).toBe(0);
    expect(slantOnPath(headingRight(61), north, false)).toBe(0);
    expect(slantOnPath(headingRight(-6), north, false)).toBeCloseTo(Math.tan((6 * Math.PI) / 180), 6);
    // Behind the nose the band is the one now (no reach back along the slant).
    expect(isInFrontBand(3, 0, -0.113, -10, 1.7)).toBe(false);
  });
});

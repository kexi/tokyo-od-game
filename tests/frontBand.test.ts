import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  DRIFT_MIN_M,
  DRIFT_SPAN_M,
  frontSlant,
  isInFrontBand,
  NoseDrift,
  placeOnRoute,
  slantOnPath,
} from "../src/game/autoTraffic";

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

describe("the slant the band sweeps by (D4 v2): the heading's and the nose's drift together", () => {
  it("T-g1: the smaller of the two when they point the same way; 0 when they point apart, either is 0, or the car stands", () => {
    expect(frontSlant(-0.105, -0.087, false)).toBe(-0.087);
    expect(frontSlant(-0.05, -0.113, false)).toBe(-0.05);
    expect(frontSlant(0.08, 0.2, false)).toBe(0.08);
    expect(frontSlant(-0.2, 0.05, false)).toBe(0);
    expect(frontSlant(0.2, -0.05, false)).toBe(0);
    expect(frontSlant(0, -0.1, false)).toBe(0);
    expect(frontSlant(-0.1, 0, false)).toBe(0);
    expect(frontSlant(-0.105, -0.087, true)).toBe(0);
  });

  it("T-g2: the drift over the last 8 m: a straight slant's own slope, the last value under 0.5 m, nothing older than 8 m, 0 after a reset", () => {
    expect(DRIFT_SPAN_M).toBe(8);
    expect(DRIFT_MIN_M).toBe(0.5);
    const d = new NoseDrift();
    // (a) Along a straight slant of −0.1: its slope, once 0.5 m on.
    for (let at = 0; at <= 20; at += 0.25) d.note(at, -0.1 * at);
    expect(d.value).toBeCloseTo(-0.1, 9);
    // (b) Under 0.5 m from the first place the value is the one before (0 at the start).
    const fresh = new NoseDrift();
    expect(fresh.note(100, 0)).toBe(0);
    expect(fresh.note(100.25, -0.05)).toBe(0);
    expect(fresh.note(100.5, -0.05)).toBeCloseTo(-0.1, 9);
    expect(fresh.note(100.6, -0.05)).toBeCloseTo(-0.05 / 0.6, 9);
    // (c) 30 m on the line, then 4 m at 6° off it: from the place 8 m back, half 6°'s slope.
    const onset = new NoseDrift();
    const slope = -Math.tan((6 * Math.PI) / 180);
    for (let at = 0; at <= 30; at += 0.25) onset.note(at, 0);
    let last = 0;
    for (let at = 30.25; at <= 34; at += 0.25) last = onset.note(at, slope * (at - 30));
    expect(last).toBeCloseTo(slope / 2, 9);
    // (d) After a reset the value is 0, and the first 0.5 m keeps it there.
    onset.reset();
    expect(onset.value).toBe(0);
    expect(onset.note(40, -3)).toBe(0);
    expect(onset.note(40.25, -3.1)).toBe(0);
    // A place more than 0.5 m back along the path starts afresh.
    const back = new NoseDrift();
    for (let at = 0; at <= 10; at += 0.5) back.note(at, -0.1 * at);
    expect(back.note(9, -0.9)).toBe(0);
  });

  it("T-g3: no drift for a nose that keeps its lateral round an arc of radius 6.5 m (placed on the path)", () => {
    // A quarter arc of radius 6.5 m (a left turn's path), and a nose on a radius 0.3 m larger.
    const points: Vector3[] = [];
    for (let a = 0; a <= 90; a += 3) {
      const r = (a * Math.PI) / 180;
      points.push(new Vector3(6.5 * Math.cos(r) - 6.5, 0, 6.5 * Math.sin(r)));
    }
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
    const route = { points, cum };
    const d = new NoseDrift();
    let worst = 0;
    for (let a = 6; a <= 84; a += 1) {
      const r = (a * Math.PI) / 180;
      const nose = new Vector3(6.8 * Math.cos(r) - 6.5, 0, 6.8 * Math.sin(r));
      const place = placeOnRoute(route, nose, 0, cum[cum.length - 1], 1)!;
      worst = Math.max(worst, Math.abs(d.note(place.at, place.lateral)));
    }
    expect(worst).toBeLessThan(0.01);
  });
});

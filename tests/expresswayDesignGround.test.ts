import { describe, expect, it } from "vitest";
import { envelope } from "../src/expressway/designGround";

// The design ground line (P2.7-3, designGround.ts): what the objective-v2 deck aims at.
const STEP = 5;
const grid = (lengthM: number, f: (s: number) => number) =>
  Float64Array.from({ length: Math.round(lengthM / STEP) + 1 }, (_, k) => f(k * STEP));
const range = (a: ArrayLike<number>, from = 0, to = a.length) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = from; k < to; k++) {
    lo = Math.min(lo, a[k]);
    hi = Math.max(hi, a[k]);
  }
  return hi - lo;
};
/** A rough ground: a 200 m wave of 1 m, a 37 m one of 0.4 m and a 1.5 km one of 6 m. */
const rough = (s: number) =>
  10 +
  Math.sin((2 * Math.PI * s) / 200) +
  0.4 * Math.sin((2 * Math.PI * s) / 37 + 1) +
  6 * Math.sin((2 * Math.PI * s) / 1500);

describe("設計地盤線（designGround.ts envelope）", () => {
  it("upper is never under the ground and lower never over it, ends included", () => {
    const g = grid(3000, rough);
    const upper = envelope(g, 150, "upper");
    const lower = envelope(g, 150, "lower");
    for (let k = 0; k < g.length; k++) {
      expect(upper[k]).toBeGreaterThanOrEqual(g[k]);
      expect(lower[k]).toBeLessThanOrEqual(g[k]);
    }
  });

  it("keeps a constant constant, and moves with the ground when the ground is raised", () => {
    const flat = grid(1000, () => 7.25);
    for (const kind of ["upper", "lower", "mid"] as const) {
      for (const v of envelope(flat, 150, kind)) expect(v).toBeCloseTo(7.25, 12);
      const g = grid(2000, rough);
      const base = envelope(g, 150, kind);
      const raised = envelope(
        g.map((v) => v + 12.5),
        150,
        kind,
      );
      raised.forEach((v, k) => expect(v - base[k]).toBeCloseTo(12.5, 9));
    }
  });

  it("drops the bumps of a wavelength up to twice the reach, and keeps the longer waves", () => {
    // A 200 m wave of 1 m under a reach of 150 m: the moving maximum over 300 m is its crest.
    const short = grid(3000, (s) => 10 + Math.sin((2 * Math.PI * s) / 200));
    const inner = [60, short.length - 60] as const;
    expect(range(envelope(short, 150, "upper"), ...inner)).toBeLessThan(0.02);
    expect(range(envelope(short, 150, "lower"), ...inner)).toBeLessThan(0.02);
    // Exactly 2 × reach: still dropped.
    const edge = grid(3000, (s) => 10 + Math.sin((2 * Math.PI * s) / 300));
    expect(range(envelope(edge, 150, "upper"), ...inner)).toBeLessThan(0.05);
    // A 1.5 km wave of 6 m: followed with three quarters of its height or more (the extreme flattens
    // its crests over 300 m, the mean after it its sags).
    const long = grid(6000, (s) => 10 + 6 * Math.sin((2 * Math.PI * s) / 1500));
    const up = envelope(long, 150, "upper");
    expect(range(up, 60, up.length - 60)).toBeGreaterThan(0.75 * 12);
  });

  it("cuts its windows to the samples there are at the ends", () => {
    // A ramp: the upper envelope at the first sample sees only what lies after it.
    const ramp = grid(1000, (s) => s / 100);
    const up = envelope(ramp, 50, "upper");
    // Windows of ±10 samples: the maximum at k is ramp[min(k + 10, n − 1)], its mean at 0 over 0…10
    // is the mean of ramp[10…20] = 0.75 m.
    expect(up[0]).toBeCloseTo(0.75, 12);
    expect(up[up.length - 1]).toBeCloseTo(10, 12);
    const low = envelope(ramp, 50, "lower");
    expect(low[0]).toBeCloseTo(0, 12);
    expect(low[low.length - 1]).toBeCloseTo(10 - 0.75, 12);
  });

  it("mid is the mean of upper and lower, between the two", () => {
    const g = grid(2000, rough);
    const upper = envelope(g, 150, "upper");
    const lower = envelope(g, 150, "lower");
    const mid = envelope(g, 150, "mid");
    mid.forEach((v, k) => {
      expect(v).toBeCloseTo((upper[k] + lower[k]) / 2, 12);
      expect(v).toBeLessThanOrEqual(upper[k]);
      expect(v).toBeGreaterThanOrEqual(lower[k]);
    });
  });

  it("takes the reach in metres on the grid it is given", () => {
    const g = grid(2000, rough);
    const coarse = Float64Array.from(
      { length: Math.floor(g.length / 2) + 1 },
      (_, k) => g[Math.min(2 * k, g.length - 1)],
    );
    // A reach of 150 m on a 10 m grid is 15 samples, as 30 are on a 5 m one.
    expect(envelope(coarse, 150, "upper", 10)).toEqual(envelope(coarse, 300, "upper", 20));
  });
});

import { describe, expect, it } from "vitest";
import { FLOOR_CORRELATION, facadeHash, litShare, windowPick, type WindowUse } from "../src/world/facade";

const USES: WindowUse[] = ["office", "home", "mixed", "shop", "works"];

/** Every window of `buildings` towers 45 bays wide (one PERIOD) and 40 storeys tall. */
function* windows(buildings: number) {
  for (let b = 0; b < buildings; b++) {
    const tint = 0.05 + ((0.9 * (b * 0.618034)) % 0.9);
    const layer = b % 8;
    const face = 1 + (b % 4);
    for (let x = 0; x < 180; x++) for (let y = 0; y < 40; y++) yield { x, y, face, tint, layer };
  }
}

/** How often two neighbouring windows on one floor are both lit or both dark at a 40 % share. */
function agreement(correlation: number): number {
  let same = 0;
  let n = 0;
  for (const w of windows(24)) {
    const isNeighbourOnFloor = w.x % 2 === 0;
    if (!isNeighbourOnFloor) continue;
    const a = windowPick(w.x, w.y, w.face, w.tint, w.layer, correlation) <= 0.4;
    const b = windowPick(w.x + 1, w.y, w.face, w.tint, w.layer, correlation) <= 0.4;
    if (a === b) same++;
    n++;
  }
  return same / n;
}

describe("lit share by hour and use", () => {
  it("keeps every share between 0 and 1 at every quarter hour", () => {
    for (const use of USES)
      for (let h = 0; h < 24; h += 0.25) {
        expect(litShare(use, h)).toBeGreaterThanOrEqual(0);
        expect(litShare(use, h)).toBeLessThanOrEqual(1);
      }
  });

  it("empties offices through the evening: many lit at 19 h, few after 23 h", () => {
    expect(litShare("office", 19)).toBeGreaterThan(0.45);
    expect(litShare("office", 21)).toBeGreaterThan(litShare("office", 23));
    expect(litShare("office", 23.5)).toBeLessThan(0.12);
    expect(litShare("office", 3)).toBeLessThan(0.06);
  });

  it("lights homes in the evening and few after midnight", () => {
    expect(litShare("home", 20)).toBeGreaterThan(0.65);
    expect(litShare("home", 20)).toBeGreaterThan(litShare("home", 14));
    expect(litShare("home", 2)).toBeLessThan(0.1);
  });

  it("closes street-level shops at night but keeps the all-night ones lit", () => {
    expect(litShare("shop", 19)).toBeGreaterThan(0.85);
    expect(litShare("shop", 23)).toBeLessThan(0.3);
    expect(litShare("shop", 3)).toBeGreaterThan(0.05);
  });

  it("keeps 雑居ビル busier than offices late in the evening", () => {
    expect(litShare("mixed", 23)).toBeGreaterThan(litShare("office", 23));
  });

  it("darkens offices on days off but not homes or shops", () => {
    expect(litShare("office", 21, true)).toBeLessThan(litShare("office", 21) * 0.5);
    expect(litShare("home", 21, true)).toBe(litShare("home", 21));
    expect(litShare("shop", 21, true)).toBe(litShare("shop", 21));
  });

  it("is continuous across midnight and wraps the hour", () => {
    for (const use of USES) {
      expect(litShare(use, 23.999)).toBeCloseTo(litShare(use, 0), 2);
      expect(litShare(use, 25)).toBeCloseTo(litShare(use, 1), 10);
      expect(litShare(use, -1)).toBeCloseTo(litShare(use, 23), 10);
    }
  });
});

describe("window hash", () => {
  it("spreads the windows of a city block evenly over [0, 1)", () => {
    const buckets = Array.from({ length: 10 }, () => 0);
    let n = 0;
    for (const w of windows(24)) {
      const h = facadeHash(w.x + w.face * 211, w.y + w.tint * 977 + w.layer * 17);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      buckets[Math.floor(h * 10)]++;
      n++;
    }
    // 172 800 samples: each tenth within 5 % of its expected count.
    for (const count of buckets) expect(Math.abs(count / (n / 10) - 1)).toBeLessThan(0.05);
  });

  it("lights the asked-for share of windows, window by window or floor by floor", () => {
    for (const use of ["home", "office"] as const)
      for (const share of [0.1, 0.3, 0.7]) {
        let lit = 0;
        let n = 0;
        for (const w of windows(48)) {
          const isLit = windowPick(w.x, w.y, w.face, w.tint, w.layer, FLOOR_CORRELATION[use]) <= share;
          if (isLit) lit++;
          n++;
        }
        expect(Math.abs(lit / n - share)).toBeLessThan(0.03);
      }
  });

  it("makes office windows on one floor agree more often than flats", () => {
    // Independent windows at a 40 % share agree 52 % of the time (0.4² + 0.6²); with 65 % of them
    // following their floor, 0.65² + (1 − 0.65²) × 0.52 ≈ 72 %.
    expect(agreement(FLOOR_CORRELATION.home)).toBeCloseTo(0.52, 1);
    expect(agreement(FLOOR_CORRELATION.office)).toBeGreaterThan(0.66);
  });

  it("gives a window the same lights after the floating origin moves by a whole period", () => {
    for (const x of [-181, -1, 0, 7, 179, 365])
      expect(windowPick(x + 180, 3, 2, 0.4, 5, 0)).toBe(windowPick(x, 3, 2, 0.4, 5, 0));
  });
});

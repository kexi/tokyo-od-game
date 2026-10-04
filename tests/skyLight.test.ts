import { describe, expect, it } from "vitest";
import {
  airMass,
  GLOW_CLEAR,
  hex,
  lightBalance,
  nightFactorAt,
  skylight,
  srgbToLinear,
  sunIntensity,
  sunTint,
} from "../src/world/skyLight";

const luma = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe("air mass towards the sun (Kasten & Young)", () => {
  it("is 1 overhead, about 5.6 at 10° and about 38 on the horizon", () => {
    expect(airMass(90)).toBeCloseTo(1, 3);
    expect(airMass(10)).toBeCloseTo(5.6, 1);
    expect(airMass(0)).toBeCloseTo(37.9, 0);
  });

  it("grows as the sun sinks and is held once it is gone", () => {
    for (let h = 89; h > -1; h -= 1) expect(airMass(h)).toBeGreaterThan(airMass(h + 1));
    expect(airMass(-5)).toBe(airMass(-1));
  });
});

describe("colour of direct sunlight", () => {
  it("is white at noon in October (~50°)", () => {
    const c = sunTint(50);
    expect(Math.min(c.r, c.g, c.b)).toBeGreaterThan(0.94);
  });

  it("is orange with a sun 3° up (evening preset) and warm at 9° (morning preset)", () => {
    const evening = sunTint(3);
    expect(evening.r).toBe(1);
    expect(evening.g).toBeGreaterThan(0.4);
    expect(evening.g).toBeLessThan(0.65);
    expect(evening.b).toBeLessThan(0.25);
    const morning = sunTint(9);
    expect(morning.g).toBeGreaterThan(evening.g);
    expect(morning.b).toBeLessThan(0.65);
  });

  it("loses blue first, then green, as the sun sinks (Rayleigh ∝ λ⁻⁴)", () => {
    for (let h = 60; h > 0; h -= 2) {
      const high = sunTint(h);
      const low = sunTint(h - 2);
      expect(low.b).toBeLessThanOrEqual(high.b + 1e-9);
      expect(low.g).toBeLessThanOrEqual(high.g + 1e-9);
      expect(low.b / low.g).toBeLessThanOrEqual(high.b / high.g + 1e-9);
    }
  });
});

describe("intensity of direct sunlight", () => {
  it("keeps the old 2.8 at noon and is gone once the disc has set", () => {
    expect(sunIntensity(50, 0)).toBeCloseTo(2.8, 1);
    expect(sunIntensity(-0.8, 0)).toBe(0);
    expect(sunIntensity(-10, 0)).toBe(0);
  });

  it("falls as the sun sinks but leaves a warm key light at sunset", () => {
    for (let h = 70; h > 0; h -= 1) expect(sunIntensity(h - 1, 0)).toBeLessThan(sunIntensity(h, 0));
    expect(sunIntensity(3, 0)).toBeGreaterThan(1);
    expect(sunIntensity(3, 0)).toBeLessThan(1.8);
  });

  it("is a third under a raining deck", () => {
    expect(sunIntensity(50, 1) / sunIntensity(50, 0)).toBeCloseTo(0.32, 2);
  });
});

describe("skylight and night", () => {
  it("is 1 at noon, never above 1.05, and falls tenfold from sunset to −6°", () => {
    expect(skylight(50)).toBeCloseTo(1, 5);
    for (let h = -20; h <= 90; h += 0.5) expect(skylight(h)).toBeLessThanOrEqual(1.05);
    expect(skylight(-6) / skylight(0.5)).toBeCloseTo(0.1, 2);
  });

  it("night factor is 0 in daylight (≥ 2°) and 1 after civil twilight (≤ −8°)", () => {
    expect(nightFactorAt(2)).toBe(0);
    expect(nightFactorAt(40)).toBe(0);
    expect(nightFactorAt(-8)).toBe(1);
    expect(nightFactorAt(-3)).toBeGreaterThan(0);
    expect(nightFactorAt(-3)).toBeLessThan(1);
  });
});

describe("the light balance", () => {
  it("keeps noon on a clear day as the game had it (sun 2.8, hemisphere 1.5 of 0xbfd9ff, exposure 1)", () => {
    const noon = lightBalance(50, 0);
    expect(noon.sunIntensity).toBeCloseTo(2.8, 1);
    expect(noon.hemiIntensity).toBeCloseTo(1.5, 2);
    const old = hex(0xbfd9ff);
    expect(noon.hemiSky.r).toBeCloseTo(old.r, 2);
    expect(noon.hemiSky.b).toBeCloseTo(old.b, 2);
    expect(noon.exposure).toBeCloseTo(1, 2);
    expect(noon.glow.r).toBe(0);
    expect(noon.stars).toBe(0);
  });

  it("reads as evening at 3°: warm key light, bluer and dimmer shade, the eye opened up", () => {
    const noon = lightBalance(50, 0);
    const evening = lightBalance(3, 0);
    expect(evening.sunColor.b / evening.sunColor.r).toBeLessThan(0.3);
    expect(evening.hemiSky.b / evening.hemiSky.r).toBeGreaterThan(noon.hemiSky.b / noon.hemiSky.r);
    expect(evening.hemiIntensity).toBeLessThan(noon.hemiIntensity);
    expect(evening.exposure).toBeGreaterThan(1.15);
  });

  it("makes rain soft and cool: less sun, a colourless key, more ambient by day", () => {
    const clear = lightBalance(50, 0);
    const rain = lightBalance(50, 1);
    expect(rain.sunIntensity).toBeLessThan(clear.sunIntensity * 0.4);
    expect(rain.sunColor.b).toBeGreaterThan(clear.sunColor.b - 0.01);
    expect(rain.sunColor.b / rain.sunColor.r).toBeGreaterThan(0.95);
    expect(rain.hemiIntensity).toBeGreaterThan(clear.hemiIntensity);
    expect(rain.deck.r).toBeGreaterThan(0);
  });

  it("gives the night a grey-orange city glow, brighter under cloud, stars only when clear", () => {
    const clear = lightBalance(-40, 0);
    const cloudy = lightBalance(-40, 1);
    expect(clear.glow.r).toBeGreaterThan(clear.glow.g);
    expect(clear.glow.g).toBeGreaterThan(clear.glow.b);
    expect(luma(cloudy.glow)).toBeGreaterThan(luma(clear.glow));
    expect(clear.stars).toBe(1);
    expect(cloudy.stars).toBe(0);
    expect(clear.sunIntensity).toBe(0);
    expect(clear.moonIntensity).toBeGreaterThan(0);
  });

  it("hazes the night with the glow (warm, not the old near-black navy) and the noon with the old colour", () => {
    const night = lightBalance(-40, 0);
    expect(night.fog.r).toBeGreaterThan(night.fog.b);
    expect(night.fog.r).toBeCloseTo(GLOW_CLEAR.r * 1.15, 4);
    const noon = lightBalance(50, 0);
    const old = hex(0xbfd2e4);
    expect(noon.fog.g).toBeCloseTo(old.g, 3);
  });

  it("changes smoothly with the sun: no jumps over 0.1° steps from −20° to 70°, the moon swap included", () => {
    const keys = ["moonIntensity", "hemiIntensity", "exposure", "envIntensity", "skyGain"] as const;
    let prev = lightBalance(-20, 0);
    for (let h = -19.9; h <= 70; h += 0.1) {
      const next = lightBalance(h, 0);
      for (const k of keys) expect(Math.abs(next[k] - prev[k])).toBeLessThan(0.05);
      // The disc sets over 2.3° (about a real minute at the game clock's 10×).
      expect(Math.abs(next.sunIntensity - prev.sunIntensity)).toBeLessThan(0.08);
      expect(Math.abs(luma(next.fog) - luma(prev.fog))).toBeLessThan(0.02);
      prev = next;
    }
    // Where the light swaps from the sun's direction to the moon's (−4°), both are dark.
    expect(lightBalance(-4, 0).sunIntensity).toBe(0);
    expect(lightBalance(-4, 0).moonIntensity).toBe(0);
  });

  it("changes smoothly with the weather (おまかせ turns it over ~25 s)", () => {
    for (const h of [50, 9, 3, -3, -30]) {
      let prev = lightBalance(h, 0);
      for (let c = 0.02; c <= 1; c += 0.02) {
        const next = lightBalance(h, c);
        expect(Math.abs(next.sunIntensity - prev.sunIntensity)).toBeLessThan(0.06);
        expect(Math.abs(next.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.03);
        expect(Math.abs(luma(next.fog) - luma(prev.fog))).toBeLessThan(0.02);
        prev = next;
      }
    }
  });
});

describe("hex colours", () => {
  it("are stored linear as three's Color(hex) stores them", () => {
    const c = hex(0xbfd9ff);
    expect(c.r).toBeCloseTo(srgbToLinear(0xbf / 255), 6);
    expect(c.b).toBeCloseTo(1, 6);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
  });
});

import { describe, expect, it } from "vitest";
import { SPELL_MINUTES, spellMinutes, rainRateMmH, STEADY_RAIN_MM_H } from "../src/world/weatherSpells";

describe("おまかせの天気", () => {
  it("keeps each spell within its range, rain shorter than fair weather", () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const rain = spellMinutes(true, r);
      const fair = spellMinutes(false, r);
      expect(rain).toBeGreaterThanOrEqual(SPELL_MINUTES.rain[0]);
      expect(rain).toBeLessThanOrEqual(SPELL_MINUTES.rain[1]);
      expect(fair).toBeGreaterThanOrEqual(SPELL_MINUTES.clear[0]);
      expect(fair).toBeLessThanOrEqual(SPELL_MINUTES.clear[1]);
      expect(rain).toBeLessThan(fair);
    }
  });

  it("clamps a random value outside [0, 1)", () => {
    expect(spellMinutes(true, -1)).toBe(SPELL_MINUTES.rain[0]);
    expect(spellMinutes(true, 2)).toBe(SPELL_MINUTES.rain[1]);
  });
});

describe("how hard it rains on the windscreen (rainRateMmH)", () => {
  it("wets the glass whenever the scene rains, measured or not", () => {
    // What it guarantees: おまかせ and a replay rain in the scene with AMeDAS reporting nothing;
    // the glass still gets 本降り (it stayed dry under the falling rain before).
    expect(rainRateMmH(true, false, 0)).toBe(STEADY_RAIN_MM_H);
    expect(rainRateMmH(true, false, null)).toBe(STEADY_RAIN_MM_H);
  });

  it("follows the measurement under 現在の天気, and is dry when the scene does not rain", () => {
    expect(rainRateMmH(true, true, 0.5)).toBe(3);
    expect(rainRateMmH(true, true, 4)).toBe(24);
    expect(rainRateMmH(false, true, 4)).toBe(0);
    expect(rainRateMmH(false, false, null)).toBe(0);
  });
});

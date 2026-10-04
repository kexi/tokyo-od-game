import { describe, expect, it } from "vitest";
import { SPELL_MINUTES, spellMinutes } from "../src/world/weatherSpells";

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

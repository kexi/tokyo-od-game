import { describe, expect, it } from "vitest";
import { BackSide } from "three";
import { bloomSettings } from "../src/world/bloom";
import { isEnvStale } from "../src/world/skyEnvMap";
import { TokyoSky } from "../src/world/skyShader";

describe("Tokyo's sky (TSL)", () => {
  it("drives like three's SkyMesh: the same uniforms, which the environment map's sky copies", () => {
    const sky = new TokyoSky();
    for (const name of ["turbidity", "rayleigh", "mieCoefficient", "cloudCoverage", "sunPosition"] as const)
      expect(sky[name].isUniformNode).toBe(true);
    // A box drawn from inside at the far plane, behind everything, without fog of its own.
    expect(sky.material.side).toBe(BackSide);
    expect(sky.material.depthWrite).toBe(false);
    expect(sky.material.fog).toBe(false);
    expect(sky.material.colorNode).not.toBeNull();
    expect(sky.material.vertexNode).not.toBeNull();
  });

  it("starts with the additions off (no glow, stars, deck, ground or haze until Environment sets them)", () => {
    const look = new TokyoSky().look;
    expect(look.uSkyGain.value).toBe(1);
    expect(look.uStars.value).toBe(0);
    expect(look.uDeck.value.w).toBe(0);
    expect(look.uGround.value.w).toBe(0);
    expect(look.uHaze.value.w).toBe(0);
    expect(look.uGlow.value.getHex()).toBe(0);
  });

  it("gives each sky its own uniforms (the environment map's sky has the ground, the screen's the haze)", () => {
    const a = new TokyoSky();
    const b = new TokyoSky();
    a.look.uGround.value.w = 1;
    expect(b.look.uGround.value.w).toBe(0);
    expect(a.turbidity).not.toBe(b.turbidity);
  });
});

describe("when the environment map is drawn again", () => {
  const noon = { elevation: 50, azimuth: 180, overcast: 0 };

  it("draws the first map and not the same sky twice", () => {
    expect(isEnvStale(null, noon)).toBe(true);
    expect(isEnvStale(noon, { ...noon })).toBe(false);
  });

  it("follows 1° of elevation or 2° of azimuth (across north too), times the step", () => {
    expect(isEnvStale(noon, { ...noon, elevation: 49.5 })).toBe(false);
    expect(isEnvStale(noon, { ...noon, elevation: 49 })).toBe(true);
    expect(isEnvStale({ ...noon, azimuth: 359 }, { ...noon, azimuth: 1 })).toBe(true);
    expect(isEnvStale({ ...noon, azimuth: 359 }, { ...noon, azimuth: 1 }, 3)).toBe(false);
    expect(isEnvStale(noon, { ...noon, elevation: 47.5 }, 3)).toBe(false);
  });

  it("ignores the sun in deep night but not the weather", () => {
    const night = { elevation: -30, azimuth: 300, overcast: 0 };
    expect(isEnvStale(night, { ...night, elevation: -40, azimuth: 340 })).toBe(false);
    expect(isEnvStale(night, { ...night, overcast: 0.06 })).toBe(true);
    expect(isEnvStale(night, { ...night, overcast: 0.05 })).toBe(false);
  });
});

describe("bloom by the light", () => {
  it("lets only clipped light spill by day and lit windows too at night", () => {
    const day = bloomSettings(0, 0);
    const night = bloomSettings(1, 0);
    // Pseudo-HDR x / (1 − 0.96·x): a white wall at display 0.85 is ~4.6, a lit window at 0.85–0.9 ~5–7.
    expect(day.threshold).toBeGreaterThan(14);
    expect(night.threshold).toBeLessThan(4.6);
    expect(night.strength).toBeGreaterThan(day.strength);
  });

  it("spreads further in wet air at night, not by day", () => {
    expect(bloomSettings(1, 1).strength).toBeGreaterThan(bloomSettings(1, 0).strength);
    expect(bloomSettings(0, 1).strength).toBeCloseTo(bloomSettings(0, 0).strength, 6);
  });
});

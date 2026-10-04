import { describe, expect, it } from "vitest";
import { BackSide } from "three";
import { bloomSettings, bloomShare, CAP, KNEE } from "../src/world/bloom";
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

/** The bloom threshold on a clear evening, by the night factor. */
const thresholdAt = (night: number) => bloomSettings(night, 0).threshold;

describe("bloom by the light (thresholds in exposed radiance: the HDR frame times the exposure)", () => {
  // Exposed radiances measured or set in the game: the noon sky by the horizon (its brightest
  // channel), a white wall in the sun, the city's glow on a clear night's horizon, a lit signal
  // lens's LEDs (the green, the dimmest lit colour: render/untonemapped.ts draws ~1.0–1.8 exposed,
  // whatever the exposure; tests/untonemapped.test.ts has every colour), a low-beam headlamp, a
  // street lamp's lens (night exposure 0.8).
  const NOON_HORIZON = 5.4;
  const SUNLIT_WALL = 1.5;
  const NIGHT_SKY = 0.1;
  const SIGNAL = 1.0;
  const HEADLAMP = 1.8 * 0.8;
  const LAMP = 1 * 0.8;

  it("lets only what outshines the sky spill by day: the sun and glints, not the sky or a white wall", () => {
    const day = bloomSettings(0, 0);
    expect(day.threshold * (1 - KNEE)).toBeGreaterThan(NOON_HORIZON);
    expect(bloomShare(NOON_HORIZON, day.threshold)).toBe(0);
    expect(bloomShare(SUNLIT_WALL, day.threshold)).toBe(0);
    expect(bloomShare(CAP, day.threshold)).toBeGreaterThan(0.5);
  });

  it("lets lamps, signals and headlights spill at night, not the sky's glow", () => {
    const night = bloomSettings(1, 0);
    for (const light of [SIGNAL, HEADLAMP, LAMP])
      expect(bloomShare(light, night.threshold)).toBeGreaterThan(0);
    expect(bloomShare(SIGNAL, night.threshold)).toBeGreaterThan(bloomShare(LAMP, night.threshold));
    expect(bloomShare(NIGHT_SKY, night.threshold)).toBe(0);
    expect(night.strength).toBeGreaterThan(bloomSettings(0, 0).strength);
  });

  it("moves the threshold in stops through dusk, never below the night's or above the day's", () => {
    const half = thresholdAt(0.425);
    expect(half).toBeCloseTo(Math.sqrt(thresholdAt(0) * thresholdAt(1)), 6);
    for (let n = 0; n <= 1; n += 0.05) {
      expect(thresholdAt(n)).toBeLessThanOrEqual(thresholdAt(0));
      expect(thresholdAt(n)).toBeGreaterThanOrEqual(thresholdAt(1));
      expect(thresholdAt(n + 0.05)).toBeLessThanOrEqual(thresholdAt(n) + 1e-9);
    }
  });

  it("holds the sun's disc to CAP, so a 6·10⁴ disc does not flood the chain", () => {
    const t = bloomSettings(0, 0).threshold;
    // Its contribution, as a radiance: share × brightness.
    expect(bloomShare(60000, t) * 60000).toBeCloseTo(bloomShare(CAP, t) * CAP, 6);
  });

  it("spreads further in wet air at night, not by day", () => {
    expect(bloomSettings(1, 1).strength).toBeGreaterThan(bloomSettings(1, 0).strength);
    expect(bloomSettings(0, 1).strength).toBeCloseTo(bloomSettings(0, 0).strength, 6);
  });
});

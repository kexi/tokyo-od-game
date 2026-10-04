import { describe, expect, it } from "vitest";
import { Sky } from "three/addons/objects/Sky.js";
import { bloomSettings } from "../src/world/bloom";
import { isEnvStale } from "../src/world/skyEnvMap";
import { patchSkyFragment } from "../src/world/skyShader";

describe("Tokyo's additions to the Preetham sky shader", () => {
  it("apply to the installed three's Sky.js (each anchor found once)", () => {
    const patched = patchSkyFragment(new Sky().material.fragmentShader);
    const uniforms = {
      uSkyGain: "float",
      uOzone: "float",
      uGlow: "vec3",
      uStars: "float",
      uTwilight: "float",
      uDeck: "vec4",
      uGround: "vec4",
      uHaze: "vec4",
    };
    for (const [name, type] of Object.entries(uniforms))
      expect(patched).toContain(`uniform ${type} ${name};`);
    // Behind the clouds (they composite over the glow and the stars), the deck over them, the haze
    // after the output encoding.
    const at = (s: string) => patched.indexOf(s);
    expect(at("texColor += uGlow")).toBeLessThan(at("// Clouds"));
    expect(at("if ( uDeck.w > 0.0 )")).toBeGreaterThan(at("// Clouds"));
    expect(at("if ( uHaze.w > 0.0 )")).toBeGreaterThan(at("#include <colorspace_fragment>"));
  });

  it("refuse a shader whose anchors moved (a three update), so the plain sky is kept", () => {
    expect(() => patchSkyFragment("void main() {}")).toThrow(/anchor/);
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

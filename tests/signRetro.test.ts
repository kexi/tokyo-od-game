import { describe, expect, it } from "vitest";
import { KNEE, bloomSettings } from "../src/world/bloom";
import { lightBalance } from "../src/world/skyLight";
import { ASSUMPTIONS, BASE_GLOW, LAMP, NIGHT_BASE, RETRO_MAX } from "../src/signs/retroAssumptions";
import {
  lampIntensity,
  RA_PEAK,
  retroCoefficient,
  retroEmission,
  retroWhite,
  type Beam,
  type Lamps,
} from "../src/signs/retroreflection";
import { SHEETING_RA } from "../src/signs/retroStandards";

/**
 * The retroreflection model the sign faces draw (src/signs/retroreflection.ts, copied node for node
 * in src/world/signFaceMaterial.ts): it follows the 再帰反射係数 table it cites, lights a plate in
 * the beam and not one the eye sees from far off the lamps, and never adds more than RETRO_MAX.
 */

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** A car on +Z at `back` m before a plate 3.5 m to its left (+X), 2.9 m up, facing the car. */
function scene(back: number, beam: Beam) {
  const lamps: Lamps = {
    positions: [
      { x: 0.62, y: 0.6, z: -back + 2.1 },
      { x: -0.62, y: 0.6, z: -back + 2.1 },
    ],
    forward: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    beam,
  };
  const plate = { x: 3.5, y: 2.9, z: 0 };
  const normal = { x: 0, y: 0, z: -1 };
  const driver = { x: 0.35, y: 1.2, z: -back };
  return { lamps, plate, normal, driver };
}

describe("the sheeting's coefficient", () => {
  it("is within a factor 1.35 of every white row of 表2-2-29 (observation × entrance)", () => {
    for (const row of SHEETING_RA.value) {
      const model = RA_PEAK * retroCoefficient(row.obsDeg, row.entDeg);
      const ratio = model / row.white;
      expect(ratio, `${row.obsDeg}° / ${row.entDeg}°: ${model.toFixed(1)} vs ${row.white}`).toBeGreaterThan(
        1 / 1.35,
      );
      expect(ratio).toBeLessThan(1.35);
    }
  });

  it("is 1 at the table's best geometry and falls with both angles", () => {
    expect(retroCoefficient(0.2, 5)).toBeCloseTo(1, 6);
    expect(retroCoefficient(0.1, 0)).toBeCloseTo(1, 6);
    expect(retroCoefficient(1, 5)).toBeLessThan(retroCoefficient(0.5, 5));
    expect(retroCoefficient(0.2, 60)).toBeLessThan(retroCoefficient(0.2, 30));
    expect(retroCoefficient(0.2, 95)).toBe(0);
  });

  it("leaves the colours to the artwork's albedo: its luminance is the table's colour/white ratio within 12 %", () => {
    // Colours of scripts/textures/signs/base.py (別表第二 備考一(三)); 案内標識 blue of guideArt.ts.
    const colours: Array<[string, [number, number, number], "red" | "blue" | "yellow" | "green"]> = [
      ["red", [215, 38, 46], "red"],
      ["blue", [11, 78, 162], "blue"],
      ["yellow", [252, 214, 0], "yellow"],
      ["green", [0, 140, 96], "green"],
      ["guide blue", [29, 79, 156], "blue"],
    ];
    const best = SHEETING_RA.value[0];
    for (const [name, rgb, column] of colours) {
      const ratio = best[column] / best.white;
      expect(luminance(rgb) / ratio, name).toBeGreaterThan(0.88);
      expect(luminance(rgb) / ratio, name).toBeLessThan(1.13);
    }
  });
});

describe("the values the model rests on", () => {
  it("take the model's 1 from the table's best row (0.2°, 5°), not a copy of it", () => {
    expect(RA_PEAK).toBe(SHEETING_RA.value.find((r) => r.obsDeg === 0.2 && r.entDeg === 5)?.white);
  });

  it("keep a white face's brightest return under where the night bloom's knee starts, from the game's own exposure and bloom", () => {
    const exposure = lightBalance(-30, 0).exposure;
    const kneeStart = bloomSettings(1, 0).threshold * (1 - KNEE);
    const brightest = (RETRO_MAX.value + BASE_GLOW.value.plates * NIGHT_BASE.value) * exposure;
    expect(exposure).toBeCloseTo(0.8, 2);
    expect(brightest).toBeLessThan(kneeStart);
  });

  it("are all marked unverified, each with its reason", () => {
    for (const [name, a] of Object.entries(ASSUMPTIONS)) {
      expect(a.verified, name).toBe(false);
      expect(a.reason.length, name).toBeGreaterThan(10);
    }
  });
});

describe("the headlamps' distribution", () => {
  it("keeps the dipped beam low on the oncoming side and raised towards the kerb (左側通行)", () => {
    expect(lampIntensity(0, -2, "low")).toBeGreaterThan(10000);
    expect(lampIntensity(-10, 1, "low")).toBeLessThan(1000);
    expect(lampIntensity(10, 0.5, "low")).toBeGreaterThan(lampIntensity(-10, 0.5, "low") * 5);
  });

  it("throws the main beam far brighter above the horizon than the dipped one", () => {
    expect(lampIntensity(0, 2, "high")).toBeGreaterThan(lampIntensity(0, 2, "low") * 20);
    expect(lampIntensity(0, 0, "high")).toBeCloseTo(LAMP.value.high.peakCd + LAMP.value.high.floorCd, -1);
  });
});

describe("a plate in the player's headlamps", () => {
  it("glows for the driver at 30 m on the dipped beam, more on the main beam", () => {
    const low = scene(30, "low");
    const high = scene(30, "high");
    const lowGlow = retroEmission(retroWhite(low.lamps, low.plate, low.normal, low.driver), 0);
    const highGlow = retroEmission(retroWhite(high.lamps, high.plate, high.normal, high.driver), 0);
    expect(lowGlow).toBeGreaterThan(0.15);
    expect(highGlow).toBeGreaterThan(lowGlow);
  });

  it("never adds more than RETRO_MAX (no white-out), and a wet plate returns less", () => {
    const s = scene(60, "high");
    const L = retroWhite(s.lamps, s.plate, s.normal, s.driver);
    expect(retroEmission(L, 0)).toBeLessThanOrEqual(RETRO_MAX.value);
    expect(retroEmission(1e9, 0)).toBeLessThanOrEqual(RETRO_MAX.value);
    expect(retroEmission(L, 1)).toBeCloseTo(retroEmission(L, 0) * 0.6, 6);
  });

  it("does not glow for an eye far off the lamps (a passer-by's photo at 12 m, 45° aside)", () => {
    const s = scene(30, "high");
    const passerBy = { x: 3.5 + 12 * Math.sin(Math.PI / 4), y: 1.6, z: -12 * Math.cos(Math.PI / 4) };
    const driver = retroEmission(retroWhite(s.lamps, s.plate, s.normal, s.driver), 0);
    const photo = retroEmission(retroWhite(s.lamps, s.plate, s.normal, passerBy), 0);
    expect(photo).toBeLessThan(0.01);
    expect(photo).toBeLessThan(driver / 50);
  });

  it("does not glow out of the beam (the car turned 45° away) nor from behind the plate", () => {
    const s = scene(30, "low");
    const turn = -Math.PI / 4;
    const turned: Lamps = { ...s.lamps, forward: { x: Math.sin(turn), y: 0, z: Math.cos(turn) } };
    // Luminance, before the saturating curve: a tenth of the plate's in the beam.
    const ahead = retroWhite(s.lamps, s.plate, s.normal, s.driver);
    expect(retroWhite(turned, s.plate, s.normal, s.driver)).toBeLessThan(ahead / 10);
    const back = { x: 0, y: 0, z: 1 };
    expect(retroWhite(s.lamps, s.plate, back, s.driver)).toBe(0);
  });
});

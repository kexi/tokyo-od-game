import { describe, expect, it } from "vitest";
import { Color, Matrix3, Vector3 } from "three";
import { acesInverse, displayToRadiance, NEAR_BLACK, RADIANCE_MAX } from "../src/render/untonemapped";
import { bloomSettings, bloomShare } from "../src/world/bloom";

type Rgb = [number, number, number];

// A copy of three r186's acesFilmicToneMapping (nodes/display/ToneMappingFunctions.js) as the
// WebGPU renderer runs it: mat3() with nine numbers is new Matrix3(…), which takes rows; the fit's
// denominator is v·((v + 0.4329510)·0.983729) + 0.238081 as the TSL writes it.
const ACES_IN = new Matrix3(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777);
const ACES_OUT = new Matrix3(
  1.60475,
  -0.53108,
  -0.07367,
  -0.10208,
  1.10813,
  -0.00605,
  -0.00327,
  -0.07276,
  1.07602,
);
const rrtAndOdtFit = (v: number) =>
  (v * (v + 0.0245786) - 0.000090537) / (v * ((v + 0.432951) * 0.983729) + 0.238081);
function threeAces(c: readonly number[], exposure: number): Rgb {
  const v = new Vector3(c[0], c[1], c[2]).multiplyScalar(exposure).divideScalar(0.6).applyMatrix3(ACES_IN);
  const out = new Vector3(rrtAndOdtFit(v.x), rrtAndOdtFit(v.y), rrtAndOdtFit(v.z)).applyMatrix3(ACES_OUT);
  return [out.x, out.y, out.z].map((x) => Math.min(Math.max(x, 0), 1)) as Rgb;
}

/** The canvas value (0…255, before rounding) of a linear colour: three's sRGB transfer. */
const encoded = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
/** The linear colour of a canvas value (0…1). */
const decoded = (e: number) => (e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4));
/** The linear colour of a hex colour, as three's Color reads it (sRGB → linear working space). */
const linear = (hex: number): Rgb => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
/**
 * How close the screen shows a reachable colour, in display steps (1/255). It must be within a
 * step; the inverse is exact, so a hundredth (a whole step would let the GLSL chunk's slightly
 * different fit pass).
 */
const EXACT = 0.01;
/** How far, in display steps, the screen shows the radiance drawn for `want` off `want`. */
function steps(want: Rgb, exposure: number): Rgb {
  const shown = threeAces(displayToRadiance(want, exposure), exposure);
  return shown.map((x, i) => encoded(x) - encoded(want[i])) as Rgb;
}
const worst = (d: readonly number[]) => Math.max(...d.map(Math.abs));
const scaled = (c: Rgb, k: number): Rgb => c.map((x) => x * k) as Rgb;
/** All channels ≥ 0: some radiance shows this colour. */
const isReachable = (want: Rgb) => acesInverse(want).every((x) => x >= 0);

// The lamps (world/trafficControl.ts, world/orbis.ts).
const RED = linear(0xff2a1a);
const AMBER = linear(0xffc21a);
const GREEN = linear(0x19e6b4);
const PED_STOP = linear(0xff3a24);
const LAMP_OFF = linear(0x1d2226);
const ORBIS_RED = linear(0xff3020);
const ORBIS_REST = linear(0x2a0909);
const WHITE: Rgb = [1, 1, 1];
// The lens artwork (assets/signals/textures/lens_led.png): its mean (what a distant lens's mip
// shows) and its diffuser between the LEDs; its LEDs are white (1).
const ARTWORK_MEAN = 0.392;
const DIFFUSER = 0.155;
// The exposure through the day: night 0.8, noon 1, a low sun up to ~1.4 (world/skyLight.ts).
const EXPOSURES = [0.8, 1, 1.4];

describe("a colour shown as it is through the frame's ACES (render/untonemapped.ts)", () => {
  it("shows white, greys, black and the lamps within a display step, at any exposure", () => {
    const colours: Rgb[] = [
      WHITE,
      [0.5, 0.5, 0.5],
      [0.05, 0.05, 0.05],
      [0, 0, 0],
      RED,
      PED_STOP,
      ORBIS_RED,
      ORBIS_REST,
      LAMP_OFF,
      // The green and amber lamps where ACES reaches them: a distant lens, the LEDs' diffuser.
      ...[ARTWORK_MEAN, DIFFUSER, 0.5].flatMap((k) => [scaled(GREEN, k), scaled(AMBER, k)]),
      ...[ARTWORK_MEAN, DIFFUSER].flatMap((k) => [scaled(RED, k), scaled(PED_STOP, k), scaled(LAMP_OFF, k)]),
    ];
    for (const exposure of EXPOSURES)
      for (const c of colours) {
        expect(isReachable(c)).toBe(true);
        expect(worst(steps(c, exposure))).toBeLessThan(EXACT);
      }
  });

  it("shows any colour ACES can reach within a display step (a sweep of 5,000 colours)", () => {
    let seed = 12345;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let reachable = 0;
    for (let i = 0; i < 5000; i++) {
      const want = [random(), random(), random()].map(decoded) as Rgb;
      if (!isReachable(want)) continue;
      reachable++;
      for (const exposure of EXPOSURES) expect(worst(steps(want, exposure))).toBeLessThan(EXACT);
    }
    // Most colours: ACES only loses the most saturated bright ones.
    expect(reachable).toBeGreaterThan(3500);
  });

  it("keeps the lightness of what ACES cannot reach and gives up saturation (the clamp)", () => {
    // The green lamp at the artwork's white needs a negative red radiance, the amber a negative blue.
    expect(acesInverse(GREEN)[0]).toBeLessThan(0);
    expect(acesInverse(AMBER)[2]).toBeLessThan(0);
    // Where it stops being reachable: 57 % and 59 % of their brightness.
    expect(isReachable(scaled(GREEN, 0.56))).toBe(true);
    expect(isReachable(scaled(GREEN, 0.58))).toBe(false);
    expect(isReachable(scaled(AMBER, 0.58))).toBe(true);
    expect(isReachable(scaled(AMBER, 0.6))).toBe(false);
    // Green and blue as wanted, red lifted (paler): (149, 228, 181) for (25, 230, 180).
    const green = steps(GREEN, 1);
    expect(Math.abs(green[1])).toBeLessThan(3);
    expect(Math.abs(green[2])).toBeLessThan(2);
    expect(green[0]).toBeGreaterThan(100);
    const amber = steps(AMBER, 1);
    expect(Math.abs(amber[0])).toBeLessThan(1);
    expect(Math.abs(amber[1])).toBeLessThan(1);
    expect(amber[2]).toBeGreaterThan(40);
  });

  it("never darkens an unreachable colour by more than a few steps: it only pales", () => {
    let seed = 99;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 5000; i++) {
      const want = [random(), random(), random()].map(decoded) as Rgb;
      if (isReachable(want)) continue;
      const d = steps(want, 1);
      const brightest = want.indexOf(Math.max(...want));
      expect(Math.abs(d[brightest])).toBeLessThan(6.5);
      expect(Math.min(...d)).toBeGreaterThan(-6.5);
    }
  });

  it("draws black with no radiance, and fades to it within half a step", () => {
    expect(displayToRadiance([0, 0, 0], 1)).toEqual([0, 0, 0]);
    // The exact inverse of black would be ACES's toe (~0.002 / exposure), over a whole sprite.
    const toe = Math.max(...acesInverse([0, 0, 0]));
    expect(toe).toBeGreaterThan(0.001);
    for (const k of [0.25, 0.5, 0.99, 1, 2])
      for (const exposure of EXPOSURES)
        expect(worst(steps(scaled(ORBIS_RED, k * NEAR_BLACK), exposure))).toBeLessThanOrEqual(0.5);
  });

  it("draws the radiance in proportion to 1 / exposure, the same light once exposed", () => {
    for (const c of [RED, scaled(GREEN, ARTWORK_MEAN), WHITE]) {
      const atOne = displayToRadiance(c, 1);
      const atNight = displayToRadiance(c, 0.8);
      atOne.forEach((x, i) => expect(atNight[i] * 0.8).toBeCloseTo(x, 9));
    }
  });

  it("stays finite: above 1 shows as 1, below 0 as 0, and a zero exposure is capped", () => {
    expect(displayToRadiance([3, 2, 1.5], 1)).toEqual(displayToRadiance(WHITE, 1));
    expect(displayToRadiance([-1, 0, 0], 1)).toEqual([0, 0, 0]);
    // White is ~15 once exposed.
    expect(Math.max(...displayToRadiance(WHITE, 1))).toBeCloseTo(15.16, 1);
    for (const x of displayToRadiance(WHITE, 0)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeLessThanOrEqual(RADIANCE_MAX);
    }
  });
});

/** A lens texel's brightest channel once exposed: what the bloom's prefilter weighs. */
const exposed = (c: Rgb, exposure: number) => Math.max(...displayToRadiance(c, exposure)) * exposure;

describe("the lamps in the bloom (thresholds in exposed radiance, world/bloom.ts)", () => {
  const night = bloomSettings(1, 0).threshold;
  const day = bloomSettings(0, 0).threshold;

  it("spills from a lit lens's LEDs at night, whatever the colour, and never from an unlit one", () => {
    for (const lit of [RED, AMBER, GREEN, PED_STOP, ORBIS_RED]) {
      expect(exposed(lit, 0.8)).toBeGreaterThan(night);
      expect(bloomShare(exposed(lit, 0.8), night)).toBeGreaterThan(0);
    }
    for (const unlit of [LAMP_OFF, ORBIS_REST]) expect(bloomShare(exposed(unlit, 0.8), night)).toBe(0);
  });

  it("does not spill from a lit lens by day; the strobe's white flash does", () => {
    for (const lit of [RED, AMBER, GREEN, PED_STOP]) expect(bloomShare(exposed(lit, 1), day)).toBe(0);
    expect(bloomShare(exposed(WHITE, 1), day)).toBeGreaterThan(0);
  });
});

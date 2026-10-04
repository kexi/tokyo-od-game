import { describe, expect, it } from "vitest";
import { Color, PerspectiveCamera, Scene, type Vector2, Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { GRAPHICS } from "../src/device";
import {
  flareStrength,
  GHOSTS,
  LensFlare,
  PROBE_RADIUS,
  sunOnScreen,
  TAP_RING,
} from "../src/world/lensFlare";

const camera = () => {
  const c = new PerspectiveCamera(60, 16 / 9, 0.5, 40000);
  c.position.set(10, 2, -5);
  c.lookAt(10, 2, -100); // looking north (−z)
  c.updateMatrixWorld();
  return c;
};

describe("the sun on the screen", () => {
  it("is at the centre straight ahead, above it when higher (uv from the top left)", () => {
    const ahead = sunOnScreen(new Vector3(0, 0, -1), camera());
    expect(ahead.isInView).toBe(true);
    expect(ahead.uv.x).toBeCloseTo(0.5, 6);
    expect(ahead.uv.y).toBeCloseTo(0.5, 6);
    const high = sunOnScreen(new Vector3(0, 0.3, -1).normalize(), camera());
    expect(high.isInView).toBe(true);
    expect(high.uv.y).toBeLessThan(0.5);
    const right = sunOnScreen(new Vector3(0.3, 0, -1).normalize(), camera());
    expect(right.uv.x).toBeGreaterThan(0.5);
  });

  it("is not in view behind the eye (whatever the projected z says) or outside the picture", () => {
    expect(sunOnScreen(new Vector3(0, 0, 1), camera()).isInView).toBe(false);
    expect(sunOnScreen(new Vector3(0, 0.2, 1).normalize(), camera()).isInView).toBe(false);
    expect(sunOnScreen(new Vector3(0, 1, -0.2).normalize(), camera()).isInView).toBe(false);
    expect(sunOnScreen(new Vector3(1, 0, -0.1).normalize(), camera()).isInView).toBe(false);
  });
});

describe("how strong the flare is", () => {
  it("follows what the probe saw: none for a hidden sun, full for a clear one", () => {
    expect(flareStrength(0, 40, 0)).toBe(0);
    expect(flareStrength(1, 40, 0)).toBe(1);
    expect(flareStrength(0.5, 40, 0)).toBeCloseTo(0.5, 6);
  });

  it("goes as the disc sinks, and under cloud well before the deck closes", () => {
    expect(flareStrength(1, -1, 0)).toBe(0);
    expect(flareStrength(1, 0.5, 0)).toBeGreaterThan(0);
    expect(flareStrength(1, 0.5, 0)).toBeLessThan(1);
    expect(flareStrength(1, 40, 0.6)).toBe(0);
    expect(flareStrength(1, 40, 1)).toBe(0);
    let last = 1;
    for (let o = 0; o <= 1; o += 0.05) {
      const s = flareStrength(1, 40, o);
      expect(s).toBeLessThanOrEqual(last + 1e-12);
      last = s;
    }
  });
});

describe("the probe and the ghosts", () => {
  it("samples inside the sun disc's full-brightness core (Preetham's disc edge: (cos θ − 0.9999567)·50000 ≥ 1)", () => {
    const core = Math.acos(0.9999566769464484 + 1 / 50000);
    expect(PROBE_RADIUS).toBeLessThan(core);
    expect(PROBE_RADIUS * TAP_RING).toBeLessThan(core);
  });

  it("puts the ghosts on the line through the centre, on both sides of it, none on the sun", () => {
    expect(GHOSTS.some((g) => g.at > 0)).toBe(true);
    expect(GHOSTS.some((g) => g.at < 0)).toBe(true);
    for (const g of GHOSTS) {
      expect(Math.abs(g.at - 1)).toBeGreaterThan(0.2);
      expect(g.radius).toBeGreaterThan(0);
      expect(g.radius).toBeLessThan(0.3);
    }
  });
});

describe("the flare's passes from frame to frame", () => {
  // Only what update() reads of the renderer.
  const renderer = {
    toneMappingExposure: 1,
    getDrawingBufferSize: (v: Vector2) => v.set(1600, 900),
  } as unknown as WebGPURenderer;
  const sun = (direction: Vector3) => ({
    direction,
    elevation: 30,
    overcast: 0,
    color: new Color(1, 1, 1),
    night: 0,
  });

  it("draws and reads the probe while the sun is in view, before any reading has lit the flare", () => {
    GRAPHICS.settings = { ...GRAPHICS.settings, lensFlare: "on" };
    const scene = new Scene();
    const flare = new LensFlare(renderer, scene, null);
    flare.update(camera(), sun(new Vector3(0, 0.3, -1).normalize()));
    // No reading yet, so no flare; but the probe must be drawn and read, or it never would be.
    expect(flare.isActive()).toBe(false);
    expect(flare.reader.isActive()).toBe(true);
    expect(scene.getObjectByName("sun-probe")?.visible).toBe(true);
  });

  it("neither draws nor reads anything for a sun behind the eye, or with レンズフレア なし", () => {
    const scene = new Scene();
    const flare = new LensFlare(renderer, scene, null);
    GRAPHICS.settings = { ...GRAPHICS.settings, lensFlare: "on" };
    flare.update(camera(), sun(new Vector3(0, 0.3, 1).normalize()));
    expect(flare.reader.isActive()).toBe(false);
    GRAPHICS.settings = { ...GRAPHICS.settings, lensFlare: "off" };
    flare.update(camera(), sun(new Vector3(0, 0.3, -1).normalize()));
    expect(flare.reader.isActive()).toBe(false);
    expect(flare.isActive()).toBe(false);
    GRAPHICS.settings = { ...GRAPHICS.settings, lensFlare: "on" };
  });
});

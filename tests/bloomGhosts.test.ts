import { describe, expect, it } from "vitest";
import { GHOST_LEVEL, LAMP_GHOST_TAPS, MODES, ghostSourceUv } from "../src/world/bloom";
import { bloomChain, image, isolatePoints, lampGhostImage, maxIn, type Img } from "./bloomCpu";

/**
 * Offline render tests of the night lens ghosts (bloom.ts) on the CPU copy of the chain: a 640×360
 * picture (a third of 1080p) at the night's threshold (0.55) and exposure (0.8), against the dark
 * haze of a rainy night (0.05). Values are frame radiance before the `ghosts` uniform (0.5 at night).
 */
const W = 640;
const H = 360;
const NIGHT = { threshold: 0.55, exposure: 0.8 };

const fill = (im: Img, x0: number, y0: number, w: number, h: number, v: number) => {
  for (let j = y0; j < y0 + h; j++) for (let i = x0; i < x0 + w; i++) im.d[j * im.w + i] = v;
};
/** A picture with things drawn on the night haze, through the chain of a 光のにじみ mode. */
const ghostLevel = (draw: (im: Img) => void, mode: (typeof MODES)[keyof typeof MODES] = MODES.high) => {
  const street = image(W, H, 0.05);
  draw(street);
  const levels = bloomChain(street, mode, NIGHT.threshold, NIGHT.exposure);
  return levels[Math.min(GHOST_LEVEL, levels.length - 1)];
};
/** A floodlit tower straight ahead, its top above the centre (the far Tokyo Tower: ~1.3). */
const tower = (im: Img) => fill(im, 318, 60, 5, 150, 1.3);
/** A street lamp's head (radiance 10, 4 px) at (200, 250) px, lower left of the centre. */
const lamp = (im: Img) => fill(im, 198, 248, 4, 4, 10);
/** The old taps: magnifications −1, −1.43, −2.5 and −10 (dispersal 0.3, four ghosts). */
const OLD_TAPS = [0, 1, 2, 3].map((i) => ({ scale: 1 / (0.3 * i - 1), tint: LAMP_GHOST_TAPS[i].tint }));

describe("the night lamps' ghosts", () => {
  it("were an upside-down glowing column under a lit tower (the reported look)", () => {
    const ghosts = lampGhostImage(ghostLevel(tower), W, H, OLD_TAPS);
    // Below the centre, in the tower's column: brighter than the haze it was drawn on (×0.5 at night).
    expect(maxIn(ghosts, 0.45, 0.6, 0.55, 1) * 0.5).toBeGreaterThan(0.2);
    // The tenfold ghost spread it over the whole height of the picture.
    expect(maxIn(ghosts, 0.45, 0.9, 0.55, 1)).toBeGreaterThan(0.1);
  });

  it("are not drawn for a lit tower, a lit wall or a row of lamps on either 光のにじみ mode", () => {
    const shapes: Array<(im: Img) => void> = [
      tower,
      (im) => fill(im, 400, 60, 5, 150, 1.3),
      (im) => fill(im, 260, 120, 120, 80, 1.3),
      (im) => {
        for (let k = 0; k < 12; k++) fill(im, 100 + k * 12, 250, 2, 2, 10);
      },
    ];
    for (const mode of Object.values(MODES))
      for (const draw of shapes) {
        const ghosts = lampGhostImage(isolatePoints(ghostLevel(draw, mode)), W, H);
        expect(maxIn(ghosts, 0, 0, 1, 1)).toBeLessThan(1e-3);
      }
  });

  it("still mirror a street lamp through the centre, as large as before", () => {
    const level = ghostLevel(lamp);
    const ghosts = lampGhostImage(isolatePoints(level), W, H);
    const old = lampGhostImage(level, W, H, OLD_TAPS);
    // The lamp at (200, 250) px: its plain mirror image is at (440, 110), up and to the right.
    expect(maxIn(ghosts, 0.66, 0.26, 0.72, 0.36)).toBeGreaterThan(0.02);
    expect(maxIn(ghosts, 0, 0, 1, 1)).toBeGreaterThan(0.8 * maxIn(old, 0, 0, 1, 1));
    // Nothing on the lamp's own side of the picture's lower half.
    expect(maxIn(ghosts, 0, 0.55, 0.5, 1)).toBeLessThan(1e-3);
  });

  it("magnify a light at most 1.4 times, through the centre", () => {
    for (const { scale } of LAMP_GHOST_TAPS) {
      expect(scale).toBeLessThan(0);
      expect(Math.abs(scale)).toBeLessThanOrEqual(1.4);
    }
    // uv from the top left: the plain ghost of a light up and to the left is down and to the right.
    const [u, v] = ghostSourceUv(0.7, 0.8, -1);
    expect(u).toBeCloseTo(0.3, 9);
    expect(v).toBeCloseTo(0.2, 9);
  });
});

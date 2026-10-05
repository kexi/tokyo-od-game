/**
 * A CPU copy of the bloom chain in src/world/bloom.ts (prefilter, dual-filter down and up, the
 * lamps' ghosts), one channel, for offline render tests: a picture is pushed through the same taps,
 * weights and texel offsets the shaders use, and the result read back as numbers. Textures are
 * sampled as the GPU's bilinear filter with clamp-to-edge does, uv with the origin at the top left
 * (screenUV and the targets' rows agree on both backends, so one convention covers both).
 */
import {
  CAP,
  ISOLATION_STEP,
  KNEE,
  LAMP_GHOST_TAPS,
  ghostIsolation,
  ghostSourceUv,
} from "../src/world/bloom";

export type Img = { w: number; h: number; d: Float32Array };

export const image = (w: number, h: number, fill = 0): Img => ({
  w,
  h,
  d: new Float32Array(w * h).fill(fill),
});

/** Bilinear sample at uv (texel centres at (i + 0.5) / w), clamped to the edge. */
export function sample(im: Img, u: number, v: number): number {
  const x = u * im.w - 0.5;
  const y = v * im.h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const at = (i: number, j: number) => {
    const ci = Math.min(im.w - 1, Math.max(0, i));
    const cj = Math.min(im.h - 1, Math.max(0, j));
    return im.d[cj * im.w + ci];
  };
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

const each = (im: Img, fn: (u: number, v: number) => number): Img => {
  for (let j = 0; j < im.h; j++)
    for (let i = 0; i < im.w; i++) im.d[j * im.w + i] = fn((i + 0.5) / im.w, (j + 0.5) / im.h);
  return im;
};

/** bloom.ts buildPrefilter: four taps a full-resolution texel off each corner, knee, Karis average. */
function prefilter(src: Img, w: number, h: number, threshold: number, exposure: number): Img {
  const knee = threshold * KNEE;
  const k = { x: threshold, y: threshold - knee, z: 2 * knee, w: 0.25 / knee };
  return each(image(w, h), (u, v) => {
    let sum = 0;
    let weights = 0;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const c = Math.max(sample(src, u + dx / src.w, v + dy / src.h), 0);
      const bright = c * exposure;
      const held = Math.min(bright, CAP);
      const soft = Math.min(Math.max(held - k.y, 0), k.z);
      const curve = Math.max(soft * soft * k.w, held - k.x);
      const contribution = c * (curve / Math.max(bright, 1e-4));
      const weight = 1 / (contribution * exposure + 1);
      sum += contribution * weight;
      weights += weight;
    }
    return sum / Math.max(weights, 1e-4);
  });
}

/** bloom.ts buildDown: the centre four times and the four diagonals, an eighth each. */
function down(src: Img, w: number, h: number): Img {
  const t = { x: 1 / src.w, y: 1 / src.h };
  return each(image(w, h), (u, v) => {
    const at = (x: number, y: number) => sample(src, u + t.x * x, v + t.y * y);
    return (at(0, 0) * 4 + at(-1, -1) + at(1, 1) + at(1, -1) + at(-1, 1)) * 0.125;
  });
}

/** bloom.ts buildUp, blended additively onto the next larger level. */
function upOnto(src: Img, target: Img): void {
  const t = { x: 1 / src.w, y: 1 / src.h };
  for (let j = 0; j < target.h; j++)
    for (let i = 0; i < target.w; i++) {
      const u = (i + 0.5) / target.w;
      const v = (j + 0.5) / target.h;
      const at = (x: number, y: number) => sample(src, u + t.x * x, v + t.y * y);
      const edges = at(-2, 0) + at(2, 0) + at(0, -2) + at(0, 2);
      const corners = (at(1, 1) + at(-1, -1) + at(1, -1) + at(-1, 1)) * 2;
      target.d[j * target.w + i] += (edges + corners) / 12;
    }
}

/** Bloom.prepare: the levels after the down and up passes (level 0 is the sum the street adds). */
export function bloomChain(
  street: Img,
  mode: { first: number; levels: number },
  threshold: number,
  exposure: number,
): Img[] {
  const size = (i: number) => ({
    w: Math.max(1, Math.round(street.w / (mode.first * 2 ** i))),
    h: Math.max(1, Math.round(street.h / (mode.first * 2 ** i))),
  });
  const levels = [prefilter(street, size(0).w, size(0).h, threshold, exposure)];
  for (let i = 1; i < mode.levels; i++) levels.push(down(levels[i - 1], size(i).w, size(i).h));
  for (let i = mode.levels - 1; i > 0; i--) upOnto(levels[i], levels[i - 1]);
  return levels;
}

/** bloom.ts buildIsolate: the ghost level kept where a light outshines its four neighbours. */
export function isolatePoints(level: Img): Img {
  const tx = ISOLATION_STEP / level.w;
  const ty = ISOLATION_STEP / level.h;
  return each(image(level.w, level.h), (u, v) => {
    const light = sample(level, u, v);
    const neighbour = Math.max(
      sample(level, u + tx, v),
      sample(level, u - tx, v),
      sample(level, u, v + ty),
      sample(level, u, v - ty),
    );
    return light * ghostIsolation(light, neighbour);
  });
}

/**
 * bloom.ts lampGhosts at full resolution: `source` (the isolated points, or for the old version the
 * ghost level itself) sampled through each tap's mirror and scale, faded towards the edge.
 */
export function lampGhostImage(
  source: Img,
  width: number,
  height: number,
  taps: ReadonlyArray<{ scale: number; tint: readonly [number, number, number] }> = LAMP_GHOST_TAPS,
): Img {
  return each(image(width, height), (u, v) => {
    let sum = 0;
    for (const tap of taps) {
      const [su, sv] = ghostSourceUv(u, v, tap.scale);
      const r = Math.hypot(su - 0.5, sv - 0.5) / Math.SQRT1_2;
      const fade = Math.max(1 - r, 0) ** 6;
      // One channel: the tint's brightest component (the shader multiplies each channel).
      sum += sample(source, su, sv) * fade * Math.max(...tap.tint);
    }
    return sum;
  });
}

/** Largest value inside a box of uv (x0, y0)–(x1, y1). */
export function maxIn(im: Img, x0: number, y0: number, x1: number, y1: number): number {
  let m = 0;
  for (let j = Math.floor(y0 * im.h); j < Math.ceil(y1 * im.h); j++)
    for (let i = Math.floor(x0 * im.w); i < Math.ceil(x1 * im.w); i++) m = Math.max(m, im.d[j * im.w + i]);
  return m;
}

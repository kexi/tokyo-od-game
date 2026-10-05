import type { WaterPolygon } from "./waterGeometry";

export type WaterMasks = { raster: Uint8Array; cut: Uint8Array };

/** The worker and the frame-sliced fallback use identical operations in the same order. */
export function* waterMaskSteps(
  polygons: WaterPolygon[],
  x: number,
  y: number,
  size: number,
): Generator<void, WaterMasks> {
  yield;
  const isEmpty = polygons.length === 0;
  if (isEmpty) return { raster: new Uint8Array(size * size), cut: new Uint8Array(size * size) };
  const raster = yield* rasterizeSteps(polygons, x, y, 1, size);
  const mask = yield* coverageSteps(polygons, x, y, 1, size);
  const cut = yield* dilateSteps(mask, size);
  return { raster, cut };
}

/**
 * Even–odd raster of the polygons over the square [x0, x0 + span]² (global units), `size` pixels a
 * side, 1 where a pixel's centre is water. Scanline fill: each row crosses every edge once at most.
 */
export function rasterize(
  polys: WaterPolygon[],
  x0: number,
  y0: number,
  span: number,
  size: number,
): Uint8Array {
  const steps = rasterizeSteps(polys, x0, y0, span, size);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}

export function* rasterizeSteps(
  polys: WaterPolygon[],
  x0: number,
  y0: number,
  span: number,
  size: number,
): Generator<void, Uint8Array> {
  const out = new Uint8Array(size * size);
  const px = span / size;
  const xs: number[] = [];
  for (let j = 0; j < size; j++) {
    yield;
    const y = y0 + (j + 0.5) * px;
    xs.length = 0;
    for (const poly of polys) {
      for (const ring of poly) {
        const n = ring.length / 2;
        for (let i = 0, k = n - 1; i < n; k = i++) {
          const ay = ring[i * 2 + 1];
          const by = ring[k * 2 + 1];
          const isCrossing = ay > y !== by > y;
          if (!isCrossing) continue;
          const ax = ring[i * 2];
          const bx = ring[k * 2];
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * size;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel centres x0 + (i + 0.5)·px inside [xa, xb).
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / px - 0.5));
      const i1 = Math.min(size - 1, Math.ceil((xs[k + 1] - x0) / px - 0.5) - 1);
      for (let i = i0; i <= i1; i++) out[row + i] = 1;
    }
  }
  return out;
}

/**
 * Anti-aliased raster (0–255 = share of the pixel that is water), `sub` scanlines per pixel with exact
 * horizontal coverage. The ground's cut-out is drawn from it with bilinear filtering and a 50 %
 * threshold, which puts the cut on the shore to a fraction of a pixel instead of in 1 m steps.
 */
export function coverage(
  polys: WaterPolygon[],
  x0: number,
  y0: number,
  span: number,
  size: number,
  sub = 4,
): Uint8Array {
  const steps = coverageSteps(polys, x0, y0, span, size, sub);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}

export function* coverageSteps(
  polys: WaterPolygon[],
  x0: number,
  y0: number,
  span: number,
  size: number,
  sub = 4,
): Generator<void, Uint8Array> {
  const px = span / size;
  const acc = new Float32Array(size * size);
  const xs: number[] = [];
  for (let j = 0; j < size; j++) {
    yield;
    for (let r = 0; r < sub; r++) {
      const y = y0 + (j + (r + 0.5) / sub) * px;
      xs.length = 0;
      for (const poly of polys) {
        for (const ring of poly) {
          const n = ring.length / 2;
          for (let i = 0, k = n - 1; i < n; k = i++) {
            const ay = ring[i * 2 + 1];
            const by = ring[k * 2 + 1];
            if (ay > y === by > y) continue;
            xs.push(ring[i * 2] + ((y - ay) / (by - ay)) * (ring[k * 2] - ring[i * 2]));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // The run [xa, xb) in pixel units, clamped to the raster.
        const xa = Math.max(0, (xs[k] - x0) / px);
        const xb = Math.min(size, (xs[k + 1] - x0) / px);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.min(size - 1, Math.floor(xb));
        const row = j * size;
        if (ia === ib) {
          acc[row + ia] += (xb - xa) / sub;
          continue;
        }
        acc[row + ia] += (ia + 1 - xa) / sub;
        for (let i = ia + 1; i < ib; i++) acc[row + i] += 1 / sub;
        if (ib < size) acc[row + ib] += (xb - ib) / sub;
      }
    }
  }
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    yield;
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      out[k] = Math.round(Math.min(1, acc[k]) * 255);
    }
  }
  return out;
}

/**
 * Grow the water by one pixel (each pixel takes the most water of itself and its 4 neighbours), so
 * the ground's cut-out reaches just past the shore wall: from the water the wall's face then stands
 * in front of the cut, and from the land the gap shows the wall's own top. Why not cut inside the
 * wall (erode): on a steep bank the ground left over the water is a sloped lip that shows above the
 * wall (神田川 at 御茶ノ水).
 */
export function dilate(mask: Uint8Array, size: number): Uint8Array {
  const steps = dilateSteps(mask, size);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}

export function* dilateSteps(mask: Uint8Array, size: number): Generator<void, Uint8Array> {
  const out = mask.slice();
  for (let j = 0; j < size; j++) {
    yield;
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let v = mask[k];
      if (i > 0) v = Math.max(v, mask[k - 1]);
      if (i < size - 1) v = Math.max(v, mask[k + 1]);
      if (j > 0) v = Math.max(v, mask[k - size]);
      if (j < size - 1) v = Math.max(v, mask[k + size]);
      out[k] = v;
    }
  }
  return out;
}

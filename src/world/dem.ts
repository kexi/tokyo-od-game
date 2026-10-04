import { GSI, TERRAIN_ZOOM } from "../config";
import type { Geoid } from "../geo/geoid";
import { decodeGsiDem, latToTileY, lonToTileX } from "../geo/tiles";

const SIZE = 256;

async function fetchPixels(url: string): Promise<Uint8ClampedArray | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  // Colour management or premultiplication would corrupt the packed elevation bits.
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function decodeTile(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) {
    out[i] = decodeGsiDem(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  return out;
}

/**
 * Orthometric elevation store backed by GSI DEM5A (5 m, z15) with DEM10B (z14) as the fallback
 * for tiles/pixels DEM5A lacks (water, gaps). Remaining holes are treated as sea level.
 */
export class DemStore {
  private readonly pending = new Map<string, Promise<Float32Array>>();
  private readonly loaded = new Map<string, Float32Array>();
  private readonly coarse = new Map<string, Promise<Float32Array | null>>();

  constructor(private readonly geoid: Geoid) {}

  load(x: number, y: number): Promise<Float32Array> {
    const key = `${x}/${y}`;
    let p = this.pending.get(key);
    if (!p) {
      p = this.fetchTile(x, y).then((data) => {
        this.loaded.set(key, data);
        return data;
      });
      this.pending.set(key, p);
    }
    return p;
  }

  isLoaded(x: number, y: number): boolean {
    return this.loaded.has(`${x}/${y}`);
  }

  /** Bilinear orthometric height at global z15 pixel coordinates (pixel-corner convention). */
  sampleGlobal(gx: number, gy: number): number {
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const a = this.pixel(x0, y0);
    const b = this.pixel(x0 + 1, y0);
    const c = this.pixel(x0, y0 + 1);
    const d = this.pixel(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** WGS84 ellipsoidal ground height, or null when the covering tile is not loaded yet. */
  heightAt(lat: number, lon: number): number | null {
    const gx = lonToTileX(lon, TERRAIN_ZOOM) * SIZE;
    const gy = latToTileY(lat, TERRAIN_ZOOM) * SIZE;
    const isReady = this.isLoaded(Math.floor(gx / SIZE), Math.floor(gy / SIZE));
    if (!isReady) return null;
    return this.sampleGlobal(gx, gy) + this.geoid.undulation(lat, lon);
  }

  ellipsoidal(lat: number, lon: number, orthometric: number): number {
    return orthometric + this.geoid.undulation(lat, lon);
  }

  private pixel(gx: number, gy: number): number {
    const tile = this.loaded.get(`${Math.floor(gx / SIZE)}/${Math.floor(gy / SIZE)}`);
    if (!tile) return 0;
    const px = ((gx % SIZE) + SIZE) % SIZE;
    const py = ((gy % SIZE) + SIZE) % SIZE;
    return tile[py * SIZE + px];
  }

  private async fetchTile(x: number, y: number): Promise<Float32Array> {
    return smoothGround(await this.fetchRaw(x, y));
  }

  private async fetchRaw(x: number, y: number): Promise<Float32Array> {
    const z = TERRAIN_ZOOM;
    const fine = await fetchPixels(GSI.dem5a(z, x, y)).catch(() => null);
    const data = fine ? decodeTile(fine) : new Float32Array(SIZE * SIZE).fill(Number.NaN);
    const hasHoles = data.some((v) => Number.isNaN(v));
    if (!hasHoles) return data;

    const coarse = await this.loadCoarse(x >> 1, y >> 1);
    const ox = (x & 1) * (SIZE / 2);
    const oy = (y & 1) * (SIZE / 2);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const idx = j * SIZE + i;
        if (!Number.isNaN(data[idx])) continue;
        const fallback = coarse ? coarse[(oy + (j >> 1)) * SIZE + ox + (i >> 1)] : Number.NaN;
        data[idx] = Number.isNaN(fallback) ? 0 : fallback;
      }
    }
    return data;
  }

  private loadCoarse(x: number, y: number): Promise<Float32Array | null> {
    const key = `${x}/${y}`;
    let p = this.coarse.get(key);
    if (!p) {
      p = fetchPixels(GSI.dem10(TERRAIN_ZOOM - 1, x, y))
        .then((rgba) => (rgba ? decodeTile(rgba) : null))
        .catch(() => null);
      this.coarse.set(key, p);
    }
    return p;
  }
}

/**
 * DEM5A in the city is laser ground points with buildings removed; where few ground points
 * survive (beside buildings, under elevated roads) the interpolation leaves 1–1.5 m lumps and
 * pits that read as a bumpy pavement in the game. A 5×5 median (~20 m at z15) removes those
 * while keeping real steps such as moat walls and embankments sharp; a 3×3 binomial pass then
 * softens the median's terraces. Why not a plain Gaussian: it would smear the lumps into wider
 * swells and round off the steps.
 */
export function smoothGround(src: Float32Array): Float32Array {
  const median = new Float32Array(SIZE * SIZE);
  const window = new Float32Array(25);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.min(SIZE - 1, Math.max(0, y + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const xx = Math.min(SIZE - 1, Math.max(0, x + dx));
          window[n++] = src[yy * SIZE + xx];
        }
      }
      window.sort();
      median[y * SIZE + x] = window[12];
    }
  }
  const out = new Float32Array(SIZE * SIZE);
  const kernel = [1, 2, 1];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(SIZE - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(SIZE - 1, Math.max(0, x + dx));
          sum += median[yy * SIZE + xx] * kernel[dx + 1] * kernel[dy + 1];
        }
      }
      out[y * SIZE + x] = sum / 16;
    }
  }
  return out;
}

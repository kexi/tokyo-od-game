import { GSI, TERRAIN_SEGMENTS, TERRAIN_ZOOM } from "../config";
import type { Geoid } from "../geo/geoid";
import { decodeGsiDem, latToTileY, lonToTileX } from "../geo/tiles";

import { DemCompute } from "./demCompute";
import type { TerrainInput } from "./terrainData";
export { parseDemText, smoothGround } from "./demData";

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
  private readonly compute = new DemCompute();
  private readonly pending = new Map<string, Promise<Float32Array>>();
  private readonly loaded = new Map<string, Float32Array>();
  /** DEM5A's text edition (NaN where it has no value), for reading surveyed water surfaces. */
  private readonly surveyed = new Map<string, Promise<Float32Array | null>>();
  private readonly surveyedReady = new Map<string, Float32Array | null>();
  private surveyedTile: { x: number; y: number; data: Float32Array } | null = null;
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

  /** The east/south tiles supply the bilinear samples at the chunk's outer corners. */
  async loadTerrainInput(x: number, y: number): Promise<TerrainInput> {
    const tiles = await Promise.all([
      this.load(x, y),
      this.load(x + 1, y),
      this.load(x, y + 1),
      this.load(x + 1, y + 1),
    ]);
    return { x, y, zoom: TERRAIN_ZOOM, segments: TERRAIN_SEGMENTS, tiles, geoid: this.geoid.snapshot() };
  }

  /** Bilinear orthometric height at global z15 pixel coordinates (pixel-corner convention). */
  sampleGlobal(gx: number, gy: number): number {
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const px = ((x0 % SIZE) + SIZE) % SIZE;
    const py = ((y0 % SIZE) + SIZE) % SIZE;
    const crossesTile = px === SIZE - 1 || py === SIZE - 1;
    let a: number, b: number, c: number, d: number;
    if (crossesTile) {
      a = this.pixel(x0, y0);
      b = this.pixel(x0 + 1, y0);
      c = this.pixel(x0, y0 + 1);
      d = this.pixel(x0 + 1, y0 + 1);
    } else {
      // Query the live store rather than caching a missing tile across its eventual arrival.
      const tile = this.loaded.get(`${Math.floor(x0 / SIZE)}/${Math.floor(y0 / SIZE)}`);
      const isMissing = !tile;
      if (isMissing) {
        a = b = c = d = 0;
      } else {
        const i = py * SIZE + px;
        a = tile![i];
        b = tile![i + 1];
        c = tile![i + SIZE];
        d = tile![i + SIZE + 1];
      }
    }
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

  /**
   * Load DEM5A's text edition of a z15 tile (CORS *, ~75 KB gzipped). Why not the PNG the ground is
   * built from: its 2026 edition leaves water blank (日本橋川, 神田川 at 御茶ノ水), while the text
   * edition (2025) still carries the water surface the laser survey measured.
   */
  loadSurveyed(x: number, y: number): Promise<Float32Array | null> {
    const key = `${x}/${y}`;
    let p = this.surveyed.get(key);
    if (!p) {
      p = fetch(GSI.dem5aText(TERRAIN_ZOOM, x, y))
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => (text === null ? null : this.compute.parse(text)))
        .catch(() => null)
        .then((tile) => {
          this.surveyedReady.set(key, tile);
          this.surveyedTile = null;
          return tile;
        });
      this.surveyed.set(key, p);
    }
    return p;
  }

  /**
   * DEM5A as surveyed at global z15 pixel coordinates (nearest pixel, T.P. m): NaN where it has no
   * value or the tile is not loaded (loadSurveyed). Unlike sampleGlobal it is neither filled nor
   * smoothed, so channels narrower than the median window keep their surveyed water surface.
   */
  surveyedAt(gx: number, gy: number): number {
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    const tx = Math.floor(x / SIZE);
    const ty = Math.floor(y / SIZE);
    const sameTile = this.surveyedTile?.x === tx && this.surveyedTile.y === ty;
    const tile = sameTile ? this.surveyedTile!.data : this.surveyedReady.get(`${tx}/${ty}`);
    const isMissing = !tile;
    if (isMissing) return Number.NaN;
    const needsRemembering = !sameTile;
    if (needsRemembering) this.surveyedTile = { x: tx, y: ty, data: tile! };
    return tile![(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
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
    return this.compute.smooth(await this.fetchRaw(x, y));
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

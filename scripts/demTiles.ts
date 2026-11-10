// The ground the game stands on, at build time: GSI DEM5A PNG (z15) with DEM10B (z14) where DEM5A
// has no value and 0 (sea level) where neither has, the 5×5 median + 3×3 binomial of
// src/world/demData.ts per tile, and the same bilinear sampling as src/world/dem.ts. So an
// elevation fixed here is the height the game's terrain has at that point (orthometric, T.P.;
// the game adds the geoid). Tiles are cached under .cache/gsi-dem and fetched one at a time.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GSI, TERRAIN_ZOOM } from "../src/config.ts";
import { decodeGsiDem, latToTileY, lonToTileX } from "../src/geo/tiles.ts";
import { smoothGround } from "../src/world/demData.ts";
import { log } from "../src/log.ts";
import { decodePng } from "./png.ts";

const SIZE = 256;
const CACHE = join(import.meta.dirname, "..", ".cache", "gsi-dem");
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";

/** Network requests made (cache misses), for the build log. */
let requests = 0;

async function cachedPng(url: string, file: string): Promise<Uint8Array | null> {
  const path = join(CACHE, file);
  try {
    const bytes = new Uint8Array(await readFile(path));
    return bytes.length === 0 ? null : bytes;
  } catch {
    // not cached yet
  }
  for (let attempt = 1; ; attempt++) {
    try {
      requests++;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      const isMissing = res.status === 404;
      const bytes = isMissing ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
      if (!res.ok && !isMissing) throw new Error(`HTTP ${res.status}`);
      await mkdir(CACHE, { recursive: true });
      // An empty file remembers a tile GSI does not have (sea), so it is not asked again.
      await writeFile(path, bytes);
      return isMissing ? null : bytes;
    } catch (error) {
      if (attempt >= 4) throw new Error(`${url}: ${String(error)}`, { cause: error });
      log("fetch_retry", { url, attempt, error: String(error) });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

function decodeTile(png: Uint8Array): Float32Array {
  const { data } = decodePng(png);
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = decodeGsiDem(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return out;
}

export class BuildDem {
  private readonly tiles = new Map<string, Float32Array>();
  private readonly coarse = new Map<string, Float32Array | null>();

  /** Tiles requested from GSI so far (the rest came from .cache/gsi-dem). */
  get fetched(): number {
    return requests;
  }

  /** Load every z15 tile the points (and the pixel to their right/below) fall in. */
  async prefetch(points: Array<[number, number]>): Promise<number> {
    const keys = new Set<string>();
    for (const [lon, lat] of points) {
      const gx = lonToTileX(lon, TERRAIN_ZOOM) * SIZE;
      const gy = latToTileY(lat, TERRAIN_ZOOM) * SIZE;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ])
        keys.add(`${Math.floor((Math.floor(gx) + dx) / SIZE)}/${Math.floor((Math.floor(gy) + dy) / SIZE)}`);
    }
    for (const key of [...keys].sort()) {
      if (this.tiles.has(key)) continue;
      const [x, y] = key.split("/").map(Number);
      this.tiles.set(key, smoothGround(await this.raw(x, y)));
    }
    return keys.size;
  }

  /** Orthometric height (T.P. m), bilinear at global z15 pixel coordinates like DemStore.sampleGlobal. */
  heightAt(lon: number, lat: number): number {
    const gx = lonToTileX(lon, TERRAIN_ZOOM) * SIZE;
    const gy = latToTileY(lat, TERRAIN_ZOOM) * SIZE;
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

  private pixel(gx: number, gy: number): number {
    const tile = this.tiles.get(`${Math.floor(gx / SIZE)}/${Math.floor(gy / SIZE)}`);
    if (!tile) throw new Error(`DEM tile for pixel ${gx},${gy} was not prefetched`);
    return tile[(((gy % SIZE) + SIZE) % SIZE) * SIZE + (((gx % SIZE) + SIZE) % SIZE)];
  }

  private async raw(x: number, y: number): Promise<Float32Array> {
    const z = TERRAIN_ZOOM;
    const png = await cachedPng(GSI.dem5a(z, x, y), `dem5a-${z}-${x}-${y}.png`);
    const data = png ? decodeTile(png) : new Float32Array(SIZE * SIZE).fill(Number.NaN);
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

  private async loadCoarse(x: number, y: number): Promise<Float32Array | null> {
    const key = `${x}/${y}`;
    if (this.coarse.has(key)) return this.coarse.get(key)!;
    const z = TERRAIN_ZOOM - 1;
    const png = await cachedPng(GSI.dem10(z, x, y), `dem10b-${z}-${x}-${y}.png`);
    const tile = png ? decodeTile(png) : null;
    this.coarse.set(key, tile);
    return tile;
  }
}

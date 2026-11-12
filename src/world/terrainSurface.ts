import { TERRAIN_SEGMENTS, TERRAIN_ZOOM } from "../config";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";

const S = TERRAIN_SEGMENTS;

/** The streets' asphalt over the drawn ground (roadSurface.ts), which the collider and renderer share. */
export const STREET_LIFT_M = 0.1;

/** Whatever answers the DEM's bilinear orthometric height at global z15 pixels (DemStore, or a build-time DEM). */
export type DemSampler = { sampleGlobal(gx: number, gy: number): number };

/**
 * Height (T.P. m) of the drawn ground at a point: the chunks' grid triangles (TERRAIN_SEGMENTS per
 * z15 tile, ~15 m), which is what a wall must meet, rather than the 5 m DEM between grid points.
 * Pure (no scene, no browser): scripts/expresswayTerrainProbe.ts reads the game's ground with it.
 * Why not in terrain.ts as before: that module pulls in the renderer and Vite's globs, which a
 * script run by tsx cannot load.
 */
export function meshHeightAt(dem: DemSampler, lat: number, lon: number): number {
  const gi = lonToTileX(lon, TERRAIN_ZOOM) * S;
  const gj = latToTileY(lat, TERRAIN_ZOOM) * S;
  const i0 = Math.floor(gi);
  const j0 = Math.floor(gj);
  const u = gi - i0;
  const v = gj - j0;
  const h = (i: number, j: number) => dem.sampleGlobal((i / S) * 256, (j / S) * 256);
  // Each cell is split along its b–c diagonal (see terrain.ts buildChunk): corner a = (i, j) on one side.
  const isNearA = u + v <= 1;
  if (isNearA) {
    const a = h(i0, j0);
    return a + u * (h(i0 + 1, j0) - a) + v * (h(i0, j0 + 1) - a);
  }
  const d = h(i0 + 1, j0 + 1);
  return d + (1 - u) * (h(i0, j0 + 1) - d) + (1 - v) * (h(i0 + 1, j0) - d);
}

/**
 * The drawn terrain (its grid triangles, as meshHeightAt) from a sampler of the DEM's bilinear
 * height at any point (DemStore.heightAt: ellipsoidal, null where not loaded), read at the grid's
 * vertices. The geoid is taken at each vertex, which over a 15.5 m cell is the same to well under a
 * millimetre. Why from the sampler: the decks get only that (main.ts), not the DemStore.
 */
export function meshOf(
  heightAt: (lat: number, lon: number) => number | null,
): (lat: number, lon: number) => number | null {
  return (lat, lon) => {
    const gi = lonToTileX(lon, TERRAIN_ZOOM) * S;
    const gj = latToTileY(lat, TERRAIN_ZOOM) * S;
    const i0 = Math.floor(gi);
    const j0 = Math.floor(gj);
    const u = gi - i0;
    const v = gj - j0;
    const h = (i: number, j: number) =>
      heightAt(tileYToLat(j / S, TERRAIN_ZOOM), tileXToLon(i / S, TERRAIN_ZOOM));
    const isNearA = u + v <= 1;
    const corner = isNearA
      ? [h(i0, j0), h(i0 + 1, j0), h(i0, j0 + 1)]
      : [h(i0 + 1, j0 + 1), h(i0, j0 + 1), h(i0 + 1, j0)];
    if (corner.some((c) => c === null)) return null;
    const [a, b, c] = corner as number[];
    return isNearA ? a + u * (b - a) + v * (c - a) : a + (1 - u) * (b - a) + (1 - v) * (c - a);
  };
}

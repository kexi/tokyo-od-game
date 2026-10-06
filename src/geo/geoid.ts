import { GEOID_FALLBACK } from "../config";
import type { GeoidGrid } from "../data/schema";

/**
 * Geoid undulation (ellipsoid height − orthometric height). PLATEAU 3D Tiles sit on WGS84
 * ellipsoidal heights while GSI DEM tiles are orthometric (Tokyo Bay mean sea level), so the
 * ground must be lifted by N (~36–37 m in Tokyo) or every building floats/sinks.
 * The grid is precomputed at build time because the GSI geoid API does not allow CORS.
 */
export class Geoid {
  constructor(private readonly grid: GeoidGrid | null) {}

  snapshot(): GeoidGrid | null {
    const grid = this.grid;
    const isMissing = !grid;
    if (isMissing) return null;
    return { ...grid, values: grid.values.slice() };
  }

  undulation(lat: number, lon: number): number {
    const g = this.grid;
    if (!g) return GEOID_FALLBACK;
    const fy = Math.min(Math.max((lat - g.lat0) / g.dLat, 0), g.nLat - 1);
    const fx = Math.min(Math.max((lon - g.lon0) / g.dLon, 0), g.nLon - 1);
    const y0 = Math.min(Math.floor(fy), g.nLat - 2);
    const x0 = Math.min(Math.floor(fx), g.nLon - 2);
    const ty = fy - y0;
    const tx = fx - x0;
    const v = (iy: number, ix: number) => g.values[iy * g.nLon + ix];
    const top = v(y0, x0) * (1 - tx) + v(y0, x0 + 1) * tx;
    const bottom = v(y0 + 1, x0) * (1 - tx) + v(y0 + 1, x0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }
}

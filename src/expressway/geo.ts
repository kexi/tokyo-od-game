/**
 * A local east/north plane in metres around a fixed origin (equirectangular on the WGS84 sphere of
 * radius R). Each alignment chain gets its own origin (its first node), so a chain's geometry does
 * not depend on which other chains were loaded, and within a chain (≤ ~15 km) the scale error
 * stays under 0.01 %. Why not one plane for all Tokyo: 0.15 % scale error at the ward edges would
 * leak into grades and radii checked against the statute.
 */

const R = 6371008.8;
const DEG = Math.PI / 180;

export type Plane = {
  readonly lon0: number;
  readonly lat0: number;
  toXY(lon: number, lat: number): [number, number];
  toLonLat(x: number, y: number): [number, number];
};

export function planeAt(lon0: number, lat0: number): Plane {
  const kx = R * DEG * Math.cos(lat0 * DEG);
  const ky = R * DEG;
  return {
    lon0,
    lat0,
    toXY: (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLonLat: (x, y) => [lon0 + x / kx, lat0 + y / ky],
  };
}

/** Great-circle distance in metres. */
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** z14-style XYZ tile key "x-y" of a point. */
export function tileKey(lon: number, lat: number, z: number): string {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const r = lat * DEG;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  return `${x}-${y}`;
}

/** Round to a fixed number of decimals (for byte-stable output). */
export function roundTo(v: number, decimals: number): number {
  const k = 10 ** decimals;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;
}

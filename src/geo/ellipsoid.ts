// WGS84 geodetic <-> ECEF conversions. Pure math so it can be unit-tested in Node.
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

const DEG = Math.PI / 180;

export type Geodetic = { lat: number; lon: number; h: number };
export type Vec3 = { x: number; y: number; z: number };

export function geodeticToEcef(lat: number, lon: number, h: number): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return {
    x: (n + h) * cosPhi * Math.cos(lambda),
    y: (n + h) * cosPhi * Math.sin(lambda),
    z: (n * (1 - WGS84_E2) + h) * sinPhi,
  };
}

// Iterative inversion. Converges to sub-millimetre in a few rounds near the surface,
// which is all a ground-level game needs (closed-form Vermeille is not worth the complexity).
export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - WGS84_E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const sinPhi = Math.sin(phi);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    h = p / Math.cos(phi) - n;
    phi = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + h)));
  }
  return { lat: phi / DEG, lon: lon / DEG, h };
}

// Great-circle-ish distance on a sphere; precise enough for gameplay radii (< 50 km).
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

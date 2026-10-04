// Web Mercator (XYZ) tile math and GSI elevation-PNG decoding.

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * GSI elevation PNG: x = R*2^16 + G*2^8 + B; h = x*0.01 (x < 2^23), (x-2^24)*0.01 (x > 2^23),
 * x == 2^23 means no data. https://maps.gsi.go.jp/development/demtile.html
 */
export function decodeGsiDem(r: number, g: number, b: number): number {
  const x = r * 65536 + g * 256 + b;
  if (x === 8388608) return Number.NaN;
  return x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
}

/**
 * 町丁 (small-area) lookup from e-Stat census boundaries, shared by the build script (POI
 * validation) and the game (current ward/town, crowd density). Replaces calls to GSI's reverse
 * geocoder, which GSI provides mainly for its own map site.
 *
 * File format (public/data/areas.json): coordinates are integers in 1e-5° units, each ring
 * delta-encoded, to keep ~3,200 polygons around 1 MB before gzip.
 */
export type AreaFile = {
  source: string;
  wards: string[];
  towns: Array<{
    w: number; // index into wards
    n: string; // town name (町丁・字)
    d: number; // residents per km² (2020 census)
    b: [number, number, number, number]; // bbox minLon,minLat,maxLon,maxLat (1e-5°)
    r: number[][]; // rings, delta-encoded [x0,y0,dx,dy,…] (1e-5°)
  }>;
};

export type AreaHit = { ward: string; town: string; density: number };

const Q = 1e5;
const CELL = 1000; // 0.01° grid cells in 1e-5° units

type Town = {
  ward: string;
  town: string;
  density: number;
  bbox: [number, number, number, number];
  rings: Int32Array[];
};

export class AreaIndex {
  private readonly towns: Town[];
  private readonly grid = new Map<string, number[]>();

  constructor(file: AreaFile) {
    this.towns = file.towns.map((t) => ({
      ward: file.wards[t.w],
      town: t.n,
      density: t.d,
      bbox: t.b,
      rings: t.r.map(decodeRing),
    }));
    this.towns.forEach((t, i) => {
      for (let gx = Math.floor(t.bbox[0] / CELL); gx <= Math.floor(t.bbox[2] / CELL); gx++) {
        for (let gy = Math.floor(t.bbox[1] / CELL); gy <= Math.floor(t.bbox[3] / CELL); gy++) {
          const key = `${gx}/${gy}`;
          const list = this.grid.get(key);
          if (list) list.push(i);
          else this.grid.set(key, [i]);
        }
      }
    });
  }

  lookup(lat: number, lon: number): AreaHit | null {
    const x = Math.round(lon * Q);
    const y = Math.round(lat * Q);
    const candidates = this.grid.get(`${Math.floor(x / CELL)}/${Math.floor(y / CELL)}`) ?? [];
    for (const i of candidates) {
      const t = this.towns[i];
      const isInBox = x >= t.bbox[0] && x <= t.bbox[2] && y >= t.bbox[1] && y <= t.bbox[3];
      if (isInBox && insideRings(t.rings, x, y)) return { ward: t.ward, town: t.town, density: t.density };
    }
    return null;
  }
}

export function encodeRing(ring: number[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const x = Math.round(ring[i] * Q);
    const y = Math.round(ring[i + 1] * Q);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

function decodeRing(deltas: number[]): Int32Array {
  const out = new Int32Array(deltas.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i];
    y += deltas[i + 1];
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/** Even-odd rule over all rings, so shapefile holes need no special handling. */
function insideRings(rings: Int32Array[], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      const crosses = yi > y !== yj > y && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i];
      if (crosses) inside = !inside;
    }
  }
  return inside;
}

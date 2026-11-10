import { CLEARANCE_HEIGHT } from "../law/roadStandards";
import { GIRDER_DEPTH, PARAPET_WIDTH } from "./assumptions";
import { STATION_STRIDE, type XwChunk } from "./format";
import { carriagewayWidth } from "./section";

/**
 * Decks whose plan bands overlap (knowledge/road-redesign-plan.md 4.2 「同じ層の車線域が重ならないことを検査」): where the
 * deck of one run lies over (or under) the deck of another, the two must either be one surface
 * (|Δz| ≤ 5 cm, a nose or merged carriageways) or be a whole level apart (|Δz| ≥ clearance + girder).
 * Anything between is a deck sunk into the side of another or a girder over a carriageway. P1
 * detects and records them (compile.ts → `deck_overlap`); separating them is P3's.
 *
 * Why without OSM layers: the rule holds whatever the tags say, so the data test can recompute it
 * from the tiles alone.
 */

export type Overlap = {
  a: string;
  b: string;
  /** Stations of `a` over or under `b`'s deck with a forbidden height difference. */
  stations: number;
  minDzM: number;
  maxDzM: number;
  /** Smallest distance between the two centre lines among them. */
  minGapM: number;
};

export const SAME_SURFACE_M = 0.05;
const LEVEL_APART_M = CLEARANCE_HEIGHT.value + GIRDER_DEPTH.value;
const CELL_M = 25;

type Pt = { x: number; y: number; z: number; hw: number };

/** Every run's stations as one polyline in a plane around the data (metres). */
function polylines(chunks: XwChunk[]): Map<string, Pt[]> {
  let lat0 = 0;
  let n = 0;
  for (const c of chunks) {
    lat0 += c.st[2];
    n++;
  }
  lat0 = n > 0 ? lat0 / n : 35.68;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const out = new Map<string, Pt[]>();
  for (const [run, list] of byRun) {
    list.sort((p, q) => p.k - q.k);
    const pts: Pt[] = [];
    for (const c of list) {
      const hw = carriagewayWidth(c) / 2 + PARAPET_WIDTH.value;
      const first = pts.length === 0 ? 0 : STATION_STRIDE;
      for (let i = first; i < c.st.length; i += STATION_STRIDE) {
        pts.push({ x: c.st[i + 1] * kx, y: c.st[i + 2] * ky, z: c.st[i + 3], hw });
      }
    }
    out.set(run, pts);
  }
  return out;
}

export function deckOverlaps(chunks: XwChunk[]): Overlap[] {
  const lines = polylines(chunks);
  const cell = (x: number, y: number) => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`;
  const grid = new Map<string, Array<{ run: string; i: number }>>();
  for (const [run, pts] of lines) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const keys = new Set([cell(pts[i].x, pts[i].y), cell(pts[i + 1].x, pts[i + 1].y)]);
      for (const k of keys) grid.set(k, [...(grid.get(k) ?? []), { run, i }]);
    }
  }
  const found = new Map<string, Overlap>();
  const runs = [...lines.keys()].sort();
  for (const a of runs) {
    for (const p of lines.get(a)!) {
      const cx = Math.floor(p.x / CELL_M);
      const cy = Math.floor(p.y / CELL_M);
      // The nearest point of each other run's deck around this station.
      const best = new Map<string, { d: number; z: number; hw: number }>();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const { run: b, i } of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const isOther = b > a;
            if (!isOther) continue;
            const q0 = lines.get(b)![i];
            const q1 = lines.get(b)![i + 1];
            const ex = q1.x - q0.x;
            const ey = q1.y - q0.y;
            const len2 = ex * ex + ey * ey || 1;
            const t = ((p.x - q0.x) * ex + (p.y - q0.y) * ey) / len2;
            const isBeside = t >= 0 && t <= 1;
            if (!isBeside) continue;
            const d = Math.hypot(p.x - (q0.x + ex * t), p.y - (q0.y + ey * t));
            const prev = best.get(b);
            const isNearer = !prev || d < prev.d;
            if (isNearer) best.set(b, { d, z: q0.z + (q1.z - q0.z) * t, hw: q0.hw });
          }
        }
      }
      for (const [b, q] of best) {
        const isOverlapping = q.d < p.hw + q.hw;
        if (!isOverlapping) continue;
        const dz = p.z - q.z;
        const isAllowed = Math.abs(dz) <= SAME_SURFACE_M || Math.abs(dz) >= LEVEL_APART_M;
        if (isAllowed) continue;
        const key = `${a}|${b}`;
        const o = found.get(key) ?? {
          a,
          b,
          stations: 0,
          minDzM: Infinity,
          maxDzM: -Infinity,
          minGapM: Infinity,
        };
        o.stations++;
        o.minDzM = Math.min(o.minDzM, Math.abs(dz));
        o.maxDzM = Math.max(o.maxDzM, Math.abs(dz));
        o.minGapM = Math.min(o.minGapM, q.d);
        found.set(key, o);
      }
    }
  }
  return [...found.values()].sort((p, q) => (p.a + p.b < q.a + q.b ? -1 : 1));
}

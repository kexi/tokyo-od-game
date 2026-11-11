import { CLEARANCE_HEIGHT } from "../law/roadStandards";
import { GIRDER_DEPTH } from "./assumptions";
import { STATION_STRIDE, type XwChunk } from "./format";
import { hermite, ST } from "./profile";
import { carriagewayWidth } from "./section";

/**
 * Carriageways whose plan bands overlap (knowledge/road-redesign-plan.md 4.2 「同じ層の車線域が重ならないことを検査」): where
 * the 車線域 (lanes and shoulders, inside the parapets) of one run lies over (or under) another's,
 * the two must either be one surface (|Δz| ≤ 5 cm: a nose, or carriageways side by side on one
 * slab) or be a whole level apart (|Δz| ≥ clearance + girder). Anything between is a deck sunk into
 * the side of another or a girder over a carriageway. Why the carriageway and not the whole deck
 * (P1 counted the 0.5 m parapets too): two decks whose parapets alone overlap stand side by side
 * within OSM's ±1.5 m, which is what the design asks to check.
 *
 * `planOverlaps` finds the station pairs on the compiler's plan lines (before any height is known),
 * which compile.ts turns into couplings of the joint vertical QP. `deckOverlaps` recomputes the
 * violations from the tiles alone (without OSM layers: the rule holds whatever the tags say), for
 * the data test and the `deck_overlap` diagnostic.
 */

export const SAME_SURFACE_M = 0.05;
export const LEVEL_APART_M = CLEARANCE_HEIGHT.value + GIRDER_DEPTH.value;
const CELL_M = 25;

/** A run's plan line in one metric plane: points every few metres with the carriageway half width. */
export type PlanLine = { id: string; x: Float64Array; y: Float64Array; s: Float64Array; hw: Float64Array };

/** Station `ia` of run a (at sa) lies over the deck of b, whose centre line is nearest at sb. */
export type PlanPair = {
  a: string;
  ia: number;
  sa: number;
  b: string;
  sb: number;
  dist: number;
  /** Cosine between the two directions of travel (−1: side by side the other way). */
  cos: number;
};

type Seg = { line: number; i: number };

function segmentGrid(lines: PlanLine[]): Map<string, Seg[]> {
  const grid = new Map<string, Seg[]>();
  lines.forEach((ln, line) => {
    for (let i = 0; i + 1 < ln.x.length; i++) {
      const keys = new Set([
        `${Math.floor(ln.x[i] / CELL_M)},${Math.floor(ln.y[i] / CELL_M)}`,
        `${Math.floor(ln.x[i + 1] / CELL_M)},${Math.floor(ln.y[i + 1] / CELL_M)}`,
      ]);
      for (const k of keys) {
        const list = grid.get(k);
        if (list) list.push({ line, i });
        else grid.set(k, [{ line, i }]);
      }
    }
  });
  return grid;
}

/**
 * Every point of every line that lies within the other line's deck (centre distance below the sum
 * of the half widths plus `margin`), with the nearest point on the other's centre line. Both
 * directions are listed (a over b and b over a), so a crossing's footprint is covered from both
 * sides. Lines must be in one plane; the grid assumes half widths under 12 m.
 */
export function planOverlaps(lines: PlanLine[], margin = 0.5): PlanPair[] {
  const grid = segmentGrid(lines);
  const out: PlanPair[] = [];
  lines.forEach((a, la) => {
    for (let ia = 0; ia < a.x.length; ia++) {
      const px = a.x[ia];
      const py = a.y[ia];
      const cx = Math.floor(px / CELL_M);
      const cy = Math.floor(py / CELL_M);
      const best = new Map<number, { d: number; sb: number; hw: number; ex: number; ey: number }>();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const { line, i } of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (line === la) continue;
            const b = lines[line];
            const ex = b.x[i + 1] - b.x[i];
            const ey = b.y[i + 1] - b.y[i];
            const len2 = ex * ex + ey * ey || 1;
            const t = Math.min(1, Math.max(0, ((px - b.x[i]) * ex + (py - b.y[i]) * ey) / len2));
            const d = Math.hypot(px - (b.x[i] + ex * t), py - (b.y[i] + ey * t));
            const prev = best.get(line);
            const isNearer = !prev || d < prev.d;
            if (!isNearer) continue;
            const sb = b.s[i] + (b.s[i + 1] - b.s[i]) * t;
            const hw = b.hw[i] + (b.hw[i + 1] - b.hw[i]) * t;
            best.set(line, { d, sb, hw, ex, ey });
          }
        }
      }
      const j = Math.min(ia + 1, a.x.length - 1);
      const k = Math.max(ia - 1, 0);
      const tx = a.x[j] - a.x[k];
      const ty = a.y[j] - a.y[k];
      for (const [line, q] of [...best.entries()].sort((p, r) => p[0] - r[0])) {
        const isOver = q.d < a.hw[ia] + q.hw + margin;
        if (!isOver) continue;
        const cos = (tx * q.ex + ty * q.ey) / (Math.hypot(tx, ty) * Math.hypot(q.ex, q.ey) || 1);
        out.push({ a: a.id, ia, sa: a.s[ia], b: lines[line].id, sb: q.sb, dist: q.d, cos });
      }
    }
  });
  return out;
}

export type Overlap = {
  a: string;
  b: string;
  /** Stations of either over the other's deck with a forbidden height difference. */
  stations: number;
  minDzM: number;
  maxDzM: number;
  /** Smallest distance between the two centre lines among them. */
  minGapM: number;
};

/** One run's stations from its chunks, in a plane around the data (metres). */
type Pt = { x: number; y: number; s: number; z: number; g: number; hw: number };

function polylines(chunks: XwChunk[]): Map<string, Pt[]> {
  let lat0 = 0;
  let n = 0;
  for (const c of chunks) {
    lat0 += c.st[ST.lat];
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
      const hw = carriagewayWidth(c) / 2;
      const first = pts.length === 0 ? 0 : STATION_STRIDE;
      for (let i = first; i < c.st.length; i += STATION_STRIDE) {
        pts.push({
          x: c.st[i + ST.lon] * kx,
          y: c.st[i + ST.lat] * ky,
          s: c.st[i + ST.s],
          z: c.st[i + ST.z],
          g: c.st[i + ST.grade],
          hw,
        });
      }
    }
    out.set(run, pts);
  }
  return out;
}

/**
 * Pairs of runs with stations over the other's deck at a height difference that is neither one
 * surface nor a level apart. The other deck's height is the Hermite surface (profile.ts) at the
 * nearest point of its centre line, so a straight chord between its stations does not fake a step.
 */
export function deckOverlaps(chunks: XwChunk[]): Overlap[] {
  const lines = polylines(chunks);
  const runs = [...lines.keys()].sort();
  const planLines: PlanLine[] = runs.map((id) => {
    const pts = lines.get(id)!;
    return {
      id,
      x: Float64Array.from(pts, (p) => p.x),
      y: Float64Array.from(pts, (p) => p.y),
      s: Float64Array.from(pts, (p) => p.s),
      hw: Float64Array.from(pts, (p) => p.hw),
    };
  });
  const surface = (id: string, s: number) => {
    const pts = lines.get(id)!;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const p = pts[lo];
    const q = pts[Math.min(lo + 1, pts.length - 1)];
    return hermite(p.s, p.z, p.g, q.s, q.z, q.g, s).z;
  };
  // A run and the tunnel or cut it goes on into (P9) are one road through a portal (the same chain):
  // near the portal each is over the other's carriageway, at the other's height plus its grade.
  const chainOf = new Map(chunks.map((c) => [c.run, c.chain]));
  const found = new Map<string, Overlap>();
  for (const pair of planOverlaps(planLines, 0)) {
    const isSameRoad = chainOf.get(pair.a) === chainOf.get(pair.b);
    if (isSameRoad) continue;
    const za = lines.get(pair.a)![pair.ia].z;
    const dz = za - surface(pair.b, pair.sb);
    const isAllowed = Math.abs(dz) <= SAME_SURFACE_M || Math.abs(dz) >= LEVEL_APART_M;
    if (isAllowed) continue;
    const [a, b] = pair.a < pair.b ? [pair.a, pair.b] : [pair.b, pair.a];
    const key = `${a}|${b}`;
    const o = found.get(key) ?? { a, b, stations: 0, minDzM: Infinity, maxDzM: -Infinity, minGapM: Infinity };
    o.stations++;
    o.minDzM = Math.min(o.minDzM, Math.abs(dz));
    o.maxDzM = Math.max(o.maxDzM, Math.abs(dz));
    o.minGapM = Math.min(o.minGapM, pair.dist);
    found.set(key, o);
  }
  return [...found.values()].sort((p, q) => (p.a + p.b < q.a + q.b ? -1 : 1));
}

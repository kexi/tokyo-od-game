import { PARAPET_WIDTH } from "../src/expressway/assumptions.ts";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format.ts";
import { planeAt } from "../src/expressway/geo.ts";
import { frameAt, ST } from "../src/expressway/profile.ts";
import { carriagewayWidth } from "../src/expressway/section.ts";

/**
 * Points of the generated data where the compiler made two runs one surface (decks "same"), read
 * from the chunks alone: the stations' plan (linear between stations) and the Hermite surface
 * (profile.ts), in one east/north plane. Why not the deck builder's rings or sides: the tests that
 * use this check the merged decks (expresswayMerge.ts), so where they probe must not come from it.
 */

/**
 * Plan coordinates (east, north metres) of a point at road height z (T.P. m). A local tangent frame
 * needs z: away from its origin the plan position of a point moves with its height (h · d / R, 1.4 cm
 * for 60 m at 1.5 km), more than the seam probes' 2 mm either side of a slab edge.
 */
export type Project = (lon: number, lat: number, z: number) => [number, number];

const PLANE = planeAt(139.75, 35.65);

export type PairPoint = {
  chunk: XwChunk;
  with: string;
  /** Run distance on `chunk`, and its centre (plane metres, T.P. elevation). */
  s: number;
  x: number;
  y: number;
  z: number;
  /** The other run's nearest centre point, its unit direction of travel and its chunk there. */
  other: { chunk: XwChunk; s: number; x: number; y: number; z: number; dx: number; dy: number };
  /** This centre's offset left of the other's centre line (m), and whether both run one way. */
  offset: number;
  isSameWay: boolean;
  /** The other's surface minus this one's, at the foot (T.P. m). */
  dz: number;
  /** Half the slab of each (carriageway + parapet). */
  edge: number;
  otherEdge: number;
};

type Station = { chunk: XwChunk; s: number; x: number; y: number };

function stationsOf(chunks: readonly XwChunk[], project: Project): Station[] {
  const out: Station[] = [];
  for (const c of chunks.toSorted((a, b) => a.k - b.k)) {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const [x, y] = project(c.st[i + ST.lon], c.st[i + ST.lat], c.st[i + ST.z]);
      out.push({ chunk: c, s: c.st[i + ST.s], x, y });
    }
  }
  return out;
}

/** The road height of a chunk at s, s held within the chunk (a padded stretch reaches past its ends). */
const heightIn = (c: XwChunk, s: number) =>
  frameAt(c.st, Math.min(Math.max(s, c.st[0]), c.st[c.st.length - STATION_STRIDE])).z;

const slabHalf = (c: XwChunk) => carriagewayWidth(c) / 2 + PARAPET_WIDTH.value;

/**
 * Every `step` metres of every chunk's unpadded "same" stretches, with the other run there.
 * `project` maps lon/lat to plan metres: an equirectangular plane by default, whose scale is ~0.3 %
 * off the game's local frame (fine for heights and stretches, not for millimetres at a slab edge).
 */
export function pairPoints(
  chunks: readonly XwChunk[],
  step = 0.5,
  project: Project = (lon, lat) => PLANE.toXY(lon, lat),
): PairPoint[] {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const lines = new Map([...byRun].map(([run, list]) => [run, stationsOf(list, project)]));
  const out: PairPoint[] = [];
  for (const c of chunks) {
    for (const d of c.decks) {
      const line = lines.get(d.with);
      if (d.relation !== "same" || !line) continue;
      // Off the stretch's ends and its stations by a few centimetres.
      for (let s = d.s0 + 0.13; s < d.s1; s += step) {
        const f = frameAt(c.st, s);
        const [x, y] = project(f.lon, f.lat, heightIn(c, s));
        let best: (PairPoint["other"] & { dist: number }) | null = null;
        for (let k = 0; k + 1 < line.length; k++) {
          const a = line[k];
          const b = line[k + 1];
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const len2 = ex * ex + ey * ey;
          if (len2 < 1e-9) continue;
          const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (y - a.y) * ey) / len2));
          const dist = Math.hypot(a.x + ex * t - x, a.y + ey * t - y);
          if (best && dist >= best.dist) continue;
          const len = Math.sqrt(len2);
          // A seam station closes one chunk and opens the next: the chunk holding the segment.
          const chunk = b.chunk === a.chunk ? a.chunk : b.chunk;
          const sOther = a.s + (b.s - a.s) * t;
          best = {
            chunk,
            s: sOther,
            x: a.x + ex * t,
            y: a.y + ey * t,
            z: 0,
            dx: ex / len,
            dy: ey / len,
            dist,
          };
        }
        if (!best) continue;
        best.z = frameAt(best.chunk.st, best.s).z;
        const h = frameAt(c.st, Math.min(s + 0.5, c.st[c.st.length - STATION_STRIDE]));
        const [hx, hy] = project(
          h.lon,
          h.lat,
          heightIn(c, Math.min(s + 0.5, c.st[c.st.length - STATION_STRIDE])),
        );
        const isSameWay = (hx - x) * best.dx + (hy - y) * best.dy > 0;
        // Left of the other's travel: its direction turned 90° anticlockwise.
        const offset = (x - best.x) * -best.dy + (y - best.y) * best.dx;
        out.push({
          chunk: c,
          with: d.with,
          s,
          x,
          y,
          z: f.z,
          other: best,
          offset,
          isSameWay,
          dz: best.z - f.z,
          edge: slabHalf(c),
          otherEdge: slabHalf(best.chunk),
        });
      }
    }
  }
  return out;
}

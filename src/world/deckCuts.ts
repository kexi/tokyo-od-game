import { PARAPET_WIDTH } from "../expressway/assumptions";
import { ST, STATION_STRIDE, type XwChunk } from "../expressway/format";
import { planeAt } from "../expressway/geo";
import { carriagewayWidth } from "../expressway/section";

/**
 * Where PLATEAU buildings must give way to an elevated deck (buildings.ts cutAboveDecks): points
 * over the deck's whole width, each with the height of the girder's soffit under it. A building
 * whose roof covers one of them and rises above that soffit is cut down below it.
 *
 * Why points and not the deck's outline: a point in the roof's triangles is the test the buildings
 * can make per feature without clipping walls (PLATEAU LOD1 walls are single quads from the ground
 * to the roof), and a regular spacing finds a building that only clips an edge of the deck.
 */
export type DeckCutPoint = { lon: number; lat: number; soffitTp: number; roadTp: number };

/** A cut point with ellipsoidal heights (the local frame's input): `h` the soffit, `top` the road. */
export type DeckCutGeodetic = { lat: number; lon: number; h: number; top: number };

/** Across the deck: the centre, the quarter points and the outer edges (+ MARGIN_M). */
const ACROSS = [-1, -0.5, 0, 0.5, 1];
/** Beyond the 壁高欄's outer face: the building's wall must not touch the parapet either. */
const MARGIN_M = 0.5;
/** Along the deck: a building narrower than this between two rows could be missed. */
export const CUT_STEP_M = 2;

/** The cut points of one chunk (T.P. heights; the caller turns them into the local frame). */
export function deckCutPoints(chunk: XwChunk, step = CUT_STEP_M): DeckCutPoint[] {
  const st = chunk.st;
  const n = st.length / STATION_STRIDE;
  if (n < 2) return [];
  const half = carriagewayWidth(chunk) / 2 + PARAPET_WIDTH.value + MARGIN_M;
  const plane = planeAt(st[ST.lon], st[ST.lat]);
  const xy = (i: number) => plane.toXY(st[i * STATION_STRIDE + ST.lon], st[i * STATION_STRIDE + ST.lat]);
  const points: DeckCutPoint[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const [ax, ay] = xy(i);
    const [bx, by] = xy(i + 1);
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) continue;
    // Left of travel, in the plane (x east, y north).
    const lx = -(by - ay) / length;
    const ly = (bx - ax) / length;
    const isLast = i + 2 === n;
    const rows = Math.max(1, Math.ceil(length / step));
    for (let k = 0; k <= rows; k++) {
      const isShared = k === rows && !isLast;
      if (isShared) continue; // the next span's first row
      const t = k / rows;
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      const z = st[i * STATION_STRIDE + ST.z] * (1 - t) + st[(i + 1) * STATION_STRIDE + ST.z] * t;
      // An embankment (P2.7-6) is walled down to the ground: nothing of a building stays under it.
      const ground =
        st[i * STATION_STRIDE + ST.ground] * (1 - t) + st[(i + 1) * STATION_STRIDE + ST.ground] * t;
      const soffitTp =
        chunk.structure === "embankment" ? Math.min(ground, z - chunk.girder) : z - chunk.girder;
      for (const a of ACROSS) {
        const [lon, lat] = plane.toLonLat(cx + lx * half * a, cy + ly * half * a);
        points.push({ lon, lat, soffitTp, roadTp: z });
      }
    }
  }
  return points;
}

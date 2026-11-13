import { GROUND_ROAD_HALF_WIDTH, PARAPET_WIDTH, RAMP_FOOT } from "./assumptions";

/**
 * Where a ramp's ground end goes (S6 PR 7c2, T): out of the carriageway of the streets it meets.
 * The end node of a motorway_link is on the street's centre line, and a run at grade climbs from it, so
 * the slab and its parapets stood in the street's lanes (861095931: 17 m in a 25 m street, +0.86 m
 * where it left). The run is cut where its slab's edge (the carriageway's half width + PARAPET_WIDTH)
 * first stands clear of every street through the end node and every street the run's centre line
 * crosses within RAMP_FOOT.maxM, each taken GROUND_ROAD_HALF_WIDTH either side of its centre line (OSM
 * has no width). What is cut off is the street's own surface, which the game's connector joins (as
 * before the runs at grade). Pure geometry on a local plane: compile.ts planNetwork does the cutting.
 */

/** A street at ground level near the end: its centre line on the run's plane (x, y, x, y, …). */
export type FootRoad = { id: number; xy: Float64Array };

/**
 * The run from its end inwards: the samples' plane positions (x, y, …), their distance from the end,
 * and the half width of the carriageway at each.
 */
export type FootLine = { xy: Float64Array; d: Float64Array; laneHalf: Float32Array };

/**
 * `clear`: the slab at the end node is already out of every street (nothing to cut). `cut`: cut at
 * sample `k` of the line, `d` metres from the end. `along`: the slab is in a street all of
 * RAMP_FOOT.maxM (a ramp in a street's median running with it), not cut; `roads` the streets it is in,
 * with what a rule for them would be made from (design answer 4.1, the ledger's foot-along-street): the
 * angle to the nearest of them at the end (°, 0–90), how far the slab stays in them (to RAMP_FOOT.maxM)
 * and how far its edge covers their centre line (the centre line within the slab's half width).
 * `inside`: the same, but the run ends within RAMP_FOOT.maxM still in the street (the measures over
 * the whole run).
 */
export type FootCut =
  | { kind: "clear" }
  | { kind: "cut"; k: number; d: number; roads: number[] }
  | { kind: "along"; roads: number[]; angleDeg: number; streetM: number; coverM: number }
  | { kind: "inside"; roads: number[]; angleDeg: number; streetM: number; coverM: number };

/** Distance from point (px, py) to segment (ax, ay)–(bx, by). */
function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
  return Math.hypot(ax + ex * t - px, ay + ey * t - py);
}

/** The cross product (q − p) × (r − p): which side of p→q the point r is on. */
function side(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px);
}

/** Whether segments a–b and c–e cross (proper or touching). */
function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
): boolean {
  const d1 = side(cx, cy, ex, ey, ax, ay);
  const d2 = side(cx, cy, ex, ey, bx, by);
  const d3 = side(ax, ay, bx, by, cx, cy);
  const d4 = side(ax, ay, bx, by, ex, ey);
  // On one line: they cross only where their boxes overlap (the sides alone say so for any two).
  const isCollinear = d1 === 0 && d2 === 0;
  if (isCollinear)
    return (
      Math.min(ax, bx) <= Math.max(cx, ex) &&
      Math.min(cx, ex) <= Math.max(ax, bx) &&
      Math.min(ay, by) <= Math.max(cy, ey) &&
      Math.min(cy, ey) <= Math.max(ay, by)
    );
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** Distance between segments a–b and c–e (0 where they cross). */
function segmentSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
): number {
  if (segmentsCross(ax, ay, bx, by, cx, cy, ex, ey)) return 0;
  return Math.min(
    pointSegment(ax, ay, cx, cy, ex, ey),
    pointSegment(bx, by, cx, cy, ex, ey),
    pointSegment(cx, cy, ax, ay, bx, by),
    pointSegment(ex, ey, ax, ay, bx, by),
  );
}

/** Distance from segment a–b to a polyline. */
function segmentPolyline(ax: number, ay: number, bx: number, by: number, xy: Float64Array): number {
  let best = Infinity;
  for (let j = 0; j + 3 < xy.length; j += 2) {
    best = Math.min(best, segmentSegment(ax, ay, bx, by, xy[j], xy[j + 1], xy[j + 2], xy[j + 3]));
  }
  return best;
}

/** Distance from a point to a polyline. */
function pointPolyline(px: number, py: number, xy: Float64Array): number {
  let best = Infinity;
  for (let j = 0; j + 3 < xy.length; j += 2)
    best = Math.min(best, pointSegment(px, py, xy[j], xy[j + 1], xy[j + 2], xy[j + 3]));
  return best;
}

/** Whether the run's centre line from the end to RAMP_FOOT.maxM crosses the polyline. */
function crossesWithin(line: FootLine, xy: Float64Array, maxM: number): boolean {
  const n = line.d.length;
  for (let k = 0; k + 1 < n && line.d[k] <= maxM; k++) {
    const [ax, ay, bx, by] = [line.xy[2 * k], line.xy[2 * k + 1], line.xy[2 * k + 2], line.xy[2 * k + 3]];
    for (let j = 0; j + 3 < xy.length; j += 2) {
      if (segmentsCross(ax, ay, bx, by, xy[j], xy[j + 1], xy[j + 2], xy[j + 3])) return true;
    }
  }
  return false;
}

/**
 * The slab's cross-section at sample k (its two edges), perpendicular to the line there. The
 * direction from the neighbouring samples (the next one; the last sample takes the one before).
 */
function sectionAt(line: FootLine, k: number): [number, number, number, number] {
  const n = line.d.length;
  const a = Math.max(0, Math.min(k, n - 2));
  const tx = line.xy[2 * a + 2] - line.xy[2 * a];
  const ty = line.xy[2 * a + 3] - line.xy[2 * a + 1];
  const len = Math.hypot(tx, ty) || 1;
  const nx = -ty / len;
  const ny = tx / len;
  const edge = line.laneHalf[k] + PARAPET_WIDTH.value;
  const x = line.xy[2 * k];
  const y = line.xy[2 * k + 1];
  return [x + nx * edge, y + ny * edge, x - nx * edge, y - ny * edge];
}

/** The angle (°, 0–90) between the run at its end and the nearest segment of the streets there. */
function angleAtEnd(line: FootLine, roads: readonly FootRoad[]): number {
  const [x0, y0] = [line.xy[0], line.xy[1]];
  const fiveMetres = line.d.findIndex((d) => d >= 5);
  const far = fiveMetres === -1 ? line.d.length - 1 : fiveMetres;
  const [tx, ty] = [line.xy[2 * far] - x0, line.xy[2 * far + 1] - y0];
  let best = { dist: Infinity, ex: 1, ey: 0 };
  for (const r of roads)
    for (let j = 0; j + 3 < r.xy.length; j += 2) {
      const dist = pointSegment(x0, y0, r.xy[j], r.xy[j + 1], r.xy[j + 2], r.xy[j + 3]);
      if (dist < best.dist) best = { dist, ex: r.xy[j + 2] - r.xy[j], ey: r.xy[j + 3] - r.xy[j + 1] };
    }
  const cos =
    Math.abs(tx * best.ex + ty * best.ey) / ((Math.hypot(tx, ty) || 1) * (Math.hypot(best.ex, best.ey) || 1));
  return Math.round(((Math.acos(Math.min(1, cos)) * 180) / Math.PI) * 10) / 10;
}

/** Rounded to the decimetre. */
function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** footCut's `along` measures: the angle at the end, the slab in the streets, its edge over their centre line. */
function alongMeasures(
  line: FootLine,
  roads: readonly FootRoad[],
): { angleDeg: number; streetM: number; coverM: number } {
  const { maxM } = RAMP_FOOT.value;
  const half = GROUND_ROAD_HALF_WIDTH.value;
  let streetM = 0;
  let coverM = 0;
  let isCovering = true;
  for (let k = 0; k < line.d.length && line.d[k] <= maxM; k++) {
    const [ax, ay, bx, by] = sectionAt(line, k);
    const isInside = roads.some((r) => segmentPolyline(ax, ay, bx, by, r.xy) <= half);
    if (!isInside) break;
    streetM = line.d[k];
    const edge = line.laneHalf[k] + PARAPET_WIDTH.value;
    const isOverCentre = roads.some((r) => pointPolyline(line.xy[2 * k], line.xy[2 * k + 1], r.xy) < edge);
    isCovering = isCovering && isOverCentre;
    if (isCovering) coverM = line.d[k];
  }
  return { angleDeg: angleAtEnd(line, roads), streetM: r1(streetM), coverM: r1(coverM) };
}

/**
 * Where to cut a ramp's ground end (see the module's comment). The streets taken: those through the
 * end node (within RAMP_FOOT.nodeOnRoadM of it: the node is shared, so the line passes through it)
 * and those the centre line crosses within RAMP_FOOT.maxM. Why the crossed ones from the start and not
 * only once the cut has reached them: a street just past the first is still under the slab when it
 * leaves the first (two streets meeting at a corner), and a cut between them would stand the slab in
 * the second. One farther on is clear of the slab where the first is left, and stays a crossing of
 * the run (`blocked`), as before.
 */
export function footCut(line: FootLine, roads: readonly FootRoad[]): FootCut {
  const { maxM, nodeOnRoadM } = RAMP_FOOT.value;
  const half = GROUND_ROAD_HALF_WIDTH.value;
  const x0 = line.xy[0];
  const y0 = line.xy[1];
  const taken = roads.filter(
    (r) => pointPolyline(x0, y0, r.xy) <= nodeOnRoadM || crossesWithin(line, r.xy, maxM),
  );
  const isOffStreets = taken.length === 0;
  if (isOffStreets) return { kind: "clear" };
  const inside = (k: number) => {
    const [ax, ay, bx, by] = sectionAt(line, k);
    return taken.filter((r) => segmentPolyline(ax, ay, bx, by, r.xy) <= half).map((r) => r.id);
  };
  const atEnd = inside(0);
  const isClearAtEnd = atEnd.length === 0;
  if (isClearAtEnd) return { kind: "clear" };
  for (let k = 1; k < line.d.length && line.d[k] <= maxM; k++) {
    const isClear = inside(k).length === 0;
    if (isClear) return { kind: "cut", k, d: line.d[k], roads: atEnd };
  }
  // The run ended before RAMP_FOOT.maxM with its slab still in the street (a short run in it all its
  // length): no `along` (that is a slab in the street for all of maxM); cutFeet keeps it uncut.
  const isRunOut = line.d[line.d.length - 1] < maxM;
  return {
    kind: isRunOut ? "inside" : "along",
    roads: atEnd,
    ...alongMeasures(
      line,
      taken.filter((r) => atEnd.includes(r.id)),
    ),
  };
}

import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import type { OrbisSite } from "./orbis";
import { leftOf, speedLimit, type RoadGraph, type Segment } from "./roads";
import { isAllDay } from "./ruleTime";

/**
 * 可搬式オービス (portable speed cameras) set up by the game: the 警視庁 runs them on 生活道路 and
 * school routes (警視庁速度管理指針) and publishes the routes and districts it watches, not where
 * these units stand, so the game picks its own places, the same for everyone on a given game day. The ground is cut into cells of about 300 m on a fixed
 * lon/lat grid; a hash of the date and the cell decides whether the cell has a unit that day
 * (twice as often near a 小学校) and where in the cell to look for a street. The unit goes on the
 * residential street nearest that point (posted 30 km/h sections and streets by a 小学校 count as
 * nearer), off the carriageway at the left kerb, 15 m or more from either end of the street
 * piece, looking back at the traffic it takes. Nothing depends on the frame or the order of the
 * graph, so a reload, a re-anchored frame or another window over the same streets puts the units
 * in the same places.
 */
export const PORTABLE = {
  /** Cell size in degrees: ≈ 300 m north–south and 298 m east–west at 35.7°N. */
  cellLat: 0.0027,
  cellLon: 0.0033,
  /**
   * Share of cells with a unit on a game day, and of cells whose centre is near a 小学校: about
   * 3–4 units in a loaded 3 × 3 tile window (≈ 1.5 km square, ~16–20 whole cells).
   */
  chance: 0.15,
  schoolChance: 0.3,
  /** km/h over the limit it photographs (可搬式: 15, Wikipedia; fixed ones 30). */
  threshold: 15,
  /**
   * Metres kept from each end of the street piece: clear of the junction box (a residential
   * crossing is 4–6 m across) and its approach. Why not more: GSI splits Tokyo's residential
   * streets every 40–60 m, and only ~11 % of the pieces are 60 m long (太子堂, 阿佐谷).
   */
  clear: 15,
  /** The unit's centre beyond the carriageway edge (m). */
  kerbGap: 0.55,
  /** Streets with a higher limit are not 生活道路. */
  maxLimit: 40,
  /** A 小学校 within this distance (m) makes the street a school route. */
  schoolRadius: 250,
  /** Cells nearer than this to the loaded streets' edge are left out (their streets are cut). */
  edge: 40,
} as const;

export type GameDay = { y: number; m: number; d: number };
/** places.json `schools`: [lon, lat, kind (0 school, 1 kindergarten, 2 childcare), name]. */
export type School = readonly [number, number, number, string];

export const dayKey = (day: GameDay): string =>
  `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;

/**
 * FNV-1a, 32 bit, then MurmurHash3's finaliser: a stable hash of the key, the same in every
 * browser and in the tests. Why the finaliser: keys differ only in their last characters (the
 * cell indices), and plain FNV-1a left neighbouring cells' top bits alike, so some days put a
 * unit in nearly every cell of a row.
 */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const unitOf = (text: string) => hash32(text) / 2 ** 32;

/**
 * The one-way that holds all day (JARTIC), else 0. Why not `seg.oneway`: it follows the game's
 * clock (setClock), and a unit placed at 8:00 must face the same way as one placed at 15:00.
 */
export function onewayAllDay(seg: Segment): 0 | 1 | -1 {
  if (seg.line.oneway !== 0) return seg.line.oneway;
  const rule = seg.onewayRule;
  return rule && isAllDay(rule.time) ? rule.dir : 0;
}

/** Residential streets a unit may stand on. */
export function isPortableStreet(seg: Segment): boolean {
  const isResidential = seg.line.kind === "local" || seg.line.kind === "narrow";
  // Not where cars may never go (歩行者用道路, 通行止め round the clock); a school-run closure
  // for some hours is where these units are used most (警視庁速度管理指針).
  const isOpen = !seg.line.bridge && !seg.closures.some((c) => isAllDay(c.time));
  const fits = seg.line.width >= 3.5 && seg.line.width <= 13;
  const isLong = seg.length >= 2 * PORTABLE.clear + 5;
  return isResidential && isOpen && fits && isLong && speedLimit(seg) <= PORTABLE.maxLimit;
}

/** Convex quad (cell corners in order) contains p, on the ground plane. */
function inQuad(q: Vector3[], p: Vector3): boolean {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a = q[k];
    const b = q[(k + 1) % 4];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const s = Math.sign(cross);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

type Box = { x0: number; x1: number; z0: number; z1: number };

function boxOf(seg: Segment): Box {
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of seg.pts) {
    box.x0 = Math.min(box.x0, p.x);
    box.x1 = Math.max(box.x1, p.x);
    box.z0 = Math.min(box.z0, p.z);
    box.z1 = Math.max(box.z1, p.z);
  }
  return box;
}

/**
 * The portable units for a game day on the loaded streets: OrbisSite records (kind "portable")
 * with the kerb position they stand at, for the same crossing test as the fixed cameras.
 */
export function planPortable(
  graph: RoadGraph,
  frame: LocalFrame,
  day: GameDay,
  schools: readonly School[] = [],
): OrbisSite[] {
  const streets = graph.segments.filter((seg) => seg.line.kind !== "highway");
  if (streets.length === 0) return [];
  const boxes = new Map(streets.map((seg) => [seg, boxOf(seg)]));
  const all = [...boxes.values()];
  const extent: Box = {
    x0: Math.min(...all.map((b) => b.x0)) + PORTABLE.edge,
    x1: Math.max(...all.map((b) => b.x1)) - PORTABLE.edge,
    z0: Math.min(...all.map((b) => b.z0)) + PORTABLE.edge,
    z1: Math.max(...all.map((b) => b.z1)) - PORTABLE.edge,
  };
  const isInside = (p: Vector3) =>
    p.x >= extent.x0 && p.x <= extent.x1 && p.z >= extent.z0 && p.z <= extent.z1;
  const local = (lat: number, lon: number) => frame.toLocal(lat, lon, frame.origin.h).setY(0);
  // Cell range from the extent's corners (the frame is only a little rotated from lon/lat).
  const corners = [
    [extent.x0, extent.z0],
    [extent.x1, extent.z0],
    [extent.x0, extent.z1],
    [extent.x1, extent.z1],
  ].map(([x, z]) => frame.toGeodetic(new Vector3(x, 0, z)));
  const i0 = Math.floor(Math.min(...corners.map((c) => c.lon)) / PORTABLE.cellLon);
  const i1 = Math.floor(Math.max(...corners.map((c) => c.lon)) / PORTABLE.cellLon);
  const j0 = Math.floor(Math.min(...corners.map((c) => c.lat)) / PORTABLE.cellLat);
  const j1 = Math.floor(Math.max(...corners.map((c) => c.lat)) / PORTABLE.cellLat);
  const schoolsNear = schools
    .filter(([, , kind, name]) => kind === 0 && name.includes("小学校"))
    .map(([lon, lat]) => local(lat, lon))
    .filter(
      (p) =>
        p.x > extent.x0 - PORTABLE.schoolRadius - PORTABLE.edge &&
        p.x < extent.x1 + PORTABLE.schoolRadius + PORTABLE.edge &&
        p.z > extent.z0 - PORTABLE.schoolRadius - PORTABLE.edge &&
        p.z < extent.z1 + PORTABLE.schoolRadius + PORTABLE.edge,
    );
  const today = dayKey(day);
  const out: OrbisSite[] = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const key = `${today}|${i}|${j}`;
      const lon0 = i * PORTABLE.cellLon;
      const lat0 = j * PORTABLE.cellLat;
      const quad = [
        local(lat0, lon0),
        local(lat0, lon0 + PORTABLE.cellLon),
        local(lat0 + PORTABLE.cellLat, lon0 + PORTABLE.cellLon),
        local(lat0 + PORTABLE.cellLat, lon0),
      ];
      // Only cells whose streets are all loaded: elsewhere a cut street could move the unit.
      if (!quad.every(isInside)) continue;
      const centre = local(lat0 + PORTABLE.cellLat / 2, lon0 + PORTABLE.cellLon / 2);
      const isSchoolCell = schoolsNear.some(
        (q) => Math.hypot(q.x - centre.x, q.z - centre.z) < PORTABLE.schoolRadius,
      );
      const hasUnit = unitOf(key) < (isSchoolCell ? PORTABLE.schoolChance : PORTABLE.chance);
      if (!hasUnit) continue;
      const u = unitOf(`${key}|u`);
      const v = unitOf(`${key}|v`);
      const target = local(lat0 + v * PORTABLE.cellLat, lon0 + u * PORTABLE.cellLon);
      const site = placeInCell(graph, boxes, quad, target, schoolsNear, key);
      if (site) out.push(finish(site, frame, key));
    }
  }
  return out;
}

type Pick = { seg: Segment; s: number; dir: 1 | -1; line: Vector3; travel: Vector3; stand: Vector3 };

function placeInCell(
  graph: RoadGraph,
  boxes: Map<Segment, Box>,
  quad: Vector3[],
  target: Vector3,
  schools: Vector3[],
  key: string,
): Pick | null {
  const cell: Box = {
    x0: Math.min(...quad.map((p) => p.x)),
    x1: Math.max(...quad.map((p) => p.x)),
    z0: Math.min(...quad.map((p) => p.z)),
    z1: Math.max(...quad.map((p) => p.z)),
  };
  let best: { seg: Segment; s: number; score: number } | null = null;
  for (const [seg, box] of boxes) {
    const overlaps = box.x1 >= cell.x0 && box.x0 <= cell.x1 && box.z1 >= cell.z0 && box.z0 <= cell.z1;
    if (!overlaps || !isPortableStreet(seg)) continue;
    const s = Math.min(Math.max(graph.nearestOn(seg, target).s, PORTABLE.clear), seg.length - PORTABLE.clear);
    const p = graph.sample(seg, s).pos;
    if (!inQuad(quad, p)) continue;
    // Posted 30 km/h (JARTIC 区間・区域) and school routes count as nearer, so they win more often.
    const isPosted30 = seg.limit !== null && seg.limit <= 30;
    const isSlow = speedLimit(seg) <= 30;
    const isZone = seg.limitKind === "zone";
    const isSchoolRoute = schools.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < PORTABLE.schoolRadius);
    const factor = (isPosted30 ? 0.5 : isSlow ? 0.75 : 1) * (isZone ? 0.8 : 1) * (isSchoolRoute ? 0.5 : 1);
    // Centimetres: a re-anchored frame moves the numbers by far less, so ties fall the same way.
    const score = Math.round(Math.hypot(p.x - target.x, p.z - target.z) * factor * 100);
    const isBetter = !best || score < best.score || (score === best.score && tieBreak(p, best, graph));
    if (isBetter) best = { seg, s, score };
  }
  if (!best) return null;
  const { seg } = best;
  const oneway = onewayAllDay(seg);
  const dir: 1 | -1 = oneway !== 0 ? oneway : unitOf(`${key}|dir`) < 0.5 ? 1 : -1;
  // Out of other streets' carriageways (a parallel or crossing street close by): step along.
  for (const step of [0, 6, -6, 12, -12, 18, -18]) {
    const s = best.s + step;
    if (s < PORTABLE.clear || s > seg.length - PORTABLE.clear) continue;
    const { pos, dir: along } = graph.sample(seg, s);
    const travel = along.clone().multiplyScalar(dir);
    const stand = pos.clone().add(leftOf(travel, seg.line.width / 2 + PORTABLE.kerbGap));
    const isClear =
      graph.carriagewaysAt(stand, 0.3, seg).length === 0 && graph.carriagewaysAt(pos, 0, seg).length === 0;
    if (isClear) return { seg, s, dir, line: pos, travel, stand };
  }
  return null;
}

/** Equal scores: the westernmost, then southernmost point (+X east, +Z south), to the centimetre. */
function tieBreak(p: Vector3, best: { seg: Segment; s: number }, graph: RoadGraph): boolean {
  const q = graph.sample(best.seg, best.s).pos;
  const [px, qx] = [Math.round(p.x * 100), Math.round(q.x * 100)];
  if (px !== qx) return px < qx;
  return Math.round(p.z * 100) > Math.round(q.z * 100);
}

function finish(pick: Pick, frame: LocalFrame, key: string): OrbisSite {
  const { seg, s, dir, line, travel, stand } = pick;
  const g = frame.toGeodetic(stand);
  const bearing = Math.round(((Math.atan2(travel.x, -travel.z) * 180) / Math.PI + 360) % 360);
  // Narrow two-way streets have no centre line: cars use the whole width, and the camera sees it.
  const hasCentreLine = seg.line.width >= 5.5;
  const span = onewayAllDay(seg) !== 0 || !hasCentreLine ? seg.line.width : seg.line.width / 2;
  return {
    entry: {
      // Negative ids keep the cool-down map apart from the OSM node ids of the fixed cameras.
      id: -1 - (hash32(key) % 0x7fffffff),
      lon: Math.round(g.lon * 1e6) / 1e6,
      lat: Math.round(g.lat * 1e6) / 1e6,
      bearing,
      source: "none",
      lanes: 1,
      maxspeed: 0,
      road: "portable",
      elevated: false,
      name: "",
      signs: [],
      origin: `game:portable/${key}`,
    },
    seg,
    s,
    dir,
    line: line.clone(),
    travel: travel.clone(),
    kind: "portable",
    lanes: 1,
    kerb: seg.line.width / 2,
    laneWidth: span,
    expressway: false,
    limit: speedLimit(seg),
    threshold: PORTABLE.threshold,
    stand: stand.clone(),
  };
}

import { Vector3 } from "three";
import { isLaneChangeBanned, laneBand, laneOfOffset } from "../world/laneChange";
import { laneOffset, leftOf, type RoadGraph, type Segment } from "../world/roads";
import type { LaneHint, Maneuver, Route, Step, Turn } from "./navigation";

/**
 * The way a car drives a route, for the navigation to show and the autopilot to follow: in its
 * lane, and round each corner on a curve as the law has it (道路交通法 第34条) instead of through
 * the graph node at a right angle:
 *
 * - 左折 (第1項): from the left of the road, a tight arc hugging the kerb into the new road's left lane.
 * - 右折 (第2項): from next to the centre line, an arc passing just inside the junction centre
 *   (交差点の中心の直近の内側: the centre stays on the driver's left) into the far side's left lane.
 * - 右折 from a one-way street (第4項): from its right edge, round the right-hand corner.
 * - Bends of the street, slight turns and roundabouts: an arc that stays in the lane (第35条の2 for
 *   a roundabout: along its left edge).
 *
 * Lines are in the local frame (x east, z south, y = 0); lane offsets are metres left of a
 * street's centreline.
 */

/** Tightest turn the car makes at 15 km/h (2.7 m wheelbase, steering lock 0.45 rad there). */
export const MIN_RADIUS = 6;
/** 直近の内側: the car's centre passes this far inside the junction centre (half the car + 0.35 m). */
export const CENTRE_GAP = 1.2;
/** Before a right turn, the car's centre this far left of the centre line (第34条第2項). */
export const CENTRE_HUG = 1.2;
/** Lanes for a turn are taken this far before it (第34条: あらかじめその前から). */
export const LANE_PREPARE = 120;
// Moving over within the lane happens with the 合図, 30 m before the turn (施行令 第21条).
const HUG_BEFORE = 30;
// Lateral metres per metre of travel while changing lanes (a 3 m lane over 30 m).
const LANE_SLOPE = 0.1;
const MAX_RADIUS = 40;
// A right turn sweeping wider than this ends in the lane by the centre line instead.
const WIDE_SWEEP = 20;
// Bends: an arc this long on each side at least, so slight bends are not slowed to a crawl.
const BEND_TANGENT = 6;
const DEG = Math.PI / 180;
const SEED_MIN = 22 * DEG; // a junction node turning this much can start a turn
const JOIN_MIN = 8 * DEG; // nodes of the same junction box turning the same way join it
const JOIN_REACH = 20; // m between nodes of one junction box (GSI splits big junctions)
const TURN_MIN = 50 * DEG; // a turn (left / right), not a slight bend
const BEND_MIN = 12 * DEG; // smaller kinks are mitred, not rounded
const BEND_JOIN = 8; // m between vertices of one bend
const ABSORB = 4; // m: kinks this close to a turn are part of its junction
const UTURN_MIN = 150 * DEG;

export type CornerKind = "left" | "right" | "bend" | "uturn";

export type CornerSpec = {
  kind: CornerKind;
  /** Where the approach and exit centrelines (extended) cross: the junction centre. */
  centre: Vector3;
  inDir: Vector3;
  outDir: Vector3;
  /** Lane centre left of the approach / exit centreline (m). */
  inOffset: number;
  outOffset: number;
  /** Half the carriageway width of the approach / exit (centreline to kerb). */
  inHalf: number;
  outHalf: number;
  /** 第34条第4項: a right turn out of a one-way street (from its right edge). */
  fromOneWay?: boolean;
  /** The curve starts at least `minBack` and at most `maxBack` before the centre (along inDir). */
  minBack?: number;
  maxBack?: number;
  /** …and ends at least `minAhead`, at most `maxAhead` after it (along outDir). */
  minAhead?: number;
  maxAhead?: number;
};

export type CornerPath = {
  /** From the approach lane to the exit lane, ≤ 1 m and 6° apart on the arc. */
  points: Vector3[];
  /** Where it starts before the centre (along inDir) and ends after it (along outDir), m. */
  back: number;
  ahead: number;
  radius: number;
  /** Right turns: how far inside the junction centre the car's centre passes (m; < 0 outside). */
  inside: number | null;
};

const cross = (a: Vector3, b: Vector3) => a.x * b.z - a.z * b.x;
/** `v` turned left by `angle` radians (negative: right), on the ground plane. */
const turnLeft = (v: Vector3, angle: number) =>
  v
    .clone()
    .multiplyScalar(Math.cos(angle))
    .add(leftOf(v, Math.sin(angle)));
/** Signed angle from `a` to `b` (+ = left), as classifyTurn measures it. */
export const deflection = (a: Vector3, b: Vector3) => Math.atan2(leftOf(a, 1).dot(b), a.dot(b));

/**
 * Kerb corner radius from the two widths (GSI has no corner geometry): 2–5 m. Why not the 10 m and
 * more of real arterial corners: the game draws the streets as straight strips meeting at sharp
 * corners, and a wider arc would put the path over the pavement there.
 */
const kerbRadius = (inHalf: number, outHalf: number) =>
  Math.min(5, Math.max(2, 0.4 * Math.min(inHalf, outHalf)));

/**
 * The curve through one corner: the arc tangent to the approach and exit lane lines, its radius
 * set by the kind of turn, fitted inside the room it has. Null when the lines are parallel or
 * there is no room for an arc.
 */
export function cornerPath(c: CornerSpec): CornerPath | null {
  const a = c.inDir;
  const b = c.outDir;
  const la = c.inOffset;
  const lb = c.outOffset;
  const theta = deflection(a, b);
  const minBack = c.minBack ?? 0;
  const minAhead = c.minAhead ?? 0;
  const maxBack = Math.max(minBack, c.maxBack ?? Infinity);
  const maxAhead = Math.max(minAhead, c.maxAhead ?? Infinity);
  const n1 = leftOf(a, 1);
  const n2 = leftOf(b, 1);
  const isUturn = c.kind === "uturn" || Math.abs(theta) > UTURN_MIN;
  if (isUturn) return uturnPath(c.centre, a, la, lb);
  if (Math.abs(theta) < 1e-3) return null;
  // Lane lines O + s·a + la·n1 and O + u·b + lb·n2 meet at P (s along the approach, u the exit).
  const w = n2.clone().multiplyScalar(lb).sub(n1.clone().multiplyScalar(la));
  const k = cross(a, b);
  const s = cross(w, b) / k;
  const u = cross(w, a) / k;
  const tanHalf = Math.tan(Math.abs(theta) / 2);
  const side = Math.sign(theta); // +1 left, −1 right
  // The arc of radius r, its centre and how far inside the junction centre it passes.
  const arcAt = (r: number) => {
    const t = r * tanHalf;
    const t1 = c.centre
      .clone()
      .addScaledVector(a, s - t)
      .addScaledVector(n1, la);
    const centre = t1.clone().addScaledVector(n1, side * r);
    return { t, t1, centre };
  };
  const insideAt = (r: number) => {
    const { centre } = arcAt(r);
    const p = c.centre.clone().addScaledVector(a, s).addScaledVector(n1, la);
    const toApex = p.sub(centre).setY(0);
    const toO = c.centre.clone().sub(centre).setY(0);
    const d = toO.length();
    // Within the arc's sweep the centre is passed on the inside when it lies beyond the arc.
    const isInSweep =
      d > 1e-6 && toApex.normalize().dot(toO.divideScalar(d)) >= Math.cos(Math.abs(theta) / 2);
    return isInSweep ? d - r : -Math.abs(d - r) - 1;
  };
  // Room: the curve starts no further back than maxBack and ends no further than maxAhead.
  const tRoom = Math.min(s + maxBack, maxAhead - u);
  const rRoom = tRoom > 0 ? tRoom / tanHalf : 0;
  let radius: number;
  const isRight = theta < 0 && c.kind === "right";
  if (c.kind === "left" && theta > 0) {
    // Hugging the kerb: the kerb corner's radius plus the lane's distance from the kerb.
    const gap = Math.max(0.5, (c.inHalf - la + (c.outHalf - lb)) / 2);
    radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, kerbRadius(c.inHalf, c.outHalf) + gap));
  } else if (isRight && c.fromOneWay) {
    // 第4項: round the right-hand corner from the right edge, still inside the centre.
    const gap = Math.max(0.5, (c.inHalf + la + (c.outHalf + lb)) / 2);
    radius = Math.max(MIN_RADIUS, kerbRadius(c.inHalf, c.outHalf) + gap);
    while (radius < MAX_RADIUS && insideAt(radius) < 0) radius += 0.1;
  } else if (isRight) {
    // 第2項: the smallest arc that passes CENTRE_GAP inside the junction centre.
    radius = MIN_RADIUS;
    while (radius < MAX_RADIUS && insideAt(radius) < CENTRE_GAP) radius += 0.1;
  } else {
    radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, c.inHalf + c.outHalf, BEND_TANGENT / tanHalf));
  }
  radius = Math.min(radius, rRoom);
  // No room for an arc at all (another corner right next to it): no curve, the lanes just meet.
  if (radius < 0.5) return null;
  const { t, t1, centre } = arcAt(radius);
  const back = Math.max(t - s, minBack);
  const ahead = Math.max(u + t, minAhead);
  const points: Vector3[] = [];
  const start = c.centre.clone().addScaledVector(a, -back).addScaledVector(n1, la);
  if (back > t - s + 1e-6) points.push(start);
  // ≤ 1 m and ≤ 6° per piece.
  const n = Math.max(2, Math.ceil(Math.abs(theta) * radius), Math.ceil(Math.abs(theta) / (6 * DEG)));
  const r0 = t1.clone().sub(centre);
  for (let i = 0; i <= n; i++) points.push(centre.clone().add(turnLeft(r0, (theta * i) / n)));
  const end = c.centre.clone().addScaledVector(b, ahead).addScaledVector(n2, lb);
  if (ahead > u + t + 1e-6) points.push(end);
  return { points, back, ahead, radius, inside: isRight ? insideAt(Math.max(0.05, radius)) : null };
}

/**
 * A U-turn at a dead end (the only place routes make one): a half loop through the right from the
 * left lane to the other lane, its far end at the end of the street.
 */
function uturnPath(o: Vector3, a: Vector3, la: number, lb: number): CornerPath {
  const n1 = leftOf(a, 1);
  const half = (la + lb) / 2;
  const reach = Math.max(1.5, half);
  const points: Vector3[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const phi = (Math.PI * i) / n;
    points.push(
      o
        .clone()
        .addScaledVector(n1, (la - lb) / 2 + half * Math.cos(phi))
        .addScaledVector(a, reach * (Math.sin(phi) - 1)),
    );
  }
  return { points, back: reach, ahead: reach, radius: reach, inside: null };
}

/** Planned lane at a point of the path. */
export type LanePlan = {
  /** Lane centre left of the street's centreline (m). */
  offset: number;
  /** Lane (0 = leftmost) of `count`. */
  lane: number;
  count: number;
  /** On a corner curve (the offset there is only interpolated). */
  corner: boolean;
};

/** A rounded corner of the path, by route distance. */
export type Corner = { from: number; to: number; kind: CornerKind; radius: number; inside: number | null };

/**
 * Centre of lane `i` (0 = leftmost) left of the centreline, for traffic on this street. Lanes
 * split the carriageway half (two-way) or the whole carriageway (one-way); kept at least 1.6 m
 * inside the edge, since GSI 幅員 can include the pavement.
 */
export function laneCentre(seg: Segment, i: number, count = seg.lanes): number {
  const lanes = Math.max(1, count);
  const half = seg.line.width / 2;
  const span = seg.oneway === 0 ? half : seg.line.width;
  const width = span / lanes;
  const offset = half - (Math.min(i, lanes - 1) + 0.5) * width;
  return seg.oneway === 0 ? Math.max(0.8, Math.min(offset, half - 1.6)) : Math.min(offset, half - 1.6);
}

const isRightward = (turn: Turn) => turn === "right" || turn === "slightRight" || turn === "uturn";
// Keeping to one edge of a one-way street without lanes: as far in as the left lane of a two-way one.
const edgeHug = (seg: Segment) => Math.max(0, Math.min(seg.line.width / 4, seg.line.width / 2 - 2));

/**
 * The lane to be in at route distance `d` on `step`: on a 進行方向別通行区分 approach one that goes
 * the route's way (第35条第1項; the rightmost of them to turn right, else the leftmost); otherwise
 * the leftmost (第20条第1項), or the rightmost before a right turn (第34条). Within 30 m of the
 * turn, a street without lanes is kept to as the law says: by the centre line (two-way) or the
 * right edge (one-way) to turn right, the left edge of a one-way street to turn left. `forced`
 * overrides the lane (planLanes: held across a 進路変更禁止 stretch, or moved into before it).
 */
export function laneFor(
  d: number,
  step: Step,
  hints: readonly LaneHint[],
  maneuvers: readonly Maneuver[],
  forced: number | null = null,
): Omit<LanePlan, "corner"> {
  const seg = step.seg;
  let count = Math.max(1, seg.lanes);
  const next = maneuvers.find((m) => m.at > d);
  const toTurn = next ? next.at - d : Infinity;
  const hint = hints.find((h) => h.seg === seg && h.dir === step.dir && h.at > d && h.at - d < LANE_PREPARE);
  let lane = 0;
  if (hint) {
    const ok = hint.ok.flatMap((v, i) => (v ? [i] : []));
    lane = isRightward(hint.take) ? ok[ok.length - 1] : ok[0];
    count = hint.lanes.length;
  } else if (next && toTurn < LANE_PREPARE && isRightward(next.turn)) lane = count - 1;
  if (forced !== null) lane = Math.max(0, Math.min(forced, count - 1));
  let offset = count > 1 ? laneCentre(seg, lane, count) : laneOffset(seg);
  const isHugging = next !== undefined && toTurn < HUG_BEFORE && count === 1;
  const isRightTurn = next?.turn === "right" || next?.turn === "uturn";
  const isOneWay = seg.oneway !== 0;
  if (isHugging && isRightTurn && !isOneWay) offset = Math.min(offset, CENTRE_HUG);
  if (isHugging && isRightTurn && isOneWay) offset = -edgeHug(seg);
  if (isHugging && next.turn === "left" && isOneWay) offset = edgeHug(seg);
  return { offset, lane, count };
}

/** Corner groups found on the centreline: sample indices of its first, last and main vertex. */
type Group = { first: number; last: number; seed: number; kind: CornerKind };

/** Signed turn at each centreline sample (0 except at polyline vertices). */
function vertexTurns(points: readonly Vector3[]): number[] {
  const turns = points.map(() => 0);
  for (let j = 1; j < points.length - 1; j++) {
    const into = points[j]
      .clone()
      .sub(points[j - 1])
      .setY(0);
    const out = points[j + 1].clone().sub(points[j]).setY(0);
    if (into.lengthSq() < 1e-6 || out.lengthSq() < 1e-6) continue;
    turns[j] = deflection(into.normalize(), out.normalize());
  }
  return turns;
}

/**
 * Corners along the centreline. A turn at a junction can span several GSI nodes (big junctions
 * are boxes of short segments), so nodes of the same box turning the same way are joined; a street
 * that keeps bending the same way before or after is a curve (or a roundabout), not a turn there.
 */
function findGroups(route: Route, graph: RoadGraph, turns: readonly number[]): Group[] {
  const { cum, stepOf, steps } = route;
  const isJunction = (j: number) => {
    const isBoundary = j + 1 < stepOf.length && stepOf[j] !== stepOf[j + 1];
    if (!isBoundary) return false;
    const st = steps[stepOf[j]];
    const node = st.dir === 1 ? st.seg.to : st.seg.from;
    return (graph.nodes.get(node)?.length ?? 0) >= 3;
  };
  const vertices = turns.flatMap((t, j) => (Math.abs(t) > 1e-4 ? [j] : []));
  const used = new Set<number>();
  const groups: Group[] = [];
  const sameWay = (j: number, sign: number) => Math.sign(turns[j]) === sign && Math.abs(turns[j]) >= JOIN_MIN;
  const seeds = vertices
    .filter((j) => isJunction(j) && Math.abs(turns[j]) >= SEED_MIN)
    .toSorted((p, q) => Math.abs(turns[q]) - Math.abs(turns[p]));
  for (const seed of seeds) {
    if (used.has(seed)) continue;
    const sign = Math.sign(turns[seed]);
    let total = turns[seed];
    let lo = vertices.indexOf(seed);
    let hi = lo;
    // A junction box is about as big as its widest street: the bends of a narrow street 15 m
    // before a junction are not part of it.
    const wide = Math.max(
      steps[stepOf[seed]].seg.line.width,
      steps[stepOf[seed + 1] ?? stepOf[seed]].seg.line.width,
    );
    const reach = Math.min(JOIN_REACH, Math.max(6, wide / 2 + 4));
    const canJoin = (j: number, from: number) =>
      !used.has(j) &&
      sameWay(j, sign) &&
      Math.abs(cum[j] - cum[from]) <= reach &&
      Math.abs(total + turns[j]) <= 135 * DEG;
    while (lo > 0 && canJoin(vertices[lo - 1], vertices[lo])) total += turns[vertices[--lo]];
    while (hi < vertices.length - 1 && canJoin(vertices[hi + 1], vertices[hi]))
      total += turns[vertices[++hi]];
    if (Math.abs(total) < TURN_MIN) continue;
    // Kinks of either way within a few metres of the turn are part of the junction's geometry: the
    // streets' directions are taken beyond them.
    const isKinkBy = (j: number | undefined, from: number) =>
      j !== undefined &&
      !used.has(j) &&
      Math.abs(cum[j] - cum[from]) <= ABSORB &&
      Math.abs(turns[j]) < 45 * DEG;
    while (isKinkBy(vertices[lo - 1], vertices[lo])) lo--;
    while (isKinkBy(vertices[hi + 1], vertices[hi])) hi++;
    const before = vertices[lo - 1];
    const after = vertices[hi + 1];
    const isCurving =
      (before !== undefined && sameWay(before, sign) && cum[vertices[lo]] - cum[before] <= reach) ||
      (after !== undefined && sameWay(after, sign) && cum[after] - cum[vertices[hi]] <= reach);
    const isUturn = Math.abs(total) > UTURN_MIN;
    if (isCurving && !isUturn) continue;
    for (let i = lo; i <= hi; i++) used.add(vertices[i]);
    const kind = isUturn ? "uturn" : sign > 0 ? "left" : "right";
    groups.push({ first: vertices[lo], last: vertices[hi], seed, kind });
  }
  // Bends: GSI rounds a sharp corner of a street with a few vertices a metre or two apart, so
  // vertices close together turning the same way are one bend (rounding each alone in its tiny
  // room would leave a lane inside the curve doubling back on itself).
  for (let i = 0; i < vertices.length; i++) {
    const j = vertices[i];
    if (used.has(j) || Math.abs(turns[j]) < JOIN_MIN) continue;
    const sign = Math.sign(turns[j]);
    let total = turns[j];
    let hi = i;
    while (hi + 1 < vertices.length) {
      const k = vertices[hi + 1];
      const isClose = cum[k] - cum[vertices[hi]] <= BEND_JOIN;
      const isJoinable =
        isClose && !used.has(k) && sameWay(k, sign) && Math.abs(total + turns[k]) <= UTURN_MIN;
      if (!isJoinable) break;
      total += turns[k];
      hi++;
    }
    const isUturn = hi === i && Math.abs(total) > UTURN_MIN;
    if (Math.abs(total) >= BEND_MIN)
      groups.push({ first: j, last: vertices[hi], seed: j, kind: isUturn ? "uturn" : "bend" });
    i = hi;
  }
  return groups.toSorted((p, q) => cum[p.first] - cum[q.first]);
}

/** Direction of the centreline leaving (ahead) or entering (behind) sample j. */
function pieceDir(points: readonly Vector3[], j: number, ahead: boolean): Vector3 {
  const step = ahead ? 1 : -1;
  for (let k = j + step; k >= 0 && k < points.length; k += step) {
    const v = ahead ? points[k].clone().sub(points[j]) : points[j].clone().sub(points[k]);
    v.setY(0);
    if (v.lengthSq() > 1e-4) return v.normalize();
  }
  return new Vector3(0, 0, -1);
}

export type DrivePath = {
  points: Vector3[];
  cum: number[];
  stepOf: number[];
  lanes: LanePlan[];
  corners: Corner[];
  /**
   * Route distances of the turns (and レーン案内 junctions) the plan cannot reach in a lane that
   * goes there without crossing a yellow lane line: planRoute plans round them.
   */
  blocked: number[];
};

// A lane change before a 進路変更禁止 stretch is over this far before its first point.
const BAN_LEAD = 10;
// Metres before a junction that its turn's curve may take (where no lane change can go).
const TURN_ROOM = 20;

/** Offsets (m left of the centreline) a lane spans, as laneBand gives them. */
type Band = { min: number; max: number };
const inBand = (band: Band | null, v: number) => (band ? Math.max(band.min, Math.min(band.max, v)) : v);

/**
 * The band of offsets each centreline sample must stay in (null: free): on a 進路変更禁止 segment
 * the painted lane (laneBand, counted as the violation check counts it) of the first sample of that
 * segment in the stretch, so a change of the lane count the plan uses there (a レーン案内 approach
 * counts its own lanes) or of the street's width never moves the path over a yellow line. The
 * junction sample where a stretch begins belongs to the street before, but the path from it runs
 * on the stretch: it takes the stretch's band too (within the one before's, if both are banned).
 */
function laneBands(route: Route, plans: ReadonlyArray<Omit<LanePlan, "corner">>): Array<Band | null> {
  const { points: axis, cum, stepOf, steps, maneuvers } = route;
  const isTurnNode = (j: number) => maneuvers.some((m) => Math.abs(m.at - cum[j]) < 1e-6);
  const segOf = (j: number) => steps[stepOf[j]].seg;
  const bands: Array<Band | null> = axis.map(() => null);
  for (let j = 0; j < axis.length; j++) {
    const seg = segOf(j);
    if (!isLaneChangeBanned(seg)) continue;
    const before = j > 0 ? bands[j - 1] : null;
    const isHeldOn = before !== null && !isTurnNode(j - 1);
    if (isHeldOn && segOf(j - 1) === seg) {
      bands[j] = before;
      continue;
    }
    // On into the next segment of the stretch: the lane the path is in there (where it is, not the
    // lane number the plan counts: the next one may count other lanes, or be wider).
    const from = isHeldOn ? inBand(before, plans[j - 1].offset) : plans[j].offset;
    const lane = Math.max(0, Math.min(seg.lanes - 1, laneOfOffset(seg, from)));
    bands[j] = laneBand(seg, lane);
  }
  for (let j = 0; j < axis.length - 1; j++) {
    const next = bands[j + 1];
    // Not the zero-length last step of a route that ends at a junction (nothing runs on it).
    const isEntry = next !== null && segOf(j) !== segOf(j + 1) && !isTurnNode(j) && cum[j + 1] > cum[j] + 0.5;
    if (!isEntry) continue;
    const own = bands[j];
    if (!own) {
      bands[j] = next;
      continue;
    }
    // Streets of very different widths may share no offset in that lane: then the street it is on.
    const both = { min: Math.max(own.min, next.min), max: Math.min(own.max, next.max) };
    if (both.min <= both.max) bands[j] = both;
  }
  return bands;
}

/** A 進路変更禁止 stretch of the route: centreline samples a..b. */
type Hold = { a: number; b: number };

/**
 * The lane each centreline sample is held in (null: the plain plan, laneFor), so that the route
 * never changes lanes on a segment where it is 進路変更禁止 (道路交通法 第26条の2第3項, the
 * yellow lane line; isLaneChangeBanned is what the violation check books). A stretch is the run of
 * banned samples between turns; the car stays in one lane through it:
 *
 * - entered by a turn: the lane the turn's curve comes into first (the rightmost after a right
 *   turn, the leftmost after a left one), then as below with no room before it;
 * - the same lane as it arrives in, when that is wanted at the end too, or when there is room to
 *   change after it before the next turn;
 * - else the lane wanted at its end, the change moved before it (finished BAN_LEAD before);
 *   whichever lane it keeps, the plan is in it over the approach (room for the widest change),
 *   so a change the plain plan starts just before the stretch never runs into it;
 * - else (no room either side: the route starts in it, or another stretch just before) the lane it
 *   arrives in, held up to the next turn, and that turn is reported `blocked` when that lane does
 *   not go its way.
 */
function planLanes(
  route: Route,
  hints: readonly LaneHint[],
  startLane: number,
): { forced: Array<number | null>; blocked: number[] } {
  const { points: axis, cum, stepOf, steps, maneuvers } = route;
  const n = axis.length;
  const want = axis.map((_, j) => laneFor(cum[j], steps[stepOf[j]], hints, maneuvers));
  const forced: Array<number | null> = axis.map(() => null);
  forced[0] = startLane;
  const isHeld = axis.map(() => false);
  const isTurnNode = (j: number) => j >= 0 && maneuvers.some((m) => Math.abs(m.at - cum[j]) < 1e-6);
  const isBanned = (j: number) => isLaneChangeBanned(steps[stepOf[j]].seg);
  const holds: Hold[] = [];
  for (let j = 0; j < n; j++) {
    if (!isBanned(j)) continue;
    const last = holds.at(-1);
    const isContinued = last !== undefined && last.b === j - 1 && !isTurnNode(j - 1);
    if (isContinued) last.b = j;
    else holds.push({ a: j, b: j });
  }
  const laneAt = (j: number) => laneFor(cum[j], steps[stepOf[j]], hints, maneuvers, forced[j]).lane;
  const offsetAt = (j: number, lane: number) =>
    laneFor(cum[j], steps[stepOf[j]], hints, maneuvers, lane).offset;
  const indexFrom = (d: number) => {
    let j = 0;
    while (j < n - 1 && cum[j] < d) j++;
    return j;
  };
  let anchor = 0; // route distance before which the lanes are settled (the last stretch's end)
  for (const h of holds) {
    const { a, b } = h;
    // The lane wanted at its end: at the last point before a junction it ends at (the junction's own
    // point already plans for the turn after it).
    const exitWant = want[isTurnNode(b) && b > 0 ? b - 1 : b].lane;
    const nextTurn = maneuvers.find((m) => m.at >= cum[b] - 1e-6);
    const turnBefore = maneuvers.filter((m) => m.at > anchor && m.at < cum[a]).at(-1);
    const entry = a > 0 ? maneuvers.find((m) => Math.abs(m.at - cum[a - 1]) < 1e-6) : undefined;
    const isEnteredByTurn = entry !== undefined;
    // The approach a lane change before the stretch may use: room for the widest change on its
    // first segment (all its lanes across), from the last turn (which can end in any lane) or the
    // last stretch. Why the widest and not the change at hand: the plain plan may already be
    // moving over just before the stretch (120 m before a right turn), so the lane at a - 1 is
    // not the lane the car is settled in.
    const { count } = want[a];
    const needWidest = Math.abs(offsetAt(a, 0) - offsetAt(a, count - 1)) / LANE_SLOPE + BAN_LEAD;
    const zoneFrom = Math.max(turnBefore?.at ?? anchor, cum[a] - needWidest);
    const zone = a === 0 ? a : Math.max(1, indexFrom(zoneFrom));
    // The lane it arrives in when nothing moves it over in that approach. Turned into, the lane the
    // curve reaches first: the curve of a right turn comes in from the centre line, of a left turn
    // from the kerb, so ending in any other lane would cross the yellow lines on the way.
    const turnedInto = !entry
      ? null
      : entry.turn === "right" || entry.turn === "uturn"
        ? count - 1
        : entry.turn === "left"
          ? 0
          : exitWant;
    const arrive = turnedInto ?? (a === 0 ? startLane : laneAt(Math.max(0, zone - 1)));
    const need = Math.abs(offsetAt(a, exitWant) - offsetAt(a, arrive)) / LANE_SLOPE + BAN_LEAD;
    const roomAfter = (nextTurn?.at ?? route.length) - cum[b] - TURN_ROOM;
    const isRoomBefore = a > 0 && !isEnteredByTurn && (turnBefore !== undefined || cum[a] - need >= anchor);
    const isKept = exitWant === arrive || roomAfter >= need;
    const lane = isKept || !isRoomBefore ? arrive : exitWant;
    const isStuck = !isKept && !isRoomBefore;
    if (isStuck) {
      // Kept up to the next turn: no lane change between the yellow line and the junction either.
      const until = nextTurn?.at ?? route.length;
      for (let j = b + 1; j < n && cum[j] < until; j++) {
        forced[j] = arrive;
        isHeld[j] = true;
      }
    }
    // In that lane from the start of the approach, so any change is over before the yellow line.
    if (!isEnteredByTurn) for (let j = zone; j < a; j++) forced[j] = lane;
    for (let j = a; j <= b; j++) {
      forced[j] = lane;
      isHeld[j] = true;
    }
    anchor = cum[b];
  }
  // Turns and designated junctions approached in a held lane that does not go their way.
  const blocked = new Set<number>();
  const approach = (at: number) => {
    let j = 0;
    while (j < n - 1 && cum[j + 1] < at - 1e-6) j++;
    return j;
  };
  for (const hint of hints) {
    const j = approach(hint.at);
    const isWrong = isHeld[j] && hint.ok[laneAt(j)] === false;
    if (isWrong) blocked.add(hint.at);
  }
  for (const m of maneuvers) {
    const j = approach(m.at);
    const hasHint = hints.some((hint) => Math.abs(hint.at - m.at) < 1e-6);
    const isWrong = !hasHint && isHeld[j] && laneAt(j) !== want[j].lane;
    if (isWrong) blocked.add(m.at);
  }
  return { forced, blocked: [...blocked] };
}

/** Smoothstep: 0 below 0, 1 above 1, an S between. */
const smooth = (u: number) => {
  const v = Math.min(1, Math.max(0, u));
  return v * v * (3 - 2 * v);
};

/** Route distances from `from` to `to` spread over a polyline in proportion to its length. */
function spread(pts: readonly Vector3[], from: number, to: number): number[] {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = Math.max(1e-6, len[len.length - 1]);
  return len.map((l) => from + ((to - from) * l) / total);
}

/**
 * The driven path of a route whose `points` are still the streets' centrelines: each point moved
 * into its planned lane (lane changes eased at 1 m per 10 m), and every corner replaced by its
 * curve (cornerPath). `cum` stays the route distance along the centrelines, so `at` values,
 * maneuvers and steps keep their meaning; inside a curve it is spread evenly along the arc.
 */
export function drivePath(
  graph: RoadGraph,
  route: Route,
  hints: readonly LaneHint[],
  /** The lane the car is in at the start (0 = leftmost, as the autopilot assumes when unknown). */
  startLane = 0,
): DrivePath {
  const { points: axis, cum, stepOf, steps, maneuvers } = route;
  // Lane plan at every centreline point, held across 進路変更禁止 stretches (planLanes).
  const { forced, blocked } = planLanes(route, hints, startLane);
  const plain = axis.map((_, j) => laneFor(cum[j], steps[stepOf[j]], hints, maneuvers, forced[j]));
  const bands = laneBands(route, plain);
  const raw = plain.map((plan, j) => ({ ...plan, offset: inBand(bands[j], plan.offset) }));
  const planAt = (j: number, d: number) => {
    const plan = laneFor(d, steps[stepOf[j]], hints, maneuvers, forced[j]);
    return { ...plan, offset: inBand(bands[j], plan.offset) };
  };
  /** The centreline sample at or before route distance d. */
  const sampleAt = (d: number) => {
    let j = 0;
    while (j < axis.length - 1 && cum[j + 1] <= d) j++;
    return j;
  };
  const turns = vertexTurns(axis);
  const vertices = turns.flatMap((t, j) => (Math.abs(t) > 1e-4 ? [j] : []));
  const groups = findGroups(route, graph, turns);

  type Plan = Omit<LanePlan, "corner">;
  type Built = {
    from: number;
    to: number;
    kind: CornerKind;
    path: CornerPath;
    inPlan: Plan;
    outPlan: Plan;
    mid: number;
  };
  /**
   * How far the centreline runs straight on (within 8° of its direction) from sample j, ahead or
   * back: a curve tangent to the lane line extended straight must not reach further than that.
   */
  const straightRun = (j: number, ahead: boolean) => {
    let bent = 0;
    for (let k = ahead ? j + 1 : j - 1; k > 0 && k < axis.length - 1; k += ahead ? 1 : -1) {
      bent += Math.abs(turns[k]);
      if (bent > 8 * DEG) return Math.abs(cum[k] - cum[j]);
    }
    return Infinity;
  };
  /** The curve of one group, starting no earlier than `minFrom` and ending by `maxTo`. */
  const buildCorner = (group: Group, minFromRoom: number, maxToRoom: number): Built | null => {
    let g = group;
    let inDir = pieceDir(axis, g.first, false);
    let outDir = pieceDir(axis, g.last, true);
    // The junction centre: where the approach and exit centrelines (extended) cross.
    const k = cross(inDir, outDir);
    const gap = axis[g.last].clone().sub(axis[g.first]);
    let alpha = Math.abs(k) > 1e-3 ? cross(gap, outDir) / k : 0;
    let beta = Math.abs(k) > 1e-3 ? cross(inDir, gap) / k : 0;
    // Streets that do not meet ahead (the box's geometry is odd): the main vertex alone.
    const isOdd = alpha < 0 || beta < 0 || alpha > 40 || beta > 40;
    if (isOdd) {
      g = { ...g, first: g.seed, last: g.seed };
      inDir = pieceDir(axis, g.first, false);
      outDir = pieceDir(axis, g.last, true);
      [alpha, beta] = [0, 0];
    }
    const minFrom = Math.max(minFromRoom, cum[g.first] - straightRun(g.first, false));
    const maxTo = Math.min(maxToRoom, cum[g.last] + straightRun(g.last, true));
    if (cum[g.first] < minFrom || cum[g.last] > maxTo) return null;
    const centre = axis[g.first].clone().addScaledVector(inDir, alpha);
    // Plans just before the first vertex (approach) and just after the last (exit).
    const inPlan = planAt(Math.max(0, g.first - 1), cum[g.first] - 0.01);
    let outPlan = planAt(Math.min(axis.length - 1, g.last + 1), cum[g.last] + 0.01);
    const inSeg = steps[stepOf[Math.max(0, g.first - 1)]].seg;
    const outSeg = steps[stepOf[Math.min(axis.length - 1, g.last + 1)]].seg;
    // A bend rounds the street's centreline itself; the lane offset is applied along it after.
    const isBend = g.kind === "bend";
    const curve = (outOffset: number) =>
      cornerPath({
        kind: g.kind,
        centre,
        inDir,
        outDir,
        inOffset: isBend ? 0 : inPlan.offset,
        outOffset: isBend ? 0 : outOffset,
        inHalf: inSeg.line.width / 2,
        outHalf: outSeg.line.width / 2,
        fromOneWay: inSeg.oneway !== 0,
        minBack: alpha,
        maxBack: alpha + Math.max(0, cum[g.first] - minFrom),
        minAhead: beta,
        maxAhead: beta + Math.max(0, maxTo - cum[g.last]),
      });
    // The end of a turn's curve on a 進路変更禁止 segment (a piece of a big junction box, or the
    // street it turns into): it ends in the lane the curve comes into first, the one by the centre
    // line after a right turn and by the kerb after a left one. Ending further over, its last
    // stretch (aligned with the street already) would cross the yellow lines.
    let isExitBanned = false;
    for (let j = g.seed + 1; j <= Math.min(axis.length - 1, g.last + 1); j++) {
      if (isLaneChangeBanned(steps[stepOf[j]].seg)) isExitBanned = true;
    }
    const isRightExit = g.kind === "right" || g.kind === "uturn";
    const entryLane = isRightExit ? outPlan.count - 1 : 0;
    const isTurnExit = isExitBanned && g.kind !== "bend" && outPlan.count > 1 && outPlan.lane !== entryLane;
    if (isTurnExit) {
      const j = Math.min(axis.length - 1, g.last + 1);
      const offset = inBand(bands[j], laneCentre(outSeg, entryLane, outPlan.count));
      outPlan = { ...outPlan, lane: entryLane, offset };
    }
    let path = curve(outPlan.offset);
    // Right into a wide street: a sweep into its far left lane would run along the oncoming half
    // for seconds (右側通行), so the curve ends in the lane by the centre line and the car moves
    // over to the left lane after it.
    const isWideSweep = g.kind === "right" && path !== null && path.radius > WIDE_SWEEP;
    if (isWideSweep) {
      const near = outPlan.count > 1 ? laneCentre(outSeg, outPlan.count - 1, outPlan.count) : 2 * CENTRE_HUG;
      const nearPlan = { ...outPlan, lane: outPlan.count - 1, offset: Math.min(outPlan.offset, near) };
      const tighter = curve(nearPlan.offset);
      if (tighter) [path, outPlan] = [tighter, nearPlan];
    }
    if (!path) return null;
    const from = cum[g.first] - (path.back - alpha);
    const to = cum[g.last] + (path.ahead - beta);
    return { from, to, kind: g.kind, path, inPlan, outPlan, mid: (cum[g.first] + cum[g.last]) / 2 };
  };
  // Turns first, each with room up to halfway to the next turn (bends in between give way: the
  // turn's curve replaces them); then the bends in the gaps left.
  const turnGroups = groups.filter((g) => g.kind !== "bend");
  const built: Built[] = [];
  let prevEnd = 0;
  turnGroups.forEach((g, gi) => {
    const next = turnGroups[gi + 1];
    const maxTo = next ? (cum[g.last] + cum[next.first]) / 2 : route.length;
    const corner = buildCorner(g, prevEnd, maxTo);
    if (!corner) return;
    built.push(corner);
    prevEnd = corner.to;
  });
  // A bend of several vertices is one arc only where that arc stays on the street: a hairpin's
  // straight ends meet far beyond it, so it is rounded vertex by vertex instead.
  const strays = (c: Built, g: Group) => {
    const tolerance = Math.max(1, steps[stepOf[g.first]].seg.line.width / 4);
    for (let j = g.first; j <= g.last; j++) {
      let best = Infinity;
      for (const q of c.path.points) best = Math.min(best, q.distanceTo(axis[j]));
      if (best > tolerance + 1.5) return true;
    }
    return false;
  };
  const bends = groups
    .filter((g) => g.kind === "bend")
    .flatMap((g) => {
      if (g.first === g.last) return [g];
      const whole = buildCorner(g, 0, route.length);
      if (!whole || !strays(whole, g)) return [g];
      return vertices
        .filter((j) => j >= g.first && j <= g.last && Math.abs(turns[j]) >= BEND_MIN)
        .map((j) => ({ ...g, first: j, last: j, seed: j }));
    });
  bends.forEach((g, gi) => {
    const turnBefore = built.filter((c) => c.kind !== "bend" && c.from <= cum[g.first]).at(-1);
    const turnAfter = built.find((c) => c.kind !== "bend" && c.from > cum[g.first]);
    const bendBefore = built.filter((c) => c.kind === "bend").at(-1);
    const next = bends[gi + 1];
    const minFrom = Math.max(turnBefore?.to ?? 0, bendBefore?.to ?? 0);
    const maxTo = Math.min(
      turnAfter?.from ?? route.length,
      next ? (cum[g.last] + cum[next.first]) / 2 : route.length,
    );
    const corner = buildCorner(g, minFrom, maxTo);
    if (corner) built.push(corner);
  });
  const ordered = built.toSorted((p, q) => p.from - q.from);
  const stepAt = (d: number) => {
    let k = 0;
    while (k < route.stepStart.length - 1 && route.stepStart[k + 1] <= d) k++;
    return k;
  };
  // The path as a stream: points of the (rounded) centreline to move into the lane, and the
  // turns' curves, which are already in their lanes.
  // On a 進路変更禁止 segment a point also carries the offsets its lane spans there (`band`, the
  // lane counted as the violation check counts it), and the easing never takes it out of them.
  type LaneItem = {
    p: Vector3;
    dir: Vector3;
    d: number;
    step: number;
    plan: Plan;
    scale: number;
    band: Band | null;
  };
  const stream: Array<LaneItem | Built> = [];
  const lanePoint = (
    p: Vector3,
    dir: Vector3,
    d: number,
    step: number,
    plan: Plan,
    band: Band | null,
    scale = 1,
  ) => {
    stream.push({ p, dir, d, step, plan, scale, band });
  };
  let ci = 0;
  for (let j = 0; j < axis.length; j++) {
    const corner = ordered[ci];
    if (corner && cum[j] >= corner.from) {
      if (corner.kind === "bend") {
        const pts = corner.path.points;
        spread(pts, corner.from, corner.to).forEach((d, i) => {
          const ahead = pts[Math.min(pts.length - 1, i + 1)];
          const behind = pts[Math.max(0, i - 1)];
          const dir = ahead.clone().sub(behind).setY(0).normalize();
          const k = stepAt(d);
          const j0 = sampleAt(d);
          // The band of the sample the arc point lies after, or of the next one where that is the
          // previous street's.
          const jb = stepOf[j0] === k || j0 + 1 >= axis.length ? j0 : j0 + 1;
          const plan = laneFor(d, steps[k], hints, maneuvers, forced[jb]);
          // The rounded centreline is off the street's own (inside the bend), and the check
          // measures from the street's: the band moves by as much.
          const band = bands[jb];
          const off = band ? graph.nearestOn(steps[k].seg, pts[i]).lateral * steps[k].dir : 0;
          const shifted = band ? { min: band.min - off, max: band.max - off } : null;
          lanePoint(pts[i], dir, d, k, { ...plan, offset: inBand(shifted, plan.offset) }, shifted);
        });
      } else {
        stream.push(corner);
      }
      // Skip the centreline points the curve replaces (the loop moves on to the first after it).
      let k = j - 1;
      while (k + 1 < axis.length && cum[k + 1] <= corner.to) k++;
      j = k;
      ci++;
      continue;
    }
    // Mitred at small kinks.
    // The last point of a route ending at a junction is followed by the zero-length last step's
    // point at the same place: no piece leaves it (pieceDir would answer north), so it is the end.
    let isEnd = true;
    for (let k = j + 1; k < axis.length && isEnd; k++) isEnd = axis[k].distanceToSquared(axis[j]) <= 1e-4;
    const into = j > 0 ? pieceDir(axis, j, false) : pieceDir(axis, j, true);
    const out = isEnd ? into : pieceDir(axis, j, true);
    const mitre = into.clone().add(out);
    const dir = mitre.lengthSq() > 1e-6 ? mitre.normalize() : out;
    lanePoint(axis[j], dir, cum[j], stepOf[j], raw[j], bands[j], 1 / Math.max(0.5, dir.dot(out)));
  }
  // Lane changes eased at LANE_SLOPE: forward from where the plan changes (and from each turn's
  // exit lane), then backward so the car is already in the lane each turn's curve starts from.
  const isLane = (x: LaneItem | Built): x is LaneItem => "plan" in x;
  const eased = new Map<LaneItem, number>();
  let value = stream.find(isLane)?.plan.offset ?? 0;
  let lastD = 0;
  for (const x of stream) {
    if (!isLane(x)) {
      value = x.outPlan.offset;
      lastD = x.to;
      continue;
    }
    const ease = LANE_SLOPE * Math.max(0, x.d - lastD);
    value = inBand(x.band, value + Math.max(-ease, Math.min(ease, x.plan.offset - value)));
    lastD = x.d;
    eased.set(x, value);
  }
  let nextD = Infinity;
  let nextValue: number | null = null;
  for (let i = stream.length - 1; i >= 0; i--) {
    const x = stream[i];
    if (!isLane(x)) {
      nextValue = x.inPlan.offset;
      nextD = x.from;
      continue;
    }
    let v = eased.get(x) ?? x.plan.offset;
    if (nextValue !== null) {
      const ease = LANE_SLOPE * Math.max(0, nextD - x.d);
      v = inBand(x.band, Math.max(nextValue - ease, Math.min(nextValue + ease, v)));
    }
    eased.set(x, v);
    nextValue = v;
    nextD = x.d;
  }

  const inLane = (x: LaneItem) => x.p.clone().add(leftOf(x.dir, (eased.get(x) ?? x.plan.offset) * x.scale));
  const points: Vector3[] = [];
  const outCum: number[] = [];
  const outStep: number[] = [];
  const lanes: LanePlan[] = [];
  stream.forEach((x, xi) => {
    if (isLane(x)) {
      const offset = eased.get(x) ?? x.plan.offset;
      const p = inLane(x);
      // Where a lane inside a tight bend would double back on itself, leave the point out (and
      // the end of one curve that is the start of the next).
      const last = points[points.length - 1];
      const isBackward = last !== undefined && p.clone().sub(last).dot(x.dir) < 0.05;
      if (isBackward) return;
      points.push(p);
      outCum.push(x.d);
      outStep.push(x.step);
      lanes.push({ ...x.plan, offset, corner: false });
      return;
    }
    // A turn's curve, its route distances spread along it in proportion to arc length. Its ends
    // lie on the lane lines extended straight from the junction; where the street itself bends
    // or kinks before or after, they are eased onto the lane points there over half the curve.
    const pts = x.path.points;
    const total = Math.max(1e-6, x.to - x.from);
    const before = stream[xi - 1];
    const after = stream[xi + 1];
    const stitch = (item: LaneItem | Built | undefined, end: Vector3, along: number) => {
      if (!item || !isLane(item) || Math.abs(along) > 8) return new Vector3();
      const delta = inLane(item).addScaledVector(item.dir, along).sub(end).setY(0);
      return delta.length() < 6 ? delta : new Vector3();
    };
    const startDelta = stitch(before, pts[0], before && isLane(before) ? x.from - before.d : 0);
    const endDelta = stitch(after, pts[pts.length - 1], after && isLane(after) ? x.to - after.d : 0);
    spread(pts, x.from, x.to).forEach((d, i) => {
      const t = (d - x.from) / total;
      const p = pts[i]
        .clone()
        .addScaledVector(startDelta, 1 - smooth(t * 2))
        .addScaledVector(endDelta, smooth(t * 2 - 1));
      const last = points[points.length - 1];
      if (last !== undefined && last.distanceTo(p) < 0.05) return;
      points.push(p);
      outCum.push(d);
      outStep.push(stepAt(d));
      const plan = d < x.mid ? x.inPlan : x.outPlan;
      lanes.push({ ...plan, offset: x.inPlan.offset * (1 - t) + x.outPlan.offset * t, corner: true });
    });
  });
  const corners = ordered.map((c) => ({
    from: c.from,
    to: c.to,
    kind: c.kind,
    radius: c.path.radius,
    inside: c.path.inside,
  }));
  return { points, cum: outCum, stepOf: outStep, lanes, corners, blocked };
}

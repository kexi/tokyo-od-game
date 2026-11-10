import type { Vector3 } from "three";
import {
  CONFIRM_AFTER,
  CONFIRM_ROWS,
  CONFIRM_SPACING,
  DIRECTION_BACKS,
  ROAD_DETOUR,
} from "../signs/boardAssumptions";
import { GUIDE_PLACES } from "../signs/boardStandards";
import type { Row, RowsContent } from "../signs/board/content";
import {
  armNames,
  isGuideJunction,
  junctionArms,
  junctionCentre,
  junctionNodesOf,
  KERB_GAP,
  lanesFor,
  letterHeight,
  MIN_SPACING,
  mountFor,
  onTrace,
  pickPlace,
  roadClass,
  signName,
  spotFor,
  type Arm,
  type GuideApproach,
  type GuidePlace,
  type GuidePlan,
  type PlanInput,
  type Trace,
} from "./guidePlan";
import { leftOf, speedLimit, type RoadGraph, type Segment } from "./roads";

/**
 * 105 方面、方向及び距離 and 106-A 方面及び距離 (確認標識) for the signalled junctions, planned after
 * the 108 series (guidePlan.ts) so the 108 boards keep their places, and drawn by the `rows`
 * template (src/signs/board/rows.ts).
 *
 * Where they stand is declared in ROW_PLACEMENTS:
 * - 105: 交差点の手前 30 m 以内 (別表第一), where the 108 planner found a guide junction but no spot
 *   for its 108の2 within 55–140 m (a street with a side road every 30 m). One row per direction:
 *   straight on, right, left (図 008), each with one place and its distance.
 * - 106-A: past a junction on a 一般国道 or 主要地方道, on the road carried straight on: the places
 *   ahead on it — the nearest 主要地, then a 重要地 beyond it, and 東京 (基準地, 日本橋) when the road
 *   leads there — the farthest on top (図 011). One for the same traffic per CONFIRM_SPACING.
 * Both stand on the left kerb as the 108 do: 片持式 on wide roads, 路側式 else (mountFor), held up
 * by src/signs/mount.ts resolveMount.
 *
 * The distances are road distances: along the traced road inside the graph, then the straight
 * distance times ROAD_DETOUR beyond it, printed in whole km (1 at least).
 */

export type RowsPlan = GuidePlan<RowsContent>;

/** The placement rules of the rows boards (values: boardStandards.ts and boardAssumptions.ts). */
export const ROW_PLACEMENTS = {
  "105": {
    measuredFrom: "stop-line",
    tries: DIRECTION_BACKS.value,
    maxBeforeM: GUIDE_PLACES.value.directionDistance.maxBeforeM,
    where: "a guide junction without a 108の2",
  },
  "106-A": {
    measuredFrom: "junction-centre",
    tries: CONFIRM_AFTER.value,
    spacingM: CONFIRM_SPACING.value,
    maxRows: CONFIRM_ROWS.value,
    where: "past a junction on a road of class 0 or 1, straight on",
  },
} as const;

/** How far an overhead board reaches over the road from its pole, m (arm 0.55 m + a 4 m board). */
const OVERHEAD_REACH = 5;

/** km as printed on a board: whole km, at least 1. */
export const printedKm = (metres: number) => Math.max(1, Math.round(metres / 1000));

/** Road distance (m) from the trace's start to a place: along the trace, or beyond its end. */
export function roadDistance(trace: Trace, pos: Vector3): number {
  const { dist, along } = onTrace(trace, pos);
  const isByTheRoad = along < trace.length - 1 && dist <= 250;
  if (isByTheRoad) return along;
  const end = trace.pts[trace.pts.length - 1];
  if (!end) return Math.hypot(pos.x, pos.z) * ROAD_DETOUR.value;
  return trace.length + Math.hypot(pos.x - end.x, pos.z - end.z) * ROAD_DETOUR.value;
}

/** 105-A (three rows), 105-B (two), 105-C (one). */
const directionKind = (rows: number): RowsContent["kind"] =>
  rows >= 3 ? "105-A" : rows === 2 ? "105-B" : "105-C";

/** Rows of a 105: straight on, then right, then left (図 008), one place each. */
export function directionRows(
  arms: Arm[],
  approachCls: ReturnType<typeof roadClass>,
  centre: Vector3,
  before: number,
  input: Pick<PlanInput, "places" | "names">,
): Row[] {
  const used = new Set<string>();
  const rows: Array<Row & { order: number }> = [];
  for (const arm of arms) {
    const isBack = Math.abs(arm.drawn) > 90;
    if (isBack) continue;
    // One place per row (図 008): the straight arm's first-rank place. Why not the junction names
    // (the 108's 一般地 of the last resort): a row names where the road leads, with a distance;
    // the next crossing's name is not a destination (表示地名 and stations only).
    const [place] = armNames(arm, approachCls, centre, input.places, [], used);
    if (!place) continue;
    const km = printedKm(before + roadDistance(arm.trace, place.pos));
    const order = arm.drawn === 0 ? 0 : arm.drawn < 0 ? 1 : 2;
    rows.push({
      angle: arm.drawn,
      name: signName(place.ja, place.en, input.places, input.names),
      km,
      order,
    });
  }
  return rows
    .toSorted((a, b) => a.order - b.order)
    .slice(0, 3)
    .map(({ order: _order, ...row }) => row);
}

/**
 * Places a 106 names ahead on the road: the nearest 主要地, the nearest 重要地 beyond it and 東京
 * (rank 0) beyond both, at least 1 km apart, the farthest first.
 */
export function confirmRows(
  trace: Trace,
  from: Vector3,
  after: number,
  refs: string[],
  input: Pick<PlanInput, "places" | "names">,
): Row[] {
  const picked: Array<{ place: GuidePlace; metres: number }> = [];
  const used = new Set<string>();
  for (const ranks of [[2], [1], [0]] as const) {
    const c = pickPlace(input.places, from, trace, refs, ranks, used);
    if (!c) continue;
    const metres = roadDistance(trace, c.place.pos) - after;
    const isBeyondLast = picked.every((p) => metres > p.metres + 1000);
    const isApart = picked.every((p) => p.place.pos.distanceTo(c.place.pos) > 1000);
    if (metres < 1000 || !isBeyondLast || !isApart) continue;
    picked.push({ place: c.place, metres });
    used.add(c.place.ja);
  }
  return picked
    .slice(0, ROW_PLACEMENTS["106-A"].maxRows)
    .toSorted((a, b) => b.metres - a.metres)
    .map(({ place, metres }) => ({
      angle: null,
      name: signName(place.ja, place.en, input.places, input.names),
      km: printedKm(metres),
    }));
}

/** The spot `after` metres down an arm (from the junction), the nodes passed on the way, or null. */
function alongArm(
  graph: RoadGraph,
  arm: Arm,
  after: number,
): { seg: Segment; pos: Vector3; dir: Vector3; passed: number[] } | null {
  let left = after;
  let seg = arm.seg;
  let dir = arm.dir;
  const passed: number[] = [];
  for (const next of [arm.seg, ...arm.trace.segs.slice(1)]) {
    if (next !== seg) {
      const end = dir === 1 ? seg.to : seg.from;
      passed.push(end);
      const isJoined = next.from === end || next.to === end;
      if (!isJoined) return null;
      dir = next.from === end ? 1 : -1;
      seg = next;
    }
    if (left <= seg.length) {
      const s = dir === 1 ? left : seg.length - left;
      const { pos, dir: d } = graph.sample(seg, s);
      return { seg, pos: pos.clone(), dir: d.clone().multiplyScalar(dir), passed };
    }
    left -= seg.length;
  }
  return null;
}

/** A signal pole's arm over the road: from its foot across its approach's carriageway, m. */
export type SignalArm = { pos: Vector3; travel: Vector3; reachM?: number };

export type RowsInput = PlanInput & {
  /** The 108 plans already placed (their poles are kept clear of, and their junctions known). */
  placed: GuidePlan[];
  /** Signal arms an overhead board must keep clear of (TrafficControl.signalPoles). */
  signalArms?: SignalArm[];
};

/** How far a signal arm is taken to reach over the road, m (the poles do not say). */
const ARM_REACH = 10;
/** An overhead board this close to a signal arm (plan view, m) would hang through it. */
const ARM_CLEAR = 4;

/** Distance in plan from p to the segment s0–s1. */
function pointToSeg(p: Vector3, s0: Vector3, s1: Vector3): number {
  const ex = s1.x - s0.x;
  const ez = s1.z - s0.z;
  const len2 = ex * ex + ez * ez;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - s0.x) * ex + (p.z - s0.z) * ez) / len2)) : 0;
  return Math.hypot(s0.x + ex * t - p.x, s0.z + ez * t - p.z);
}

/** Which side of o→p the point q is on (plan cross product). */
const cross = (o: Vector3, p: Vector3, q: Vector3) => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);

/** Shortest distance between two segments in plan (x, z). */
function segmentGap(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3): number {
  const isCrossing = cross(a0, a1, b0) * cross(a0, a1, b1) < 0 && cross(b0, b1, a0) * cross(b0, b1, a1) < 0;
  if (isCrossing) return 0;
  return Math.min(
    pointToSeg(a0, b0, b1),
    pointToSeg(a1, b0, b1),
    pointToSeg(b0, a0, a1),
    pointToSeg(b1, a0, a1),
  );
}

/**
 * Whether an overhead board standing at `kerb` (reaching `reach` m over the road, to the right of
 * `travel`) would hang through a signal arm. Why: the first review round found a 105 within 30 m
 * of a junction hung behind the arm of the crossing road's signal (the 108 stand 55 m back and
 * never met one).
 */
export function isUnderSignalArm(
  kerb: Vector3,
  travel: Vector3,
  reach: number,
  arms: readonly SignalArm[],
): boolean {
  const over = kerb.clone().add(leftOf(travel, -reach));
  return arms.some((arm) => {
    const tip = arm.pos.clone().add(leftOf(arm.travel, -(arm.reachM ?? ARM_REACH)));
    return segmentGap(kerb, over, arm.pos, tip) < ARM_CLEAR;
  });
}

/** All 105 and 106-A boards for the signalled junctions of the graph. */
export function* planRowSteps(input: RowsInput): Generator<void, RowsPlan[]> {
  const { graph, routes } = input;
  const junctionNodes = junctionNodesOf(graph);
  const signalled = new Set(input.approaches.flatMap((a) => a.nodes));
  const plans: RowsPlan[] = [];
  const signalArms = input.signalArms ?? [];
  const avoid = [...input.avoid, ...input.placed.map((p) => p.pos)];
  const everything = () => [...input.placed, ...plans];
  const isSpaced = (pos: Vector3, travel: Vector3) =>
    !everything().some((p) => {
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      return d < 4 || (d < MIN_SPACING && p.travel.dot(travel) > 0.7);
    });
  const hasJunctionBoard = (centre: Vector3, travel: Vector3) =>
    input.placed.some(
      (p) =>
        p.board.distance === null &&
        Math.hypot(p.centre.x - centre.x, p.centre.z - centre.z) < 1 &&
        p.travel.dot(travel) > 0.7,
    );
  for (const ap of input.approaches) {
    yield;
    const approachCls = roadClass(ap.seg, routes);
    const isArterial = approachCls <= 2 && ap.seg.line.width >= 7;
    if (!isArterial) continue;
    const centre = junctionCentre(graph, ap.nodes);
    if (!centre) continue;
    const arms = junctionArms(graph, ap, routes, centre);
    const letter = letterHeight(Math.max(40, speedLimit(ap.seg)), lanesFor(ap.seg));
    const mount = mountFor(ap.seg);
    const stop = graph.sample(ap.seg, ap.dir === 1 ? ap.at : ap.seg.length - ap.at).pos;
    const stopToCentre = Math.hypot(stop.x - centre.x, stop.z - centre.z);
    const isDirectionSite = isGuideJunction(arms) && !hasJunctionBoard(centre, ap.travel);
    if (isDirectionSite) {
      const rule = ROW_PLACEMENTS["105"];
      for (const back of rule.tries) {
        if (back > rule.maxBeforeM) continue;
        const spot = spotFor(graph, ap, back, signalled, junctionNodes, avoid);
        if (!spot || !isSpaced(spot.pos, spot.travel)) continue;
        const isBlocked =
          mount === "overhead" && isUnderSignalArm(spot.pos, spot.travel, OVERHEAD_REACH, signalArms);
        if (isBlocked) continue;
        const before = back + stopToCentre;
        const rows = directionRows(arms, approachCls, centre, before, input);
        if (rows.length === 0) break;
        plans.push({
          board: { kind: directionKind(rows.length), rows, letter },
          shape: "multi",
          pos: spot.pos,
          travel: spot.travel,
          mount,
          before,
          centre,
          seg: spot.seg,
        });
        avoid.push(spot.pos);
        break;
      }
    }
    const isMajor = approachCls <= 1;
    if (!isMajor) continue;
    const approachKey = routes.get(ap.seg.id)?.key ?? null;
    const ahead = arms.find(
      (a) => Math.abs(a.angle) < 30 && (approachKey === null || routes.get(a.seg.id)?.key === approachKey),
    );
    if (!ahead) continue;
    const rule = ROW_PLACEMENTS["106-A"];
    const own = new Set(ap.nodes);
    for (const after of rule.tries) {
      const at = alongArm(graph, ahead, after);
      if (!at) continue;
      const isPastOtherSignal = at.passed.some((n) => signalled.has(n) && !own.has(n));
      if (isPastOtherSignal || at.seg.line.bridge || at.seg.line.kind === "highway") continue;
      const travel = at.dir;
      const kerb = at.pos.clone().add(leftOf(travel, at.seg.line.width / 2 + KERB_GAP));
      if (graph.carriagewaysAt(kerb, 0.3).length > 0) continue;
      const isNearJunction = junctionNodes.some((n) => Math.hypot(n.x - at.pos.x, n.z - at.pos.z) < 12);
      const isCrowded = avoid.some((p) => Math.hypot(p.x - kerb.x, p.z - kerb.z) < 5);
      if (isNearJunction || isCrowded || !isSpaced(kerb, travel)) continue;
      const isBlocked =
        mountFor(at.seg) === "overhead" && isUnderSignalArm(kerb, travel, OVERHEAD_REACH, signalArms);
      if (isBlocked) continue;
      const isTooClose = plans.some(
        (p) =>
          p.board.kind === "106-A" &&
          p.travel.dot(travel) > 0.7 &&
          Math.hypot(p.pos.x - kerb.x, p.pos.z - kerb.z) < rule.spacingM,
      );
      if (isTooClose) break;
      const refs = ahead.route
        ? ahead.route.refs.map((r) => `${ahead.route?.cls === 0 ? "N" : "P"}${r}`)
        : [];
      const rows = confirmRows(ahead.trace, kerb, after, refs, input);
      if (rows.length < 2) break;
      plans.push({
        board: { kind: "106-A", rows, letter },
        shape: "straight",
        pos: kerb,
        travel: travel.clone(),
        mount: mountFor(at.seg),
        before: -after,
        centre,
        seg: at.seg,
      });
      avoid.push(kerb);
      break;
    }
  }
  return plans;
}

/** All 105・106 boards at once (tests). */
export function planRowSigns(input: RowsInput): RowsPlan[] {
  const steps = planRowSteps(input);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export type { GuideApproach };

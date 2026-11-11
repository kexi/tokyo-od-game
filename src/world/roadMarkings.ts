import { CENTRE_LINE_DIMENSIONS, MARKING_DIMENSIONS, MARKING_SYMBOL_DIMENSIONS } from "../law/roadStandards";
import { CROSSWALK_DEPTH, DIAMOND_LENGTH, DIAMOND_LINE } from "./streetAssumptions";
import { carriagewayWidth, isLaneChangeBanned, laneLeftEdge, sectionOf } from "./laneChange";
import type { AppliedRegulations } from "./regulations";
import type { RoadGraph, Segment } from "./roads";

/**
 * Which lines are painted on a street, where, and how: a pure plan (MarkingPlan) from the segment,
 * the graph's junctions and the applied regulations. roadSurface.ts only drapes what it says on
 * the terrain; the expressway deck (P3) will take the same plan. The lane lines come from the same
 * definitions the violation check reads (laneChange.ts: the lane widths, isLaneChangeBanned), so
 * a yellow line is painted exactly where 進路変更禁止 is booked (tests/roadMarkings.test.ts).
 *
 * Offsets are metres left of the centreline, `from` / `to` metres along the segment. Lines sit on
 * the section (laneChange.ts): the 車道外側線 at the lanes' edge, a 路肩 (構造令 第8条) inside the
 * carriageway's edge, and each 車線境界線 a lane width further in from it (laneLeftEdge − k·laneWidth).
 */

/**
 * Sizes as painted, each inside the range of 標識令 別表第四・第六 (src/law/roadStandards.ts;
 * tests/roadMarkings.test.ts checks): 中央線, 車線境界線, 車道外側線, the yellow lines, 停止線,
 * 横断歩道's bars and gaps, ◇'s width and line. Not in the figures, so not checked against them:
 * the crosswalk's depth along the road and its clearance from the edges, and ◇'s length
 * (knowledge/road-standards.md).
 */
export const MARKING = {
  /** 区画線 width: 中央線, 車線境界線 (102: 0.10–0.15 m), 車道外側線 (103: 0.15–0.20 m). */
  lineWidth: 0.15,
  /** Dashed 中央線 / 車線境界線: painted and gap, urban standard 5 m + 5 m (MLIT). */
  dash: 5,
  gap: 5,
  /** 停止線 depth along the road. */
  stopDepth: 0.45,
  /** 横断歩道 (201): bars 0.45 m wide every 0.9 m (gaps 0.45 m), 0.3 m clear of each edge. */
  crosswalkBar: 0.45,
  crosswalkPitch: 0.9,
  crosswalkDepth: CROSSWALK_DEPTH.value,
  crosswalkEdge: 0.6,
  /** 車道中央線 only on carriageways of 5.5 m or more (命令 別表第三). */
  centreMinWidth: 5.5,
  /** Solid white centre line from this half width (片側 6 m 以上). */
  solidCentreHalf: 6,
  /** ◇ (210): 1.5 m across (別表第六); one outline, its line and length assumed (streetAssumptions). */
  diamondLength: DIAMOND_LENGTH.value,
  diamondWidth: MARKING_SYMBOL_DIMENSIONS.value.diamondWidth,
  diamondLine: DIAMOND_LINE.value,
} as const;

export type MarkingKind = "edge" | "centre" | "lane";
/** White, or yellow for the 規制標示 (はみ出し禁止 102, 進路変更禁止 102 の 2, 命令 別表第六). */
export type MarkingColour = "white" | "yellow";

/** A line along the street. Dashed lines start a dash at `from`. */
export type MarkingLine = {
  kind: MarkingKind;
  offset: number;
  from: number;
  to: number;
  colour: MarkingColour;
  width: number;
  dash: { length: number; gap: number } | null;
};

/** A white strip across part of the street: a 停止線 or one bar of a 横断歩道. */
export type MarkingBar = {
  kind: "stop" | "crosswalk";
  from: number;
  to: number;
  offset: number;
  width: number;
};

export type MarkingPlan = { lines: MarkingLine[]; bars: MarkingBar[] };

const EMPTY: MarkingPlan = { lines: [], bars: [] };

/** Whether a node is a junction (3 or more segments meet). */
const isJunction = (graph: RoadGraph, node: number) => (graph.nodes.get(node)?.length ?? 0) >= 3;

/**
 * Distance from a junction node to the kerb line of the widest crossing road. The GSI 幅員, not
 * the carriageway: the junction box is the asphalt the signals' stop lines measure too
 * (trafficControl.ts), and where the 幅員 includes the pavement the crosswalk belongs past it.
 */
export function junctionClearance(graph: RoadGraph, node: number): number {
  const widths = (graph.nodes.get(node) ?? []).map((id) => graph.segments[id].line.width);
  return Math.max(...widths) / 2 + 1.5;
}

/** The bars of a 横断歩道 centred `s` along the segment, across the whole carriageway. */
export function planCrosswalk(seg: Segment, s: number): MarkingBar[] {
  const w = carriagewayWidth(seg);
  const count = Math.max(1, Math.floor((w - MARKING.crosswalkEdge) / MARKING.crosswalkPitch));
  const first = -((count - 1) * MARKING.crosswalkPitch) / 2;
  const half = MARKING.crosswalkDepth / 2;
  const bars: MarkingBar[] = [];
  for (let i = 0; i < count; i++) {
    const offset = first + i * MARKING.crosswalkPitch;
    bars.push({ kind: "crosswalk", from: s - half, to: s + half, offset, width: MARKING.crosswalkBar });
  }
  return bars;
}

/**
 * 停止線 at `s` along the segment for traffic travelling `travel` (+1 along the coordinates): from
 * the centre line (or the 中央帯) to the left 車道外側線 on a two-way street (別表第六 203's figure),
 * edge line to edge line on a one-way one.
 */
export function planStopLine(seg: Segment, s: number, travel: 1 | -1): MarkingBar {
  const edge = laneLeftEdge(seg);
  const isTwoWay = seg.oneway === 0;
  const inner = isTwoWay ? sectionOf(seg).median / 2 : -edge;
  const offset = travel * ((edge + inner) / 2);
  const width = edge - inner;
  const half = MARKING.stopDepth / 2;
  return { kind: "stop", from: s - half, to: s + half, offset, width };
}

/**
 * Lines along one street, and (where the area has no surveyed markings) a synthesised 横断歩道 and
 * 停止線 at each junction end: 車道外側線 both sides; 中央線 on two-way carriageways ≥ 5.5 m (yellow
 * where はみ出し禁止, else white, solid for 2+ lanes or ≥ 6 m a direction); 車線境界線 between the
 * lanes of each direction (yellow where 進路変更禁止). Markings stop short of each junction.
 */
export function planMarkings(
  graph: RoadGraph,
  seg: Segment,
  applied: AppliedRegulations | null,
): MarkingPlan {
  const w = carriagewayWidth(seg);
  const startCut = isJunction(graph, seg.from)
    ? Math.min(seg.length / 2, junctionClearance(graph, seg.from) + 6)
    : 0;
  const endCut = isJunction(graph, seg.to)
    ? Math.min(seg.length / 2, junctionClearance(graph, seg.to) + 6)
    : 0;
  const isMarked = w >= MARKING.centreMinWidth && seg.length - startCut - endCut > 4;
  if (!isMarked) return EMPTY;
  const from = startCut;
  const to = seg.length - endCut;
  const dashed = { length: MARKING.dash, gap: MARKING.gap };
  const lines: MarkingLine[] = [];
  const add = (kind: MarkingKind, offset: number, colour: MarkingColour, isDashed: boolean) =>
    lines.push({ kind, offset, from, to, colour, width: MARKING.lineWidth, dash: isDashed ? dashed : null });

  // The lanes' edge: the carriageway's edge less the 路肩 (構造令 第8条), where laneOfOffset counts from.
  const edge = laneLeftEdge(seg);
  for (const side of [-1, 1]) add("edge", side * edge, "white", false);
  const isTwoWay = seg.oneway === 0;
  const lanes = seg.lanes;
  const median = sectionOf(seg).median;
  const hasMedian = isTwoWay && median > 0;
  // A divided road: the 中央帯 parts the directions, each bounded by an edge line along it.
  if (hasMedian) for (const side of [-1, 1]) add("edge", side * (median / 2), "white", false);
  const hasCentreLine = isTwoWay && !hasMedian;
  if (hasCentreLine) {
    const isSolid = lanes >= 2 || w / 2 >= MARKING.solidCentreHalf;
    add("centre", 0, seg.noOvertake ? "yellow" : "white", !seg.noOvertake && !isSolid);
  }
  if (lanes >= 2) {
    const laneWidth = sectionOf(seg).laneWidth;
    const isBanned = isLaneChangeBanned(seg);
    // From each direction's left edge line inwards; a one-way street's lanes span edge to edge.
    for (let k = 1; k < lanes; k++) {
      const inner = edge - k * laneWidth;
      const offsets = isTwoWay ? [inner, -inner] : [inner];
      for (const o of offsets) add("lane", o, isBanned ? "yellow" : "white", !isBanned);
    }
  }

  const isSurveyed = applied?.hasMarkings ?? false;
  if (isSurveyed) return { lines, bars: [] };
  const bars: MarkingBar[] = [];
  // 横断歩道 2 m beyond the kerb line, and the 停止線 2 m before it on the approaching half.
  const ends: Array<[boolean, number, 1 | -1]> = [
    [isJunction(graph, seg.from), junctionClearance(graph, seg.from) + 2, 1],
    [isJunction(graph, seg.to), seg.length - junctionClearance(graph, seg.to) - 2, -1],
  ];
  for (const [isEnd, at, side] of ends) {
    const isRoom = isEnd && at >= 4 && at <= seg.length - 4;
    if (!isRoom) continue;
    bars.push(...planCrosswalk(seg, at));
    // The traffic heading into the junction moves along −side.
    bars.push(planStopLine(seg, at + side * (MARKING.crosswalkDepth / 2 + 2), side === 1 ? -1 : 1));
  }
  return { lines, bars };
}

/**
 * The ranges of 標識令 別表第四・第六 the plan's marks must sit inside (for the tests): lines by kind
 * and colour, and the bars and symbols by what they are.
 */
export const MARKING_LIMITS = {
  lane: MARKING_DIMENSIONS.value.laneLine,
  laneYellow: CENTRE_LINE_DIMENSIONS.value.noLaneChange,
  edge: MARKING_DIMENSIONS.value.edgeLine,
  centreDashed: CENTRE_LINE_DIMENSIONS.value.dashed,
  centreSolid: CENTRE_LINE_DIMENSIONS.value.solid,
  centreYellow: CENTRE_LINE_DIMENSIONS.value.noOvertake,
  stopLine: MARKING_SYMBOL_DIMENSIONS.value.stopLine,
  crosswalkBar: MARKING_SYMBOL_DIMENSIONS.value.crosswalkBar,
  crosswalkGap: MARKING_SYMBOL_DIMENSIONS.value.crosswalkGap,
} as const;

/**
 * How the streets' sections rest, for the log after each rebuild (road_sections): segments by
 * basis, and those whose OSM lanes differ by direction (drawn and judged with the larger count
 * both ways until P6 passes the direction through).
 */
export function sectionSummary(graph: RoadGraph): {
  segments: number;
  byBasis: Record<string, number>;
  asymmetric: number;
} {
  const byBasis: Record<string, number> = {};
  let asymmetric = 0;
  for (const seg of graph.segments) {
    const section = seg.section;
    if (!section) continue;
    byBasis[section.basis] = (byBasis[section.basis] ?? 0) + 1;
    const isAsymmetric = section.forward > 0 && section.backward > 0 && section.forward !== section.backward;
    if (isAsymmetric) asymmetric++;
  }
  return { segments: graph.segments.length, byBasis, asymmetric };
}

/**
 * Streets whose lanes reach into PLATEAU's pavement (pavement_over_lanes): at the middle of each
 * segment, a point 0.3 m inside each edge line lies in a pavement polygon. Counts where the GSI
 * 幅員 held less than the carriageway the evidence asked for, or the centreline lies off the road's
 * middle, so the pavement assumption (streetAssumptions PAVED_FROM) can be checked against PLATEAU.
 */
export function lanesUnderPavement(
  graph: RoadGraph,
  isPavement: (x: number, z: number) => boolean,
): { checked: number; under: number } {
  let checked = 0;
  let under = 0;
  for (const seg of graph.segments) {
    if (!seg.section || seg.length < 20) continue;
    checked++;
    const { pos, dir } = graph.sample(seg, seg.length / 2);
    const inside = laneLeftEdge(seg) - 0.3;
    const isUnder = [1, -1].some((side) =>
      isPavement(pos.x - dir.z * side * inside, pos.z + dir.x * side * inside),
    );
    if (isUnder) under++;
  }
  return { checked, under };
}

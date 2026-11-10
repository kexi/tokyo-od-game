import { MARKING_DIMENSIONS } from "../law/roadStandards";
import { carriagewayWidth, isLaneChangeBanned, KERB_INSET, laneLeftEdge, sectionOf } from "./laneChange";
import type { AppliedRegulations } from "./regulations";
import type { RoadGraph, Segment } from "./roads";

/**
 * Which lines are painted on a street, where, and how: a pure plan (MarkingPlan) from the segment,
 * the graph's junctions and the applied regulations. roadSurface.ts only drapes what it says on
 * the terrain; the expressway deck (P3) will take the same plan. The lane lines come from the same
 * definitions the violation check reads (laneChange.ts: the lane widths, isLaneChangeBanned), so
 * a yellow line is painted exactly where 進路変更禁止 is booked (tests/roadMarkings.test.ts).
 *
 * Offsets are metres left of the centreline, `from` / `to` metres along the segment.
 */

/**
 * Sizes as painted. Lane line (102) and edge line (103) are inside 標識令 別表第四's ranges
 * (src/law/roadStandards.ts; tests/roadMarkings.test.ts checks). The others are not in that table
 * as read so far (knowledge/road-model.md lists them): they stay as they were.
 */
export const MARKING = {
  /** 区画線 width: 中央線, 車線境界線 (102: 0.10–0.15 m), 車道外側線 (103: 0.15–0.20 m). */
  lineWidth: 0.15,
  /** Dashed 中央線 / 車線境界線: painted and gap, urban standard 5 m + 5 m (MLIT). */
  dash: 5,
  gap: 5,
  /** 停止線 depth along the road. */
  stopDepth: 0.45,
  /** 横断歩道 (201): bars 0.45 m wide every 0.9 m, 4 m deep, 0.3 m clear of each edge. */
  crosswalkBar: 0.45,
  crosswalkPitch: 0.9,
  crosswalkDepth: 4,
  crosswalkEdge: 0.6,
  /** 車道中央線 only on carriageways of 5.5 m or more (命令 別表第三). */
  centreMinWidth: 5.5,
  /** Solid white centre line from this half width (片側 6 m 以上). */
  solidCentreHalf: 6,
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

/** Distance from a junction node to the kerb line of the widest crossing road. */
export function junctionClearance(graph: RoadGraph, node: number): number {
  const widths = (graph.nodes.get(node) ?? []).map((id) => carriagewayWidth(graph.segments[id].line));
  return Math.max(...widths) / 2 + 1.5;
}

/** The bars of a 横断歩道 centred `s` along the segment, across the whole carriageway. */
export function planCrosswalk(seg: Segment, s: number): MarkingBar[] {
  const w = carriagewayWidth(seg.line);
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
 * 停止線 at `s` along the segment for traffic travelling `travel` (+1 along the coordinates):
 * keep-left, so the left half of that direction on a two-way street, the whole width on a one-way.
 */
export function planStopLine(seg: Segment, s: number, travel: 1 | -1): MarkingBar {
  const w = carriagewayWidth(seg.line);
  const isTwoWay = seg.oneway === 0;
  const offset = isTwoWay ? travel * (w / 4) : 0;
  const width = isTwoWay ? w / 2 - KERB_INSET.edgeLine : w - 2 * KERB_INSET.edgeLine;
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
  const w = carriagewayWidth(seg.line);
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

  const isTwoWay = seg.oneway === 0;
  const lanes = seg.lanes;
  const section = sectionOf(seg);
  // The edges of the lanes, inside the shoulders (the right one mirrored across the centre on a
  // two-way street). A line with no section of its own (every GSI street) keeps the old inset
  // from the 幅員 edge: its 幅員 may include the pavement (KERB_INSET, P8).
  const hasSection = seg.line.section !== undefined;
  const leftEdge = hasSection ? laneLeftEdge(seg) : w / 2 - KERB_INSET.edgeLine;
  const rightEdge = !hasSection
    ? -(w / 2 - KERB_INSET.edgeLine)
    : isTwoWay
      ? -laneLeftEdge(seg)
      : -(w / 2 - section.shoulderR);
  add("edge", rightEdge, "white", false);
  add("edge", leftEdge, "white", false);
  if (isTwoWay) {
    const isSolid = lanes >= 2 || w / 2 >= MARKING.solidCentreHalf;
    const colour = seg.noOvertake ? "yellow" : "white";
    const isDashed = !seg.noOvertake && !isSolid;
    // A median splits the centre line in two, one at each edge of it.
    const hasMedian = section.median > 0;
    if (hasMedian) for (const side of [1, -1]) add("centre", (side * section.median) / 2, colour, isDashed);
    else add("centre", 0, colour, isDashed);
  }
  if (lanes >= 2) {
    const laneWidth = section.laneWidth;
    const isBanned = isLaneChangeBanned(seg);
    // laneLeftEdge − j·laneWidth for j = lanes − k: the lines between the lanes counted from the
    // left edge (laneChange.ts), listed from the centre outwards as before (the drawn order).
    const fromLeft = (k: number) => laneLeftEdge(seg) - (lanes - k) * laneWidth;
    for (let k = 1; k < lanes; k++) {
      const offsets = isTwoWay ? [fromLeft(k), -fromLeft(k)] : [fromLeft(k)];
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

/** The dimensions of 標識令 別表第四 the plan's lines must sit inside, by kind (for the tests). */
export const MARKING_LIMITS = {
  lane: MARKING_DIMENSIONS.value.laneLine,
  edge: MARKING_DIMENSIONS.value.edgeLine,
} as const;

import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import {
  CENTRE_LINE_DIMENSIONS,
  MARKING_DIMENSIONS,
  MARKING_SYMBOL_DIMENSIONS,
} from "../src/law/roadStandards";
import {
  carriagewayWidth,
  isLaneChangeBanned,
  laneBand,
  laneLeftEdge,
  laneOfOffset,
} from "../src/world/laneChange";
import type { AppliedRegulations } from "../src/world/regulations";
import {
  MARKING,
  planCrosswalk,
  planMarkings,
  planStopLine,
  type MarkingPlan,
} from "../src/world/roadMarkings";
import { CROSSWALK_DEPTH, DIAMOND_LENGTH, DIAMOND_LINE } from "../src/world/streetAssumptions";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";

// Local frame: x east, z south. These helpers take x east, y north metres.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const line = (pts: Array<[number, number]>, width: number, oneway: RoadLine["oneway"] = 0): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  oneway,
  kind: "local",
});

/** One 300 m street on its own (no junctions), with the lanes and rules a test gives it. */
function street(
  width: number,
  opts: Partial<Pick<Segment, "lanes" | "noLaneChange" | "noOvertake">> = {},
  oneway: RoadLine["oneway"] = 0,
) {
  const graph = new RoadGraph(
    [
      line(
        [
          [0, 0],
          [0, 300],
        ],
        width,
        oneway,
      ),
    ],
    frame,
  );
  const seg = graph.segments[0];
  Object.assign(seg, opts);
  return { graph, seg };
}

const surveyed = { hasMarkings: true } as AppliedRegulations;
const inRange = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;
const laneLines = (plan: MarkingPlan) => plan.lines.filter((l) => l.kind === "lane");
/** The 中央線 of a lone two-way street `width` wide. */
const centre = (width: number, opts: Partial<Pick<Segment, "lanes" | "noOvertake">>) => {
  const { graph, seg } = street(width, opts);
  return planMarkings(graph, seg, surveyed).lines.find((l) => l.kind === "centre");
};

describe("MarkingPlan (src/world/roadMarkings.ts)", () => {
  it("paints 車線境界線 (102) and 車道外側線 (103) inside 標識令 別表第四's dimensions", () => {
    const { laneLine, edgeLine } = MARKING_DIMENSIONS.value;
    const { graph, seg } = street(20, { lanes: 3 });
    const plan = planMarkings(graph, seg, surveyed);
    const lane = laneLines(plan);
    expect(lane.length).toBeGreaterThan(0);
    for (const l of lane) {
      expect(l.width).toBeGreaterThanOrEqual(laneLine.width[0]);
      expect(l.width).toBeLessThanOrEqual(laneLine.width[1]);
      expect(l.dash).not.toBeNull();
      const { length, gap } = l.dash!;
      expect(length).toBeGreaterThanOrEqual(laneLine.dash[0]);
      expect(length).toBeLessThanOrEqual(laneLine.dash[1]);
      expect(gap / length).toBeGreaterThanOrEqual(laneLine.gapRatio[0]);
      expect(gap / length).toBeLessThanOrEqual(laneLine.gapRatio[1]);
    }
    const edges = plan.lines.filter((l) => l.kind === "edge");
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.width).toBeGreaterThanOrEqual(edgeLine.width[0]);
      expect(e.width).toBeLessThanOrEqual(edgeLine.width[1]);
      expect(e.dash).toBeNull();
    }
  });

  it("paints the lane lines yellow and solid exactly where the violation check books 進路変更禁止", () => {
    for (const [lanes, noLaneChange] of [
      [2, true],
      [3, true],
      [2, false],
      [1, true],
    ] as const) {
      const { graph, seg } = street(20, { lanes, noLaneChange });
      const lane = laneLines(planMarkings(graph, seg, surveyed));
      const isBanned = isLaneChangeBanned(seg);
      expect(lane.length > 0).toBe(lanes >= 2);
      for (const l of lane) {
        expect(l.colour === "yellow").toBe(isBanned);
        expect(l.dash === null).toBe(isBanned);
      }
    }
  });

  it("puts each lane line on the boundary laneOfOffset counts lanes by, and keeps every lane band between lines", () => {
    for (const oneway of [0, 1] as const) {
      for (const lanes of [2, 3, 4]) {
        const { graph, seg } = street(24, { lanes }, oneway);
        // Lines of the coordinate direction's lanes: left of the centreline on a two-way street.
        const offsets = laneLines(planMarkings(graph, seg, surveyed))
          .map((l) => l.offset)
          .filter((o) => oneway !== 0 || o > 0)
          .toSorted((a, b) => b - a);
        expect(offsets).toHaveLength(lanes - 1);
        offsets.forEach((o, k) => {
          expect(laneOfOffset(seg, o + 0.01)).toBe(k);
          expect(laneOfOffset(seg, o - 0.01)).toBe(k + 1);
        });
        for (let k = 0; k < lanes; k++) {
          const band = laneBand(seg, k);
          const left = k === 0 ? Infinity : offsets[k - 1];
          const right = k === lanes - 1 ? -Infinity : offsets[k];
          expect(band.max).toBeLessThan(left);
          expect(band.min).toBeGreaterThan(right);
        }
      }
    }
  });

  it("draws the 中央線 yellow under はみ出し禁止, solid for 2+ lanes, else dashed white", () => {
    expect(centre(9, {})).toMatchObject({
      colour: "white",
      dash: { length: MARKING.dash, gap: MARKING.gap },
    });
    // A 12 m 幅員 with one lane a direction is a 7.5 m carriageway: under 6 m a direction, dashed.
    expect(centre(12, {})).toMatchObject({
      colour: "white",
      dash: { length: MARKING.dash, gap: MARKING.gap },
    });
    expect(centre(9, { lanes: 2 })).toMatchObject({ colour: "white", dash: null });
    expect(centre(9, { noOvertake: true })).toMatchObject({ colour: "yellow", dash: null });
  });

  it("paints the 中央線 inside 標識令 別表第四・第六's dimensions in each of its forms", () => {
    const { dashed, solid, noOvertake } = CENTRE_LINE_DIMENSIONS.value;
    const plain = centre(9, {});
    expect(inRange(plain!.width, dashed.width)).toBe(true);
    expect(inRange(plain!.dash!.length, dashed.dash)).toBe(true);
    expect(inRange(plain!.dash!.gap / plain!.dash!.length, dashed.gapRatio)).toBe(true);
    expect(inRange(centre(9, { lanes: 2 })!.width, solid.width)).toBe(true);
    expect(inRange(centre(9, { noOvertake: true })!.width, noOvertake.width)).toBe(true);
    const banned = laneLines(
      planMarkings(
        street(20, { lanes: 2, noLaneChange: true }).graph,
        street(20, { lanes: 2, noLaneChange: true }).seg,
        surveyed,
      ),
    );
    for (const l of banned)
      expect(inRange(l.width, CENTRE_LINE_DIMENSIONS.value.noLaneChange.width)).toBe(true);
  });

  it("puts the 車道外側線 a 0.5 m 路肩 inside the carriageway, on the edge laneOfOffset counts lanes from", () => {
    for (const [width, lanes, oneway] of [
      [9, 1, 0],
      [30, 2, 0],
      [13, 2, 0],
      [9, 2, 1],
    ] as const) {
      const { graph, seg } = street(width, { lanes }, oneway);
      const edges = planMarkings(graph, seg, surveyed).lines.filter((l) => l.kind === "edge");
      const edge = laneLeftEdge(seg);
      expect(edge).toBeCloseTo(carriagewayWidth(seg) / 2 - 0.5, 9);
      expect(edges.map((e) => e.offset).toSorted((a, b) => a - b)).toEqual([-edge, edge]);
      // Just inside the line is the first lane; just outside it is no lane (the shoulder).
      expect(laneOfOffset(seg, edge - 0.01)).toBe(0);
      expect(laneOfOffset(seg, edge + 0.01)).toBe(-1);
    }
  });

  it("keeps the lanes 3.25 m wide where the 幅員 includes the pavement, instead of spreading them to the kerb", () => {
    const { graph, seg } = street(30, { lanes: 2 });
    const offsets = laneLines(planMarkings(graph, seg, surveyed))
      .map((l) => l.offset)
      .filter((o) => o > 0);
    expect(offsets).toEqual([3.25]);
    expect(laneLeftEdge(seg)).toBe(6.5);
  });

  it("paints 停止線 (203) from the centre line to the edge line, and 横断歩道 (201) inside 別表第六's dimensions", () => {
    const { stopLine, crosswalkBar, crosswalkGap } = MARKING_SYMBOL_DIMENSIONS.value;
    const { seg } = street(16, { lanes: 2 });
    const stop = planStopLine(seg, 100, 1);
    expect(stop.to - stop.from).toBeGreaterThanOrEqual(stopLine[0]);
    expect(stop.to - stop.from).toBeLessThanOrEqual(stopLine[1]);
    expect(stop.offset - stop.width / 2).toBeCloseTo(0, 9);
    expect(stop.offset + stop.width / 2).toBeCloseTo(laneLeftEdge(seg), 9);
    const bars = planCrosswalk(seg, 100).toSorted((a, b) => a.offset - b.offset);
    for (const b of bars) {
      expect(b.width).toBeGreaterThanOrEqual(crosswalkBar[0]);
      expect(b.width).toBeLessThanOrEqual(crosswalkBar[1]);
    }
    const gap = bars[1].offset - bars[0].offset - bars[0].width;
    expect(gap).toBeGreaterThanOrEqual(crosswalkGap[0] - 1e-9);
    expect(gap).toBeLessThanOrEqual(crosswalkGap[1]);
    // Across the carriageway, not over the pavement the 幅員 may include.
    const span = bars.at(-1)!.offset - bars[0].offset + bars[0].width;
    expect(span).toBeLessThanOrEqual(carriagewayWidth(seg));
  });

  it("draws ◇ (210) 1.5 m across as 別表第六 says, its line and length from the unverified assumptions", () => {
    expect(MARKING.diamondWidth).toBe(MARKING_SYMBOL_DIMENSIONS.value.diamondWidth);
    expect(MARKING.diamondLine).toBe(DIAMOND_LINE.value);
    expect(MARKING.diamondLength).toBe(DIAMOND_LENGTH.value);
    expect(MARKING.crosswalkDepth).toBe(CROSSWALK_DEPTH.value);
  });

  it("paints nothing on carriageways under 5.5 m, and no 中央線 on a one-way street", () => {
    const narrow = street(5);
    expect(planMarkings(narrow.graph, narrow.seg, surveyed)).toEqual({ lines: [], bars: [] });
    const oneway = street(9, {}, 1);
    expect(planMarkings(oneway.graph, oneway.seg, surveyed).lines.some((l) => l.kind === "centre")).toBe(
      false,
    );
  });

  it("synthesises a 横断歩道 and 停止線 at each junction end only where nothing is surveyed", () => {
    const graph = new RoadGraph(
      [
        line(
          [
            [0, -200],
            [0, 0],
            [0, 200],
          ],
          12,
        ),
        line(
          [
            [-200, 0],
            [0, 0],
            [200, 0],
          ],
          12,
        ),
      ],
      frame,
    );
    const seg = graph.segments[0];
    const synthesised = planMarkings(graph, seg, null).bars;
    expect(synthesised.filter((b) => b.kind === "stop")).toHaveLength(1);
    expect(synthesised.filter((b) => b.kind === "crosswalk").length).toBeGreaterThan(5);
    for (const b of synthesised.filter((x) => x.kind === "crosswalk")) {
      expect(b.width).toBe(MARKING.crosswalkBar);
      expect(b.to - b.from).toBe(MARKING.crosswalkDepth);
    }
    expect(planMarkings(graph, seg, surveyed).bars).toEqual([]);
  });
});

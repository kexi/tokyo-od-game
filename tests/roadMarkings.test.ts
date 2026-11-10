import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { MARKING_DIMENSIONS } from "../src/law/roadStandards";
import { isLaneChangeBanned, laneBand, laneOfOffset } from "../src/world/laneChange";
import type { AppliedRegulations } from "../src/world/regulations";
import { MARKING, planMarkings, type MarkingPlan } from "../src/world/roadMarkings";
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

  it("draws the 中央線 yellow under はみ出し禁止, solid for 2+ lanes or 6 m a direction, else dashed white", () => {
    expect(centre(9, {})).toMatchObject({
      colour: "white",
      dash: { length: MARKING.dash, gap: MARKING.gap },
    });
    expect(centre(12, {})).toMatchObject({ colour: "white", dash: null });
    expect(centre(9, { lanes: 2 })).toMatchObject({ colour: "white", dash: null });
    expect(centre(9, { noOvertake: true })).toMatchObject({ colour: "yellow", dash: null });
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

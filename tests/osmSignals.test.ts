import { describe, expect, it } from "vitest";
import { classifySignalNodes, isKept } from "../scripts/osm-signals";
import type { OsmNode, OsmWay } from "../scripts/osm-pbf";

const LAT = 35.68;
/** Degrees of longitude per metre east at this latitude. */
const E = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
/** A node `east` metres east of the junction at 139.76, `north` metres north. */
const at = (east: number, north = 0): [number, number] => [139.76 + east * E, LAT + north / 111_320];

/**
 * A T junction (node 1) of a west arm, a north arm and an east road 1–10–11–12–13 (20 m apart),
 * and a footway over the east road that does not share its nodes.
 */
const COORDS = new Map<number, [number, number]>([
  [1, at(0)],
  [2, at(-100)],
  [3, at(0, 100)],
  [10, at(20)],
  [11, at(40)],
  [12, at(60)],
  [13, at(80)],
  [50, at(60, 10)],
]);
const WAYS: OsmWay[] = [
  { id: 1, refs: [2, 1], tags: { highway: "secondary" } },
  { id: 2, refs: [3, 1], tags: { highway: "residential" } },
  { id: 3, refs: [1, 10, 11, 12, 13], tags: { highway: "secondary" } },
  { id: 4, refs: [50, 12], tags: { highway: "footway" } },
  // A driveway meeting the east road at 12: not a junction for the 単路 test.
  { id: 5, refs: [60, 12], tags: { highway: "service" } },
];
const node = (id: number, tags: Record<string, string>): OsmNode => {
  const [lon, lat] = COORDS.get(id) ?? [0, 0];
  return { id, lon, lat, tags };
};
const NODES: OsmNode[] = [
  node(1, { highway: "traffic_signals" }),
  node(10, { highway: "crossing", crossing: "traffic_signals" }),
  node(12, {
    highway: "crossing",
    crossing: "traffic_signals",
    button_operated: "yes",
    "traffic_signals:sound": "no",
    "traffic_signals:direction": "forward",
  }),
  node(50, { highway: "crossing", "crossing:signals": "yes", "traffic_signals:sound": "yes" }),
];

const classify = () =>
  classifySignalNodes(
    NODES,
    WAYS,
    (ids) => new Map([...ids].flatMap((id) => (COORDS.has(id) ? [[id, COORDS.get(id)!] as const] : []))),
    () => true,
  );

describe("scripts/osm-signals.ts on a fixture: the facts each signal node gets", () => {
  it("measures each node's distance to the nearest car-road junction (service roads are not junctions)", () => {
    const byId = new Map(classify().map((s) => [s.node.id, s]));
    expect(byId.get(1)?.junctionM).toBe(0);
    expect(byId.get(10)?.junctionM).toBeCloseTo(20, 0);
    expect(byId.get(12)?.junctionM).toBeCloseTo(60, 0);
    expect(byId.get(50)?.onCarRoad).toBe(false);
  });

  it("calls a crossing signal beyond 25 m 単路, and reads button, sound and the direction as a bearing", () => {
    const byId = new Map(classify().map((s) => [s.node.id, s.facts]));
    expect(byId.get(10)).toMatchObject({ isCrossing: true, awayFromJunction: false, isHighwaySignal: false });
    expect(byId.get(12)).toMatchObject({
      isCrossing: true,
      awayFromJunction: true,
      button: true,
      sound: false,
      bearing: 90, // forward along the way 1 → 13, which runs east
    });
    expect(byId.get(1)).toMatchObject({ isHighwaySignal: true, isCrossing: false, bearing: null });
  });

  it("keeps every junction signal, the 単路 crossings, and crossings with a sound tag that are on a car road", () => {
    const kept = classify()
      .filter(isKept)
      .map((s) => s.node.id)
      .toSorted((a, b) => a - b);
    // 10: a crossing next to the junction with nothing more to say; 50: not on the road.
    expect(kept).toEqual([1, 12]);
  });
});

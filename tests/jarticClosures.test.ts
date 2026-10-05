import { afterEach, describe, expect, it, vi } from "vitest";
import { bindsCar, closureUse, ruleUse } from "../scripts/jartic";
import { LocalFrame } from "../src/geo/frame";
import { recentLogs } from "../src/log";
import { CLOSURE, MAX_CLOSURE_AREA_KM2, ringAreaKm2 } from "../src/world/closures";
import { applyRegulations, type RegulationData } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LAT = 1 / 110_950; // degrees per metre of latitude near Tokyo
const M_LON = 1 / 90_400; // degrees per metre of longitude near Tokyo
const empty = (): RegulationData => ({
  laneArrows: [],
  turnlanes: [],
  speed: [],
  speedZone: [],
  oneway: [],
  crosswalk: [],
  stopLine: [],
  stopSign: [],
  sections: [],
  turns: [],
  noOvertake: [],
  lanes: [],
  noLaneChange: [],
  signals: [],
  closures: [],
  junctions: [],
  footbridges: [],
});
/** A street along `lat` from 139.76 for `metres`, coordinates west → east. */
const street = (lat = 35.68, metres = 180): RoadLine => ({
  coords: [139.76, lat, 139.76 + metres * M_LON, lat],
  width: 9,
  oneway: 0,
  kind: "local",
});
/** A square ring of `side` metres centred on (lat, lon), closed like JARTIC's (first = last). */
const square = (lat: number, lon: number, side: number) => {
  const dx = (side / 2) * M_LON;
  const dy = (side / 2) * M_LAT;
  return [lon - dx, lat - dy, lon + dx, lat - dy, lon + dx, lat + dy, lon - dx, lat + dy, lon - dx, lat - dy];
};
/** One CSV row as the build reads it: header → value, blank when absent. */
const row = (fields: Record<string, string>) => (header: string) => fields[header] ?? "";
const ALL_DAY = [1, 0, 1440, 0, 0];

// The record behind 「太子堂の 2,732 区間が終日通行止め」 (警視庁 2026-08, ユニークキー
// 08202608001598200000000000009566), cut down to the columns that matter: an area (面) 通行禁止
// with nothing in 対象車両 A and C = 100100100 (特定中貨＋大貨＋大特 = 大型貨物自動車等). The real
// ring has 377 vertices round 環七 (35.5774–35.7790 N, 139.6535–139.8829 E, 317 km²).
const KANNANA_TRUCK_BAN = {
  共通規制種別コード: "4",
  点・線・面コード: "3",
  県別規制種別名称: "通行禁止",
  対象車両コード1_C: "100100100",
  ユニークキー: "08202608001598200000000000009566",
};
const KANNANA_RING = [
  139.73477, 35.57759, 139.8829, 35.6445, 139.8601, 35.779, 139.7472, 35.7745, 139.6535, 35.7032, 139.6601,
  35.6202, 139.73477, 35.57759,
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("対象車両 (who a JARTIC rule binds)", () => {
  it("binds the player's car only through category A codes that cover it, or no vehicle at all", () => {
    expect(bindsCar("")).toBe(true); // no vehicle named: everyone
    expect(bindsCar("1")).toBe(true); // 車両
    expect(bindsCar("10")).toBe(true); // 自動車
    expect(bindsCar("1000")).toBe(true); // 普通乗用自動車
    expect(bindsCar("100000000")).toBe(false); // 特定中型 only
    expect(bindsCar("1000000000000")).toBe(false); // タクシー only
    expect(bindsCar("", "", "100100100")).toBe(false); // 大型貨物自動車等
    expect(bindsCar("", "1000000")).toBe(false); // 路線バス
    expect(bindsCar("", "", "", "100")).toBe(false); // 普通自転車
    expect(bindsCar("2")).toBe(false); // digits other than 0/1 are undefined in the spec
  });

  it("does not read the 環七 大型貨物自動車等 area ban as 通行止め for the car", () => {
    expect(ruleUse(row(KANNANA_TRUCK_BAN), "4")).toEqual({ skip: "vehicles" });
  });

  it("keeps the conditions that bind the car and takes the sign from the first of them", () => {
    // 1: 大型貨物自動車等 all day; 2: 車両 7:30–9:00 (a school-run closure on a truck-banned street).
    const use = ruleUse(
      row({
        対象車両コード1_C: "100100100",
        規制時間2_開始: "730",
        規制時間2_終了: "900",
        対象車両コード2_A: "1",
      }),
      "4",
    );
    expect(use).toEqual({ time: { on: [[450, 540, 0]], off: [] }, target: "1" });
  });

  it("still reads a bus or bicycle lane by category A only (対象 is whom the lane is for)", () => {
    expect(ruleUse(row({ 対象車両コード1_B: "1000000" }), "111")).toEqual({
      time: { on: [[0, 1440, 0]], off: [] },
      target: "",
    });
  });

  it("frees the car at the weekend when one 除外 set packs 「土・日・休日」 with 「自転車」", () => {
    const use = ruleUse(
      row({
        規制時間1_開始: "730",
        規制時間1_終了: "830",
        対象車両コード1_A: "1",
        除外曜日コード1: "2",
        除外車両コード1_D: "100",
      }),
      "1",
    );
    expect(use).toEqual({ time: { on: [[450, 510, 0]], off: [[0, 1440, 2]] }, target: "1" });
  });
});

describe("通行禁止 records and the implausible-area guard", () => {
  it("measures a ring's area in km²", () => {
    expect(ringAreaKm2(square(35.68, 139.76, 1000))).toBeCloseTo(1, 1);
    expect(ringAreaKm2([0, 0, 1, 1])).toBe(0);
    // The leading TIME block is skipped with `from`.
    expect(ringAreaKm2([...ALL_DAY, ...square(35.68, 139.76, 500)], ALL_DAY.length)).toBeCloseTo(0.25, 2);
  });

  it("drops an area larger than any real 通行禁止 zone even when its vehicles bind the car", () => {
    expect(ringAreaKm2(KANNANA_RING)).toBeGreaterThan(200);
    const use = closureUse("4", "3", KANNANA_RING, "", "|||");
    expect(use).toMatchObject({ skip: "area" });
    expect((use as { areaKm2: number }).areaKm2).toBeGreaterThan(MAX_CLOSURE_AREA_KM2);
  });

  it("keeps real zones and lines and picks their sign from the code and 対象車両", () => {
    const zone = square(35.68, 139.76, 400);
    expect(closureUse("1", "3", zone, "1", "|||100")).toEqual({ kind: CLOSURE.pedestrianRoad });
    expect(closureUse("4", "3", zone, "1", "|||100")).toEqual({ kind: CLOSURE.vehicles });
    expect(closureUse("4", "2", KANNANA_RING, "", "|||")).toEqual({ kind: CLOSURE.all }); // a line: no area
    expect(closureUse("4", "2", zone, "10", "|||")).toEqual({ kind: CLOSURE.motor });
    expect(closureUse("4", "1", zone, "1", "|||")).toEqual({ skip: "point" });
    expect(closureUse("4", "2", zone, "1", "|||100000000000000")).toEqual({ skip: "expressway" });
  });

  it("ignores an implausibly large closure area in old tiles, with a log", () => {
    recentLogs.clear();
    const graph = new RoadGraph([street()], frame);
    const data = empty();
    data.closures.push([3, CLOSURE.all, ...ALL_DAY, ...KANNANA_RING]);
    applyRegulations(graph, data, frame);
    expect(graph.segments[0].closures).toEqual([]);
    expect(recentLogs.query({ event: "closure_area_implausible", level: "warn" })).toHaveLength(1);
  });

  it("closes the streets inside a small zone but not the road its ring is traced on", () => {
    const inside = street(35.68);
    // The ring's south edge runs 3 m inside this road (国道246 at 三軒茶屋 lay 1–4 m inside a zone).
    const bounding = street(35.68 - 147 * M_LAT);
    const graph = new RoadGraph([inside, bounding], frame);
    const data = empty();
    data.closures.push([3, CLOSURE.pedestrianRoad, ...ALL_DAY, ...square(35.68, 139.76 + 90 * M_LON, 300)]);
    applyRegulations(graph, data, frame);
    graph.setClock(gameClock(2026, 10, 1, 12 * 60));
    const [a, b] = graph.segments;
    expect([a.closed, b.closed]).toEqual([true, false]);
  });

  it("reports a road network that is mostly closed, whatever the cause", () => {
    recentLogs.clear();
    const lines = Array.from({ length: 220 }, (_, i) => street(35.68 + i * 30 * M_LAT, 60));
    const graph = new RoadGraph(lines, frame);
    const data = empty();
    for (const line of lines) data.closures.push([2, CLOSURE.all, ...ALL_DAY, ...line.coords]);
    applyRegulations(graph, data, frame);
    expect(recentLogs.query({ event: "closures_implausible_share", level: "warn" })).toHaveLength(1);
  });
});

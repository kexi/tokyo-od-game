import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import {
  armNames,
  classifyShape,
  drawnAngle,
  isPlaceLikeJunction,
  letterHeight,
  planGuideSigns,
  printedDistance,
  refShields,
  relativeAngle,
  signEnglish,
  type Arm,
  type GuideApproach,
  type GuidePlace,
  type RouteInfo,
} from "../src/world/guidePlan";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LAT = 1 / 110_950;
const M_LON = M_LAT / Math.cos((35.68 * Math.PI) / 180);
// Local frame: +x east, +z south.
const at = (east: number, north: number) => new Vector3(east, 0, -north);
const place = (ja: string, rank: number, east: number, north: number, routes: string[] = []): GuidePlace => ({
  ja,
  en: ja,
  rank,
  pos: at(east, north),
  routes: new Set(routes),
});
/** An arm leaving the origin straight along `heading`, the road traced for `length` metres. */
const arm = (
  angle: number,
  heading: Vector3,
  cls: Arm["cls"],
  route: RouteInfo | null = null,
  length = 2000,
): Arm => ({
  angle,
  drawn: angle,
  seg: {} as Segment,
  dir: 1,
  heading,
  route,
  cls,
  trace: { pts: [new Vector3(), heading.clone().multiplyScalar(length)], length, segs: [] },
});
const EAST = new Vector3(1, 0, 0);
const NORTH = new Vector3(0, 0, -1);

describe("junction shape seen from the approach", () => {
  it("names the shapes of the arrow diagram by the arms' angles (+ left)", () => {
    expect(classifyShape([0])).toBe("straight");
    expect(classifyShape([0, 90, -90])).toBe("cross");
    expect(classifyShape([88, -92])).toBe("T");
    expect(classifyShape([40, -45])).toBe("Y");
    expect(classifyShape([0, 85])).toBe("left-branch");
    expect(classifyShape([0, -100])).toBe("right-branch");
    expect(classifyShape([95])).toBe("left-bend");
    expect(classifyShape([0, 45, 90, -90])).toBe("multi");
  });

  it("draws crossings near 90° at 90° and the others at the nearest 45°", () => {
    expect(drawnAngle(78)).toBe(90);
    expect(drawnAngle(-104)).toBe(-90);
    expect(drawnAngle(35)).toBe(45);
    expect(drawnAngle(-12)).toBe(0);
    expect(drawnAngle(132)).toBe(135);
  });

  it("measures arm angles to the left as positive (x east, z south)", () => {
    expect(relativeAngle(EAST, NORTH)).toBeCloseTo(90);
    expect(relativeAngle(EAST, NORTH.clone().negate())).toBeCloseTo(-90);
    expect(relativeAngle(NORTH, EAST)).toBeCloseTo(-90);
  });
});

describe("English on the boards (告示 and 別表第二 figures)", () => {
  it("abbreviates Station to Sta. and adds it for 〜駅", () => {
    expect(signEnglish("東京駅", "Tokyo")).toBe("Tokyo Sta.");
    expect(signEnglish("神田駅南口", "Kanda Station")).toBe("Kanda Sta.");
  });

  it("writes streets as -dori Ave. and 街道 as -kaido Ave.", () => {
    expect(signEnglish("永代通り", "Eitai Street")).toBe("Eitai-dori Ave.");
    expect(signEnglish("六本木通り", "Roppongi-dori")).toBe("Roppongi-dori Ave.");
    expect(signEnglish("甲州街道", "Koshu Kaido")).toBe("Koshu-kaido Ave.");
  });

  it("writes a ward as City, drops macrons and never prints Crossing", () => {
    expect(signEnglish("千代田区", "Chiyoda")).toBe("Chiyoda City");
    expect(signEnglish("中央区", "Chuo-ku")).toBe("Chuo City");
    expect(signEnglish("大手町", "Ōtemachi")).toBe("Otemachi");
    expect(signEnglish("祝田橋", "Iwaidabashi Crossing")).toBe("Iwaidabashi");
    expect(signEnglish("日比谷", "")).toBe("");
  });

  it("reads OSM destination:ref as 国道 or 都道 numbers", () => {
    expect(refShields("R1")).toEqual([{ kind: "national", number: "1" }]);
    expect(refShields("319")).toEqual([{ kind: "prefectural", number: "319" }]);
    expect(refShields("20;413")).toEqual([
      { kind: "national", number: "20" },
      { kind: "prefectural", number: "413" },
    ]);
  });
});

describe("destinations (表示地名 by road class, ルール3)", () => {
  it("shows straight on a 主要幹線 the nearest 重要地 on the left and 主要地 on the right", () => {
    const places = [place("遠い重要地", 1, 3000, 50), place("近い主要地", 2, 1200, -40)];
    const names = armNames(arm(0, EAST, 0), 0, new Vector3(), places, [], new Set());
    expect(names.map((p) => p.ja)).toEqual(["遠い重要地", "近い主要地"]);
  });

  it("moves the 重要地 right when it is the nearer and fetches the next one for the left", () => {
    const places = [
      place("近い重要地", 1, 800, 0),
      place("主要地", 2, 1500, 0),
      place("次の重要地", 1, 4000, 100),
    ];
    const names = armNames(arm(0, EAST, 0), 0, new Vector3(), places, [], new Set());
    expect(names.map((p) => p.ja)).toEqual(["次の重要地", "近い重要地"]);
  });

  it("names one place to the side by the crossing road's class (幹線 → 主要地)", () => {
    const places = [place("北の重要地", 1, 0, 3000), place("北の主要地", 2, 100, 1500)];
    const names = armNames(arm(90, NORTH, 1), 0, new Vector3(), places, [], new Set());
    expect(names.map((p) => p.ja)).toEqual(["北の主要地"]);
  });

  it("ignores places behind, beside and at the junction itself", () => {
    const places = [
      place("後ろ", 1, -2000, 0),
      place("真横", 1, 0, 2000),
      place("ここ", 1, 150, 0),
      place("前", 1, 2500, 200),
    ];
    const names = armNames(arm(0, EAST, 2), 2, new Vector3(), places, [], new Set());
    expect(names.map((p) => p.ja)).toEqual(["前"]);
  });

  it("follows the arm's route to a place off the road's last heading beyond the graph", () => {
    const n1: RouteInfo = { cls: 0, refs: ["1"], name: "", nameEn: "", key: "N1" };
    // 1 km of road in the graph, then 国道1号 bends: 50° off, outside the 28° cone but on the route.
    const off = (deg: number, d: number) => [
      1000 + d * Math.cos((deg * Math.PI) / 180),
      d * Math.sin((deg * Math.PI) / 180),
    ];
    const [ox, on] = off(50, 1200);
    const places = [
      place("国道沿い", 2, ox, on, ["N1"]),
      place("遠い直線上", 2, 5000, 0),
      place("道沿いでない", 2, ox, -on),
    ];
    const names = armNames(arm(-90, EAST, 0, n1, 1000), 0, new Vector3(), places, [], new Set());
    // A 主要幹線 side road asks for a 重要地 first; there is none, so the nearest 主要地.
    expect(names.map((p) => p.ja)).toEqual(["国道沿い"]);
  });

  it("takes a place standing by the traced road at its distance along it", () => {
    const places = [place("道ばた", 2, 700, 90), place("先の直線上", 2, 2600, 0)];
    const names = armNames(arm(90, EAST, 1), 0, new Vector3(), places, [], new Set());
    expect(names.map((p) => p.ja)).toEqual(["道ばた"]);
  });

  it("names a ward only when no other place lies ahead", () => {
    const ward = place("千代田区", 4, 1500, 0);
    expect(
      armNames(arm(90, EAST, 2), 0, new Vector3(), [ward, place("主要地", 2, 2500, 0)], [], new Set()).map(
        (p) => p.ja,
      ),
    ).toEqual(["主要地"]);
    expect(armNames(arm(90, EAST, 2), 0, new Vector3(), [ward], [], new Set()).map((p) => p.ja)).toEqual([
      "千代田区",
    ]);
  });

  it("takes the next named junction down a 補助幹線 as its 一般地", () => {
    const junctions = [
      { ja: "八丁堀", en: "Hatchobori", pos: at(600, 2) },
      { ja: "八丁堀二丁目", en: "Hatchobori 2", pos: at(400, 2) },
    ];
    const names = armNames(
      arm(90, EAST, 2),
      0,
      new Vector3(),
      [place("主要地", 2, 3000, 0)],
      junctions,
      new Set(),
    );
    expect(names.map((p) => p.ja)).toEqual(["八丁堀"]);
  });

  it("only takes junction names that are places, with an English name", () => {
    expect(isPlaceLikeJunction("八丁堀", "Hatchobori")).toBe(true);
    expect(isPlaceLikeJunction("大手町一丁目", "Otemachi 1")).toBe(false);
    expect(isPlaceLikeJunction("八重洲中央口前", "Yaesu")).toBe(false);
    expect(isPlaceLikeJunction("神田駅南口", "Kanda Station")).toBe(false);
    expect(isPlaceLikeJunction("呉服橋", "")).toBe(false);
  });
});

describe("board sizes and distances", () => {
  it("sizes the letters by design speed and lanes (国土交通省 Q&A)", () => {
    expect(letterHeight(60, 2)).toBe(30);
    expect(letterHeight(50, 1)).toBe(20);
    expect(letterHeight(30, 2)).toBe(15);
    expect(letterHeight(30, 1)).toBe(10);
    expect(letterHeight(80, 1)).toBe(30);
  });

  it("prints the 予告 distance to the nearest 50 m, at least 100 m", () => {
    expect(printedDistance(318)).toBe(300);
    expect(printedDistance(276)).toBe(300);
    expect(printedDistance(130)).toBe(150);
    expect(printedDistance(60)).toBe(100);
  });
});

describe("placement on a crossing of a 国道 and a 都道", () => {
  const line = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    width: number,
    kind: RoadLine["kind"],
  ): RoadLine => ({
    coords: [139.76 + x0 * M_LON, 35.68 - z0 * M_LAT, 139.76 + x1 * M_LON, 35.68 - z1 * M_LAT],
    width,
    oneway: 0,
    kind,
  });
  const graph = new RoadGraph(
    [
      line(-1000, 0, 0, 0, 22, "national"),
      line(0, 0, 1000, 0, 22, "national"),
      line(0, -800, 0, 0, 16, "prefectural"),
      line(0, 0, 0, 800, 16, "prefectural"),
    ],
    frame,
  );
  const west = graph.segments[0];
  const centreNode = west.to;
  const approach: GuideApproach = {
    seg: west,
    dir: 1,
    at: west.length - 18,
    travel: EAST.clone(),
    nodes: [centreNode],
  };
  const places = [
    place("東の重要地", 1, 3000, 0),
    place("東の主要地", 2, 1200, 0),
    place("北の主要地", 2, 0, 2000),
    place("南の主要地", 2, 0, -2500),
  ];
  const plans = planGuideSigns({
    graph,
    approaches: [approach],
    routes: new Map(),
    places,
    names: [],
    dests: [],
    avoid: [],
  });

  it("stands a 108の2-A within 150 m and a 108-A 予告 within 300 m before the junction", () => {
    const atJunction = plans.find((p) => p.board.kind === "108の2-A");
    const advance = plans.find((p) => p.board.kind === "108-A");
    expect(atJunction?.before).toBeGreaterThan(30);
    expect(atJunction?.before).toBeLessThanOrEqual(150 + 20);
    expect(advance?.before).toBeLessThanOrEqual(300 + 20);
    expect(advance?.board.distance).toBe(printedDistance(advance?.before ?? 0));
  });

  it("puts the pole on the left kerb, overhanging the wide road, facing the traffic", () => {
    for (const p of plans) {
      expect(p.pos.z).toBeLessThan(-11); // north of the eastbound carriageway (22 m wide)
      expect(p.pos.x).toBeLessThan(-30);
      expect(p.travel.x).toBeCloseTo(1);
      expect(p.mount).toBe("overhead");
    }
  });

  it("orders the arms with their names: straight two, the sides one each", () => {
    const board = plans.find((p) => p.board.kind === "108の2-A")?.board;
    const byAngle = new Map(board?.arms.map((a) => [a.angle, a.names.map((n) => n.ja)]));
    expect(byAngle.get(0)).toEqual(["東の重要地", "東の主要地"]);
    expect(byAngle.get(90)).toEqual(["北の主要地"]);
    expect(byAngle.get(-90)).toEqual(["南の主要地"]);
    expect(plans[0].shape).toBe("cross");
  });
});

import { Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { laneAdvice } from "../src/game/laneView";
import { compassLabel } from "../src/game/minimap";
import { junctionLabel, type AheadStep } from "../src/game/navAhead";
import { closureWord, collectNotices, type OrbisLike } from "../src/game/navNotices";
import {
  joinSpoken,
  junctionName,
  sayLane,
  sayStraight,
  sayTurn,
  spokenName,
  turnPhrase,
} from "../src/game/navPhrases";
import { idleView, roadLabel } from "../src/game/navView";
import { setLocale, t, type Locale, type MessageKey } from "../src/i18n";
import { en } from "../src/i18n/en";
import { pickVoice, speechLang } from "../src/i18n/speech";
import { zh } from "../src/i18n/zh";
import { CLOSURE } from "../src/world/closures";
import type { RouteInfo } from "../src/world/guidePlan";
import type { Segment } from "../src/world/roads";

afterEach(() => setLocale("ja"));

const deg = (d: number) => (d * Math.PI) / 180;
/** Every language in turn, with the language in force switched for the callback. */
const inEach = <T>(fn: () => T): Record<Locale, T> => {
  const out = {} as Record<Locale, T>;
  for (const locale of ["ja", "en", "zh"] as const) {
    setLocale(locale);
    out[locale] = fn();
  }
  return out;
};

describe("ナビの読み上げ: each language phrased as its own navigation apps phrase it", () => {
  it("calls a right turn at a named junction 300 m ahead", () => {
    const said = inEach(() =>
      sayTurn({ turn: "right", name: junctionName("日比谷", "Hibiya"), distance: 300 }),
    );
    expect(said).toEqual({
      ja: "およそ300メートル先、日比谷交差点を右方向です。",
      en: "In 300 meters, turn right at Hibiya.",
      zh: "前方300米，在日比谷路口右转。",
    });
  });

  it("says the last call close to an unnamed left turn without a distance", () => {
    expect(inEach(() => sayTurn({ turn: "left", name: null, distance: null }))).toEqual({
      ja: "まもなく、左方向です。",
      en: "Turn left ahead.",
      zh: "即将左转。",
    });
  });

  it("says the last call close to a named right turn with the name after the turn in English", () => {
    const said = inEach(() =>
      sayTurn({ turn: "right", name: junctionName("新宿駅南口", "Shinjuku Sta."), distance: null }),
    );
    expect(said).toEqual({
      ja: "まもなく、新宿駅南口交差点を右方向です。",
      en: "Turn right just ahead, at Shinjuku Station.",
      zh: "即将在新宿駅南口路口右转。",
    });
  });

  it("calls a U-turn a kilometre off in whole kilometres outside Japanese", () => {
    expect(inEach(() => sayTurn({ turn: "uturn", name: null, distance: 1000 }))).toEqual({
      ja: "およそ1.0キロ先、U ターンです。",
      en: "In 1 kilometer, make a U-turn.",
      zh: "前方1公里，掉头。",
    });
  });

  it("guides straight on at a named junction, ahead and then soon", () => {
    const ahead = inEach(() => sayStraight({ name: junctionName("日比谷"), soon: false }));
    expect(ahead).toEqual({
      ja: "この先、日比谷交差点を直進です。",
      en: "Up ahead, continue straight at 日比谷.",
      zh: "前方日比谷路口，请直行。",
    });
    const soon = inEach(() => sayStraight({ name: junctionName("桜田門", "Sakuradamon"), soon: true }));
    expect(soon).toEqual({
      ja: "まもなく、桜田門交差点を直進です。",
      en: "Continue straight at Sakuradamon.",
      zh: "即将经过桜田門路口，请直行。",
    });
  });

  it("adds the lanes to take after the call, and alone when the car must leave its lane", () => {
    const withLane = inEach(() =>
      joinSpoken([
        t("nav.say.start"),
        sayTurn({ turn: "right", name: junctionName("日比谷", "Hibiya"), distance: 100 }),
        sayLane(laneAdvice([false, false, true]) ?? ""),
      ]),
    );
    expect(withLane).toEqual({
      ja: "ルート案内を開始します。およそ100メートル先、日比谷交差点を右方向です。右側の車線を走行してください。",
      en: "Starting route guidance. In 100 meters, turn right at Hibiya. Use the right lane.",
      zh: "开始路线引导。前方100米，在日比谷路口右转。请走右侧车道。",
    });
    expect(inEach(() => sayLane(laneAdvice([true, false]) ?? "", true))).toEqual({
      ja: "この先、左側の車線を走行してください。",
      en: "Up ahead, use the left lane.",
      zh: "前方请走左侧车道。",
    });
    expect(laneAdvice([true, true])).toBeNull();
  });

  it("announces the arrival", () => {
    expect(inEach(() => t("nav.say.arrived"))).toEqual({
      ja: "目的地周辺です。音声案内を終了します。",
      en: "You are near your destination. Ending route guidance.",
      zh: "已到达目的地附近，本次导航结束。",
    });
  });

  it("speaks the guide-sign abbreviations in full in English only", () => {
    setLocale("en");
    expect(spokenName("Shinjuku Sta.")).toBe("Shinjuku Station");
    expect(spokenName("Sendagaya 3 -W.")).toBe("Sendagaya 3 West");
    expect(spokenName("Harumi-dori Ave.")).toBe("Harumi-dori Avenue");
    expect(spokenName("Kitashinagawa")).toBe("Kitashinagawa");
    expect(
      sayTurn({ turn: "slightLeft", name: junctionName("新宿駅南口", "Shinjuku Sta."), distance: 700 }),
    ).toBe("In 700 meters, bear left at Shinjuku Station.");
    setLocale("zh");
    expect(spokenName("新宿駅南口路口")).toBe("新宿駅南口路口");
  });

  it("speaks in the language in force (ja-JP / en-US / zh-CN)", () => {
    expect(inEach(() => speechLang())).toEqual({ ja: "ja-JP", en: "en-US", zh: "zh-CN" });
  });

  it("takes another region's voice of the same language, Mandarin before Cantonese", () => {
    const voices = [{ lang: "ja-JP" }, { lang: "en-GB" }, { lang: "zh-HK" }, { lang: "zh-TW" }];
    expect(pickVoice(voices, "en-US")?.lang).toBe("en-GB");
    expect(pickVoice(voices, "zh-CN")?.lang).toBe("zh-TW");
    expect(pickVoice([{ lang: "ja-JP" }], "en-US")).toBeNull();
  });
});

const readCompass = () => [0, 45, 90, 135, 225, 315].map((d) => compassLabel(deg(d)));

/** The idle panel nowhere in particular, heading north-east, with Hibiya ahead. */
const idleWords = () => {
  const v = idleView({
    ward: "—",
    town: "",
    road: null,
    heading: compassLabel(deg(45)),
    limit: 40,
    mode: "car",
    junctions: [{ distance: 182, name: junctionName("日比谷", "Hibiya") }],
    notice: null,
  });
  return [v.dist, v.words, v.road, v.list[0]?.dist, v.list[0]?.name];
};

describe("ナビの画面の文字", () => {
  it("writes the turn and the junction on the second line", () => {
    expect(inEach(() => turnPhrase("right", junctionName("日比谷", "Hibiya")))).toEqual({
      ja: "日比谷交差点を右方向",
      en: "Turn right at Hibiya",
      zh: "在日比谷路口右转",
    });
    expect(inEach(() => turnPhrase("slightLeft", null))).toEqual({
      ja: "斜め左方向",
      en: "Bear left",
      zh: "向左前方",
    });
  });

  it("names a junction from the OSM English name, else keeps the Japanese one", () => {
    const names = [
      { pos: new Vector3(0, 0, 0), name: "日比谷", en: "Hibiya" },
      { pos: new Vector3(500, 0, 0), name: "むらさき橋交差点", en: "" },
      { pos: new Vector3(1000, 0, 0), name: "新宿駅", en: "Shinjuku Station" },
    ];
    const at = (x: number) => junctionLabel(names, new Vector3(x, 0, 10));
    expect(inEach(() => [at(0), at(500), at(1000)])).toEqual({
      ja: ["日比谷交差点", "むらさき橋交差点", "新宿駅交差点"],
      en: ["Hibiya", "むらさき橋", "Shinjuku Sta."],
      zh: ["日比谷路口", "むらさき橋路口", "新宿駅路口"],
    });
    expect(junctionLabel(names, new Vector3(250, 0, 0))).toBeNull();
  });

  it("names the roads with their English names and route numbers in English", () => {
    type Info = Pick<RouteInfo, "cls" | "refs" | "name" | "nameEn">;
    const harumi: Info = { cls: 1, refs: ["304"], name: "晴海通り", nameEn: "Harumi-dori" };
    const route1: Info = { cls: 0, refs: ["1", "15"], name: "", nameEn: "" };
    const label = () => [
      roadLabel(harumi, "local"),
      roadLabel(route1, "national"),
      roadLabel(undefined, "national"),
    ];
    expect(inEach(label)).toEqual({
      ja: ["晴海通り（都道304号）", "国道1号・国道15号", "国道"],
      en: ["Harumi-dori Ave. (Tokyo Route 304)", "Route 1 / Route 15", "National route"],
      zh: ["晴海通り（都道304号）", "国道1号・国道15号", "国道"],
    });
    setLocale("en");
    expect(roadLabel({ cls: 3, refs: [], name: "外堀通り" }, "local")).toBe("外堀通り");
  });

  it("reads the compass in each language (Chinese puts east and west first)", () => {
    expect(inEach(readCompass)).toEqual({
      ja: ["北", "北東", "東", "南東", "南西", "北西"],
      en: ["N", "NE", "E", "SE", "SW", "NW"],
      zh: ["北", "东北", "东", "东南", "西南", "西北"],
    });
  });

  it("shows where the player is when there is nothing to guide", () => {
    expect(inEach(idleWords)).toEqual({
      ja: ["現在地", "北東へ進行中", "道路名なし", "180m", "日比谷交差点"],
      en: ["Current location", "Heading NE", "Unnamed road", "180 m", "Hibiya"],
      zh: ["当前位置", "向东北行驶", "无名道路", "180米", "日比谷路口"],
    });
  });

  it("words the notices on the panel and in the voice", () => {
    const seg = {
      id: 1,
      from: 0,
      to: 1,
      length: 600,
      closed: false,
      closures: [],
      limit: 60,
      limitKind: "sign",
      line: { kind: "local", width: 8 },
    } as unknown as Segment;
    const steps: AheadStep[] = [{ seg, dir: 1, start: 0, entry: 0, length: 600 }];
    const orbis: OrbisLike[] = [{ seg, s: 340, dir: 1, entry: { id: 1 }, limit: 60 }];
    const stop = { seg, dir: 1 as const, at: 60, kind: "stop" as const, controller: null };
    const read = () =>
      collectNotices(steps, { limit: 60, approaches: [stop], orbis }).map((n) => [n.text, n.voice]);
    expect(inEach(read)).toEqual({
      ja: [
        ["この先 速度取締機・340m", "この先、速度取締機があります。制限速度は60キロです。"],
        ["一時停止・60m", "この先、一時停止です。"],
      ],
      en: [
        ["Speed camera ahead · 340 m", "Speed camera ahead. The speed limit is 60 kilometers per hour."],
        ["Stop sign · 60 m", "Stop sign ahead."],
      ],
      zh: [
        ["前方测速摄像头·340米", "前方有测速摄像头，限速60公里。"],
        ["停车让行·60米", "前方停车让行。"],
      ],
    });
    expect(inEach(() => closureWord(CLOSURE.vehicles))).toEqual({
      ja: "車両通行止め",
      en: "No vehicles",
      zh: "车辆禁止通行",
    });
  });
});

describe("ナビのパネル（264×352）に収まる長さ", () => {
  // Budgets in characters, from the slot widths in src/style.css at their font sizes: about
  // 7 px a Latin letter and 12–14 px a Han character.
  const budgets: Array<[RegExp, number, number]> = [
    // The second line (14 px bold, 196 px).
    [/^nav\.(arrived|follow|followToGoal|searching|towardGoal)$|^turn\.[a-zA-Z]+$/, 24, 13],
    // The list's names (12 px, about 160 px).
    [/^nav\.(goal|goalOffMap|noJunctions)$/, 28, 13],
    // Under the speedometer's limit sign (9 px) and the walking badge (24 px circle).
    [/^speedo\.(sign|zone|statutory)$/, 9, 4],
    [/^nav\.walkBadge$/, 4, 2],
    // The notice line's fixed words (12 px, 232 px, with a distance after them).
    [/^notice\.(school|pedestrianRoad)$|^closure\.[a-zA-Z]+$/, 20, 9],
  ];
  it("keeps the panel's fixed words inside their slots", () => {
    const keys = Object.keys(en) as MessageKey[];
    for (const [pattern, latin, han] of budgets) {
      const matched = keys.filter((k) => pattern.test(k));
      expect(matched.length, String(pattern)).toBeGreaterThan(0);
      for (const key of matched) {
        expect(en[key].length, `en ${key}: ${en[key]}`).toBeLessThanOrEqual(latin);
        expect(zh[key].length, `zh ${key}: ${zh[key]}`).toBeLessThanOrEqual(han);
      }
    }
  });
});

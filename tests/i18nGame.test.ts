import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keyRows } from "../src/game/controlsHelp";
import { setLocale, t, type Locale, type MessageKey } from "../src/i18n";
import { en } from "../src/i18n/en";
import { formatClock, formatDay } from "../src/i18n/format";
import { ja } from "../src/i18n/ja";
import { violationDetail } from "../src/i18n/law";
import { inJapanese, keysWithPrefix } from "../src/i18n/reverse";
import { zh } from "../src/i18n/zh";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const main = read("src/main.ts");
const html = read("index.html");
/** The game's own files whose text phase 2 put through t(). */
const SOURCES = [
  "src/main.ts",
  "src/game/controlsHelp.ts",
  "src/game/noticeLog.ts",
  "src/game/mirrorCharm.ts",
  "src/game/phone.ts",
  "src/world/transit.ts",
];
// The areas of the dictionary these files name (a key literal is "area.name…").
const AREAS =
  /"((?:toast|notify|hud|dialog|dayEnd|warp|help|taxi|phoneUi|police|parking|arrest|time|weather|camera|mission|violationDetail|violationWord|accident|incident|replay|transit|ticket|toolbar|settings)\.[\w.]+)"/g;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const DICTS = { ja, en, zh } as const;
/** The dictionary's areas this part of phase 2 added (main.ts, the HUD, the dialogs, the help). */
const GAME_AREAS =
  /^(toast|notify|hud|dialog|dayEnd|warp|help|taxi|phoneUi|police|parking|arrest|time|weather|camera|mission|violationDetail|violationWord|accident|incident|replay|transit)\./;
const has = (key: string) => (Object.keys(ja) as string[]).includes(key);

/** The text of each call `name(…)` in `src`, its parentheses balanced (strings may hold some). */
function calls(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![\\w.])${name}\\(`, "g");
  for (const m of src.matchAll(re)) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index + name.length; i < src.length; i++) {
      const c = src[i];
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    out.push(src.slice(m.index, end + 1));
  }
  return out;
}

afterEach(() => setLocale("ja"));

describe("main.ts とゲームの画面が使うキー", () => {
  it("names only keys that exist, in every language", () => {
    const named = SOURCES.flatMap((path) => [...read(path).matchAll(AREAS)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(250);
    for (const key of named) {
      expect(has(key), `${key} in ja`).toBe(true);
      expect(en[key as MessageKey], `${key} in en`).toBeTruthy();
      expect(zh[key as MessageKey], `${key} in zh`).toBeTruthy();
    }
  });

  it("passes no Japanese to a toast or a notice: every one goes through a key", () => {
    const shown = [...calls(main, "toast"), ...calls(main, "notify"), ...calls(main, "stopAutopilot")];
    expect(shown.length).toBeGreaterThan(80);
    for (const call of shown) expect(JAPANESE.test(call), call).toBe(false);
  });

  it("marks index.html's game dialogs and HUD with keys that exist in every language", () => {
    const keys = [...html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(110);
    for (const key of keys) {
      expect(en[key as MessageKey], key).toBeTruthy();
      expect(zh[key as MessageKey], key).toBeTruthy();
    }
  });

  it("names the key from the layout in hints, never a letter of an older layout", () => {
    // 「F で…」 (乗降 moved to Q), 「（P）」 for the phone (P pauses), 「O・運転操作で解除」.
    // help.digits' 「F キー」 are the function keys, not a key to press.
    for (const key of keysWithPrefix("").filter((k) => GAME_AREAS.test(k) && k !== "help.digits")) {
      const text = ja[key];
      // A lone capital, as a key is written: 「Q で」「N キー」「（B）」 (not "iOS では").
      const namesKey = /(^|[\s（「])[A-Z] (で|キー)|（[A-Z]）|もう一度 [A-Z]$/.test(text);
      expect(namesKey, `${key}: ${text}`).toBe(false);
    }
  });
});

describe("訳文", () => {
  const mine = (Object.keys(ja) as MessageKey[]).filter((k) => GAME_AREAS.test(k));

  it("writes English without Japanese, and Chinese without kana", () => {
    expect(mine.length).toBeGreaterThan(350);
    for (const key of mine) {
      expect(JAPANESE.test(en[key]), `en ${key}: ${en[key]}`).toBe(false);
      expect(KANA.test(zh[key]), `zh ${key}: ${zh[key]}`).toBe(false);
    }
  });

  it("renders toasts with their values in each language", () => {
    const cases: Array<[Locale, string]> = [
      ["ja", "車を降りました（Q で乗車・Shift で走る・Space でジャンプ・←→ やドラッグで視点）"],
      ["en", "Out of the car (Q to get in, Shift to run, Space to jump, ←→ or drag to look around)"],
      ["zh", "已下车（Q 上车·Shift 奔跑·Space 跳跃·←→ 或拖动转换视角）"],
    ];
    for (const [locale, text] of cases) {
      setLocale(locale);
      expect(t("toast.gotOut", { key: "Q" })).toBe(text);
    }
    setLocale("en");
    expect(t("toast.taxiFare", { fare: "1,200", km: "2.4" })).toBe(
      "🚕 Fare ¥1,200 (2.4 km, paid in the app). Thank you!",
    );
    expect(t("hud.licensePoints", { points: 3 })).toBe("Penalty points 3 / 6");
    setLocale("zh");
    expect(t("toast.missionDone", { name: "东京塔", points: 30 })).toBe("任务完成！东京塔 +30");
    expect(t("hud.licenseFines", { fines: "9,000" })).toBe("罚款 9,000 日元");
  });

  it("keeps the HUD's Japanese exactly as before", () => {
    expect(t("hud.licensePoints", { points: 2 })).toBe("違反点数 2 / 6");
    expect(t("hud.licenseFines", { fines: "9,000" })).toBe("反則金 9,000円");
    expect(t("toast.timeOfDay", { label: t("time.label.evening") })).toBe("時間帯: 夕方");
    expect(t("incident.eta", { label: t("incident.ambulance"), s: 40 })).toBe("🚑 救急: 到着まで約40秒");
  });
});

describe("時計と日付（Intl）", () => {
  it("writes the HUD's day and time as each language does", () => {
    const day = { m: 10, d: 12 };
    expect(formatDay(day, 1, true)).toBe("10/12(月・祝)");
    expect(formatClock(9 * 60 + 5)).toBe("09:05");
    setLocale("en");
    expect(formatDay(day, 1, true)).toBe("Mon, 10/12 (holiday)");
    expect(formatDay(day, 6, false)).toBe("Sat, 10/12");
    expect(formatClock(21 * 60 + 30)).toBe("21:30");
    setLocale("zh");
    expect(formatDay(day, 1, true)).toBe("10/12 周一（节假日）");
    expect(formatDay(day, 0, false)).toBe("10/12 周日");
  });
});

describe("違反の記録の詳細（日本語で残し、画面で訳す）", () => {
  /** What main.ts and the review show: law.ts's violationDetail (the template, then the words in it). */
  const shown = violationDetail;

  it("records the same Japanese as before phase 2", () => {
    setLocale("en");
    expect(inJapanese("violationDetail.speedSign", { limit: 40, kmh: 65, over: 25 })).toBe(
      "規制速度 40 km/h のところ 65 km/h（25 km/h 超過）",
    );
    const lane = inJapanese("violationDetail.laneDirection", {
      allowed: `${inJapanese("violationWord.straight")}・${inJapanese("violationWord.left")}`,
      n: 1,
      turn: inJapanese("violationWord.turnRight"),
    });
    expect(lane).toBe("直進・左折の車線（左から 1 番目）から右方向");
  });

  it("shows a recorded detail in English, the words inside it too", () => {
    setLocale("en");
    expect(shown("規制速度 40 km/h のところ 65 km/h（25 km/h 超過）")).toBe(
      "65 km/h where the posted limit is 40 km/h (25 km/h over)",
    );
    expect(shown("直進・左折の車線（左から 1 番目）から右方向")).toBe(
      "From the lane for straight / left (lane 1 from the left), went right",
    );
    expect(shown("車両通行止めの道路に進入")).toBe("Entered a road marked “No vehicles”");
    expect(shown("通行禁止の道路に進入")).toBe("Entered a road closed to traffic");
    expect(shown("通行禁止の道路に進入（7:30-8:30）")).toBe("Entered a road marked “No entry” (7:30-8:30)");
    setLocale("zh");
    expect(shown("直進・左折の車線（左から 1 番目）から右方向")).toBe("从直行、左转车道（左数第 1 条）右转");
    expect(shown("どれにも当たらない自由な文")).toBe("どれにも当たらない自由な文");
  });
});

describe("操作の一覧", () => {
  it("lists the keys in English and Chinese, the key names as printed", () => {
    for (const locale of ["en", "zh"] as const) {
      setLocale(locale);
      const rows = keyRows({ layout: "ccd", assist: "easy" });
      for (const [, what] of rows) expect(KANA.test(what), `${locale}: ${what}`).toBe(false);
      expect(rows.some(([k]) => k === "Q")).toBe(true);
    }
    setLocale("en");
    const wipers = keyRows({ layout: "wasd", assist: "easy" }).find(([k]) => k === "Tab")?.[1];
    expect(wipers).toBe("Wipers (automatic in Easy mode)");
  });
});

describe("辞書の形", () => {
  it("has the game's keys in all three dictionaries", () => {
    for (const [name, dict] of Object.entries(DICTS))
      for (const key of keysWithPrefix("toast.")) expect(dict[key], `${name} ${key}`).toBeTruthy();
  });
});

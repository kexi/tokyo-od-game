import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, type Locale } from "../src/i18n";
import {
  formatClock,
  formatDay,
  formatDistance,
  formatNumber,
  formatWeekday,
  formatYen,
  spokenDistance,
} from "../src/i18n/format";
import { inJapanese, matchJapanese, retranslate, translateWord } from "../src/i18n/reverse";
import { localUtterance, pickVoice, speechLang } from "../src/i18n/speech";

afterEach(() => {
  setLocale("ja");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Each case run in every language: [ja, en, zh]. */
function perLocale<T>(fn: () => T): Record<Locale, T> {
  const out = {} as Record<Locale, T>;
  for (const locale of ["ja", "en", "zh"] as const) {
    setLocale(locale);
    out[locale] = fn();
  }
  return out;
}

class FakeUtterance {
  lang = "";
  voice: unknown = null;
  constructor(public text: string) {}
}

/** A stand-in for the browser's speech: the listed voices and the utterances made. */
function stubSpeech(list: Array<{ lang: string; name: string }>) {
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", { getVoices: () => list });
}

describe("距離の書き方", () => {
  it("shows distances on screen to 10 m and from 1 km to 0.1 km, Japanese exactly as before", () => {
    expect(perLocale(() => formatDistance(296))).toEqual({ ja: "300m", en: "300 m", zh: "300米" });
    expect(perLocale(() => formatDistance(3))).toEqual({ ja: "10m", en: "10 m", zh: "10米" });
    expect(perLocale(() => formatDistance(1260))).toEqual({ ja: "1.3km", en: "1.3 km", zh: "1.3公里" });
    // The switch to km is at 1 km after rounding to 10 m (994 → 990 m, 996 → 1.0 km).
    expect(perLocale(() => formatDistance(994))).toEqual({ ja: "990m", en: "990 m", zh: "990米" });
    expect(perLocale(() => formatDistance(996))).toEqual({ ja: "1.0km", en: "1.0 km", zh: "1.0公里" });
  });

  it("reads distances aloud as each language's navigation says them", () => {
    expect(perLocale(() => spokenDistance(300))).toEqual({
      ja: "300メートル",
      en: "300 meters",
      zh: "300米",
    });
    expect(perLocale(() => spokenDistance(1500))).toEqual({
      ja: "1.5キロ",
      en: "1.5 kilometers",
      zh: "1.5公里",
    });
    // Japanese keeps "1.0キロ"; the others drop ".0", and English says the singular.
    expect(perLocale(() => spokenDistance(1000))).toEqual({ ja: "1.0キロ", en: "1 kilometer", zh: "1公里" });
  });
});

describe("数・金額・時刻・日付", () => {
  it("groups numbers and writes yen in each language's way", () => {
    expect(perLocale(() => formatNumber(12345))).toEqual({ ja: "12,345", en: "12,345", zh: "12,345" });
    expect(perLocale(() => formatNumber(2.5, 1))).toEqual({ ja: "2.5", en: "2.5", zh: "2.5" });
    expect(perLocale(() => formatYen(9000))).toEqual({ ja: "9,000 円", en: "¥9,000", zh: "9,000 日元" });
  });

  it("keeps the clock at 24 hours in every language", () => {
    expect(perLocale(() => formatClock(14 * 60 + 5))).toEqual({ ja: "14:05", en: "14:05", zh: "14:05" });
    expect(perLocale(() => formatClock(7 * 60 + 30.9))).toEqual({ ja: "07:30", en: "07:30", zh: "07:30" });
  });

  it("names weekdays from Sunday = 0", () => {
    expect(perLocale(() => formatWeekday(0))).toEqual({ ja: "日", en: "Sun", zh: "周日" });
    expect(perLocale(() => formatWeekday(6))).toEqual({ ja: "土", en: "Sat", zh: "周六" });
  });

  it("writes the in-game day as before in Japanese, and as English and Chinese write dates", () => {
    expect(perLocale(() => formatDay({ m: 10, d: 5 }, 1, false))).toEqual({
      ja: "10/5(月)",
      en: "Mon, 10/5",
      zh: "10/5 周一",
    });
    expect(perLocale(() => formatDay({ m: 10, d: 12 }, 1, true))).toEqual({
      ja: "10/12(月・祝)",
      en: "Mon, 10/12 (holiday)",
      zh: "10/12 周一（节假日）",
    });
  });
});

describe("読み上げの言語と声", () => {
  const voices = [
    { lang: "ja-JP", name: "Kyoko" },
    { lang: "en-GB", name: "Daniel" },
    { lang: "en-US", name: "Samantha" },
    { lang: "zh-HK", name: "Sinji" },
    { lang: "zh-TW", name: "Meijia" },
  ];

  it("speaks Japanese, US English and mainland Mandarin", () => {
    expect(speechLang("ja")).toBe("ja-JP");
    expect(speechLang("en")).toBe("en-US");
    expect(speechLang("zh")).toBe("zh-CN");
    expect(perLocale(() => speechLang())).toEqual({ ja: "ja-JP", en: "en-US", zh: "zh-CN" });
  });

  it("picks the exact voice, else the nearest region, Mandarin before Cantonese", () => {
    expect(pickVoice(voices, "en-US")?.name).toBe("Samantha");
    expect(pickVoice(voices, "ja-JP")?.name).toBe("Kyoko");
    expect(pickVoice(voices, "zh-CN")?.name).toBe("Meijia");
    expect(pickVoice([{ lang: "en_GB", name: "Android" }], "en-US")?.name).toBe("Android");
    expect(pickVoice([{ lang: "zh-HK", name: "Sinji" }], "zh-CN")?.name).toBe("Sinji");
    expect(pickVoice([{ lang: "ja-JP", name: "Kyoko" }], "zh-CN")).toBeNull();
  });

  it("makes the utterance in the language in force, with its voice", () => {
    stubSpeech(voices);
    setLocale("en");
    const u = localUtterance("In 300 meters, turn right.");
    expect(u?.lang).toBe("en-US");
    expect((u?.voice as { name: string } | null)?.name).toBe("Samantha");
    setLocale("zh");
    expect(localUtterance("前方300米，右转。")?.lang).toBe("zh-CN");
  });

  it("stays silent when the device lists voices and none speaks the language", () => {
    stubSpeech([{ lang: "ja-JP", name: "Kyoko" }]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setLocale("zh");
    expect(localUtterance("前方300米，右转。")).toBeNull();
    setLocale("ja");
    expect(localUtterance("まもなく右方向です。")?.lang).toBe("ja-JP");
  });

  it("sets only the language while the voice list is still loading", () => {
    stubSpeech([]);
    setLocale("en");
    const u = localUtterance("Turn right.");
    expect(u?.lang).toBe("en-US");
    expect(u?.voice).toBeNull();
  });

  it("makes nothing without speechSynthesis", () => {
    expect(localUtterance("まもなく右方向です。")).toBeNull();
  });
});

describe("スタート地点のタワー", () => {
  it("names the towers in the language in force, on the picker and once chosen", async () => {
    const { readStart, START_LANDMARKS } = await import("../src/game/startPoint");
    const fallback = { lat: 35.68, lon: 139.76, yaw: 0, label: () => "東京駅" };
    vi.stubGlobal("location", { search: "?start=35.658581,139.745433" });
    const start = readStart(fallback, []);
    expect(perLocale(() => start.label())).toEqual({ ja: "東京タワー", en: "Tokyo Tower", zh: "东京塔" });
    const skytree = START_LANDMARKS.find((l) => l.key === "start.towerSkytree");
    vi.stubGlobal("location", { search: `?start=${skytree?.lat},${skytree?.lon}` });
    const label = readStart(fallback, []).label;
    expect(perLocale(label)).toEqual({ ja: "東京スカイツリー", en: "Tokyo Skytree", zh: "东京晴空塔" });
  });
});

describe("日本語で残した記録を訳し直す", () => {
  it("writes Japanese whatever the language, and reads its values back", () => {
    setLocale("en");
    const text = inJapanese("loading.plateau", { percent: 42 });
    expect(text).toBe("PLATEAU 3D 都市モデルを読み込み中… 42%");
    expect(matchJapanese(text, "loading.plateau")).toEqual({ percent: "42" });
    expect(matchJapanese("別の文", "loading.plateau")).toBeNull();
  });

  it("shows a record in the language in force, unchanged in Japanese or when nothing matches", () => {
    const text = inJapanese("loading.plateau", { percent: 42 });
    const keys = ["loading.failed", "loading.plateau"] as const;
    expect(perLocale(() => retranslate(text, keys))).toEqual({
      ja: "PLATEAU 3D 都市モデルを読み込み中… 42%",
      en: "Loading PLATEAU 3D city models… 42%",
      zh: "正在加载 PLATEAU 3D 城市模型… 42%",
    });
    setLocale("en");
    expect(retranslate("自由な文", keys)).toBe("自由な文");
    expect(retranslate(inJapanese("loading.failed", { error: "x" }), keys, () => "Y")).toBe(
      "Couldn't start: Y",
    );
  });

  it("translates a Japanese word through the key whose Japanese is exactly it", () => {
    expect(perLocale(() => translateWord("高", "graphics."))).toEqual({ ja: "高", en: "High", zh: "高" });
    setLocale("en");
    expect(translateWord("知らない語", "graphics.")).toBe("知らない語");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { personaPrompt, templateLine, templateReply, type Surroundings } from "../src/ai/dialogue";
import { hasEnoughInfo, operatorPrompt, QUICK_REPLIES, scriptedOperator } from "../src/ai/dispatch";
import { isBlocked } from "../src/ai/llm";
import type { Poi } from "../src/data/schema";
import { NaviTv } from "../src/game/naviTv";
import {
  channelLabel,
  pressTv,
  programmeTitle,
  stationName,
  tickerItems,
  tickerLine,
  TV_OFF,
  type TvInfo,
} from "../src/game/tvRules";
import { setLocale, t, type Locale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ja } from "../src/i18n/ja";
import { zh } from "../src/i18n/zh";
import { profileFor } from "../src/world/pedestrians";

afterEach(() => {
  setLocale("ja");
  vi.unstubAllGlobals();
});

/** setLocale remembers the choice in localStorage; node has none, so give it a blank one. */
function inLocale(locale: Locale): void {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  setLocale(locale);
}

const info = (over: Partial<TvInfo> = {}): TvInfo => ({
  hour: 14 + 5 / 60,
  place: "千代田区 丸の内",
  ward: "千代田区",
  lat: 35.68,
  lon: 139.76,
  weather: {
    raining: false,
    fixedSky: false,
    sun1h: 0.8,
    night: false,
    temp: 21.34,
    humidity: 64,
    precip10m: 0,
    wind: 2.1,
  },
  violations: [
    { label: "信号無視（赤色等）", caught: true },
    { label: "速度超過（25km/h超過）", caught: false },
  ],
  ...over,
});

describe("ナビのテレビ: 局名・番組名・テロップ", () => {
  it("names the fictional channels and programmes in each language", () => {
    expect([stationName(0), programmeTitle("news"), channelLabel(1)]).toEqual([
      "げんしゅテレビ",
      "げんしゅニュース",
      "11ch げんしゅ天気",
    ]);
    inLocale("en");
    expect([stationName(0), programmeTitle("news"), channelLabel(1)]).toEqual([
      "Abide TV",
      "Abide News",
      "Ch 11 Abide Weather",
    ]);
    inLocale("zh");
    expect([stationName(0), programmeTitle("news"), channelLabel(1)]).toEqual([
      "守法电视台",
      "守法新闻",
      "11频道 守法天气台",
    ]);
  });

  it("names no real broadcaster in any language, the 受信料 parody included", () => {
    const real =
      /(NHK|日本放送協会|日本テレビ|日テレ|テレビ朝日|テレ朝|TBS|フジテレビ|テレビ東京|BBC|CNN|CCTV|央视|Nippon TV|Fuji TV|TV Asahi|TV Tokyo)/;
    for (const dict of [ja, en, zh])
      for (const [key, text] of Object.entries(dict))
        if (key.startsWith("tv.")) expect(text, key).not.toMatch(real);
  });

  it("reads the news in English: the time on a 12-hour clock, the ward's English name, the weather, the violations", () => {
    inLocale("en");
    const items = tickerItems(info());
    expect(items.map((i) => i.kind)).toEqual(["time", "place", "weather", "violations", "safety"]);
    expect(items.map((i) => i.tag)).toEqual(["Time", "Location", "Weather", "Violations", "Road safety"]);
    expect(items[0]).toMatchObject({ text: "14:05", speech: "The time is 2:05." });
    expect(items[1]).toMatchObject({ text: "Near 千代田区 丸の内", speech: "You're near Chiyoda City." });
    expect(items[2].text).toBe(
      "Central Tokyo (Kitanomaru Park): sunny · 21.3°C · humidity 64% · wind 2.1 m/s",
    );
    expect(items[2].speech).toBe(
      "It's sunny in central Tokyo, the temperature is 21 degrees, humidity is 64 percent.",
    );
    expect(items[3].text).toMatch(/^2 \(.+, .+\) · 1 caught$/);
    expect(items[3].text).not.toMatch(/[぀-ヿ]/);
    expect(tickerItems(info({ hour: 7 }))[0].speech).toBe("It's 7 o'clock.");
    expect(tickerLine(items)).toContain("[Time] 14:05   ◆   [Location] Near");
  });

  it("does not read a place an English voice cannot say (a town outside the 23 wards)", () => {
    inLocale("en");
    const place = tickerItems(info({ place: "川崎市 中原区", ward: "川崎市" }))[1];
    expect(place).toMatchObject({ kind: "place", text: "Near 川崎市 中原区", speech: "" });
  });

  it("reads the news in Chinese, the place in its kanji, below zero as 零下", () => {
    inLocale("zh");
    const items = tickerItems(info({ weather: { ...info().weather, night: true, sun1h: 0, temp: -2.6 } }));
    expect(items[0]).toMatchObject({ tag: "时间", text: "14:05", speech: "现在是14点5分。" });
    expect(items[1].speech).toBe("当前位置在千代田区丸の内附近。");
    expect(items[2].speech).toBe("东京市中心目前没有下雨。气温零下3度，湿度百分之64。");
    expect(items[3].text).toMatch(/^2起（.+、.+）　其中被查处 1起$/);
    expect(items[4].text).toBe("行驶中注视屏幕违反《道路交通法》（第71条）");
  });

  it("says the set weather and an empty day of violations in each language", () => {
    const fixed = info({ weather: { ...info().weather, fixedSky: true, raining: true }, violations: [] });
    inLocale("en");
    expect(tickerItems(fixed)[2].speech).toBe(
      "The weather is rainy. In central Tokyo, the temperature is 21 degrees, humidity is 64 percent.",
    );
    expect(tickerItems(fixed)[3].text).toBe("Zero — law-abiding again today");
    inLocale("zh");
    expect(tickerItems(fixed)[2].speech).toBe("天气为雨。东京市中心气温21度，湿度百分之64。");
  });
});

describe("ナビのテレビ: 読み上げの言語", () => {
  type Spoken = { text: string; lang: string; voice: { lang: string } | null };

  /** Runs the newsreader for its first line with a fake speechSynthesis that has `voices`. */
  function firstLine(locale: Locale, voices: Array<{ lang: string }>): Spoken[] {
    inLocale(locale);
    const spoken: Spoken[] = [];
    class FakeUtterance {
      lang = "";
      voice: { lang: string } | null = null;
      rate = 1;
      volume = 1;
      constructor(readonly text: string) {}
      addEventListener(): void {}
    }
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
      speak: (u: FakeUtterance) => spoken.push({ text: u.text, lang: u.lang, voice: u.voice }),
      cancel: () => {},
      pending: false,
    });
    const tv = new NaviTv({
      audio: { muted: false, volume: 1, context: null } as never,
      voice: { enabled: false } as never,
      areas: null,
      info: () => info(),
      speakerAt: () => null as never,
      canSpeak: () => true,
    });
    tv.press();
    const frame = { drive: { kmh: 0, parkingBrake: true, engineOff: false }, assist: "easy" as const };
    tv.update({ ...frame, now: 2000, routeActive: false, inCar: true, inCabin: true });
    return spoken;
  }

  const voices = [{ lang: "ja-JP" }, { lang: "en-US" }, { lang: "zh-CN" }];

  it("reads in the language in force with a voice of that language", () => {
    expect(firstLine("ja", voices)).toEqual([
      { text: "14時5分になりました。", lang: "ja-JP", voice: { lang: "ja-JP" } },
    ]);
    expect(firstLine("en", voices)).toEqual([
      { text: "The time is 2:05.", lang: "en-US", voice: { lang: "en-US" } },
    ]);
    expect(firstLine("zh", voices)).toEqual([
      { text: "现在是14点5分。", lang: "zh-CN", voice: { lang: "zh-CN" } },
    ]);
  });

  it("stays silent rather than read English with a Japanese voice", () => {
    expect(firstLine("en", [{ lang: "ja-JP" }])).toEqual([]);
  });

  it("tells the driver in their language when the TV comes on, and how the picture shows", () => {
    inLocale("en");
    const tv = new NaviTv({
      audio: { muted: false, volume: 1, context: null } as never,
      voice: { enabled: false } as never,
      areas: null,
      info: () => info(),
      speakerAt: () => null as never,
      canSpeak: () => false,
    });
    expect(tv.press()).toBe("📺 Ch 10 Abide TV: Abide News");
    expect(pressTv(TV_OFF).on).toBe(true);
    expect(tv.press()).toBe("TV off (back to the navi map)");
  });
});

const poi = (id: number, category: string, lat: number, lon: number, name: string): Poi => ({
  id,
  category,
  lat,
  lon,
  name,
  ward: "千代田区",
  source: 0,
});

describe("歩行者との会話", () => {
  const s: Surroundings = {
    ward: "千代田区",
    town: "丸の内二丁目",
    timeLabel: "昼",
    clock: "12時00分",
    weather: "晴れで、気温は21度くらい",
    nearbyPois: [
      poi(1, "station", 35.6812, 139.7671, "東京駅"),
      poi(2, "culture", 35.6851, 139.7528, "皇居外苑"),
    ],
    categories: [
      { id: "station", label: "都営交通の駅", color: "#0f0", points: 15 },
      { id: "culture", label: "都指定文化財", color: "#f0f", points: 30 },
    ],
    lat: 35.68075,
    lon: 139.76345,
    busLine: "都０４",
  };
  const profile = profileFor(42);

  it("keeps the Japanese replies as they were", () => {
    expect(templateReply(profile, s, "近くの駅はどこ？")).toMatch(
      /^東京駅（都営交通の駅、東へ約\d+m）が近いですよ。$/,
    );
    expect(templateReply(profile, s, "今日の天気は？")).toBe(
      "今は晴れで、気温は21度くらいですね。運転には気をつけてください。",
    );
    expect(templateReply(profile, s, "ここは何区ですか？")).toBe("ここは千代田区丸の内二丁目ですよ。");
  });

  it("answers the quick questions in English, with the Japanese original for the voice", () => {
    inLocale("en");
    const station = templateLine(profile, s, t("talk.quick.station"));
    expect(station.text).toMatch(/^東京駅 \(.+, about \d+ m to the east\) is close by\.$/);
    expect(station.ja).toMatch(/^東京駅（都営交通の駅、東へ約\d+m）が近いですよ。$/);
    expect(templateReply(profile, s, t("talk.quick.weather"))).toBe(
      "It's sunny, about 21 degrees right now. Drive carefully.",
    );
    expect(templateReply(profile, s, t("talk.quick.ward"))).toBe("You're in 丸の内二丁目, Chiyoda City.");
    expect(templateReply(profile, s, t("talk.quick.spots"))).toMatch(
      /^Around here, I'd recommend .+ is nice too\.$/,
    );
    expect(templateReply(profile, s, "thanks!")).toMatch(
      /^(You're welcome! Drive safely\.|No problem — take care!|Enjoy your drive\.)$/,
    );
  });

  it("answers in Chinese too", () => {
    inLocale("zh");
    expect(templateReply(profile, s, t("talk.quick.station"))).toMatch(
      /^東京駅（.+，往东约\d+米）离这儿很近。$/,
    );
    expect(templateReply(profile, s, t("talk.quick.weather"))).toBe(
      "现在是晴天，气温大约21度呢。开车要小心。",
    );
    expect(templateReply(profile, s, t("talk.quick.ward"))).toBe("这里是千代田区丸の内二丁目哦。");
  });

  it("tells Gemma the reply's language in English and Chinese, and leaves the Japanese prompt as it was", () => {
    const jaPrompt = personaPrompt(profile, s);
    expect(jaPrompt).toContain("日本語の話し言葉で1〜2文、全体で60文字以内で答えてください。");
    expect(jaPrompt).toContain("英語やアルファベット、数字の羅列は避けてください。");
    expect(jaPrompt).not.toMatch(/Reply in English|简体中文/);
    inLocale("en");
    const enPrompt = personaPrompt(profile, s);
    expect(enPrompt.split("\n").at(-1)).toMatch(/^Reply in English only/);
    expect(enPrompt).not.toContain("英語やアルファベット");
    expect(enPrompt).toContain("政治・宗教・思想");
    inLocale("zh");
    expect(personaPrompt(profile, s).split("\n").at(-1)).toMatch(/^请只用简体中文回答/);
  });

  it("holds model replies to the same topics in English and Chinese", () => {
    expect(isBlocked("選挙に行こう")).toBe(true);
    inLocale("en");
    expect(isBlocked("Go vote in the election!")).toBe(true);
    expect(isBlocked("The station is to the east.")).toBe(false);
    inLocale("zh");
    expect(isBlocked("我们来聊聊宗教吧")).toBe(true);
  });
});

describe("119・110 の模擬通報", () => {
  it("lets the operator speak the player's language, with the Japanese original for the voice", () => {
    inLocale("en");
    const ask = scriptedOperator("119", "help", true);
    expect(ask).toEqual({
      text: "Where are you? Tell me the address or a landmark nearby.",
      ja: "場所はどこですか。住所か、近くの目印を教えてください。",
    });
    const none = scriptedOperator("110", "I'm near the station and there's been an accident", false);
    expect(none.text).toBe(
      "We have no report of an accident near there. For anything that isn't urgent, please call the police advice line, #9110.",
    );
    expect(none.ja).toBe(
      "その付近で事故の情報は確認できません。急ぎでない相談は、警察相談専用電話の「#9110」をご利用ください。",
    );
  });

  it("dispatches on the quick replies in English and Chinese as in Japanese", () => {
    for (const locale of ["ja", "en", "zh"] as const) {
      inLocale(locale);
      const where = t("call.location", { location: "千代田区丸の内二丁目" });
      const what = t(QUICK_REPLIES["119"][2]?.key ?? "call.quick.hitPedestrian");
      expect(hasEnoughInfo(`${what} ${where}`), locale).toBe(true);
      expect(hasEnoughInfo(what), locale).toBe(false);
    }
  });

  it("tells the operator model the reply's language only outside Japanese", () => {
    expect(operatorPrompt("110", "千代田区")).toContain("日本語で1〜2文、50文字以内で");
    inLocale("en");
    const prompt = operatorPrompt("110", "千代田区");
    expect(prompt).not.toContain("日本語で");
    expect(prompt.split("\n").at(-1)).toBe("Reply in English only, in one or two short sentences.");
  });
});

describe("出典・ライセンス", () => {
  const sources = [
    {
      id: "a",
      title: "文化財一覧",
      publisher: "東京都教育庁",
      license: "クリエイティブ・コモンズ・ライセンス 表示4.0国際",
      url: "https://example.test/a",
    },
    {
      id: "odpt-bus",
      title: "都営バス時刻表",
      publisher: "東京都交通局",
      license: "CC BY 4.0",
      url: "https://example.test/b",
    },
  ];
  const regs = {
    targetMonth: "2026年08月",
    releaseDay: "2026年10月01日",
    fetchedAt: "2026-10-04T05:16:30Z",
    url: "https://www.jartic.or.jp/service/opendata/",
  };
  const render = async (locale: Locale) => {
    inLocale(locale);
    vi.stubGlobal("location", { href: "https://example.test/game/" });
    const { renderCredits } = await import("../src/game/credits");
    return renderCredits(sources, regs)
      .replace(/<a [^>]*>([^<]*)<\/a>/g, "$1")
      .replace(/\s+/g, " ");
  };
  // The wording the providers prescribe, which every language keeps.
  const REQUIRED = [
    "このゲームは、以下の著作物を改変（緯度経度・名称の抽出および形式変換）して利用しています。",
    "文化財一覧、東京都・教育庁、クリエイティブ・コモンズ・ライセンス 表示4.0国際",
    "出典：国土交通省 PLATEAUウェブサイト「3D都市モデル（Project PLATEAU）東京都」",
    "出典：国土地理院「地理院タイル」",
    "出典 国土地理院ベクトルタイル提供実験",
    "出典：「交通規制情報」（公益財団法人日本道路交通情報センター）（https://www.jartic.or.jp/service/opendata/）（2026年10月4日に利用）を加工して作成。",
    "© OpenStreetMap contributors",
    "出典：政府統計の総合窓口（e-Stat）「国勢調査 令和2年 小地域（町丁・字等別）境界データ 東京都」を加工して作成",
    "東京都交通局・公共交通オープンデータ協議会",
    "本ゲームが利用する公共交通データは、公共交通オープンデータセンターにおいて提供されるものです。",
    "出典：気象庁ホームページのアメダス観測データ（東京）を加工して作成。",
    "編集・加工の責任は本ゲーム作者にあります。",
    "つくよみちゃんコーパス",
    "人を批判・攻撃すること。",
  ];

  it("keeps each provider's required Japanese wording in every language", async () => {
    for (const locale of ["ja", "en", "zh"] as const) {
      const html = await render(locale);
      for (const words of REQUIRED) expect(html, `${locale}: ${words}`).toContain(words);
    }
  });

  it("adds the translation after the required wording, and translates the rest", async () => {
    const english = await render("en");
    expect(english).toContain("(used on October 4, 2026), processed by the game.");
    expect(english).toContain("<h3>Traffic regulations");
    expect(english).toContain("the data as of August 2026 (published October 1, 2026)");
    expect(english).not.toContain("<h3>交通規制");
    const chinese = await render("zh");
    expect(chinese).toContain("<h3>交通管制");
    expect(chinese).toContain("2026年10月4日使用");
    const japanese = await render("ja");
    expect(japanese).not.toContain('lang="ja"');
    expect(japanese).toContain("<h3>交通規制（一方通行・規制速度・横断歩道・停止線・一時停止）</h3>");
  });
});

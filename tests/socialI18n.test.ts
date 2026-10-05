import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n";
import { SOCIAL_JA, SOCIAL_MESSAGES, st, stCount } from "../src/i18n/socialMessages";
import {
  followLocale,
  formatCount,
  joinedLabel,
  originalOf,
  postTimestamp,
  relativeTime,
  renderPhrase,
  slotsOf,
  SocialFeed,
  tagIn,
  timeWord,
  wordIn,
  type SocialWorld,
} from "../src/game/social";
import { accountFor, FOLLOWED_LIST, PLAYER_ACCOUNT } from "../src/game/socialAccounts";
import {
  ANSWERS,
  CHATTER,
  CHATTER_ANSWERS,
  CHATTER_REPLIES,
  DASHCAM_LEADS,
  KIND_WORDS,
  languageOf,
  MEDIA_WORDS,
  NEWS_QUOTE,
  OPENERS,
  QUOTES,
  REPLIES,
  SOURCE_TAGS,
  TAGS,
  textIn,
  TRANSLATIONS,
  WARD_NAMES,
  WORDS,
  type LineLike,
} from "../src/game/socialTexts";
import { VIOLATIONS, type ViolationKind, type ViolationRecord } from "../src/game/traffic";
import { BANNED, BANNED_ABROAD } from "./socialBanned";

const textOf = (l: LineLike) => (typeof l === "string" ? l : l.text);
const slotSet = (s: string) => [...new Set(slotsOf(s))].toSorted();
const KANA = /[\p{sc=Hiragana}\p{sc=Katakana}]/u;
const LANGS = ["en", "zh"] as const;
const POOL = Array.from({ length: 4000 }, (_, i) => accountFor(i, 0));
const ACCOUNTS = [...POOL, ...FOLLOWED_LIST, PLAYER_ACCOUNT];
const isVisitor = (persona: string | undefined) => persona === "touristEn" || persona === "touristZh";

const NON_ASCII = /[^\t\n -~]/;
const lines = (table: Record<string, readonly LineLike[]>) =>
  Object.values(table).flatMap((ls) => ls.map(textOf));

/** Every Japanese text Y writes by itself (the visitors' own words are not among them). */
function japaneseSources(): string[] {
  const bios = ACCOUNTS.filter((a) => !isVisitor(a.persona) && NON_ASCII.test(a.bio)).map((a) => a.bio);
  const places = ACCOUNTS.map((a) => a.location).filter((p) => p && NON_ASCII.test(p) && !WARD_NAMES[p]);
  const all = [
    ...lines(OPENERS),
    ...Object.values(TAGS).flat(),
    ...Object.values(SOURCE_TAGS),
    ...lines(REPLIES),
    ...lines(QUOTES),
    ...lines(ANSWERS),
    NEWS_QUOTE,
    ...Object.values(MEDIA_WORDS),
    ...DASHCAM_LEADS,
    ...CHATTER.flatMap((t) => [t.text, ...(t.replies ?? [])]),
    ...Object.values(CHATTER_REPLIES).flat(),
    ...CHATTER_ANSWERS.ja,
    ...CHATTER_ANSWERS.careful,
    ...Object.values(WORDS).flatMap((ws) => ws.map((w) => w.text)),
    ...bios,
    ...places,
  ];
  return [...new Set(all)].filter((s) => languageOf(s) === "ja");
}

const record = (kind: ViolationKind, place = "港区 芝公園四丁目 （芝公園交差点付近）"): ViolationRecord => ({
  ...(kind === "speed"
    ? { kind, label: "速度超過（25km/h超過）", article: "道路交通法 第22条", points: 3, fine: 18000 }
    : VIOLATIONS[kind]),
  at: 0,
  status: "uncaught",
  context: {
    clock: "10/5(月) 9:30",
    place,
    lat: 35.656,
    lon: 139.748,
    kmh: 65,
    limit: 40,
    limitKind: "sign",
  },
});

const world = (more: Partial<SocialWorld> = {}): SocialWorld => ({
  ward: "渋谷区",
  town: "神南一丁目",
  nearWards: ["港区", "新宿区"],
  lat: 35.664,
  lon: 139.698,
  raining: false,
  tempC: 19,
  landmarks: [{ name: "東京タワー", km: 4.5 }],
  parks: ["代々木公園"],
  river: "渋谷川",
  bridge: "稲荷橋",
  signs: [{ ja: "新宿", en: "Shinjuku" }],
  buses: 1,
  jammed: false,
  ...more,
});

/** A feed with posts about the player (with their replies and quotes) and a day of everyday posts. */
function busyFeed(): SocialFeed {
  const feed = new SocialFeed();
  feed.world = () => world();
  const t0 = Date.UTC(2026, 9, 5, 0); // 9:00 JST
  for (const kind of ["signal", "hitAndRun", "pedestrianCrossing", "stopSign", "speed"] as const)
    for (let i = 0; i < 8; i++) feed.maybePost(record(kind), 6, t0);
  for (let m = 0; m <= 12 * 60; m += 1) feed.update(t0 + m * 60_000);
  return feed;
}

afterEach(() => setLocale("ja"));

describe("Y in English and Chinese: the translation tables", () => {
  it("translates every Japanese text Y writes, keeping its {slots}", () => {
    const sources = japaneseSources();
    expect(sources.length).toBeGreaterThan(1000);
    for (const lang of LANGS)
      for (const source of sources) {
        const translated = TRANSLATIONS[lang][source];
        expect(translated, `${lang}: ${source}`).toBeTruthy();
        expect(slotSet(translated ?? ""), `${lang}: ${source}`).toEqual(slotSet(source));
      }
  });

  it("has no translation of a text that no longer exists, and no kana left in one", () => {
    const sources = new Set([...japaneseSources(), ...ACCOUNTS.map((a) => a.location).filter(Boolean)]);
    for (const lang of LANGS)
      for (const [source, translated] of Object.entries(TRANSLATIONS[lang])) {
        expect(sources.has(source), `${lang} key: ${source}`).toBe(true);
        expect(translated, `${lang}: ${source}`).not.toMatch(KANA);
      }
  });

  it("leaves the visitors' own posts and answers as they wrote them", () => {
    const visitors = CHATTER.filter((t) => t.who === "touristEn" || t.who === "touristZh");
    expect(visitors.length).toBeGreaterThan(10);
    for (const t of visitors) {
      const own = t.who === "touristEn" ? "en" : "zh";
      expect(languageOf(t.text)).toBe(own);
      for (const lang of ["ja", "en", "zh"] as const)
        expect(textIn(t.text, lang)).toEqual({ text: t.text, lang: own });
    }
    for (const text of CHATTER_ANSWERS.en) expect(languageOf(text)).toBe("en");
    for (const text of CHATTER_ANSWERS.zh) expect(languageOf(text)).toBe("zh");
    // A Japanese reply to a visitor is Japanese (and translated).
    expect(languageOf("楽しんでね！")).toBe("ja");
  });

  it("writes hashtags as tags: one word, no spaces, ASCII letters in English, never twice on one post", () => {
    const tags = [...Object.values(TAGS).flat(), ...Object.values(SOURCE_TAGS)];
    for (const tag of tags) {
      expect(TRANSLATIONS.en[tag], tag).toMatch(/^#[A-Za-z0-9]+$/);
      expect(TRANSLATIONS.zh[tag], tag).toMatch(/^#[\p{L}\p{N}_]+$/u);
    }
    for (const lang of LANGS)
      for (const own of Object.values(TAGS)) {
        const shown = own.map((t) => tagIn(t, lang));
        expect(new Set(shown).size, shown.join(" ")).toBe(shown.length);
      }
    for (const ward of Object.keys(WARD_NAMES).filter((w) => w.endsWith("区"))) {
      expect(tagIn(`#${ward}`, "en")).toMatch(/^#[A-Za-z]+$/);
      expect(tagIn(`#${ward}`, "zh")).toMatch(/^#[\p{L}]+区$/u);
    }
  });

  it("names no real service, brand, operator or politics in any translation", () => {
    for (const lang of LANGS)
      for (const translated of Object.values(TRANSLATIONS[lang]))
        for (const word of [...BANNED, ...BANNED_ABROAD]) expect(translated).not.toMatch(word);
    for (const names of Object.values(KIND_WORDS))
      for (const word of [...BANNED, ...BANNED_ABROAD]) expect(`${names.en} ${names.zh}`).not.toMatch(word);
  });
});

describe("Y in English and Chinese: slot words", () => {
  it("names wards, landmarks, signs and times in the language of the text", () => {
    expect(wordIn({ ja: "渋谷区", ...WARD_NAMES.渋谷区 }, "en")).toBe("Shibuya");
    expect(wordIn({ ja: "渋谷区", ...WARD_NAMES.渋谷区 }, "zh")).toBe("涩谷区");
    expect(wordIn("コンパクトカー", "en")).toBe("compact car");
    expect(wordIn("代々木公園", "en")).toBe("代々木公園");
    expect(timeWord(11, 35)).toEqual({ ja: "11時半ごろ", en: "around 11:30am", zh: "11点半左右" });
    expect(timeWord(23, 50)).toEqual({ ja: "0時前", en: "just before midnight", zh: "快0点的时候" });
    expect(timeWord(12, 5)).toMatchObject({ ja: "12時ごろ", en: "around noon" });
    expect(timeWord(15, 0).en).toBe("around 3pm");
  });

  it("puts the place of a post in each language: the ward translated, the town as written", () => {
    const feed = new SocialFeed();
    let post = null;
    for (let i = 0; i < 40 && !post; i++) post = feed.maybePost(record("signal"), 6, 0);
    if (!post) throw new Error("nobody posted");
    const place = post.phrase.slots.place;
    expect(wordIn(place, "ja")).toBe("港区芝公園四丁目");
    expect(wordIn(place, "en")).toBe("芝公園四丁目, Minato");
    expect(wordIn(place, "zh")).toBe("港区芝公園四丁目");
    expect(post.tagsJa).toContain("#港区");
    feed.setLang("en");
    expect(post.tags).toContain("#Minato");
  });
});

describe("Y in English and Chinese: what the app shows", () => {
  it("formats counts per language (cut, not rounded)", () => {
    expect(formatCount(3456, "en")).toBe("3,456");
    expect(formatCount(12345, "en")).toBe("12.3K");
    expect(formatCount(99999, "en")).toBe("99.9K");
    expect(formatCount(123456, "en")).toBe("123K");
    expect(formatCount(1234567, "en")).toBe("1.2M");
    expect(formatCount(1_000_000, "en")).toBe("1M");
    expect(formatCount(2_345_678_901, "en")).toBe("2.3B");
    expect(formatCount(12345, "zh")).toBe("1.2万");
    expect(formatCount(1234567, "zh")).toBe("123万");
    expect(formatCount(123456789, "zh")).toBe("1.2亿");
    expect(formatCount(123456789, "ja")).toBe("1.2億");
  });

  it("shows a post's age per language", () => {
    const now = Date.UTC(2026, 9, 5, 2, 30); // 2026-10-05 11:30 JST
    expect(relativeTime(now - 30_000, now, "en")).toBe("now");
    expect(relativeTime(now - 5 * 60_000, now, "en")).toBe("5m");
    expect(relativeTime(now - 2 * 3_600_000, now, "en")).toBe("2h");
    expect(relativeTime(now - 2 * 86_400_000, now, "en")).toBe("Oct 3");
    expect(relativeTime(Date.UTC(2025, 11, 30, 23), now, "en")).toBe("Dec 31, 2025");
    expect(relativeTime(now - 30_000, now, "zh")).toBe("刚刚");
    expect(relativeTime(now - 5 * 60_000, now, "zh")).toBe("5分钟");
    expect(relativeTime(now - 2 * 3_600_000, now, "zh")).toBe("2小时");
    expect(relativeTime(now - 2 * 86_400_000, now, "zh")).toBe("10月3日");
    expect(relativeTime(now - 5 * 60_000, now, "ja")).toBe("5分");
  });

  it("shows an opened post's time and a profile's join date per language", () => {
    expect(postTimestamp(Date.UTC(2026, 9, 5, 2, 30), "en")).toBe("11:30 AM · Oct 5, 2026");
    expect(postTimestamp(Date.UTC(2026, 9, 5, 3, 5), "en")).toBe("12:05 PM · Oct 5, 2026");
    expect(postTimestamp(Date.UTC(2026, 9, 5, 14, 15), "zh")).toBe("下午11:15 · 2026年10月5日");
    expect(postTimestamp(Date.UTC(2026, 9, 5, 3, 5), "ja")).toBe("午後0:05 · 2026年10月5日");
    const me = { ...PLAYER_ACCOUNT, joined: { year: 2024, month: 4 } };
    expect(joinedLabel(me, "ja")).toBe("2024年4月からYを利用しています");
    expect(joinedLabel(me, "en")).toBe("Joined Y in April 2024");
    expect(joinedLabel(me, "zh")).toBe("2024年4月加入 Y");
  });

  it("has every screen string in English and Chinese, with the same slots", () => {
    for (const key of Object.keys(SOCIAL_JA) as (keyof typeof SOCIAL_JA)[])
      for (const lang of LANGS) {
        const text = SOCIAL_MESSAGES[lang][key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        expect(slotSet(text), `${lang} ${key}`).toEqual(slotSet(SOCIAL_JA[key]));
        expect(text, `${lang} ${key}`).not.toMatch(KANA);
      }
    expect(stCount("count.reposts", 1, undefined, "en")).toBe("Repost");
    expect(stCount("count.reposts", 2, undefined, "en")).toBe("Reposts");
    expect(stCount("count.reposts", 1, undefined, "zh")).toBe("次转发");
    expect(st("notes.follow", { name: "ゆうき🚗" }, "en")).toBe("ゆうき🚗 followed you");
  });
});

describe("Y in English and Chinese: the feed follows the UI's language", () => {
  it("writes every post, reply, quote, everyday post and tag again when the language changes", () => {
    const feed = busyFeed();
    const stop = followLocale(feed);
    const replies = feed.posts.flatMap((p) => [...p.replies, ...p.quotePosts]);
    const chatterReplies = feed.chatter.flatMap((c) => c.replies);
    expect(feed.posts.length).toBeGreaterThan(5);
    expect(replies.length).toBeGreaterThan(20);
    expect(feed.chatter.length).toBeGreaterThan(20);
    expect(chatterReplies.length).toBeGreaterThan(5);
    const before = {
      posts: feed.posts.map((p) => [p.text, ...p.tags]),
      chatter: feed.chatter.map((c) => c.text),
    };
    const texts = () => [
      ...feed.posts.flatMap((p) => [
        p.text,
        ...p.replies.map((r) => r.text),
        ...p.quotePosts.map((q) => q.text),
      ]),
      ...feed.chatter.flatMap((c) => [c.text, ...c.replies.map((r) => r.text)]),
    ];
    // Japanese that may stay in English: the town, park, river and bridge names (no romanised data).
    const asWritten = /芝公園四丁目|神南|代々木公園|渋谷川|稲荷橋/g;

    setLocale("en");
    expect(feed.lang).toBe("en");
    for (const p of feed.posts) {
      expect(p.text).toBe(renderPhrase(p.phrase, "en"));
      for (const tag of p.tags) expect(tag).toMatch(/^#[A-Za-z0-9]+$/);
    }
    for (const text of texts()) expect(text.replace(asWritten, ""), text).not.toMatch(KANA);
    expect(feed.posts.some((p) => originalOf(p) !== null)).toBe(true);

    setLocale("zh");
    expect(feed.lang).toBe("zh");
    for (const text of texts()) expect(text.replace(asWritten, ""), text).not.toMatch(KANA);
    for (const p of feed.posts) for (const tag of p.tags) expect(tag).toMatch(/^#[\p{L}\p{N}_]+$/u);

    setLocale("ja");
    expect(feed.posts.map((p) => [p.text, ...p.tags])).toEqual(before.posts);
    expect(feed.chatter.map((c) => c.text)).toEqual(before.chatter);
    for (const p of feed.posts) expect(originalOf(p)).toBeNull();
    stop();
  });

  it("calls the view back after rewriting, and stops when unsubscribed", () => {
    const feed = new SocialFeed();
    const seen: string[] = [];
    const stop = followLocale(feed, (lang) => seen.push(`${lang}:${feed.lang}`));
    setLocale("zh");
    setLocale("en");
    stop();
    setLocale("ja");
    expect(seen).toEqual(["zh:zh", "en:en"]);
    expect(feed.lang).toBe("en");
  });

  it("keeps a visitor's post as written in every language, with the ward in its own language", () => {
    const feed = busyFeed();
    const visitors = () =>
      feed.chatter.filter((c) => c.account.persona === "touristEn" || c.account.persona === "touristZh");
    expect(visitors().length).toBeGreaterThan(0);
    const before = visitors().map((c) => c.text);
    for (const lang of ["en", "zh", "ja"] as const) {
      feed.setLang(lang);
      expect(visitors().map((c) => c.text)).toEqual(before);
      for (const c of visitors()) expect(originalOf(c)).toBeNull();
    }
    const zhPost = {
      parts: ["在{ward}过马路，车主动停下来让我先走，好感动"],
      slots: { ward: { ja: "渋谷区", ...WARD_NAMES.渋谷区 } },
    };
    expect(renderPhrase(zhPost, "en")).toBe("在涩谷区过马路，车主动停下来让我先走，好感动");
  });

  it("shows the on-device AI's Japanese in Japanese only, and the template's translation elsewhere", async () => {
    const feed = new SocialFeed();
    feed.writer = async (role) => (role === "post" ? "目の前で信号無視の車が突っ込んできた…怖すぎる" : null);
    let post = null;
    for (let i = 0; i < 20 && !post; i++) post = feed.maybePost(record("signal"), 6, 0);
    if (!post) throw new Error("nobody posted");
    await new Promise((r) => setTimeout(r, 0));
    expect(post.text).toBe("目の前で信号無視の車が突っ込んできた…怖すぎる");
    feed.setLang("en");
    expect(post.text).toBe(renderPhrase(post.phrase, "en"));
    expect(originalOf(post)).toBe("目の前で信号無視の車が突っ込んできた…怖すぎる");
    feed.setLang("ja");
    expect(post.text).toBe("目の前で信号無視の車が突っ込んできた…怖すぎる");
  });

  it("writes the news account's quote in each language", () => {
    const feed = new SocialFeed();
    let post = null;
    for (let i = 0; i < 40 && !post; i++) post = feed.maybePost(record("hitAndRun"), 6, 0);
    feed.update(60 * 60_000);
    const news = post?.quotePosts.find((q) => q.account.isVouched);
    if (!news) throw new Error("no news quote");
    // Japanese keeps the record's own label (救護義務違反（ひき逃げ）, without the brackets).
    expect(news.text).toContain("「救護義務違反」");
    feed.setLang("en");
    expect(news.text).toMatch(
      /^\[Trending\] A (video|photo) of a car at 芝公園四丁目, Minato \(hit-and-run\)/,
    );
    feed.setLang("zh");
    expect(news.text).toContain("在港区芝公園四丁目拍到的“肇事逃逸”车辆");
  });
});

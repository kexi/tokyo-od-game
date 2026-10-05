import type { Category, Poi } from "../data/schema";
import { haversineMeters } from "../geo/ellipsoid";
import { getLocale, t, type Locale, type MessageKey } from "../i18n";
import { inJapanese, matchJapanese, translateWord } from "../i18n/reverse";
import { wardInEnglish } from "../i18n/wards";
import type { PedestrianProfile } from "../world/pedestrians";

/** What the passer-by knows around them; the words (ward, weather…) are Japanese, as main.ts gives them. */
export type Surroundings = {
  ward: string;
  town: string;
  timeLabel: string;
  clock: string;
  weather: string;
  nearbyPois: Poi[];
  categories: Category[];
  lat: number;
  lon: number;
  busLine: string | null;
};

/**
 * A line in the language in force (`text`, shown) and in Japanese (`ja`, what the Japanese voice
 * says: the pedestrians are Tokyo people and sanoTTS-jp speaks Japanese only).
 */
export type Line = { text: string; ja: string };
type Value = string | number | Line;

const valueIn = (v: Value, isJapanese: boolean) => (typeof v === "object" ? (isJapanese ? v.ja : v.text) : v);

/** A key in both languages, each slot filled with its value in that language. */
function line(key: MessageKey, params: Record<string, Value> = {}): Line {
  const entries = Object.entries(params);
  const local = Object.fromEntries(entries.map(([k, v]) => [k, valueIn(v, false)]));
  const japanese = Object.fromEntries(entries.map(([k, v]) => [k, valueIn(v, true)]));
  return { text: t(key, local), ja: inJapanese(key, japanese) };
}

// Sentences run together in Japanese and Chinese; English puts a space between them.
const SENTENCE_SEP: Record<Locale, string> = { ja: "", en: " ", zh: "" };
const joinLines = (...lines: Line[]): Line => ({
  text: lines.map((l) => l.text).join(SENTENCE_SEP[getLocale()]),
  ja: lines.map((l) => l.ja).join(""),
});

const DIRECTION_KEYS: readonly MessageKey[] = [
  "talk.dir.0",
  "talk.dir.1",
  "talk.dir.2",
  "talk.dir.3",
  "talk.dir.4",
  "talk.dir.5",
  "talk.dir.6",
  "talk.dir.7",
];

/** 0 north, 1 north-east … 7 north-west: the eight-way direction from one point to another. */
function bearingIndex(lat: number, lon: number, toLat: number, toLon: number): number {
  const dy = toLat - lat;
  const dx = (toLon - lon) * Math.cos((lat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return Math.round(deg / 45) % 8;
}

/** 北 / north / 北 …: the direction in the language in force. */
export function bearingLabel(lat: number, lon: number, toLat: number, toLon: number): string {
  return t(DIRECTION_KEYS[bearingIndex(lat, lon, toLat, toLon)] ?? "talk.dir.0");
}

function describePoi(s: Surroundings, p: Poi): Line {
  const d = Math.round(haversineMeters(s.lat, s.lon, p.lat, p.lon) / 10) * 10;
  const category = s.categories.find((c) => c.id === p.category)?.label ?? "";
  return line("talk.poi", {
    name: p.name,
    // The categories' Japanese labels come from the data; the mission keys hold their translations.
    category: { ja: category, text: translateWord(category, "mission.category.") },
    dir: line(DIRECTION_KEYS[bearingIndex(s.lat, s.lon, p.lat, p.lon)] ?? "talk.dir.0"),
    d,
  });
}

function closest(s: Surroundings, n: number): Poi[] {
  return s.nearbyPois
    .toSorted(
      (a, b) => haversineMeters(s.lat, s.lon, a.lat, a.lon) - haversineMeters(s.lat, s.lon, b.lat, b.lon),
    )
    .slice(0, n);
}

/**
 * System prompt for Gemma: a local passer-by grounded in real open data around the player.
 * The restrictions mirror the sanoTTS-jp voice licence (§3.2) because replies are spoken aloud.
 *
 * In English and Chinese the persona stays in Japanese (the model reads it well and the facts are
 * Japanese names), the reply's language and length go last in that language, where a small model
 * heeds them most, and the Japanese voice's rule against Latin letters is dropped: the voice does
 * not read a reply in another language.
 */
export function personaPrompt(profile: PedestrianProfile, s: Surroundings): string {
  const isJapanese = getLocale() === "ja";
  const spots = closest(s, 6)
    .map((p) => `- ${describePoi(s, p).ja}`)
    .join("\n");
  const answer = isJapanese
    ? "車に乗ったプレイヤーが窓越しに話しかけてきました。ゲームの登場人物として、日本語の話し言葉で1〜2文、全体で60文字以内で答えてください。"
    : "車に乗ったプレイヤーが窓越しに話しかけてきました。ゲームの登場人物として、短く答えてください。";
  const safety = isJapanese
    ? "人を批判・攻撃すること、政治・宗教・思想への賛否を呼びかけること、刺激の強い表現は絶対にしないでください。英語やアルファベット、数字の羅列は避けてください。"
    : "人を批判・攻撃すること、政治・宗教・思想への賛否を呼びかけること、刺激の強い表現は絶対にしないでください。";
  const lines = [
    `あなたは東京都${s.ward}${s.town}の路上にいる通行人「${profile.name}」（${profile.age}・${profile.role}・性格: ${profile.mood}）です。`,
    answer,
    `今は${s.timeLabel}（${s.clock}頃）、天気は${s.weather}です。${s.busLine ? `近くを都営バス「${s.busLine}」が走っています。` : ""}`,
    "近くの実在スポット（東京都のオープンデータより。方角と距離は正確です）:",
    spots || "- （近くに登録スポットはありません）",
    "道案内を頼まれたら上の情報の方角と距離を使ってください。知らないことは知らないと言い、作り話をしないでください。",
    safety,
  ];
  if (!isJapanese) lines.push(t("talk.replyLanguage"));
  return lines.join("\n");
}

const GREETINGS: readonly MessageKey[] = [
  "talk.greeting.1",
  "talk.greeting.2",
  "talk.greeting.3",
  "talk.greeting.4",
];
const THANKS: readonly MessageKey[] = ["talk.thanks.1", "talk.thanks.2", "talk.thanks.3"];

// What the player asks, in Japanese, English or Chinese (the quick questions are in the language
// in force, and people type in theirs).
const ASKS_SPOT =
  /(おすすめ|オススメ|近く|どこ|行き|観光|見どころ|名所|スポット|recommend|worth seeing|sightsee|things to do|around here|nearby|places? to|推荐|景点|好玩|观光|值得|去哪)/i;
// Chinese words that Japanese also writes (冷 in 冷たい) are left out, so Japanese reads as before.
const ASKS_WEATHER =
  /(天気|雨|晴|暑|寒|気温|weather|rain|sunny|hot|cold|temperature|天气|下雨|热|冷吗|很冷|好冷|气温)/i;
const ASKS_PLACE =
  /(ここ|今いる|何区|住所|場所|what ward|which ward|where am i|where are we|this place|address|这里|哪个区|什么区|地址|我在哪)/i;
const ASKS_TRANSPORT =
  /(バス|電車|駅|交通|bus|train|station|subway|metro|transport|公交|巴士|电车|车站|地铁|交通)/i;
const SAYS_THANKS = /(ありがと|サンキュー|助か|thank|thx|appreciate|谢谢|多谢|感谢)/i;

const skyLine = (ja: string): Line => ({ ja, text: translateWord(ja, "talk.sky.") });

/** The sky words main.ts gives (晴れ / 雨 / くもり, or 「晴れで、気温は21度くらい」) as a line. */
function weatherLine(weather: string): Line {
  const withTemp = matchJapanese(weather, "talk.weather.withTemp");
  if (!withTemp) return skyLine(weather);
  return line("talk.weather.withTemp", { sky: skyLine(String(withTemp.sky)), temp: String(withTemp.temp) });
}

/** The ward in English for English replies (its kanji otherwise); towns stay as e-Stat names them. */
function wardLine(ward: string): Line {
  const isEnglish = getLocale() === "en";
  return { ja: ward, text: isEnglish ? (wardInEnglish(ward) ?? ward) : ward };
}

/**
 * Rule-based reply used when Gemma is not available (no WebGPU / not downloaded), in the language
 * in force and in Japanese for the voice.
 */
export function templateLine(profile: PedestrianProfile, s: Surroundings, text: string): Line {
  const choose = (keys: readonly MessageKey[]) =>
    line(keys[(profile.id + text.length) % keys.length] ?? keys[0]);
  const near = closest(s, 3);
  if (SAYS_THANKS.test(text)) return choose(THANKS);
  // Transport first: "駅はどこ？" also matches the generic "どこ" of spot questions.
  if (ASKS_TRANSPORT.test(text)) {
    const station = closest({ ...s, nearbyPois: s.nearbyPois.filter((p) => p.category === "station") }, 1)[0];
    if (station) return line("talk.reply.station", { poi: describePoi(s, station) });
    return s.busLine ? line("talk.reply.bus", { line: s.busLine }) : line("talk.reply.noStation");
  }
  const first = near[0];
  if (ASKS_SPOT.test(text) && first) {
    const spot = line("talk.reply.spot", { poi: describePoi(s, first) });
    const second = near[1];
    return second ? joinLines(spot, line("talk.reply.spotAlso", { name: second.name })) : spot;
  }
  if (ASKS_WEATHER.test(text)) return line("talk.reply.weather", { weather: weatherLine(s.weather) });
  if (ASKS_PLACE.test(text)) {
    const ward = wardLine(s.ward);
    return s.town ? line("talk.reply.place", { ward, town: s.town }) : line("talk.reply.placeWard", { ward });
  }
  const isAskingVisit = first !== undefined && profile.id % 2 === 0;
  if (isAskingVisit) return joinLines(choose(GREETINGS), line("talk.reply.visited", { name: first.name }));
  return choose(GREETINGS);
}

/** The reply as shown (the language in force). */
export function templateReply(profile: PedestrianProfile, s: Surroundings, text: string): string {
  return templateLine(profile, s, text).text;
}

/** The greeting asked of templateLine when a conversation opens: the same pedestrian greets alike in every language. */
export const OPENING_WORDS = "こんにちは";

/** The quick questions' keys, shown and sent in the language in force. */
export const QUICK_QUESTIONS: readonly MessageKey[] = [
  "talk.quick.spots",
  "talk.quick.ward",
  "talk.quick.weather",
  "talk.quick.station",
];

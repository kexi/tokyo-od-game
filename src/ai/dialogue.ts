import type { Category, Poi } from "../data/schema";
import { haversineMeters } from "../geo/ellipsoid";
import type { PedestrianProfile } from "../world/pedestrians";

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

const DIRECTIONS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

export function bearingLabel(lat: number, lon: number, toLat: number, toLon: number): string {
  const dy = toLat - lat;
  const dx = (toLon - lon) * Math.cos((lat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return DIRECTIONS[Math.round(deg / 45) % 8];
}

function describePoi(s: Surroundings, p: Poi): string {
  const d = Math.round(haversineMeters(s.lat, s.lon, p.lat, p.lon) / 10) * 10;
  const cat = s.categories.find((c) => c.id === p.category)?.label ?? "";
  return `${p.name}（${cat}、${bearingLabel(s.lat, s.lon, p.lat, p.lon)}へ約${d}m）`;
}

function closest(s: Surroundings, n: number): Poi[] {
  return [...s.nearbyPois]
    .sort((a, b) => haversineMeters(s.lat, s.lon, a.lat, a.lon) - haversineMeters(s.lat, s.lon, b.lat, b.lon))
    .slice(0, n);
}

/**
 * System prompt for Gemma: a local passer-by grounded in real open data around the player.
 * The restrictions mirror the sanoTTS-jp voice licence (§3.2) because replies are spoken aloud.
 */
export function personaPrompt(profile: PedestrianProfile, s: Surroundings): string {
  const spots = closest(s, 6)
    .map((p) => `- ${describePoi(s, p)}`)
    .join("\n");
  return [
    `あなたは東京都${s.ward}${s.town}の路上にいる通行人「${profile.name}」（${profile.age}・${profile.role}・性格: ${profile.mood}）です。`,
    "車に乗ったプレイヤーが窓越しに話しかけてきました。ゲームの登場人物として、日本語の話し言葉で1〜2文、全体で60文字以内で答えてください。",
    `今は${s.timeLabel}（${s.clock}頃）、天気は${s.weather}です。${s.busLine ? `近くを都営バス「${s.busLine}」が走っています。` : ""}`,
    "近くの実在スポット（東京都のオープンデータより。方角と距離は正確です）:",
    spots || "- （近くに登録スポットはありません）",
    "道案内を頼まれたら上の情報の方角と距離を使ってください。知らないことは知らないと言い、作り話をしないでください。",
    "人を批判・攻撃すること、政治・宗教・思想への賛否を呼びかけること、刺激の強い表現は絶対にしないでください。英語やアルファベット、数字の羅列は避けてください。",
  ].join("\n");
}

const GREETINGS = [
  "こんにちは！いい車ですね。",
  "どうも、何かお困りですか？",
  "あ、こんにちは。道に迷いました？",
  "こんにちは、今日はどちらまで？",
];

/** Rule-based reply used when Gemma is not available (no WebGPU / not downloaded). */
export function templateReply(profile: PedestrianProfile, s: Surroundings, text: string): string {
  const pick = <T>(arr: T[]) => arr[(profile.id + text.length) % arr.length];
  const near = closest(s, 3);
  const isAskingSpot = /(おすすめ|オススメ|近く|どこ|行き|観光|見どころ|名所|スポット)/.test(text);
  const isAskingWeather = /(天気|雨|晴|暑|寒|気温)/.test(text);
  const isAskingPlace = /(ここ|今いる|何区|住所|場所)/.test(text);
  const isAskingBus = /(バス|電車|駅|交通)/.test(text);
  const isThanks = /(ありがと|サンキュー|助か)/.test(text);
  if (isThanks)
    return pick(["どういたしまして！安全運転でね。", "いえいえ、気をつけて！", "楽しんでくださいね。"]);
  // Transport first: "駅はどこ？" also matches the generic "どこ" of spot questions.
  if (isAskingBus) {
    const station = closest({ ...s, nearbyPois: s.nearbyPois.filter((p) => p.category === "station") }, 1)[0];
    if (station) return `${describePoi(s, station)}が近いですよ。`;
    return s.busLine
      ? `この辺りは都営バスの「${s.busLine}」が走っています。`
      : "このあたりは都営の駅が遠いかもしれません。";
  }
  if (isAskingSpot && near[0]) {
    return `この辺りなら${describePoi(s, near[0])}がおすすめですよ。${near[1] ? `${near[1].name}もいいですね。` : ""}`;
  }
  if (isAskingWeather) return `今は${s.weather}ですね。運転には気をつけてください。`;
  if (isAskingPlace) return `ここは${s.ward}${s.town}ですよ。`;
  if (near[0] && profile.id % 2 === 0) return `${pick(GREETINGS)}${near[0].name}にはもう行きました？`;
  return pick(GREETINGS);
}

export const QUICK_QUESTIONS = [
  "このあたりのおすすめは？",
  "ここは何区ですか？",
  "今日の天気は？",
  "近くの駅はどこ？",
];

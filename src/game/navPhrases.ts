import { getLocale, t, type MessageKey } from "../i18n";
import { spokenDistance } from "../i18n/format";
import { signEnglish } from "../world/guidePlan";
import type { Turn } from "./navigation";

/**
 * The navi's words in the language in force: the panel's turn words and junction names, and the
 * sentences the voice says. Japanese keeps the phrasing of Japanese car navigation word for word
 * (「およそ300メートル先、日比谷交差点を右方向です。」); English and Chinese use the phrasing of
 * their own navigation apps ("In 300 meters, turn right at Hibiya." / 「前方300米，在日比谷路口右转。」)
 * through whole-sentence templates, since the word order differs too much to assemble from parts.
 */

const TURN_KEY: Record<Turn, MessageKey> = {
  straight: "turn.straight",
  slightLeft: "turn.slightLeft",
  left: "turn.left",
  slightRight: "turn.slightRight",
  right: "turn.right",
  uturn: "turn.uturn",
};
const SAY_KEY: Record<Turn, MessageKey> = {
  straight: "turn.say.straight",
  slightLeft: "turn.say.slightLeft",
  left: "turn.say.left",
  slightRight: "turn.say.slightRight",
  right: "turn.say.right",
  uturn: "turn.say.uturn",
};

/** The turn on the panel: 右方向 / Turn right / 右转. */
export const turnWord = (turn: Turn): string => t(TURN_KEY[turn]);

/** The panel's second line: 日比谷交差点を右方向 / Turn right at Hibiya / 在日比谷路口右转. */
export function turnPhrase(turn: Turn, name: string | null): string {
  if (!name) return turnWord(turn);
  return t("nav.turnAt", { name, turn: turnWord(turn) });
}

/**
 * A junction's name as the panel shows it: 「日比谷交差点」; in English the OSM English name as the
 * guide signs print it ("Hibiya", "Shinjuku Sta.", signEnglish), or the Japanese name without
 * 交差点 when there is none; in Chinese the Japanese name with 路口 for 交差点 (Chinese readers read
 * the kanji; the voice reads them in Mandarin, as Chinese speakers name Japanese places).
 */
export function junctionName(ja: string, en = ""): string {
  const base = ja.endsWith("交差点") ? ja.slice(0, -"交差点".length) : ja;
  const isEnglishNamed = getLocale() === "en" && en.trim() !== "";
  const name = isEnglishNamed ? signEnglish(base, en) || base : base;
  return t("nav.junction", { name });
}

/**
 * The board abbreviations read out in full, so the English voice says "Station" and "West", not
 * "S-T-A" and "W" (signEnglish and the OSM names write "Shinjuku Sta.", "Sendagaya 3 -W.").
 */
const SPOKEN_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bSta\.(?=\s|$)/g, "Station"],
  [/\bAve\.(?=\s|$)/g, "Avenue"],
  [/\bBlvd\.(?=\s|$)/g, "Boulevard"],
  [/\bSt\.(?=\s|$)/g, "Street"],
  [/\bEnt\.(?=\s|$)/g, "Entrance"],
  [/\bBrdg\.(?=\s|$)/g, "Bridge"],
  [/\bSch\.(?=\s|$)/g, "School"],
  [/(?:\s-?|-)N\.?$/, " North"],
  [/(?:\s-?|-)E\.?$/, " East"],
  [/(?:\s-?|-)S\.?$/, " South"],
  [/(?:\s-?|-)W\.?$/, " West"],
];

/** A name as the voice should read it (English abbreviations spelt out; others as shown). */
export function spokenName(name: string): string {
  if (getLocale() !== "en") return name;
  return SPOKEN_WORDS.reduce((s, [re, word]) => s.replace(re, word), name).trim();
}

/** Sentences joined as each language writes them: back to back in Japanese and Chinese, a space in English. */
export function joinSpoken(parts: ReadonlyArray<string | null | undefined>): string {
  const separator = getLocale() === "en" ? " " : "";
  return parts.filter((p): p is string => !!p).join(separator);
}

/** English sentences that open with the turn ("turn right ahead.") start with a capital. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A turn call: at a distance (the 700/300/100 m calls; "およそ300メートル先、…です。") or, with
 * `distance` null, the last one close to it (「まもなく、…です。」 / "Turn right ahead." / 「即将右转。」).
 */
export function sayTurn(o: { turn: Turn; name: string | null; distance: number | null }): string {
  const turn = t(SAY_KEY[o.turn]);
  const name = o.name ? spokenName(o.name) : null;
  const isCall = o.distance !== null;
  if (isCall) {
    const dist = spokenDistance(o.distance ?? 0);
    return capitalise(
      name ? t("nav.say.turnIn", { dist, name, turn }) : t("nav.say.turnInPlain", { dist, turn }),
    );
  }
  return capitalise(name ? t("nav.say.turnSoon", { name, turn }) : t("nav.say.turnSoonPlain", { turn }));
}

/** 直進案内 at a named junction: 「この先、…を直進です。」, or 「まもなく、…」 once close. */
export function sayStraight(o: { name: string; soon: boolean }): string {
  return t(o.soon ? "nav.say.straightSoon" : "nav.say.straightAhead", { name: spokenName(o.name) });
}

/**
 * The lanes to take: with a call (「右側の車線を走行してください。」), or on its own when the car
 * goes straight on in a lane that must turn (「この先、…」). `lane` is laneAdvice()'s words.
 */
export function sayLane(lane: string, ahead = false): string {
  return t(ahead ? "nav.say.laneAhead" : "nav.say.lane", { lane });
}

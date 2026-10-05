import { warn } from "../log";
import { getLocale, type Locale } from "./index";

/**
 * Speech in the language in force (the navi, the TV's newsreader, the officer at the window):
 * the utterance's language and a voice that speaks it.
 */

/** speechSynthesis tags: voices are listed by language and region. Chinese is Mandarin, mainland. */
const SPEECH_LANG: Record<Locale, string> = { ja: "ja-JP", en: "en-US", zh: "zh-CN" };

/** Other regions to fall back on, best first; Mandarin before Cantonese (zh-HK) for Chinese. */
const FALLBACK_TAGS: Record<string, readonly string[]> = {
  "ja-jp": ["ja"],
  "en-us": ["en-gb", "en-au", "en-ca", "en"],
  "zh-cn": ["cmn-hans-cn", "cmn-cn", "zh-hans", "cmn", "zh-sg", "zh-tw", "cmn-hant-tw", "zh"],
};

export type VoiceLike = { lang: string };

export function speechLang(locale: Locale = getLocale()): string {
  return SPEECH_LANG[locale];
}

/** "en_US" (some Android voices) → "en-us". */
const normalise = (lang: string) => lang.trim().replace(/_/g, "-").toLowerCase();

/**
 * The voice for `lang`: the first with that exact tag, else one of the same language in the
 * next-best region (en-GB for en-US; zh-TW, still Mandarin, before any other Chinese), else null.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  const wanted = normalise(lang);
  const exact = voices.find((v) => normalise(v.lang) === wanted);
  if (exact) return exact;
  for (const tag of FALLBACK_TAGS[wanted] ?? []) {
    const near = voices.find((v) => normalise(v.lang) === tag || normalise(v.lang).startsWith(`${tag}-`));
    if (near) return near;
  }
  const primary = wanted.split("-")[0];
  return voices.find((v) => normalise(v.lang).split("-")[0] === primary) ?? null;
}

const reported = new Set<string>();

/**
 * An utterance of `text` in the language in force, with its voice; null without speechSynthesis,
 * or when the device lists its voices and none speaks the language.
 *
 * Why not speak anyway with the default voice: a Japanese voice reading English or Chinese is
 * hard to follow, and the panel shows the same words. While the list is still empty (it loads
 * after the page), the language alone is set and the browser picks.
 */
export function localUtterance(text: string, locale: Locale = getLocale()): SpeechSynthesisUtterance | null {
  const canSpeak = typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  if (!canSpeak) return null;
  const lang = speechLang(locale);
  const voices = speechSynthesis.getVoices();
  const voice = pickVoice(voices, lang);
  const isListedWithout = voices.length > 0 && voice === null;
  if (isListedWithout) {
    if (!reported.has(lang)) warn("speech_no_voice", { lang, voices: voices.length });
    reported.add(lang);
    return null;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  if (voice) u.voice = voice;
  return u;
}

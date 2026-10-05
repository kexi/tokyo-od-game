import { sunPosition } from "../geo/sun";
import { getLocale, onLocaleChange } from "../i18n";
import { MONTH_NAMES_EN, st } from "../i18n/socialMessages";
import { GAME_TIME_SCALE } from "../world/environment";
import type { HumanColors } from "../world/human";
import {
  ACCOUNT_POOL,
  accountFor,
  avatarFor,
  cameraFor,
  FOLLOWED,
  FOLLOWED_LIST,
  hashString,
  personaSeeds,
  PLAYER_ACCOUNT,
  witnessAccount,
  type FollowedKey,
  type Persona,
  type PictureMotif,
  type SocialAccount,
} from "./socialAccounts";
import { SOCIAL_APP_NAME } from "./socialTheme";
import {
  ACTIVE_HOURS,
  ANSWERS,
  CAREFUL_TOPICS,
  CHASE_FALLBACK,
  CHASE_OPENERS,
  CHASE_TAGS,
  STOP_FALLBACK,
  STOP_OPENERS,
  STOP_TAGS,
  CHATTER,
  CHATTER_ANSWERS,
  CHATTER_REPLIES,
  DASHCAM_LEADS,
  KIND_WORDS,
  LANDMARK_WORDS,
  MEDIA_WORDS,
  NEWS_IDENTIFIED,
  NEWS_QUOTE,
  OPENERS,
  QUOTES,
  REPLIES,
  REPLY_GROUP,
  SOURCE_TAGS,
  TAGS,
  textIn,
  TIME_WORDS,
  TIME_WORDS_IN,
  TRANSLATIONS,
  WARD_EN,
  WARD_NAMES,
  WEEKDAY_WORDS,
  WEEKDAY_WORDS_IN,
  WORDS,
  type ChatterTemplate,
  type ChatterVoice,
  type Cue,
  type HappeningKind,
  type Light,
  type Line,
  type LineLike,
  type Period,
  type PostMedia,
  type PraiseKind,
  type ReplyGroup,
  type Season,
  type SocialLang,
  type StopPhase,
} from "./socialTexts";
import type { ViolationKind, ViolationRecord } from "./traffic";

/**
 * Y (SOCIAL_APP_NAME, a fictional social app on the in-game phone): what happens when bystanders or a
 * dashcam film a violation. A post appears with the poster's own shot, hashtags and the place; over
 * game time it gathers reposts, quotes, likes and replies (やべー, こいつやべー, 通報しました …),
 * and once it spreads far enough the police trace the driver from the video, so a notice to
 * appear follows. Around those posts runs everyone else's everyday timeline (chatter), which
 * follows the game's world — the ward, the hour, the season, the weather, the landmarks in sight
 * and what just happened nearby — and the notifications the player gets. Nothing here imitates a
 * real service: names, handles and terms are generic. The words are in socialTexts.ts.
 *
 * Languages: every text keeps what it was made from (a Phrase: the source lines and the words
 * picked for its slots), and `text` is that phrase in the feed's language (`lang`), written again
 * by setLang when the player switches (followLocale wires it to the UI's language). People's
 * Japanese is shown translated, as if the app translated it; a visitor's English or Chinese stays
 * as they wrote it.
 */

/** A slot's word: the Japanese (the game's data), and its English and Chinese when known. */
export type SlotWord = string | { ja: string; en?: string; zh?: string };
/**
 * What a text was made from, so it can be written in any language: its source lines (Japanese,
 * or a visitor's own words) joined in order, and the word picked for each slot.
 */
export type Phrase = {
  parts: readonly string[];
  slots: Readonly<Record<string, SlotWord>>;
  /**
   * The on-device AI's words for it. Japanese (main.ts asks for 日本語), so they are shown in
   * Japanese only; the other languages show the template's translation.
   */
  written?: string;
};

export type SocialReply = {
  id: number;
  account: SocialAccount;
  /** account.name and account.handle (kept for older readers). */
  author: string;
  handle: string;
  /** `phrase` in the feed's language. */
  text: string;
  phrase: Phrase;
  /** Minutes after the post. */
  atMinute: number;
  /** Game time (epoch ms). */
  postedAt: number;
  /** Its share of the post's likes (they grow together). */
  weight: number;
  likes: number;
  /** The reply this answers (the poster answering someone); absent when it answers the post. */
  replyTo?: number;
};
export type SocialPost = {
  id: number;
  account: SocialAccount;
  author: string;
  handle: string;
  /** `phrase` in the feed's language. */
  text: string;
  phrase: Phrase;
  /** `tagsJa` in the feed's language. */
  tags: string[];
  /** The hashtags as written in Japanese (#信号無視, #ドラレコ, #千代田区). */
  tagsJa: readonly string[];
  /** What it carries: the poster's video (most), a still from it, or words only. */
  media: PostMedia;
  /** The driver's own view at the moment (the fallback when no bystander shot could be taken). */
  image?: string;
  /** The poster's own shot from where they stood (witnessShot.ts), a JPEG data URL. */
  photo?: string;
  /**
   * Where the poster filmed from and how their phone sees it (for playing the video): the eye in the
   * local frame when shot, and the game turns it into latitude/longitude so it survives recentering.
   */
  filmedFrom?: {
    eye: { x: number; y: number; z: number };
    geo?: { lat: number; lon: number; h: number };
    fov: number;
    tilt: number;
    aspect: string;
  };
  /** Width / height of `photo`. */
  photoAspect?: number;
  /** Length of the clip, seconds. */
  clipSeconds: number;
  record: ViolationRecord;
  severity: number;
  /** Game time (epoch ms) of the post. */
  postedAt: number;
  /** Final reach (reposts) this post is heading for. */
  reach: number;
  reposts: number;
  quotes: number;
  likes: number;
  views: number;
  replies: SocialReply[];
  quotePosts: SocialReply[];
  /** Accounts the player follows who reposted it, and when. */
  reposters: { account: SocialAccount; at: number }[];
  /** The police have seen it (it becomes a notice to appear). */
  isReported: boolean;
  /** A post about a pursuit going on (postChase) or a roadside stop (postStop), not a violation. */
  topic?: "chase" | "stop";
};

/** An everyday post of someone else: the rest of the timeline. */
export type SocialChatter = {
  id: number;
  account: SocialAccount;
  /** `phrase` in the feed's language. */
  text: string;
  phrase: Phrase;
  picture?: { motif: PictureMotif; hue: number };
  postedAt: number;
  /** Likes it is heading for. */
  reach: number;
  likes: number;
  reposts: number;
  views: number;
  /** A few replies as it gets liked (and now and then the poster's answer). */
  replies: SocialReply[];
  /** Someone thanking the player for how they drove (a crosswalk, a stop sign). */
  aboutPlayer?: PraiseKind;
};

/** What the notifications tab lists. */
export type SocialEvent =
  | { kind: "trend"; at: number; post: SocialPost }
  | { kind: "milestone"; at: number; post: SocialPost; count: number }
  | { kind: "news"; at: number; post: SocialPost; quote: SocialReply }
  | { kind: "follow"; at: number; account: SocialAccount }
  | { kind: "praise"; at: number; chatter: SocialChatter };

/** A pedestrian who filmed it: the post's author is then that person, in their own clothes. */
export type SocialWitness = { id?: number; colors: HumanColors; variant?: number };

/** Takes the poster's own shot of what they saw, at the moment of posting (sets photo). */
export type SocialCamera = (post: SocialPost) => void;

/**
 * What the game knows around the player, read when everyday posts are written. Everything is
 * optional in effect: a template whose facts are missing is simply not used.
 */
export type SocialWorld = {
  ward: string | null;
  /** 町丁 name (丸の内二丁目). */
  town: string | null;
  /** Wards around the player's. */
  nearWards: readonly string[];
  lat: number;
  lon: number;
  raining: boolean;
  /** AMeDAS temperature (℃); null when unknown. */
  tempC: number | null;
  /** The game's landmarks by name, and how far they are (km). */
  landmarks: readonly { name: string; km: number }[];
  /** Parks near the player (open-data names). */
  parks: readonly string[];
  /** The nearest river (and a bridge over it) from the water-level gauges. */
  river: string | null;
  bridge: string | null;
  /** Places written on guide signs near the player. */
  signs: readonly { ja: string; en: string }[];
  /** Route buses near the player. */
  buses: number;
  /** Traffic around the player is standing still. */
  jammed: boolean;
};

const MINUTE = 60_000;
const HOUR = 3_600_000;

// How shocking each kind is to watch (0–1): what makes people film, post and share it.
const SEVERITY: Record<string, number> = {
  hitAndRun: 1,
  injury: 0.95,
  safeDriving: 0.75,
  pedestrianCrossing: 0.7,
  signal: 0.6,
  noEntry: 0.6,
  phoneDanger: 0.7,
  keepLeft: 0.4,
  stopSign: 0.35,
  closedRoad: 0.3,
  phone: 0.3,
  uturn: 0.3,
  laneChange: 0.2,
  unlicensed: 0.2,
};

/** How shocking it looked (0–1): sets the chance of a post here and who films it (witnessPhones). */
export function severityOf(r: ViolationRecord): number {
  if (r.kind === "speed") {
    const over = Number(/（(\d+)km\/h超過）/.exec(r.label)?.[1] ?? 0);
    return over >= 30 ? 0.75 : over >= 20 ? 0.45 : over >= 15 ? 0.25 : 0.1;
  }
  return SEVERITY[r.kind] ?? (r.kind.startsWith("injury") ? 0.95 : 0.15);
}

/** How striking a roadside stop looks at each moment (a reach and spread like a violation's). */
const STOP_SEVERITY: Record<StopPhase, number> = {
  stopped: 0.3,
  stoppedBike: 0.3,
  ticket: 0.3,
  red: 0.5,
  arrest: 0.75,
  fledCaught: 0.7,
};
/** The chance someone posts a roadside stop's moment, before the people around and the hour count. */
const STOP_POST_BASE: Record<StopPhase, number> = {
  stopped: 0.35,
  stoppedBike: 0.35,
  ticket: 0.3,
  red: 0.55,
  arrest: 0.8,
  fledCaught: 0.75,
};

/**
 * The chance a roadside stop's moment is posted: more for a driver taken away than a ticket, scaled
 * by the people who can see it (none: no post) and halved after dark, when fewer are out.
 */
export function stopPostChance(phase: StopPhase, witnesses: number, night: boolean): number {
  if (witnesses <= 0) return 0;
  return STOP_POST_BASE[phase] * Math.min(1, witnesses / 4) * (night ? 0.5 : 1);
}

// ---------- slots ----------

/** Candidate words per slot name ({ward} → ["千代田区"]); an empty list means it cannot be filled. */
export type SlotValues = Readonly<Record<string, readonly SlotWord[]>>;
const SLOT = /\{(\w+)\}/g;

/** The slot names in a text, in order. */
export const slotsOf = (text: string): string[] => [...text.matchAll(SLOT)].map((m) => m[1]);

const canFill = (text: string, values: SlotValues) =>
  slotsOf(text).every((s) => (values[s]?.length ?? 0) > 0);

/**
 * One word for each slot of `text` that has any, in the order they appear (a slot that repeats
 * keeps its word). Draws `rand` once per slot filled, the same as filling the text did.
 */
export function chooseSlots(text: string, values: SlotValues, rand: () => number): Record<string, SlotWord> {
  const chosen: Record<string, SlotWord> = {};
  for (const name of slotsOf(text)) {
    const isKnown = name in chosen;
    const list = values[name] ?? [];
    if (isKnown || list.length === 0) continue;
    chosen[name] = list[Math.floor(rand() * list.length)];
  }
  return chosen;
}

/**
 * A slot's word in `lang`: its own translation (wards, landmarks, signs, times), else the word's
 * entry in TRANSLATIONS (food, flowers, the car), else the Japanese as it is (towns, parks, rivers).
 */
export function wordIn(word: SlotWord, lang: SocialLang): string {
  const ja = typeof word === "string" ? word : word.ja;
  if (lang === "ja") return ja;
  const own = typeof word === "string" ? undefined : word[lang];
  return own || TRANSLATIONS[lang][ja] || ja;
}

/** Puts the chosen words into a text written in `lang`; a slot without a word stays as written. */
export function fillWords(text: string, slots: Readonly<Record<string, SlotWord>>, lang: SocialLang): string {
  return text.replace(SLOT, (all, name: string) => {
    const word = slots[name];
    return word === undefined ? all : wordIn(word, lang);
  });
}

/** Fills every slot with one of its words, in Japanese (the same word each time a slot repeats). */
export function fillSlots(text: string, values: SlotValues, rand: () => number): string {
  return fillWords(text, chooseSlots(text, values, rand), "ja");
}

/**
 * A phrase in `lang`: each source line translated (or as written), its slots filled in the
 * language the line ended up in, the lines joined (a space between them in English).
 */
export function renderPhrase(phrase: Phrase, lang: SocialLang): string {
  const joiner = lang === "en" ? " " : "";
  return phrase.parts
    .map((part) => {
      const line = textIn(part, lang);
      return fillWords(line.text, phrase.slots, line.lang);
    })
    .join(joiner);
}

/**
 * What a text said before it was translated (the Japanese, or the AI's words), for 「原文を表示」;
 * null when it is shown as written (in Japanese, or a visitor's own words).
 */
export function originalOf(item: { text: string; phrase: Phrase }): string | null {
  const original = item.phrase.written ?? renderPhrase(item.phrase, "ja");
  return original === item.text ? null : original;
}

/** A hashtag in `lang`: its translation, else a ward's name (#千代田区 → #Chiyoda), else as written. */
export function tagIn(tag: string, lang: SocialLang): string {
  if (lang === "ja") return tag;
  const translated = TRANSLATIONS[lang][tag];
  if (translated) return translated;
  const ward = WARD_NAMES[tag.replace(/^#/, "")];
  return ward ? `#${ward[lang].replace(/\s+/g, "")}` : tag;
}

/** A ward (or 都内) with its English and Chinese names. */
const wardWord = (ja: string): SlotWord => {
  const names = WARD_NAMES[ja];
  return names ? { ja, ...names } : ja;
};

/**
 * Where a post was: 「港区芝公園四丁目」. In English the town (Japanese, there is no romanised
 * town data) comes first and the ward after, as in an address: 「芝公園四丁目, Minato」.
 */
const placeWord = (ward: string | undefined, town: string | undefined): SlotWord => {
  if (!ward) return wardWord("都内");
  const names = WARD_NAMES[ward];
  const ja = `${ward}${town ?? ""}`;
  if (!names) return ja;
  return {
    ja,
    en: town ? `${town}, ${names.en}` : names.en,
    zh: `${names.zh}${town ?? ""}`,
  };
};

/** When it happened, as people write it: 11時半ごろ / around 11:30am / 11点半左右. */
export function timeWord(hour: number, minute: number): { ja: string; en: string; zh: string } {
  const kind = minute < 20 ? "about" : minute < 45 ? "half" : "before";
  const h = kind === "before" ? (hour + 1) % 24 : hour;
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 || 12;
  const isNoonOrMidnight = h % 12 === 0;
  // 「12時ごろ」 is noon or midnight: English says which instead of 12pm / 12am.
  const enHour =
    kind === "half" ? `${h12}:30${ap}` : isNoonOrMidnight ? (h === 0 ? "midnight" : "noon") : `${h12}${ap}`;
  return {
    ja: TIME_WORDS[kind].replace("{h}", String(h)),
    en: TIME_WORDS_IN.en[kind].replace("{h}", enHour),
    zh: TIME_WORDS_IN.zh[kind].replace("{h}", String(h)),
  };
}

const asLine = (l: LineLike): Line => (typeof l === "string" ? { text: l } : l);

/** What a post is, for the lines that can go with it. */
type PostShape = { media: PostMedia; kind: string; isDashcam: boolean };
const fitsPost = (l: Line, p: PostShape) => {
  const checks = [
    !l.media || l.media.includes(p.media),
    !l.kinds || (l.kinds as readonly string[]).includes(p.kind),
    !(l.foot && p.isDashcam),
  ];
  return checks.every(Boolean);
};

/**
 * One of `lines` (source texts) that fits the post and whose slots can be filled, preferring
 * those not in `recent` (newest last); when all were used lately, the one used longest ago.
 */
function pickLine(
  lines: readonly LineLike[],
  shape: PostShape,
  values: SlotValues,
  recent: readonly string[],
  rand: () => number,
): string | null {
  const fitting = lines.map(asLine).filter((l) => fitsPost(l, shape) && canFill(l.text, values));
  if (fitting.length === 0) return null;
  const fresh = fitting.filter((l) => !recent.includes(l.text));
  if (fresh.length > 0) return fresh[Math.floor(rand() * fresh.length)].text;
  return fitting.toSorted((a, b) => recent.indexOf(a.text) - recent.indexOf(b.text))[0].text;
}

/** Keeps the last `size` keys, newest last (a key used again moves to the end). */
function remember(list: string[], key: string, size: number): void {
  const at = list.indexOf(key);
  if (at !== -1) list.splice(at, 1);
  list.push(key);
  if (list.length > size) list.splice(0, list.length - size);
}

// ---------- the moment: hour, season, light, weather and what is going on ----------

/** Tokyo's monthly mean temperature (℃, 1991–2020 normals), for when nothing is observed. */
const USUAL_TEMP = [5.4, 6.1, 9.4, 14.3, 18.8, 21.9, 25.7, 26.9, 23.3, 18.0, 12.5, 7.7];
// Month-day spans (MMDD, inclusive) of the times of year people post about.
const PERIOD_SPANS: Record<Exclude<Period, "school">, readonly (readonly [number, number])[]> = {
  pollen: [[210, 430]],
  sakura: [[322, 408]],
  newFiscal: [[401, 415]],
  goldenWeek: [[429, 506]],
  koromogae: [
    [525, 605],
    [1001, 1020],
  ],
  exams: [
    [115, 205],
    [715, 731],
  ],
  summerBreak: [[720, 831]],
  obon: [[811, 816]],
  typhoon: [[801, 1020]],
  kinmokusei: [[925, 1020]],
  undokai: [[920, 1031]],
  gakusai: [[1020, 1125]],
  halloween: [[1020, 1031]],
  koyo: [[1110, 1210]],
  christmas: [[1218, 1225]],
  yearEnd: [[1226, 1231]],
  newYear: [[101, 107]],
};
// Schools are out over these (so no 通学路 posts then).
const SCHOOL_BREAKS: readonly (readonly [number, number])[] = [
  [101, 107],
  [325, 406],
  [720, 831],
  [1225, 1231],
];
const inSpan = (md: number, spans: readonly (readonly [number, number])[]) =>
  spans.some(([a, b]) => md >= a && md <= b);

/** The season of a month and day (梅雨 from 7 June to 19 July, as in an average year in Kanto). */
export function seasonOf(month: number, day: number): Season {
  const md = month * 100 + day;
  if (md >= 1201 || md < 301) return "winter";
  if (md < 607) return "spring";
  if (md < 720) return "rainy";
  if (md < 916) return "summer";
  return "autumn";
}

export function periodsOf(month: number, day: number): Set<Period> {
  const md = month * 100 + day;
  const out = new Set<Period>();
  for (const [p, spans] of Object.entries(PERIOD_SPANS)) if (inSpan(md, spans)) out.add(p as Period);
  if (!inSpan(md, SCHOOL_BREAKS)) out.add("school");
  return out;
}

const inHours = (hour: number, [from, to]: readonly [number, number]) =>
  from <= to ? hour >= from && hour < to : hour >= from || hour < to;
const isWeekend = (dow: number) => dow === 0 || dow === 6;

/** A landmark (its game name) as people call it in each language. */
const landmarkWord = (name: string): SlotWord => {
  const known = LANDMARK_WORDS[name];
  return known ? { ja: known.ja, en: known.en, zh: known.zh } : name;
};

/** Everything a template is checked against at one game time. */
export type Moment = {
  hour: number;
  dow: number;
  season: Season;
  periods: ReadonlySet<Period>;
  light: Light;
  raining: boolean;
  /** Observed, else the month's usual for the hour (℃). */
  temp: number;
  cues: ReadonlySet<Cue>;
  /** Landmarks in sight (game names). */
  landmarks: readonly string[];
  values: SlotValues;
};

// Tokyo Station, for the sun when the game has not said where the player is.
const TOKYO = { lat: 35.681, lon: 139.767 };

/** The moment at game time `at` with the world as the game reports it (null: nothing known). */
export function momentAt(at: number, world: SocialWorld | null, cues: ReadonlySet<Cue> = new Set()): Moment {
  const d = jstParts(at);
  const dow = new Date(at + 9 * HOUR).getUTCDay();
  const season = seasonOf(d.month, d.day);
  const sun = sunPosition(new Date(at), world?.lat ?? TOKYO.lat, world?.lon ?? TOKYO.lon).elevation;
  const light: Light = sun > 6 ? "day" : sun < -6 ? "dark" : d.hour < 12 ? "dawn" : "dusk";
  // The usual day: coolest before dawn, warmest about 14:00 (a 7 ℃ swing).
  const usual = USUAL_TEMP[d.month - 1] + 3.5 * Math.cos(((d.hour - 14) / 24) * Math.PI * 2);
  const observed = world?.tempC ?? null;
  const landmarks = (world?.landmarks ?? [])
    .filter((l) => l.km <= (LANDMARK_WORDS[l.name]?.seenKm ?? 0))
    .toSorted((a, b) => a.km - b.km)
    .map((l) => l.name);
  // Food, flowers and the car are translated through TRANSLATIONS (wordIn), so the Japanese is enough.
  const words = (list: readonly { text: string; seasons?: readonly Season[] }[]) =>
    list.filter((w) => !w.seasons || w.seasons.includes(season)).map((w) => w.text);
  const ward = world?.ward ?? null;
  const town = world?.town?.replace(/[一二三四五六七八九十]+丁目$/, "") || null;
  const values: SlotValues = {
    ward: ward ? [wardWord(ward)] : [],
    town: town ? [town] : [],
    nearWard: (world?.nearWards ?? []).filter((w) => w !== ward).map(wardWord),
    wardEn: ward && WARD_EN[ward] ? [WARD_EN[ward]] : [],
    landmark: landmarks.slice(0, 1).map(landmarkWord),
    park: [...(world?.parks ?? [])],
    river: world?.river ? [world.river] : [],
    bridge: world?.bridge ? [world.bridge] : [],
    // The guide signs carry the place's English (Ginza); Chinese readers get the kanji.
    sign: (world?.signs ?? []).map((s) => ({ ja: s.ja, ...(s.en ? { en: s.en } : {}) })),
    signEn: (world?.signs ?? []).map((s) => s.en).filter(Boolean),
    temp: observed === null ? [] : [String(Math.round(observed))],
    hour: [String(d.hour)],
    weekday: [{ ja: WEEKDAY_WORDS[dow], en: WEEKDAY_WORDS_IN.en[dow], zh: WEEKDAY_WORDS_IN.zh[dow] }],
    lunch: words(WORDS.lunch),
    snack: words(WORDS.snack),
    dinner: words(WORDS.dinner),
    flower: words(WORDS.flower),
    color: words(WORDS.color),
    car: words(WORDS.car),
  };
  return {
    hour: d.hour,
    dow,
    season,
    periods: periodsOf(d.month, d.day),
    light,
    raining: world?.raining ?? false,
    temp: observed ?? usual,
    cues,
    landmarks,
    values,
  };
}

/** Whether an everyday post fits the moment: its hours, days, season, light, weather, cue and slots. */
export function fitsMoment(t: ChatterTemplate, m: Moment): boolean {
  const hours = t.hours ?? ACTIVE_HOURS[t.who];
  const checks = [
    !hours || inHours(m.hour, hours),
    !t.days || (t.days === "weekend") === isWeekend(m.dow),
    !t.dow || t.dow.includes(m.dow),
    !t.seasons || t.seasons.includes(m.season),
    !t.periods || t.periods.some((p) => m.periods.has(p)),
    !t.light || t.light.includes(m.light),
    !t.sky || (t.sky === "rain") === m.raining,
    !t.temp || (m.temp >= t.temp[0] && m.temp <= t.temp[1]),
    !t.cue || m.cues.has(t.cue),
    !t.landmark || m.landmarks.includes(t.landmark),
    canFill(t.text, m.values),
  ];
  return checks.every(Boolean);
}

const isFollowedKey = (who: ChatterVoice): who is FollowedKey => who in FOLLOWED;

/**
 * Words from the on-device LLM, when it is on: the post and its first replies are rewritten in a
 * bystander's own voice. Null (or no writer) keeps the template text, so the feed works without it.
 */
export type SocialWriter = (
  role: "post" | "reply" | "quote",
  post: SocialPost,
  seed: number,
) => Promise<string | null>;
const LLM_REPLIES = 6;
// Posters of the 晒し are often accounts made for it.
const POSTER_NEW_SHARE = 0.4;
const MAX_CHATTER = 40;
const MAX_EVENTS = 60;
const MILESTONES = [100, 1000, 10000, 100000];
/** No text comes back within this many timeline posts (chatter, openers and quotes each). */
export const NO_REPEAT_WINDOW = 30;
// What happened nearby is talked about for this long (real seconds), by at most two people.
const HAPPENING_FRESH_S = 180;
const HAPPENING_USES = 2;
// The same kind of thing noted again this soon (real seconds) is the same happening.
const HAPPENING_GAP_S = 180;
// At least this long (real seconds) between two posts thanking the player.
const PRAISE_GAP_S = 90;
const MAX_CHATTER_REPLIES = 4;
// Pacing in real seconds (timestamps stay in game time; SocialFeed.timeScale converts): people
// post, reply and follow at a human pace however fast the game clock runs.
const CHATTER_GAP_S = [20, 60] as const;
// Everyday posts already there when the timeline is first opened (or the clock jumps).
const PREFILL_POSTS = 12;
// A post's shares take this long (real seconds) to get most of the way: 30 for the worst.
const SPREAD_S = { min: 30, extra: 60 } as const;
// The k-th reply under a post comes no sooner than k × this (real seconds) after it.
const REPLY_PACE_S = 8;
const QUOTE_PACE_S = 25;
const FOLLOW_GAP_S = [90, 330] as const;

type Happening = { kind: HappeningKind; at: number; uses: number };
type ChatterSource = { template: ChatterTemplate; values: SlotValues };

export class SocialFeed {
  readonly posts: SocialPost[] = [];
  /** Everyone else's everyday posts, newest first. */
  readonly chatter: SocialChatter[] = [];
  /** What the notifications tab lists, oldest first. */
  readonly events: SocialEvent[] = [];
  /** Everyone met so far, by id. */
  readonly accounts = new Map<string, SocialAccount>();
  readonly player: SocialAccount = { ...PLAYER_ACCOUNT };
  writer: SocialWriter | null = null;
  camera: SocialCamera | null = null;
  /** What the game knows around the player (main.ts); without it the chatter keeps to the clock. */
  world: (() => SocialWorld) | null = null;
  /** The language texts are shown in (setLang changes it and rewrites them). */
  lang: SocialLang = "ja";
  /**
   * Game ms per real ms: GAME_TIME_SCALE while the game clock runs fast, 1 in リアル時刻 (main.ts
   * sets it). Everything people do is paced in real seconds through it.
   */
  timeScale = GAME_TIME_SCALE;
  private seed = 12345;
  // A stream of its own, so the everyday timeline does not change who posts the player's clips.
  private chatterSeed = 777;
  private nextId = 1;
  private nextReplyId = 1;
  private nextChatterId = 1;
  private nextChatterAt: number | null = null;
  private nextFollowAt: number | null = null;
  private readonly milestones = new WeakMap<SocialPost, number>();
  // Violations the news account has covered (once each, however many posted it).
  private readonly covered = new WeakSet<ViolationRecord>();
  private readonly happenings: Happening[] = [];
  private readonly recentChatter: string[] = [];
  private readonly recentOpeners: string[] = [];
  private readonly recentQuotes: string[] = [];
  private readonly sources = new WeakMap<SocialChatter, ChatterSource>();
  // Each post's spread time (game ms), fixed when it is posted so a change of clock speed leaves it.
  private readonly spreads = new WeakMap<SocialPost, number>();
  private readonly regulars = new Map<Persona, readonly number[]>();
  private lastRaining: boolean | null = null;
  private lastPraiseAt = -Infinity;

  constructor() {
    for (const a of [this.player, ...FOLLOWED_LIST]) this.accounts.set(a.id, a);
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return (this.seed >>> 8) / 0x1000000;
  }

  private crand(): number {
    this.chatterSeed = (this.chatterSeed * 1103515245 + 12345) >>> 0;
    return (this.chatterSeed >>> 8) / 0x1000000;
  }

  /** Game ms that pass in `seconds` of real time at the current clock speed. */
  private real(seconds: number): number {
    return seconds * 1000 * this.timeScale;
  }

  /**
   * Shows everything in `lang` from now on: every post, reply, quote, everyday post and hashtag
   * is written again from its phrase (nothing is picked again, so the same words come back).
   */
  setLang(lang: SocialLang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    for (const p of this.posts) {
      p.text = this.say(p.phrase);
      p.tags = p.tagsJa.map((tag) => tagIn(tag, lang));
      for (const r of [...p.replies, ...p.quotePosts]) r.text = this.say(r.phrase);
    }
    for (const c of this.chatter) {
      c.text = this.say(c.phrase);
      for (const r of c.replies) r.text = this.say(r.phrase);
    }
  }

  /** A phrase in the feed's language (the AI's own words in Japanese). */
  private say(phrase: Phrase): string {
    const isWrittenHere = this.lang === "ja" && phrase.written !== undefined;
    return isWrittenHere ? (phrase.written ?? "") : renderPhrase(phrase, this.lang);
  }

  /** A text from its source lines and slots, in the feed's language. */
  private phrase(
    parts: readonly string[],
    slots: Readonly<Record<string, SlotWord>>,
  ): { text: string; phrase: Phrase } {
    const phrase: Phrase = { parts, slots };
    return { text: this.say(phrase), phrase };
  }

  /** Keeps the on-device AI's words for a text, and shows them where they fit (Japanese). */
  private keepWritten(item: { text: string; phrase: Phrase }, written: string | null): void {
    if (!written) return;
    item.phrase.written = written;
    item.text = this.say(item.phrase);
  }

  private spreadOf(p: SocialPost): number {
    return this.spreads.get(p) ?? this.real(SPREAD_S.min + SPREAD_S.extra * (1 - p.severity));
  }

  /**
   * Maybe someone filmed it: the more people around and the worse it looked, the likelier a
   * post. Returns the post if one was made. `filmedBy` makes that pedestrian the author.
   * draftPost and publish one after the other, at once.
   */
  maybePost(
    record: ViolationRecord,
    witnesses: number,
    gameNow: number,
    filmedBy?: SocialWitness,
  ): SocialPost | null {
    const post = this.draftPost(record, witnesses, gameNow, filmedBy);
    if (post) this.publish(post, gameNow);
    return post;
  }

  /**
   * maybePost's decision and its words, not yet on the timeline: the game drafts at the moment
   * of the violation (the poster is filming and typing it) and publishes a few seconds later, as
   * people do. Nothing is shot or rewritten until publish.
   */
  draftPost(
    record: ViolationRecord,
    witnesses: number,
    gameNow: number,
    filmedBy?: SocialWitness,
  ): SocialPost | null {
    if (witnesses > 0 && record.kind === "closedRoad") this.note("closure", gameNow);
    const severity = severityOf(record);
    const chance = Math.min(0.95, severity * Math.min(1, witnesses / 3) * 1.2);
    if (witnesses === 0 || this.rand() > chance) return null;
    const account = filmedBy
      ? this.register(witnessAccount(filmedBy, gameNow))
      : this.someone(() => this.rand(), gameNow, POSTER_NEW_SHARE);
    // A dashcam's clip is tagged (and often introduced) as one; a phone's is what someone saw.
    const isDashcam = cameraFor(account).kind === "dashcam";
    const media = isDashcam ? "video" : this.mediaFor(severity);
    const values = postValues(record, gameNow);
    const shape = { media, kind: record.kind, isDashcam };
    const opener =
      pickLine(openersOf(record.kind), shape, values, this.recentOpeners, () => this.rand()) ??
      "{place}で危ない運転の車がいた";
    remember(this.recentOpeners, opener, NO_REPEAT_WINDOW);
    const slots = chooseSlots(opener, values, () => this.rand());
    const lead = DASHCAM_LEADS[this.nextId % DASHCAM_LEADS.length];
    const hasLead = isDashcam && this.nextId % 2 === 0;
    const said = this.phrase(hasLead ? [lead, opener] : [opener], slots);
    const area = record.context?.place?.split(" ")[0];
    const id = this.nextId++;
    // Reach spans from a few reposts to tens of thousands for the worst.
    const reach = Math.round(10 ** (0.8 + 3.6 * severity * (0.55 + 0.45 * this.rand())));
    const tagsJa = this.tagsFor(record.kind, isDashcam, area);
    const post: SocialPost = {
      id,
      account,
      author: account.name,
      handle: account.handle,
      ...said,
      tags: tagsJa.map((tag) => tagIn(tag, this.lang)),
      tagsJa,
      media,
      clipSeconds: 6 + (hashString(`${account.id}/${id}`) % 28),
      record,
      severity,
      postedAt: gameNow,
      reach,
      reposts: 0,
      quotes: 0,
      likes: 0,
      views: 0,
      replies: [],
      quotePosts: [],
      reposters: [],
      isReported: false,
    };
    return post;
  }

  /**
   * Puts a drafted post on the timeline at `gameNow`: it spreads from then, its poster's shot is
   * asked for (the camera may have it already) and the on-device AI may rewrite it.
   */
  publish(post: SocialPost, gameNow: number): void {
    post.postedAt = gameNow;
    // Drafted in the language of that moment: the player may have switched since.
    post.text = this.say(post.phrase);
    post.tags = post.tagsJa.map((tag) => tagIn(tag, this.lang));
    this.posts.unshift(post);
    this.spreads.set(post, this.spreadOf(post));
    // Words only: nothing to shoot.
    if (post.media !== "text") this.camera?.(post);
    void this.writer?.("post", post, 0).then((written) => this.keepWritten(post, written));
  }

  /**
   * Someone filming a pursuit going on near the player: 「〇〇でパトカーとヘリが車を追ってる」 (stage 3)
   * or the units gathering (stage 2). `record` stands for the moment (where, when, the car); it is
   * not a booked violation, and the post is not a lead for the police (they are already on it).
   * Why not maybePost: its openers, hashtags and its chance are a violation's; a chase that people
   * stop to watch is posted whenever someone is around.
   */
  postChase(stage: 2 | 3, record: ViolationRecord, witnesses: number, gameNow: number): SocialPost | null {
    if (witnesses <= 0) return null;
    const tagsJa = CHASE_TAGS.filter((t) => stage === 3 || t !== "#ヘリ");
    const reach = Math.round(10 ** (2.6 + 1.2 * this.rand()));
    return this.scenePost(record, gameNow, {
      lines: CHASE_OPENERS[stage],
      fallback: CHASE_FALLBACK,
      tagsJa,
      severity: stage === 3 ? 0.9 : 0.75,
      reach,
      topic: "chase",
      media: (isDashcam) => (isDashcam || this.rand() < 0.7 ? "video" : "photo"),
    });
  }

  /**
   * Someone going past while the police deal with the player's car at the roadside: 「〇〇で白黒
   * パトカーに止められてる車いる」, 「切符切られてるっぽい」. Mostly a photo from the pavement or a
   * passing car (no plate, no face), now and then a clip or words only. More people stop to post an
   * arrest or a driver taken into the patrol car than a ticket; fewer after dark, and none where
   * nobody is about (`witnesses`, as for a violation).
   */
  postStop(
    phase: StopPhase,
    record: ViolationRecord,
    witnesses: number,
    gameNow: number,
    night: boolean,
  ): SocialPost | null {
    const chance = stopPostChance(phase, witnesses, night);
    if (this.rand() >= chance) return null;
    const severity = STOP_SEVERITY[phase];
    return this.scenePost(record, gameNow, {
      lines: STOP_OPENERS[phase],
      fallback: STOP_FALLBACK,
      tagsJa: STOP_TAGS,
      severity,
      reach: Math.round(10 ** (1 + 2.4 * severity * (0.6 + 0.4 * this.rand()))),
      topic: "stop",
      media: (isDashcam) => {
        const u = this.rand();
        if (isDashcam) return "video";
        return u < 0.6 ? "photo" : u < 0.9 ? "video" : "text";
      },
    });
  }

  /** A post about something happening around the player (a chase, a roadside stop), not a violation. */
  private scenePost(
    record: ViolationRecord,
    gameNow: number,
    o: {
      lines: readonly LineLike[];
      fallback: string;
      tagsJa: readonly string[];
      severity: number;
      reach: number;
      topic: "chase" | "stop";
      media: (isDashcam: boolean) => PostMedia;
    },
  ): SocialPost {
    const account = this.someone(() => this.rand(), gameNow, POSTER_NEW_SHARE);
    const isDashcam = cameraFor(account).kind === "dashcam";
    const media = o.media(isDashcam);
    const values = postValues(record, gameNow);
    const shape = { media, kind: record.kind, isDashcam };
    const opener = pickLine(o.lines, shape, values, this.recentOpeners, () => this.rand()) ?? o.fallback;
    remember(this.recentOpeners, opener, NO_REPEAT_WINDOW);
    const said = this.phrase(
      [opener],
      chooseSlots(opener, values, () => this.rand()),
    );
    const area = record.context?.place?.split(" ")[0];
    const id = this.nextId++;
    const tagsJa = [...o.tagsJa, ...(area ? [`#${area}`] : [])];
    const post: SocialPost = {
      id,
      account,
      author: account.name,
      handle: account.handle,
      ...said,
      tags: tagsJa.map((tag) => tagIn(tag, this.lang)),
      tagsJa,
      media,
      clipSeconds: 10 + (hashString(`${account.id}/${id}`) % 30),
      record,
      severity: o.severity,
      postedAt: gameNow,
      reach: o.reach,
      reposts: 0,
      quotes: 0,
      likes: 0,
      views: 0,
      replies: [],
      quotePosts: [],
      reposters: [],
      // The police are already there: these are not leads for them.
      isReported: true,
      topic: o.topic,
    };
    this.posts.unshift(post);
    this.spreads.set(post, this.spreadOf(post));
    if (media !== "text") this.camera?.(post);
    return post;
  }

  /**
   * The driver who got away is identified (the plate, cameras, the posted videos): the news account
   * follows up on the latest chase post, and it trends again (「逃走車、特定される」).
   */
  identified(gameNow: number): SocialReply | null {
    const post = this.posts.find((p) => p.topic === "chase");
    if (!post) return null;
    const [ward, town] = post.record.context?.place?.split(" ") ?? [];
    const news = FOLLOWED.news;
    const said = this.phrase([NEWS_IDENTIFIED], { place: placeWord(ward, town) });
    const quote: SocialReply = {
      id: this.nextReplyId++,
      account: news,
      author: news.name,
      handle: news.handle,
      ...said,
      atMinute: Math.round((gameNow - post.postedAt) / MINUTE),
      postedAt: gameNow,
      weight: 0.08,
      likes: 0,
    };
    post.quotePosts.push(quote);
    post.reach *= 2;
    this.events.push({ kind: "news", at: gameNow, post, quote }, { kind: "trend", at: gameNow, post });
    return quote;
  }

  /** Video for most; a still or words only for some, more so for what looked less serious. */
  private mediaFor(severity: number): PostMedia {
    const u = this.rand();
    const textShare = severity < 0.3 ? 0.3 : severity < 0.6 ? 0.15 : 0;
    const photoShare = severity < 0.6 ? 0.3 : 0.15;
    return u < textShare ? "text" : u < textShare + photoShare ? "photo" : "video";
  }

  /** The kind's main tag, one or two more of its own, where it came from and the ward. */
  private tagsFor(kind: string, isDashcam: boolean, area: string | undefined): string[] {
    const own = TAGS[kind as ViolationKind] ?? ["#危険運転"];
    const extra = own
      .slice(1)
      .filter(() => this.rand() < 0.5)
      .slice(0, 2);
    const source = isDashcam ? SOURCE_TAGS.dashcam : SOURCE_TAGS.witness;
    return [own[0], ...extra, source, ...(area ? [`#${area}`] : [])];
  }

  /**
   * Something happened in the game near the player (an orbis flash, a crash, a patrol, a robotaxi
   * …): people around will mention it in the next few everyday posts.
   */
  note(kind: HappeningKind, at: number): void {
    const last = this.happenings.findLast((h) => h.kind === kind);
    const isSame = last !== undefined && Math.abs(at - last.at) < this.real(HAPPENING_GAP_S);
    if (isSame) return;
    this.happenings.push({ kind, at, uses: 0 });
    if (this.happenings.length > 30) this.happenings.shift();
    // People react within seconds: the next everyday post comes sooner.
    if (this.nextChatterAt !== null)
      this.nextChatterAt = Math.min(this.nextChatterAt, at + this.real(5 + this.crand() * 10));
  }

  /**
   * The player drove well in front of people (stopped for someone at a crosswalk, came to a full
   * stop at 止まれ): now and then one of them thanks them. Returns that post if one was made.
   */
  maybePraise(kind: PraiseKind, witnesses: number, gameNow: number): SocialChatter | null {
    const isTooSoon = gameNow - this.lastPraiseAt < this.real(PRAISE_GAP_S);
    const chance = Math.min(0.5, 0.12 * witnesses);
    if (witnesses === 0 || isTooSoon || this.crand() > chance) return null;
    const c = this.chatOnce(gameNow, this.world?.() ?? null, kind);
    if (!c) return null;
    c.aboutPlayer = kind;
    // Good news travels: people like these more than the usual post.
    c.reach *= 3;
    this.lastPraiseAt = gameNow;
    this.events.push({ kind: "praise", at: gameNow, chatter: c });
    return c;
  }

  /** Grow every post with game time; returns posts the police have just noticed. */
  update(gameNow: number): SocialPost[] {
    const noticed: SocialPost[] = [];
    for (const p of this.posts) {
      const spreadMs = this.spreadOf(p);
      // Shares spread over the first real minute or two, then level off (compressed from hours).
      const spread = 1 - Math.exp(-Math.max(0, gameNow - p.postedAt) / spreadMs);
      p.reposts = Math.round(p.reach * spread);
      p.quotes = Math.round(p.reposts * 0.12);
      p.likes = Math.round(p.reposts * (3 + p.severity * 2));
      p.views = Math.round(p.likes * 38 + p.reposts * 15);
      const wantReplies = Math.min(14, Math.floor(Math.log2(1 + p.reposts) * 1.6));
      while (p.replies.length < wantReplies) {
        // When the k-th reply came: the moment the shares were enough for k of them, but people
        // take a while to write, so they come one by one over a minute or two.
        const k = p.replies.length + 1;
        const earliest = p.postedAt + this.real(4 + REPLY_PACE_S * k);
        if (earliest > gameNow) break;
        const at = Math.max(earliest, whenReposts(p, 2 ** (k / 1.6) - 1, gameNow, spreadMs));
        const said = this.postLine(p, REPLIES, p.replies, []);
        if (said === null) break;
        const r = this.line(
          this.someone(() => this.rand(), gameNow),
          said,
          p,
          at,
        );
        p.replies.push(r);
        if (p.replies.length <= LLM_REPLIES)
          void this.writer?.("reply", p, p.replies.length).then((written) => this.keepWritten(r, written));
        this.maybeAnswer(p, r, gameNow);
      }
      for (const r of p.replies) r.likes = Math.round(p.likes * r.weight);
      const wantQuotes = Math.min(5, Math.floor(Math.log10(1 + p.quotes) * 2));
      while (p.quotePosts.length < wantQuotes) {
        const k = p.quotePosts.length + 1;
        const earliest = p.postedAt + this.real(QUOTE_PACE_S * k);
        if (earliest > gameNow) break;
        const at = Math.max(earliest, whenReposts(p, (10 ** (k / 2) - 1) / 0.12, gameNow, spreadMs));
        const said = this.postLine(p, QUOTES, p.quotePosts, this.recentQuotes);
        if (said === null) break;
        const q = this.line(
          this.someone(() => this.rand(), gameNow),
          said,
          p,
          at,
        );
        p.quotePosts.push(q);
        if (p.quotePosts.length <= 2)
          void this.writer?.("quote", p, 100 + p.quotePosts.length).then((written) =>
            this.keepWritten(q, written),
          );
      }
      for (const q of p.quotePosts) q.likes = Math.round(p.likes * q.weight);
      this.spreadAmongFollowed(p, gameNow);
      this.markMilestones(p, gameNow);
      // Widely shared clips get to the police, who trace the car from the video (words alone
      // show them nothing).
      const isWide = p.reposts > 2000 || (p.severity >= 0.9 && p.reposts > 50);
      const hasPicture = p.media !== "text";
      if (isWide && hasPicture && !p.isReported) {
        p.isReported = true;
        noticed.push(p);
        this.reportNews(p, gameNow);
      }
    }
    this.chat(gameNow);
    this.follow(gameNow);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return noticed;
  }

  /**
   * A filled line for a post from `table` (its group's lines, else those that fit any), not one
   * already under it, and not one in `recent` while there are others (then it is remembered).
   */
  private postLine(
    p: SocialPost,
    table: Record<ReplyGroup | "common", readonly LineLike[]>,
    under: readonly SocialReply[],
    recent: string[],
  ): { text: string; phrase: Phrase } | null {
    const values = postValues(p.record, p.postedAt);
    // A roadside stop or a chase is not about the moment's record (it stands for the place only).
    const group: ReplyGroup | undefined =
      p.topic === "stop"
        ? "pulledOver"
        : p.topic === "chase"
          ? "flee"
          : (REPLY_GROUP[p.record.kind as ViolationKind] as ReplyGroup | undefined);
    // By source line, so a line is not used twice under a post whatever the language or the AI wrote.
    const used = new Set(under.map((r) => r.phrase.parts[0]));
    const unused = (lines: readonly LineLike[]) => lines.filter((l) => !used.has(asLine(l).text));
    // Most of what people write is about this kind of thing; the rest fits anything.
    const isOwn = group !== undefined && this.rand() < 0.55;
    const first = isOwn ? unused(table[group]) : unused(table.common);
    const second = isOwn ? unused(table.common) : group ? unused(table[group]) : [];
    const shape = { media: p.media, kind: p.record.kind, isDashcam: cameraFor(p.account).kind === "dashcam" };
    const source =
      pickLine(first, shape, values, recent, () => this.rand()) ??
      pickLine(second, shape, values, recent, () => this.rand());
    if (source === null) return null;
    if (recent.length > 0 || table === QUOTES) remember(recent, source, NO_REPEAT_WINDOW);
    return this.phrase(
      [source],
      chooseSlots(source, values, () => this.rand()),
    );
  }

  /**
   * Someone from the pool; with `newShare`, that share of the time a new (throwaway) account, and
   * `settled` never one (people chatting under a cat photo are not throwaways).
   */
  private someone(rand: () => number, gameNow: number, newShare = 0, settled = false): SocialAccount {
    const wantsNew = newShare > 0 && rand() < newShare;
    let seed = Math.floor(rand() * ACCOUNT_POOL);
    // New accounts are the ones the avatar mix leaves with the default picture: walk to the next.
    const isWrong = (s: number) => (avatarFor(`u${s}`).kind === "default") !== wantsNew;
    if (wantsNew || settled) for (let i = 0; i < 60 && isWrong(seed); i++) seed = (seed + 1) % ACCOUNT_POOL;
    return this.accounts.get(`u${seed}`) ?? this.register(accountFor(seed, gameNow));
  }

  private register(a: SocialAccount): SocialAccount {
    const known = this.accounts.get(a.id);
    if (known) return known;
    this.accounts.set(a.id, a);
    return a;
  }

  private line(
    account: SocialAccount,
    said: { text: string; phrase: Phrase },
    p: SocialPost,
    at: number,
  ): SocialReply {
    return {
      id: this.nextReplyId++,
      account,
      author: account.name,
      handle: account.handle,
      ...said,
      atMinute: Math.round((at - p.postedAt) / MINUTE),
      postedAt: at,
      // Most replies get a few likes, one or two get many.
      weight: 0.002 + 0.04 * this.rand() ** 3,
      likes: 0,
    };
  }

  /** Now and then the poster answers a reply (twice at most). */
  private maybeAnswer(p: SocialPost, r: SocialReply, gameNow: number): void {
    const isPoster = r.account === p.account;
    const answered = p.replies.filter((x) => x.account === p.account).length;
    if (isPoster || answered >= 2 || this.rand() > 0.3) return;
    const said = this.postLine(p, ANSWERS, p.replies, []);
    if (said === null) return;
    const at = Math.min(gameNow, r.postedAt + this.real(6 + this.rand() * 30));
    p.replies.push({ ...this.line(p.account, said, p, at), replyTo: r.id });
  }

  /** People the player follows repost it as it spreads (one per tenfold). */
  private spreadAmongFollowed(p: SocialPost, gameNow: number): void {
    const want = Math.min(3, Math.floor(Math.log10(1 + p.reposts)));
    while (p.reposters.length < want) {
      const pool = FOLLOWED_LIST.filter(
        (a) => a !== FOLLOWED.news && !p.reposters.some((r) => r.account === a),
      );
      const account = pool[Math.floor(this.rand() * pool.length)];
      const n = 10 ** (p.reposters.length + 1) - 1;
      p.reposters.push({ account, at: whenReposts(p, n, gameNow, this.spreadOf(p)) });
    }
  }

  private markMilestones(p: SocialPost, gameNow: number): void {
    const shown = this.milestones.get(p) ?? 0;
    for (const n of MILESTONES) {
      const isNew = n > shown && p.reposts >= n;
      if (!isNew) continue;
      this.milestones.set(p, n);
      const at = whenReposts(p, n, gameNow, this.spreadOf(p));
      this.events.push(
        n === MILESTONES[0] ? { kind: "trend", at, post: p } : { kind: "milestone", at, post: p, count: n },
      );
    }
  }

  /** The news account picks up a clip the police now know of. */
  private reportNews(p: SocialPost, gameNow: number): void {
    if (this.covered.has(p.record)) return;
    this.covered.add(p.record);
    const [ward, town] = p.record.context?.place?.split(" ") ?? [];
    const kind = p.record.kind.replace(/\d+$/, "") as ViolationKind;
    const what: SlotWord = { ja: p.record.label.replace(/（.*?）/g, ""), ...KIND_WORDS[kind] };
    const news = FOLLOWED.news;
    const said = this.phrase([NEWS_QUOTE], {
      place: placeWord(ward, town),
      what,
      media: MEDIA_WORDS[p.media],
    });
    const quote: SocialReply = {
      id: this.nextReplyId++,
      account: news,
      author: news.name,
      handle: news.handle,
      ...said,
      atMinute: Math.round((gameNow - p.postedAt) / MINUTE),
      postedAt: gameNow,
      weight: 0.06,
      likes: 0,
    };
    p.quotePosts.push(quote);
    this.events.push({ kind: "news", at: gameNow, post: p, quote });
  }

  /** Everyone else's posts: a few hours' worth at first, then one every few minutes. */
  private chat(gameNow: number): void {
    const world = this.world?.() ?? null;
    // Rain starting or stopping is something people post about.
    const raining = world ? world.raining : null;
    const hasTurned = raining !== null && this.lastRaining !== null && raining !== this.lastRaining;
    if (hasTurned) this.note(raining ? "rainStart" : "rainStop", gameNow);
    this.lastRaining = raining;
    // A dozen posts' worth at the mean gap: what is already there when the app is first opened.
    const span = PREFILL_POSTS * this.real((CHATTER_GAP_S[0] + CHATTER_GAP_S[1]) / 2);
    const ahead = this.nextChatterAt === null ? 0 : this.nextChatterAt - gameNow;
    // The clock set back (a new day, a time preset) or leapt far ahead: start over from now.
    const isJump =
      this.nextChatterAt === null || ahead > this.real(CHATTER_GAP_S[1] * 2) + MINUTE || -ahead > 2 * span;
    if (isJump) {
      for (let i = this.chatter.length - 1; i >= 0; i--)
        if (this.chatter[i].postedAt > gameNow) this.chatter.splice(i, 1);
      this.nextChatterAt =
        Math.max(gameNow - span, this.chatter[0]?.postedAt ?? -Infinity) + this.chatterGap(gameNow);
    }
    while (this.nextChatterAt !== null && this.nextChatterAt <= gameNow) {
      this.chatOnce(this.nextChatterAt, world);
      this.nextChatterAt += this.chatterGap(this.nextChatterAt);
    }
    if (this.chatter.length > MAX_CHATTER) this.chatter.length = MAX_CHATTER;
    for (const c of this.chatter) {
      const spread = 1 - Math.exp(-Math.max(0, gameNow - c.postedAt) / this.real(150));
      c.likes = Math.round(c.reach * spread);
      c.reposts = Math.round(c.likes * 0.08);
      c.views = Math.round(c.likes * 40 + c.reach * 6 * spread);
      this.growReplies(c, gameNow);
    }
  }

  /** Game ms to the next everyday post after one at `at`: 20–60 real seconds, longer at night. */
  private chatterGap(at: number): number {
    const hour = jstParts(at).hour;
    // Fewer people are up from 1 to 5: half as many posts.
    const isSmallHours = hour >= 1 && hour < 5;
    const seconds = CHATTER_GAP_S[0] + this.crand() * (CHATTER_GAP_S[1] - CHATTER_GAP_S[0]);
    return this.real(seconds * (isSmallHours ? 2 : 1));
  }

  /** What is going on at `at`: happenings people still talk about, buses and jams around. */
  private cuesAt(at: number, world: SocialWorld | null): Set<Cue> {
    const cues = new Set<Cue>();
    for (const h of this.happenings) {
      const isFresh = h.at <= at && at - h.at <= this.real(HAPPENING_FRESH_S) && h.uses < HAPPENING_USES;
      if (isFresh) cues.add(h.kind);
    }
    if ((world?.buses ?? 0) > 0) cues.add("bus");
    if (world?.jammed) cues.add("jam");
    return cues;
  }

  /**
   * One everyday post at `at`: a template that fits the moment and was not used in the last
   * NO_REPEAT_WINDOW posts, weighted, filled from what the game knows. With `cue` (a praise),
   * only templates for it; otherwise something that just happened is answered first.
   */
  private chatOnce(at: number, world: SocialWorld | null, cue?: Cue): SocialChatter | null {
    const cues = this.cuesAt(at, world);
    if (cue) cues.add(cue);
    const m = momentAt(at, world, cues);
    const fitting = CHATTER.filter((t) => fitsMoment(t, m));
    const fresh = fitting.filter((t) => !this.recentChatter.includes(t.text));
    // Something that happened a moment ago and nobody has mentioned yet comes first (mostly).
    const pending = this.happenings.find((h) => h.uses === 0 && cues.has(h.kind));
    const wanted = cue ?? (pending && this.crand() < 0.85 ? pending.kind : undefined);
    const forCue = wanted ? fresh.filter((t) => t.cue === wanted) : [];
    if (cue && forCue.length === 0) return null;
    // Cue-only templates wait for their cue to be wanted, so they stay rare.
    const general = fresh.filter((t) => !t.cue || t.cue === "bus" || t.cue === "jam");
    const lastWho = this.lastVoice();
    const others = general.filter((t) => t.who !== lastWho);
    const pool = forCue.length > 0 ? forCue : others.length > 0 ? others : general;
    // Everything that fits was posted lately (a quiet hour): nobody posts rather than a repeat.
    if (pool.length === 0) return null;
    const t = weighted(pool, weightOf, () => this.crand());
    const used = t.cue ? this.happenings.findLast((h) => h.kind === t.cue && cues.has(h.kind)) : undefined;
    if (used) used.uses++;
    remember(this.recentChatter, t.text, NO_REPEAT_WINDOW);
    const account = this.voiceOf(t.who, at);
    const c: SocialChatter = {
      id: this.nextChatterId++,
      account,
      ...this.phrase(
        [t.text],
        chooseSlots(t.text, m.values, () => this.crand()),
      ),
      picture: t.picture ? { motif: t.picture, hue: Math.floor(this.crand() * 360) } : undefined,
      postedAt: at,
      reach: Math.round(Math.max(2, account.followers * (0.003 + this.crand() * 0.02))),
      likes: 0,
      reposts: 0,
      views: 0,
      replies: [],
    };
    this.sources.set(c, { template: t, values: m.values });
    // Newest first, also when a praise comes in between scheduled posts.
    const index = this.chatter.findIndex((x) => x.postedAt <= at);
    this.chatter.splice(index === -1 ? this.chatter.length : index, 0, c);
    return c;
  }

  /** The template a post was written from (for tests and the QA logs). */
  templateOf(c: SocialChatter): ChatterTemplate | undefined {
    return this.sources.get(c)?.template;
  }

  private lastVoice(): ChatterVoice | undefined {
    const last = this.chatter[0];
    return last ? this.sources.get(last)?.template.who : undefined;
  }

  /** An account the player follows, or one of the people with that persona (mostly its regulars). */
  private voiceOf(who: ChatterVoice, at: number): SocialAccount {
    if (isFollowedKey(who)) return FOLLOWED[who];
    const seeds = personaSeeds(who);
    if (seeds.length === 0) return this.someone(() => this.crand(), at);
    // A few regulars write most of a persona's posts, so the same faces come back.
    const isRegular = this.crand() < 0.7;
    const list = isRegular ? this.regularsOf(who, seeds, at) : seeds;
    const seed = list[Math.floor(this.crand() * list.length)];
    return this.accounts.get(`u${seed}`) ?? this.register(accountFor(seed, at));
  }

  /** Up to three seeds of a persona with different names (not three accounts of one person). */
  private regularsOf(who: Persona, seeds: readonly number[], at: number): readonly number[] {
    const known = this.regulars.get(who);
    if (known) return known;
    const names = new Set<string>();
    const out: number[] = [];
    for (const seed of seeds) {
      const name = accountFor(seed, at).name;
      if (names.has(name)) continue;
      names.add(name);
      out.push(seed);
      if (out.length === 3) break;
    }
    this.regulars.set(who, out);
    return out;
  }

  /** A few replies under an everyday post as it is liked, and sometimes the poster's thanks. */
  private growReplies(c: SocialChatter, gameNow: number): void {
    const source = this.sources.get(c);
    if (!source) return;
    const { template: t, values } = source;
    const top = () => c.replies.filter((r) => r.replyTo === undefined);
    const want = Math.min(MAX_CHATTER_REPLIES, Math.floor(Math.log2(1 + c.likes) / 1.7));
    while (top().length < want) {
      const used = new Set(c.replies.map((r) => r.phrase.parts[0]));
      // Every line's words are picked (as many draws as before), then the unfillable and used drop out.
      const lines = [...(t.replies ?? []), ...CHATTER_REPLIES[t.topic]]
        .map((line) => ({ line, slots: chooseSlots(line, values, () => this.crand()) }))
        .filter(({ line, slots }) => !used.has(line) && slotsOf(line).every((s) => s in slots));
      if (lines.length === 0) break;
      const k = top().length + 1;
      const at = Math.min(gameNow, c.postedAt + this.real(10 + 25 * k + this.crand() * 15));
      const who = this.someone(() => this.crand(), gameNow, 0, true);
      const picked = pickOf(lines, this.crand());
      const r = this.chatterReply(c, who, this.phrase([picked.line], picked.slots), at);
      c.replies.push(r);
      this.maybeThank(c, r, gameNow);
    }
    for (const r of c.replies) r.likes = Math.round(c.likes * r.weight);
  }

  /** The poster of an everyday post answers one reply now and then (not the news or tips accounts). */
  private maybeThank(c: SocialChatter, r: SocialReply, gameNow: number): void {
    const isOfficial = c.account === FOLLOWED.news || c.account === FOLLOWED.lab;
    const hasAnswered = c.replies.some((x) => x.account === c.account);
    if (isOfficial || hasAnswered || r.account === c.account || this.crand() > 0.3) return;
    const topic = this.sources.get(c)?.template.topic ?? "misc";
    const voice =
      c.account.persona === "touristEn"
        ? "en"
        : c.account.persona === "touristZh"
          ? "zh"
          : CAREFUL_TOPICS.includes(topic)
            ? "careful"
            : "ja";
    const text = pickOf(CHATTER_ANSWERS[voice], this.crand());
    const at = Math.min(gameNow, r.postedAt + this.real(5 + this.crand() * 30));
    c.replies.push({ ...this.chatterReply(c, c.account, this.phrase([text], {}), at), replyTo: r.id });
  }

  private chatterReply(
    c: SocialChatter,
    account: SocialAccount,
    said: { text: string; phrase: Phrase },
    at: number,
  ): SocialReply {
    return {
      id: this.nextReplyId++,
      account,
      author: account.name,
      handle: account.handle,
      ...said,
      atMinute: Math.round((at - c.postedAt) / MINUTE),
      postedAt: at,
      weight: 0.02 + 0.1 * this.crand() ** 3,
      likes: 0,
    };
  }

  /** Now and then someone follows the player (people follow anyone). */
  private follow(gameNow: number): void {
    const longest = this.real(FOLLOW_GAP_S[1]);
    const ahead = this.nextFollowAt === null ? 0 : this.nextFollowAt - gameNow;
    const isJump = this.nextFollowAt === null || ahead > longest + MINUTE || -ahead > 2 * longest;
    if (isJump) this.nextFollowAt = gameNow + this.real(30 + this.crand() * 120);
    while (this.nextFollowAt !== null && this.nextFollowAt <= gameNow) {
      const account = this.someone(() => this.crand(), this.nextFollowAt);
      this.player.followers++;
      this.events.push({ kind: "follow", at: this.nextFollowAt, account });
      this.nextFollowAt += this.real(FOLLOW_GAP_S[0] + this.crand() * (FOLLOW_GAP_S[1] - FOLLOW_GAP_S[0]));
    }
  }
}

const pickOf = <T>(list: readonly T[], u: number): T => list[Math.floor(u * list.length)];

/**
 * How likely a template is among those that fit: its own weight, a little more for the ones tied
 * to the moment (hour, season, weather, light), so the feed sounds like now rather than any day.
 */
function weightOf(t: ChatterTemplate): number {
  const isOfTheMoment = Boolean(t.hours || t.seasons || t.periods || t.sky || t.temp || t.light || t.dow);
  return (t.weight ?? 1) * (isOfTheMoment ? 1.5 : 1);
}

function weighted<T>(list: readonly T[], weight: (x: T) => number, rand: () => number): T {
  const total = list.reduce((s, x) => s + weight(x), 0);
  let u = rand() * total;
  for (const x of list) {
    u -= weight(x);
    if (u < 0) return x;
  }
  return list[list.length - 1];
}

/** The openers for a kind (records of kinds the table does not know get a general one). */
function openersOf(kind: string): readonly LineLike[] {
  const table: Partial<Record<string, readonly LineLike[]>> = OPENERS;
  return table[kind] ?? table[kind.replace(/\d+$/, "")] ?? [];
}

/** The slots of a post about a violation: where, how fast, the player's car, when. */
function postValues(r: ViolationRecord, at: number): SlotValues {
  const [ward, town] = r.context?.place?.split(" ") ?? [];
  const place = placeWord(ward || undefined, town || undefined);
  const kmh = r.context?.kmh ?? 0;
  const limit = r.context?.limit ?? null;
  const t = jstParts(at);
  return {
    place: [place],
    ward: [wardWord(ward || "都内")],
    town: town ? [town] : [place],
    kmh: [String(Math.round(kmh))],
    limit: limit === null ? [] : [String(limit)],
    over: limit === null ? [] : [String(Math.max(0, Math.round(kmh - limit)))],
    time: [timeWord(t.hour, t.minute)],
    color: WORDS.color.map((w) => w.text),
    car: WORDS.car.map((w) => w.text),
  };
}

/** Game time when a post's reposts reached `n` (no later than now), with its spread time in game ms. */
function whenReposts(p: SocialPost, n: number, gameNow: number, spreadMs: number): number {
  const share = Math.max(0, n) / p.reach;
  if (share >= 1) return gameNow;
  const at = p.postedAt - spreadMs * Math.log(1 - share);
  return Math.min(gameNow, at);
}

/** Replies a post shows it has: those written out plus the many nobody opens. */
export const replyCountOf = (p: SocialPost) => p.replies.length + Math.round(p.reposts * 0.2);

// Big counts by language, largest unit first: 万・億 in Japanese, 万・亿 in Chinese, K・M・B in English.
const COUNT_UNITS: Record<SocialLang, readonly (readonly [string, number])[]> = {
  ja: [
    ["億", 100_000_000],
    ["万", 10_000],
  ],
  zh: [
    ["亿", 100_000_000],
    ["万", 10_000],
  ],
  en: [
    ["B", 1_000_000_000],
    ["M", 1_000_000],
    ["K", 1_000],
  ],
};

/**
 * Counts the way the app shows them: 3,456 / 1.2万 / 12.3万 / 123万 / 1.2億 (Japanese; 亿 in
 * Chinese) or 3,456 / 12.3K / 123K / 1.2M (English). Cut, not rounded (99,999 is 9.9万 and 99.9K,
 * never 10.0万). Below 10,000 every language shows the number itself.
 */
export function formatCount(n: number, lang: SocialLang = getLocale()): string {
  const v = Math.max(0, Math.floor(n));
  // Why a fixed locale: the grouping must not depend on the machine (tests, players abroad).
  if (v < 10_000) return v.toLocaleString("en-US");
  const [unit, size] = COUNT_UNITS[lang].find(([, s]) => v >= s) ?? COUNT_UNITS[lang].at(-1) ?? ["", 1];
  const tenths = Math.floor((v * 10) / size);
  const shown = tenths < 1000 ? tenths / 10 : Math.floor(tenths / 10);
  return `${shown}${unit}`;
}

/** Year … second of a game time in Japan (JST, no daylight saving). */
export function jstParts(ms: number) {
  const d = new Date(ms + 9 * HOUR);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** A month as a date in `lang` writes it: 10 (10月), or Oct / October in English. */
const monthIn = (month: number, lang: SocialLang, long = false): string => {
  if (lang !== "en") return String(month);
  const name = MONTH_NAMES_EN[month - 1];
  return long ? name : name.slice(0, 3);
};

/** A date (Japan time) without the year when it is this year's: 10月4日 / Oct 4 / 2025年12月31日. */
function dateIn(d: ReturnType<typeof jstParts>, withYear: boolean, lang: SocialLang): string {
  const params = { year: d.year, month: monthIn(d.month, lang), day: d.day };
  return st(withYear ? "time.dateYear" : "time.date", params, lang);
}

/**
 * A post's age as a timeline row shows it: たった今 / 3分 / 2時間 / 10月4日 / 2025年12月31日,
 * now / 3m / 2h / Oct 4 / Dec 31, 2025, 刚刚 / 3分钟 / 2小时 / 10月4日.
 */
export function relativeTime(thenMs: number, nowMs: number, lang: SocialLang = getLocale()): string {
  const s = Math.floor((nowMs - thenMs) / 1000);
  if (s < 60) return st("time.now", undefined, lang);
  if (s < 3600) return st("time.minutes", { n: Math.floor(s / 60) }, lang);
  if (s < 86400) return st("time.hours", { n: Math.floor(s / 3600) }, lang);
  const d = jstParts(thenMs);
  const isThisYear = d.year === jstParts(nowMs).year;
  return dateIn(d, !isThisYear, lang);
}

/**
 * An opened post's time (Japan time): 午前11:30 · 2026年10月5日 / 11:30 AM · Oct 5, 2026 /
 * 上午11:30 · 2026年10月5日. Japanese counts the afternoon from 午後0時; the others from 12.
 */
export function postTimestamp(ms: number, lang: SocialLang = getLocale()): string {
  const d = jstParts(ms);
  const half = st(d.hour < 12 ? "time.am" : "time.pm", undefined, lang);
  const h = lang === "ja" ? d.hour % 12 : d.hour % 12 || 12;
  const clock = st("time.clock", { half, h, mm: String(d.minute).padStart(2, "0") }, lang);
  return `${clock} · ${dateIn(d, true, lang)}`;
}

/** 「2019年4月からYを利用しています」 / "Joined Y in April 2019" / 「2019年4月加入 Y」. */
export function joinedLabel(a: SocialAccount, lang: SocialLang = getLocale()): string {
  const month = monthIn(a.joined.month, lang, true);
  return st("profile.joined", { year: a.joined.year, month, app: SOCIAL_APP_NAME }, lang);
}

/**
 * Keeps `feed` in the UI's language: now, and again on every switch, then calls `then` (the
 * view redraws). Returns the unsubscribe.
 */
export function followLocale(feed: SocialFeed, then?: (lang: SocialLang) => void): () => void {
  feed.setLang(getLocale());
  return onLocaleChange((lang) => {
    feed.setLang(lang);
    then?.(lang);
  });
}

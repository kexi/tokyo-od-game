// A namespace: the sound code below calls its time `t`.
import * as i18n from "../i18n";
import type { Locale, MessageKey } from "../i18n";
import { violationName } from "../i18n/law";
import { wardInEnglish } from "../i18n/wards";
import type { Assist } from "./carControls";
import { whiteNoise } from "./spatialMath";

/**
 * ナビのテレビ: what the navi may show and play, and what its programmes say (naviTv.ts draws and
 * plays them). No DOM or WebAudio here, so vitest can run it.
 *
 * The law: 道路交通法 第71条第5号の5 — unless the car is stopped, the driver must not 注視 (keep
 * looking at) an image on a display fitted in the car or brought into it. The makers' rule on top
 * (自工会 画像表示装置ガイドライン 3.0, Annex 2 §3): no broadcast TV pictures while the car moves.
 * Navis tell "stopped" from the parking brake wire and the speed pulse, so the picture comes back
 * only with the car at rest and the parking brake on; the sound plays on while driving.
 * See knowledge/navi-tv.md.
 */

/** Below this the speed pulse reads as stopped (km/h). */
export const STOP_KMH = 1;
/** The car has set off once it passes this (km/h): above STOP_KMH, so a creep does not count. */
export const SET_OFF_KMH = 3;

/** What the navi's picture lock reads from the car. */
export type TvDrive = {
  kmh: number;
  /** The parking brake signal (サイドブレーキ, or 簡単操作's brake hold). */
  parkingBrake: boolean;
  /** Engine off (the key at ACC: the car cannot drive away). */
  engineOff: boolean;
};

/** The picture shows only with the car stopped and parked: the parking brake on, or the engine off. */
export function mayShowPicture(d: TvDrive): boolean {
  const isStopped = Math.abs(d.kmh) < STOP_KMH;
  const isParked = d.parkingBrake || d.engineOff;
  return isStopped && isParked;
}

/** `on`: the tuner plays (its sound); `screen`: what the driver chose to see on the navi. */
export type TvState = { on: boolean; screen: "map" | "tv"; channel: number };
export const TV_OFF: TvState = { on: false, screen: "map", channel: 0 };

/** The map, the programme, or 「走行中は映像を表示できません」 with the sound playing on. */
export type NaviView = "map" | "picture" | "blocked";

export function naviView(s: TvState, d: TvDrive): NaviView {
  const isMap = !s.on || s.screen === "map";
  if (isMap) return "map";
  return mayShowPicture(d) ? "picture" : "blocked";
}

/**
 * テレビ: from the map the TV comes on; from the TV it goes off; from the map with the TV's sound
 * playing (簡単操作 went back to the map) the TV shows again.
 */
export function pressTv(s: TvState): TvState {
  if (!s.on) return { ...s, on: true, screen: "tv" };
  if (s.screen === "map") return { ...s, screen: "tv" };
  return { ...s, on: false, screen: "map" };
}

/** チャンネル: the next channel (round), or the TV on at the channel it was last on. */
export function pressChannel(s: TvState, count = CHANNELS.length): TvState {
  if (!s.on) return { ...s, on: true, screen: "tv" };
  return { ...s, channel: (s.channel + 1) % count };
}

/**
 * Setting off is the moment the car passes SET_OFF_KMH after standing still (below STOP_KMH): a
 * car already moving when the TV is switched to does not set off again.
 */
export function trackSetOff(armed: boolean, kmh: number): { armed: boolean; setOff: boolean } {
  const speed = Math.abs(kmh);
  if (speed < STOP_KMH) return { armed: true, setOff: false };
  const setOff = armed && speed >= SET_OFF_KMH;
  return { armed: armed && !setOff, setOff };
}

/**
 * 簡単操作: as the car sets off with a route, the navi goes back to the map by itself (the sound
 * stays on, as navis keep the AV source playing behind the map). In リアル the driver switches.
 */
export function autoReturn(
  s: TvState,
  o: { assist: Assist; routeActive: boolean; setOff: boolean },
): TvState {
  const isDue = o.assist === "easy" && o.routeActive && o.setOff && s.on && s.screen === "tv";
  return isDue ? { ...s, screen: "map" } : s;
}

// ---------- channels (fictional: no real broadcaster's name, mark, programme or presenter) ----------

export type Programme = "news" | "weather" | "nature" | "colorBars";
export type Channel = { number: number; station: string };

/**
 * Remote-key numbers 10–12, above the 1–9 Tokyo's terrestrial stations are known by (why not 1, 4,
 * 6…: a news programme on one of those would read as that real station's).
 */
export const CHANNELS: readonly Channel[] = [
  { number: 10, station: "げんしゅテレビ" },
  { number: 11, station: "げんしゅ天気" },
  { number: 12, station: "げんしゅ自然" },
];

/**
 * The Japanese titles: Y's posters (socialTexts.ts) quote them as they are. The screen shows
 * programmeTitle() and stationName(), in the language in force.
 */
export const PROGRAMME_TITLE: Record<Programme, string> = {
  news: "げんしゅニュース",
  weather: "いまの23区",
  nature: "げんしゅ自然紀行",
  colorBars: "放送休止",
};

const STATION_KEY: readonly MessageKey[] = ["tv.station.news", "tv.station.weather", "tv.station.nature"];
const PROGRAMME_KEY: Record<Programme, MessageKey> = {
  news: "tv.programme.news",
  weather: "tv.programme.weather",
  nature: "tv.programme.nature",
  colorBars: "tv.programme.colorBars",
};

/** A channel's station in the language in force (「げんしゅテレビ」 / "Abide TV" / 「守法电视台」). */
export function stationName(channel: number): string {
  const key = STATION_KEY[channel];
  return key ? i18n.t(key) : (CHANNELS[channel]?.station ?? "");
}

/** "10ch げんしゅテレビ" / "Ch 10 Abide TV" / "10频道 守法电视台". */
export function channelLabel(channel: number): string {
  return i18n.t("tv.channel", { n: CHANNELS[channel]?.number ?? channel, station: stationName(channel) });
}

export function programmeTitle(p: Programme): string {
  return i18n.t(PROGRAMME_KEY[p]);
}

/** What a channel airs at a clock hour (JST): 12ch closes down 1:00–5:00 (the colour bars). */
export function programmeAt(channel: number, hour: number): Programme {
  if (channel === 0) return "news";
  if (channel === 1) return "weather";
  const isClosedDown = hour >= 1 && hour < 5;
  return isClosedDown ? "colorBars" : "nature";
}

// ---------- the news: a ticker from what the game knows ----------

export type Sky = "晴れ" | "くもり" | "雨" | "雨なし";

export type TvWeather = {
  raining: boolean;
  /** The sky is the game's setting (晴れ / 雨 / おまかせ), not the observation's. */
  fixedSky: boolean;
  night: boolean;
  // The observation at 北の丸公園 (null without one): real whatever the sky is set to.
  /** Sunshine in the last hour (h). */
  sun1h: number | null;
  temp: number | null;
  humidity: number | null;
  /** Rain in the last 10 minutes (mm). */
  precip10m: number | null;
  wind: number | null;
};

export type TvInfo = {
  /** Clock hour (JST) with the minutes as a fraction. */
  hour: number;
  /** Ward and town where the car is ("" when unknown). */
  place: string;
  ward: string;
  lat: number;
  lon: number;
  weather: TvWeather;
  /** The driver's own violations today, caught or not. */
  violations: Array<{ label: string; caught: boolean }>;
};

/** What an item is about (its picture on the monitor, the weather channel's pick); `tag` is its label. */
export type TickerKind = "time" | "place" | "weather" | "violations" | "safety";
/** `speech` is "" when the item is shown but not read (a place an English voice cannot say). */
export type TickerItem = { kind: TickerKind; tag: string; text: string; speech: string };

const TAG_KEY: Record<TickerKind, MessageKey> = {
  time: "tv.tag.time",
  place: "tv.tag.place",
  weather: "tv.tag.weather",
  violations: "tv.tag.violations",
  safety: "tv.tag.safety",
};
const item = (kind: TickerKind, text: string, speech: string): TickerItem => ({
  kind,
  tag: i18n.t(TAG_KEY[kind]),
  text,
  speech,
});

// Punctuation between the parts, which the dictionaries cannot hold (they keep no edge spaces):
// the ticker's items, the numbers of one item, a spoken list, two spoken sentences.
const TICKER_SEP: Record<Locale, string> = { ja: "　　◆　　", en: "   ◆   ", zh: "　　◆　　" };
const PART_SEP: Record<Locale, string> = { ja: "　", en: " · ", zh: "　" };
const SAID_SEP: Record<Locale, string> = { ja: "、", en: ", ", zh: "，" };
const LABEL_SEP: Record<Locale, string> = { ja: "・", en: ", ", zh: "、" };
const SENTENCE_SEP: Record<Locale, string> = { ja: "", en: " ", zh: "" };
const sentences = (...parts: string[]) => parts.filter(Boolean).join(SENTENCE_SEP[i18n.getLocale()]);
/** English sentences start with a capital; the others are left as they are. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const SKY_KEY: Record<Sky, MessageKey> = {
  晴れ: "tv.sky.clear",
  くもり: "tv.sky.cloudy",
  雨: "tv.sky.rain",
  雨なし: "tv.sky.dry",
};

/** The sky in the language in force: 晴れ / sunny / 晴. */
export function skyWord(sky: Sky): string {
  return i18n.t(SKY_KEY[sky]);
}

/**
 * The sky in a word. Sunshine says 晴れ or くもり by day; at night it says nothing, so only whether it
 * rains (why not くもり at night: the observation cannot tell).
 */
export function skyOf(w: TvWeather): Sky {
  if (w.raining) return "雨";
  if (w.fixedSky) return "晴れ";
  if (w.night || w.sun1h === null) return "雨なし";
  return w.sun1h >= 0.3 ? "晴れ" : "くもり";
}

const clock = (hour: number) => {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return { h, m };
};

/** 21 → 「21度」 / "21 degrees", −3 → 「氷点下3度」 / "minus 3 degrees" (the speech engine drops a minus sign). */
const degreesSpoken = (temp: number) => {
  const r = Math.round(temp);
  const n = Math.abs(r);
  if (r < 0) return i18n.t(n === 1 ? "tv.weather.degBelowOne" : "tv.weather.degBelow", { n });
  return i18n.t(n === 1 ? "tv.weather.degOne" : "tv.weather.deg", { n: r });
};

/** The time read aloud: 「10時5分」, "10:05" on a 12-hour clock in English (as people say it), 「10点5分」. */
function timeSpeech(h: number, m: number): string {
  const isEnglish = i18n.getLocale() === "en";
  const hour = isEnglish ? h % 12 || 12 : h;
  if (m === 0) return i18n.t("tv.time.speechHour", { h: hour });
  // English reads "10:05" as "ten oh five"; Japanese and Chinese say the minutes as a number.
  const minutes = isEnglish ? String(m).padStart(2, "0") : String(m);
  return i18n.t("tv.time.speech", { h: hour, m: minutes });
}

/**
 * The place read aloud: the e-Stat names as they are in Japanese and Chinese (a Chinese voice reads
 * the kanji); in English the ward's English name, or nothing when there is none.
 */
function placeSpeech(info: TvInfo): string {
  const isEnglish = i18n.getLocale() === "en";
  const place = isEnglish ? wardInEnglish(info.ward) : info.place.replace(" ", "");
  return place ? i18n.t("tv.place.speech", { place }) : "";
}

/** The news items, in the order they are read: the time, the place, the weather, the violations, a word on safety. */
export function tickerItems(info: TvInfo): TickerItem[] {
  const { h, m } = clock(info.hour);
  const items: TickerItem[] = [
    item("time", i18n.t("tv.time.text", { h, mm: String(m).padStart(2, "0") }), timeSpeech(h, m)),
  ];
  if (info.place)
    items.push(item("place", i18n.t("tv.place.text", { place: info.place }), placeSpeech(info)));
  items.push(weatherItem(info.weather));
  items.push(violationItem(info.violations));
  items.push(item("safety", i18n.t("tv.safety.text"), i18n.t("tv.safety.speech")));
  return items;
}

function weatherItem(w: TvWeather): TickerItem {
  const locale = i18n.getLocale();
  const sky = skyOf(w);
  const skyText = skyWord(sky);
  const numbers: string[] = [];
  const said: string[] = [];
  if (w.temp !== null) {
    numbers.push(i18n.t("tv.weather.temp", { t: w.temp.toFixed(1) }));
    said.push(i18n.t("tv.weather.saidTemp", { deg: degreesSpoken(w.temp) }));
  }
  if (w.humidity !== null) {
    numbers.push(i18n.t("tv.weather.humidity", { n: Math.round(w.humidity) }));
    said.push(i18n.t("tv.weather.saidHumidity", { n: Math.round(w.humidity) }));
  }
  // The observed rain only with the observed sky: under a set 晴れ it would contradict the screen.
  const rain = w.fixedSky ? 0 : (w.precip10m ?? 0);
  if (rain > 0) numbers.push(i18n.t("tv.weather.rain10", { n: rain }));
  if (w.wind !== null) numbers.push(i18n.t("tv.weather.wind", { n: w.wind.toFixed(1) }));
  const sep = PART_SEP[locale];
  const saidList = said.join(SAID_SEP[locale]);
  const observed = numbers.length > 0 ? i18n.t("tv.weather.observed", { list: numbers.join(sep) }) : "";
  if (w.fixedSky) {
    const text = [i18n.t("tv.weather.fixed", { sky: skyText }), observed].filter(Boolean).join(sep);
    const numbersSaid = said.length > 0 ? i18n.t("tv.weather.saidCentre", { said: saidList }) : "";
    return item("weather", text, sentences(i18n.t("tv.weather.speechFixed", { sky: skyText }), numbersSaid));
  }
  const text = i18n.t("tv.weather.observed", { list: [skyText, ...numbers].join(sep) });
  if (sky === "雨なし") {
    const numbersSaid = said.length > 0 ? capitalise(i18n.t("tv.weather.saidPlain", { said: saidList })) : "";
    return item("weather", text, sentences(i18n.t("tv.weather.speechDry"), numbersSaid));
  }
  const all = [i18n.t("tv.weather.saidSky", { sky: skyText }), ...said].join(SAID_SEP[locale]);
  return item("weather", text, capitalise(i18n.t("tv.weather.saidPlain", { said: all })));
}

function violationItem(list: TvInfo["violations"]): TickerItem {
  if (list.length === 0)
    return item("violations", i18n.t("tv.violations.none"), i18n.t("tv.violations.noneSpeech"));
  const locale = i18n.getLocale();
  // The labels in the language in force, each once, without their bracketed detail.
  const names = list.map((v) =>
    violationName(v.label)
      .replace(/（.*?）|\(.*?\)/g, "")
      .trim(),
  );
  const labels = [...new Set(names)];
  const listed = labels.slice(0, 3).join(LABEL_SEP[locale]);
  const shown = labels.length > 3 ? i18n.t("tv.violations.more", { list: listed }) : listed;
  const caught = list.filter((v) => v.caught).length;
  // Japanese reads the ・ of the list as a pause (、); the others already list with commas.
  const shownSaid = locale === "ja" ? shown.replace(/・/g, "、") : shown;
  return item(
    "violations",
    i18n.t("tv.violations.text", { n: list.length, shown, caught }),
    i18n.t("tv.violations.speech", { n: list.length, shown: shownSaid }),
  );
}

/** One line for the ticker: every item, its tag in brackets. */
export function tickerLine(items: TickerItem[]): string {
  return items
    .map((i) => i18n.t("tv.tickerItem", { tag: i.tag, text: i.text }))
    .join(TICKER_SEP[i18n.getLocale()]);
}

// ---------- sound: a quiet loop for each programme ----------

/** Loop lengths (s): every frequency below fits a whole number of cycles, so the loops join. */
const LOOP_S: Record<Programme, number> = { news: 4, weather: 4, nature: 6, colorBars: 1 };

/**
 * A programme's bed, peaking near 0.5: the news a soft chord, the weather a pizzicato arpeggio,
 * nature a brook with birds, the colour bars the 1 kHz line-up tone stations send with them.
 */
export function programmeBed(p: Programme, sampleRate: number): Float32Array {
  const n = Math.round(LOOP_S[p] * sampleRate);
  const out = new Float32Array(n);
  const tau = Math.PI * 2;
  if (p === "colorBars") {
    for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((tau * 1000 * i) / sampleRate);
    return out;
  }
  if (p === "news") {
    // A major chord on 0.25 Hz steps (A2 A3 C♯4 E4), swelling twice per loop.
    const chord = [110, 220, 277.25, 329.75];
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const swell = 0.75 + 0.25 * Math.sin(tau * 0.5 * t);
      let v = 0;
      for (const f of chord) v += Math.sin(tau * f * t);
      out[i] = (0.5 / chord.length) * swell * v;
    }
    return out;
  }
  if (p === "weather") {
    // Eight notes of a pentatonic arpeggio, each plucked and gone before its half second ends.
    const notes = [523.25, 659.25, 784, 880, 784, 659.25, 587.33, 659.25];
    const slot = Math.floor(n / notes.length);
    notes.forEach((f, k) => {
      for (let j = 0; j < slot; j++) {
        const t = j / sampleRate;
        const attack = Math.min(1, t / 0.005);
        const release = Math.min(1, (slot - j) / (0.01 * sampleRate));
        const env = attack * release * Math.exp(-t * 7);
        out[k * slot + j] = (0.5 * env * (Math.sin(tau * f * t) + 0.3 * Math.sin(tau * 2 * f * t))) / 1.3;
      }
    });
    return out;
  }
  // nature: a brook (noise through a one-pole low-pass, run twice round the loop so its end meets
  // its start) that rises and falls, and three bird calls.
  const noise = whiteNoise(n, 12);
  let y = 0;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      y += 0.08 * (noise[i] - y);
      if (pass === 1) {
        const t = i / sampleRate;
        const flow = 0.7 + 0.2 * Math.sin((tau * t) / 6) + 0.1 * Math.sin((tau * 3 * t) / 6);
        out[i] = 1.6 * y * flow;
      }
    }
  for (const at of [1.0, 1.22, 3.8]) {
    const start = Math.round(at * sampleRate);
    const len = Math.round(0.09 * sampleRate);
    let phase = 0;
    for (let j = 0; j < len && start + j < n; j++) {
      const k = j / len;
      phase += (tau * (3000 + 1200 * k)) / sampleRate;
      out[start + j] += 0.3 * Math.sin(Math.PI * k) ** 2 * Math.sin(phase);
    }
  }
  return out;
}

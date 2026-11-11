/**
 * The OSM tags of one signal record in public/data/signals (scripts/regulations.ts writes them,
 * TrafficControl reads them). A record is `[lon, lat]` (no tags kept: what every record was before
 * T3, and still is for most), `[lon, lat, flags]` or `[lon, lat, flags, bearing]`. Readers that take
 * only `[lon, lat]` (src/world/regulations.ts) keep working.
 *
 * Why bit flags and not an object per record: the 23 wards have about 20,000 records and the tile
 * files are fetched while driving; the other tile layers are number arrays too.
 */

/** Tag facts as bits of `flags`. */
export const SIGNAL_FLAG = {
  /** More than SIGNAL_JUNCTION_M from any OSM car-road junction node (scripts/osm-signals.ts). */
  awayFromJunction: 1,
  /** crossing=traffic_signals (or crossing:signals=yes): the signal controls a pedestrian crossing. */
  crossing: 2,
  /** No highway=traffic_signals on the node: only the crossing node is tagged. */
  crossingOnly: 4,
  buttonYes: 8,
  buttonNo: 16,
  soundYes: 32,
  soundNo: 64,
  /** crossing:scramble=yes or crossing_ref=pedestrian_scramble: 歩車分離 with the diagonal (T4). */
  scramble: 128,
  /** button_operated=night: push-button at night only (T4). */
  buttonNight: 256,
  /** traffic_signals=blinker (always), or traffic_signals:conditional=blinker @ (window) (T4). */
  flash: 512,
  /** 夜間点滅式 (a traffic_signals value or the whole note) with no hours given (T4). */
  flashNight: 1024,
  /** The note says this direction flashes red (赤点滅) / yellow (黄色点滅, 黄点滅) (T4). */
  flashHintRed: 2048,
  flashHintYellow: 4096,
  /** 時差式: (traffic_signals:)designation=時差式, or 時差式 in the note (T4). */
  staggered: 8192,
  /** The note says this direction's green ends first (先に…) / later (後から…, 遅れて…). */
  staggeredFirst: 16384,
  staggeredLater: 32768,
} as const;

export { SIGNAL_JUNCTION_M } from "./siting";

export type SignalTags = {
  /** A pedestrian crossing's signal away from any junction (単路の横断歩道). */
  midBlock: boolean;
  /** crossing=traffic_signals on the node. */
  crossing: boolean;
  /** A highway=traffic_signals node (the only kind used to signal a junction, as before T3). */
  junctionCapable: boolean;
  /** More than SIGNAL_JUNCTION_M from an OSM junction (whatever it controls). */
  awayFromJunction: boolean;
  /** button_operated: yes / no / not tagged. */
  button: boolean | null;
  /** traffic_signals:sound: yes (also walk, locate) / no / not tagged. */
  sound: boolean | null;
  /** The travel bearing (degrees from north, clockwise) traffic_signals:direction gives, if any. */
  bearing: number | null;
  /** What the node says of the plan (T4: 歩車分離, 夜間の押ボタン・点滅, 時差式). */
  phase: SignalPhaseFacts;
};

/**
 * The plan facts (T4) one node carries. `flash`: "always" (traffic_signals=blinker), "window"
 * (traffic_signals:conditional=blinker @ (HH:MM-HH:MM), the minutes in `flashWindow`), "night"
 * (夜間点滅式 with no hours: the game's assumed night, assign.ts). `flashHint` and `staggered`
 * come from free-text notes and say something only with a `bearing` (the direction they are for).
 */
export type SignalPhaseFacts = {
  scramble: boolean;
  buttonNight: boolean;
  flash: "always" | "window" | "night" | null;
  /** Minutes after midnight, [from, to); `to` < `from` runs past midnight. */
  flashWindow: readonly [number, number] | null;
  flashHint: "red" | "yellow" | null;
  /** 時差式: whether this direction's green ends first, later, or the node does not say. */
  staggered: "first" | "later" | "unknown" | null;
};

export const NO_PHASE: SignalPhaseFacts = {
  scramble: false,
  buttonNight: false,
  flash: null,
  flashWindow: null,
  flashHint: null,
  staggered: null,
};

/** One record as the game holds it: where the node is (lon/lat, for stable hashes) and its tags. */
export type SignalRecord = { lon: number; lat: number; tags: SignalTags };

/** What the tags were before any were kept (a two-number record): a junction signal, nothing known. */
export const UNTAGGED: SignalTags = {
  midBlock: false,
  crossing: false,
  junctionCapable: true,
  awayFromJunction: false,
  button: null,
  sound: null,
  bearing: null,
  phase: NO_PHASE,
};

const triState = (flags: number, yes: number, no: number): boolean | null =>
  (flags & yes) !== 0 ? true : (flags & no) !== 0 ? false : null;

const has = (flags: number, bit: number) => (flags & bit) !== 0;

/** The T4 facts of a record's flags and its window (`record[4]`, `record[5]`). */
function decodePhase(flags: number, record: readonly number[]): SignalPhaseFacts {
  const from = record[4];
  const to = record[5];
  const hasWindow = typeof from === "number" && typeof to === "number" && from >= 0 && to >= 0;
  const flashKind = (): SignalPhaseFacts["flash"] => {
    if (has(flags, SIGNAL_FLAG.flash)) return hasWindow ? "window" : "always";
    return has(flags, SIGNAL_FLAG.flashNight) ? "night" : null;
  };
  const staggeredKind = (): SignalPhaseFacts["staggered"] => {
    if (!has(flags, SIGNAL_FLAG.staggered)) return null;
    if (has(flags, SIGNAL_FLAG.staggeredFirst)) return "first";
    return has(flags, SIGNAL_FLAG.staggeredLater) ? "later" : "unknown";
  };
  const flash = flashKind();
  const flashHint = has(flags, SIGNAL_FLAG.flashHintRed)
    ? "red"
    : has(flags, SIGNAL_FLAG.flashHintYellow)
      ? "yellow"
      : null;
  return {
    scramble: has(flags, SIGNAL_FLAG.scramble),
    buttonNight: has(flags, SIGNAL_FLAG.buttonNight),
    flash,
    flashWindow: flash === "window" ? [from, to] : null,
    flashHint,
    staggered: staggeredKind(),
  };
}

/** The tags of one record (`[lon, lat, flags?, bearing?, flashFrom?, flashTo?]`). */
export function decodeSignalTags(record: readonly number[]): SignalTags {
  const flags = record[2];
  const hasFlags = typeof flags === "number" && Number.isInteger(flags) && flags >= 0;
  if (!hasFlags) return UNTAGGED;
  const crossing = (flags & SIGNAL_FLAG.crossing) !== 0;
  const awayFromJunction = (flags & SIGNAL_FLAG.awayFromJunction) !== 0;
  const bearing = record[3];
  return {
    midBlock: crossing && awayFromJunction,
    crossing,
    junctionCapable: (flags & SIGNAL_FLAG.crossingOnly) === 0,
    awayFromJunction,
    button: triState(flags, SIGNAL_FLAG.buttonYes, SIGNAL_FLAG.buttonNo),
    sound: triState(flags, SIGNAL_FLAG.soundYes, SIGNAL_FLAG.soundNo),
    bearing: typeof bearing === "number" && bearing >= 0 ? bearing : null,
    phase: decodePhase(flags, record),
  };
}

/** The OSM facts the extractor finds on one node. */
export type SignalNodeFacts = {
  isHighwaySignal: boolean;
  isCrossing: boolean;
  awayFromJunction: boolean;
  button: boolean | null;
  sound: boolean | null;
  bearing: number | null;
  /** The T4 facts (phaseOf); absent: none. */
  phase?: SignalPhaseFacts;
};

/** The phase bits of `phase`. */
function phaseFlags(phase: SignalPhaseFacts): number {
  let flags = 0;
  if (phase.scramble) flags |= SIGNAL_FLAG.scramble;
  if (phase.buttonNight) flags |= SIGNAL_FLAG.buttonNight;
  const isAlwaysOrTimed = phase.flash === "always" || phase.flash === "window";
  if (isAlwaysOrTimed) flags |= SIGNAL_FLAG.flash;
  if (phase.flash === "night") flags |= SIGNAL_FLAG.flashNight;
  if (phase.flashHint === "red") flags |= SIGNAL_FLAG.flashHintRed;
  if (phase.flashHint === "yellow") flags |= SIGNAL_FLAG.flashHintYellow;
  if (phase.staggered !== null) flags |= SIGNAL_FLAG.staggered;
  if (phase.staggered === "first") flags |= SIGNAL_FLAG.staggeredFirst;
  if (phase.staggered === "later") flags |= SIGNAL_FLAG.staggeredLater;
  return flags;
}

/**
 * The record for one node: `[lon, lat]` when nothing is known beyond the position, then flags,
 * the bearing (-1 when there is none but a window follows) and a flashing window's minutes.
 */
export function encodeSignalRecord(lon: number, lat: number, facts: SignalNodeFacts): number[] {
  const phase = facts.phase ?? NO_PHASE;
  let flags = phaseFlags(phase);
  if (facts.awayFromJunction) flags |= SIGNAL_FLAG.awayFromJunction;
  if (facts.isCrossing) flags |= SIGNAL_FLAG.crossing;
  if (!facts.isHighwaySignal) flags |= SIGNAL_FLAG.crossingOnly;
  if (facts.button === true) flags |= SIGNAL_FLAG.buttonYes;
  if (facts.button === false) flags |= SIGNAL_FLAG.buttonNo;
  if (facts.sound === true) flags |= SIGNAL_FLAG.soundYes;
  if (facts.sound === false) flags |= SIGNAL_FLAG.soundNo;
  const window = phase.flash === "window" ? phase.flashWindow : null;
  if (window) return [lon, lat, flags, facts.bearing ?? -1, window[0], window[1]];
  if (facts.bearing !== null) return [lon, lat, flags, facts.bearing];
  return flags === 0 ? [lon, lat] : [lon, lat, flags];
}

/** "HH:MM" as minutes after midnight (24:00 is 0), or null. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  const isInDay = minutes <= 24 * 60 && Number(m[2]) < 60;
  return isInDay ? minutes % (24 * 60) : null;
}

/**
 * The T4 facts of one node's OSM tags. Structured tags first: crossing:scramble /
 * crossing_ref=pedestrian_scramble, button_operated=night, traffic_signals=blinker,
 * traffic_signals:conditional=blinker @ (HH:MM-HH:MM), (traffic_signals:)designation=時差式. Then
 * the only free text read, the `note` (and 夜間点滅式 as a traffic_signals value): 夜間点滅式 as the
 * whole note, 赤点滅 / 黄色点滅・黄点滅 (the colour this direction flashes), 時差式 with 先に or
 * 後から・遅れて (whether this direction's green ends first). Why read notes at all: in the 23 wards
 * mappers write 時差式 and the flashing colour only there (knowledge/signal-system.md, the T4
 * census); the patterns are the few phrases found there, not a reading of free Japanese.
 */
export function phaseOf(tags: Record<string, string>): SignalPhaseFacts {
  const note = tags.note ?? "";
  const conditional = /^blinker\s*@\s*\((\d{1,2}:\d{2})-(\d{1,2}:\d{2})\)$/.exec(
    (tags["traffic_signals:conditional"] ?? "").trim(),
  );
  const from = conditional ? minutesOf(conditional[1]) : null;
  const to = conditional ? minutesOf(conditional[2]) : null;
  const window: [number, number] | null = from !== null && to !== null && from !== to ? [from, to] : null;
  const isBlinker = tags.traffic_signals === "blinker";
  const isNightFlash = tags.traffic_signals === "夜間点滅式" || note.trim() === "夜間点滅式";
  const flash = isBlinker ? "always" : window ? "window" : isNightFlash ? "night" : null;
  const isStaggered =
    tags.designation === "時差式" ||
    tags["traffic_signals:designation"] === "時差式" ||
    note.includes("時差式");
  const staggeredKind = (): SignalPhaseFacts["staggered"] => {
    if (!isStaggered) return null;
    if (note.includes("先に")) return "first";
    return /後から|遅れて/.test(note) ? "later" : "unknown";
  };
  return {
    scramble: tags["crossing:scramble"] === "yes" || tags.crossing_ref === "pedestrian_scramble",
    buttonNight: tags.button_operated === "night",
    flash,
    flashWindow: flash === "window" ? window : null,
    flashHint: note.includes("赤点滅") ? "red" : /黄色?点滅/.test(note) ? "yellow" : null,
    staggered: staggeredKind(),
  };
}

/** Whether a node's T4 facts say anything (the tiles keep such crossing nodes, osm-signals.ts). */
export const hasPhaseFacts = (phase: SignalPhaseFacts): boolean =>
  phase.scramble ||
  phase.buttonNight ||
  phase.flash !== null ||
  phase.flashHint !== null ||
  phase.staggered !== null;

/**
 * OSM button_operated as a tri-state: yes → true, no → false; anything else (night, optional,
 * untagged) unknown. Why not night as yes: it is push-button only at night, and the game's
 * mid-block plans do not switch by time of day.
 */
export function buttonOf(tags: Record<string, string>): boolean | null {
  const v = tags.button_operated;
  return v === "yes" ? true : v === "no" ? false : null;
}

/**
 * OSM traffic_signals:sound as the game's 音響式 (a guide call while walkers may go): yes and walk
 * → true, no → false. `locate` (a locator tone that only says where the pole is, 10 nodes in the
 * 23 wards) is not that call, so it counts as untagged and the default rule applies.
 */
export function soundOf(tags: Record<string, string>): boolean | null {
  const v = tags["traffic_signals:sound"];
  if (v === "no") return false;
  return v === "yes" || v === "walk" ? true : null;
}

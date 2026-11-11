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
};

const triState = (flags: number, yes: number, no: number): boolean | null =>
  (flags & yes) !== 0 ? true : (flags & no) !== 0 ? false : null;

/** The tags of one record (`[lon, lat, flags?, bearing?]`). */
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
};

/** The record for one node: `[lon, lat]` when nothing is known beyond the position. */
export function encodeSignalRecord(lon: number, lat: number, facts: SignalNodeFacts): number[] {
  let flags = 0;
  if (facts.awayFromJunction) flags |= SIGNAL_FLAG.awayFromJunction;
  if (facts.isCrossing) flags |= SIGNAL_FLAG.crossing;
  if (!facts.isHighwaySignal) flags |= SIGNAL_FLAG.crossingOnly;
  if (facts.button === true) flags |= SIGNAL_FLAG.buttonYes;
  if (facts.button === false) flags |= SIGNAL_FLAG.buttonNo;
  if (facts.sound === true) flags |= SIGNAL_FLAG.soundYes;
  if (facts.sound === false) flags |= SIGNAL_FLAG.soundNo;
  if (facts.bearing !== null) return [lon, lat, flags, facts.bearing];
  return flags === 0 ? [lon, lat] : [lon, lat, flags];
}

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

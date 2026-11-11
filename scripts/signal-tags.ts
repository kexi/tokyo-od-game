// The census of OSM signal tags in the 23 wards (knowledge/signal-system.md, T3): every
// highway=traffic_signals and crossing=traffic_signals node, how many carry each tag the signal
// system could use, and how many are 単路 (mid-block) crossings. Reads the OSM extract that
// `just fetch-regs` caches (.cache/osm); it downloads nothing.
// Run: just count-signal-tags
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../src/log.ts";
import { readSignalNodes } from "./osm-signals.ts";
import { SIGNAL_JUNCTION_M } from "../src/signals/siting.ts";
import { readReplicationTimestamp } from "./osm-pbf.ts";

const OSM_CACHE = join(import.meta.dirname, "..", ".cache", "osm", "kanto-latest.osm.pbf");
// The same box as scripts/regulations.ts (the 23 wards with a little margin).
const BBOX = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
const inBbox = (lon: number, lat: number) =>
  lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;
/** The tags counted value by value (the rest of a node's tags are names, notes and surveys). */
const KEYS = [
  "traffic_signals",
  "traffic_signals:direction",
  "button_operated",
  "traffic_signals:sound",
  "traffic_signals:vibration",
  "traffic_signals:countdown",
  "traffic_signals:turn",
  "crossing",
  "crossing:signals",
  "crossing:island",
  "crossing:markings",
  "crossing_ref",
  "crossing:scramble",
];

const file = new Uint8Array(await readFile(OSM_CACHE));
const nodes = readSignalNodes(file, inBbox);
const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};
const byKind: Record<string, number> = {};
const byTag: Record<string, number> = {};
const midBlock: Record<string, number> = {};
for (const s of nodes) {
  const { facts, onCarRoad, junctionM } = s;
  const what = facts.isHighwaySignal ? (facts.isCrossing ? "signal+crossing" : "signal") : "crossingOnly";
  const where = !onCarRoad
    ? "offCarRoad"
    : junctionM === 0
      ? "atJunction"
      : junctionM <= SIGNAL_JUNCTION_M
        ? `within${SIGNAL_JUNCTION_M}m`
        : `beyond${SIGNAL_JUNCTION_M}m`;
  bump(byKind, `${what}/${where}`);
  for (const key of KEYS) {
    const value = s.node.tags[key];
    if (value !== undefined) bump(byTag, `${key}=${value}`);
  }
  const isMidBlock = facts.isCrossing && facts.awayFromJunction;
  if (!isMidBlock) continue;
  bump(midBlock, "nodes");
  bump(midBlock, `button=${facts.button ?? "untagged"}`);
  bump(midBlock, `sound=${facts.sound ?? "untagged"}`);
  bump(midBlock, `direction=${s.node.tags["traffic_signals:direction"] ?? "untagged"}`);
}
log("signal_tags_counted", {
  extract: readReplicationTimestamp(file) ?? "unknown",
  nodes: nodes.length,
  byKind,
  byTag,
  midBlock,
});

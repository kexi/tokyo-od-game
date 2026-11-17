// The compiler's input as scripts/expressway.ts reads it from the pinned OSM extract: the structures
// the landmark build pinned, and the motorways (and the structures' streets) of the universe as a
// Network. Shared with the probes that read the plan without solving it (scripts/expresswayScopeProbe.ts),
// so a probe plans the very runs the build does.
// Why a module and not a probe of its own reading: the plan (chains, run ids, the operator's ways)
// follows from every filter here, and a second copy that drifted would measure another plan.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bbox } from "../src/expressway/compile.ts";
import {
  type Network,
  normalizeNode,
  normalizeStreetWay,
  normalizeWay,
  type XwNode,
  type XwWay,
} from "../src/expressway/network.ts";
import { STRUCTURE_SPECS, type Structure, structureFrom } from "../src/expressway/structures.ts";
import { log, warn } from "../src/log.ts";
import { deckLevelsOf } from "../src/world/deckLevels.ts";
import { type OsmNode, readNodeCoords, readTaggedNodes, readWays, readWaysById } from "./osm-pbf.ts";

/**
 * The ways the compiler knows about: the 23 wards with a margin. Fixed, so a chain (and every id
 * derived from it) is the same whichever --range is built.
 */
export const UNIVERSE: Bbox = { minLon: 139.5, minLat: 35.45, maxLon: 139.98, maxLat: 35.87 };

const inBox = (b: Bbox, lon: number, lat: number) =>
  lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;

/** 非常駐車帯 where OSM maps them (highway=emergency_bay, or emergency=emergency_bay). */
export const isBay = (t: Record<string, string>) =>
  t.highway === "emergency_bay" || t.emergency === "emergency_bay";

/**
 * The structures: the deck levels the landmark build wrote. Without them the bridge is compiled as an
 * ordinary viaduct (warned), never pinned to numbers that do not parse. `use` false builds without
 * them (--no-structures).
 */
export async function readStructures(use: boolean): Promise<Structure[]> {
  const LANDMARKS = join(import.meta.dirname, "..", "public", "data", "landmarks.json");
  const landmarkEntries = JSON.parse(await readFile(LANDMARKS, "utf8")) as Array<{
    id: string;
    deckLevels?: unknown;
  }>;
  const structures: Structure[] = [];
  for (const spec of use ? STRUCTURE_SPECS : []) {
    const entry = landmarkEntries.find((e) => e.id === spec.landmark);
    const levels = entry ? deckLevelsOf(entry) : null;
    if (!levels) {
      warn("expressway_structure_missing", { landmarkId: spec.landmark, hasEntry: entry !== undefined });
      continue;
    }
    structures.push(structureFrom(spec, levels));
  }
  return structures;
}

export type ExpresswayInput = {
  net: Network;
  /** The nodes where a chain leaves the universe (its way continues outside): those ends are free. */
  outsideNodes: Set<number>;
  /** emergency=phone nodes and the bays in the universe (G6, 116の4・116の6). */
  phoneOrBay: OsmNode[];
  /** The street ways the structures name (their lower floors). */
  streetIds: Set<number>;
};

/** The motorways of the universe and the structures' streets, read from the extract (logs expressway_osm_read). */
export function readExpresswayInput(file: Uint8Array, structures: readonly Structure[]): ExpresswayInput {
  const isMotorway = (t: Record<string, string>) => t.highway === "motorway" || t.highway === "motorway_link";
  const allWays = readWays(file, isMotorway);
  const coords = readNodeCoords(file, new Set(allWays.flatMap((w) => w.refs)));
  const junctionTags = new Map(
    readTaggedNodes(file, (t) => t.highway === "motorway_junction").map((n) => [n.id, n.tags]),
  );
  const phoneOrBay = readTaggedNodes(file, (t) => t.emergency === "phone" || isBay(t)).filter((n) =>
    inBox(UNIVERSE, n.lon, n.lat),
  );
  const universe = allWays.filter((w) =>
    w.refs.some((r) => {
      const c = coords.get(r);
      return c !== undefined && inBox(UNIVERSE, c[0], c[1]);
    }),
  );
  const universeIds = new Set(universe.map((w) => w.id));
  const nodes = new Map<number, XwNode>();
  const ways = new Map<number, XwWay>();
  for (const w of universe) {
    const hasAllCoords = w.refs.every((r) => coords.has(r));
    if (!hasAllCoords || w.refs.length < 2) continue;
    ways.set(w.id, normalizeWay(w.id, w.refs, w.tags));
    for (const r of w.refs) {
      const [lon, lat] = coords.get(r)!;
      nodes.set(r, normalizeNode(r, lon, lat, junctionTags.get(r) ?? {}));
    }
  }
  // A chain that leaves the universe ends where its way continues outside: that end is left free.
  const outsideNodes = new Set<number>();
  for (const w of allWays) {
    if (universeIds.has(w.id)) continue;
    for (const r of [w.refs[0], w.refs[w.refs.length - 1]]) if (nodes.has(r)) outsideNodes.add(r);
  }
  // The streets a structure names (its lower floor): read by id, compiled as `street` decks.
  const streetIds = new Set(structures.flatMap((st) => st.streetWays));
  const streetWays = streetIds.size > 0 ? readWaysById(file, streetIds) : [];
  const missingStreets = [...streetIds].filter((id) => !streetWays.some((w) => w.id === id));
  if (missingStreets.length > 0)
    throw new Error(`structure street ways not in the extract: ${missingStreets.join(", ")}`);
  const streetCoords = readNodeCoords(file, new Set(streetWays.flatMap((w) => w.refs)));
  for (const w of streetWays) {
    ways.set(w.id, normalizeStreetWay(w.id, w.refs, w.tags));
    for (const r of w.refs) {
      const [lon, lat] = streetCoords.get(r)!;
      nodes.set(r, nodes.get(r) ?? normalizeNode(r, lon, lat, {}));
    }
  }
  log("expressway_osm_read", {
    ways: allWays.length,
    universeWays: ways.size,
    nodes: nodes.size,
    junctions: [...nodes.values()].filter((n) => n.junctionName !== null || n.junctionRef !== null).length,
  });
  return { net: { ways, nodes }, outsideNodes, phoneOrBay, streetIds };
}

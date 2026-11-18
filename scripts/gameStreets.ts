// The street network the game builds round a point, for the Node tools that judge street lanes
// against the expressway's sites (the lanes probe, the hole probe, measureStreetBands; P2.7 R1-2-0):
// GSI's z16 tiles from the cache, the expressway joined in (joinExpressway), the graph built and the
// regulations applied as the worker does (computeRoadNetwork: JARTIC 車両通行帯 and one-way, OSM
// lanes). Why one module: the probes counted lanes on a graph without regulations (every street one
// lane), so they judged lanes the game never draws; R1-2's measure found the wide streets at 2–5
// lanes. One reader keeps the three tools on the game's network.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { latToTileY, lonToTileX } from "../src/geo/tiles.ts";
import type { LocalFrame } from "../src/geo/frame.ts";
import { joinExpressway, type XwRoadInput } from "../src/world/expresswayRoads.ts";
import { applyRegulations, type AppliedRegulations, type RegulationData } from "../src/world/regulations.ts";
import { RoadGraph, type RoadLine } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, roadLinesOfTile } from "../src/world/roadTiles.ts";

const ROOT = join(import.meta.dirname, "..");
/** The data folder the game fetches its regulation tiles from (RegulationTiles). */
export const DATA_DIR = join(ROOT, "public", "data");
/** The tile zoom the regulations are cut at (regulations.ts REG_ZOOM). */
const REG_ZOOM = 14;
/** The OSM folders RegulationTiles.around reads besides JARTIC's regs. */
const OSM_DIRS = ["signals", "junctions", "footbridges", "turnlanes", "roadlanes"] as const;

/** GSI's street lines of one z16 tile from a cache folder: null when the tile is not cached. */
export function gsiTileReader(cacheDir: string): (x: number, y: number) => Promise<RoadLine[] | null> {
  const tiles = new Map<string, RoadLine[] | null>();
  return async (x, y) => {
    const key = `${x}-${y}`;
    if (tiles.has(key)) return tiles.get(key)!;
    const bytes = await readFile(join(cacheDir, `${ROAD_TILE_ZOOM}-${key}.pbf`)).catch(() => null);
    const lines =
      bytes === null
        ? null
        : bytes.length === 0
          ? []
          : roadLinesOfTile(new VectorTile(new Pbf(new Uint8Array(bytes))), x, y);
    tiles.set(key, lines);
    return lines;
  };
}

/** The z16 tile a point is in. */
export const roadTileOf = (lon: number, lat: number): [number, number] => [
  Math.floor(lonToTileX(lon, ROAD_TILE_ZOOM)),
  Math.floor(latToTileY(lat, ROAD_TILE_ZOOM)),
];

export const emptyRegulations = (): RegulationData => ({
  speed: [],
  speedZone: [],
  oneway: [],
  crosswalk: [],
  stopLine: [],
  stopSign: [],
  sections: [],
  turns: [],
  closures: [],
  noOvertake: [],
  lanes: [],
  noLaneChange: [],
  laneArrows: [],
  signals: [],
  junctions: [],
  footbridges: [],
  turnlanes: [],
  roadlanes: [],
});

const readJson = async (dir: string, path: string) =>
  JSON.parse(await readFile(join(dir, path), "utf8")) as unknown;

/**
 * RegulationTiles.around from the files of a data folder: the z14 tiles under the 3 × 3 z16 tiles
 * round tile (cx, cy), each record once. Null when the folder has no regulation index (data not
 * fetched): the tools then build the network as before, from the widths alone.
 */
export function regulationReader(
  dataDir = DATA_DIR,
): (cx: number, cy: number) => Promise<RegulationData | null> {
  const index = new Map<string, Promise<Set<string> | null>>();
  const tileIndex = (dir: string) => {
    let p = index.get(dir);
    if (!p) {
      p = readFile(join(dataDir, dir, "meta.json"), "utf8")
        .then((text) => new Set((JSON.parse(text) as { tiles?: string[] }).tiles ?? []))
        .catch(() => null);
      index.set(dir, p);
    }
    return p;
  };
  return async (cx, cy) => {
    const regs = await tileIndex("regs");
    if (regs === null) return null;
    const shift = 2 ** (ROAD_TILE_ZOOM - REG_ZOOM);
    const keys = new Set<string>();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        keys.add(`${Math.floor((cx + dx) / shift)}-${Math.floor((cy + dy) / shift)}`);
    const out = emptyRegulations();
    const seen = new Map<unknown[], Set<string>>();
    const add = (list: unknown[], items: unknown[]) => {
      const listed = seen.get(list) ?? new Set<string>();
      seen.set(list, listed);
      for (const item of items) {
        // Lines crossing a tile edge are stored in every tile they touch.
        const key = JSON.stringify(item);
        if (listed.has(key)) continue;
        listed.add(key);
        list.push(item);
      }
    };
    for (const key of [...keys].toSorted()) {
      if (regs.has(key)) {
        const t = (await readJson(dataDir, `regs/${key}.json`)) as Record<string, unknown[]>;
        for (const k of Object.keys(t)) add((out as Record<string, unknown[]>)[k], t[k]);
      }
      for (const dir of OSM_DIRS) {
        const has = (await tileIndex(dir))?.has(key) ?? false;
        if (!has) continue;
        add(out[dir] as unknown[], (await readJson(dataDir, `${dir}/${key}.json`)) as unknown[]);
      }
    }
    return out;
  };
}

/**
 * The network as the worker builds it (computeRoadNetwork): the expressway joined into the streets,
 * the graph, and the regulations on it when given (null: the sections from the widths alone).
 */
export function gameStreetGraph(
  streets: readonly RoadLine[],
  xw: XwRoadInput,
  frame: LocalFrame,
  regs: RegulationData | null,
): { graph: RoadGraph; applied: AppliedRegulations | null } {
  const joined = joinExpressway(streets, xw, () => {});
  const graph = new RoadGraph(joined, frame, () => {});
  const applied = regs === null ? null : applyRegulations(graph, regs, frame, () => {});
  // One-way as the section was resolved (regulations.ts streetSectionOf takes the rule's direction
  // whenever one is matched). Why not RoadGraph.setClock at some hour: a timed rule then splits the
  // one-way section as a two-way street, lanes the game draws at no hour.
  for (const seg of graph.segments) seg.oneway = seg.onewayRule?.dir ?? seg.line.oneway;
  return { graph, applied };
}

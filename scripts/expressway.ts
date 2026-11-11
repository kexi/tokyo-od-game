// Build-time expressway compiler (knowledge/road-redesign-plan.md 4): OSM motorway / motorway_link from the Geofabrik Kanto
// extract → plan and vertical alignment within 道路構造令 (src/expressway/) → public/data/expressway/
// <x>-<y>.json (z14 tiles of ≤ 300 m chunks) and meta.json. The ground constraints read GSI DEM
// tiles exactly as the game does (scripts/demTiles.ts), cached under .cache/gsi-dem.
// Run: pnpm exec tsx scripts/expressway.ts [--range hamazakibashi,rainbow|all] [--pbf <path>] [--out <dir>]
// (--range takes one or more named ranges joined by commas; the default is DEFAULT_RANGES.)
// Structure overrides (src/expressway/structures.ts): the deck levels of the landmarks in
// public/data/landmarks.json (レインボーブリッジ) pin the decks they carry, and the street ways they
// name are compiled too. Build order: landmarks (just make-all-landmark-models) → this script.
// (--out writes somewhere else than public/data/expressway, e.g. to measure --range all.)
// (the OSM extract is the one just fetch-regs caches in .cache/osm; it is downloaded if missing).
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareChunks, DEFAULT_RANGES, parseRanges, RANGES } from "../src/expressway/ranges.ts";
import { STRUCTURE_SPECS, type Structure, structureFrom } from "../src/expressway/structures.ts";
import { deckLevelsOf, DECK_LEVELS_VERSION } from "../src/world/deckLevels.ts";
import {
  type Bbox,
  type CrossObject,
  groundPoints,
  planNetwork,
  solvePlan,
} from "../src/expressway/compile.ts";
import {
  CROSS_STRIDE,
  PIER_STRIDE,
  STATION_STRIDE,
  type XwMeta,
  XW_VERSION,
  type XwTile,
} from "../src/expressway/format.ts";
import { tileKey } from "../src/expressway/geo.ts";
import { planSigns } from "../src/expressway/signPlan.ts";
import {
  type Network,
  normalizeNode,
  normalizeStreetWay,
  normalizeWay,
  type XwNode,
  type XwWay,
} from "../src/expressway/network.ts";
import { log, warn } from "../src/log.ts";
import { BuildDem } from "./demTiles.ts";
import {
  readNodeCoords,
  readNodeCoordsWhere,
  readReplicationTimestamp,
  readTaggedNodes,
  readWays,
  readWaysById,
} from "./osm-pbf.ts";

const started = performance.now();
const OUT_DEFAULT = join(import.meta.dirname, "..", "public", "data", "expressway");
const OSM_EXTRACT = "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf";
const OSM_CACHE = join(import.meta.dirname, "..", ".cache", "osm", "kanto-latest.osm.pbf");
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";
const Z = 14;
/**
 * The ways the compiler knows about: the 23 wards with a margin. Fixed, so a chain (and every id
 * derived from it) is the same whichever --range is built.
 */
const UNIVERSE: Bbox = { minLon: 139.5, minLat: 35.45, maxLon: 139.98, maxLat: 35.87 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function extract(path: string): Promise<Uint8Array> {
  const isCached = await stat(path).then(
    (s) => s.size > 0,
    () => false,
  );
  if (!isCached) {
    log("download", { url: OSM_EXTRACT });
    const res = await fetch(OSM_EXTRACT, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`${OSM_EXTRACT}: HTTP ${res.status}`);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array(await res.arrayBuffer()));
  }
  return new Uint8Array(await readFile(path));
}

const inBox = (b: Bbox, lon: number, lat: number) =>
  lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;

const rangeArg = arg("range") ?? DEFAULT_RANGES.join(",");
const { names: rangeNames, boxes: ranges } = parseRanges(arg("range"));

// 0. Structures: the deck levels the landmark build wrote. Without them the bridge is compiled as an
// ordinary viaduct (warned), never pinned to numbers that do not parse.
const LANDMARKS = join(import.meta.dirname, "..", "public", "data", "landmarks.json");
const landmarkEntries = JSON.parse(await readFile(LANDMARKS, "utf8")) as Array<{
  id: string;
  deckLevels?: unknown;
}>;
const structures: Structure[] = [];
// --no-structures builds without them (to compare a bridge pinned to its levels with the plain viaduct).
const useStructures = !process.argv.includes("--no-structures");
for (const spec of useStructures ? STRUCTURE_SPECS : []) {
  const entry = landmarkEntries.find((e) => e.id === spec.landmark);
  const levels = entry ? deckLevelsOf(entry) : null;
  if (!levels) {
    warn("expressway_structure_missing", { landmarkId: spec.landmark, hasEntry: entry !== undefined });
    continue;
  }
  structures.push(structureFrom(spec, levels));
}
const pbfPath = arg("pbf") ?? OSM_CACHE;
const OUT = arg("out") ?? OUT_DEFAULT;
const file = await extract(pbfPath);
const timestamp = readReplicationTimestamp(file);

// 1. Motorways of the region, and those of the universe.
const isMotorway = (t: Record<string, string>) => t.highway === "motorway" || t.highway === "motorway_link";
const allWays = readWays(file, isMotorway);
const coords = readNodeCoords(file, new Set(allWays.flatMap((w) => w.refs)));
const junctionTags = new Map(
  readTaggedNodes(file, (t) => t.highway === "motorway_junction").map((n) => [n.id, n.tags]),
);
// 非常電話 and 非常駐車帯 for 116の4・116の6 (G6): OSM's emergency=phone nodes, and the bays where
// OSM maps them (highway=emergency_bay, or emergency=emergency_bay).
const isBay = (t: Record<string, string>) => t.highway === "emergency_bay" || t.emergency === "emergency_bay";
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
const net: Network = { ways, nodes };
log("expressway_osm_read", {
  ways: allWays.length,
  universeWays: ways.size,
  nodes: nodes.size,
  junctions: [...nodes.values()].filter((n) => n.junctionName !== null || n.junctionRef !== null).length,
});

// 2. Plan alignment and what the range depends on.
const plan = planNetwork(net, outsideNodes, ranges, structures);
log("expressway_planned", {
  chains: plan.chains.size,
  runs: plan.runs.size,
  wanted: plan.wanted.size,
  needed: plan.needed.length,
  crossings: plan.crossings.length,
});

// 3. The ground under the needed runs.
const dem = new BuildDem();
const points = groundPoints(plan);
const demTiles = await dem.prefetch(points);
log("expressway_dem_ready", { tiles: demTiles, fetched: dem.fetched });

// 4. Roads and railways at ground level under the needed runs (z16 cells around their stations).
const cellKey = (lon: number, lat: number) => tileKey(lon, lat, 16);
const cells = new Set<string>();
for (const [lon, lat] of points) {
  for (const [dx, dy] of [
    [0, 0],
    [0.004, 0],
    [-0.004, 0],
    [0, 0.0035],
    [0, -0.0035],
  ])
    cells.add(cellKey(lon + dx, lat + dy));
}
const nearCoords = readNodeCoordsWhere(file, (lon, lat) => cells.has(cellKey(lon, lat)));
const isAtGround = (t: Record<string, string>) =>
  (t.bridge ?? "no") === "no" &&
  (t.tunnel ?? "no") === "no" &&
  (Number.parseInt(t.layer ?? "0", 10) || 0) === 0;
const ROAD = /^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;
const RAIL = /^(rail|light_rail|subway|narrow_gauge|tram)$/;
const isCrossed = (t: Record<string, string>) =>
  isAtGround(t) && (ROAD.test(t.highway ?? "") || RAIL.test(t.railway ?? ""));
const crossWays = readWays(file, isCrossed, (refs) => refs.some((r) => nearCoords.has(r)));
const missing = new Set(crossWays.flatMap((w) => w.refs).filter((r) => !nearCoords.has(r)));
const farCoords = missing.size > 0 ? readNodeCoords(file, missing) : new Map<number, [number, number]>();
const objects: CrossObject[] = crossWays
  .map((w) => ({
    kind: (RAIL.test(w.tags.railway ?? "") ? "rail" : "road") as CrossObject["kind"],
    id: w.id,
    pts: w.refs.map((r) => nearCoords.get(r) ?? farCoords.get(r)).filter((c): c is [number, number] => !!c),
  }))
  .filter((o) => o.pts.length >= 2)
  .sort((a, b) => a.id - b.id);
log("expressway_objects_read", {
  roads: objects.filter((o) => o.kind === "road").length,
  rails: objects.filter((o) => o.kind === "rail").length,
});

// 5. Solve and write.
const solveStarted = performance.now();
const result = solvePlan(plan, (lon, lat) => dem.heightAt(lon, lat), objects);
log("expressway_solved", {
  ...result.stats,
  qpMs: Math.round(result.stats.qpMs),
  durationS: Math.round((performance.now() - solveStarted) / 100) / 10,
});
// 6. Signs (G6): where each stands on the decks and what it says; the entrances for 103・104.
const signPlan = planSigns({
  chunks: result.chunks,
  runs: result.runs,
  features: result.features,
  net,
  phones: phoneOrBay
    .filter((n) => n.tags.emergency === "phone")
    .map(({ id, lon, lat }) => ({ id, lon, lat })),
  bays: phoneOrBay.filter((n) => isBay(n.tags)).map(({ id, lon, lat }) => ({ id, lon, lat })),
});
for (const chunk of result.chunks) {
  const signs = signPlan.signs.get(chunk.id);
  if (signs) chunk.signs = signs;
  const posted = signPlan.posted.get(chunk.id);
  if (posted !== undefined) chunk.posted = posted;
}
const signCounts: Record<string, number> = {};
for (const list of signPlan.signs.values())
  for (const sign of list) signCounts[sign.id] = (signCounts[sign.id] ?? 0) + 1;
log("expressway_signs_planned", {
  signs: [...signPlan.signs.values()].reduce((n, l) => n + l.length, 0),
  byId: signCounts,
  entrances: signPlan.entrances.length,
  unplaced: signPlan.unplaced.length,
});
for (const u of signPlan.unplaced) warn("expressway_sign_unplaced", u);
const tiles = new Map<string, XwTile>();
for (const chunk of result.chunks) {
  const mid = Math.floor(chunk.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
  const key = tileKey(chunk.st[mid + 1], chunk.st[mid + 2], Z);
  const tile = tiles.get(key) ?? { chunks: [] };
  tile.chunks.push(chunk);
  tiles.set(key, tile);
}
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
let bytes = 0;
const tileKeys = [...tiles.keys()].sort();
for (const key of tileKeys) {
  const tile = tiles.get(key)!;
  tile.chunks.sort(compareChunks);
  const text = JSON.stringify(tile);
  bytes += Buffer.byteLength(text);
  await writeFile(join(OUT, `${key}.json`), text);
}
const UNSOLVED = [
  "vertical_unsolved",
  "parent_unsolved",
  "parent_missing",
  "dependency_cycle",
  "partner_unsolved",
];
const isUnsolved = (kind: string) => UNSOLVED.includes(kind);
const meta: XwMeta = {
  version: XW_VERSION,
  zoom: Z,
  tiles: tileKeys,
  ranges: rangeNames.map((name) => ({ name, ...RANGES[name] })),
  structures: structures.map((st) => ({
    id: st.id,
    version: DECK_LEVELS_VERSION,
    decks: st.decks.map((d) => d.id),
  })),
  extract: { url: OSM_EXTRACT, timestamp },
  counts: {
    runs: result.runs.length,
    chunks: result.chunks.length,
    stations: result.chunks.reduce((n, c) => n + c.st.length / STATION_STRIDE, 0),
    piers: result.chunks.reduce((n, c) => n + c.piers.length / PIER_STRIDE, 0),
    crossings: result.chunks.reduce((n, c) => n + c.cross.length / CROSS_STRIDE, 0),
  },
  bytes,
  solver: {
    components: result.stats.components,
    solves: result.stats.solves,
    unconverged: result.stats.unconverged,
  },
  runs: result.runs,
  diagnostics: result.diagnostics.filter((d) => plan.needed.includes(d.run)),
  entrances: signPlan.entrances,
};
await writeFile(join(OUT, "meta.json"), JSON.stringify(meta));
await writeFile(
  join(OUT, "LICENSE.txt"),
  `Expressway centrelines, lanes, ref and entrance/exit names in this folder are extracted from
OpenStreetMap and altered (smoothed and resampled).
© OpenStreetMap contributors — https://www.openstreetmap.org/copyright
This database, including the road surface elevations, is made available under the Open Database
License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/
Source extract: ${OSM_EXTRACT} (Geofabrik), replication timestamp ${timestamp ?? "unknown"}.
Filters: way["highway"~"^(motorway|motorway_link)$"] within ${JSON.stringify(UNIVERSE)}, and the
node["highway"="motorway_junction"] on them (name, name:en, ref), node["emergency"="phone"] /
emergency bays beside them (placed as the signs 116の4・116の6), and the street ways a structure
names (src/expressway/structures.ts: way ${[...streetIds].sort((a, b) => a - b).join(", ")}, the
Rainbow Bridge's lower floor and its approaches). The operator's name is stripped off route names
and anything still naming it is dropped. Roads and railways at ground level under the viaducts (way["highway"] / way["railway"]
without bridge, tunnel or layer) are read as clearance constraints only and are not in this folder.
Method: scripts/expressway.ts (plan smoothing within 1.5 m of the OSM line, vertical alignment
within 道路構造令, chunks of at most 300 m).
Elevations: 地理院タイル（標高タイル（基盤地図情報数値標高モデル））を加工して作成
(https://maps.gsi.go.jp/development/ichiran.html). They are a vertical alignment designed by this
project with the ground elevation as a constraint — estimates, not surveyed values and not a
product of GSI. The files also carry the ground elevation under each station and pier (the last
value of a station, the second of a pier): 地理院の標高タイルを平滑化（5×5 中央値と 3×3 の重み付き平均）
した値を加工して含む — processed (smoothed) GSI elevation-tile values, offered under the same ODbL,
used by the game to stop girders and piers at the ground.
`,
);
for (const d of meta.diagnostics) warn("expressway_diagnostic", d);
for (const r of meta.runs) {
  if (!r.structure) continue;
  const { deck, osmM, planM, zM } = r.structure;
  log("expressway_structure_built", { deck, run: r.id, osmM, planM, zM });
}
log("expressway_written", {
  range: rangeArg,
  tiles: tileKeys.length,
  runs: result.runs.length,
  chunks: result.chunks.length,
  stations: meta.counts.stations,
  bytes,
  diagnostics: meta.diagnostics.length,
  unsolved: meta.diagnostics.filter((d) => isUnsolved(d.kind)).length,
  durationS: Math.round((performance.now() - started) / 100) / 10,
});

// Build-time expressway compiler (knowledge/road-redesign-plan.md 4): OSM motorway / motorway_link from the Geofabrik Kanto
// extract → plan and vertical alignment within 道路構造令 (src/expressway/) → public/data/expressway/
// <x>-<y>.json (z14 tiles of ≤ 300 m chunks) and meta.json. The ground constraints read GSI DEM
// tiles exactly as the game does (scripts/demTiles.ts), cached under .cache/gsi-dem.
// Run: pnpm exec tsx scripts/expressway.ts [--range hamazakibashi|all] [--pbf <path>] [--out <dir>]
// (--out writes somewhere else than public/data/expressway, e.g. to measure --range all.)
// (the OSM extract is the one just fetch-regs caches in .cache/osm; it is downloaded if missing).
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareChunks, RANGES, type RangeName } from "../src/expressway/ranges.ts";
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
import {
  type Network,
  normalizeNode,
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

const rangeName = (arg("range") ?? "hamazakibashi") as RangeName | "all";
const range = rangeName === "all" ? null : RANGES[rangeName];
if (rangeName !== "all" && !range)
  throw new Error(`unknown --range ${rangeName} (${Object.keys(RANGES).join(", ")}, all)`);
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
const net: Network = { ways, nodes };
log("expressway_osm_read", {
  ways: allWays.length,
  universeWays: ways.size,
  nodes: nodes.size,
  junctions: [...nodes.values()].filter((n) => n.junctionName !== null || n.junctionRef !== null).length,
});

// 2. Plan alignment and what the range depends on.
const plan = planNetwork(net, outsideNodes, range);
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
  range: range ? { name: rangeName, ...range } : null,
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
node["highway"="motorway_junction"] on them (name, ref). Names that carry the operator's name are
dropped. Roads and railways at ground level under the viaducts (way["highway"] / way["railway"]
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
log("expressway_written", {
  range: rangeName,
  tiles: tileKeys.length,
  runs: result.runs.length,
  chunks: result.chunks.length,
  stations: meta.counts.stations,
  bytes,
  diagnostics: meta.diagnostics.length,
  unsolved: meta.diagnostics.filter((d) => isUnsolved(d.kind)).length,
  durationS: Math.round((performance.now() - started) / 100) / 10,
});

// Whether the ground or a street stands through the expressway's carriageway (P2.7-6 PR 7b): over
// every embankment and cut chunk and every chunk of an at-grade run (`ground` in the run summary)
// of a data folder, the carriageway every 1 m along and 0.5 m across, the drawn terrain (the game's
// own mesh height over the build's DEM, terrainSurface.ts) where the terrain is not cut away for the
// expressway (groundCuts.ts, from the folder's own chunks), against the road less 2 cm. The streets
// are GSI's ground-level centrelines as the game reads them (roadTiles.ts), their asphalt the
// terrain + 0.1 m, counted where they cover a point no hole takes away. The logic is
// src/world/terrainProbe.ts; this reads the folder, the DEM and the streets. Beside every
// embankment it also reads the drawn terrain against its walls' tops and feet (probeWalls), and
// lists the GSI streets the game takes out across an embankment or a cut and those the deck passes
// over (expresswayRoads.ts siteCrossings).
// One JSON log line (expressway_terrain_probed); exit code 1 when any point stands through the road
// (the tunnel mouths' and runs' ends apart) or past a wall's top or foot.
// Run: pnpm exec tsx scripts/expresswayTerrainProbe.ts <dir> (just check-expressway-terrain <dir>;
// a label without a slash means .cache/expressway-area/<label>). --no-streets skips the streets.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { TERRAIN_SEGMENTS, TERRAIN_ZOOM } from "../src/config.ts";
import { ST, STATION_STRIDE, type XwChunk } from "../src/expressway/format.ts";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import { GroundCuts } from "../src/world/groundCuts.ts";
import type { RoadLine } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, roadLinesOfTile } from "../src/world/roadTiles.ts";
import { planeAt } from "../src/expressway/geo.ts";
import { expresswayRoadInput, type SiteCrossing, siteCrossings } from "../src/world/expresswayRoads.ts";
import {
  holeTests,
  type ProbeHit,
  probeChunk,
  probeWalls,
  tunnelMouths,
  type WallHit,
} from "../src/world/terrainProbe.ts";
import { meshHeightAt } from "../src/world/terrainSurface.ts";
import { BuildDem } from "./demTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";

const ROOT = join(import.meta.dirname, "..");
const VECTOR_CACHE = join(ROOT, ".cache", "gsi-vector");
/** How many of the worst points and chunks the log line lists. */
const LIST = 20;
/** A street this wide or wider taken out across the expressway is a main street (counted apart). */
const WIDE_STREET_M = 13;

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
if (target === undefined) throw new Error("usage: expresswayTerrainProbe.ts <dir|label> [--no-streets]");
const hasStreets = !args.includes("--no-streets");
const isLabel = !target.includes("/");
const dir = isLabel ? join(ROOT, ".cache", "expressway-area", target) : target;

const started = performance.now();
const files = readExpresswayFiles(dir);
const isProbed = (c: XwChunk) =>
  c.structure === "embankment" || c.structure === "cut" || files.runById.get(c.run)?.ground === true;
const probed = files.chunks.filter(isProbed);

// Every hole of the folder, as the game cuts them once the tiles are read (no water: it only takes
// more ground away).
const cuts = new GroundCuts(null);
for (const c of files.chunks) cuts.addChunk(c);
const holes = holeTests(cuts);

// The DEM under every probe point's terrain triangle: the chunk's stations widened by a grid cell.
const dem = new BuildDem();
const prefetch: Array<[number, number]> = [];
const S = TERRAIN_SEGMENTS;
for (const c of probed) {
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    const gi = Math.floor(lonToTileX(c.st[i + ST.lon], TERRAIN_ZOOM) * S);
    const gj = Math.floor(latToTileY(c.st[i + ST.lat], TERRAIN_ZOOM) * S);
    for (let dj = -1; dj <= 2; dj++)
      for (let di = -1; di <= 2; di++)
        prefetch.push([tileXToLon((gi + di) / S, TERRAIN_ZOOM), tileYToLat((gj + dj) / S, TERRAIN_ZOOM)]);
  }
}
await dem.prefetch(prefetch);
// BuildDem answers by lon/lat; the mesh asks by global z15 pixel (bilinear either way, the same tiles).
const sampler = {
  sampleGlobal: (gx: number, gy: number) =>
    dem.heightAt(tileXToLon(gx / 256, TERRAIN_ZOOM), tileYToLat(gy / 256, TERRAIN_ZOOM)),
};
const groundAt = (lat: number, lon: number) => meshHeightAt(sampler, lat, lon);

/** A z16 vector tile's bytes, from .cache/gsi-vector or GSI (an empty file remembers a 404). */
async function vectorTile(x: number, y: number): Promise<VectorTile | null> {
  const file = join(VECTOR_CACHE, `${ROAD_TILE_ZOOM}-${x}-${y}.pbf`);
  let bytes: Uint8Array | null = null;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch {
    const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${ROAD_TILE_ZOOM}/${x}/${y}.pbf`;
    const res = await fetch(url);
    const isMissing = res.status === 404;
    if (!res.ok && !isMissing) throw new Error(`${url}: HTTP ${res.status}`);
    bytes = isMissing ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
    await mkdir(VECTOR_CACHE, { recursive: true });
    await writeFile(file, bytes);
  }
  return bytes.length === 0 ? null : new VectorTile(new Pbf(bytes));
}

const streetTiles = new Map<string, RoadLine[]>();
/** The streets of the z16 tiles a chunk's stations lie in and their neighbours. */
async function streetsNear(c: XwChunk): Promise<RoadLine[]> {
  if (!hasStreets) return [];
  const keys = new Set<string>();
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    const x = Math.floor(lonToTileX(c.st[i + ST.lon], ROAD_TILE_ZOOM));
    const y = Math.floor(latToTileY(c.st[i + ST.lat], ROAD_TILE_ZOOM));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.add(`${x + dx}/${y + dy}`);
  }
  const out: RoadLine[] = [];
  for (const key of [...keys].toSorted()) {
    if (!streetTiles.has(key)) {
      const [x, y] = key.split("/").map(Number);
      const tile = await vectorTile(x, y);
      streetTiles.set(key, tile ? roadLinesOfTile(tile, x, y) : []);
    }
    out.push(...streetTiles.get(key)!);
  }
  // Only the lines that come near the chunk (its stations' box widened by 50 m).
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    x0 = Math.min(x0, c.st[i + ST.lon]);
    x1 = Math.max(x1, c.st[i + ST.lon]);
    y0 = Math.min(y0, c.st[i + ST.lat]);
    y1 = Math.max(y1, c.st[i + ST.lat]);
  }
  const margin = 50 / 111000;
  const isNear = (s: RoadLine) => {
    for (let i = 0; i + 1 < s.coords.length; i += 2) {
      const isInBox =
        s.coords[i] >= x0 - margin * 1.3 &&
        s.coords[i] <= x1 + margin * 1.3 &&
        s.coords[i + 1] >= y0 - margin &&
        s.coords[i + 1] <= y1 + margin;
      if (isInBox) return true;
    }
    return false;
  };
  return out.filter(isNear);
}

/** A run's end where the road meets the ground, an untraced tunnel or the range's edge. */
const isOpenEnd = (kind: string | undefined) => kind === "ground" || kind === "portal" || kind === "open";
// Where the road leaves the cut-out (terrainProbe.ts END_M): every tunnel mouth, and every run's
// ground, portal or open end.
const ends: Array<[number, number]> = tunnelMouths(files.chunks);
for (const [run, chunks] of files.byRun) {
  const summary = files.runById.get(run);
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (summary && first && isOpenEnd(summary.start.kind)) ends.push([first.st[ST.lon], first.st[ST.lat]]);
  const tail = last ? last.st.length - STATION_STRIDE : 0;
  if (summary && last && isOpenEnd(summary.end.kind))
    ends.push([last.st[tail + ST.lon], last.st[tail + ST.lat]]);
}

let points = 0;
const hits: ProbeHit[] = [];
const walls: WallHit[] = [];
for (const c of probed) {
  const result = probeChunk(c, holes, groundAt, await streetsNear(c), ends);
  points += result.points;
  hits.push(...result.hits);
  walls.push(...probeWalls(c, groundAt, holes, files.chunks));
}

// The streets the game would take out across an embankment or a cut, and those it keeps because the
// deck passes over them (expresswayRoads.ts siteCrossings, as joinExpressway reads them).
const streets = [...new Set([...streetTiles.values()].flat())];
const runs = [...files.tiles.values()].flatMap((t) => t.runs);
const sites = expresswayRoadInput(files.chunks, runs, (_lat, _lon, h) => h).sites ?? [];
const first = files.chunks[0];
const plane = planeAt(first.st[ST.lon], first.st[ST.lat]);
const crossings = siteCrossings(streets, sites, plane.toXY);
const crossingRow = (c: SiteCrossing) => ({
  chunk: c.chunk,
  s: c.s,
  widthM: c.widthM,
  angleDeg: c.angleDeg,
  overGroundM: c.overGroundM,
  tunnel: c.tunnel,
  lat: c.at[0],
  lon: c.at[1],
});
const ofCrossing = (kind: SiteCrossing["kind"]) =>
  crossings
    .filter((c) => c.kind === kind)
    .toSorted((a, b) => b.widthM - a.widthM || a.chunk.localeCompare(b.chunk) || a.s - b.s);
const crossingCounts: Record<string, number> = {};
for (const c of crossings) crossingCounts[c.kind] = (crossingCounts[c.kind] ?? 0) + 1;

const round = (v: number, k = 100) => Math.round(v * k) / k;
const inner = hits.filter((h) => !h.atEnd);
const atEnds = hits.filter((h) => h.atEnd);
const ofKind = (kind: ProbeHit["kind"]) => inner.filter((h) => h.kind === kind);
const terrainHits = inner.filter((h) => h.kind !== "street");
const streetHits = ofKind("street");
/** The worst chunks of a list of points: their count, worst overM and its s. */
const worstChunks = (list: readonly ProbeHit[]) => {
  const byChunk = new Map<
    string,
    {
      chunk: string;
      structure: string;
      points: number;
      maxOverM: number;
      s: number;
      lat: number;
      lon: number;
    }
  >();
  for (const h of list) {
    const known = byChunk.get(h.chunk);
    const isWorse = !known || h.overM > known.maxOverM;
    const entry = known ?? {
      chunk: h.chunk,
      structure: h.structure,
      points: 0,
      maxOverM: 0,
      s: h.s,
      lat: h.lat,
      lon: h.lon,
    };
    entry.points++;
    if (isWorse) Object.assign(entry, { maxOverM: h.overM, s: h.s, lat: h.lat, lon: h.lon });
    byChunk.set(h.chunk, entry);
  }
  return [...byChunk.values()]
    .toSorted((a, b) => b.points - a.points || b.maxOverM - a.maxOverM)
    .slice(0, LIST)
    .map((e) => ({
      ...e,
      maxOverM: round(e.maxOverM),
      s: round(e.s, 10),
      lat: round(e.lat, 1e6),
      lon: round(e.lon, 1e6),
    }));
};
/** The chunks whose walls the terrain passes most often: their count, the worst and where. */
const worstWalls = (list: readonly WallHit[]) => {
  const byChunk = new Map<
    string,
    { chunk: string; points: number; maxOverM: number; s: number; kind: string }
  >();
  for (const w of list) {
    const entry = byChunk.get(w.chunk) ?? { chunk: w.chunk, points: 0, maxOverM: 0, s: w.s, kind: w.kind };
    entry.points++;
    if (w.overM > entry.maxOverM) Object.assign(entry, { maxOverM: w.overM, s: w.s, kind: w.kind });
    byChunk.set(w.chunk, entry);
  }
  return [...byChunk.values()]
    .toSorted((a, b) => b.points - a.points || b.maxOverM - a.maxOverM)
    .slice(0, LIST)
    .map((e) => ({ ...e, maxOverM: round(e.maxOverM), s: round(e.s, 10) }));
};
const structures: Record<string, number> = {};
for (const c of probed) structures[c.structure] = (structures[c.structure] ?? 0) + 1;
log("expressway_terrain_probed", {
  dir: target,
  chunks: probed.length,
  structures,
  points,
  terrainOut: terrainHits.length,
  drawnOut: ofKind("drawn").length,
  colliderOut: ofKind("collider").length,
  streetOut: streetHits.length,
  endTerrainOut: atEnds.filter((h) => h.kind !== "street").length,
  endStreetOut: atEnds.filter((h) => h.kind === "street").length,
  maxOverM: round(terrainHits.reduce((m, h) => Math.max(m, h.overM), 0)),
  streetMaxOverM: round(streetHits.reduce((m, h) => Math.max(m, h.overM), 0)),
  terrainChunks: worstChunks(terrainHits),
  streetChunks: worstChunks(streetHits),
  endChunks: worstChunks(atEnds),
  wallTopOut: walls.filter((w) => w.kind === "top").length,
  wallFootOut: walls.filter((w) => w.kind === "foot").length,
  wallMaxOverM: round(walls.reduce((m, w) => Math.max(m, w.overM), 0)),
  wallChunks: worstWalls(walls),
  streetCrossings: crossingCounts,
  wideCuts: ofCrossing("cut").filter((c) => c.widthM >= WIDE_STREET_M).length,
  streetCuts: ofCrossing("cut").slice(0, LIST).map(crossingRow),
  streetsUnder: ofCrossing("under").slice(0, LIST).map(crossingRow),
  streetTiles: streetTiles.size,
  durationMs: Math.round(performance.now() - started),
});
const isClear = inner.length === 0 && walls.length === 0;
if (!isClear) process.exitCode = 1;

// What lies under the expressway outside the 23 wards (R1-1a 7, plan 10.3): per written station of a
// data folder outside the wards, whether GSI's DEM5A has the pixel there (else the ground falls to
// DEM10B, scripts/demTiles.ts and src/world/dem.ts alike) and whether a gated PLATEAU prefecture's
// municipality regions hold it (public/data/plateau/tileset.json: else no buildings stand there).
// Reads the DEM tiles from .cache/gsi-dem only (the build of that folder cached every tile under
// its stations). One JSON file and one log line.
//   pnpm exec tsx scripts/expresswayOutsideGround.ts <dir> [--out <file>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PLATEAU_SOURCES, TERRAIN_ZOOM } from "../src/config.ts";
import { STATION_STRIDE } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { nearWards } from "../src/expressway/scope.ts";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import { decodeGsiDem, latToTileY, lonToTileX } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import { gatesOf, type RootTileset } from "../src/world/plateauRoot.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { decodePng } from "./png.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const files = readExpresswayFiles(dir);
const out = flag("out") ?? `.qa/expressway/outside-ground-${files.dir.split("/").filter(Boolean).pop()}.json`;
const root = join(import.meta.dirname, "..");
const areas = new AreaIndex(
  JSON.parse(readFileSync(join(root, "public", "data", "areas.json"), "utf8")) as AreaFile,
);
const inWards = (lon: number, lat: number) => areas.lookup(lat, lon) != null;
const plateauRoot = JSON.parse(
  readFileSync(join(root, "public", "data", "plateau", "tileset.json"), "utf8"),
) as RootTileset;
const gates = gatesOf(plateauRoot, PLATEAU_SOURCES);

const SIZE = 256;
const dem5a = new Map<string, Float32Array | null>();
/** DEM5A's value at a point, NaN where the tile or the pixel has none; null where the tile is not cached. */
function dem5aAt(lon: number, lat: number): number | null {
  const gx = lonToTileX(lon, TERRAIN_ZOOM) * SIZE;
  const gy = latToTileY(lat, TERRAIN_ZOOM) * SIZE;
  const tx = Math.floor(gx / SIZE);
  const ty = Math.floor(gy / SIZE);
  const key = `${tx}/${ty}`;
  if (!dem5a.has(key)) {
    const path = join(root, ".cache", "gsi-dem", `dem5a-${TERRAIN_ZOOM}-${tx}-${ty}.png`);
    const isCached = existsSync(path);
    if (!isCached) return null;
    const bytes = new Uint8Array(readFileSync(path));
    // An empty file is a tile GSI does not have (demTiles.ts remembers a 404 so).
    const isEmpty = bytes.length === 0;
    if (isEmpty) dem5a.set(key, null);
    else {
      const { data } = decodePng(bytes);
      const tile = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < tile.length; i++)
        tile[i] = decodeGsiDem(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      dem5a.set(key, tile);
    }
  }
  const tile = dem5a.get(key);
  if (!tile) return Number.NaN;
  return tile[(Math.floor(gy) - ty * SIZE) * SIZE + (Math.floor(gx) - tx * SIZE)];
}

/**
 * East of the 旧江戸川 (139.87°E) between 35.60° and 35.80°N: 浦安 and 市川, the Chiba cities with no
 * PLATEAU tileset (plan 10.3). Why a line and not the cities' polygons: the game holds the 23 wards'
 * towns only, and the expressway crosses that river in two places (湾岸線, 7号), so a meridian sorts
 * them; a station off the wards' towns and west of it is Tokyo's water (the bay, the rivers), which
 * the ungated Tokyo tileset covers but no building stands on.
 */
const isChibaBayside = (lon: number, lat: number) => lon >= 139.87 && lat >= 35.6 && lat <= 35.8;

/** The gated prefecture whose municipality regions hold a point, or null. */
function plateauAt(lon: number, lat: number): string | null {
  const x = (lon * Math.PI) / 180;
  const y = (lat * Math.PI) / 180;
  for (const [code, regions] of Object.entries(gates)) {
    const isIn = regions.some((r) => x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]);
    if (isIn) return code;
  }
  return null;
}

type Tally = { km: number; runs: Set<string> };
const tally = () => ({ km: 0, runs: new Set<string>() });
const dem = { dem5a: tally(), dem10b: tally(), uncached: tally() };
const plateau = new Map<string, Tally>();
/** Stretches with no PLATEAU region, by run: where buildings will not stand. */
const bare = new Map<
  string,
  { km: number; minLat: number; maxLat: number; minLon: number; maxLon: number }
>();
const fallbacks = new Map<string, { km: number; lat: number; lon: number }>();
let outsideKm = 0;
for (const c of files.chunks) {
  for (let i = 0; i + STATION_STRIDE < c.st.length; i += STATION_STRIDE) {
    const lon = c.st[i + 1];
    const lat = c.st[i + 2];
    const km = haversine(lon, lat, c.st[i + STATION_STRIDE + 1], c.st[i + STATION_STRIDE + 2]) / 1000;
    const isOutside = !nearWards(inWards, lon, lat);
    if (!isOutside) continue;
    outsideKm += km;
    const v = dem5aAt(lon, lat);
    const bucket = v === null ? dem.uncached : Number.isNaN(v) ? dem.dem10b : dem.dem5a;
    bucket.km += km;
    bucket.runs.add(c.run);
    const isFallback = v !== null && Number.isNaN(v);
    if (isFallback) {
      const f = fallbacks.get(c.run) ?? { km: 0, lat, lon };
      f.km += km;
      fallbacks.set(c.run, f);
    }
    const code = plateauAt(lon, lat) ?? (isChibaBayside(lon, lat) ? "none-chiba" : "none");
    const t = plateau.get(code) ?? tally();
    t.km += km;
    t.runs.add(c.run);
    plateau.set(code, t);
    const isBare = code.startsWith("none");
    if (isBare) {
      const b = bare.get(c.run) ?? { km: 0, minLat: lat, maxLat: lat, minLon: lon, maxLon: lon };
      b.km += km;
      b.minLat = Math.min(b.minLat, lat);
      b.maxLat = Math.max(b.maxLat, lat);
      b.minLon = Math.min(b.minLon, lon);
      b.maxLon = Math.max(b.maxLon, lon);
      bare.set(c.run, b);
    }
  }
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const asTally = (t: Tally) => ({ km: r3(t.km), runs: t.runs.size });
const names = Object.fromEntries(PLATEAU_SOURCES.map((s) => [s.code, s.name]));
const result = {
  dir: files.dir,
  outsideKm: r3(outsideKm),
  dem: { dem5a: asTally(dem.dem5a), dem10b: asTally(dem.dem10b), uncached: asTally(dem.uncached) },
  dem10bByRun: Object.fromEntries(
    [...fallbacks].sort().map(([run, f]) => [run, { km: r3(f.km), lat: r5(f.lat), lon: r5(f.lon) }]),
  ),
  plateau: Object.fromEntries(
    [...plateau]
      .sort()
      .map(([code, t]) => [
        code.startsWith("none") ? code : `${code} ${names[code] ?? ""}`.trim(),
        asTally(t),
      ]),
  ),
  bareByRun: Object.fromEntries(
    [...bare]
      .sort()
      .map(([run, b]) => [
        run,
        { km: r3(b.km), lat: [r5(b.minLat), r5(b.maxLat)], lon: [r5(b.minLon), r5(b.maxLon)] },
      ]),
  ),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
log("expressway_outside_ground_measured", {
  dir: files.dir,
  out,
  outsideKm: result.outsideKm,
  dem5aKm: result.dem.dem5a.km,
  dem10bKm: result.dem.dem10b.km,
  uncachedKm: result.dem.uncached.km,
  noPlateauKm: (result.plateau["none-chiba"]?.km ?? 0) + (result.plateau.none?.km ?? 0),
});

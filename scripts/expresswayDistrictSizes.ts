// The tiles' size district by district (R1-1a, U3's numbers): the written runs of a ship folder by
// district (districts.ts, from the chunks), the tiles the published districts would make at each
// stage (R1 central, R2 + east, R3 + yamate, R4 + outside) packed as the build packs them
// (files.ts packTiles) and their gzip, and each district's runs and km. One JSON file and one log line.
//   pnpm exec tsx scripts/expresswayDistrictSizes.ts <dir> [--out <file>]
// Why packed again here and not read off a build per stage: the chunks of a run are the same whichever
// districts are written (T8, --districts), so a stage's tiles are the whole ship's chunks of its runs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { DISTRICTS } from "../src/expressway/districts.ts";
import { packTiles } from "../src/expressway/files.ts";
import { STATION_STRIDE } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { nearWards } from "../src/expressway/scope.ts";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import { log } from "../src/log.ts";
import { districtsOfFiles, readExpresswayFiles } from "./expresswayFiles.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const files = readExpresswayFiles(dir);
const out = flag("out") ?? `.qa/expressway/district-sizes-${files.dir.split("/").filter(Boolean).pop()}.json`;
const district = districtsOfFiles(files);

/** gzip of each tile of the runs `ids`, packed as the build packs them. */
function sizesOf(ids: ReadonlySet<string>) {
  const tiles = packTiles(
    files.chunks.filter((c) => ids.has(c.run)),
    files.runs.filter((r) => ids.has(r.id)),
    files.entrances.filter((e) => ids.has(e.run)),
    files.meta.zoom,
  );
  const gz = [...tiles].map(([key, t]) => ({ key, gzip: gzipSync(JSON.stringify(t)).length }));
  gz.sort((a, b) => b.gzip - a.gzip);
  const total = gz.reduce((n, t) => n + t.gzip, 0);
  return { tiles: gz.length, gzipBytes: total, maxGzipBytes: gz[0]?.gzip ?? 0, maxTile: gz[0]?.key ?? null };
}

const root = join(import.meta.dirname, "..");
const areas = new AreaIndex(
  JSON.parse(readFileSync(join(root, "public", "data", "areas.json"), "utf8")) as AreaFile,
);
const inWards = (lon: number, lat: number) => areas.lookup(lat, lon) != null;

/** The stations' km of the runs `ids` over the wards and off them (scope.ts nearWards, by each step's start). */
function wardsKmOf(ids: ReadonlySet<string>): { inKm: number; outKm: number } {
  let inKm = 0;
  let outKm = 0;
  for (const c of files.chunks) {
    if (!ids.has(c.run)) continue;
    for (let i = 0; i + STATION_STRIDE < c.st.length; i += STATION_STRIDE) {
      const km =
        haversine(c.st[i + 1], c.st[i + 2], c.st[i + STATION_STRIDE + 1], c.st[i + STATION_STRIDE + 2]) /
        1000;
      const isIn = nearWards(inWards, c.st[i + 1], c.st[i + 2]);
      if (isIn) inKm += km;
      else outKm += km;
    }
  }
  return { inKm, outKm };
}

const perDistrict = Object.fromEntries(
  DISTRICTS.map((d) => {
    const ids = new Set(files.runs.filter((r) => district.get(r.id) === d).map((r) => r.id));
    const km = files.runs.filter((r) => ids.has(r.id)).reduce((n, r) => n + r.lengthM, 0) / 1000;
    const main = files.runs.filter((r) => ids.has(r.id) && r.cls === "expressway").length;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const { inKm, outKm } = wardsKmOf(ids);
    return [d, { runs: ids.size, main, km: r3(km), inKm: r3(inKm), outKm: r3(outKm), ...sizesOf(ids) }];
  }),
);
const stages = DISTRICTS.map((_, k) => {
  const published = DISTRICTS.slice(0, k + 1);
  const ids = new Set(files.runs.filter((r) => published.includes(district.get(r.id)!)).map((r) => r.id));
  return { districts: published, runs: ids.size, ...sizesOf(ids) };
});
const result = { dir: files.dir, perDistrict, stages };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
log("expressway_district_sizes_measured", {
  dir: files.dir,
  out,
  stages: stages.map((s) => ({
    districts: s.districts.join(","),
    tiles: s.tiles,
    gzipBytes: s.gzipBytes,
    maxGzipBytes: s.maxGzipBytes,
  })),
});

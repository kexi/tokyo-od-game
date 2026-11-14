// The street lanes left over an embankment's slab (S6 PR 7c, the ledger's lane-in-site): for every
// embankment chunk of a data folder, the GSI streets round it joined as the game joins them
// (joinExpressway: a street crossing the site at grade is cut at its edge, one along it or ending at
// a ramp's foot is kept), built into the game's lanes (RoadGraph, laneCentreOffset each way a lane is
// driven), and every lane whose centre comes within the slab's edge (carriageway/2 + PARAPET_WIDTH)
// for MIN_LENGTH_M or more: a lane the game keeps that runs into the embankment's walls. Grouped per
// chunk and street, one ledger case each. One JSON log line (expressway_lanes_probed); exit code 1
// when more places than LANES_MAX are found (the count after 7c's rebuild: a new one stops it).
// Run: pnpm exec tsx scripts/expresswayLanesProbe.ts <dir|label> [--cache <dir>] [--cases <file>]
// (just check-expressway-lanes <dir>; the tiles from the cache only, a chunk whose tiles are missing
// is skipped and counted). --cases writes the places for the ledger tool's --site-lanes.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { Vector3 } from "three";
import { PARAPET_WIDTH } from "../src/expressway/assumptions.ts";
import { ST, STATION_STRIDE, type XwTileRun } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { latToTileY, lonToTileX } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads.ts";
import { laneCentreOffset } from "../src/world/laneChange.ts";
import { isExpressway, sourceOf } from "../src/world/roadClass.ts";
import { leftOf, RoadGraph, type RoadLine } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, roadLinesOfTile } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";

const ROOT = join(import.meta.dirname, "..");
/**
 * Places found after S6 PR 7c's rebuild: the low stretches the ledger takes as lane-in-site (the design's 8
 * stretches are 6 places here, a street's lanes either way one place; and 3 more the first count missed).
 */
const LANES_MAX = 9;
/** Shorter than this within the slab is a street's end at the site's edge, not a lane over it (m). */
const MIN_LENGTH_M = 3;
/** The decks the game joins round a point (expresswayDeck.ts GRAPH_RADIUS_M). */
const GRAPH_RADIUS_M = 1300;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--cache", "--cases"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error("usage: expresswayLanesProbe.ts <dir|label> [--cache <dir>] [--cases <file>]");
const dir = target.includes("/") ? target : join(ROOT, ".cache", "expressway-area", target);
const cacheDir = flag("cache") ?? join(ROOT, ".cache", "gsi-vector");
const started = performance.now();
const files = readExpresswayFiles(dir);
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];
const tiles = new Map<string, RoadLine[] | null>();
async function streetsOf(x: number, y: number): Promise<RoadLine[] | null> {
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
}

/** One place: a street's lanes within an embankment's slab, as the ledger's lane-in-site reads it. */
export type SiteLanes = {
  run: string;
  chunk: string;
  s0: number;
  s1: number;
  lengthM: number;
  streetM: number;
  nearestM: number;
  lanes: number;
};
const places: SiteLanes[] = [];
let skipped = 0;
for (const [run, chunks] of files.byRun) {
  for (const emb of chunks.filter((c) => c.structure === "embankment")) {
    const o = Math.floor(emb.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
    const lon = emb.st[o + ST.lon];
    const lat = emb.st[o + ST.lat];
    const cx = Math.floor(lonToTileX(lon, ROAD_TILE_ZOOM));
    const cy = Math.floor(latToTileY(lat, ROAD_TILE_ZOOM));
    const streets: RoadLine[] = [];
    let isMissing = false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const lines = await streetsOf(cx + dx, cy + dy);
        if (lines === null) isMissing = true;
        else streets.push(...lines);
      }
    if (isMissing) {
      skipped++;
      continue;
    }
    const near = files.chunks.filter((c) => {
      for (let i = 0; i < c.st.length; i += STATION_STRIDE)
        if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= GRAPH_RADIUS_M) return true;
      return false;
    });
    const joined = joinExpressway(
      streets,
      expresswayRoadInput(near, runs, (_la, _lo, h) => h),
      () => {},
    );
    const frame = new LocalFrame(lat, lon, 0);
    const graph = new RoadGraph(
      joined.filter((l) => sourceOf(l) === "gsi" && !isExpressway(l)),
      frame,
    );
    const centre: Vector3[] = [];
    const stS: number[] = [];
    for (let i = 0; i < emb.st.length; i += STATION_STRIDE) {
      centre.push(frame.toLocal(emb.st[i + ST.lat], emb.st[i + ST.lon], 0).setY(0));
      stS.push(emb.st[i + ST.s]);
    }
    const edge = (emb.lanes * emb.laneWidth + emb.shoulderL + emb.shoulderR) / 2 + PARAPET_WIDTH.value;
    /** Distance from (x, z) to the slab's centre line and the run distance there. */
    const toSite = (x: number, z: number): [number, number] => {
      let best = Infinity;
      let at = 0;
      for (let i = 0; i + 1 < centre.length; i++) {
        const [a, b] = [centre[i], centre[i + 1]];
        const [ex, ez] = [b.x - a.x, b.z - a.z];
        const l2 = ex * ex + ez * ez;
        const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
        if (d < best) {
          best = d;
          at = stS[i] + (stS[i + 1] - stS[i]) * t;
        }
      }
      return [best, at];
    };
    // An embankment's end face: past the run's first or last station the distance is to the face, not
    // the slab beside the lane. Only stations the slab spans count.
    const [sFirst, sLast] = [stS[0], stS[stS.length - 1]];
    for (const seg of graph.segments) {
      let place: SiteLanes | null = null;
      for (const d of [1, -1] as const) {
        const isDriven = seg.oneway === 0 || seg.oneway === d;
        if (!isDriven) continue;
        for (let lane = 0; lane < seg.lanes; lane++) {
          let len = 0;
          let nearest = Infinity;
          let s0 = Infinity;
          let s1 = -Infinity;
          for (let s = 0; s <= seg.length; s += 1) {
            const { pos, dir: along } = graph.sample(seg, s);
            const p = pos.add(leftOf(along.multiplyScalar(d), laneCentreOffset(seg, lane)));
            const [dist, at] = toSite(p.x, p.z);
            const isOver = dist <= edge && at > sFirst + 0.5 && at < sLast - 0.5;
            if (!isOver) continue;
            len++;
            nearest = Math.min(nearest, dist);
            s0 = Math.min(s0, at);
            s1 = Math.max(s1, at);
          }
          if (len < MIN_LENGTH_M) continue;
          place ??= {
            run,
            chunk: emb.id,
            s0,
            s1,
            lengthM: 0,
            streetM: seg.line.width,
            nearestM: nearest,
            lanes: 0,
          };
          place.s0 = Math.min(place.s0, s0);
          place.s1 = Math.max(place.s1, s1);
          place.lengthM = Math.max(place.lengthM, len);
          place.nearestM = Math.min(place.nearestM, nearest);
          place.lanes++;
        }
      }
      if (place)
        places.push({
          ...place,
          s0: Math.round(place.s0 * 10) / 10,
          s1: Math.round(place.s1 * 10) / 10,
          nearestM: Math.round(place.nearestM * 100) / 100,
        });
    }
  }
}
// Pieces of one street split by the graph's nodes along one stretch: one place.
places.sort((a, b) => (a.chunk === b.chunk ? a.s0 - b.s0 : a.chunk < b.chunk ? -1 : 1));
const merged: SiteLanes[] = [];
for (const p of places) {
  const last = merged[merged.length - 1];
  const isSame =
    last !== undefined && last.chunk === p.chunk && last.streetM === p.streetM && p.s0 <= last.s1 + 1;
  if (isSame) {
    last.s1 = Math.max(last.s1, p.s1);
    last.lengthM = Math.max(last.lengthM, p.lengthM);
    last.nearestM = Math.min(last.nearestM, p.nearestM);
    last.lanes = Math.max(last.lanes, p.lanes);
  } else merged.push({ ...p });
}
log("expressway_lanes_probed", {
  dir: target,
  places: merged.length,
  max: LANES_MAX,
  skippedForMissingTiles: skipped,
  list: merged.map((p) => ({
    chunk: p.chunk,
    s0: p.s0,
    s1: p.s1,
    lengthM: p.lengthM,
    streetM: p.streetM,
    nearestM: p.nearestM,
  })),
  durationMs: Math.round(performance.now() - started),
});
const casesPath = flag("cases");
if (casesPath !== undefined) await writeFile(casesPath, JSON.stringify(merged, null, 1) + "\n");
if (merged.length > LANES_MAX) process.exitCode = 1;

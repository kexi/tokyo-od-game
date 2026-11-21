// The street lanes left over an embankment's slab (S6 PR 7c, the ledger's lane-in-site): for every
// embankment chunk of a data folder, the GSI streets round it joined as the game joins them
// (joinExpressway: a street crossing the site at grade is cut at its edge, one along it or ending at
// a ramp's foot is kept), built into the game's lanes (RoadGraph, laneCentreOffset each way a lane is
// driven), and every lane whose centre comes within the slab's edge (carriageway/2 + PARAPET_WIDTH)
// for MIN_LENGTH_M or more: a lane the game keeps that runs into the embankment's walls (the judgement
// and the merging in scripts/expresswaySiteLanes.ts). The lanes are the game's: the network has the
// regulations applied as the worker does (scripts/gameStreets.ts, P2.7 R1-2-0: JARTIC and OSM lane
// counts; before it every street was one lane). Grouped per run and street width, one ledger case
// each. One JSON log line (expressway_lanes_probed); exit code 1
// when more places are found than the folder's ledger takes as lane-in-site (a new one stops it), or
// than --max; a folder with neither (a measuring folder) is only counted.
// Run: pnpm exec tsx scripts/expresswayLanesProbe.ts <dir|label> [--cache <dir>] [--cases <file>] [--max <n>]
// (just check-expressway-lanes <dir>; the tiles from the cache only, a chunk whose tiles are missing
// is skipped and counted; exit code 1 when any is). --cases writes the places for the ledger tool's --site-lanes.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Vector3 } from "three";
import { PARAPET_WIDTH } from "../src/expressway/assumptions.ts";
import { ST, STATION_STRIDE, type XwTileRun } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { log } from "../src/log.ts";
import { expresswayRoadInput } from "../src/world/expresswayRoads.ts";
import { laneCentreOffset } from "../src/world/laneChange.ts";
import { isExpressway, sourceOf } from "../src/world/roadClass.ts";
import { leftOf, type RoadLine } from "../src/world/roads.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { gameStreetGraph, gsiTileReader, regulationReader, roadTileOf } from "./gameStreets.ts";
import { laneOverSite, mergeSitePlaces, type SiteLanes, type SiteLine } from "./expresswaySiteLanes.ts";

const ROOT = join(import.meta.dirname, "..");
/** The decks the game joins round a point (expresswayDeck.ts GRAPH_RADIUS_M). */
const GRAPH_RADIUS_M = 1300;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--cache", "--cases", "--max"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error("usage: expresswayLanesProbe.ts <dir|label> [--cache <dir>] [--cases <file>]");
const dir = target.includes("/") ? target : join(ROOT, ".cache", "expressway-area", target);
const cacheDir = flag("cache") ?? join(ROOT, ".cache", "gsi-vector");
const started = performance.now();
const files = readExpresswayFiles(dir);
// The most places allowed: --max, else the lane-in-site cases the folder's ledger has decided (9 in
// the default area after S6 PR 7c), else none (a folder with no ledger is only counted). Why not a
// constant: a ship folder has its own count.
const maxFlag = flag("max");
const ledgerCount = files.ledger?.cases.filter(
  (c) => c.kind === "lane-in-site" && c.status !== "gone",
).length;
const max = maxFlag !== undefined ? Number(maxFlag) : (ledgerCount ?? null);
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];
const streetsOf = gsiTileReader(cacheDir);
const regulationsAround = regulationReader();

const places: SiteLanes[] = [];
let skipped = 0;
for (const [run, chunks] of files.byRun) {
  for (const emb of chunks.filter((c) => c.structure === "embankment")) {
    const o = Math.floor(emb.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
    const lon = emb.st[o + ST.lon];
    const lat = emb.st[o + ST.lat];
    const [cx, cy] = roadTileOf(lon, lat);
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
    const frame = new LocalFrame(lat, lon, 0);
    const { graph } = gameStreetGraph(
      streets,
      expresswayRoadInput(near, runs, (_la, _lo, h) => h),
      frame,
      await regulationsAround(cx, cy),
    );
    const centre: Vector3[] = [];
    const stS: number[] = [];
    for (let i = 0; i < emb.st.length; i += STATION_STRIDE) {
      centre.push(frame.toLocal(emb.st[i + ST.lat], emb.st[i + ST.lon], 0).setY(0));
      stS.push(emb.st[i + ST.s]);
    }
    const edgeM = (emb.lanes * emb.laneWidth + emb.shoulderL + emb.shoulderR) / 2 + PARAPET_WIDTH.value;
    const site: SiteLine = { centre, s: stS, edgeM };
    for (const seg of graph.segments) {
      const isStreet = sourceOf(seg.line) === "gsi" && !isExpressway(seg.line);
      if (!isStreet) continue;
      let place: SiteLanes | null = null;
      for (const d of [1, -1] as const) {
        const isDriven = seg.oneway === 0 || seg.oneway === d;
        if (!isDriven) continue;
        for (let lane = 0; lane < seg.lanes; lane++) {
          const points: Vector3[] = [];
          for (let s = 0; s <= seg.length; s += 1) {
            const { pos, dir: along } = graph.sample(seg, s);
            points.push(pos.add(leftOf(along.multiplyScalar(d), laneCentreOffset(seg, lane))));
          }
          const over = laneOverSite(points, site);
          if (over === null) continue;
          place ??= {
            run,
            chunk: emb.id,
            s0: over.s0,
            s1: over.s1,
            lengthM: 0,
            streetM: seg.line.width,
            nearestM: over.nearestM,
            lanes: 0,
          };
          place.s0 = Math.min(place.s0, over.s0);
          place.s1 = Math.max(place.s1, over.s1);
          place.lengthM = Math.max(place.lengthM, over.lengthM);
          place.nearestM = Math.min(place.nearestM, over.nearestM);
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
// Pieces of one street split by the graph's nodes or by a chunk's end along one stretch: one place.
// Why not per chunk (before A2): a place across a chunk's end was two, and a rebuild that moved the
// chunk's end split or joined it.
const merged = mergeSitePlaces(places);
log("expressway_lanes_probed", {
  dir: target,
  places: merged.length,
  max: max ?? -1,
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
const isOver = max !== null && merged.length > max;
// A chunk skipped for want of GSI's tiles is a place not looked at: a failure, not a zero.
const isPartial = skipped > 0;
if (isOver || isPartial) process.exitCode = 1;

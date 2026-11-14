// The street lanes over a cut's site (S6 PR 7c, the ledger's street-lane-over-cut): for every run of
// a data folder with cut chunks, the GSI streets round them built as the game builds them (RoadGraph,
// the 3 × 3 z16 tiles round the cut) and every lane's centre (laneCentreOffset, each way it may be
// driven) within the hole's edge (the retaining walls' outer face) + SITE_MARGIN_M. One JSON log line
// (expressway_hole_lanes_measured); --cases <file> writes one case per run with such a lane for the
// ledger tool (just update-expressway-ledger <dir> "--lanes <file>"). Never by rule: R1 decides the
// lanes of a street with a site in it.
// Run: pnpm exec tsx scripts/expresswayHoleLanes.ts <dir|label> [--cache <dir>] [--cases <file>]
// (just check-hole-lanes <dir>; the tiles come from the cache only: a cut whose tiles are not cached
// is skipped and counted; exit code 1 when any is).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { Vector3 } from "three";
import { CUT_WALL } from "../src/expressway/assumptions.ts";
import { ST, STATION_STRIDE } from "../src/expressway/format.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { latToTileY, lonToTileX } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import { laneCentreOffset } from "../src/world/laneChange.ts";
import { isExpressway } from "../src/world/roadClass.ts";
import { leftOf, RoadGraph, type RoadLine } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, roadLinesOfTile } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";

const ROOT = join(import.meta.dirname, "..");
/** How far past the hole's edge a lane's centre counts as over the site (m): half a car's width and a margin. */
const SITE_MARGIN_M = 1;
/** The step a lane is checked at (m). */
const SAMPLE_M = 1;
/** Shorter than this over the site is a street's end cut at the site's edge (7b), not a lane over it. */
const MIN_LENGTH_M = 3;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--cache", "--cases"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error("usage: expresswayHoleLanes.ts <dir|label> [--cache <dir>] [--cases <file>]");
const dir = target.includes("/") ? target : join(ROOT, ".cache", "expressway-area", target);
const cacheDir = flag("cache") ?? join(ROOT, ".cache", "gsi-vector");
const files = readExpresswayFiles(dir);

/** One street lane over a cut's site: its segment, the way it is driven, its lane and stretch. */
export type LaneOverCut = {
  street: number;
  widthM: number;
  dir: 1 | -1;
  lane: number;
  lengthM: number;
  nearestM: number;
};
/** A run's lanes over its site, as the ledger tool reads them (--lanes). */
export type HoleLanesCase = { run: string; holeHalfM: number; lanes: LaneOverCut[] };

const out: HoleLanesCase[] = [];
let skipped = 0;
for (const [run, chunks] of files.byRun) {
  const cuts = chunks.filter((c) => c.structure === "cut");
  if (cuts.length === 0) continue;
  const mid = cuts[0].st;
  const frame = new LocalFrame(mid[ST.lat], mid[ST.lon], 0);
  const centre: Vector3[] = [];
  let half = 0;
  for (const c of cuts) {
    half = Math.max(half, (c.lanes * c.laneWidth + c.shoulderL + c.shoulderR) / 2 + CUT_WALL.value.thickness);
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      centre.push(frame.toLocal(c.st[i + ST.lat], c.st[i + ST.lon], 0).setY(0));
  }
  const cx = Math.floor(lonToTileX(mid[ST.lon], ROAD_TILE_ZOOM));
  const cy = Math.floor(latToTileY(mid[ST.lat], ROAD_TILE_ZOOM));
  const lines: RoadLine[] = [];
  let isMissing = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const file = join(cacheDir, `${ROAD_TILE_ZOOM}-${cx + dx}-${cy + dy}.pbf`);
      const bytes = await readFile(file).catch(() => null);
      if (bytes === null) isMissing = true;
      else if (bytes.length > 0)
        lines.push(...roadLinesOfTile(new VectorTile(new Pbf(new Uint8Array(bytes))), cx + dx, cy + dy));
    }
  if (isMissing) {
    skipped++;
    continue;
  }
  const graph = new RoadGraph(lines, frame);
  const toHole = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i + 1 < centre.length; i++) {
      const [a, b] = [centre[i], centre[i + 1]];
      const [ex, ez] = [b.x - a.x, b.z - a.z];
      const l2 = ex * ex + ez * ez;
      const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
      best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
    }
    return best;
  };
  const lanes: LaneOverCut[] = [];
  for (const seg of graph.segments) {
    // GSI's own line of an expressway at grade is the same road as the deck, not a street over its site.
    const isStreet = seg.line.source !== "osm" && !isExpressway(seg.line);
    if (!isStreet) continue;
    for (const d of [1, -1] as const) {
      const isDriven = seg.oneway === 0 || seg.oneway === d;
      if (!isDriven) continue;
      for (let lane = 0; lane < seg.lanes; lane++) {
        let lengthM = 0;
        let nearest = Infinity;
        for (let s = 0; s <= seg.length; s += SAMPLE_M) {
          const { pos, dir: along } = graph.sample(seg, s);
          const at = pos.add(leftOf(along.multiplyScalar(d), laneCentreOffset(seg, lane)));
          const dist = toHole(at.x, at.z);
          nearest = Math.min(nearest, dist);
          const isOver = dist <= half + SITE_MARGIN_M;
          if (isOver) lengthM += SAMPLE_M;
        }
        const isLane = lengthM >= MIN_LENGTH_M;
        if (isLane)
          lanes.push({
            street: seg.id,
            widthM: seg.line.width,
            dir: d,
            lane,
            lengthM,
            nearestM: Math.round(nearest * 100) / 100,
          });
      }
    }
  }
  if (lanes.length > 0) out.push({ run, holeHalfM: half, lanes });
}

log("expressway_hole_lanes_measured", {
  dir: target,
  runs: out.length,
  lanes: out.reduce((n, c) => n + c.lanes.length, 0),
  longestM: Math.max(0, ...out.flatMap((c) => c.lanes.map((l) => l.lengthM))),
  skippedForMissingTiles: skipped,
  byRun: out.map((c) => ({
    run: c.run,
    lanes: c.lanes.length,
    longestM: Math.max(...c.lanes.map((l) => l.lengthM)),
  })),
});
const casesPath = flag("cases");
if (casesPath !== undefined) await writeFile(casesPath, JSON.stringify(out, null, 1) + "\n");
// A chunk skipped for want of GSI's tiles is a place not looked at: a failure, not a zero.
const isPartial = skipped > 0;
if (isPartial) process.exitCode = 1;

// Whether the ramps' feet of a data folder join the streets as F1 asks (S6 PR 7c1,
// src/world/expresswayRoads.ts): every ramp's and structure street's ground end joined the way the
// game joins it (the 3 × 3 z16 GSI tiles round the foot as the loaded streets, the chunks within
// GRAPH_RADIUS_M of it as the loaded decks), and its connector checked against rule 1 (no point
// behind the end face outside the carriageway: it would run through the deck's own wall) and rule 2
// (its first LEAD_M straight ahead, within LEAD_TOLERANCE_M), and its street leg against turning back
// (over TURN_BACK_DEG off the heading; over LEG_MAX_DEG is listed). One JSON log line
// (expressway_feet_probed); exit code 1 when any foot breaks one of them.
// Run: pnpm exec tsx scripts/expresswayFeetProbe.ts <dir|label> [--cache <dir>] [--cache-only]
// (just check-expressway-feet <dir>; a label without a slash means .cache/expressway-area/<label>).
// The tiles come from --cache (default .cache/gsi-vector) or GSI (written to the cache); with
// --cache-only a foot whose tiles are not cached is skipped and counted.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { ST, STATION_STRIDE, type XwTileRun } from "../src/expressway/format.ts";
import { haversine, planeAt } from "../src/expressway/geo.ts";
import { latToTileY, lonToTileX } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import {
  expresswayRoadInput,
  isClearOfDeck,
  joinExpressway,
  LEAD_M,
  type XwGroundEnd,
} from "../src/world/expresswayRoads.ts";
import type { RoadDiagnostic, RoadLine } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, roadLinesOfTile } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";

const ROOT = join(import.meta.dirname, "..");
/** How far off the heading the first LEAD_M may stray (m): a join within a metre of the lead point goes straight to it. */
const LEAD_TOLERANCE_M = 1;
/** The step a connector is checked at (m). */
const CHECK_STEP_M = 0.25;
/**
 * The decks the game joins round a foot (expresswayDeck.ts GRAPH_RADIUS_M). Why not import it: the
 * deck module imports its textures, which Node cannot load.
 */
const GRAPH_RADIUS_M = 1300;
/** How many of the breaking feet the log line lists. */
const LIST = 30;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--cache"));
if (target === undefined)
  throw new Error("usage: expresswayFeetProbe.ts <dir|label> [--cache <dir>] [--cache-only]");
const isLabel = !target.includes("/");
const dir = isLabel ? join(ROOT, ".cache", "expressway-area", target) : target;
const cacheDir = flag("cache") ?? join(ROOT, ".cache", "gsi-vector");
const isCacheOnly = args.includes("--cache-only");

const started = performance.now();
const files = readExpresswayFiles(dir);
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];

const tiles = new Map<string, RoadLine[] | null>();
/** A z16 tile's streets, from the cache or GSI (an empty file remembers a 404); null when not to be had. */
async function streetsOf(x: number, y: number): Promise<RoadLine[] | null> {
  const key = `${x}-${y}`;
  if (tiles.has(key)) return tiles.get(key)!;
  const file = join(cacheDir, `${ROAD_TILE_ZOOM}-${key}.pbf`);
  let bytes: Uint8Array | null = null;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch {
    if (!isCacheOnly) {
      const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${ROAD_TILE_ZOOM}/${x}/${y}.pbf`;
      const res = await fetch(url);
      const isMissing = res.status === 404;
      if (!res.ok && !isMissing) throw new Error(`${url}: HTTP ${res.status}`);
      bytes = isMissing ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, bytes);
    }
  }
  const lines =
    bytes === null ? null : bytes.length === 0 ? [] : roadLinesOfTile(new VectorTile(new Pbf(bytes)), x, y);
  tiles.set(key, lines);
  return lines;
}

type Breach = {
  run: string;
  end: "start" | "end";
  rule: "beside-deck" | "not-straight" | "turns-back";
  out: number;
  left: number;
};
const round = (v: number) => Math.round(v * 100) / 100;
const joined = { atGrade: 0, street: 0, inside: 0, unattached: 0 };
const breaches: Breach[] = [];
const unattachedFeet: Array<{ run: string; end: "start" | "end" }> = [];
let feet = 0;
let groundRunFeet = 0;
let skipped = 0;
let maxLegDeg = 0;
/** The feet whose street leg turns more than LEG_MAX_DEG off the heading (none within it was in reach). */
const steepFeet: Array<{ run: string; end: "start" | "end"; deg: number }> = [];
/** rule (b)'s turn from the heading (deg) past which a leg is not a turn but a way back. */
const LEG_MAX_DEG = 45;
const TURN_BACK_DEG = 90;

for (const [run, chunks] of files.byRun) {
  const summary = files.runById.get(run);
  const isJoined = summary !== undefined && summary.cls !== "expressway";
  if (!isJoined) continue;
  for (const end of ["start", "end"] as const) {
    if (summary[end].kind !== "ground") continue;
    const chunk = end === "start" ? chunks[0] : chunks[chunks.length - 1];
    const o = end === "start" ? 0 : chunk.st.length - STATION_STRIDE;
    const lon = chunk.st[o + ST.lon];
    const lat = chunk.st[o + ST.lat];
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
    feet++;
    if (summary.ground === true) groundRunFeet++;
    const near = files.chunks.filter((c) => {
      for (let i = 0; i < c.st.length; i += STATION_STRIDE)
        if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= GRAPH_RADIUS_M) return true;
      return false;
    });
    const input = expresswayRoadInput(near, runs, (_lat, _lon, h) => h);
    const foot = input.ends.find((e) => e.run === run && e.end === end);
    if (!foot) continue;
    const diags: RoadDiagnostic[] = [];
    const lines = joinExpressway(streets, input, (d) => diags.push(d));
    const isUnattached = diags.some(
      (d) => d.event === "ramp_unattached" && d.fields.run === run && d.fields.end === end,
    );
    if (isUnattached) {
      joined.unattached++;
      unattachedFeet.push({ run, end });
      continue;
    }
    const connector = lines.find(
      (l) => l.xid === undefined && l.source === "osm" && (l.nodeIds ?? []).includes(foot.node),
    );
    if (!connector) {
      joined.inside++;
      continue;
    }
    const isTraced = (connector.nodeIds ?? []).every((id) => !id.startsWith("xwg:"));
    if (isTraced) joined.atGrade++;
    else joined.street++;
    const breach = checkConnector(foot, connector, !isTraced, run, end);
    if (breach) breaches.push({ run, end, ...breach });
  }
}

/** The first point of a connector breaking rule 1 or 2, in the foot's (out, left), or null. */
function checkConnector(
  foot: XwGroundEnd,
  connector: RoadLine,
  isStreetJoin: boolean,
  run: string,
  end: "start" | "end",
): Omit<Breach, "run" | "end"> | null {
  const plane = planeAt(foot.lon, foot.lat);
  const [dx, dy] = foot.dir;
  const rel = (lo: number, la: number): [number, number] => {
    const [x, y] = plane.toXY(lo, la);
    return [x * dx + y * dy, -x * dy + y * dx];
  };
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < connector.coords.length; i += 2)
    pts.push(rel(connector.coords[i], connector.coords[i + 1]));
  const fromFoot = foot.end === "start" ? pts.toReversed() : pts;
  let arc = 0;
  for (let i = 0; i + 1 < fromFoot.length; i++) {
    const [a, b] = [fromFoot[i], fromFoot[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const legDeg = (Math.atan2(Math.abs(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
    // The leg from the lead point to the street (rule (b)'s 45°); a traced line bends as GSI's does.
    const isStreetLeg = isStreetJoin && arc >= LEAD_M - 1e-6;
    if (isStreetLeg) maxLegDeg = Math.max(maxLegDeg, legDeg);
    const isSteep = isStreetLeg && legDeg > LEG_MAX_DEG + 1e-6;
    if (isSteep) steepFeet.push({ run, end, deg: Math.round(legDeg) });
    const isTurningBack = isSteep && legDeg > TURN_BACK_DEG;
    if (isTurningBack) return { rule: "turns-back", out: round(b[0]), left: round(b[1]) };
    for (let d = 0; d <= len; d += CHECK_STEP_M) {
      const t = len > 0 ? d / len : 0;
      const out = a[0] + (b[0] - a[0]) * t;
      const left = a[1] + (b[1] - a[1]) * t;
      if (!isClearOfDeck(out, left, foot.halfWidth))
        return { rule: "beside-deck", out: round(out), left: round(left) };
      const isInLead = arc + d <= LEAD_M;
      const isStraight = Math.abs(left) <= LEAD_TOLERANCE_M && out >= -1e-6;
      if (isInLead && !isStraight) return { rule: "not-straight", out: round(out), left: round(left) };
    }
    arc += len;
  }
  return null;
}

log("expressway_feet_probed", {
  dir: target,
  feet,
  groundRunFeet,
  skippedForMissingTiles: skipped,
  joined,
  violations: breaches.length,
  violating: breaches.slice(0, LIST),
  unattachedFeet: unattachedFeet.slice(0, LIST),
  maxLegDeg: Math.round(maxLegDeg),
  steepFeet: steepFeet.slice(0, LIST),
  durationMs: Math.round(performance.now() - started),
});
if (breaches.length > 0) process.exitCode = 1;

// P2.7 R1-2: the street segments an expressway's site (embankment or cut, XwSite) runs along, and
// what R1-2a's rules (memo 改訂 1, 3.3) make of each. Read only: the game is not changed by it. For
// every group of site chunks whose middles share a z16 tile, the network round it is built as the
// worker builds it (scripts/gameStreets.ts: the expressway joined in, the regulations applied), and
// each GSI street segment is sampled every metre: where a site within SITE_CROSSING_MIN_DEG of the
// street's heading reaches the street's 幅員, the site's strip (half its slab, widened by
// SITE_CLEARANCE_M) is a strip across the street. Runs of such samples (MIN_LENGTH_M or more,
// JOIN_GAP_M gaps closed) give the segment's bands (scripts/streetBands.ts mergeBands: strips a lane
// or more apart stay apart), and the segment is classed (classify):
//   clear  no lane's centre lies in the band now: nothing to change;
//   A      two-way, a 中央帯 over the band holds a lane each way (in the carriageway as it is, else in
//          the room streetRoom leaves);
//   A'     the band on one side: the carriageway capped at twice the band's inner edge holds a lane
//          each way (one-way: a lane);
//   B1     one-way, unresolved, but a lane or more fits to one side of the bands within the room;
//   B2     two-way, unresolved, but a lane or more a way fits beside the bands within the room;
//   B3     A or A' fits, but a moved line would keep more lanes (memo 3.3 の 5): left as it is;
//   C      fits nowhere within the room.
// B1, B2, B3 and C need the street's line moved sideways (R1-2b); no street is cut. Also: the lane 0
// centre's sideways jump at the ends of each A / A' segment before and after (memo 3.4), PLATEAU's
// pavement inside the bands and under an edge line moved out, the ramps' feet beside the bands,
// piers over the lanes, and the nodes with two segments only.
// One JSON log line (street_bands_measured) and --out <file> for the full list.
// Run: pnpm exec tsx scripts/measureStreetBands.ts <dir|label> [--cache <dir>] [--plateau <dir>] [--out <file>] [--moves <file>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { Vector3 } from "three";
import { PARAPET_WIDTH } from "../src/expressway/assumptions.ts";
import { PIER_STRIDE, ST, STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { carriagewayWidth as deckCarriageway } from "../src/expressway/section.ts";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { tileXToLon, tileYToLat } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import { expresswayRoadInput, sameRoadGaps, streetsAtSites } from "../src/world/expresswayRoads.ts";
import { laneCentreOffset, laneWidth, STREET, streetRoom } from "../src/world/laneChange.ts";
import { polygonsOf, WARD_TILES, type PavementPolygon } from "../src/world/pavements.ts";
import { isExpressway, sourceOf } from "../src/world/roadClass.ts";
import { type RoadLine, type Segment } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, widthBoundsOf } from "../src/world/roadTiles.ts";
import { isAllDay, readTime } from "../src/time/ruleTime.ts";
import { ROAD_LANES_COLUMN } from "../src/world/roadLanesData.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { classify, type Klass, laneZero, mergeBands, offCentreLanes, type Ruling } from "./streetBands.ts";
import { DATA_DIR, gameStreetGraph, gsiTileReader, regulationReader, roadTileOf } from "./gameStreets.ts";

const ROOT = join(import.meta.dirname, "..");
/** The decks the game joins round a point (expresswayDeck.ts GRAPH_RADIUS_M). */
const GRAPH_RADIUS_M = 1300;
/**
 * The values the memo names (3.2): expresswayRoads.ts's SITE_CROSSING_MIN_DEG and SITE_CLEARANCE_M,
 * the lanes probe's MIN_LENGTH_M and JOIN_GAP_M. Copied, as GRAPH_RADIUS_M is: the src ones are not
 * exported, and R1-2-0 changes no runtime code (expresswayFeetProbe.ts copies its own the same way).
 */
const SITE_CROSSING_MIN_DEG = 30;
const SITE_CLEARANCE_M = 1;
const MIN_LENGTH_M = 3;
const JOIN_GAP_M = 1;
/** The street's shoulder: the edge line runs this far inside the carriageway. */
const SHOULDER = STREET.shoulder;
/** A segment beyond a node within this of straight on is the same street going on (deg). */
const STRAIGHT_ON_DEG = 30;
/** A foot's join this close to a band's segment is listed (memo 手順 0 の 7). */
const FOOT_NEAR_M = 30;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--cache", "--out", "--plateau", "--moves"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error(
    "usage: measureStreetBands.ts <dir|label> [--cache <dir>] [--plateau <dir>] [--out <file>]",
  );
const dataDir = target.includes("/") ? target : join(ROOT, ".cache", "expressway-area", target);
const cacheDir = flag("cache") ?? join(ROOT, ".cache", "gsi-vector");
const plateauDir = flag("plateau") ?? join(ROOT, ".cache", "plateau-tran");
const files = readExpresswayFiles(dataDir);
const started = performance.now();
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];
const areas = new AreaIndex(JSON.parse(await readFile(join(DATA_DIR, "areas.json"), "utf8")) as AreaFile);
const streetsOf = gsiTileReader(cacheDir);
const regulationsAround = regulationReader();

/** PLATEAU's pavements of a z16 tile, every ward round it (cached under --plateau; 403/404 kept empty). */
async function plateauOf(x: number, y: number): Promise<PavementPolygon[]> {
  const lon0 = tileXToLon(x, 16);
  const lat0 = tileYToLat(y + 1, 16);
  const wards = areas.wardsIn(lon0, lat0, tileXToLon(x + 1, 16), tileYToLat(y, 16));
  const out: PavementPolygon[] = [];
  for (const ward of wards) {
    const base = WARD_TILES[ward];
    if (!base) continue;
    const file = join(plateauDir, `${base.split("/").at(-1)}-${x}-${y}.mvt`);
    let bytes = await readFile(file).catch(() => null);
    if (bytes === null) {
      const res = await fetch(`https://assets.cms.plateau.reearth.io/assets/${base}/16/${x}/${y}.mvt`);
      const isAbsent = res.status === 403 || res.status === 404;
      const isFailed = !isAbsent && !res.ok;
      if (isFailed) throw new Error(`PLATEAU ${res.status} ${x}/${y}`);
      bytes = isAbsent ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
      await mkdir(plateauDir, { recursive: true });
      await writeFile(file, bytes);
    }
    if (bytes.length === 0) continue;
    const tile = new VectorTile(new Pbf(new Uint8Array(bytes)));
    for (const [layerName, wanted, kind] of [
      ["TrafficArea", "歩道部", "sidewalk"],
      ["AuxiliaryTrafficArea", "島", "island"],
    ] as const) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const isWanted = f.type === 3 && f.properties.tran_function === wanted;
        if (!isWanted) continue;
        for (const rings of polygonsOf(f.loadGeometry(), layer.extent))
          out.push({
            kind,
            rings: rings.map((ring) =>
              ring.flatMap((pt) => [
                tileXToLon(x + pt.x / layer.extent, 16),
                tileYToLat(y + pt.y / layer.extent, 16),
              ]),
            ),
          });
      }
    }
  }
  return out;
}

// ---------- geometry ----------

type P = { x: number; z: number };
type BandSite = { chunk: string; run: string; structure: string; pts: P[]; s: number[]; half: number };
type Strip = { right: number; left: number; chunk: string; structure: string; s: number };

/**
 * The sites' strips across a street at one point (`p`, unit heading `t`, 幅員 `width`): one for every
 * site segment the street's normal through p meets at under SITE_CROSSING_MIN_DEG, its half width over
 * the cosine of the angle, widened by SITE_CLEARANCE_M, that reaches the street's 幅員. Why each its
 * own and not their union: two decks either side of a street meet one normal, and their union covers
 * the lanes between them (mergeBands decides what is one band).
 */
function stripsAt(p: P, t: P, width: number, sites: readonly BandSite[]): Strip[] {
  const n = { x: t.z, z: -t.x }; // leftOf
  const cosMin = Math.cos((SITE_CROSSING_MIN_DEG * Math.PI) / 180);
  const out: Strip[] = [];
  for (const site of sites) {
    for (let j = 0; j + 1 < site.pts.length; j++) {
      const a = site.pts[j];
      const b = site.pts[j + 1];
      const e = { x: b.x - a.x, z: b.z - a.z };
      const len = Math.hypot(e.x, e.z);
      if (len < 1e-6) continue;
      const cos = Math.abs(t.x * e.x + t.z * e.z) / len;
      const isAlong = cos > cosMin;
      if (!isAlong) continue;
      // p + u n = a + v e
      const det = -n.x * e.z + n.z * e.x;
      if (Math.abs(det) < 1e-9) continue;
      const rx = a.x - p.x;
      const rz = a.z - p.z;
      const u = (rx * -e.z + rz * e.x) / det;
      const v = (n.x * rz - n.z * rx) / det;
      const isOnSegment = v >= 0 && v <= 1;
      if (!isOnSegment) continue;
      const across = site.half / cos + SITE_CLEARANCE_M;
      const right = u - across;
      const left = u + across;
      const reaches = left > -width / 2 && right < width / 2;
      if (!reaches) continue;
      const s = site.s[j] + (site.s[j + 1] - site.s[j]) * v;
      out.push({ right, left, chunk: site.chunk, structure: site.structure, s });
    }
  }
  return out;
}

function insidePolygon(x: number, z: number, ring: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

// ---------- R1-2b 手順 0b: moving the street's line (measured, not done) ----------

/**
 * What moving a banded street's line off its bands would take (memo R1-2b 手順 0b): the shape (a
 * band over the middle of a two-way street, on one side, or a one-way street), the move (a two-way
 * street over its middle split into two lines, one each side; otherwise the whole carriageway put
 * beside the bands, a one-way street to its left of travel first), how far each piece moves and how
 * far past the 幅員's edge it reaches, and what lies where it would go (another site, another
 * street's carriageway, PLATEAU's pavement, a GSI building, as shares of the points sampled across
 * the moved carriageway every 0.5 m at each band sample). Also: the junctions round the band, a
 * street drawn over the ramp itself, a foot joined to it, and whether JARTIC's one-way lines run
 * either side of it (a divided street drawn as one line).
 */
type MoveOption = {
  side: "left" | "right" | "split";
  /** Sideways moves of the carriageway's pieces (m, + left of the coords). */
  moves: number[];
  /** Past the 幅員's edge, the most either side (m). */
  outOfWidthM: number;
  /**
   * `street` counts only another line running alongside (under 30°, not this line doubled: 手順 0c
   * の 2, the one that blocks); `streetCross` a street across it (a junction) and `streetTwin` the
   * same line drawn twice (knowledge road-model.md's doubled GSI lines), neither of which blocks.
   */
  shares: {
    site: number;
    street: number;
    streetCross: number;
    streetTwin: number;
    pavement: number;
    building: number;
  };
  /** The lines alongside that join the same two junctions as this one (within 5 m of its ends). */
  parallelSameEnds: number;
};
type Move = {
  seg: number;
  at: [number, number];
  klass: Klass;
  lengthM: number;
  widthM: number;
  travel: 0 | 1 | -1;
  lanes: number;
  shape: "middle" | "side" | "one-way";
  options: MoveOption[];
  best: "fits-in-width" | "out-of-width-clear" | "blocked" | "neither";
  toJunctionM: [number, number];
  junctionsNear: number;
  rampDrawn: boolean;
  footJoined: boolean;
  jartic: "split" | "one-way" | "none";
  /** 手順 0c の 3, for a wide street (13 m or more) GSI draws two-way but JARTIC makes one-way. */
  oneway?: OnewaySource;
  /** R1-2b PR 2 手順 0-A: form E (move each sample by its own need, up to its cap) on this segment. */
  e: MoveE;
};
/**
 * R1-2b PR 2 手順 0-A (r1-2b-pr2-instructions.md 3 節 form E, 4 節): what moving this segment sample
 * by sample would need and allow. `need` (m) at a sample: how far sideways, away from the site, the
 * carriageway's edge must go to reach the band's edge (0 where the band misses the carriageway);
 * a sample whose band straddles the centre line, or with bands on both sides, cannot move. `capM`:
 * the most it may go, its carriageway's outer edge kept within half the 幅員 class's upper bound (the
 * 幅員 itself for the open class and for an exact width) and within EXTENT_MARGIN_M × the slope.
 */
type MoveE = {
  memoClass: string;
  widthClassUpperM: number | null;
  onewayFrom: "gsi" | "jartic-all-day" | "jartic-timed" | "two-way";
  foot: string | null;
  bridge: boolean;
  needSamples: number;
  needMedianM: number | null;
  needMaxM: number | null;
  capM: number;
  movableSamples: number;
  lanesNow: number;
  /** Lanes the street's own width holds off the band (R1-2a's offCentre, 0c の 6); form E moves the whole carriageway, so a movable sample keeps lanesNow. */
  lanesOffCentreInWidth: number;
  verdict: "movable" | "partly movable" | "not movable";
  reasons: string[];
  /**
   * On the side it would go to (the 0b option, the whole segment moved by its most): the shares of
   * PLATEAU's pavement and islands and of this line drawn twice. Columns, not reasons: whether the
   * pavement is newly met (not under the carriageway already) is not told here, and a doubled line
   * does not block (追記 1 A6 4).
   */
  beyond: { pavement: number; twin: number };
  junctions: { cross: number; tee: number; controlled: number };
};
/**
 * Where a JARTIC one-way on a two-way GSI line comes from (手順 0c の 3): the voting JARTIC line's
 * offset from the centre line (+ left of the coords), whether an opposite JARTIC one-way runs on the
 * other side, and what OSM's lanes say beside it: a divided street (one-way ways both ways), one-way
 * (one way only), a single two-way way, or nothing mapped.
 */
type OnewaySource = {
  jarticOffsetM: number | null;
  jarticOpposite: boolean;
  osm: "divided" | "one-way" | "two-way" | "unknown";
};

/** GSI's building footprints of a z16 tile (the same cached tiles as the streets; lon/lat rings). */
async function buildingsOf(x: number, y: number): Promise<number[][]> {
  const bytes = await readFile(join(cacheDir, `${ROAD_TILE_ZOOM}-${x}-${y}.pbf`)).catch(() => null);
  const isMissing = bytes === null || bytes.length === 0;
  if (isMissing) return [];
  const tile = new VectorTile(new Pbf(new Uint8Array(bytes)));
  const layer = tile.layers.building;
  if (!layer) return [];
  const out: number[][] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const isPolygon = f.type === 3;
    if (!isPolygon) continue;
    for (const rings of polygonsOf(f.loadGeometry(), layer.extent))
      out.push(
        rings[0].flatMap((pt) => [
          tileXToLon(x + pt.x / layer.extent, ROAD_TILE_ZOOM),
          tileYToLat(y + pt.y / layer.extent, ROAD_TILE_ZOOM),
        ]),
      );
  }
  return out;
}

/** memo 1's class of a move case (as movesSummary.byMemoClass reads it). */
function memoClassOf(widthM: number, hasJarticOneway: boolean, shape: Move["shape"]): string {
  if (widthM < 13) return "γ";
  if (hasJarticOneway) return "β1";
  if (shape === "middle") return "β2";
  if (shape === "side") return "β3";
  return "β1-like (one-way line)";
}

/** expresswayRoads.ts EXTENT_MARGIN_M (not exported) and memo 4.2's slope (7.5 m across in 40 m along). */
const EXTENT_MARGIN_M = 60;
const MOVE_SLOPE = 7.5 / 40;

/** Form E on a segment (MoveE): per sample need and cap, the line's verdict and its reasons. */
function formE(c: {
  seg: Segment;
  kept: Array<{ l: number; strips: Strip[] }>;
  carriageway: number;
  lanes: number;
  lanesOffCentreInWidth: number;
  options: MoveOption[];
  isJarticWide: boolean;
  shape: Move["shape"];
  foot: string | null;
  junctionAt: (node: number) => { ways: number; isControlled: boolean };
  toJ: [number, number];
}): MoveE {
  const W = c.seg.line.width;
  const bounds = widthBoundsOf(W);
  const isOpenOrExact = !Number.isFinite(bounds.upper) || bounds.upper === bounds.lower;
  const upper = isOpenOrExact ? W : bounds.upper;
  const capM = Math.max(0, Math.min(upper / 2 - c.carriageway / 2, EXTENT_MARGIN_M * MOVE_SLOPE));
  const rule = c.seg.onewayRule;
  const onewayFrom: MoveE["onewayFrom"] =
    c.seg.line.oneway !== 0
      ? "gsi"
      : rule === null
        ? "two-way"
        : isAllDay(rule.time)
          ? "jartic-all-day"
          : "jartic-timed";
  const needs: number[] = [];
  let movable = 0;
  let unmovableSide = 0;
  const dirs = new Set<number>();
  for (const h of c.kept) {
    const right = Math.min(...h.strips.map((b) => b.right));
    const left = Math.max(...h.strips.map((b) => b.left));
    const isOnLine = right < 0 && left > 0;
    const hasBoth = h.strips.some((b) => b.right > 0) && h.strips.some((b) => b.left < 0);
    if (isOnLine || hasBoth) {
      unmovableSide++;
      continue;
    }
    const isSiteLeft = right >= 0;
    const need = isSiteLeft ? c.carriageway / 2 - right : left + c.carriageway / 2;
    const isClearAlready = need <= 0;
    if (isClearAlready) continue;
    needs.push(need);
    dirs.add(isSiteLeft ? -1 : 1);
    if (need <= capM) movable++;
  }
  const sorted = needs.toSorted((a, b) => a - b);
  const needMaxM = sorted.length ? sorted.at(-1)! : null;
  const reasons: string[] = [];
  const isJarticOneway = onewayFrom.startsWith("jartic");
  if (isJarticOneway) reasons.push("jartic one-way");
  if (c.foot !== null) reasons.push("foot");
  if (c.seg.line.bridge === true) reasons.push("bridge");
  if (unmovableSide > 0 || dirs.size > 1) reasons.push("site both sides or on the line");
  if (needs.length > movable) reasons.push("over the cap");
  // The side it would go to (away from the site): that option's shares of buildings and streets.
  const side = dirs.has(1) ? "left" : "right";
  const option = c.options.find((o) => o.side === side);
  if ((option?.shares.site ?? 0) > 0) reasons.push("site beyond");
  if ((option?.shares.building ?? 0) > 0) reasons.push("building beyond");
  if ((option?.shares.street ?? 0) > 0) reasons.push("street alongside beyond");
  const isLineBlocked = reasons.some((r) =>
    [
      "jartic one-way",
      "foot",
      "bridge",
      "site beyond",
      "building beyond",
      "street alongside beyond",
    ].includes(r),
  );
  const verdict: MoveE["verdict"] =
    isLineBlocked || movable === 0
      ? "not movable"
      : movable < needs.length || unmovableSide > 0
        ? "partly movable"
        : "movable";
  // Junctions within the stretch moved and its slope's reach: the segment's own end nodes.
  const reach = (needMaxM ?? 0) / MOVE_SLOPE;
  const junctions = { cross: 0, tee: 0, controlled: 0 };
  for (const [i, node] of [c.seg.from, c.seg.to].entries()) {
    const isInReach = c.toJ[i] <= reach;
    if (!isInReach) continue;
    const j = c.junctionAt(node);
    if (j.ways >= 4) junctions.cross++;
    else if (j.ways === 3) junctions.tee++;
    if (j.isControlled) junctions.controlled++;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    memoClass: memoClassOf(W, c.isJarticWide, c.shape),
    widthClassUpperM: isOpenOrExact ? null : bounds.upper,
    onewayFrom,
    foot: c.foot,
    bridge: c.seg.line.bridge === true,
    needSamples: needs.length,
    needMedianM: sorted.length ? r2(sorted[Math.floor(sorted.length / 2)]) : null,
    needMaxM: needMaxM === null ? null : r2(needMaxM),
    capM: r2(capM),
    movableSamples: movable,
    lanesNow: c.lanes,
    lanesOffCentreInWidth: c.lanesOffCentreInWidth,
    verdict,
    reasons,
    beyond: { pavement: option?.shares.pavement ?? 0, twin: option?.shares.streetTwin ?? 0 },
    junctions,
  };
}

/** Distance from p to a polyline. */
function toPolyline(p: P, pts: readonly P[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2));
    best = Math.min(best, Math.hypot(a.x + ex * t - p.x, a.z + ez * t - p.z));
  }
  return best;
}

// ---------- the walk ----------

type Banded = {
  run: string;
  chunk: string;
  /** Every chunk a strip of the segment's bands comes from (two decks beside one street). */
  chunks: string[];
  structure: string;
  s0: number;
  s1: number;
  lengthM: number;
  seg: number;
  segLengthM: number;
  at: [number, number];
  widthM: number;
  travel: 0 | 1 | -1;
  lineOneway: number;
  ruled: boolean;
  lanes: number;
  basis: string;
  medianNow: number;
  carriagewayNow: number;
  room: number;
  right: number;
  left: number;
  bands: Array<{ right: number; left: number }>;
  ruling: Ruling;
  lanesChange: number;
  widened: boolean;
  offCentre: number;
  edgeOnPavement: boolean;
  pavementShare: number;
  footNearM: number | null;
};
type Jump = { seg: number; node: string; other: number; beforeM: number; afterM: number };

const lane0Now = (seg: Segment) => laneCentreOffset(seg, 0);
/** A segment's unit heading out of one of its end nodes. */
const headingOut = (seg: Segment, node: number): P => {
  const atFrom = seg.from === node;
  const a = atFrom ? seg.pts[0] : seg.pts[seg.pts.length - 1];
  const b = atFrom ? seg.pts[1] : seg.pts[seg.pts.length - 2];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
};
const isStreet = (seg: Segment) => sourceOf(seg.line) === "gsi" && !isExpressway(seg.line);
const round = (v: number, k = 100) => Math.round(v * k) / k;
const banded: Banded[] = [];
const moves: Move[] = [];
/** 手順 0c の 3 over every network: wide GSI two-way streets JARTIC makes one-way, each once. */
/** 手順 0c の 1: the streets taken out as the ramp itself (M1), each once. */
const alphas = new Map<
  string,
  { at: [number, number]; chunk: string; widthM: number; lengthM: number; jarticLanes: number }
>();
const ruledOneways = new Map<string, OnewaySource & { lengthM: number; widthM: number }>();
const isWideRuledOneway = (seg: Segment) =>
  seg.line.width >= 13 && seg.line.oneway === 0 && seg.onewayRule !== null;
const jumps: Jump[] = [];
const piersOverLanes: Array<{ chunk: string; s: number; street: number; widthM: number }> = [];
const twoNodes = new Map<string, { stop: boolean; crossing: boolean; signal: boolean }>();
let skipped = 0;
let groupsWithoutRegulations = 0;

const siteChunks = files.chunks.filter((c) => c.structure === "embankment" || c.structure === "cut");
const tileKeyOf = (c: XwChunk) => {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  return roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-");
};
const groups = new Map<string, XwChunk[]>();
for (const c of siteChunks) groups.set(tileKeyOf(c), [...(groups.get(tileKeyOf(c)) ?? []), c]);

for (const [key, focus] of groups) {
  const [cx, cy] = key.split("-").map(Number);
  const streets: RoadLine[] = [];
  let isMissing = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const lines = await streetsOf(cx + dx, cy + dy);
      if (lines === null) isMissing = true;
      else streets.push(...lines);
    }
  if (isMissing) {
    skipped += focus.length;
    continue;
  }
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= GRAPH_RADIUS_M) return true;
    return false;
  });
  const frame = new LocalFrame(lat, lon, 0);
  const regs = await regulationsAround(cx, cy);
  if (regs === null) groupsWithoutRegulations++;
  const local = (lo: number, la: number): P => {
    const v = frame.toLocal(la, lo, 0);
    return { x: v.x, z: v.z };
  };
  const xwInput = expresswayRoadInput(near, runs, (_la, _lo, h) => h);
  const { graph, applied } = gameStreetGraph(streets, xwInput, frame, regs);
  // 手順 0c の 1: the streets the game now takes out as the ramp itself (M1, α), judged on the lines
  // as joinExpressway hands them to the rule (GSI 高速道路 replaced, crossings cut), not the tiles as
  // read: a GSI ramp line the game drops is no street.
  const hasChunks = xwInput.lines.length > 0;
  if (hasChunks) {
    const { cut, xy } = streetsAtSites(streets, xwInput, () => {});
    for (const taken of sameRoadGaps(cut, xwInput.sites ?? [], xy)) {
      const st = taken.judgement.stretches[0];
      const k = st.at.map((v) => v.toFixed(5)).join(",");
      if (alphas.has(k)) continue;
      const street = cut[st.street];
      // JARTIC 車両通行帯 matched onto it as applyRegulations matches them (within the larger of 6 m
      // and half its 幅員 + 2 m, parallel within 25°): 2 or more is a lane count no ramp's foot carries.
      const p = local(st.at[1], st.at[0]);
      const c = street.coords;
      const a0 = local(c[0], c[1]);
      const a1 = local(c[c.length - 2], c[c.length - 1]);
      const dl = Math.hypot(a1.x - a0.x, a1.z - a0.z) || 1;
      const dir = { x: (a1.x - a0.x) / dl, z: (a1.z - a0.z) / dl };
      const reach = Math.max(6, street.width / 2 + 2);
      const jarticLanes = Math.max(
        0,
        ...(regs?.lanes ?? []).map((r) => {
          let best = 0;
          for (let i = 1; i + 3 < r.length; i += 2) {
            const q0 = local(r[i], r[i + 1]);
            const q1 = local(r[i + 2], r[i + 3]);
            const ql = Math.hypot(q1.x - q0.x, q1.z - q0.z);
            if (ql < 1e-6) continue;
            const isParallel =
              Math.abs(((q1.x - q0.x) * dir.x + (q1.z - q0.z) * dir.z) / ql) > Math.cos((25 * Math.PI) / 180);
            const isNear = toPolyline(p, [q0, q1]) <= reach;
            if (isParallel && isNear) best = r[0];
          }
          return best;
        }),
      );
      let lineM = 0;
      for (let i = 2; i + 1 < street.coords.length; i += 2) {
        const [ax, ay] = xy(street.coords[i - 2], street.coords[i - 1]);
        const [bx, by] = xy(street.coords[i], street.coords[i + 1]);
        lineM += Math.hypot(bx - ax, by - ay);
      }
      alphas.set(k, {
        at: st.at,
        chunk: st.chunk,
        widthM: street.width,
        // What the game takes out: the gaps, carried on into the band (追記 4 K2), on the line.
        lengthM: Math.round(
          taken.gaps.reduce((n, [g0, g1]) => n + Math.max(0, Math.min(g1, lineM) - Math.max(0, g0)), 0),
        ),
        jarticLanes,
      });
    }
  }
  const sites: BandSite[] = near
    .filter((c) => c.structure === "embankment" || c.structure === "cut")
    .map((c) => {
      const pts: P[] = [];
      const s: number[] = [];
      for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
        pts.push(local(c.st[i + ST.lon], c.st[i + ST.lat]));
        s.push(c.st[i + ST.s]);
      }
      return {
        chunk: c.id,
        run: c.run,
        structure: c.structure,
        pts,
        s,
        half: deckCarriageway(c) / 2 + PARAPET_WIDTH.value,
      };
    });
  const focusIds = new Set(focus.map((c) => c.id));
  const runOf = new Map(near.map((c) => [c.id, c.run]));
  // PLATEAU round the group (the 3 × 3 tiles), in the frame.
  const pavements: Array<{ kind: string; ring: P[] }> = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (const poly of await plateauOf(cx + dx, cy + dy)) {
        const outer = poly.rings[0];
        const ring: P[] = [];
        for (let i = 0; i + 1 < outer.length; i += 2) ring.push(local(outer[i], outer[i + 1]));
        pavements.push({ kind: poly.kind, ring });
      }
  const onPavement = (x: number, z: number, kinds: readonly string[]) =>
    pavements.some((p) => kinds.includes(p.kind) && insidePolygon(x, z, p.ring));
  // The feet's joins: a connector's node on a street.
  const footNodes: Array<P & { name: string }> = [];
  for (const seg of graph.segments) {
    const isConnector = sourceOf(seg.line) === "osm" && seg.line.structure === "ground";
    if (!isConnector) continue;
    const name = (seg.line.nodeIds ?? []).find((id) => id.startsWith("xw:") && !id.includes("|")) ?? "?";
    for (const node of [seg.from, seg.to]) {
      const meetsStreet = (graph.nodes.get(node) ?? []).some((id) => isStreet(graph.segments[id]));
      if (!meetsStreet) continue;
      const p = node === seg.from ? seg.pts[0] : seg.pts[seg.pts.length - 1];
      footNodes.push({ x: p.x, z: p.z, name: name.replace(/^xw:/, "") });
    }
  }
  // GSI's buildings and JARTIC's one-way lines round the group, in the frame (手順 0b).
  const buildings: Array<{ ring: P[]; box: [number, number, number, number] }> = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (const outer of await buildingsOf(cx + dx, cy + dy)) {
        const ring: P[] = [];
        for (let i = 0; i + 1 < outer.length; i += 2) ring.push(local(outer[i], outer[i + 1]));
        const xs = ring.map((p) => p.x);
        const zs = ring.map((p) => p.z);
        buildings.push({ ring, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
      }
  const inBuilding = (x: number, z: number) =>
    buildings.some(
      ({ ring, box }) =>
        x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3] && insidePolygon(x, z, ring),
    );
  const onewayLines: P[][] = (regs?.oneway ?? []).map((r) => {
    const { next } = readTime(r, 0);
    const pts: P[] = [];
    for (let i = next; i + 1 < r.length; i += 2) pts.push(local(r[i], r[i + 1]));
    return pts;
  });
  // OSM's lanes beside a street (public/data/roadlanes, roadLanesData.ts's layout).
  const osmWays = (regs?.roadlanes ?? []).map((r) => {
    const pts: P[] = [];
    for (let i = ROAD_LANES_COLUMN.coords; i + 1 < r.length; i += 2) pts.push(local(r[i], r[i + 1]));
    return { oneway: r[ROAD_LANES_COLUMN.oneway] === 1, pts };
  });
  /** 手順 0c の 3: what the JARTIC and OSM lines beside a segment say of its one-way rule. */
  const onewaySourceOf = (seg: Segment): OnewaySource => {
    const W = seg.line.width;
    const osmDirs = new Set<number>();
    let osmTwoWay = false;
    let jarticOffsetM: number | null = null;
    let jarticOpposite = false;
    const rule = seg.onewayRule!.dir;
    for (const f of [0.2, 0.5, 0.8]) {
      const { pos, dir } = graph.sample(seg, seg.length * f);
      const p = { x: pos.x, z: pos.z };
      const visit = (pts: readonly P[], fn: (along: number, offset: number, d: number) => void) => {
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          const len = Math.hypot(ex, ez);
          if (len < 1e-6) continue;
          const along = (ex * dir.x + ez * dir.z) / len;
          const isParallel = Math.abs(along) > Math.cos((25 * Math.PI) / 180);
          if (!isParallel) continue;
          const d = toPolyline(p, [a, b]);
          const isNear = d <= W / 2 + 15;
          if (!isNear) continue;
          // Offset of the line from the centre, + left of the coords (leftOf: (dir.z, −dir.x)).
          const offset = (a.x - p.x) * dir.z + (a.z - p.z) * -dir.x;
          fn(Math.sign(along), offset, d);
        }
      };
      for (const w of osmWays)
        visit(w.pts, (along) => {
          if (w.oneway) osmDirs.add(along);
          else osmTwoWay = true;
        });
      for (const line of onewayLines)
        visit(line, (along, offset, d) => {
          const isVoting = along === rule && d <= 6;
          if (isVoting && (jarticOffsetM === null || Math.abs(offset) < Math.abs(jarticOffsetM)))
            jarticOffsetM = round(offset);
          if (along === -rule) jarticOpposite = true;
        });
    }
    const osm: OnewaySource["osm"] =
      osmDirs.size === 2
        ? "divided"
        : osmDirs.size === 1 && !osmTwoWay
          ? "one-way"
          : osmTwoWay
            ? "two-way"
            : "unknown";
    return { jarticOffsetM, jarticOpposite, osm };
  };
  // 手順 0c の 3, over the whole network: wide two-way GSI streets with a JARTIC one-way, by OSM's say.
  for (const seg of graph.segments) {
    if (!isStreet(seg) || !isWideRuledOneway(seg)) continue;
    const g = frame.toGeodetic(graph.sample(seg, seg.length / 2).pos);
    const k = `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`;
    if (ruledOneways.has(k)) continue;
    ruledOneways.set(k, { lengthM: seg.length, widthM: seg.line.width, ...onewaySourceOf(seg) });
  }
  const inSite = (p: P) => sites.some((site) => toPolyline(p, site.pts) <= site.half);
  const isJunctionNode = (node: number) => (graph.nodes.get(node)?.length ?? 0) >= 3;
  /** Distance along the street from a segment's end to the first junction (through two-segment nodes). */
  const toJunction = (seg: Segment, node0: number, start: number): number => {
    let dist = start;
    let cur = seg;
    let node = node0;
    for (let hop = 0; hop < 50; hop++) {
      if (isJunctionNode(node)) return dist;
      const others = (graph.nodes.get(node) ?? []).filter((id) => id !== cur.id);
      const isDeadEnd = others.length !== 1;
      if (isDeadEnd) return Infinity;
      cur = graph.segments[others[0]];
      dist += cur.length;
      node = cur.from === node ? cur.to : cur.from;
    }
    return dist;
  };
  const lane0After = new Map<number, number>();
  const groupBanded: Array<{ seg: Segment; row: Banded }> = [];

  for (const seg of graph.segments) {
    if (!isStreet(seg)) continue;
    const travel = seg.oneway;
    const hits: Array<{ l: number; strips: Strip[] }> = [];
    for (let l = 0; l <= seg.length; l += 1) {
      const { pos, dir } = graph.sample(seg, l);
      const strips = stripsAt({ x: pos.x, z: pos.z }, { x: dir.x, z: dir.z }, seg.line.width, sites);
      if (strips.length > 0) hits.push({ l, strips });
    }
    // Runs of hits, gaps of JOIN_GAP_M closed; those of MIN_LENGTH_M or more make the segment's band.
    const runsOfHits: Array<typeof hits> = [];
    for (const h of hits) {
      const last = runsOfHits.at(-1);
      const isJoined = last !== undefined && h.l - last.at(-1)!.l <= 1 + JOIN_GAP_M;
      if (isJoined) last.push(h);
      else runsOfHits.push([h]);
    }
    const kept = runsOfHits.filter((r) => r.length >= MIN_LENGTH_M).flat();
    if (kept.length === 0) continue;
    const chunkVotes = new Map<string, number>();
    for (const h of kept)
      for (const strip of h.strips) chunkVotes.set(strip.chunk, (chunkVotes.get(strip.chunk) ?? 0) + 1);
    const chunk = [...chunkVotes].toSorted((a, b) => b[1] - a[1])[0][0];
    // Each segment once: the group whose tile holds the chunk most of its band is from.
    if (!focusIds.has(chunk)) continue;
    // The bands (memo 3.2): strips apart by a lane or more stay apart; the union only for B1 / B2.
    const bands = mergeBands(kept.flatMap((h) => h.strips.map((b) => ({ right: b.right, left: b.left }))));
    const right = Math.min(...bands.map((b) => b.right));
    const left = Math.max(...bands.map((b) => b.left));
    const section = seg.section;
    const lanes = seg.lanes;
    const medianNow = section?.median ?? 0;
    const carriagewayNow = section?.carriageway ?? 0;
    const { room } = streetRoom(seg.line.width, travel);
    const centres: number[] = [];
    for (const d of [1, -1] as const) {
      const isDriven = travel === 0 || travel === d;
      if (!isDriven) continue;
      for (let lane = 0; lane < lanes; lane++) centres.push(d * laneCentreOffset(seg, lane));
    }
    const offCentre = offCentreLanes(room, travel, lanes, { right, left });
    const ruling = classify(
      { travel, lanes, carriageway: carriagewayNow, median: medianNow, room, centres },
      bands,
      offCentre,
    );
    const isResolved = ruling.klass === "A" || ruling.klass === "A'";
    const widened = isResolved && ruling.carriageway > carriagewayNow + 0.01;
    if (isResolved)
      lane0After.set(seg.id, laneZero(travel, ruling.lanesAfter, ruling.carriageway, ruling.median));
    // Edge lines moved out (A widened) against PLATEAU's pavement, where the old ones were not on it;
    // PLATEAU's pavement inside the band.
    let edgeOnPavement = false;
    let pavedSamples = 0;
    let bandSamples = 0;
    for (const h of kept) {
      const { pos, dir } = graph.sample(seg, h.l);
      const nx = dir.z;
      const nz = -dir.x;
      if (widened)
        for (const side of [1, -1]) {
          const nowAt = side * (carriagewayNow / 2 - SHOULDER);
          const newAt = side * (ruling.carriageway / 2 - SHOULDER);
          const wasOn = onPavement(pos.x + nx * nowAt, pos.z + nz * nowAt, ["sidewalk"]);
          const isOn = onPavement(pos.x + nx * newAt, pos.z + nz * newAt, ["sidewalk"]);
          if (isOn && !wasOn) edgeOnPavement = true;
        }
      for (const strip of h.strips) {
        const lo = Math.max(strip.right, -seg.line.width / 2);
        const hi = Math.min(strip.left, seg.line.width / 2);
        for (let u = lo; u <= hi; u += 0.5) {
          bandSamples++;
          if (onPavement(pos.x + nx * u, pos.z + nz * u, ["sidewalk", "island"])) pavedSamples++;
        }
      }
    }
    let footNearM: number | null = null;
    for (const f of footNodes)
      for (const h of kept) {
        const { pos } = graph.sample(seg, h.l);
        const d = Math.hypot(pos.x - f.x, pos.z - f.z);
        if (d <= FOOT_NEAR_M) footNearM = Math.min(footNearM ?? Infinity, Math.round(d));
      }
    const g = frame.toGeodetic(graph.sample(seg, kept[Math.floor(kept.length / 2)].l).pos);
    const isMoveCase = ruling.klass !== "clear";
    if (isMoveCase) {
      const W = seg.line.width;
      const cw = carriagewayNow;
      const straddles = right < 0 && left > 0;
      const shape: Move["shape"] = travel !== 0 ? "one-way" : straddles ? "middle" : "side";
      // The moved carriageway's pieces as [low, high] offsets (left of the coords).
      const pieceSets: Array<{ side: MoveOption["side"]; pieces: Array<[number, number]>; moves: number[] }> =
        [];
      const isSplit = shape === "middle";
      if (isSplit) {
        const half = (cw - medianNow) / 2;
        pieceSets.push({
          side: "split",
          pieces: [
            [left, left + half],
            [right - half, right],
          ],
          moves: [left - medianNow / 2, right + medianNow / 2],
        });
      } else {
        const toLeft = left + cw / 2;
        const toRight = right - cw / 2;
        // A one-way street to its left of travel first (left of the coords for travel 1).
        const order: Array<["left" | "right", number]> =
          travel === -1
            ? [
                ["right", toRight],
                ["left", toLeft],
              ]
            : [
                ["left", toLeft],
                ["right", toRight],
              ];
        for (const [side, s] of order)
          pieceSets.push({ side, pieces: [[-cw / 2 + s, cw / 2 + s]], moves: [s] });
      }
      const twins = (other: Segment) =>
        (other.from === seg.from && other.to === seg.to) || (other.from === seg.to && other.to === seg.from);
      const cosCross = Math.cos((30 * Math.PI) / 180);
      const ends = [seg.pts[0], seg.pts[seg.pts.length - 1]];
      const options: MoveOption[] = pieceSets.map(({ side, pieces, moves: m }) => {
        const counts = { site: 0, street: 0, streetCross: 0, streetTwin: 0, pavement: 0, building: 0 };
        const sameEnds = new Set<number>();
        let points = 0;
        for (const h of kept) {
          const { pos, dir } = graph.sample(seg, h.l);
          const nx = dir.z;
          const nz = -dir.x;
          for (const [lo, hi] of pieces)
            for (let u = lo; u <= hi + 1e-9; u += 0.5) {
              points++;
              const p = { x: pos.x + nx * u, z: pos.z + nz * u };
              if (inSite(p)) counts.site++;
              const hit = graph.nearest(
                new Vector3(p.x, 0, p.z),
                30,
                (o) => isStreet(o) && o !== seg && !twins(o),
              );
              const isOnOther =
                hit !== null &&
                Math.abs(hit.lateral) <= (hit.seg.section?.carriageway ?? hit.seg.line.width) / 2;
              if (isOnOther) {
                const isAcross = Math.abs(hit.dir.x * dir.x + hit.dir.z * dir.z) < cosCross;
                const onHit = graph.sample(hit.seg, hit.s).pos;
                const isTwin = !isAcross && graph.nearestOn(seg, onHit).dist <= 0.5;
                if (isAcross) counts.streetCross++;
                else if (isTwin) counts.streetTwin++;
                else {
                  counts.street++;
                  const hitEnds = [hit.seg.pts[0], hit.seg.pts[hit.seg.pts.length - 1]];
                  const isSameEnds = ends.every((e) =>
                    hitEnds.some((h) => Math.hypot(h.x - e.x, h.z - e.z) <= 5),
                  );
                  if (isSameEnds) sameEnds.add(hit.seg.id);
                }
              }
              if (onPavement(p.x, p.z, ["sidewalk", "island"])) counts.pavement++;
              if (inBuilding(p.x, p.z)) counts.building++;
            }
        }
        const share = (n: number) => (points === 0 ? 0 : round(n / points));
        const outOfWidthM = Math.max(0, ...pieces.map(([lo, hi]) => Math.max(hi - W / 2, -W / 2 - lo)));
        return {
          side,
          moves: m.map((v) => round(v)),
          outOfWidthM: round(outOfWidthM),
          shares: {
            site: share(counts.site),
            street: share(counts.street),
            streetCross: share(counts.streetCross),
            streetTwin: share(counts.streetTwin),
            pavement: share(counts.pavement),
            building: share(counts.building),
          },
          parallelSameEnds: sameEnds.size,
        };
      });
      const isClear = (o: MoveOption) =>
        o.shares.site === 0 && o.shares.street === 0 && o.shares.building === 0;
      const best: Move["best"] = options.some((o) => o.outOfWidthM === 0 && o.shares.site === 0)
        ? "fits-in-width"
        : options.some(isClear)
          ? "out-of-width-clear"
          : options.every((o) => o.shares.site > 0)
            ? "neither"
            : "blocked";
      const first = kept[0].l;
      const last = kept.at(-1)!.l;
      const toJ: [number, number] = [
        toJunction(seg, seg.from, first),
        toJunction(seg, seg.to, seg.length - last),
      ];
      const nearJunctions = toJ.filter((d) => d <= 30).length;
      const rampDrawn =
        W <= 9 && kept.some((h) => h.strips.some((b) => Math.abs((b.left + b.right) / 2) <= 2));
      const footJoined = footNodes.some((f) =>
        [seg.pts[0], seg.pts[seg.pts.length - 1]].some((e) => Math.hypot(e.x - f.x, e.z - f.z) < 0.5),
      );
      // JARTIC's one-way lines beside the band, parallel: one way only, or both ways (a divided street).
      const ways = new Set<number>();
      for (const h of kept.filter((_, i) => i % 5 === 0)) {
        const { pos, dir } = graph.sample(seg, h.l);
        for (const line of onewayLines)
          for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i];
            const b = line[i + 1];
            const ex = b.x - a.x;
            const ez = b.z - a.z;
            const len = Math.hypot(ex, ez);
            if (len < 1e-6) continue;
            const along = (ex * dir.x + ez * dir.z) / len;
            const isParallel = Math.abs(along) > Math.cos((25 * Math.PI) / 180);
            if (!isParallel) continue;
            const d = toPolyline({ x: pos.x, z: pos.z }, [a, b]);
            const isNear = d <= W / 2 + 15;
            if (isNear) ways.add(Math.sign(along));
          }
      }
      const jartic: Move["jartic"] = ways.size === 2 ? "split" : ways.size === 1 ? "one-way" : "none";
      const e = formE({
        seg,
        kept,
        carriageway: cw,
        lanes,
        lanesOffCentreInWidth: offCentre,
        options,
        isJarticWide: isWideRuledOneway(seg),
        shape,
        foot:
          footNodes.find((f) =>
            [seg.pts[0], seg.pts[seg.pts.length - 1]].some((p) => Math.hypot(p.x - f.x, p.z - f.z) < 0.5),
          )?.name ?? null,
        junctionAt: (node: number) => {
          const ids = graph.nodes.get(node) ?? [];
          const at = seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1];
          const near5 = (p: Vector3) => Math.hypot(p.x - at.x, p.z - at.z) <= 5;
          const isControlled =
            (applied?.stopLines.some((sl) => near5(sl.pos)) ?? false) ||
            (applied?.crossings.some((c) => near5(c.pos)) ?? false) ||
            (applied?.signals.some((q) => near5(q)) ?? false);
          return { ways: ids.filter((id) => isStreet(graph.segments[id])).length, isControlled };
        },
        toJ,
      });
      moves.push({
        seg: seg.id,
        at: [round(g.lat, 1e6), round(g.lon, 1e6)],
        klass: ruling.klass,
        lengthM: kept.length,
        widthM: W,
        travel,
        lanes,
        shape,
        options,
        best,
        toJunctionM: [round(toJ[0]), round(toJ[1])],
        junctionsNear: nearJunctions,
        rampDrawn,
        footJoined,
        jartic,
        ...(isWideRuledOneway(seg) ? { oneway: onewaySourceOf(seg) } : {}),
        e,
      });
    }
    const row: Banded = {
      run: runOf.get(chunk) ?? "?",
      chunk,
      structure: kept.flatMap((h) => h.strips).find((b) => b.chunk === chunk)?.structure ?? "?",
      chunks: [...chunkVotes.keys()].toSorted(),
      s0: round(
        Math.min(...kept.flatMap((h) => h.strips.filter((b) => b.chunk === chunk).map((b) => b.s))),
        10,
      ),
      s1: round(
        Math.max(...kept.flatMap((h) => h.strips.filter((b) => b.chunk === chunk).map((b) => b.s))),
        10,
      ),
      lengthM: kept.length,
      seg: seg.id,
      segLengthM: round(seg.length, 10),
      at: [round(g.lat, 1e6), round(g.lon, 1e6)],
      widthM: seg.line.width,
      travel,
      lineOneway: seg.line.oneway,
      ruled: seg.onewayRule !== null,
      lanes,
      basis: section?.basis ?? "?",
      medianNow: round(medianNow),
      carriagewayNow: round(carriagewayNow),
      room: round(room),
      right: round(right),
      left: round(left),
      bands: bands.map((b) => ({ right: round(b.right), left: round(b.left) })),
      ruling: { ...ruling, median: round(ruling.median), carriageway: round(ruling.carriageway) },
      lanesChange: ruling.lanesAfter - lanes,
      widened,
      offCentre,
      edgeOnPavement,
      pavementShare: bandSamples === 0 ? 0 : round(pavedSamples / bandSamples),
      footNearM,
    };
    banded.push(row);
    groupBanded.push({ seg, row });
  }

  // Lane 0's jump at the ends of each A / A' segment (memo 3.4): against each street segment going on
  // nearly straight from the node, before (both as now) and after (the banded ones with their band).

  const cosStraight = Math.cos((STRAIGHT_ON_DEG * Math.PI) / 180);
  for (const { seg } of groupBanded) {
    const after = lane0After.get(seg.id);
    if (after === undefined) continue;
    for (const node of [seg.from, seg.to]) {
      const out = headingOut(seg, node);
      for (const id of graph.nodes.get(node) ?? []) {
        if (id === seg.id) continue;
        const other = graph.segments[id];
        if (!isStreet(other)) continue;
        const on = headingOut(other, node);
        const isStraightOn = -(out.x * on.x + out.z * on.z) > cosStraight;
        if (!isStraightOn) continue;
        const otherNow = lane0Now(other);
        const otherAfter = lane0After.get(other.id) ?? otherNow;
        const p = node === seg.from ? seg.pts[0] : seg.pts[seg.pts.length - 1];
        const gp = frame.toGeodetic(p);
        jumps.push({
          seg: seg.id,
          node: `${gp.lat.toFixed(6)},${gp.lon.toFixed(6)}`,
          other: other.id,
          beforeM: round(Math.abs(lane0Now(seg) - otherNow)),
          afterM: round(Math.abs(after - otherAfter)),
        });
      }
    }
  }

  // Piers over a street's lanes (lane width and 0.5 m each side), each viaduct chunk in its own tile's group.
  for (const c of near) {
    const isViaduct = c.structure === "viaduct" && c.piers.length > 0;
    if (!isViaduct) continue;
    if (tileKeyOf(c) !== key) continue;
    // A pier's box as expresswayDeck.ts pierTriangles makes it: GIRDER_BOTTOM_SHARE 0.55 and
    // PIER_ACROSS_SHARE 0.4 of the deck across, PIER_ALONG 2.2 m along (1.1 m each side below).
    const across = (deckCarriageway(c) + 2 * PARAPET_WIDTH.value) * 0.55 * 2 * 0.4;
    for (let p = 0; p < c.piers.length / PIER_STRIDE; p++) {
      const s = c.piers[p * PIER_STRIDE];
      let i = 0;
      while ((i + 2) * STATION_STRIDE <= c.st.length - 1 && c.st[(i + 1) * STATION_STRIDE + ST.s] < s) i++;
      const a = local(c.st[i * STATION_STRIDE + ST.lon], c.st[i * STATION_STRIDE + ST.lat]);
      const b = local(c.st[(i + 1) * STATION_STRIDE + ST.lon], c.st[(i + 1) * STATION_STRIDE + ST.lat]);
      const s0 = c.st[i * STATION_STRIDE + ST.s];
      const s1 = c.st[(i + 1) * STATION_STRIDE + ST.s];
      const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)));
      const ctr = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const fl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const f = { x: (b.x - a.x) / fl, z: (b.z - a.z) / fl };
      const l = { x: f.z, z: -f.x };
      const corners = [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ].map(([u, v]) => ({
        x: ctr.x + f.x * u * 1.1 + l.x * v * (across / 2),
        z: ctr.z + f.z * u * 1.1 + l.z * v * (across / 2),
      }));
      const hit = graph.nearest(new Vector3(ctr.x, 0, ctr.z), 30, isStreet);
      if (!hit) continue;
      const seg = hit.seg;
      const near0 = graph.nearestOn(seg, new Vector3(ctr.x, 0, ctr.z));
      const { pos, dir } = graph.sample(seg, near0.s);
      const nx = dir.z;
      const nz = -dir.x;
      const lats = corners.map((q) => (q.x - pos.x) * nx + (q.z - pos.z) * nz);
      const alongs = corners.map((q) => (q.x - pos.x) * dir.x + (q.z - pos.z) * dir.z);
      const isBeside = Math.min(...alongs) > 1 || Math.max(...alongs) < -1;
      if (isBeside) continue;
      const [lo, hi] = [Math.min(...lats), Math.max(...lats)];
      let isOver = false;
      for (const d of seg.oneway === 0 ? [1, -1] : [seg.oneway])
        for (let lane = 0; lane < seg.lanes; lane++) {
          const w = laneWidth(seg);
          const centre = d * laneCentreOffset(seg, lane);
          const isCrossing = centre - w / 2 - 0.5 < hi && centre + w / 2 + 0.5 > lo;
          if (isCrossing) isOver = true;
        }
      if (isOver)
        piersOverLanes.push({ chunk: c.id, s: round(s, 10), street: seg.id, widthM: seg.line.width });
    }
  }

  // Nodes with two segments only (streets): stop lines, crossings and signals put there.
  for (const [node, ids] of graph.nodes) {
    if (ids.length !== 2) continue;
    const both = ids.every((id) => isStreet(graph.segments[id]));
    if (!both) continue;
    const s0 = graph.segments[ids[0]];
    const at = s0.from === node ? s0.pts[0] : s0.pts[s0.pts.length - 1];
    const g = frame.toGeodetic(at);
    const k = `${g.lat.toFixed(6)},${g.lon.toFixed(6)}`;
    const near2 = (p: Vector3, m: number) => Math.hypot(p.x - at.x, p.z - at.z) <= m;
    const prev = twoNodes.get(k) ?? { stop: false, crossing: false, signal: false };
    twoNodes.set(k, {
      stop: prev.stop || (applied?.stopLines.some((sl) => near2(sl.pos, 2)) ?? false),
      crossing: prev.crossing || (applied?.crossings.some((c) => near2(c.pos, 2)) ?? false),
      signal: prev.signal || (applied?.signals.some((p) => near2(p, 5)) ?? false),
    });
  }
}

const KLASSES: readonly Klass[] = ["clear", "A", "A'", "B1", "B2", "B3", "C"];
const perKlass = (f: (k: Klass) => number) =>
  Object.fromEntries(KLASSES.map((k) => [k, f(k)])) as Record<Klass, number>;
const ofKlass = (k: Klass) => banded.filter((b) => b.ruling.klass === k);
const resolved = banded.filter((b) => b.ruling.klass === "A" || b.ruling.klass === "A'");
const twoList = [...twoNodes.values()];
const summary = {
  dir: target,
  groups: groups.size,
  siteChunks: siteChunks.length,
  skippedChunksForMissingTiles: skipped,
  groupsWithoutRegulations,
  segments: banded.length,
  totalLengthM: banded.reduce((n, b) => n + b.lengthM, 0),
  byClass: perKlass((k) => ofKlass(k).length),
  lengthByClass: perKlass((k) => ofKlass(k).reduce((n, b) => n + b.lengthM, 0)),
  fewerLanes: resolved.filter((b) => b.lanesChange < 0).length,
  widened: resolved.filter((b) => b.widened).length,
  edgeOnPavement: resolved.filter((b) => b.edgeOnPavement).length,
  jumps: jumps.length,
  jumpsGrown: jumps.filter((j) => j.afterM > j.beforeM + 0.01).length,
  jumpMostBeforeM: Math.max(0, ...jumps.map((j) => j.beforeM)),
  jumpMostAfterM: Math.max(0, ...jumps.map((j) => j.afterM)),
  withPavement: banded.filter((b) => b.pavementShare > 0).length,
  footNear: banded.filter((b) => b.footNearM !== null).length,
  piersOverLanes: piersOverLanes.length,
  twoNodes: twoList.length,
  twoNodesWithStop: twoList.filter((t) => t.stop).length,
  twoNodesWithCrossing: twoList.filter((t) => t.crossing).length,
  twoNodesWithSignal: twoList.filter((t) => t.signal).length,
  durationMs: Math.round(performance.now() - started),
};
log("street_bands_measured", summary);
// 手順 0b's table, one place a row (the doubled GSI lines give some twice: knowledge road-model.md).
const byPlace = new Map(moves.map((m) => [m.at.join(","), m]));
const placed = [...byPlace.values()];
const tally = (pick: (m: Move) => string) => {
  const out: Record<string, { n: number; m: number }> = {};
  for (const m of placed) {
    const k = pick(m);
    out[k] ??= { n: 0, m: 0 };
    out[k].n++;
    out[k].m += m.lengthM;
  }
  return out;
};
const movesSummary = {
  places: placed.length,
  rows: moves.length,
  byBest: tally((m) => m.best),
  byShape: tally((m) => m.shape),
  byJartic: tally((m) => m.jartic),
  byShapeAndJartic: tally((m) => `${m.shape}/${m.jartic}`),
  rampDrawn: placed.filter((m) => m.rampDrawn).length,
  footJoined: placed.filter((m) => m.footJoined).length,
  junctionsNear: tally((m) => String(m.junctionsNear)),
  // 手順 0c の 1 and memo 1's classes (α taken out now; β1 / β2 / β3 / γ of what is left).
  alpha: { n: alphas.size, m: [...alphas.values()].reduce((n, a) => n + a.lengthM, 0) },
  alphaWithJarticLanes: [...alphas.values()].filter((a) => a.jarticLanes >= 2).length,
  byMemoClass: tally((m) =>
    m.widthM < 13
      ? "γ"
      : m.oneway
        ? "β1"
        : m.shape === "middle"
          ? "β2"
          : m.shape === "side"
            ? "β3"
            : "β1-like (one-way line)",
  ),
  // R1-2b PR 2 手順 0-A: form E's verdicts by memo class (count, length m), and the reasons.
  formE: (() => {
    const out: Record<string, Record<string, { n: number; m: number }>> = {};
    const reasons: Record<string, Record<string, { n: number; m: number }>> = {};
    for (const m of placed) {
      const isTarget = ["γ", "β3", "β1"].includes(m.e.memoClass);
      if (!isTarget) continue;
      out[m.e.memoClass] ??= {};
      const v = (out[m.e.memoClass][m.e.verdict] ??= { n: 0, m: 0 });
      v.n++;
      v.m += m.lengthM;
      for (const r of m.e.reasons) {
        reasons[m.e.memoClass] ??= {};
        const w = (reasons[m.e.memoClass][r] ??= { n: 0, m: 0 });
        w.n++;
        w.m += m.lengthM;
      }
    }
    // Where the one-way comes from, by place (the same places as the verdicts).
    const onewayFrom: Record<string, number> = {};
    for (const m of placed) {
      const isTarget = ["γ", "β3", "β1"].includes(m.e.memoClass);
      if (isTarget) onewayFrom[m.e.onewayFrom] = (onewayFrom[m.e.onewayFrom] ?? 0) + 1;
    }
    return { byVerdict: out, byReason: reasons, onewayFrom };
  })(),
  // 手順 0c の 3: the β1 places (wide, JARTIC one-way on a two-way line), by OSM's say.
  onewayAtSites: tally((m) => (m.oneway ? m.oneway.osm : "-")),
  ruledOneways: (() => {
    const out: Record<string, { n: number; m: number }> = {};
    for (const r of ruledOneways.values()) {
      out[r.osm] ??= { n: 0, m: 0 };
      out[r.osm].n++;
      out[r.osm].m += Math.round(r.lengthM);
    }
    return out;
  })(),
};
const movesPath = flag("moves");
if (movesPath !== undefined)
  await writeFile(
    movesPath,
    JSON.stringify(
      {
        summary: movesSummary,
        moves,
        alphas: [...alphas.values()],
        ruledOneways: Object.fromEntries(ruledOneways),
      },
      null,
      1,
    ) + "\n",
  );
const outPath = flag("out");
if (outPath !== undefined)
  await writeFile(
    outPath,
    JSON.stringify({ summary, segments: banded, jumps, piersOverLanes }, null, 1) + "\n",
  );
// A site chunk left out for a road tile missing from the cache fails the run (exit code 1, after the
// output is written): the counts were then of a network with a hole in it, and nothing said so
// (central's γ read 75 for 76). Why by default and not behind a flag: a run for its numbers (--moves,
// --out) would pass a hole again, as the lanes and hole probes would not (#128's review W1).
const hasSkipped = skipped > 0;
if (hasSkipped) process.exitCode = 1;

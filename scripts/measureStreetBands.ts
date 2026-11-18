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
//   B1     one-way, unresolved, but all its lanes fit to one side of the band within the room;
//   B2     two-way, unresolved, but both ways fit to one side of the band within the room;
//   B3     A or A' fits, but a moved line would keep more lanes (memo 3.3 の 5): left as it is;
//   C      fits nowhere within the room.
// B1, B2, B3 and C need the street's line moved sideways (R1-2b); no street is cut. Also: the lane 0
// centre's sideways jump at the ends of each A / A' segment before and after (memo 3.4), PLATEAU's
// pavement inside the bands and under an edge line moved out, the ramps' feet beside the bands,
// piers over the lanes, and the nodes with two segments only.
// One JSON log line (street_bands_measured) and --out <file> for the full list.
// Run: pnpm exec tsx scripts/measureStreetBands.ts <dir|label> [--cache <dir>] [--plateau <dir>] [--out <file>]
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
import { expresswayRoadInput } from "../src/world/expresswayRoads.ts";
import { laneCentreOffset, laneWidth, streetRoom } from "../src/world/laneChange.ts";
import { polygonsOf, WARD_TILES, type PavementPolygon } from "../src/world/pavements.ts";
import { isExpressway, sourceOf } from "../src/world/roadClass.ts";
import { type RoadLine, type Segment } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { classify, type Klass, laneZero, mergeBands, offCentreLanes, type Ruling } from "./streetBands.ts";
import { DATA_DIR, gameStreetGraph, gsiTileReader, regulationReader, roadTileOf } from "./gameStreets.ts";

const ROOT = join(import.meta.dirname, "..");
const GRAPH_RADIUS_M = 1300;
/** The values the memo names (3.2): the code's and the probes'. */
const SITE_CROSSING_MIN_DEG = 30;
const SITE_CLEARANCE_M = 1;
const MIN_LENGTH_M = 3;
const JOIN_GAP_M = 1;
const SHOULDER = 0.5;
/** A segment beyond a node within this of straight on is the same street going on (deg). */
const STRAIGHT_ON_DEG = 30;
/** A foot's join this close to a band's segment is listed (memo 手順 0 の 7). */
const FOOT_NEAR_M = 30;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--cache", "--out", "--plateau"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error("usage: measureStreetBands.ts <dir|label> [--cache <dir>] [--out <file>]");
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
      if (!isAbsent && !res.ok) throw new Error(`PLATEAU ${res.status} ${x}/${y}`);
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
        if (f.type !== 3 || f.properties.tran_function !== wanted) continue;
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
  const { graph, applied } = gameStreetGraph(
    streets,
    expresswayRoadInput(near, runs, (_la, _lo, h) => h),
    frame,
    regs,
  );
  const local = (lo: number, la: number): P => {
    const v = frame.toLocal(la, lo, 0);
    return { x: v.x, z: v.z };
  };
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
  const footNodes: P[] = [];
  for (const seg of graph.segments) {
    const isConnector = sourceOf(seg.line) === "osm" && seg.line.structure === "ground";
    if (!isConnector) continue;
    for (const node of [seg.from, seg.to]) {
      const meetsStreet = (graph.nodes.get(node) ?? []).some((id) => isStreet(graph.segments[id]));
      if (!meetsStreet) continue;
      const p = node === seg.from ? seg.pts[0] : seg.pts[seg.pts.length - 1];
      footNodes.push({ x: p.x, z: p.z });
    }
  }
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
const outPath = flag("out");
if (outPath !== undefined)
  await writeFile(
    outPath,
    JSON.stringify({ summary, segments: banded, jumps, piersOverLanes }, null, 1) + "\n",
  );

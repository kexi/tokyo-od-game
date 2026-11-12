import { STATION_STRIDE, type XwChunk, type XwClass, type XwTileRun } from "../expressway/format";
import { planeAt } from "../expressway/geo";
import { frameAt, ST, surfaceSamples } from "../expressway/profile";
import { GIRDER_DEPTH, PARAPET_WIDTH } from "../expressway/assumptions";
import { carriagewayWidth } from "../expressway/section";
import { clearsOnThinGirder } from "../expressway/heightStructures";
import { CLEARANCE_HEIGHT } from "../law/roadStandards";
import { type CrossSection, sectionWidth } from "./laneChange";
import { isExpressway, OSM_EXPRESSWAY_KIND, type RoadKind, sourceOf, usesGroundSurface } from "./roadClass";
import { type RoadDiagnostic, type RoadLine, vertexKey } from "./roads";

/**
 * The expressway chunks as road-graph lines (knowledge/road-redesign-plan.md 3.2 and 4.5, P3), and
 * how they meet the GSI streets.
 *
 * On the page, `expresswayRoadInput` turns each loaded chunk into one RoadLine: the points are the
 * deck's own rings (profile.ts surfaceSamples, the stations and the Hermite subdivisions), each
 * with the ellipsoidal height of the surface there, so a segment's elev between two points is the
 * collider's face between the same two rings (knowledge/road-redesign-plan.md 4.4 T11). Every point has a node id:
 * `xw:<a>|<b>` where chunks a and b meet, `xw:<run>:start` / `:end` at a run's ends, and a unique id
 * inside, so decks never join anything by position (two stacked carriageways share points in plan).
 * A run that starts or ends on another (an 分合流) gets its end's id inserted into the other's line
 * at the junction's distance, where the compiler put the ramp's end on the parent's centreline.
 *
 * In the worker, `joinExpressway` drops the GSI 高速道路 lines the chunks replace (they would draw a
 * second, unconnected expressway into the graph) and joins each ramp's ground end to the streets:
 * first along GSI's at-grade part of the ramp (a 高速道路 line within RAMP_REACH_M of the deck's
 * end, walked to the first vertex a street shares), else to the nearest GSI street within
 * RAMP_REACH_M (a vertex is inserted into the street at the projection). Either way a ground-level
 * connector runs from the deck's end. A ramp end with neither stays a dead end and is reported
 * (`ramp_unattached`): routes cannot use it. Why not OSM's node shared with the street (設計書
 * 4.5): the data has no such node; the at-grade end of a link is not compiled (it is no viaduct).
 *
 * A structure's street (P7, the 臨港道路 on the Rainbow Bridge's lower floor: cls `street`) is a
 * street on a viaduct: its line is a local road (no 歩道, no roadside, its own OSM limit), and its
 * ground ends join the nearest GSI street the same way, without the at-grade walk (that follows GSI
 * 高速道路 lines, which a street has none of).
 *
 * Why the page and not the worker builds the lines: the heights need the geoid (dem.ellipsoidal),
 * which lives on the page; the lines are frame-free, so one set serves every origin and rebuild.
 */

/** Farthest a ramp's ground end may be from the street it joins (knowledge/road-redesign-plan.md 4.5). */
export const RAMP_REACH_M = 15;
/** GSI 高速道路 lines this close to a chunk are the same road and are dropped. */
const REPLACE_REACH_M = 40;
/** A vertex inserted into a street keeps this far from the street's own vertices (no 0 m pieces). */
const VERTEX_CLEARANCE_M = 1;
/** A ramp end this close to the edge of the loaded streets is left for the next area. */
const EXTENT_MARGIN_M = 60;
/** A street crossing a site within this of where its run meets the ground is that end's street, not cut. */
const SITE_END_REACH_M = RAMP_REACH_M;
/** A street meeting a site at less than this angle runs along it (a ramp in its median), not across. */
const SITE_CROSSING_MIN_DEG = 30;
/** The grid siteCrossings files the sites' segments in (m). */
const SITE_CELL_M = 50;
/** A cut street stops this far short of the site's slab edge (m). */
const SITE_CLEARANCE_M = 1;
/**
 * What a deck must stand over the ground to pass over a street (siteCrossings `under`: the compiler
 * should have made it a viaduct there): 構造令 第12条's clearance and the standard girder, judged as
 * the compiler's R3 judges a crossing's window (heightStructures.ts clearsOnThinGirder: a girder
 * thinned to GIRDER_MIN). Why not the reduced 3 m of 第12条ただし書: it is for the lowest class of
 * road alone, none in the data (roadStandards.ts), and the soffit, not the road, is what a car
 * passes under (re-review W-B, S-b).
 */
const SITE_UNDER_NEED_M = CLEARANCE_HEIGHT.value + GIRDER_DEPTH.value;

/** The ground end of a ramp (or a structure's street), to be joined to a street in the worker. */
export type XwGroundEnd = {
  run: string;
  /** ramp: try GSI's at-grade part first; street: straight to the nearest street. */
  cls: Exclude<XwClass, "expressway">;
  end: "start" | "end";
  node: string;
  lon: number;
  lat: number;
  /** Ellipsoidal height of the deck's end (it meets the ground there). */
  height: number;
  /** One-way sense of the ramp at this end: 1 the ramp leaves the street here, −1 arrives. */
  oneway: 1 | -1;
  width: number;
  section: CrossSection;
  /** The posted limit of the deck's end chunk (OSM maxspeed), absent where none is tagged. */
  limit?: number;
};

/**
 * The ground an embankment or a cut chunk takes at grade (P2.7-6 PR 7b): its centre line (stations,
 * lon/lat pairs and their run distances), half its slab's width, and the run distances of its run's
 * ground, portal and open ends within it (a street crossing there is where the road meets the ground).
 */
export type XwSite = {
  chunk: string;
  coords: number[];
  /** Per station: run distance, road and centre line's ground (T.P. m). */
  s: number[];
  z: number[];
  ground: number[];
  halfWidth: number;
  ends: number[];
};

/** `sites` (PR 7b) is absent in an input made before it, or of decks without an embankment or cut. */
export type XwRoadInput = { lines: RoadLine[]; ends: XwGroundEnd[]; sites?: XwSite[] };

/**
 * The road kind a chunk's line carries: the expressway's for its main lines and ramps, a local road
 * for a structure's street (GSI's 一般道 kind for a 臨港道路; mapRank draws it among the streets).
 */
const kindOf = (cls: XwClass): RoadKind => (cls === "street" ? "local" : OSM_EXPRESSWAY_KIND);

export type Ellipsoidal = (lat: number, lon: number, orthometric: number) => number;

const startId = (run: string) => `xw:${run}:start`;
const endId = (run: string) => `xw:${run}:end`;
const seamId = (a: string, b: string) => `xw:${a}|${b}`;
const chunkStartId = (c: XwChunk) => (c.prev ? seamId(c.prev, c.id) : startId(c.run));
const chunkEndId = (c: XwChunk) => (c.next ? seamId(c.id, c.next) : endId(c.run));

/** The section an expressway chunk carries (no median: each direction is its own run). */
export function chunkSection(chunk: XwChunk): CrossSection {
  return {
    lanes: chunk.lanes,
    laneWidth: chunk.laneWidth,
    shoulderL: chunk.shoulderL,
    shoulderR: chunk.shoulderR,
    median: 0,
    basis: chunk.basis,
  };
}

type Point = { s: number; lon: number; lat: number; z: number; id: string };

/**
 * Lines for the loaded chunks. `runs` is the run summaries of the tiles read (v6: each tile carries
 * those of its chunks' runs: class and ends); a chunk whose run is missing from it is skipped.
 */
export function expresswayRoadInput(
  chunks: readonly XwChunk[],
  runs: readonly XwTileRun[],
  ellipsoidal: Ellipsoidal,
): XwRoadInput {
  const byRun = new Map(runs.map((r) => [r.id, r]));
  // Junction ends to insert into their parents: run id → [s, node id]. A junction that falls on
  // one of the parent's own chunk ends takes that end's id instead (`alias`): one point, one id.
  const insertions = new Map<string, Array<{ s: number; id: string }>>();
  const alias = new Map<string, string>();
  for (const r of runs) {
    for (const end of ["start", "end"] as const) {
      const e = r[end];
      // A seam (P9: a viaduct going on into a tunnel or cut) joins like a junction at the parent's end.
      const isJunction =
        (e.kind === "junction" || e.kind === "seam") && e.parent !== undefined && e.parentS !== undefined;
      if (!isJunction) continue;
      const id = end === "start" ? startId(r.id) : endId(r.id);
      const parentS = e.parentS!;
      const atEnd = chunks.find((c) => {
        const isParent = c.run === e.parent;
        const last = c.st[c.st.length - STATION_STRIDE];
        return isParent && (Math.abs(c.st[0] - parentS) < 1e-3 || Math.abs(last - parentS) < 1e-3);
      });
      if (atEnd) {
        const isStart = Math.abs(atEnd.st[0] - parentS) < 1e-3;
        alias.set(id, isStart ? chunkStartId(atEnd) : chunkEndId(atEnd));
        continue;
      }
      const list = insertions.get(e.parent!) ?? [];
      list.push({ s: parentS, id });
      insertions.set(e.parent!, list);
    }
  }
  const lines: RoadLine[] = [];
  const ends: XwGroundEnd[] = [];
  const sites: XwSite[] = [];
  for (const chunk of chunks) {
    const run = byRun.get(chunk.run);
    if (!run) continue;
    const site = siteOf(chunk, run);
    if (site) sites.push(site);
    const n = chunk.st.length / STATION_STRIDE;
    const s0 = chunk.st[0];
    const s1 = chunk.st[(n - 1) * STATION_STRIDE];
    const firstId = alias.get(chunkStartId(chunk)) ?? chunkStartId(chunk);
    const lastId = alias.get(chunkEndId(chunk)) ?? chunkEndId(chunk);
    const points: Point[] = surfaceSamples(chunk.st).map(({ i, t, s }, k) => {
      const o = i * STATION_STRIDE;
      // A station is read as stored, so both chunks of a seam give the seam point the same values.
      const isStation = t === 0;
      const f = isStation ? null : frameAt(chunk.st, s);
      return {
        s,
        lon: f ? f.lon : chunk.st[o + ST.lon],
        lat: f ? f.lat : chunk.st[o + ST.lat],
        z: f ? f.z : chunk.st[o + ST.z],
        id: `xw:${chunk.id}#${k}`,
      };
    });
    points[0].id = firstId;
    points[points.length - 1].id = lastId;
    for (const j of insertions.get(chunk.run) ?? []) {
      const isInside = j.s > s0 && j.s < s1;
      if (!isInside) continue;
      const f = frameAt(chunk.st, j.s);
      const k = points.findIndex((p) => p.s > j.s);
      const isOnPoint = Math.abs(points[k - 1].s - j.s) < 1e-3;
      if (isOnPoint) {
        points[k - 1].id = j.id;
        continue;
      }
      points.splice(k, 0, { s: j.s, lon: f.lon, lat: f.lat, z: f.z, id: j.id });
    }
    lines.push(lineOf(chunk, points, ellipsoidal));
    for (const end of ["start", "end"] as const) {
      const isRunEnd = end === "start" ? chunk.prev === null : chunk.next === null;
      const joinsStreet = run.cls === "ramp" || run.cls === "street";
      const isGroundEnd = isRunEnd && joinsStreet && run[end].kind === "ground";
      if (!isGroundEnd) continue;
      const p = end === "start" ? points[0] : points[points.length - 1];
      ends.push({
        run: run.id,
        cls: run.cls === "street" ? "street" : "ramp",
        end,
        node: p.id,
        lon: p.lon,
        lat: p.lat,
        height: ellipsoidal(p.lat, p.lon, p.z),
        oneway: end === "start" ? 1 : -1,
        width: sectionWidth(chunk),
        section: chunkSection(chunk),
        ...limitOf(chunk),
      });
    }
  }
  // A junction whose parent chunk is not loaded leaves the child's end open (a dead end in the graph).
  return sites.length > 0 ? { lines, ends, sites } : { lines, ends };
}

/** A run's end where the road meets the ground, an untraced tunnel or the range's edge. */
const meetsGround = (kind: string) => kind === "ground" || kind === "portal" || kind === "open";

/** The ground an embankment or cut chunk takes (XwSite), null for a viaduct or tunnel. */
function siteOf(chunk: XwChunk, run: XwTileRun): XwSite | null {
  const isAtGrade = chunk.structure === "embankment" || chunk.structure === "cut";
  if (!isAtGrade) return null;
  const n = chunk.st.length / STATION_STRIDE;
  const coords: number[] = [];
  const s: number[] = [];
  const z: number[] = [];
  const ground: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STATION_STRIDE;
    coords.push(chunk.st[o + ST.lon], chunk.st[o + ST.lat]);
    s.push(chunk.st[o + ST.s]);
    z.push(chunk.st[o + ST.z]);
    ground.push(chunk.st[o + ST.ground]);
  }
  const ends: number[] = [];
  if (chunk.prev === null && meetsGround(run.start.kind)) ends.push(s[0]);
  if (chunk.next === null && meetsGround(run.end.kind)) ends.push(s[n - 1]);
  return {
    chunk: chunk.id,
    coords,
    s,
    z,
    ground,
    halfWidth: carriagewayWidth(chunk) / 2 + PARAPET_WIDTH.value,
    ends,
  };
}

/**
 * The limit a chunk's line carries (limitKind "sign"): the posted speed (G6 signPlan.ts postedOf,
 * the 323 plates' value: the OSM maxspeed of the way, an untagged way carrying the value before it,
 * a run starting untagged at the statute's 60), else the chunk's own tag (data without signs), else
 * none: the segment takes the statutory 60 km/h (roads.ts estimatedLimit). Why not the run's design
 * speed (P3's tagV, W5): it is what the alignment was built for, not what is posted.
 */
function limitOf(chunk: XwChunk): { limit?: number } {
  const limit = chunk.posted ?? chunk.maxspeed ?? null;
  return limit === null ? {} : { limit };
}

function lineOf(chunk: XwChunk, points: Point[], ellipsoidal: Ellipsoidal): RoadLine {
  const section = chunkSection(chunk);
  return {
    coords: points.flatMap((p) => [p.lon, p.lat]),
    width: sectionWidth(section),
    oneway: 1,
    kind: kindOf(chunk.cls),
    source: "osm",
    cls: chunk.cls,
    // An embankment (P2.7-6, a height build) is a deck on walls over the ground: a viaduct's level to
    // the graph. Why not a structure of its own: nothing in the graph treats it otherwise.
    structure: chunk.structure === "embankment" ? "viaduct" : chunk.structure,
    // Below the ground (P9) a level down, as roadClass.levelOf counts tunnels.
    level: chunk.structure === "viaduct" || chunk.structure === "embankment" ? 1 : -1,
    nodeIds: points.map((p) => p.id),
    section,
    xid: chunk.id,
    ...(chunk.ref ? { ref: chunk.ref } : {}),
    ...(chunk.name ? { name: chunk.name } : {}),
    ...limitOf(chunk),
    heights: points.map((p) => ellipsoidal(p.lat, p.lon, p.z)),
  };
}

/** Squared-distance projection of a point onto a polyline in a local plane (metres). */
function project(
  xy: (lon: number, lat: number) => [number, number],
  coords: number[],
  px: number,
  py: number,
): { d: number; piece: number; t: number; len: number } {
  let best = { d: Infinity, piece: -1, t: 0, len: 0 };
  for (let i = 0; i + 3 < coords.length; i += 2) {
    const [ax, ay] = xy(coords[i], coords[i + 1]);
    const [bx, by] = xy(coords[i + 2], coords[i + 3]);
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-9) continue;
    const t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / len2));
    const d = Math.hypot(ax + ex * t - px, ay + ey * t - py);
    if (d < best.d) best = { d, piece: i / 2, t, len: Math.sqrt(len2) };
  }
  return best;
}

/**
 * The street lines with the expressway joined in (in the worker, before the graph is built): GSI
 * 高速道路 lines within REPLACE_REACH_M of a chunk are dropped, each ramp's ground end is joined to
 * the nearest street within RAMP_REACH_M, and the chunk lines are appended. Lines it does not
 * change are passed through as the same objects.
 */
export function joinExpressway(
  streets: readonly RoadLine[],
  xw: XwRoadInput,
  report: (diagnostic: RoadDiagnostic) => void,
): RoadLine[] {
  const hasChunks = xw.lines.length > 0;
  if (!hasChunks) return [...streets];
  const lat0 = xw.lines[0].coords[1];
  const lon0 = xw.lines[0].coords[0];
  const plane = planeAt(lon0, lat0);
  const xy = plane.toXY;
  // Chunk points by 40 m cell, for the replacement test.
  const CELL = REPLACE_REACH_M;
  const cells = new Set<string>();
  for (const line of xw.lines) {
    for (let i = 0; i < line.coords.length; i += 2) {
      const [x, y] = xy(line.coords[i], line.coords[i + 1]);
      cells.add(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
    }
  }
  const isNearChunk = (lon: number, lat: number) => {
    const [x, y] = xy(lon, lat);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) if (cells.has(`${cx + dx},${cy + dy}`)) return true;
    return false;
  };
  const isReplaced = (line: RoadLine) => {
    const isGsiExpressway = isExpressway(line) && sourceOf(line) === "gsi";
    if (!isGsiExpressway) return false;
    for (let i = 0; i < line.coords.length; i += 2)
      if (isNearChunk(line.coords[i], line.coords[i + 1])) return true;
    return false;
  };
  const out: RoadLine[] = cutAtSites(
    streets.filter((l) => !isReplaced(l)),
    xw.sites ?? [],
    xy,
    report,
  );
  const gsiExpressway = streets.filter((l) => isExpressway(l) && sourceOf(l) === "gsi");
  const streetKeys = new Set<string>();
  for (const line of out) {
    if (!usesGroundSurface(line)) continue;
    for (let i = 0; i < line.coords.length; i += 2)
      streetKeys.add(vertexKey(line.coords[i], line.coords[i + 1]));
  }
  const extra: RoadLine[] = [];
  const connector = (end: XwGroundEnd, path: number[]): RoadLine => {
    // Drawn from the street to the deck for an on-ramp (its start), from the deck for an off-ramp.
    const coords = [end.lon, end.lat, ...path];
    const ids = [end.node, ...Array.from({ length: path.length / 2 }, () => "")];
    const isEntry = end.end === "start";
    const pairs = isEntry ? reversePairs(coords) : coords;
    return {
      coords: pairs,
      width: end.width,
      oneway: 1,
      kind: kindOf(end.cls),
      source: "osm",
      cls: end.cls,
      // On the ground: its height is the terrain's (no heights), like a street's.
      structure: "ground",
      level: 0,
      nodeIds: isEntry ? ids.toReversed() : ids,
      section: end.section,
      ...(end.limit === undefined ? {} : { limit: end.limit }),
    };
  };
  // The streets' extent (the GSI tiles around the network's centre): a ramp end outside it is not
  // joined, nor reported, because its street is simply not loaded (the next area joins it).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of out) {
    if (!usesGroundSurface(line)) continue;
    for (let i = 0; i < line.coords.length; i += 2) {
      const [x, y] = xy(line.coords[i], line.coords[i + 1]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const isInsideStreets = (x: number, y: number) =>
    x > minX + EXTENT_MARGIN_M &&
    x < maxX - EXTENT_MARGIN_M &&
    y > minY + EXTENT_MARGIN_M &&
    y < maxY - EXTENT_MARGIN_M;
  for (const end of xw.ends) {
    const [px, py] = xy(end.lon, end.lat);
    const isLoaded = isInsideStreets(px, py);
    if (!isLoaded) continue;
    // First the ramp's own at-grade part, which GSI draws as a 高速道路 line from the deck's end to
    // the street (OSM's continuation of the link is not compiled: it is not a viaduct).
    // Walked over every GSI 高速道路 line, the ones kept too (P6, W6): the at-grade part can run on
    // more than REPLACE_REACH_M from any chunk, and when the decks loaded are fewer than the streets
    // (another centre) the lines near the ramp's foot were not among the replaced ones.
    const atGrade = end.cls === "ramp" ? traceAtGrade(gsiExpressway, streetKeys, xy, px, py) : null;
    if (atGrade) {
      extra.push(connector(end, atGrade));
      continue;
    }
    let best: { index: number; d: number; piece: number; t: number; len: number } | null = null;
    for (let index = 0; index < out.length; index++) {
      const line = out[index];
      if (!usesGroundSurface(line)) continue;
      const hit = project(xy, line.coords, px, py);
      const isCloser = hit.d < (best?.d ?? RAMP_REACH_M);
      if (isCloser) best = { index, ...hit };
    }
    if (!best) {
      report({ event: "ramp_unattached", fields: { run: end.run, end: end.end, reachM: RAMP_REACH_M } });
      continue;
    }
    const street = out[best.index];
    // Keep the new vertex VERTEX_CLEARANCE_M off the piece's ends, so no piece of the split street
    // falls under the graph's 1 m minimum.
    const margin = Math.min(0.5, VERTEX_CLEARANCE_M / Math.max(best.len, 1e-6));
    const t = Math.min(1 - margin, Math.max(margin, best.t));
    const i = best.piece * 2;
    const lon = street.coords[i] + (street.coords[i + 2] - street.coords[i]) * t;
    const lat = street.coords[i + 1] + (street.coords[i + 3] - street.coords[i + 1]) * t;
    const n = street.coords.length / 2;
    const ids = street.nodeIds ?? Array.from({ length: n }, () => "");
    const joinId = `xwg:${end.run}:${end.end}`;
    out[best.index] = {
      ...street,
      coords: [...street.coords.slice(0, i + 2), lon, lat, ...street.coords.slice(i + 2)],
      nodeIds: [...ids.slice(0, best.piece + 1), joinId, ...ids.slice(best.piece + 1)],
    };
    // From the deck's end down to the street, on the ground (the deck meets the ground there).
    // Under a metre the graph would drop the connector: the street's new vertex takes the deck
    // end's id itself (they are one point to within that metre).
    const [jx, jy] = xy(lon, lat);
    const isTooShort = Math.hypot(jx - px, jy - py) < 1;
    if (isTooShort) {
      out[best.index].nodeIds![best.piece + 1] = end.node;
      continue;
    }
    const joined = connector(end, [lon, lat]);
    const last = end.end === "end" ? joined.nodeIds!.length - 1 : 0;
    joined.nodeIds![last] = joinId;
    extra.push(joined);
  }
  return [...out, ...xw.lines, ...extra];
}

/** How a GSI street meets a site (siteCrossings): taken out, or kept and why. */
export type SiteCrossing = {
  /** The street's index in the list given. */
  street: number;
  chunk: string;
  /** Run distance on the site's chunk, and where (lat, lon). */
  s: number;
  at: [number, number];
  angleDeg: number;
  widthM: number;
  /** The road over the centre line's ground there (m). */
  overGroundM: number;
  /**
   * cut: crosses at grade; under: the deck's soffit clears it (a viaduct the compiler did not make);
   * both are taken out. end: by the run's ground end; along: runs along it; both kept.
   */
  kind: "cut" | "end" | "along" | "under";
  /** GSI marks the street as in a tunnel (ftCode 2704): an underpass the game does not draw. */
  tunnel: boolean;
  /** The street's arc length at the crossing and how far either side is taken out (cut only). */
  atM: number;
  reachM: number;
};

/** The SITE_CELL_M cell of a plane coordinate. */
const cellOf = (v: number) => Math.floor(v / SITE_CELL_M);

/** A box [x0, y0, x1, y1] round some plane points, widened by m. */
function boxOfPoints(pts: ReadonlyArray<[number, number]>, m: number): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

/** Whether cutAtSites takes a crossing out (at grade, or under a deck the compiler left low). */
const isTakenOut = (c: SiteCrossing): c is SiteCrossing & { kind: "cut" | "under" } =>
  c.kind === "cut" || c.kind === "under";

const isGsiStreet = (street: RoadLine) =>
  sourceOf(street) === "gsi" && !isExpressway(street) && street.nodeIds === undefined;

/**
 * Every crossing of a GSI street's centre line with a site's (an embankment's or a cut's) and what
 * cutAtSites makes of it. Kept: within SITE_END_REACH_M of the run's ground, portal or open end (that
 * is the ramp's own street, RAMP_REACH_M), or at less than SITE_CROSSING_MIN_DEG (a ramp in a
 * street's median: its lanes go by on either side). The rest are taken out, `under` where the deck
 * stands over the ground by SITE_UNDER_NEED_M on a thinned girder (the street could pass under it: a
 * viaduct the compiler did not make, told apart for the probe; taken out all the same, as its walls
 * stop a car there: re-review W-B). Each site's segments are filed in a grid first (review W6: all against all
 * made joinExpressway 28 → ~500 ms).
 */
export function siteCrossings(
  streets: readonly RoadLine[],
  sites: readonly XwSite[],
  xy: (lon: number, lat: number) => [number, number],
): SiteCrossing[] {
  if (sites.length === 0) return [];
  const siteXY = sites.map((site) => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < site.coords.length; i += 2) pts.push(xy(site.coords[i], site.coords[i + 1]));
    return pts;
  });
  // The sites' segments by SITE_CELL_M cell of their boxes: a street segment tests only those of
  // the cells it spans.
  const cells = new Map<string, Array<[number, number]>>();
  for (let k = 0; k < siteXY.length; k++) {
    const line = siteXY[k];
    for (let j = 0; j + 1 < line.length; j++) {
      const [x0, y0, x1, y1] = boxOfPoints([line[j], line[j + 1]], 0);
      for (let cx = cellOf(x0); cx <= cellOf(x1); cx++)
        for (let cy = cellOf(y0); cy <= cellOf(y1); cy++) {
          const key = `${cx},${cy}`;
          cells.set(key, [...(cells.get(key) ?? []), [k, j]]);
        }
    }
  }
  const minSin = Math.sin((SITE_CROSSING_MIN_DEG * Math.PI) / 180);
  const out: SiteCrossing[] = [];
  for (let index = 0; index < streets.length; index++) {
    const street = streets[index];
    if (!isGsiStreet(street)) continue;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < street.coords.length; i += 2)
      pts.push(xy(street.coords[i], street.coords[i + 1]));
    let along: number[] | null = null;
    const crossed: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0, x1, y1] = boxOfPoints([pts[i], pts[i + 1]], 0);
      const pairs = new Set<string>();
      for (let cx = cellOf(x0); cx <= cellOf(x1); cx++)
        for (let cy = cellOf(y0); cy <= cellOf(y1); cy++)
          for (const [k, j] of cells.get(`${cx},${cy}`) ?? []) pairs.add(`${k}|${j}`);
      for (const pair of [...pairs].toSorted()) {
        const [k, j] = pair.split("|").map(Number);
        const site = sites[k];
        const line = siteXY[k];
        const hit = crossingOf(line[j], line[j + 1], pts[i], pts[i + 1]);
        if (!hit) continue;
        if (!along) {
          along = [0];
          for (let q = 1; q < pts.length; q++)
            along.push(along[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
        }
        const atM = along[i] + (along[i + 1] - along[i]) * hit.u;
        // A crossing through a station meets the segments either side of it: one crossing.
        const isSeen = crossed.some((c) => Math.abs(c - atM) < 0.5);
        if (isSeen) continue;
        crossed.push(atM);
        const lerp = (v: readonly number[]) => v[j] + (v[j + 1] - v[j]) * hit.t;
        const siteS = lerp(site.s);
        const overGroundM = lerp(site.z) - lerp(site.ground);
        const isAtEnd = site.ends.some((e) => Math.abs(e - siteS) <= SITE_END_REACH_M);
        const isAlong = hit.sin < minSin;
        const isUnder = clearsOnThinGirder(lerp(site.z), lerp(site.ground), SITE_UNDER_NEED_M);
        const kind = isAtEnd ? "end" : isAlong ? "along" : isUnder ? "under" : "cut";
        // Across the slab and its clearance at this angle, and the street's own half width beside it.
        const reachM =
          (site.halfWidth + SITE_CLEARANCE_M) / hit.sin + street.width / 2 / Math.tan(Math.asin(hit.sin));
        out.push({
          street: index,
          chunk: site.chunk,
          s: Math.round(siteS * 10) / 10,
          at: [
            Math.round(
              (street.coords[i * 2 + 1] + (street.coords[i * 2 + 3] - street.coords[i * 2 + 1]) * hit.u) *
                1e6,
            ) / 1e6,
            Math.round(
              (street.coords[i * 2] + (street.coords[i * 2 + 2] - street.coords[i * 2]) * hit.u) * 1e6,
            ) / 1e6,
          ],
          angleDeg: Math.round((Math.asin(hit.sin) * 180) / Math.PI),
          widthM: street.width,
          overGroundM: Math.round(overGroundM * 100) / 100,
          kind,
          tunnel: street.tunnel === true,
          atM,
          reachM,
        });
      }
    }
  }
  return out;
}

/**
 * The GSI streets with the stretch taken out where one crosses an embankment or a cut at grade
 * (XwSite, P2.7-6 PR 7b; which crossings: siteCrossings): from SITE_CLEARANCE_M short of the slab's
 * edge on one side to as far past the other, so neither the street's surface nor its graph runs
 * through the walls (a car following it met them, or the hole the ground is cut away in). Each cut
 * is reported (`street_cut_at_expressway`). Why not a bridge or an underpass: which a crossing is,
 * is for the compiler to decide (R), and until it does a dead end on each side is what a car can
 * drive without passing through a wall.
 */
function cutAtSites(
  streets: RoadLine[],
  sites: readonly XwSite[],
  xy: (lon: number, lat: number) => [number, number],
  report: (diagnostic: RoadDiagnostic) => void,
): RoadLine[] {
  const cuts = siteCrossings(streets, sites, xy).filter(isTakenOut);
  if (cuts.length === 0) return streets;
  const gapsOf = new Map<number, Array<[number, number]>>();
  for (const c of cuts) {
    gapsOf.set(c.street, [...(gapsOf.get(c.street) ?? []), [c.atM - c.reachM, c.atM + c.reachM]]);
    report({
      event: "street_cut_at_expressway",
      fields: {
        chunk: c.chunk,
        s: c.s,
        at: c.at,
        lengthM: Math.round(2 * c.reachM * 10) / 10,
        angleDeg: c.angleDeg,
        widthM: c.widthM,
        overGroundM: c.overGroundM,
        kind: c.kind,
        tunnel: c.tunnel,
      },
    });
  }
  const out: RoadLine[] = [];
  for (let index = 0; index < streets.length; index++) {
    const gaps = gapsOf.get(index);
    if (!gaps) {
      out.push(streets[index]);
      continue;
    }
    const street = streets[index];
    const along = [0];
    for (let i = 2; i + 1 < street.coords.length; i += 2) {
      const [ax, ay] = xy(street.coords[i - 2], street.coords[i - 1]);
      const [bx, by] = xy(street.coords[i], street.coords[i + 1]);
      along.push(along[along.length - 1] + Math.hypot(bx - ax, by - ay));
    }
    out.push(...piecesOutside(street, along, gaps));
  }
  return out;
}

/** Where segment a–b crosses segment p–q (shares t along a–b, u along p–q) and the sine of the angle between them. */
function crossingOf(
  a: [number, number],
  b: [number, number],
  p: [number, number],
  q: [number, number],
): { t: number; u: number; sin: number } | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const fx = q[0] - p[0];
  const fy = q[1] - p[1];
  const d = ex * fy - ey * fx;
  const lengths = Math.hypot(ex, ey) * Math.hypot(fx, fy);
  const isParallel = lengths < 1e-9 || Math.abs(d) < 1e-9 * lengths;
  if (isParallel) return null;
  const t = ((p[0] - a[0]) * fy - (p[1] - a[1]) * fx) / d;
  const u = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / d;
  const isOn = t >= 0 && t <= 1 && u >= 0 && u <= 1;
  return isOn ? { t, u, sin: Math.abs(d) / lengths } : null;
}

/** A street's pieces outside some stretches of its arc length (each piece ≥ 1 m, the graph's least). */
function piecesOutside(
  street: RoadLine,
  along: readonly number[],
  gaps: ReadonlyArray<[number, number]>,
): RoadLine[] {
  const total = along[along.length - 1];
  const merged = gaps.toSorted((a, b) => a[0] - b[0]);
  const kept: Array<[number, number]> = [];
  let from = 0;
  for (const [g0, g1] of merged) {
    if (g0 > from) kept.push([from, g0]);
    from = Math.max(from, g1);
  }
  if (from < total) kept.push([from, total]);
  const pointAt = (l: number): [number, number] => {
    let i = 0;
    while (i + 2 < along.length && along[i + 1] < l) i++;
    const share = (l - along[i]) / (along[i + 1] - along[i] || 1);
    const k = i * 2;
    return [
      street.coords[k] + (street.coords[k + 2] - street.coords[k]) * share,
      street.coords[k + 1] + (street.coords[k + 3] - street.coords[k + 1]) * share,
    ];
  };
  const out: RoadLine[] = [];
  for (const [l0, l1] of kept) {
    const isTooShort = l1 - l0 < 1;
    if (isTooShort) continue;
    const coords = [...pointAt(l0)];
    for (let i = 0; i < along.length; i++)
      if (along[i] > l0 && along[i] < l1) coords.push(street.coords[i * 2], street.coords[i * 2 + 1]);
    coords.push(...pointAt(l1));
    out.push({ ...street, coords });
  }
  return out;
}

/** [lon, lat] pairs in the other order. */
function reversePairs(coords: number[]): number[] {
  const out: number[] = [];
  for (let i = coords.length - 2; i >= 0; i -= 2) out.push(coords[i], coords[i + 1]);
  return out;
}

/** Longest at-grade continuation walked from a deck's end to the street. */
const AT_GRADE_MAX_M = 250;

/**
 * The ramp's at-grade part from a deck's ground end: the GSI 高速道路 line within RAMP_REACH_M of
 * the end, walked (through the GSI lines that share its vertices) to the nearest vertex a street
 * shares, as [lon, lat] pairs from the projection of the end to that vertex. Null when there is no
 * such line or no street within AT_GRADE_MAX_M along it.
 */
function traceAtGrade(
  lines: readonly RoadLine[],
  streetKeys: ReadonlySet<string>,
  xy: (lon: number, lat: number) => [number, number],
  px: number,
  py: number,
): number[] | null {
  let start: { line: number; piece: number; t: number; d: number } | null = null;
  for (let line = 0; line < lines.length; line++) {
    const hit = project(xy, lines[line].coords, px, py);
    const isCloser = hit.d < (start?.d ?? RAMP_REACH_M);
    if (isCloser) start = { line, piece: hit.piece, t: hit.t, d: hit.d };
  }
  if (!start) return null;
  // Vertices of the GSI lines by key, for walking from one line onto the next.
  const at = new Map<string, Array<[number, number]>>();
  lines.forEach((l, li) => {
    for (let v = 0; v < l.coords.length / 2; v++) {
      const key = vertexKey(l.coords[v * 2], l.coords[v * 2 + 1]);
      const list = at.get(key) ?? [];
      list.push([li, v]);
      at.set(key, list);
    }
  });
  const c = lines[start.line].coords;
  const i = start.piece * 2;
  const foot = [c[i] + (c[i + 2] - c[i]) * start.t, c[i + 1] + (c[i + 3] - c[i + 1]) * start.t];
  const distance = (a: number[], b: number[]) => {
    const [ax, ay] = xy(a[0], a[1]);
    const [bx, by] = xy(b[0], b[1]);
    return Math.hypot(bx - ax, by - ay);
  };
  // Dijkstra over the vertices from the foot (both ways along its piece) to a street's vertex.
  type Step = { line: number; v: number; d: number; path: number[] };
  const queue: Step[] = [
    { line: start.line, v: start.piece, d: 0, path: [] },
    { line: start.line, v: start.piece + 1, d: 0, path: [] },
  ].map((s) => {
    const p = [lines[s.line].coords[s.v * 2], lines[s.line].coords[s.v * 2 + 1]];
    return { ...s, d: distance(foot, p), path: [...foot, ...p] };
  });
  const seen = new Set<string>();
  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const step = queue.shift()!;
    const coords = lines[step.line].coords;
    const here = [coords[step.v * 2], coords[step.v * 2 + 1]];
    const key = vertexKey(here[0], here[1]);
    const isAtStreet = streetKeys.has(key);
    if (isAtStreet) return step.path;
    const isDone = seen.has(key) || step.d > AT_GRADE_MAX_M;
    if (isDone) continue;
    seen.add(key);
    for (const [li, v] of at.get(key) ?? []) {
      const n = lines[li].coords.length / 2;
      for (const w of [v - 1, v + 1]) {
        const isOffLine = w < 0 || w >= n;
        if (isOffLine) continue;
        const next = [lines[li].coords[w * 2], lines[li].coords[w * 2 + 1]];
        queue.push({ line: li, v: w, d: step.d + distance(here, next), path: [...step.path, ...next] });
      }
    }
  }
  return null;
}

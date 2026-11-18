import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import { type XwSite, SITE_CLEARANCE_M, SITE_CROSSING_MIN_DEG } from "./expresswayRoads";
import { isExpressway, sourceOf, structureOf } from "./roadClass";
import {
  bandSection,
  resolveSection,
  STREET,
  streetRoom,
  type StreetSection,
  unbandedOf,
} from "./laneChange";
import { BAN_LEAD, classifyTurn, LANE_SLOPE } from "./laneMoves";
import { junctionClearance } from "./roadMarkings";
import type { RoadGraph, Segment } from "./roads";
import type { LogFields } from "../logEvents";
import { mergeBands, type StreetBand } from "./streetBandRules";
import type { PavementPolygon } from "./pavements";

/**
 * The bands an expressway's site makes across the streets it runs along (P2.7 R1-2a, memo 改訂 1,
 * 3.2), applied to the streets' sections in the worker, and the islands drawn in the medians they
 * give (3.6, U8: kerbed paving).
 *
 * In the worker, after the graph is built and before the regulations (computeRoadNetwork),
 * `applyStreetBands` samples every GSI street segment each metre. Where an embankment's or a cut's
 * slab (XwSite: half the carriageway and the parapet, which is the cut's wall's thickness too) meets
 * the street's normal at under SITE_CROSSING_MIN_DEG and reaches its 幅員, its strip, widened by
 * SITE_CLEARANCE_M, lies across the street. Runs of such samples MIN_LENGTH_M or longer (gaps of
 * JOIN_GAP_M closed) give the segment's bands (mergeBands: strips a lane apart stay apart), kept on
 * Segment.bands and handed to resolveSection, there and again when the regulations resolve the
 * section (regulations.ts), so both go through classify. The lines are not changed: no street is
 * cut, split or moved. Why after the graph and not on the lines (joinExpressway): the section is a
 * segment's, and a line's band would be split again at its junctions.
 */

/** Shorter than this along a site is a street's end at the site's edge, not a street along it (m). */
export const MIN_LENGTH_M = 3;
/** Gaps in a run of samples this short or shorter are closed (m). */
export const JOIN_GAP_M = 1;
/** The step a segment is sampled at (m). */
const SAMPLE_M = 1;
/** The grid the sites' segments are filed in (m). */
const CELL_M = 50;

type P = { x: number; z: number };
/** A site in the frame: its centre line and half its slab's width (unwidened). */
export type LocalSite = { chunk: string; pts: P[]; s: number[]; half: number };
/** One site's strip across a street at a sample: unwidened (`inner`) and widened (the band's). */
/** `s` is the run distance on the site where the street's normal meets it (for the tools). */
export type Strip = {
  right: number;
  left: number;
  innerRight: number;
  innerLeft: number;
  chunk: string;
  s: number;
};

/** The sites in a frame, and their segments filed by CELL_M cell for the samples' queries. */
export class SiteIndex {
  readonly sites: LocalSite[];
  private readonly cells = new Map<string, Array<[number, number]>>();
  constructor(sites: readonly XwSite[], frame: LocalFrame) {
    this.sites = sites.map((site) => {
      const pts: P[] = [];
      for (let i = 0; i + 1 < site.coords.length; i += 2) {
        const v = frame.toLocal(site.coords[i + 1], site.coords[i], 0);
        pts.push({ x: v.x, z: v.z });
      }
      return { chunk: site.chunk, pts, s: site.s, half: site.halfWidth };
    });
    this.sites.forEach((site, k) => {
      for (let j = 0; j + 1 < site.pts.length; j++) {
        const [a, b] = [site.pts[j], site.pts[j + 1]];
        for (let cx = cellOf(Math.min(a.x, b.x)); cx <= cellOf(Math.max(a.x, b.x)); cx++)
          for (let cz = cellOf(Math.min(a.z, b.z)); cz <= cellOf(Math.max(a.z, b.z)); cz++) {
            const key = `${cx},${cz}`;
            const list = this.cells.get(key) ?? [];
            list.push([k, j]);
            this.cells.set(key, list);
          }
      }
    });
  }

  /** Site segments filed in the cells within `reach` of p. */
  near(p: P, reach: number): Array<[number, number]> {
    const out = new Set<string>();
    const pairs: Array<[number, number]> = [];
    for (let cx = cellOf(p.x - reach); cx <= cellOf(p.x + reach); cx++)
      for (let cz = cellOf(p.z - reach); cz <= cellOf(p.z + reach); cz++)
        for (const pair of this.cells.get(`${cx},${cz}`) ?? []) {
          const key = `${pair[0]}|${pair[1]}`;
          if (out.has(key)) continue;
          out.add(key);
          pairs.push(pair);
        }
    return pairs.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  get isEmpty(): boolean {
    return this.sites.length === 0;
  }
}

const cellOf = (v: number) => Math.floor(v / CELL_M);

/**
 * The sites' strips across a street at one point (`p`, unit heading `t`, 幅員 `width`): one for every
 * site segment the street's normal through p meets at under SITE_CROSSING_MIN_DEG, its half width over
 * the cosine of the angle, that reaches the street's 幅員 once widened by SITE_CLEARANCE_M. Why each
 * its own and not their union: two decks either side of a street meet one normal, and their union
 * would cover the lanes between them (mergeBands decides what is one band).
 */
export function stripsAt(p: P, t: P, width: number, index: SiteIndex): Strip[] {
  const n = { x: t.z, z: -t.x }; // leftOf
  const cosMin = Math.cos((SITE_CROSSING_MIN_DEG * Math.PI) / 180);
  const reach = width / 2 + 40;
  const out: Strip[] = [];
  for (const [k, j] of index.near(p, reach)) {
    const site = index.sites[k];
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
    const inner = site.half / cos;
    const right = u - inner - SITE_CLEARANCE_M;
    const left = u + inner + SITE_CLEARANCE_M;
    const reaches = left > -width / 2 && right < width / 2;
    if (!reaches) continue;
    const s = site.s[j] + (site.s[j + 1] - site.s[j]) * v;
    out.push({ right, left, innerRight: u - inner, innerLeft: u + inner, chunk: site.chunk, s });
  }
  return out;
}

/** A GSI street (not the expressway's own lines, nor the ramps' connectors): what the bands apply to. */
export const takesBands = (seg: Segment) => sourceOf(seg.line) === "gsi" && !isExpressway(seg.line);

/** A segment's samples with strips, each run MIN_LENGTH_M or longer (JOIN_GAP_M gaps closed). */
export function bandSamples(
  graph: RoadGraph,
  seg: Segment,
  index: SiteIndex,
): Array<{ l: number; strips: Strip[] }> {
  const hits: Array<{ l: number; strips: Strip[] }> = [];
  for (let l = 0; l <= seg.length; l += SAMPLE_M) {
    const { pos, dir } = graph.sample(seg, l);
    const strips = stripsAt({ x: pos.x, z: pos.z }, { x: dir.x, z: dir.z }, seg.line.width, index);
    if (strips.length > 0) hits.push({ l, strips });
  }
  const runs: Array<typeof hits> = [];
  for (const h of hits) {
    const last = runs.at(-1);
    const isJoined = last !== undefined && h.l - last.at(-1)!.l <= SAMPLE_M + JOIN_GAP_M;
    if (isJoined) last.push(h);
    else runs.push([h]);
  }
  return runs.filter((r) => r.length * SAMPLE_M >= MIN_LENGTH_M).flat();
}

/** A segment's bands (memo 3.2), none where no site runs along it. */
export function segmentBands(graph: RoadGraph, seg: Segment, index: SiteIndex): StreetBand[] {
  const kept = bandSamples(graph, seg, index);
  const strips = kept.flatMap((h) =>
    h.strips.map((b) => ({ right: b.right, left: b.left, source: "xw-site" as const })),
  );
  return mergeBands(strips);
}

/** Whether a segment's box comes within reach of any site (a quick test before sampling it). */
function isNearAnySite(seg: Segment, index: SiteIndex): boolean {
  const reach = seg.line.width / 2 + 40;
  for (let i = 0; i < seg.pts.length; i += 4) {
    const p = seg.pts[i];
    if (index.near({ x: p.x, z: p.z }, reach).length > 0) return true;
  }
  const last = seg.pts[seg.pts.length - 1];
  return index.near({ x: last.x, z: last.z }, reach).length > 0;
}

/**
 * Bands on the GSI streets the sites run along (Segment.bands), each such segment's section
 * resolved again from its width with them (the regulations resolve it once more with their
 * evidence). Returns the segments given bands.
 */
/** A banded segment and where along it (coords' distance) its sites' samples begin and end. */
export type BandedSegment = { seg: Segment; first: number; last: number };

export function applyStreetBands(
  graph: RoadGraph,
  sites: readonly XwSite[],
  frame: LocalFrame,
): BandedSegment[] {
  if (sites.length === 0) return [];
  const index = new SiteIndex(sites, frame);
  const banded: BandedSegment[] = [];
  for (const seg of graph.segments) {
    if (!takesBands(seg)) continue;
    if (!isNearAnySite(seg, index)) continue;
    const kept = bandSamples(graph, seg, index);
    const isAlongNone = kept.length === 0;
    if (isAlongNone) continue;
    const bands = mergeBands(
      kept.flatMap((h) =>
        h.strips.map((b) => ({ right: b.right, left: b.left, source: "xw-site" as const })),
      ),
    );
    seg.bands = bands;
    const section = resolveSection(seg.line.width, seg.line.oneway, { bands });
    seg.section = section;
    seg.lanes = section.lanes;
    banded.push({ seg, first: kept[0].l, last: kept.at(-1)!.l });
  }
  return banded;
}

const round = (v: number, k = 100) => Math.round(v * k) / k;

/** What the bands made of a banded segment, for the page's log (the worker cannot log). */
export type BandDiagnostic =
  | { event: "street_band_applied"; fields: LogFields<"street_band_applied"> }
  | { event: "street_band_guard_short"; fields: LogFields<"street_band_guard_short"> }
  | { event: "street_bands_chained"; fields: LogFields<"street_bands_chained"> }
  | { event: "street_band_unresolved"; fields: LogFields<"street_band_unresolved"> };

/** The logs of the banded segments' sections once resolved (street_band_applied / _unresolved). */
export function bandDiagnostics(
  graph: RoadGraph,
  banded: readonly Segment[],
  frame: LocalFrame,
  chainOf: ReadonlyMap<number, { chain: number; extended: number }> = new Map(),
): BandDiagnostic[] {
  const out: BandDiagnostic[] = [];
  for (const seg of banded) {
    const section = seg.section;
    const klass = section?.bandClass;
    if (!section || !klass || klass === "clear") continue;
    const g = frame.toGeodetic(graph.sample(seg, seg.length / 2).pos);
    const at = [round(g.lat, 1e6), round(g.lon, 1e6)];
    const bands = (seg.bands ?? []).map((b) => ({ right: round(b.right), left: round(b.left) }));
    const travel = seg.onewayRule?.dir ?? seg.line.oneway;
    const isGiven = klass === "A" || klass === "A'";
    if (isGiven) {
      out.push({
        event: "street_band_applied",
        fields: {
          at,
          widthM: seg.line.width,
          travel,
          klass,
          bands,
          lanesBefore: section.unbanded?.lanes ?? section.lanes,
          lanesAfter: section.lanes,
          carriagewayBefore: round(section.unbanded?.carriageway ?? section.carriageway),
          carriagewayAfter: round(section.carriageway),
          medianAfter: round(section.median),
          chain: chainOf.get(seg.id)?.chain ?? 1,
          extended: chainOf.get(seg.id)?.extended ?? 0,
        },
      });
      continue;
    }
    out.push({
      event: "street_band_unresolved",
      fields: { at, widthM: seg.line.width, travel, klass, bands, lanes: section.lanes },
    });
  }
  return out;
}

// ---------- islands (memo 3.6) ----------

/** The step islands are cut into along a street (pavements.ts EDGE_STEP): one cell each. */
const ISLAND_STEP_M = 4;
/** An island piece narrower than this is left as road (m). */
const ISLAND_LEAST_M = 0.5;

/** One island cell: its stretch along the segment and its offsets (left of the coords) across. */
export type IslandCell = { seg: number; s0: number; s1: number; right: number; left: number };

/**
 * The island cells of the segments given a 中央帯 by their bands (class A): the median less the sites'
 * slabs as they stand (unwidened), cut into ISLAND_STEP_M cells, none inside a junction's clearance
 * (roadMarkings junctionClearance: the crossings and stop lines), none within a ramp's connector's
 * half width + 1 m (the cars joining the street there). A cell's offsets hold over its whole stretch
 * (the median's edge and the sites' at its two ends and middle), so no cell reaches into a slab.
 * Not on a capped carriageway (A'): the road runs to the slab there as by an embankment now.
 */
export function islandCells(graph: RoadGraph, sites: readonly XwSite[], frame: LocalFrame): IslandCell[] {
  const index = new SiteIndex(sites, frame);
  const connectors = graph.segments.filter(
    (s) => sourceOf(s.line) === "osm" && structureOf(s.line) === "ground",
  );
  const isByConnector = (p: Vector3) =>
    connectors.some((c) => {
      const near = graph.nearestOn(c, p);
      return near.dist <= c.line.width / 2 + 1;
    });
  const out: IslandCell[] = [];
  for (const seg of graph.segments) {
    // Only where a site is: a segment the band was copied onto (memo 3.4) keeps its median as road.
    const isMedian =
      seg.section?.bandClass === "A" &&
      seg.section.bandExtended !== true &&
      seg.oneway === 0 &&
      seg.section.median > 0;
    if (!isMedian) continue;
    const half = seg.section!.median / 2;
    const isJunctionAt = (node: number) => (graph.nodes.get(node)?.length ?? 0) >= 3;
    const from = isJunctionAt(seg.from) ? junctionClearance(graph, seg.from) : 0;
    const to = seg.length - (isJunctionAt(seg.to) ? junctionClearance(graph, seg.to) : 0);
    for (let s0 = from; s0 + ISLAND_STEP_M / 2 <= to; s0 += ISLAND_STEP_M) {
      const s1 = Math.min(to, s0 + ISLAND_STEP_M);
      // The slabs over the cell (unwidened), at its ends and middle.
      const slabs: Array<[number, number]> = [];
      for (const s of [s0, (s0 + s1) / 2, s1]) {
        const { pos, dir } = graph.sample(seg, s);
        for (const strip of stripsAt({ x: pos.x, z: pos.z }, { x: dir.x, z: dir.z }, seg.line.width, index))
          slabs.push([strip.innerRight, strip.innerLeft]);
      }
      const mid = graph.sample(seg, (s0 + s1) / 2);
      for (const [right, left] of minus([-half, half], slabs)) {
        const isTooNarrow = left - right < ISLAND_LEAST_M;
        if (isTooNarrow) continue;
        const centre = mid.pos
          .clone()
          .add(new Vector3(mid.dir.z, 0, -mid.dir.x).multiplyScalar((left + right) / 2));
        if (isByConnector(centre)) continue;
        out.push({ seg: seg.id, s0, s1, right, left });
      }
    }
  }
  return out;
}

/** An interval less some others (each [right, left]). */
function minus(span: [number, number], cuts: ReadonlyArray<[number, number]>): Array<[number, number]> {
  let pieces: Array<[number, number]> = [span];
  for (const [r, l] of cuts) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of pieces) {
      if (l <= a || r >= b) {
        next.push([a, b]);
        continue;
      }
      if (r > a) next.push([a, r]);
      if (l < b) next.push([l, b]);
    }
    pieces = next;
  }
  return pieces;
}

/**
 * The cells as PLATEAU-style pavement polygons (kind "island", lon/lat), less every cell a corner or
 * the centre of which `isPaved` (PLATEAU's own 歩道 or 島 already there: two faces at one height
 * would fight). Why one polygon a cell and not one a run: the PLATEAU test drops single cells, and a
 * run's outline would need its own clipping; neighbouring cells meet edge to edge at one height.
 */
export function islandPolygons(
  graph: RoadGraph,
  cells: readonly IslandCell[],
  frame: LocalFrame,
  isPaved: (x: number, z: number) => boolean,
): PavementPolygon[] {
  const out: PavementPolygon[] = [];
  for (const cell of cells) {
    const seg = graph.segments[cell.seg];
    const corner = (s: number, offset: number) => {
      const { pos, dir } = graph.sample(seg, s);
      return pos.clone().add(new Vector3(dir.z, 0, -dir.x).multiplyScalar(offset));
    };
    const ring = [
      corner(cell.s0, cell.right),
      corner(cell.s1, cell.right),
      corner(cell.s1, cell.left),
      corner(cell.s0, cell.left),
    ];
    const centre = corner((cell.s0 + cell.s1) / 2, (cell.left + cell.right) / 2);
    const isOnPlateau = [...ring, centre].some((p) => isPaved(p.x, p.z));
    if (isOnPlateau) continue;
    out.push({
      kind: "island",
      rings: [
        ring.flatMap((p) => {
          const g = frame.toGeodetic(p);
          return [g.lon, g.lat];
        }),
      ],
    });
  }
  return out;
}

/**
 * Whether a frame point lies inside one of PLATEAU's pavements (outer rings; a box test first): the
 * islands' test for paving already there.
 */
export function plateauContains(
  polys: readonly PavementPolygon[],
  frame: LocalFrame,
): (x: number, z: number) => boolean {
  const rings = polys.map((poly) => {
    const outer = poly.rings[0];
    const pts: P[] = [];
    for (let i = 0; i + 1 < outer.length; i += 2) {
      const v = frame.toLocal(outer[i + 1], outer[i], 0);
      pts.push({ x: v.x, z: v.z });
    }
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    return { pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
  return (x, z) =>
    rings.some(({ pts, box }) => {
      const isInBox = x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];
      return isInBox && insideRing(x, z, pts);
    });
}

function insideRing(x: number, z: number, ring: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

// ---------- chains and their guards (memo 3.4) ----------

/** One end of a chain: the node the band ends at, what the planner's lane shift needs and has. */
export type ChainEnd = {
  at: [number, number];
  /** "fits": the shift ends before the first site; "dead-end": nothing goes straight on. */
  kind: "fits" | "dead-end" | "short";
  /** jump ÷ LANE_SLOPE + BAN_LEAD, and the distance from the node to the first site (m). */
  needM: number;
  haveM: number;
  jumpM: number;
  /** Segments the band was copied onto at this end. */
  extended: number;
  reason?: "one-way" | "not-street" | "no-lane" | "other-chain" | "too-many";
};

/** Most segments a chain's end is extended by before it is given up. */
const EXTEND_MOST = 20;

const dirOf = (seg: Segment): 0 | 1 | -1 => seg.onewayRule?.dir ?? seg.line.oneway;

/** The unit heading of a segment at one of its end nodes, pointing out of the node along it. */
function headingOut(seg: Segment, node: number): Vector3 {
  const atFrom = seg.from === node;
  const a = atFrom ? seg.pts[0] : seg.pts[seg.pts.length - 1];
  const b = atFrom ? seg.pts[1] : seg.pts[seg.pts.length - 2];
  return new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
}

/**
 * The street segment going straight on from `seg` through `node` (navigation's classifyTurn says
 * straight; the least bend among those), or null.
 */
function straightOn(graph: RoadGraph, seg: Segment, node: number): Segment | null {
  const tIn = headingOut(seg, node).negate();
  let best: { seg: Segment; bend: number } | null = null;
  for (const id of graph.nodes.get(node) ?? []) {
    if (id === seg.id) continue;
    const other = graph.segments[id];
    const isStreet = takesBands(other);
    if (!isStreet) continue;
    const tOut = headingOut(other, node);
    const isStraight = classifyTurn(tIn, tOut) === "straight";
    if (!isStraight) continue;
    const bend = Math.acos(Math.max(-1, Math.min(1, tIn.dot(tOut))));
    const isLess = best === null || bend < best.bend;
    if (isLess) best = { seg: other, bend };
  }
  return best?.seg ?? null;
}

const otherEnd = (seg: Segment, node: number) => (seg.from === node ? seg.to : seg.from);

/** A lane's centre, left of travel, in a section (sectionOf's even split). */
function laneAt(section: StreetSection, lane: number): number {
  const edge = section.carriageway / 2 - STREET.shoulder;
  return edge - (lane + 0.5) * section.laneWidth;
}

/**
 * The largest sideways move of a lane across a node from `a`'s section to `b`'s (either way, lanes
 * matched by number, the extra ones onto the last): what the planner eases at LANE_SLOPE.
 */
function laneJump(a: StreetSection, b: StreetSection): number {
  let most = 0;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ])
    for (let k = 0; k < p.lanes; k++)
      most = Math.max(most, Math.abs(laneAt(p, k) - laneAt(q, Math.min(k, q.lanes - 1))));
  return most;
}

/** A segment's section with `bands` judged again in the room it was first judged in. */
function rebanded(seg: Segment, bands: readonly StreetBand[]): StreetSection {
  const section = seg.section ?? resolveSection(seg.line.width, dirOf(seg));
  const dir = dirOf(seg);
  const room = section.bandRoom ?? streetRoom(seg.line.width, dir).room;
  return bandSection(unbandedOf(section), dir, room, bands);
}

const isGiven = (s: StreetSection | undefined) => s?.bandClass === "A" || s?.bandClass === "A'";

/**
 * The banded segments as chains (memo 3.4, after the regulations have resolved them): those given a
 * band (A / A') that go straight on into each other are one chain, judged again with their bands
 * merged (one median through it); each end is then carried on along the street going straight on,
 * a whole segment at a time, until the drive planner's shift (the largest lane jump at the end's
 * node ÷ LANE_SLOPE + BAN_LEAD) ends before the first site. An end with nothing straight on is left
 * as it is (the cars come round a corner into their lane). A chain that does not fit its merged band,
 * or whose end cannot be carried on (a one-way street, no street, no lane, another chain), is given
 * no band at all: its segments go back to their sections without one (B3, R1-2b's), so that no car
 * is left shifting over into a site's walls. Why not shorter steps cut into the segment ahead: the
 * lines would be split again (memo 3.4's Why not), and the length the shift needs is the same.
 */
export function chainStreetBands(
  graph: RoadGraph,
  banded: readonly BandedSegment[],
  frame: LocalFrame,
): {
  diagnostics: BandDiagnostic[];
  ends: ChainEnd[];
  extended: Segment[];
  chainOf: Map<number, { chain: number; extended: number }>;
} {
  const diagnostics: BandDiagnostic[] = [];
  const chainOf = new Map<number, { chain: number; extended: number }>();
  const ends: ChainEnd[] = [];
  const extendedAll: Segment[] = [];
  const given = banded.filter((b) => isGiven(b.seg.section));
  const byId = new Map(given.map((b) => [b.seg.id, b]));
  const taken = new Set<number>();
  const geo = (p: Vector3): [number, number] => {
    const g = frame.toGeodetic(p);
    return [round(g.lat, 1e6), round(g.lon, 1e6)];
  };
  const nodePoint = (seg: Segment, node: number) =>
    seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1];
  let chains = 0;
  for (const start of given) {
    const isTaken = taken.has(start.seg.id);
    if (isTaken) continue;
    // The chain: members joined straight on both ways.
    const members: BandedSegment[] = [];
    const queue = [start];
    taken.add(start.seg.id);
    while (queue.length > 0) {
      const b = queue.pop()!;
      members.push(b);
      for (const node of [b.seg.from, b.seg.to]) {
        const next = straightOn(graph, b.seg, node);
        const member = next ? byId.get(next.id) : undefined;
        const isMutual = member !== undefined && straightOn(graph, member.seg, node) === b.seg;
        if (!isMutual || taken.has(member.seg.id)) continue;
        taken.add(member.seg.id);
        queue.push(member);
      }
    }
    chains++;
    const memberIds = new Set(members.map((m) => m.seg.id));
    const common = mergeBands(members.flatMap((m) => m.seg.bands ?? []));
    const sections = new Map<number, StreetSection>();
    let failed: ChainEnd["reason"] | null = null;
    for (const m of members) {
      const section = rebanded(m.seg, common);
      const fits = isGiven(section);
      if (!fits) failed = "no-lane";
      sections.set(m.seg.id, section);
    }
    // Each end of the chain: a member's node that no member goes straight on through.
    const extensions: Array<{ seg: Segment; section: StreetSection }> = [];
    const chainEnds: ChainEnd[] = [];
    for (const m of members) {
      if (failed) break;
      for (const node0 of [m.seg.from, m.seg.to]) {
        const next0 = straightOn(graph, m.seg, node0);
        const isInner = next0 !== null && memberIds.has(next0.id);
        if (isInner) continue;
        let node = node0;
        let last = m.seg;
        let haveM = node0 === m.seg.from ? m.first : m.seg.length - m.last;
        let extended = 0;
        let end: ChainEnd | null = null;
        for (let hop = 0; hop <= EXTEND_MOST && end === null; hop++) {
          const at = geo(nodePoint(last, node));
          const next = straightOn(graph, last, node);
          if (next === null) {
            end = { at, kind: "dead-end", needM: 0, haveM: round(haveM), jumpM: 0, extended };
            break;
          }
          const lastSection = sections.get(last.id) ?? extensions.find((e) => e.seg === last)!.section;
          const nextSection = next.section ?? resolveSection(next.line.width, dirOf(next));
          const isOneWay = dirOf(last) !== 0 || dirOf(next) !== 0;
          const jumpM = laneJump(lastSection, nextSection);
          const needM = jumpM / LANE_SLOPE + BAN_LEAD;
          const fits = haveM >= needM;
          const base = { at, needM: round(needM), haveM: round(haveM), jumpM: round(jumpM), extended };
          if (fits) {
            end = { ...base, kind: "fits" };
            break;
          }
          const reason: ChainEnd["reason"] | null =
            hop === EXTEND_MOST
              ? "too-many"
              : isOneWay
                ? "one-way"
                : next.bands !== undefined || memberIds.has(next.id)
                  ? "other-chain"
                  : null;
          if (reason) {
            end = { ...base, kind: "short", reason };
            break;
          }
          const copied = rebanded(next, common);
          const holdsLane = isGiven(copied);
          if (!holdsLane) {
            end = { ...base, kind: "short", reason: "no-lane" };
            break;
          }
          extensions.push({ seg: next, section: { ...copied, bandExtended: true } });
          extended++;
          haveM += next.length;
          node = otherEnd(next, node);
          last = next;
        }
        chainEnds.push(end!);
        const isShort = end!.kind === "short";
        if (isShort) failed = end!.reason ?? "no-lane";
      }
    }
    ends.push(...chainEnds);
    if (failed) {
      // No band on the chain: back to the sections without one, its class for R1-2b.
      for (const m of members) {
        const section = m.seg.section!;
        m.seg.section = {
          ...unbandedOf(section),
          bands: m.seg.bands,
          bandClass: "B3",
          bandRoom: section.bandRoom,
        };
        m.seg.lanes = m.seg.section.lanes;
      }
      const short = chainEnds.find((e) => e.kind === "short");
      diagnostics.push({
        event: "street_band_guard_short",
        fields: {
          at: short?.at ?? geo(members[0].seg.pts[0]),
          reason: failed,
          segments: members.length,
          needM: short?.needM ?? 0,
          haveM: short?.haveM ?? 0,
        },
      });
      continue;
    }
    for (const m of members) {
      const section = sections.get(m.seg.id)!;
      m.seg.bands = common;
      m.seg.section = section;
      m.seg.lanes = section.lanes;
    }
    for (const m of members) chainOf.set(m.seg.id, { chain: members.length, extended: extensions.length });
    for (const e of extensions) {
      e.seg.bands = common;
      e.seg.section = e.section;
      e.seg.lanes = e.section.lanes;
      extendedAll.push(e.seg);
    }
  }
  // Nothing to say where no street was banded: the reply stays as it was without sites.
  const hasChains = chains > 0;
  if (hasChains)
    diagnostics.push({
      event: "street_bands_chained",
      fields: {
        chains,
        extended: extendedAll.length,
        extendedM: Math.round(extendedAll.reduce((n, s) => n + s.length, 0)),
        ends: ends.map((e) => ({ ...e })),
      },
    });
  return { diagnostics, ends, extended: extendedAll, chainOf };
}

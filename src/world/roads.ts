import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import type { ClosureKind } from "./closures";
import {
  carriagewayWidth,
  laneCentreOffset,
  resolveSection,
  type CrossSection,
  type StreetSection,
} from "./laneChange";
import { warn } from "../log";
import {
  classOf,
  isExpressway,
  isLevelInconsistent,
  isOnGround,
  levelOf,
  structureOf,
  usesGroundSurface,
  type RoadClass,
  type RoadKind,
  type RoadSource,
  type RoadStructure,
} from "./roadClass";
import { buildLaneLinks, type LaneLink } from "./laneLinks";
import { inForce, type GameClock, type RuleTime } from "./ruleTime";
import type { LogFields } from "../logEvents";

/** A contradiction found in the lines while building the graph (logged, not repaired). */
export type RoadDiagnostic =
  | { event: "road_level_mismatch"; fields: LogFields<"road_level_mismatch"> }
  | { event: "ramp_unattached"; fields: LogFields<"ramp_unattached"> }
  | { event: "street_cut_at_expressway"; fields: LogFields<"street_cut_at_expressway"> };

/**
 * A road centreline from a vector source, in lon/lat. The fields after `bridge` are optional so
 * that a GSI line (and every test that writes one) means what it always did: absent, they read as
 * source "gsi", the class from `kind`, on the ground at level 0, with no section of its own (the
 * accessors are in roadClass.ts and laneChange.ts). The expressway chunks (P3) set them.
 */
export type RoadLine = {
  coords: number[]; // [lon0, lat0, lon1, lat1, …]
  width: number; // GSI 幅員 (m), 道路縁 to 道路縁 (may include the pavement); the 車道 is carriagewayWidth
  oneway: 0 | 1 | -1; // 1: along coords, -1: against, 0: both ways
  /** 行政区分 from GSI (rdCtg); what the road is for is `cls`. */
  kind: RoadKind;
  /** 橋 (GSI ftCode 2703 at ground level): where the street crosses water it is on a deck. */
  bridge?: boolean;
  /** GSI ftCode 2704 (トンネル内の道路) at ground level: drawn on the ground like any street (P2.7-6 PR 7b). */
  tunnel?: boolean;
  source?: RoadSource;
  cls?: RoadClass;
  structure?: RoadStructure;
  /**
   * 0 on the ground; decks above count up. Part of the junction key where a point has no id, so
   * lines crossing on different levels do not join.
   */
  level?: number;
  /**
   * Id of the node at each point (OSM node id), or "" where it has none. Where both ends of a
   * junction have one, the ids join lines, whatever their level: a ramp joins the deck at one end
   * and the street at the other. Split along with `coords` by splitAtJunctions.
   */
  nodeIds?: string[];
  /** The cross-section, where the source gives one: then it is what lanes and lane widths read. */
  section?: CrossSection;
  /** Stable id of an expressway chunk (`<run>:<k>`, src/expressway), the same in every rebuild. */
  xid?: string;
  /** 路線記号 (OSM ref, e.g. C1). */
  ref?: string;
  /** An expressway ramp's own name (OSM name, 「芝公園出口」), never the operator's (network.ts). */
  name?: string;
  /** OSM maxspeed (km/h): the posted limit where JARTIC does not apply (Segment.limit). */
  limit?: number;
  /**
   * WGS84 ellipsoidal height (m) of the road surface at each point, where the road is not on the
   * terrain (the expressway's chunks). The graph turns it into Segment.elev in its own frame, the
   * same way the deck places its rings (frame.toLocal at that height), so a line built once serves
   * every origin. Split along with `coords`.
   */
  heights?: number[];
};

export type Segment = {
  id: number;
  line: RoadLine;
  pts: Vector3[]; // local frame, y = 0 (heights come from the terrain)
  cum: number[]; // cumulative length at each point
  length: number;
  from: number; // node ids
  to: number;
  /** One-way in force now (see RoadGraph.setClock): 1 along coords, −1 against, 0 both. */
  oneway: 0 | 1 | -1;
  /** JARTIC 一方通行 matched onto this segment, with when it applies. */
  onewayRule: { dir: 1 | -1; time: RuleTime } | null;
  /** 規制速度 from JARTIC (km/h), or null when only the statutory limit applies. */
  limit: number | null;
  limitKind: "sign" | "zone" | "statutory";
  /** 追越しのための右側部分はみ出し通行禁止 (JARTIC): yellow centre line. */
  noOvertake: boolean;
  /** 進路変更禁止 (JARTIC): yellow lane lines. */
  noLaneChange: boolean;
  /** Lanes per direction (the street's section: JARTIC, OSM or the width; laneChange.ts). */
  lanes: number;
  /**
   * A street's cross-section both ways and its 車道 width (resolveSection), from the width when the
   * graph is built and from JARTIC and OSM once the regulations apply. Absent on a line with its own
   * section (the expressway) and on segments written by hand (streetSection derives one).
   */
  section?: StreetSection;
  /** JARTIC sections on this segment: 115 駐車禁止, 65 駐停車禁止, 51 転回禁止, 61 徐行. */
  rules: Array<{ code: number; time: RuleTime }>;
  /** JARTIC 通行禁止 (車両通行止め, 歩行者用道路 …) on this segment, and whether one applies now. */
  closures: Array<{ kind: ClosureKind; time: RuleTime }>;
  closed: boolean;
  /**
   * Road surface height (local y) at each point, where the road is not on the terrain (expressway
   * decks, P3). Absent on the ground. `pts` keep y = 0: XZ distances are measured everywhere.
   */
  elev?: number[];
};

/** Carriageway below which no 車道中央線 is painted (命令 別表第三): the car drives the middle. */
const CENTRE_LINE_FROM = 5.5;

/**
 * Centre of the left-hand half of a two-way street, from the centreline: keeping left (第18条)
 * inside the edge line. 0 on a one-way street, and on a street too narrow for a centre line, where
 * cars keep to the middle as before P8. Why not keep left there too: it is not what P8 set out to
 * change, and on a 4.3 m street it put 50 more turn curves over the un-rounded kerb corners (review
 * W4). The carriageway is the section's, so no inset from the kerb is needed on top.
 */
export function laneOffset(seg: Segment | undefined): number {
  if (!seg || seg.oneway !== 0) return 0;
  const hasCentreLine = carriagewayWidth(seg) >= CENTRE_LINE_FROM;
  if (!hasCentreLine) return 0;
  return Math.max(0, laneCentreOffset(seg, 0, 1));
}

/** Speed limit in force on a segment: posted (JARTIC) when known, statutory otherwise. */
export function speedLimit(seg: Segment): number {
  return seg.limit ?? estimatedLimit(seg.line);
}

/**
 * Speed limit without 規制速度 data: the statutory limit (施行令 第11条, amended 2026-09-01) is
 * 60 km/h only on roads with a centre line / lanes / divided carriageway and 30 km/h on other
 * ordinary roads. GSI data has no centre-line flag, so ≥5.5 m carriageways stand in for it.
 */
export function estimatedLimit(line: RoadLine): number {
  // The 都市高速 is a 自動車専用道路, not a 高速自動車国道 (100 km/h, 施行令 第27条), so the ordinary 60 km/h
  // applies wherever no limit is posted.
  if (isExpressway(line)) return 60;
  return line.width >= 5.5 ? 60 : 30;
}

/**
 * Road network around the player, rebuilt per area. Nodes join segment ends that share a point
 * (rounded to ~10 cm), giving intersections for AI routing and the traffic-law checks.
 */
const CELL = 32;
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

export type RoadGraphSnapshot = {
  segments: Array<Omit<Segment, "pts"> & { pts: Array<[number, number, number]> }>;
  nodes: Map<number, number[]>;
  pieces: Map<string, Array<[number, number]>> | null;
  /** Present only where the expressway is in the graph: a street-only reply stays as it was. */
  laneLinks?: LaneLink[];
};

/** Height of the terrain the streets are drawn on at (x, z), or null where it has not loaded. */
export type GroundHeight = (x: number, z: number) => number | null;

/** Vertical gate of nearestOnSurface: farther above or below a road surface is another level. */
export const SURFACE_GATE = 2.5;
/**
 * How far beyond its carriageway's edge a point still counts as on a deck: the parapet (0.5 m) and
 * a little more. A deck cannot be reached sideways, so a road 30 m off at the same height is not
 * the one a car is on.
 */
export const DECK_REACH = 1;

export class RoadGraph {
  readonly segments: Segment[] = [];
  /**
   * Terrain height for surfaceY on ground roads. Not part of the snapshot (a function does not
   * survive the structured clone); the game binds it to the terrain after restoring (main.ts).
   * Unknown (null) until then, never a made-up 0: see nearestOnSurface.
   */
  ground: GroundHeight = () => null;
  /**
   * How many nearestOnSurface answers fell back to a ground road whose terrain was not loaded
   * (no height to gate by). The game logs it with the network (road_network_built).
   */
  unknownGroundHits = 0;
  readonly nodes = new Map<number, number[]>(); // node id → segment ids
  /** 車線単位の接続 at the expressway's nodes (laneLinks.ts): empty on the streets. */
  laneLinks: LaneLink[] = [];
  private readonly nodeIds = new Map<string, number>();
  /** Polyline pieces [segment id, point index] by 32 m cell, for carriageway tests. */
  private pieces: Map<string, Array<[number, number]>> | null = null;

  snapshot(): RoadGraphSnapshot {
    return {
      segments: this.segments.map((seg) => ({ ...seg, pts: seg.pts.map((p) => [p.x, p.y, p.z]) })),
      nodes: this.nodes,
      pieces: this.pieces,
      ...(this.laneLinks.length > 0 ? { laneLinks: this.laneLinks } : {}),
    };
  }

  /** Structured clone drops Vector3 and RoadGraph methods; keep the computed spatial index. */
  static restore(data: RoadGraphSnapshot, frame: LocalFrame): RoadGraph {
    const graph = new RoadGraph([], frame);
    for (const seg of data.segments)
      graph.segments.push({ ...seg, pts: seg.pts.map((p) => new Vector3(...p)) });
    for (const [node, ids] of data.nodes) graph.nodes.set(node, ids);
    graph.pieces = data.pieces;
    graph.laneLinks = data.laneLinks ?? [];
    return graph;
  }

  constructor(
    lines: RoadLine[],
    frame: LocalFrame,
    /** Where a contradiction in the lines goes: the log, or the worker's diagnostics (to the page). */
    report: (diagnostic: RoadDiagnostic) => void = ({ event, fields }) => warn(event, fields),
  ) {
    const inconsistent = lines.filter(isLevelInconsistent);
    const hasInconsistent = inconsistent.length > 0;
    if (hasInconsistent) {
      const examples = inconsistent
        .slice(0, 3)
        .map((l) => ({ level: levelOf(l), structure: structureOf(l), xid: l.xid ?? null }));
      report({ event: "road_level_mismatch", fields: { count: inconsistent.length, examples } });
    }
    for (const line of splitAtJunctions(lines)) {
      const pts: Vector3[] = [];
      for (let i = 0; i < line.coords.length; i += 2) {
        const v = frame.toLocal(line.coords[i + 1], line.coords[i], frame.origin.h);
        v.y = 0;
        pts.push(v);
      }
      if (pts.length < 2) continue;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const length = cum[cum.length - 1];
      if (length < 1) continue;
      const id = this.segments.length;
      // Only lines with heights get the key: GSI segments stay as they were in the snapshot.
      const heights = line.heights;
      const elev = heights
        ? heights.map((h, k) => frame.toLocal(line.coords[k * 2 + 1], line.coords[k * 2], h).y)
        : null;
      // A street's lanes from its width until the regulations say more (applyRegulations).
      const section = line.section ? undefined : resolveSection(line.width, line.oneway);
      const from = this.node(pointKey(line, 0));
      const to = this.node(pointKey(line, line.coords.length / 2 - 1));
      this.segments.push({
        id,
        line,
        pts,
        cum,
        length,
        from,
        to,
        oneway: line.oneway,
        onewayRule: null,
        // Where the source posts a limit (OSM maxspeed) or a section, those stand until JARTIC
        // (which only matches streets) says otherwise; GSI lines have neither.
        limit: line.limit ?? null,
        limitKind: line.limit === undefined ? "statutory" : "sign",
        noOvertake: false,
        noLaneChange: false,
        lanes: line.section?.lanes ?? section?.lanes ?? 1,
        ...(section ? { section } : {}),
        rules: [],
        closures: [],
        closed: false,
        ...(elev ? { elev } : {}),
      });
      this.link(from, id);
      this.link(to, id);
    }
    const hasExpressway = this.segments.some((seg) => seg.line.xid !== undefined);
    if (hasExpressway) this.laneLinks = buildLaneLinks(this);
  }

  /**
   * Surface streets whose carriageway (half width + `margin`) covers p, except `except`, with the
   * street direction there. Used to keep signs and lane markings out of other roads and junctions.
   * Ground streets only (usesGroundSurface): a viaduct overhead does not cover the street below.
   */
  carriagewaysAt(p: Vector3, margin = 0, except?: Segment): Array<{ seg: Segment; dir: Vector3 }> {
    const cells = this.pieceIndex();
    const best = new Map<number, { d: number; i: number }>();
    for (const [segId, i] of cells.get(cellKey(p.x, p.z)) ?? []) {
      const seg = this.segments[segId];
      if (seg === except) continue;
      const a = seg.pts[i - 1];
      const b = seg.pts[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
      const d = Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
      const prev = best.get(segId);
      if (!prev || d < prev.d) best.set(segId, { d, i });
    }
    const out: Array<{ seg: Segment; dir: Vector3 }> = [];
    for (const [segId, { d, i }] of best) {
      const seg = this.segments[segId];
      if (d >= seg.line.width / 2 + margin) continue;
      out.push({
        seg,
        dir: seg.pts[i]
          .clone()
          .sub(seg.pts[i - 1])
          .setY(0)
          .normalize(),
      });
    }
    return out;
  }

  private pieceIndex(): Map<string, Array<[number, number]>> {
    if (this.pieces) return this.pieces;
    const cells = new Map<string, Array<[number, number]>>();
    for (const seg of this.segments) {
      if (!usesGroundSurface(seg.line)) continue;
      const reach = seg.line.width / 2 + 3; // widest margin a caller asks for
      for (let i = 1; i < seg.pts.length; i++) {
        const a = seg.pts[i - 1];
        const b = seg.pts[i];
        const x0 = Math.floor((Math.min(a.x, b.x) - reach) / CELL);
        const x1 = Math.floor((Math.max(a.x, b.x) + reach) / CELL);
        const z0 = Math.floor((Math.min(a.z, b.z) - reach) / CELL);
        const z1 = Math.floor((Math.max(a.z, b.z) + reach) / CELL);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            const key = `${cx},${cz}`;
            const list = cells.get(key) ?? [];
            list.push([seg.id, i]);
            cells.set(key, list);
          }
        }
      }
    }
    this.pieces = cells;
    return cells;
  }

  /** Point and unit direction at distance s along a segment (local frame, y = 0). */
  sample(seg: Segment, s: number, pos = new Vector3(), dir = new Vector3()): { pos: Vector3; dir: Vector3 } {
    const d = Math.min(Math.max(s, 0), seg.length);
    let i = 1;
    while (i < seg.cum.length - 1 && seg.cum[i] < d) i++;
    const a = seg.pts[i - 1];
    const b = seg.pts[i];
    const t = (d - seg.cum[i - 1]) / Math.max(1e-6, seg.cum[i] - seg.cum[i - 1]);
    pos.copy(a).lerp(b, t);
    dir.copy(b).sub(a).normalize();
    return { pos, dir };
  }

  /**
   * Nearest road to a point: returns the segment, the along-distance, and the signed lateral
   * offset (positive = left of the segment's coordinate direction). In 2D and on the ground
   * (level 0) only, so a deck overhead never answers for the street below; a caller that knows
   * the height uses nearestOnSurface.
   */
  nearest(p: Vector3, maxDist: number, accept: (seg: Segment) => boolean = () => true): RoadHit | null {
    return this.nearestWhere(p, maxDist, (seg) => isOnGround(seg.line) && accept(seg));
  }

  /**
   * Nearest road whose surface is within SURFACE_GATE of p.y, on any level: the deck a car is on,
   * not the street under it (nor, for a car on the street, the deck over it). The gate is taken
   * at each segment's horizontally nearest point, and the nearest segment that passes wins. A deck
   * (off the ground) also has to be under p: within its carriageway and DECK_REACH.
   *
   * Of several decks under p (at a 分合流 the ramp's deck lies on the main line's for tens of
   * metres), the main line wins, then the higher posted limit, then the nearer centreline
   * (deckRank). Why not the nearest centreline: a car in the main line's left lane is nearer the
   * ramp's centre there, and was booked at the ramp's 40 km/h for 3 s at 60 (review of P3).
   *
   * Where the terrain under a ground road has not loaded, its height is unknown: such a road is
   * the answer only when no road of known height passes, and the fallback is counted
   * (unknownGroundHits). Why not skip it: a car on a street whose DEM tile is late would find no
   * road at all, and the speed and lane checks would stop without a word.
   */
  nearestOnSurface(
    p: Vector3,
    maxDist: number,
    accept: (seg: Segment) => boolean = () => true,
  ): RoadHit | null {
    let ground: RoadHit | null = null;
    let groundD = maxDist;
    let deck: { hit: RoadHit; rank: number } | null = null;
    let deckD = maxDist;
    let blind: RoadHit | null = null;
    let blindD = maxDist;
    const hitAt = (seg: Segment, on: { s: number; lateral: number }): RoadHit => ({
      seg,
      s: on.s,
      lateral: on.lateral,
      dir: this.sample(seg, on.s).dir,
    });
    for (const seg of this.segments) {
      if (!accept(seg)) continue;
      const on = this.nearestOn(seg, p);
      const isOutOfRange = on.dist >= maxDist;
      if (isOutOfRange) continue;
      const isDeck = !isOnGround(seg.line);
      // A deck's `width` is its carriageway between the parapets (expresswayRoads: sectionWidth).
      // Why not carriagewayWidth: a deck line without a section would be resolved as a street,
      // lanes from the width, and come out narrower than the deck a car is on.
      const isBesideDeck = isDeck && on.dist > seg.line.width / 2 + DECK_REACH;
      if (isBesideDeck) continue;
      const y = this.surfaceY(seg, on.s);
      const isUnknown = y === null;
      if (isUnknown) {
        const isNearerBlind = on.dist < blindD;
        if (!isNearerBlind) continue;
        blindD = on.dist;
        blind = hitAt(seg, on);
        continue;
      }
      const isOtherLevel = Math.abs(p.y - y) > SURFACE_GATE;
      if (isOtherLevel) continue;
      if (isDeck) {
        deckD = Math.min(deckD, on.dist);
        const rank = deckRank(seg, on.dist);
        const isBetterDeck = deck === null || rank > deck.rank;
        if (isBetterDeck) deck = { hit: hitAt(seg, on), rank };
        continue;
      }
      const isNearerGround = on.dist < groundD;
      if (!isNearerGround) continue;
      groundD = on.dist;
      ground = hitAt(seg, on);
    }
    // A deck under p beats a street only when it is nearer (both pass the gate near a ground end).
    const isOnDeck = deck !== null && deckD <= groundD;
    if (isOnDeck) return deck!.hit;
    if (ground || !blind) return ground;
    this.unknownGroundHits++;
    return blind;
  }

  /**
   * The road a point is on, for the callers that used `nearest` (the car's own checks, the
   * autopilot's start, the spawn): the deck under p when p is up on one (nearestOnSurface over the
   * roads off the ground), otherwise exactly what `nearest` answers. Why not nearestOnSurface for
   * everything: on the ground this keeps the old search (and its ties) to the bit, which the
   * invariance tests hold the streets to.
   */
  locate(p: Vector3, maxDist: number, accept: (seg: Segment) => boolean = () => true): RoadHit | null {
    const deck = this.nearestOnSurface(p, maxDist, (seg) => !isOnGround(seg.line) && accept(seg));
    return deck ?? this.nearest(p, maxDist, accept);
  }

  /**
   * Road surface height (local y) `s` metres along a segment: the deck's own heights where it has
   * them (Segment.elev, linear between points), otherwise the terrain under the centreline, or
   * null where the terrain has not loaded.
   *
   * On an expressway deck this is the collider's face within 1 cm (T11), except on a ramp cut at
   * the main line's edge (expresswayMerge.ts, P3.5): while the ramp's centre lies on the main line's
   * face or within MERGE_RAMP (1 m) of the seam, a car there rides the main line's face, which can
   * differ from the ramp's own height by up to MERGE_MAX_DZ (0.15 m; the compiler aims at ≤ 5 cm).
   */
  surfaceY(seg: Segment, s: number): number | null {
    const elev = seg.elev;
    if (!elev) {
      const { pos } = this.sample(seg, s);
      return this.ground(pos.x, pos.z);
    }
    const d = Math.min(Math.max(s, 0), seg.length);
    let i = 1;
    while (i < seg.cum.length - 1 && seg.cum[i] < d) i++;
    const t = (d - seg.cum[i - 1]) / Math.max(1e-6, seg.cum[i] - seg.cum[i - 1]);
    return elev[i - 1] + (elev[i] - elev[i - 1]) * t;
  }

  private nearestWhere(p: Vector3, maxDist: number, accept: (seg: Segment) => boolean): RoadHit | null {
    let best: RoadHit | null = null;
    let bestD = maxDist;
    const ab = new Vector3();
    const ap = new Vector3();
    for (const seg of this.segments) {
      if (!accept(seg)) continue;
      for (let i = 1; i < seg.pts.length; i++) {
        const a = seg.pts[i - 1];
        ab.copy(seg.pts[i]).sub(a);
        const len2 = ab.x * ab.x + ab.z * ab.z;
        if (len2 < 1e-6) continue;
        ap.set(p.x - a.x, 0, p.z - a.z);
        const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.z * ab.z) / len2));
        const cx = a.x + ab.x * t - p.x;
        const cz = a.z + ab.z * t - p.z;
        const d = Math.hypot(cx, cz);
        if (d >= bestD) continue;
        bestD = d;
        const len = Math.sqrt(len2);
        const dir = new Vector3(ab.x / len, 0, ab.z / len);
        // Left of travel direction d=(dx,dz) is (dz, -dx) in this frame (x east, z south).
        const lateral = (ap.x * dir.z - ap.z * dir.x) * 1;
        best = { seg, s: seg.cum[i - 1] + len * t, lateral, dir };
      }
    }
    return best;
  }

  /** Apply one-way rules and closures for a moment (time of day, day of week, 祝日). */
  setClock(clock: GameClock): void {
    for (const seg of this.segments) {
      const r = seg.onewayRule;
      seg.oneway = r && inForce(r.time, clock) ? r.dir : seg.line.oneway;
      seg.closed = seg.closures.some((c) => inForce(c.time, clock));
    }
  }

  /**
   * Projection of a point onto one segment: along-distance and signed lateral (left = +). The
   * caller names the segment, so there is no level to choose: it projects in 2D on any level.
   */
  nearestOn(seg: Segment, p: Vector3): { s: number; lateral: number; dist: number } {
    let best = { s: 0, lateral: 0, dist: Infinity };
    for (let i = 1; i < seg.pts.length; i++) {
      const a = seg.pts[i - 1];
      const ex = seg.pts[i].x - a.x;
      const ez = seg.pts[i].z - a.z;
      const len = Math.hypot(ex, ez);
      if (len < 1e-6) continue;
      const dx = ex / len;
      const dz = ez / len;
      const t = Math.min(len, Math.max(0, (p.x - a.x) * dx + (p.z - a.z) * dz));
      const dist = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
      if (dist < best.dist)
        best = { s: seg.cum[i - 1] + t, lateral: (p.x - a.x) * dz - (p.z - a.z) * dx, dist };
    }
    return best;
  }

  /** Segments leaving a node, excluding the one we came from (unless it is a dead end). */
  exits(node: number, cameFrom: number): Segment[] {
    const ids = (this.nodes.get(node) ?? []).filter((id) => id !== cameFrom);
    const list = (ids.length ? ids : (this.nodes.get(node) ?? [])).map((id) => this.segments[id]);
    // Respect one-way roads: only enter in the allowed direction.
    return list.filter((seg) => {
      const forward = seg.from === node;
      return seg.oneway === 0 || (seg.oneway === 1) === forward;
    });
  }

  private node(key: string): number {
    let id = this.nodeIds.get(key);
    if (id === undefined) {
      id = this.nodeIds.size;
      this.nodeIds.set(key, id);
    }
    return id;
  }

  private link(node: number, seg: number): void {
    const list = this.nodes.get(node);
    if (list) list.push(seg);
    else this.nodes.set(node, [seg]);
  }
}

/**
 * Order of the decks a point is on: a main line over a ramp, then the higher posted limit, then the
 * nearer centreline (the distance only breaks ties: it is below 100 m by the width gate).
 */
function deckRank(seg: Segment, dist: number): number {
  const isMainLine = classOf(seg.line) === "expressway";
  return (isMainLine ? 1e6 : 0) + speedLimit(seg) * 1e3 - dist;
}

/** Nearest-road answer: segment, along-distance, signed lateral (left +) and direction there. */
export type RoadHit = { seg: Segment; s: number; lateral: number; dir: Vector3 };

// ~1 m: joins lines clipped at vector-tile edges whose quantised end points differ slightly.
export function vertexKey(lon: number, lat: number): string {
  return `${Math.round(lon * 1e5)}/${Math.round(lat * 1e5)}`;
}

/**
 * Junction key of point `i` of a line: its node id where it has one (OSM), which joins lines
 * across levels (a ramp's two ends); otherwise the rounded point and the level, so a deck passing
 * over a street corner is not a junction with it. Ground keys without ids are the plain vertex
 * key, as before levels.
 */
function pointKey(line: RoadLine, i: number): string {
  const id = line.nodeIds?.[i];
  if (id) return `id:${id}`;
  const key = vertexKey(line.coords[i * 2], line.coords[i * 2 + 1]);
  const level = levelOf(line);
  return level === 0 ? key : `${key}@${level}`;
}

/**
 * Vector roads are not split where a street meets the middle of another, so a T-junction would
 * look like a dead end. Split every line at interior vertices shared with any other line.
 */
export function splitAtJunctions(lines: RoadLine[]): RoadLine[] {
  const uses = new Map<string, number>();
  for (const line of lines) {
    const seen = new Set<string>();
    for (let i = 0; i < line.coords.length / 2; i++) {
      const key = pointKey(line, i);
      if (seen.has(key)) continue;
      seen.add(key);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const out: RoadLine[] = [];
  for (const line of lines) {
    let start = 0;
    const n = line.coords.length / 2;
    const piece = (a: number, b: number): RoadLine => {
      const coords = line.coords.slice(a * 2, b * 2 + 2);
      // Copy nodeIds and heights only where the line has them: an absent key keeps GSI lines as
      // they were.
      const out: RoadLine = { ...line, coords };
      if (line.nodeIds) out.nodeIds = line.nodeIds.slice(a, b + 1);
      if (line.heights) out.heights = line.heights.slice(a, b + 1);
      return out;
    };
    for (let i = 1; i < n - 1; i++) {
      const isJunction = (uses.get(pointKey(line, i)) ?? 0) > 1;
      if (!isJunction) continue;
      out.push(piece(start, i));
      start = i;
    }
    out.push(piece(start, n - 1));
  }
  return out;
}

/** Offset to the left (Japan drives on the left) of a direction, in metres. */
export function leftOf(dir: Vector3, metres: number, target = new Vector3()): Vector3 {
  return target.set(dir.z * metres, 0, -dir.x * metres);
}

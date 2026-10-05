import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX } from "../geo/tiles";
import { warn } from "../log";
import { anchors, M_LAT, M_LON, reversed } from "./anchors";
import { leftOf, type RoadGraph, type Segment } from "./roads";
import { CLOSURE, MAX_CLOSURE_AREA_KM2, ringAreaKm2, type ClosureKind } from "./closures";
import { inForce, readTime, timeNote, type GameClock, type RuleTime } from "./ruleTime";

/**
 * Traffic regulations for the area around the player, as tiled by scripts/regulations.ts:
 * JARTIC 交通規制情報 (one-way, 規制速度, 横断歩道, 停止線, 一時停止, sign posts, lane and
 * overtaking rules) and OpenStreetMap traffic signals. All coordinates are lon/lat; `applyRegulations` maps them onto a RoadGraph.
 */
export type RegulationData = {
  speed: number[][]; // [limit, lon0, lat0, …]
  speedZone: number[][]; // [limit, ring…]
  oneway: number[][]; // [TIME…, …coords in permitted travel order] (TIME: ruleTime.ts)
  crosswalk: number[][]; // [lon1, lat1, lon2, lat2] kerb to kerb
  stopLine: number[][]; // [lon, lat]
  stopSign: number[][]; // [lon, lat]
  sections: number[][]; // [code, bothWays, TIME…, …coords]: 115 駐車禁止, 65 駐停車禁止, 51 転回禁止, 61 徐行
  turns: number[][]; // 指定方向外進行禁止: [centreLon, centreLat, entryLon, entryLat, mask, TIME…]
  closures: number[][]; // 通行禁止: [shape (2 line, 3 area), kind (CLOSURE), TIME…, …coords]
  noOvertake: number[][]; // はみ出し禁止 sections: coords
  lanes: number[][]; // 車両通行帯: [lanes or 0, …coords]
  noLaneChange: number[][]; // 進路変更禁止 sections: coords
  laneArrows: number[][]; // 進行方向別通行区分 approaches: [lanes or 0, …coords]
  signals: number[][]; // [lon, lat]
  /** OSM: 交差点名 on signal nodes, [lon, lat, name, English name or ""]. */
  junctions: Array<[number, number, string, string]>;
  /** OSM: pedestrian bridge decks, [width or 0, deck coords, [stair coords from the deck down]…]. */
  footbridges: Array<[number, number[], number[][]]>;
  /** OSM: turn:lanes at junction approaches, [lon, lat, bearing°, "left;through|through|right"]. */
  turnlanes: Array<[number, number, number, string]>;
};

/** A direction a lane may take at the junction (OSM turn:lanes vocabulary). */
export type LaneDirection = "left" | "slight_left" | "through" | "slight_right" | "right" | "reverse";
const LANE_DIRECTIONS = new Set<string>([
  "left",
  "slight_left",
  "through",
  "slight_right",
  "right",
  "reverse",
]);

/**
 * 進行方向別通行区分 (道路交通法 第35条第1項) at a junction approach: the directions allowed from
 * each lane, left lane first. From OSM turn:lanes where mapped; otherwise, where JARTIC lists the
 * regulation, the usual Tokyo pattern for the lane count (左折・直進 | 直進 … | 右折).
 */
export type LaneUse = {
  seg: Segment;
  dir: 1 | -1;
  node: number;
  lanes: LaneDirection[][];
  source: "osm" | "assumed";
};

/** Sign types (the game maps them to 道路標識 artwork). */
export const SIGN = {
  speed: 1,
  oneway: 2,
  noEntry: 3,
  noParking: 4,
  noStopping: 5,
  noUturn: 6,
  slow: 7,
  turn: 8,
  crosswalk: 9, // 横断歩道 (407-A), placed at runtime at crossings without signals
  stop: 10, // 一時停止 (330-A), placed at runtime at 一時停止 approaches
  closed: 11, // 車両通行止め (302), at the entrances of streets under 通行禁止
  pedestrianRoad: 12, // 歩行者等専用 (325の4: 歩行者用道路), mostly with school-run hours
  roadClosed: 13, // 通行止め (301)
  motorClosed: 14, // 自動車 (incl. 二輪) 通行止め (310 with 補助)
  noPedestrianCrossing: 15, // 歩行者等横断禁止 (332)
  noOvertakeRight: 16, // 追越しのための右側部分はみ出し通行禁止 (314)
  noOvertake: 17, // 追越し禁止 (314の2)
  noVehicleCrossing: 18, // 車両横断禁止 (312)
  horn: 19, // 警笛鳴らせ (328)
  bikeOnPavement: 20, // 普通自転車等及び歩行者等専用 (325の3: 普通自転車歩道通行可)
  parkingAllowed: 21, // 駐車可 (403)
  timedParking: 22, // 時間制限駐車区間 (318)
  busLane: 23, // 専用通行帯 (327の4)
  bikeLane: 24, // 普通自転車専用通行帯 (327の4の2)
  busPriority: 25, // 路線バス等優先通行帯 (327の5)
  vehicleClass: 26, // 車両通行区分 (327)
  laneArrows: 27, // 進行方向別通行区分 (327の7), the lanes in PlacedSign.lanes
  hydrant: 28, // 消火栓 (法定外: the red disc at hydrants)
  school: 29, // 学校、幼稚園、保育所等あり (208)
  schoolRoute: 30, // 通学路 (法定外 plate, under 歩行者専用 in school hours)
} as const;

const REG_ZOOM = 14;
const ROAD_ZOOM = 16; // RoadTiles covers the 3×3 z16 tiles around the player

const empty = (): RegulationData => ({
  speed: [],
  speedZone: [],
  oneway: [],
  crosswalk: [],
  stopLine: [],
  stopSign: [],
  sections: [],
  turns: [],
  closures: [],
  noOvertake: [],
  lanes: [],
  noLaneChange: [],
  laneArrows: [],
  signals: [],
  junctions: [],
  footbridges: [],
  turnlanes: [],
});

export type RegulationMeta = { targetMonth: string; releaseDay: string; fetchedAt: string; url: string };

export class RegulationTiles {
  private readonly base = `${import.meta.env.BASE_URL}data/`;
  private readonly index = new Map<string, Promise<Set<string>>>();
  private readonly cache = new Map<string, Promise<unknown>>();

  /** Regulations on the z14 tiles that overlap the road area around a point, de-duplicated. */
  async around(lat: number, lon: number): Promise<RegulationData> {
    const shift = 2 ** (ROAD_ZOOM - REG_ZOOM);
    const cx = Math.floor(lonToTileX(lon, ROAD_ZOOM));
    const cy = Math.floor(latToTileY(lat, ROAD_ZOOM));
    const keys = new Set<string>();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        keys.add(`${Math.floor((cx + dx) / shift)}-${Math.floor((cy + dy) / shift)}`);
    const osmDirs = ["signals", "junctions", "footbridges", "turnlanes"] as const;
    const [regIndex, ...osmIndex] = await Promise.all([
      this.tileIndex("regs"),
      ...osmDirs.map((d) => this.tileIndex(d)),
    ]);
    const out = empty();
    const seen = new Map<unknown[], Set<string>>();
    const add = (list: unknown[], items: unknown[]) => {
      const listed = seen.get(list) ?? new Set<string>();
      seen.set(list, listed);
      for (const item of items) {
        // Lines crossing a tile edge are stored in every tile they touch.
        const key = JSON.stringify(item);
        if (listed.has(key)) continue;
        listed.add(key);
        list.push(item);
      }
    };
    await Promise.all(
      [...keys].map(async (key) => {
        if (regIndex.has(key)) {
          const t = (await this.json(`regs/${key}.json`)) as Omit<
            RegulationData,
            "signals" | "junctions" | "footbridges" | "turnlanes"
          > | null;
          if (t) for (const k of Object.keys(t) as (keyof typeof t)[]) add(out[k], t[k]);
        }
        await Promise.all(
          osmDirs.map(async (dir, i) => {
            if (!osmIndex[i].has(key)) return;
            const items = (await this.json(`${dir}/${key}.json`)) as unknown[] | null;
            if (items) add(out[dir], items);
          }),
        );
      }),
    );
    return out;
  }

  /** JARTIC edition and download date, for the credit line the licence asks for. */
  async meta(): Promise<RegulationMeta | null> {
    return (await this.json("regs/meta.json")) as RegulationMeta | null;
  }

  private tileIndex(dir: string): Promise<Set<string>> {
    let p = this.index.get(dir);
    if (!p) {
      p = this.json(`${dir}/meta.json`).then((m) => new Set((m as { tiles?: string[] } | null)?.tiles ?? []));
      this.index.set(dir, p);
    }
    return p;
  }

  private json(path: string): Promise<unknown> {
    let p = this.cache.get(path);
    if (!p) {
      p = fetch(this.base + path)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<unknown>;
        })
        .catch((error: unknown) => {
          warn("regulation_tile_failed", { path, error: String(error) });
          this.cache.delete(path);
          return null;
        });
      this.cache.set(path, p);
    }
    return p;
  }
}

// ---------- matching onto the road graph ----------

type Piece<T> = { owner: T; ax: number; az: number; bx: number; bz: number };
type Hit<T> = { owner: T; dist: number; t: number; dx: number; dz: number; lateral: number };

/** Uniform grid over polyline pieces (local frame, metres) for nearest-line queries. */
export class LineGrid<T> {
  private readonly cells = new Map<string, Piece<T>[]>();

  constructor(private readonly size = 25) {}

  add(owner: T, pts: Vector3[]): void {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const piece: Piece<T> = { owner, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      const x0 = Math.floor(Math.min(a.x, b.x) / this.size);
      const x1 = Math.floor(Math.max(a.x, b.x) / this.size);
      const z0 = Math.floor(Math.min(a.z, b.z) / this.size);
      const z1 = Math.floor(Math.max(a.z, b.z) / this.size);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`;
          const list = this.cells.get(key);
          if (list) list.push(piece);
          else this.cells.set(key, [piece]);
        }
    }
  }

  /**
   * Nearest piece within maxDist (≤ grid size) whose direction passes `accept`. `lateral` is
   * positive when the point lies left of the piece's direction (x east, z south).
   */
  nearest(
    x: number,
    z: number,
    maxDist: number,
    accept?: (dx: number, dz: number) => boolean,
  ): Hit<T> | null {
    let best: Hit<T> | null = null;
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    const seen = new Set<Piece<T>>();
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (const p of this.cells.get(`${gx},${gz}`) ?? []) {
          if (seen.has(p)) continue;
          seen.add(p);
          const ex = p.bx - p.ax;
          const ez = p.bz - p.az;
          const len = Math.hypot(ex, ez);
          if (len < 1e-3) continue;
          const dx = ex / len;
          const dz = ez / len;
          if (accept && !accept(dx, dz)) continue;
          const t = Math.min(len, Math.max(0, (x - p.ax) * dx + (z - p.az) * dz));
          const dist = Math.hypot(p.ax + dx * t - x, p.az + dz * t - z);
          if (dist > maxDist || (best && dist >= best.dist)) continue;
          const lateral = (x - p.ax) * dz - (z - p.az) * dx;
          best = { owner: p.owner, dist, t, dx, dz, lateral };
        }
      }
    return best;
  }
}

export type StopLine = {
  seg: Segment;
  dir: 1 | -1; // travel direction it applies to (AI convention: 1 = from → to)
  at: number; // distance along that travel direction
  pos: Vector3;
};
export type StopSign = { pos: Vector3; line: StopLine };
/** A sign post resolved onto the road edge, facing traffic that travels along `travel`. */
export type PlacedSign = {
  type: number;
  value: number;
  pos: Vector3; // foot of the post, left of the carriageway for that traffic
  travel: Vector3; // unit travel direction of the traffic it addresses
  seg: Segment;
  s: number; // along-distance on seg (coordinate order)
  dir: 1 | -1; // travel direction relative to seg coordinates
  /** 補助標識 text under the plate, e.g. "7-8:30\n土・日・休日を除く". */
  note?: string;
  /** 進行方向別通行区分: lanes from the left, e.g. [["left","through"],["right"]]. */
  lanes?: LaneDirection[][];
};
/** A crosswalk snapped onto a street: centred at `s`, spanning the carriageway. */
export type Crossing = { seg: Segment; s: number; pos: Vector3 };
/** 指定方向外進行禁止 at a junction node, for traffic arriving on `approach` in `dir`. */
export type TurnRule = {
  node: number;
  approach: Segment;
  dir: 1 | -1;
  mask: number;
  time: RuleTime;
};
export type AppliedRegulations = {
  crossings: Crossing[];
  signs: PlacedSign[];
  turnRules: TurnRule[];
  stopLines: StopLine[];
  stopSigns: StopSign[];
  signals: Vector3[];
  /** 交差点名 at signalled junctions (OSM), for the name plates on the signal arms. */
  junctionNames: Array<{ pos: Vector3; name: string; en: string }>;
  /** Footbridge decks and their stairs in the local frame (OSM). */
  footbridges: Array<{ width: number; deck: Vector3[]; stairs: Vector3[][] }>;
  /** 進行方向別通行区分 at junction approaches. */
  laneUse: LaneUse[];
  hasMarkings: boolean;
};

const toLocal = (frame: LocalFrame, coords: number[], from = 0): Vector3[] => {
  const pts: Vector3[] = [];
  for (let i = from; i + 1 < coords.length; i += 2) {
    const v = frame.toLocal(coords[i + 1], coords[i], frame.origin.h);
    v.y = 0;
    pts.push(v);
  }
  return pts;
};

// GSI centrelines and JARTIC lines are digitised independently; a few metres apart is normal.
const MATCH_DIST = 6;
const PARALLEL = Math.cos((25 * Math.PI) / 180);
// 区域規制 cover the streets inside the ring, not the roads it runs along: JARTIC traces the ring on
// the bounding roads and never marks 面規制の外周道路有無 in Tokyo, which the spec uses to say a
// bounding road is included. A point counts as inside only this far from the ring.
const AREA_EDGE = 8;

function insidePolygon(x: number, z: number, ring: Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToRing(x: number, z: number, ring: Vector3[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
}

// Share of the streets that may carry a 通行禁止 before it is reported. The densest real case seen,
// the all-day 歩行者用道路 zones of 太子堂, is about 14 %; the misread 環七 truck ban made it 99 %.
const CLOSED_SHARE_WARN = 0.5;

/**
 * A guard for any misread that shuts a whole district, whatever its cause: logged, not undone,
 * since which record is wrong cannot be told from here.
 */
function warnIfDistrictClosed(graph: RoadGraph): void {
  const streets = graph.segments.filter((s) => s.line.kind !== "highway");
  const closed = streets.filter((s) => s.closures.length > 0).length;
  const isImplausible = closed >= 200 && closed > streets.length * CLOSED_SHARE_WARN;
  if (!isImplausible) return;
  warn("closures_implausible_share", { closed, streets: streets.length, maxShare: CLOSED_SHARE_WARN });
}

/**
 * Transfer regulations onto the graph's segments (one-way rule, posted limit) and resolve the
 * point features (stop lines, stop signs) to the segment and travel direction they govern.
 */
export function applyRegulations(
  graph: RoadGraph,
  data: RegulationData,
  frame: LocalFrame,
): AppliedRegulations {
  const oneways = new LineGrid<RuleTime>();
  for (const r of data.oneway) {
    const { time, next } = readTime(r, 0);
    oneways.add(time, toLocal(frame, r, next));
  }
  type Closure = { kind: ClosureKind; time: RuleTime };
  const closureLines = new LineGrid<Closure>();
  const closureAreas: Array<{ closure: Closure; ring: Vector3[] }> = [];
  for (const r of data.closures) {
    const { time, next } = readTime(r, 2);
    const closure = { kind: r[1] as ClosureKind, time };
    const isArea = r[0] === 3;
    if (!isArea) {
      closureLines.add(closure, toLocal(frame, r, next));
      continue;
    }
    // The data build drops these already; tiles built before that check may still carry one (the
    // 環七 truck ban read as 通行止め closed a whole district), so drop it here too, with a log.
    const areaKm2 = ringAreaKm2(r, next);
    if (areaKm2 > MAX_CLOSURE_AREA_KM2) {
      warn("closure_area_implausible", {
        areaKm2: Math.round(areaKm2 * 10) / 10,
        maxKm2: MAX_CLOSURE_AREA_KM2,
        kind: closure.kind,
        at: r.slice(next, next + 2),
      });
      continue;
    }
    closureAreas.push({ closure, ring: toLocal(frame, r, next) });
  }
  const limits = new LineGrid<number>();
  for (const r of data.speed) limits.add(r[0], toLocal(frame, r, 1));
  const zones = data.speedZone.map((r) => ({ limit: r[0], ring: toLocal(frame, r, 1) }));
  const noOvertake = new LineGrid<true>();
  for (const r of data.noOvertake) noOvertake.add(true, toLocal(frame, r));
  const noLaneChange = new LineGrid<true>();
  for (const r of data.noLaneChange) noLaneChange.add(true, toLocal(frame, r));
  const laneLines = new LineGrid<number>();
  for (const r of data.lanes) laneLines.add(r[0], toLocal(frame, r, 1));
  const sectionGrids = new Map<number, LineGrid<RuleTime>>();
  for (const r of data.sections) {
    const { time, next } = readTime(r, 2);
    const grid = sectionGrids.get(r[0]) ?? new LineGrid<RuleTime>();
    grid.add(time, toLocal(frame, r, next));
    sectionGrids.set(r[0], grid);
  }

  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    seg.onewayRule = null;
    seg.limit = null;
    seg.limitKind = "statutory";
    seg.noOvertake = false;
    seg.noLaneChange = false;
    seg.lanes = 1;
    seg.rules = [];
    seg.closures = [];
    if (seg.line.kind === "highway") continue;
    const fractions = seg.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
    let votes = 0;
    let rule: RuleTime | null = null;
    const limitVotes = new Map<number, number>();
    let overtakeVotes = 0;
    let laneChangeVotes = 0;
    let laneVotes = 0;
    let laneCount = 0;
    const ruleVotes = new Map<number, { n: number; time: RuleTime }>();
    const closureVotes = new Map<Closure, number>();
    for (const f of fractions) {
      graph.sample(seg, seg.length * f, pos, dir);
      const isParallel = (dx: number, dz: number) => Math.abs(dx * dir.x + dz * dir.z) > PARALLEL;
      const ow = oneways.nearest(pos.x, pos.z, MATCH_DIST, isParallel);
      if (ow) {
        votes += Math.sign(ow.dx * dir.x + ow.dz * dir.z);
        rule = ow.owner;
      }
      const lim = limits.nearest(pos.x, pos.z, MATCH_DIST, isParallel);
      if (lim) limitVotes.set(lim.owner, (limitVotes.get(lim.owner) ?? 0) + 1);
      // Lane-level sections may be digitised on either carriageway half: allow half the width.
      const wide = Math.max(MATCH_DIST, seg.line.width / 2 + 2);
      if (noOvertake.nearest(pos.x, pos.z, wide, isParallel)) overtakeVotes++;
      if (noLaneChange.nearest(pos.x, pos.z, wide, isParallel)) laneChangeVotes++;
      for (const [code, grid] of sectionGrids) {
        const hit = grid.nearest(pos.x, pos.z, wide, isParallel);
        if (!hit) continue;
        const v = ruleVotes.get(code) ?? { n: 0, time: hit.owner };
        v.n++;
        ruleVotes.set(code, v);
      }
      // A closure shuts the whole street, so its line lies on the centreline: matching within
      // half the width (as for lane-level sections) closed 内堀通り because of the closed paths
      // of 皇居外苑 running beside it.
      const closed = closureLines.nearest(pos.x, pos.z, MATCH_DIST, isParallel);
      if (closed) closureVotes.set(closed.owner, (closureVotes.get(closed.owner) ?? 0) + 1);
      // Not the bounding roads: a 歩行者用道路 zone in 太子堂 traced on 国道246 closed it all day.
      for (const area of closureAreas) {
        const isInside =
          insidePolygon(pos.x, pos.z, area.ring) && distanceToRing(pos.x, pos.z, area.ring) > AREA_EDGE;
        if (isInside) closureVotes.set(area.closure, (closureVotes.get(area.closure) ?? 0) + 1);
      }
      const lane = laneLines.nearest(pos.x, pos.z, wide, isParallel);
      if (lane) {
        laneVotes++;
        laneCount = Math.max(laneCount, lane.owner);
      }
    }
    const majority = Math.ceil(fractions.length / 2);
    if (rule && Math.abs(votes) >= majority) seg.onewayRule = { dir: votes > 0 ? 1 : -1, time: rule };
    for (const [closure, n] of closureVotes) if (n >= majority) seg.closures.push(closure);
    seg.noOvertake = overtakeVotes >= majority;
    seg.noLaneChange = laneChangeVotes >= majority;
    if (laneVotes >= majority) seg.lanes = lanesPerDirection(seg, laneCount);
    for (const [code, v] of ruleVotes) if (v.n >= majority) seg.rules.push({ code, time: v.time });
    const posted = [...limitVotes].filter(([, n]) => n >= majority).toSorted((a, b) => b[1] - a[1])[0];
    if (posted) {
      seg.limit = posted[0];
      seg.limitKind = "sign";
      continue;
    }
    // 区域規制 (e.g. ゾーン30): roads inside the area, but not the arterials that bound it.
    graph.sample(seg, seg.length / 2, pos, dir);
    const zone = zones.find(
      (z) => insidePolygon(pos.x, pos.z, z.ring) && distanceToRing(pos.x, pos.z, z.ring) > AREA_EDGE,
    );
    if (zone) {
      seg.limit = zone.limit;
      seg.limitKind = "zone";
    }
  }
  warnIfDistrictClosed(graph);

  // Segment index for the point features.
  const segs = new LineGrid<Segment>();
  for (const seg of graph.segments) if (seg.line.kind !== "highway") segs.add(seg, seg.pts);
  const resolveStopLine = (p: Vector3): StopLine | null => {
    const hit = segs.nearest(p.x, p.z, 10);
    if (!hit) return null;
    const seg = hit.owner;
    const near = graph.nearestOn(seg, p);
    // Keep-left: a line left of the coordinate direction stops traffic moving along it.
    // The rule, not seg.oneway: the clock has not been applied to a freshly built graph yet.
    const oneway = seg.onewayRule?.dir ?? seg.line.oneway;
    let travel: 1 | -1;
    if (oneway !== 0) travel = oneway;
    else if (Math.abs(near.lateral) >= 0.6) travel = near.lateral > 0 ? 1 : -1;
    else travel = near.s > seg.length / 2 ? 1 : -1;
    const at = travel === 1 ? near.s : seg.length - near.s;
    return { seg, dir: travel, at, pos: p };
  };
  const stopLines: StopLine[] = [];
  for (const [lon, lat] of data.stopLine) {
    const line = resolveStopLine(toLocal(frame, [lon, lat])[0]);
    if (line) stopLines.push(line);
  }
  const stopSigns: StopSign[] = [];
  for (const [lon, lat] of data.stopSign) {
    const p = toLocal(frame, [lon, lat])[0];
    // A sign sits at the kerb beside its stop line; prefer that line's resolved direction.
    let best: StopLine | null = null;
    let bestD = 12;
    for (const l of stopLines) {
      const d = l.pos.distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    const line = best ?? resolveStopLine(p);
    if (line) stopSigns.push({ pos: p, line });
  }
  // Crosswalks: JARTIC gives kerb-to-kerb points digitised independently of the GSI centrelines,
  // so only their position along the street is used; the marking itself follows the street.
  const crossings: Crossing[] = [];
  for (const c of data.crosswalk) {
    const [p, q] = toLocal(frame, c);
    const mid = p.clone().add(q).multiplyScalar(0.5);
    const hit = segs.nearest(mid.x, mid.z, 12);
    if (!hit) continue;
    const seg = hit.owner;
    const across = q.clone().sub(p).normalize();
    const { s } = graph.nearestOn(seg, mid);
    const { dir: along } = graph.sample(seg, s);
    // A crosswalk runs across its street; one parallel to it belongs to the crossing street.
    const isAcross = Math.abs(across.dot(along)) < 0.6;
    const isDuplicate = crossings.some((c2) => c2.seg === seg && Math.abs(c2.s - s) < 4);
    if (!isAcross || isDuplicate || s < 2 || s > seg.length - 2) continue;
    crossings.push({ seg, s, pos: graph.sample(seg, s).pos.clone() });
  }
  const signs = placeSigns(graph, data, frame, segs, crossings);
  const laneUse = resolveLaneUse(graph, data, frame, segs);
  // 進行方向別通行区分 (327の7) on the approach, some 35 m before the junction, at the kerb.
  for (const use of laneUse) {
    const seg = use.seg;
    const back = Math.min(35, seg.length * 0.6);
    const s = use.dir === 1 ? seg.length - back : back;
    const { pos, dir } = graph.sample(seg, s);
    const travel = dir.clone().multiplyScalar(use.dir);
    signs.push({
      type: SIGN.laneArrows,
      value: 0,
      pos: pos.clone().add(leftOf(travel, seg.line.width / 2 + 0.7)),
      travel,
      seg,
      s,
      dir: use.dir,
      lanes: use.lanes,
    });
  }
  return {
    laneUse,
    crossings,
    signs,
    turnRules: resolveTurns(graph, data, frame),
    stopLines,
    stopSigns,
    signals: data.signals.map(([lon, lat]) => toLocal(frame, [lon, lat])[0]),
    junctionNames: data.junctions.map(([lon, lat, name, en]) => ({
      pos: toLocal(frame, [lon, lat])[0],
      name,
      en,
    })),
    footbridges: data.footbridges.map(([width, deck, stairs]) => ({
      width,
      deck: toLocal(frame, deck),
      stairs: stairs.map((c) => toLocal(frame, c)),
    })),
    hasMarkings: data.crosswalk.length + data.stopLine.length > 0,
  };
}

/** Travel direction at the `dir` end of a segment (toward the node it arrives at). */
function arrivingDir(seg: Segment, dir: 1 | -1): Vector3 {
  const n = seg.pts.length;
  const [a, b] = dir === 1 ? [seg.pts[n - 2], seg.pts[n - 1]] : [seg.pts[1], seg.pts[0]];
  return b.clone().sub(a).setY(0).normalize();
}

/** Directions one can leave a node in, coming along `seg` in `dir` (one-way streets respected). */
function exitDirections(graph: RoadGraph, seg: Segment, dir: 1 | -1): Set<LaneDirection> {
  const node = dir === 1 ? seg.to : seg.from;
  const inbound = arrivingDir(seg, dir);
  const out = new Set<LaneDirection>();
  for (const next of graph.exits(node, seg.id)) {
    if (next.line.kind === "highway") continue;
    const forward = next.from === node;
    const n = next.pts.length;
    const [a, b] = forward ? [next.pts[0], next.pts[1]] : [next.pts[n - 1], next.pts[n - 2]];
    const d = b.clone().sub(a).setY(0).normalize();
    const cross = inbound.x * d.z - inbound.z * d.x; // > 0: to the right (−Z north, +X east)
    const dot = inbound.dot(d);
    if (dot > 0.7) out.add("through");
    else if (dot < -0.7) continue;
    else out.add(cross > 0 ? "right" : "left");
  }
  return out;
}

/** The usual Tokyo pattern for `n` lanes: 左折・直進 | 直進 … | 右折 (2 lanes: 直進・右折). */
export function assumedLanes(n: number, exits: Set<LaneDirection>): LaneDirection[][] {
  const lanes: LaneDirection[][] = [];
  for (let i = 0; i < n; i++) {
    const isLeft = i === 0;
    const isRight = i === n - 1;
    const set: LaneDirection[] = [];
    if (isLeft && exits.has("left")) set.push("left");
    const isThrough = !isRight || n === 2 || !exits.has("right");
    if (exits.has("through") && isThrough) set.push("through");
    if (isRight && exits.has("right")) set.push("right");
    lanes.push(set.length ? set : ["through"]);
  }
  return lanes;
}

function resolveLaneUse(
  graph: RoadGraph,
  data: RegulationData,
  frame: LocalFrame,
  segs: LineGrid<Segment>,
): LaneUse[] {
  const out = new Map<string, LaneUse>();
  const key = (seg: Segment, dir: number) => `${seg.id}:${dir}`;
  // OSM: the approach ending within 30 m of the way end, arriving within 40° of its bearing.
  for (const [lon, lat, bearing, value] of data.turnlanes) {
    const p = toLocal(frame, [lon, lat])[0];
    const rad = (bearing * Math.PI) / 180;
    const heading = new Vector3(Math.sin(rad), 0, -Math.cos(rad));
    let best: { seg: Segment; dir: 1 | -1; d: number } | null = null;
    for (const seg of graph.segments) {
      if (seg.line.kind === "highway") continue;
      for (const dir of [1, -1] as const) {
        const end = dir === 1 ? seg.pts[seg.pts.length - 1] : seg.pts[0];
        const d = end.distanceTo(p);
        if (d > 30 || (best && d >= best.d)) continue;
        if (arrivingDir(seg, dir).dot(heading) < Math.cos((40 * Math.PI) / 180)) continue;
        best = { seg, dir, d };
      }
    }
    if (!best) continue;
    const lanes = value.split("|").map((lane) => {
      const set = lane.split(";").filter((t) => LANE_DIRECTIONS.has(t)) as LaneDirection[];
      return set.length ? set : (["through"] as LaneDirection[]); // none / merge_to_*: no arrow
    });
    if (lanes.length < 2) continue;
    const node = best.dir === 1 ? best.seg.to : best.seg.from;
    out.set(key(best.seg, best.dir), { seg: best.seg, dir: best.dir, node, lanes, source: "osm" });
  }
  // JARTIC: the regulated approach, its direction by the side of the street it lies on.
  for (const r of data.laneArrows) {
    const pts = toLocal(frame, r, 1);
    if (pts.length < 2) continue;
    const mid = pts[0].clone().lerp(pts[pts.length - 1], 0.5);
    const hit = segs.nearest(mid.x, mid.z, 14);
    if (!hit) continue;
    const seg = hit.owner;
    const near = graph.nearestOn(seg, mid);
    const oneway = seg.onewayRule?.dir ?? seg.line.oneway;
    const dir: 1 | -1 =
      oneway !== 0
        ? oneway
        : Math.abs(near.lateral) >= 0.6
          ? near.lateral > 0
            ? 1
            : -1
          : near.s > seg.length / 2
            ? 1
            : -1;
    if (out.has(key(seg, dir))) continue;
    const n = r[0] > 0 ? Math.min(r[0], 5) : seg.lanes;
    if (n < 2) continue;
    const exits = exitDirections(graph, seg, dir);
    if (exits.size < 2) continue;
    const node = dir === 1 ? seg.to : seg.from;
    out.set(key(seg, dir), { seg, dir, node, lanes: assumedLanes(n, exits), source: "assumed" });
  }
  return [...out.values()];
}

/**
 * 車両通行帯 lanes per direction. JARTIC's count is often blank; when it is given and cannot fit
 * one direction of the carriageway at ≥3 m per lane, it is the total for both directions.
 */
function lanesPerDirection(seg: Segment, count: number): number {
  const isOneWay = (seg.onewayRule?.dir ?? seg.line.oneway) !== 0;
  const span = isOneWay ? seg.line.width : seg.line.width / 2;
  const estimate = Math.min(4, Math.max(2, Math.round(span / 3.25)));
  if (!count) return estimate;
  const perDirection = !isOneWay && count * 3 > span + 1 ? Math.ceil(count / 2) : count;
  return Math.max(1, Math.min(perDirection, Math.floor(span / 2.75)));
}

/**
 * Where 道路標識 stand, derived from the regulated sections: [type, value, lon, lat, heading°]
 * (heading = travel direction of the traffic the sign faces). Signs sit 3 m into a section and
 * repeat along long ones; 車両進入禁止 faces wrong-way traffic at a one-way street's exit.
 */
export function signAnchors(data: RegulationData): number[][] {
  const out: number[][] = [];
  const along = (type: number, value: number, coords: number[], spacing: number, bothWays: boolean) => {
    for (const a of anchors(coords, spacing)) out.push([type, value, ...a]);
    if (bothWays) for (const a of anchors(reversed(coords), spacing)) out.push([type, value, ...a]);
  };
  for (const [limit, ...coords] of data.speed) along(SIGN.speed, limit, coords, 300, true);
  for (const r of data.oneway) {
    const travel = r.slice(readTime(r, 0).next);
    along(SIGN.oneway, 0, travel, 150, false);
    const [exit] = anchors(reversed(travel), 1e9);
    if (exit) out.push([SIGN.noEntry, 0, ...exit]);
  }
  // [sign, spacing (m)]: the sign at a section's start and repeated along it.
  const bySection: Record<number, [number, number]> = {
    115: [SIGN.noParking, 200],
    65: [SIGN.noStopping, 200],
    51: [SIGN.noUturn, 300],
    61: [SIGN.slow, 200],
    14: [SIGN.noPedestrianCrossing, 150],
    21: [SIGN.vehicleClass, 300],
    24: [SIGN.busPriority, 200],
    50: [SIGN.noVehicleCrossing, 200],
    53: [SIGN.noOvertake, 300],
    70: [SIGN.parkingAllowed, 150],
    71: [SIGN.parkingAllowed, 150],
    116: [SIGN.parkingAllowed, 150],
    72: [SIGN.timedParking, 100],
    77: [SIGN.horn, 200],
    81: [SIGN.bikeOnPavement, 150],
    1111: [SIGN.bikeLane, 150],
    1112: [SIGN.busLane, 200],
  };
  // はみ出し禁止 (yellow centre line): 314 at the start, repeated every 400 m, both ways.
  for (const coords of data.noOvertake) along(SIGN.noOvertakeRight, 0, coords, 400, true);
  for (const r of data.sections) {
    const kind = bySection[r[0]];
    if (kind) along(kind[0], 0, r.slice(readTime(r, 2).next), kind[1], r[1] === 1);
  }
  for (const [cx, cy, ex, ey, mask] of data.turns) {
    // On the approach, ~12 m before the junction centre.
    const dx = (cx - ex) * M_LON;
    const dy = (cy - ey) * M_LAT;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) continue;
    const back = Math.min(dist, 12) / dist;
    const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    out.push([SIGN.turn, mask, cx - (cx - ex) * back, cy - (cy - ey) * back, heading]);
  }
  return out;
}

/** 指定方向外進行禁止 resolved to a junction node and the approach segment it governs. */
function resolveTurns(graph: RoadGraph, data: RegulationData, frame: LocalFrame): TurnRule[] {
  const rules: TurnRule[] = [];
  const ends: Array<{ node: number; pos: Vector3 }> = [];
  for (const [node, ids] of graph.nodes) {
    if (ids.length < 3) continue;
    const seg = graph.segments[ids[0]];
    ends.push({ node, pos: seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1] });
  }
  for (const t of data.turns) {
    const [cx, cy, ex, ey, mask] = t;
    const { time } = readTime(t, 5);
    const [centre, entry] = toLocal(frame, [cx, cy, ex, ey]);
    let best: { node: number; pos: Vector3 } | null = null;
    let bestD = 20;
    for (const e of ends) {
      const d = Math.hypot(e.pos.x - centre.x, e.pos.z - centre.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) continue;
    const toEntry = entry.clone().sub(best.pos).setY(0).normalize();
    let approach: Segment | null = null;
    let bestDot = 0.6;
    for (const id of graph.nodes.get(best.node) ?? []) {
      const seg = graph.segments[id];
      // Direction leaving the node along this segment.
      const away =
        seg.from === best.node
          ? graph.sample(seg, Math.min(5, seg.length)).dir.clone()
          : graph
              .sample(seg, Math.max(0, seg.length - 5))
              .dir.clone()
              .negate();
      const dot = away.dot(toEntry);
      if (dot > bestDot) {
        bestDot = dot;
        approach = seg;
      }
    }
    if (!approach) continue;
    const dir: 1 | -1 = approach.to === best.node ? 1 : -1;
    // A rule that forbids every way on is on the wrong node: snapped to the nearest one with three
    // streets, it can land where no street goes its way (the apex of the 東京駅丸の内 forecourt
    // loop, where a left-only rule left the loop with no exit). Kept, it made a dead end of the
    // street for the route planner and would book a turn the sign cannot mean.
    if (!allowsAWayOn(graph, best.node, approach, dir, mask)) continue;
    rules.push({ node: best.node, approach, dir, mask, time });
  }
  return rules;
}

/**
 * Whether some street leaving `node` (one-way streets only their way, unless the one-way holds only
 * at times) lies in a direction `mask` allows for traffic arriving on `approach`: 1 left, 2
 * straight, 4 right, as navigation.ts turnBit classes a turn. Dead ends count as allowed.
 */
function allowsAWayOn(graph: RoadGraph, node: number, approach: Segment, dir: 1 | -1, mask: number): boolean {
  // Directions 2 m from the node, as the route planner measures a turn (navigation.ts tangent).
  const end = dir === 1 ? Math.max(0, approach.length - 2) : Math.min(2, approach.length);
  const tIn = graph.sample(approach, end).dir.clone().multiplyScalar(dir);
  const exits = (graph.nodes.get(node) ?? [])
    .map((id) => graph.segments[id])
    .filter((seg) => seg !== approach);
  if (exits.length === 0) return true;
  return exits.some((seg) => {
    const leaving: 1 | -1 = seg.from === node ? 1 : -1;
    const rule = seg.onewayRule;
    const isAllDay =
      rule !== null && rule.time.off.length === 0 && rule.time.on.some(([a, b]) => a === 0 && b >= 1440);
    const oneway = rule && isAllDay ? rule.dir : seg.line.oneway;
    if (oneway !== 0 && oneway !== leaving) return false;
    const tOut = graph
      .sample(seg, leaving === 1 ? Math.min(2, seg.length) : Math.max(0, seg.length - 2))
      .dir.clone()
      .multiplyScalar(leaving);
    const side = leftOf(tIn, 1).dot(tOut);
    const bit = side > 0.57 ? 1 : side < -0.57 ? 4 : 2;
    return (mask & bit) !== 0;
  });
}

/** Whether a regulation with its 規制時間・曜日 and 除外 conditions is in force at `clock`. */
export function isInForce(rule: { time: RuleTime }, clock: GameClock): boolean {
  return inForce(rule.time, clock);
}

/** Heading (0 = north, clockwise) → unit vector in the local frame (x east, z south). */
const headingVector = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return new Vector3(Math.sin(r), 0, -Math.cos(r));
};

/**
 * Put the data's sign anchors onto the left kerb of the street they belong to, and add the
 * entry signs of 区域規制 (zone 30 etc.) where a street crosses into the zone.
 */
function placeSigns(
  graph: RoadGraph,
  data: RegulationData,
  frame: LocalFrame,
  segs: LineGrid<Segment>,
  crossings: Crossing[],
): PlacedSign[] {
  const placed: PlacedSign[] = [];
  // A post never stands in another road (a junction the section starts at) or on a crosswalk.
  const isClear = (seg: Segment, s: number, foot: Vector3) =>
    graph.carriagewaysAt(foot, 0.5, seg).length === 0 &&
    !crossings.some((c) => c.seg === seg && Math.abs(c.s - s) < 3.5);
  const put = (type: number, value: number, seg: Segment, s0: number, dir: 1 | -1, note?: string) => {
    // Slide along the travel direction, past the junction, until the kerb is clear.
    let s = s0;
    let pos = new Vector3();
    let d = new Vector3();
    let foot: Vector3 | null = null;
    for (let k = 0; k < 15; k++, s += dir * 3) {
      if (s < 1 || s > seg.length - 1) break;
      ({ pos, dir: d } = graph.sample(seg, s));
      const travelHere = d.clone().multiplyScalar(dir);
      const candidate = pos.clone().add(leftOf(travelHere, seg.line.width / 2 + 0.7));
      if (isClear(seg, s, candidate)) {
        foot = candidate;
        break;
      }
    }
    if (!foot) return;
    const travel = d.clone().multiplyScalar(dir);
    const isDuplicate = placed.some(
      (o) =>
        o.type === type && o.value === value && o.pos.distanceTo(foot) < 15 && o.travel.dot(travel) > 0.7,
    );
    if (!isDuplicate) placed.push({ type, value, pos: foot, travel, seg, s, dir, note });
  };
  for (const [type, value, lon, lat, heading] of signAnchors(data)) {
    const p = toLocal(frame, [lon, lat])[0];
    const want = headingVector(heading);
    const hit = segs.nearest(p.x, p.z, 15, (dx, dz) => Math.abs(dx * want.x + dz * want.z) > 0.7);
    if (!hit) continue;
    const seg = hit.owner;
    const { s } = graph.nearestOn(seg, p);
    const { dir: d } = graph.sample(seg, s);
    const dir: 1 | -1 = d.dot(want) >= 0 ? 1 : -1;
    // 車両進入禁止 only ever faces wrong-way traffic on a one-way street; nothing else does.
    const oneway = seg.onewayRule?.dir ?? seg.line.oneway;
    const isAgainstFlow = oneway !== 0 && oneway !== dir;
    const fits = type === SIGN.noEntry ? isAgainstFlow : !isAgainstFlow;
    if (!fits) continue;
    put(type, value, seg, s, dir);
  }
  // The closure's sign (歩行者専用, 通行止め, 車両通行止め …) at each end of a closed street that
  // joins an open one, facing traffic about to turn in, with its hours and days on a 補助標識
  // when it is not closed round the clock.
  const closureSign: Record<ClosureKind, number> = {
    [CLOSURE.pedestrianRoad]: SIGN.pedestrianRoad,
    [CLOSURE.all]: SIGN.roadClosed,
    [CLOSURE.vehicles]: SIGN.closed,
    [CLOSURE.motor]: SIGN.motorClosed,
  };
  for (const seg of graph.segments) {
    const closure = seg.closures[0];
    if (!closure || seg.length < 8) continue;
    const time = closure.time;
    for (const [node, dir, s] of [
      [seg.from, 1, 3],
      [seg.to, -1, seg.length - 3],
    ] as const) {
      const isEntrance = (graph.nodes.get(node) ?? []).some((id) => graph.segments[id].closures.length === 0);
      if (isEntrance) put(closureSign[closure.kind], 0, seg, s, dir, timeNote(time) ?? undefined);
      // 歩行者用道路 for the school run: the ward's 通学路 plate on the same post.
      const isSchoolRun = closure.kind === CLOSURE.pedestrianRoad && timeNote(time) !== null;
      if (isEntrance && isSchoolRun) put(SIGN.schoolRoute, 0, seg, s, dir);
    }
  }
  // Zone entrances: a zone street whose end joins a street outside the zone.
  for (const seg of graph.segments) {
    if (seg.limitKind !== "zone" || seg.limit === null || seg.length < 12) continue;
    for (const [node, dir, s] of [
      [seg.from, 1, 4],
      [seg.to, -1, seg.length - 4],
    ] as const) {
      const isEntry = (graph.nodes.get(node) ?? []).some((id) => graph.segments[id].limitKind !== "zone");
      const oneway = seg.onewayRule?.dir ?? seg.line.oneway;
      if (isEntry && (oneway === 0 || oneway === dir)) put(SIGN.speed, seg.limit, seg, s, dir);
    }
  }
  return placed;
}

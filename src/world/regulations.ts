import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX } from "../geo/tiles";
import { warn } from "../log";
import { leftOf, type RoadGraph, type Segment } from "./roads";

/**
 * Traffic regulations for the area around the player, as tiled by scripts/regulations.ts:
 * JARTIC 交通規制情報 (one-way, 規制速度, 横断歩道, 停止線, 一時停止, sign posts, lane and
 * overtaking rules) and OpenStreetMap traffic signals. All coordinates are lon/lat; `applyRegulations` maps them onto a RoadGraph.
 */
export type RegulationData = {
  speed: number[][]; // [limit, lon0, lat0, …]
  speedZone: number[][]; // [limit, ring…]
  oneway: number[][]; // [startMin, endMin, …coords in permitted travel order]
  crosswalk: number[][]; // [lon1, lat1, lon2, lat2] kerb to kerb
  stopLine: number[][]; // [lon, lat]
  stopSign: number[][]; // [lon, lat]
  signs: number[][]; // [type, value, lon, lat, heading°] (see SIGN in scripts/regulations.ts)
  noOvertake: number[][]; // はみ出し禁止 sections: coords
  lanes: number[][]; // 車両通行帯: [lanes or 0, …coords]
  noLaneChange: number[][]; // 進路変更禁止 sections: coords
  signals: number[][]; // [lon, lat]
};

/** Sign type codes shared with the build script. */
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
  signs: [],
  noOvertake: [],
  lanes: [],
  noLaneChange: [],
  signals: [],
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
    const [regIndex, signalIndex] = await Promise.all([this.tileIndex("regs"), this.tileIndex("signals")]);
    const out = empty();
    const seen = new Map<number[][], Set<string>>();
    const add = (list: number[][], items: number[][]) => {
      const listed = seen.get(list) ?? new Set<string>();
      seen.set(list, listed);
      for (const item of items) {
        // Lines crossing a tile edge are stored in every tile they touch.
        const key = item.join(",");
        if (listed.has(key)) continue;
        listed.add(key);
        list.push(item);
      }
    };
    await Promise.all(
      [...keys].map(async (key) => {
        if (regIndex.has(key)) {
          const t = (await this.json(`regs/${key}.json`)) as Omit<RegulationData, "signals"> | null;
          if (t) for (const k of Object.keys(t) as (keyof typeof t)[]) add(out[k], t[k]);
        }
        if (signalIndex.has(key)) {
          const s = (await this.json(`signals/${key}.json`)) as number[][] | null;
          if (s) add(out.signals, s);
        }
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
};
/** A crosswalk snapped onto a street: centred at `s`, spanning the carriageway. */
export type Crossing = { seg: Segment; s: number; pos: Vector3 };
export type AppliedRegulations = {
  crossings: Crossing[];
  signs: PlacedSign[];
  stopLines: StopLine[];
  stopSigns: StopSign[];
  signals: Vector3[];
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

/**
 * Transfer regulations onto the graph's segments (one-way rule, posted limit) and resolve the
 * point features (stop lines, stop signs) to the segment and travel direction they govern.
 */
export function applyRegulations(
  graph: RoadGraph,
  data: RegulationData,
  frame: LocalFrame,
): AppliedRegulations {
  const oneways = new LineGrid<{ start: number; end: number }>();
  for (const r of data.oneway) oneways.add({ start: r[0], end: r[1] }, toLocal(frame, r, 2));
  const limits = new LineGrid<number>();
  for (const r of data.speed) limits.add(r[0], toLocal(frame, r, 1));
  const zones = data.speedZone.map((r) => ({ limit: r[0], ring: toLocal(frame, r, 1) }));
  const noOvertake = new LineGrid<true>();
  for (const r of data.noOvertake) noOvertake.add(true, toLocal(frame, r));
  const noLaneChange = new LineGrid<true>();
  for (const r of data.noLaneChange) noLaneChange.add(true, toLocal(frame, r));
  const laneLines = new LineGrid<number>();
  for (const r of data.lanes) laneLines.add(r[0], toLocal(frame, r, 1));

  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    seg.onewayRule = null;
    seg.limit = null;
    seg.limitKind = "statutory";
    seg.noOvertake = false;
    seg.noLaneChange = false;
    seg.lanes = 1;
    if (seg.line.kind === "highway") continue;
    const fractions = seg.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
    let votes = 0;
    let rule: { start: number; end: number } | null = null;
    const limitVotes = new Map<number, number>();
    let overtakeVotes = 0;
    let laneChangeVotes = 0;
    let laneVotes = 0;
    let laneCount = 0;
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
      const lane = laneLines.nearest(pos.x, pos.z, wide, isParallel);
      if (lane) {
        laneVotes++;
        laneCount = Math.max(laneCount, lane.owner);
      }
    }
    const majority = Math.ceil(fractions.length / 2);
    if (rule && Math.abs(votes) >= majority) seg.onewayRule = { dir: votes > 0 ? 1 : -1, ...rule };
    seg.noOvertake = overtakeVotes >= majority;
    seg.noLaneChange = laneChangeVotes >= majority;
    if (laneVotes >= majority) seg.lanes = lanesPerDirection(seg, laneCount);
    const posted = [...limitVotes].filter(([, n]) => n >= majority).toSorted((a, b) => b[1] - a[1])[0];
    if (posted) {
      seg.limit = posted[0];
      seg.limitKind = "sign";
      continue;
    }
    // 区域規制 (e.g. ゾーン30): roads inside the area, but not the arterials that bound it.
    graph.sample(seg, seg.length / 2, pos, dir);
    const zone = zones.find(
      (z) => insidePolygon(pos.x, pos.z, z.ring) && distanceToRing(pos.x, pos.z, z.ring) > 8,
    );
    if (zone) {
      seg.limit = zone.limit;
      seg.limitKind = "zone";
    }
  }

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
  const signs = placeSigns(graph, data, frame, segs);
  return {
    crossings,
    signs,
    stopLines,
    stopSigns,
    signals: data.signals.map(([lon, lat]) => toLocal(frame, [lon, lat])[0]),
    hasMarkings: data.crosswalk.length + data.stopLine.length > 0,
  };
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
): PlacedSign[] {
  const placed: PlacedSign[] = [];
  const put = (type: number, value: number, seg: Segment, s: number, dir: 1 | -1) => {
    const { pos, dir: d } = graph.sample(seg, s);
    const travel = d.clone().multiplyScalar(dir);
    const foot = pos.clone().add(leftOf(travel, seg.line.width / 2 + 0.7));
    const isDuplicate = placed.some(
      (o) =>
        o.type === type && o.value === value && o.pos.distanceTo(foot) < 15 && o.travel.dot(travel) > 0.7,
    );
    if (!isDuplicate) placed.push({ type, value, pos: foot, travel, seg, s, dir });
  };
  for (const [type, value, lon, lat, heading] of data.signs) {
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

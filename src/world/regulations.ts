import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX } from "../geo/tiles";
import { warn } from "../log";
import type { RoadGraph, Segment } from "./roads";

/**
 * Traffic regulations for the area around the player, as tiled by scripts/regulations.ts:
 * JARTIC 交通規制情報 (one-way, 規制速度, 横断歩道, 停止線, 一時停止) and OpenStreetMap
 * traffic signals. All coordinates are lon/lat; `applyRegulations` maps them onto a RoadGraph.
 */
export type RegulationData = {
  speed: number[][]; // [limit, lon0, lat0, …]
  speedZone: number[][]; // [limit, ring…]
  oneway: number[][]; // [startMin, endMin, …coords in permitted travel order]
  crosswalk: number[][]; // [lon1, lat1, lon2, lat2] kerb to kerb
  stopLine: number[][]; // [lon, lat]
  stopSign: number[][]; // [lon, lat]
  signals: number[][]; // [lon, lat]
};

const REG_ZOOM = 14;
const ROAD_ZOOM = 16; // RoadTiles covers the 3×3 z16 tiles around the player

const empty = (): RegulationData => ({
  speed: [],
  speedZone: [],
  oneway: [],
  crosswalk: [],
  stopLine: [],
  stopSign: [],
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
export type AppliedRegulations = {
  crosswalks: [Vector3, Vector3][];
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

  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    seg.onewayRule = null;
    seg.limit = null;
    seg.limitKind = "statutory";
    if (seg.line.kind === "highway") continue;
    const fractions = seg.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
    let votes = 0;
    let rule: { start: number; end: number } | null = null;
    const limitVotes = new Map<number, number>();
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
    }
    const majority = Math.ceil(fractions.length / 2);
    if (rule && Math.abs(votes) >= majority) seg.onewayRule = { dir: votes > 0 ? 1 : -1, ...rule };
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
  // Crosswalks come from whole z14 tiles; keep the ones on a street of this graph.
  const crosswalks: [Vector3, Vector3][] = [];
  for (const c of data.crosswalk) {
    const [p, q] = toLocal(frame, c);
    const hit = segs.nearest((p.x + q.x) / 2, (p.z + q.z) / 2, 12);
    if (hit) crosswalks.push([p, q]);
  }
  return {
    crosswalks,
    stopLines,
    stopSigns,
    signals: data.signals.map(([lon, lat]) => toLocal(frame, [lon, lat])[0]),
    hasMarkings: data.crosswalk.length + data.stopLine.length > 0,
  };
}

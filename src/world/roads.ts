import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";

/** A road centreline from a vector source, in lon/lat. */
export type RoadLine = {
  coords: number[]; // [lon0, lat0, lon1, lat1, …]
  width: number; // carriageway width estimate (m)
  oneway: 0 | 1 | -1; // 1: along coords, -1: against, 0: both ways
  kind: "highway" | "national" | "prefectural" | "local" | "narrow";
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
  /** JARTIC 一方通行 matched onto this segment, valid from `start` to `end` (minutes of day). */
  onewayRule: { dir: 1 | -1; start: number; end: number } | null;
  /** 規制速度 from JARTIC (km/h), or null when only the statutory limit applies. */
  limit: number | null;
  limitKind: "sign" | "zone" | "statutory";
  /** 追越しのための右側部分はみ出し通行禁止 (JARTIC): yellow centre line. */
  noOvertake: boolean;
  /** 進路変更禁止 (JARTIC): yellow lane lines. */
  noLaneChange: boolean;
  /** Lanes per direction: 1 unless JARTIC lists a 車両通行帯 for the section. */
  lanes: number;
  /** JARTIC sections on this segment: 115 駐車禁止, 65 駐停車禁止, 51 転回禁止, 61 徐行. */
  rules: Array<{ code: number; start: number; end: number }>;
};

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
  // 首都高 is a 自動車専用道路, not a 高速自動車国道 (100 km/h, 施行令 第27条), so the ordinary 60 km/h
  // applies wherever no limit is posted.
  if (line.kind === "highway") return 60;
  return line.width >= 5.5 ? 60 : 30;
}

/**
 * Road network around the player, rebuilt per area. Nodes join segment ends that share a point
 * (rounded to ~10 cm), giving intersections for AI routing and the traffic-law checks.
 */
const CELL = 32;
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

export class RoadGraph {
  readonly segments: Segment[] = [];
  readonly nodes = new Map<number, number[]>(); // node id → segment ids
  private readonly nodeIds = new Map<string, number>();
  /** Polyline pieces [segment id, point index] by 32 m cell, for carriageway tests. */
  private pieces: Map<string, Array<[number, number]>> | null = null;

  constructor(lines: RoadLine[], frame: LocalFrame) {
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
      const from = this.node(line.coords[0], line.coords[1]);
      const to = this.node(line.coords[line.coords.length - 2], line.coords[line.coords.length - 1]);
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
        limit: null,
        limitKind: "statutory",
        noOvertake: false,
        noLaneChange: false,
        lanes: 1,
        rules: [],
      });
      this.link(from, id);
      this.link(to, id);
    }
  }

  /**
   * Surface streets whose carriageway (half width + `margin`) covers p, except `except`, with the
   * street direction there. Used to keep signs and lane markings out of other roads and junctions.
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
      if (seg.line.kind === "highway") continue;
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
   * offset (positive = left of the segment's coordinate direction).
   */
  nearest(
    p: Vector3,
    maxDist: number,
    accept: (seg: Segment) => boolean = () => true,
  ): { seg: Segment; s: number; lateral: number; dir: Vector3 } | null {
    let best: { seg: Segment; s: number; lateral: number; dir: Vector3 } | null = null;
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

  /** Apply time-windowed one-way rules for a time of day (minutes since midnight). */
  setClock(minutes: number): void {
    for (const seg of this.segments) {
      const r = seg.onewayRule;
      const isActive =
        r !== null &&
        (r.start <= r.end ? minutes >= r.start && minutes < r.end : minutes >= r.start || minutes < r.end);
      seg.oneway = isActive && r ? r.dir : seg.line.oneway;
    }
  }

  /** Projection of a point onto one segment: along-distance and signed lateral (left = +). */
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

  private node(lon: number, lat: number): number {
    const key = vertexKey(lon, lat);
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

// ~1 m: joins lines clipped at vector-tile edges whose quantised end points differ slightly.
function vertexKey(lon: number, lat: number): string {
  return `${Math.round(lon * 1e5)}/${Math.round(lat * 1e5)}`;
}

/**
 * Vector roads are not split where a street meets the middle of another, so a T-junction would
 * look like a dead end. Split every line at interior vertices shared with any other line.
 */
export function splitAtJunctions(lines: RoadLine[]): RoadLine[] {
  const uses = new Map<string, number>();
  for (const line of lines) {
    const seen = new Set<string>();
    for (let i = 0; i < line.coords.length; i += 2) {
      const key = vertexKey(line.coords[i], line.coords[i + 1]);
      if (seen.has(key)) continue;
      seen.add(key);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const out: RoadLine[] = [];
  for (const line of lines) {
    let start = 0;
    const n = line.coords.length / 2;
    for (let i = 1; i < n - 1; i++) {
      const isJunction = (uses.get(vertexKey(line.coords[i * 2], line.coords[i * 2 + 1])) ?? 0) > 1;
      if (!isJunction) continue;
      out.push({ ...line, coords: line.coords.slice(start * 2, i * 2 + 2) });
      start = i;
    }
    out.push({ ...line, coords: line.coords.slice(start * 2) });
  }
  return out;
}

/** Offset to the left (Japan drives on the left) of a direction, in metres. */
export function leftOf(dir: Vector3, metres: number, target = new Vector3()): Vector3 {
  return target.set(dir.z * metres, 0, -dir.x * metres);
}

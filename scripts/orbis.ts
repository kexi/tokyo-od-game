// 速度違反自動取締装置 (オービス) from OpenStreetMap for public/data/police.json: every
// highway=speed_camera node in the 23 wards, with the travel direction it enforces, the lanes and
// road class there, and the points up the road where its 予告看板 (warning signs) stand.
// Used by scripts/regulations.ts (`pnpm exec tsx scripts/regulations.ts police`).
import { readNodeCoords, readRelations, readTaggedNodes, readWays, type OsmWay } from "./osm-pbf.ts";
import type { OrbisBearingSource, OrbisEntry, OrbisSign } from "../src/world/orbisData.ts";

/** The 23 special wards, as their OSM boundaries (admin_level 7) are named. */
export const WARDS = [
  "千代田区",
  "中央区",
  "港区",
  "新宿区",
  "文京区",
  "台東区",
  "墨田区",
  "江東区",
  "品川区",
  "目黒区",
  "大田区",
  "世田谷区",
  "渋谷区",
  "中野区",
  "杉並区",
  "豊島区",
  "北区",
  "荒川区",
  "板橋区",
  "練馬区",
  "足立区",
  "葛飾区",
  "江戸川区",
];

/**
 * 予告看板 distances (m before the device). Tokyo's 固定式 devices have at least two signs up the
 * road; the far one ~1.5 km and a near one shortly before are the assumption here.
 */
export const SIGN_DISTANCES = [1500, 200];
// Roads the sign walk follows and devices are matched to (not residential: the 予告看板 stand on
// the through road the device is on).
const THROUGH = /^(motorway|trunk|primary|secondary|tertiary|unclassified)(_link)?$/;
// A device off every way within this distance is left unmatched.
const MATCH_RADIUS = 40;
// Beyond this turn at a way end the road does not go on (a junction, not a bend).
const MAX_TURN = 50;

const M_LAT = 110_950; // metres per degree of latitude near Tokyo
const DEG = Math.PI / 180;

type LonLat = [number, number];

/** Bearing a → b, degrees clockwise from north. */
export function bearingOf(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * Math.cos(a[1] * DEG);
  const dy = b[1] - a[1];
  return (((Math.atan2(dx, dy) / DEG) % 360) + 360) % 360;
}

/** Smallest angle between two bearings (0–180°). */
export const turnOf = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);

const metres = (a: LonLat, b: LonLat) =>
  Math.hypot((b[0] - a[0]) * Math.cos(a[1] * DEG) * M_LAT, (b[1] - a[1]) * M_LAT);

/** The through-road network: ways, node coordinates and which ways pass each node. */
export type Network = {
  ways: OsmWay[];
  coords: Map<number, LonLat>;
  /** node id → [way index, position in its refs] for every way through the node. */
  at: Map<number, Array<[number, number]>>;
};

export function network(ways: OsmWay[], coords: Map<number, LonLat>): Network {
  const at = new Map<number, Array<[number, number]>>();
  ways.forEach((w, wi) =>
    w.refs.forEach((r, i) => {
      const list = at.get(r) ?? [];
      list.push([wi, i]);
      at.set(r, list);
    }),
  );
  return { ways, coords, at };
}

/** +1 along the way only, −1 against only, 0 both ways. */
function onewayOf(w: OsmWay): 1 | -1 | 0 {
  const v = w.tags.oneway;
  if (v === "yes" || v === "1" || v === "true") return 1;
  if (v === "-1" || v === "reverse") return -1;
  // Motorways and roundabouts are one-way by definition in OSM.
  const isImplied = w.tags.highway === "motorway" || w.tags.junction === "roundabout";
  return isImplied && v !== "no" ? 1 : 0;
}

/** [lon, lat, travel bearing there, metres walked up the road]. */
export type UpstreamPoint = [number, number, number, number];

/** A point on a way: segment k (refs[k] → refs[k+1]) at fraction t, travelled with d. */
type Anchor = { wi: number; k: number; t: number; d: 1 | -1 };

/**
 * Walk up the road from the anchor against the travel direction and return the points `targets`
 * metres before it (shortest first is not required), each with the travel bearing there. At a way
 * end the walk goes on along the way that flows into it with the least turn (one-way rules kept,
 * a change of road name counting as a little extra turn); it stops where nothing goes on within
 * MAX_TURN, so a sign that would fall past the end of the road is not returned.
 */
export function walkUpstream(net: Network, start: Anchor, targets: number[]): UpstreamPoint[] {
  const out: UpstreamPoint[] = [];
  const goal = Math.max(...targets);
  const pending = [...targets].sort((a, b) => a - b);
  const c = (wi: number, i: number) => net.coords.get(net.ways[wi].refs[i]);
  const a0 = c(start.wi, start.k);
  const b0 = c(start.wi, start.k + 1);
  if (!a0 || !b0) return out;
  let wi = start.wi;
  let d = start.d;
  let pos: LonLat = [a0[0] + (b0[0] - a0[0]) * start.t, a0[1] + (b0[1] - a0[1]) * start.t];
  // The next node upstream: the segment's start when travelling along the way, else its end.
  let n = d === 1 ? start.k : start.k + 1;
  let walked = 0;
  const seen = new Set<string>();
  for (let steps = 0; steps < 5000 && pending.length > 0 && walked < goal; steps++) {
    const node = c(wi, n);
    if (!node) break;
    const step = metres(pos, node);
    while (pending.length > 0 && walked + step >= pending[0]) {
      const f = step > 0 ? (pending[0] - walked) / step : 0;
      const p: LonLat = [pos[0] + (node[0] - pos[0]) * f, pos[1] + (node[1] - pos[1]) * f];
      out.push([round6(p[0]), round6(p[1]), Math.round(bearingOf(node, pos)), pending[0]]);
      pending.shift();
    }
    walked += step;
    // Travel arrives at `node` from upstream and leaves it toward the next node downstream.
    const downstream = c(wi, n + d) ?? pos;
    const leaving = bearingOf(node, downstream);
    pos = node;
    const next = n - d;
    const w = net.ways[wi];
    if (next >= 0 && next < w.refs.length) {
      n = next;
      continue;
    }
    // End of this way: carry on along the way that flows into this node most straight.
    const here = w.refs[n];
    let best: { wi: number; n: number; d: 1 | -1; cost: number } | null = null;
    for (const [wj, j] of net.at.get(here) ?? []) {
      if (wj === wi) continue;
      const other = net.ways[wj];
      const ow = onewayOf(other);
      for (const d2 of [1, -1] as const) {
        const isAllowed = ow === 0 || ow === d2;
        const from = j - d2;
        if (!isAllowed || from < 0 || from >= other.refs.length) continue;
        const prev = net.coords.get(other.refs[from]);
        if (!prev) continue;
        const arriving = bearingOf(prev, node);
        const sameRoad =
          (other.tags.name ?? "") === (w.tags.name ?? "") && (other.tags.ref ?? "") === (w.tags.ref ?? "");
        const cost = turnOf(arriving, leaving) + (sameRoad ? 0 : 10);
        if (turnOf(arriving, leaving) <= MAX_TURN && (!best || cost < best.cost))
          best = { wi: wj, n: from, d: d2, cost };
      }
    }
    if (!best) break;
    const key = `${best.wi}/${best.d}`;
    if (seen.has(key)) break;
    seen.add(key);
    wi = best.wi;
    n = best.n;
    d = best.d;
  }
  return out;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Nearest point on any through way to p, with the side p is on (+ left of the way's direction). */
function nearestOnNetwork(
  net: Network,
  p: LonLat,
  accept: (w: OsmWay, bearing: number) => boolean = () => true,
): { wi: number; k: number; t: number; dist: number; lateral: number } | null {
  let best: { wi: number; k: number; t: number; dist: number; lateral: number } | null = null;
  const kx = Math.cos(p[1] * DEG) * M_LAT;
  net.ways.forEach((w, wi) => {
    for (let k = 0; k + 1 < w.refs.length; k++) {
      const a = net.coords.get(w.refs[k]);
      const b = net.coords.get(w.refs[k + 1]);
      if (!a || !b) continue;
      // Cheap reject: both ends far away.
      if (Math.abs(a[1] - p[1]) * M_LAT > 600 && Math.abs(b[1] - p[1]) * M_LAT > 600) continue;
      const ax = (a[0] - p[0]) * kx;
      const ay = (a[1] - p[1]) * M_LAT;
      const ex = (b[0] - a[0]) * kx;
      const ey = (b[1] - a[1]) * M_LAT;
      const len2 = ex * ex + ey * ey;
      if (len2 < 1e-6) continue;
      const t = Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2));
      const dist = Math.hypot(ax + ex * t, ay + ey * t);
      if (dist > MATCH_RADIUS || (best && dist >= best.dist)) continue;
      if (!accept(w, bearingOf(a, b))) continue;
      // Left of travel a → b (x east, y north) is (−ey, ex); p − closest = −(a + e t).
      const lateral = (-(ax + ex * t) * -ey + -(ay + ey * t) * ex) / Math.sqrt(len2);
      best = { wi, k, t, dist, lateral };
    }
  });
  return best;
}

const num = (v: string | undefined) => Number.parseFloat(v ?? "") || 0;

/** Edges [lon0, lat0, lon1, lat1] of each ward's boundary, outer and inner rings alike. */
export type WardShapes = Map<string, number[][]>;

/**
 * The 23 wards' boundaries from the extract: the admin_level 7 relations named in WARDS whose
 * edges lie mostly in the box (Chiba and Saitama have a 中央区 and a 北区 of their own, outside it).
 * Why not the e-Stat 町丁 polygons the game uses (public/data/areas.json): the 2020 census has no
 * town on the 中央防波堤 reclaimed land, which is 江東区・大田区 and carries two speed cameras.
 */
export function readWards(file: Uint8Array, inBox: (lon: number, lat: number) => boolean): WardShapes {
  const rels = readRelations(
    file,
    (t) => t.boundary === "administrative" && t.admin_level === "7" && WARDS.includes(t.name ?? ""),
  );
  const ids = new Set(rels.flatMap((r) => r.members.filter((m) => m.type === "way").map((m) => m.ref)));
  // The boundary ways are tagged boundary=administrative themselves (all 1,195 of the wards' on
  // the 2026-10-04 extract), so the filter keeps the read small.
  const ways = new Map(
    readWays(file, (t) => t.boundary === "administrative")
      .filter((w) => ids.has(w.id))
      .map((w) => [w.id, w]),
  );
  const coords = readNodeCoords(file, new Set([...ways.values()].flatMap((w) => w.refs)));
  const out: WardShapes = new Map();
  for (const r of rels) {
    const edges: number[][] = [];
    for (const m of r.members) {
      const w = m.type === "way" ? ways.get(m.ref) : undefined;
      if (!w) continue;
      for (let k = 0; k + 1 < w.refs.length; k++) {
        const a = coords.get(w.refs[k]);
        const b = coords.get(w.refs[k + 1]);
        if (a && b) edges.push([a[0], a[1], b[0], b[1]]);
      }
    }
    const inside = edges.filter((e) => inBox(e[0], e[1])).length;
    const isTokyo = edges.length > 0 && inside >= edges.length / 2;
    if (!isTokyo) continue;
    const name = r.tags.name ?? "";
    out.set(name, [...(out.get(name) ?? []), ...edges]);
  }
  return out;
}

/**
 * The ward a point lies in, or null: even-odd crossings of a ray to the east over every edge of
 * the ward's rings (an inner ring's edges flip it back out, so no ring assembly is needed).
 */
export function wardAt(shapes: WardShapes, lon: number, lat: number): string | null {
  for (const [name, edges] of shapes) {
    let inside = false;
    for (const [x0, y0, x1, y1] of edges) {
      const straddles = y0 > lat !== y1 > lat;
      if (straddles && lon < x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0)) inside = !inside;
    }
    if (inside) return name;
  }
  return null;
}

/** Lanes the given direction has on a way (0 = not mapped). */
function lanesOf(w: OsmWay, d: 1 | -1): number {
  if (onewayOf(w) !== 0) return num(w.tags.lanes);
  const each = num(w.tags[d === 1 ? "lanes:forward" : "lanes:backward"]);
  return each || Math.floor(num(w.tags.lanes) / 2);
}

function maxspeedOf(w: OsmWay, d: 1 | -1): number {
  return num(w.tags[d === 1 ? "maxspeed:forward" : "maxspeed:backward"]) || num(w.tags.maxspeed);
}

/**
 * Every speed camera in the 23 wards, resolved against the extract. The box only narrows the read:
 * it reaches into 川崎市 and Chiba, so a camera counts when it lies inside a ward's boundary.
 * Checked on 2026-10-05 for tagging this misses: no way, and no node without highway=speed_camera,
 * carries enforcement / speed_camera keys in the wards; the enforcement=maxspeed relations all
 * name a speed_camera node as their device (others are traffic_signals and maxweight).
 */
export function buildOrbis(file: Uint8Array, inBox: (lon: number, lat: number) => boolean): OrbisEntry[] {
  const wards = readWards(file, inBox);
  const wardOf = new Map<number, string>();
  const cams = readTaggedNodes(file, (t) => t.highway === "speed_camera").filter((n) => {
    if (!inBox(n.lon, n.lat)) return false;
    const ward = wardAt(wards, n.lon, n.lat);
    if (ward) wardOf.set(n.id, ward);
    return ward !== null;
  });
  const camIds = new Set(cams.map((n) => n.id));
  const relations = readRelations(file, (t) => t.type === "enforcement" && t.enforcement === "maxspeed");
  const byDevice = new Map<number, { from?: number; to?: number; maxspeed: number }>();
  for (const r of relations) {
    const device = r.members.find((m) => m.role === "device" && m.type === "node" && camIds.has(m.ref));
    if (!device) continue;
    byDevice.set(device.ref, {
      from: r.members.find((m) => m.role === "from" && m.type === "node")?.ref,
      to: r.members.find((m) => m.role === "to" && m.type === "node")?.ref,
      maxspeed: num(r.tags.maxspeed),
    });
  }
  const ways = readWays(file, (t) => THROUGH.test(t.highway ?? ""));
  const ends = [...byDevice.values()]
    .flatMap((r) => [r.from, r.to])
    .filter((r): r is number => r !== undefined);
  const coords = readNodeCoords(file, new Set([...ways.flatMap((w) => w.refs), ...ends]));
  const net = network(ways, coords);

  const out: OrbisEntry[] = [];
  for (const cam of cams) {
    const p: LonLat = [cam.lon, cam.lat];
    const rel = byDevice.get(cam.id);
    const relFrom = rel?.from !== undefined ? coords.get(rel.from) : undefined;
    const relTo = rel?.to !== undefined ? coords.get(rel.to) : undefined;
    const relBearing = relFrom && relTo ? bearingOf(relFrom, relTo) : null;
    // On a way: the node itself is one of its refs (pick the segment leaving it, or the last one).
    // A node at a junction is on several ways: the one along the relation's direction, else one
    // it lies inside of (not where the way ends).
    const onWay = (net.at.get(cam.id) ?? [])
      .map(([wi, i]) => {
        const w = net.ways[wi];
        const k = Math.min(i, w.refs.length - 2);
        const a = coords.get(w.refs[k]);
        const b = coords.get(w.refs[k + 1]);
        const along = a && b ? bearingOf(a, b) : 0;
        const isEnd = i === 0 || i === w.refs.length - 1;
        const fit =
          relBearing === null
            ? isEnd
              ? 1
              : 0
            : Math.min(turnOf(along, relBearing), turnOf(along + 180, relBearing));
        return { wi, k, t: i === k ? 0 : 1, dist: 0, lateral: 0, fit };
      })
      .sort((x, y) => x.fit - y.fit);
    const accept = (_w: OsmWay, b: number) =>
      relBearing === null || Math.min(turnOf(b, relBearing), turnOf(b, relBearing + 180)) < 45;
    const hit = onWay[0] ?? nearestOnNetwork(net, p, accept);
    if (!hit) {
      out.push(entry(cam.id, p, null, "none", 0, num(cam.tags.maxspeed), "", false, "", []));
      continue;
    }
    const w = net.ways[hit.wi];
    const a = coords.get(w.refs[hit.k]);
    const b = coords.get(w.refs[hit.k + 1]);
    const wayBearing = a && b ? bearingOf(a, b) : 0;
    const ow = onewayOf(w);
    let d: 1 | -1 | null = null;
    let source: OrbisBearingSource = "none";
    const dirTag = cam.tags.direction;
    if (relBearing !== null) {
      d = turnOf(wayBearing, relBearing) <= 90 ? 1 : -1;
      source = "relation";
    } else if (onWay.length > 0 && (dirTag === "forward" || dirTag === "backward")) {
      d = dirTag === "forward" ? 1 : -1;
      source = "direction";
    } else if (ow !== 0) {
      d = ow;
      source = "oneway";
    } else if (Number.isFinite(Number.parseFloat(dirTag ?? ""))) {
      // A bearing on the node is the way the camera looks: back at the traffic it photographs
      // (the one Tokyo node with both, 8041133763, has direction=5 and an enforcement relation
      // southbound at 183°).
      d = turnOf(wayBearing, Number.parseFloat(dirTag ?? "") + 180) <= 90 ? 1 : -1;
      source = "direction";
    } else if (Math.abs(hit.lateral) >= 1.5) {
      // Left-hand traffic: the kerb a roadside unit stands at is on the left of the traffic it watches.
      d = hit.lateral > 0 ? 1 : -1;
      source = "side";
    }
    const isElevated = (w.tags.bridge ?? "no") !== "no" || num(w.tags.layer) >= 1;
    const directions: Array<1 | -1> = d === null ? [1, -1] : [d];
    const travelOf = (dir: 1 | -1) => Math.round(dir === 1 ? wayBearing : (wayBearing + 180) % 360);
    const signs = directions.flatMap((dir) =>
      walkUpstream(net, { wi: hit.wi, k: hit.k, t: hit.t, d: dir }, SIGN_DISTANCES).map((s): OrbisSign => [
        s[0],
        s[1],
        s[2],
        s[3],
        travelOf(dir),
      ]),
    );
    const bearing = d === null ? null : travelOf(d);
    const lanes = d === null ? 0 : lanesOf(w, d);
    const maxspeed = num(cam.tags.maxspeed) || rel?.maxspeed || maxspeedOf(w, d ?? 1);
    out.push(
      entry(
        cam.id,
        p,
        bearing,
        source,
        lanes,
        maxspeed,
        w.tags.highway ?? "",
        isElevated,
        w.tags.name ?? "",
        signs,
      ),
    );
  }
  // Where each entry comes from, kept per entry so a camera from another source can sit beside them.
  return out.map((e) => ({ ...e, ward: wardOf.get(e.id) ?? "", origin: `osm:node/${e.id}` }));
}

function entry(
  id: number,
  p: LonLat,
  bearing: number | null,
  source: OrbisBearingSource,
  lanes: number,
  maxspeed: number,
  road: string,
  elevated: boolean,
  name: string,
  signs: OrbisSign[],
): OrbisEntry {
  return {
    id,
    lon: round6(p[0]),
    lat: round6(p[1]),
    bearing,
    source,
    lanes,
    maxspeed,
    road,
    elevated,
    name,
    signs,
  };
}

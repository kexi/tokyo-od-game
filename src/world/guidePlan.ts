import { Vector3 } from "three";
import type { LocalFrame } from "../geo/frame";
import { LineGrid } from "./regulations";
import { leftOf, speedLimit, type RoadGraph, type Segment } from "./roads";

/**
 * 案内標識 of the 108 series for the junctions of the road graph: which approaches get one, where
 * its pole stands, what its arrow diagram looks like and which places it names. Pure planning; the
 * boards are drawn by guideArt.ts and stood up by guideSigns.ts.
 *
 * Rules (道路標識、区画線及び道路標示に関する命令 別表第一・第二, 道路標識設置基準 3-2-1, 国土交通省
 * 「案内標識のしくみ」): 「方面及び方向の予告」(108-A) within 300 m and 「方面及び方向」(108の2-A) within
 * 150 m before the junction, on the left kerb or over the carriageway; where a crossing road has a
 * 通称名 the 108の3 / 108の4 versions show it in a box on the arm, except for 一般国道, which show
 * their 国道番号. The places come from the 表示地名 (重要地・主要地・一般地) by the road's class:
 * straight on, the nearest 重要地 and 主要地 of a 主要幹線道路 (left the farther or more important,
 * right the nearer); to the side, one name by the crossing road's class.
 */

/** 0 一般国道 (主要幹線道路), 1 主要地方道 (幹線道路), 2 一般都道府県道 (補助幹線道路), 3 other streets. */
export type RoadClass = 0 | 1 | 2 | 3;
export type RouteInfo = { cls: RoadClass; refs: string[]; name: string; nameEn: string; key: string };
/** public/data/routes tiles (scripts/guide-signs.ts). */
export type RouteRoad = [number, string, string, string, ...number[]];
export type RouteDest = [number, number, number, string, string, string];
export type RouteName = [number, number, string, string];
export type RouteTile = { roads: RouteRoad[]; dests: RouteDest[]; names: RouteName[] };
/** public/data/guide-places.json rows: [name, English, rank, lon, lat, "N1,P301"]. */
export type PlaceRow = [string, string, number, number, number, string];

/** rank 1 重要地, 2 主要地, 3 一般地 (a named junction on the road), 4 a ward (一般地 of the last resort). */
export type GuidePlace = { ja: string; en: string; rank: number; pos: Vector3; routes: Set<string> };
export type GuideName = { ja: string; en: string; pos: Vector3 };
export type GuideDest = { pos: Vector3; heading: Vector3; names: string[]; en: string[]; ref: string };

export type SignName = { ja: string; en: string; expressway: boolean };
export type Shield = { kind: "national" | "prefectural"; number: string };
/** One arm of the arrow diagram: angle in degrees from straight on, + to the left. */
export type ArmSpec = { angle: number; names: SignName[]; shields: Shield[]; street: string | null };
export type BoardKind = "108-A" | "108の2-A" | "108の3" | "108の4";
export type BoardSpec = {
  kind: BoardKind;
  arms: ArmSpec[];
  /** 予告: metres to the junction, rounded as printed ("300m"); null at the junction. */
  distance: number | null;
  /** Height of the Japanese letters (cm). */
  letter: number;
};
export type JunctionShape =
  | "straight"
  | "cross"
  | "T"
  | "Y"
  | "left-branch"
  | "right-branch"
  | "left-bend"
  | "right-bend"
  | "multi";

export type GuidePlan = {
  board: BoardSpec;
  shape: JunctionShape;
  /** Foot of the pole (y = 0), on the kerb left of the traffic it faces. */
  pos: Vector3;
  travel: Vector3;
  mount: "overhead" | "roadside";
  /** Metres along the road from the sign to the junction centre. */
  before: number;
  centre: Vector3;
  seg: Segment;
};

/** An approach into a signalled junction (trafficControl.ts), with the junction's nodes. */
export type GuideApproach = {
  seg: Segment;
  dir: 1 | -1;
  /** Stop position along the travel direction (from the travelled start of seg). */
  at: number;
  travel: Vector3;
  nodes: number[];
};

const DEG = Math.PI / 180;
const BACK_JUNCTION = [55, 45, 65, 75, 35, 85, 95, 110, 125, 140]; // 108の2: within 150 m
const BACK_ADVANCE = [300, 280, 260, 240, 220, 200, 180, 160]; // 108: within 300 m
const MIN_PLACE = 300; // a place this close is "here", not a direction
// 表示地名 further than this are not what a city-centre board points to (所沢, 千葉 from 日比谷);
// a station (rank 3, 一般地) only within 3 km.
const MAX_PLACE = 12000;
const MAX_STATION = 3000;
const MIN_SPACING = 30; // two guide signs for the same traffic stand at least this far apart
const KERB_GAP = 0.9; // pole axis behind the kerb line

// ---------------------------------------------------------------- data on the graph

const toLocal = (frame: LocalFrame, lon: number, lat: number) =>
  frame.toLocal(lat, lon, frame.origin.h).setY(0);

/** OSM route numbers and street names onto the segments (3-point vote, parallel within 25°). */
export function matchRoutes(graph: RoadGraph, roads: RouteRoad[], frame: LocalFrame): Map<number, RouteInfo> {
  const grid = new LineGrid<RouteInfo>(25);
  for (const [cls, ref, name, nameEn, ...coords] of roads) {
    const pts: Vector3[] = [];
    for (let i = 0; i + 1 < coords.length; i += 2) pts.push(toLocal(frame, coords[i], coords[i + 1]));
    const refs = ref ? ref.split(";").filter(Boolean) : [];
    const key = refs.length ? `${cls === 0 ? "N" : "P"}${refs.join(";")}` : name;
    grid.add({ cls: Math.min(3, Math.max(0, cls)) as RoadClass, refs, name, nameEn, key }, pts);
  }
  const out = new Map<number, RouteInfo>();
  const cos = Math.cos(25 * DEG);
  for (const seg of graph.segments) {
    if (seg.line.kind === "highway") continue;
    const fractions = seg.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
    const votes = new Map<RouteInfo, number>();
    for (const f of fractions) {
      const { pos, dir } = graph.sample(seg, seg.length * f);
      const reach = Math.min(24, seg.line.width / 2 + 6);
      const hit = grid.nearest(pos.x, pos.z, reach, (dx, dz) => Math.abs(dx * dir.x + dz * dir.z) > cos);
      if (hit) votes.set(hit.owner, (votes.get(hit.owner) ?? 0) + 1);
    }
    let best: RouteInfo | null = null;
    let bestVotes = 0;
    for (const [info, n] of votes)
      if (n > bestVotes || (n === bestVotes && best && info.cls < best.cls)) {
        best = info;
        bestVotes = n;
      }
    if (best && bestVotes * 2 > fractions.length) out.set(seg.id, best);
  }
  return out;
}

/** The segment's class: OSM's route where matched, else the GSI 道路種別. */
export function roadClass(seg: Segment, routes: Map<number, RouteInfo>): RoadClass {
  const r = routes.get(seg.id);
  if (r) return r.cls;
  if (seg.line.kind === "national") return 0;
  if (seg.line.kind === "prefectural") return 1;
  return 3;
}

export function localPlaces(rows: PlaceRow[], frame: LocalFrame): GuidePlace[] {
  return rows.map(([ja, en, rank, lon, lat, refs]) => ({
    ja,
    en,
    rank,
    pos: toLocal(frame, lon, lat),
    routes: new Set(refs ? refs.split(",") : []),
  }));
}

/** Bearing (° clockwise from north) as a local unit vector (x east, z south). */
export const bearingVector = (deg: number) => new Vector3(Math.sin(deg * DEG), 0, -Math.cos(deg * DEG));

export function localDests(rows: RouteDest[], frame: LocalFrame): GuideDest[] {
  return rows.map(([lon, lat, bearing, dest, en, ref]) => ({
    pos: toLocal(frame, lon, lat),
    heading: bearingVector(bearing),
    names: dest
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    en: en.split(";").map((s) => s.trim()),
    ref,
  }));
}

/**
 * Junction names that make a 一般地 (「沿道の著名な地点」): a place's own name, not 「…一丁目」,
 * 「…前」, 「…入口」 or a corner of something; and only with an English name for the board.
 */
export function isPlaceLikeJunction(ja: string, en: string): boolean {
  const isPart = /(丁目|前|入口|出口|口|東|西|南|北|下|上|角|詰|側|裏|横|脇|先|[0-9０-９])$/.test(ja);
  const isFacility =
    /(駅|署|所|館|院|校|園|場|局|門|神社|寺|ビル|センター|ホテル|タワー|プラザ|ランプ|IC|JCT)/.test(ja);
  return !isPart && !isFacility && ja.length <= 6 && en.trim() !== "";
}

// ---------------------------------------------------------------- English (告示 and the figures)

const stripMacrons = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * English on a board: 国土交通省告示 (平成26年3月26日「道路の案内標識の英語による表示に関する告示」)
 * fixes the common nouns — 駅 Station, 通り Avenue/Street/Boulevard, 公園 Park, 橋 Bridge … — "or
 * their abbreviations", and the Tokyo boards use "Sta." and "-dori Ave."; 区 is written "City",
 * as 別表第二's 図 251 writes 三好市 "Miyoshi City" and the special wards write themselves.
 * Proper names keep their Hepburn spelling without macrons; 「交差点」 is never printed.
 */
export function signEnglish(ja: string, en: string): string {
  let e = stripMacrons(en.trim());
  if (!e) return "";
  e = e
    .replace(/\s+(Crossing|Intersection|Junction|Jct\.?)$/i, "")
    .replace(/\bStation\b/g, "Sta.")
    .replace(/\bBoulevard\b/g, "Blvd.");
  const isStreet = /(通り|通)$/.test(ja) && !/大通り?$/.test(ja);
  if (isStreet) {
    const base = e.replace(/(-|\s)?(dori|doori)?\s*(Avenue|Ave\.|Street|St\.)?$/i, "").trim();
    return `${base}-dori Ave.`;
  }
  if (ja.endsWith("街道")) {
    const base = e.replace(/(-|\s)?kaido\s*(Avenue|Ave\.|Street|St\.|Road)?$/i, "").trim();
    return `${base}-kaido Ave.`;
  }
  e = e.replace(/\bAvenue\b/g, "Ave.").replace(/\bStreet\b/g, "St.");
  if (ja.endsWith("駅") && !e.endsWith("Sta.")) e = `${e} Sta.`;
  if (ja.endsWith("区") && !e.endsWith("City")) e = `${e.replace(/-?ku$/i, "").trim()} City`;
  return e;
}

/** 首都高・高速道路の名前: shown in a green box on a blue board (備考一(三)1(13) ただし書). */
export function isExpresswayName(ja: string): boolean {
  return /(首都高|高速|自動車道|東名|中央道|関越道|東北道|常磐道|京葉道|外環|第三京浜|湾岸線|JCT$|IC$|^[EC]\d+)/.test(
    ja,
  );
}

// ---------------------------------------------------------------- geometry of a junction

/** Angle (°) of `heading` from `travel`: 0 straight on, + to the left (left-hand frame x east, z south). */
export function relativeAngle(travel: Vector3, heading: Vector3): number {
  const left = leftOf(travel, 1);
  return (
    Math.atan2(heading.x * left.x + heading.z * left.z, heading.x * travel.x + heading.z * travel.z) / DEG
  );
}

/**
 * The angle an arm is drawn at: crossings near 90° are drawn at 90° (「θが90°に近い場合は、90°にして
 * 表示する」, 国土交通省 108 系統の表示例), the rest at the nearest 45°.
 */
export function drawnAngle(angle: number): number {
  const a = Math.abs(angle);
  const sign = angle < 0 ? -1 : 1;
  if (a < 20) return 0;
  if (a < 62) return 45 * sign;
  if (a < 118) return 90 * sign;
  return 135 * sign;
}

/** Shape of the arms seen from the approach (angles in degrees, + left, the way back left out). */
export function classifyShape(angles: number[]): JunctionShape {
  const ahead = angles.filter((a) => Math.abs(a) < 30).length;
  const left = angles.filter((a) => a >= 30 && a < 150);
  const right = angles.filter((a) => a <= -30 && a > -150);
  const total = ahead + left.length + right.length;
  if (total >= 4 || ahead > 1 || left.length > 1 || right.length > 1) return "multi";
  const hasLeft = left.length > 0;
  const hasRight = right.length > 0;
  if (ahead && hasLeft && hasRight) return "cross";
  if (ahead && hasLeft) return "left-branch";
  if (ahead && hasRight) return "right-branch";
  if (hasLeft && hasRight) return Math.max(left[0], -right[0]) < 70 ? "Y" : "T";
  if (hasLeft) return "left-bend";
  if (hasRight) return "right-bend";
  return "straight";
}

const nodePos = (graph: RoadGraph, node: number): Vector3 | null => {
  const id = graph.nodes.get(node)?.[0];
  if (id === undefined) return null;
  const seg = graph.segments[id];
  return (seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1]).clone();
};

/** Unit travel direction on seg at its start (atEnd false) or end, travelling `dir`. */
function travelDir(graph: RoadGraph, seg: Segment, dir: 1 | -1, atEnd: boolean): Vector3 {
  const s = (dir === 1) === atEnd ? seg.length - 0.5 : 0.5;
  return graph.sample(seg, s).dir.clone().multiplyScalar(dir);
}

export type Trace = { pts: Vector3[]; length: number; segs: Segment[] };

/**
 * The road followed from `node` along seg in `dir`: at each node the continuation that turns
 * least (under 40°, the same route preferred), up to `maxLength` metres or the graph's edge.
 */
export function traceRoad(
  graph: RoadGraph,
  seg: Segment,
  dir: 1 | -1,
  routes: Map<number, RouteInfo>,
  maxLength: number,
): Trace {
  const pts: Vector3[] = [];
  const segs: Segment[] = [];
  const seen = new Set<number>();
  let cur = seg;
  let d = dir;
  let length = 0;
  const key = routes.get(seg.id)?.key ?? "";
  while (length < maxLength && !seen.has(cur.id)) {
    seen.add(cur.id);
    segs.push(cur);
    const ordered = d === 1 ? cur.pts : cur.pts.toReversed();
    for (const p of ordered) {
      const last = pts[pts.length - 1];
      if (last) length += last.distanceTo(p);
      if (!last || last.distanceTo(p) > 0.01) pts.push(p);
    }
    const end = d === 1 ? cur.to : cur.from;
    const out = travelDir(graph, cur, d, true);
    let best: { seg: Segment; dir: 1 | -1; score: number } | null = null;
    for (const id of graph.nodes.get(end) ?? []) {
      const c = graph.segments[id];
      if (c === cur || c.line.kind === "highway") continue;
      const cd: 1 | -1 = c.from === end ? 1 : -1;
      const isAllowed = c.oneway === 0 || c.oneway === cd;
      if (!isAllowed) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, travelDir(graph, c, cd, false).dot(out)))) / DEG;
      const isSameRoute = key !== "" && routes.get(c.id)?.key === key;
      const score = turn - (isSameRoute ? 15 : 0);
      if (turn < 40 && (!best || score < best.score)) best = { seg: c, dir: cd, score };
    }
    if (!best) break;
    cur = best.seg;
    d = best.dir;
  }
  return { pts, length, segs };
}

/** Point `along` metres down a trace (its end when shorter). */
export function traceAt(trace: Trace, along: number): Vector3 {
  let left = along;
  for (let i = 1; i < trace.pts.length; i++) {
    const step = trace.pts[i].distanceTo(trace.pts[i - 1]);
    if (step >= left) return trace.pts[i - 1].clone().lerp(trace.pts[i], step > 0 ? left / step : 0);
    left -= step;
  }
  return (trace.pts[trace.pts.length - 1] ?? new Vector3()).clone();
}

/** Distance from p to the trace and how far along it the nearest point is. */
function onTrace(trace: Trace, p: Vector3): { dist: number; along: number } {
  let best = { dist: Infinity, along: 0 };
  let acc = 0;
  for (let i = 1; i < trace.pts.length; i++) {
    const a = trace.pts[i - 1];
    const b = trace.pts[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len > 1e-6) {
      const t = Math.min(len, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / len));
      const dist = Math.hypot(a.x + (ex / len) * t - p.x, a.z + (ez / len) * t - p.z);
      if (dist < best.dist) best = { dist, along: acc + t };
    }
    acc += len;
  }
  return best;
}

export type Arm = {
  angle: number;
  /** The angle it is drawn at on the board (drawnAngle, kept apart from the other arms). */
  drawn: number;
  seg: Segment;
  dir: 1 | -1;
  heading: Vector3;
  route: RouteInfo | null;
  cls: RoadClass;
  trace: Trace;
};

/** Roads leaving a junction (its signal's nodes), seen from an approach; the way back left out. */
export function junctionArms(
  graph: RoadGraph,
  ap: GuideApproach,
  routes: Map<number, RouteInfo>,
  centre: Vector3,
  traceLength = 2500,
): Arm[] {
  const members = new Set(ap.nodes);
  const arms: Arm[] = [];
  for (const node of ap.nodes) {
    for (const id of graph.nodes.get(node) ?? []) {
      const seg = graph.segments[id];
      const other = seg.from === node ? seg.to : seg.from;
      if (members.has(other) || seg.line.kind === "highway") continue;
      const dir: 1 | -1 = seg.from === node ? 1 : -1;
      const isAllowed = seg.oneway === 0 || seg.oneway === dir;
      if (!isAllowed) continue;
      const trace = traceRoad(graph, seg, dir, routes, traceLength);
      // The arm's direction from the junction centre to a point 40 m down it: the first metres
      // of a GSI line inside a big crossing bend toward its node.
      const heading = traceAt(trace, 40).sub(centre).setY(0);
      if (heading.lengthSq() < 1) continue;
      heading.normalize();
      const angle = relativeAngle(ap.travel, heading);
      if (Math.abs(angle) >= 150) continue;
      const route = routes.get(seg.id) ?? null;
      arms.push({
        angle,
        drawn: drawnAngle(angle),
        seg,
        dir,
        heading,
        route,
        cls: roadClass(seg, routes),
        trace,
      });
    }
  }
  // One arm per direction: parallel exits (a slip road, a frontage road) merge into the better road.
  arms.sort((a, b) => a.cls - b.cls || b.seg.line.width - a.seg.line.width);
  // The two carriageways of one divided road leave the box as two exits a few tens of degrees
  // apart: one arm per road (same route or name within 60°), else per direction (25°).
  const sameRoad = (a: Arm, b: Arm) => !!a.route?.key && a.route.key === b.route?.key;
  const kept: Arm[] = [];
  for (const a of arms) {
    const twin = kept.find((k) => Math.abs(k.angle - a.angle) < (sameRoad(k, a) ? 60 : 25));
    if (!twin) kept.push(a);
    else if (sameRoad(twin, a)) twin.angle = (twin.angle + a.angle) / 2;
  }
  // Two arms drawn at one angle: the one further off it moves to the next 45° slot on its side if
  // that is free and within 35° of the real angle, else the lesser road is left off the board.
  const slots = new Map<number, Arm>();
  for (const a of kept) {
    const drawn = drawnAngle(a.angle);
    if (!slots.has(drawn)) {
      a.drawn = drawn;
      slots.set(drawn, a);
      continue;
    }
    const other = slots.get(drawn) as Arm;
    const [mover, stayer] =
      Math.abs(a.angle - drawn) >= Math.abs(other.angle - drawn) ? [a, other] : [other, a];
    const next = drawn + (mover.angle > drawn ? 45 : -45);
    const isFree = !slots.has(next) && Math.abs(next) < 150 && Math.abs(mover.angle - next) <= 35;
    slots.set(drawn, stayer);
    stayer.drawn = drawn;
    if (isFree) {
      mover.drawn = next;
      slots.set(next, mover);
    }
  }
  return [...slots.values()].toSorted((a, b) => Math.abs(a.drawn) - Math.abs(b.drawn));
}

// ---------------------------------------------------------------- destinations

type Candidate = { place: GuidePlace; dist: number };

/**
 * Nearest place of the given ranks the arm leads to. Within the traced road (the graph around the
 * player) a place must stand by it — 120 m, 250 m when OSM puts it on the arm's route; beyond the
 * trace's end it must lie ahead of the road's last heading — within 60° on the route, else in a
 * 28° cone, counted 1.35× as far.
 */
export function pickPlace(
  places: GuidePlace[],
  from: Vector3,
  trace: Trace,
  refs: string[],
  ranks: readonly number[],
  used: ReadonlySet<string>,
): Candidate | null {
  const end = trace.pts[trace.pts.length - 1] ?? from;
  const endDir = end
    .clone()
    .sub(traceAt(trace, Math.max(0, trace.length - 200)))
    .setY(0);
  if (endDir.lengthSq() < 1) endDir.copy(end).sub(from).setY(0);
  endDir.normalize();
  let best: Candidate | null = null;
  for (const place of places) {
    if (!ranks.includes(place.rank) || used.has(place.ja)) continue;
    const d0 = Math.hypot(place.pos.x - from.x, place.pos.z - from.z);
    const isOutOfReach = d0 < MIN_PLACE || d0 > (place.rank === 3 ? MAX_STATION : MAX_PLACE);
    if (isOutOfReach) continue;
    const isOnRoute = refs.some((r) => place.routes.has(r));
    const { dist, along } = onTrace(trace, place.pos);
    const isByTheRoad = along >= MIN_PLACE && along < trace.length - 1 && dist <= (isOnRoute ? 250 : 120);
    let score: number | null = isByTheRoad ? along + dist : null;
    if (score === null) {
      const vx = place.pos.x - end.x;
      const vz = place.pos.z - end.z;
      const dv = Math.hypot(vx, vz);
      const angle =
        dv > 1 ? Math.acos(Math.max(-1, Math.min(1, (vx * endDir.x + vz * endDir.z) / dv))) / DEG : 180;
      const isAhead = angle <= (isOnRoute ? 60 : 28);
      if (isAhead) score = trace.length + dv * (isOnRoute ? 1 : 1.35) * (1 + angle / 120);
    }
    if (score !== null && (!best || score < best.dist)) best = { place, dist: score };
  }
  return best;
}

/** The next junction of a place-like name down the arm (一般地 「沿道の著名な地点」), 250 m on at least. */
export function namedAlong(trace: Trace, names: GuideName[], used: ReadonlySet<string>): Candidate | null {
  let best: Candidate | null = null;
  for (const n of names) {
    if (used.has(n.ja) || !isPlaceLikeJunction(n.ja, n.en)) continue;
    const { dist, along } = onTrace(trace, n.pos);
    if (dist > 35 || along < 250 || (best && along >= best.dist)) continue;
    best = { place: { ja: n.ja, en: n.en, rank: 3, pos: n.pos, routes: new Set() }, dist: along };
  }
  return best;
}

const routeRefs = (route: RouteInfo | null): string[] =>
  route ? route.refs.map((r) => `${route.cls === 0 ? "N" : "P"}${r}`) : [];

/**
 * Names for one arm. Straight on, two names where the approach is a 主要幹線 or 幹線 road: the
 * nearest of the first rank on the left and of the second rank on the right — unless the first-rank
 * place is the nearer, when it moves right and the next first-rank place takes the left (国土交通省
 * 「案内標識のしくみ」ルール3). Elsewhere one name, of the rank the arm's road class calls for.
 */
export function armNames(
  arm: Arm,
  approachCls: RoadClass,
  centre: Vector3,
  places: GuidePlace[],
  names: GuideName[],
  used: Set<string>,
): GuidePlace[] {
  const refs = routeRefs(arm.route);
  const pick = (
    ranks: readonly number[],
    extra: ReadonlySet<string> = new Set(),
    reach = Infinity,
  ): Candidate | null => {
    const skip = new Set([...used, ...extra]);
    const fromPlaces = pickPlace(places, centre, arm.trace, refs, ranks, skip);
    const fromNames = ranks.includes(3) ? namedAlong(arm.trace, names, skip) : null;
    const best =
      fromPlaces && fromNames
        ? fromNames.dist <= fromPlaces.dist
          ? fromNames
          : fromPlaces
        : (fromPlaces ?? fromNames);
    return best && best.dist <= reach ? best : null;
  };
  const isStraight = Math.abs(arm.angle) < 30;
  const out: GuidePlace[] = [];
  if (isStraight && approachCls <= 1) {
    const [first, second] = approachCls === 0 ? [[1], [2]] : [[1, 2], [3]];
    const a = pick(first);
    const taken = new Set(a ? [a.place.ja] : []);
    const b = pick(second, taken) ?? (approachCls === 1 ? pick([4], taken) : null);
    if (a && b && a.dist < b.dist) {
      const a2 = pick(first, new Set([a.place.ja]));
      out.push(...(a2 ? [a2.place, a.place] : [a.place, b.place]));
    } else out.push(...[a, b].filter((c): c is Candidate => c !== null).map((c) => c.place));
  } else {
    // A ward (rank 4) only when nothing else is ahead: real boards seldom name one. A side street
    // (補助幹線 and below) names what is near; a 主要地 is borrowed only within 4 km.
    const near = 4000;
    const order: Array<[number[], number]> = isStraight
      ? [
          [[1, 2, 3], Infinity],
          [[4], Infinity],
        ]
      : arm.cls === 0
        ? [
            [[1], Infinity],
            [[2], Infinity],
            [[4], Infinity],
          ]
        : arm.cls === 1
          ? [
              [[2], Infinity],
              [[1], Infinity],
              [[4], Infinity],
            ]
          : [
              [[3], Infinity],
              [[2], near],
              [[1], near],
              [[4], near],
            ];
    for (const [ranks, reach] of order) {
      const c = pick(ranks, new Set(), reach);
      if (c) {
        out.push(c.place);
        break;
      }
    }
  }
  for (const p of out) used.add(p.ja);
  return out;
}

/** OSM `destination` mapped where the arm begins (the actual sign's content), if any. */
export function mappedDestination(arm: Arm, dests: GuideDest[]): GuideDest | null {
  const near = arm.trace.pts.slice(0, 1).concat(traceAt(arm.trace, 30), traceAt(arm.trace, 60));
  let best: { d: GuideDest; dist: number } | null = null;
  for (const d of dests) {
    if (d.heading.dot(arm.heading) < Math.cos(40 * DEG)) continue;
    const dist = Math.min(...near.map((p) => Math.hypot(p.x - d.pos.x, p.z - d.pos.z)));
    if (dist < 45 && (!best || dist < best.dist)) best = { d, dist };
  }
  return best?.d ?? null;
}

// ---------------------------------------------------------------- board contents

/** Lanes for this direction: JARTIC's count where it gave one, else from the width (3.25 m). */
export function lanesFor(seg: Segment): number {
  if (seg.lanes > 1) return seg.lanes;
  const width = seg.oneway === 0 ? seg.line.width / 2 : seg.line.width;
  return Math.max(1, Math.round(width / 3.25));
}

/**
 * 漢字 height (cm) by design speed and lanes: 国土交通省「案内標識の文字の大きさ」 (別表第二 備考一(五)2
 * with its 1.5× enlargement): 片側2車線以上 15 / 30 / 30 cm for ≤30, 40–60, ≥70 km/h, 片側1車線 10 / 20 / 30.
 * ローマ字 is half (the art module).
 */
export function letterHeight(designSpeed: number, lanes: number): number {
  const isWide = lanes >= 2;
  if (designSpeed <= 30) return isWide ? 15 : 10;
  if (designSpeed < 70) return isWide ? 30 : 20;
  return 30;
}

/** 予告 distance as printed: to the nearest 50 m, at least 100 m. */
export function printedDistance(metres: number): number {
  return Math.max(100, Math.round(metres / 50) * 50);
}

const shieldsOf = (route: RouteInfo | null): Shield[] =>
  route && route.cls <= 2
    ? route.refs.slice(0, 2).map((number) => ({ kind: route.cls === 0 ? "national" : "prefectural", number }))
    : [];

// 一般国道 through the 23 wards: a bare number in OSM destination:ref is one of these or a 都道.
const NATIONAL_TOKYO = new Set(["1", "4", "6", "14", "15", "17", "20", "122", "131", "246", "254", "357"]);

/** Shields for an OSM destination:ref ("R1" or "1" for 国道1号, "319" for 都道319号). */
export function refShields(ref: string): Shield[] {
  return ref
    .split(";")
    .map((r) => r.trim())
    .filter((r) => /^R?\d+$/.test(r))
    .slice(0, 2)
    .map((r) => {
      const number = r.replace(/^R/, "");
      const isNational = r.startsWith("R") || NATIONAL_TOKYO.has(number);
      return { kind: isNational ? "national" : "prefectural", number };
    });
}

/** A 通称名 the 108の3 / 108の4 box can show (国道 show their number instead, 設置基準 3-2-1). */
const streetOf = (route: RouteInfo | null): string | null =>
  route && route.cls > 0 && /(通り|街道|大通|新道)$/.test(route.name) ? route.name : null;

function signName(ja: string, en: string, places: GuidePlace[], names: GuideName[]): SignName {
  const known = en || places.find((p) => p.ja === ja)?.en || names.find((n) => n.ja === ja)?.en || "";
  return { ja, en: signEnglish(ja, known), expressway: isExpresswayName(ja) };
}

export type PlanInput = {
  graph: RoadGraph;
  approaches: GuideApproach[];
  routes: Map<number, RouteInfo>;
  places: GuidePlace[];
  names: GuideName[];
  dests: GuideDest[];
  /** Posts, poles and crossings the sign must keep clear of (y ignored). */
  avoid: Vector3[];
};

/** Board for an approach: arms with their names, shields and street boxes. */
export function boardFor(
  arms: Arm[],
  approachCls: RoadClass,
  approachRoute: RouteInfo | null,
  centre: Vector3,
  input: Pick<PlanInput, "places" | "names" | "dests">,
  letter: number,
  distance: number | null,
): BoardSpec {
  const used = new Set<string>();
  const specs: ArmSpec[] = [];
  // Straight on first: its first-rank place must not be taken by a side road.
  for (const arm of arms) {
    const mapped = mappedDestination(arm, input.dests);
    const names: SignName[] = mapped
      ? mapped.names.slice(0, 2).map((ja, i) => signName(ja, mapped.en[i] ?? "", input.places, input.names))
      : armNames(arm, approachCls, centre, input.places, input.names, used).map((p) =>
          signName(p.ja, p.en, input.places, input.names),
        );
    for (const n of names) used.add(n.ja);
    const street = streetOf(arm.route);
    const isSameRoad = !!arm.route && arm.route.key === approachRoute?.key && Math.abs(arm.angle) < 30;
    const own = shieldsOf(arm.route);
    const isNamed = street !== null && !isSameRoad;
    const shields = isNamed ? [] : own.length ? own : mapped ? refShields(mapped.ref) : [];
    specs.push({
      angle: arm.drawn,
      names,
      // The road carried on straight keeps its number on the arrow (図 229) but not its name.
      shields,
      street: isSameRoad ? null : street,
    });
  }
  const hasStreet = specs.some((s) => s.street !== null);
  const kind: BoardKind =
    distance === null ? (hasStreet ? "108の4" : "108の2-A") : hasStreet ? "108の3" : "108-A";
  return { kind, arms: specs, distance, letter };
}

/**
 * Walk `distance` metres up the road from (seg, s) against travel `dir`, taking the inflow that
 * runs most straight (within 30°). Returns the spot and the junction nodes passed, or null.
 */
export function walkBack(
  graph: RoadGraph,
  seg: Segment,
  s: number,
  dir: 1 | -1,
  distance: number,
): { seg: Segment; s: number; dir: 1 | -1; passed: number[] } | null {
  let cur = seg;
  let at = s;
  let d = dir;
  let left = distance;
  const passed: number[] = [];
  for (let steps = 0; steps < 100; steps++) {
    const room = d === 1 ? at : cur.length - at;
    if (room >= left) return { seg: cur, s: d === 1 ? at - left : at + left, dir: d, passed };
    left -= room;
    const node = d === 1 ? cur.from : cur.to;
    passed.push(node);
    const out = travelDir(graph, cur, d, false);
    let best: { seg: Segment; dir: 1 | -1; score: number } | null = null;
    for (const id of graph.nodes.get(node) ?? []) {
      const c = graph.segments[id];
      if (c === cur || c.line.kind === "highway") continue;
      const arrives: 1 | -1 = c.to === node ? 1 : -1;
      const isAllowed = c.oneway === 0 || c.oneway === arrives;
      if (!isAllowed) continue;
      const score = travelDir(graph, c, arrives, true).dot(out);
      if (score >= Math.cos(30 * DEG) && (!best || score > best.score))
        best = { seg: c, dir: arrives, score };
    }
    if (!best) return null;
    cur = best.seg;
    d = best.dir;
    at = d === 1 ? cur.length : 0;
  }
  return null;
}

/**
 * Where a sign `back` metres before the stop line can stand: on the left kerb, not on a bridge,
 * clear of every carriageway, 12 m from any junction node, 5 m from other posts, and without
 * passing another signalled junction on the way. Null when the spot fails.
 */
export function spotFor(
  graph: RoadGraph,
  ap: GuideApproach,
  back: number,
  signalled: ReadonlySet<number>,
  junctionNodes: Vector3[],
  avoid: Vector3[],
): { pos: Vector3; travel: Vector3; seg: Segment; centreline: Vector3 } | null {
  const stopS = ap.dir === 1 ? ap.at : ap.seg.length - ap.at;
  const w = walkBack(graph, ap.seg, stopS, ap.dir, back);
  if (!w) return null;
  const own = new Set(ap.nodes);
  const isPastOtherSignal = w.passed.some((n) => signalled.has(n) && !own.has(n));
  if (isPastOtherSignal || w.seg.line.bridge || w.seg.line.kind === "highway") return null;
  const { pos, dir } = graph.sample(w.seg, w.s);
  const travel = dir.clone().multiplyScalar(w.dir);
  const centreline = pos.clone();
  const kerb = pos.clone().add(leftOf(travel, w.seg.line.width / 2 + KERB_GAP));
  if (graph.carriagewaysAt(kerb, 0.3).length > 0) return null;
  // Between side streets, as on real streets with a crossing every 30 m: 12 m from any junction node.
  const isNearJunction = junctionNodes.some((n) => Math.hypot(n.x - centreline.x, n.z - centreline.z) < 12);
  if (isNearJunction) return null;
  const isCrowded = avoid.some((p) => Math.hypot(p.x - kerb.x, p.z - kerb.z) < 5);
  if (isCrowded) return null;
  return { pos: kerb, travel, seg: w.seg, centreline };
}

/** All 108 series signs for the signalled junctions of the graph. */
export function planGuideSigns(input: PlanInput): GuidePlan[] {
  const { graph, routes } = input;
  const junctionNodes: Vector3[] = [];
  for (const [node, ids] of graph.nodes) {
    if (ids.length < 3) continue;
    const p = nodePos(graph, node);
    if (p) junctionNodes.push(p);
  }
  const signalled = new Set(input.approaches.flatMap((a) => a.nodes));
  const plans: GuidePlan[] = [];
  const avoid = [...input.avoid];
  const isSpaced = (pos: Vector3, travel: Vector3) =>
    !plans.some((p) => {
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      return d < 4 || (d < MIN_SPACING && p.travel.dot(travel) > 0.7);
    });
  for (const ap of input.approaches) {
    const approachCls = roadClass(ap.seg, routes);
    const isArterial = approachCls <= 2 && ap.seg.line.width >= 7;
    if (!isArterial) continue;
    const nodes = ap.nodes.map((n) => nodePos(graph, n)).filter((p): p is Vector3 => p !== null);
    if (nodes.length === 0) continue;
    const centre = nodes.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / nodes.length);
    const arms = junctionArms(graph, ap, routes, centre);
    const turning = arms.filter((a) => Math.abs(a.angle) >= 30);
    // A guide junction: a numbered or named road crosses here (local side streets get none).
    const isGuideJunction = turning.some((a) => a.cls <= 2 || streetOf(a.route) !== null);
    if (!isGuideJunction) continue;
    const lanes = lanesFor(ap.seg);
    const design = Math.max(40, speedLimit(ap.seg));
    const letter = letterHeight(design, lanes);
    const mount: GuidePlan["mount"] = lanes >= 2 || ap.seg.line.width >= 9 ? "overhead" : "roadside";
    const shape = classifyShape(arms.map((a) => a.angle));
    const stop = graph.sample(ap.seg, ap.dir === 1 ? ap.at : ap.seg.length - ap.at).pos;
    const stopToCentre = Math.hypot(stop.x - centre.x, stop.z - centre.z);
    const approachRoute = routes.get(ap.seg.id) ?? null;
    const place = (backs: number[], advance: boolean) => {
      for (const back of backs) {
        const spot = spotFor(graph, ap, back, signalled, junctionNodes, avoid);
        if (!spot || !isSpaced(spot.pos, spot.travel)) continue;
        const before = back + stopToCentre;
        const board = boardFor(
          arms,
          approachCls,
          approachRoute,
          centre,
          input,
          letter,
          advance ? printedDistance(before) : null,
        );
        const hasNames = board.arms.some((a) => a.names.length > 0);
        if (!hasNames) return;
        plans.push({
          board,
          shape,
          pos: spot.pos,
          travel: spot.travel,
          mount,
          before,
          centre,
          seg: spot.seg,
        });
        avoid.push(spot.pos);
        return;
      }
    };
    place(BACK_JUNCTION, false);
    // 予告 where the approach has two lanes or more each way (片側1車線は「必要に応じて」).
    if (lanes >= 2) place(BACK_ADVANCE, true);
  }
  return plans;
}

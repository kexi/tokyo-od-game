import { Vector3 } from "three";
import { type DriveInput, RIDE_HEIGHT, type Vehicle } from "../physics/vehicle";
import type { ExpresswayDecks } from "../world/expresswayDeck";
import { laneCentreOffset } from "../world/laneChange";
import { log } from "../log";
import type { AutoDriver } from "../game/autoDriver";
import { leftOf, laneOffset, type RoadGraph, type RoadHit, type Segment, speedLimit } from "../world/roads";

/**
 * Dev-build hooks to drive the player's car over the expressway decks at a steady speed and
 * measure the ride (knowledge/road-redesign-plan.md 7: 落下・段差・合流の挙動), as
 * `window.__game.debug.expressway`. Imported only in the dev block of main.ts.
 *
 * `cruise` takes over the pedals and the wheel (main.ts debugDrive) with a pure-pursuit steer to
 * the centre of a lane ahead on the graph's segments, choosing at each node the segment of the
 * first preferred run that leaves it (else the same run, else any). Each physics frame it records
 * the car's height over the surface under it (graph.surfaceY of the segment RoadGraph.locate gives)
 * and its vertical speed; `stop` sums them up and logs `expressway_drive_checked`.
 *
 * Why not the autopilot: the navi and the autopilot are not opened to the expressway until P6
 * (EXPRESSWAY_OPEN), and this checks the decks, not the route planner.
 */

export type ExpresswayDriveDeps = {
  graph: () => RoadGraph | null;
  vehicle: Vehicle;
  decks: ExpresswayDecks;
  setDrive: (fn: ((dt: number) => DriveInput) | null) => void;
  snapCamera: () => void;
  /** The drawn terrain's height at a local (x, z), for a street with no surface of its own (placeOnStreet). */
  groundY?: (x: number, z: number) => number | null;
  /**
   * Why a drive now would not measure the decks (an accident in progress, a pursuit, a suspended
   * licence: the game may freeze the car for an arrest), or null.
   */
  blocker: () => string | null;
  /** The player's autopilot (main.ts), for `route` (P6). */
  autopilot?: {
    start: (target: Vector3) => boolean;
    driver: () => AutoDriver | null;
    input: () => DriveInput | null;
    violations: () => ReadonlyArray<{
      kind: string;
      at: number;
      context?: { detail?: string; lat?: number; lon?: number };
    }>;
    toLocal: (lat: number, lon: number) => Vector3;
  };
  /** The traffic AI on the expressway now (P6). */
  traffic?: () => { cars: number; onDeck: number; onRamps: number; merged: number; diverged: number };
  /** Put a traffic car on chunk `xid` at `share` of it, at `kmh` (P6: a main-line car timed to a merge). */
  placeTraffic?: (xid: string, share: number, kmh: number) => boolean;
  /** Traffic cars within 30 m of the player's car: ahead / side / up (m, in its frame) and speed (P2.7-5). */
  nearCars?: () => Array<{ ahead: number; side: number; up: number; mps: number }>;
  /** A local point's latitude and longitude (for where a drop happened). */
  toGeodetic?: (p: Vector3) => { lat: number; lon: number };
};

/**
 * A drop of more than DROP_KMH between two samples (P2.7-5: 47 → −2 km/h at 24402611:27 with dy
 * unchanged): where, what the car touched, the traffic near it, and the road graph / deck collider
 * swaps within DROP_WINDOW_S either side, to tell a car ahead, a collider and a reload apart.
 */
type Drop = {
  t: number;
  xid: string | null;
  /** Where on the chunk (m from its start) and on the map. */
  s: number | null;
  lat?: number;
  lon?: number;
  fromKmh: number;
  toKmh: number;
  off: number;
  y: number;
  touching: { buildings: number; other: number } | null;
  cars: Array<{ ahead: number; side: number; up: number; mps: number }>;
  swaps: Array<{ t: number; kind: "graph" | "colliders"; from?: number; to?: number }>;
};
const DROP_KMH = 15;
const DROP_WINDOW_S = 1;

/**
 * One ride sample. `kmh` the car's speed and `target` the cruise's own (so a wall that stops the car
 * shows as a drop far under the target), `off` its distance from its lane's centre (m).
 */
type Sample = {
  t: number;
  xid: string | null;
  dy: number;
  vy: number;
  ay: number;
  y: number;
  kmh: number;
  target: number;
  off: number;
  /** Where on its segment the surface was read (m) and the segment's length: a hit at an end is clamped. */
  at: number;
  len: number;
};

/** The ride is sampled at most this often (s of game time). */
const SAMPLE_S = 0.05;
/** `route` arrived: the car stopped this close to the place it was sent to (m). */
const ARRIVED_M = 80;
/** Side acceleration the cruise allows in a bend (m/s², a calm driver). */
const LATERAL_MS2 = 2.5;

/** The chunk of the sample where `f` is largest, or null for none. */
function argMax(xs: readonly Sample[], f: (x: Sample) => number): string | null {
  let best: Sample | null = null;
  for (const x of xs) if (best === null || f(x) > f(best)) best = x;
  return best?.xid ?? null;
}

/**
 * The surface hit to measure the ride against: `hit` itself, unless it is clamped to an end of its
 * segment and another deck segment holds the car inside it: one of the same run (the next chunk
 * past a seam), or one that meets this one at the clamped end's node, of whatever run (a viaduct
 * seamed into a ground run, S6 PR 7c1, F4).
 * Why: without a preferred run (the autopilot's route) the graph's locate ranks the slower-limit
 * segment first, and 4.8–5.2 m past 45021976:10's end it still answered :10, clamped at its last
 * station (z 15.410), 0.19–0.21 m under :11's face: a +0.14 m "bump" the car never felt (P2.7-5).
 * Across runs the same: 3.2 m before 4853798's seam into the ground run 203873824 the route's hit
 * stood clamped at 203873824:0's start, and the 8.96 % grade made it +0.213 m.
 */
export function insideHit<H extends { seg: Segment; s: number }>(
  graph: Pick<RoadGraph, "nearestOnSurface">,
  p: Vector3,
  hit: H,
): H {
  const isAtStart = hit.s <= 0.01;
  const isClamped = isAtStart || hit.s >= hit.seg.length - 0.01;
  if (!isClamped) return hit;
  const run = hit.seg.line.xid?.split(":")[0];
  if (run === undefined) return hit;
  const node = isAtStart ? hit.seg.from : hit.seg.to;
  const isNext = (seg: Segment) => {
    const isDeck = seg.line.xid !== undefined;
    const isSameRun = seg.line.xid?.split(":")[0] === run;
    const meetsHere = seg.from === node || seg.to === node;
    return seg !== hit.seg && isDeck && (isSameRun || meetsHere);
  };
  const other = graph.nearestOnSurface(p, 15, isNext);
  const isInsideOther = other !== null && other.s > 0.01 && other.s < other.seg.length - 0.01;
  return isInsideOther ? (other as unknown as H) : hit;
}

/** Whether a hit lies inside its segment (not clamped to an end). */
const isInsideHit = (h: RoadHit) => h.s > 0.01 && h.s < h.seg.length - 0.01;

/**
 * The surface the ride is measured against at p: the first of `prefer`'s runs (a cruise's own
 * decks, in order) the car is inside, else the nearest deck under the car among `onRoute` (the
 * autopilot's route now, as navGuide.ts locateCar picks the car's deck), else the graph's locate;
 * then insideHit. Why the route before locate (review of 7c1): locate ranks a main line over a
 * ramp (deckRank), and where the ramp 24402125:2 passes 1.6 m over the main line 45068170:0 the
 * main line was within SURFACE_GATE of the car: a "|dy| 1.6 m" the car on the ramp never felt.
 */
export function rideHit(
  graph: Pick<RoadGraph, "nearestOnSurface" | "locate">,
  p: Vector3,
  prefer: readonly string[],
  onRoute: ReadonlySet<Segment> | null,
): RoadHit | null {
  const hits = prefer
    .map((run) => graph.nearestOnSurface(p, 15, (seg) => seg.line.xid?.split(":")[0] === run))
    .filter((h) => h !== null);
  const own = hits.find(isInsideHit) ?? hits[0] ?? null;
  const isOnRoute = (seg: Segment) => onRoute !== null && onRoute.has(seg) && seg.line.xid !== undefined;
  const routed = own === null && onRoute !== null ? graph.nearestOnSurface(p, 15, isOnRoute) : null;
  const located = own ?? routed ?? graph.locate(p, 15, () => true);
  return located ? insideHit(graph, p, located) : null;
}

export function createExpresswayHooks(deps: ExpresswayDriveDeps) {
  let samples: Sample[] = [];
  let visited: string[] = [];
  let prev: { y: number; vy: number; t: number } | null = null;
  let t = 0;
  let distance = 0;
  let last: Vector3 | null = null;
  let lastTarget = 0;
  let drops: Drop[] = [];
  let swaps: Drop["swaps"] = [];
  let seenGraph: RoadGraph | null = null;
  let seenColliders = -1;

  /** Put the car on segment `xid` (an expressway chunk) at `share` of its length, in lane `lane`. */
  const place = (xid: string, share = 0.1, lane = 0): boolean => {
    const graph = deps.graph();
    const seg = graph?.segments.find((s) => s.line.xid === xid);
    if (!graph || !seg) return false;
    const s = seg.length * share;
    const { pos, dir } = graph.sample(seg, s);
    const y = graph.surfaceY(seg, s);
    if (y === null) return false;
    const at = pos.add(leftOf(dir, laneCentreOffset(seg, lane))).setY(y + RIDE_HEIGHT + 0.05);
    deps.vehicle.teleport(at, Math.atan2(dir.x, dir.z));
    deps.snapCamera();
    return true;
  };

  /**
   * Put the car on the street nearest (lat, lon) (within 30 m, the ground's: no deck), in the lane
   * the game drives (laneOffset: the left half of a two-way street, the middle of a one-way one),
   * facing towards `toward` (lat, lon). For the street drive's checks (S6 PR 7c: its first version put
   * the car a quarter of the width off the centre line, not in a lane, and on a 40 m street that was
   * the median's hole). Returns the street's width, one-way and the lane's offset, or null.
   */
  const placeOnStreet = (
    at: { lat: number; lon: number },
    toward: { lat: number; lon: number },
  ): { widthM: number; oneway: number; laneM: number } | null => {
    const graph = deps.graph();
    const toLocal = deps.autopilot?.toLocal;
    if (!graph || !toLocal) return null;
    const p = toLocal(at.lat, at.lon);
    const q = toLocal(toward.lat, toward.lon);
    const hit = graph.nearest(p, 30, (seg) => seg.line.xid === undefined);
    if (!hit) return null;
    const { pos, dir } = graph.sample(hit.seg, hit.s);
    const isAlong = dir.x * (q.x - p.x) + dir.z * (q.z - p.z) >= 0;
    const travel = isAlong ? dir : dir.clone().negate();
    const isAllowed = hit.seg.oneway === 0 || hit.seg.oneway === (isAlong ? 1 : -1);
    if (!isAllowed) return null;
    const laneM = laneOffset(hit.seg);
    const y = graph.surfaceY(hit.seg, hit.s) ?? deps.groundY?.(pos.x, pos.z) ?? pos.y;
    const car = pos.add(leftOf(travel, laneM)).setY(y + RIDE_HEIGHT + 0.3);
    deps.vehicle.teleport(car, Math.atan2(travel.x, travel.z));
    deps.snapCamera();
    return { widthM: hit.seg.line.width, oneway: hit.seg.oneway, laneM: Math.round(laneM * 100) / 100 };
  };

  /** The point `ahead` metres on along the preferred segments from (seg, s), in its lane. */
  const aimAt = (
    graph: RoadGraph,
    seg: Segment,
    s: number,
    ahead: number,
    prefer: string[],
    lane: number,
  ) => {
    let cur = seg;
    let at = s + ahead;
    for (let hop = 0; hop < 8 && at > cur.length; hop++) {
      const node = cur.oneway === -1 ? cur.from : cur.to;
      const exits = graph.exits(node, cur.id);
      if (exits.length === 0) break;
      const runOf = (x: Segment) => x.line.xid?.split(":")[0] ?? null;
      const preferred = prefer.map((run) => exits.find((x) => runOf(x) === run)).find((x) => x !== undefined);
      const sameRun = exits.find((x) => runOf(x) !== null && runOf(x) === runOf(cur));
      at -= cur.length;
      cur = preferred ?? sameRun ?? exits[0];
    }
    const sAt = Math.min(cur.length, at);
    const { pos, dir } = graph.sample(cur, sAt);
    const isDeck = cur.line.xid !== undefined;
    const offset = isDeck ? laneCentreOffset(cur, Math.min(lane, cur.lanes - 1)) : laneOffset(cur);
    return pos.add(leftOf(dir, offset));
  };

  /** deps.blocker() when the cruise began (null: nothing in the way). */
  let startBlocker: string | null = null;

  const cruise = (
    options: {
      kmh?: number;
      prefer?: string[];
      lane?: number;
      /** The segments of the route the car follows now (an autopilot's), for rideHit. */
      onRoute?: () => ReadonlySet<Segment> | null;
    } = {},
  ) => {
    const want = (options.kmh ?? 60) / 3.6;
    const prefer = options.prefer ?? [];
    const lane = options.lane ?? 0;
    samples = [];
    drops = [];
    swaps = [];
    seenGraph = deps.graph();
    seenColliders = deps.decks.colliderCount();
    startBlocker = deps.blocker();
    visited = [];
    prev = null;
    t = 0;
    distance = 0;
    last = null;
    deps.setDrive((dt) => {
      const graph = deps.graph();
      const v = deps.vehicle;
      const p = v.position();
      const speed = v.forwardSpeed();
      t += dt;
      const graphNow = graph;
      const isGraphSwapped = graphNow !== seenGraph;
      if (isGraphSwapped) swaps.push({ t, kind: "graph" });
      seenGraph = graphNow;
      const colliders = deps.decks.colliderCount();
      const isCollidersSwapped = colliders !== seenColliders;
      if (isCollidersSwapped) swaps.push({ t, kind: "colliders", from: seenColliders, to: colliders });
      seenColliders = colliders;
      // A change of origin moves the car by hundreds of metres in one frame: not a motion.
      const isJump = last !== null && last.distanceTo(p) > 5;
      if (isJump) prev = null;
      if (last && !isJump) distance += Math.hypot(p.x - last.x, p.z - last.z);
      last = p.clone();
      // The route's own deck first (in `prefer`'s order), then whatever the car is on: at a diverge
      // the game's locate answers the main line over the ramp (deckRank), and following that the
      // car would never leave it.
      // A hit clamped to its segment's end is the run the car has just left (or not reached yet):
      // where one run seams into the next (a viaduct into a tunnel, P9) the other run's hit inside
      // its segment is the surface under the car. Measured against the clamped one, a 6 % grade made
      // a 0.2–0.3 m "bump" for a few metres past every seam.
      const hit = graph ? rideHit(graph, p, prefer, options.onRoute?.() ?? null) : null;
      const xid = hit?.seg.line.xid ?? null;
      if (xid && visited[visited.length - 1] !== xid) visited.push(xid);
      const surface = hit && graph ? graph.surfaceY(hit.seg, hit.s) : null;
      // Over windows of at least SAMPLE_S: a frame's dt can be near 0 (advance() runs frames back
      // to back), which made a millimetre look like a jump.
      const window = prev ? t - prev.t : Infinity;
      const isDue = window >= SAMPLE_S;
      if (isDue) {
        const vy = prev ? (p.y - prev.y) / window : 0;
        const ay = prev ? (vy - prev.vy) / window : 0;
        prev = { y: p.y, vy, t };
        const isLane = hit !== null && hit.seg.line.xid !== undefined;
        const off = isLane
          ? Math.abs(hit.lateral - laneCentreOffset(hit.seg, Math.min(lane, hit.seg.lanes - 1)))
          : NaN;
        const before = samples[samples.length - 1];
        const isDrop = before !== undefined && before.kmh - speed * 3.6 > DROP_KMH;
        if (isDrop)
          drops.push({
            t,
            xid,
            s: hit ? Math.round(hit.s * 10) / 10 : null,
            ...(deps.toGeodetic ? deps.toGeodetic(p) : {}),
            fromKmh: Math.round(before.kmh * 10) / 10,
            toKmh: Math.round(speed * 36) / 10,
            off: Math.round(off * 100) / 100,
            y: Math.round(p.y * 1000) / 1000,
            touching: v.touching?.() ?? null,
            cars: deps.nearCars?.() ?? [],
            swaps: [],
          });
        samples.push({
          t,
          xid,
          dy: surface === null ? NaN : p.y - surface - RIDE_HEIGHT,
          vy,
          ay,
          y: p.y,
          kmh: speed * 3.6,
          target: lastTarget * 3.6,
          off,
          at: hit ? hit.s : NaN,
          len: hit ? hit.seg.length : NaN,
        });
      }
      if (!hit || !graph) return { throttle: 0, brake: 0.3, steer: 0, handbrake: false, brakeOnly: true };
      const ahead = Math.max(8, 0.9 * Math.abs(speed));
      const aim = aimAt(graph, hit.seg, hit.s, ahead, prefer, lane);
      const yaw = v.yaw();
      const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const dx = aim.x - p.x;
      const dz = aim.z - p.z;
      const leftward = dx * f.z - dz * f.x;
      const curvature = (2 * leftward) / Math.max(1, dx * dx + dz * dz);
      const steer = Math.max(-1, Math.min(1, Math.atan(curvature * 2.7) / 0.5));
      // Slow for the bends ahead as a driver would: the turn between 10 m and 40 m on the path
      // sets the radius, and the speed keeps the side acceleration under LATERAL_MS2 (a 20 km/h
      // ramp at 47 km/h rolled the car over). Never above the posted limit either.
      const near = aimAt(graph, hit.seg, hit.s, 10, prefer, lane);
      const far = aimAt(graph, hit.seg, hit.s, 40, prefer, lane);
      const mid = aimAt(graph, hit.seg, hit.s, 25, prefer, lane);
      const turn = Math.abs(
        Math.atan2(far.z - mid.z, far.x - mid.x) - Math.atan2(mid.z - near.z, mid.x - near.x),
      );
      const bend = Math.min(turn, 2 * Math.PI - turn) / 15;
      const posted = speedLimit(hit.seg) / 3.6;
      const target = Math.min(want, posted, Math.sqrt(LATERAL_MS2 / Math.max(bend, 1e-4)));
      lastTarget = target;
      const error = target - speed;
      const throttle = Math.max(0, Math.min(1, error * 0.35));
      const brake = error < -1 ? Math.min(1, -error * 0.2) : 0;
      return { throttle, brake, steer, handbrake: false, brakeOnly: true };
    });
  };

  /** Stop cruising; the ride's numbers (also logged as expressway_drive_checked). */
  const stop = (label = "cruise") => {
    deps.setDrive(null);
    const onDeck = samples.filter((s) => s.xid !== null && Number.isFinite(s.dy));
    const settled = onDeck.slice(Math.min(onDeck.length, 30));
    const maxAbs = (xs: number[]) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / Math.max(1, xs.length));
    // Fallen: well under the deck's surface while the graph still puts the car on a deck.
    const fell = settled.some((s) => s.dy < -1.5);
    // From the first time the car is up to its target (the run-up from a standstill is no hit).
    const upTo = settled.findIndex((s) => s.kmh >= 0.9 * s.target);
    const cruising = upTo < 0 ? [] : settled.slice(upTo);
    const summary = {
      label,
      seconds: Math.round(t * 10) / 10,
      distanceM: Math.round(distance),
      chunks: visited,
      frames: samples.length,
      deckFrames: onDeck.length,
      maxAbsDyM: Math.round(maxAbs(settled.map((s) => s.dy)) * 1000) / 1000,
      maxAbsVyMs: Math.round(maxAbs(settled.map((s) => s.vy)) * 1000) / 1000,
      rmsAyMs2: Math.round(rms(settled.map((s) => s.ay)) * 1000) / 1000,
      maxAbsAyMs2: Math.round(maxAbs(settled.map((s) => s.ay)) * 100) / 100,
      // A 壁高欄 hit stops the car or throws it off its lane: the largest shortfall under the cruise's
      // own target speed, and the largest distance from the lane's centre.
      maxShortfallKmh: Math.round(Math.max(0, ...cruising.map((s) => s.target - s.kmh)) * 10) / 10,
      maxLaneOffM: Math.round(maxAbs(settled.map((s) => s.off).filter(Number.isFinite)) * 100) / 100,
      // Where the largest of each was seen (the chunk the car was on), to tell a bend from a step.
      maxDyAt: argMax(settled, (x) => Math.abs(x.dy)),
      maxLaneOffAt: argMax(settled, (x) => (Number.isFinite(x.off) ? x.off : 0)),
      maxShortfallAt: argMax(cruising, (x) => x.target - x.kmh),
      fell,
      endsOnDeck: samples.length > 0 && samples[samples.length - 1].xid !== null,
      // Not a measurement of the decks when an accident or a pursuit was on at either end.
      invalid: startBlocker ?? deps.blocker(),
    };
    log("expressway_drive_checked", summary);
    if (!routed) return summary;
    const ap = deps.autopilot;
    const driver = ap?.driver() ?? null;
    const route = routed.route;
    const graph = deps.graph();
    const runOfId = (id: number) => graph?.segments[id]?.line.xid?.split(":")[0] ?? "?";
    const booked = (ap?.violations() ?? []).slice(routed.violationsFrom);
    const here = deps.vehicle.position();
    const target = routed.target();
    const arrived = Math.hypot(here.x - target.x, here.z - target.z) < ARRIVED_M;
    const driven = {
      label,
      seconds: summary.seconds,
      distanceM: summary.distanceM,
      runs: [...new Set(visited.map((x) => x.split(":")[0]))],
      links: (route?.links ?? []).map((l) => `${l.kind} ${runOfId(l.from)}→${runOfId(l.to)} ${l.side}`),
      calls: (route?.maneuvers ?? []).flatMap((m) =>
        m.xw ? [`${m.xw.kind}${m.xw.name ? ` ${m.xw.name}` : ""}`] : [],
      ),
      violations: booked.map((v) => {
        const where = v.context?.lat ? ` @${v.context.lat.toFixed(5)},${v.context.lon?.toFixed(5)}` : "";
        return `${v.kind}${v.context?.detail ? `: ${v.context.detail}` : ""}${where}`;
      }),
      maxAbsDyM: summary.maxAbsDyM,
      fell: summary.fell,
      arrived,
      gaveUp: driver?.gaveUp ?? routed.gaveUp ?? (arrived || driver !== null ? null : "stopped"),
      yieldedS: Math.round(routed.yieldedS * 10) / 10,
    };
    routed = null;
    log("expressway_route_driven", driven);
    return { ...summary, ...driven };
  };

  /** The autopilot's route of the last `route` call, and what happened on it. */
  let routed: {
    route: AutoDriver["route"];
    /**
     * The place asked for, in the frame of the moment it is asked: the world is re-anchored as the
     * car drives off (the origin moves with it), so a local point taken at the start is somewhere
     * else by the end.
     */
    target: () => Vector3;
    violationsFrom: number;
    yieldedS: number;
    gaveUp: string | null;
  } | null = null;

  /**
   * Drive the player's car to (lat, lon) on the game's own autopilot (the navi's route, over the
   * expressway where it is shorter), sampling the ride as `cruise` does (its sampler, not its
   * steering); `stop(label)` sums it up and logs expressway_route_driven too. False without a route.
   */
  const route = (to: { lat: number; lon: number }): boolean => {
    const ap = deps.autopilot;
    if (!ap) return false;
    const target = ap.toLocal(to.lat, to.lon);
    const isStarted = ap.start(target);
    if (!isStarted) return false;
    // The cruise's per-frame sampler, caught instead of installed (its pedals are not used).
    let sampler: ((dt: number) => DriveInput) | null = null;
    const install = deps.setDrive;
    deps.setDrive = (fn) => (sampler = fn);
    // The route's segments, made again only when the autopilot plans anew (a new graph, off route).
    let onRoute: { route: AutoDriver["route"]; segs: Set<Segment> } | null = null;
    const routeSegs = (): ReadonlySet<Segment> | null => {
      const now = ap.driver()?.route ?? null;
      if (!now) return null;
      const isSame = onRoute?.route === now;
      if (!isSame) onRoute = { route: now, segs: new Set(now.steps.map((st) => st.seg)) };
      return onRoute!.segs;
    };
    cruise({ onRoute: routeSegs });
    deps.setDrive = install;
    routed = {
      route: ap.driver()?.route ?? null,
      target: () => ap.toLocal(to.lat, to.lon),
      violationsFrom: ap.violations().length,
      yieldedS: 0,
      gaveUp: null,
    };
    install((dt) => {
      sampler?.(dt);
      const driver = ap.driver();
      if (routed && driver?.yieldingAtMerge) routed.yieldedS += dt;
      if (routed && driver?.gaveUp) routed.gaveUp = driver.gaveUp;
      return ap.input() ?? { throttle: 0, brake: 1, steer: 0, handbrake: false, brakeOnly: true };
    });
    return true;
  };

  /** What the traffic AI does on the expressway now (logged as expressway_traffic_seen). */
  const traffic = () => {
    const stats = deps.traffic?.() ?? null;
    if (stats) log("expressway_traffic_seen", stats);
    return stats;
  };

  /** A traffic car on chunk `xid` (debug.expressway.trafficAt): see deps.placeTraffic. */
  const trafficAt = (xid: string, share = 0.5, kmh = 50): boolean =>
    deps.placeTraffic?.(xid, share, kmh) ?? false;

  return {
    place,
    placeOnStreet,
    trafficAt,
    /** Why a drive now would not count (read before place(): drive-deck.ts waits it out). */
    blocker: () => deps.blocker(),
    cruise,
    route,
    traffic,
    stop,
    /** The raw samples of the last cruise (for plotting the ride). */
    samples: () => samples,
    /** The sudden drops of the last cruise, each with the swaps within DROP_WINDOW_S of it. */
    drops: () =>
      drops.map((d) => ({ ...d, swaps: swaps.filter((w) => Math.abs(w.t - d.t) <= DROP_WINDOW_S) })),
    colliders: () => deps.decks.colliderCount(),
  };
}

import { Vector3 } from "three";
import { type DriveInput, RIDE_HEIGHT, type Vehicle } from "../physics/vehicle";
import type { ExpresswayDecks } from "../world/expresswayDeck";
import { laneCentreOffset } from "../world/laneChange";
import { log } from "../log";
import { leftOf, laneOffset, type RoadGraph, type Segment, speedLimit } from "../world/roads";

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
};

type Sample = { t: number; xid: string | null; dy: number; vy: number; ay: number; y: number };

/** The ride is sampled at most this often (s of game time). */
const SAMPLE_S = 0.05;
/** Side acceleration the cruise allows in a bend (m/s², a calm driver). */
const LATERAL_MS2 = 2.5;

export function createExpresswayHooks(deps: ExpresswayDriveDeps) {
  let samples: Sample[] = [];
  let visited: string[] = [];
  let prev: { y: number; vy: number; t: number } | null = null;
  let t = 0;
  let distance = 0;
  let last: Vector3 | null = null;
  const anySurface = () => true;

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

  const cruise = (options: { kmh?: number; prefer?: string[]; lane?: number } = {}) => {
    const want = (options.kmh ?? 60) / 3.6;
    const prefer = options.prefer ?? [];
    const lane = options.lane ?? 0;
    samples = [];
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
      // A change of origin moves the car by hundreds of metres in one frame: not a motion.
      const isJump = last !== null && last.distanceTo(p) > 5;
      if (isJump) prev = null;
      if (last && !isJump) distance += Math.hypot(p.x - last.x, p.z - last.z);
      last = p.clone();
      // The route's own deck first (in `prefer`'s order), then whatever the car is on: at a diverge
      // the game's locate answers the main line over the ramp (deckRank), and following that the
      // car would never leave it.
      const own = prefer
        .map((run) => graph?.nearestOnSurface(p, 15, (seg) => seg.line.xid?.split(":")[0] === run) ?? null)
        .find((h) => h !== null);
      const hit = own ?? graph?.locate(p, 15, anySurface) ?? null;
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
        samples.push({ t, xid, dy: surface === null ? NaN : p.y - surface - RIDE_HEIGHT, vy, ay, y: p.y });
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
      fell,
      endsOnDeck: samples.length > 0 && samples[samples.length - 1].xid !== null,
    };
    log("expressway_drive_checked", summary);
    return summary;
  };

  return {
    place,
    cruise,
    stop,
    /** The raw samples of the last cruise (for plotting the ride). */
    samples: () => samples,
    colliders: () => deps.decks.colliderCount(),
  };
}

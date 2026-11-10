import type { View } from "./viewTable.ts";

/**
 * Where a view's eye stands and what it looks at, from the target the page found
 * (src/debug/viewHooks.ts ViewTarget), in the game's local frame: +X east, +Y up, −Z north.
 * Pure arithmetic, so the placements are unit-tested (tests/viewTable.test.ts) and the page only
 * puts the camera where it is told.
 */

export type Vec3 = { x: number; y: number; z: number };

/** The part of the page's ViewTarget the placement reads. */
export type FoundTarget = {
  point: Vec3;
  /** Unit horizontal facing (a plate's front); null for round things (a tower, a point). */
  normal: Vec3 | null;
  size: number;
  /** Deck surface points in travel order, `point` at `pathIndex` (expressway chunks). */
  path?: Vec3[];
  pathIndex?: number;
  facts?: Record<string, unknown>;
};

/**
 * An eye for the page: `above` is metres over the ground at x, z (the page reads the DEM there);
 * otherwise `y` is absolute (on a deck, or a free camera).
 */
export type EyeSpot = { x: number; z: number; y?: number; above?: number };

export type Placement = {
  eye: EyeSpot;
  lookAt: Vec3;
  fov: number;
  /** Where to park the player's car (shown in 後方追従), yaw as the game's (atan2(dx, dz)). */
  car?: { x: number; z: number; above: number; yaw: number };
  /**
   * Where to park the player's car with its headlamps lit (state.headlamps), facing the target. Its
   * body is hidden so it does not block the eye, but shown in 後方追従 (`showBody`).
   */
  lampCar?: { x: number; z: number; above: number; yaw: number; beam: "low" | "high"; showBody: boolean };
};

const DEG = Math.PI / 180;

/** Unit horizontal vector pointing along a compass bearing. */
export function bearingVector(deg: number): Vec3 {
  return { x: Math.sin(deg * DEG), y: 0, z: -Math.cos(deg * DEG) };
}

/** Compass bearing of a horizontal vector. */
export function bearingOf(v: Vec3): number {
  const deg = Math.atan2(v.x, -v.z) / DEG;
  return (deg + 360) % 360;
}

/** The eye's right as it looks along `forward` (horizontal). */
function rightOf(forward: Vec3): Vec3 {
  return { x: -forward.z, y: 0, z: forward.x };
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/** Default distances (m) by camera when a view gives none: big things are stood back from. */
function defaultDistance(view: View, target: FoundTarget): number {
  const base = view.camera === "pedestrian" ? 12 : 30;
  return Math.max(base, target.size * 1.2);
}

/**
 * The bearing from the target to the eye: the view's absolute one, else the target's facing turned
 * by `angleDeg`, else (a round thing) from the target towards `fallback` (the car at the start, so
 * the eye stands where the world has streamed in).
 */
export function eyeBearing(
  view: { bearingDeg?: number; angleDeg?: number },
  target: FoundTarget,
  fallback: Vec3,
): number {
  if (view.bearingDeg !== undefined) return view.bearingDeg;
  const angle = view.angleDeg ?? 0;
  if (target.normal) return bearingOf(target.normal) + angle;
  const toFallback = { x: fallback.x - target.point.x, y: 0, z: fallback.z - target.point.z };
  const isOnTop = Math.hypot(toFallback.x, toFallback.z) < 1;
  return (isOnTop ? 180 : bearingOf(toFallback)) + angle;
}

/**
 * A point `m` metres back along a deck path from `index` (towards its start), and the travel
 * direction there. Beyond the first station the path is extended straight.
 */
export function backAlongPath(path: Vec3[], index: number, m: number): { at: Vec3; forward: Vec3 } {
  let left = m;
  let i = index;
  while (i > 0) {
    const a = path[i - 1];
    const b = path[i];
    const step = Math.hypot(b.x - a.x, b.z - a.z);
    if (step >= left) {
      const k = left / step;
      const at = { x: b.x + (a.x - b.x) * k, y: b.y + (a.y - b.y) * k, z: b.z + (a.z - b.z) * k };
      return { at, forward: unit({ x: b.x - a.x, y: 0, z: b.z - a.z }) };
    }
    left -= step;
    i--;
  }
  const forward = unit({ x: path[1].x - path[0].x, y: 0, z: path[1].z - path[0].z });
  return { at: add(path[0], forward, -left), forward };
}

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/**
 * The eye and aim of a view. `target` is null only for `at` / free views; `car` is the player's car
 * now (the fallback side for round targets); `local` turns a geodetic point into the frame (the
 * page's targets.local, already resolved by the caller for `at` and free views).
 */
export function placeView(
  view: View,
  target: FoundTarget | null,
  ctx: { fov: number; car: Vec3; atLocal?: Vec3; eyeLocal?: Vec3; lookLocal?: Vec3 },
): Placement {
  const fov = view.fov ?? ctx.fov;
  if (view.camera === "free") {
    if (!ctx.eyeLocal || !ctx.lookLocal) throw new Error(`view ${view.id}: free camera points not resolved`);
    return { eye: { x: ctx.eyeLocal.x, y: ctx.eyeLocal.y, z: ctx.eyeLocal.z }, lookAt: ctx.lookLocal, fov };
  }
  if (view.camera === "overhead") {
    if (!target) throw new Error(`view ${view.id}: no target`);
    const bearing = eyeBearing(view, target, ctx.car);
    const back = view.altitudeM / Math.tan(view.pitchDeg * DEG);
    const isStraightDown = view.pitchDeg >= 89.9;
    const out = isStraightDown ? 0 : back;
    const eye = add(target.point, bearingVector(bearing), out);
    return { eye: { x: eye.x, z: eye.z, y: target.point.y + view.altitudeM }, lookAt: target.point, fov };
  }
  // driver, pedestrian, chase: standing on the ground (or the deck) at a distance.
  const eyeHeight = view.camera === "chase" ? view.heightM : view.eyeHeightM;
  if (!target) {
    if (!view.at || !ctx.atLocal) throw new Error(`view ${view.id}: give a target or at`);
    const forward = bearingVector(view.at.headingDeg);
    const stand = view.camera === "chase" ? add(ctx.atLocal, forward, -view.backM) : ctx.atLocal;
    const lookAt = add({ ...ctx.atLocal, y: ctx.atLocal.y + eyeHeight * 0.6 }, forward, view.at.lookAheadM);
    const car =
      view.camera === "chase" && view.showCar
        ? { x: ctx.atLocal.x, z: ctx.atLocal.z, above: 0.6, yaw: Math.atan2(forward.x, forward.z) }
        : undefined;
    return { eye: { x: stand.x, z: stand.z, above: eyeHeight }, lookAt, fov, car };
  }
  const distance = view.distanceM ?? defaultDistance(view, target);
  const back = view.camera === "chase" ? view.backM : 0;
  const isOnDeck = target.path !== undefined && target.pathIndex !== undefined && target.path.length > 1;
  if (isOnDeck) {
    // Along the deck: the eye rides the surface, so it neither floats nor sinks on a grade.
    const path = target.path as Vec3[];
    const index = target.pathIndex as number;
    const anchor = backAlongPath(path, index, distance);
    const stand = backAlongPath(path, index, distance + back);
    const side = rightOf(stand.forward);
    const eye = add(add(stand.at, side, view.lateralM), { x: 0, y: eyeHeight, z: 0 });
    const lookAt = { ...target.point, y: target.point.y + eyeHeight * 0.5 };
    const car =
      view.camera === "chase" && view.showCar
        ? { x: anchor.at.x, z: anchor.at.z, above: 0.6, yaw: Math.atan2(anchor.forward.x, anchor.forward.z) }
        : undefined;
    return { eye: { x: eye.x, z: eye.z, y: eye.y }, lookAt, fov, car };
  }
  const bearing = eyeBearing(view, target, ctx.car);
  const out = bearingVector(bearing);
  const toTarget = { x: -out.x, y: 0, z: -out.z };
  const side = rightOf(toTarget);
  const anchor = add(add(target.point, out, distance), side, view.lateralM);
  const stand = add(anchor, out, back);
  const car =
    view.camera === "chase" && view.showCar
      ? { x: anchor.x, z: anchor.z, above: 0.6, yaw: Math.atan2(toTarget.x, toTarget.z) }
      : undefined;
  const lamps = view.state?.headlamps;
  // 後方追従: the lit car is the one the camera follows (at `anchor`), the eye behind it.
  const isChase = view.camera === "chase";
  const lampCar = lamps
    ? { ...lampCarOf(view, target, ctx.car, lamps, isChase ? anchor : stand, distance), showBody: isChase }
    : undefined;
  return { eye: { x: stand.x, z: stand.z, above: eyeHeight }, lookAt: target.point, fov, car, lampCar };
}

/**
 * The lit car of state.headlamps: at `stand` (under the eye, or the followed car) unless the lamps give their own distance,
 * angle or offset, then on the target's facing as an eye would stand there; yaw towards the target.
 */
function lampCarOf(
  view: { angleDeg?: number; bearingDeg?: number; lateralM: number },
  target: FoundTarget,
  fallback: Vec3,
  lamps: { beam: "low" | "high"; distanceM?: number; angleDeg?: number; lateralM?: number; turnDeg: number },
  stand: Vec3,
  distance: number,
): Omit<NonNullable<Placement["lampCar"]>, "showBody"> {
  const isOwnSpot =
    lamps.distanceM !== undefined || lamps.angleDeg !== undefined || lamps.lateralM !== undefined;
  const at = isOwnSpot
    ? (() => {
        const bearing = eyeBearing({ angleDeg: lamps.angleDeg ?? view.angleDeg }, target, fallback);
        const out = bearingVector(bearing);
        const side = rightOf({ x: -out.x, y: 0, z: -out.z });
        return add(add(target.point, out, lamps.distanceM ?? distance), side, lamps.lateralM ?? 0);
      })()
    : stand;
  // The game's yaw is atan2(dx, dz); turning left (towards the car's +X) adds to it.
  const yaw = Math.atan2(target.point.x - at.x, target.point.z - at.z) + lamps.turnDeg * DEG;
  return { x: at.x, z: at.z, above: 0.6, yaw, beam: lamps.beam };
}

/**
 * How far from the middle of the frame the aim point fell (0 = centre, 1 = an edge), from its
 * normalised device coordinates. The camera looks at that very point, so this is near 0 by
 * construction: it catches a camera that did not take the pose (ground not loaded, a lookAt that
 * failed), not whether the thing is visible — that is the box's screen share and the reviewer's eye.
 */
export function offCentre(ndc: { x: number; y: number }): number {
  return Math.round(Math.hypot(ndc.x, ndc.y) * 1000) / 1000;
}
export const CENTRED_WITHIN = 0.2;

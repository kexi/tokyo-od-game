// How far the town round the car has loaded: the near town's load (loadProgress.ts) counted only
// over the tiles whose bounds reach a small sphere round the load's centre (the car, or a warp's
// destination). The loading screen and the warp's landing wait for this, not for the whole town
// (up to 4 km round, 234 tiles at 東京駅): play needs the street, its buildings and their colliders,
// and the rest streams in while driving. src/world/buildings.ts marks the tiles with NearbyMarks
// (a load region that sees every tile the renderer judges) and steps the count each frame.
//
// Why not a lower threshold on the whole town's progress: it does not look at which tiles remain,
// and the nearby ones can be the last 5 % (the warp to 川口駅 landed with 1 of 5 nearby tiles).
// Why not wait for the colliders: they are made from tiles shown, so "no building here yet" and
// "no building here" look the same.

import { SphereRegion } from "3d-tiles-renderer/plugins";
import { LOAD_HOLD_MS, stepLoad, type LoadState } from "./loadProgress";

/**
 * The sphere round the load's centre (m) whose tiles the screen and the warp wait for: wider than
 * the colliders' radius (BUILDING_COLLIDER_RADIUS, 260 m) and the full-detail one (250 m), so a
 * car that has just started finds its walls and the buildings beside it.
 */
export const NEARBY_RADIUS_M = 300;

/** What a mark needs of a tile's bounds (TileBoundingVolume has both). */
type Bounds = {
  intersectsSphere(sphere: SphereRegion["sphere"]): boolean;
  distanceToPoint(point: SphereRegion["sphere"]["center"]): number;
};

/**
 * A load region that never claims a tile, so what loads and shows is as without it, and marks
 * each tile it is asked about: nearby (with its bounds' distance from the centre) when its bounds
 * reach `sphere`, or when its parent's do; unmarked when neither. A tile keeps its last mark while
 * it is not judged (a download that carries on after its tile left the traversal).
 *
 * Why the parent's children too: a parent stays shown until all its children are in, so a child
 * just outside the sphere holds the coarse parent over the nearby street (川崎駅: two children at
 * 367 m kept their parent shown over the station after the screen closed). One level only: the
 * parent counts by its own bounds, else every tile under the root would be nearby.
 * Why a region: LoadRegionPlugin asks every region about every tile it judges, parents before
 * children, with the tile's bounds, so the marks come from the same bounds the renderer loads by,
 * and no field inside the library is read (`parent` is the tile's own, typed). Why not mask: a
 * mask that says no would hide tiles.
 */
export class NearbyMarks extends SphereRegion {
  private readonly distances = new WeakMap<object, number>();
  /** The tiles whose own bounds reached the sphere when last judged. */
  private readonly reaching = new WeakSet<object>();
  constructor() {
    super({ mask: false });
    this.sphere.radius = NEARBY_RADIUS_M;
  }

  intersectsTile(...args: Parameters<SphereRegion["intersectsTile"]>): boolean {
    const bounds = args[0] as unknown as Bounds;
    const tile = args[1] as { parent?: object | null };
    const reaches = bounds.intersectsSphere(this.sphere);
    if (reaches) this.reaching.add(tile);
    else this.reaching.delete(tile);
    const isParentReaching = tile.parent != null && this.reaching.has(tile.parent);
    const isNearby = reaches || isParentReaching;
    if (isNearby) this.distances.set(tile, bounds.distanceToPoint(this.sphere.center));
    else this.distances.delete(tile);
    return false;
  }

  /** The tile's bounds' distance from the centre (m) if it was nearby when last judged, else undefined. */
  distanceOf(tile: object): number | undefined {
    return this.distances.get(tile);
  }
}

/** The tiles of `loading` (queued, downloading or parsing) that are marked nearby. */
export function nearbyLoading<T>(loading: Iterable<T>, isNearby: (tile: T) => boolean): Set<T> {
  const out = new Set<T>();
  for (const tile of loading) if (isNearby(tile)) out.add(tile);
  return out;
}

/** How many of `before` are no longer in `now`: finished (loaded, failed or dropped) or moved off. */
export function countLeft<T>(before: ReadonlySet<T>, now: ReadonlySet<T>): number {
  let left = 0;
  for (const tile of before) if (!now.has(tile)) left++;
  return left;
}

/** This frame's nearby counts: what still loads nearby, what has left that since the start, whether the root is in. */
export type NearbyCounts = { remaining: number; finished: number; isRootLoaded: boolean };

/**
 * The next nearby state: as stepLoad (1 only once nothing nearby has remained for the hold), but
 * 0 until the root tileset is in, when nothing is requested yet and so nothing remains.
 */
export function stepNearby(
  state: LoadState,
  counts: NearbyCounts,
  now: number,
  hold = LOAD_HOLD_MS,
): LoadState {
  const isWaitingForRoot = !counts.isRootLoaded;
  if (isWaitingForRoot) return { progress: 0, finishedAtStart: counts.finished, zeroSince: null };
  return stepLoad(state, { remaining: counts.remaining, finished: counts.finished }, now, hold);
}

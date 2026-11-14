// The lanes probe's judgement (scripts/expresswayLanesProbe.ts, the ledger's lane-in-site), kept apart
// from the files and tiles it reads so that it can be tested: whether a lane's centre runs within an
// embankment's slab. Plane positions are three's Vector3 in a LocalFrame (x east, z south; y unused).
import type { Vector3 } from "three";

/** Shorter than this within the slab is a street's end at the site's edge, not a lane over it (m). */
export const MIN_LENGTH_M = 3;
/**
 * Past the slab's first or last station by less than this, the nearest point on the centre line is its
 * end and the distance is to the end face, not to the slab beside the lane: not counted (m).
 */
export const END_FACE_M = 0.5;
/** An embankment's slab: its centre line (points and their run distances) and the edge's offset. */
export type SiteLine = { centre: readonly Vector3[]; s: readonly number[]; edgeM: number };

/** A lane's stretch within a slab: its length (1 m samples), nearest distance and run distances. */
export type LaneOverSite = { lengthM: number; nearestM: number; s0: number; s1: number };

/** One place: a street's lanes within an embankment's slab, as the ledger's lane-in-site reads it. */
export type SiteLanes = {
  run: string;
  /** The chunk holding `s0` (a mark for the views; the key does not use it). */
  chunk: string;
  s0: number;
  s1: number;
  lengthM: number;
  streetM: number;
  nearestM: number;
  lanes: number;
};

/** Distance from (x, z) to the slab's centre line and the run distance at the nearest point. */
export function siteDistance(site: SiteLine, x: number, z: number): [number, number] {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < site.centre.length; i++) {
    const [a, b] = [site.centre[i], site.centre[i + 1]];
    const [ex, ez] = [b.x - a.x, b.z - a.z];
    const l2 = ex * ex + ez * ez;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
    if (d < best) {
      best = d;
      at = site.s[i] + (site.s[i + 1] - site.s[i]) * t;
    }
  }
  return [best, at];
}

/**
 * A lane's centre points (one per metre along it) against a slab: each point within the edge
 * (`dist ≤ edgeM`) and more than END_FACE_M inside the slab's first and last stations counts 1 m.
 * Null when that is under MIN_LENGTH_M.
 */
export function laneOverSite(points: readonly Vector3[], site: SiteLine): LaneOverSite | null {
  const [sFirst, sLast] = [site.s[0], site.s[site.s.length - 1]];
  let lengthM = 0;
  let nearestM = Infinity;
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const p of points) {
    const [dist, at] = siteDistance(site, p.x, p.z);
    const isOver = dist <= site.edgeM && at > sFirst + END_FACE_M && at < sLast - END_FACE_M;
    if (!isOver) continue;
    lengthM++;
    nearestM = Math.min(nearestM, dist);
    s0 = Math.min(s0, at);
    s1 = Math.max(s1, at);
  }
  const isTooShort = lengthM < MIN_LENGTH_M;
  if (isTooShort) return null;
  return { lengthM, nearestM, s0, s1 };
}

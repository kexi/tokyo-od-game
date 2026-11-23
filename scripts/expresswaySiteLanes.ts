// The lanes probe's judgement (scripts/expresswayLanesProbe.ts, the ledger's lane-in-site), kept apart
// from the files and tiles it reads so that it can be tested: whether a lane's centre runs within an
// embankment's slab, how the places a street's pieces make are merged, and how they are numbered for
// the ledger's key. Plane positions are three's Vector3 in a LocalFrame (x east, z south; y unused).
import type { Vector3 } from "three";

/**
 * Shorter than MIN_LENGTH_M within the slab is a street's end at the site's edge, not a lane over it;
 * places of one run and street width closer than JOIN_GAP_M along the run are one place (m). The
 * game's same-road test (expresswayRoads.ts sameRoadJudgements, P2.7 R1-2b) uses the same two.
 */
import { JOIN_GAP_M, MIN_LENGTH_M } from "../src/world/expresswayRoads.ts";
export { JOIN_GAP_M, MIN_LENGTH_M };
/**
 * Past the slab's first or last station by less than this, the nearest point on the centre line is its
 * end and the distance is to the end face, not to the slab beside the lane: not counted (m).
 */
export const END_FACE_M = 0.5;
/**
 * How far past a cut's hole edge a lane's centre counts as over the site (m): half a car's width and a
 * margin (the hole lanes probe's, scripts/expresswayHoleLanes.ts; here so the street drive's known
 * cases reach as far, R1-5 PR A).
 */
export const HOLE_SITE_MARGIN_M = 1;

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

/**
 * The places of one street's pieces (split by the graph's nodes, and by the chunks the probe walks)
 * merged: one place per run and street width while each starts within JOIN_GAP_M of the one before's
 * end, keeping the first's chunk. Sorted by run, then s0.
 */
export function mergeSitePlaces(places: readonly SiteLanes[]): SiteLanes[] {
  const sorted = places.toSorted((a, b) => (a.run === b.run ? a.s0 - b.s0 : a.run < b.run ? -1 : 1));
  const merged: SiteLanes[] = [];
  const open = new Map<string, SiteLanes>();
  for (const p of sorted) {
    const group = `${p.run}|${p.streetM}`;
    const last = open.get(group);
    const isJoined = last !== undefined && p.s0 <= last.s1 + JOIN_GAP_M;
    if (isJoined) {
      last.s1 = Math.max(last.s1, p.s1);
      last.lengthM = Math.max(last.lengthM, p.lengthM);
      last.nearestM = Math.min(last.nearestM, p.nearestM);
      last.lanes = Math.max(last.lanes, p.lanes);
      continue;
    }
    const next = { ...p };
    merged.push(next);
    open.set(group, next);
  }
  return merged;
}

/**
 * The ledger key of each place (in the list's order): `lane-in-site:<run>|w<street width>|<n>`, n
 * counting the run's places of that width from 1 in order of s0. Why not the chunk and the rounded
 * stretch (before A2): a rebuild that shifts a chunk's number or the stretch by a metre made every case
 * gone + new. Why not a street's ID: GSI's RoadLine has none that is stable (roadTiles.ts reads the
 * width and the kind only). Why not a rounded lat/lon: the place's extent moves with the slab, and a
 * rounded point jumps across a cell's edge. Its limit: the key names no place, so a place of the same
 * run and width added or gone renumbers those after it, and a renumbered or new place takes over a
 * key decided for another. What sends it back to new is the cap, which holds the stretch (lane-in-site's
 * CAP_FIELDS: lengthM, s0, s1, within CASE_MARGIN), not the key.
 */
export function sitePlaceKeys(list: readonly SiteLanes[]): string[] {
  const order = list.map((p, i) => ({ p, i })).toSorted((a, b) => a.p.s0 - b.p.s0);
  const n = new Map<string, number>();
  const keys: string[] = Array.from({ length: list.length });
  for (const { p, i } of order) {
    const group = `${p.run}|w${p.streetM}`;
    const k = (n.get(group) ?? 0) + 1;
    n.set(group, k);
    keys[i] = `lane-in-site:${group}|${k}`;
  }
  return keys;
}

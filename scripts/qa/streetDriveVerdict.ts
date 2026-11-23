/**
 * What fails a street drive (scripts/qa/street-drive.ts, P2.7 R1-5 PR A), from what the drive saw:
 * each failure as a short reason. The checks and their numbers are S6 PR 7c's street drive's (the
 * copy .qa/street-drive.mts): arrived within ARRIVE_M of the end, the car's height over the ground
 * within RIDE_BAND at every 0.25 s sample, no fall, no building crossed, no stall, no respawn.
 *
 * Where the drive failed inside a case the ledger takes (lane-in-site: a street's lanes in an
 * embankment's slab; street-lane-over-cut: lanes over a cut's site), the drive is `known`, with the
 * cases: not a pass, and counted apart from the failures (R1-5 3.3).
 * Why not known as a pass: the ledger takes "a lane lies there", not "a car may fall there"; the
 * counts are shown apart for R1-7's judgement.
 */

/** How near the end the car must stop to have arrived (m; 7c's street drive). */
export const ARRIVE_M = 10;
/**
 * The car body's height over the ground under it on a street (m; 7c's street drive): its resting
 * ride is 0.7–0.9 m. The ground is `__game.groundY(x, z)` without a height to look from: the DEM (a
 * bridge's deck over water), so a car fallen into a cut's hole is metres under it, one up on a deck
 * metres over it.
 */
export const RIDE_BAND = [0.4, 1.3] as const;

/** A point where the drive went wrong (lat, lon) and what went wrong there. */
export type StreetFault = { what: string; lat: number; lon: number };

export type StreetDriveRide = {
  /** The autopilot took the drive (debug.expressway.route answered true). */
  started: boolean;
  /** The car's distance from the drive's end when it stopped (m). */
  endM: number;
  /** debug.expressway.stop's `fell` (counted on a deck only: on a street it is false). */
  fell: boolean;
  /** The 0.25 s samples of the car's height over the ground: how many, under and over RIDE_BAND. */
  over: { n: number; below: number; above: number };
  /** expressway_building_crossed, expressway_car_stalled (both on a deck only) and car_respawned lines. */
  crossed: number;
  stalled: number;
  respawned: number;
};

export function streetDriveFailures(ride: StreetDriveRide): string[] {
  const failures: string[] = [];
  if (!ride.started) failures.push("no route (debug.expressway.route answered false)");
  // Why its own failure: with no sample the band below could not fail, and only the end's distance
  // was left to fail a drive that never moved (R1-5 PR A, a gap in 7c's check filled, no new number).
  const isUnmeasured = ride.over.n === 0;
  if (isUnmeasured) failures.push("no sample of the car's height over the ground");
  const isArrived = ride.endM <= ARRIVE_M;
  if (!isArrived) failures.push(`stopped ${ride.endM} m from the end (over ${ARRIVE_M} m)`);
  const isUnder = ride.over.below > 0;
  if (isUnder)
    failures.push(`under the ground's band ${RIDE_BAND[0]} m in ${ride.over.below} samples (fallen)`);
  const isOver = ride.over.above > 0;
  if (isOver)
    failures.push(
      `over the ground's band ${RIDE_BAND[1]} m in ${ride.over.above} samples (up a deck or a wall)`,
    );
  if (ride.fell) failures.push("fell off a deck");
  const isCrossed = ride.crossed > 0;
  if (isCrossed) failures.push(`building crossed (${ride.crossed})`);
  const isStalled = ride.stalled > 0;
  if (isStalled) failures.push(`stalled on a deck (${ride.stalled})`);
  const isRespawned = ride.respawned > 0;
  if (isRespawned) failures.push(`put back by the game (car_respawned ${ride.respawned})`);
  return failures;
}

/**
 * A case of the ledger a street drive may fail in, as the probes write them (--cases): the run, the
 * run distances it covers and how far from the run's centre line it reaches (m).
 * - lane-in-site (scripts/expresswayLanesProbe.ts): s0–s1 of the lanes in the slab; the slab's edge
 *   is the chunk's half width and the parapet (the probe's edgeM).
 * - street-lane-over-cut (scripts/expresswayHoleLanes.ts): the run's cut site, every s; its hole's
 *   half width (holeHalfM) and the probe's margin.
 */
export type KnownCase = { key: string; run: string; s0: number; s1: number; reachM: number };

/** A point's place along a run: its run distance and its distance from the centre line (m). */
export type RunProjection = { s: number; offM: number };

/**
 * The cases every fault lies in (a fault in none: []). `project` puts a point on a case's run (null
 * when the point is not along it). A drive that failed with no fault point (no route, no sample) is
 * no known case: nothing of it lies anywhere.
 */
export function knownCasesOf(
  faults: readonly StreetFault[],
  cases: readonly KnownCase[],
  project: (run: string, lat: number, lon: number) => RunProjection | null,
): string[] {
  const hasFaults = faults.length > 0;
  if (!hasFaults) return [];
  const keys = new Set<string>();
  for (const f of faults) {
    const inside = cases.filter((c) => {
      const p = project(c.run, f.lat, f.lon);
      if (p === null) return false;
      return p.s >= c.s0 && p.s <= c.s1 && p.offM <= c.reachM;
    });
    const isOutside = inside.length === 0;
    if (isOutside) return [];
    for (const c of inside) keys.add(c.key);
  }
  return [...keys].toSorted();
}

export type StreetVerdict = "pass" | "fail" | "known";

/** pass: no failure; known: failed, every fault inside a ledger case; else fail. */
export function streetVerdict(failures: readonly string[], known: readonly string[]): StreetVerdict {
  const isClean = failures.length === 0;
  if (isClean) return "pass";
  const isKnown = known.length > 0;
  return isKnown ? "known" : "fail";
}

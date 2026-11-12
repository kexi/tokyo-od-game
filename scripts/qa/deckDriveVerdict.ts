/**
 * What fails a drive over the decks (scripts/qa/drive-deck.ts), from the ride's summary
 * (debug.expressway.stop) and the logs: each failure as a short reason. A drive that ends where it
 * should, with nothing below, has none.
 */

/** The cruise fell this far under its own target speed at most (km/h): more is a wall or a step. */
export const MAX_SHORTFALL_KMH = 15;
/**
 * The car's height over the deck under it varies by this much at most (m, after the run-up): more is
 * a step or a seam the car bounces on (P2.7-5 4.4). Why 0.15: P3.5's merged decks drove at 0.02–0.08.
 */
export const MAX_ABS_DY_M = 0.15;

export type DeckDriveRide = {
  fell: boolean;
  maxAbsDyM: number;
  maxShortfallKmh: number;
  maxShortfallAt: string | null;
  maxDyAt: string | null;
  chunks: string[];
};

export type DeckDriveSeen = {
  /** expressway_building_crossed lines. */
  crossed: number;
  /** expressway_car_stalled lines (the car stood still on a deck, held or touching). */
  stalled: number;
  /** The car came off the decks at the route's end (onto the street the exit ramp meets). */
  reachedEnd: boolean;
};

export function deckDriveFailures(ride: DeckDriveRide, seen: DeckDriveSeen): string[] {
  const failures: string[] = [];
  const isCrossed = seen.crossed > 0;
  if (isCrossed) failures.push(`building crossed on a deck (${seen.crossed})`);
  // Why not leave a stall to the log (as before): a car stopped dead by a 壁高欄 ended every drive
  // standing at 24402611:31 and still exited 0, so the check passed a wall across the lane.
  const isStalled = seen.stalled > 0;
  if (isStalled) failures.push(`stalled on a deck (${seen.stalled})`);
  if (ride.fell) failures.push(`fell off a deck (at ${ride.maxDyAt ?? "?"})`);
  const isBouncing = ride.maxAbsDyM > MAX_ABS_DY_M;
  if (isBouncing)
    failures.push(`|dy| ${ride.maxAbsDyM} m over ${MAX_ABS_DY_M} m (at ${ride.maxDyAt ?? "?"})`);
  const isSlowed = ride.maxShortfallKmh > MAX_SHORTFALL_KMH;
  if (isSlowed)
    failures.push(`slowed ${ride.maxShortfallKmh} km/h under its target (at ${ride.maxShortfallAt ?? "?"})`);
  if (!seen.reachedEnd)
    failures.push(`did not reach the end of the route (last ${ride.chunks.at(-1) ?? "none"})`);
  return failures;
}

/** What the autopilot's drive (debug.expressway.route, then stop) gives back. */
export type AutoDriveRide = {
  fell: boolean;
  maxAbsDyM: number;
  maxDyAt: string | null;
  arrived: boolean;
  gaveUp: string | null;
  violations: string[];
};

/**
 * What fails an autopilot route (P6's drives, P2.7-5 4.4): arriving and booking no violation, and on
 * the way what fails a cruise but the speed (the autopilot keeps its own: a queue is no wall).
 */
export function autoDriveFailures(ride: AutoDriveRide, seen: Omit<DeckDriveSeen, "reachedEnd">): string[] {
  const failures: string[] = [];
  const isCrossed = seen.crossed > 0;
  if (isCrossed) failures.push(`building crossed on a deck (${seen.crossed})`);
  const isStalled = seen.stalled > 0;
  if (isStalled) failures.push(`stalled on a deck (${seen.stalled})`);
  if (ride.fell) failures.push(`fell off a deck (at ${ride.maxDyAt ?? "?"})`);
  const isBouncing = ride.maxAbsDyM > MAX_ABS_DY_M;
  if (isBouncing)
    failures.push(`|dy| ${ride.maxAbsDyM} m over ${MAX_ABS_DY_M} m (at ${ride.maxDyAt ?? "?"})`);
  if (!ride.arrived) failures.push(`did not arrive (${ride.gaveUp ?? "stopped short"})`);
  const isBooked = ride.violations.length > 0;
  if (isBooked) failures.push(`violations booked: ${ride.violations.join("; ")}`);
  return failures;
}

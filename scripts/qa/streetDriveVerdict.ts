/**
 * What fails a street drive (scripts/qa/street-drive.ts, P2.7 R1-5 PR A), from what the drive saw:
 * each failure as its kind, a short reason and the points where it happened. The checks and their
 * numbers are S6 PR 7c's street drive's (the copy .qa/street-drive.mts): arrived within ARRIVE_M of
 * the end, the car's height over the ground within RIDE_BAND at every 0.25 s sample, no fall, no
 * building crossed, no stall, no respawn.
 *
 * Where every failure of a drive happened inside a case the ledger takes (lane-in-site: a street's
 * lanes in an embankment's slab; street-lane-over-cut: lanes over a cut's site), the drive is `known`,
 * with the cases: not a pass, and counted apart from the failures (R1-5 3.3).
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

export type LatLon = { lat: number; lon: number };

/** What went wrong, without its count (the unit main's drive is compared by, againstMain). */
export type FailureKind =
  | "no-run"
  | "unplaced"
  | "no-ride"
  | "no-route"
  | "no-sample"
  | "stopped-short"
  | "under"
  | "over"
  | "fell"
  | "crossed"
  | "stalled"
  | "respawned";

/**
 * One failure: its kind, a short reason, and where it happened (every point: each sample off the
 * band, each logged building, stall and respawn, the car's stop), or null when it has no place (no
 * route, no sample, a fall the hook does not place).
 */
export type StreetFailure = { kind: FailureKind; text: string; points: LatLon[] | null };

export type StreetDriveRide = {
  /** The autopilot took the drive (debug.expressway.route answered true). */
  started: boolean;
  /** The car's distance from the drive's end when it stopped (m, as measured: not rounded). */
  endM: number;
  /** debug.expressway.stop's `fell` (counted on a deck only: on a street it is false). */
  fell: boolean;
  /** How many 0.25 s samples of the car's height over the ground were taken. */
  samples: number;
  /** Where the car was at each sample under and over RIDE_BAND. */
  below: LatLon[];
  above: LatLon[];
  /** The lat/lon of each expressway_building_crossed, expressway_car_stalled and car_respawned line. */
  crossed: LatLon[];
  stalled: LatLon[];
  respawned: LatLon[];
  /** Where the car stopped. */
  end: LatLon;
};

const round1 = (m: number) => Math.round(m * 10) / 10;

export function streetDriveFailures(ride: StreetDriveRide): StreetFailure[] {
  const failures: StreetFailure[] = [];
  const isUnstarted = !ride.started;
  if (isUnstarted)
    failures.push({
      kind: "no-route",
      text: "no route (debug.expressway.route answered false)",
      points: null,
    });
  // Why its own failure: with no sample the band below could not fail, and only the end's distance
  // was left to fail a drive that never moved (R1-5 PR A, a gap in 7c's check filled, no new number).
  const isUnmeasured = ride.samples === 0;
  if (isUnmeasured)
    failures.push({ kind: "no-sample", text: "no sample of the car's height over the ground", points: null });
  // The distance as measured (7c compared it unrounded): rounded, 10.04 m read as 10.0 and arrived.
  const isArrived = ride.endM <= ARRIVE_M;
  if (!isArrived)
    failures.push({
      kind: "stopped-short",
      text: `stopped ${round1(ride.endM)} m from the end (over ${ARRIVE_M} m)`,
      points: [ride.end],
    });
  const isUnder = ride.below.length > 0;
  if (isUnder)
    failures.push({
      kind: "under",
      text: `under the ground's band ${RIDE_BAND[0]} m in ${ride.below.length} samples (fallen)`,
      points: ride.below,
    });
  const isOver = ride.above.length > 0;
  if (isOver)
    failures.push({
      kind: "over",
      text: `over the ground's band ${RIDE_BAND[1]} m in ${ride.above.length} samples (up a deck or a wall)`,
      points: ride.above,
    });
  const hasFallen = ride.fell;
  if (hasFallen) failures.push({ kind: "fell", text: "fell off a deck", points: null });
  const isCrossed = ride.crossed.length > 0;
  if (isCrossed)
    failures.push({
      kind: "crossed",
      text: `building crossed (${ride.crossed.length})`,
      points: ride.crossed,
    });
  const isStalled = ride.stalled.length > 0;
  if (isStalled)
    failures.push({
      kind: "stalled",
      text: `stalled on a deck (${ride.stalled.length})`,
      points: ride.stalled,
    });
  const isRespawned = ride.respawned.length > 0;
  if (isRespawned)
    failures.push({
      kind: "respawned",
      text: `put back by the game (car_respawned ${ride.respawned.length})`,
      points: ride.respawned,
    });
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

export type Project = (run: string, lat: number, lon: number) => RunProjection | null;

/**
 * The cases the drive's failures lie in, when every point of every failure lies in one ([] else). A
 * failure with no point (no route, no sample, a fall) makes the drive no known case: nothing of it is
 * known to lie anywhere. Why every point and not the first (as before): a car that sank inside a case
 * and then crossed a building or climbed a deck outside it was read as known (PR #132 review, M2).
 */
export function knownCasesOf(
  failures: readonly StreetFailure[],
  cases: readonly KnownCase[],
  project: Project,
): string[] {
  const hasFailures = failures.length > 0;
  if (!hasFailures) return [];
  const isUnplaced = failures.some((f) => f.points === null || f.points.length === 0);
  if (isUnplaced) return [];
  const keys = new Set<string>();
  for (const f of failures) {
    for (const pt of f.points!) {
      const inside = cases.filter((c) => {
        const p = project(c.run, pt.lat, pt.lon);
        const isAlong = p !== null;
        return isAlong && p.s >= c.s0 && p.s <= c.s1 && p.offM <= c.reachM;
      });
      const isOutside = inside.length === 0;
      if (isOutside) return [];
      for (const c of inside) keys.add(c.key);
    }
  }
  return [...keys].toSorted();
}

export type StreetVerdict = "pass" | "fail" | "known" | "known-main";

/** pass: no failure; known: failed, every failure inside a ledger case; else fail. */
export function streetVerdict(failures: readonly StreetFailure[], known: readonly string[]): StreetVerdict {
  const isClean = failures.length === 0;
  if (isClean) return "pass";
  const isKnown = known.length > 0;
  return isKnown ? "known" : "fail";
}

/** The kinds of a drive's failures, each once, sorted (what main's drive is compared by). */
export const kindsOf = (failures: readonly StreetFailure[]): FailureKind[] =>
  [...new Set(failures.map((f) => f.kind))].toSorted();

/** main's drive of the same place (`--baseline`): its verdict and the kinds of its failures. */
export type MainDrive = { verdict: string; kinds: readonly string[] };

/**
 * A failure set against main's drive of the same place (`--baseline`, R1-5 PR A): S7-6 is held to
 * "no failure main's result does not have", where main's result is main's checkout driven on main's
 * data (the coordinator's decision, 2026-11-24). A fail is `known-main` only when every kind of it
 * is a kind main failed with too (counts apart: a stop 5 m further is the same kind); one new kind
 * keeps it a fail. A place main passed, did not drive or drove invalid keeps its verdict.
 * Why kinds and not the place (as before): main fails 13 of the 18 default places, and by place any
 * new failure there (a respawn where main only sank) was hidden (PR #132 review, M3).
 * Why not a pass where main fails: main's failure is the game's defect now; it is only not this change's.
 */
export function againstMain(
  verdict: StreetVerdict,
  kinds: readonly FailureKind[],
  main: MainDrive | null,
): StreetVerdict {
  const isFail = verdict === "fail";
  if (!isFail) return verdict;
  const isNoMain = main === null;
  if (isNoMain) return verdict;
  const didMainFail = main.verdict === "fail" || main.verdict === "known" || main.verdict === "known-main";
  if (!didMainFail) return verdict;
  const isOld = kinds.every((k) => main.kinds.includes(k));
  return isOld ? "known-main" : verdict;
}

/** A run's summary: the places by verdict, and the table's places with no result of this run. */
export type StreetSummary = {
  pass: readonly string[];
  fail: readonly string[];
  known: readonly string[];
  knownMain: readonly string[];
  invalid: readonly string[];
  missing: readonly string[];
};

/**
 * The run's exit code: 1 a failure, 2 an invalid place, 5 a place of the table with no result of
 * this run (a part driven with --only, or a result of other data), 3 a known failure, 4 only
 * known-main ones, 0 all passed. Why missing is not 0: a folder driven in parts read green half done.
 */
export function exitCodeOf(s: StreetSummary): number {
  const hasFail = s.fail.length > 0;
  if (hasFail) return 1;
  const hasInvalid = s.invalid.length > 0;
  if (hasInvalid) return 2;
  const hasMissing = s.missing.length > 0;
  if (hasMissing) return 5;
  const hasKnown = s.known.length > 0;
  if (hasKnown) return 3;
  const hasKnownMain = s.knownMain.length > 0;
  if (hasKnownMain) return 4;
  return 0;
}

/** One place's drive as the tool records it, before it is judged. */
export type StreetDriveTry = {
  /** Why the drive does not count (driveInvalid.ts), or null. */
  invalid: string | null;
  /** Why the car could not be driven at all (no run in the data, no lane to put it in), or none. */
  error?: { kind: "no-run" | "unplaced"; text: string };
  ride?: StreetDriveRide;
};

export type StreetJudgement = {
  verdict: StreetVerdict | "invalid";
  failures: StreetFailure[];
  kinds: FailureKind[];
  known: string[];
};

/**
 * One place's verdict from its last try: invalid as it is; an error, or a try with no ride, as a
 * failure with no point (never known, never a pass); else the ride's failures, the ledger cases they
 * lie in, and main's drive of the place.
 */
export function judgeStreetDrive(
  last: StreetDriveTry,
  cases: readonly KnownCase[],
  project: Project,
  main: MainDrive | null,
): StreetJudgement {
  const failures: StreetFailure[] = last.error
    ? [{ kind: last.error.kind, text: last.error.text, points: null }]
    : last.ride
      ? streetDriveFailures(last.ride)
      : [{ kind: "no-ride", text: "nothing driven", points: null }];
  const kinds = kindsOf(failures);
  const known = knownCasesOf(failures, cases, project);
  const isInvalid = last.invalid !== null;
  const verdict = isInvalid ? "invalid" : againstMain(streetVerdict(failures, known), kinds, main);
  return { verdict, failures, kinds, known };
}

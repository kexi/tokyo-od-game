/**
 * 追跡の段階. A patrol that saw a violation lights up and calls the car over (stage 1: firmer calls,
 * the siren, the HUD chip). A driver who does not pull over is fleeing; the longer it goes on the
 * more of the police it brings: 緊急配備 (stage 2: more units from nearby streets, the radio, the
 * navi's emergency-vehicle notice) and then the helicopter overhead and a 検問 on the way ahead
 * (stage 3). It ends when the car stands near a unit (pulled over, gave up, boxed in, crashed,
 * stopped at the 検問) or when every unit has lost it for a while (escaped).
 *
 * Pure: the scene (pursuitScene.ts) feeds it what the world measured each frame and acts on what it
 * returns. Times are seconds of play (dt), so the 設定 pause and the replay, which stop the frame
 * before this runs, stop the clock too.
 */
export type PursuitStage = 1 | 2 | 3;
/**
 * pulledOver: stopped near the unit without ever fleeing. gaveUp: fled, then stopped of their own
 * accord. boxedIn: stopped with the accelerator down and police around (blocked, not stopping).
 * crashed: stopped right after an accident. checkpoint: stopped at the 検問. escaped: all lost.
 */
export type PursuitEnd = "pulledOver" | "gaveUp" | "boxedIn" | "crashed" | "checkpoint" | "escaped";

/** Seconds a driver has to start pulling over before it counts as not stopping. */
export const GRACE_S = 12;
/** Pulling over is slowing down: above this after the grace, the car is going on. */
export const FLEE_KMH = 25;
/** A gap this wide is pulling away, whenever it opens. */
export const PULL_AWAY_M = 120;
/** Fleeing this long (s since the pursuit began) brings 緊急配備, then the helicopter and a 検問. */
export const STAGE_AT: Record<2 | 3, number> = { 2: 30, 3: 60 };
/** The patrol's call-over distance and how long the car must stand there (policePatrol.ts's). */
export const STOP_GAP_M = 22;
export const STOP_HOLD_S = 2.5;
const STOPPED_KMH = 3.6;
/** A unit this far behind has lost sight of the car (the plate was read: policePatrol.ts LOST). */
export const LOST_M = 450;
/**
 * How long every ground unit must be beyond LOST_M with the helicopter blind before the car has
 * got away: at once while one car follows (today's rule), longer once the area is being covered.
 */
export const ESCAPE_HOLD_S: Record<PursuitStage, number> = { 1: 0, 2: 25, 3: 40 };
/** An accident this recent makes a stop a crash. */
export const CRASH_RECENT_S = 6;
const BOXED_THROTTLE = 0.3;
/** Units this close round a car that will not move count as boxing it in (unitsClose). */
export const BOXED_RANGE_M = 15;

export type PursuitInput = {
  dt: number;
  speedKmh: number;
  /** Accelerator (0–1) the driver is pressing now. */
  throttle: number;
  /** Metres to the nearest unit in the pursuit (Infinity: none). */
  nearestUnit: number;
  /** Units of the pursuit within BOXED_RANGE_M of the car. */
  unitsClose: number;
  /** The helicopter has the car in sight now. */
  heliSees: boolean;
  /** The car is at the 検問 (within its zone). */
  atCheckpoint: boolean;
  /** Seconds since the player's last accident (Infinity: none). */
  sinceCrash: number;
};

export type PursuitEvent =
  | { type: "fleeing" }
  | { type: "stage"; stage: PursuitStage }
  | { type: "end"; end: PursuitEnd };

export class PursuitEscalation {
  elapsed = 0;
  stage: PursuitStage = 1;
  /** Once true it stays: the driver did not stop when called (the officer's tone, the law). */
  fleeing = false;
  /** Seconds since fleeing began (0 before). */
  fledFor = 0;
  ended: PursuitEnd | null = null;
  private stoppedFor = 0;
  private lostFor = 0;
  /** The accelerator was pressed during the current stop (blocked, not stopping). */
  private pushedWhileStopped = false;
  /** Seconds the stop check is held off (debug: to see the stages with the car standing). */
  private stopHeld = 0;

  /** Hold off judging a stop for `seconds` (a staged pursuit in the dev build). */
  holdStop(seconds: number): void {
    this.stopHeld = Math.max(this.stopHeld, seconds);
    this.stoppedFor = 0;
  }

  update(i: PursuitInput): PursuitEvent[] {
    if (this.ended) return [];
    const events: PursuitEvent[] = [];
    this.elapsed += i.dt;
    if (this.fleeing) this.fledFor += i.dt;
    if (!this.fleeing && isFleeing(this.elapsed, i.speedKmh, i.nearestUnit)) {
      this.fleeing = true;
      events.push({ type: "fleeing" });
    }
    const due = stageAt(this.fledFor > 0 || this.fleeing ? this.elapsed : 0);
    while (this.fleeing && this.stage < due) {
      this.stage = (this.stage + 1) as PursuitStage;
      events.push({ type: "stage", stage: this.stage });
    }
    const end = this.checkStop(i) ?? this.checkLost(i);
    if (end) {
      this.ended = end;
      events.push({ type: "end", end });
    }
    return events;
  }

  /** The car stands near a unit (or at the 検問) long enough: how the pursuit ended. */
  private checkStop(i: PursuitInput): PursuitEnd | null {
    if (this.stopHeld > 0) {
      this.stopHeld = Math.max(0, this.stopHeld - i.dt);
      return null;
    }
    const isNear = i.nearestUnit < STOP_GAP_M || i.atCheckpoint;
    const isStanding = Math.abs(i.speedKmh) < STOPPED_KMH && isNear;
    this.stoppedFor = isStanding ? this.stoppedFor + i.dt : 0;
    if (!isStanding) this.pushedWhileStopped = false;
    const isPushing = i.throttle > BOXED_THROTTLE;
    if (isStanding && isPushing) this.pushedWhileStopped = true;
    if (this.stoppedFor < STOP_HOLD_S) return null;
    return stopKind({
      fleeing: this.fleeing,
      atCheckpoint: i.atCheckpoint,
      sinceCrash: i.sinceCrash,
      pushed: this.pushedWhileStopped,
      unitsClose: i.unitsClose,
    });
  }

  /** Every unit lost (and the helicopter blind) for the stage's hold: the car got away. */
  private checkLost(i: PursuitInput): PursuitEnd | null {
    const isLost = i.nearestUnit > LOST_M && !i.heliSees;
    this.lostFor = isLost ? this.lostFor + i.dt : 0;
    const isGone = isLost && this.lostFor >= ESCAPE_HOLD_S[this.stage];
    return isGone ? "escaped" : null;
  }
}

/** Not stopping: going on above FLEE_KMH after the grace, still moving at twice the grace, or pulling away. */
export function isFleeing(elapsed: number, speedKmh: number, nearestUnit: number): boolean {
  const isGoingOn = elapsed >= GRACE_S && Math.abs(speedKmh) > FLEE_KMH;
  const isStillMoving = elapsed >= GRACE_S * 2 && Math.abs(speedKmh) > 5;
  const isPullingAway = nearestUnit > PULL_AWAY_M && nearestUnit < Infinity;
  return isGoingOn || isStillMoving || isPullingAway;
}

/** The stage a pursuit `elapsed` seconds old has reached while the driver flees. */
export function stageAt(elapsed: number): PursuitStage {
  if (elapsed >= STAGE_AT[3]) return 3;
  if (elapsed >= STAGE_AT[2]) return 2;
  return 1;
}

/** How a stop near the police came about (see PursuitEnd). */
export function stopKind(s: {
  fleeing: boolean;
  atCheckpoint: boolean;
  sinceCrash: number;
  pushed: boolean;
  unitsClose: number;
}): PursuitEnd {
  if (!s.fleeing) return "pulledOver";
  if (s.atCheckpoint) return "checkpoint";
  if (s.sinceCrash < CRASH_RECENT_S) return "crashed";
  const isBlocked = s.pushed && s.unitsClose > 0;
  if (isBlocked) return "boxedIn";
  return "gaveUp";
}

/** Whether the pursuit ended with the driver caught rather than stopping of their own accord. */
export function isCaught(end: PursuitEnd): boolean {
  return end === "boxedIn" || end === "crashed" || end === "checkpoint";
}

/**
 * The loudspeaker line for the n-th call (0 first): polite at first, firmer as the car goes on,
 * and a word to the other traffic once the chase is on. Keys of src/i18n (police.*).
 */
export function calloutKey(n: number, fleeing: boolean, stage: PursuitStage): CalloutKey {
  if (!fleeing) return n === 0 ? "police.callStop" : "police.callStopShort";
  if (stage >= 3) return n % 2 === 0 ? "police.callStopDanger" : "police.callTraffic";
  if (stage === 2) return n % 2 === 0 ? "police.callStopFirm" : "police.callTraffic";
  return "police.callStopFirm";
}
export type CalloutKey =
  | "police.callStop"
  | "police.callStopShort"
  | "police.callStopFirm"
  | "police.callStopDanger"
  | "police.callTraffic";

/** Everything that counts as the police dealing with the player now. */
export type EnforcementState = {
  /** A unit pursuing the car or standing behind it with its lights on. */
  unitEngaged: boolean;
  /** The pursuit, the roadside stop, the story panels or the identification after a getaway. */
  pursuitBusy: boolean;
  /** The ticket dialog is open. */
  ticketOpen: boolean;
  /** The arrest screen (#suspended) is shown. */
  arrestShown: boolean;
  /** The accident response is chasing a ひき逃げ. */
  hitAndRunChase: boolean;
};

/**
 * Whether the police are dealing with the player: then 移動, 復帰 (R), getting out of the car,
 * タイトルへ and ending the day at home wait, or they would be a way out of the pursuit and what
 * follows it. One check for all of them, so a new phase only has to be counted here.
 */
export function isEnforcing(s: EnforcementState): boolean {
  return s.unitEngaged || s.pursuitBusy || s.ticketOpen || s.arrestShown || s.hitAndRunChase;
}

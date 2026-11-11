import type { ViolationKind } from "./traffic";

/**
 * The rules of 道路交通法 第4章の2 (高速自動車国道等における自動車の交通方法等の特例) as the game
 * judges them on the expressway decks (knowledge/road-redesign-plan.md 4.9, P6). Pure: main.ts
 * feeds it what the car does on the road it is on (RoadGraph.locate) and books what comes back.
 * Why not in main.ts with the street checks: each rule here is defined by numbers (seconds, metres,
 * m/s²) that a test can hold to, both ways (booked when it should, not when it should not).
 *
 * The 都市高速 is a 自動車専用道路, so the chapter applies (第75条の2の3); the main line is 本線車道
 * (第2条第1項第3号の2: the 本線車線 of an 自動車専用道路), a ramp (連結路) is not. What is judged:
 *
 * - 第75条の5 横断・転回・後退: on 本線車道 only (a ramp is no 本線車道). 転回 is the heading turning
 *   from with the traffic to against it on the same main line; 後退 is moving backwards while facing
 *   the way the traffic goes. 横断 (across the carriageway) cannot happen between the 壁高欄 and
 *   is not judged.
 * - 逆走 (driving forward against the traffic) is 通行区分違反 (第17条第4項), on any expressway road.
 * - 第75条の8 駐停車: standing still on any expressway road (本線, ramp), except 渋滞 (a vehicle
 *   standing just ahead in the lane), stopping to prevent danger (just after a collision), waiting
 *   to merge as 第75条の6 requires, and 第1項第2号: broken down (hazard lamps) on a shoulder wide
 *   enough for the car. The data's shoulders (第8条: 1.25 / 0.75 m) are narrower than a car, so
 *   that exception only holds where a wider one is given.
 * - 第20条第1項 通行帯: on a main line of two lanes or more the rightmost lane is for overtaking; as
 *   on the streets (main.ts), driving along in it for 20 s is 通行帯違反. Getting ready for an exit
 *   on the right is 第20条第3項 (道路の状況その他の事情によりやむを得ないとき).
 * - 第75条の6 進行妨害 at a merge and 第75条の7 本線車道の出入の方法: judgeMerge / judgeExit.
 * - 第75条の4 最低速度: not judged. It is for 高速自動車国道 only, and the 都市高速 is not one.
 */

/** Which expressway road the car is on: 本線車道 (main) or a 連結路 (ramp). */
export type XwRoadKind = "main" | "ramp";

/** One look at the car on an expressway road (main.ts, five times a second). */
export type XwSample = {
  /** Game-loop time (ms). */
  now: number;
  /** The road the car is on: null when it is not on the expressway (the checks reset). */
  road: {
    /** Identity of the road (the run: two chunks of one main line are the same road). */
    id: string;
    kind: XwRoadKind;
    lanes: number;
    /** Lane the car is in, from the left (0); −1 left of the lanes, `lanes` right of them. */
    lane: number;
    /** Shoulder widths (m) left and right of the lanes (第8条). */
    shoulderL: number;
    shoulderR: number;
  } | null;
  /** Speed along the traffic's direction (m/s): + with it, − backwards or against it. */
  along: number;
  /** Cosine of the angle between the car's heading and the traffic's direction. */
  facing: number;
  /** |speed| (km/h). */
  kmh: number;
  /** Hazard lamps on (the car shows it is broken down or stopped for a reason, 第75条の11). */
  hazard: boolean;
  /** A vehicle stands or crawls within QUEUE_M ahead in the car's lane (渋滞). */
  queueAhead: boolean;
  /** Seconds since the car's last collision (stopping to prevent danger, 第75条の8第1項). */
  sinceCrashS: number;
  /**
   * A stop the law or the police call for (第75条の8第1項 法令の規定若しくは警察官の命令): a red
   * signal or a stop line just ahead (a ramp's ground end at a street), a patrol's stop, a ticket
   * being written.
   */
  mustStop: boolean;
  /** An accident is being dealt with (救護・報告, 第72条): the car stays where it is. */
  accident: boolean;
  /** The car is on a ramp's last stretch waiting for a gap in the main line (第75条の6). */
  waitingToMerge: boolean;
  /** An exit or a branch to the right comes within RIGHT_EXIT_M on the route. */
  rightExitAhead: boolean;
};

/** What a check found: the violation and the words for the record (an i18n key and its values). */
export type XwFinding = {
  kind: ViolationKind;
  detail: { key: XwDetailKey; params?: Record<string, number | string> };
};

export type XwDetailKey =
  | "violationDetail.xwUturn"
  | "violationDetail.xwReverse"
  | "violationDetail.xwWrongWay"
  | "violationDetail.xwStoppingMain"
  | "violationDetail.xwStoppingRamp"
  | "violationDetail.xwRightLane"
  | "violationDetail.xwMergeObstruct"
  | "violationDetail.xwMergeCutIn"
  | "violationDetail.xwMergeNoAccel"
  | "violationDetail.xwExitLate";

/** The game's thresholds, not the law's (it gives none): seconds and metres a check waits for. */
export const XW_LAW = {
  /** 後退: backwards at more than this (m/s, 1.8 km/h) for REVERSE_S. */
  reverseMps: 0.5,
  reverseS: 1,
  /** 逆走: forward against the traffic above this speed (km/h) for WRONG_WAY_S. */
  wrongWayKmh: 5,
  wrongWayS: 1.5,
  /** 転回: the heading flips (cos beyond ±0.7) within this long on the same main line (s). */
  uturnWindowS: 20,
  /** 駐停車: standing (under 1 km/h) this long (s). A stop of a second or two in traffic is not booked. */
  standKmh: 1,
  standS: 10,
  /** 危険防止: a stop within this long after a collision (s); while an accident is dealt with, any time. */
  crashS: 60,
  /** 転回: not within this long after a collision (a spin turns the car round), s. */
  spinS: 10,
  /** 転回: moving on against the traffic faster than this (m/s) — under its own power. */
  againstMps: 1,
  /** A car (1.7 m wide) needs at least this wide a shoulder to stand clear of the lanes (m, 第75条の8第1項第2号). */
  carWidthM: 1.7,
  /** 通行帯: in the rightmost lane this long (s) without an exit to the right ahead. */
  rightLaneS: 20,
  rightLaneKmh: 10,
} as const;

/** How close ahead a standing vehicle makes a queue (m). */
export const QUEUE_M = 25;
/** How far ahead an exit on the right lets the car keep to the right lane (m). */
export const RIGHT_EXIT_M = 1000;

type Since = number | null;

/** The checks that need time (how long something has gone on), one per car. */
export class ExpresswayLaw {
  private reverseSince: Since = null;
  private wrongSince: Since = null;
  private standSince: Since = null;
  private rightSince: Since = null;
  /** The last heading with the traffic on a main line: where and when. */
  private withTraffic: { road: string; at: number } | null = null;
  private booked = new Set<string>();

  /** Off the expressway, or jumped (warp, respawn): start over. */
  reset(): void {
    this.reverseSince = null;
    this.wrongSince = null;
    this.standSince = null;
    this.rightSince = null;
    this.withTraffic = null;
    this.booked.clear();
  }

  step(x: XwSample): XwFinding[] {
    const road = x.road;
    if (!road) {
      this.reset();
      return [];
    }
    const out: XwFinding[] = [];
    const isMain = road.kind === "main";
    const isFacingTraffic = x.facing > 0.7;
    const isFacingAgainst = x.facing < -0.7;
    const elapsed = (since: Since) => (since === null ? 0 : (x.now - since) / 1000);

    // 第75条の5 後退: facing the traffic's way and moving backwards, on 本線車道.
    const isBacking = isMain && x.facing > 0.5 && x.along < -XW_LAW.reverseMps;
    this.reverseSince = isBacking ? (this.reverseSince ?? x.now) : null;
    if (!isBacking) this.booked.delete(`reverse:${road.id}`);
    const isReversing = elapsed(this.reverseSince) >= XW_LAW.reverseS;
    if (isReversing && this.once(`reverse:${road.id}`))
      out.push({ kind: "xwCrossing", detail: { key: "violationDetail.xwReverse" } });

    // 第75条の5 転回: with the traffic, then against it, on the same main line.
    const isMoving = x.kmh > XW_LAW.wrongWayKmh;
    if (isMain && isFacingTraffic && isMoving) {
      this.withTraffic = { road: road.id, at: x.now };
      this.booked.delete(`uturn:${road.id}`);
    }
    // Turned round under its own power: driving on against the traffic, not spun round by a crash
    // (a spin ends facing anywhere, standing or sliding).
    const isDrivingAgainst = x.along < -XW_LAW.againstMps;
    const isAfterSpin = x.sinceCrashS < XW_LAW.spinS;
    const turnedRound =
      isMain &&
      isFacingAgainst &&
      isMoving &&
      isDrivingAgainst &&
      !isAfterSpin &&
      this.withTraffic !== null &&
      this.withTraffic.road === road.id &&
      x.now - this.withTraffic.at < XW_LAW.uturnWindowS * 1000;
    if (turnedRound && this.once(`uturn:${road.id}`)) {
      this.withTraffic = null;
      out.push({ kind: "xwCrossing", detail: { key: "violationDetail.xwUturn" } });
    }

    // 逆走 (第17条第4項): driving forward against the traffic.
    const isAgainst = isFacingAgainst && x.along < 0 && x.kmh > XW_LAW.wrongWayKmh;
    this.wrongSince = isAgainst ? (this.wrongSince ?? x.now) : null;
    if (!isAgainst) this.booked.delete(`wrong:${road.id}`);
    const isWrongWay = elapsed(this.wrongSince) >= XW_LAW.wrongWayS;
    if (isWrongWay && this.once(`wrong:${road.id}`))
      out.push({ kind: "xwWrongWay", detail: { key: "violationDetail.xwWrongWay" } });

    // 第75条の8 駐停車.
    const isStanding = x.kmh < XW_LAW.standKmh;
    // 第75条の8第1項: 法令の規定若しくは警察官の命令により、又は危険を防止するため一時停止する場合.
    const isJustAfterCrash = x.sinceCrashS < XW_LAW.crashS;
    const isExcused =
      x.queueAhead ||
      x.waitingToMerge ||
      x.mustStop ||
      x.accident ||
      isJustAfterCrash ||
      isBrokenDownClear(x);
    this.standSince = isStanding && !isExcused ? (this.standSince ?? x.now) : null;
    if (!isStanding) this.booked.delete("stand");
    const hasStood = elapsed(this.standSince) >= XW_LAW.standS;
    if (hasStood && this.once("stand")) {
      const key = isMain ? "violationDetail.xwStoppingMain" : "violationDetail.xwStoppingRamp";
      out.push({ kind: "xwStopping", detail: { key } });
    }

    // 第20条第1項 通行帯: driving along in the rightmost lane of a main line.
    const isRightLane =
      isMain &&
      road.lanes >= 2 &&
      road.lane === road.lanes - 1 &&
      isFacingTraffic &&
      x.kmh > XW_LAW.rightLaneKmh &&
      !x.rightExitAhead;
    this.rightSince = isRightLane ? (this.rightSince ?? x.now) : null;
    if (!isRightLane) this.booked.delete("right");
    const isRightTooLong = elapsed(this.rightSince) >= XW_LAW.rightLaneS;
    if (isRightTooLong && this.once("right"))
      out.push({
        kind: "laneUse",
        detail: { key: "violationDetail.xwRightLane", params: { lanes: road.lanes } },
      });
    return out;
  }

  /** True the first time `key` is asked since the last reset (one record per offence). */
  private once(key: string): boolean {
    if (this.booked.has(key)) return false;
    this.booked.add(key);
    return true;
  }
}

/**
 * 第75条の8第1項第2号: broken down (hazard lamps on) and standing on a shoulder wide enough for
 * the car, off the lanes.
 */
function isBrokenDownClear(x: XwSample): boolean {
  const road = x.road;
  if (!road || !x.hazard) return false;
  const isOnLeftShoulder = road.lane < 0 && road.shoulderL >= XW_LAW.carWidthM;
  const isOnRightShoulder = road.lane >= road.lanes && road.shoulderR >= XW_LAW.carWidthM;
  return isOnLeftShoulder || isOnRightShoulder;
}

/** A main-line vehicle behind the car in the lane it merged into, at the moment it came in. */
export type MergeFollower = {
  /** Gap from its front to the car's back (m). */
  gapM: number;
  /** Its speed (m/s). */
  speed: number;
};

/** The moment the car comes off a ramp into a main line's lane. */
export type MergeSituation = {
  /** The car's speed (m/s). */
  speed: number;
  followers: readonly MergeFollower[];
  /**
   * How far apart the ramp's lane and the main line's lanes still were (m, edge to edge) where the
   * car crossed over: > 0 means it went over the 導流帯 instead of along the 加速車線.
   */
  rampGapM: number;
};

/** The thresholds of judgeMerge (the game's reading of 第2条第1項第22号 進行妨害). */
export const MERGE_LAW = {
  /**
   * 急ブレーキ: a follower that has to brake harder than this (m/s², 0.3 G) to keep its reaction
   * distance behind the car "急に速度を変更しなければならない" (第2条第1項第22号).
   */
  hardBrakeMs2: 3,
  /** The reaction time a follower keeps in front of it (s): the 車間 of 第26条 as autoTraffic.ts takes it. */
  reactionS: 0.75,
  /** Where the 導流帯 is: the ramp's lane more than this far (m) from the main line's lanes. */
  zebraGapM: 0.5,
} as const;

/** What a follower would have to brake (m/s²) to stay its reaction distance behind the car. */
export function brakeNeeded(car: number, f: MergeFollower): number {
  const closing = f.speed - car;
  const room = f.gapM - f.speed * MERGE_LAW.reactionS;
  const isInside = room <= 0;
  if (isInside) return closing >= 0 || f.gapM <= 0 ? Infinity : 0;
  if (closing <= 0) return 0;
  return (closing * closing) / (2 * room);
}

/**
 * 第75条の6第1項 and 第75条の7第1項 at the moment the car comes into the main line: 進行妨害 when a
 * main-line vehicle behind it in that lane would have to brake hard (brakeNeeded ≥ 3 m/s², or the car
 * cuts in inside its reaction distance), and 本線車道出入方法違反 when it came in over the 導流帯,
 * not along the 加速車線. Stepping on the 導流帯 while staying on the ramp is not booked (設計書 4.9).
 */
export function judgeMerge(m: MergeSituation): XwFinding[] {
  const out: XwFinding[] = [];
  const worst = m.followers.reduce((a, f) => Math.max(a, brakeNeeded(m.speed, f)), 0);
  const isObstructing = worst >= MERGE_LAW.hardBrakeMs2;
  // Cut in inside a follower's reaction distance: no deceleration figure to give (brakeNeeded is
  // ∞), the ticket names the gap instead. Why not "∞ m/s²": it read as a measured value.
  const isCutIn = isObstructing && !Number.isFinite(worst);
  if (isCutIn) {
    // The gap of the follower it cut in front of (the one with no deceleration figure).
    const cutOff = m.followers.filter((f) => !Number.isFinite(brakeNeeded(m.speed, f)));
    const gap = Math.max(0, Math.min(...cutOff.map((f) => f.gapM)));
    out.push({
      kind: "xwMergeObstruct",
      detail: { key: "violationDetail.xwMergeCutIn", params: { gap: Math.round(gap * 10) / 10 } },
    });
  } else if (isObstructing) {
    out.push({
      kind: "xwMergeObstruct",
      detail: { key: "violationDetail.xwMergeObstruct", params: { brake: Math.round(worst * 10) / 10 } },
    });
  }
  const isOverZebra = m.rampGapM > MERGE_LAW.zebraGapM;
  if (isOverZebra)
    out.push({
      kind: "xwRampMethod",
      detail: { key: "violationDetail.xwMergeNoAccel", params: { gap: Math.round(m.rampGapM * 10) / 10 } },
    });
  return out;
}

/** The moment the car leaves a main line onto an exit ramp. */
export type ExitSituation = {
  /** The main line's lanes, and the lane the car was in EXIT_PREPARE_M before it left. */
  lanes: number;
  laneBefore: number;
  /** Which side the exit leaves from. */
  side: "left" | "right";
};

/** How long before the exit (m) the car must already be in the lane the exit leaves from. */
export const EXIT_PREPARE_M = 50;

/**
 * 第75条の7第2項: あらかじめその前から出口に接続する車両通行帯を通行しなければならない. The
 * car was not in the lane next to the exit EXIT_PREPARE_M before leaving: it cut across the lanes
 * into the exit at the last moment. One lane: nothing to judge.
 */
export function judgeExit(e: ExitSituation): XwFinding | null {
  if (e.lanes < 2) return null;
  const exitLane = e.side === "left" ? 0 : e.lanes - 1;
  const isBeyondExitLane = e.side === "left" ? e.laneBefore <= exitLane : e.laneBefore >= exitLane;
  if (isBeyondExitLane) return null;
  const lanes = Math.abs(e.laneBefore - exitLane);
  return {
    kind: "xwRampMethod",
    detail: { key: "violationDetail.xwExitLate", params: { lanes, metres: EXIT_PREPARE_M } },
  };
}

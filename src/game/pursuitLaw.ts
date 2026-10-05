import type { ViolationKind, ViolationRecord } from "./traffic";

/**
 * What the law makes of a pursuit and how the game decides it (knowledge/pursuit-and-aftermath.md
 * cites every article, fetched from e-Gov on 2026-10-05). Pure, so the thresholds are tested.
 *
 * - Fleeing is not an offence in itself. It makes the driver one who 「逃亡するおそれがある」, so the
 *   officer gives no 告知 (道路交通法 第126条第1項第2号) and the 反則 protection is gone (第130条第1号):
 *   the 反則行為 seen go the criminal way (赤切符, 略式). FLED_PROCEDURE.
 * - A stop under 第67条第1項 (the game: driving while the licence is suspended or revoked, 第64条第1項)
 *   not obeyed is itself an offence (第119条第1項第13号). A suspended driver is never a 反則者
 *   (第125条第2項第1号). UNLICENSED_PROCEDURE.
 * - Reckless driving through the chase: 安全運転義務違反 (第70条), besides each violation booked.
 * - Injuring someone in the chase: 過失運転致傷 (自動車運転死傷処罰法 第5条), or 危険運転致傷 (同法
 *   第2条) at the numeric high speed of 第4号 or after running a red 殊更に (第10号).
 * - Ramming a unit or driving at an officer on purpose: 公務執行妨害 (刑法 第95条第1項), and 器物損壊
 *   (刑法 第261条) for the damaged police vehicle.
 */

/** procedure.* texts (src/i18n), kept in Japanese on the records. */
export const FLED_PROCEDURE = "procedure.fled";
export const UNLICENSED_PROCEDURE = "procedure.unlicensed";

/**
 * 自動車運転死傷処罰法 第2条第4号 (in force 2026-07-21): 最高速度 60 km/h 以下の道路では 50 km/h、
 * それを超える道路では 60 km/h、最高速度を超える速度以上で運転する行為.
 */
export function dangerousSpeedOver(limit: number): number {
  return limit <= 60 ? 50 : 60;
}

/**
 * 第2条第10号's 「重大な交通の危険を生じさせる速度」 has no number in the law. The game takes 20 km/h:
 * a speed at which hitting someone crossing on their green does serious harm. An assumption, said
 * so in the knowledge doc (the case law usually cited for it was not read for this).
 */
export const SERIOUS_DANGER_KMH = 20;
/** A red run this recently before the crash is the one that led to it. */
export const RED_LINK_MS = 6000;

export type InjuryCharge = { kind: "negligent" } | { kind: "dangerous"; item: 4 | 10 };

/**
 * The charge for hurting someone during a chase. `redRunAgoMs`: since the last 信号無視 booked
 * (null: none). Running a red to get away from the police is deliberate (殊更に無視): the driver
 * sees the red and goes because of the chase, not by misjudging an amber.
 */
export function chaseInjuryCharge(i: {
  fleeing: boolean;
  kmh: number;
  limit: number | null;
  redRunAgoMs: number | null;
}): InjuryCharge {
  const isNumericHighSpeed = i.limit !== null && i.kmh >= i.limit + dangerousSpeedOver(i.limit);
  if (isNumericHighSpeed) return { kind: "dangerous", item: 4 };
  const isRedLinked = i.redRunAgoMs !== null && i.redRunAgoMs <= RED_LINK_MS;
  const isDeliberateRed = i.fleeing && isRedLinked && i.kmh >= SERIOUS_DANGER_KMH;
  if (isDeliberateRed) return { kind: "dangerous", item: 10 };
  return { kind: "negligent" };
}

/** Kinds that put others in danger, for judging the chase as a whole (安全運転義務). */
const DANGEROUS_KINDS: ReadonlySet<ViolationKind> = new Set([
  "signal",
  "speed",
  "noEntry",
  "keepLeft",
  "pedestrianCrossing",
  "stopSign",
  "uturn",
  "turnBan",
  "closedRoad",
  "slow",
]);
/** Seconds of driving 20 km/h or more over the limit with others close by. */
export const RECKLESS_SECONDS = 8;
export const RECKLESS_OVER_KMH = 20;
/** Different dangerous kinds booked while fleeing. */
export const RECKLESS_KINDS = 3;

/**
 * How the driver drove while fleeing, for 安全運転義務違反 (第70条: 「他人に危害を及ぼさないような速度と
 * 方法で運転しなければならない」): sustained speed well over the limit near other road users, or
 * one dangerous violation after another. Due once per pursuit.
 */
export class ChaseConduct {
  dangerFor = 0;
  readonly kinds = new Set<ViolationKind>();
  booked = false;

  observe(dt: number, o: { fleeing: boolean; kmh: number; limit: number | null; othersNear: number }): void {
    const isOver = o.limit !== null && o.kmh >= o.limit + RECKLESS_OVER_KMH;
    const isEndangering = o.fleeing && isOver && o.othersNear > 0;
    if (isEndangering) this.dangerFor += dt;
  }

  onViolation(kind: ViolationKind, fleeing: boolean): void {
    if (fleeing && DANGEROUS_KINDS.has(kind)) this.kinds.add(kind);
  }

  /** Whether 安全運転義務違反 is due now (true once; the caller books it). */
  take(): boolean {
    if (this.booked) return false;
    const isDue = this.dangerFor >= RECKLESS_SECONDS || this.kinds.size >= RECKLESS_KINDS;
    if (isDue) this.booked = true;
    return isDue;
  }
}

/** What the game knows about a hit on a police unit. */
export type UnitImpact = {
  /** A pursuit or a stop is going on (the officers are on duty with this car). */
  engaged: boolean;
  playerKmh: number;
  /** The unit's speed along the player's heading (km/h; negative toward the player). */
  unitKmh: number;
  /** Angle between the player's heading and the direction to the unit (degrees). */
  angleDeg: number;
  /** Accelerator at the moment of the hit (0–1). */
  throttle: number;
  /** Earlier hits on police units in the last minute. */
  earlierHits: number;
};

/**
 * Whether a hit on a patrol car or 白バイ was on purpose (暴行 for 刑法 第95条第1項), decided
 * conservatively: only with officers on duty with this car, and either driving straight at it with
 * the accelerator down and closing fast, or hitting again. A bump in traffic, a unit running into
 * the player, a slow scrape: an accident (安全運転義務違反 only, as any collision).
 */
export function isDeliberateRam(i: UnitImpact): boolean {
  if (!i.engaged) return false;
  const isClosing = i.playerKmh - i.unitKmh >= 10;
  const isStraightAt = i.angleDeg <= 30 && i.playerKmh >= 20 && i.throttle >= 0.5 && isClosing;
  const isAgain = i.earlierHits >= 1 && i.angleDeg <= 45 && i.playerKmh >= 10 && i.throttle >= 0.3;
  return isStraightAt || isAgain;
}

/**
 * Driving at an officer standing in the road (the 検問, the roadside stop): heading straight at them
 * (within ~25°), fast, and passing within reach. Conservative: a car that swerves or slows is not
 * charged.
 */
export function isDrivingAtOfficer(i: {
  engaged: boolean;
  kmh: number;
  /** Cosine between the car's heading and the direction to the officer. */
  headingDot: number;
  distance: number;
}): boolean {
  return i.engaged && i.kmh >= 25 && i.headingDot >= 0.9 && i.distance <= 3;
}

/** How the case is disposed of at the roadside (the outcome selection of trafficStop.ts). */
export type Disposal = "blue" | "red" | "voluntary" | "arrest";

/** Kinds that always lead to an arrest when the driver is caught. */
const ARREST_KINDS: ReadonlySet<ViolationKind> = new Set([
  "hitAndRun",
  "obstruction",
  "propertyDamage",
  "dangerousInjury",
  "ignoredStop",
]);

/**
 * The roadside outcome for what the unit saw:
 * - arrest (現行犯・準現行犯, 刑訴法 第212条・第213条): ひき逃げ, 公務執行妨害, 危険運転致傷, a 第67条
 *   stop not obeyed, or a driver caught after fleeing (追呼されている者, 第212条第2項第1号) for
 *   something punishable;
 * - voluntary (任意同行, 警職法 第2条第2項): driving while suspended, found at the stop;
 * - red (赤切符): anything outside the 反則 system (fine null), or 反則行為 after fleeing;
 * - blue (青切符): 反則行為 only, stopped when called.
 * Points-only records (座席ベルト, fine 0) carry no penalty and never make a case criminal.
 */
export function decideDisposal(c: {
  records: readonly ViolationRecord[];
  fled: boolean;
  caught: boolean;
}): Disposal {
  const kinds = new Set(c.records.map((r) => r.kind));
  const isGrave = [...kinds].some((k) => ARREST_KINDS.has(k));
  if (isGrave) return "arrest";
  const punishable = c.records.filter((r) => r.fine !== 0);
  const isCaughtFleeing = c.fled && c.caught && punishable.length > 0;
  if (isCaughtFleeing) return "arrest";
  if (kinds.has("unlicensed")) return "voluntary";
  const isCriminal = punishable.some((r) => r.fine === null) || (c.fled && punishable.length > 0);
  return isCriminal ? "red" : "blue";
}

/**
 * After a getaway, once the car is identified (plate, cameras, Y's videos): an arrest on a warrant
 * (通常逮捕, 刑訴法 第199条) for the grave cases, otherwise a request to appear (出頭要請, 第198条)
 * and the criminal procedure for the rest.
 */
export function laterDisposal(records: readonly ViolationRecord[]): "laterArrest" | "laterVisit" {
  const isGrave = records.some((r) => ARREST_KINDS.has(r.kind) || r.kind === "unlicensed");
  return isGrave ? "laterArrest" : "laterVisit";
}

/** Records whose 反則金 the flight takes away (those with one: fine > 0). */
export function fledRecords(records: readonly ViolationRecord[]): ViolationRecord[] {
  return records.filter((r) => r.fine !== null && r.fine > 0);
}

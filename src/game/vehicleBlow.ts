import type { Impact } from "../physics/massContacts";
import { STANDING_KMH } from "./motion";

/** Above this speed after the steps (km/h) a blow against anything but the ground is an accident. */
export const ACCIDENT_KMH = 5;

export type VehicleBlowJudgement = {
  /** The driver's accident (安全運転義務違反 and what follows). */
  isAccident: boolean;
  /** A car stood and was hit hard enough to count before: logged as vehicle_bump, nothing booked. */
  isStandingBump: boolean;
};

/**
 * The player's car's own speed on the ground going into a blow (km/h): the mass contact's record
 * of the blow (its carSpeed, before the exchange), else the speed taken before this frame's steps.
 * Why not Vehicle.speedKmh(): it is read after the steps, so it holds the push the blow gave.
 * Why not impactAgainstMass's carSpeed: it is made from that same speed after the steps.
 */
export function ownKmhIntoBlow(record: Pick<Impact, "carSpeed"> | null, kmhBeforeSteps: number): number {
  return record ? record.carSpeed * 3.6 : kmhBeforeSteps;
}

/**
 * Whether a blow between the player's car and something (`what`: hitKind's "ground", "vehicle", a
 * wall, a post…) is the driver's accident: as before, not the ground and above ACCIDENT_KMH by the
 * speed after the steps (`kmhAfter`); and now also the car moving by its own speed going into the
 * blow (`ownKmhBefore` above STANDING_KMH, motion.ts), from wherever it was hit.
 *
 * Why the car's own speed: a car standing at a red light, run into from behind and pushed to
 * 11 km/h, was booked for 安全運転義務違反 (D3, 東京駅南口, 4 runs in 5) — the hole pedestrianBlow.ts
 * closed for people. Why not look at the direction it was hit from: a standing car caused nothing
 * whichever side it was hit on (the people's rule draws the same line). Why not change the 5 km/h:
 * a moving car's bumps below it stay bumps, as they were.
 */
export function judgeVehicleBlow(what: string, kmhAfter: number, ownKmhBefore: number): VehicleBlowJudgement {
  const isHard = what !== "ground" && kmhAfter > ACCIDENT_KMH;
  const isOwnMotion = ownKmhBefore > STANDING_KMH;
  return { isAccident: isHard && isOwnMotion, isStandingBump: isHard && !isOwnMotion && what === "vehicle" };
}

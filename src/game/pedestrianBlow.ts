import type { Impact } from "../physics/massContacts";
import { STANDING_KMH } from "./motion";

/** A person whose Δv from the blow stays under this (km/h) was nudged, not hurt. */
export const HURT_KMH = 3;

export type PedestrianBlowJudgement = {
  /** The player's car knocked the person down: an accident (安全運転義務違反 and the injury). */
  isAccident: boolean;
  /** The car's speed going into the blow (km/h). */
  carKmh: number;
  /** The person's Δv (km/h). */
  victimKmh: number;
};

/**
 * Whether a blow between the player's car and a person is the driver's accident: the car must be
 * moving by its own speed going into the blow (above STANDING_KMH, motion.ts); the closing speed,
 * which includes the person's own walking or running, only tells through their Δv whether they
 * were hurt.
 *
 * Why not judge by the closing speed as before (max of the car's speed and closing + Δv): a person
 * walking into a car standing at a red light closes at their own pace, so a standing car was booked
 * for 安全運転義務違反 and an injury.
 * Why not Vehicle.speedKmh(): it is read after the step, so it already holds the shove the person
 * gave (a light two-wheeler then "moves"), and it is the forward component only, so a car skidding
 * sideways into someone would stand.
 */
export function judgePedestrianBlow(impact: Pick<Impact, "carSpeed" | "dvOther">): PedestrianBlowJudgement {
  const carKmh = impact.carSpeed * 3.6;
  const victimKmh = impact.dvOther * 3.6;
  const isCarMoving = carKmh > STANDING_KMH;
  const isHurt = victimKmh > HURT_KMH;
  return { isAccident: isCarMoving && isHurt, carKmh, victimKmh };
}

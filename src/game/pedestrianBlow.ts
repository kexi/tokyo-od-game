import type { Impact } from "../physics/massContacts";

/**
 * Below this the player's car stands (km/h, its own speed after the step): a person who walks
 * into it has bumped into a standing vehicle. The game's other "stopped" checks (idling stop) use
 * the same 1 km/h.
 *
 * Why not 0: the blow itself and the solver's jitter leave a standing car a few hundredths of a
 * m/s (a 60 kg person walking at 5 km/h into a 1.4 t car gives it about 0.2 km/h).
 * Why not the 3 km/h the people's Δv uses: under 道路交通法 a vehicle that moves at all, even
 * creeping (徐行), owes the care of 第70条 (安全運転義務) and the driver answers for a person it
 * touches; only a vehicle at a standstill is, as a rule, not at fault when a pedestrian walks
 * into it. So the line sits at "standing", not at "slow".
 */
export const STANDING_CAR_KMH = 1;
/** A person whose Δv from the blow stays under this (km/h) was nudged, not hurt. */
export const HURT_KMH = 3;

export type PedestrianBlowJudgement = {
  /** The player's car knocked the person down: an accident (安全運転義務違反 and the injury). */
  isAccident: boolean;
  /** The car's speed going into the blow (km/h): its speed now plus what the blow took off it. */
  carKmh: number;
  /** The person's Δv (km/h). */
  victimKmh: number;
};

/**
 * Whether a blow between the player's car and a person is the driver's accident. The car must be
 * moving by its own speed; the closing speed (which includes the person's own walking or running)
 * only tells, through the person's Δv, whether they were hurt.
 *
 * Why not judge by the closing speed as before (max of the car's speed and closing + Δv): a person
 * walking into a car standing at a red light closes at their own pace, so a standing car was booked
 * for 安全運転義務違反 and an injury.
 */
export function judgePedestrianBlow(
  ownKmh: number,
  impact: Pick<Impact, "dvCar" | "dvOther">,
): PedestrianBlowJudgement {
  const carKmh = Math.abs(ownKmh) + impact.dvCar * 3.6;
  const victimKmh = impact.dvOther * 3.6;
  const isCarMoving = Math.abs(ownKmh) > STANDING_CAR_KMH;
  const isHurt = victimKmh > HURT_KMH;
  return { isAccident: isCarMoving && isHurt, carKmh, victimKmh };
}

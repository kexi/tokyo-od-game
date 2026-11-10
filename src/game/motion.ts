/**
 * The two lines the game draws between moving and not, shared by the checks that would drift
 * apart if each kept its own number.
 */

/**
 * Below this a car stands (km/h): the idling stop (main.ts) and whether a person who touched the
 * player's car was hit by it (pedestrianBlow.ts).
 *
 * Why not 0: a standing car is never exactly still in the physics (the solver's jitter; a person
 * leaning on a two-wheeler gives it about 1 km/h).
 * Why not the 3 km/h people's Δv uses: under 道路交通法 a vehicle that moves at all, even creeping
 * (徐行), owes the care of 第70条 (安全運転義務); only one at a standstill is, as a rule, not at
 * fault when a pedestrian walks into it. The line sits at "standing", not at "slow".
 */
export const STANDING_KMH = 1;

/**
 * A frame's move on the ground plane longer than this (metres) is a jump (移動, 復帰, re-spawn,
 * debug place), not driving: the odometer leaves it out and the accident scene does not count it
 * as leaving. A frame is at most 0.05 s (main.ts), so only above 720 km/h would driving reach it.
 */
export const JUMP_METRES = 10;

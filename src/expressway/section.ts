import { LANE_WIDTH, SHOULDER } from "../law/roadStandards";
import { type CrossSection, sectionWidth } from "../world/laneChange";
import { PARAPET_WIDTH, RAMP_SECTION } from "./assumptions";
import type { RoadClass } from "./network";

/**
 * Cross-section of an expressway chunk (knowledge/road-redesign-plan.md 3.1 CrossSection). The type
 * is the one laneChange.ts defines for every road (one definition: the deck, the graph's segments
 * and the lane arithmetic read the same fields). A main line is 第二種第二級 (都心部の自動車専用道路):
 * lanes of 第5条第4項, shoulders of 第8条, no median (each direction is its own run and deck). A
 * ramp is freed from those articles (第28条第4項) and takes assumptions.RAMP_SECTION.
 */
export type { CrossSection };
/** An expressway section rests on the statute or on an assumption, never on JARTIC or a width. */
export type XwSection = CrossSection & { basis: "statute" | "assumption" };

export function sectionFor(cls: RoadClass, lanes: number): XwSection {
  const isStreet = cls === "street";
  if (isStreet) return streetSection(lanes);
  const isRamp = cls === "ramp";
  if (isRamp) return { lanes, ...RAMP_SECTION.value, median: 0, basis: "assumption" };
  return {
    lanes,
    laneWidth: LANE_WIDTH.value.type2class2,
    shoulderL: SHOULDER.value.type2Left,
    shoulderR: SHOULDER.value.type2Right,
    median: 0,
    basis: "statute",
  };
}

/**
 * A street compiled by a structure override (structures.ts, the 臨港道路): 第四種第1級 lanes
 * (第5条第4項) and shoulders (第8条). Off the structure only: on it the deck levels' strips decide.
 */
export function streetSection(lanes: number): XwSection {
  return {
    lanes,
    laneWidth: LANE_WIDTH.value.type4class1,
    shoulderL: SHOULDER.value.type4Left,
    shoulderR: SHOULDER.value.type4Right,
    median: 0,
    basis: "statute",
  };
}

/** Carriageway width between the parapets' inner faces (laneChange.sectionWidth). */
export const carriagewayWidth = sectionWidth;

/** Full deck width including both parapets. */
export function deckWidth(s: Parameters<typeof sectionWidth>[0]): number {
  return sectionWidth(s) + 2 * PARAPET_WIDTH.value;
}

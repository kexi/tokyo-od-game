import { LANE_WIDTH, SHOULDER } from "../law/roadStandards";
import { PARAPET_WIDTH, RAMP_SECTION } from "./assumptions";
import type { RoadClass } from "./network";

/**
 * Cross-section of an expressway chunk (knowledge/road-redesign-plan.md 3.1 CrossSection, the part P1 needs). A main line is
 * 第二種第二級 (都心部の自動車専用道路): lanes of 第5条第4項, shoulders of 第8条. A ramp is freed
 * from those articles (第28条第4項) and takes assumptions.RAMP_SECTION.
 */
export type CrossSection = {
  lanes: number;
  laneWidth: number;
  shoulderL: number;
  shoulderR: number;
  basis: "statute" | "assumption";
};

export function sectionFor(cls: RoadClass, lanes: number): CrossSection {
  const isRamp = cls === "ramp";
  if (isRamp) return { lanes, ...RAMP_SECTION.value, basis: "assumption" };
  return {
    lanes,
    laneWidth: LANE_WIDTH.value.type2class2,
    shoulderL: SHOULDER.value.type2Left,
    shoulderR: SHOULDER.value.type2Right,
    basis: "statute",
  };
}

/** Carriageway width between the parapets' inner faces. */
export function carriagewayWidth(
  s: Pick<CrossSection, "lanes" | "laneWidth" | "shoulderL" | "shoulderR">,
): number {
  return s.lanes * s.laneWidth + s.shoulderL + s.shoulderR;
}

/** Full deck width including both parapets. */
export function deckWidth(s: Pick<CrossSection, "lanes" | "laneWidth" | "shoulderL" | "shoulderR">): number {
  return carriagewayWidth(s) + 2 * PARAPET_WIDTH.value;
}

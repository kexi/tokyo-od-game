import { compilePlan, twoPhase, twoPhaseWithRightArrow, type CompiledPlan, type GroupId } from "./plan";

/** The lane directions of one junction approach, left lane first (regulations.ts LaneUse). */
type ApproachLanes = { lanes: readonly (readonly string[])[]; source: "osm" | "assumed" };

/**
 * The rule (T2, before the OSM tag census of T3) for which approaches get a 右折矢印: one whose OSM
 * turn:lanes has a lane for turning right only. Assumption, not data on the signal: where a junction
 * gives right-turners a lane of their own, Tokyo commonly gives them an arrow too. Unconfirmed
 * against the 警視庁's own list (none read); T3 replaces it where OSM tags say otherwise.
 * Why not JARTIC's 進行方向別通行区分 too: those lanes are `assumed` from the lane count (the usual
 * 左折・直進 | 直進 | 右折 pattern), so a right-only lane there is the game's guess, not a survey.
 */
export function hasRightTurnLane(use: ApproachLanes | undefined): boolean {
  if (!use || use.source !== "osm") return false;
  return use.lanes.some((lane) => lane.length === 1 && lane[0] === "right");
}

/**
 * The plan for one controller from its approaches' groups and lanes: twoPhaseWithRightArrow for the
 * groups with a right-turn lane on any of their approaches (both directions of that axis get the
 * arrow: a one-sided arrow is a 時差式 plan, T4), else the default twoPhase.
 */
export function planForJunction(
  approaches: readonly { group: GroupId; lanes?: ApproachLanes }[],
): CompiledPlan {
  const arrowGroups = [
    ...new Set(approaches.filter((a) => hasRightTurnLane(a.lanes)).map((a) => a.group)),
  ].toSorted();
  const key = arrowGroups.join();
  const cached = PLANS.get(key);
  if (cached) return cached;
  // Plans are parsed (zod) and compiled once per kind: every rebuild re-plans tens of controllers,
  // and controllers of one kind share the one compiled plan.
  const plan = compilePlan(arrowGroups.length === 0 ? twoPhase() : twoPhaseWithRightArrow(arrowGroups));
  PLANS.set(key, plan);
  return plan;
}
const PLANS = new Map<string, CompiledPlan>();

/** Whether `group` ever shows a right arrow in `plan` (which head it gets, and the summary count). */
export const hasRightArrow = (plan: CompiledPlan, group: GroupId): boolean =>
  plan.plan.steps.some((st) => st.arrows[group]?.includes("right"));

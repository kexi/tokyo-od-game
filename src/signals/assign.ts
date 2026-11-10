import {
  CROSSING_GROUPS,
  compilePlan,
  crossingFixed,
  pushButton,
  twoPhase,
  twoPhaseWithRightArrow,
  type CompiledPlan,
  type GroupId,
} from "./plan";

/** The lane directions of one junction approach, left lane first (regulations.ts LaneUse). */
type ApproachLanes = { lanes: readonly (readonly string[])[]; source: "osm" | "assumed" };

/** A plan chosen for one controller, and the signal group of each approach it was given. */
export type PlanChoice = { plan: CompiledPlan; groupOf: readonly GroupId[] };

/**
 * The rule (T2) for which approaches get a 右折矢印: one whose OSM turn:lanes has a lane for turning
 * right only. Assumption, not data on the signal: where a junction gives right-turners a lane of
 * their own, Tokyo commonly gives them an arrow too. Unconfirmed against the 警視庁's own list (none
 * read). The T3 census found no OSM tag on signal nodes that says "arrow" often enough to replace
 * it (traffic_signals:turn on 14 nodes in the 23 wards), so the rule stays.
 * Why not JARTIC's 進行方向別通行区分 too: those lanes are `assumed` from the lane count (the usual
 * 左折・直進 | 直進 | 右折 pattern), so a right-only lane there is the game's guess, not a survey.
 */
export function hasRightTurnLane(use: ApproachLanes | undefined): boolean {
  if (!use || use.source !== "osm") return false;
  return use.lanes.some((lane) => lane.length === 1 && lane[0] === "right");
}

/** Axis 0 (the widest road's) is group a, axis 1 group b: the two-phase templates' groups. */
const TWO_PHASE_GROUP: Record<0 | 1, GroupId> = { 0: "a", 1: "b" };

/**
 * The plan for one junction controller from its approaches' axes and lanes, and each approach's
 * group in it: twoPhaseWithRightArrow for the groups with a right-turn lane on any of their
 * approaches (both directions of that axis get the arrow: a one-sided arrow is a 時差式 plan, T4),
 * else the default twoPhase.
 */
export function planForJunction(approaches: readonly { axis: 0 | 1; lanes?: ApproachLanes }[]): PlanChoice {
  const groupOf = approaches.map((a) => TWO_PHASE_GROUP[a.axis]);
  const arrowGroups = [
    ...new Set(approaches.filter((a) => hasRightTurnLane(a.lanes)).map((a) => TWO_PHASE_GROUP[a.axis])),
  ].toSorted();
  const key = `junction:${arrowGroups.join()}`;
  const plan = cached(key, () =>
    arrowGroups.length === 0 ? twoPhase("default") : twoPhaseWithRightArrow(arrowGroups, "inferred"),
  );
  return { plan, groupOf };
}

/** What OSM says of a 単路 (mid-block) crossing's signal (src/signals/osmTags.ts). */
export type CrossingFacts = { button: boolean | null };

/**
 * The plan for a 単路 crossing's controller: pushButton where OSM tags button_operated=yes, else a
 * fixed cycle (crossingFixed; source "osm" when OSM says button_operated=no, "default" when it says
 * nothing). Every approach (both directions of the road) is the one vehicle group.
 */
export function planForCrossing(facts: CrossingFacts, approachCount: number): PlanChoice {
  const groupOf = Array.from({ length: approachCount }, () => CROSSING_GROUPS.vehicles);
  if (facts.button === true) return { plan: cached("crossing:button", () => pushButton("osm")), groupOf };
  const source = facts.button === false ? "osm" : "default";
  return { plan: cached(`crossing:fixed:${source}`, () => crossingFixed(source)), groupOf };
}

// Plans are parsed (zod) and compiled once per kind: every rebuild re-plans tens of controllers,
// and controllers of one kind share the one compiled plan.
const PLANS = new Map<string, CompiledPlan>();
function cached(key: string, make: () => Parameters<typeof compilePlan>[0]): CompiledPlan {
  const hit = PLANS.get(key);
  if (hit) return hit;
  const plan = compilePlan(make());
  PLANS.set(key, plan);
  return plan;
}

/** Whether `group` ever shows a right arrow in `plan` (which head it gets, and the summary count). */
export const hasRightArrow = (plan: CompiledPlan, group: GroupId): boolean =>
  plan.plan.steps.some((st) => st.arrows[group]?.includes("right"));

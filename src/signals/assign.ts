import {
  CROSSING_GROUPS,
  STAGGERED_GROUPS,
  compilePlan,
  crossingFixed,
  nightFlash,
  pushButton,
  scramble,
  staggered,
  twoPhase,
  twoPhaseWithRightArrow,
  withWalkButtons,
  type CompiledPlan,
  type FlashAspect,
  type GroupId,
  type SignalPlan,
} from "./plan";
import { hasPhaseFacts, type SignalTags } from "./osmTags";
import type { NightPlan } from "./run";

export type { NightPlan } from "./run";

/** The lane directions of one junction approach, left lane first (regulations.ts LaneUse). */
type ApproachLanes = { lanes: readonly (readonly string[])[]; source: "osm" | "assumed" };

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

/** One approach into a junction: its axis, its lanes, and its travel bearing (degrees from north). */
export type JunctionApproach = { axis: 0 | 1; lanes?: ApproachLanes; bearingDeg?: number };

/** A flashing mode by the clock: always, inside a window of minutes, or at the assumed night. */
export type FlashWhen =
  | { when: "always" }
  | { when: "window"; window: readonly [number, number] }
  | { when: "night" };

/**
 * What the OSM nodes of one junction (within its snap of any of its nodes, TrafficControl) say of
 * its plan (T4, src/signals/osmTags.ts phaseOf). `hints` are the ones that name a direction: the
 * travel bearing of a node's traffic_signals:direction, with the colour it flashes or whether its
 * 時差式 green ends first.
 */
export type JunctionFacts = {
  scramble: boolean;
  /** button_operated: yes on some node (every walk on call), night (only at night), or none. */
  button: "yes" | "night" | null;
  flash: FlashWhen | null;
  staggered: boolean;
  hints: readonly { bearingDeg: number; flash?: "red" | "yellow"; staggered?: "first" | "later" }[];
};

export const NO_JUNCTION_FACTS: JunctionFacts = {
  scramble: false,
  button: null,
  flash: null,
  staggered: false,
  hints: [],
};

/**
 * The night the game assumes where OSM says 夜間 without hours (夜間点滅式, button_operated=night):
 * 22:00–06:00, the window the 23 wards' two traffic_signals:conditional=blinker @ (…) tags give.
 * Unconfirmed: each 公安委員会 sets its own hours, and none was read.
 */
export const ASSUMED_NIGHT: readonly [number, number] = [22 * 60, 6 * 60];

/**
 * A plan chosen for one controller, the signal group of each approach it was given, the plan that
 * replaces it at night, and how many groups' right arrows the chosen template dropped.
 */
export type PlanChoice = {
  plan: CompiledPlan;
  groupOf: readonly GroupId[];
  night: NightPlan | null;
  droppedArrows: number;
};

/** How far apart (degrees) two bearings may be and still be one direction of travel. */
const SAME_WAY_DEG = 45;
const bearingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Which approaches are which direction of a 時差式 road, or null when the junction cannot run it. */
function staggeredRoles(
  approaches: readonly JunctionApproach[],
  facts: JunctionFacts,
): { roles: ("later" | "first" | null)[]; isFromOsm: boolean } | null {
  const named = facts.hints.find((h) => h.staggered !== undefined);
  // The direction the node names: its approach's axis is the 時差式 road.
  const matched = named
    ? approaches.findIndex(
        (a) => a.bearingDeg !== undefined && bearingGap(a.bearingDeg, named.bearingDeg) < SAME_WAY_DEG,
      )
    : -1;
  const isNamed = named !== undefined && matched >= 0;
  const axis = isNamed ? approaches[matched].axis : 0;
  const onAxis = approaches.filter((a) => a.axis === axis && a.bearingDeg !== undefined);
  if (onAxis.length === 0) return null;
  // Assumed where no node says which way: the direction with an OSM right-turn lane keeps 青 (that is
  // what the lag is for), else the first approach of the main road. Unconfirmed: a guess at the
  // junction, not data on it.
  const assumedLater = onAxis.find((a) => hasRightTurnLane(a.lanes)) ?? onAxis[0];
  const ref = isNamed ? approaches[matched] : assumedLater;
  const refRole = isNamed ? (named.staggered as "first" | "later") : "later";
  const other = refRole === "later" ? "first" : "later";
  const roles = approaches.map((a) => {
    if (a.axis !== axis || a.bearingDeg === undefined || ref.bearingDeg === undefined) return null;
    return bearingGap(a.bearingDeg, ref.bearingDeg) < 90 ? refRole : other;
  });
  const hasBothWays = roles.includes("later") && roles.includes("first");
  return hasBothWays ? { roles, isFromOsm: isNamed } : null;
}

/** Assumed (design 5.3): 主道路 黄点滅・従道路 赤点滅 — the usual practice; no 公安委員会 rule was read. */
const flashByAxis = (axis: 0 | 1): FlashAspect => (axis === 0 ? "FY" : "FR");

/** Each group's flashing lamp: the main road's 黄の点滅 and the crossing road's 赤の点滅, unless the notes say. */
function flashingOf(
  approaches: readonly JunctionApproach[],
  groupOf: readonly GroupId[],
  facts: JunctionFacts,
): Record<GroupId, FlashAspect> {
  const out: Record<GroupId, FlashAspect> = {};
  approaches.forEach((a, i) => {
    out[groupOf[i]] ??= flashByAxis(a.axis);
  });
  const hinted = { ...out };
  for (const h of facts.hints) {
    if (h.flash === undefined) continue;
    approaches.forEach((a, i) => {
      const isThisWay = a.bearingDeg !== undefined && bearingGap(a.bearingDeg, h.bearingDeg) < SAME_WAY_DEG;
      if (isThisWay) hinted[groupOf[i]] = h.flash === "red" ? "FR" : "FY";
    });
  }
  // A note's colour wins unless it would leave two crossing roads both at 黄の点滅 (nobody told to
  // stop first): then the assumed main/crossing split stands.
  const axesYellow = new Set(approaches.filter((_, i) => hinted[groupOf[i]] === "FY").map((a) => a.axis));
  return axesYellow.size > 1 ? out : hinted;
}

/** What the chooser knows of one junction when it picks its base template. */
type BaseContext = {
  facts: JunctionFacts;
  stagger: ReturnType<typeof staggeredRoles>;
  arrowGroups: readonly GroupId[];
};

/**
 * The base templates, first that applies wins: 歩車分離 where a node says crossing:scramble, 時差式
 * where a node says 時差式 and the junction has both directions of that road, the right arrow where an
 * approach has an OSM right-turn lane (both directions of that axis get it), else twoPhase.
 */
const BASE_TEMPLATES: readonly {
  key: (x: BaseContext) => string;
  applies: (x: BaseContext) => boolean;
  make: (x: BaseContext) => SignalPlan;
  /** Whether the template shows the right arrows the lanes would earn (the others drop them). */
  hasArrows: boolean;
}[] = [
  {
    key: () => "scramble",
    applies: (x) => x.facts.scramble,
    make: () => scramble("osm"),
    hasArrows: false,
  },
  {
    key: (x) => `staggered:${x.stagger?.isFromOsm}`,
    applies: (x) => x.stagger !== null,
    make: (x) => staggered(x.stagger?.isFromOsm ? "osm" : "inferred"),
    hasArrows: false,
  },
  {
    key: (x) => `arrow:${x.arrowGroups.join()}`,
    applies: (x) => x.arrowGroups.length > 0,
    make: (x) => twoPhaseWithRightArrow(x.arrowGroups, "inferred"),
    hasArrows: true,
  },
  { key: () => "twoPhase", applies: () => true, make: () => twoPhase("default"), hasArrows: true },
];

/**
 * The plan for one junction controller from its approaches (axes, lanes, bearings) and what its OSM
 * nodes say (T4), with each approach's group in it and the plan that replaces it at night:
 * - the base template (BASE_TEMPLATES). Scramble and 時差式 have no arrow step: the right-turn
 *   lanes' arrows they drop are counted in `droppedArrows` (the network summary logs them). Why not
 *   add arrows to them: scramble's walk and 時差式's lag already clear the right-turners, and no
 *   source for such combined 現示 was read.
 * - button_operated=yes: every walk on call (withWalkButtons); =night: that at the assumed night.
 * - traffic_signals=blinker: flashing always; a blinker window or 夜間点滅式: flashing at night
 *   (nightFlash, the main road 黄・the crossing road 赤 unless the notes say).
 */
export function planForJunction(
  approaches: readonly JunctionApproach[],
  facts: JunctionFacts = NO_JUNCTION_FACTS,
): PlanChoice {
  const stagger = !facts.scramble && facts.staggered ? staggeredRoles(approaches, facts) : null;
  const groupOf = approaches.map((a, i) => {
    const role = stagger?.roles[i];
    if (!stagger) return TWO_PHASE_GROUP[a.axis];
    if (role === "later") return STAGGERED_GROUPS.later;
    if (role === "first") return STAGGERED_GROUPS.first;
    return STAGGERED_GROUPS.crossing;
  });
  const arrowGroups = [
    ...new Set(approaches.filter((a) => hasRightTurnLane(a.lanes)).map((a) => TWO_PHASE_GROUP[a.axis])),
  ].toSorted();
  const context: BaseContext = { facts, stagger, arrowGroups };
  const chosen = BASE_TEMPLATES.find((t) => t.applies(context)) ?? BASE_TEMPLATES[BASE_TEMPLATES.length - 1];
  const droppedArrows = chosen.hasArrows ? 0 : arrowGroups.length;
  const base = { key: chosen.key(context), make: () => chosen.make(context) };
  const isButtonAllDay = facts.button === "yes";
  const day = isButtonAllDay
    ? { key: `${base.key}+button`, make: () => withWalkButtons(base.make(), "osm") }
    : base;
  const flashing = facts.flash ? flashingOf(approaches, groupOf, facts) : null;
  const flashKey = flashing
    ? Object.entries(flashing)
        .map(([g, f]) => `${g}${f}`)
        .join()
    : "";
  const flashPlan = () =>
    cached(`${day.key}~flash:${flashKey}`, () => nightFlash(day.make(), flashing ?? {}, "osm"));
  const flash = facts.flash;
  if (flash?.when === "always") return { plan: flashPlan(), groupOf, night: null, droppedArrows };
  const plan = cached(`junction:${day.key}`, day.make);
  if (flash) {
    const window = flash.when === "window" ? flash.window : ASSUMED_NIGHT;
    return { plan, groupOf, night: { kind: "flash", window, plan: flashPlan() }, droppedArrows };
  }
  const isButtonAtNight = facts.button === "night";
  if (!isButtonAtNight) return { plan, groupOf, night: null, droppedArrows };
  const night = cached(`junction:${base.key}+button`, () => withWalkButtons(base.make(), "osm"));
  return { plan, groupOf, night: { kind: "buttons", window: ASSUMED_NIGHT, plan: night }, droppedArrows };
}

/**
 * What the tags of the OSM records near one junction (TrafficControl picks those within its snap of
 * the junction's nodes) say of its plan (T4). A button yes on any of them wins over no and night; a
 * flash with hours wins over 夜間点滅式 without; the hints are the records' direction-bearing notes.
 * Records that say nothing of a plan (osmTags.ts hasPhaseFacts, no button) are skipped.
 */
export function junctionFacts(tags: readonly SignalTags[]): JunctionFacts {
  const relevant = tags.filter((t) => saysOfPlan(t));
  if (relevant.length === 0) return NO_JUNCTION_FACTS;
  const button = relevant.some((t) => t.button === true)
    ? "yes"
    : relevant.some((t) => t.phase.buttonNight)
      ? "night"
      : null;
  const phases = relevant.map((t) => t.phase);
  const always = phases.find((f) => f.flash === "always");
  const timed = phases.find((f) => f.flash === "window" && f.flashWindow !== null);
  const flash: JunctionFacts["flash"] = always
    ? { when: "always" }
    : timed?.flashWindow
      ? { when: "window", window: timed.flashWindow }
      : phases.some((f) => f.flash === "night")
        ? { when: "night" }
        : null;
  const hints = relevant.flatMap((t) => {
    if (t.bearing === null) return [];
    const flashHint = t.phase.flashHint ?? undefined;
    const staggeredHint =
      t.phase.staggered === "first" || t.phase.staggered === "later" ? t.phase.staggered : undefined;
    const hasHint = flashHint !== undefined || staggeredHint !== undefined;
    return hasHint ? [{ bearingDeg: t.bearing, flash: flashHint, staggered: staggeredHint }] : [];
  });
  return {
    scramble: relevant.some((t) => t.phase.scramble),
    button,
    flash,
    staggered: relevant.some((t) => t.phase.staggered !== null),
    hints,
  };
}

/** Whether a record's tags say anything of a junction's plan: a button, or a T4 fact. */
export const saysOfPlan = (t: SignalTags): boolean => t.button === true || hasPhaseFacts(t.phase);

/** What OSM says of a 単路 (mid-block) crossing's signal (src/signals/osmTags.ts). */
export type CrossingFacts = { button: boolean | null };

/**
 * The plan for a 単路 crossing's controller: pushButton where OSM tags button_operated=yes, else a
 * fixed cycle (crossingFixed; source "osm" when OSM says button_operated=no, "default" when it says
 * nothing). Every approach (both directions of the road) is the one vehicle group.
 */
export function planForCrossing(facts: CrossingFacts, approachCount: number): PlanChoice {
  const groupOf = Array.from({ length: approachCount }, () => CROSSING_GROUPS.vehicles);
  if (facts.button === true)
    return {
      plan: cached("crossing:button", () => pushButton("osm")),
      groupOf,
      night: null,
      droppedArrows: 0,
    };
  const source = facts.button === false ? "osm" : "default";
  return {
    plan: cached(`crossing:fixed:${source}`, () => crossingFixed(source)),
    groupOf,
    night: null,
    droppedArrows: 0,
  };
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

/** The vehicle groups of `plan` (its steps' main lamps). */
export const groupsOf = (plan: CompiledPlan): GroupId[] => Object.keys(plan.plan.steps[0].main);

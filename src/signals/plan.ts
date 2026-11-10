import { z } from "zod";
import { ArrowDirection } from "./heads";

/**
 * 現示表 (signal plans), declared as data: a plan is the list of steps one controller runs through,
 * each saying what every signal group shows for how long. Templates are pure functions that write
 * plans; `permits` is the one place that reads a step as 施行令第2条 does (knowledge/signal-system.md).
 *
 * Groups: a vehicle group is the traffic that one set of heads faces (the two-phase templates use
 * "a" for the widest road's axis and "b" for the crossing one). A pedestrian group shares its
 * vehicle group's id: `ped.a` lights the walkers who go alongside group a (across the b road).
 */

export const GroupId = z.string().regex(/^[a-z][a-z0-9]*$/);
export type GroupId = z.infer<typeof GroupId>;

/** The main lamps: 青・黄・赤, 黄の点滅, 赤の点滅, or dark. */
export const MainAspect = z.enum(["G", "Y", "R", "FY", "FR", "off"]);
export type MainAspect = z.infer<typeof MainAspect>;
/** 人の形の記号を有する青色の灯火 / その点滅 / 赤色の灯火. */
export const PedAspect = z.enum(["go", "flash", "stop"]);
export type PedAspect = z.infer<typeof PedAspect>;

export const StepSchema = z.strictObject({
  /** Seconds the step lasts. */
  s: z.number().positive(),
  main: z.record(GroupId, MainAspect),
  /** 青色の灯火の矢印 lit with the main lamps, by group. */
  arrows: z.record(GroupId, z.array(ArrowDirection)).default({}),
  ped: z.record(GroupId, PedAspect).default({}),
});
export type Step = z.output<typeof StepSchema>;

export const SignalPlanSchema = z
  .strictObject({
    template: z.string(),
    steps: z.array(StepSchema).min(1),
    /** Where the choice of template came from (design table: OSM tag > inferred > default). */
    source: z.enum(["osm", "inferred", "default"]),
    /**
     * Pairs of groups whose paths cross. Not in the design's sketch: the safety checks need to know
     * which groups may not move together, and only the template knows its geometry.
     */
    conflicts: z.array(z.tuple([GroupId, GroupId])).default([]),
  })
  .superRefine((plan, ctx) => {
    const groups = Object.keys(plan.steps[0].main).toSorted().join();
    const isSameGroups = plan.steps.every((st) => Object.keys(st.main).toSorted().join() === groups);
    if (!isSameGroups)
      ctx.addIssue({ code: "custom", path: ["steps"], message: "every step lists the same groups" });
    for (const issue of orderIssues(plan)) ctx.addIssue({ code: "custom", path: ["steps"], message: issue });
  });
export type SignalPlan = z.output<typeof SignalPlanSchema>;

// ---------- 施行令第3条第2項: the order of the signals ----------

const NEXT_MAIN: Partial<Record<MainAspect, MainAspect>> = { G: "Y", Y: "R", R: "G" };
const NEXT_PED: Record<PedAspect, PedAspect> = { go: "flash", flash: "stop", stop: "go" };

/** The cyclic sequence of `values` with repeats run together (`[R, G, G, Y, R]` → `[G, Y, R]`). */
function changes<T>(values: readonly T[]): T[] {
  const out = values.filter((v, i) => v !== values[(i - 1 + values.length) % values.length]);
  return out.length === 0 && values.length > 0 ? [values[0]] : out;
}

/**
 * 施行令第3条第2項: 青→黄→赤 for the vehicle lamps and 青→青の点滅→赤 for the walk lamps, wherever
 * those are shown in succession. Flashing and dark steps are outside that paragraph (they are not
 * 青・黄・赤 in succession) and are not checked here.
 */
export function orderIssues(plan: {
  steps: readonly { main: Record<string, MainAspect>; ped?: Record<string, PedAspect> }[];
}): string[] {
  const issues: string[] = [];
  const groups = Object.keys(plan.steps[0]?.main ?? {});
  for (const g of groups) {
    const seq = changes(plan.steps.map((st) => st.main[g]).filter((a) => a in NEXT_MAIN));
    if (seq.length < 2) continue;
    seq.forEach((a, i) => {
      const next = seq[(i + 1) % seq.length];
      if (NEXT_MAIN[a] !== next)
        issues.push(`施行令第3条第2項: group ${g} shows ${a} then ${next} (青→黄→赤)`);
    });
  }
  const pedGroups = new Set(plan.steps.flatMap((st) => Object.keys(st.ped ?? {})));
  for (const g of pedGroups) {
    const seq = changes(plan.steps.map((st) => st.ped?.[g] ?? "stop"));
    if (seq.length < 2) continue;
    seq.forEach((a, i) => {
      const next = seq[(i + 1) % seq.length];
      if (NEXT_PED[a] !== next)
        issues.push(`施行令第3条第2項: walkers ${g} see ${a} then ${next} (青→青の点滅→赤)`);
    });
  }
  return issues;
}

// ---------- safety (design 5.3): not law text, what a plan must hold to be drivable ----------

/** The shortest yellow (施行令 has no figure; 3 s is the game's and the design's floor). */
export const MIN_YELLOW_S = 3;
/** The shortest all-red between groups whose paths cross. */
export const MIN_ALL_RED_S = 1;

/** Whether `group`'s vehicles may be moving into the junction in `st` (青・黄 or an arrow). */
const isOpen = (st: Step, group: string) => {
  const main = st.main[group];
  return main === "G" || main === "Y" || main === "FY" || (st.arrows[group]?.length ?? 0) > 0;
};

/**
 * Safety checks over one cycle: crossing groups never open together, walkers never walk while the
 * traffic crossing their path (the other group, or their own group's turning arrows) moves, every
 * yellow lasts at least 3 s, arrows show only over 赤 or 黄, and an all-red separates crossing groups.
 */
export function safetyIssues(plan: SignalPlan): string[] {
  const issues: string[] = [];
  const n = plan.steps.length;
  const crosses = (g: string, h: string) =>
    plan.conflicts.some(([x, y]) => (x === g && y === h) || (x === h && y === g));
  const groups = Object.keys(plan.steps[0].main);
  plan.steps.forEach((st, i) => {
    for (const g of groups) {
      for (const h of groups) {
        const isBothOpen = g < h && crosses(g, h) && isOpen(st, g) && isOpen(st, h);
        if (isBothOpen) issues.push(`step ${i}: ${g} and ${h} open together`);
      }
      const isWalking = st.ped[g] === "go" || st.ped[g] === "flash";
      const isCrossedByOthers = groups.some((h) => crosses(g, h) && isOpen(st, h));
      const isCrossedByTurners = (st.arrows[g]?.length ?? 0) > 0;
      if (isWalking && (isCrossedByOthers || isCrossedByTurners))
        issues.push(`step ${i}: walkers ${g} cross moving traffic`);
      const hasArrows = (st.arrows[g]?.length ?? 0) > 0;
      const isOverRedOrYellow = st.main[g] === "R" || st.main[g] === "Y";
      if (hasArrows && !isOverRedOrYellow) issues.push(`step ${i}: ${g}'s arrows over ${st.main[g]}`);
    }
  });
  for (const g of groups) {
    // A yellow run's length, starting where the previous step is not yellow (cyclic).
    plan.steps.forEach((st, i) => {
      const isRunStart = st.main[g] === "Y" && plan.steps[(i - 1 + n) % n].main[g] !== "Y";
      if (!isRunStart) return;
      let total = 0;
      for (let k = 0; k < n && plan.steps[(i + k) % n].main[g] === "Y"; k++)
        total += plan.steps[(i + k) % n].s;
      if (total < MIN_YELLOW_S) issues.push(`group ${g}: yellow of ${total} s`);
    });
  }
  // All-red: walking on from a step where g is open, the first step where a crossing h opens must
  // come after at least MIN_ALL_RED_S of steps where nobody is open.
  plan.steps.forEach((st, i) => {
    for (const g of groups) {
      const isLastOpen = isOpen(st, g) && !isOpen(plan.steps[(i + 1) % n], g);
      if (!isLastOpen) continue;
      let allRed = 0;
      for (let k = 1; k < n; k++) {
        const next = plan.steps[(i + k) % n];
        const opened = groups.find((h) => isOpen(next, h));
        if (opened === undefined) {
          allRed += next.s;
          continue;
        }
        if (crosses(g, opened) && allRed < MIN_ALL_RED_S)
          issues.push(`step ${i}: ${opened} opens ${allRed} s after ${g}`);
        break;
      }
    }
  });
  return issues;
}

// ---------- 施行令第2条: what a step lets each movement do ----------

/** Which way a vehicle leaves the junction, as the law checks classify it (turnBit's 35°). */
export type Movement = "left" | "through" | "right" | "uturn";
export const MOVEMENTS: readonly Movement[] = ["left", "through", "right", "uturn"];

/**
 * What a step means to a vehicle making one movement past the stop position:
 * - `go`: 青, or 青色の灯火の矢印 the way it goes (黄色の灯火の点滅 too: 他の交通に注意して進行).
 * - `stopIfAble`: 黄 — not past the stop position, unless too close to it to stop safely.
 * - `stop`: 赤 with no arrow its way.
 * - `stopFirst`: 赤色の灯火の点滅 — 一時停止 at the stop position, then on.
 * - `unconfirmed`: the law text read does not say (a dark signal). Drivers treat it as stop and
 *   the violation check does not book it: both the safe side.
 */
export type Permission = "go" | "stopIfAble" | "stop" | "stopFirst" | "unconfirmed";

const MAIN_PERMISSION: Record<MainAspect, Permission> = {
  G: "go",
  Y: "stopIfAble",
  R: "stop",
  FY: "go",
  FR: "stopFirst",
  off: "unconfirmed",
};

/**
 * 施行令第2条 for `group`'s heads in `step`, for a vehicle making `movement` — the one reading of the
 * table the violation check, the autopilot, the traffic AI, the walkers and the crossing sounds share.
 * - 青色の灯火の矢印: 車両は、黄色の灯火又は赤色の灯火の信号にかかわらず、矢印の方向に進行することが
 *   できる. Only 青 arrows are modelled: 黄色の灯火の矢印 is for 路面電車, which the game has none of.
 * - 転回 under a right arrow: 道路交通法施行規則 別表第一の二 defines the right arrow as the one by which
 *   「車両等（…多通行帯道路等通行一般原動機付自転車、特定小型原動機付自転車及び軽車両を除く。）が右折し、
 *   又は転回することができることとなるもの」, so 転回 is the arrow's way. The excluded vehicles (two-stage
 *   right turners, bicycles) are not driven in the game: every vehicle here is a car or a bus.
 * - Under 青 the game lets 転回 go as before (第2条 lists 直進・左折・右折; not changed here).
 */
export function permits(step: Step, group: GroupId, movement: Movement): Permission {
  const arrows = step.arrows[group] ?? [];
  const arrowFor = movement === "uturn" ? "right" : movement;
  const hasArrowItsWay = arrows.includes(arrowFor);
  if (hasArrowItsWay) return "go";
  return MAIN_PERMISSION[step.main[group] ?? "off"];
}

/** Whether a driver may go past the stop position now (anything short of `go` is a stop for them). */
export const mayProceed = (p: Permission): boolean => p === "go";

// ---------- running a plan ----------

/** A plan with its step start times worked out, for looking steps up every frame. */
export type CompiledPlan = { plan: SignalPlan; starts: number[]; cycle: number };

export function compilePlan(plan: SignalPlan): CompiledPlan {
  const starts: number[] = [];
  let t = 0;
  for (const st of plan.steps) {
    starts.push(t);
    t += st.s;
  }
  return { plan, starts, cycle: t };
}

/** Seconds into the cycle at clock `seconds` for a controller `offset` seconds ahead (negative wraps). */
export const cycleTime = (seconds: number, offset: number, cycle: number): number =>
  (((seconds + offset) % cycle) + cycle) % cycle;

/** The step showing `t` seconds into the cycle (0 ≤ t < cycle). */
export function stepAt(c: CompiledPlan, t: number): Step {
  const { starts, plan } = c;
  let i = starts.length - 1;
  while (i > 0 && starts[i] > t) i--;
  return plan.steps[i];
}

// ---------- templates ----------

/**
 * The game's two-phase timing since 2026-10-04 (seconds): 青 20 / 黄 3 / 全赤 2 for the widest road,
 * 青 15 / 黄 3 / 全赤 2 for the crossing one; walkers' 青 flashes for the last 5 s of the green they
 * walk with. Why not real cycles (100–140 s): to keep the game moving (design 9 章).
 */
export const TWO_PHASE_TIMING = { green: [20, 15], yellow: 3, allRed: 2, pedFlash: 5 } as const;
export type TwoPhaseTiming = {
  green: readonly [number, number];
  yellow: number;
  allRed: number;
  pedFlash: number;
};
/** The right-arrow step's length (assumed: no source for Tokyo's arrow times was read). */
export const RIGHT_ARROW_S = 6;

const GROUPS = ["a", "b"] as const;

function phaseSteps(group: "a" | "b", t: TwoPhaseTiming, green: number, arrowS: number): Step[] {
  const other = group === "a" ? "b" : "a";
  const main = (mine: MainAspect) => ({ [group]: mine, [other]: "R" }) as Record<string, MainAspect>;
  const stopped = { a: "stop", b: "stop" } as Record<string, PedAspect>;
  const steps: Step[] = [
    { s: green - t.pedFlash, main: main("G"), arrows: {}, ped: { ...stopped, [group]: "go" } },
    { s: t.pedFlash, main: main("G"), arrows: {}, ped: { ...stopped, [group]: "flash" } },
    { s: t.yellow, main: main("Y"), arrows: {}, ped: stopped },
  ];
  // 赤＋右折矢印 after the yellow, then the arrow goes out into the all-red. Why not 矢印→黄→赤 (the
  // design's sketch): our reading, unconfirmed, is that the main lamp showing 赤 then 黄 goes against
  // 第3条第2項's 青→黄→赤; the 警察庁 arrow guideline (丁規発第50号, 2024) that would settle the
  // practice was not read. The arrow's going out unannounced is covered on the drivers' side (they
  // stop when they can) and on the check's (a grace for crossing just after it went out).
  if (arrowS > 0) steps.push({ s: arrowS, main: main("R"), arrows: { [group]: ["right"] }, ped: stopped });
  steps.push({ s: t.allRed, main: { a: "R", b: "R" }, arrows: {}, ped: stopped });
  return steps;
}

/** The game's two-phase plan, as lightState ran it before 現示表 (tests/signalPlans.test.ts holds them equal). */
export function twoPhase(t: TwoPhaseTiming = TWO_PHASE_TIMING): SignalPlan {
  return SignalPlanSchema.parse({
    template: "twoPhase",
    source: "default",
    conflicts: [["a", "b"]],
    steps: GROUPS.flatMap((g, i) => phaseSteps(g, t, t.green[i], 0)),
  });
}

/**
 * Two phases with a 右折矢印 step after the yellow of each group in `arrowGroups`: 赤 with the right
 * arrow for `arrowS` seconds, while the crossing group and every walker stay at red.
 */
export function twoPhaseWithRightArrow(
  arrowGroups: readonly GroupId[],
  t: TwoPhaseTiming = TWO_PHASE_TIMING,
  arrowS = RIGHT_ARROW_S,
): SignalPlan {
  return SignalPlanSchema.parse({
    template: "twoPhaseWithRightArrow",
    source: "inferred",
    conflicts: [["a", "b"]],
    steps: GROUPS.flatMap((g, i) => phaseSteps(g, t, t.green[i], arrowGroups.includes(g) ? arrowS : 0)),
  });
}

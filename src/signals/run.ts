import {
  WalkCalls,
  cycleTime,
  flashExit,
  isChangeMoment,
  isInWindow,
  stepAt,
  stepIndexAt,
  walkLeftS,
  type CompiledPlan,
  type GroupId,
  type PlanRun,
  type Step,
} from "./plan";

/**
 * A plan that runs instead of the day plan inside `window` (minutes after midnight): a flash
 * (nightFlash; left by way of flashExit) or the day plan with walk buttons (the same steps, so it is
 * entered and left at the same moments without a way out).
 */
export type NightPlan = { kind: "flash" | "buttons"; window: readonly [number, number]; plan: CompiledPlan };

/** One stretch of a run: from `from` (clock seconds) on, `plan` with its cycle at `offset`. */
type Segment = {
  from: number;
  plan: CompiledPlan;
  offset: number;
  mode: "day" | "night" | "exit";
  /** The walk buttons of `plan` at `offset` (none when the plan has no on-call walkers). */
  calls: WalkCalls | null;
};

/** How long what was run is kept, for the violation check's grace and the replay (seconds). */
const HISTORY_S = 600;

/**
 * A controller on the clock (T4): the day plan, and the night plan inside its window. The plans
 * change only at a change moment (plan.ts isChangeMoment: all 赤 for MIN_ALL_RED_S, nobody walking),
 * and a flash is left through flashExit, after which the day plan starts again at its first step
 * (its offset is moved to that moment: the controller then runs out of step with its old phase, as
 * a real one starting its day plan would). What was run is kept as segments, so a step a moment ago
 * (the grace) and the replay's earlier times read what really showed; `advance` (only when the
 * clock goes forward, never in the replay) is the one place the run changes.
 * Why not choose the plan from the window at each lookup: a lookup at any time would jump plans in
 * the middle of a green (the review's C1).
 */
export class ScheduledRun implements PlanRun {
  private segments: Segment[];

  constructor(
    readonly day: CompiledPlan,
    readonly night: NightPlan | null,
    offset: number,
    minute: number | null,
  ) {
    // A controller met for the first time (nobody saw it before) starts in the plan its window asks.
    const isNight = night !== null && minute !== null && isInWindow(minute, night.window);
    const plan = isNight && night ? night.plan : day;
    this.segments = [segment(-Infinity, plan, offset, isNight ? "night" : "day")];
  }

  /** Whether this run was made for these plans (a rebuilt network keeps the run when they match). */
  isFor(day: CompiledPlan, night: NightPlan | null): boolean {
    const isSameWindow =
      this.night?.window[0] === night?.window[0] && this.night?.window[1] === night?.window[1];
    return this.day === day && this.night?.plan === night?.plan && isSameWindow;
  }

  /** The plan running at `now` (the night plan's, the exit's or the day's). */
  planAt(now: number): CompiledPlan {
    return this.at(now).plan;
  }

  /** Whether the night plan (or its way out) is running at `now`. */
  isNightAt(now: number): boolean {
    return this.at(now).mode !== "day";
  }

  /** The cycle offset of the plan running at `now`. */
  offsetAt(now: number): number {
    return this.at(now).offset;
  }

  /**
   * Move the run on to `now` with the game's time of day `minute`: into the night plan at a change
   * moment of the day plan once the window has begun, out of it once the window is over (a flash by
   * way of flashExit, the buttons plan at its own change moment). Returns the template now running
   * when it changed, else null. Never call it with an earlier `now` (the replay reads, it does not run).
   */
  advance(now: number, minute: number | null): string | null {
    const night = this.night;
    const last = this.segments[this.segments.length - 1];
    const isInTransit = last.from > now || last.mode === "exit";
    if (!night || isInTransit) return this.prune(now);
    const wantsNight = minute !== null && isInWindow(minute, night.window);
    const isNight = last.mode === "night";
    if (wantsNight === isNight) return this.prune(now);
    const t = cycleTime(now, last.offset, last.plan.cycle);
    const isFlashing = isNight && night.kind === "flash";
    if (!isFlashing && !isChangeMoment(last.plan, t)) return this.prune(now);
    if (!isNight) {
      // A flash has one step: its phase does not matter. The buttons plan keeps the day's phase.
      const offset = night.kind === "flash" ? -now : last.offset;
      this.segments.push(segment(now, night.plan, offset, "night"));
    } else if (night.kind === "buttons") {
      this.segments.push(segment(now, this.day, last.offset, "day"));
    } else {
      const exit = flashExit(night.plan.plan);
      const dayFrom = now + exit.cycle;
      this.segments.push(segment(now, exit, -now, "exit"));
      this.segments.push(segment(dayFrom, this.day, -dayFrom, "day"));
    }
    this.prune(now);
    return this.planAt(now).plan.template;
  }

  stepAt(now: number): Step {
    const seg = this.at(now);
    const step = stepAt(seg.plan, cycleTime(now, seg.offset, seg.plan.cycle));
    return seg.calls ? seg.calls.mask(step, now) : step;
  }

  stepBefore(now: number, agoS: number): Step {
    const t = now - agoS;
    const seg = this.at(t);
    return stepAt(seg.plan, cycleTime(t, seg.offset, seg.plan.cycle));
  }

  call(group: GroupId, now: number): boolean {
    return this.at(now).calls?.call(group, now) ?? false;
  }

  isWaiting(group: GroupId, now: number): boolean {
    return this.at(now).calls?.isWaiting(group, now) ?? false;
  }

  /** Seconds of `group`'s walk left at `now` (0 when it is not walking, or walks only on call). */
  walkLeftS(group: GroupId, now: number): number {
    const seg = this.at(now);
    const isOnCall = seg.plan.plan.onCall.includes(group);
    if (isOnCall) return 0;
    return walkLeftS(seg.plan, group, cycleTime(now, seg.offset, seg.plan.cycle));
  }

  /**
   * The earliest clock time from `now` on at which step `index` of the plan running at `now` shows
   * its middle (the review views hold the clock there; never earlier, as the run only goes forward).
   */
  clockFor(index: number, now: number): number {
    const seg = this.at(now);
    const c = seg.plan;
    const from = now;
    const mid = c.starts[index] + c.plan.steps[index].s / 2;
    const at = cycleTime(from, seg.offset, c.cycle);
    return from + ((((mid - at) % c.cycle) + c.cycle) % c.cycle);
  }

  /** The index of the step of the running plan at `now`. */
  stepIndexAt(now: number): number {
    const seg = this.at(now);
    return stepIndexAt(seg.plan, cycleTime(now, seg.offset, seg.plan.cycle));
  }

  private at(t: number): Segment {
    for (let i = this.segments.length - 1; i > 0; i--)
      if (this.segments[i].from <= t) return this.segments[i];
    return this.segments[0];
  }

  /** Drop the segments that ended more than HISTORY_S before `now`. */
  private prune(now: number): null {
    while (this.segments.length > 1 && this.segments[1].from < now - HISTORY_S) this.segments.shift();
    return null;
  }
}

function segment(from: number, plan: CompiledPlan, offset: number, mode: Segment["mode"]): Segment {
  const calls = plan.plan.onCall.length > 0 ? new WalkCalls(plan, offset) : null;
  return { from, plan, offset, mode, calls };
}

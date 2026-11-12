import { z } from "zod";

/**
 * The review loop's records and its stopping rule (knowledge/review-loop.md). Each round the
 * reviewers (one per viewpoint: 様式・寸法・取付・可読性・夜と雨…) write JSON lines in
 * .qa/reviews/<table>/round-NN.jsonl:
 * - `review`: who looked, from which viewpoint, at which shots (at least one per round: an empty
 *   file is not a quiet round, it is a round nobody reviewed);
 * - `finding`: one problem, its `id` kept from round to round;
 * - `metric`: a measured probe with its limits.
 *
 * Fail-closed throughout: a finding stays open until a round says `fixed`, or `wontfix` with the
 * reason in `fix`; a finding left out of a later round is carried over open, not dropped. A metric
 * seen once (or required by the table) must be reported every round after. A round whose shots
 * were incomplete (scripts/qa/views.ts run.json), or whose reviews do not cover every shot, is
 * never quiet.
 *
 * Converged: the last STABLE_ROUNDS rounds quiet (valid, covered, no new Critical/Warning — a
 * finding raised from Info to Warning counts as new), and after the last round no Critical or
 * Warning open and no metric missing or outside. Round ESCALATE_AFTER not converged: back to the
 * design, and that stays (later quiet rounds do not undo it).
 */

export const SEVERITIES = ["Critical", "Warning", "Info"] as const;
export const STATUSES = ["open", "fixed", "wontfix"] as const;
const BLOCKING = new Set<string>(["Critical", "Warning"]);
export const STABLE_ROUNDS = 2;
export const ESCALATE_AFTER = 6;

export const FindingSchema = z
  .strictObject({
    type: z.literal("finding").default("finding"),
    /** Stable across rounds: `<shot>:<slug>` (e.g. marunouchi-arrow--arrow-driver-30:lamp-order). */
    id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    round: z.number().int().positive(),
    /** The shot it was seen in: `<session>--<view>` (`<session>.<look>--<view>` with looks). */
    view: z.string().min(1),
    severity: z.enum(SEVERITIES),
    status: z.enum(STATUSES).default("open"),
    /** What is wrong, in one line. */
    finding: z.string().min(1),
    perspective: z.string().optional(),
    /** The law, standard or data it is checked against (施行令第3条, 別表第二, frame JSON …). */
    basis: z.string().optional(),
    /** The fix or the test added for it; for wontfix, why it is left (required). */
    fix: z.string().optional(),
  })
  .refine((f) => f.status !== "wontfix" || (f.fix ?? "").trim().length > 0, {
    message: "wontfix needs the reason in `fix`",
  });
export type Finding = z.infer<typeof FindingSchema>;

export const MetricSchema = z
  .strictObject({
    type: z.literal("metric"),
    name: z.string().min(1),
    round: z.number().int().positive(),
    view: z.string().optional(),
    value: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().optional(),
  })
  .refine((m) => m.min !== undefined || m.max !== undefined, { message: "a metric needs min or max" });
export type Metric = z.infer<typeof MetricSchema>;

export const ReviewSchema = z.strictObject({
  type: z.literal("review"),
  round: z.number().int().positive(),
  /** The reviewer's viewpoint (様式, 寸法, 取付, 可読性, 夜と雨, 配列, 幾何, 性能 …). */
  perspective: z.string().min(1),
  reviewer: z.string().optional(),
  /** The shots looked at (shot keys, as in the round's run.json). */
  views: z.array(z.string().min(1)).min(1),
});
export type Review = z.infer<typeof ReviewSchema>;

/** The table's side of the check: the shot keys of a complete round and the required probes. */
export type ReviewContext = {
  shots: readonly string[];
  metrics?: ReadonlyArray<{ name: string; min?: number; max?: number }>;
};

export type Round = {
  round: number;
  reviews: Review[];
  findings: Finding[];
  metrics: Metric[];
  /** The round's shoot was complete (run.json); unknown (undefined) counts as complete in tests. */
  isShootComplete?: boolean;
  /** The shots this round took (its run.json); absent: the context's (the table's now). */
  shots?: readonly string[];
};

/**
 * One round's JSONL. Throws, naming the line, on bad JSON, a line that fits no record, a line for
 * another round, the same finding id twice, a shot not in the table, or no `review` line at all.
 */
export function parseRound(round: number, jsonl: string, ctx?: ReviewContext): Round {
  const reviews: Review[] = [];
  const findings: Finding[] = [];
  const metrics: Metric[] = [];
  const shots = ctx ? new Set(ctx.shots) : null;
  const where = (i: number) => `round ${round} line ${i + 1}`;
  jsonl.split("\n").forEach((line, i) => {
    const isBlank = line.trim() === "";
    if (isBlank) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (error) {
      throw new Error(`${where(i)}: not JSON (${String(error)})`, { cause: error });
    }
    const type = (json as { type?: unknown } | null)?.type ?? "finding";
    const schema = type === "review" ? ReviewSchema : type === "metric" ? MetricSchema : FindingSchema;
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${where(i)}: ${z.prettifyError(parsed.error)}`);
    const rec = parsed.data as Review | Metric | Finding;
    if (rec.round !== round) throw new Error(`${where(i)}: written for round ${rec.round}`);
    const named = rec.type === "review" ? rec.views : rec.view !== undefined ? [rec.view] : [];
    const unknown = shots ? named.filter((v) => !shots.has(v)) : [];
    if (unknown.length > 0) throw new Error(`${where(i)}: no such shot in the table: ${unknown.join(", ")}`);
    if (rec.type === "review") reviews.push(rec);
    else if (rec.type === "metric") metrics.push(rec);
    else {
      const isRepeated = findings.some((f) => f.id === rec.id);
      if (isRepeated)
        throw new Error(`${where(i)}: finding ${rec.id} twice in one round (give each its own id)`);
      findings.push(rec);
    }
  });
  if (reviews.length === 0)
    throw new Error(
      `round ${round}: no "review" line — an empty or findings-only file is not a reviewed round`,
    );
  return { round, reviews, findings, metrics };
}

export const isMetricWithin = (m: { value: number; min?: number; max?: number }) =>
  (m.min === undefined || m.value >= m.min) && (m.max === undefined || m.value <= m.max);

export type MetricProblem = {
  name: string;
  problem: "missing" | "outside";
  value?: number;
  min?: number;
  max?: number;
};

export type RoundDiff = {
  round: number;
  /** Open now and not open before, or raised from Info to Critical/Warning. */
  new: Finding[];
  /** Closed this round (fixed, or wontfix with a reason). */
  gone: Finding[];
  /** Open before and not mentioned this round: still open. */
  carried: Finding[];
  /** Open before and written again open. */
  kept: Finding[];
  newBlocking: number;
  openCritical: number;
  openWarning: number;
  metricProblems: MetricProblem[];
  /** Shots no review line of the round covers. */
  unreviewed: string[];
  isShootComplete: boolean;
  isQuiet: boolean;
};

type State = { open: Map<string, Finding>; metrics: Map<string, { min?: number; max?: number }> };

function step(state: State, r: Round, ctx: ReviewContext | undefined): RoundDiff {
  const before = state.open;
  const open = new Map(before);
  const mentioned = new Set(r.findings.map((f) => f.id));
  const fresh: Finding[] = [];
  const gone: Finding[] = [];
  const kept: Finding[] = [];
  for (const f of r.findings) {
    const prev = before.get(f.id);
    if (f.status !== "open") {
      if (prev) gone.push(f);
      open.delete(f.id);
      continue;
    }
    open.set(f.id, f);
    const isRaised = prev !== undefined && !BLOCKING.has(prev.severity) && BLOCKING.has(f.severity);
    if (!prev || isRaised) fresh.push(f);
    else kept.push(f);
  }
  const carried = [...before.values()].filter((f) => !mentioned.has(f.id));
  // Every metric seen so far, and every one the table requires, must be in this round.
  for (const m of ctx?.metrics ?? []) state.metrics.set(m.name, { min: m.min, max: m.max });
  for (const m of r.metrics) state.metrics.set(m.name, { min: m.min, max: m.max });
  const metricProblems: MetricProblem[] = [];
  for (const [name, limits] of state.metrics) {
    const got = r.metrics.filter((m) => m.name === name);
    if (got.length === 0) metricProblems.push({ name, problem: "missing", ...limits });
    for (const m of got)
      if (!isMetricWithin(m))
        metricProblems.push({ name, problem: "outside", value: m.value, min: m.min, max: m.max });
  }
  const covered = new Set(r.reviews.flatMap((v) => v.views));
  const unreviewed = (r.shots ?? ctx?.shots ?? []).filter((s) => !covered.has(s));
  const isShootComplete = r.isShootComplete ?? true;
  const newBlocking = fresh.filter((f) => BLOCKING.has(f.severity)).length;
  state.open = open;
  const openNow = [...open.values()];
  return {
    round: r.round,
    new: fresh,
    gone,
    carried,
    kept,
    newBlocking,
    openCritical: openNow.filter((f) => f.severity === "Critical").length,
    openWarning: openNow.filter((f) => f.severity === "Warning").length,
    metricProblems,
    unreviewed,
    isShootComplete,
    isQuiet: newBlocking === 0 && unreviewed.length === 0 && isShootComplete,
  };
}

export type Verdict = {
  verdict: "converged" | "continue" | "escalate";
  /** The round the verdict is for (the last one given). */
  round: number;
  /** Rounds in a row, ending with the last, that were quiet. */
  quietRounds: number;
  reason: string;
  diffs: RoundDiff[];
};

/** Why the state after `d` (with `quiet` quiet rounds ending at it) is not converged; "" if it is. */
function blockers(d: RoundDiff, quiet: number): string {
  return [
    quiet < STABLE_ROUNDS && `${quiet} quiet round(s) of ${STABLE_ROUNDS}`,
    d.newBlocking > 0 && `${d.newBlocking} new Critical/Warning`,
    !d.isShootComplete && "this round's shoot is incomplete (failed or partial shots)",
    d.unreviewed.length > 0 && `${d.unreviewed.length} shot(s) not reviewed`,
    d.openCritical > 0 && `${d.openCritical} Critical open`,
    d.openWarning > 0 && `${d.openWarning} Warning open`,
    d.metricProblems.length > 0 &&
      `metrics ${d.metricProblems.map((m) => `${m.name} ${m.problem}`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** The verdict after the rounds so far (numbered from 1 without gaps, in any order). */
export function judge(rounds: Round[], ctx?: ReviewContext): Verdict {
  const sorted = rounds.toSorted((a, b) => a.round - b.round);
  if (sorted.length === 0) throw new Error("no review rounds yet");
  sorted.forEach((r, i) => {
    const isGap = r.round !== i + 1;
    if (isGap) throw new Error(`review rounds must run 1, 2, 3 …: round ${i + 1} is missing`);
  });
  const state: State = { open: new Map(), metrics: new Map() };
  const diffs: RoundDiff[] = [];
  let quiet = 0;
  let escalatedAt: number | null = null;
  let why = "";
  for (const r of sorted) {
    const d = step(state, r, ctx);
    diffs.push(d);
    quiet = d.isQuiet ? quiet + 1 : 0;
    why = blockers(d, quiet);
    const isOutOfRounds = escalatedAt === null && why !== "" && r.round >= ESCALATE_AFTER;
    if (isOutOfRounds) escalatedAt = r.round;
  }
  const last = diffs[diffs.length - 1];
  const base = { round: last.round, quietRounds: quiet, diffs };
  if (escalatedAt !== null)
    return {
      ...base,
      verdict: "escalate",
      reason: `not converged at round ${escalatedAt}: back to the design${why ? ` (now: ${why})` : ""}`,
    };
  if (why === "") return { ...base, verdict: "converged", reason: `${quiet} quiet rounds, nothing open` };
  return { ...base, verdict: "continue", reason: why };
}

const brief = (f: Finding) => ({
  id: f.id,
  view: f.view,
  severity: f.severity,
  status: f.status,
  finding: f.finding,
});

/** The diff file of a round, as written next to its JSONL (for the next round's reviewers). */
export function diffRecord(d: RoundDiff) {
  return {
    round: d.round,
    new: d.new.map(brief),
    gone: d.gone.map(brief),
    carried: d.carried.map(brief),
    kept: d.kept.map(brief),
    newBlocking: d.newBlocking,
    openCritical: d.openCritical,
    openWarning: d.openWarning,
    metricProblems: d.metricProblems,
    unreviewed: d.unreviewed,
    isShootComplete: d.isShootComplete,
    isQuiet: d.isQuiet,
  };
}

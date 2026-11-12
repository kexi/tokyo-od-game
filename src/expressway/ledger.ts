import {
  CASE_MARGIN,
  HEIGHT_KM_STEP,
  HIGH_DECK_MARGIN,
  isAllowed,
  type CaseVerdict,
  isRuleAllowed,
  LET_GO_MAX_STEP_M,
  LET_GO_REASON,
  NOSE_REASON,
  PORTAL_OPEN_CUT_MAX_M,
  PORTAL_OPEN_CUT_REASON,
  RULE_KINDS,
  CUT_STRETCH_REASON,
  EMBANKMENT_STRETCH_REASON,
  THIN_GIRDER_REASON,
} from "./allowlist";
import { GIRDER_MIN } from "./assumptions";
import { isOpenGroundRuled } from "./heightStructures";
import { type District, DISTRICTS } from "./districts";
import type { HeightKm } from "./highDeck";
import type { XwBlockRecord, XwBuildRecord, XwChunk, XwDiagnostic, XwTileRun } from "./format";
import { isJoined, overlapKindOf, overlapPair } from "./overlapClass";

/**
 * The ledger of a data folder (P2.7-4, ledger.json): every case the project accepts, defers or has
 * still to decide, one line each. The ledger tool (scripts/expresswayLedger.ts) counts the cases from
 * the files and writes what it finds (`key`, `kind`, `run`, `with`, `chunk`, `district`, `block`,
 * `blockHash`, `measured`); a review writes the decision (`cap`, `status`, `reason`, `qa`) and the
 * `budget`. The tool only adds (a case no longer found becomes `gone`, removed only with --prune)
 * and keeps a decision while the case stays within its cap and CASE_MARGIN. Pure: the tool and the
 * tests read and write the files.
 */
export const LEDGER_VERSION = 1;

/**
 * The kinds of case (5.2 of the instruction). Overlaps (deck_overlap): nose (by rule),
 * changeover, parallel-ramp, touchdown, other. portal-open-cut (tunnel_cover_short, by rule within
 * PORTAL_OPEN_CUT_MAX_M). ramp-radius (ramp_radius), layer-ambiguous (crossing_layer_ambiguous).
 * The merged decks' (scripts/expresswaySeams.ts): seam_step (a step or a face miss at a seam),
 * seam_hole (no face at a seam), merge_skipped (a same-surface stretch over MERGE_MAX_DZ, drawn
 * apart), let_go (where a merged pair lets go, by rule within LET_GO_MAX_STEP_M). high-deck (P2.7-5):
 * a free viaduct stretch over HIGH_DECK_ABOVE_M for HIGH_DECK_MIN_M or more (src/expressway/highDeck.ts).
 * cut-stretch / embankment-stretch (P2.7-6 PR 1, a height build): a viaduct-tagged run's cut or
 * embankment (heightStructures.ts openGroundStretches), by rule within HEIGHT_STRUCTURES' limits;
 * thin-girder: a viaduct chunk on a girder thinner than GIRDER_DEPTH, by rule at GIRDER_MIN or more.
 * low-viaduct: a viaduct under the viaduct's height that never comes down to the ground (an embankment
 * in the air kept a viaduct, heightStructures.lowViaductStretches), listed for a review.
 */
export const CASE_KINDS = [
  "nose",
  "changeover",
  "parallel-ramp",
  "touchdown",
  "other",
  "portal-open-cut",
  "ramp-radius",
  "layer-ambiguous",
  "seam_step",
  "seam_hole",
  "merge_skipped",
  "let_go",
  "high-deck",
  "cut-stretch",
  "embankment-stretch",
  "thin-girder",
  "low-viaduct",
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/** The kinds a rule accepts without a review while within its condition (`by: "rule"`). */
export const AUTO_KINDS: readonly CaseKind[] = [
  "nose",
  "portal-open-cut",
  "let_go",
  "cut-stretch",
  "embankment-stretch",
  "thin-girder",
];

export const STATUSES = ["new", "accepted", "open", "wontfix", "gone"] as const;
export type CaseStatus = (typeof STATUSES)[number];

/** The measures of a case (which ones depends on its kind), in this order in the file. */
export const MEASURES = [
  "stations",
  "probes",
  "minDzM",
  "maxDzM",
  "s",
  "s0",
  "s1",
  "stepM",
  "insideM",
  "alongStepM",
  "minRadiusM",
  "lengthM",
  "heightM",
  "spanM",
  "depthM",
  "girderM",
] as const;
export type Measured = Partial<Record<(typeof MEASURES)[number], number>>;

/** A decision as a review wrote it (kept in `previous` when the case leaves its cap). */
export type Decision = {
  status: CaseStatus;
  by: "rule" | "review" | null;
  cap: Measured | null;
  reason: string | null;
  qa: string | null;
};

export type LedgerCase = {
  key: string;
  kind: CaseKind;
  run: string;
  with: string | null;
  chunk: string | null;
  district: District;
  /** The block(s) of the case's runs (report.json blocks), joined by "+". */
  block: string;
  /** Their dataHash (report.json), joined by "+": what tells a case whose decks did not change. */
  blockHash: string;
  measured: Measured;
  cap: Measured | null;
  status: CaseStatus;
  by: "rule" | "review" | null;
  reason: string | null;
  /** The view that shows it (`<view table>/<view id>`, scripts/qa/views) or a drive's id. */
  qa: string | null;
  previous: Decision | null;
};

/** Counts the tool writes: per district, kind and status; the rest as in LedgerBudget. */
export type LedgerSummary = {
  cases: Partial<Record<District, Partial<Record<CaseKind, Partial<Record<CaseStatus, number>>>>>>;
  /** Cases `open` (defects to mend). */
  open: number;
  /** changeover and parallel-ramp cases (not gone) without a `qa` view. */
  withoutQa: number;
  /** The seam probes of the merged decks (every 0.5 m of the stretches a car drives over). */
  seamProbes: number;
  /** The diagnostics the `*` rules accept, per kind (allowlist.ts RULES). */
  rules: Record<string, number>;
  /** The km of viaduct over 15 and 20 m per district (P2.7-5; absent from a ledger before it). */
  heightKm?: HeightKm;
};

/** What a review fixes (the ratchet): the summary's counts without the status split, gone left out. */
export type LedgerBudget = {
  cases: Partial<Record<District, Partial<Record<CaseKind, number>>>>;
  open: number;
  withoutQa: number;
  seamProbes: number;
  rules: Record<string, number>;
  /**
   * Caps on the km over 15 and 20 m per district (P2.7-5 4.3): the summary's rounded up to
   * HEIGHT_KM_STEP. Unlike the counts the test asks for at most these, not the same (the km wobble
   * from build to build).
   */
  heightKm?: HeightKm;
};

export type Ledger = {
  version: typeof LEDGER_VERSION;
  /** The data the ledger is of: the ranges built (or the scope), the objective, the extract. */
  data: { ranges: string[]; scope: string | null; objective: string; extract: string | null };
  summary: LedgerSummary;
  /** null until a review writes it (the tool's --write-budget). */
  budget: LedgerBudget | null;
  cases: LedgerCase[];
};

/** A case as found in the files, before the ledger's district, block and decision. */
export type FoundCase = {
  key: string;
  kind: CaseKind;
  run: string;
  with: string | null;
  chunk: string | null;
  measured: Measured;
};

const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** A Measured in MEASURES order (the file stays byte-stable whatever order it was made in). */
export function orderMeasured(m: Measured): Measured {
  const out: Measured = {};
  for (const k of MEASURES) if (m[k] !== undefined) out[k] = m[k];
  return out;
}

/** What the cases of the diagnostics need of the build: the runs, the untied pairs, tunnel mouths. */
export type CaseContext = {
  runs: ReadonlyMap<string, Pick<XwTileRun, "id" | "cls" | "start" | "end">>;
  /** "a|b" (a < b) of report.json's `untied`. */
  untied: ReadonlySet<string>;
  /** Run distances of a run's tunnel mouths (a portal with a tunnel on one side). */
  mouths: (run: string) => number[];
};

/** The case of a diagnostic, or null for a kind that is no case (the `*` rules, the failures). */
export function caseOfDiagnostic(d: XwDiagnostic, ctx: CaseContext): FoundCase | null {
  if (d.kind === "deck_overlap") return overlapCase(d, ctx);
  if (d.kind === "tunnel_cover_short") return portalCase(d, ctx);
  if (d.kind === "ramp_radius") {
    const r = /R=([\d.]+) m/.exec(d.detail);
    if (!r) return null;
    return {
      key: `ramp-radius:${d.run}`,
      kind: "ramp-radius",
      run: d.run,
      with: null,
      chunk: null,
      measured: { minRadiusM: Number(r[1]) },
    };
  }
  if (d.kind === "crossing_layer_ambiguous") {
    const m = /^crosses (\S+) at (\d+) m/.exec(d.detail);
    if (!m) return null;
    return {
      key: `layer-ambiguous:${d.run}|${m[1]}`,
      kind: "layer-ambiguous",
      run: d.run,
      with: m[1],
      chunk: null,
      measured: { s: Number(m[2]) },
    };
  }
  return null;
}

function overlapCase(d: XwDiagnostic, ctx: CaseContext): FoundCase | null {
  const pair = overlapPair(d);
  if (!pair) return null;
  const [a, b] = pair.a < pair.b ? [pair.a, pair.b] : [pair.b, pair.a];
  const ra = ctx.runs.get(a);
  const rb = ctx.runs.get(b);
  const joined = ra !== undefined && rb !== undefined && isJoined(ra, rb);
  const kind = overlapKindOf(pair, ra?.cls ?? "ramp", rb?.cls ?? "ramp", joined, ctx.untied.has(`${a}|${b}`));
  return {
    key: `${kind}:${a}|${b}`,
    kind,
    run: a,
    with: b,
    chunk: null,
    measured: { stations: pair.stations, minDzM: pair.minDzM, maxDzM: pair.maxDzM },
  };
}

function portalCase(d: XwDiagnostic, ctx: CaseContext): FoundCase | null {
  const m = /^(\d+) stations at (\d+)–(\d+) m/.exec(d.detail);
  if (!m) return null;
  const s0 = Number(m[2]);
  const s1 = Number(m[3]);
  // From the mouth that the short stretch leans on: the farther end of the stretch from it.
  const lengths = ctx.mouths(d.run).map((p) => Math.max(Math.abs(p - s0), Math.abs(p - s1)));
  const hasMouth = lengths.length > 0;
  const measured: Measured = { stations: Number(m[1]), s0, s1 };
  if (hasMouth) measured.lengthM = round(Math.min(...lengths), 1);
  return {
    key: `portal-open-cut:${d.run}`,
    kind: "portal-open-cut",
    run: d.run,
    with: null,
    chunk: null,
    measured,
  };
}

/** The cases of a build's diagnostics, one per key (a pair found twice keeps its larger measures). */
export function diagnosticCases(diagnostics: readonly XwDiagnostic[], ctx: CaseContext): FoundCase[] {
  const byKey = new Map<string, FoundCase>();
  for (const d of diagnostics) {
    const c = caseOfDiagnostic(d, ctx);
    if (!c) continue;
    const seen = byKey.get(c.key);
    if (!seen) {
      byKey.set(c.key, c);
      continue;
    }
    seen.measured = mergeMeasured(seen.measured, c.measured);
  }
  return [...byKey.values()];
}

/** Two measures of one case as one: the larger counts and misses, the smaller radius and start. */
function mergeMeasured(a: Measured, b: Measured): Measured {
  const out: Measured = { ...a };
  for (const k of MEASURES) {
    const x = a[k];
    const y = b[k];
    if (y === undefined) continue;
    if (x === undefined) {
      out[k] = y;
      continue;
    }
    const isLow = k === "minDzM" || k === "minRadiusM" || k === "s0";
    out[k] = isLow ? Math.min(x, y) : Math.max(x, y);
  }
  return out;
}

/** A seam probed on the merged decks (scripts/expresswaySeams.ts). */
export type SeamProbeLike = {
  chunk: string;
  with: string;
  s: number;
  dz: number;
  step: number | null;
  inside: number | null;
};
export type LetGoLike = { chunk: string; with: string; s: number; alongStep: number | null };
export type MergeMissLike = { chunk: string; with: string; s0: number; s1: number; maxDzM: number };

/** Probes of one chunk and partner, s apart by more than this, are separate stretches (cases). */
export const STRETCH_GAP_M = 5;

/** Consecutive probes (by s) of one chunk and partner, split where they are STRETCH_GAP_M apart. */
function stretches<T extends { chunk: string; with: string; s: number }>(items: readonly T[]): T[][] {
  const byPair = new Map<string, T[]>();
  for (const x of items) {
    const key = `${x.chunk}|${x.with}`;
    byPair.set(key, [...(byPair.get(key) ?? []), x]);
  }
  const out: T[][] = [];
  for (const key of [...byPair.keys()].sort()) {
    const list = byPair.get(key)!.toSorted((a, b) => a.s - b.s);
    let current: T[] = [];
    for (const x of list) {
      const isApart = current.length > 0 && x.s - current[current.length - 1].s > STRETCH_GAP_M;
      if (isApart) {
        out.push(current);
        current = [];
      }
      current.push(x);
    }
    if (current.length > 0) out.push(current);
  }
  return out;
}

const runOfChunk = (chunk: string) => chunk.slice(0, chunk.lastIndexOf(":"));

/**
 * The limits of a seam a car drives over (P3.5): the step at the master's face ≤ 1 mm where the pair
 * is within `fullDz` (MERGE_FULL_DZ), ≤ `maxDz` + 1 mm where it slides to the ramp's height; the
 * inside face within 1 cm of the master's centre height.
 */
export type SeamLimits = { fullDz: number; maxDz: number };

/**
 * The merged decks' cases: seam_hole (stretches of probes meeting no face), seam_step (stretches of
 * probes off the seam limits, outside a hole's stretch: in one a ray can meet a face metres down,
 * the same defect), merge_skipped (one per chunk and partner), let_go (each let-go point).
 */
export function seamCases(
  probes: readonly SeamProbeLike[],
  cuts: readonly LetGoLike[],
  misses: readonly MergeMissLike[],
  limits: SeamLimits,
): FoundCase[] {
  const out: FoundCase[] = [];
  const holes = stretches(probes.filter((p) => p.step === null));
  const holeSpans = holes.map((h) => ({
    pair: `${h[0].chunk}|${h[0].with}`,
    s0: h[0].s,
    s1: h[h.length - 1].s,
  }));
  const numbered = new Map<string, number>();
  const nextIndex = (prefix: string) => {
    const n = numbered.get(prefix) ?? 0;
    numbered.set(prefix, n + 1);
    return n;
  };
  for (const h of holes) {
    const pair = `${h[0].chunk}|${h[0].with}`;
    out.push({
      key: `seam_hole:${pair}|${nextIndex(`seam_hole:${pair}`)}`,
      kind: "seam_hole",
      run: runOfChunk(h[0].chunk),
      with: h[0].with,
      chunk: h[0].chunk,
      measured: { probes: h.length, s0: round(h[0].s, 1), s1: round(h[h.length - 1].s, 1) },
    });
  }
  const inHole = (p: SeamProbeLike) =>
    holeSpans.some((h) => h.pair === `${p.chunk}|${p.with}` && p.s >= h.s0 && p.s <= h.s1);
  const isOff = (p: SeamProbeLike) => {
    const limit = Math.abs(p.dz) <= limits.fullDz ? 0.001 : limits.maxDz + 0.001;
    return p.step! > limit || Math.abs(p.inside!) > 0.01 + 1e-4;
  };
  const off = probes.filter((p) => p.step !== null && !inHole(p) && isOff(p));
  for (const st of stretches(off)) {
    const pair = `${st[0].chunk}|${st[0].with}`;
    out.push({
      key: `seam_step:${pair}|${nextIndex(`seam_step:${pair}`)}`,
      kind: "seam_step",
      run: runOfChunk(st[0].chunk),
      with: st[0].with,
      chunk: st[0].chunk,
      measured: {
        probes: st.length,
        s0: round(st[0].s, 1),
        s1: round(st[st.length - 1].s, 1),
        stepM: round(Math.max(...st.map((p) => p.step!)), 4),
        insideM: round(Math.max(...st.map((p) => Math.abs(p.inside!))), 4),
      },
    });
  }
  for (const m of misses.toSorted((a, b) => (`${a.chunk}|${a.with}` < `${b.chunk}|${b.with}` ? -1 : 1))) {
    out.push({
      key: `merge_skipped:${m.chunk}|${m.with}`,
      kind: "merge_skipped",
      run: runOfChunk(m.chunk),
      with: m.with,
      chunk: m.chunk,
      measured: { s0: round(m.s0, 1), s1: round(m.s1, 1), maxDzM: round(m.maxDzM, 3) },
    });
  }
  const sortedCuts = cuts.toSorted((a, b) =>
    a.chunk === b.chunk
      ? a.with === b.with
        ? a.s - b.s
        : a.with < b.with
          ? -1
          : 1
      : a.chunk < b.chunk
        ? -1
        : 1,
  );
  for (const c of sortedCuts) {
    const pair = `${c.chunk}|${c.with}`;
    const measured: Measured = { s: round(c.s, 1) };
    if (c.alongStep !== null) measured.alongStepM = round(c.alongStep, 4);
    out.push({
      key: `let_go:${pair}|${nextIndex(`let_go:${pair}`)}`,
      kind: "let_go",
      run: runOfChunk(c.chunk),
      with: c.with,
      chunk: c.chunk,
      measured,
    });
  }
  return out;
}

/** Whether a rule accepts the case without a review (the kind's condition holds). */
export function isAutoAccepted(c: Pick<FoundCase, "kind" | "measured">): boolean {
  if (c.kind === "nose") return true;
  if (c.kind === "portal-open-cut")
    return c.measured.lengthM !== undefined && c.measured.lengthM <= PORTAL_OPEN_CUT_MAX_M;
  if (c.kind === "let_go")
    return c.measured.alongStepM !== undefined && c.measured.alongStepM <= LET_GO_MAX_STEP_M;
  const isOpenGround = c.kind === "cut-stretch" || c.kind === "embankment-stretch";
  if (isOpenGround)
    return (
      c.measured.lengthM !== undefined &&
      isOpenGroundRuled({
        structure: c.kind === "cut-stretch" ? "cut" : "embankment",
        lengthM: c.measured.lengthM,
        depthM: c.measured.depthM ?? 0,
      })
    );
  if (c.kind === "thin-girder")
    return c.measured.girderM !== undefined && c.measured.girderM >= GIRDER_MIN.value - 1e-9;
  return false;
}

/** The rule's reason for a case it accepts. */
export function ruleReason(kind: CaseKind): string | null {
  if (kind === "nose") return NOSE_REASON;
  if (kind === "portal-open-cut") return PORTAL_OPEN_CUT_REASON;
  if (kind === "let_go") return LET_GO_REASON;
  if (kind === "cut-stretch") return CUT_STRETCH_REASON;
  if (kind === "embankment-stretch") return EMBANKMENT_STRETCH_REASON;
  if (kind === "thin-girder") return THIN_GIRDER_REASON;
  return null;
}

/**
 * Whether a measure stays within a decided cap and CASE_MARGIN: counts +2, |Δz|, steps and face
 * misses +5 cm, a stretch's start −5 m and end +5 m, a point ±5 m, a radius −0.5 m, a length +5 m,
 * a high deck's height +0.5 m and length +20 m (HIGH_DECK_MARGIN).
 * A measure the cap names but the case lacks is out (the case changed shape).
 */
export function withinCap(measured: Measured, cap: Measured): boolean {
  const { stations, dzM, edgeM, radiusM } = CASE_MARGIN;
  for (const k of MEASURES) {
    const c = cap[k];
    if (c === undefined || k === "minDzM") continue;
    const m = measured[k];
    if (m === undefined) return false;
    const isCount = k === "stations" || k === "probes";
    if (isCount && m > c + stations) return false;
    const isMiss = k === "maxDzM" || k === "stepM" || k === "insideM" || k === "alongStepM";
    if (isMiss && m > c + dzM + 1e-9) return false;
    if (k === "s0" && m < c - edgeM) return false;
    if (k === "s1" && m > c + edgeM) return false;
    if (k === "s" && Math.abs(m - c) > edgeM) return false;
    if (k === "minRadiusM" && m < c - radiusM - 1e-9) return false;
    if (k === "lengthM" && m > c + edgeM) return false;
    if (k === "heightM" && m > c + HIGH_DECK_MARGIN.heightM + 1e-9) return false;
    if (k === "spanM" && m > c + HIGH_DECK_MARGIN.spanM + 1e-9) return false;
    if (k === "depthM" && m > c + dzM + 1e-9) return false;
    if (k === "girderM" && m < c - dzM - 1e-9) return false;
  }
  return true;
}

/**
 * The measures a decided cap must state, per kind (a cap of {} would accept anything). The rule's
 * kinds have none when the rule takes them; decided by a review (beyond the rule) they need these.
 */
export const CAP_FIELDS: Readonly<Record<CaseKind, ReadonlyArray<keyof Measured>>> = {
  nose: ["stations", "maxDzM"],
  changeover: ["stations", "maxDzM"],
  "parallel-ramp": ["stations", "maxDzM"],
  touchdown: ["stations", "maxDzM"],
  other: ["stations", "maxDzM"],
  "portal-open-cut": ["s0", "s1"],
  "ramp-radius": ["minRadiusM"],
  "layer-ambiguous": ["s"],
  seam_step: ["stepM", "insideM", "s0", "s1"],
  seam_hole: ["s0", "s1"],
  merge_skipped: ["maxDzM", "s0", "s1"],
  let_go: ["s", "alongStepM"],
  "high-deck": ["heightM", "spanM", "s0", "s1"],
  "cut-stretch": ["lengthM", "depthM", "s0", "s1"],
  "embankment-stretch": ["lengthM", "depthM", "s0", "s1"],
  "thin-girder": ["girderM"],
  "low-viaduct": ["lengthM", "s0", "s1"],
};

/** Whether a decided case accepts what is measured now (accepted or wontfix, within its cap). */
export function isDecidedAccepted(entry: LedgerCase | undefined, measured: Measured): boolean {
  if (!entry) return false;
  const isAccepting = entry.status === "accepted" || entry.status === "wontfix";
  if (!isAccepting) return false;
  if (entry.by === "rule") return false;
  return entry.cap !== null && withinCap(measured, entry.cap);
}

/**
 * The verdict for the diagnostics RULES do not cover (allowlist.ts isAllowed): its case accepted by
 * a rule (nose, portal-open-cut within the length), or decided in the ledger and within its cap.
 */
export function ledgerVerdict(ctx: CaseContext, ledger: Ledger | null): CaseVerdict {
  const byKey = new Map((ledger?.cases ?? []).map((c) => [c.key, c]));
  return (d) => {
    const c = caseOfDiagnostic(d, ctx);
    if (!c) return false;
    if (isAutoAccepted(c)) return true;
    return isDecidedAccepted(byKey.get(c.key), c.measured);
  };
}

/** The tightest radius T6 takes on a ramp: its ledger case's cap less CASE_MARGIN, if decided. */
export function rampFloorOf(ledger: Ledger | null): (run: string) => number | undefined {
  const byKey = new Map((ledger?.cases ?? []).map((c) => [c.key, c]));
  return (run) => {
    const c = byKey.get(`ramp-radius:${run}`);
    const isAccepting = c !== undefined && (c.status === "accepted" || c.status === "wontfix");
    const cap = c?.cap?.minRadiusM;
    if (!isAccepting || cap === undefined) return undefined;
    return round(cap - CASE_MARGIN.radiusM, 3);
  };
}

/** A case's block ids and dataHashes (of its runs' blocks, joined by "+", sorted, each once). */
export function blocksOf(
  blocks: readonly XwBlockRecord[],
  runs: readonly string[],
): { block: string; blockHash: string } {
  const hit = blocks
    .filter((b) => runs.some((r) => b.runs.includes(r)))
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  return { block: hit.map((b) => b.id).join("+"), blockHash: hit.map((b) => b.dataHash).join("+") };
}

const decisionOf = (c: LedgerCase): Decision => ({
  status: c.status,
  by: c.by,
  cap: c.cap,
  reason: c.reason,
  qa: c.qa,
});

const sameMeasured = (a: Measured, b: Measured) =>
  JSON.stringify(orderMeasured(a)) === JSON.stringify(orderMeasured(b));

/** A case in the file's field order. */
function caseOf(
  f: FoundCase & { district: District; block: string; blockHash: string },
  d: Decision,
  previous: Decision | null,
): LedgerCase {
  return {
    key: f.key,
    kind: f.kind,
    run: f.run,
    with: f.with,
    chunk: f.chunk,
    district: f.district,
    block: f.block,
    blockHash: f.blockHash,
    measured: orderMeasured(f.measured),
    cap: d.cap === null ? null : orderMeasured(d.cap),
    status: d.status,
    by: d.by,
    reason: d.reason,
    qa: d.qa,
    previous,
  };
}

const NEW: Decision = { status: "new", by: null, cap: null, reason: null, qa: null };

/**
 * A decision carried to a case measured anew (rule 3): kept while the case is within the cap (and
 * margin), else the case is `new` with the decision kept in `previous`. A rule's acceptance does not
 * carry (the rule decides again); `new` stays `new`.
 */
function carry(decision: Decision, measured: Measured): { decision: Decision; previous: Decision | null } {
  const isUndecided = decision.status === "new" || decision.by === "rule";
  if (isUndecided)
    return { decision: { ...NEW, qa: decision.qa }, previous: decision.by === "rule" ? decision : null };
  const isWithin = decision.cap !== null && withinCap(measured, decision.cap);
  if (isWithin) return { decision, previous: null };
  return { decision: { ...NEW, qa: decision.qa }, previous: decision };
}

export type UpdateOptions = {
  data: Ledger["data"];
  /** Cases found in the files, with their district and block. */
  found: ReadonlyArray<FoundCase & { district: District; block: string; blockHash: string }>;
  seamProbes: number;
  rules: Record<string, number>;
  /** The km of viaduct over 15 and 20 m per district (highDeck.ts heightKmOf). */
  heightKm?: HeightKm;
  /** Drop the gone cases instead of keeping them. */
  prune?: boolean;
  /** Another folder's ledger to take decisions from by key (a folder with no ledger yet). */
  seed?: Ledger | null;
  /** Write the budget from this summary (a review tightening or loosening the ratchet). */
  writeBudget?: boolean;
};

/**
 * The ledger after counting the files again (5.4): new cases come in `new`; a case whose blocks did
 * not change (same blockHash and measures) is left as it is; one whose blocks changed takes its new
 * measures and keeps its decision within the cap and margin, else goes back to `new` with the
 * decision in `previous`; a rule's kind is accepted while its condition holds; a case no longer
 * found is `gone` (removed with `prune`). Cases sorted by key; the same input gives the same ledger.
 */
export function updateLedger(prev: Ledger | null, opts: UpdateOptions): Ledger {
  const old = new Map((prev?.cases ?? []).map((c) => [c.key, c]));
  const seed = new Map((opts.seed?.cases ?? []).map((c) => [c.key, c]));
  const cases: LedgerCase[] = [];
  const found = [...opts.found].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const foundKeys = new Set(found.map((f) => f.key));
  for (const f of found) {
    const was = old.get(f.key);
    const isAuto = isAutoAccepted(f);
    if (isAuto) {
      const rule: Decision = {
        status: "accepted",
        by: "rule",
        cap: null,
        reason: ruleReason(f.kind),
        qa: was?.qa ?? seed.get(f.key)?.qa ?? null,
      };
      cases.push(caseOf(f, rule, null));
      continue;
    }
    const isLive = was !== undefined && was.status !== "gone";
    if (isLive) {
      const isUnchanged = was.blockHash === f.blockHash && sameMeasured(was.measured, f.measured);
      if (isUnchanged) {
        cases.push(caseOf(f, decisionOf(was), was.previous));
        continue;
      }
      const { decision, previous } = carry(decisionOf(was), f.measured);
      cases.push(caseOf(f, decision, previous ?? was.previous));
      continue;
    }
    const isBack = was !== undefined && was.previous !== null;
    if (isBack) {
      const { decision, previous } = carry(was.previous!, f.measured);
      cases.push(caseOf(f, decision, previous));
      continue;
    }
    const seeded = seed.get(f.key);
    const isSeeded = seeded !== undefined && seeded.status !== "gone";
    if (isSeeded) {
      const { decision, previous } = carry(decisionOf(seeded), f.measured);
      cases.push(caseOf(f, decision, previous));
      continue;
    }
    cases.push(caseOf(f, NEW, null));
  }
  for (const [key, was] of old) {
    if (foundKeys.has(key) || opts.prune) continue;
    const isGoneAlready = was.status === "gone";
    const previous = isGoneAlready ? was.previous : was.status === "new" ? null : decisionOf(was);
    cases.push(
      caseOf(was, { status: "gone", by: null, cap: null, reason: was.reason, qa: was.qa }, previous),
    );
  }
  cases.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const summary = summaryOf(cases, opts.seamProbes, opts.rules, opts.heightKm);
  const budget = opts.writeBudget ? budgetOf(summary) : (prev?.budget ?? null);
  return { version: LEDGER_VERSION, data: opts.data, summary, budget, cases };
}

/** The tool's counts over the cases. */
export function summaryOf(
  cases: readonly LedgerCase[],
  seamProbes: number,
  rules: Record<string, number>,
  heightKm?: HeightKm,
): LedgerSummary {
  const tally: LedgerSummary["cases"] = {};
  for (const district of DISTRICTS) {
    for (const kind of CASE_KINDS) {
      for (const status of STATUSES) {
        const n = cases.filter(
          (c) => c.district === district && c.kind === kind && c.status === status,
        ).length;
        if (n === 0) continue;
        const byKind = (tally[district] ??= {});
        const byStatus = (byKind[kind] ??= {});
        byStatus[status] = n;
      }
    }
  }
  const live = cases.filter((c) => c.status !== "gone");
  const isQaKind = (c: LedgerCase) => c.kind === "changeover" || c.kind === "parallel-ramp";
  return {
    cases: tally,
    open: live.filter((c) => c.status === "open").length,
    withoutQa: live.filter((c) => isQaKind(c) && c.qa === null).length,
    seamProbes,
    rules: Object.fromEntries(RULE_KINDS.map((k) => [k, rules[k] ?? 0])),
    ...(heightKm === undefined ? {} : { heightKm }),
  };
}

/** A km rounded up to HEIGHT_KM_STEP (the budget's cap: room for a rebuild's wobble, none for a trend). */
export const capKm = (km: number) => round(Math.ceil(round(km / HEIGHT_KM_STEP, 9)) * HEIGHT_KM_STEP, 3);

/** The summary as a budget states it (gone cases left out, the statuses summed). */
export function budgetOf(summary: LedgerSummary): LedgerBudget {
  const cases: LedgerBudget["cases"] = {};
  for (const district of DISTRICTS) {
    for (const kind of CASE_KINDS) {
      const byStatus = summary.cases[district]?.[kind] ?? {};
      const n = STATUSES.filter((s) => s !== "gone").reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
      if (n === 0) continue;
      (cases[district] ??= {})[kind] = n;
    }
  }
  const heightKm =
    summary.heightKm === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(summary.heightKm).map(([d, v]) => [
            d,
            { over15Km: capKm(v.over15Km), over20Km: capKm(v.over20Km) },
          ]),
        );
  return {
    cases,
    open: summary.open,
    withoutQa: summary.withoutQa,
    seamProbes: summary.seamProbes,
    rules: summary.rules,
    ...(heightKm === undefined ? {} : { heightKm }),
  };
}

/**
 * The districts whose km over 15 or 20 m exceed the budget's caps, one problem each (empty: within).
 * A district measured but with no cap in the budget is a problem too: a new district must get one.
 */
export function withinHeightBudget(summary: LedgerSummary, budget: LedgerBudget): string[] {
  const out: string[] = [];
  for (const [d, v] of Object.entries(summary.heightKm ?? {})) {
    const cap = budget.heightKm?.[d as District];
    const isUncapped = cap === undefined;
    if (isUncapped) {
      out.push(`${d}: no cap in the budget`);
      continue;
    }
    const isOver15 = v.over15Km > cap.over15Km;
    if (isOver15) out.push(`${d}: over 15 m ${v.over15Km} km > ${cap.over15Km}`);
    const isOver20 = v.over20Km > cap.over20Km;
    if (isOver20) out.push(`${d}: over 20 m ${v.over20Km} km > ${cap.over20Km}`);
  }
  return out;
}

/**
 * report.json's `allowed` decided again from a ledger (the ledger tool, after a review decided a
 * case of a diagnostic): the build wrote `allowed` with the ledger it had then, so a decision taken
 * later must reach the record without a rebuild. Returns how many changed; the record is changed in
 * place (its fields keep their order, so the file is rewritten byte-stable).
 */
export function reallowRecord(
  record: Pick<XwBuildRecord, "diagnostics">,
  ctx: CaseContext,
  ledger: Ledger | null,
): number {
  const verdict = ledgerVerdict(ctx, ledger);
  let changed = 0;
  for (const d of record.diagnostics) {
    const allowed = isAllowed(d, verdict);
    if (allowed === d.allowed) continue;
    d.allowed = allowed;
    changed++;
  }
  return changed;
}

/** The CaseContext of a build: its runs, report.json's untied pairs and the chunks' tunnel mouths. */
export function caseContextOf(
  runs: ReadonlyArray<Pick<XwTileRun, "id" | "cls" | "start" | "end">>,
  untied: ReadonlyArray<{ a: string; b: string }>,
  chunks: ReadonlyArray<XwChunk>,
): CaseContext {
  const mouths = new Map<string, number[]>();
  for (const c of chunks)
    for (const p of c.portals ?? []) {
      const isMouth = (p.from === "tunnel") !== (p.to === "tunnel");
      if (isMouth) mouths.set(c.run, [...(mouths.get(c.run) ?? []), p.s]);
    }
  return {
    runs: new Map(runs.map((r) => [r.id, r])),
    untied: new Set(untied.map((p) => (p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`))),
    mouths: (run) => mouths.get(run) ?? [],
  };
}

/** How many diagnostics the `*` rules accept, per kind. */
export function ruleCounts(diagnostics: readonly XwDiagnostic[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(RULE_KINDS.map((k) => [k, 0]));
  for (const d of diagnostics) if (isRuleAllowed(d)) out[d.kind]++;
  return out;
}

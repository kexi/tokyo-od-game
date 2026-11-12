import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isAllowed, RULES, SEAM_FULL_DZ_M, SEAM_SLIDE_MAX_DZ_M } from "../src/expressway/allowlist";
import { MERGE_FULL_DZ, MERGE_MAX_DZ } from "../src/world/expresswayMerge";
import { assignDistricts, districtOfRef, type DistrictRun, YAMATE_BOX } from "../src/expressway/districts";
import {
  AUTO_KINDS,
  budgetOf,
  CAP_FIELDS,
  reallowRecord,
  caseContextOf,
  caseOfDiagnostic,
  type FoundCase,
  isAutoAccepted,
  isSlidingSeamStep,
  type Ledger,
  type LedgerCase,
  ledgerVerdict,
  orderMeasured,
  seamCases,
  summaryOf,
  updateLedger,
  withinCap,
  withinHeightBudget,
} from "../src/expressway/ledger";
import { overlapKindOf } from "../src/expressway/overlapClass";
import { type Counted, countCases } from "../scripts/expresswayCases";
import { readExpresswayFiles } from "../scripts/expresswayFiles";

// The ledger of the data folder under test (XW_DATA_DIR, else public/data/expressway; P2.7-4):
// counted again from the files as the tool counts them, it must say the same, decide everything,
// and keep the budget the review wrote.
const files = readExpresswayFiles();
const ledger = files.ledger;
let counted: Counted;
beforeAll(async () => {
  counted = await countCases(files);
}, 120_000);

const live = () => (ledger?.cases ?? []).filter((c) => c.status !== "gone");

describe("the data folder's ledger", () => {
  it("is there, of this data (ranges, scope, objective, extract), with a budget", () => {
    expect(ledger, "run just update-expressway-ledger").not.toBeNull();
    expect(ledger!.data).toEqual({
      ranges: files.meta.ranges.map((r) => r.name),
      scope: files.meta.scope ?? null,
      objective: files.record.objective,
      extract: files.meta.extract.timestamp,
    });
    expect(ledger!.budget, "a review writes the budget (--write-budget)").not.toBeNull();
  });

  it("has no case left undecided (new) and none gone (just update-expressway-ledger … --prune)", () => {
    expect(ledger!.cases.filter((c) => c.status === "new").map((c) => c.key)).toEqual([]);
    expect(ledger!.cases.filter((c) => c.status === "gone").map((c) => c.key)).toEqual([]);
  });

  it("is up to date: the cases counted from the files again are its cases, with the same measures and blocks", () => {
    const found = new Map(counted.found.map((c) => [c.key, c]));
    expect(live().map((c) => c.key)).toEqual([...found.keys()].sort());
    for (const c of live()) {
      const f = found.get(c.key)!;
      expect(c.measured, c.key).toEqual(orderMeasured(f.measured));
      expect([c.kind, c.run, c.with, c.chunk, c.district, c.block, c.blockHash], c.key).toEqual([
        f.kind,
        f.run,
        f.with,
        f.chunk,
        f.district,
        f.block,
        f.blockHash,
      ]);
    }
  });

  it("keeps every decided case within its cap and margin, every rule's case within the rule", () => {
    for (const c of live()) {
      const isRule = c.by === "rule";
      if (isRule) {
        expect(AUTO_KINDS, c.key).toContain(c.kind);
        expect(isAutoAccepted(c), c.key).toBe(true);
        continue;
      }
      // A merge_skipped that follows its pair (S6 PR 3 followPairs): the pair's case is there and
      // accepted (or wontfix), the stretch within the pair's overlap, and no cap of its own.
      const isFollowing = c.by !== null && c.by !== "review";
      if (isFollowing) {
        const pair = live().find((p) => p.key === c.by);
        expect(c.kind, c.key).toBe("merge_skipped");
        expect(["accepted", "wontfix"], c.key).toContain(pair?.status);
        expect(c.cap, c.key).toBeNull();
        const [a, b] = c.run < c.with! ? [c.run, c.with!] : [c.with!, c.run];
        const stretches = counted.pairSpans.get(`${a}|${b}`)?.[c.run] ?? [];
        const isInside = stretches.some(([p, q]) => c.measured.s0! >= p - 5 && c.measured.s1! <= q + 5);
        expect(isInside, c.key).toBe(true);
        continue;
      }
      expect(["accepted", "open", "wontfix"], c.key).toContain(c.status);
      expect(c.cap, c.key).not.toBeNull();
      // A cap must bound what its kind measures (a cap of {} would accept anything).
      for (const field of CAP_FIELDS[c.kind])
        expect(c.cap![field], `${c.key} cap.${field}`).toBeTypeOf("number");
      expect(c.reason?.length ?? 0, c.key).toBeGreaterThan(10);
      expect(
        withinCap(c.measured, c.cap!),
        `${c.key} ${JSON.stringify(c.measured)} > ${JSON.stringify(c.cap)}`,
      ).toBe(true);
    }
  });

  it("lets nothing pass by the rules alone that is a case: every diagnostic the `*` rules do not take is a ledger case", () => {
    const ctx = caseContextOf(files.runs, files.record.untied, files.chunks);
    const keys = new Set(live().map((c) => c.key));
    const verdict = ledgerVerdict(ctx, ledger);
    for (const d of files.diagnostics) {
      const isRule = RULES.some((r) => r.kind === d.kind);
      if (isRule) continue;
      const c = caseOfDiagnostic(d, ctx);
      expect(c, `${d.run} ${d.kind}`).not.toBeNull();
      expect(keys.has(c!.key), c!.key).toBe(true);
      // The build's `allowed` is the same verdict.
      expect(d.allowed, c!.key).toBe(isAllowed(d, verdict));
    }
  });

  it("states the counts it has (summary) and they are the budget the review wrote (the ratchet: more or fewer fails)", () => {
    expect(ledger!.summary).toEqual(
      summaryOf(ledger!.cases, counted.seamProbes, counted.rules, counted.heightKm),
    );
    const { heightKm: _caps, ...counts } = ledger!.budget!;
    const { heightKm: _now, ...expected } = budgetOf(ledger!.summary);
    expect(expected).toEqual(counts);
  });

  it("keeps the km of viaduct over 15 and 20 m per district at most the budget's caps (P2.7-5: not equal, they wobble)", () => {
    expect(ledger!.budget!.heightKm, "--write-budget writes the caps").toBeDefined();
    expect(withinHeightBudget(ledger!.summary, ledger!.budget!)).toEqual([]);
  });

  it("points each qa at a view that exists (<view table>/<view id>)", () => {
    const dir = join(import.meta.dirname, "..", "scripts", "qa", "views");
    const ids = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const table = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        sessions: Array<{ views?: Array<{ id: string }> }>;
      };
      for (const s of table.sessions)
        for (const v of s.views ?? []) ids.add(`${f.replace(".json", "")}/${v.id}`);
    }
    for (const c of ledger!.cases.filter((x) => x.qa !== null))
      expect(ids.has(c.qa!), `${c.key} ${c.qa}`).toBe(true);
  });
});

// ---------- the tool's rules, on a made-up ledger ----------

const DATA = { ranges: ["r"], scope: null, objective: "v1", extract: null };
const found = (
  key: string,
  measured: FoundCase["measured"],
  hash = "h1",
  kind: FoundCase["kind"] = "changeover",
) => ({
  key,
  kind,
  run: key.split(":")[1].split("|")[0],
  with: key.split("|")[1] ?? null,
  chunk: null,
  measured,
  district: "central" as const,
  block: "b",
  blockHash: hash,
});
const update = (
  prev: Ledger | null,
  list: ReturnType<typeof found>[],
  extra: Partial<Parameters<typeof updateLedger>[1]> = {},
) => updateLedger(prev, { data: DATA, found: list, seamProbes: 10, rules: {}, ...extra });
const decide = (l: Ledger, key: string, d: Partial<LedgerCase>): Ledger => ({
  ...l,
  cases: l.cases.map((c) =>
    c.key === key ? { ...c, by: "review", status: "accepted", reason: "reviewed here", ...d } : c,
  ),
});

describe("the ledger tool's rules (updateLedger)", () => {
  const a = found("changeover:a|b", { stations: 10, minDzM: 0.1, maxDzM: 3 });
  const first = update(null, [a]);
  const decided = decide(first, a.key, { cap: { stations: 10, maxDzM: 3 } });

  it("keeps a review's decision in previous when a rule takes the case over (S6 PR 7c), and keeps it there on the next count", () => {
    const old = { probes: 1, s0: 82.6, s1: 82.6, stepM: 0.1604, insideM: 0.0033 };
    const step = found("seam_step:r:0|m|0", old, "h1", "seam_step");
    const reviewed = decide(update(null, [step]), step.key, { cap: old, qa: "expressway/seam" });
    const now = found("seam_step:r:0|m|0", { ...old, minDzM: 0.1489, maxDzM: 0.1489 }, "h2", "seam_step");
    const ruled = update(reviewed, [now]);
    const [c] = ruled.cases;
    expect([c.status, c.by, c.qa]).toEqual(["accepted", "rule", "expressway/seam"]);
    expect(c.previous).toMatchObject({ by: "review", reason: "reviewed here", cap: old });
    expect(update(ruled, [now]).cases[0].previous).toEqual(c.previous);
  });

  it("adds a new case as new, and a rule's case as accepted by the rule", () => {
    expect(first.cases.map((c) => [c.key, c.status, c.by])).toEqual([["changeover:a|b", "new", null]]);
    const nose = update(null, [found("nose:a|c", { stations: 1, maxDzM: 0.2 }, "h1", "nose")]);
    expect(nose.cases.map((c) => [c.status, c.by])).toEqual([["accepted", "rule"]]);
  });

  it("leaves a case whose blocks did not change exactly as it is", () => {
    const again = update(decided, [a]);
    expect(again.cases).toEqual(decided.cases);
  });

  it("keeps the decision of a case whose blocks changed while it stays within cap and margin, else sends it back to new with the decision kept", () => {
    const moved = update(decided, [found(a.key, { stations: 12, minDzM: 0.1, maxDzM: 3.05 }, "h2")]);
    expect(moved.cases[0]).toMatchObject({
      status: "accepted",
      blockHash: "h2",
      measured: { stations: 12, maxDzM: 3.05 },
      previous: null,
    });
    const out = update(decided, [found(a.key, { stations: 13, minDzM: 0.1, maxDzM: 3 }, "h2")]);
    expect(out.cases[0]).toMatchObject({
      status: "new",
      cap: null,
      previous: { status: "accepted", cap: { stations: 10, maxDzM: 3 } },
    });
  });

  it("only adds: a case no longer found is gone (its decision in previous), removed only with prune; one that comes back takes its decision again", () => {
    const gone = update(decided, []);
    expect(gone.cases[0]).toMatchObject({ status: "gone", previous: { status: "accepted" } });
    expect(update(decided, [], { prune: true }).cases).toEqual([]);
    const back = update(gone, [a]);
    expect(back.cases[0]).toMatchObject({ status: "accepted", cap: { stations: 10, maxDzM: 3 } });
  });

  it("seeds a folder without a ledger from another's decisions by key (within the margin)", () => {
    const seeded = update(
      null,
      [
        found(a.key, { stations: 11, minDzM: 0.1, maxDzM: 3 }, "other"),
        found("changeover:x|y", { stations: 1, maxDzM: 1 }),
      ],
      { seed: decided },
    );
    expect(seeded.cases.map((c) => [c.key, c.status])).toEqual([
      ["changeover:a|b", "accepted"],
      ["changeover:x|y", "new"],
    ]);
    expect(seeded.budget).toBeNull();
  });

  it("writes the same ledger twice and whatever order the cases come in; a budget only when asked", () => {
    const b = found("parallel-ramp:c|d", { stations: 3, maxDzM: 1 }, "h1", "parallel-ramp");
    const one = update(decided, [a, b]);
    const two = update(decided, [b, a]);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(JSON.stringify(update(one, [a, b]))).toBe(JSON.stringify(one));
    expect(one.budget).toBeNull();
    const budgeted = update(decided, [a, b], { writeBudget: true });
    expect(budgeted.budget).toEqual(budgetOf(budgeted.summary));
    expect(budgeted.budget!.withoutQa).toBe(2);
  });
});

describe("report.json's allowed decided again from the ledger (the tool, reallowRecord)", () => {
  it("turns a diagnostic allowed once its case is decided, back when it is not, and changes nothing twice", () => {
    const end = { kind: "open" as const };
    const ctx = {
      runs: new Map(["a", "b"].map((id) => [id, { id, cls: "expressway" as const, start: end, end }])),
      untied: new Set<string>(),
      mouths: () => [],
    };
    const d = {
      run: "a",
      kind: "deck_overlap",
      detail: "with b: 3 stations, |Δz| 0.10–2 m, centre lines 6 m apart",
      allowed: false,
    };
    const record = { diagnostics: [d, { run: "a", kind: "vertical_fallback", detail: "", allowed: true }] };
    const undecided = update(null, [found("changeover:a|b", { stations: 3, minDzM: 0.1, maxDzM: 2 })]);
    expect(reallowRecord(record, ctx, undecided)).toBe(0);
    const decided = decide(undecided, "changeover:a|b", { cap: { stations: 3, maxDzM: 2 } });
    expect(reallowRecord(record, ctx, decided)).toBe(1);
    expect(d.allowed).toBe(true);
    expect(reallowRecord(record, ctx, decided)).toBe(0);
    // open is a defect to mend, not accepted: a diagnostic's case set open fails T10.
    expect(
      reallowRecord(
        record,
        ctx,
        decide(undecided, "changeover:a|b", { status: "open", cap: { stations: 3, maxDzM: 2 } }),
      ),
    ).toBe(1);
    expect(d.allowed).toBe(false);
  });
});

describe("the kinds of case", () => {
  it("tells a touchdown (an untied pair) before the scorecard's classes", () => {
    expect(overlapKindOf({ maxDzM: 0.3 }, "expressway", "expressway", true, true)).toBe("touchdown");
    expect(overlapKindOf({ maxDzM: 0.3 }, "expressway", "ramp", true, false)).toBe("nose");
    expect(overlapKindOf({ maxDzM: 0.3 }, "expressway", "ramp", false, false)).toBe("other");
    expect(overlapKindOf({ maxDzM: 3 }, "expressway", "ramp", false, false)).toBe("parallel-ramp");
    expect(overlapKindOf({ maxDzM: 3 }, "expressway", "expressway", false, false)).toBe("changeover");
  });

  it("reads the cases of the diagnostics: a portal's shortfall from the mouth it leans on, a ramp's radius, a crossing on one layer", () => {
    const ctx = {
      runs: new Map(),
      untied: new Set<string>(),
      mouths: (run: string) => (run === "t" ? [108.84, 596.5] : []),
    };
    const portal = caseOfDiagnostic(
      {
        run: "t",
        kind: "tunnel_cover_short",
        detail: "23 stations at 490–596 m cannot reach the box",
        allowed: false,
      },
      ctx,
    )!;
    expect(portal).toMatchObject({ key: "portal-open-cut:t", measured: { lengthM: 106.5 } });
    expect(isAutoAccepted(portal)).toBe(true);
    const far = caseOfDiagnostic(
      {
        run: "t",
        kind: "tunnel_cover_short",
        detail: "40 stations at 300–596 m cannot reach",
        allowed: false,
      },
      ctx,
    )!;
    expect(isAutoAccepted(far)).toBe(false);
    const noMouth = caseOfDiagnostic(
      { run: "u", kind: "tunnel_cover_short", detail: "3 stations at 10–20 m cannot", allowed: false },
      ctx,
    )!;
    expect(isAutoAccepted(noMouth)).toBe(false);
    expect(
      caseOfDiagnostic(
        { run: "r", kind: "ramp_radius", detail: "R=13.4 m < 15 m (V20)", allowed: false },
        ctx,
      ),
    ).toMatchObject({ key: "ramp-radius:r", measured: { minRadiusM: 13.4 } });
    expect(
      caseOfDiagnostic(
        {
          run: "a",
          kind: "crossing_layer_ambiguous",
          detail: "crosses b at 120 m on the same layer 1",
          allowed: false,
        },
        ctx,
      ),
    ).toMatchObject({ key: "layer-ambiguous:a|b", measured: { s: 120 } });
    expect(
      caseOfDiagnostic({ run: "a", kind: "vertical_fallback", detail: "", allowed: true }, ctx),
    ).toBeNull();
  });

  it("groups the merged decks' probes into stretches: a hole, a step outside the hole, a let-go by the rule or not", () => {
    const p = (s: number, step: number | null, inside: number | null = 0, dz = 0.01) => ({
      chunk: "r:0",
      with: "m",
      s,
      dz,
      step,
      inside,
    });
    const cases = seamCases(
      [
        p(1, null),
        p(1.5, 0.5, 2),
        p(2, null),
        p(20, 0.004),
        p(20.5, 0.003),
        p(40, 0.0005),
        p(60, 0.0005, 0.02),
      ],
      [
        { chunk: "r:0", with: "m", s: 70, alongStep: 0.0004 },
        { chunk: "r:0", with: "m", s: 90, alongStep: 0.01 },
      ],
      [{ chunk: "r:0", with: "m", s0: 100, s1: 120, maxDzM: 0.3 }],
      { fullDz: 0.05, maxDz: 0.15 },
    );
    expect(cases.map((c) => [c.key, JSON.stringify(orderMeasured(c.measured))])).toEqual([
      ["seam_hole:r:0|m|0", JSON.stringify({ probes: 2, s0: 1, s1: 2 })],
      [
        "seam_step:r:0|m|0",
        JSON.stringify({ probes: 2, minDzM: 0.01, maxDzM: 0.01, s0: 20, s1: 20.5, stepM: 0.004, insideM: 0 }),
      ],
      [
        "seam_step:r:0|m|1",
        JSON.stringify({
          probes: 1,
          minDzM: 0.01,
          maxDzM: 0.01,
          s0: 60,
          s1: 60,
          stepM: 0.0005,
          insideM: 0.02,
        }),
      ],
      ["merge_skipped:r:0|m", JSON.stringify({ maxDzM: 0.3, s0: 100, s1: 120 })],
      ["let_go:r:0|m|0", JSON.stringify({ s: 70, alongStepM: 0.0004 })],
      ["let_go:r:0|m|1", JSON.stringify({ s: 90, alongStepM: 0.01 })],
    ]);
    expect(cases.filter((c) => c.kind === "let_go").map(isAutoAccepted)).toEqual([true, false]);
  });

  it("takes a sliding band's one or two probes by rule (PR 5's (A), S6 PR 7c); (A2), a seam meant to be one surface, and a longer or deeper stretch stay a review's", () => {
    const at = (s: number, step: number, inside: number, dz: number) => ({
      chunk: "r:0",
      with: "m",
      s,
      dz,
      step,
      inside,
    });
    const limits = { fullDz: 0.05, maxDz: 0.15 };
    const steps = (probes: ReturnType<typeof at>[]) =>
      seamCases(probes, [], [], limits).filter((c) => c.kind === "seam_step");
    // (A): one probe where the pair lets go, 0.149 m apart in the data, a 0.157 m step, 5 mm inside.
    const [a] = steps([at(10, 0.157, 0.005, 0.149)]);
    expect(isAutoAccepted(a)).toBe(true);
    expect(isSlidingSeamStep(a.measured)).toBe(true);
    // Two probes 0.5 m apart, still the band's.
    expect(isAutoAccepted(steps([at(10, 0.16, 0.004, 0.12), at(10.5, 0.158, 0.006, 0.14)])[0])).toBe(true);
    // (A2): no step, the inside face 0.15 m off: not the rule's.
    expect(isAutoAccepted(steps([at(10, 0, 0.15, 0.148)])[0])).toBe(false);
    // A seam meant to be one surface (within MERGE_FULL_DZ): any step over 1 mm is a review's.
    expect(isAutoAccepted(steps([at(10, 0.004, 0, 0.03)])[0])).toBe(false);
    // Past the chords' allowance (0.17 m), or three probes, or past MERGE_MAX_DZ in the data.
    expect(isAutoAccepted(steps([at(10, 0.171, 0.005, 0.149)])[0])).toBe(false);
    expect(
      isAutoAccepted(
        steps([at(10, 0.16, 0.005, 0.12), at(10.5, 0.16, 0.005, 0.12), at(11, 0.16, 0.005, 0.12)])[0],
      ),
    ).toBe(false);
    expect(isAutoAccepted(steps([at(10, 0.16, 0.005, 0.151)])[0])).toBe(false);
    // A case measured before PR 7c (no data |Δz|) is not taken.
    expect(isSlidingSeamStep({ probes: 1, s0: 10, s1: 10, stepM: 0.157, insideM: 0.005 })).toBe(false);
  });

  it("the rule's |Δz| bounds are the runtime's merge (MERGE_FULL_DZ, MERGE_MAX_DZ)", () => {
    expect(SEAM_FULL_DZ_M).toBe(MERGE_FULL_DZ);
    expect(SEAM_SLIDE_MAX_DZ_M).toBe(MERGE_MAX_DZ);
  });
});

describe("districts (provisional, districts.ts)", () => {
  const run = (
    id: string,
    cls: DistrictRun["cls"],
    ref: string | null,
    parents: string[],
    points: Array<[number, number]>,
  ): DistrictRun => ({ id, cls, ref, parents, points });

  it("places a main line by its ref, C2 by the yamate box, a ref not in the table outside", () => {
    expect(districtOfRef("C1", 139.75, 35.65)).toBe("central");
    expect(districtOfRef("6", 139.8, 35.7)).toBe("east");
    expect(districtOfRef("C2", YAMATE_BOX.maxLon - 0.01, YAMATE_BOX.maxLat - 0.01)).toBe("yamate");
    expect(districtOfRef("C2", YAMATE_BOX.maxLon + 0.01, YAMATE_BOX.maxLat - 0.01)).toBe("east");
    expect(districtOfRef("C2", YAMATE_BOX.maxLon - 0.01, YAMATE_BOX.maxLat + 0.01)).toBe("east");
    expect(districtOfRef("K1", 139.65, 35.5)).toBe("outside");
    expect(districtOfRef(null, 139.75, 35.65)).toBeNull();
  });

  it("follows a ramp (or a main line without a ref) to the main line its ends hang from, start first, else the nearest main line", () => {
    const d = assignDistricts([
      run("c1", "expressway", "C1", [], [[139.75, 35.65]]),
      run("six", "expressway", "6", [], [[139.8, 35.7]]),
      run("ramp", "ramp", null, ["link", "six"], [[139.76, 35.66]]),
      run("link", "ramp", null, ["c1"], [[139.75, 35.651]]),
      run("noref", "expressway", null, ["six"], [[139.8, 35.71]]),
      run("street", "street", null, [], [[139.801, 35.701]]),
    ]);
    expect(Object.fromEntries(d)).toEqual({
      c1: "central",
      six: "east",
      ramp: "central",
      link: "central",
      noref: "east",
      street: "east",
    });
  });

  it("puts every run and case of the default data in central (a case's run outside the files by its block)", () => {
    const isDefault = !process.env.XW_DATA_DIR;
    if (!isDefault) return;
    expect([...new Set(counted.districts.values())]).toEqual(["central"]);
    expect([...new Set(counted.found.map((c) => c.district))]).toEqual(["central"]);
  });
});

describe("merge_skipped は同じ 2 本の重なりの事例に従う（S6 PR 3 followPairs）", () => {
  const pair = found("changeover:a|b", { stations: 10, minDzM: 0.1, maxDzM: 3 });
  const merge = (s0: number, s1: number) =>
    found("merge_skipped:a:0|b", { s0, s1, maxDzM: 0.4 }, "h1", "merge_skipped");
  const stretch = (p: number, q: number): [number, number] => [p, q];
  // Two overlaps of the pair on a, far apart (review W2): 100–300 and 2000–2100.
  const spans = new Map([["a|b", { a: [stretch(100, 300), stretch(2000, 2100)], b: [stretch(50, 250)] }]]);
  const accepted = (list: ReturnType<typeof found>[]) =>
    decide(update(null, list, { pairSpans: spans }), pair.key, { cap: { stations: 10, maxDzM: 3 } });

  it("is accepted with the pair's key as `by` while the pair is accepted and it lies within the overlap", () => {
    const l = update(accepted([pair, merge(120, 280)]), [pair, merge(120, 280)], { pairSpans: spans });
    const m = l.cases.find((c) => c.kind === "merge_skipped")!;
    expect([m.status, m.by]).toEqual(["accepted", pair.key]);
    expect(m.previous).toBeNull();
  });

  it("stays new while the pair is new or open", () => {
    const l = update(null, [pair, merge(120, 280)], { pairSpans: spans });
    expect(l.cases.find((c) => c.kind === "merge_skipped")!.status).toBe("new");
    const open = decide(l, pair.key, { status: "open", by: "review" });
    const again = update(open, [pair, merge(120, 280)], { pairSpans: spans });
    expect(again.cases.find((c) => c.kind === "merge_skipped")!.status).toBe("new");
  });

  it("goes back to new once its stretch leaves the overlap", () => {
    const followed = update(accepted([pair, merge(120, 280)]), [pair, merge(120, 280)], { pairSpans: spans });
    const moved = update(followed, [pair, merge(120, 320)], { pairSpans: spans });
    const m = moved.cases.find((c) => c.kind === "merge_skipped")!;
    expect([m.status, m.by, m.previous]).toEqual(["new", null, null]);
  });

  it("leaves a merge_skipped a review decided as the review decided it", () => {
    const first = update(null, [pair, merge(120, 280)], { pairSpans: spans });
    const reviewed = decide(first, "merge_skipped:a:0|b", { status: "wontfix", cap: { maxDzM: 0.5 } });
    const l = update(reviewed, [pair, merge(120, 280)], { pairSpans: spans });
    const m = l.cases.find((c) => c.kind === "merge_skipped")!;
    expect([m.status, m.by]).toEqual(["wontfix", "review"]);
  });

  it("follows within one of the pair's stretches, not between two far apart (review W2)", () => {
    const inSecond = update(accepted([pair, merge(2010, 2090)]), [pair, merge(2010, 2090)], {
      pairSpans: spans,
    });
    expect(inSecond.cases.find((c) => c.kind === "merge_skipped")!.status).toBe("accepted");
    const between = update(accepted([pair, merge(400, 1900)]), [pair, merge(400, 1900)], {
      pairSpans: spans,
    });
    expect(between.cases.find((c) => c.kind === "merge_skipped")!.status).toBe("new");
  });

  it("does not follow a merge_skipped that left its review's cap: it stays new for the review (review W3)", () => {
    const first = update(accepted([pair, merge(120, 280)]), [pair, merge(120, 280)], { pairSpans: spans });
    const reviewed = decide(first, "merge_skipped:a:0|b", { cap: { maxDzM: 0.45, s0: 120, s1: 280 } });
    const past = found("merge_skipped:a:0|b", { s0: 120, s1: 280, maxDzM: 0.6 }, "h2", "merge_skipped");
    const l = update(reviewed, [pair, past], { pairSpans: spans });
    const m = l.cases.find((c) => c.kind === "merge_skipped")!;
    expect([m.status, m.by, m.previous?.by]).toEqual(["new", null, "review"]);
  });

  it("does not follow past the pair's cap |Δz| (and its margin)", () => {
    const wide = found("merge_skipped:a:0|b", { s0: 120, s1: 280, maxDzM: 3.2 }, "h1", "merge_skipped");
    const l = update(accepted([pair, wide]), [pair, wide], { pairSpans: spans });
    expect(l.cases.find((c) => c.kind === "merge_skipped")!.status).toBe("new");
  });
});

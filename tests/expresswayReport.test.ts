import { describe, expect, it } from "vitest";
import {
  checkExtract,
  EXPECTED_EXTRACT_SHA256,
  EXPECTED_EXTRACT_TIMESTAMP,
  pinnedExtractName,
} from "../src/expressway/extract";
import type { XwChunk, XwClass, XwDiagnostic, XwEnd, XwRunSummary } from "../src/expressway/format";
import { classifyOverlap, isJoined, overlapPair } from "../src/expressway/overlapClass";
import { PROPERTIES, type Violations } from "../src/expressway/violations";
import {
  blockChanges,
  buildReport,
  buildsUnlike,
  objectiveLabel,
  outsideOf,
  flattenReport,
  danglingOf,
  deckMismatchOf,
  overlapPairsOf,
  closuresOf,
  forcingOf,
  overlapsOf,
  ReportSchema,
  reversals,
  spreadOf,
  trackingOf,
} from "../src/expressway/report";

const end = (parent?: string): XwEnd =>
  parent ? { kind: "junction", parent, parentS: 0 } : { kind: "ground" };

function run(id: string, cls: XwClass, lengthM: number, start?: string, finish?: string): XwRunSummary {
  return {
    id,
    chain: `c${id}`,
    cls,
    ref: null,
    lengthM,
    V: 60,
    tagV: 60,
    planV: 60,
    minRadiusM: 1e6,
    maxShiftM: 0,
    steps: ["standard"],
    start: end(start),
    end: end(finish),
    chunks: [],
    structure: null,
  };
}

const overlap = (a: string, b: string, stations: number, maxDz: number, allowed = false): XwDiagnostic => ({
  run: a,
  kind: "deck_overlap",
  detail: `with ${b}: ${stations} stations, |Δz| 0.06–${maxDz.toFixed(2)} m, centre lines 3.0 m apart`,
  allowed,
});

/** One viaduct chunk of `lengthM` with stations every 10 m from z(s) and ground(s). */
function chunkOf(
  id: string,
  lengthM: number,
  z: (s: number) => number,
  grade: (s: number) => number,
  ground: (s: number) => number,
): XwChunk {
  const st: number[] = [];
  for (let s = 0; s <= lengthM + 1e-9; s += 10) st.push(s, 139.75, 35.65, z(s), 0, ground(s), grade(s));
  return {
    id: `${id}:0`,
    run: id,
    k: 0,
    cls: "expressway",
    structure: "viaduct",
    over: null,
    st,
    decks: [],
    cross: [],
  } as unknown as XwChunk;
}

describe("床版の重なりの類型（overlapClass.ts）", () => {
  const main = run("1", "expressway", 3000);
  const other = run("2", "expressway", 3000);
  const branch = run("3", "ramp", 400, "1");

  it("reads a deck_overlap diagnostic's pair, stations and largest |Δz|", () => {
    expect(overlapPair(overlap("1", "3", 4, 0.31, true))).toEqual({
      a: "1",
      b: "3",
      stations: 4,
      minDzM: 0.06,
      maxDzM: 0.31,
      allowed: true,
    });
    expect(overlapPair({ run: "1", kind: "ramp_radius", detail: "R=12 m", allowed: true })).toBeNull();
  });

  it("a ramp within 0.5 m of the main line it leaves is a nose", () => {
    expect(isJoined(main, branch)).toBe(true);
    expect(classifyOverlap({ maxDzM: 0.31 }, "expressway", "ramp", isJoined(main, branch))).toBe("nose");
  });

  it("two ramps leaving one run are joined too (their nose)", () => {
    expect(isJoined(run("4", "ramp", 300, "1"), run("5", "ramp", 300, undefined, "1"))).toBe(true);
  });

  it("a ramp at heights apart from the main line beside it is parallel-ramp", () => {
    expect(classifyOverlap({ maxDzM: 3.2 }, "ramp", "expressway", true)).toBe("parallel-ramp");
  });

  it("two main lines apart in height are a changeover (two levels to side by side)", () => {
    expect(isJoined(main, other)).toBe(false);
    expect(classifyOverlap({ maxDzM: 4.1 }, "expressway", "expressway", false)).toBe("changeover");
  });

  it("a near-surface pair not joined, and ramps over ramps, are other", () => {
    expect(classifyOverlap({ maxDzM: 0.2 }, "expressway", "expressway", false)).toBe("other");
    expect(classifyOverlap({ maxDzM: 2 }, "ramp", "ramp", true)).toBe("other");
  });

  it("counts pairs and stations per kind, and those not allowed apart", () => {
    const runs = [main, other, branch];
    const out = overlapsOf(
      [overlap("1", "3", 4, 0.31, true), overlap("1", "2", 12, 4.1), overlap("2", "3", 3, 2.5)],
      runs,
    );
    expect(out.nose).toEqual({ pairs: 1, stations: 4, notAllowedPairs: 0, notAllowedStations: 0 });
    expect(out.changeover).toEqual({ pairs: 1, stations: 12, notAllowedPairs: 1, notAllowedStations: 12 });
    expect(out["parallel-ramp"]).toEqual({
      pairs: 1,
      stations: 3,
      notAllowedPairs: 1,
      notAllowedStations: 3,
    });
    expect(out.other.pairs).toBe(0);
  });
});

describe("範囲の外の run の診断（report.ts outsideOf、S6 PR 7c）", () => {
  const d = (run: string, kind: string): XwDiagnostic => ({ run, kind, detail: "", allowed: false });
  it("counts per kind the diagnostics of runs outside the range, and leaves the field out when there are none", () => {
    const diagnostics = [
      d("1", "ramp_radius"),
      d("8", "tunnel_cover_short"),
      d("9", "tunnel_cover_short"),
      d("9", "ramp_radius"),
    ];
    expect(outsideOf(diagnostics, new Set(["1"]))).toEqual({
      diagnosticsOutside: { ramp_radius: 1, tunnel_cover_short: 2 },
    });
    expect(outsideOf(diagnostics, new Set(["1", "8", "9"]))).toEqual({});
  });
});

describe("閉鎖の根と道連れ（report.ts closuresOf）", () => {
  it("follows parent_unsolved up to the root and books the dragged runs and km to it", () => {
    const planned = [
      { id: "1", cls: "expressway" as const, lengthM: 5000, below: false, wanted: true },
      { id: "2", cls: "ramp" as const, lengthM: 400, below: false, wanted: true },
      { id: "3", cls: "ramp" as const, lengthM: 600, below: false, wanted: true },
      { id: "9", cls: "ramp" as const, lengthM: 200, below: false, wanted: true },
    ];
    const closed = [
      { run: "1", chain: "c1", cls: "expressway" as const, reason: "vertical_unsolved" },
      { run: "2", chain: "c2", cls: "ramp" as const, reason: "parent_unsolved" },
      { run: "3", chain: "c3", cls: "ramp" as const, reason: "parent_unsolved" },
      { run: "9", chain: "c9", cls: "ramp" as const, reason: "vertical_unsolved" },
    ];
    const diagnostics: XwDiagnostic[] = [
      { run: "1", kind: "vertical_unsolved", detail: "V60: …", allowed: false },
      { run: "2", kind: "parent_unsolved", detail: "parent 1", allowed: false },
      { run: "3", kind: "parent_unsolved", detail: "parent 2", allowed: false },
    ];
    const out = closuresOf(closed, diagnostics, planned);
    expect(out.roots).toBe(2);
    expect(out.dragged).toEqual({ runs: 2, km: 1 });
    expect(out.list[0]).toEqual({
      run: "1",
      cls: "expressway",
      lengthKm: 5,
      inRange: true,
      dragged: { runs: 2, km: 1 },
    });
    expect(out.list[1].dragged).toEqual({ runs: 0, km: 0 });
  });
});

/** A ground of T.P. 10 ± 5 m in a 2 km wave, and its grade. */
const wave = (s: number) => 10 + 5 * Math.sin((2 * Math.PI * s) / 2000);
const waveGrade = (s: number) => ((5 * 2 * Math.PI) / 2000) * Math.cos((2 * Math.PI * s) / 2000);

describe("地表への追従（report.ts trackingOf）", () => {
  const L = 6000;

  it("a deck following a sine ground correlates with it and reverses its grade at each crest and sag", () => {
    const chunks = [chunkOf("1", L, (s) => wave(s) + 8, waveGrade, wave)];
    const t = trackingOf(chunks, [run("1", "expressway", L)]);
    expect(t.runs).toBe(1);
    expect(t.km).toBeCloseTo(5.4, 3);
    expect(t.correlation).toBeGreaterThan(0.99);
    // Raised 8 m over the ground, it rises metre for metre with it.
    expect(t.slope).toBeCloseTo(1, 2);
    expect(t.shortWaveCorrelation).toBeGreaterThan(0.99);
    // Crests and sags at 500, 1500, … 5500 m: 6 of them between 300 and 5700 m.
    expect(t.reversalsPerKm).toBeCloseTo(6 / 5.4, 3);
    // The 2 km wave less its 500 m moving average leaves (1 − sinc(π/4)) × 5 m ≈ 0.5 m, RMS ≈ 0.35 m.
    expect(t.shortWaveStdM).toBeGreaterThan(0.3);
    expect(t.shortWaveStdM).toBeLessThan(0.4);
  });

  it("a straight deck over the same ground does not correlate, never reverses and has no short waves", () => {
    const chunks = [
      chunkOf(
        "1",
        L,
        (s) => 20 + 0.001 * s,
        () => 0.001,
        wave,
      ),
    ];
    const t = trackingOf(chunks, [run("1", "expressway", L)]);
    expect(Math.abs(t.correlation!)).toBeLessThan(0.2);
    // The straight deck has no short waves at all: nothing to correlate.
    expect(t.shortWaveCorrelation).toBeNull();
    expect(t.reversalsPerKm).toBe(0);
    expect(t.shortWaveStdM).toBeLessThan(1e-6);
  });

  it("leaves out ramps and runs too short to keep anything past their ends", () => {
    const none = {
      km: 0,
      shortWaveCorrelation: null,
      shortWaveStdM: null,
      shortWaveSlope: null,
      reversalsPerKm: null,
    };
    const chunks = [
      chunkOf("1", 700, wave, waveGrade, wave),
      { ...chunkOf("2", L, wave, waveGrade, wave), cls: "ramp" },
    ];
    const t = trackingOf(chunks as XwChunk[], [run("1", "expressway", 700), run("2", "ramp", L)]);
    expect(t).toEqual({
      runs: 0,
      km: 0,
      correlation: null,
      slope: null,
      shortWaveCorrelation: null,
      shortWaveStdM: null,
      reversalsPerKm: null,
      free: none,
      junction: none,
      forcedKm: 0,
      // The 700 m run is a viaduct 8 m over the ground (the wave less nothing): none over 15 m.
      height: { medianM: null, p95M: null, over15Km: 0, over20Km: 0 },
      below: { runs: 0, km: 0, shortWaveStdM: null, reversalsPerKm: null },
    });
  });

  it("free: the decks over or under another, the crossings standing 2 m over the ground and the ends forced, one surface not", () => {
    const c = {
      ...chunkOf("1", L, (s) => wave(s) + 8, waveGrade, wave),
      decks: [
        { with: "7", relation: "above", s0: 2000, s1: 2100 },
        { with: "8", relation: "same", s0: 4000, s1: 4500 },
      ],
      // A deck below at 3,500 m (its top 6 m over the ground) and a street at ground at 4,200 m.
      cross: [3500, wave(3500) + 6, 6.7, wave(3500) + 14, 4200, wave(4200), 6.7, wave(4200) + 8],
    } as XwChunk;
    expect(forcingOf([c])).toEqual([
      [0, 0],
      [L, L],
      [2000, 2100],
      [3500, 3500],
    ]);
    const t = trackingOf([c], [run("1", "expressway", L)]);
    // Tracked 300–5,700 m (5.4 km); forced within 300 m of 0, 6,000, 2,000–2,100 and 3,500 m: free
    // are 310–1,690, 2,410–3,190 and 3,810–5,690 m (the same surface over 4,000–4,500 m stays free).
    expect(t.free!.km).toBeCloseTo(1.38 + 0.78 + 1.88, 3);
    expect(t.forcedKm).toBeCloseTo(5.4 - t.free!.km, 3);
    expect(t.free!.shortWaveCorrelation).toBeGreaterThan(0.99);
    // Crests and sags at 500 and 1,500 (310–1,690), 2,500 (2,410–3,190), 4,500 and 5,500
    // (3,810–5,690): counted inside their free stretch; 3,500 m falls in a forced gap.
    expect(t.free!.reversalsPerKm).toBeCloseTo(5 / t.free!.km, 3);
    expect(t.reversalsPerKm).toBeCloseTo(6 / 5.4, 3);
    // 8 m over the ground everywhere.
    expect(t.height!.medianM).toBeCloseTo(8, 3);
    expect(t.height!.p95M).toBeCloseTo(8, 3);
    // It rises metre for metre with the ground's short waves too.
    expect(t.free!.shortWaveSlope).toBeCloseTo(1, 2);
    // No run joins it: nothing near a junction.
    expect(t.junction!.km).toBe(0);
  });

  it("junction: the free stretches within 300 m of where another run leaves, apart and still in free", () => {
    const c = chunkOf("1", L, (s) => wave(s) + 8, waveGrade, wave);
    const alone = trackingOf([c], [run("1", "expressway", L)]);
    // A ramp leaves at 1,000 m: 700–1,300 m is near it.
    const t = trackingOf([c], [run("1", "expressway", L), run("9", "ramp", 400, "1")]);
    expect(t.junction!.km).toBeCloseTo(0, 6);
    const leaving = {
      ...run("9", "ramp", 400),
      start: { kind: "junction" as const, parent: "1", parentS: 1000 },
    };
    const near = trackingOf([c], [run("1", "expressway", L), leaving]);
    expect(near.junction!.km).toBeCloseTo(0.6, 3);
    // The sag at 1,500 m is past 1,300 m, the crest at 500 m before 700 m: no reversal near it.
    expect(near.junction!.reversalsPerKm).toBe(0);
    expect(near.free).toEqual(alone.free);
  });

  it("heights: the km of viaduct over 15 m and over 20 m above the ground, every written run", () => {
    const high = {
      ...chunkOf(
        "3",
        1000,
        () => 19,
        () => 0,
        () => 3,
      ),
      cls: "ramp",
    } as XwChunk;
    const t = trackingOf([high], [run("3", "ramp", 1000)]);
    expect(t.height!.over15Km).toBeCloseTo(1, 6);
    expect(t.height!.over20Km).toBe(0);
  });

  it("below: the main lines all in tunnels or cuts, their short waves and reversals apart from the viaducts'", () => {
    const tunnel = {
      ...chunkOf("5", L, (s) => wave(s) - 20, waveGrade, wave),
      structure: "tunnel",
    } as XwChunk;
    const t = trackingOf([tunnel], [run("5", "expressway", L)]);
    expect(t.runs).toBe(0);
    expect(t.below!.runs).toBe(1);
    expect(t.below!.km).toBeCloseTo(5.4, 3);
    expect(t.below!.reversalsPerKm).toBeCloseTo(6 / 5.4, 3);
    expect(t.below!.shortWaveStdM).toBeGreaterThan(0.3);
  });

  it("counts a grade's sign change only past the hysteresis", () => {
    expect(reversals([0.01, 0.001, -0.001, 0.001, 0.01])).toBe(0);
    expect(reversals([0.01, -0.003, 0.003])).toBe(2);
  });
});

describe("スコアカードのスキーマ（report.ts ReportSchema）", () => {
  const L = 1200;
  const input = (): Parameters<typeof buildReport>[0] => ({
    label: "t",
    range: "ship",
    below: "pruned",
    extract: {
      url: "https://example.invalid/x.osm.pbf",
      timestamp: EXPECTED_EXTRACT_TIMESTAMP,
      expected: EXPECTED_EXTRACT_TIMESTAMP,
      accepted: false,
      sha256: "a".repeat(64),
    },
    plan: { chains: 2, runs: 2, components: 1, belowRuns: 0, belowDeferred: 0 },
    planned: [
      { id: "1", cls: "expressway", lengthM: L, below: false, wanted: true },
      { id: "2", cls: "ramp", lengthM: 300, below: false, wanted: true },
    ],
    extent: null,
    rampsOutside: null,
    structureDecks: [],
    violations: Object.fromEntries(
      PROPERTIES.map((p) => [p, { count: 0, first: [] as string[] }]),
    ) as unknown as Violations,
    runs: [run("1", "expressway", L)],
    closed: [{ run: "2", chain: "c2", cls: "ramp", reason: "vertical_unsolved" }],
    diagnostics: [{ run: "2", kind: "vertical_unsolved", detail: "…", allowed: false }],
    chunks: [
      chunkOf(
        "1",
        L,
        (s) => 10 + s * 0.01,
        () => 0.01,
        () => 3,
      ),
    ],
    tiles: [{ bytes: 1000, gzipBytes: 200 }],
    meta: { raw: 500, gzip: 100, byField: { tiles: 300 } },
    record: { raw: 900, gzip: 200 },
    ledger: null,
    districts: new Map([["m", "central" as const]]),
    ledgerSummary: null,
    solver: {
      components: 1,
      largestRuns: 2,
      largestVariables: 40,
      solves: 1,
      iterations: 10,
      unconverged: 0,
      qpMs: 1.4,
    },
    partition: {
      mode: "blocks",
      quietFactor: 1.5,
      quietMinM: 300,
      anchors: [
        { run: "1", s: 600, q: 300, z: 16, grade: 0.01, blocks: ["1#0", "1#1"] },
        { run: "1", s: 900, q: 300, z: 19, grade: 0.01, blocks: ["1#1", "1#2"] },
      ],
      pieces: 4,
      neededBlocks: 2,
      routeSolves: 1,
      anchorsNearProblems: 0,
      joins: { dz: 0, dGrade: 0, dBank: 0 },
      blocks: [
        { id: "1#0", pieces: 2, runs: 2, variables: 40, hash: "1".repeat(64) },
        { id: "1#1", pieces: 1, runs: 1, variables: 24, hash: "2".repeat(64) },
      ],
    },
    stagesMs: { plan: 12.6 },
  });

  it("builds a report the schema accepts, with sizes as total, median, p90 and max", () => {
    expect(spreadOf([5, 1, 3, 2, 4])).toEqual({ total: 15, median: 3, p90: 5, max: 5 });
    const report = buildReport(input());
    expect(ReportSchema.parse(report)).toEqual(report);
    expect(report.runs.planned.main).toEqual({ runs: 1, km: 1.2 });
    expect(report.runs.closed.ramp).toEqual({ runs: 1, km: 0.3 });
    expect(report.diagnostics).toEqual({ vertical_unsolved: { allowed: 0, notAllowed: 1 } });
    expect(report.timings).toEqual({ qpMs: 1, stagesMs: { plan: 13 } });
    expect(report.scope.wanted).toEqual(["1", "2"]);
  });

  it("keeps the timings apart: a baseline without them is the same bytes whatever the clock said", () => {
    const slow = { ...input(), stagesMs: { plan: 99999 }, withoutTimings: true };
    const fast = { ...input(), withoutTimings: true };
    expect(buildReport(slow).timings).toBeUndefined();
    expect(JSON.stringify(buildReport(slow))).toBe(JSON.stringify(buildReport(fast)));
  });

  it("names the written runs hanging from a run not written, and decks listed but not carried", () => {
    const runs = [run("1", "expressway", 3000), run("3", "ramp", 400, "1"), run("4", "ramp", 400, "9")];
    expect(danglingOf(runs)).toEqual([{ run: "4", parent: "9" }]);
    const deck = "bridge:upper:forward";
    const carried = { ...runs[0], structure: { deck, s0: 0, s1: 1, osmM: 0, planM: 0, zM: 0 } };
    expect(deckMismatchOf([carried], [deck, "bridge:lower:forward"])).toEqual([
      "listed, not carried: bridge:lower:forward",
    ]);
  });

  it("version 6: the sizes of report.json and the ledger (P2.7-4); the objective (v1 when not given) and v2's weights; version-2 and -3 reports still parse", () => {
    const report = buildReport(input());
    expect(report.version).toBe(6);
    expect(report.size.record).toEqual({ raw: 900, gzip: 200 });
    expect(report.size.ledger).toBeNull();
    // Every district, the planned runs all counted in one (a run with no district is outside).
    expect(Object.keys(report.districts!)).toEqual(["central", "east", "yamate", "outside"]);
    const planned = Object.values(report.districts!).reduce((n, d) => n + d.planned.runs, 0);
    const tally = report.runs.planned;
    expect(planned).toBe(tally.main.runs + tally.ramp.runs + tally.street.runs);
    expect(report.ledger).toBeNull();
    expect(report.objective).toEqual({ kind: "v1", gradeChange: null, reachM: null, targetScale: null });
    const v2 = buildReport({
      ...input(),
      objective: { kind: "v2", gradeChange: 1, reachM: { viaduct: 150, below: 300 }, targetScale: 0.5 },
    });
    expect(v2.objective).toEqual({
      kind: "v2",
      gradeChange: 1,
      reachM: { viaduct: 150, below: 300 },
      targetScale: 0.5,
    });
    const { objective: _o, ...three } = report;
    const { free: _f, junction: _j, forcedKm: _k, height: _h, below: _b, ...tracking } = report.tracking;
    const parsed = ReportSchema.parse({ ...three, tracking, version: 3 });
    expect(parsed.objective).toBeUndefined();
    expect(parsed.tracking.free).toBeUndefined();
  });

  it("compares a version-3 report with a version-4 one as the new fields added and nothing else", () => {
    const report = buildReport({ ...input(), withoutTimings: true });
    const { objective: _o, ...three } = report;
    const { free: _f, junction: _j, forcedKm: _k, height: _h, below: _b, ...tracking } = report.tracking;
    const before = flattenReport(ReportSchema.parse({ ...three, tracking, version: 3 }));
    const after = flattenReport(report);
    const added = [...after.keys()].filter((k) => !before.has(k));
    const changed = [...before.keys()].filter((k) => k !== "version" && before.get(k) !== after.get(k));
    expect(changed).toEqual([]);
    expect([...before.keys()].every((k) => after.has(k))).toBe(true);
    const isNew = (k: string) =>
      [
        "tracking.free.",
        "tracking.junction.",
        "tracking.forcedKm",
        "tracking.height.",
        "tracking.below.",
      ].some((p) => k.startsWith(p));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every(isNew)).toBe(true);
  });

  it("a version-4 report (no junction, slope nor heights over 15 / 20 m) still parses", () => {
    const report = buildReport(input());
    const { junction: _j, ...tracking } = report.tracking;
    const { shortWaveSlope: _s, ...free } = tracking.free!;
    const { over15Km: _a, over20Km: _b, ...height } = tracking.height!;
    const four = ReportSchema.parse({ ...report, version: 4, tracking: { ...tracking, free, height } });
    expect(four.tracking.junction).toBeUndefined();
  });

  it("warns of builds unlike in range, below, extract or objective with its weights", () => {
    const report = buildReport(input());
    const v2 = (w: number) =>
      buildReport({
        ...input(),
        objective: { kind: "v2", gradeChange: w, reachM: { viaduct: 150, below: 300 }, targetScale: 1 },
      });
    expect(buildsUnlike(report, report)).toBeNull();
    expect(buildsUnlike(v2(1.5), v2(1.5))).toBeNull();
    expect(buildsUnlike(report, v2(1.5))).toEqual({
      a: `ship/pruned/${EXPECTED_EXTRACT_TIMESTAMP}/v1`,
      b: `ship/pruned/${EXPECTED_EXTRACT_TIMESTAMP}/v2(w 1.5, reach 150/300, target ×1)`,
    });
    expect(buildsUnlike(v2(1.5), v2(2))).not.toBeNull();
    // A report before version 4 has no objective: v1.
    const { objective: _o, ...old } = report;
    expect(objectiveLabel({ objective: undefined })).toBe("v1");
    expect(buildsUnlike(old, report)).toBeNull();
    expect(buildsUnlike(report, { ...report, below: "all" })).not.toBeNull();
  });

  it("version 3: the partition with its anchor count and largest block, and a version-2 report still parses", () => {
    const report = buildReport(input());
    expect(report.partition!.anchorCount).toBe(2);
    expect(report.partition!.largest).toEqual({ id: "1#0", runs: 2, pieces: 2, variables: 40 });
    const { partition: _, ...old } = report;
    expect(ReportSchema.parse({ ...old, version: 2 }).partition).toBeUndefined();
  });

  it("compares a version-2 report with a version-3 one as the partition added and nothing else", () => {
    const report = buildReport({ ...input(), withoutTimings: true });
    const { partition: _, ...old } = report;
    const before = flattenReport(ReportSchema.parse({ ...old, version: 2 }));
    const after = flattenReport(report);
    const added = [...after.keys()].filter((k) => !before.has(k));
    const changed = [...before.keys()].filter((k) => k !== "version" && before.get(k) !== after.get(k));
    expect(changed).toEqual([]);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((k) => k.startsWith("partition."))).toBe(true);
    // Two anchors on one run keep a row each (keyed run@s), blocks by id.
    expect(added).toContain("partition.anchors[1@600].z");
    expect(added).toContain("partition.anchors[1@900].z");
    expect(added).toContain("partition.blocks[1#1].variables");
  });

  it("sums the blocks up by their solution hash: changed, and on one side only", () => {
    const a = buildReport(input());
    const b = buildReport({
      ...input(),
      partition: {
        ...input().partition,
        blocks: [
          { id: "1#0", pieces: 2, runs: 2, variables: 40, hash: "3".repeat(64) },
          { id: "1#2", pieces: 1, runs: 1, variables: 24, hash: "2".repeat(64) },
        ],
      },
    });
    expect(blockChanges(a, b)).toEqual({ changed: ["1#0"], added: ["1#2"], removed: ["1#1"] });
    expect(blockChanges(a, a)).toEqual({ changed: [], added: [], removed: [] });
  });

  it("lists every overlap pair with its kind, whether joined, and its smallest and largest |Δz|", () => {
    const runs = [run("1", "expressway", 3000), run("3", "ramp", 400, "1")];
    expect(overlapPairsOf([overlap("1", "3", 4, 0.31, true)], runs)).toEqual([
      { a: "1", b: "3", kind: "nose", joined: true, stations: 4, minDzM: 0.06, maxDzM: 0.31, allowed: true },
    ]);
  });
});

describe("抽出の固定（extract.ts）", () => {
  it("goes on with the pinned extract, and with another only when --accept-extract is given", () => {
    expect(checkExtract(EXPECTED_EXTRACT_TIMESTAMP, false)).toEqual({ ok: true });
    const other = checkExtract("2026-11-01T20:20:00Z", false);
    expect(other.ok).toBe(false);
    expect(other.ok ? "" : other.reason).toMatch(/--accept-extract/);
    expect(checkExtract("2026-11-01T20:20:00Z", true)).toEqual({ ok: true });
    expect(checkExtract(null, false).ok).toBe(false);
  });

  it("stops on a file of the pinned timestamp with another SHA-256, and says how to recover", () => {
    expect(checkExtract(EXPECTED_EXTRACT_TIMESTAMP, false, EXPECTED_EXTRACT_SHA256)).toEqual({ ok: true });
    const damaged = checkExtract(EXPECTED_EXTRACT_TIMESTAMP, false, "b".repeat(64));
    expect(damaged.ok).toBe(false);
    expect(damaged.ok ? "" : damaged.reason).toContain(`.cache/osm/${pinnedExtractName()}`);
  });

  it("names the pinned copy by its timestamp, apart from the kanto-latest that fetch-regs refreshes", () => {
    expect(pinnedExtractName()).toBe("kanto-20261003T202050Z.osm.pbf");
  });
});

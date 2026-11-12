import { describe, expect, it } from "vitest";
import { judge, parseRound, type ReviewContext, type Round } from "../scripts/qa/reviewLoop";
import { isCompleteRun, nextRound, roundRead, roundShots } from "../scripts/qa/runRecord";

// Two shots in the table; every round's reviewer covers both unless a test says otherwise.
const SHOTS = ["s--a", "s--b"];
const CTX: ReviewContext = { shots: SHOTS };
const review = (round: number, views = SHOTS) =>
  JSON.stringify({ type: "review", round, perspective: "様式", views });
const finding = (round: number, id: string, severity: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, round, view: "s--a", severity, finding: `${id} is wrong`, ...extra });
const metric = (round: number, name: string, value: number, limits: Record<string, number> = { min: 12 }) =>
  JSON.stringify({ type: "metric", name, round, value, ...limits });
/** Rounds from their lines (a review line covering every shot is added unless `bare`). */
const rounds = (...lines: string[][]): Round[] =>
  lines.map((l, i) => parseRound(i + 1, [review(i + 1), ...l].join("\n"), CTX));

describe("a review round's JSONL", () => {
  it("reads reviews, findings and metrics, a finding's type and status defaulted", () => {
    const r = parseRound(
      1,
      [review(1), finding(1, "s--a:lamp", "Critical"), metric(1, "px", 14)].join("\n"),
      CTX,
    );
    expect(r.reviews).toHaveLength(1);
    expect(r.findings).toEqual([expect.objectContaining({ type: "finding", status: "open" })]);
    expect(r.metrics).toEqual([expect.objectContaining({ name: "px", value: 14 })]);
  });

  it("does not count an empty file as a round: nobody reviewed it", () => {
    expect(() => parseRound(1, "", CTX)).toThrow(/no "review" line/);
    expect(() => parseRound(1, finding(1, "s--a:x", "Info"), CTX)).toThrow(/no "review" line/);
  });

  it("names the line of broken JSON", () => {
    expect(() => parseRound(1, `${review(1)}\n{not json`, CTX)).toThrow(/round 1 line 2: not JSON/);
  });

  it("rejects an unknown severity, naming the line", () => {
    expect(() => parseRound(1, `${review(1)}\n${finding(1, "s--a:x", "Major")}`, CTX)).toThrow(
      /round 1 line 2/,
    );
  });

  it("rejects a line written for another round (a file copied forward unedited)", () => {
    expect(() => parseRound(2, `${review(2)}\n${finding(1, "s--a:x", "Info")}`, CTX)).toThrow(
      /written for round 1/,
    );
  });

  it("rejects the same finding id twice in one round", () => {
    const twice = [review(1), finding(1, "s--a:x", "Critical"), finding(1, "s--a:x", "Warning")].join("\n");
    expect(() => parseRound(1, twice, CTX)).toThrow(/finding s--a:x twice/);
  });

  it("rejects a finding or a review naming a shot the table does not have", () => {
    const stray = [
      review(1),
      JSON.stringify({ id: "x:a", round: 1, view: "nope--x", severity: "Info", finding: "x" }),
    ];
    expect(() => parseRound(1, stray.join("\n"), CTX)).toThrow(/no such shot in the table: nope--x/);
    expect(() => parseRound(1, review(1, ["s--zzz"]), CTX)).toThrow(/no such shot/);
  });

  it("rejects wontfix without its reason", () => {
    expect(() =>
      parseRound(1, `${review(1)}\n${finding(1, "s--a:x", "Critical", { status: "wontfix" })}`, CTX),
    ).toThrow(/wontfix needs the reason/);
  });

  it("rejects a metric with no limit to be within", () => {
    expect(() => parseRound(1, `${review(1)}\n${metric(1, "m", 5, {})}`, CTX)).toThrow(/needs min or max/);
  });
});

describe("the verdict, fail-closed (2 quiet rounds, nothing open, back to the design after 6)", () => {
  it("converges after two quiet rounds once the finding is closed as fixed", () => {
    const v = judge(
      rounds([finding(1, "s--a:x", "Warning")], [finding(2, "s--a:x", "Warning", { status: "fixed" })], []),
      CTX,
    );
    expect(v).toMatchObject({ verdict: "converged", round: 3, quietRounds: 2 });
  });

  it("carries over a Critical left out of a later round: omission is not a fix", () => {
    const v = judge(rounds([finding(1, "s--a:x", "Critical")], [], []), CTX);
    expect(v.verdict).toBe("continue");
    expect(v.reason).toMatch(/1 Critical open/);
    expect(v.diffs[1].carried.map((f) => f.id)).toEqual(["s--a:x"]);
  });

  it("does not converge while a Warning is rewritten open round after round", () => {
    const rewritten = [1, 2, 3].map((n) => [finding(n, "s--a:x", "Warning")]);
    expect(judge(rounds(...rewritten), CTX).reason).toMatch(/1 Warning open/);
  });

  it("closes with wontfix when the reason is given", () => {
    const v = judge(
      rounds(
        [finding(1, "s--a:x", "Critical")],
        [finding(2, "s--a:x", "Critical", { status: "wontfix", fix: "法令上の例外" })],
        [],
      ),
      CTX,
    );
    expect(v.verdict).toBe("converged");
  });

  it("counts a finding raised from Info to Warning under the same id as new", () => {
    const v = judge(rounds([finding(1, "s--a:x", "Info")], [finding(2, "s--a:x", "Warning")]), CTX);
    expect(v.diffs[1].newBlocking).toBe(1);
  });

  it("counts a finding back after a fix as new (a regression)", () => {
    const v = judge(
      rounds([finding(1, "s--a:x", "Warning", { status: "fixed" })], [finding(2, "s--a:x", "Warning")]),
      CTX,
    );
    expect(v.diffs[1].newBlocking).toBe(1);
  });

  it("does not let a metric outside its limit drop out by being left out later", () => {
    const v = judge(rounds([], [metric(2, "m", 5)], []), CTX);
    expect(v.verdict).toBe("continue");
    expect(v.diffs[2].metricProblems).toEqual([expect.objectContaining({ name: "m", problem: "missing" })]);
  });

  it("needs every metric the table requires, every round", () => {
    const ctx = { ...CTX, metrics: [{ name: "text-px-30m", min: 12 }] };
    const r = (n: number, l: string[]) => parseRound(n, [review(n), ...l].join("\n"), ctx);
    expect(judge([r(1, []), r(2, [])], ctx).reason).toMatch(/text-px-30m missing/);
    expect(
      judge([r(1, [metric(1, "text-px-30m", 14)]), r(2, [metric(2, "text-px-30m", 15)])], ctx).verdict,
    ).toBe("converged");
  });

  it("is not quiet when the reviews do not cover every shot", () => {
    const partial = (n: number) => parseRound(n, review(n, ["s--a"]), CTX);
    const v = judge([partial(1), partial(2)], CTX);
    expect(v.verdict).toBe("continue");
    expect(v.reason).toMatch(/1 shot\(s\) not reviewed/);
  });

  it("is not quiet when the round's shoot was incomplete", () => {
    const [a, b] = rounds([], []);
    const v = judge([a, { ...b, isShootComplete: false }], CTX);
    expect(v.verdict).toBe("continue");
    expect(v.reason).toMatch(/shoot is incomplete/);
  });

  it("does not converge on one quiet round", () => {
    const v = judge(
      rounds([finding(1, "s--a:x", "Critical")], [finding(2, "s--a:x", "Critical", { status: "fixed" })]),
      CTX,
    );
    expect(v).toMatchObject({ verdict: "continue", quietRounds: 1 });
  });

  it("sends the design back when round 6 ends without converging, and keeps it so after quiet rounds", () => {
    const noisy = [1, 2, 3, 4, 5, 6].map((n) => [finding(n, `s--a:new-${n}`, "Warning")]);
    expect(judge(rounds(...noisy.slice(0, 5)), CTX).verdict).toBe("continue");
    expect(judge(rounds(...noisy), CTX).verdict).toBe("escalate");
    const closeAll = [1, 2, 3, 4, 5, 6].map((n) =>
      finding(7, `s--a:new-${n}`, "Warning", { status: "fixed" }),
    );
    expect(judge(rounds(...noisy, closeAll, []), CTX).verdict).toBe("escalate");
  });

  it("converges at round 6 rather than escalating when that round makes it", () => {
    const v = judge(
      rounds(
        [],
        [],
        [],
        [finding(4, "s--a:x", "Warning")],
        [finding(5, "s--a:x", "Warning", { status: "fixed" })],
        [],
      ),
      CTX,
    );
    expect(v.verdict).toBe("converged");
  });

  it("refuses rounds with a gap (a missing file would skip a comparison)", () => {
    const [a] = rounds([]);
    const c = parseRound(3, review(3), CTX);
    expect(() => judge([a, c], CTX)).toThrow(/round 2 is missing/);
  });
});

const run = (over: Record<string, unknown> = {}) => ({
  table: "t",
  round: 1,
  only: null,
  shots: SHOTS,
  failed: [],
  complete: true,
  ...over,
});

describe("a round's shoot record", () => {
  it("is complete only with every shot, none failed, not a partial (--only) shoot", () => {
    expect(isCompleteRun(run(), SHOTS)).toBe(true);
    expect(isCompleteRun(run({ failed: [{ shot: "s--b", error: "x" }], complete: false }), SHOTS)).toBe(
      false,
    );
    expect(isCompleteRun(run({ only: ["a"] }), SHOTS)).toBe(false);
    expect(isCompleteRun(run({ shots: ["s--a"] }), SHOTS)).toBe(false);
    expect(isCompleteRun(null, SHOTS)).toBe(false);
  });

  it("numbers a new shoot after the last complete round, or shoots an incomplete one again", () => {
    expect(nextRound(new Map(), SHOTS)).toBe(1);
    expect(nextRound(new Map([[1, run()]]), SHOTS)).toBe(2);
    expect(
      nextRound(
        new Map<number, unknown>([
          [1, run()],
          [2, null],
        ]),
        SHOTS,
      ),
    ).toBe(2);
    expect(
      nextRound(
        new Map([
          [1, run()],
          [2, run({ only: ["a"] })],
        ]),
        SHOTS,
      ),
    ).toBe(2);
  });
});

describe("a round read against the shots it took (P2.7-5: a view taken out of the table)", () => {
  it("checks a past round against its own run.json, so a retired view does not stop the verdict", () => {
    // Round 1 shot and reviewed s--old; the table has since dropped it.
    const old = run({ shots: ["s--a", "s--old"] });
    const shots1 = roundShots(old, SHOTS);
    expect(shots1).toEqual(["s--a", "s--old"]);
    const line = JSON.stringify({ id: "s--old:x", round: 1, view: "s--old", severity: "Info", finding: "x" });
    const text = [review(1, ["s--a", "s--old"]), line].join("\n");
    expect(() => parseRound(1, text, CTX)).toThrow(/no such shot/);
    const r1 = parseRound(1, text, { ...CTX, shots: shots1 });
    const r2 = parseRound(2, review(2), CTX);
    const verdict = judge(
      [
        { ...r1, shots: shots1, isShootComplete: isCompleteRun(old, shots1) },
        { ...r2, isShootComplete: true },
      ],
      CTX,
    );
    expect(verdict.diffs[0].unreviewed).toEqual([]);
    expect(verdict.diffs[0].isShootComplete).toBe(true);
  });

  it("does not count a round whose shoot lacks a view added to the table since, though it reads its review (PR #71 W4)", () => {
    // The table has s--a and s--b now; the shoot took s--a only (s--b added after it).
    const partial = run({ shots: ["s--a"] });
    const read = roundRead(partial, SHOTS);
    expect(read.shots).toEqual(["s--a"]);
    expect(read.isShootComplete).toBe(false);
    expect(nextRound(new Map([[1, partial]]), SHOTS)).toBe(1);
    const r1 = parseRound(1, review(1, ["s--a"]), { ...CTX, shots: read.shots });
    const verdict = judge([{ ...r1, ...read }], CTX);
    expect(verdict.diffs[0].isQuiet).toBe(false);
    expect(verdict.verdict).not.toBe("converged");
    // A view taken out since (the shoot took more than the table has now) still counts.
    expect(roundRead(run({ shots: [...SHOTS, "s--old"] }), SHOTS).isShootComplete).toBe(true);
  });

  it("falls back to the table's shots without a record", () => {
    expect(roundShots(null, SHOTS)).toEqual(SHOTS);
    expect(roundShots({ nonsense: true }, SHOTS)).toEqual(SHOTS);
  });
});

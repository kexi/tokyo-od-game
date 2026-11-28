import { describe, expect, it, vi } from "vitest";
import { DECISIONS, decisionTablesOf } from "../scripts/expresswayGuards";
import { scorecardViolationsOf } from "../scripts/expresswayScorecardViolations";
import { STRUCTURE_DECISIONS } from "../src/expressway/structureDecisions";
import { violationsOf } from "../src/expressway/violations";

vi.mock("../src/expressway/violations", async (original) => ({
  ...(await original<typeof import("../src/expressway/violations")>()),
  violationsOf: vi.fn(() => ({})),
}));

/**
 * PR #136 review 2: the scorecard's T13 is judged by the decisions' tables the build applied. A table
 * left out there would go unseen (a decided stretch allows both structures, so T13 only goes lenient),
 * so the call the build makes is held here.
 */
describe("スコアカードの違反は、生成が当てた決定の表で判定する（--decisions、R1-3）", () => {
  const meta = { runs: [], diagnostics: [] };
  const floor = () => undefined;

  it("hands violationsOf, for every --decisions value, the structure table planNetwork was given (the module's for all), and the rest as given", () => {
    for (const mode of DECISIONS) {
      vi.mocked(violationsOf).mockClear();
      scorecardViolationsOf(mode, meta, [], floor, true);
      const expected = decisionTablesOf(mode)?.structureDecisions ?? STRUCTURE_DECISIONS;
      expect(vi.mocked(violationsOf).mock.calls, mode).toEqual([[meta, [], floor, true, expected]]);
    }
  });
  it("gives an empty table where the structure rows are left out (none, feet-only), never undefined", () => {
    for (const mode of ["none", "feet-only"] as const) {
      vi.mocked(violationsOf).mockClear();
      scorecardViolationsOf(mode, meta, [], floor, true);
      expect(vi.mocked(violationsOf).mock.calls[0][4], mode).toEqual([]);
    }
  });
});

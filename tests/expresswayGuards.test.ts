import { describe, expect, it } from "vitest";
import {
  type BuildFlags,
  DECISIONS,
  decisionsRefusal,
  decisionTablesOf,
  shippedFolderRefusal,
} from "../scripts/expresswayGuards";
import { FOOT_DEFERRALS } from "../src/expressway/footDeferrals";
import { STRUCTURE_DECISIONS } from "../src/expressway/structureDecisions";

/** R1-3: `--decisions` names the decisions' tables applied; any but all is for measuring only. */
describe("決定の表を当てる値（--decisions、R1-3）", () => {
  const plain: BuildFlags = { hasOut: false, isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };
  const flagsOf = (mode: (typeof DECISIONS)[number], hasOut: boolean): BuildFlags => ({
    ...plain,
    hasOut,
    isDecisionsOff: decisionTablesOf(mode) !== null,
  });

  it("lets all (the default) write the shipped folder, and stops every other value without --out", () => {
    expect(shippedFolderRefusal(flagsOf("all", false))).toBeNull();
    for (const mode of ["none", "feet-only", "structures-only"] as const) {
      expect(shippedFolderRefusal(flagsOf(mode, false)), mode).toMatch(/決定の表を外した生成は計測用/);
      expect(shippedFolderRefusal(flagsOf(mode, true)), mode).toBeNull();
    }
  });
  it("stops an unknown value (a typo is not read as all), and takes the four values", () => {
    expect(decisionsRefusal("feet")).toMatch(/^unknown --decisions feet/);
    expect(decisionsRefusal("")).toMatch(/^unknown --decisions/);
    for (const mode of DECISIONS) expect(decisionsRefusal(mode), mode).toBeNull();
  });
  it("gives no table for all (the build reads the modules' as before), and for the others the tables they name as applied", () => {
    expect(decisionTablesOf("all")).toBeNull();
    expect(decisionTablesOf("none")).toEqual({ footDeferrals: [], structureDecisions: [] });
    // feet-only applies the feet's table: its rows all there, the structures' left out.
    const feet = decisionTablesOf("feet-only")!;
    expect(feet.footDeferrals).toEqual(FOOT_DEFERRALS);
    expect(feet.footDeferrals.length).toBe(FOOT_DEFERRALS.length);
    expect(feet.structureDecisions).toEqual([]);
    // structures-only applies the structures' table: the foot (203832842) comes back.
    const structures = decisionTablesOf("structures-only")!;
    expect(structures.structureDecisions).toEqual(STRUCTURE_DECISIONS);
    expect(structures.footDeferrals).toEqual([]);
  });
});

/** What may write public/data/expressway: only a plain v2 build with the assumed weights. */
describe("出荷フォルダに書いてよい生成（scripts/expressway.ts、PR #71 W3）", () => {
  const plain: BuildFlags = { hasOut: false, isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };

  it("lets a plain v2 build write the shipped folder", () => {
    expect(shippedFolderRefusal(plain)).toBeNull();
  });
  it("stops a sweep of the v2 weights without --out, naming the first flag", () => {
    expect(shippedFolderRefusal({ ...plain, v2Flags: ["reach", "grade-change"] })).toMatch(
      /^--reach is for a sweep/,
    );
    for (const flag of ["grade-change", "reach", "reach-below", "target-scale"])
      expect(shippedFolderRefusal({ ...plain, v2Flags: [flag] })).not.toBeNull();
  });
  it("stops --below all, blocks and v1 without --out, as before", () => {
    expect(shippedFolderRefusal({ ...plain, isBelowAll: true })).toMatch(/--below all/);
    expect(shippedFolderRefusal({ ...plain, isBlocks: true })).toMatch(/--partition blocks/);
    expect(shippedFolderRefusal({ ...plain, isV1: true })).toMatch(/--objective v1/);
  });
  it("lets the network's flags (the default since S6 PR 7c) write the shipped folder, and stops the values before them and a weight sweep without --out", () => {
    expect(shippedFolderRefusal(plain)).toBeNull();
    expect(shippedFolderRefusal({ ...plain, isTags: true })).toMatch(/^--structures tags/);
    expect(shippedFolderRefusal({ ...plain, isGroundSkip: true })).toMatch(/^--ground skip/);
    expect(shippedFolderRefusal({ ...plain, isTouchdownMains: true })).toMatch(/^--touchdown mains/);
    expect(shippedFolderRefusal({ ...plain, isCompanionsOff: true })).toMatch(/^--companions off/);
    expect(shippedFolderRefusal({ ...plain, isCompanionWeight: true })).toMatch(/^--companion-weight/);
    const before = { isTags: true, isGroundSkip: true, isTouchdownMains: true, isCompanionsOff: true };
    expect(shippedFolderRefusal({ ...plain, ...before })).toMatch(/^--structures tags/);
    expect(shippedFolderRefusal({ ...plain, hasOut: true, ...before })).toBeNull();
  });
  it("stops --ramp-shift and --nose-surface overlap without --out (S6 PR 4)", () => {
    expect(shippedFolderRefusal({ ...plain, isRampShift: true })).toMatch(/^--ramp-shift/);
    expect(shippedFolderRefusal({ ...plain, isNoseOverlap: true })).toMatch(/^--nose-surface overlap/);
    expect(
      shippedFolderRefusal({ ...plain, hasOut: true, isRampShift: true, isNoseOverlap: true }),
    ).toBeNull();
  });
  it("stops --hold-mains on without --out (S6 PR 6)", () => {
    expect(shippedFolderRefusal({ ...plain, isHoldMains: true })).toMatch(/^--hold-mains on/);
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isHoldMains: true })).toBeNull();
  });
  it("lets every measuring flag through with --out", () => {
    const all: BuildFlags = {
      hasOut: true,
      isBelowAll: true,
      isBlocks: true,
      isV1: true,
      v2Flags: ["reach"],
    };
    expect(shippedFolderRefusal(all)).toBeNull();
  });
});

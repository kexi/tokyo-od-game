import { describe, expect, it } from "vitest";
import { type BuildFlags, shippedFolderRefusal } from "../scripts/expresswayGuards";

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

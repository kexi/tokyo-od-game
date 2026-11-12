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
  it("stops --structures height without --out until PR 7 makes it the default (P2.7-6)", () => {
    expect(shippedFolderRefusal({ ...plain, isHeight: true })).toMatch(/--structures height/);
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isHeight: true })).toBeNull();
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

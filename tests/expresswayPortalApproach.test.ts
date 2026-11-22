import { describe, expect, it } from "vitest";
import { portalApproachRefusal, shippedFolderRefusal } from "../scripts/expresswayGuards";
import {
  type BelowLinkRun,
  ceilingAt,
  ceilingFrom,
  descentWithin,
  hasPortalsBeyond,
  portalReaches,
  TUNNEL_DEPTH_M,
} from "../src/expressway/below";

// S7-2 (`--portal-approach cut`): a tunnel's portal on a lowered approach is read at the lowered
// stretch's start, its length beyond the tunnel's end. What must hold: without a lowered approach every
// ceiling is as before; with one, the way to that portal is the stretch's length longer, at the ground
// of the stretch's start, also for a child that reaches it through its parent under the ground.

/** A tunnel run of `length` m, its ends' ground 3 m, at grade on both sides unless given. */
const tunnel = (id: string, length: number, more: Partial<BelowLinkRun> = {}): BelowLinkRun => ({
  id,
  lengthM: length,
  planV: 60,
  below: true,
  ends: [{ kind: "seam", parent: `${id}-before`, parentS: 0 }, { kind: "open" }],
  ground: [3, 3],
  ...more,
});
const atGrade = (id: string, length: number): BelowLinkRun => ({
  id,
  lengthM: length,
  planV: 60,
  below: false,
  ends: [{ kind: "open" }, { kind: "open" }],
  ground: [3, 3],
});
const linksOf = (...runs: BelowLinkRun[]) => new Map(runs.map((r) => [r.id, r]));

describe("E. 坑口の高さの定義（S7-2 3.3）", () => {
  it("without a lowered approach, a tunnel's ends are its own portals and every ceiling is ceilingAt's", () => {
    const links = linksOf(tunnel("1", 800), atGrade("1-before", 300));
    expect(hasPortalsBeyond(links, "1")).toBe(false);
    const reaches = portalReaches(links, "1");
    expect(reaches).toEqual([[{ offset: 0, z: 3, V: 60 }], [{ offset: 0, z: 3, V: 60 }]]);
    for (let s = 0; s <= 800; s += 25)
      expect(ceilingFrom("tunnel", 30, s, 800, reaches)).toBe(
        ceilingAt("tunnel", 30, s, 800, { z0: 3, z1: 3 }, 60),
      );
  });

  it("with the start's approach lowered for L m, its portal is L m beyond the start at the stretch's start's ground", () => {
    const L = 215;
    const links = linksOf(
      tunnel("1", 800, { portalAt: [{ offsetM: L, z: 4.5, V: 60 }, null] }),
      atGrade("1-before", 300),
    );
    expect(hasPortalsBeyond(links, "1")).toBe(true);
    const [start, end] = portalReaches(links, "1");
    expect(start).toEqual([{ offset: L, z: 4.5, V: 60 }]);
    expect(end).toEqual([{ offset: 0, z: 3, V: 60 }]);
    // At the tunnel's first station the descent from the portal is already the depth's (L is where it
    // reaches TUNNEL_DEPTH_M and the margin), so the ceiling stands there; without the lowering it does not.
    const ground = 4.5;
    expect(descentWithin(60, L)).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M + 0.1);
    expect(ceilingFrom("tunnel", ground, 0, 800, [start, end])).toBeCloseTo(ground - TUNNEL_DEPTH_M, 9);
    expect(ceilingAt("tunnel", ground, 0, 800, { z0: 3, z1: 3 }, 60)).toBeNull();
  });

  it("takes the faster of the tunnel's and the approach's speed over the lowered stretch", () => {
    const links = linksOf(tunnel("1", 800, { planV: 40, portalAt: [{ offsetM: 215, z: 3, V: 60 }, null] }));
    expect(portalReaches(links, "1")[0]).toEqual([{ offset: 215, z: 3, V: 60 }]);
  });

  it("a ramp leaving the tunnel under the ground adds the parent's lowered stretch beyond the parent's portal", () => {
    const parent = tunnel("1", 800, { portalAt: [{ offsetM: 215, z: 4, V: 60 }, null] });
    const ramp: BelowLinkRun = {
      id: "70",
      lengthM: 400,
      planV: 40,
      below: true,
      ends: [{ kind: "junction", parent: "1", parentS: 300 }, { kind: "open" }],
      ground: [3, 3],
    };
    const links = linksOf(parent, ramp);
    expect(hasPortalsBeyond(links, "70")).toBe(true);
    const [start] = portalReaches(links, "70");
    expect(start).toContainEqual({ offset: 300 + 215, z: 4, V: 60 });
    expect(start).toContainEqual({ offset: 500, z: 3, V: 60 });
  });
});

describe("I. 番人（S7-2 3.1）", () => {
  const plain = { isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };
  it("cut stops without --out and is taken with it", () => {
    expect(shippedFolderRefusal({ ...plain, hasOut: false, isPortalApproachCut: true })).toMatch(
      /portal-approach/,
    );
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isPortalApproachCut: true })).toBeNull();
  });

  it("cut needs --below-junctions compile; off takes either; an unknown value stops", () => {
    expect(portalApproachRefusal("cut", "compile")).toBeNull();
    expect(portalApproachRefusal("cut", "defer")).toMatch(/below-junctions compile/);
    expect(portalApproachRefusal("off", "defer")).toBeNull();
    expect(portalApproachRefusal("off", "compile")).toBeNull();
    expect(portalApproachRefusal("down", "compile")).toMatch(/unknown/);
  });
});

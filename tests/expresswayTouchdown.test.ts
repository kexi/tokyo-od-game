import { describe, expect, it } from "vitest";
import { SHARED_TOUCHDOWN } from "../src/expressway/assumptions";
import {
  approachLength,
  endPlan,
  type Plan,
  planNetwork,
  solvePlan,
  untiedPairs,
} from "../src/expressway/compile";
import {
  type TouchdownNet,
  touchdownGround,
  touchdownNet,
  touchdownRoad,
  TOUCHDOWN_PLANE,
} from "./expresswayTouchdown";

// Two main lines coming down to the same place, the upper over the lower by OSM layer (P2.7-3a:
// 都心環状線 41009552 under 668292569). Both touching down there, no grade puts a level between
// them; held a level apart anyway, the soft rows pushed the lower deck down short of the street it
// must clear. These say which station pairs are let go (markSharedTouchdowns) and what that does.

const LOWER = "2";
const UPPER = "5";
const unsolvedKinds = ["vertical_unsolved", "parent_unsolved"];

const planOf = (o: TouchdownNet = {}, range: Parameters<typeof planNetwork>[2] = null) =>
  planNetwork(touchdownNet(o), new Set(), range);
const marked = (plan: Plan) => plan.pairs.filter((p) => p.untied);
const key = (p: Plan["pairs"][number]) => `${p.a}@${p.sa.toFixed(3)}|${p.b}@${p.sb.toFixed(3)}|${p.relation}`;

describe("同じ場所へ降りる本線どうしの 1 段離しは QP の行にしない（P2.7-3a）", () => {
  const plan = planOf();
  const reach = approachLength(40);

  it("marks exactly the above / below pairs within the climb of both ground ends", () => {
    const lower = plan.runs.get(LOWER)!;
    const upper = plan.runs.get(UPPER)!;
    expect(marked(plan).length).toBeGreaterThan(0);
    for (const p of plan.pairs) {
      const [sLow, sUp] = p.a === LOWER ? [p.sa, p.sb] : [p.sb, p.sa];
      // The lower's touchdown is its start (x = 0), the upper's its end (it runs west).
      const isNear = sLow <= reach && upper.length - sUp <= reach;
      expect(p.relation).not.toBe("same");
      expect(p.untied === true).toBe(isNear);
    }
    expect(lower.length).toBeGreaterThan(reach);
  });

  it("solves the lower main line once the pairs are let go, and not with them held", () => {
    const solved = solvePlan(plan, touchdownGround, [touchdownRoad()]);
    expect(solved.diagnostics.filter((d) => unsolvedKinds.includes(d.kind))).toEqual([]);
    expect(solved.runs.map((r) => r.id).sort()).toEqual([LOWER, UPPER]);
    // The same plan with every pair held again (as before P2.7-3a): the lower misses the street.
    const held = planOf();
    for (const p of held.pairs) delete p.untied;
    const before = solvePlan(held, touchdownGround, [touchdownRoad()]);
    const failed = before.diagnostics.filter((d) => unsolvedKinds.includes(d.kind));
    expect(failed.map((d) => d.run)).toEqual([LOWER]);
    expect(failed[0].detail).toMatch(/clearance short/);
  });

  it("keeps the pairs in the chunks' decks and in deck_overlap", () => {
    const solved = solvePlan(plan, touchdownGround, [touchdownRoad()]);
    const decks = solved.chunks.filter((c) => c.run === LOWER).flatMap((c) => c.decks ?? []);
    expect(decks.some((d) => d.with === UPPER && d.relation === "below" && d.s0 < reach)).toBe(true);
    const overlap = solved.diagnostics.filter((d) => d.kind === "deck_overlap" && d.run === LOWER);
    expect(overlap.length).toBe(1);
    expect(overlap[0].detail).toMatch(new RegExp(`with ${UPPER}`));
  });

  it("reports them per run pair among the needed runs (the scorecard's plan.untied)", () => {
    const list = untiedPairs(plan);
    expect(list).toEqual([{ a: LOWER, b: UPPER, component: LOWER, stations: marked(plan).length }]);
  });

  it("marks none when one of the conditions is missing", () => {
    const levelApart = (p: Plan) => p.pairs.filter((q) => q.relation !== "same" && q.sa < reach);
    // The upper comes down into a tunnel (a portal, not a ground end).
    const portal = planOf({ ending: "tunnel" });
    expect(levelApart(portal).length).toBeGreaterThan(0);
    expect(marked(portal)).toEqual([]);
    // The upper is a ramp.
    const ramp = planOf({ upper: "ramp" });
    expect(levelApart(ramp).length).toBeGreaterThan(0);
    expect(marked(ramp)).toEqual([]);
    // The two touch down farther apart than SHARED_TOUCHDOWN.
    const apart = 100;
    expect(apart).toBeGreaterThan(SHARED_TOUCHDOWN.value);
    const far = planOf({ touchdown: -apart });
    expect(levelApart(far).length).toBeGreaterThan(0);
    expect(marked(far)).toEqual([]);
    // One surface (same layer) is never let go.
    const same = planOf({ upperLayer: "1" });
    expect(same.pairs.some((p) => p.relation === "same")).toBe(true);
    expect(marked(same)).toEqual([]);
  });

  it("keeps the pairs at a real crossing of the two tied, even within the climb of a shared touchdown", () => {
    // The upper comes from the south and crosses over the lower 64 m from where both touch down
    // (668292569 over 955398790 in the review): that level is a clearance over a road, kept.
    const crossing = planOf({ over: 60, transition: 100, side: -80, step: 10 });
    const [c] = crossing.crossings;
    expect([c.upper, c.lower]).toEqual([UPPER, LOWER]);
    expect(c.sLower).toBeLessThan(reach);
    const lower = crossing.runs.get(LOWER)!;
    const upper = crossing.runs.get(UPPER)!;
    const w = Math.min(60, (lower.halfWidth + upper.halfWidth) / Math.max(c.sinAngle, 0.2)) + 10;
    const atCrossing = (p: Plan["pairs"][number]) => {
      const [sLow, sUp] = p.a === LOWER ? [p.sa, p.sb] : [p.sb, p.sa];
      return Math.abs(sLow - c.sLower) <= w && Math.abs(sUp - c.sUpper) <= w;
    };
    const near = crossing.pairs.filter(atCrossing);
    expect(near.length).toBeGreaterThan(0);
    expect(near.filter((p) => p.untied)).toEqual([]);
    // Beside each other before the crossing, they are still let go.
    expect(marked(crossing).length).toBeGreaterThan(0);
  });

  it("needs both stations within the climb of their own ground ends (not only the ends 60 m apart)", () => {
    // The upper loops back west and north and touches down 50 m from the lower's end, but its
    // stations beside the lower are 600 m and more from that end along its own run.
    const loop = planOf({ ending: "loop" });
    const upper = loop.runs.get(UPPER)!;
    expect(endPlan(loop, upper, false).kind).toBe("ground");
    const beside = loop.pairs.filter((p) => p.relation !== "same" && (p.a === LOWER ? p.sa : p.sb) < reach);
    expect(beside.length).toBeGreaterThan(0);
    for (const p of beside) expect(upper.length - (p.a === UPPER ? p.sa : p.sb)).toBeGreaterThan(reach);
    expect(marked(loop)).toEqual([]);
  });

  it("judges the ends as the solve sees them, after pruneBelow (an end on a deferred tunnel is a ground end)", () => {
    // The upper ends at a node inside a tunnel that goes on into a viaduct of its own: pruneBelow
    // defers that tunnel (it would join two components), and only then is the upper's end a ground end.
    const pruned = planOf({ ending: "deferredTunnel" });
    expect(pruned.belowDeferred.length).toBe(1);
    expect(marked(pruned).length).toBeGreaterThan(0);
    const kept = planNetwork(touchdownNet({ ending: "deferredTunnel" }), new Set(), null, [], {
      pruneBelow: false,
    });
    expect(kept.belowDeferred).toEqual([]);
    expect(marked(kept)).toEqual([]);
  });

  it("reports only the needed runs' marks (a marked component out of the range is left out)", () => {
    const far = { offset: { id: 100000, y: 5000 } };
    const both = planNetwork(touchdownNet({}, far), new Set(), null);
    const [lon0, lat0] = TOUCHDOWN_PLANE.toLonLat(1500, -20);
    const [lon1, lat1] = TOUCHDOWN_PLANE.toLonLat(1600, 20);
    const box = { minLon: lon0, minLat: lat0, maxLon: lon1, maxLat: lat1 };
    const one = planNetwork(touchdownNet({}, far), new Set(), box);
    expect(new Set(marked(one).map((p) => p.a))).toEqual(new Set([LOWER, UPPER, "100002", "100005"]));
    expect(untiedPairs(one).map((p) => `${p.a}|${p.b}`)).toEqual([`${LOWER}|${UPPER}`]);
    expect(untiedPairs(both).map((p) => `${p.a}|${p.b}`)).toEqual(["100002|100005", `${LOWER}|${UPPER}`]);
  });

  it("is decided on the plan alone: the same pairs whatever the range or the order of the ways (T8)", () => {
    const all = marked(plan).map(key).sort();
    const [lon0, lat0] = TOUCHDOWN_PLANE.toLonLat(1500, -20);
    const [lon1, lat1] = TOUCHDOWN_PLANE.toLonLat(1600, 20);
    const ranged = planOf({}, { minLon: lon0, minLat: lat0, maxLon: lon1, maxLat: lat1 });
    expect(ranged.wanted.has(UPPER)).toBe(false);
    expect(marked(ranged).map(key).sort()).toEqual(all);
    expect(
      marked(planOf({ reversed: true }))
        .map(key)
        .sort(),
    ).toEqual(all);
  });
});

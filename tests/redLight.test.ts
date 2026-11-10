import { describe, expect, it } from "vitest";
import { MOVEMENTS, permits, type Movement, type Step } from "../src/signals/plan";
import { RedLightJudge, type CrossingOutcome, type SignalCrossing } from "../src/signals/redLight";

/**
 * A junction at the origin; the approach comes from the south heading north (−z) and its stop line
 * is 12 m short of the node. The car is moved along a path and the judge is fed every 0.5 m.
 */
const NORTH = { x: 0, z: -1 };
const step = (main: Step["main"][string], arrows: Step["arrows"][string] = []): Step => ({
  s: 1,
  main: { a: main, b: "R" },
  arrows: arrows.length ? { a: arrows } : {},
  ped: {},
});
const crossingUnder = (st: Step): SignalCrossing => ({
  approachId: 3,
  permissions: Object.fromEntries(
    MOVEMENTS.map((m) => [m, permits(st, "a", m)]),
  ) as SignalCrossing["permissions"],
  line: { x: 0, z: 12 },
  tIn: NORTH,
  node: { x: 0, z: 0 },
  exitM: 25,
});
/** Points from the stop line through the junction and out by `movement`, 0.5 m apart. */
function path(movement: Movement): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = 12; z >= 0; z -= 0.5) out.push({ x: 0, z });
  const exit = {
    left: { x: -1, z: 0 },
    through: { x: 0, z: -1 },
    right: { x: 1, z: 0 },
    uturn: { x: 0, z: 1 },
  }[movement];
  // A 転回 turns right round the node and comes back on the oncoming side (east of the centreline).
  const side = movement === "uturn" ? { x: 3, z: 0 } : { x: 0, z: 0 };
  for (let d = 0.5; d <= 40; d += 0.5) out.push({ x: side.x + exit.x * d, z: side.z + exit.z * d });
  return out;
}
/** Drive the path after crossing under `st`; every outcome, in order, with the time it came. */
function drive(st: Step, movement: Movement, judge = new RedLightJudge(), from = 0) {
  const outcomes: CrossingOutcome[] = [...judge.crossed(crossingUnder(st), from)];
  const pts = path(movement);
  for (let i = 1; i < pts.length; i++) {
    const d = { x: pts[i].x - pts[i - 1].x, z: pts[i].z - pts[i - 1].z };
    const len = Math.hypot(d.x, d.z);
    outcomes.push(...judge.update(pts[i], { x: d.x / len, z: d.z / len }, from + i * 50));
  }
  return outcomes;
}
const kinds = (o: CrossingOutcome[]) => o.map((x) => x.kind);

describe("信号無視 with arrows: hold at the stop line, decide by the arm the car leaves by", () => {
  it("books a straight run over a red with no arrow at the stop line, as before", () => {
    const o = drive(step("R"), "through");
    expect(kinds(o)).toEqual(["violation"]);
    expect(o[0]).toMatchObject({ kind: "violation", movement: null, heldMs: 0 });
  });

  it("books nothing on green, nor on yellow (too close to stop safely is allowed, and not told apart)", () => {
    for (const m of MOVEMENTS) {
      expect(drive(step("G"), m)).toEqual([]);
      expect(drive(step("Y"), m)).toEqual([]);
    }
  });

  it("does not book a right turn under the right arrow", () => {
    const o = drive(step("R", ["right"]), "right");
    expect(kinds(o)).toEqual(["held", "permitted"]);
    expect(o[1]).toMatchObject({ movement: "right" });
  });

  it("books going straight (or left) under the right arrow, when the car leaves the junction", () => {
    for (const m of ["through", "left"] as const) {
      const o = drive(step("R", ["right"]), m);
      expect(kinds(o)).toEqual(["held", "violation"]);
      expect(o[1]).toMatchObject({ kind: "violation", movement: m });
      if (o[1].kind === "violation") expect(o[1].heldMs).toBeGreaterThan(0);
    }
  });

  it("does not book a 転回 under the right arrow (施行規則 別表第一の二: the right arrow lets cars 転回)", () => {
    const o = drive(step("R", ["right"]), "uturn");
    expect(kinds(o)).toEqual(["held", "permitted"]);
    expect(o[1]).toMatchObject({ movement: "uturn" });
  });

  it("does not book a movement whose permission is unconfirmed", () => {
    const judge = new RedLightJudge();
    const c = crossingUnder(step("R", ["right"]));
    c.permissions.through = "unconfirmed";
    judge.crossed(c, 0);
    const out: CrossingOutcome[] = [];
    for (let z = 12; z >= -30; z -= 0.5) out.push(...judge.update({ x: 0, z }, NORTH, 100));
    expect(kinds(out)).toEqual(["unconfirmed"]);
  });

  it("keeps a car that stops inside the junction held, and judges it by the light it crossed on", () => {
    const judge = new RedLightJudge();
    judge.crossed(crossingUnder(step("R", ["right"])), 0);
    // Stands 3 m past the node for a minute (the lights change meanwhile; that does not matter).
    for (let t = 0; t <= 60_000; t += 500) expect(judge.update({ x: 0, z: -3 }, NORTH, t)).toEqual([]);
    expect(judge.isHolding).toBe(true);
    const out: CrossingOutcome[] = [];
    for (let z = -3; z >= -30; z -= 0.5) out.push(...judge.update({ x: 0, z }, NORTH, 61_000));
    expect(kinds(out)).toEqual(["violation"]);
  });

  it("drops, unbooked, a held car that backs out behind the stop line", () => {
    const judge = new RedLightJudge();
    judge.crossed(crossingUnder(step("R", ["right"])), 0);
    expect(judge.update({ x: 0, z: 11 }, NORTH, 100)).toEqual([]);
    const o = judge.update({ x: 0, z: 13.5 }, { x: 0, z: 1 }, 200);
    expect(o).toMatchObject([{ kind: "dropped", reason: "backedOut" }]);
    expect(judge.isHolding).toBe(false);
  });

  it("drops a hold, unbooked, when the car stops being driven", () => {
    const judge = new RedLightJudge();
    judge.crossed(crossingUnder(step("R", ["right"])), 0);
    expect(judge.reset(10)).toMatchObject([{ kind: "dropped", reason: "reset" }]);
    expect(judge.isHolding).toBe(false);
  });

  it("settles a hold by the way the car moves when it crosses the next stop line (it has left that junction)", () => {
    const east = { x: 1, z: 0 };
    const judge = new RedLightJudge();
    judge.crossed(crossingUnder(step("R", ["right"])), 0);
    expect(kinds(judge.crossed(crossingUnder(step("G")), 30, east))).toEqual(["permitted"]);
    judge.crossed(crossingUnder(step("R", ["right"])), 40);
    const next = judge.crossed(crossingUnder(step("R")), 50, NORTH);
    expect(next).toMatchObject([
      { kind: "violation", movement: "through" },
      { kind: "violation", movement: null },
    ]);
  });
});

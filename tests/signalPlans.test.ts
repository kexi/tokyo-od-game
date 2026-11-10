import { describe, expect, it } from "vitest";
import { hasRightTurnLane, planForJunction } from "../src/signals/assign";
import { movementOf } from "../src/signals/movement";
import {
  MOVEMENTS,
  RIGHT_ARROW_S,
  SignalPlanSchema,
  compilePlan,
  cycleTime,
  orderIssues,
  permits,
  safetyIssues,
  stepAt,
  twoPhase,
  twoPhaseWithRightArrow,
  type SignalPlan,
  type Step,
} from "../src/signals/plan";
import { CYCLE, lightState } from "../src/world/trafficControl";

/**
 * The two-phase signal as the game ran it before 現示表 (trafficControl.ts up to T1), copied here
 * unchanged as the reference the twoPhase template must reproduce.
 */
const LEGACY = (() => {
  const GREEN = [20, 15] as const;
  const YELLOW = 3;
  const ALL_RED = 2;
  const OLD_CYCLE = GREEN[0] + GREEN[1] + 2 * (YELLOW + ALL_RED);
  const oldLight = (seconds: number, offset: number, axis: 0 | 1) => {
    const t = (((seconds + offset) % OLD_CYCLE) + OLD_CYCLE) % OLD_CYCLE;
    const local = t - (axis === 0 ? 0 : GREEN[0] + YELLOW + ALL_RED);
    if (local >= 0 && local < GREEN[axis]) return "green";
    if (local >= 0 && local < GREEN[axis] + YELLOW) return "yellow";
    return "red";
  };
  /** The walk light for crossing a road of `axis` (walkers go with the other axis's green). */
  const pedLight = (seconds: number, offset: number, axis: 0 | 1) => {
    const other: 0 | 1 = axis === 0 ? 1 : 0;
    const t = (((seconds + offset) % OLD_CYCLE) + OLD_CYCLE) % OLD_CYCLE;
    const local = t - (other === 0 ? 0 : GREEN[0] + YELLOW + ALL_RED);
    if (local < 0 || local >= GREEN[other]) return "stop";
    return local < GREEN[other] - 5 ? "go" : "flash";
  };
  return { CYCLE: OLD_CYCLE, lightState: oldLight, pedLight };
})();

const COLOUR = { G: "green", Y: "yellow", R: "red" } as const;
/** Times over two cycles: a fine grid, every whole second and just either side of each. */
const TIMES = (() => {
  const out: number[] = [];
  for (let t = -LEGACY.CYCLE; t < 2 * LEGACY.CYCLE; t += 0.05) out.push(t);
  for (let s = -LEGACY.CYCLE; s <= 2 * LEGACY.CYCLE; s++) out.push(s - 1e-9, s, s + 1e-9);
  return out;
})();

describe("twoPhase reproduces the game's two-phase signal (twoPhase 一致)", () => {
  const plan = compilePlan(twoPhase());

  it("lasts the same 45 s cycle", () => {
    expect(plan.cycle).toBe(LEGACY.CYCLE);
    expect(CYCLE).toBe(LEGACY.CYCLE);
  });

  it("shows the same main lamps and walk lights as the old formula at every time, for any offset", () => {
    for (const offset of [0, 17, 33, 44, 44.5]) {
      for (const t of TIMES) {
        const step = stepAt(plan, cycleTime(t, offset, plan.cycle));
        for (const axis of [0, 1] as const) {
          const group = axis === 0 ? "a" : "b";
          const main = step.main[group] as keyof typeof COLOUR;
          expect(COLOUR[main], `t=${t} offset=${offset} axis=${axis}`).toBe(
            LEGACY.lightState(t, offset, axis),
          );
          // Walkers crossing the axis-`axis` road go with the other group.
          const walkers = axis === 0 ? "b" : "a";
          expect(step.ped[walkers], `t=${t} offset=${offset} ped axis=${axis}`).toBe(
            LEGACY.pedLight(t, offset, axis),
          );
        }
      }
    }
  });

  it("keeps lightState (the compatibility export) equal to the old formula", () => {
    for (const t of TIMES)
      for (const axis of [0, 1] as const)
        expect(lightState(t, 17, axis)).toBe(LEGACY.lightState(t, 17, axis));
  });
});

/** Every template as the game can build it, with the default and some other timings. */
const TEMPLATES: Record<string, SignalPlan> = {
  twoPhase: twoPhase(),
  twoPhaseSlow: twoPhase({ green: [40, 30], yellow: 4, allRed: 3, pedFlash: 8 }),
  rightArrowA: twoPhaseWithRightArrow(["a"]),
  rightArrowB: twoPhaseWithRightArrow(["b"]),
  rightArrowAB: twoPhaseWithRightArrow(["a", "b"]),
  rightArrowLong: twoPhaseWithRightArrow(["a"], { green: [30, 20], yellow: 3, allRed: 2, pedFlash: 6 }, 10),
};

describe("施行令第3条第2項: every template shows its signals in the law's order", () => {
  for (const [name, plan] of Object.entries(TEMPLATES)) {
    it(`${name}: 青→黄→赤 for each group's lamps and 青→青の点滅→赤 for each walk light, round the cycle`, () => {
      expect(orderIssues(plan)).toEqual([]);
      // And walked step by step: each change of a lamp is to the next in the order.
      const n = plan.steps.length;
      for (const g of Object.keys(plan.steps[0].main)) {
        for (let i = 0; i < n; i++) {
          const [a, b] = [plan.steps[i], plan.steps[(i + 1) % n]];
          const isChange = a.main[g] !== b.main[g];
          if (isChange) expect(`${a.main[g]}→${b.main[g]}`).toMatch(/^(G→Y|Y→R|R→G)$/);
          const isPedChange = a.ped[g] !== b.ped[g];
          if (isPedChange) expect(`${a.ped[g]}→${b.ped[g]}`).toMatch(/^(go→flash|flash→stop|stop→go)$/);
        }
      }
    });
  }

  it("rejects plans out of that order (青→赤, 赤→黄, 青→赤 for walkers)", () => {
    const step = (
      main: Record<string, "G" | "Y" | "R">,
      ped: Record<string, "go" | "flash" | "stop"> = {},
    ) => ({
      main,
      ped,
    });
    expect(orderIssues({ steps: [step({ a: "G" }), step({ a: "R" })] })).toHaveLength(1); // G→R (R→G is fine)
    expect(
      orderIssues({ steps: [step({ a: "G" }), step({ a: "R" }), step({ a: "Y" })] }).length,
    ).toBeGreaterThan(0);
    expect(
      orderIssues({ steps: [step({ a: "R" }, { a: "go" }), step({ a: "R" }, { a: "stop" })] }).length,
    ).toBeGreaterThan(0);
    const bad = {
      template: "x",
      source: "default",
      steps: [
        { s: 5, main: { a: "G" } },
        { s: 5, main: { a: "R" } },
      ],
    };
    expect(SignalPlanSchema.safeParse(bad).success).toBe(false);
  });
});

describe("safety: crossing traffic never moves together and changes are cleared", () => {
  for (const [name, plan] of Object.entries(TEMPLATES)) {
    it(`${name}: no crossing groups open together, walkers clear of moving traffic, yellow ≥ 3 s, arrows over 赤・黄 only, all-red between`, () => {
      expect(safetyIssues(plan)).toEqual([]);
    });
  }

  it("catches unsafe plans (both groups green, an arrow over green, a 2 s yellow, no all-red)", () => {
    const base = { template: "x", source: "default" as const, conflicts: [["a", "b"]] as [string, string][] };
    const s = (
      secs: number,
      a: Step["main"][string],
      b: Step["main"][string],
      extra: Partial<Step> = {},
    ): Step => ({
      s: secs,
      main: { a, b },
      arrows: {},
      ped: {},
      ...extra,
    });
    const together = { ...base, steps: [s(10, "G", "G"), s(3, "Y", "Y"), s(2, "R", "R")] };
    expect(safetyIssues(together).some((m) => m.includes("open together"))).toBe(true);
    const arrowOverGreen = {
      ...base,
      steps: [
        s(10, "G", "R", { arrows: { a: ["right"] } }),
        s(3, "Y", "R"),
        s(2, "R", "R"),
        s(10, "R", "G"),
        s(3, "R", "Y"),
        s(2, "R", "R"),
      ],
    };
    expect(safetyIssues(arrowOverGreen).some((m) => m.includes("arrows over G"))).toBe(true);
    const shortYellow = {
      ...base,
      steps: [
        s(10, "G", "R"),
        s(2, "Y", "R"),
        s(2, "R", "R"),
        s(10, "R", "G"),
        s(3, "R", "Y"),
        s(2, "R", "R"),
      ],
    };
    expect(safetyIssues(shortYellow).some((m) => m.includes("yellow of 2 s"))).toBe(true);
    const noAllRed = { ...base, steps: [s(10, "G", "R"), s(3, "Y", "R"), s(10, "R", "G"), s(3, "R", "Y")] };
    expect(safetyIssues(noAllRed).some((m) => m.includes("opens 0 s after"))).toBe(true);
    const walkIntoTurners = {
      ...base,
      steps: [
        s(10, "G", "R", { ped: { a: "go" } }),
        s(3, "Y", "R"),
        s(6, "R", "R", { arrows: { a: ["right"] }, ped: { a: "go" } }),
        s(2, "R", "R"),
        s(10, "R", "G"),
        s(3, "R", "Y"),
        s(2, "R", "R"),
      ],
    };
    expect(safetyIssues(walkIntoTurners).some((m) => m.includes("walkers a cross"))).toBe(true);
  });
});

describe("twoPhaseWithRightArrow", () => {
  it("lights the right arrow over red for 6 s straight after group a's yellow, with group b and every walker at red", () => {
    const plan = compilePlan(twoPhaseWithRightArrow(["a"]));
    expect(plan.cycle).toBe(CYCLE + RIGHT_ARROW_S);
    const arrowSteps = plan.plan.steps.flatMap((st, i) => ((st.arrows.a?.length ?? 0) > 0 ? [i] : []));
    expect(arrowSteps).toHaveLength(1);
    const i = arrowSteps[0];
    const st = plan.plan.steps[i];
    expect(st.s).toBe(RIGHT_ARROW_S);
    expect(st.arrows).toEqual({ a: ["right"] });
    expect(st.main).toEqual({ a: "R", b: "R" });
    expect(Object.values(st.ped).every((p) => p === "stop")).toBe(true);
    expect(plan.plan.steps[i - 1].main.a).toBe("Y");
    expect(plan.plan.steps[i + 1].main).toEqual({ a: "R", b: "R" }); // the arrow goes out into the all-red
    // 20 s green + 3 s yellow: the arrow shows from 23 s to 29 s into the cycle.
    expect(plan.starts[i]).toBe(23);
    expect(plan.plan.steps.some((s) => (s.arrows.b?.length ?? 0) > 0)).toBe(false);
  });
});

describe("permits: 施行令第2条's table for each movement", () => {
  const step = (main: Step["main"][string], arrows: Step["arrows"][string] = []): Step => ({
    s: 1,
    main: { a: main, b: "R" },
    arrows: arrows.length ? { a: arrows } : {},
    ped: {},
  });
  const all = (st: Step) => Object.fromEntries(MOVEMENTS.map((m) => [m, permits(st, "a", m)]));

  it("青: every movement may go (転回 too, as the game always let it)", () => {
    expect(all(step("G"))).toEqual({ left: "go", through: "go", right: "go", uturn: "go" });
  });

  it("黄: not past the stop position unless unable to stop safely, for every movement", () => {
    expect(all(step("Y"))).toEqual({
      left: "stopIfAble",
      through: "stopIfAble",
      right: "stopIfAble",
      uturn: "stopIfAble",
    });
  });

  it("赤: every movement stops", () => {
    expect(all(step("R"))).toEqual({ left: "stop", through: "stop", right: "stop", uturn: "stop" });
  });

  it("赤＋右矢印: right and 転回 go (施行規則 別表第一の二: 右折し、又は転回することができる), left and through stop", () => {
    expect(all(step("R", ["right"]))).toEqual({
      left: "stop",
      through: "stop",
      right: "go",
      uturn: "go",
    });
  });

  it("黄＋左矢印 and 赤＋直進矢印: the arrow's way goes 黄・赤にかかわらず", () => {
    expect(permits(step("Y", ["left"]), "a", "left")).toBe("go");
    expect(permits(step("Y", ["left"]), "a", "through")).toBe("stopIfAble");
    expect(permits(step("R", ["through"]), "a", "through")).toBe("go");
  });

  it("黄の点滅 goes with care, 赤の点滅 stops first, a dark signal is unconfirmed", () => {
    expect(permits(step("FY"), "a", "through")).toBe("go");
    expect(permits(step("FR"), "a", "through")).toBe("stopFirst");
    expect(permits(step("off"), "a", "through")).toBe("unconfirmed");
  });
});

describe("movementOf: the law checks' three ways plus 転回", () => {
  // Heading north (−z): left is west (−x).
  const north = { x: 0, z: -1 };
  it("classifies by 35° to the side and 150° back", () => {
    expect(movementOf(north, { x: 0, z: -1 })).toBe("through");
    expect(movementOf(north, { x: -1, z: 0 })).toBe("left");
    expect(movementOf(north, { x: 1, z: 0 })).toBe("right");
    expect(movementOf(north, { x: 0, z: 1 })).toBe("uturn");
    const deg = (d: number) => ({ x: Math.sin((d * Math.PI) / 180), z: -Math.cos((d * Math.PI) / 180) });
    expect(movementOf(north, deg(30))).toBe("through"); // 30° to the right
    expect(movementOf(north, deg(40))).toBe("right");
    expect(movementOf(north, deg(-140))).toBe("left");
    expect(movementOf(north, deg(160))).toBe("uturn");
    // Bent back past 145° but short of 150°: sin is under 0.57, still a turn, never through.
    for (const d of [146, 147, 149]) {
      expect(movementOf(north, deg(d))).toBe("right");
      expect(movementOf(north, deg(-d))).toBe("left");
    }
    expect(movementOf(north, deg(151))).toBe("uturn");
  });
});

describe("the 右折矢印 rule (assign.ts)", () => {
  const osm = (...lanes: string[][]) => ({ lanes, source: "osm" as const });

  it("counts an OSM approach with a lane for turning right only", () => {
    expect(hasRightTurnLane(osm(["left", "through"], ["through"], ["right"]))).toBe(true);
    expect(hasRightTurnLane(osm(["left", "through"], ["through", "right"]))).toBe(false);
    expect(hasRightTurnLane(osm(["through"], ["slight_right"]))).toBe(false);
    expect(hasRightTurnLane({ lanes: [["left", "through"], ["right"]], source: "assumed" })).toBe(false);
    expect(hasRightTurnLane(undefined)).toBe(false);
  });

  it("gives the arrow to the groups with such an approach, and twoPhase elsewhere", () => {
    expect(planForJunction([{ group: "a" }, { group: "b" }]).plan.template).toBe("twoPhase");
    // Controllers of one kind share one compiled plan (no re-parse, no re-compile per rebuild).
    expect(planForJunction([{ group: "a" }])).toBe(planForJunction([{ group: "b" }]));
    const plan = planForJunction([{ group: "a", lanes: osm(["through"], ["right"]) }, { group: "b" }]).plan;
    expect(plan.template).toBe("twoPhaseWithRightArrow");
    expect(plan.source).toBe("inferred");
    expect(plan.steps.some((s) => s.arrows.a?.includes("right"))).toBe(true);
    expect(plan.steps.some((s) => (s.arrows.b?.length ?? 0) > 0)).toBe(false);
  });
});

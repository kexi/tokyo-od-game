import { describe, expect, it } from "vitest";
import { hasRightTurnLane, planForCrossing, planForJunction } from "../src/signals/assign";
import { movementOf } from "../src/signals/movement";
import {
  MOVEMENTS,
  RIGHT_ARROW_S,
  CROSSING_TIMING,
  OnDemandRun,
  SignalPlanSchema,
  compilePlan,
  crossingFixed,
  crossingVerdict,
  cycleTime,
  driverAction,
  orderIssues,
  permits,
  nightFlash,
  pushButton,
  safetyIssues,
  scramble,
  staggered,
  stepAt,
  twoPhase,
  twoPhaseWithRightArrow,
  withWalkButtons,
  type Permission,
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
  const plan = compilePlan(twoPhase("default"));

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
  twoPhase: twoPhase("default"),
  twoPhaseSlow: twoPhase("default", { green: [40, 30], yellow: 4, allRed: 3, pedFlash: 8 }),
  rightArrowA: twoPhaseWithRightArrow(["a"], "inferred"),
  rightArrowB: twoPhaseWithRightArrow(["b"], "inferred"),
  rightArrowAB: twoPhaseWithRightArrow(["a", "b"], "inferred"),
  rightArrowLong: twoPhaseWithRightArrow(
    ["a"],
    "inferred",
    { green: [30, 20], yellow: 3, allRed: 2, pedFlash: 6 },
    10,
  ),
  pushButton: pushButton("osm"),
  pushButtonSlow: pushButton("osm", {
    minGreen: 40,
    yellow: 4,
    allRed: 3,
    walk: 20,
    pedFlash: 8,
    clearance: 3,
  }),
  crossingFixed: crossingFixed("default"),
  // T4
  scramble: scramble("osm"),
  scrambleSlow: scramble("osm", {
    green: [40, 30],
    yellow: 4,
    allRed: 3,
    walk: 30,
    pedFlash: 10,
    clearance: 4,
  }),
  staggered: staggered("osm"),
  staggeredSlow: staggered("inferred", { green: [40, 30], yellow: 4, allRed: 3, pedFlash: 8, lag: 10 }),
  nightFlash: nightFlash(twoPhase("default"), { a: "FY", b: "FR" }, "osm"),
  nightFlashAllRed: nightFlash(twoPhase("default"), { a: "FR", b: "FR" }, "osm"),
  nightFlashScramble: nightFlash(scramble("osm"), { a: "FY", b: "FR" }, "osm"),
  nightFlashStaggered: nightFlash(staggered("osm"), { a: "FY", c: "FY", b: "FR" }, "osm"),
  walkButtons: withWalkButtons(twoPhase("default"), "osm"),
  walkButtonsArrow: withWalkButtons(twoPhaseWithRightArrow(["a"], "inferred"), "osm"),
  walkButtonsScramble: withWalkButtons(scramble("osm"), "osm"),
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
        }
      }
      for (const p of Object.keys(plan.walkers)) {
        for (let i = 0; i < n; i++) {
          const [a, b] = [plan.steps[i], plan.steps[(i + 1) % n]];
          const isPedChange = a.ped[p] !== b.ped[p];
          if (isPedChange) expect(`${a.ped[p]}→${b.ped[p]}`).toMatch(/^(go→flash|flash→stop|stop→go)$/);
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
      conflicts: [],
      walkers: {},
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
    const base = {
      template: "x",
      source: "default" as const,
      conflicts: [["a", "b"]] as [string, string][],
      walkers: { a: { across: "b", alongside: "a" }, b: { across: "a", alongside: "b" } },
      onDemand: false,
    };
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
    const plan = compilePlan(twoPhaseWithRightArrow(["a"], "inferred"));
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
    const plain = planForJunction([{ axis: 0 }, { axis: 1 }]);
    expect(plain.plan.plan.template).toBe("twoPhase");
    expect(plain.plan.plan.source).toBe("default");
    // The plan names each approach's group: axis 0 (the widest road) is a, axis 1 is b.
    expect(plain.groupOf).toEqual(["a", "b"]);
    // Controllers of one kind share one compiled plan (no re-parse, no re-compile per rebuild).
    expect(planForJunction([{ axis: 0 }]).plan).toBe(planForJunction([{ axis: 1 }]).plan);
    const choice = planForJunction([{ axis: 0, lanes: osm(["through"], ["right"]) }, { axis: 1 }]);
    const plan = choice.plan.plan;
    expect(choice.groupOf).toEqual(["a", "b"]);
    expect(plan.template).toBe("twoPhaseWithRightArrow");
    expect(plan.source).toBe("inferred");
    expect(plan.steps.some((s) => s.arrows.a?.includes("right"))).toBe(true);
    expect(plan.steps.some((s) => (s.arrows.b?.length ?? 0) > 0)).toBe(false);
  });
});

describe("the 単路 crossing rule (assign.ts planForCrossing)", () => {
  it("runs pushButton where OSM says button_operated=yes, a fixed cycle where it says no or nothing", () => {
    const button = planForCrossing({ button: true }, 2);
    expect(button.plan.plan.template).toBe("pushButton");
    expect(button.plan.plan.onDemand).toBe(true);
    expect(button.plan.plan.source).toBe("osm");
    // Both directions of the road are the one vehicle group the walkers cross.
    expect(button.groupOf).toEqual(["v", "v"]);
    expect(button.plan.plan.walkers).toEqual({ p: { across: "v" } });
    const no = planForCrossing({ button: false }, 1).plan.plan;
    expect([no.template, no.onDemand, no.source]).toEqual(["crossingFixed", false, "osm"]);
    const unknown = planForCrossing({ button: null }, 1).plan.plan;
    expect([unknown.template, unknown.source]).toEqual(["crossingFixed", "default"]);
  });
});

describe("driverAction and crossingVerdict: the one reading of each permission", () => {
  const PERMISSIONS: Permission[] = ["go", "stopIfAble", "stop", "stopFirst", "unconfirmed"];

  it("a driver goes on go, stops when it can on 黄・赤・dark, and on 赤の点滅 makes the 一時停止 first (fullStop); one that cannot stop goes on", () => {
    const table = Object.fromEntries(
      PERMISSIONS.map((p) => [p, [driverAction(p, true), driverAction(p, false)]]),
    );
    expect(table).toEqual({
      go: ["go", "go"],
      stopIfAble: ["stop", "go"],
      stop: ["stop", "go"],
      stopFirst: ["fullStop", "go"],
      unconfirmed: ["stop", "go"],
    });
  });

  it("信号無視 books 赤 with no arrow its way (赤色等) and 赤の点滅 crossed without stopping (点滅); 黄 is not booked, a dark signal is unconfirmed", () => {
    const verdicts = (hasStopped: boolean) =>
      Object.fromEntries(PERMISSIONS.map((p) => [p, crossingVerdict(p, hasStopped)]));
    expect(verdicts(false)).toEqual({
      go: "allowed",
      stopIfAble: "allowed",
      stop: "booked",
      stopFirst: "bookedFlashing",
      unconfirmed: "unconfirmed",
    });
    // Having stopped changes only 赤の点滅: 赤 is booked however long the car stood (第2条 forbids the crossing).
    expect(verdicts(true)).toEqual({ ...verdicts(false), stopFirst: "allowed" });
  });
});

describe("the plan declares its walkers and conflicts (W5)", () => {
  const steps = twoPhase("default").steps;

  it("rejects a plan without conflicts, without walkers, or with walkers it does not declare", () => {
    const base = { template: "x", source: "default", steps };
    expect(SignalPlanSchema.safeParse({ ...base, walkers: twoPhase("default").walkers }).success).toBe(false);
    expect(SignalPlanSchema.safeParse({ ...base, conflicts: [["a", "b"]] }).success).toBe(false);
    const undeclared = { ...base, conflicts: [["a", "b"]], walkers: { a: { across: "b" } } };
    expect(SignalPlanSchema.safeParse(undeclared).success).toBe(false);
    const unknownGroup = { ...base, conflicts: [], walkers: { a: { across: "x" }, b: { across: "a" } } };
    expect(SignalPlanSchema.safeParse(unknownGroup).success).toBe(false);
  });

  it("takes source from its caller", () => {
    expect(twoPhase("osm").source).toBe("osm");
    expect(pushButton("default").source).toBe("default");
  });

  it("catches walkers whose road's traffic moves too soon after their walk (no clearance)", () => {
    const s = (secs: number, v: "G" | "Y" | "R", p: "go" | "flash" | "stop"): Step => ({
      s: secs,
      main: { v },
      arrows: {},
      ped: { p },
    });
    const noClearance = {
      template: "x",
      source: "default" as const,
      conflicts: [],
      walkers: { p: { across: "v" } },
      onDemand: false,
      steps: [s(20, "G", "stop"), s(3, "Y", "stop"), s(2, "R", "stop"), s(10, "R", "go"), s(5, "R", "flash")],
    };
    expect(safetyIssues(noClearance).some((m) => m.includes("walkers p have 0 s clear of v after"))).toBe(
      true,
    );
    const walkOnYellow = {
      ...noClearance,
      steps: [s(20, "G", "stop"), s(3, "Y", "go"), s(10, "R", "flash")],
    };
    expect(safetyIssues(walkOnYellow).some((m) => m.includes("walkers p cross moving traffic"))).toBe(true);
  });
});

describe("pushButton: rests at the vehicles' 青 until a walker calls (押ボタン式)", () => {
  const plan = compilePlan(pushButton("osm"));
  const t = CROSSING_TIMING;
  const look = (run: OnDemandRun, at: number) => {
    const st = run.stepAt(at);
    return `${st.main.v}/${st.ped.p}`;
  };

  it("shows the vehicles 青 and the walkers 赤 for as long as nobody presses", () => {
    const run = new OnDemandRun(plan, 0);
    for (let at = 0; at < 600; at += 7) expect(look(run, at)).toBe("G/stop");
  });

  it("after a press: 黄 → 全赤 → walkers' 青 → its flash → 全赤 → back to 青, in that order and timing", () => {
    const run = new OnDemandRun(plan, 0);
    expect(run.call("p", 100)).toBe(true);
    expect(run.isWaiting("p", 100)).toBe(true);
    expect(look(run, 100.5)).toBe("Y/stop");
    expect(look(run, 100 + t.yellow + 0.5)).toBe("R/stop");
    const walk = 100 + t.yellow + t.allRed;
    expect(run.isWaiting("p", walk - 0.1)).toBe(true);
    expect(look(run, walk + 0.5)).toBe("R/go");
    expect(run.isWaiting("p", walk + 0.5)).toBe(false);
    expect(look(run, walk + t.walk + 0.5)).toBe("R/flash");
    expect(look(run, walk + t.walk + t.pedFlash + 0.5)).toBe("R/stop");
    const back = walk + t.walk + t.pedFlash + t.clearance;
    expect(look(run, back + 0.5)).toBe("G/stop");
    expect(look(run, back + 300)).toBe("G/stop");
  });

  it("serves a call only after the vehicles' shortest green, and ignores presses while the walk is still to come", () => {
    const run = new OnDemandRun(plan, 0);
    run.call("p", 10);
    run.stepAt(10.5);
    expect(run.call("p", 11)).toBe(false); // the walk this run will show serves it
    const back = 10 + plan.cycle - t.minGreen;
    expect(run.call("p", back - 1)).toBe(true); // during the clearance: waits for the next run
    expect(look(run, back + 1)).toBe("G/stop");
    expect(look(run, back + t.minGreen - 0.5)).toBe("G/stop");
    expect(look(run, back + t.minGreen + 0.5)).toBe("Y/stop");
  });

  it("answers what showed a moment ago (the violation check's grace) without moving the run", () => {
    const run = new OnDemandRun(plan, 0);
    run.call("p", 50);
    run.stepAt(50 + t.yellow + 1);
    expect(run.stepBefore(50 + t.yellow + 1, 2).main.v).toBe("Y");
    expect(run.stepBefore(50 + t.yellow + 1, 10).main.v).toBe("G");
  });

  it("drops the run when the clock goes back (the replay rewinds it)", () => {
    const run = new OnDemandRun(plan, 0);
    run.call("p", 100);
    expect(look(run, 101)).toBe("Y/stop");
    expect(look(run, 20)).toBe("G/stop");
  });
});

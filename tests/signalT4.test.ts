import { describe, expect, it } from "vitest";
import {
  ASSUMED_NIGHT,
  NO_JUNCTION_FACTS,
  junctionFacts,
  planForJunction,
  type JunctionFacts,
} from "../src/signals/assign";
import { UNTAGGED } from "../src/signals/osmTags";
import { ScheduledRun } from "../src/signals/run";
import {
  NO_PHASE,
  decodeSignalTags,
  encodeSignalRecord,
  phaseOf,
  type SignalNodeFacts,
} from "../src/signals/osmTags";
import {
  MOVEMENTS,
  SCRAMBLE_TIMING,
  STAGGERED_GROUPS,
  STAGGERED_TIMING,
  FLASH_EXIT,
  MIN_ALL_RED_S,
  WalkCalls,
  compilePlan,
  flashExit,
  isChangeMoment,
  twoPhaseWithRightArrow,
  crossedBy,
  isDiagonal,
  isInWindow,
  nightFlash,
  permits,
  safetyIssues,
  scramble,
  staggered,
  stepAt,
  twoPhase,
  withWalkButtons,
  type Step,
} from "../src/signals/plan";
import { RedLightJudge, type SignalCrossing } from "../src/signals/redLight";

const isOpen = (st: Step, g: string) =>
  st.main[g] === "G" || st.main[g] === "Y" || st.main[g] === "FY" || (st.arrows[g]?.length ?? 0) > 0;

describe("scramble (歩車分離): every walker at once, every vehicle at red", () => {
  const plan = scramble("osm");

  it("declares diagonal walkers that cross both roads", () => {
    const x = Object.entries(plan.walkers).find(([, w]) => isDiagonal(w));
    expect(x?.[0]).toBe("x");
    expect(crossedBy(plan.walkers.x)).toEqual(["a", "b"]);
  });

  it("lets no walker walk while any vehicle group may move, and walks every walker in the same steps", () => {
    for (const st of plan.steps) {
      const walking = Object.keys(plan.walkers).filter((p) => st.ped[p] === "go" || st.ped[p] === "flash");
      if (walking.length === 0) continue;
      expect(walking.toSorted()).toEqual(["a", "b", "x"]);
      expect(["a", "b"].some((g) => isOpen(st, g))).toBe(false);
    }
  });

  it("has a 全赤 of at least the clearance before the vehicles move again after the walk", () => {
    const n = plan.steps.length;
    const lastWalk = plan.steps.findLastIndex((st) => st.ped.x === "flash");
    const after = plan.steps[(lastWalk + 1) % n];
    expect(after.main).toEqual({ a: "R", b: "R" });
    expect(after.s).toBe(SCRAMBLE_TIMING.clearance);
  });

  it("is caught when the walk overlaps a vehicle 青 (the property the checks hold every template to)", () => {
    const broken = {
      ...plan,
      steps: plan.steps.map((st, i) => (i === 6 ? { ...st, main: { a: "G", b: "R" } as Step["main"] } : st)),
    };
    expect(safetyIssues(broken).some((m) => m.includes("walkers x cross moving traffic"))).toBe(true);
  });
});

describe("staggered (時差式): one road's two directions end their 青 apart", () => {
  const plan = compilePlan(staggered("osm"));
  const { later: a, first: c, crossing: b } = STAGGERED_GROUPS;
  const steps = plan.plan.steps;

  it("turns the first direction 黄 then 赤 while the other keeps 青 for the lag", () => {
    const yellow = steps.findIndex((st) => st.main[c] === "Y");
    expect(steps[yellow].main[a]).toBe("G");
    const lag = steps[yellow + 1];
    expect(lag.main).toEqual({ [a]: "G", [c]: "R", [b]: "R" });
    expect(lag.s).toBe(STAGGERED_TIMING.lag);
  });

  it("lets the lagging direction's right-turners go unopposed only with every oncoming movement at 赤, and under plain 青 (yield, 第37条) while the oncoming may still come", () => {
    let unopposed = 0;
    for (const st of steps) {
      if (permits(st, a, "right") !== "go") continue;
      const isOncomingOpen = isOpen(st, c);
      // While the oncoming is at 青 or 黄 (a car too close to stop may still come on), no arrow
      // tells a's right-turners the way is theirs.
      if (isOncomingOpen) expect(st.arrows[a] ?? []).toEqual([]);
      if (isOncomingOpen) continue;
      unopposed++;
      for (const m of MOVEMENTS) expect(permits(st, c, m)).toBe("stop");
    }
    expect(unopposed).toBeGreaterThan(0);
  });

  it("never has the first direction open while the later one is closed (its 青 really ends first)", () => {
    for (const st of steps) {
      const isFirstOutlasting = isOpen(st, c) && !isOpen(st, a);
      expect(isFirstOutlasting).toBe(false);
    }
  });

  it("is caught giving a right arrow to one direction while the oncoming one moves", () => {
    const withArrow = {
      ...plan.plan,
      steps: steps.map((st, i) => (i === 0 ? { ...st, arrows: { [c]: ["right" as const] } } : st)),
    };
    expect(safetyIssues(withArrow).some((m) => m.includes("right arrow while oncoming"))).toBe(true);
  });
});

describe("nightFlash (点滅): 施行令第2条 黄色の灯火の点滅・赤色の灯火の点滅", () => {
  const plan = nightFlash(twoPhase("default"), { a: "FY", b: "FR" }, "osm");
  const [st] = plan.steps;

  it("lets every movement go with care on 黄の点滅 and makes it stop first on 赤の点滅", () => {
    for (const m of MOVEMENTS) {
      expect(permits(st, "a", m)).toBe("go");
      expect(permits(st, "b", m)).toBe("stopFirst");
    }
  });

  it("darkens every walk lamp (walkers then read the vehicle lamps they face)", () => {
    expect(Object.values(st.ped)).toEqual(["off", "off"]);
  });

  it("keeps the day plan's groups and walkers, and flashes red any group the caller did not name", () => {
    const partial = nightFlash(staggered("osm"), { a: "FY" }, "osm");
    expect(partial.steps[0].main).toEqual({ a: "FY", c: "FR", b: "FR" });
    expect(partial.walkers).toEqual(staggered("osm").walkers);
  });

  it("is caught flashing yellow on two crossing roads (nobody told to stop first)", () => {
    const bothYellow = { ...plan, steps: [{ ...st, main: { a: "FY", b: "FY" } as Step["main"] }] };
    expect(safetyIssues(bothYellow).some((m) => m.includes("open together"))).toBe(true);
  });
});

describe("WalkCalls: a junction's 押ボタン on a fixed cycle", () => {
  const plan = compilePlan(withWalkButtons(twoPhase("default"), "osm"));
  const offset = 0;
  // twoPhase: walkers a walk 0–20 s (go 15, flash 5), walkers b 25–40 s.
  const at = (calls: WalkCalls, t: number) => calls.mask(stepAt(plan, t % plan.cycle), t);

  it("keeps the walk at red when nobody pressed, while the vehicles run as ever", () => {
    const calls = new WalkCalls(plan, offset);
    for (let t = 0; t < plan.cycle; t += 0.5) {
      const st = at(calls, t);
      expect(st.ped.a).toBe("stop");
      expect(st.ped.b).toBe("stop");
      expect(st.main).toEqual(stepAt(plan, t).main);
    }
  });

  it("shows the whole walk (青, then its flash, then red) after a press before it, and only once", () => {
    const calls = new WalkCalls(plan, offset);
    expect(calls.call("b", 10)).toBe(true);
    expect(calls.isWaiting("b", 10)).toBe(true);
    expect(calls.call("b", 12)).toBe(false); // already called
    expect(at(calls, 26).ped.b).toBe("go");
    expect(calls.isWaiting("b", 26)).toBe(false);
    expect(at(calls, 37).ped.b).toBe("flash");
    expect(at(calls, 41).ped.b).toBe("stop");
    expect(at(calls, 45 + 26).ped.b).toBe("stop"); // the next cycle needs a new press
  });

  it("gives a press made during a walk that shows red to the next walk, not this one", () => {
    const calls = new WalkCalls(plan, offset);
    expect(calls.call("a", 5)).toBe(true);
    expect(at(calls, 6).ped.a).toBe("stop");
    expect(at(calls, 45 + 1).ped.a).toBe("go");
  });

  it("drops its calls when the clock goes back (the replay)", () => {
    const calls = new WalkCalls(plan, offset);
    calls.call("b", 100);
    at(calls, 20);
    expect(calls.isWaiting("b", 20)).toBe(false);
  });
});

describe("isInWindow: a window of minutes, possibly past midnight", () => {
  it("reads 22:00–06:00 as the night either side of midnight", () => {
    expect(isInWindow(23 * 60, ASSUMED_NIGHT)).toBe(true);
    expect(isInWindow(3 * 60, ASSUMED_NIGHT)).toBe(true);
    expect(isInWindow(6 * 60, ASSUMED_NIGHT)).toBe(false);
    expect(isInWindow(12 * 60, ASSUMED_NIGHT)).toBe(false);
    expect(isInWindow(10 * 60, [9 * 60, 17 * 60])).toBe(true);
  });
});

describe("OSM's T4 tags (osmTags.ts phaseOf) and the tile records", () => {
  it("reads 歩車分離, the night button, blinkers and their window, 時差式 and the notes' colours", () => {
    expect(phaseOf({ "crossing:scramble": "yes" }).scramble).toBe(true);
    expect(phaseOf({ crossing_ref: "pedestrian_scramble" }).scramble).toBe(true);
    expect(phaseOf({ button_operated: "night" }).buttonNight).toBe(true);
    expect(phaseOf({ traffic_signals: "blinker" }).flash).toBe("always");
    const timed = phaseOf({ "traffic_signals:conditional": "blinker @ (22:00-06:00)" });
    expect([timed.flash, timed.flashWindow]).toEqual(["window", [1320, 360]]);
    expect(phaseOf({ traffic_signals: "夜間点滅式" }).flash).toBe("night");
    expect(phaseOf({ note: "夜間点滅式" }).flash).toBe("night");
    expect(phaseOf({ note: "赤点滅で進行" }).flashHint).toBe("red");
    expect(phaseOf({ note: "黄色点滅で進行、8-20右折禁止" }).flashHint).toBe("yellow");
    expect(phaseOf({ "traffic_signals:designation": "時差式" }).staggered).toBe("unknown");
    expect(phaseOf({ note: "時差式(先に赤になる)" }).staggered).toBe("first");
    expect(phaseOf({ note: "時差式(後から赤になる)" }).staggered).toBe("later");
    expect(phaseOf({ highway: "traffic_signals" })).toEqual(NO_PHASE);
  });

  it("does not take a note that only mentions 夜間点滅 in passing as 夜間点滅式, nor a bad window", () => {
    expect(phaseOf({ note: "夜間点滅式の交差点の手前" }).flash).toBe(null);
    expect(phaseOf({ "traffic_signals:conditional": "blinker @ (25:00-06:00)" }).flash).toBe(null);
  });

  it("writes and reads back every T4 fact, the window as two more numbers after the bearing", () => {
    const base: SignalNodeFacts = {
      isHighwaySignal: true,
      isCrossing: false,
      awayFromJunction: false,
      button: null,
      sound: null,
      bearing: null,
    };
    const phases = [
      phaseOf({ "crossing:scramble": "yes", button_operated: "night" }),
      phaseOf({ "traffic_signals:conditional": "blinker @ (22:00-06:00)" }),
      phaseOf({ traffic_signals: "blinker", note: "赤点滅信号" }),
      phaseOf({ note: "時差式(先に赤になる)" }),
    ];
    for (const phase of phases) {
      const record = encodeSignalRecord(1, 2, { ...base, phase, bearing: 90 });
      expect(decodeSignalTags(record).phase).toEqual(phase);
      expect(decodeSignalTags(record).bearing).toBe(90);
    }
    const noBearing = encodeSignalRecord(1, 2, { ...base, phase: phases[1] });
    expect(noBearing).toHaveLength(6);
    expect(decodeSignalTags(noBearing).bearing).toBe(null);
  });
});

const facts = (f: Partial<JunctionFacts>): JunctionFacts => ({ ...NO_JUNCTION_FACTS, ...f });

describe("planForJunction with OSM's T4 facts (assign.ts)", () => {
  // A four-way junction: axis 0 east–west (bearings 90 / 270), axis 1 north–south (0 / 180).
  const approaches = [
    { axis: 0 as const, bearingDeg: 90 },
    { axis: 0 as const, bearingDeg: 270 },
    { axis: 1 as const, bearingDeg: 0 },
    { axis: 1 as const, bearingDeg: 180 },
  ];

  it("runs scramble where a node says crossing:scramble", () => {
    const choice = planForJunction(approaches, facts({ scramble: true }));
    expect(choice.plan.plan.template).toBe("scramble");
    expect(choice.groupOf).toEqual(["a", "a", "b", "b"]);
  });

  it("runs staggered with the direction the note names: 先に赤 ends first, the oncoming one later", () => {
    const choice = planForJunction(
      approaches,
      facts({ staggered: true, hints: [{ bearingDeg: 0, staggered: "first" }] }),
    );
    expect(choice.plan.plan.template).toBe("staggered");
    expect(choice.plan.plan.source).toBe("osm");
    // The note's direction (northbound, axis 1) ends first: the 時差式 road is axis 1 here.
    expect(choice.groupOf).toEqual(["b", "b", "c", "a"]);
  });

  it("assumes the direction with a right-turn lane keeps 青 where no node says which way (source inferred)", () => {
    const lanes = { lanes: [["through"], ["right"]], source: "osm" as const };
    const withLane = approaches.map((a, i) => (i === 1 ? { ...a, lanes } : a));
    const choice = planForJunction(withLane, facts({ staggered: true }));
    expect(choice.plan.plan.source).toBe("inferred");
    expect(choice.groupOf).toEqual(["c", "a", "b", "b"]);
  });

  it("falls back to the default where the 時差式 road has only one direction (a one-way road)", () => {
    const oneWay = [approaches[0], approaches[2], approaches[3]];
    const choice = planForJunction(oneWay, facts({ staggered: true }));
    expect(choice.plan.plan.template).toBe("twoPhase");
  });

  it("flashes always for traffic_signals=blinker: the main road 黄, the crossing road 赤, unless a note says", () => {
    const always = planForJunction(approaches, facts({ flash: { when: "always" } }));
    expect(always.plan.plan.template).toBe("nightFlash");
    expect(always.plan.plan.steps[0].main).toEqual({ a: "FY", b: "FR" });
    expect(always.night).toBe(null);
    const noted = planForJunction(
      approaches,
      facts({
        flash: { when: "always" },
        hints: [
          { bearingDeg: 92, flash: "red" },
          { bearingDeg: 0, flash: "yellow" },
        ],
      }),
    );
    expect(noted.plan.plan.steps[0].main).toEqual({ a: "FR", b: "FY" });
  });

  it("keeps the day plan by day and flashes inside the window (or the assumed night for 夜間点滅式)", () => {
    const timed = planForJunction(approaches, facts({ flash: { when: "window", window: [1320, 360] } }));
    expect(timed.plan.plan.template).toBe("twoPhase");
    expect(timed.night?.window).toEqual([1320, 360]);
    expect(timed.night?.plan.plan.template).toBe("nightFlash");
    const night = planForJunction(approaches, facts({ flash: { when: "night" } }));
    expect(night.night?.window).toEqual(ASSUMED_NIGHT);
  });

  it("puts every walk on call for button_operated=yes, and only at night for button_operated=night", () => {
    const yes = planForJunction(approaches, facts({ button: "yes" }));
    expect(yes.plan.plan.onCall.toSorted()).toEqual(["a", "b"]);
    expect(yes.night).toBe(null);
    const night = planForJunction(approaches, facts({ button: "night" }));
    expect(night.plan.plan.onCall).toEqual([]);
    expect(night.night?.plan.plan.onCall.toSorted()).toEqual(["a", "b"]);
    expect(night.night?.window).toEqual(ASSUMED_NIGHT);
  });
});

describe("信号無視（点滅）: 赤色の灯火の点滅 crossed without the 一時停止 (RedLightJudge)", () => {
  const flash = nightFlash(twoPhase("default"), { a: "FY", b: "FR" }, "osm").steps[0];
  const crossing = (group: "a" | "b", hasStopped: boolean): SignalCrossing => ({
    approachId: 1,
    permissions: Object.fromEntries(
      MOVEMENTS.map((m) => [m, permits(flash, group, m)]),
    ) as SignalCrossing["permissions"],
    line: { x: 0, z: 0 },
    tIn: { x: 0, z: -1 },
    node: { x: 0, z: -10 },
    exitM: 25,
    hasStopped,
  });

  it("books 信号無視（点滅） at the line when the car did not stop on 赤の点滅", () => {
    const out = new RedLightJudge().crossed(crossing("b", false), 0);
    expect(out).toEqual([expect.objectContaining({ kind: "violation", movement: null, flashing: true })]);
  });

  it("books nothing when the car stopped first, and nothing on 黄の点滅", () => {
    expect(new RedLightJudge().crossed(crossing("b", true), 0)).toEqual([]);
    expect(new RedLightJudge().crossed(crossing("a", false), 0)).toEqual([]);
  });
});

/** 第3条第2項 over a stretch of steps that does not loop: each lamp's change is G→Y, Y→R or R→G. */
function linearOrderIssues(steps: readonly Step[]): string[] {
  const next: Record<string, string> = { G: "Y", Y: "R", R: "G" };
  const issues: string[] = [];
  for (const g of Object.keys(steps[0].main)) {
    const seq = steps.map((st) => st.main[g]).filter((m, i, all) => i === 0 || m !== all[i - 1]);
    for (let i = 1; i < seq.length; i++)
      if (next[seq[i - 1]] !== seq[i]) issues.push(`${g}: ${seq[i - 1]}→${seq[i]}`);
  }
  return issues;
}

describe("changing plans at night (C1): every template × every flash colouring × every change moment", () => {
  const days = {
    twoPhase: twoPhase("default"),
    rightArrow: twoPhaseWithRightArrow(["a", "b"], "inferred"),
    scramble: scramble("osm"),
    staggered: staggered("osm"),
    buttons: withWalkButtons(twoPhase("default"), "osm"),
  };
  const colourings = (groups: string[]): Record<string, "FY" | "FR">[] => {
    const out: Record<string, "FY" | "FR">[] = [{}];
    for (const g of groups)
      out.splice(
        0,
        out.length,
        ...out.flatMap((o) => [
          { ...o, [g]: "FY" as const },
          { ...o, [g]: "FR" as const },
        ]),
      );
    return out;
  };

  for (const [name, dayPlan] of Object.entries(days)) {
    it(`${name}: has a change moment, and day → flash → way out → day keeps 第3条第2項 and the safety rules`, () => {
      const day = compilePlan(dayPlan);
      const moments = day.plan.steps.flatMap((st, i) =>
        isChangeMoment(day, day.starts[i] + st.s - 1e-6) ? [i] : [],
      );
      expect(moments.length).toBeGreaterThan(0);
      const groups = Object.keys(dayPlan.steps[0].main);
      let checked = 0;
      for (const colours of colourings(groups)) {
        const flash = nightFlash(dayPlan, colours, "osm");
        const isFlashSafe = safetyIssues(flash).length === 0;
        if (!isFlashSafe) continue; // nightFlash with two crossing roads at 黄の点滅 is refused upstream
        const exit = flashExit(flash).plan.steps;
        for (const k of moments) {
          // The run as one cycle: the day plan up to its change moment (the all-red cut at
          // MIN_ALL_RED_S), the flash, its way out, back to the day plan's first step.
          const run = {
            ...dayPlan,
            steps: [
              ...dayPlan.steps.slice(0, k),
              { ...dayPlan.steps[k], s: MIN_ALL_RED_S },
              flash.steps[0],
              ...exit,
            ],
          };
          expect(safetyIssues(run), `${name} ${JSON.stringify(colours)} at step ${k}`).toEqual([]);
          // 第3条第2項 is about 青・黄・赤 shown in succession: the flash breaks the succession, so the
          // order is checked on the steady stretch before it and on the way out into the day plan.
          const before = dayPlan.steps.slice(0, k + 1);
          const after = [...exit, dayPlan.steps[0]];
          expect(linearOrderIssues(before), `${name} before the flash at step ${k}`).toEqual([]);
          expect(linearOrderIssues(after), `${name} ${JSON.stringify(colours)} out of the flash`).toEqual([]);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it("flashExit: 黄の点滅 → 黄 for 3 s, 赤の点滅 → 赤, then all 赤; walk lamps from dark to red", () => {
    const exit = flashExit(nightFlash(twoPhase("default"), { a: "FR", b: "FY" }, "osm")).plan.steps;
    expect(exit.map((st) => [st.s, st.main])).toEqual([
      [FLASH_EXIT.yellowS, { a: "R", b: "Y" }],
      [FLASH_EXIT.allRedS, { a: "R", b: "R" }],
    ]);
    expect(exit.every((st) => Object.values(st.ped).every((p) => p === "stop"))).toBe(true);
  });

  it("ScheduledRun: waits for the day plan's all-red to go into the flash, and keeps what showed for the grace", () => {
    const day = compilePlan(twoPhase("default"));
    const flash = compilePlan(nightFlash(twoPhase("default"), { a: "FY", b: "FR" }, "osm"));
    const run = new ScheduledRun(day, { kind: "flash", window: [1320, 360], plan: flash }, 0, 12 * 60);
    let t = 0;
    for (; t < 10; t += 0.25) expect(run.advance(t, 23 * 60)).toBe(null); // a's 青: no change
    while (run.advance(t, 23 * 60) === null) t += 0.25;
    // twoPhase's first all-red is 23–25 s; the change waits MIN_ALL_RED_S into it.
    expect(t).toBeCloseTo(23 + MIN_ALL_RED_S);
    expect(run.stepBefore(t, 0.5).main).toEqual({ a: "R", b: "R" });
    expect(run.stepAt(t + 1).main).toEqual({ a: "FY", b: "FR" });
  });
});

describe("junctionFacts (assign.ts, W3): what the records near a junction say", () => {
  it("uses a record that carries only a colour note, and skips records that say nothing", () => {
    const blinker = { ...UNTAGGED, phase: { ...NO_PHASE, flash: "always" as const } };
    const colourOnly = {
      ...UNTAGGED,
      junctionCapable: false,
      bearing: 90,
      phase: { ...NO_PHASE, flashHint: "red" as const },
    };
    const got = junctionFacts([UNTAGGED, blinker, colourOnly]);
    expect(got.flash).toEqual({ when: "always" });
    expect(got.hints).toEqual([{ bearingDeg: 90, flash: "red", staggered: undefined }]);
    expect(junctionFacts([UNTAGGED])).toBe(NO_JUNCTION_FACTS);
  });
});

describe("dropped right arrows (W6)", () => {
  it("counts the right-turn lanes' arrows scramble and 時差式 drop, and none where the arrows run", () => {
    const lanes = { lanes: [["through"], ["right"]], source: "osm" as const };
    const approaches = [
      { axis: 0 as const, bearingDeg: 90, lanes },
      { axis: 0 as const, bearingDeg: 270, lanes },
      { axis: 1 as const, bearingDeg: 0, lanes },
      { axis: 1 as const, bearingDeg: 180 },
    ];
    expect(planForJunction(approaches, facts({ scramble: true })).droppedArrows).toBe(2);
    expect(planForJunction(approaches, facts({ staggered: true })).droppedArrows).toBe(2);
    const arrows = planForJunction(approaches);
    expect([arrows.plan.plan.template, arrows.droppedArrows]).toEqual(["twoPhaseWithRightArrow", 0]);
  });
});

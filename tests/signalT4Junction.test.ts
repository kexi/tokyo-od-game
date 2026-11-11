import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, BufferGeometry, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { AppliedRegulations, Crossing } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { NO_PHASE, UNTAGGED, type SignalPhaseFacts, type SignalRecord } from "../src/signals/osmTags";
import { SCRAMBLE_TIMING } from "../src/signals/plan";
import type { SignalKit } from "../src/world/signalModels";
import { TrafficControl, type Approach } from "../src/world/trafficControl";
import { SignalViolationCheck } from "../src/game/signalViolations";
import { TrafficAI } from "../src/world/traffic-ai";
import { SidewalkNetwork, type Walk } from "../src/world/sidewalks";

const part = () => [{ geometry: new BufferGeometry(), material: new MeshBasicMaterial() }];
const kit = {
  head: part(),
  headRightArrow: part(),
  pedHead: part(),
  pole: part(),
  arm: part(),
  buttonBox: part(),
  lamp: new BufferGeometry(),
  arrowLamp: new BufferGeometry(),
  pedLamp: new BufferGeometry(),
  waitLamp: new BufferGeometry(),
  lens: new MeshBasicMaterial(),
  pedStop: new MeshBasicMaterial(),
  pedGo: new MeshBasicMaterial(),
  waitLens: new MeshBasicMaterial(),
} as unknown as SignalKit;
vi.mock("../src/world/signalModels", async (original) => ({
  ...(await original<typeof import("../src/world/signalModels")>()),
  signalKit: () => kit,
}));
// The 「時差式信号」 plate draws its face on a canvas; the tests run without a DOM.
vi.stubGlobal("document", {
  createElement: () => ({
    getContext: () => ({
      fillRect: () => undefined,
      strokeRect: () => undefined,
      fillText: () => undefined,
      measureText: () => ({ width: 100 }),
    }),
  }),
});
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const C = [139.76, 35.68];
const D = 0.0012; // ≈ 110 m arms
/** A four-way junction: a 16 m east–west road (the main road, axis 0) and a 10 m north–south one. */
const roads: RoadLine[] = [
  { coords: [C[0] - D, C[1], C[0], C[1]], width: 16, kind: "local", oneway: 0 },
  { coords: [C[0], C[1], C[0] + D, C[1]], width: 16, kind: "local", oneway: 0 },
  { coords: [C[0], C[1] - D, C[0], C[1]], width: 10, kind: "local", oneway: 0 },
  { coords: [C[0], C[1], C[0], C[1] + D], width: 10, kind: "local", oneway: 0 },
];

/** The junction, a crosswalk on each arm 12 m out, and one OSM record at the junction with `phase`. */
function build(
  phase: Partial<SignalPhaseFacts>,
  extra: Partial<SignalRecord["tags"]> = {},
  scene = new Scene(),
  more: readonly Partial<SignalRecord["tags"]>[] = [],
) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const control = new TrafficControl(scene, () => 0, world);
  const graph = new RoadGraph(roads, frame);
  const centre = frame.toLocal(C[1], C[0], 0);
  const crossings: Crossing[] = graph.segments.map((seg) => {
    const startsAtJunction = graph.sample(seg, 0).pos.distanceTo(new Vector3(centre.x, 0, centre.z)) < 1;
    const at = startsAtJunction ? 12 : seg.length - 12;
    return { seg, s: at, pos: graph.sample(seg, at).pos.clone() };
  });
  const regs: AppliedRegulations = {
    crossings,
    signs: [],
    turnRules: [],
    stopLines: [],
    stopSigns: [],
    signals: [new Vector3(centre.x, 0, centre.z), ...more.map(() => new Vector3(centre.x + 3, 0, centre.z))],
    junctionNames: [],
    footbridges: [],
    laneUse: [],
    hasMarkings: false,
  };
  // `more`: further nodes 3 m off the junction (notes that name a direction), crossing-only so they
  // do not snap a signal of their own.
  const records: SignalRecord[] = [
    { lon: C[0], lat: C[1], tags: { ...UNTAGGED, ...extra, phase: { ...NO_PHASE, ...phase } } },
    ...more.map((m) => ({ lon: C[0], lat: C[1], tags: { ...UNTAGGED, junctionCapable: false, ...m } })),
  ];
  control.rebuild(graph, regs, records);
  const signals = () => control.approaches.filter((a) => a.kind === "signal");
  return {
    scene,
    world,
    control,
    graph,
    regs,
    records,
    crossings,
    centre: new Vector3(centre.x, 0, centre.z),
    signals,
  };
}

/** The first clock time (0.25 s steps) at which `ok` holds. */
function firstTime(control: TrafficControl, ok: () => boolean, from = 0, until = 400): number {
  for (let t = from; t < until; t += 0.25) {
    control.update(t);
    if (ok()) return t;
  }
  throw new Error("never");
}

describe("歩車分離 at a junction OSM tags crossing:scramble (T4)", () => {
  it("runs scramble: while any walk light is 青 every vehicle approach is at 赤, and the diagonal walks with them", () => {
    const { world, control, crossings, centre, signals } = build({ scramble: true });
    try {
      expect(signals()[0].controller?.plan.plan.template).toBe("scramble");
      let walked = 0;
      for (let t = 0; t < 120; t += 0.25) {
        control.update(t);
        const lights = crossings.map((c) => control.pedLight(c.seg, c.pos));
        const isAnyWalking = lights.some((l) => l === "go");
        if (!isAnyWalking) continue;
        walked++;
        expect(lights.every((l) => l === "go")).toBe(true);
        expect(control.diagonalLight(centre)).toBe("go");
        expect(control.mayCrossDiagonal(centre)).toBe(true);
        for (const ap of signals()) expect(control.permits(ap, "through")).toBe("stop");
      }
      expect(walked).toBeGreaterThan(0);
    } finally {
      world.free();
    }
  });

  it("sounds one bird at every crosswalk during the scramble walk (音響式)", () => {
    const { world, control, crossings } = build({ scramble: true });
    try {
      firstTime(control, () => control.pedLight(crossings[0].seg, crossings[0].pos) === "go");
      const birds = new Set<string | null>();
      let heads = 0;
      control.forEachWalking((h) => {
        heads++;
        birds.add(h.bird);
      });
      expect(heads).toBe(8); // both ends of four crosswalks
      expect(birds).toEqual(new Set(["piyo"]));
    } finally {
      world.free();
    }
  });

  it("walkers at a corner sometimes take the diagonal, wait for its 青 and go corner to opposite corner", () => {
    const { world, control, graph, crossings, centre } = build({ scramble: true });
    try {
      control.update(0);
      const net = new SidewalkNetwork(
        graph,
        crossings,
        (seg, near) => control.mayCross(seg, near),
        () => true,
        () => false,
        undefined,
        (near) => control.mayCrossDiagonal(near),
      );
      const noCar = { pos: new Vector3(0, 0, 1e6), speed: 0, forward: new Vector3(0, 0, 1) };
      let diagonals = 0;
      for (let id = 1; id <= 80 && diagonals === 0; id++) {
        const w = net.attach(centre.clone().add(new Vector3(-40, 0, 9)), id) as Walk;
        if (!w) continue;
        const pos = net.point(w.seg, w.s, w.side, w.lateral);
        let t = 0;
        for (let i = 0; i < 4000; i++) {
          t += 0.05;
          control.update(t);
          const step = net.advance(w, 0.07, id, noCar, pos);
          const leg = w.leg;
          const isOnDiagonal = step.crossing && leg?.diagonal === true;
          if (isOnDiagonal && leg) {
            expect(control.diagonalLight(centre)).not.toBe("stop");
            const [from, to] = [leg.points[leg.crossTo - 1], leg.points[leg.crossTo]];
            // Opposite corners: on either side of the centre in both x and z.
            expect(Math.sign(from.x - centre.x)).toBe(-Math.sign(to.x - centre.x));
            expect(Math.sign(from.z - centre.z)).toBe(-Math.sign(to.z - centre.z));
            diagonals++;
            break;
          }
          if (step.crossing && leg && !leg.diagonal) break;
          pos.copy(step.target);
        }
      }
      expect(diagonals).toBeGreaterThan(0);
    } finally {
      world.free();
    }
  });
});

describe("時差式 at a junction OSM tags 時差式 (T4)", () => {
  it("splits the main road's two directions into groups that end apart, and hangs a 「時差式信号」 plate under their heads", () => {
    const scene = new Scene();
    const { world, control, signals } = build({ staggered: "unknown" }, {}, scene);
    try {
      const groups = signals().map((a) => `${a.axis}${a.group}`);
      expect(new Set(groups)).toEqual(new Set(["0a", "0c", "1b"]));
      const plates = scene.children.filter(
        (o): o is Mesh =>
          o instanceof Mesh && o.geometry instanceof BoxGeometry && o.geometry.parameters.width < 1.3,
      );
      expect(plates).toHaveLength(signals().filter((a) => a.axis === 0).length);
      const first = signals().find((a) => a.group === "c") as Approach;
      const later = signals().find((a) => a.group === "a") as Approach;
      firstTime(control, () => control.state(first) === "red" && control.state(later) === "green");
      expect(control.permits(later, "right")).toBe("go");
      expect(control.permits(first, "through")).toBe("stop");
    } finally {
      world.free();
    }
  });
});

describe("点滅 at a junction OSM tags blinker (T4)", () => {
  it("flashes always for traffic_signals=blinker: the main road 黄の点滅, the crossing road 赤の点滅, walk lamps dark", () => {
    const { world, control, crossings, signals } = build({ flash: "always" });
    try {
      control.update(10);
      const main = signals().find((a) => a.axis === 0) as Approach;
      const side = signals().find((a) => a.axis === 1) as Approach;
      expect(control.state(main)).toBe("flashingYellow");
      expect(control.state(side)).toBe("flashingRed");
      expect(control.permits(main, "through")).toBe("go");
      expect(control.permits(side, "through")).toBe("stopFirst");
      expect(control.pedLight(crossings[0].seg, crossings[0].pos)).toBe("off");
      expect(control.mayCross(crossings[0].seg, crossings[0].pos)).toBe(null);
    } finally {
      world.free();
    }
  });

  // Every combination the notes can give (main/crossing red or yellow, never both yellow), entered at
  // every moment of the day cycle and left again: the lamps each approach showed, tick by tick,
  // keep the safety rules (lampsAreSafe).
  for (const [label, hints] of [
    ["main 黄・crossing 赤 (the assumption)", []],
    [
      "main 赤・crossing 黄 (notes flip it)",
      [
        { flashHint: "red", bearing: 90 },
        { flashHint: "yellow", bearing: 0 },
      ],
    ],
    [
      "both 赤",
      [
        { flashHint: "red", bearing: 90 },
        { flashHint: "red", bearing: 0 },
      ],
    ],
  ] as const) {
    it(`into the night flash and back keeps every crossing pair apart, 黄 ≥ 3 s and an all-red: ${label}`, () => {
      const extra = hints.map((h) => ({
        bearing: h.bearing,
        phase: { ...NO_PHASE, flashHint: h.flashHint },
      }));
      for (const nightfall of [0.5, 9, 21.5, 24.5, 31, 44.5]) {
        const { world, control, signals } = build(
          { flash: "window", flashWindow: [22 * 60, 6 * 60] },
          {},
          new Scene(),
          extra,
        );
        try {
          const timeline: Record<string, string>[] = [];
          const sample = (t: number) => {
            control.update(t);
            timeline.push(Object.fromEntries(signals().map((a) => [`${a.axis}${a.id}`, control.state(a)])));
          };
          control.setTimeOfDay(12 * 60);
          let t = 0;
          for (; t < nightfall; t += 0.25) sample(t);
          control.setTimeOfDay(23 * 60);
          for (; t < nightfall + 120; t += 0.25) sample(t);
          expect(signals()[0].controller?.plan.plan.template).toBe("nightFlash");
          // The notes' colours are used (a node with only a colour note counts: assign.ts saysOfPlan).
          const main = signals().find((x) => x.axis === 0) as Approach;
          expect(control.state(main)).toBe(hints[0]?.flashHint === "red" ? "flashingRed" : "flashingYellow");
          control.setTimeOfDay(7 * 60);
          for (; t < nightfall + 240; t += 0.25) sample(t);
          expect(signals()[0].controller?.isNight).toBe(false);
          expect(lampsAreSafe(timeline, 0.25)).toEqual([]);
        } finally {
          world.free();
        }
      }
    });
  }

  it("keeps a plan change under way across a rebuild of the network (the run is kept by the junction's key)", () => {
    const { world, control, graph, regs, records, signals } = build({
      flash: "window",
      flashWindow: [22 * 60, 6 * 60],
    });
    try {
      control.setTimeOfDay(23 * 60);
      firstTime(control, () => signals()[0].controller?.plan.plan.template === "nightFlash");
      control.setTimeOfDay(7 * 60);
      const out = firstTime(control, () => signals()[0].controller?.plan.plan.template === "flashExit", 100);
      control.rebuild(graph, regs, records);
      control.update(out + 1);
      expect(signals()[0].controller?.plan.plan.template).toBe("flashExit");
      // And a rebuild at night does not jump back into the flash from wherever the day plan is.
      control.update(out + 10);
      expect(signals()[0].controller?.plan.plan.template).toBe("twoPhase");
    } finally {
      world.free();
    }
  });

  it("reads the grace a moment ago from what showed then: just after the flash's way out the 黄 is still there", () => {
    const { world, control, signals } = build({ flash: "window", flashWindow: [22 * 60, 6 * 60] });
    try {
      control.setTimeOfDay(23 * 60);
      firstTime(control, () => signals()[0].controller?.plan.plan.template === "nightFlash");
      control.setTimeOfDay(7 * 60);
      const day = firstTime(control, () => signals()[0].controller?.plan.plan.template === "twoPhase", 100);
      const main = signals().find((a) => a.axis === 0) as Approach;
      // 3 s before the day plan's first 青 the main road showed the way out's 黄, then 赤.
      expect(control.permitsBefore(main, "through", 4)).toBe("stopIfAble");
      expect(control.permitsBefore(main, "through", 1)).toBe("stop");
      void day;
    } finally {
      world.free();
    }
  });

  it("books 信号無視（点滅） for crossing 赤の点滅 without stopping, and nothing after a stop or on 黄の点滅", () => {
    const { world, control, signals } = build({ flash: "always" });
    try {
      control.update(10);
      const side = signals().find((a) => a.axis === 1) as Approach;
      const main = signals().find((a) => a.axis === 0) as Approach;
      const drive = (ap: Approach, hasStopped: boolean) => {
        const booked: string[] = [];
        const check = new SignalViolationCheck(control, (_, kind) => booked.push(kind));
        const line = ap.a.clone().add(ap.b).multiplyScalar(0.5);
        let prev = line.clone().addScaledVector(ap.travel, -10.37);
        for (let d = 1; d <= 40; d++) {
          const cur = prev.clone().addScaledVector(ap.travel, 1);
          check.step(control.crossed(prev, cur), prev, cur, ap.travel, 10_000 + d * 50, () => hasStopped);
          prev = cur;
        }
        return booked;
      };
      expect(drive(side, false)).toEqual(["signalFlashing"]);
      expect(drive(side, true)).toEqual([]);
      expect(drive(main, false)).toEqual([]);
    } finally {
      world.free();
    }
  });

  it("交通 AI: after the 一時停止 at 赤の点滅, lets a car coming on the crossing road by first", () => {
    const { world, control, graph, scene, signals } = build({ flash: "always" });
    try {
      control.update(10);
      const ap = signals().find((a) => a.axis === 1) as Approach;
      const cross = signals().find((a) => a.axis === 0) as Approach;
      const ai = new TrafficAI(scene, world, () => 0, control) as unknown as {
        stopGap(graph: RoadGraph, car: unknown, dt: number): number;
        cars: unknown[];
      };
      const car = {
        seg: ap.seg,
        dir: ap.dir,
        s: ap.at - 1,
        speed: 0,
        route: [],
        served: -1,
        waited: 0,
        serial: 1,
      };
      // A car on the main road (黄の点滅) 20 m short of the junction, driving on.
      const along = cross.dir === 1 ? cross.at - 10 : cross.seg.length - cross.at + 10;
      const pos = graph.sample(cross.seg, along).pos.clone();
      ai.cars.push({ seg: cross.seg, dir: cross.dir, s: cross.at - 10, speed: 8, object: { position: pos } });
      for (let i = 0; i < 150; i++) ai.stopGap(graph, car, 0.016); // standing 2.4 s at the line
      expect(ai.stopGap(graph, car, 0.016)).toBeLessThan(10); // still held at the line
      ai.cars.length = 0;
      expect(ai.stopGap(graph, car, 0.016)).toBe(Infinity);
    } finally {
      world.free();
    }
  });

  it("交通 AI: makes the 一時停止 at 赤の点滅, then goes on", () => {
    const { world, control, graph, scene, signals } = build({ flash: "always" });
    try {
      control.update(10);
      const ap = signals().find((a) => a.axis === 1) as Approach;
      const ai = new TrafficAI(scene, world, () => 0, control) as unknown as {
        stopGap(graph: RoadGraph, car: unknown, dt: number): number;
      };
      const car = {
        seg: ap.seg,
        dir: ap.dir,
        s: ap.at - 40,
        speed: 10,
        route: [],
        served: -1,
        waited: 0,
        serial: 1,
      };
      expect(ai.stopGap(graph, car, 0.016)).toBeLessThan(46); // held at the line from afar
      Object.assign(car, { s: ap.at - 1, speed: 0 });
      for (let i = 0; i < 100; i++) ai.stopGap(graph, car, 0.016); // standing 1.6 s at the line
      expect(ai.stopGap(graph, car, 0.016)).toBe(Infinity);
    } finally {
      world.free();
    }
  });
});

describe("交差点の押ボタン (button_operated=yes / night, T4)", () => {
  it("keeps the walk at red until pressed (the vehicles cycle as ever), then shows it", () => {
    const { world, control, crossings, signals } = build({}, { button: true });
    try {
      const cw = crossings[0];
      expect(signals()[0].controller?.plan.plan.onCall.length).toBeGreaterThan(0);
      const lights = new Set<string | null>();
      for (let t = 0; t < 90; t += 0.25) {
        control.update(t);
        lights.add(control.pedLight(cw.seg, cw.pos));
      }
      expect(lights).toEqual(new Set(["stop"]));
      control.update(90);
      expect(control.pressButton(cw.seg, cw.pos)).toBe(true);
      firstTime(control, () => control.pedLight(cw.seg, cw.pos) === "go", 90, 200);
    } finally {
      world.free();
    }
  });

  it("button_operated=night: the walk comes on its own by day and only on a press at night", () => {
    const { world, control, crossings } = build({ buttonNight: true });
    try {
      const cw = crossings[0];
      control.setTimeOfDay(12 * 60);
      firstTime(control, () => control.pedLight(cw.seg, cw.pos) === "go");
      control.setTimeOfDay(23 * 60);
      const seen = new Set<string | null>();
      for (let t = 100; t < 200; t += 0.25) {
        control.update(t);
        seen.add(control.pedLight(cw.seg, cw.pos));
      }
      expect(seen).toEqual(new Set(["stop"]));
    } finally {
      world.free();
    }
  });
});

describe("SCRAMBLE_TIMING and the diagonal's walk left", () => {
  it("gives a walker at 1.3 m/s 39 m over 青 and flash (the assumption written in plan.ts)", () => {
    expect((SCRAMBLE_TIMING.walk + SCRAMBLE_TIMING.pedFlash) * 1.3).toBeCloseTo(39);
  });

  it("lets a walker set out on the diagonal only while the walk left covers it", () => {
    const { world, control, centre } = build({ scramble: true });
    try {
      const start = firstTime(control, () => control.diagonalLight(centre) === "go");
      expect(control.mayCrossDiagonal(centre, 25)).toBe(true);
      // Near the end of 青 (flash 8 s still to come): 25 s of walking no longer fits, 5 s does.
      control.update(start + SCRAMBLE_TIMING.walk - 1);
      expect(control.diagonalLight(centre)).toBe("go");
      expect(control.mayCrossDiagonal(centre, 25)).toBe(false);
      expect(control.mayCrossDiagonal(centre, 5)).toBe(true);
    } finally {
      world.free();
    }
  });
});

/**
 * The safety rules over what approaches showed, sampled every `dt` s: approaches of crossing axes
 * never open (青・黄・黄の点滅) together, an approach that opens has had every crossing approach
 * closed for MIN_ALL_RED_S, a 黄 lasts at least 3 s, and 青 or 黄の点滅 never turns straight to 赤.
 */
function lampsAreSafe(timeline: Record<string, string>[], dt: number): string[] {
  const issues: string[] = [];
  const isOpen = (l: string) => l === "green" || l === "yellow" || l === "flashingYellow";
  const keys = Object.keys(timeline[0] ?? {});
  const crossing = (k: string, m: string) => k[0] !== m[0];
  timeline.forEach((now, i) => {
    for (const k of keys) {
      for (const m of keys) {
        if (crossing(k, m) && isOpen(now[k]) && isOpen(now[m])) issues.push(`${i}: ${k} and ${m} open`);
      }
      const before = timeline[i - 1];
      if (!before) continue;
      const opens = isOpen(now[k]) && !isOpen(before[k]);
      if (opens) {
        const look = Math.round(1 / dt);
        const back = timeline.slice(Math.max(0, i - look), i);
        const isCleared =
          back.length === look && back.every((b) => keys.every((m) => !crossing(k, m) || !isOpen(b[m])));
        if (!isCleared && i >= look) issues.push(`${i}: ${k} opens without an all-red`);
      }
      const isStraightToRed =
        (before[k] === "green" || before[k] === "flashingYellow") &&
        (now[k] === "red" || now[k] === "flashingRed");
      if (isStraightToRed) issues.push(`${i}: ${k} ${before[k]} → ${now[k]}`);
      const yellowEnds = before[k] === "yellow" && now[k] !== "yellow";
      if (yellowEnds) {
        let run = 0;
        for (let j = i - 1; j >= 0 && timeline[j][k] === "yellow"; j--) run += dt;
        const isWhole = i - Math.round(run / dt) > 0;
        if (isWhole && run < 3 - 1e-6) issues.push(`${i}: ${k} yellow ${run} s`);
      }
    }
  });
  return issues;
}

describe("lampsAreSafe (the checker the night-flash tests lean on)", () => {
  it("catches a crossing road going 黄の点滅 straight after the other's 青, and 青 straight to 赤の点滅", () => {
    const tick = (a: string, b: string) => ({ "0a": a, "1b": b });
    const bad = [
      ...Array.from({ length: 8 }, () => tick("green", "red")),
      ...Array.from({ length: 8 }, () => tick("flashingRed", "flashingYellow")),
    ];
    const issues = lampsAreSafe(bad, 0.25);
    expect(issues.some((m) => m.includes("opens without an all-red"))).toBe(true);
    expect(issues.some((m) => m.includes("green → flashingRed"))).toBe(true);
  });
});

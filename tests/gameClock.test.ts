import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Scene } from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The police unit's physics car without its glTF body (loaded by the browser), as
// tests/massContacts.test.ts does.
vi.mock("../src/game/carModel", () => ({
  WHEEL_RADIUS: 0.36,
  createCarModel: () => {
    const wheels = [0, 1, 2, 3].map(() => new Group().add(new Group()));
    return { root: new Group(), wheels, headlights: [], setLights: () => {} };
  },
}));
import { clockStep, gameStep, MAX_FRAME_S } from "../src/game/frameClock";
import { hasHeldOver, heldSince } from "../src/game/lawTimers";
import {
  type IndicatorMemory,
  isSignalOmitted,
  noteIndicators,
  turnSignalSide,
} from "../src/game/signalOmission";
import { TrafficLaw, VIOLATIONS } from "../src/game/traffic";
import { sourceFiles } from "./sourceCode";

/**
 * The game's clock (frameClock.ts gameStep) and the law's times on it. What these guarantee: a
 * judgement about the world (合図, 逆走's grace, the re-count after a booking, the phone in use, the
 * police lights) comes out the same whether a frame takes 16.7 ms or 300 ms of wall time, because
 * the world moves at most MAX_FRAME_S a frame and the law now counts in the same time.
 */

/** 60 frames a second, and a page under load (QA's headless Chrome, a phone): 300 ms a frame. */
const FAST_MS = 1000 / 60;
const SLOW_MS = 300;
/** main.ts runs its law checks 5 times a second (lastLawCheck). */
const LAW_CHECK_MS = 200;
/** The car's speed in the runs below (m/s, 36 km/h). */
const SPEED = 10;

type Frame = { dt: number; game: number; wall: number };

/** The frames main.ts's step sees with a frame every `frameMs` of wall time (from 1000 ms). */
function* frames(frameMs: number): Generator<Frame> {
  let stamp = 1000;
  let last = stamp;
  let game = stamp;
  for (;;) {
    stamp += frameMs;
    const clock = clockStep(stamp, last);
    last = clock.last;
    game = gameStep(game, clock.dt);
    yield { dt: clock.dt, game, wall: clock.last };
  }
}

/**
 * main.ts's 合図 at a right turn: the car runs from 40 m before the junction to 25 m past it, the
 * indicator on until `offAt` m (null: never on), judged at the first law check past 25 m. `clock`
 * picks the time the law reads: the game's (now) or the wall clock (before this change).
 */
function turnBooked(frameMs: number, offAt: number | null, clock: "game" | "wall"): boolean {
  const memory: IndicatorMemory = { left: -Infinity, right: -Infinity };
  let x = -40;
  let lastCheck = 0;
  for (const f of frames(frameMs)) {
    const now = clock === "game" ? f.game : f.wall;
    x += SPEED * f.dt;
    // The law check comes before the indicators are noted in the frame (main.ts's order).
    const isCheckDue = now - lastCheck > LAW_CHECK_MS;
    if (isCheckDue) {
      lastCheck = now;
      const isPastJunction = x > 25;
      if (isPastJunction) return isSignalOmitted(turnSignalSide("right"), now, memory);
    }
    const isSignalling = offAt !== null && x < offAt;
    noteIndicators(memory, false, isSignalling, now);
  }
  throw new Error("unreachable");
}

describe("gameStep: the game's clock runs with the world", () => {
  it("keeps to the wall clock at 60 frames a second (the game as it was)", () => {
    let game = 1000;
    let last = 1000;
    for (let i = 1; i <= 600; i++) {
      const clock = clockStep(1000 + i * FAST_MS, last);
      last = clock.last;
      game = gameStep(game, clock.dt);
    }
    expect(game).toBeCloseTo(last, 6);
  });

  it("moves MAX_FRAME_S a frame when frames take 300 ms", () => {
    const run = frames(SLOW_MS);
    const first = run.next().value as Frame;
    const second = run.next().value as Frame;
    expect(second.game - first.game).toBeCloseTo(MAX_FRAME_S * 1000, 9);
    expect(second.wall - first.wall).toBe(SLOW_MS);
  });

  it("does not move on a frame stamped behind the last one (rAF after advance)", () => {
    const back = clockStep(900, 1000);
    expect(gameStep(5000, back.dt)).toBe(5000);
  });
});

describe("合図 (第53条) on the game's clock", () => {
  // The indicator cancels 5 m before the junction; the car is judged 25 m past it: 30 m, 3 s on.
  it("does not book a signalled turn, at 16.7 ms or 300 ms a frame", () => {
    expect(turnBooked(FAST_MS, -5, "game")).toBe(false);
    expect(turnBooked(SLOW_MS, -5, "game")).toBe(false);
  });

  it("booked that turn on a slow page when the law read the wall clock (the bug this fixes)", () => {
    expect(turnBooked(FAST_MS, -5, "wall")).toBe(false);
    expect(turnBooked(SLOW_MS, -5, "wall")).toBe(true);
  });

  it("still books a turn without the indicator, at either weight", () => {
    expect(turnBooked(FAST_MS, null, "game")).toBe(true);
    expect(turnBooked(SLOW_MS, null, "game")).toBe(true);
  });

  it("needs the indicator of the side turned to (a slight bend needs none)", () => {
    expect(turnSignalSide("slightLeft")).toBe("left");
    expect(turnSignalSide("uturn")).toBe("right");
    expect(turnSignalSide("straight")).toBeNull();
    expect(turnSignalSide("slightRight")).toBeNull();
    expect(isSignalOmitted(null, 10_000, { left: -Infinity, right: -Infinity })).toBe(false);
  });
});

/** 逆走 (通行禁止, 1.5 s): the car goes `metres` against a one-way street; is it booked? */
function wrongWayBooked(frameMs: number, metres: number, clock: "game" | "wall"): boolean {
  let x = 0;
  let since: number | null = null;
  let lastCheck = 0;
  let booked = false;
  for (const f of frames(frameMs)) {
    const now = clock === "game" ? f.game : f.wall;
    x += SPEED * f.dt;
    const isCheckDue = now - lastCheck > LAW_CHECK_MS;
    if (!isCheckDue) continue;
    lastCheck = now;
    const isWrongWay = x < metres;
    since = heldSince(isWrongWay, since, now);
    if (hasHeldOver(since, now, 1500)) booked = true;
    const isOffTheStreet = x > metres + 10;
    if (isOffTheStreet) return booked;
  }
  throw new Error("unreachable");
}

describe("a timed offence (逆走's 1.5 s) on the game's clock", () => {
  it("books the same drives at 16.7 ms and 300 ms a frame", () => {
    // 12 m at 10 m/s is 1.2 s: a moment, not booked. 25 m is 2.5 s: booked.
    for (const frameMs of [FAST_MS, SLOW_MS]) {
      expect(wrongWayBooked(frameMs, 12, "game")).toBe(false);
      expect(wrongWayBooked(frameMs, 25, "game")).toBe(true);
    }
  });

  it("booked the moment on a slow page when it read the wall clock (the bug this fixes)", () => {
    expect(wrongWayBooked(SLOW_MS, 12, "wall")).toBe(true);
  });
});

/** A minute of the world with the offence held all along, booked with a 15 s re-count. */
function bookings(frameMs: number): number {
  const law = new TrafficLaw();
  let lastCheck = 0;
  let count = 0;
  for (const f of frames(frameMs)) {
    const isMinuteOver = f.game - 1000 > 60_000;
    if (isMinuteOver) return count;
    const isCheckDue = f.game - lastCheck > LAW_CHECK_MS;
    if (!isCheckDue) continue;
    lastCheck = f.game;
    if (law.commit(VIOLATIONS.signalOmission, f.game, 15_000)) count++;
  }
  throw new Error("unreachable");
}

describe("the re-count after a booking (book's 3rd argument) on the game's clock", () => {
  it("counts once per 15 s of the world, however long the frames take", () => {
    expect(bookings(FAST_MS)).toBe(4);
    expect(bookings(SLOW_MS)).toBe(4);
  });
});

// ---------- a time set and a time compared on one clock ----------

/** A stand-in element: whatever the phone sets or calls on it, recording its listeners. */
function fakeElement(listeners: Map<string, () => void>, hidden: boolean): HTMLElement {
  const el: Record<string | symbol, unknown> = {
    hidden,
    textContent: "",
    dataset: {},
    classList: {
      contains: () => false,
      toggle: () => undefined,
      add: () => undefined,
      remove: () => undefined,
    },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
  };
  return new Proxy(el, {
    get: (target, key) => (key in target ? target[key] : () => undefined),
  }) as unknown as HTMLElement;
}

describe("the phone's ながら運転 (2 s after working it) on the clock it is given", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stamps a touch and judges it on the game's clock, not performance.now()", async () => {
    const listeners = new Map<string, () => void>();
    const phoneEl = fakeElement(listeners, false);
    vi.stubGlobal("document", {
      querySelector: (sel: string) => (sel === "#phone" ? phoneEl : fakeElement(new Map(), true)),
      querySelectorAll: () => [],
    });
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("window", { addEventListener: () => undefined, innerWidth: 1280, innerHeight: 800 });
    const { Phone } = await import("../src/game/phone");
    let game = 50_000;
    const phone = new Phone(
      {} as never,
      {} as never,
      () => ({ location: "", clock: "", hasIncident: false }),
      () => false,
      () => game,
    );
    listeners.get("pointerdown")?.();
    // Far from the wall clock: a wall-clock stamp would be judged long ago (or in the future).
    game += 1999;
    expect(phone.isInUse(game)).toBe(true);
    game += 2;
    expect(phone.isInUse(game)).toBe(false);
  });
});

describe("the police lights' quiet tail on the clock they are given", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it("an unmarked car's lights come on 6 s of the game after it saw the offence", async () => {
    const { PolicePatrol } = await import("../src/game/policePatrol");
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    let game = 90_000;
    const unit = new PolicePatrol(
      new Scene(),
      world,
      () => 0,
      () => game,
      "unmarked",
    );
    const law = new TrafficLaw();
    const record = law.commit(VIOLATIONS.signal, game, 0);
    expect(record).not.toBeNull();
    unit.witness(record!);
    game += 5999;
    expect(unit.lightsOn).toBe(false);
    game += 2;
    expect(unit.lightsOn).toBe(true);
  });
});

// ---------- the sources ----------

/**
 * The files that time the world: the law's checks, the police, the phone, the signals, the traffic
 * and the autopilot. They take the game's clock from main.ts (`now`, gameNow) and read no clock of
 * their own: a time stamped on the wall clock and judged against the game's drifts apart on a slow
 * page (knowledge/game-clock.md).
 */
const WORLD_FILES = [
  "src/game/autoDriver.ts",
  "src/game/autoTraffic.ts",
  "src/game/emergency.ts",
  "src/game/expresswayLaw.ts",
  "src/game/expresswayWatch.ts",
  "src/game/lawTimers.ts",
  "src/game/missions.ts",
  "src/game/navGuide.ts",
  "src/game/parkingPatrol.ts",
  "src/game/phone.ts",
  "src/game/policePatrol.ts",
  "src/game/pursuitDirector.ts",
  "src/game/pursuitEscalation.ts",
  "src/game/pursuitLaw.ts",
  "src/game/replay.ts",
  "src/game/robotaxi.ts",
  "src/game/signalOmission.ts",
  "src/game/signalViolations.ts",
  "src/game/traffic.ts",
  "src/game/trafficStop.ts",
  "src/world/orbis.ts",
  "src/world/pedestrians.ts",
  "src/world/traffic-ai.ts",
  "src/world/trafficControl.ts",
];

/** The wall-clock reads those files may keep: none is a time in the world. */
const WALL_READS: Record<string, { calls: number; why: string }> = {
  "src/game/autoDriver.ts": { calls: 1, why: "the planner's budget in a frame (PLAN_MS): the page's time" },
  "src/game/traffic.ts": {
    calls: 1,
    why: "a record's id and savedAt: the real date it was saved, kept over reloads",
  },
};

const CLOCK_READ = /\b(?:performance|Date)\.now\(\)/g;

describe("the world's files read no clock of their own (source check)", () => {
  const files = new Map(sourceFiles("src").map((f) => [f.path, f.code]));

  it("lists only files that exist", () => {
    expect(WORLD_FILES.filter((p) => !files.has(p))).toEqual([]);
  });

  it("call neither performance.now() nor Date.now(), but for the reads listed with a reason", () => {
    // The signals' plans and runs (src/signals/) too, whatever files come there.
    const signals = [...files.keys()].filter((p) => p.startsWith("src/signals/"));
    const reads = [...WORLD_FILES, ...signals]
      .map((p) => [p, (files.get(p) ?? "").match(CLOCK_READ)?.length ?? 0] as const)
      .filter(([, n]) => n > 0)
      .map(([p, n]) => [p, n]);
    const allowed = Object.entries(WALL_READS).map(([p, r]) => [p, r.calls]);
    expect(reads).toEqual(allowed);
  });

  it("main.ts's frame reads the wall clock only as `wall` (clockStep's), never performance.now()", () => {
    const main = files.get("src/main.ts") ?? "";
    const start = main.indexOf("const step = (stamp: number) => {");
    const end = main.indexOf("\n  };\n", start);
    const body = main.slice(start, end);
    expect(start).toBeGreaterThan(0);
    // The whole frame, through its last call.
    expect(body).toContain("afterViolations(now);");
    expect(body).not.toMatch(/performance\.now\(\)/);
  });

  it("main.ts books, commits and starts the world's timers on the game's clock, not performance.now()", () => {
    const main = files.get("src/main.ts") ?? "";
    const worldCalls =
      /\b(?:book|commit|chargeOwner|isInUse|start|startTrip|startHome|startChosen|startAppointment)\([^;]*performance\.now\(\)/g;
    expect(main.match(worldCalls) ?? []).toEqual([]);
  });

  // The relay's click and the HUD's arrows blink on `wall / 380`, the car's lamps on the wall clock
  // (carModel.ts): the cockpit's lamp (cockpit.ts, opts.now / 380) blinks in step with them only
  // on the same clock. The game's clock falls behind at every frame over MAX_FRAME_S, for good.
  it("main.ts gives the cockpit (its indicator lamp's blink) the wall clock, as the relay and the HUD", () => {
    const main = files.get("src/main.ts") ?? "";
    const start = main.indexOf("cockpit.update({");
    const call = main.slice(start, main.indexOf("});", start));
    expect(start).toBeGreaterThan(0);
    expect(main).toMatch(/const blink = Math\.floor\(wall \/ 380\) % 2 === 0;/);
    expect(call).toMatch(/\bnow: wall,/);
  });
});

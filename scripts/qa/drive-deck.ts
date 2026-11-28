// Drives a route of the deck routes table (scripts/qa/deckRoutes.ts, P2.7-5) over the expressway
// decks and counts what the decks still get wrong. Without a route it drives P3's (entrance ramp
// 207111988 → C1 内回り 24402611 → the 汐留出口 ramp 24402125 down to the street), as before.
// A cruise route takes the steady-speed dev hook (window.__game.debug.expressway.cruise): PLATEAU
// buildings the car's chassis overlaps on a deck (expressway_building_crossed), the car standing
// still on a deck (expressway_car_stalled), a fall, |dy| over the deck beyond MAX_ABS_DY_M, a drop
// far under the cruise's target speed (a wall, a step), and not reaching the route's end
// (deckDriveVerdict.ts). An autopilot route (debug.expressway.route, P6) fails on the same but the
// speed, on not arriving, and on any violation the game books. A run with an accident, a citation
// or an arrest (or blocked before it began) is `invalid` and does not count: it is driven again, up
// to --tries times (3), and stays invalid if every try was. Writes .qa/drive-deck-<label>.json (no
// route) or .qa/drive-deck-<label>-<route>.json, or into --out <dir> as <route>.json; exit 1 when the
// decks failed the drive, 2 when the run is invalid.
//
// --cpu-throttle N slows the page's CPU N times (DevTools Emulation.setCPUThrottlingRate) for the
// drive, after the town has loaded: frames then take longer than MAX_FRAME_S, and the world (and the
// game's clock, frameClock.ts gameStep) moves slower than the wall clock. The verdicts must not
// depend on it (knowledge/game-clock.md). 1 (the default) leaves the page as it is.
//
// Why the exit ramp and not on along 内回り (P3's route): past 24402611:30 the main line goes down to
// the ground end of the loaded data (築地川's cut is not in it), where the decks leave 汐留出口's
// 壁高欄 standing in 内回り's lane 0 by design (SHIODOME_REASON, knowledge/expressway-generation.md);
// the route and the traffic AI do not go there, so the check's car should not either.
//
//   just check-deck-drive [label] [route] (the dev server: just serve-dev; route all drives every one)
//   pnpm exec tsx scripts/qa/drive-deck.ts [--label L] [--route R|all] [--base URL] [--out DIR] [--tries N]
//     [--cpu-throttle N] [--pre-wait S]
//
// --pre-wait S lets the world run S seconds of game time (the signals' clock) before an autopilot
// route starts, the car standing where the town loaded (before it is put at the ramp's foot). The
// drive is the same, the signals' phase as the car comes to each light is not: since the world runs
// on one clock (knowledge/game-clock.md) a route met the same lights at the same phase on every run
// (D1).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readExpresswayFiles } from "../expresswayFiles.ts";
import { launch } from "./browser.mjs";
import {
  autoDriveFailures,
  type AutoDriveRide,
  deckDriveFailures,
  type DeckDriveRide,
  wallStopFailures,
  type WallDriveRide,
} from "./deckDriveVerdict.ts";
import {
  type AutoRoute,
  chunkAt,
  type CruiseRoute,
  DEFAULT_DATA_ROUTES,
  DEFAULT_ROUTE,
  type DeckRoute,
  routeOf,
  type WallRoute,
} from "./deckRoutes.ts";
import { type DeckStall, judgeStalls, parseLogged, type StopTrace } from "./deckStops.ts";
import { invalidOf } from "./driveInvalid.ts";
import { freePort } from "./ports.ts";
import { MOVE_S, OPEN_S, REOPEN_EVERY, routeWorstSeconds } from "./routeBundles.ts";
import { checkServedData, type ServedData } from "./servedData.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const routeArg = flag("route") ?? "";
const outDir = flag("out");
const tries = Number(flag("tries") ?? 3);
const cpuThrottle = Number(flag("cpu-throttle") ?? 1);
const preWaitS = Number(flag("pre-wait") ?? 0);
/**
 * --routes <file>: a generated table (make-district-routes.ts) instead of the hand table, driven on
 * one page moved from route to route (R1-5 PR B: the 移動, then settle, place twice, blocker), opened
 * again every REOPEN_EVERY routes or when the page's JS heap passes REOPEN_HEAP_MB. --resume skips a
 * route whose result is there for the same served data and route; --budget-min M stops before the
 * routes' estimate (routeBundles.ts) would pass M minutes and writes the next route's id.
 * Why only with --routes: the hand table's results stay as they were, one page per route (B7).
 */
const routesFile = flag("routes");
const isTable = routesFile !== undefined;
const isResume = argv.includes("--resume");
const budgetMin = flag("budget-min") === undefined ? null : Number(flag("budget-min"));
const routes: DeckRoute[] = isTable
  ? (JSON.parse(readFileSync(routesFile, "utf8")) as { routes: DeckRoute[] }).routes
  : routeArg === "all"
    ? [...DEFAULT_DATA_ROUTES]
    : [routeOf(routeArg === "" ? DEFAULT_ROUTE : routeArg)];
/** A table's results: --out, else .qa/drive-deck-<label>/ (one file per route). */
/** A kept page is opened again past this JS heap (MB; the coordinator's 1.5 GB, 手順 0 saw 201–704). */
const REOPEN_HEAP_MB = 1500;
/**
 * Tries per route: a table's 1, its invalid results driven again in a later bundle by --resume (so a
 * bundle's worst case is one try of each route); the hand table's --tries (3).
 */
const triesOf = isTable ? 1 : tries;
const tableDir = isTable ? (outDir ?? join(ROOT, ".qa", `drive-deck-${label}`)) : null;
/** The data the dev server serves (XW_DATA_DIR else public/data/expressway): where a run distance lies. */
const files = readExpresswayFiles();
/** The dev server serves the same data (R1-5 PR A, servedData.ts): else nothing is driven. */
const served = await checkServedData(base);

type Browser = Awaited<ReturnType<typeof launch>>;

const untilIn =
  (b: Browser) =>
  async <T>(expr: string, tries = 180): Promise<T> => {
    for (let i = 0; i < tries; i++) {
      const v = await b.evaluate<T>(expr).catch(() => null);
      if (v) return v;
      await b.sleep(1000);
    }
    throw new Error(`timeout: ${expr}`);
  };

/**
 * The page's CPU slowed `cpuThrottle` times (1: as it is). Only the drive is slowed: loading under
 * the throttle would only take longer.
 */
async function throttle(b: Browser): Promise<void> {
  const isThrottled = cpuThrottle !== 1;
  if (isThrottled) await b.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
}

/** Wait out whatever would make the drive invalid (null: nothing in the way). */
async function blockerOf(b: Browser): Promise<string | null> {
  // Nothing in the way first (an accident, a pursuit: an arrest would freeze the car mid-drive and
  // the run would measure the arrest, not the decks; knowledge/road-textures.md「止まる件」).
  let before: string | null = null;
  for (let i = 0; i < 30; i++) {
    before = await b.evaluate<string | null>("__game.debug.expressway.blocker()");
    const isClear = before === null;
    if (isClear) break;
    await b.sleep(1000);
  }
  return before;
}

/**
 * A table's drive stops at its worst real time (routeBundles.ts routeWorstSeconds) even before its
 * game-time limit: a frame over the 50 ms cap takes longer than the cap (an autopilot route took 18 min
 * of real time for 240 advance(1) calls, the trial b5-b, 2026-11-28), and a bundle must end inside its
 * lock. The hand table's drives keep their game-time limits alone (B7).
 */
const isPastWall = (r: DeckRoute, since: number) =>
  isTable && Date.now() - since > (routeWorstSeconds(r) - MOVE_S) * 1000;

/** A table's page, kept from route to route (null: none open), and how many routes it drove. */
let kept: { b: Browser; routes: number } | null = null;
/** The page's JS heap (MB), from DevTools. */
async function heapMb(b: Browser): Promise<number> {
  const m = (await b.send("Performance.getMetrics")) as {
    result?: { metrics: Array<{ name: string; value: number }> };
  };
  return (m.result?.metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0) / 1e6;
}

/**
 * Open the game at `start`, start it, let it settle, wait out whatever would make the drive invalid.
 * With a table, the page kept from the route before is moved there instead (the game's 移動, then
 * settle) while it has driven fewer than REOPEN_EVERY routes and its heap is under REOPEN_HEAP_MB.
 * `logsFrom`: the page's log lines from here on are this route's.
 */
async function open(
  start: string,
): Promise<{ b: Browser; url: string; before: string | null; logsFrom: number }> {
  const url = `${base}?start=${start}&time=day&weather=clear&seed=20261110&expressway`;
  const isReusable = kept !== null && kept.routes < REOPEN_EVERY && (await heapMb(kept.b)) < REOPEN_HEAP_MB;
  if (isReusable) {
    const b = kept!.b;
    kept!.routes++;
    const [lat, lon] = start.split(",").map(Number);
    const logsFrom = b.logs.length;
    await b.evaluate(`__game.debug.roads.warp({ lat: ${lat}, lon: ${lon}, name: "drive-deck" })`);
    await b.evaluate("__game.advance(1)");
    await untilIn(b)("!__game.vehicle.isFrozen() && __game.debug.settled().isSettled", 150);
    return { b, url, before: await blockerOf(b), logsFrom };
  }
  await closeKept();
  const b = await launch(url, { width: 960, height: 540, port: await freePort() });
  const until = untilIn(b);
  await until("window.__game?.getState() === 'ready'");
  await b.evaluate("window.__game.start()");
  await until("__game.debug.settled().isSettled", 150);
  await b.sleep(3000);
  if (isTable) {
    await b.send("Performance.enable");
    kept = { b, routes: 1 };
  }
  return { b, url, before: await blockerOf(b), logsFrom: 0 };
}

/** Close the kept page (a table's), if any. */
async function closeKept(): Promise<void> {
  const page = kept;
  kept = null;
  if (page) await page.b.close();
}

/**
 * After a drive: a hand-table route's page is closed, a table's kept for the next route. A drive that
 * threw has its kept page closed by the loop (closeKept), as the page may be stuck.
 */
async function release(b: Browser): Promise<void> {
  const isKept = kept !== null && kept.b === b;
  if (!isKept) await b.close();
}

async function driveCruise(r: CruiseRoute) {
  const from = chunkAt(files.byRun, r.from);
  if (!from) throw new Error(`${r.id}: no chunk of ${r.from.run} at ${r.from.s} m`);
  const end = "street" in r.to ? null : chunkAt(files.byRun, r.to);
  const isEndMissing = !("street" in r.to) && end === null;
  if (isEndMissing) throw new Error(`${r.id}: no chunk at its end`);
  const start = `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`;
  const { b, url, before, logsFrom } = await open(start);
  const driveStart = Date.now();
  try {
    await throttle(b);
    const logsBefore = b.logs.length;
    let stallFrom = logsBefore;
    const during = (event: string) =>
      b.logs.slice(logsBefore).filter((l) => l.includes(`"event":"${event}"`));
    let reachedEnd = false;
    let worst: unknown = null;
    let summary: (DeckDriveRide & Record<string, unknown> & { invalid: string | null }) | null = null;
    const isClear = before === null;
    if (isClear) {
      const until = untilIn(b);
      const lane = r.lane ?? 0;
      const place = `__game.debug.expressway.place(${JSON.stringify(from.xid)}, ${from.share}, ${lane})`;
      await until(place, 60);
      // Again once the colliders round the new spot are built (the first may fall short of them, P7).
      await b.evaluate("__game.advance(3)");
      await b.evaluate(place);
      await b.evaluate("__game.advance(1)");
      // The stall check from here on: the car stood placed for the colliders above, by design.
      stallFrom = b.logs.length;
      await b.evaluate(
        `__game.debug.expressway.cruise({ kmh: ${r.kmh}, prefer: ${JSON.stringify(r.prefer)}, lane: ${lane} })`,
      );
      const lastRun = JSON.stringify(`${r.to.run}:`);
      const endK = end?.k ?? -1;
      // The game's own frames (advance), so the drive is the same at any page speed; a second of
      // frames at a time, to stop at the route's end.
      for (;;) {
        await b.evaluate("__game.advance(1)");
        const last = await b.evaluate<{
          t: number;
          xid: string | null;
          onLast: boolean;
          atEnd: boolean;
        } | null>(
          `(() => { const s = __game.debug.expressway.samples(); const x = s.at(-1);
            const k = (y) => Number(y.xid.split(":")[1]);
            return x ? { t: x.t, xid: x.xid, onLast: s.some((y) => y.xid?.startsWith(${lastRun})),
              atEnd: s.some((y) => y.xid?.startsWith(${lastRun}) && k(y) >= ${endK}) } : null; })()`,
        );
        const isOffTheEnd = end === null && last !== null && last.onLast && last.xid === null;
        const isAtEnd = end !== null && last !== null && last.atEnd;
        if (isOffTheEnd || isAtEnd) reachedEnd = true;
        const isOver = (last !== null && last.t > r.seconds) || isPastWall(r, driveStart);
        if (reachedEnd || isOver) break;
      }
      summary = await b.evaluate(`__game.debug.expressway.stop(${JSON.stringify(r.id)})`);
      // The samples round the worst drop under the target and the worst |dy| (±2 s), to tell a wall,
      // a car ahead and a step apart without driving again.
      worst = await b.evaluate(WORST);
    }
    const crossed = b.logs.slice(logsFrom).filter((l) => l.includes(`"event":"expressway_building_crossed"`));
    const stalled = b.logs.slice(stallFrom).filter((l) => l.includes(`"event":"expressway_car_stalled"`));
    const invalid = invalidOf(before, summary?.invalid, during);
    const failures = summary
      ? deckDriveFailures(summary, { crossed: crossed.length, stalled: stalled.length, reachedEnd })
      : [];
    return {
      route: r.id,
      kind: r.kind,
      url,
      invalid,
      failures,
      reachedEnd,
      from,
      end,
      summary,
      worst,
      crossed,
      stalled,
      lawEvents: lawEvents(during),
      respawned: during("car_respawned"),
      // The car held for a deck or ground not ready yet (main.ts freezes its body): a stop that is no wall.
      holds: during("vehicle_hold_changed"),
    };
  } finally {
    await release(b);
  }
}

/** Seconds a wall-stop drive goes on after the car stands at the wall (R1-1b 7.3: 5 s). */
const WALL_HOLD_S = 5;

/**
 * A drive into an end wall (R1-1b 7.3): placed as a cruise, then cruising at the posted limit of the
 * wall's chunk, 1.5 times it, or flat out (the cruise over the limit), watching how far past the end
 * the car comes (debug.expressway.cruise endOf), on WALL_HOLD_S after it stands on the end chunk.
 */
async function driveWall(r: WallRoute) {
  const from = chunkAt(files.byRun, r.from);
  if (!from) throw new Error(`${r.id}: no chunk of ${r.from.run} at ${r.from.s} m`);
  const list = files.byRun.get(r.wall) ?? [];
  const endChunk = list.find((c) => c.next === null);
  if (!endChunk) throw new Error(`${r.id}: no end chunk of ${r.wall}`);
  const start = `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`;
  const { b, url, before, logsFrom } = await open(start);
  const driveStart = Date.now();
  try {
    await throttle(b);
    const logsBefore = b.logs.length;
    const during = (event: string) =>
      b.logs.slice(logsBefore).filter((l) => l.includes(`"event":"${event}"`));
    let summary: (WallDriveRide & Record<string, unknown> & { invalid: string | null }) | null = null;
    let worst: unknown = null;
    let kmh: number | null = null;
    const isClear = before === null;
    if (isClear) {
      const until = untilIn(b);
      const place = `__game.debug.expressway.place(${JSON.stringify(from.xid)}, ${from.share}, ${r.lane})`;
      await until(place, 60);
      await b.evaluate("__game.advance(3)");
      await b.evaluate(place);
      await b.evaluate("__game.advance(1)");
      // The posted limit on the wall's chunk (the graph's: its 規制速度, else 60 on the 都市高速).
      const posted = await b.evaluate<number>(
        `(() => { const g = __game.getRoadGraph(); const s = g.segments.find((x) => x.line.xid === ${JSON.stringify(endChunk.id)}); return s?.limit ?? 60; })()`,
      );
      // Flat out: a target no car reaches, held over the limit.
      kmh = r.speed === "posted" ? posted : r.speed === "over" ? posted * 1.5 : 400;
      const overLimit = r.speed !== "posted";
      await b.evaluate(
        `__game.debug.expressway.cruise({ kmh: ${kmh}, prefer: ${JSON.stringify(r.prefer)}, lane: ${r.lane}, endOf: ${JSON.stringify(endChunk.id)}, overLimit: ${overLimit} })`,
      );
      const endXid = JSON.stringify(endChunk.id);
      let stoodFor = 0;
      for (;;) {
        await b.evaluate("__game.advance(1)");
        const last = await b.evaluate<{ t: number; onEnd: boolean; kmh: number } | null>(
          `(() => { const x = __game.debug.expressway.samples().at(-1);
            return x ? { t: x.t, onEnd: x.xid === ${endXid}, kmh: x.kmh } : null; })()`,
        );
        const isStanding = last !== null && last.onEnd && Math.abs(last.kmh) < 1;
        stoodFor = isStanding ? stoodFor + 1 : 0;
        const isDone = stoodFor > WALL_HOLD_S;
        const isOver = (last !== null && last.t > r.seconds) || isPastWall(r, driveStart);
        if (isDone || isOver) break;
      }
      summary = await b.evaluate(`__game.debug.expressway.stop(${JSON.stringify(r.id)})`);
      worst = await b.evaluate(WORST);
    }
    const crossed = b.logs.slice(logsFrom).filter((l) => l.includes(`"event":"expressway_building_crossed"`));
    const uncaught = during("uncaught_error");
    const invalid = invalidOf(before, summary?.invalid, during);
    const failures = summary
      ? wallStopFailures(summary, { crossed: crossed.length, uncaught: uncaught.length })
      : [];
    return {
      route: r.id,
      kind: r.kind,
      url,
      invalid,
      failures,
      from,
      kmh,
      summary,
      worst,
      crossed,
      stalled: [] as string[],
      uncaught,
      lawEvents: lawEvents(during),
      respawned: during("car_respawned"),
      holds: during("vehicle_hold_changed"),
    };
  } finally {
    await release(b);
  }
}

async function driveAuto(r: AutoRoute) {
  const { b, url, before, logsFrom } = await open(r.start);
  const driveStart = Date.now();
  try {
    const logsBefore = b.logs.length;
    let stallFrom = logsBefore;
    const during = (event: string) =>
      b.logs.slice(logsBefore).filter((l) => l.includes(`"event":"${event}"`));
    let summary: (AutoDriveRide & Record<string, unknown> & { invalid: string | null }) | null = null;
    let placed: unknown = null;
    let worst: unknown = null;
    const isClear = before === null;
    if (isClear) {
      // Game time first, by the signals' own clock (TrafficControl.time, s), then the drive as ever.
      // Why not advance(preWaitS): advance counts frames, and at the 50 ms cap a second of frames
      // was 3 s of the game; a 15 s wait moved the 45 s cycle by a whole turn and changed nothing.
      const signalTime = () => b.evaluate<number>("__game.control.time");
      const waitFrom = await signalTime();
      while ((await signalTime()) - waitFrom < preWaitS) await b.evaluate("__game.advance(0.25)");
      // Slowed only from here: the wait is to move the signals on, and under the throttle it took
      // minutes of the run's 25 (a 4x drive with a 30 s wait ran out of time).
      await throttle(b);
      // On the street connector at the foot of the entrance ramp, facing it (P6's drive).
      placed = await b.evaluate(`(() => {
        const G = window.__game; const g = G.getRoadGraph();
        const ramp = g.segments.find((s) => s.line.xid === ${JSON.stringify(`${r.entrance}:0`)});
        const conn = ramp && g.segments.find((s) => !s.line.xid && s.line.source === "osm" && s.to === ramp.from);
        if (!conn) return "no connector";
        const { pos, dir } = g.sample(conn, 1);
        const y = g.surfaceY(conn, 1);
        pos.y = (y ?? G.groundY(pos.x, pos.z)) + 1.0;
        G.vehicle.teleport(pos, Math.atan2(dir.x, dir.z));
        return { conn: Math.round(conn.length) };
      })()`);
      // Off at once: a car standing on the ramp's foot while the page advances (10–13 s of real time
      // for advance(3)) was booked xwStopping (XW_LAW.standS 10 s), which measured the script, not the route.
      stallFrom = b.logs.length;
      const started = await b.evaluate<boolean>(`__game.debug.expressway.route(${JSON.stringify(r.to)})`);
      if (started) {
        for (let t = 0; t < r.seconds && !isPastWall(r, driveStart); t++) {
          await b.evaluate("__game.advance(1)");
          const isDriving = await b.evaluate<boolean>("!!window.__game.getAutopilot()");
          const hasStopped = !isDriving && t > 3;
          if (hasStopped) break;
        }
      }
      summary = await b.evaluate(`__game.debug.expressway.stop(${JSON.stringify(r.id)})`);
      worst = await b.evaluate(WORST);
      if (!started) summary = { ...summary!, arrived: false, gaveUp: "no route", violations: [] };
    }
    const crossed = b.logs.slice(logsFrom).filter((l) => l.includes(`"event":"expressway_building_crossed"`));
    const stalled = b.logs.slice(stallFrom).filter((l) => l.includes(`"event":"expressway_car_stalled"`));
    // The stands the driver logged a reason for (a red light, a queue) are waits, not stalls.
    const traces = b.logs.slice(stallFrom).filter((l) => l.includes(`"event":"autopilot_stop_trace"`));
    const { unexplained, waits } = judgeStalls(
      stalled.map((l) => parseLogged<DeckStall>(l)),
      traces.map((l) => parseLogged<StopTrace>(l)),
    );
    const invalid = invalidOf(before, summary?.invalid, during);
    const failures = summary
      ? autoDriveFailures(summary, { crossed: crossed.length, stalled: unexplained.length, waits })
      : [];
    return {
      route: r.id,
      kind: r.kind,
      url,
      invalid,
      failures,
      waits,
      placed,
      summary,
      worst,
      crossed,
      stalled,
      lawEvents: lawEvents(during),
      respawned: during("car_respawned"),
      // The car held for a deck or ground not ready yet (main.ts freezes its body): a stop that is no wall.
      holds: during("vehicle_hold_changed"),
    };
  } finally {
    await release(b);
  }
}

/**
 * The samples round the worst drop under the target and the worst |dy| (±2 s, with dy's sign), and
 * every sudden drop the hook saw (debug.expressway.drops: what was touched, the traffic near, the
 * graph / collider swaps), to tell a wall, a car ahead and a step apart without driving again.
 */
const WORST = `(() => {
  const xs = __game.debug.expressway.samples();
  const near = (i) => xs.slice(Math.max(0, i - 40), i + 40).filter((_, j) => j % 4 === 0)
    .map((x) => ({ t: +x.t.toFixed(2), xid: x.xid, kmh: Math.round(x.kmh), target: Math.round(x.target), dy: +x.dy.toFixed(3), off: +x.off.toFixed(2), vy: +x.vy.toFixed(2), at: +x.at.toFixed(2), len: +x.len.toFixed(2) }));
  let a = 0, d = -1;
  xs.forEach((x, i) => {
    const isShorter = x.target - x.kmh > xs[a].target - xs[a].kmh;
    if (isShorter) a = i;
    const isDeck = x.xid !== null && Number.isFinite(x.dy);
    const isWorse = d < 0 || Math.abs(x.dy) > Math.abs(xs[d].dy);
    if (isDeck && isWorse) d = i;
  });
  return xs.length === 0 ? null : { shortfall: near(a), dy: d < 0 ? [] : near(d), drops: __game.debug.expressway.drops() };
})()`;

const lawEvents = (during: (e: string) => string[]) => ({
  accident: during("accident"),
  vehicleBump: during("vehicle_bump"),
  violationCited: during("violation_cited"),
  arrest: during("story_begin").filter((l) => l.includes(`"kind":"arrest"`)),
  // Why the autopilot stood, moved off or crashed (main.ts autopilot_stop_trace).
  stopTraces: during("autopilot_stop_trace"),
});

let exit = 0;
/** When this run began (ms): --budget-min counts real time spent, not the estimate. */
const runStart = Date.now();
/**
 * A table's route already driven for the same data and route, and counted (--resume): an invalid
 * result (an accident, an arrest, a try that threw) is driven again in a later bundle.
 */
const isDoneBefore = (r: DeckRoute) => {
  const file = join(tableDir!, `${r.id}.json`);
  const isThere = existsSync(file);
  if (!isThere) return false;
  const prev = JSON.parse(readFileSync(file, "utf8")) as {
    served?: ServedData;
    routeDef?: unknown;
    invalid?: string | null;
  };
  const isSameData =
    prev.served?.tilesSha256 === served.tilesSha256 && prev.served?.metaSha256 === served.metaSha256;
  const isCounted = prev.invalid === null;
  return isSameData && isCounted && JSON.stringify(prev.routeDef) === JSON.stringify(r);
};
for (const r of routes) {
  const isSkipped = isTable && isResume && isDoneBefore(r);
  if (isSkipped) continue;
  // The bundle ends before the next route could pass the budget at worst: its whole time limit on
  // every try, a page opened again, over the real time spent so far. Why not the estimate (as
  // first): an autopilot route that did not arrive ran its 600 s on each of 3 tries, and the bundle
  // passed the 25 min lock (the trial b5-a, 2026-11-28); an autopilot route's limit counts
  // advance(1) calls, about 2.9 s each (routeBundles.ts WALL_PER_ADVANCE_S).
  // `kept` is set inside open() (the flow analysis reads it as null here).
  const page = kept as { routes: number } | null;
  const isNewPage = page === null || page.routes >= REOPEN_EVERY;
  const worstS = routeWorstSeconds(r) * triesOf + (isNewPage ? OPEN_S : 0);
  const spentS = (Date.now() - runStart) / 1000;
  const isOverBudget = budgetMin !== null && spentS > 0 && spentS + worstS > budgetMin * 60;
  if (isOverBudget) {
    process.stdout.write(
      `${JSON.stringify({ label, bundleEnd: true, spentS: Math.round(spentS), next: r.id })}\n`,
    );
    break;
  }
  /**
   * Every try, the invalid ones too: what each saw of the law and of the stops. Why not keep the
   * counted try's alone (as before): a try made invalid by the autopilot's own accident was
   * replaced by the next, and the accident was hidden behind the retry (D1, 汐留出口).
   */
  const attempts: Array<{
    invalid: string | null;
    failures: string[];
    stalled: string[];
    lawEvents: unknown;
  }> = [];
  /** One try's result (a drive's, or an invalid placeholder for a try that threw). */
  type TryResult = {
    invalid: string | null;
    failures: string[];
    summary: unknown;
    worst: unknown;
    crossed: string[];
    stalled: string[];
    holds: string[];
    [field: string]: unknown;
  };
  let result: TryResult | null = null;
  for (let i = 0; i < triesOf; i++) {
    // A try that throws (the page never settles or never answers: the buildings' tileset failed to
    // fetch, a flaky network) does not count, like an accident: invalid with the reason, and driven
    // again. Its browser is closed by the drive's own finally. Why not fail the route: nothing of the
    // decks was measured.
    const drive = r.kind === "cruise" ? driveCruise(r) : r.kind === "wall" ? driveWall(r) : driveAuto(r);
    result = await drive.catch(async (error: unknown): Promise<TryResult> => {
      // A table's kept page may be stuck: the next try opens a new one.
      await closeKept();
      return {
        route: r.id,
        kind: r.kind,
        url: "",
        invalid: `error: ${String(error)}`,
        failures: [] as string[],
        summary: null,
        worst: null,
        crossed: [] as string[],
        stalled: [] as string[],
        lawEvents: { accident: [], violationCited: [], arrest: [] },
        respawned: [] as string[],
        holds: [] as string[],
      };
    });
    attempts.push({
      invalid: result.invalid,
      failures: result.failures,
      stalled: result.stalled,
      lawEvents: result.lawEvents,
    });
    const counts = result.invalid === null;
    if (counts) break;
  }
  const out = {
    label,
    served,
    cpuThrottle,
    preWaitS,
    ...(isTable ? { routeDef: r } : {}),
    ...result!,
    attempts,
  };
  const file = tableDir
    ? join(tableDir, `${r.id}.json`)
    : outDir
      ? join(outDir, `${r.id}.json`)
      : join(ROOT, ".qa", routeArg === "" ? `drive-deck-${label}.json` : `drive-deck-${label}-${r.id}.json`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  const s = out.summary as Record<string, unknown> | null;
  process.stdout.write(
    `${JSON.stringify({
      label,
      route: r.id,
      invalid: out.invalid,
      tries: attempts.length,
      failures: out.failures,
      distanceM: s?.distanceM,
      maxAbsDyM: s?.maxAbsDyM,
      maxDyAt: s?.maxDyAt,
      maxAbsVyMs: s?.maxAbsVyMs,
      rmsAyMs2: s?.rmsAyMs2,
      maxShortfallKmh: s?.maxShortfallKmh,
      maxShortfallAt: s?.maxShortfallAt,
      wall: s?.wall,
      arrived: s?.arrived,
      violations: s?.violations,
      crossed: out.crossed.length,
      stalled: out.stalled.length,
      holds: out.holds.length,
      drops: (out.worst as { drops?: unknown[] } | null)?.drops?.length ?? null,
    })}\n`,
  );
  // 2: the run does not count (invalid), whatever it measured; 1: the decks failed the drive.
  const isFailed = out.failures.length > 0;
  const isInvalid = out.invalid !== null;
  if (isInvalid) exit = Math.max(exit, 2);
  else if (isFailed) exit = Math.max(exit, 1);
}
await closeKept();
// Ends here even if a child is still running (browser.mjs's reaper kills its Chromes at the exit).
// Why not only set process.exitCode (as before): a child left running kept the process alive after
// its results were written, and a lane of drives waited on it for good. process.exit can cut a long
// stdout into a pipe short (128 KiB seen); here it is one line per route, and the results are files.
process.exit(exit);

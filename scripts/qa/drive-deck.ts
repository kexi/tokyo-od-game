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
// Why the exit ramp and not on along 内回り (P3's route): past 24402611:30 the main line goes down to
// the ground end of the loaded data (築地川's cut is not in it), where the decks leave 汐留出口's
// 壁高欄 standing in 内回り's lane 0 by design (SHIODOME_REASON, knowledge/expressway-generation.md);
// the route and the traffic AI do not go there, so the check's car should not either.
//
//   just check-deck-drive [label] [route] (the dev server: just serve-dev; route all drives every one)
//   pnpm exec tsx scripts/qa/drive-deck.ts [--label L] [--route R|all] [--base URL] [--out DIR] [--tries N]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readExpresswayFiles } from "../expresswayFiles.ts";
import { launch } from "./browser.mjs";
import {
  autoDriveFailures,
  type AutoDriveRide,
  deckDriveFailures,
  type DeckDriveRide,
} from "./deckDriveVerdict.ts";
import {
  type AutoRoute,
  chunkAt,
  type CruiseRoute,
  DECK_ROUTES,
  DEFAULT_ROUTE,
  type DeckRoute,
  routeOf,
} from "./deckRoutes.ts";
import { freePort } from "./ports.ts";

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
const routes: DeckRoute[] =
  routeArg === "all" ? [...DECK_ROUTES] : [routeOf(routeArg === "" ? DEFAULT_ROUTE : routeArg)];
/** The data the dev server serves (XW_DATA_DIR else public/data/expressway): where a run distance lies. */
const files = readExpresswayFiles();

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

/** Open the game at `start`, start it, let it settle, wait out whatever would make the drive invalid. */
async function open(start: string): Promise<{ b: Browser; url: string; before: string | null }> {
  const url = `${base}?start=${start}&time=day&weather=clear&seed=20261110&expressway`;
  const b = await launch(url, { width: 960, height: 540, port: await freePort() });
  const until = untilIn(b);
  await until("window.__game?.getState() === 'ready'");
  await b.evaluate("window.__game.start()");
  await until("__game.debug.settled().isSettled", 150);
  await b.sleep(3000);
  // Nothing in the way first (an accident, a pursuit: an arrest would freeze the car mid-drive and
  // the run would measure the arrest, not the decks; knowledge/road-textures.md「止まる件」).
  let before: string | null = null;
  for (let i = 0; i < 30; i++) {
    before = await b.evaluate<string | null>("__game.debug.expressway.blocker()");
    const isClear = before === null;
    if (isClear) break;
    await b.sleep(1000);
  }
  return { b, url, before };
}

/** Why the drive does not count, from the logs since it began, or null. */
function invalidOf(
  before: string | null,
  blocked: string | null | undefined,
  during: (e: string) => string[],
) {
  const wasBlocked = before !== null;
  if (wasBlocked) return `blocked before the drive: ${before}`;
  if (blocked) return `blocked: ${blocked}`;
  const hadAccident = during("accident").length > 0;
  if (hadAccident) return "accident during the drive";
  const wasCited = during("violation_cited").length > 0;
  if (wasCited) return "violation cited during the drive";
  const isArrested = during("story_begin").some((l) => l.includes(`"kind":"arrest"`));
  if (isArrested) return "arrest during the drive";
  return null;
}

async function driveCruise(r: CruiseRoute) {
  const from = chunkAt(files.byRun, r.from);
  if (!from) throw new Error(`${r.id}: no chunk of ${r.from.run} at ${r.from.s} m`);
  const end = "street" in r.to ? null : chunkAt(files.byRun, r.to);
  const isEndMissing = !("street" in r.to) && end === null;
  if (isEndMissing) throw new Error(`${r.id}: no chunk at its end`);
  const start = `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`;
  const { b, url, before } = await open(start);
  try {
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
      const place = `__game.debug.expressway.place(${JSON.stringify(from.xid)}, ${from.share}, 0)`;
      await until(place, 60);
      // Again once the colliders round the new spot are built (the first may fall short of them, P7).
      await b.evaluate("__game.advance(3)");
      await b.evaluate(place);
      await b.evaluate("__game.advance(1)");
      // The stall check from here on: the car stood placed for the colliders above, by design.
      stallFrom = b.logs.length;
      await b.evaluate(
        `__game.debug.expressway.cruise({ kmh: ${r.kmh}, prefer: ${JSON.stringify(r.prefer)} })`,
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
        const isOver = last !== null && last.t > r.seconds;
        if (reachedEnd || isOver) break;
      }
      summary = await b.evaluate(`__game.debug.expressway.stop(${JSON.stringify(r.id)})`);
      // The samples round the worst drop under the target and the worst |dy| (±2 s), to tell a wall,
      // a car ahead and a step apart without driving again.
      worst = await b.evaluate(WORST);
    }
    const crossed = b.logs.filter((l) => l.includes(`"event":"expressway_building_crossed"`));
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
    await b.close();
  }
}

async function driveAuto(r: AutoRoute) {
  const { b, url, before } = await open(r.start);
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
        for (let t = 0; t < r.seconds; t++) {
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
    const crossed = b.logs.filter((l) => l.includes(`"event":"expressway_building_crossed"`));
    const stalled = b.logs.slice(stallFrom).filter((l) => l.includes(`"event":"expressway_car_stalled"`));
    const invalid = invalidOf(before, summary?.invalid, during);
    const failures = summary
      ? autoDriveFailures(summary, { crossed: crossed.length, stalled: stalled.length })
      : [];
    return {
      route: r.id,
      kind: r.kind,
      url,
      invalid,
      failures,
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
    await b.close();
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
  violationCited: during("violation_cited"),
  arrest: during("story_begin").filter((l) => l.includes(`"kind":"arrest"`)),
});

let exit = 0;
for (const r of routes) {
  const attempts: Array<{ invalid: string | null }> = [];
  let result: Awaited<ReturnType<typeof driveCruise>> | Awaited<ReturnType<typeof driveAuto>> | null = null;
  for (let i = 0; i < tries; i++) {
    result = r.kind === "cruise" ? await driveCruise(r) : await driveAuto(r);
    attempts.push({ invalid: result.invalid });
    const counts = result.invalid === null;
    if (counts) break;
  }
  const out = { label, ...result!, attempts };
  const file = outDir
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
process.exitCode = exit;

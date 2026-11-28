// The street drive (P2.7 R1-5 PR A, S6 PR 7c's「走行に足す確認」 lifted from .qa/street-drive.mts): at
// each place of a street places table (streetPlaces.ts) the car is put in the lane of the street
// nearest it (debug.expressway.placeOnStreet: the left half of a two-way street, the middle of a
// one-way one), 40 m before it, and driven on the game's autopilot to 40 m past it, sampled every
// 0.25 s of game time, and judged by streetDriveVerdict.ts (arrived, on the street's band, no fall,
// no building, no stall, no respawn). A drive whose every failure lies, point by point, in a case of
// the probes' lists (--site-lanes: check-expressway-lanes --cases, --hole-lanes: check-hole-lanes
// --cases) is `known`, counted apart. A try with an accident, a citation or an arrest is invalid
// (driveInvalid.ts, as drive-deck.ts) and driven again, up to --tries (3).
//
// One JSON file per place in .qa/street-drive-<label>/<id>.json (or --out <dir>), and the run's
// summary.json beside them. A place whose file was driven against the same served data, case lists
// and baseline (streetResults.ts) is skipped (resume); any other is driven again. An invalid result
// is kept too: delete its file to drive it again. The data is the folder the dev server serves,
// checked first (servedData.ts, meta.json and every tile): XW_DATA_DIR, else public/data/expressway,
// for both.
//
//   just check-street-drive [label] [ids] [base] [flags]   (the dev server: just serve-dev)
//   pnpm exec tsx scripts/qa/street-drive.ts [--label L] [--base URL] [--only a,b] [--out DIR]
//     [--tries N] [--site-lanes FILE] [--hole-lanes FILE] [--baseline DIR]
//
// --baseline DIR: main's results (this tool's folder from main's checkout driven on main's data; only
// the results of the run its summary.json names, streetResults.ts readMainResults). A
// failure is `known-main` when every kind of it is one main failed with at that place
// (streetDriveVerdict.ts againstMain): S7-6's line is "no failure main's result does not have".
//
// Exit 1 a place failed, 2 one stayed invalid, 5 a place of the table has no result of this run
// (driven in parts, or other data), 3 a known failure, 4 only known-main ones, else 0; 6 the
// baseline was refused (no summary: main not driven there or stopped midway, no key, no kinds).
// The served data's check (servedData.ts) stops with 1 too, before any drive, as drive-deck.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HoleLanes } from "../expresswayCases.ts";
import { readExpresswayFiles } from "../expresswayFiles.ts";
import type { SiteLanes } from "../expresswaySiteLanes.ts";
import { launch } from "./browser.mjs";
import { invalidOf } from "./driveInvalid.ts";
import { freePort } from "./ports.ts";
import { checkServedData } from "./servedData.ts";
import {
  exitCodeOf,
  judgeStreetDrive,
  type LatLon,
  RIDE_BAND,
  type StreetDriveRide,
  type StreetDriveTry,
} from "./streetDriveVerdict.ts";
import { knownCasesFrom, projectOnRun } from "./streetKnown.ts";
import { placeLatLon, placesOf, STREET_PLACES, type StreetPlace } from "./streetPlaces.ts";
import {
  fileSha256,
  isReusable,
  pointsOf,
  readMainResults,
  type ResultKey,
  summarize,
} from "./streetResults.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const only = flag("only");
const outDir = flag("out") ?? join(ROOT, ".qa", `street-drive-${label}`);
const tries = Number(flag("tries") ?? 3);
const siteLanes = flag("site-lanes");
const holeLanes = flag("hole-lanes");
/** main's results (a folder of this tool's <id>.json from main's checkout on main's data), or none. */
const baselineDir = flag("baseline");
const readList = <T>(file: string | undefined): T[] =>
  file === undefined ? [] : (JSON.parse(readFileSync(file, "utf8")) as T[]);

/** How far before and past the place the drive starts and ends (m; 7c's street drive). */
const LEAD_M = 40;
/** The street nearest the place within this (m; 7c's street drive, and placeOnStreet's own). */
const NEAREST_M = 30;
/** Samples of 0.25 s at most (60 s of game time for 80 m; 7c's street drive). */
const MAX_STEPS = 240;
/** Steps before the autopilot's end ends the drive (3 s: it may take a moment to begin; 7c's). */
const MIN_STEPS = 12;
const STEP_S = 0.25;

const files = readExpresswayFiles();
/** The dev server serves the same data (servedData.ts): else nothing is driven. */
const served = await checkServedData(base);
/**
 * main's results of its summary's run (streetResults.ts), or none without --baseline. A baseline the
 * tool cannot read stops the run with exit code 6 (BASELINE_REFUSED), apart from a failure's 1.
 */
const BASELINE_REFUSED = 6;
function refusing<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ label, baselineRefused: String(error) })}\n`);
    process.exit(BASELINE_REFUSED);
  }
}
// main's results read from a folder of a label other than main-…: worth a look (it may be a branch's).
const isOddBaseline =
  baselineDir !== undefined && !/(^|[/\\])street-drive-main-[^/\\]*\/?$/.test(baselineDir);
if (isOddBaseline)
  process.stdout.write(
    `${JSON.stringify({ label, baselineWarning: "the baseline folder is not .qa/street-drive-main-<label>", baselineDir })}\n`,
  );
const mainResults = baselineDir === undefined ? null : refusing(() => readMainResults(baselineDir));
const key: ResultKey = {
  metaSha256: served.metaSha256,
  tilesSha256: served.tilesSha256,
  siteLanes: fileSha256(siteLanes),
  holeLanes: fileSha256(holeLanes),
  baseline: mainResults?.sha256 ?? null,
};
const cases = knownCasesFrom(readList<SiteLanes>(siteLanes), readList<HoleLanes>(holeLanes), files.byRun);
const project = (run: string, lat: number, lon: number) => projectOnRun(files.byRun, run, lat, lon);
const places = placesOf(STREET_PLACES, only === undefined ? null : only.split(","));

type Browser = Awaited<ReturnType<typeof launch>>;

const untilIn =
  (b: Browser) =>
  async <T>(expr: string, waits = 180): Promise<T> => {
    for (let i = 0; i < waits; i++) {
      const v = await b.evaluate<T>(expr).catch(() => null);
      if (v) return v;
      await b.sleep(1000);
    }
    throw new Error(`timeout: ${expr}`);
  };

/** What one try saw (or why it could not drive). */
type Try = StreetDriveTry & {
  placed?: unknown;
  over?: { min: number; max: number };
  /**
   * What the autopilot said of its drive (debug.expressway.stop): its own arrival (within the hook's
   * ARRIVED_M 80 m, not this check's), why it gave up, the game seconds and metres driven. Kept to tell
   * a drive the autopilot ended short from one stuck to the 60 s cap without driving again.
   */
  autopilot?: {
    arrived: boolean | null;
    gaveUp: string | null;
    seconds: number | null;
    distanceM: number | null;
  };
  lawEvents?: Record<string, string[]>;
};

async function drive(p: StreetPlace, at: LatLon): Promise<Try> {
  const start = `${at.lat.toFixed(5)},${at.lon.toFixed(5)}`;
  const url = `${base}?start=${start}&time=day&weather=clear&seed=20261110&expressway`;
  const b = await launch(url, { width: 960, height: 540, port: await freePort() });
  try {
    const until = untilIn(b);
    await until("window.__game?.getState() === 'ready'");
    await b.evaluate("window.__game.start()");
    await until("__game.debug.settled().isSettled", 150);
    await b.sleep(3000);
    // Nothing in the way first (an accident, a pursuit), as drive-deck.ts.
    let before: string | null = null;
    for (let i = 0; i < 30; i++) {
      before = await b.evaluate<string | null>("__game.debug.expressway.blocker()");
      const isClear = before === null;
      if (isClear) break;
      await b.sleep(1000);
    }
    const logsBefore = b.logs.length;
    const during = (e: string) => b.logs.slice(logsBefore).filter((l) => l.includes(`"event":"${e}"`));
    const wasBlocked = before !== null;
    if (wasBlocked) return { invalid: invalidOf(before, null, during) };
    const placed = await b.evaluate<{ error?: string; to: LatLon }>(`(() => {
      const G = window.__game; const g = G.getRoadGraph(); const f = G.getFrame();
      const P = f.toLocal(${at.lat}, ${at.lon}, f.origin.h);
      const hit = g.nearest(P, ${NEAREST_M}, (s) => !s.line.xid);
      if (!hit) return { error: "no street within ${NEAREST_M} m" };
      const d = hit.dir.clone().setY(0).normalize();
      for (const sign of [1, -1]) {
        const A = f.toGeodetic(P.clone().addScaledVector(d, -${LEAD_M} * sign));
        const B = f.toGeodetic(P.clone().addScaledVector(d, ${LEAD_M} * sign));
        const put = G.debug.expressway.placeOnStreet({ lat: A.lat, lon: A.lon }, { lat: B.lat, lon: B.lon });
        if (put) {
          window.__streetCheck = { minOver: Infinity, maxOver: -Infinity, n: 0, below: [], above: [] };
          return { ...put, kind: hit.seg.line.kind, to: { lat: B.lat, lon: B.lon } };
        }
      }
      return { error: "no lane to put the car in (one-way against both ways?)" };
    })()`);
    const isUnplaced = placed.error !== undefined;
    if (isUnplaced) return { invalid: null, error: { kind: "unplaced", text: placed.error! }, placed };
    const started = await b.evaluate<boolean>(`__game.debug.expressway.route(${JSON.stringify(placed.to)})`);
    const steps = started ? MAX_STEPS : 0;
    for (let t = 0; t < steps; t++) {
      await b.evaluate(`__game.advance(${STEP_S})`);
      // Every sample off the band, with where it was (the frame's now: it moves with the car).
      await b.evaluate(`(() => { const G = window.__game; const p = G.vehicle.position(); const o = p.y - G.groundY(p.x, p.z);
        const s = window.__streetCheck; s.minOver = Math.min(s.minOver, o); s.maxOver = Math.max(s.maxOver, o); s.n++;
        const isBelow = o < ${RIDE_BAND[0]}; const isAbove = o > ${RIDE_BAND[1]};
        if (!isBelow && !isAbove) return;
        const g = G.getFrame().toGeodetic(p); (isBelow ? s.below : s.above).push({ lat: g.lat, lon: g.lon }); })()`);
      const isDriving = await b.evaluate<boolean>("!!window.__game.getAutopilot()");
      const hasEnded = !isDriving && t > MIN_STEPS;
      if (hasEnded) break;
    }
    const summary = await b.evaluate<{
      fell?: boolean;
      invalid?: string | null;
      arrived?: boolean;
      gaveUp?: string | null;
      seconds?: number;
      distanceM?: number;
    }>(`__game.debug.expressway.stop(${JSON.stringify(p.id)})`);
    const end = await b.evaluate<{ endM: number; lat: number; lon: number }>(`(() => {
      const G = window.__game; const f = G.getFrame(); const p = G.vehicle.position();
      const T = f.toLocal(${placed.to.lat}, ${placed.to.lon}, f.origin.h); const g = f.toGeodetic(p);
      return { endM: Math.hypot(p.x - T.x, p.z - T.z), lat: g.lat, lon: g.lon }; })()`);
    const check = await b.evaluate<{
      minOver: number;
      maxOver: number;
      n: number;
      below: LatLon[];
      above: LatLon[];
    }>("window.__streetCheck");
    const ride: StreetDriveRide = {
      started,
      endM: end.endM,
      fell: summary?.fell === true,
      samples: check.n,
      below: check.below,
      above: check.above,
      crossed: pointsOf(during("expressway_building_crossed")),
      stalled: pointsOf(during("expressway_car_stalled")),
      respawned: pointsOf(during("car_respawned")),
      end: { lat: end.lat, lon: end.lon },
    };
    return {
      invalid: invalidOf(null, summary?.invalid, during),
      placed,
      ride,
      over: { min: Math.round(check.minOver * 100) / 100, max: Math.round(check.maxOver * 100) / 100 },
      autopilot: {
        arrived: summary?.arrived ?? null,
        gaveUp: summary?.gaveUp ?? null,
        seconds: summary?.seconds ?? null,
        distanceM: summary?.distanceM ?? null,
      },
      lawEvents: {
        accident: during("accident"),
        vehicleBump: during("vehicle_bump"),
        violationCited: during("violation_cited"),
      },
    };
  } finally {
    await b.close();
  }
}

/** A JSON file's content, or null when it is not there. */
const readIfThere = <T>(file: string): T | null =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;

mkdirSync(outDir, { recursive: true });
// No summary while the run is on: a run stopped midway (the 25 min lock, Ctrl-C) leaves none, so a
// branch reading this folder as its baseline is refused rather than reading the older run's results
// that were not driven again yet (PR #133 review o1).
rmSync(join(outDir, "summary.json"), { force: true });
for (const p of places) {
  const file = join(outDir, `${p.id}.json`);
  const isDone = isReusable(readIfThere<{ key?: ResultKey }>(file), key);
  if (isDone) continue;
  const at = placeLatLon(files.byRun, p.at);
  const isNowhere = at === null;
  const attempts: Try[] = [];
  let last: Try = isNowhere
    ? {
        invalid: null,
        error: { kind: "no-run", text: `no run ${"run" in p.at ? p.at.run : "?"} in the data` },
      }
    : { invalid: "not driven" };
  const tryCount = isNowhere ? 0 : tries;
  for (let i = 0; i < tryCount; i++) {
    // A try that throws (the page never settles) does not count, as in drive-deck.ts.
    last = await drive(p, at!).catch((error: unknown): Try => ({ invalid: `error: ${String(error)}` }));
    attempts.push(last);
    const counts = last.invalid === null;
    if (counts) break;
  }
  const main = mainResults?.byPlace.get(p.id) ?? null;
  const judged = judgeStreetDrive(last, cases, project, main);
  const out = {
    label,
    key,
    served,
    place: p,
    at,
    ...judged,
    main:
      main === null
        ? null
        : { dir: baselineDir, verdict: main.verdict, kinds: main.kinds, served: main.served },
    ...last,
    attempts: attempts.length,
    tries: attempts,
  };
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  const endM = last.ride ? Math.round(last.ride.endM * 10) / 10 : null;
  process.stdout.write(
    `${JSON.stringify({ label, place: p.id, verdict: judged.verdict, kinds: judged.kinds, known: judged.known, endM, over: last.over, tries: attempts.length })}\n`,
  );
}

// The run's summary over the folder's results of this run (the ones driven before a resume too).
const results = readdirSync(outDir)
  .filter((f) => f.endsWith(".json") && f !== "summary.json")
  .map((f) => JSON.parse(readFileSync(join(outDir, f), "utf8")) as Parameters<typeof summarize>[0][number]);
const summary = {
  label,
  served,
  key,
  ...summarize(
    results,
    STREET_PLACES.map((p) => p.id),
    key,
  ),
};
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...summary, pass: summary.pass.length })}\n`);
// Ends here even if a child is still running (browser.mjs's reaper kills its Chromes at the exit), as
// drive-deck.ts.
process.exit(exitCodeOf(summary));

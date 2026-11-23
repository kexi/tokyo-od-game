// The street drive (P2.7 R1-5 PR A, S6 PR 7c's「走行に足す確認」 lifted from .qa/street-drive.mts): at
// each place of a street places table (streetPlaces.ts) the car is put in the lane of the street
// nearest it (debug.expressway.placeOnStreet: the left half of a two-way street, the middle of a
// one-way one), 40 m before it, and driven on the game's autopilot to 40 m past it, sampled every
// 0.25 s of game time, and judged by streetDriveVerdict.ts (arrived, on the street's band, no fall,
// no building, no stall, no respawn). A failure whose every fault point lies in a case of the probes'
// lists (--site-lanes: check-expressway-lanes --cases, --hole-lanes: check-hole-lanes --cases) is
// `known`, counted apart. A try with an accident, a citation or an arrest is invalid (driveInvalid.ts,
// as drive-deck.ts) and driven again, up to --tries (3).
//
// One JSON file per place in .qa/street-drive-<label>/<id>.json (or --out <dir>), and the run's
// summary.json beside them. A place whose file is there is skipped (resume: delete the file to drive it
// again). The data is the folder the dev server serves, checked first (servedData.ts): XW_DATA_DIR,
// else public/data/expressway, for both.
//
//   just check-street-drive [label] [ids] [base] [flags]   (the dev server: just serve-dev)
//   pnpm exec tsx scripts/qa/street-drive.ts [--label L] [--base URL] [--only a,b] [--out DIR]
//     [--tries N] [--site-lanes FILE] [--hole-lanes FILE] [--baseline DIR]
//
// --baseline DIR: main's results of the same places on the same data (this tool's folder). A failure
// where main failed too is `known-main` (streetDriveVerdict.ts againstMain): S7-6's line is "no
// failure main does not have".
//
// Exit 1 when a place failed, 2 when none failed but one stayed invalid, 3 when the only failures are
// known or known-main, else 0.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HoleLanes } from "../expresswayCases.ts";
import { readExpresswayFiles } from "../expresswayFiles.ts";
import type { SiteLanes } from "../expresswaySiteLanes.ts";
import { launch } from "./browser.mjs";
import { parseLogged } from "./deckStops.ts";
import { invalidOf } from "./driveInvalid.ts";
import { freePort } from "./ports.ts";
import { checkServedData } from "./servedData.ts";
import {
  againstMain,
  ARRIVE_M,
  knownCasesOf,
  RIDE_BAND,
  type StreetDriveRide,
  streetDriveFailures,
  type StreetFault,
  streetVerdict,
} from "./streetDriveVerdict.ts";
import { knownCasesFrom, projectOnRun } from "./streetKnown.ts";
import { placeLatLon, placesOf, STREET_PLACES, type StreetPlace } from "./streetPlaces.ts";

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
/** main's results of the same places on the same data (a folder of this tool's <id>.json), or none. */
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
const cases = knownCasesFrom(
  readList<SiteLanes>(flag("site-lanes")),
  readList<HoleLanes>(flag("hole-lanes")),
  files.byRun,
);
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
type Try = {
  invalid: string | null;
  error?: string;
  placed?: unknown;
  ride?: StreetDriveRide;
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
  faults: StreetFault[];
  lawEvents?: Record<string, string[]>;
};

async function drive(p: StreetPlace, at: { lat: number; lon: number }): Promise<Try> {
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
    if (wasBlocked) return { invalid: invalidOf(before, null, during), faults: [] };
    const placed = await b.evaluate<{ error?: string; to: { lat: number; lon: number } }>(`(() => {
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
          window.__streetCheck = { minOver: Infinity, maxOver: -Infinity, n: 0, below: 0, above: 0, first: null };
          return { ...put, kind: hit.seg.line.kind, to: { lat: B.lat, lon: B.lon } };
        }
      }
      return { error: "no lane to put the car in (one-way against both ways?)" };
    })()`);
    const isUnplaced = placed.error !== undefined;
    if (isUnplaced) return { invalid: null, error: placed.error, placed, faults: [] };
    const started = await b.evaluate<boolean>(`__game.debug.expressway.route(${JSON.stringify(placed.to)})`);
    const steps = started ? MAX_STEPS : 0;
    for (let t = 0; t < steps; t++) {
      await b.evaluate(`__game.advance(${STEP_S})`);
      // The first sample off the band, with where it was (the frame's now: it moves with the car).
      await b.evaluate(`(() => { const G = window.__game; const p = G.vehicle.position(); const o = p.y - G.groundY(p.x, p.z);
        const s = window.__streetCheck; s.minOver = Math.min(s.minOver, o); s.maxOver = Math.max(s.maxOver, o); s.n++;
        const isBelow = o < ${RIDE_BAND[0]}; const isAbove = o > ${RIDE_BAND[1]};
        if (isBelow) s.below++; if (isAbove) s.above++;
        if ((isBelow || isAbove) && s.first === null) { const g = G.getFrame().toGeodetic(p); s.first = { what: isBelow ? "under the band" : "over the band", lat: g.lat, lon: g.lon }; } })()`);
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
      below: number;
      above: number;
      first: StreetFault | null;
    }>("window.__streetCheck");
    const respawned = during("car_respawned");
    const ride: StreetDriveRide = {
      started,
      endM: Math.round(end.endM * 10) / 10,
      fell: summary?.fell === true,
      over: { n: check.n, below: check.below, above: check.above },
      crossed: during("expressway_building_crossed").length,
      stalled: during("expressway_car_stalled").length,
      respawned: respawned.length,
    };
    const faults: StreetFault[] = [];
    if (check.first) faults.push(check.first);
    for (const l of respawned) {
      const r = parseLogged<{ lat: number; lon: number; reason: string }>(l);
      faults.push({ what: `respawned (${r.reason})`, lat: r.lat, lon: r.lon });
    }
    const isShort = ride.endM > ARRIVE_M;
    if (isShort && started) faults.push({ what: "stopped short", lat: end.lat, lon: end.lon });
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
      faults,
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

mkdirSync(outDir, { recursive: true });
let exit = 0;
for (const p of places) {
  const file = join(outDir, `${p.id}.json`);
  const isDone = existsSync(file);
  if (isDone) continue;
  const at = placeLatLon(files.byRun, p.at);
  const attempts: Try[] = [];
  const isNowhere = at === null;
  let last: Try = isNowhere
    ? { invalid: null, error: `no run ${"run" in p.at ? p.at.run : "?"} in the data`, faults: [] }
    : { invalid: "not driven", faults: [] };
  const tryCount = isNowhere ? 0 : tries;
  for (let i = 0; i < tryCount; i++) {
    // A try that throws (the page never settles) does not count, as in drive-deck.ts.
    last = await drive(p, at!).catch((error: unknown): Try => ({
      invalid: `error: ${String(error)}`,
      faults: [],
    }));
    attempts.push(last);
    const counts = last.invalid === null;
    if (counts) break;
  }
  const hasError = last.error !== undefined;
  const failures = hasError ? [last.error!] : last.ride ? streetDriveFailures(last.ride) : [];
  const known = knownCasesOf(last.faults, cases, (run, lat, lon) => projectOnRun(files.byRun, run, lat, lon));
  const isInvalid = last.invalid !== null;
  const mainFile = baselineDir === undefined ? null : join(baselineDir, `${p.id}.json`);
  const hasMain = mainFile !== null && existsSync(mainFile);
  const main = hasMain
    ? (JSON.parse(readFileSync(mainFile!, "utf8")) as { verdict: string; failures: string[] })
    : null;
  const verdict = isInvalid ? "invalid" : againstMain(streetVerdict(failures, known), main?.verdict ?? null);
  const out = {
    label,
    served,
    place: p,
    at,
    verdict,
    failures,
    known,
    main: main === null ? null : { dir: baselineDir, verdict: main.verdict, failures: main.failures },
    ...last,
    attempts: attempts.length,
    tries: attempts,
  };
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ label, place: p.id, verdict, failures, known, endM: last.ride?.endM, over: last.over, tries: attempts.length })}\n`,
  );
}

// The run's summary over every place's file in the folder (the ones driven before a resume too).
const results = readdirSync(outDir)
  .filter((f) => f.endsWith(".json") && f !== "summary.json")
  .map(
    (f) => JSON.parse(readFileSync(join(outDir, f), "utf8")) as { place: { id: string }; verdict: string },
  );
const ids = (v: string) =>
  results
    .filter((r) => r.verdict === v)
    .map((r) => r.place.id)
    .toSorted();
const summary = {
  label,
  served,
  places: results.length,
  pass: ids("pass"),
  fail: ids("fail"),
  known: ids("known"),
  knownMain: ids("known-main"),
  invalid: ids("invalid"),
};
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...summary, pass: summary.pass.length })}\n`);
const hasFail = summary.fail.length > 0;
const hasInvalid = summary.invalid.length > 0;
const hasKnown = summary.known.length + summary.knownMain.length > 0;
if (hasFail) exit = 1;
else if (hasInvalid) exit = 2;
else if (hasKnown) exit = 3;
// Ends here even if a child is still running (browser.mjs's reaper kills its Chromes at the exit), as
// drive-deck.ts.
process.exit(exit);

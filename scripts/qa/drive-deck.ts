// Drives the P3 route over the expressway decks (entrance ramp 207111988 → C1 内回り 24402611 → the
// 汐留出口 ramp 24402125 down to the street) with the dev hook (window.__game.debug.expressway.cruise)
// and counts what the decks still get wrong: PLATEAU buildings the car's chassis overlaps on a deck
// (expressway_building_crossed, the cut-out of knowledge/road-textures.md), the car standing still on
// a deck (expressway_car_stalled: held or touching, with whether an arrest froze it), a fall, a drop
// far under the cruise's target speed (a wall, a step), and not reaching the street at the route's
// end (deckDriveVerdict.ts). A run with an accident, a citation or an arrest (or blocked before it
// began) is recorded `invalid` and does not count. Writes .qa/drive-deck-<label>.json; exit 1 when
// the decks failed the drive, 2 when the run is invalid.
//
// Why the exit ramp and not on along 内回り (as before): past 24402611:30 the main line goes down to
// the ground end of the loaded data (築地川's cut is not in it), where the decks leave 汐留出口's
// 壁高欄 standing in 内回り's lane 0 by design (SHIODOME_REASON, knowledge/expressway-generation.md);
// the route and the traffic AI do not go there, so the check's car should not either.
//
//   just check-deck-drive                     (the dev server: just serve-dev)
//   pnpm exec tsx scripts/qa/drive-deck.ts [--label L] [--base URL] [--seconds S]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { deckDriveFailures, type DeckDriveRide } from "./deckDriveVerdict.ts";
import { freePort } from "./ports.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
/** Game seconds the drive may take at most (the route takes about 160 s at 50 km/h). */
const seconds = Number(flag("seconds") ?? 400);
/** The route, in the order the cruise prefers its runs at a fork: the exit ramp over 内回り. */
const ROUTE = ["207111988", "24402125", "24402611"];
/** The run whose end at the street is the route's end. */
const LAST_RUN = "24402125";
const url = `${base}?start=35.6534,139.7500&time=day&weather=clear&seed=20261110&expressway`;
const b = await launch(url, { width: 960, height: 540, port: await freePort() });
const until = async <T>(expr: string, tries = 180): Promise<T> => {
  for (let i = 0; i < tries; i++) {
    const v = await b.evaluate<T>(expr).catch(() => null);
    if (v) return v;
    await b.sleep(1000);
  }
  throw new Error(`timeout: ${expr}`);
};
try {
  await until("window.__game?.getState() === 'ready'");
  await b.evaluate("window.__game.start()");
  await until("__game.debug.settled().isSettled", 150);
  await b.sleep(3000);
  // Nothing in the way first (an accident, a pursuit: an arrest would freeze the car mid-drive and
  // the run would measure the arrest, not the decks). A pedestrian who walks into the parked car
  // before the drive, then the teleport away from the scene, was such a case (knowledge/
  // road-textures.md「止まる件」).
  let before: string | null = null;
  for (let i = 0; i < 30; i++) {
    before = await b.evaluate<string | null>("__game.debug.expressway.blocker()");
    if (before === null) break;
    await b.sleep(1000);
  }
  const pick = (event: string) => b.logs.filter((l) => l.includes(`"event":"${event}"`));
  const logsBefore = b.logs.length;
  let reachedEnd = false;
  if (before === null) {
    await until(`__game.debug.expressway.place("207111988:0", 0.05, 0)`, 60);
    await b.evaluate(`__game.debug.expressway.cruise({ kmh: 50, prefer: ${JSON.stringify(ROUTE)} })`);
    // The game's own frames (advance), so the drive is the same at any page speed; a second of
    // frames at a time, to stop where the exit ramp meets the street.
    const lastRun = JSON.stringify(`${LAST_RUN}:`);
    for (;;) {
      await b.evaluate("__game.advance(1)");
      const last = await b.evaluate<{ t: number; xid: string | null; onLast: boolean } | null>(
        `(() => { const s = __game.debug.expressway.samples(); const x = s.at(-1);
          return x ? { t: x.t, xid: x.xid, onLast: s.some((y) => y.xid?.startsWith(${lastRun})) } : null; })()`,
      );
      const isOffTheEnd = last !== null && last.onLast && last.xid === null;
      if (isOffTheEnd) reachedEnd = true;
      const isOver = last !== null && last.t > seconds;
      if (isOffTheEnd || isOver) break;
    }
  }
  const summary =
    before === null
      ? await b.evaluate<DeckDriveRide & { invalid: string | null }>(
          `__game.debug.expressway.stop("entrance-c1-shiodome")`,
        )
      : null;
  const during = (event: string) => b.logs.slice(logsBefore).filter((l) => l.includes(`"event":"${event}"`));
  const arrests = during("story_begin").filter((l) => l.includes(`"kind":"arrest"`));
  // Invalid (not counted as a success): blocked before it began, or the law stepped in on the way.
  const invalid =
    before !== null
      ? `blocked before the drive: ${before}`
      : summary?.invalid
        ? `blocked: ${summary.invalid}`
        : during("accident").length > 0
          ? "accident during the drive"
          : during("violation_cited").length > 0
            ? "violation cited during the drive"
            : arrests.length > 0
              ? "arrest during the drive"
              : null;
  const crossed = pick("expressway_building_crossed");
  const stalled = during("expressway_car_stalled");
  const failures = summary
    ? deckDriveFailures(summary, { crossed: crossed.length, stalled: stalled.length, reachedEnd })
    : [];
  const out = {
    label,
    url,
    invalid,
    failures,
    reachedEnd,
    summary,
    lawEvents: {
      accident: during("accident"),
      violationCited: during("violation_cited"),
      arrest: arrests,
    },
    crossed,
    stalled,
    holds: pick("vehicle_hold_changed"),
    cuts: pick("buildings_cut_above_deck").length,
  };
  mkdirSync(join(ROOT, ".qa"), { recursive: true });
  writeFileSync(join(ROOT, ".qa", `drive-deck-${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ label, invalid, failures, summary, crossed: crossed.length, stalled: stalled.length })}\n`,
  );
  // 2: the run does not count (invalid), whatever it measured; 1: the decks failed the drive.
  const isFailed = failures.length > 0;
  if (invalid !== null) process.exitCode = 2;
  else if (isFailed) process.exitCode = 1;
} finally {
  await b.close();
}

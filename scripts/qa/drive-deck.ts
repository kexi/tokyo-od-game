// Drives the P3 route over the expressway decks (entrance ramp 207111988 → C1 内回り 24402611) with
// the dev hook (window.__game.debug.expressway.cruise) and counts what the decks still get wrong:
// PLATEAU buildings the car's chassis overlaps on a deck (expressway_building_crossed, the cut-out
// of knowledge/road-textures.md) and the car standing still on a deck (expressway_car_stalled: held
// or touching, with whether an arrest froze it). A run with an accident, a citation or an arrest
// (or blocked before it began) is recorded `invalid` and does not count. Writes
// .qa/drive-deck-<label>.json; exit 1 when a building was crossed, 2 when the run is invalid.
//
//   just check-deck-drive                     (the dev server: just serve-dev)
//   pnpm exec tsx scripts/qa/drive-deck.ts [--label L] [--base URL] [--seconds S]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const seconds = Number(flag("seconds") ?? 150);
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
  if (before === null) {
    await until(`__game.debug.expressway.place("207111988:0", 0.05, 0)`, 60);
    await b.evaluate(`__game.debug.expressway.cruise({ kmh: 50, prefer: ["207111988", "24402611"] })`);
    // The game's own frames (advance), so the drive is the same at any page speed.
    for (let s = 0; s < seconds; s += 10) await b.evaluate("__game.advance(10)");
  }
  const summary =
    before === null
      ? await b.evaluate<{ invalid: string | null }>(`__game.debug.expressway.stop("entrance-c1-inner")`)
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
  const out = {
    label,
    url,
    invalid,
    summary,
    lawEvents: {
      accident: during("accident"),
      violationCited: during("violation_cited"),
      arrest: arrests,
    },
    crossed,
    stalled: pick("expressway_car_stalled"),
    holds: pick("vehicle_hold_changed"),
    cuts: pick("buildings_cut_above_deck").length,
  };
  mkdirSync(join(ROOT, ".qa"), { recursive: true });
  writeFileSync(join(ROOT, ".qa", `drive-deck-${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ label, invalid, summary, crossed: crossed.length, stalled: out.stalled.length })}\n`,
  );
  // 1: a building crossed on a deck; 2: the run does not count (invalid), whatever it measured.
  if (crossed.length > 0) process.exitCode = 1;
  else if (invalid !== null) process.exitCode = 2;
} finally {
  await b.close();
}

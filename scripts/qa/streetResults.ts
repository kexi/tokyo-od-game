import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type LatLon, type MainDrive, type StreetSummary } from "./streetDriveVerdict.ts";

/**
 * What a street drive's result was driven against (street-drive.ts), so a folder driven in parts
 * (--only, a lock of 25 min at a time) is resumed only over results of the same run: the served data
 * (servedData.ts, meta and tiles), the probes' case lists and main's results it was judged with.
 * Why not resume by the file's presence alone (as before): a result of other data, or judged without
 * the baseline, was kept and counted with the rest (PR #132 review).
 *
 * The lists and the baseline are keyed by their content (SHA-256), not their paths: a list written
 * again at the same path, or main driven again into the same folder, is another run (re-review r1).
 */
export type ResultKey = {
  metaSha256: string;
  tilesSha256: string;
  /** SHA-256 of the --site-lanes / --hole-lanes file, or null without one. */
  siteLanes: string | null;
  holeLanes: string | null;
  /** SHA-256 of the key of main's summary.json the baseline's results were read by, or null. */
  baseline: string | null;
};

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** SHA-256 of a file's content, or null without a file. */
export const fileSha256 = (file: string | undefined): string | null =>
  file === undefined ? null : sha256(readFileSync(file));

/** SHA-256 of a run's key (what the baseline is keyed by). */
export const keySha256 = (key: ResultKey): string => sha256(JSON.stringify(key));

const sameKey = (a: ResultKey, b: ResultKey) =>
  a.metaSha256 === b.metaSha256 &&
  a.tilesSha256 === b.tilesSha256 &&
  a.siteLanes === b.siteLanes &&
  a.holeLanes === b.holeLanes &&
  a.baseline === b.baseline;

/** A place's earlier result that this run keeps (skips driving), or false to drive it again. */
export function isReusable(prev: { key?: ResultKey } | null, key: ResultKey): boolean {
  const hasKey = prev?.key !== undefined;
  if (!hasKey) return false;
  return sameKey(prev!.key!, key);
}

type Result = { place: { id: string }; verdict: string; key?: ResultKey };

/**
 * The summary over a folder's results of this run (`key`): the places by verdict, the table's places
 * with no such result (`missing`), and results of another run left in the folder (`stale`, not
 * counted).
 */
export function summarize(
  results: readonly Result[],
  tableIds: readonly string[],
  key: ResultKey,
): StreetSummary & { stale: string[] } {
  const ofRun = results.filter((r) => isReusable(r, key));
  const stale = results
    .filter((r) => !isReusable(r, key))
    .map((r) => r.place.id)
    .toSorted();
  const ids = (v: string) =>
    ofRun
      .filter((r) => r.verdict === v)
      .map((r) => r.place.id)
      .toSorted();
  const driven = new Set(ofRun.map((r) => r.place.id));
  return {
    pass: ids("pass"),
    fail: ids("fail"),
    known: ids("known"),
    knownMain: ids("known-main"),
    invalid: ids("invalid"),
    missing: tableIds.filter((id) => !driven.has(id)).toSorted(),
    stale,
  };
}

/**
 * The logged lines' lat/lon (expressway_building_crossed, expressway_car_stalled, car_respawned),
 * as browser.mjs keeps them: `[warning] {…}` (the console call's type, then the logger's JSON).
 */
export const pointsOf = (lines: readonly string[]): LatLon[] =>
  lines.map((l) => {
    const { lat, lon } = JSON.parse(l.slice(l.indexOf("{"))) as LatLon;
    return { lat, lon };
  });

/** main's results to judge by (`--baseline`): its run's key, and its drive of each place. */
export type MainResults = {
  keySha256: string;
  byPlace: ReadonlyMap<string, MainDrive & { served?: unknown }>;
};

/**
 * main's results in a folder of this tool's: only those of the run its summary.json names (the same
 * key), so a result of main's older data left in the folder (main's own `stale`) is not read as
 * main's (re-review r1). A folder without a summary, or a result of that run without `kinds` (a
 * version before kinds), is refused: such a baseline cannot say which kinds main failed with, and
 * read as none it would turn every failure there into a new one, and read as all, hide them (r3).
 */
export function readMainResults(dir: string): MainResults {
  const summaryFile = join(dir, "summary.json");
  const hasSummary = existsSync(summaryFile);
  if (!hasSummary) throw new Error(`baseline ${dir} has no summary.json: drive main there first`);
  const summary = JSON.parse(readFileSync(summaryFile, "utf8")) as { key?: ResultKey };
  const mainKey = summary.key;
  const hasKey = mainKey !== undefined;
  if (!hasKey)
    throw new Error(`baseline ${dir}: its summary.json has no key (a version before the resume key)`);
  const byPlace = new Map<string, MainDrive & { served?: unknown }>();
  for (const f of readdirSync(dir)) {
    const isResult = f.endsWith(".json") && f !== "summary.json";
    if (!isResult) continue;
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Result & {
      kinds?: string[];
      served?: unknown;
    };
    const isOfRun = isReusable(r, mainKey!);
    if (!isOfRun) continue;
    const hasKinds = Array.isArray(r.kinds);
    if (!hasKinds) throw new Error(`baseline ${dir}/${f} has no kinds: drive main again with this version`);
    byPlace.set(r.place.id, { verdict: r.verdict, kinds: r.kinds!, served: r.served });
  }
  return { keySha256: keySha256(mainKey!), byPlace };
}

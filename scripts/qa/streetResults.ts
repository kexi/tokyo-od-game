import type { StreetSummary } from "./streetDriveVerdict.ts";

/**
 * What a street drive's result was driven against (street-drive.ts), so a folder driven in parts
 * (--only, a lock of 25 min at a time) is resumed only over results of the same run: the served data
 * (servedData.ts, meta and tiles), the probes' case lists and main's results it was judged with.
 * Why not resume by the file's presence alone (as before): a result of other data, or judged without
 * the baseline, was kept and counted with the rest (PR #132 review).
 */
export type ResultKey = {
  metaSha256: string;
  tilesSha256: string;
  siteLanes: string | null;
  holeLanes: string | null;
  baseline: string | null;
};

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

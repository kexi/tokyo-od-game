import { z } from "zod";

/**
 * The watch over a phone's town (U12): a phone that streams the full town by default goes back to
 * the light one, and keeps it, once a page of it ended while on screen — the way a tab killed for
 * its memory ends (no `visibilitychange`, no `pagehide`).
 *
 * How: localStorage holds the run (`front` while on screen, `back` once hidden, `closed` after
 * `pagehide`) and whether this phone was sent back. A page opened after a run left at `front` counts
 * one suspected crash. Hidden pages the OS clears, tabs closed, reloads and app switches all pass
 * through `back` or `closed` first, so they do not count.
 *
 * Why not navigator.deviceMemory: only Android's Chrome has it; an iPhone (an old 4 GB one among
 * them) cannot be told apart. Why not two crashes before going back: after the first the game is
 * already unplayable on that phone; going back by mistake costs only buildings.
 */

/** The town a phone streams: the light one (24 MiB, the 描画距離's radius) or the full one. */
export type PhoneTown = "full" | "low";

/** Where the last page of the full town was when it last wrote: on screen, hidden, or ended. */
export type RunState = "front" | "back" | "closed";

/** What localStorage keeps; null `run` when no page of the full town is being watched. */
export type WatchRecord = { run: RunState | null; demoted: boolean };

/** Why the page streams the town it does. */
export type TownReason = "param" | "default" | "demoted" | "no_storage";

export type WatchOpen = {
  town: PhoneTown;
  reason: TownReason;
  /** The run before this page ended on screen (a suspected crash). */
  crashed: boolean;
  /** This page is the one that went back: tell the player once. */
  justDemoted: boolean;
  /** What to write now; null when storage cannot be used. */
  next: WatchRecord | null;
};

export const WATCH_KEY = "tod.phoneTown.watch";

const WatchRecordSchema = z.strictObject({
  run: z.enum(["front", "back", "closed"]).nullable(),
  demoted: z.boolean(),
});

/** The stored record, or a fresh one for nothing stored or nonsense. */
export function parseWatch(text: string | null): WatchRecord {
  const fresh: WatchRecord = { run: null, demoted: false };
  if (text === null) return fresh;
  try {
    const parsed = WatchRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : fresh;
  } catch {
    // Not JSON: written by something else; start again.
    return fresh;
  }
}

/**
 * The town for a page being opened. `stored` is null when storage cannot be used; `param` is the
 * URL's `?phoneTown=` (null when absent or unknown); `byDefault` is this kind of phone's default.
 * Pure: the caller reads and writes storage.
 */
export function openWatch(
  stored: WatchRecord | null,
  param: PhoneTown | null,
  byDefault: PhoneTown,
  isVisible: boolean,
): WatchOpen {
  const isStorageBlocked = stored === null;
  if (isStorageBlocked) {
    // Nothing can be remembered, so a phone that crashes would crash on every open: the light town.
    const town = param ?? "low";
    const reason: TownReason = param !== null ? "param" : byDefault === "full" ? "no_storage" : "default";
    return { town, reason, crashed: false, justDemoted: false, next: null };
  }
  const crashed = stored.run === "front";
  // `?phoneTown=full` is the way back by hand: it forgets the demotion.
  const isFullAsked = param === "full";
  const demoted = isFullAsked ? false : stored.demoted || crashed;
  const town: PhoneTown = param ?? (byDefault === "full" && !demoted ? "full" : "low");
  const reason: TownReason =
    param !== null ? "param" : byDefault === "full" && demoted ? "demoted" : "default";
  const justDemoted = param === null && byDefault === "full" && crashed && !stored.demoted;
  // Only a page of the full town is watched; the light one has nothing to go back from.
  const isWatched = town === "full";
  const run: RunState | null = isWatched ? (isVisible ? "front" : "back") : null;
  return { town, reason, crashed, justDemoted, next: { run, demoted } };
}

/** The page's own events, as the watch reads them. */
export type PageEvent = "hidden" | "visible" | "pagehide" | "pageshow";

/**
 * The run after a page event. `pageshow` is a page coming back from the back/forward cache (after
 * its `pagehide` wrote `closed`): it is on screen again, or hidden if it came back hidden.
 */
export function runAfter(event: PageEvent, isVisible: boolean): RunState {
  if (event === "pagehide") return "closed";
  if (event === "hidden") return "back";
  if (event === "visible") return "front";
  return isVisible ? "front" : "back";
}

/**
 * The page's localStorage, or null when there is none or reading `window.localStorage` itself
 * throws (Safari and Chrome do so when site data is blocked).
 */
export function pageStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads the record, or null when storage throws (a private window, blocked site data). */
export function readWatch(storage: Pick<Storage, "getItem">): WatchRecord | null {
  try {
    return parseWatch(storage.getItem(WATCH_KEY));
  } catch {
    return null;
  }
}

/** Writes the record; false when storage throws. */
export function writeWatch(storage: Pick<Storage, "setItem">, record: WatchRecord): boolean {
  try {
    storage.setItem(WATCH_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

const isVisible = () => document.visibilityState === "visible";

/**
 * Keeps the run up to date from the page's events (call once, for a page of the full town).
 * Why `pagehide` and not `beforeunload`: mobile browsers often skip `beforeunload`, and a page with
 * one is kept out of the back/forward cache.
 */
export function armWatch(storage: Pick<Storage, "setItem">, demoted: boolean): void {
  const write = (event: PageEvent) => writeWatch(storage, { run: runAfter(event, isVisible()), demoted });
  document.addEventListener("visibilitychange", () => write(isVisible() ? "visible" : "hidden"));
  window.addEventListener("pagehide", () => write("pagehide"));
  window.addEventListener("pageshow", (e) => {
    const isFromCache = e.persisted;
    if (isFromCache) write("pageshow");
  });
}

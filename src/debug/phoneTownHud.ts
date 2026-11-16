import type { TilesRenderer } from "3d-tiles-renderer";
import { pageStorage, type PhoneTown } from "../phoneTownWatch";

/**
 * The corner readout of a phone trying `?phoneTown=…` (U12, the town tried on the phones from the
 * published build): time since the page loaded, how many times the page was loaded with this town
 * (a tab the browser killed and reopened counts one more), and the near town (tiles shown, MB held
 * of the limit, frames the LRU was full). How: the load count lives in localStorage under a key per
 * town and goes up once per page load; a long press on the readout sets it back to 0 before a trial.
 * Why not the logs (.qa/logs): a phone on the published build has no dev server to send them to.
 */

/** The text is written twice a second (the full frames are counted every frame). */
const TEXT_EVERY_MS = 500;
/** Long enough that a tap while driving does not clear the count. */
const RESET_PRESS_MS = 1200;

/** The key the load count is kept under, one per town tried. */
export function loadCountKey(town: PhoneTown): string {
  return `tod.phoneTown.${town}.loads`;
}

/**
 * This page load counted: the stored count plus one (a stored value that is not a count starts
 * again from 0), or null when storage is blocked. Why not 0 when blocked: `reloads 0` would read as
 * a run that never reloaded, when nothing was counted at all.
 */
export function countLoad(storage: Pick<Storage, "getItem" | "setItem">, key: string): number | null {
  try {
    const before = Number(storage.getItem(key) ?? "0");
    const isCount = Number.isInteger(before) && before >= 0;
    const now = (isCount ? before : 0) + 1;
    storage.setItem(key, String(now));
    return now;
  } catch {
    // Storage blocked (private window): the count cannot outlive the page.
    return null;
  }
}

/** The three lines: m:ss and the reloads (loads after the first), then the near town. */
export function phoneTownLines(s: {
  town: string;
  elapsedMs: number;
  /** Null when storage is blocked: the reloads read `?`. */
  loads: number | null;
  visible: number;
  heldBytes: number;
  limitBytes: number;
  fullFrames: number;
}): string[] {
  const total = Math.floor(s.elapsedMs / 1000);
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  const mb = (bytes: number) => Math.round(bytes / 1024 ** 2);
  const reloads = s.loads === null ? "?" : String(Math.max(0, s.loads - 1));
  return [
    `phoneTown=${s.town} ${clock}`,
    `reloads ${reloads}`,
    `tiles ${s.visible} · ${mb(s.heldBytes)}/${mb(s.limitBytes)} MB · full ${s.fullFrames}`,
  ];
}

/** Shows the readout for `town` over the near town `tiles` (call once, after the town is made). */
// `cachedBytes` is a public field of 0.5.3's LRUCache that its typings leave out.
export function startPhoneTownHud(town: PhoneTown, tiles: () => TilesRenderer): void {
  const key = loadCountKey(town);
  const storage = pageStorage();
  let loads = storage === null ? null : countLoad(storage, key);
  const startedAt = performance.now();
  let fullFrames = 0;
  let textAt = 0;
  const panel = document.createElement("div");
  panel.id = "phone-town-hud";
  panel.className = "panel";
  document.body.append(panel);
  let pressTimer = 0;
  panel.addEventListener("pointerdown", () => {
    pressTimer = window.setTimeout(() => {
      try {
        storage?.setItem(key, "1");
        // Still `?` when blocked: nothing was counted, so there is nothing to set back.
        if (loads !== null) loads = 1;
      } catch {
        // Storage blocked since the page loaded: the count can no longer be kept.
        loads = null;
      }
    }, RESET_PRESS_MS);
  });
  const cancelPress = () => window.clearTimeout(pressTimer);
  panel.addEventListener("pointerup", cancelPress);
  panel.addEventListener("pointerleave", cancelPress);
  const tick = () => {
    const lru = tiles().lruCache;
    if (lru.isFull()) fullFrames++;
    const lines = phoneTownLines({
      town,
      elapsedMs: performance.now() - startedAt,
      loads,
      visible: tiles().visibleTiles.size,
      heldBytes: (lru as typeof lru & { cachedBytes: number }).cachedBytes,
      limitBytes: lru.maxBytesSize,
      fullFrames,
    });
    const isTextDue = performance.now() - textAt > TEXT_EVERY_MS;
    if (isTextDue) {
      textAt = performance.now();
      panel.textContent = lines.join("\n");
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// The PLATEAU buildings' quiet: neither the near town nor the far skyline has loaded or disposed a
// tile, or had one queued, downloading or parsing, for a while. Shared by scripts/qa/perf-buildings.ts (the window opens then) and
// scripts/qa/views.ts (a shot waits for it when the table asks, defaults.quietS). Why it is needed:
// debug.settled() reads the renderers' loadProgress, which counts only the queued, downloading and
// parsing tiles, so it reports "loaded" while tiles keep arriving for seconds more (X1 round 1: 5–23 s
// after settled at 川崎駅 and 川口駅, the near town missing in the shot).

/**
 * Page-side: counts the tile events of both renderers into window.__perfQuiet (the far one is
 * attached once it exists, and the clock starts again then) and returns the milliseconds since the
 * latest. A renderer with tiles queued, downloading or parsing (its stats) also counts as an event
 * at each call: the library ends a download's job when the response headers arrive and reads the
 * body outside its queue, so `isLoading` turns false with bodies still on the way, and a gap of a
 * few seconds between two arriving bodies would otherwise pass for quiet (X1 round 1 timelines:
 * 4–96 tiles still downloading when settled turned true).
 */
export const QUIET_WATCH = `(() => {
  const b = __game.buildings;
  const q = (window.__perfQuiet ??= { last: performance.now(), events: 0, near: false, far: false });
  const on = (r) => {
    const tick = () => { q.last = performance.now(); q.events++; };
    r.addEventListener("load-model", tick);
    r.addEventListener("dispose-model", tick);
  };
  if (!q.near) { on(b.tiles); q.near = true; }
  if (!q.far && b.far) { on(b.far); q.far = true; q.last = performance.now(); }
  const busy = (r) => r ? r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  if (busy(b.tiles) + busy(b.far) > 0) q.last = performance.now();
  return performance.now() - q.last;
})()`;

type Page = { evaluate<T = unknown>(expression: string): Promise<T>; sleep(ms: number): Promise<void> };

/**
 * Polls QUIET_WATCH every 500 ms until `quietMs` have passed without a tile event or a busy renderer, or `timeoutMs`
 * runs out. With `afterFar`, the quiet is only counted once the far skyline exists (it starts after
 * the town, or after 15 s: a quiet before it would end at its first tile).
 */
export async function waitQuiet(
  page: Page,
  quietMs: number,
  timeoutMs: number,
  afterFar = false,
): Promise<{ quiet: boolean; waitedS: number }> {
  const from = Date.now();
  const waited = () => Math.round((Date.now() - from) / 100) / 10;
  while (Date.now() - from < timeoutMs) {
    const isCounting = !afterFar || (await page.evaluate<boolean>("Boolean(__game.buildings.far)"));
    const sinceLast = isCounting ? await page.evaluate<number>(QUIET_WATCH) : 0;
    const isQuiet = sinceLast >= quietMs;
    if (isQuiet) return { quiet: true, waitedS: waited() };
    await page.sleep(500);
  }
  return { quiet: false, waitedS: waited() };
}

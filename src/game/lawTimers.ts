/**
 * The law checks' "for how long" timers (main.ts): 速度超過 for 3 s, 逆走 (通行禁止) for 1.5 s, 右側通行
 * for 2 s and the like are booked only once the condition has held that long, so a moment's swerve
 * is not an offence. Times are the game's clock (frameClock.ts gameStep), so the grace is the same
 * stretch of road however long the page takes over a frame.
 *
 * Why not keep the pattern written out at each check (as before): the pattern is the same at every
 * one, and a helper is where a test can drive it with the frames of a slow page and a fast one.
 */

/** When the condition began (`since` kept while it holds, `now` as it starts, null once it stops). */
export function heldSince(isOn: boolean, since: number | null, now: number): number | null {
  if (!isOn) return null;
  return since ?? now;
}

/** The condition has held for more than `ms` at `now`. */
export function hasHeldOver(since: number | null, now: number, ms: number): boolean {
  if (since === null) return false;
  return now - since > ms;
}

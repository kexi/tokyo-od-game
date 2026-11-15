/** The longest frame step the game simulates at once (s): a stall is not a jump through the world. */
export const MAX_FRAME_S = 0.05;

/**
 * The frame's time step (s) from the frame's time stamp `stamp` (ms) and the time of the last frame, and the time
 * the next frame counts from. Two callers drive the frames: requestAnimationFrame, whose stamp is
 * the frame's start (taken before the frame's callbacks run), and `__game.advance` (QA), which
 * reads performance.now() between them. A rAF frame after an advance step can therefore carry an
 * earlier stamp than the last step's. Such a frame takes no time (dt 0) and keeps the last frame's
 * time (`last`, which the caller uses as the frame's time), so the steps add up to the wall time
 * whichever caller ran them and the clock never runs back.
 *
 * Why not `Math.min(MAX_FRAME_S, (now - last) / 1000)` alone (as before): it let dt go negative
 * there. The physics' accumulator gave the time back, but the traffic AI moves only on frames with
 * time (it skips dt ≤ 0), so it kept the positive half of every such pair: on the decks its cars ran
 * about 1.26 × their own speed and rear-ended the player's car (knowledge/expressway-generation.md
 * 「床版の走行検査が交通 AI の車と事故で invalid」).
 */
export function clockStep(stamp: number, last: number): { dt: number; last: number } {
  const isBehind = stamp < last;
  if (isBehind) return { dt: 0, last };
  return { dt: Math.min(MAX_FRAME_S, (stamp - last) / 1000), last: stamp };
}

/**
 * The game's clock (ms) one frame on: `game` plus the frame's dt from clockStep. Everything that
 * happens in the world is timed on it (the law's timers and grace windows, the indicator's memory,
 * the police, the phone in use, the replay's ±5 s); the wall clock (performance.now()) is for what
 * happens outside it (loading waits, request and redraw throttles, log durations).
 *
 * The two run together while frames take MAX_FRAME_S or less. A longer frame moves the world only
 * MAX_FRAME_S, and this clock with it: a slow page (QA's headless Chrome, a phone under load) no
 * longer has the 合図's 6 s window or a 1.5 s 逆走 grace run out while the car has covered a sixth
 * of the road (knowledge/game-clock.md).
 *
 * Why not count from 0: the clock starts at the wall time of the loop's start, so the values the
 * game starts with (`-Infinity`, 0) compare against it as they did against performance.now().
 */
export function gameStep(game: number, dt: number): number {
  return game + dt * 1000;
}

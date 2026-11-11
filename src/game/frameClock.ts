/** The longest frame step the game simulates at once (s): a stall is not a jump through the world. */
export const MAX_FRAME_S = 0.05;

/**
 * The frame's time step (s) from the clock `now` (ms) and the time of the last frame, and the time
 * the next frame counts from. Two callers drive the frames: requestAnimationFrame, whose `now` is
 * the frame's start (taken before the frame's callbacks run), and `__game.advance` (QA), which
 * reads performance.now() between them. A rAF frame after an advance step can therefore carry an
 * earlier time than the last step's. Such a frame takes no time (dt 0) and does not move the clock
 * back, so the steps add up to the wall time whichever caller ran them.
 *
 * Why not `Math.min(MAX_FRAME_S, (now - last) / 1000)` alone (as before): it let dt go negative
 * there. The physics' accumulator gave the time back, but the traffic AI moves only on frames with
 * time (it skips dt ≤ 0), so it kept the positive half of every such pair: on the decks its cars ran
 * about 1.26 × their own speed and rear-ended the player's car (knowledge/expressway-generation.md
 * 「床版の走行検査が交通 AI の車と事故で invalid」).
 */
export function frameStep(now: number, last: number): { dt: number; last: number } {
  const isBehind = now < last;
  if (isBehind) return { dt: 0, last };
  return { dt: Math.min(MAX_FRAME_S, (now - last) / 1000), last: now };
}

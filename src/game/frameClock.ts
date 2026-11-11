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

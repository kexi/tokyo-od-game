/**
 * The design ground line (P2.7-3, S3): a smooth line through the ground under a run that keeps its
 * long waves and drops the DEM's short ones (the laser ground under a viaduct is rough: walls,
 * embankments, the smoothing's half-metre bumps). The compiler aims the objective-v2 deck at it
 * (compile.ts setupRun / setupBelow); the ground itself stays only a one-sided bound (the floor over
 * open ground, the ceiling over a tunnel) and the ends' conditions.
 *
 * `envelope(values, reach, kind)` over values on an even grid (`step` metres apart, the compiler's
 * 5 m constraint stations):
 * - upper: the largest value within ±reach, then the mean of that within ±reach;
 * - lower: the smallest within ±reach, then the mean of that within ±reach;
 * - mid: the mean of upper and lower (the centre line S6 will solve a road at grade along).
 * Near the ends both windows are cut to the samples there are.
 *
 * Why the extreme before the mean and not the mean alone (v1's ±60 m average): a mean of rough
 * ground is still rough and passes under the bumps, so the open-ground floor (the peak + 6.7 m)
 * pushes the deck up over every one of them; the moving extreme is never below (above, for lower)
 * the ground, and the mean after it takes the steps out of the extreme. Why not a low-pass filter
 * (a long moving average or a spline): it is not one-sided either, and its overshoot would bring
 * back the floor's pushes it is meant to remove.
 */

export type EnvelopeKind = "upper" | "lower" | "mid";

/** Samples within ±reach metres on a grid `step` apart (at least one). */
function halfWindow(reach: number, step: number): number {
  return Math.max(1, Math.round(reach / step));
}

/** The largest (sign 1) or smallest (sign −1) value within ±r samples, by a monotonic deque. */
function movingExtreme(values: ArrayLike<number>, r: number, sign: 1 | -1): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const deque: number[] = [];
  let head = 0;
  let next = 0;
  for (let k = 0; k < n; k++) {
    const hi = Math.min(n - 1, k + r);
    for (; next <= hi; next++) {
      const v = sign * values[next];
      while (deque.length > head && sign * values[deque[deque.length - 1]] <= v) deque.pop();
      deque.push(next);
    }
    while (deque[head] < k - r) head++;
    out[k] = values[deque[head]];
  }
  return out;
}

/** The mean within ±r samples (fewer at the ends), each window summed afresh. */
function movingMean(values: ArrayLike<number>, r: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  // Why each window summed afresh and not by prefix sums: a difference of two long prefix sums of
  // elevations (tens of metres, thousands of samples) loses the last digits, and a constant line
  // must come out constant.
  for (let k = 0; k < n; k++) {
    let sum = 0;
    const lo = Math.max(0, k - r);
    const hi = Math.min(n - 1, k + r);
    for (let j = lo; j <= hi; j++) sum += values[j];
    out[k] = sum / (hi - lo + 1);
  }
  return out;
}

export function envelope(
  values: ArrayLike<number>,
  reach: number,
  kind: EnvelopeKind,
  step = 5,
): Float64Array {
  const r = halfWindow(reach, step);
  // Each mean is over maxima (minima) of windows holding the sample itself, so it is never under
  // (over) it but for the last bit of the sum's rounding, which the clamp takes back.
  if (kind === "upper")
    return movingMean(movingExtreme(values, r, 1), r).map((v, k) => Math.max(v, values[k]));
  if (kind === "lower")
    return movingMean(movingExtreme(values, r, -1), r).map((v, k) => Math.min(v, values[k]));
  const upper = envelope(values, reach, "upper", step);
  const lower = envelope(values, reach, "lower", step);
  return upper.map((u, k) => (u + lower[k]) / 2);
}

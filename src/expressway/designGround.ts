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

/**
 * The median of the values within ±reach (fewer at the ends), on the same even grid: the design ground
 * line of a run at grade (S6 PR 2). Why not `mid` (the mean of the upper and lower envelopes): each
 * envelope takes an isolated bump whole, so a 3 m, 40 m wide mound lifted the road 1.20 m and still
 * 0.65 m 200 m off (PR 2 review W2); the median takes no bump narrower than the window's half, and a
 * periodic wave's median is its middle.
 */
export function movingMedian(values: ArrayLike<number>, reach: number, step = 5): Float64Array {
  const r = halfWindow(reach, step);
  const n = values.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const lo = Math.max(0, k - r);
    const hi = Math.min(n - 1, k + r);
    const w: number[] = [];
    for (let j = lo; j <= hi; j++) w.push(values[j]);
    w.sort((a, b) => a - b);
    const m = w.length >> 1;
    out[k] = w.length % 2 === 1 ? w[m] : (w[m - 1] + w[m]) / 2;
  }
  return out;
}

/** Points closer than this along the run give no slope to the repeated median (half the 5 m grid). */
const SLOPE_MIN_DX_M = 2.5;

/** The median of a list (sorted in place). */
function medianOf(list: number[]): number {
  list.sort((a, b) => a - b);
  const m = list.length >> 1;
  return list.length % 2 === 1 ? list[m] : (list[m - 1] + list[m]) / 2;
}

/**
 * Siegel's repeated-median line through (xs, ys): the slope the median over i of the median over j of
 * the pairs' slopes, the intercept the median of what is left. Why not least squares or Theil–Sen
 * (S6 PR 7a review C1): a 3 m mound 40 m wide near an end is a quarter of a 150 m window, which moved
 * the least-squares line by over a metre; the repeated median holds until half the points are off.
 */
export function repeatedMedianLine(xs: readonly number[], ys: readonly number[]): { a: number; b: number } {
  const n = xs.length;
  const isPoint = n < 2;
  if (isPoint) return { a: ys[0] ?? 0, b: 0 };
  const perPoint: number[] = [];
  for (let i = 0; i < n; i++) {
    const slopes: number[] = [];
    for (let j = 0; j < n; j++) {
      const dx = xs[j] - xs[i];
      // Two points under SLOPE_MIN_DX_M apart give no slope (review C2): a partner's ground pooled at
      // micrometres from this run's own station made a slope of ±10⁵ from each pair, all of one sign
      // where one run stood higher, and tilted the line (0.0016 against 0.0029 on the same points).
      const isApart = Math.abs(dx) >= SLOPE_MIN_DX_M;
      if (isApart) slopes.push((ys[j] - ys[i]) / dx);
    }
    if (slopes.length > 0) perPoint.push(medianOf(slopes));
  }
  const b = perPoint.length > 0 ? medianOf(perPoint) : 0;
  const a = medianOf(ys.map((y, i) => y - b * xs[i]));
  return { a, b };
}

/**
 * The target of a run at grade (S6 PR 7a, N1): at each grid station, the repeated-median line through
 * the ground under the run's own centre line within ±reach of it (the window cut short at the run's
 * ends), taken at the station: the median of the ground less the window's robust slope. Inside the
 * run on level ground that is the moving median; on a slope it does not lag, and at an end the window
 * is one-sided (reach long) with no change of method. Why not the moving median at the ends (PR 2
 * re-review N1): on a 3 % slope it lags by half the window's rise (3.75 m at a seam downhill). Why a
 * robust line and not least squares nor a narrowed centred window (review C1): both took a 3 m × 40 m
 * bump 25–60 m from the end by up to 2.3 m; the repeated median holds until half the window is off.
 * Why the line inside too and not the median there: one rule has no seam at reach, and on ±0.4 m
 * waves of 44 m over a 2 % slope its steps between grid stations were 0.16 m against the median's
 * 0.38 m (0.08 against 0.18 m off the slope). Why the run's own ground alone (review W1, the
 * coordinator's 案 1): beyond a run at grade the chain is a viaduct or a below run, whose ground is not
 * the road's (920238350 sank 6 m to a viaduct's ground). Pure.
 */
export function groundTarget(
  values: ArrayLike<number>,
  stations: ArrayLike<number>,
  reach: number,
  /**
   * The ground of a run at grade sharing a surface with this one (S6 PR 7a review C2), at the stations
   * of this run they stand beside (`s`, this run's distance), pooled into the windows: the two decks of
   * one slab take one line. Ascending in s.
   */
  partner: { s: ArrayLike<number>; z: ArrayLike<number> } = { s: [], z: [] },
): Float64Array {
  const n = values.length;
  const m = partner.s.length;
  const out = new Float64Array(n);
  let lo = 0;
  let hi = 0;
  let plo = 0;
  let phi = -1;
  const S = stations[n - 1];
  for (let k = 0; k < n; k++) {
    const s = stations[k];
    while (lo < n && stations[lo] < s - reach - 1e-9) lo++;
    while (hi + 1 < n && stations[hi + 1] <= s + reach + 1e-9) hi++;
    // The partner's samples within this run's window (the window cut at this run's ends).
    const from = Math.max(0, s - reach);
    const to = Math.min(S, s + reach);
    // Within half a grid step past the window: the partner's end station may stand a hair beyond this
    // run's (its length measured along its own line).
    while (plo < m && partner.s[plo] < from - SLOPE_MIN_DX_M) plo++;
    while (phi + 1 < m && partner.s[phi + 1] <= to + SLOPE_MIN_DX_M) phi++;
    const ys: number[] = [];
    const xs: number[] = [];
    for (let j = lo; j <= hi; j++) {
      // The grid's last station may repeat its length (gridStations): one sample, not two.
      const isRepeat = j > 0 && stations[j] - stations[j - 1] < 1e-6;
      if (isRepeat) continue;
      xs.push(stations[j] - s);
      ys.push(values[j]);
    }
    for (let j = plo; j <= phi; j++) {
      xs.push(partner.s[j] - s);
      ys.push(partner.z[j]);
    }
    // At the station x = 0, so the line's value there is its intercept. Held within the window's
    // ground (review C2): on a short run the slope of 20 rough samples carried the line out past
    // them (276 stations of ship, up to 2.17 m at 372483373).
    const line = repeatedMedianLine(xs, ys).a;
    const low = Math.min(...ys);
    const high = Math.max(...ys);
    out[k] = Math.max(low, Math.min(high, line));
  }
  return out;
}

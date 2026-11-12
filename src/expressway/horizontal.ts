import { MAX_LATERAL_SHIFT } from "./assumptions";

/**
 * Plan alignment (knowledge/road-redesign-plan.md 4.2): the OSM polyline resampled every ~1 m and smoothed so that the rate
 * of change of curvature (the third difference) is as small as possible while no point moves more
 * than ε (MAX_LATERAL_SHIFT) from the OSM line. Curvature then varies almost linearly with arc
 * length, which is what a clothoid transition does. Junction nodes are anchors and stay exactly on
 * the OSM node, so a ramp and its main line still meet at one point after both are smoothed.
 *
 * Why not fit clothoid/arc elements: OSM vertices wobble and the element split would jump between
 * builds; a bounded smoothing gives the same drivable line and the station output does not change
 * if exact elements are fitted later (knowledge/road-redesign-plan.md 9 章).
 */

export type PlanInput = {
  /** Polyline vertices in a local plane (metres), and which of them are anchors. */
  xy: ReadonlyArray<readonly [number, number]>;
  anchors: ReadonlySet<number>;
  /**
   * Structure overrides (structures.ts): where a sample at (x, y) on the OSM line must lie exactly
   * (a bridge deck's line), or null where it is free. The caller decides by position (the sample's
   * place along the structure's axis), so one pin serves the whole chain. Pinned samples are held like
   * anchors and their distance from OSM is reported apart (`pinnedShiftM`): the structure's own
   * tolerance (3 m) applies there, not ε.
   */
  pin?: (x: number, y: number) => [number, number] | null;
  /**
   * `--ramp-shift` (S6 PR 4): per resampled sample (as `original` comes out), metres to move the line
   * the smoothing pulls towards off the OSM line, along the OSM line's left normal (negative: to the
   * right). Such samples are held within ε of that shifted line, not of OSM, and are reported apart
   * (`shifted`; compile.ts rampShiftOf gives a run's farthest). The target is corrected by what the
   * smoothing gave back (twice), so the line moves by about the offset, not by up to ε less or more
   * (PR 4 review W3: a 0.06 m request moved 1.5 m when ε was added to it). 0 at an anchor (it stays
   * on its node); a pinned sample stays pinned.
   */
  offset?: Float64Array;
};

export type PlanAlignment = {
  /** Smoothed samples, [x0, y0, x1, y1, …]. */
  xy: Float64Array;
  /** The resampled OSM line at the same samples (what the shift is measured from). */
  original: Float64Array;
  /** Arc length of the smoothed line at each sample. */
  s: Float64Array;
  /** Signed curvature (1/m, left turn positive) at each sample. */
  kappa: Float64Array;
  /** Sample index of every input vertex (exact for anchors, nearest along the line otherwise). */
  vertexSample: Int32Array;
  /** Largest distance between `xy` and `original`, measured on the final arrays. */
  maxShiftM: number;
  /** Samples the last-resort projection had to pull back onto the ε circle (reported, not hidden). */
  clamped: number;
  /** Whether each sample is pinned by a structure override (PlanInput.pin). */
  pinned: Uint8Array;
  /** Largest distance between a pinned sample and the OSM line (0 without pins). */
  pinnedShiftM: number;
  /** Whether each sample is shifted (PlanInput.offset; never a pinned one). */
  shifted: Uint8Array;
};

const SAMPLE_M = 1;
/** Smoothing scale: curvature changes are spread over roughly this length. */
const SMOOTH_SCALE_M = 25;
const ANCHOR_WEIGHT = 1e12;

/** Solve a symmetric positive definite band system (half bandwidth b) in place by LDLᵀ. */
function solveBand(n: number, b: number, band: Float64Array, rhs: Float64Array[]): void {
  // band[i * (b + 1) + k] = A[i][i - k] for k = 0..b (the lower band, row-major).
  const at = (i: number, k: number) => i * (b + 1) + k;
  for (let i = 0; i < n; i++) {
    for (let k = Math.min(b, i); k >= 1; k--) {
      const j = i - k;
      let sum = band[at(i, k)];
      for (let m = 1; m <= b - k && j - m >= 0; m++) {
        // A[i][j-m] * A[j][j-m] / D[j-m]
        const im = k + m;
        if (im > b) break;
        sum -= band[at(i, im)] * band[at(j, m)] * band[at(j - m, 0)];
      }
      band[at(i, k)] = sum / band[at(j, 0)];
    }
    let d = band[at(i, 0)];
    for (let k = 1; k <= Math.min(b, i); k++) d -= band[at(i, k)] ** 2 * band[at(i - k, 0)];
    band[at(i, 0)] = d;
  }
  for (const r of rhs) {
    for (let i = 0; i < n; i++) {
      for (let k = 1; k <= Math.min(b, i); k++) r[i] -= band[at(i, k)] * r[i - k];
    }
    for (let i = 0; i < n; i++) r[i] /= band[at(i, 0)];
    for (let i = n - 1; i >= 0; i--) {
      for (let k = 1; k <= b && i + k < n; k++) r[i] -= band[at(i + k, k)] * r[i + k];
    }
  }
}

/** Resample the polyline every ~SAMPLE_M, keeping every anchor as a sample. */
function resample(input: PlanInput): {
  pts: Float64Array;
  vertexSample: Int32Array;
  anchorSamples: number[];
} {
  const v = input.xy;
  const out: number[] = [v[0][0], v[0][1]];
  const vertexSample = new Int32Array(v.length);
  const anchorSamples = [0];
  // Arc length of every vertex, and the anchors that cut the line into pieces.
  const cum = [0];
  for (let i = 1; i < v.length; i++)
    cum.push(cum[i - 1] + Math.hypot(v[i][0] - v[i - 1][0], v[i][1] - v[i - 1][1]));
  const cuts = [0];
  for (let i = 1; i < v.length - 1; i++) if (input.anchors.has(i)) cuts.push(i);
  cuts.push(v.length - 1);
  let seg = 0;
  for (let c = 1; c < cuts.length; c++) {
    const a = cuts[c - 1];
    const b = cuts[c];
    const len = cum[b] - cum[a];
    const n = Math.max(1, Math.round(len / SAMPLE_M));
    const base = out.length / 2 - 1;
    for (let k = 1; k <= n; k++) {
      const target = cum[a] + (len * k) / n;
      while (seg < v.length - 2 && cum[seg + 1] < target) seg++;
      const isLast = k === n;
      const i0 = isLast ? b - 1 : seg;
      const span = cum[i0 + 1] - cum[i0] || 1;
      const t = isLast ? 1 : Math.min(1, Math.max(0, (target - cum[i0]) / span));
      out.push(v[i0][0] + (v[i0 + 1][0] - v[i0][0]) * t, v[i0][1] + (v[i0 + 1][1] - v[i0][1]) * t);
    }
    for (let i = a; i <= b; i++) {
      const k = len > 0 ? Math.round(((cum[i] - cum[a]) / len) * n) : 0;
      vertexSample[i] = base + k;
    }
    anchorSamples.push(out.length / 2 - 1);
  }
  return { pts: new Float64Array(out), vertexSample, anchorSamples };
}

function smooth(original: Float64Array, weights: Float64Array, alpha: number): Float64Array {
  const n = original.length / 2;
  const isTooShort = n < 5;
  if (isTooShort) return Float64Array.from(original);
  const out = new Float64Array(original.length);
  const b = 3;
  const band = new Float64Array(n * (b + 1));
  // D3 rows: [-1, 3, -3, 1] over samples r..r+3.
  const c = [-1, 3, -3, 1];
  for (let r = 0; r + 3 < n; r++) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j <= i; j++) band[(r + i) * (b + 1) + (i - j)] += alpha * c[i] * c[j];
    }
  }
  for (let i = 0; i < n; i++) band[i * (b + 1)] += weights[i];
  const rx = new Float64Array(n);
  const ry = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rx[i] = weights[i] * original[2 * i];
    ry[i] = weights[i] * original[2 * i + 1];
  }
  solveBand(n, b, band, [rx, ry]);
  for (let i = 0; i < n; i++) {
    out[2 * i] = rx[i];
    out[2 * i + 1] = ry[i];
  }
  return out;
}

/** Signed curvature at each sample from the turn between chords `k` samples either side. */
export function curvatureOf(xy: Float64Array, s: Float64Array, k = 5): Float64Array {
  const n = xy.length / 2;
  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k);
    const b = Math.min(n - 1, i + k);
    const isEnd = a === i || b === i;
    if (isEnd) continue;
    const h1 = Math.atan2(xy[2 * i + 1] - xy[2 * a + 1], xy[2 * i] - xy[2 * a]);
    const h2 = Math.atan2(xy[2 * b + 1] - xy[2 * i + 1], xy[2 * b] - xy[2 * i]);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    kappa[i] = d / ((s[b] - s[a]) / 2);
  }
  // The ends take their neighbour's value (no chord on one side).
  for (let i = 0; i < Math.min(k, n); i++) kappa[i] = kappa[Math.min(k, n - 1)];
  for (let i = Math.max(0, n - k); i < n; i++) kappa[i] = kappa[Math.max(0, n - 1 - k)];
  return kappa;
}

export function alignPlan(input: PlanInput, epsilon = MAX_LATERAL_SHIFT.value): PlanAlignment {
  const { pts, vertexSample, anchorSamples } = resample(input);
  const n = pts.length / 2;
  const weights = new Float64Array(n).fill(1);
  for (const a of anchorSamples) weights[a] = ANCHOR_WEIGHT;
  // The line the smoothing pulls towards: OSM, except at pinned samples (a structure's deck line).
  const target = Float64Array.from(pts);
  const pinned = new Uint8Array(n);
  // Shifted samples (PlanInput.offset): the target moves off OSM along its left normal (±3 samples).
  const shifted = new Uint8Array(n);
  const offset = input.offset;
  // The OSM line's left normal at each shifted sample (±3 samples).
  const normal = new Float64Array(2 * n);
  if (offset) {
    for (let i = 0; i < n; i++) {
      const isShifted = Math.abs(offset[i] ?? 0) > 1e-9;
      if (!isShifted) continue;
      const a = Math.max(0, i - 3);
      const b = Math.min(n - 1, i + 3);
      const tx = pts[2 * b] - pts[2 * a];
      const ty = pts[2 * b + 1] - pts[2 * a + 1];
      const len = Math.hypot(tx, ty) || 1;
      normal[2 * i] = -ty / len;
      normal[2 * i + 1] = tx / len;
      target[2 * i] = pts[2 * i] + normal[2 * i] * offset[i];
      target[2 * i + 1] = pts[2 * i + 1] + normal[2 * i + 1] * offset[i];
      shifted[i] = 1;
    }
  }
  if (input.pin) {
    for (let i = 0; i < n; i++) {
      const p = input.pin(pts[2 * i], pts[2 * i + 1]);
      if (p === null) continue;
      target[2 * i] = p[0];
      target[2 * i + 1] = p[1];
      weights[i] = ANCHOR_WEIGHT;
      pinned[i] = 1;
      shifted[i] = 0;
    }
  }
  const alpha = (SMOOTH_SCALE_M / SAMPLE_M) ** 6;
  const base = Float64Array.from(weights);
  // Raise the pull towards the line held to (OSM, or its shifted target) where the shift exceeds ε,
  // until none does.
  const fit = () => {
    weights.set(base);
    let line = smooth(target, weights, alpha);
    for (let iter = 0; iter < 40; iter++) {
      let worst = 0;
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const d = Math.hypot(line[2 * i] - target[2 * i], line[2 * i + 1] - target[2 * i + 1]);
        worst = Math.max(worst, d);
        const isOver = d > epsilon * 0.97;
        if (isOver) weights[i] *= 4 * (d / epsilon) ** 2;
      }
      if (worst <= epsilon * 0.97) break;
      line = smooth(target, weights, alpha);
    }
    return line;
  };
  let xy = fit();
  // The shifted samples moved by what the smoothing left of the offset: the target takes what it gave
  // back (along the normal, only where it fell short), and the line is fitted again.
  const isCorrected = offset !== undefined && shifted.some((v) => v === 1);
  for (let pass = 0; isCorrected && pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      if (!shifted[i]) continue;
      const got =
        (xy[2 * i] - pts[2 * i]) * normal[2 * i] + (xy[2 * i + 1] - pts[2 * i + 1]) * normal[2 * i + 1];
      const want = offset[i];
      const isShort = Math.sign(got) !== Math.sign(want) || Math.abs(got) < Math.abs(want);
      if (!isShort) continue;
      target[2 * i] += normal[2 * i] * (want - got);
      target[2 * i + 1] += normal[2 * i + 1] * (want - got);
    }
    xy = fit();
  }
  let clamped = 0;
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    let dx = xy[2 * i] - target[2 * i];
    let dy = xy[2 * i + 1] - target[2 * i + 1];
    const d = Math.hypot(dx, dy);
    // Last resort: pull a stubborn sample back onto the ε circle (a tiny kink, never seen so far).
    const isOver = d > epsilon;
    if (isOver) {
      dx *= epsilon / d;
      dy *= epsilon / d;
      xy[2 * i] = target[2 * i] + dx;
      xy[2 * i + 1] = target[2 * i + 1] + dy;
      clamped++;
    }
  }
  for (const a of anchorSamples) {
    xy[2 * a] = target[2 * a];
    xy[2 * a + 1] = target[2 * a + 1];
  }
  // Pinned samples exactly on the structure's line (the smoothing holds them to ~1e-6 m).
  for (let i = 0; i < n; i++) {
    if (!pinned[i]) continue;
    xy[2 * i] = target[2 * i];
    xy[2 * i + 1] = target[2 * i + 1];
  }
  let maxShift = 0;
  let pinnedShift = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(xy[2 * i] - pts[2 * i], xy[2 * i + 1] - pts[2 * i + 1]);
    if (pinned[i]) pinnedShift = Math.max(pinnedShift, d);
    else if (!shifted[i]) maxShift = Math.max(maxShift, d);
  }
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++)
    s[i] = s[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
  return {
    xy,
    original: pts,
    s,
    kappa: curvatureOf(xy, s),
    vertexSample,
    maxShiftM: maxShift,
    clamped,
    pinned,
    pinnedShiftM: pinnedShift,
    shifted,
  };
}

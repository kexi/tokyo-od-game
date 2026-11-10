import {
  COMPOSITE_GRADE,
  type DesignSpeed,
  MAX_SUPERELEVATION,
  TRANSITION_LENGTH,
} from "../law/roadStandards";
import { SIDE_FRICTION } from "./assumptions";

/**
 * Superelevation (設計書 4.3 の 4): e = clamp(V²/(127R) − f, 0, 10 %), run in linearly over the
 * 第18条 transition length (a box filter of that length turns a step into a linear ramp of exactly
 * that length). The sign follows the curve: `bank` is the rise of the left edge per metre of width,
 * so a right-hand curve (outer edge on the left) has a positive bank. P1 computes and checks it; the
 * deck uses it only behind a flag because it changes what the car feels (設計書 4.3).
 */

export function targetSuperelevation(V: DesignSpeed, kappa: number): number {
  const R = 1 / Math.max(Math.abs(kappa), 1e-9);
  const e = (V * V) / (127 * R) - SIDE_FRICTION.value;
  const clamped = Math.min(MAX_SUPERELEVATION.value.type1to3, Math.max(0, e));
  return kappa > 0 ? -clamped : clamped;
}

export type BankEnds = { start: number | null; end: number | null };

/**
 * Bank at each sample (arc length `s`). `ends` pins the value at either end (a junction takes its
 * parent's bank, a ground end 0). `room`, if given, caps |bank| per sample (what 第25条 leaves
 * beside the grade there). Last, the bank is made to change no faster than 10 % over the 第18条
 * length anywhere, pins included, by forward and backward passes.
 */
export function superelevation(
  V: DesignSpeed,
  kappa: Float64Array,
  s: Float64Array,
  ends: BankEnds,
  room?: Float64Array,
): Float64Array {
  const n = kappa.length;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = targetSuperelevation(V, kappa[i]);
  const L = TRANSITION_LENGTH.value[V];
  // Box filter of length L over arc length (prefix sums on the non-uniform samples).
  const prefix = new Float64Array(n);
  for (let i = 1; i < n; i++) prefix[i] = prefix[i - 1] + ((raw[i] + raw[i - 1]) / 2) * (s[i] - s[i - 1]);
  const integral = (x: number) => {
    const isBefore = x <= s[0];
    if (isBefore) return raw[0] * (x - s[0]);
    const isAfter = x >= s[n - 1];
    if (isAfter) return prefix[n - 1] + raw[n - 1] * (x - s[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - s[lo]) / (s[hi] - s[lo] || 1);
    const v = raw[lo] + (raw[hi] - raw[lo]) * t;
    return prefix[lo] + ((raw[lo] + v) / 2) * (x - s[lo]);
  };
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = (integral(s[i] + L / 2) - integral(s[i] - L / 2)) / L;
  if (room) for (let i = 0; i < n; i++) bank[i] = Math.max(-room[i], Math.min(room[i], bank[i]));
  const rate = (MAX_SUPERELEVATION.value.type1to3 / L) * 0.999;
  if (ends.start !== null) bank[0] = ends.start;
  if (ends.end !== null) bank[n - 1] = ends.end;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) {
      const d = rate * (s[i] - s[i - 1]);
      const isPinned = i === n - 1 && ends.end !== null;
      if (!isPinned) bank[i] = Math.max(bank[i - 1] - d, Math.min(bank[i - 1] + d, bank[i]));
    }
    for (let i = n - 2; i >= 0; i--) {
      const d = rate * (s[i + 1] - s[i]);
      const isPinned = i === 0 && ends.start !== null;
      if (!isPinned) bank[i] = Math.max(bank[i + 1] - d, Math.min(bank[i + 1] + d, bank[i]));
    }
  }
  if (room) for (let i = 0; i < n; i++) bank[i] = Math.max(-room[i], Math.min(room[i], bank[i]));
  return bank;
}

/** Composite grade √(g² + e²) (第25条). */
export function compositeGrade(grade: number, bank: number): number {
  return Math.hypot(grade, bank);
}

export function compositeLimit(V: DesignSpeed): number {
  return COMPOSITE_GRADE.value[V];
}

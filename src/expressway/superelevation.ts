import {
  COMPOSITE_GRADE,
  type DesignSpeed,
  MAX_SUPERELEVATION,
  TRANSITION_LENGTH,
} from "../law/roadStandards";
import { SIDE_FRICTION } from "./assumptions";

/**
 * Superelevation (knowledge/road-redesign-plan.md 4.3 の 4): e = clamp(V²/(127R) − f, 0, 10 %), run in linearly over the
 * 第18条 transition length (a box filter of that length turns a step into a linear ramp of exactly
 * that length). The sign follows the curve: `bank` is the rise of the left edge per metre of width,
 * so a right-hand curve (outer edge on the left) has a positive bank. P1 computes and checks it; the
 * deck uses it only behind a flag because it changes what the car feels (knowledge/road-redesign-plan.md 4.3).
 */

export function targetSuperelevation(V: DesignSpeed, kappa: number): number {
  const R = 1 / Math.max(Math.abs(kappa), 1e-9);
  const e = (V * V) / (127 * R) - SIDE_FRICTION.value;
  const clamped = Math.min(MAX_SUPERELEVATION.value.type1to3, Math.max(0, e));
  return kappa > 0 ? -clamped : clamped;
}

export type BankEnds = { start: number | null; end: number | null };

export type BankOptions = {
  /** Caps |bank| per sample (what 第25条 leaves beside the grade there). */
  room?: Float64Array;
  /**
   * Bank per sample taken from another deck of the same surface (NaN where free): a ramp from its
   * nose to where it leaves the parent, or two carriageways on one slab.
   */
  pins?: Float64Array;
  /** Design speed whose 第18条 length sets the run-in (default: the highest of `V`). */
  transitionV?: DesignSpeed;
  /**
   * Hold 第25条 over the pins too (another deck's bank is cut to what the grade here leaves), and run
   * the run-in passes and the room's cut again until neither moves: the room's last cut no longer
   * steepens a run-in it was not part of (S6 PR 2: the short ramps at grade, 11.63 % composite and
   * 2.90‰/m run-ins). Absent: as before, so the files of a build without runs at grade stay as they were.
   */
  strict?: boolean;
};

/**
 * Bank at each sample (arc length `s`), for the design speed of each sample (a number for all).
 * `ends` pins the value at either end (a junction takes its parent's bank, a ground end 0), and
 * `pins` inside. Last, the bank is made to change no faster than 10 % over the 第18条 length of
 * `transitionV` anywhere, pins kept, by forward and backward passes.
 */
export function superelevation(
  V: DesignSpeed | ArrayLike<DesignSpeed>,
  kappa: Float64Array,
  s: Float64Array,
  ends: BankEnds,
  options: BankOptions = {},
): Float64Array {
  const { room, pins } = options;
  const n = kappa.length;
  const speedAt = (i: number): DesignSpeed => (typeof V === "number" ? V : V[i]);
  let top = speedAt(0);
  for (let i = 1; i < n; i++) top = Math.max(top, speedAt(i)) as DesignSpeed;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = targetSuperelevation(speedAt(i), kappa[i]);
  const L = TRANSITION_LENGTH.value[options.transitionV ?? top];
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
  const pinned = new Uint8Array(n);
  if (pins) {
    for (let i = 0; i < n; i++) {
      const isPin = !Number.isNaN(pins[i]);
      if (!isPin) continue;
      bank[i] = pins[i];
      pinned[i] = 1;
    }
  }
  if (ends.start !== null) {
    bank[0] = ends.start;
    pinned[0] = 1;
  }
  if (ends.end !== null) {
    bank[n - 1] = ends.end;
    pinned[n - 1] = 1;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) {
      const d = rate * (s[i] - s[i - 1]);
      if (!pinned[i]) bank[i] = Math.max(bank[i - 1] - d, Math.min(bank[i - 1] + d, bank[i]));
    }
    for (let i = n - 2; i >= 0; i--) {
      const d = rate * (s[i + 1] - s[i]);
      if (!pinned[i]) bank[i] = Math.max(bank[i + 1] - d, Math.min(bank[i + 1] + d, bank[i]));
    }
  }
  // The pinned values are another deck's (or the parent's) bank: they stay as they are.
  if (room)
    for (let i = 0; i < n; i++) if (!pinned[i]) bank[i] = Math.max(-room[i], Math.min(room[i], bank[i]));
  if (options.strict && room) {
    // The composite grade over every sample, the ends' and the pins' included; then the run-ins again
    // from what the cuts left, until a pass changes nothing (each pass only moves a bank towards 0).
    // An end held to its parent's bank stays (T3): the parent's own bank kept its room there.
    const isHeld = (i: number) => (i === 0 && ends.start !== null) || (i === n - 1 && ends.end !== null);
    for (let i = 0; i < n; i++) if (!isHeld(i)) bank[i] = Math.max(-room[i], Math.min(room[i], bank[i]));
    for (let pass = 0; pass < 50; pass++) {
      let moved = false;
      for (let i = 1; i < n; i++) {
        const d = rate * (s[i] - s[i - 1]);
        const v = Math.max(bank[i - 1] - d, Math.min(bank[i - 1] + d, bank[i]));
        const toward = Math.abs(v) < Math.abs(bank[i]) ? v : bank[i];
        if (toward !== bank[i] && !isHeld(i)) {
          bank[i] = toward;
          moved = true;
        }
      }
      for (let i = n - 2; i >= 0; i--) {
        const d = rate * (s[i + 1] - s[i]);
        const v = Math.max(bank[i + 1] - d, Math.min(bank[i + 1] + d, bank[i]));
        const toward = Math.abs(v) < Math.abs(bank[i]) ? v : bank[i];
        if (toward !== bank[i] && !isHeld(i)) {
          bank[i] = toward;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return bank;
}

/** Composite grade √(g² + e²) (第25条). */
export function compositeGrade(grade: number, bank: number): number {
  return Math.hypot(grade, bank);
}

export function compositeLimit(V: DesignSpeed): number {
  return COMPOSITE_GRADE.value[V];
}

/**
 * One column of faces on a mount, top to bottom: each 本板 with its 補助標識 right under it.
 * Pure (sizes in, centre heights out); src/signs/mount.ts decides where the column's top is and how
 * many columns a mount needs (G4). This was G2's stackPlates, which also chose the heights.
 *
 * Why the 補助標識 go right under their own plate and not all under the lowest one, as the Canvas
 * notes did: on a shared post the lowest plate may be another sign (the ward's 通学路 plate under a
 * timed 歩行者専用), and the hours would read as its own (交通規制基準 第2章 9 (2) ウ (ア): each
 * 本板's 補助板 goes under that 本板).
 */
import { AUX_GAP as AUX_GAP_ASSUMED, PLATE_GAP as PLATE_GAP_ASSUMED } from "./mountAssumptions";

/** Between a plate and the 補助標識 under it, m (mountAssumptions.ts). */
export const AUX_GAP = AUX_GAP_ASSUMED.value;
/** Between one 本板 (or its 補助標識) and the next 本板 below it, m (inside 交通規制基準's 10–15 cm). */
export const PLATE_GAP = PLATE_GAP_ASSUMED.value;

/** A plate as drawn (scaled) and the 補助標識 under it, top to bottom: heights in metres. */
export type StackInput = { height: number; aux: readonly number[] };

/** One placed face: which plate (and which of its 補助標識, or null for the plate) and its centre height. */
export type StackPlace = { plate: number; aux: number | null; y: number; height: number };

/** Top edge of the first face to the bottom edge of the last, m. */
export function columnHeight(plates: readonly StackInput[]): number {
  let h = 0;
  for (const [i, p] of plates.entries()) {
    h += (i > 0 ? PLATE_GAP : 0) + p.height;
    for (const a of p.aux) h += AUX_GAP + a;
  }
  return h;
}

/** The faces of `plates` hung from `top` (the top edge of the first plate, m above the ground). */
export function stackColumn(top: number, plates: readonly StackInput[]): StackPlace[] {
  const placed: StackPlace[] = [];
  let bottom = top;
  for (const [level, p] of plates.entries()) {
    const y = bottom - (level > 0 ? PLATE_GAP : 0) - p.height / 2;
    placed.push({ plate: level, aux: null, y, height: p.height });
    bottom = y - p.height / 2;
    for (const [i, h] of p.aux.entries()) {
      const auxY = bottom - AUX_GAP - h / 2;
      placed.push({ plate: level, aux: i, y: auxY, height: h });
      bottom = auxY - h / 2;
    }
  }
  return placed;
}

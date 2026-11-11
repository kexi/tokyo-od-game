import { describe, expect, it } from "vitest";
import { AUX_GAP, PLATE_GAP, columnHeight, stackColumn, type StackInput } from "../src/signs/stack";

/**
 * One column of faces (src/signs/stack.ts): hung from the given top, plates never overlap, each
 * 補助標識 hangs right under its own plate, the next 本板 goes 10–15 cm under (交通規制基準 第2章 9
 * (2) ウ (ウ)), and columnHeight is exactly the span the faces take.
 */

/** Plate heights as drawn: 60 cm circle and 326-A at 1.25×, 菱形 box at 1.3×, 逆三角, 327 lanes. */
const PLATES = [0.75, 0.4375, 0.6364 * 1.3, 0.6928 * 1.25, 1.125];
/** 補助標識 under a plate: none, or the 22 / 32 / 44 cm plates at 1.25×. */
const AUX: number[][] = [[], [0.275], [0.4], [0.55]];

/** Every column of one or two plates, each with any of the 補助標識 sets. */
function columns(): StackInput[][] {
  const one = PLATES.flatMap((height) => AUX.map((aux) => ({ height, aux })));
  const out: StackInput[][] = one.map((p) => [p]);
  for (const a of one) for (const b of one) out.push([a, b]);
  return out;
}

const top = (f: { y: number; height: number }) => f.y + f.height / 2;
const bottomOf = (f: { y: number; height: number }) => f.y - f.height / 2;

describe("one column of faces (stackColumn)", () => {
  it("starts at the given top and spans exactly columnHeight", () => {
    for (const col of columns()) {
      const placed = stackColumn(3, col);
      expect(top(placed[0])).toBeCloseTo(3, 9);
      expect(3 - bottomOf(placed[placed.length - 1])).toBeCloseTo(columnHeight(col), 9);
    }
  });

  it("never overlap, top to bottom", () => {
    for (const col of columns()) {
      const placed = stackColumn(4, col);
      for (let i = 1; i < placed.length; i++)
        expect(top(placed[i]), JSON.stringify(col)).toBeLessThanOrEqual(bottomOf(placed[i - 1]) + 1e-9);
    }
  });

  it("hang each 補助標識 AUX_GAP under its own plate, and the next plate PLATE_GAP (10–15 cm) under", () => {
    expect(PLATE_GAP).toBeGreaterThanOrEqual(0.1);
    expect(PLATE_GAP).toBeLessThanOrEqual(0.15);
    for (const col of columns()) {
      const placed = stackColumn(4, col);
      for (const [i, f] of placed.entries()) {
        if (i === 0) continue;
        const above = placed[i - 1];
        const gap = bottomOf(above) - top(f);
        if (f.aux === null) {
          expect(f.plate).toBe(above.plate + 1);
          expect(gap).toBeCloseTo(PLATE_GAP, 9);
          continue;
        }
        expect(above.plate).toBe(f.plate);
        expect(gap).toBeCloseTo(AUX_GAP, 9);
      }
    }
  });
});

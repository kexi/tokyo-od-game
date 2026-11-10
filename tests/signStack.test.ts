import { describe, expect, it } from "vitest";
import { AUX_GAP, POST_TOP, STACK, stackPlates, type StackInput } from "../src/signs/stack";

/**
 * Where the faces of one sign post go (src/signs/stack.ts): plates never overlap, each 補助標識
 * hangs right under its own plate, nothing reaches below the ground, and a post without 補助標識
 * keeps the heights it had before G2.
 */

/** Plate heights as drawn: 60 cm circle and 326-A at 1.25×, 菱形 box at 1.3×, 逆三角, 327 lanes. */
const PLATES = [0.75, 0.4375, 0.6364 * 1.3, 0.6928 * 1.25, 1.125];
/** 補助標識 under a plate: none, or the 22 / 32 / 44 cm plates at 1.25×. */
const AUX: number[][] = [[], [0.275], [0.4], [0.55]];

/** Every post of one to three plates, each with any of the 補助標識 sets. */
function posts(): StackInput[][] {
  const one = PLATES.flatMap((height) => AUX.map((aux) => ({ height, aux })));
  const out: StackInput[][] = one.map((p) => [p]);
  for (const a of one) for (const b of one) out.push([a, b]);
  for (const a of one.filter((_, i) => i % 3 === 0))
    for (const b of one.filter((_, i) => i % 2 === 0)) for (const c of one) out.push([a, b, c]);
  return out;
}

const top = (f: { y: number; height: number }) => f.y + f.height / 2;
const bottomOf = (f: { y: number; height: number }) => f.y - f.height / 2;

describe("the faces of a sign post (stackPlates)", () => {
  it("keep the heights posts had before G2 when no 補助標識 hangs on them", () => {
    const { placed } = stackPlates([0.75, 0.75, 0.75].map((height) => ({ height, aux: [] })));
    expect(placed.map((f) => f.y)).toEqual([POST_TOP, POST_TOP - STACK, POST_TOP - 2 * STACK]);
  });

  it("never overlap, top to bottom, and never reach below the ground", () => {
    for (const post of posts()) {
      const { placed } = stackPlates(post);
      for (let i = 1; i < placed.length; i++)
        expect(top(placed[i]), JSON.stringify(post)).toBeLessThanOrEqual(bottomOf(placed[i - 1]) + 1e-9);
      for (const f of placed) expect(bottomOf(f), JSON.stringify(post)).toBeGreaterThanOrEqual(0);
    }
  });

  it("hang each 補助標識 right under its own plate (or under the 補助標識 before it)", () => {
    for (const post of posts()) {
      const { placed } = stackPlates(post);
      for (const [i, f] of placed.entries()) {
        if (f.aux === null) continue;
        const above = placed[i - 1];
        expect(above.plate).toBe(f.plate);
        expect(bottomOf(above) - top(f)).toBeCloseTo(AUX_GAP, 9);
      }
    }
  });

  it("leave off a face that would reach below the ground, and everything under it, and count them", () => {
    const tall = [
      { height: 0.866, aux: [] },
      { height: 0.75, aux: [0.55] },
      { height: 0.625, aux: [] },
    ];
    const { placed, dropped } = stackPlates(tall);
    expect(placed.map((f) => [f.plate, f.aux])).toEqual([
      [0, null],
      [1, null],
      [1, 0],
    ]);
    expect(dropped).toBe(1);
    expect(stackPlates([{ height: 0.75, aux: [0.275] }]).dropped).toBe(0);
  });
});

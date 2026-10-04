import { describe, expect, it } from "vitest";
import { smoothGround } from "../src/world/dem";

const SIZE = 256;
const field = (f: (x: number, y: number) => number) => {
  const a = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) a[y * SIZE + x] = f(x, y);
  return a;
};

describe("ground smoothing of DEM tiles", () => {
  it("removes isolated lumps and pits left by building removal", () => {
    const src = field((x, y) => (x === 100 && y === 80 ? 4.5 : x === 30 && y === 40 ? 1.5 : 3));
    const out = smoothGround(src);
    expect(out[80 * SIZE + 100]).toBeCloseTo(3, 2);
    expect(out[40 * SIZE + 30]).toBeCloseTo(3, 2);
  });

  it("keeps a real step (moat wall, embankment) sharp", () => {
    const out = smoothGround(field((x) => (x < 128 ? 0 : 5)));
    const row = 50 * SIZE;
    expect(out[row + 124]).toBeCloseTo(0, 3);
    expect(out[row + 131]).toBeCloseTo(5, 3);
    // The transition stays within one pixel either side of the edge (~4 m at z15).
    expect(out[row + 126]).toBeCloseTo(0, 3);
    expect(out[row + 129]).toBeCloseTo(5, 3);
  });

  it("leaves a steady slope where it is", () => {
    const out = smoothGround(field((x) => x * 0.1));
    expect(out[60 * SIZE + 100]).toBeCloseTo(10, 3);
  });
});

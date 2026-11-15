import { describe, expect, it } from "vitest";
import { slope, slopeSummary, type MemorySample } from "../scripts/qa/memorySlopes";

/** A run sampled every 10 s: heap and backing from `f(t)`, the near LRU's held MB from `held(t)`. */
const run = (f: (t: number) => number, held: (t: number) => number, maxMb = 25.2): MemorySample[] =>
  Array.from({ length: 60 }, (_, i) => {
    const t = (i + 1) * 10;
    return { t, heapGcMB: f(t), backingMB: f(t) / 2, near: { mb: held(t), maxMb } };
  });

/** The saw: full (held 26 MB) before 300 s and from 400 to 500 s, at the lower bound (15 MB) otherwise. */
const isFull = (t: number) => t < 300 || (t >= 400 && t < 500);

describe("the memory run's slopes", () => {
  it("is the least-squares line, and none for fewer than 3 points", () => {
    expect(
      slope([
        [0, 1],
        [10, 3],
        [20, 5],
      ]),
    ).toBe(0.2);
    expect(
      slope([
        [0, 1],
        [10, 3],
      ]),
    ).toBeNull();
  });

  it("reads a saw (full, then at the lower bound) flatter over all samples than over the full ones", () => {
    // 0.2 MB/s of growth, plus 80 MB more whenever the LRU is full (held 26 MB) than at its lower bound (15 MB).
    const samples = run(
      (t) => 400 + 0.2 * t + (isFull(t) ? 80 : 0),
      (t) => (isFull(t) ? 26 : 15),
    );
    const s = slopeSummary(samples);
    expect(s.full.heap).toBeCloseTo(0.2, 2);
    expect(s.all.heap ?? 0).toBeLessThan(0.1);
    expect(s.full.total).toBeCloseTo(0.3, 2);
    expect(s.full.share).toBeGreaterThan(0);
    expect(s.full.share).toBeLessThan(1);
  });

  it("starts the plateau window where the LRU first holds 95 % of its most, and writes its rules", () => {
    const s = slopeSummary(
      run(
        (t) => 100 + t,
        (t) => Math.min(380, t),
      ),
    );
    expect(s.plateau.fromS).toBe(370);
    expect(s.rules).toEqual({ fromS: 60, plateauShare: 0.95, fullShare: 0.95 });
    expect(s.all.samples).toBe(55);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOAD_HOLD_MS, startLoad, stepLoad, type LoadState } from "../src/world/loadProgress";

/** Steps a state through frames of [ms, remaining, finished]. */
const run = (frames: Array<[number, number, number]>, state: LoadState = startLoad(0)) =>
  frames.reduce((s, [t, remaining, finished]) => stepLoad(s, { remaining, finished }, t), state);

describe("the buildings' load progress", () => {
  it("stays under 1 while a single tile remains", () => {
    const s = run([
      [0, 10, 0],
      [100, 1, 9],
    ]);
    expect(s.progress).toBeLessThan(1);
    expect(s.progress).toBeCloseTo(0.9, 5);
  });

  it("stays under 1 when none remain until the hold has passed, and holds again from a new rise", () => {
    const zero = run([
      [0, 5, 0],
      [100, 0, 5],
      [100 + LOAD_HOLD_MS - 1, 0, 5],
    ]);
    expect(zero.progress).toBeLessThan(1);
    // The next JSON level queued within the hold: the hold starts over when it is done.
    const again = run(
      [
        [150 + LOAD_HOLD_MS, 2, 5],
        [200 + LOAD_HOLD_MS, 0, 7],
        [200 + 2 * LOAD_HOLD_MS - 1, 0, 7],
      ],
      zero,
    );
    expect(again.progress).toBeLessThan(1);
    expect(stepLoad(again, { remaining: 0, finished: 7 }, 200 + 2 * LOAD_HOLD_MS).progress).toBe(1);
  });

  it("is 1 once nothing has remained for the hold", () => {
    expect(
      run([
        [0, 3, 0],
        [100, 0, 3],
        [100 + LOAD_HOLD_MS, 0, 3],
      ]).progress,
    ).toBe(1);
  });

  it("reaches 1 with failed or refused tiles, which are not remaining", () => {
    // 3 tiles, one of them failed: finished counts the failure (load-error), remaining is 0.
    expect(
      run([
        [0, 3, 0],
        [100, 0, 3],
        [100 + LOAD_HOLD_MS, 0, 3],
      ]).progress,
    ).toBe(1);
  });

  it("starts a new load from 0 however many tiles were finished before (a warp's 95 % is of this load)", () => {
    const before = run([
      [0, 400, 0],
      [1000, 0, 400],
      [2000, 0, 400],
    ]);
    expect(before.progress).toBe(1);
    const warped = stepLoad(before, { remaining: 20, finished: 400 }, 3000);
    expect(warped.progress).toBe(0);
    expect(stepLoad(warped, { remaining: 1, finished: 419 }, 3100).progress).toBeCloseTo(19 / 20, 5);
  });
});

const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");

describe("where the game reads the buildings' progress", () => {
  it("goes through Buildings: nothing outside it reads the library's loadProgress", () => {
    // `tiles.loadProgress` / `far.loadProgress` (a renderer's property) may appear only in buildings.ts's own entry points.
    for (const file of ["src/main.ts", "src/debug/viewHooks.ts"]) {
      expect(read(file), file).not.toMatch(/\.(tiles|far)\??\.loadProgress\b/);
    }
    const buildings = read("src/world/buildings.ts");
    expect(buildings).not.toMatch(/\.(tiles|far)\??\.loadProgress\b/);
  });
});

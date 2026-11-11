import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clockStep, MAX_FRAME_S } from "../src/game/frameClock";

/**
 * The frames of a QA run: `__game.advance` steps at performance.now() while requestAnimationFrame
 * keeps firing with its frame-start timestamps, which can lie before the last advance step.
 */
function interleaved(): number[] {
  const calls: number[] = [];
  let clock = 1000;
  for (let frame = 0; frame < 200; frame++) {
    const frameStart = clock;
    // Two advance steps inside the frame (each reads the clock a little later) ...
    clock += 6;
    calls.push(clock);
    clock += 7;
    calls.push(clock);
    // ... then the frame's own rAF callback, stamped with the frame's start.
    calls.push(frameStart);
    clock += 4;
  }
  return calls;
}

function run(calls: number[], start: number) {
  let last = start;
  const steps: number[] = [];
  for (const now of calls) {
    const next = clockStep(now, last);
    steps.push(next.dt);
    last = next.last;
  }
  return { steps, last };
}

describe("clockStep: the game's frame time step from two callers (rAF and advance)", () => {
  it("never steps back in time: a rAF frame stamped before the last advance step takes 0 s", () => {
    const { steps } = run(interleaved(), 1000);
    expect(Math.min(...steps)).toBe(0);
    expect(steps.filter((dt) => dt === 0).length).toBe(200);
  });

  it("adds up to the wall time, so physics (all steps) and the traffic AI (steps > 0 only) keep one clock", () => {
    const calls = interleaved();
    const { steps, last } = run(calls, 1000);
    const wall = (last - 1000) / 1000;
    const all = steps.reduce((a, dt) => a + dt, 0);
    // The traffic AI moves its cars only on frames with time (traffic-ai.ts drive: dt ≤ 0 returns):
    // the car at 11 m/s covers what the player's car at 11 m/s covers.
    const withTime = steps.filter((dt) => dt > 0).reduce((a, dt) => a + dt, 0);
    expect(all).toBeCloseTo(wall, 9);
    expect(withTime).toBeCloseTo(all, 9);
  });

  it("caps a stall at MAX_FRAME_S, and counts the next frame from the stalled one's time", () => {
    const stalled = clockStep(3000, 1000);
    expect(stalled).toEqual({ dt: MAX_FRAME_S, last: 3000 });
    expect(clockStep(3016, stalled.last).dt).toBeCloseTo(0.016, 9);
  });
});

describe("main.ts step: the frame's clock comes from clockStep (source check)", () => {
  const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");
  const start = main.indexOf("const step = (stamp: number) => {");
  const head = main.slice(start, start + 600);

  it("takes the frame's stamp, and its dt and its time (now) only from clockStep", () => {
    expect(start).toBeGreaterThan(0);
    expect(head).toMatch(/const clock = clockStep\(stamp, last\);/);
    expect(head).toMatch(/const dt = clock\.dt;/);
    expect(head).toMatch(/const now = clock\.last;/);
    expect(head).toMatch(/last = clock\.last;/);
  });

  it("works out no dt from a stamp itself anywhere in main.ts (rAF after advance made it negative)", () => {
    expect(main).not.toMatch(/\((?:now|stamp) - last\) \/ 1000/);
  });
});

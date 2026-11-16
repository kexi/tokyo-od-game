import { describe, expect, it } from "vitest";
import { windowStats } from "../scripts/qa/shader-prebuild";

describe("measure-shader-prebuild's window (scripts/qa/shader-prebuild.ts)", () => {
  const page = {
    frames: [0, 16, 32, 132, 148, 448, 464],
    readyAt: 0,
    compiled: null,
    skipped: true,
    pipelines: { n: 3, at: [10, 140, 500] },
  };

  it("counts only the gaps whose frame ends inside the window, against each threshold", () => {
    // Gaps ending at 16, 32, 132 (100 ms), 148, 448 (300 ms); 464 is past the window.
    const s = windowStats(page, 1, 460);
    expect(s.frames).toBe(5);
    expect(s).toMatchObject({ over50: 2, over100: 1, over250: 1 });
  });

  it("names the longest gap and when it ended, from the window's start", () => {
    const s = windowStats(page, 100, 460);
    expect(s.longestMs).toBe(300);
    expect(s.longestAtMs).toBe(348);
  });

  it("counts the pipelines built inside the window only", () => {
    expect(windowStats(page, 0, 460).pipelines).toBe(2);
    expect(windowStats(page, 460, 600).pipelines).toBe(1);
  });

  it("gives no longest gap for a window without frames", () => {
    expect(windowStats(page, 1000, 2000)).toMatchObject({ frames: 0, longestMs: null, pipelines: 0 });
  });
});

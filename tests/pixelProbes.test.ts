import { describe, expect, it } from "vitest";
import { deriveMetrics, probePixels, probeStats, type ProbeRecord } from "../scripts/qa/pixelProbes";
import { parseViewTable, type RequiredMetric } from "../scripts/qa/viewTable";

describe("pixel probes (pixelProbes.ts)", () => {
  it("gives mean, median, 95th percentile and the bright tail's contrast", () => {
    // 90 asphalt pixels at 60 and 10 paint pixels at 200.
    const lumas = [...Array(90).fill(60), ...Array(10).fill(200)];
    const s = probeStats(lumas);
    expect(s).toEqual({ mean: 74, p50: 60, p95: 200, p99: 200, contrast: 2.333, pixels: 100 });
  });

  it("sees a painted line that covers only 3 % of the rectangle (the bright tail is read at p99)", () => {
    const lumas = [...Array(97).fill(60), ...Array(3).fill(200)];
    const s = probeStats(lumas);
    expect(s?.p95).toBe(60);
    expect(s?.contrast).toBeGreaterThan(2);
  });

  it("reports nothing for an empty rectangle", () => {
    expect(probeStats([])).toBeNull();
  });

  it("turns a fractional rectangle into whole pixels inside the image", () => {
    expect(probePixels({ name: "road", rect: [0.25, 0.5, 0.75, 1] }, 1280, 720)).toEqual({
      x: 320,
      y: 360,
      w: 640,
      h: 360,
    });
    const edge = probePixels({ name: "edge", rect: [0.999, 0.999, 1, 1] }, 100, 100);
    expect(edge.w).toBeGreaterThanOrEqual(1);
    expect(edge.x).toBeLessThan(100);
  });
});

const stats = (mean: number, p50 = mean) => ({
  mean,
  p50,
  p95: p50 * 2,
  p99: p50 * 3,
  contrast: 2,
  pixels: 10,
});
const records: ProbeRecord[] = [
  { shot: "s.day--front", view: "front", look: "day", probes: { road: stats(100) } },
  { shot: "s.night--front", view: "front", look: "night", probes: { road: stats(20) } },
  { shot: "s.dark--front", view: "front", look: "dark", probes: { road: stats(0) } },
];

describe("metrics computed from probes (deriveMetrics)", () => {
  it("writes a statistic of one look and a ratio of two as review lines naming the shot", () => {
    const metrics: RequiredMetric[] = [
      { name: "luma-day", min: 40, from: { view: "front", probe: "road", stat: "mean", look: "day" } },
      {
        name: "night-over-day",
        min: 0.05,
        max: 0.5,
        from: { view: "front", probe: "road", stat: "mean", look: "night", over: "day" },
      },
      { name: "by-hand", min: 1 },
    ];
    expect(deriveMetrics(metrics, records, 3)).toEqual([
      { type: "metric", name: "luma-day", round: 3, value: 100, min: 40, view: "s.day--front" },
      {
        type: "metric",
        name: "night-over-day",
        round: 3,
        value: 0.2,
        min: 0.05,
        max: 0.5,
        view: "s.night--front",
      },
    ]);
  });

  it("leaves out a metric it cannot measure, so check-convergence reports it missing (fail-closed)", () => {
    const metrics: RequiredMetric[] = [
      { name: "no-shot", min: 1, from: { view: "side", probe: "road", stat: "mean", look: "day" } },
      {
        name: "over-black",
        min: 1,
        from: { view: "front", probe: "road", stat: "mean", look: "day", over: "dark" },
      },
    ];
    expect(deriveMetrics(metrics, records, 1)).toEqual([]);
  });
});

describe("computed metrics in a view table", () => {
  const table = (metric: unknown) => ({
    name: "t",
    description: "",
    defaults: { moment: "2026-11-10T11:00:00+09:00", looks: [{ id: "day" }, { id: "night" }] },
    metrics: [metric],
    sessions: [
      {
        id: "s",
        start: [35.68, 139.76],
        views: [
          {
            id: "front",
            camera: "driver",
            at: { lat: 35.68, lon: 139.76, headingDeg: 0 },
            probes: [{ name: "road", rect: [0.3, 0.7, 0.7, 0.98] }],
          },
        ],
      },
    ],
  });

  it("accepts a metric that names an existing probe and looks", () => {
    expect(() =>
      parseViewTable(
        table({
          name: "m",
          min: 0,
          from: { view: "front", probe: "road", stat: "mean", look: "night", over: "day" },
        }),
      ),
    ).not.toThrow();
  });

  it("refuses a metric naming a probe, view or look the table does not have", () => {
    expect(() =>
      parseViewTable(table({ name: "m", min: 0, from: { view: "front", probe: "sky", stat: "mean" } })),
    ).toThrow(/no probe sky/);
    expect(() =>
      parseViewTable(
        table({ name: "m", min: 0, from: { view: "front", probe: "road", stat: "mean", look: "dusk" } }),
      ),
    ).toThrow(/no look dusk/);
  });
});

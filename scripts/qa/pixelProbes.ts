// Pixel probes of the multi-view review (knowledge/review-loop.md「画素の指標」): the luminance of
// rectangles of a saved frame, and the table's metrics computed from them (a road's night / day
// brightness, a marking's contrast on the road). Pure: views.ts reads the pixels (in the browser,
// which decodes the JPEG) and hands the lumas here.
import type { Probe, RequiredMetric } from "./viewTable.ts";

export type ProbeStats = {
  /** Mean Rec. 709 luma of the rectangle, 0–255 (sRGB-encoded values, as the image holds them). */
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  /**
   * (p99 − p50) / p50: how far the bright tail (painted lines, lit spots) stands above the typical
   * pixel (the asphalt). About 0 for an even surface. Why not p95 (the first version): a lane line
   * is 2–5 % of a road rectangle, so the 95th percentile still fell on the asphalt.
   */
  contrast: number;
  pixels: number;
};

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Luma of an sRGB pixel (0–255), Rec. 709 weights. */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The statistics of a rectangle's lumas; null for an empty one. */
export function probeStats(lumas: ArrayLike<number>): ProbeStats | null {
  const n = lumas.length;
  if (n === 0) return null;
  const sorted = Float64Array.from(lumas).toSorted();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const p50 = at(0.5);
  const p95 = at(0.95);
  const p99 = at(0.99);

  return {
    mean: round(sum / n),
    p50: round(p50),
    p95: round(p95),
    p99: round(p99),
    contrast: round((p99 - p50) / Math.max(p50, 1)),
    pixels: n,
  };
}

/** A rectangle in whole pixels of a width × height image (at least one pixel). */
export function probePixels(probe: Probe, width: number, height: number) {
  const [x0, y0, x1, y1] = probe.rect;
  const left = Math.min(width - 1, Math.floor(x0 * width));
  const top = Math.min(height - 1, Math.floor(y0 * height));
  return {
    x: left,
    y: top,
    w: Math.max(1, Math.round(x1 * width) - left),
    h: Math.max(1, Math.round(y1 * height) - top),
  };
}

/** What a round measured: per view and look, per probe. Look null: the session has no matrix. */
export type ProbeRecord = {
  /** The shot key (session.look--view) the metric line names. */
  shot: string;
  view: string;
  look: string | null;
  probes: Record<string, ProbeStats | null>;
};

export type MetricLine = {
  type: "metric";
  name: string;
  round: number;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  view?: string;
};

/**
 * The review lines of the table's computed metrics (those with `from`). A metric whose inputs were
 * not measured (a failed shot, a dark denominator) is left out: check-convergence then reports it
 * missing, which keeps the round from counting as quiet (fail-closed).
 */
export function deriveMetrics(
  metrics: readonly RequiredMetric[],
  records: readonly ProbeRecord[],
  round: number,
): MetricLine[] {
  const recordOf = (view: string, look: string | undefined) =>
    records.find((r) => r.view === view && (look === undefined || r.look === look));
  const statOf = (record: ProbeRecord | undefined, probe: string, stat: keyof ProbeStats) => {
    const stats = record?.probes[probe];
    return stats ? stats[stat] : null;
  };
  const lines: MetricLine[] = [];
  for (const m of metrics) {
    const from = m.from;
    if (!from) continue;
    const record = recordOf(from.view, from.look);
    const value = statOf(record, from.probe, from.stat);
    if (!record || value === null) continue;
    let result = value;
    if (from.over !== undefined) {
      const base = statOf(recordOf(from.view, from.over), from.probe, from.stat);
      const isMeasurable = base !== null && base > 0;
      if (!isMeasurable) continue;
      result = value / base;
    }
    lines.push({
      type: "metric",
      name: m.name,
      round,
      value: Math.round(result * 1000) / 1000,
      ...(m.min !== undefined && { min: m.min }),
      ...(m.max !== undefined && { max: m.max }),
      ...(m.unit !== undefined && { unit: m.unit }),
      view: record.shot,
    });
  }
  return lines;
}

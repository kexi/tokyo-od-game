import { warn } from "../log";

/**
 * The tide in Tokyo from JMA's 潮位表 (東京・晴海, station TK): hourly astronomical predictions per
 * year, as text (https://www.data.jma.go.jp/kaiyou/db/tide/suisan/readme.html), CORS *, ~50 KB.
 * The tidal rivers, canals and the bay rise and fall with it.
 */
export type Tide = {
  /** Mean water level (T.P. m) the tidal surfaces are built at. */
  readonly meanLevel: number;
  /** Largest rise above the mean in the predictions (m): shore walls are built to clear it. */
  readonly amplitude: number;
  /** Predicted tide at a moment, as metres above (or below) the mean level. */
  at(date: Date): number;
};

const URL = (year: number) => `https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/${year}/TK.txt`;
/** 潮位表基準面 of 東京 in T.P. m (JMA 潮位表掲載地点一覧: −1.141 m, i.e. A.P. −0.007 m). */
export const TK_DATUM = -1.141;
/** Mean of the 2026 hourly predictions (120.0 cm above the datum), the same as the 2020–24 MSL. */
export const TK_MEAN = 0.059;
/** Spring high water in the 2026 predictions: 211 cm above the datum, T.P. +0.97 m. */
const TK_AMPLITUDE = 0.97 - TK_MEAN;

/**
 * One year of the JMA tide-table text: a line per day, 24 hourly heights (3 columns each, cm above
 * the datum, JST), then year (2 digits), month, day, station and the high and low waters.
 * Returns T.P. metres per hour from 1 January 00:00 JST.
 */
export function parseTideTable(text: string): { year: number; hourly: Float32Array } | null {
  const lines = text.split("\n").filter((l) => l.length >= 80);
  if (lines.length < 365) return null;
  const year = 2000 + Number(lines[0].slice(72, 74));
  const hourly = new Float32Array(lines.length * 24);
  for (const [d, line] of lines.entries()) {
    for (let h = 0; h < 24; h++) hourly[d * 24 + h] = Number(line.slice(h * 3, h * 3 + 3)) / 100 + TK_DATUM;
  }
  const isValid = Number.isFinite(year) && hourly.every((v) => Number.isFinite(v));
  return isValid ? { year, hourly } : null;
}

/** Hours since 1 January 00:00 JST of the date's (JST) year, and that year. */
export function jstHourOfYear(date: Date): { year: number; hours: number } {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  const year = jst.getUTCFullYear();
  return { year, hours: (jst.getTime() - Date.UTC(year, 0, 1)) / 3600_000 };
}

export class TokyoTide implements Tide {
  readonly meanLevel = TK_MEAN;
  readonly amplitude = TK_AMPLITUDE;
  private readonly years = new Map<number, Float32Array | null>();
  private readonly pending = new Set<number>();

  at(date: Date): number {
    const { year, hours } = jstHourOfYear(date);
    const table = this.years.get(year);
    if (table === undefined) {
      this.load(year);
      return 0;
    }
    if (table === null) return 0;
    const i = Math.min(table.length - 2, Math.max(0, Math.floor(hours)));
    const t = Math.min(1, Math.max(0, hours - i));
    return table[i] + (table[i + 1] - table[i]) * t - this.meanLevel;
  }

  /** Fetch a year once; without it (offline, a year JMA has not published) the water stays at the mean. */
  private load(year: number): void {
    if (this.pending.has(year)) return;
    this.pending.add(year);
    fetch(URL(year))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        const parsed = parseTideTable(text);
        this.years.set(year, parsed?.year === year ? parsed.hourly : null);
      })
      .catch((error: unknown) => {
        warn("tide_table_failed", { year, error: String(error) });
        this.years.set(year, null);
      });
  }
}

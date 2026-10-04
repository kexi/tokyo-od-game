import { JMA } from "../config";
import { warn } from "../log";
import type { Observation } from "./environment";

type AmedasValue = [number | null, number] | undefined;

/** Latest 10-minute AMeDAS observation at Tokyo (Kitanomaru). JMA serves these with CORS `*`. */
export async function fetchTokyoObservation(): Promise<Observation | null> {
  try {
    const latest = (await (await fetch(JMA.latestTime)).text()).trim();
    const stamp = latest.slice(0, 19).replace(/[-T:]/g, "");
    const map = (await (await fetch(JMA.map(stamp))).json()) as Record<string, Record<string, AmedasValue>>;
    const s = map[JMA.tokyoStation];
    if (!s) return null;
    const value = (v: AmedasValue) => (v && v[0] !== null ? v[0] : null);
    // Visibility (m) as the mean of the neighbours that report it; 20000 means "20 km or more".
    const seen = JMA.visibilityStations.map((id) => value(map[id]?.visibility)).filter((v) => v !== null);
    return {
      visibility: seen.length ? seen.reduce((a, v) => a + v, 0) / seen.length : null,
      humidity: value(s.humidity),
      temp: value(s.temp),
      precip10m: value(s.precipitation10m),
      wind: value(s.wind),
      sun1h: value(s.sun1h),
      time: latest.slice(11, 16),
    };
  } catch (error) {
    warn("amedas_fetch_failed", { error: String(error) });
    return null;
  }
}
